import type { Application, Cat, Email, InboxView, IvStatus, Pri, SortKey } from '@/data/types';
import { CAT, MN, PRI_RANK, stageLabel } from '@/data/constants';
import { addD } from './time';

/** Effective category: the user's override wins over the AI classification. */
export const effCat = (e: Email): Cat => e.catOv || e.cat;

export const needsAction = (e: Email): boolean => !!e.needs && !e.done;

export function inView(e: Email, view: InboxView): boolean {
  const c = effCat(e);
  switch (view) {
    case 'action': return needsAction(e);
    // Interview invitations include requests for availability: both lead to an interview.
    case 'invite': return c === 'invite' || c === 'avail' || e.sec === 'invite' || e.sec === 'avail';
    // A reschedule request is an action, not a request for availability.
    case 'avail': return (c === 'avail' || e.sec === 'avail') && e.mode !== 'resched';
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

export type RangeFilter = 'all' | 'today' | 'yesterday' | 'week' | 'days30' | 'month' | 'lastMonth' | 'custom';

export const RANGE_OPTIONS: { k: RangeFilter; l: string }[] = [
  { k: 'all', l: 'Any date' },
  { k: 'today', l: 'Today' },
  { k: 'yesterday', l: 'Yesterday' },
  { k: 'week', l: 'Last 7 days' },
  { k: 'days30', l: 'Last 30 days' },
  { k: 'month', l: 'This month' },
  { k: 'lastMonth', l: 'Last month' },
  { k: 'custom', l: 'Custom range…' },
];

/** The calendar day (ISO) an email arrived, on the app clock: `today` at `nowHour`, minus its age. */
export function receivedDay(e: Email, today: string, nowHour: number): string {
  return addD(today, Math.floor((nowHour * 60 - e.ago) / 1440));
}

/** An application's "Oct 8" applied date as an ISO day: this year, or last year if that would be after `today`. */
export function appliedDay(applied: string, today: string): string {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})$/.exec(applied.trim());
  const mi = m ? MN.indexOf(m[1]) : -1;
  if (!m || mi < 0) return '';
  const y = Number(today.slice(0, 4));
  const day = (yr: number) => yr + '-' + String(mi + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0');
  return day(y) > today ? day(y - 1) : day(y);
}

/** First and last day (ISO, inclusive) a range covers; '' leaves that end open. */
export function rangeDays(f: Pick<InboxFilters, 'rangeFilter' | 'rangeFrom' | 'rangeTo'>, today: string): [string, string] {
  const month = today.slice(0, 7);
  const lastMonth = addD(month + '-01', -1).slice(0, 7);
  switch (f.rangeFilter) {
    case 'today': return [today, today];
    case 'yesterday': return [addD(today, -1), addD(today, -1)];
    case 'week': return [addD(today, -6), today];
    case 'days30': return [addD(today, -29), today];
    case 'month': return [month + '-01', today];
    case 'lastMonth': return [lastMonth + '-01', addD(month + '-01', -1)];
    case 'custom': return f.rangeFrom && f.rangeTo && f.rangeFrom > f.rangeTo ? [f.rangeTo, f.rangeFrom] : [f.rangeFrom, f.rangeTo];
    default: return ['', ''];
  }
}

export interface InboxFilters {
  view: InboxView;
  acctFilter: string;
  catFilter: Cat | 'all';
  priFilter: Pri | 'all';
  coFilter: string;
  /** Only conversations with this address, sent or received ('' = everyone). */
  peer: string;
  rangeFilter: RangeFilter;
  /** Custom range, ISO days inclusive ('' = open). */
  rangeFrom: string;
  rangeTo: string;
  /** App clock, to place each email on a calendar day. */
  today: string;
  nowHour: number;
  ivFilter: 'all' | IvStatus;
  unreadOnly: boolean;
  /** Only conversations already read (the inbox's Read filter). */
  readOnly?: boolean;
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

/** The deadline (ISO day) if it is still ahead of `today`, else '' (none, unreadable, or already passed). */
export function upcomingDeadline(e: Email, today: string): string {
  const d = e.deadlineKey || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today ? d : '';
}

/**
 * Newest, oldest, priority (most urgent first, then still-to-do, then newest), or
 * approaching deadline: upcoming deadlines soonest first, then everything without
 * one (including deadlines already passed) newest first.
 */
export function sortEmails(list: Email[], key: SortKey, today = ''): Email[] {
  const todo = (e: Email) => (needsAction(e) ? 0 : 1);
  const by = (a: Email, b: Email): number => {
    switch (key) {
      case 'oldest': return b.ago - a.ago;
      case 'priority': return PRI_RANK[a.pri] - PRI_RANK[b.pri] || todo(a) - todo(b) || a.ago - b.ago;
      case 'deadline': {
        const da = upcomingDeadline(a, today);
        const db = upcomingDeadline(b, today);
        if (da !== db) return !da ? 1 : !db ? -1 : da.localeCompare(db);
        return todo(a) - todo(b) || a.ago - b.ago;
      }
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
  const [from, to] = rangeDays(f, f.today);
  if (from || to) {
    list = list.filter((e) => {
      const d = receivedDay(e, f.today, f.nowHour);
      return (!from || d >= from) && (!to || d <= to);
    });
  }
  if (f.ivFilter !== 'all') list = list.filter((e) => e.ivStatus === f.ivFilter);
  if (f.unreadOnly) list = list.filter((e) => e.unread);
  if (f.readOnly) list = list.filter((e) => !e.unread);
  if (f.actionOnly) list = list.filter(needsAction);
  if (f.savedKey) list = list.filter((e) => matchSaved(e, f.savedKey));
  if (q) list = list.filter((e) => searchText(e, apps).includes(q));
  return sortEmails(list, f.sortKey, f.today);
}

/** A message body for display: zero-width padding dropped, blank runs collapsed to one empty line. */
export function tidyBody(s: string): string {
  return s
    .replace(/[​-‏͏⁠﻿­]/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]{4,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

const MACHINE_NAME = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|info|support|hello|team)$/i;

/** A sender's display name; machine names like "no-reply" give way to the company, else the sending domain. */
export function senderName(name: string, addr: string, company = ''): string {
  const n = name.trim();
  if (n && n.toLowerCase() !== addr.toLowerCase() && !MACHINE_NAME.test(n)) return n;
  if (company) return company;
  const host = (addr.split('@')[1] || '').split('.');
  const brand = host.length > 1 ? host[host.length - 2] : host[0];
  return brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : n || addr;
}

/** Who is in a conversation, Gmail style: "Priya", "Tom, me", "Anna .. Ravi" (first names once several people take part). */
export function participants(e: Pick<Email, 'thread' | 'fromName' | 'fromAddr' | 'company'>): string {
  const names: string[] = [];
  for (const m of e.thread) {
    const n = m.mine ? 'me' : senderName(m.from, m.addr, e.company);
    if (!names.includes(n)) names.push(n);
  }
  if (!names.length) names.push(senderName(e.fromName, e.fromAddr, e.company));
  if (names.length === 1) return names[0];
  const short = names.map((n) => (n === 'me' ? n : n.split(/\s+/)[0]));
  return short.length > 3 ? short[0] + ' .. ' + short[short.length - 1] : short.join(', ');
}

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
