import { createHash } from 'node:crypto';
import { classifyMessage, classifySent, modelWanted } from './classify';
import { isJobAlert, isJobRelated, RULES_VERSION } from './classify/heuristic';
import { cfg } from './config';
import { GmailError, gmailFor, isRateLimitError, type GmailApi } from './google/gmail';
import { parseMessage } from './mime';
import { readMail, readSyncIndex, updateAccounts, writeMail, writeSyncIndex } from './store';
import type { MailStore, ParsedMessage, StoredAccount, StoredThread, SyncIndex } from './types';

/** The labels the UI mirrors, and the Gmail search that finds each. Order matters below. */
const LABEL_QUERIES: Record<string, string> = { UNREAD: 'is:unread', STARRED: 'is:starred', INBOX: 'in:inbox' };

async function pooled<T>(items: T[], width: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (i < items.length) {
      const x = items[i++];
      await fn(x);
    }
  });
  await Promise.all(workers);
}

/** New messages stored, deleted ones dropped, and work left for a later sync. */
export interface SyncOutcome {
  newMessages: number;
  removed: number;
  /** Conversations not downloaded yet. */
  pending: number;
  /** Conversations shown with the rules' classification, waiting for the model. */
  refining: number;
  /** Gmail asked to slow down; what was fetched is saved and the next sync continues. */
  throttled: boolean;
}

/** Conversations fetched from Gmail at once, and messages classified at once (model calls take seconds each). */
const FETCH_WIDTH = 8;
const CLASSIFY_WIDTH = 5;
/** Time kept back from downloading, before the deadline, for classifying and saving what was fetched. */
const FETCH_RESERVE_MS = 15_000;
/** Newest messages whose read/starred/inbox state is refreshed each sync; older mail rarely changes. */
const LABEL_WINDOW = 500;
/** Time kept back from model calls (each can take several seconds) for the last ones to finish and the save. */
const MODEL_RESERVE_MS = 12_000;
/** A sync that found nothing new saves its time at most this often. */
const LAST_SYNC_SAVE_MS = 15 * 60_000;

// One sync per account at a time: a second request (a click during an auto-sync) joins the running one.
const running = new Map<string, Promise<SyncOutcome>>();

/**
 * Pull recent mail for one account: every conversation with a new message is
 * fetched whole (sent and received, like Gmail shows it), parsed and classified;
 * known messages get their labels (read, starred, archived) refreshed so the UI
 * mirrors Gmail.
 */
export function syncAccount(acct: StoredAccount, api: GmailApi = gmailFor(acct), now: Date = new Date()): Promise<SyncOutcome> {
  const inFlight = running.get(acct.id);
  if (inFlight) return inFlight;
  const p = syncAccountNow(acct, api, now).finally(() => running.delete(acct.id));
  running.set(acct.id, p);
  return p;
}

type LabelSets = [unread: Set<string>, starred: Set<string>, inbox: Set<string>];

/** A fixed-size stand-in for a message id, so the index stays small even for Outlook's long ids. */
const shortId = (id: string): string => createHash('sha1').update(id).digest('base64url').slice(0, 8);

/** What Gmail reports about the mail we store. The same value as last time means there is nothing to do. */
function stateDigest(ids: string[], isStored: (id: string) => boolean, labels: LabelSets | null): string {
  if (!labels) return '';
  const stored = ids.filter(isStored);
  const flags = ids.slice(0, LABEL_WINDOW).filter(isStored).map((id) => labels.map((set) => (set.has(id) ? 1 : 0)).join(''));
  return createHash('sha1').update(RULES_VERSION + '|' + stored.join(',') + '|' + flags.join(',')).digest('base64url');
}

const storedIds = (mail: MailStore): string[] => Object.values(mail.threads).flatMap((t) => t.messages.map((m) => m.id));

/**
 * The stored mailbox is by far the largest thing this app moves, and most syncs change nothing in it. So a
 * small index answers "is anything new?", and the mailbox is only read when the answer is yes.
 */
async function syncAccountNow(acct: StoredAccount, api: GmailApi, now: Date): Promise<SyncOutcome> {
  // Wall clock, not `now` (tests pin `now` to the fixture's day).
  const deadline = Date.now() + cfg.syncBudgetMs;
  const left = () => deadline - Date.now();
  const savedIndex = await readSyncIndex(acct.id);
  // No index yet: build it from the mailbox, once.
  const firstMail = savedIndex ? null : await readMail(acct.id);
  const index: SyncIndex = savedIndex || { known: storedIds(firstMail!).map(shortId), skipped: firstMail!.skipped.map(shortId), digest: '' };
  const wasKnown = new Set(index.known);
  const isKnown = (id: string) => wasKnown.has(shortId(id));

  const listed = await api.listMessages(cfg.syncQuery, cfg.maxMessages);
  const ids = listed.map((m) => m.id);
  // With the job filter off, mail it skipped earlier is fetched now.
  const skipped = new Set(cfg.jobFilter ? index.skipped : []);

  // Refresh read/starred/archived on known messages with three searches rather than
  // one request per message, which used up Gmail's per-minute quota on large mailboxes.
  // Only the newest LABEL_WINDOW: any of those that is unread (starred, in the inbox) is
  // also among the newest LABEL_WINDOW unread (starred, inbox) ones, so each search is complete for them.
  const readLabels = async (): Promise<LabelSets | null> => {
    try {
      const [unread, starred, inbox] = await Promise.all(
        Object.keys(LABEL_QUERIES).map(async (label) => new Set(await api.listMessageIds(cfg.syncQuery + ' ' + LABEL_QUERIES[label], LABEL_WINDOW))),
      );
      return [unread, starred, inbox];
    } catch {
      return null; // label refresh is best effort
    }
  };
  const quickLabels = ids.slice(0, LABEL_WINDOW).some(isKnown) ? await readLabels() : null;
  const unchanged = !!index.digest && stateDigest(ids, isKnown, quickLabels) === index.digest;

  // Fetch each conversation with something new in full, so its earlier messages come
  // along even when they are older than the newest GMAIL_MAX_MESSAGES.
  // Newest first (the order Gmail lists them); a large backlog is worked through over several syncs.
  const waiting = [...new Set(listed.filter((m) => !isKnown(m.id) && !skipped.has(shortId(m.id))).map((m) => m.threadId))];
  // Measured from the request's deadline: listing and the checks above can take a while on a big mailbox.
  const fetchUntil = deadline - FETCH_RESERVE_MS;
  let fetched = 0;
  // A failed fetch (Gmail asking to slow down, mostly) ends this round's downloads; what came in is still saved.
  let stopped: unknown = null;
  const incoming = new Map<string, ParsedMessage[]>();
  await pooled(waiting.slice(0, cfg.syncBatch), FETCH_WIDTH, async (threadId) => {
    if (stopped || Date.now() >= fetchUntil) return;
    let raw;
    try {
      raw = await api.getThread(threadId);
    } catch (e) {
      stopped ||= e;
      return;
    }
    fetched++;
    const msgs = raw.map((m) => parseMessage(m, acct.email));
    // Nothing left in it (moved to Trash between listing and fetching): nothing to store.
    if (!msgs.length) return;
    if (cfg.jobFilter && !msgs.some((pm) => pm.isMine || isJobRelated(pm))) {
      msgs.forEach((pm) => skipped.add(shortId(pm.id)));
      return;
    }
    incoming.set(threadId, msgs);
  });

  // Skipped ids that left the listing can't come back through it, so the index only keeps the listed ones.
  const listedShort = new Set(ids.map(shortId));
  const keptSkipped = Array.from(skipped).filter((id) => listedShort.has(id));
  const finish = (outcome: Omit<SyncOutcome, 'pending' | 'throttled'>): SyncOutcome => {
    if (stopped && !isRateLimitError(stopped)) throw stopped;
    return { ...outcome, pending: waiting.length - fetched, throttled: !!stopped };
  };

  if (unchanged && !incoming.size) {
    const next: SyncIndex = { ...index, skipped: keptSkipped };
    if (JSON.stringify(next) !== JSON.stringify(savedIndex)) await writeSyncIndex(acct.id, next);
    // "Synced 10 minutes ago" is close enough; this is a write to the shared accounts list.
    if (!acct.lastSync || now.getTime() - Date.parse(acct.lastSync) >= LAST_SYNC_SAVE_MS) await saveSyncTime(acct, now);
    return finish({ newMessages: 0, removed: 0, refining: 0 });
  }

  const mail = firstMail || (await readMail(acct.id));
  const before = JSON.stringify(mail.threads);
  const startLabels = labelsById(mail);
  const known = new Map<string, StoredThread>();
  for (const t of Object.values(mail.threads)) for (const m of t.messages) known.set(m.id, t);
  // Read after the mailbox: a read or star made since the first search is in the mailbox as well as here.
  const labels = await readLabels();
  if (labels) {
    const [unread, starred, inbox] = labels;
    for (const id of ids.slice(0, LABEL_WINDOW).filter((x) => known.has(x))) {
      const pm = known.get(id)?.messages.find((x) => x.id === id);
      if (!pm) continue;
      const next = new Set(pm.labelIds.filter((l) => !(l in LABEL_QUERIES)));
      if (unread.has(id)) next.add('UNREAD');
      if (starred.has(id)) next.add('STARRED');
      if (inbox.has(id)) next.add('INBOX');
      // Only a real change: Gmail's order alone must not count as new data to save.
      if (labelKey(pm.labelIds) !== labelKey(Array.from(next))) pm.labelIds = Array.from(next);
    }
  }

  const removed = await dropDeleted(api, mail.threads, known, new Set(ids));

  let added = 0;
  for (const [threadId, msgs] of incoming) {
    const t = (mail.threads[threadId] ||= { id: threadId, messages: [] });
    for (const pm of msgs) {
      if (t.messages.some((x) => x.id === pm.id)) continue;
      t.messages.push(pm);
      added++;
    }
  }

  const toClassify: StoredThread[] = [];
  for (const t of Object.values(mail.threads)) {
    t.messages.sort((a, b) => a.date.localeCompare(b.date));
    const head = [...t.messages].reverse().find((m) => !m.isMine);
    if (!head) {
      // Only your own messages so far: shown under Sent until someone replies.
      const latest = t.messages[t.messages.length - 1];
      if (t.classifiedId === latest.id && t.classification) continue;
      t.classification = classifySent(latest);
      t.classifiedId = latest.id;
      continue;
    }
    if (t.classifiedId !== head.id || !t.classification || t.aiPending || staleRules(t)) toClassify.push(t);
  }
  // Every new conversation is shown right away with the rules' result; the model refines
  // the newest ones while time allows and the rest on later syncs.
  const headOf = (t: StoredThread) => [...t.messages].reverse().find((m) => !m.isMine)!;
  toClassify.sort((a, b) => headOf(b).date.localeCompare(headOf(a).date));
  await pooled(toClassify, CLASSIFY_WIDTH, async (t) => {
    const head = headOf(t);
    const fresh = t.classifiedId !== head.id || !t.classification || staleRules(t);
    const model = left() > MODEL_RESERVE_MS;
    if (!fresh && !model) return;
    t.classification = await classifyMessage(head, t.messages, now, model);
    t.classifiedId = head.id;
    if (!model && modelWanted(head, t.messages)) t.aiPending = true;
    else delete t.aiPending;
  });

  const changed = JSON.stringify(mail.threads) !== before;
  if (changed) {
    mail.skipped = []; // kept in the index now
    mail.lastSync = now.toISOString();
    await keepLabelChanges(acct.id, mail, startLabels);
    await writeMail(acct.id, mail);
    // The browser reloads the mail when this changes.
    acct.mailRev = Date.now().toString(36);
  }
  const refining = Object.values(mail.threads).filter((t) => t.aiPending).length;
  const nowStored = new Set(storedIds(mail));
  const next: SyncIndex = {
    known: Array.from(nowStored).map(shortId),
    skipped: keptSkipped,
    // Unfinished work means the next sync has to look in the mailbox again.
    digest: stopped || refining ? '' : stateDigest(ids, (id) => nowStored.has(id), labels),
  };
  if (JSON.stringify(next) !== JSON.stringify(savedIndex)) await writeSyncIndex(acct.id, next);
  await saveSyncTime(acct, now);
  return finish({ newMessages: added, removed, refining });
}

async function saveSyncTime(acct: StoredAccount, now: Date): Promise<void> {
  acct.lastSync = now.toISOString();
  await updateAccounts((list) => list.map((a) => (a.id === acct.id ? { ...a, lastSync: acct.lastSync, mailRev: acct.mailRev } : a)));
}

/**
 * Classified by an older version of the rules (the model's results are kept), or a job alert
 * an earlier classification took for a request.
 */
const staleRules = (t: StoredThread): boolean => {
  const c = t.classification;
  if (!c) return false;
  if (c.classifier === 'rules' && c.rulesVersion !== RULES_VERSION) return true;
  const head = t.messages.find((m) => m.id === t.classifiedId);
  return !!head && c.cat !== 'auto' && c.cat !== 'other' && isJobAlert(head);
};

/** Unlisted messages checked one by one per sync, at most. */
const VERIFY_MAX = 50;

/**
 * Forget mail deleted in Gmail. Trashed or spammed messages are found with one search;
 * a stored message missing from the listing although newer than listed mail was deleted
 * for good, which a lookup confirms (404). Threads left empty are removed. Returns the count.
 */
async function dropDeleted(api: GmailApi, threads: Record<string, StoredThread>, known: Map<string, StoredThread>, listed: Set<string>): Promise<number> {
  const gone = new Set<string>();
  try {
    for (const id of await api.listMessageIds('in:trash OR in:spam', 500)) if (known.has(id)) gone.add(id);
  } catch {
    /* best effort; the next sync tries again */
  }
  // Mail older than the oldest listed message may simply be outside the sync window, so only newer mail is checked.
  const listedDates = [...known.entries()].filter(([id]) => listed.has(id)).map(([id, t]) => t.messages.find((m) => m.id === id)!.date);
  const floor = listedDates.length ? listedDates.reduce((a, b) => (a < b ? a : b)) : '';
  if (floor) {
    const unlisted = [...known.entries()]
      .filter(([id]) => !listed.has(id) && !gone.has(id))
      .map(([id, t]) => t.messages.find((m) => m.id === id)!)
      .filter((m) => m.date > floor)
      .slice(0, VERIFY_MAX);
    await pooled(unlisted, FETCH_WIDTH, async (m) => {
      try {
        const g = await api.getMessage(m.id, 'minimal');
        if ((g.labelIds || []).some((l) => l === 'TRASH' || l === 'SPAM')) gone.add(m.id);
      } catch (e) {
        if (e instanceof GmailError && e.status === 404) gone.add(m.id);
      }
    });
  }
  for (const id of gone) {
    const t = known.get(id)!;
    t.messages = t.messages.filter((m) => m.id !== id);
    known.delete(id);
    if (!t.messages.length) delete threads[t.id];
  }
  return gone.size;
}

const labelKey = (labels: string[]): string => [...labels].sort().join(',');

function labelsById(mail: MailStore): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of Object.values(mail.threads)) for (const m of t.messages) out.set(m.id, labelKey(m.labelIds));
  return out;
}

/**
 * A sync works on the copy of the mail it read when it started, for up to its time budget. Marking
 * mail read, unread, starred or archived in that time saves labels to the stored copy; keep those
 * rather than writing the sync's older ones over them (they are newer than its label refresh too).
 */
async function keepLabelChanges(accountId: string, mail: MailStore, startLabels: Map<string, string>): Promise<void> {
  const latest = await readMail(accountId);
  for (const t of Object.values(latest.threads)) {
    for (const m of t.messages) {
      const was = startLabels.get(m.id);
      if (was === undefined || was === labelKey(m.labelIds)) continue;
      const ours = mail.threads[t.id]?.messages.find((x) => x.id === m.id);
      if (ours) ours.labelIds = m.labelIds;
    }
  }
}

/** Add and remove labels on every message of a stored thread (in memory). */
export function applyLabels(t: StoredThread | undefined, add: string[], remove: string[]): void {
  for (const m of t?.messages || []) {
    const set = new Set(m.labelIds);
    add.forEach((l) => set.add(l));
    remove.forEach((l) => set.delete(l));
    m.labelIds = Array.from(set);
  }
}

/** Update stored labels right away so the next snapshot reflects a read/star/archive action. */
export async function updateStoredLabels(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  const mail = await readMail(accountId);
  const t = mail.threads[threadId];
  if (!t) return;
  applyLabels(t, add, remove);
  await writeMail(accountId, mail);
}
