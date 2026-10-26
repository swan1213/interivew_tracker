import { classifyMessage, classifySent, modelWanted } from './classify';
import { isJobRelated, RULES_VERSION } from './classify/heuristic';
import { cfg } from './config';
import { GmailError, gmailFor, isRateLimitError, type GmailApi } from './google/gmail';
import { parseMessage } from './mime';
import { readMail, updateAccounts, writeMail } from './store';
import type { StoredAccount, StoredThread } from './types';

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

async function syncAccountNow(acct: StoredAccount, api: GmailApi, now: Date): Promise<SyncOutcome> {
  // Wall clock, not `now` (tests pin `now` to the fixture's day).
  const deadline = Date.now() + cfg.syncBudgetMs;
  const left = () => deadline - Date.now();
  const mail = await readMail(acct.id);
  const listed = await api.listMessages(cfg.syncQuery, cfg.maxMessages);
  const ids = listed.map((m) => m.id);
  const known = new Map<string, StoredThread>();
  for (const t of Object.values(mail.threads)) for (const m of t.messages) known.set(m.id, t);
  // With the job filter off, mail it skipped earlier is fetched now.
  const skipped = new Set(cfg.jobFilter ? mail.skipped : []);
  let added = 0;

  // Refresh read/starred/archived on known messages with three searches rather than
  // one request per message, which used up Gmail's per-minute quota on large mailboxes.
  // Only the newest LABEL_WINDOW: any of those that is unread (starred, in the inbox) is
  // also among the newest LABEL_WINDOW unread (starred, inbox) ones, so each search is complete for them.
  const knownIds = ids.slice(0, LABEL_WINDOW).filter((id) => known.has(id));
  if (knownIds.length) {
    try {
      const [unread, starred, inbox] = await Promise.all(
        Object.keys(LABEL_QUERIES).map(async (label) => new Set(await api.listMessageIds(cfg.syncQuery + ' ' + LABEL_QUERIES[label], LABEL_WINDOW))),
      );
      for (const id of knownIds) {
        const pm = known.get(id)?.messages.find((x) => x.id === id);
        if (!pm) continue;
        const labels = new Set(pm.labelIds.filter((l) => !(l in LABEL_QUERIES)));
        if (unread.has(id)) labels.add('UNREAD');
        if (starred.has(id)) labels.add('STARRED');
        if (inbox.has(id)) labels.add('INBOX');
        pm.labelIds = Array.from(labels);
      }
    } catch {
      /* label refresh is best effort */
    }
  }

  const removed = await dropDeleted(api, mail.threads, known, new Set(ids));

  // Fetch each conversation with something new in full, so its earlier messages come
  // along even when they are older than the newest GMAIL_MAX_MESSAGES.
  // Newest first (the order Gmail lists them); a large backlog is worked through over several syncs.
  const waiting = [...new Set(listed.filter((m) => !known.has(m.id) && !skipped.has(m.id)).map((m) => m.threadId))];
  // Measured from the request's deadline: listing and the checks above can take a while on a big mailbox.
  const fetchUntil = deadline - FETCH_RESERVE_MS;
  let fetched = 0;
  // A failed fetch (Gmail asking to slow down, mostly) ends this round's downloads; what came in is still saved.
  let stopped: unknown = null;
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
      msgs.forEach((pm) => skipped.add(pm.id));
      return;
    }
    const t = (mail.threads[threadId] ||= { id: threadId, messages: [] });
    for (const pm of msgs) {
      if (t.messages.some((x) => x.id === pm.id)) continue;
      t.messages.push(pm);
      added++;
    }
  });

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

  mail.skipped = Array.from(skipped).slice(-5000);
  mail.lastSync = now.toISOString();
  await writeMail(acct.id, mail);
  acct.lastSync = mail.lastSync;
  await updateAccounts((list) => list.map((a) => (a.id === acct.id ? { ...a, lastSync: acct.lastSync } : a)));
  const refining = Object.values(mail.threads).filter((t) => t.aiPending).length;
  if (stopped && !isRateLimitError(stopped)) throw stopped;
  return { newMessages: added, removed, pending: waiting.length - fetched, refining, throttled: !!stopped };
}

/** Classified by an older version of the rules (the model's results are kept). */
const staleRules = (t: StoredThread): boolean => t.classification?.classifier === 'rules' && t.classification.rulesVersion !== RULES_VERSION;

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

/** Update stored labels right away so the next snapshot reflects a read/star/archive action. */
export async function updateStoredLabels(accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  const mail = await readMail(accountId);
  const t = mail.threads[threadId];
  if (!t) return;
  for (const m of t.messages) {
    const set = new Set(m.labelIds);
    add.forEach((l) => set.add(l));
    remove.forEach((l) => set.delete(l));
    m.labelIds = Array.from(set);
  }
  await writeMail(accountId, mail);
}
