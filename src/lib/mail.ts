import type { Application, Cat, Email, InboxView, IvStatus, Pri, SortKey } from '@/data/types';
import { CAT, PRI_RANK, stageLabel } from '@/data/constants';

/** Effective category: the user's override wins over the AI classification. */
export const effCat = (e: Email): Cat => e.catOv || e.cat;

export const needsAction = (e: Email): boolean => !!e.needs && !e.done;

export function inView(e: Email, view: InboxView): boolean {
  const c = effCat(e);
  switch (view) {
    case 'action': return needsAction(e);
    case 'invite': return c === 'invite' || e.sec === 'invite';
    // A reschedule request is an action, not a request for availability.
    case 'avail': return (c === 'avail' || e.sec === 'avail') && e.mode !== 'resched';
    case 'status': return c === 'status';
    case 'applied': return c === 'applied';
    case 'offers': return c === 'offer';
    case 'rejected': return c === 'rejected';
    case 'auto': return c === 'auto' || e.sec === 'auto';
    case 'sent': return c === 'sent';
    case 'other': return c === 'other';
    default: return true;
  }
}

export function matchSaved(e: Email, k: string): boolean {
  const c = effCat(e);
  if (k === 'reply') return needsAction(e) && e.ago <= 1440;
  if (k === 'week') return e.ivStatus !== 'none' || c === 'invite' || c === 'avail';
  if (k === 'wait') return e.ivStatus === 'awaiting';
  if (k === 'new') return e.unread && c !== 'auto' && c !== 'applied';
  if (k === 'high') return e.pri === 'critical' || e.pri === 'high';
  if (k === 'unreadapp') return e.unread && (c === 'applied' || c === 'status');
  return true;
}

export interface InboxFilters {
  view: InboxView;
  acctFilter: string;
  catFilter: Cat | 'all';
  priFilter: Pri | 'all';
  coFilter: string;
  /** Only conversations with this address, sent or received ('' = everyone). */
  peer: string;
  rangeFilter: 'all' | 'today' | 'week';
  ivFilter: 'all' | IvStatus;
  unreadOnly: boolean;
  actionOnly: boolean;
  savedKey: string;
  q: string;
  sortKey: SortKey;
}

/** Everything search can match on, lower-cased. */
export function searchText(e: Email, apps: Application[]): string {
  const app = apps.find((a) => a.co === e.company);
  return [
    e.company, e.role, e.recruiter, e.fromName, e.fromAddr, e.subject, e.body,
    CAT[effCat(e)].l, e.stage, app ? stageLabel(app.stage) : '',
    (e.times || []).map((t) => t.label).join(' '), e.deadline,
  ].join(' ').toLowerCase();
}

export function sortEmails(list: Email[], key: SortKey): Email[] {
  const by = (a: Email, b: Email): number => {
    switch (key) {
      case 'oldest': return b.ago - a.ago;
      case 'priority': return PRI_RANK[a.pri] - PRI_RANK[b.pri] || a.ago - b.ago;
      case 'deadline': return a.deadlineKey.localeCompare(b.deadlineKey) || a.ago - b.ago;
      default: return a.ago - b.ago;
    }
  };
  return list.slice().sort(by);
}

export function filterEmails(all: Email[], f: InboxFilters, apps: Application[]): Email[] {
  const q = f.q.trim().toLowerCase();
  let list = all.filter((e) => inView(e, f.view));
  if (f.acctFilter !== 'all') list = list.filter((e) => e.acct === f.acctFilter);
  if (f.catFilter !== 'all') list = list.filter((e) => effCat(e) === f.catFilter);
  if (f.priFilter !== 'all') list = list.filter((e) => e.pri === f.priFilter);
  if (f.coFilter !== 'all') list = list.filter((e) => e.company === f.coFilter);
  if (f.peer) list = list.filter((e) => (e.peers || []).includes(f.peer) || e.fromAddr.toLowerCase() === f.peer);
  if (f.rangeFilter === 'today') list = list.filter((e) => e.ago <= 1440);
  if (f.rangeFilter === 'week') list = list.filter((e) => e.ago <= 10080);
  if (f.ivFilter !== 'all') list = list.filter((e) => e.ivStatus === f.ivFilter);
  if (f.unreadOnly) list = list.filter((e) => e.unread);
  if (f.actionOnly) list = list.filter(needsAction);
  if (f.savedKey) list = list.filter((e) => matchSaved(e, f.savedKey));
  if (q) list = list.filter((e) => searchText(e, apps).includes(q));
  return sortEmails(list, f.sortKey);
}

/** Second and third non-empty lines of the body, trimmed to a preview. */
export function previewOf(e: Email): string {
  return e.body.split('\n').filter((x) => x.trim()).slice(1, 3).join(' ').slice(0, 110);
}

export const companyLine = (e: Email): string =>
  e.role || (e.company ? 'Role not specified' : 'No company detected');

/** First URL-ish token in a body, for "open link" style actions. */
export function firstLink(body: string): string | null {
  const m = body.match(/https?:\/\/\S+|\b[\w.-]+\.(?:example|com|io|net|org)\/\S+/);
  return m ? m[0].replace(/[).,]+$/, '') : null;
}

/** Automated senders nobody reads replies to. */
export const isNoReply = (addr: string): boolean => /no-?reply|do-?not-?reply|^notifications?@|^alerts?@|mailer-daemon|^news(letter)?@|^updates?@/i.test(addr);

/** Subject for a reply or forward, without stacking "Re: Re:" or "Fwd: Re:". */
export const replySubject = (subject: string, forward: boolean): string => (forward ? 'Fwd: ' : 'Re: ') + subject.replace(/^((re|fwd?):\s*)+/i, '');

/** Who a reply goes to: the sender, or with reply all everyone else on the conversation. */
export function replyRecipients(e: Email, all: boolean, me: string): string {
  const sender = e.fromAddr.toLowerCase();
  if (!all) return sender;
  return [sender, ...(e.peers || [])].filter((x, i, a) => x && x !== me.toLowerCase() && a.indexOf(x) === i).join(', ');
}

/** The original message below a forward, the way mail clients quote it. */
export function forwardBlock(e: Email): string {
  const m = e.thread[e.thread.length - 1];
  return [
    '',
    '',
    '---------- Forwarded message ---------',
    'From: ' + (m ? m.from + ' <' + m.addr + '>' : e.fromName + ' <' + e.fromAddr + '>'),
    'Date: ' + (m ? m.when : e.time),
    'Subject: ' + e.subject,
    '',
    m ? m.body : e.body,
  ].join('\n');
}
