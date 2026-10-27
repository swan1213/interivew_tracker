import type { Account, Application, CalEvent, Email, InboxView, ThemePref } from '@/data/types';
import { meetingStages } from '@/lib/calendar';
import { addD } from '@/lib/time';
import { inView, needsAction } from '@/lib/mail';

export const FALLBACK_ACCT: Account = {
  id: '', label: 'No account', addr: '', provider: 'Gmail', color: '#666666', initial: '?', sendAs: '', sync: '',
};

/** Emails that are not archived and belong to a still-connected account. */
export const visibleAll = (emails: Email[], accts: Account[]): Email[] =>
  emails.filter((e) => !e.archived && accts.some((a) => a.id === e.acct));

export const unreadCount = (all: Email[], id = 'all'): number =>
  all.filter((e) => e.unread && (id === 'all' || e.acct === id)).length;

export const actionCount = (all: Email[]): number => all.filter(needsAction).length;

export const viewUnread = (all: Email[], v: InboxView): number =>
  all.filter((e) => inView(e, v) && e.unread).length;

export const getAcct = (accts: Account[], id: string): Account =>
  accts.find((a) => a.id === id) || accts[0] || FALLBACK_ACCT;

export const isDarkTheme = (themePref: ThemePref, sysDark: boolean): boolean =>
  themePref === 'dark' || (themePref === 'auto' && sysDark);

/** The mailbox an event belongs to: its own calendar account, else the account of the email it came from. */
export function eventAccount(accts: Account[], emails: Email[], v: CalEvent): Account | undefined {
  const id = v.acct || (v.emailId ? emails.find((e) => e.id === v.emailId)?.acct || v.emailId.split(':')[0] : '');
  return id ? accts.find((a) => a.id === id) : undefined;
}

type TrackIn = { apps: Application[]; events: CalEvent[]; accts: Account[]; emails: Email[]; today: string };
let tracked: (TrackIn & { out: Application[] }) | null = null;

/** Applications with their stage taken from the calendar (see meetingStages), cached until the data changes. */
export function trackedApps(s: TrackIn): Application[] {
  if (!tracked || tracked.apps !== s.apps || tracked.events !== s.events || tracked.accts !== s.accts || tracked.emails !== s.emails || tracked.today !== s.today) {
    const ago = new Map(s.emails.map((e) => [e.id, e.ago]));
    const mailDay = (id: string) => (ago.has(id) ? addD(s.today, -Math.floor(ago.get(id)! / 1440)) : undefined);
    tracked = { apps: s.apps, events: s.events, accts: s.accts, emails: s.emails, today: s.today, out: meetingStages(s.apps, s.events, s.accts.map((a) => a.addr), s.today, mailDay) };
  }
  return tracked.out;
}
