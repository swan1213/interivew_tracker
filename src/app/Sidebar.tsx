import { useCallback } from 'react';
import { useStore } from '@/store/store';
import { actionCount, getAcct, unreadCount, viewUnread, visibleAll } from '@/store/selectors';
import { provider } from '@/data/provider';
import type { IconName } from '@/data/constants';
import type { InboxView, Page } from '@/data/types';
import { canSee, currentRole } from '@/lib/roles';
import { cx } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { AcDot } from '@/ui/bits';
import { useClickOutside } from './hooks';

interface NavItem {
  label: string;
  icon: IconName;
  count: number;
  hot: boolean;
  active: boolean;
  go: () => void;
  /** Page the item opens, used to hide items the current role may not see. */
  page?: Page;
}

const nav = (label: string, icon: IconName, count: number, hot: boolean, active: boolean, go: () => void, page?: Page): NavItem => ({ label, icon, count, hot, active, go, page });

function NavButton({ n, showCount = true }: { n: NavItem; showCount?: boolean }) {
  return (
    <button type="button" className={cx('ni', n.active && 'on')} onClick={n.go} title={n.label} aria-current={n.active ? 'page' : undefined}>
      <Icon name={n.icon} />
      <span className="lbl">{n.label}</span>
      {showCount && n.count > 0 && <span className={cx('cnt', n.hot && 'hot')}>{n.count}</span>}
      <span className={cx('pip', n.count > 0 && n.hot && 'show')} />
    </button>
  );
}

export function Sidebar() {
  const st = useStore();
  const all = visibleAll(st.emails, st.accts);
  const unreadAll = unreadCount(all);
  const actionN = actionCount(all);
  const pg = st.page;
  const role = currentRole(st);
  const guest = role === 'guest';
  const inb = (v: InboxView) => pg === 'inbox' && st.view === v;
  const view = (v: InboxView) => () => st.openView(v);

  const navMain: NavItem[] = [
    nav('Dashboard', 'dash', 0, false, pg === 'dash', () => st.go('dash')),
    nav('Unified Inbox', 'inbox', unreadAll, false, inb('inbox'), view('inbox')),
  ];
  const navViews: NavItem[] = [
    nav('Action Required', 'bolt', actionN, true, inb('action'), view('action')),
    nav('Interview Invitations', 'video', viewUnread(all, 'invite'), false, inb('invite'), view('invite')),
    nav('Availability Requests', 'clock', viewUnread(all, 'avail'), false, inb('avail'), view('avail')),
    nav('Upcoming Interviews', 'checkc', 0, false, pg === 'cal' && st.calView === 'agenda', () => st.go('cal', { calView: 'agenda', calDate: st.today })),
    nav('Application Updates', 'info', viewUnread(all, 'status'), false, inb('status'), view('status')),
    nav('Application Confirmations', 'file', viewUnread(all, 'applied'), false, inb('applied'), view('applied')),
    nav('Offers', 'award', viewUnread(all, 'offers'), true, inb('offers'), view('offers')),
    nav('Rejections', 'xc', 0, false, inb('rejected'), view('rejected')),
    nav('Automated / No-Reply', 'bot', viewUnread(all, 'auto'), false, inb('auto'), view('auto')),
    nav('Sent', 'send', 0, false, inb('sent'), view('sent')),
  ];
  const navTools: NavItem[] = [
    nav('Calendar', 'cal', 0, false, pg === 'cal' && st.calView !== 'agenda', () => st.go('cal', { calView: st.calView === 'agenda' ? 'week' : st.calView }), 'cal'),
    nav('Application Tracker', 'kanban', 0, false, pg === 'track', () => st.go('track'), 'track'),
    nav('Analytics', 'chart', 0, false, pg === 'analytics', () => st.go('analytics'), 'analytics'),
    nav('Connected Accounts', 'plug', 0, false, pg === 'accounts', () => st.go('accounts'), 'accounts'),
    nav('Team & Roles', 'users', 0, false, pg === 'team', () => st.go('team'), 'team'),
    nav('Settings', 'sliders', 0, false, pg === 'settings', () => st.go('settings'), 'settings'),
  ].filter((n) => !n.page || canSee(role, n.page));

  const cur = st.acctFilter === 'all' ? null : getAcct(st.accts, st.acctFilter);
  const closeMenu = useCallback(() => useStore.getState().patch({ acMenuOpen: false }), []);
  const menuRef = useClickOutside<HTMLDivElement>(st.acMenuOpen, closeMenu);
  const acLabel = cur ? cur.label : 'All accounts';

  return (
    <aside className={cx('side', st.collapsed && 'col')} aria-label="Primary">
      <div className="brand">
        <span className="logo">
          <Icon name="flow" />
        </span>
        <span className="brandtx">
          InterviewFlow AI<small>Job search workspace</small>
        </span>
      </div>

      {!guest && (
      <div className="acsw" ref={menuRef}>
        <button
          type="button"
          className="acbtn"
          onClick={() => st.patch({ acMenuOpen: !st.acMenuOpen, notifOpen: false })}
          aria-haspopup="listbox"
          aria-expanded={st.acMenuOpen}
          aria-label={'Switch email account. Showing ' + acLabel}
        >
          <AcDot color={cur ? cur.color : 'var(--tx2)'} initial={cur ? cur.initial : '∑'} />
          <span className="acmeta">
            <b>{acLabel}</b>
            <span>{cur ? cur.addr : st.accts.length + ' accounts · ' + unreadAll + ' unread'}</span>
          </span>
          <Icon name="updown" sm className="chev" />
        </button>
        {st.acMenuOpen && (
          <div className="acmenu" role="listbox" aria-label="Accounts">
            <button type="button" role="option" aria-selected={st.acctFilter === 'all'} className={cx('acitem', st.acctFilter === 'all' && 'on')} onClick={() => st.patch({ acctFilter: 'all', acMenuOpen: false })}>
              <AcDot color="var(--tx2)" initial="∑" />
              <span className="acmeta">
                <b>All accounts</b>
                <span>Unified inbox · {unreadAll} unread</span>
              </span>
            </button>
            {st.accts.map((a) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={st.acctFilter === a.id}
                className={cx('acitem', st.acctFilter === a.id && 'on')}
                onClick={() => st.patch({ acctFilter: a.id, acMenuOpen: false, page: 'inbox', view: 'inbox' })}
              >
                <AcDot color={a.color} initial={a.initial} />
                <span className="acmeta">
                  <b>{a.label}</b>
                  <span>{a.addr}</span>
                </span>
                <span className="cnt">{unreadCount(all, a.id)}</span>
              </button>
            ))}
            <button type="button" className="acitem" onClick={() => st.go('accounts')}>
              <AcDot color="var(--sf3)" initial="+" style={{ color: 'var(--tx)' }} />
              <span className="acmeta">
                <b>Manage accounts</b>
              </span>
            </button>
          </div>
        )}
      </div>
      )}

      <nav className="nav" aria-label="Sections">
        {!guest && (
          <>
            {navMain.map((n) => (
              <NavButton key={n.label} n={n} />
            ))}
            <div className="grp">Smart views</div>
            {navViews.map((n) => (
              <NavButton key={n.label} n={n} />
            ))}
          </>
        )}
        <div className="grp">{guest ? 'Guest access' : 'Workspace'}</div>
        {navTools.map((n) => (
          <NavButton key={n.label} n={n} showCount={false} />
        ))}
      </nav>

      <div className="sidefoot">
        {provider.isDemo && <p className="demo">Demo workspace with fictional data. No real accounts, OAuth, sync or AI are connected.</p>}
        <button type="button" className="ni" onClick={st.toggleSide} aria-label={st.collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={st.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name="panel" />
          <span className="lbl">Collapse</span>
        </button>
      </div>
    </aside>
  );
}
