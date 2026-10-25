import { classifyMessage } from './classify';
import { isJobRelated } from './classify/heuristic';
import { cfg } from './config';
import { gmailFor, type GmailApi } from './google/gmail';
import { parseMessage } from './mime';
import { readAccounts, readMail, writeAccounts, writeMail } from './store';
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

/**
 * Pull recent mail for one account: new messages are fetched, filtered to
 * job-related ones, parsed and classified; known messages get their labels
 * (read, starred, archived) refreshed so the UI mirrors Gmail.
 */
export async function syncAccount(acct: StoredAccount, api: GmailApi = gmailFor(acct), now: Date = new Date()): Promise<{ newMessages: number }> {
  const mail = await readMail(acct.id);
  const ids = await api.listMessageIds(cfg.syncQuery, cfg.maxMessages);
  const known = new Map<string, StoredThread>();
  for (const t of Object.values(mail.threads)) for (const m of t.messages) known.set(m.id, t);
  const skipped = new Set(mail.skipped);
  let added = 0;

  // Refresh read/starred/archived on known messages with three searches rather than
  // one request per message, which used up Gmail's per-minute quota on large mailboxes.
  const knownIds = ids.filter((id) => known.has(id));
  if (knownIds.length) {
    try {
      const [unread, starred, inbox] = await Promise.all(
        Object.keys(LABEL_QUERIES).map(async (label) => new Set(await api.listMessageIds(cfg.syncQuery + ' ' + LABEL_QUERIES[label], cfg.maxMessages))),
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

  await pooled(
    ids.filter((id) => !known.has(id) && !skipped.has(id)),
    4,
    async (id) => {
      const m = await api.getMessage(id, 'full');
      const pm = parseMessage(m, acct.email);
      if (cfg.jobFilter && !pm.isMine && !isJobRelated(pm)) {
        skipped.add(id);
        return;
      }
      const t = (mail.threads[pm.threadId] ||= { id: pm.threadId, messages: [] });
      if (!t.messages.some((x) => x.id === pm.id)) {
        t.messages.push(pm);
        added++;
      }
    },
  );

  for (const t of Object.values(mail.threads)) {
    t.messages.sort((a, b) => a.date.localeCompare(b.date));
    const head = [...t.messages].reverse().find((m) => !m.isMine);
    if (!head) continue;
    if (t.classifiedId === head.id && t.classification) continue;
    t.classification = await classifyMessage(head, t.messages, now);
    t.classifiedId = head.id;
  }

  mail.skipped = Array.from(skipped).slice(-5000);
  mail.lastSync = now.toISOString();
  await writeMail(acct.id, mail);
  acct.lastSync = mail.lastSync;
  await writeAccounts((await readAccounts()).map((a) => (a.id === acct.id ? { ...a, lastSync: acct.lastSync } : a)));
  return { newMessages: added };
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
