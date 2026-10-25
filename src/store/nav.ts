import type { CalView, InboxView, Page } from '@/data/types';

const VIEWS: InboxView[] = ['inbox', 'action', 'invite', 'avail', 'status', 'applied', 'offers', 'rejected', 'auto', 'sent'];
const CAL_VIEWS: CalView[] = ['month', 'week', 'day', 'agenda'];

export interface Route {
  page: Page;
  view?: InboxView;
  calView?: CalView;
}

/** URL for a page. Only the inbox view and calendar view are encoded; filters stay in state. */
export function pathFor(page: Page, view: InboxView, calView: CalView): string {
  switch (page) {
    case 'dash': return '/';
    case 'inbox': return view === 'inbox' ? '/inbox' : '/inbox/' + view;
    case 'cal': return calView === 'week' ? '/calendar' : '/calendar/' + calView;
    case 'track': return '/tracker';
    case 'analytics': return '/analytics';
    case 'accounts': return '/accounts';
    case 'team': return '/team';
    case 'settings': return '/settings';
  }
}

export function parsePath(pathname: string): Route {
  const [a, b] = pathname.split('/').filter(Boolean);
  if (!a) return { page: 'dash' };
  if (a === 'inbox') return { page: 'inbox', view: VIEWS.includes(b as InboxView) ? (b as InboxView) : 'inbox' };
  if (a === 'calendar') return { page: 'cal', calView: CAL_VIEWS.includes(b as CalView) ? (b as CalView) : 'week' };
  if (a === 'tracker') return { page: 'track' };
  if (a === 'analytics') return { page: 'analytics' };
  if (a === 'accounts') return { page: 'accounts' };
  if (a === 'team') return { page: 'team' };
  if (a === 'settings') return { page: 'settings' };
  return { page: 'dash' };
}

export const PAGE_TITLES: Record<Page, string> = {
  dash: 'Dashboard',
  inbox: 'Inbox',
  cal: 'Calendar',
  track: 'Application tracker',
  analytics: 'Analytics',
  accounts: 'Connected accounts',
  team: 'Team & roles',
  settings: 'Settings',
};
