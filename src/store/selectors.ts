import type { Account, CalEvent, Email, InboxView, ThemePref } from '@/data/types';
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
