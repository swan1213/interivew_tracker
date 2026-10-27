import { useCallback } from 'react';
import { useStore } from '@/store/store';
import { getAcct, isDarkTheme } from '@/store/selectors';
import { provider } from '@/data/provider';
import { CAT } from '@/data/constants';
import { cx } from '@/lib/util';
import { canManageRoles, currentMember, currentRole } from '@/lib/roles';
import { Icon } from '@/ui/Icon';
import { RoleChip } from '@/ui/bits';
import { useClickOutside } from './hooks';

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('') || '?';

export function TopBar() {
  const st = useStore();
  const unreadNotifs = st.notifs.filter((n) => n.unread).length;
  const dark = isDarkTheme(st.themePref, st.sysDark);
  const closePop = useCallback(() => useStore.getState().patch({ notifOpen: false }), []);
  const popRef = useClickOutside<HTMLDivElement>(st.notifOpen, closePop);
  const me = currentMember(st);
  const role = currentRole(st);
  const guest = role === 'guest';
  const others = st.members.filter((m) => m.id !== me?.id);
  const closeUser = useCallback(() => useStore.getState().patch({ userMenuOpen: false }), []);
  const userRef = useClickOutside<HTMLDivElement>(st.userMenuOpen, closeUser);

  return (
    <header className="top">
      {!guest && (
        <>
      <label className="srch">
        <Icon name="search" />
        <input
          type="search"
          placeholder="Search company, role, recruiter, subject, status, category…"
          value={st.q}
          onChange={(e) => st.setSearch(e.target.value)}
          aria-label="Search all connected accounts"
        />
      </label>
      <span className="tag" title={st.acctFilter === 'all' ? 'Search runs across every connected account' : 'Search runs in this account; pick All accounts in the sidebar to search every one'}>
        {st.acctFilter === 'all' ? 'All accounts' : getAcct(st.accts, st.acctFilter).label}
      </span>
        </>
      )}
      {guest && (
        <span className="tag" title="Guests can only see Analytics">
          Guest view · Analytics only
        </span>
      )}
      <span className="sp" />
      {!guest && (
      <button type="button" className="btn sm" onClick={st.refreshAll} aria-label="Sync all accounts" disabled={st.syncing}>
        <Icon name="refresh" sm />
        {st.syncing ? 'Syncing…' : 'Sync'}
      </button>
      )}
      <button type="button" className="ib" onClick={st.toggleTheme} aria-label="Switch light or dark theme" title="Switch theme">
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      {!guest && (
      <div ref={popRef} style={{ display: 'contents' }}>
        <button
          type="button"
          className="ib"
          onClick={() => st.patch({ notifOpen: !st.notifOpen, acMenuOpen: false, userMenuOpen: false })}
          aria-label={'Notifications, ' + unreadNotifs + ' unread'}
          aria-expanded={st.notifOpen}
          title="Notifications"
        >
          <Icon name="bell" />
          {unreadNotifs > 0 && <span className="badge">{unreadNotifs}</span>}
        </button>
        {st.notifOpen && (
          <div className="pop" role="dialog" aria-label="Notification center">
            <div className="ph2">
              <b>Notifications</b>
              <span className="ln">
                <button type="button" className="btn ghost sm" onClick={st.markAllNotifs}>
                  Mark all read
                </button>
                <button type="button" className="ib" style={{ width: 26, height: 26 }} onClick={() => st.patch({ notifOpen: false })} aria-label="Close notifications">
                  <Icon name="x" sm />
                </button>
              </span>
            </div>
            <div style={{ overflow: 'auto' }}>
              {st.notifs.map((n) => (
                <button key={n.id} type="button" className={cx('nt', n.unread && 'un')} onClick={() => st.openNotif(n.id)}>
                  <span className={cx('ni2', 'cat-' + n.cat)}>
                    <Icon name={CAT[n.cat].i} sm />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600, display: 'block' }}>{n.title}</b>
                    <span className="mini">{n.text}</span>
                    <span className="mut" style={{ display: 'block', marginTop: 2 }}>
                      {n.time}
                    </span>
                  </span>
                </button>
              ))}
              {st.notifs.length === 0 && <div className="mut" style={{ padding: 14 }}>No notifications.</div>}
            </div>
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--bd)' }} className="mut">
              Reminders: in-app now. Browser, desktop and email channels are prepared in Settings for a future integration.
            </div>
          </div>
        )}
      </div>
      )}
      <div ref={userRef} style={{ display: 'contents' }}>
        <button
          type="button"
          className="avatar"
          onClick={() => st.patch({ userMenuOpen: !st.userMenuOpen, notifOpen: false, acMenuOpen: false })}
          aria-haspopup="dialog"
          aria-expanded={st.userMenuOpen}
          aria-label={'User menu. Using the app as ' + (me?.name ?? st.S.name) + ', ' + role}
          title={(me?.name ?? st.S.name) + (provider.isDemo ? ' (demo profile)' : '')}
        >
          {initials(me?.name ?? st.S.name)}
        </button>
        {st.userMenuOpen && me && (
          <div className="pop" role="dialog" aria-label="User menu" style={{ width: 320 }}>
            <div className="ph2">
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{me.name}</b>
                <span className="mini">{me.email || 'No email set'}</span>
              </span>
              <RoleChip role={me.role} />
            </div>
            <div style={{ overflow: 'auto' }}>
              {provider.isDemo && (
                <>
              <span className="fl" style={{ padding: '10px 14px 2px', margin: 0 }}>
                Switch user
              </span>
              {others.map((m) => (
                <button key={m.id} type="button" className="nt" onClick={() => st.switchUser(m.id)}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600, display: 'block' }}>{m.name}</b>
                    <span className="mini">{m.email || 'No email set'}</span>
                  </span>
                  <RoleChip role={m.role} />
                </button>
              ))}
              {others.length === 0 && (
                <div className="mut" style={{ padding: '6px 14px 10px' }}>
                  Nobody else is on the team yet.
                </div>
              )}
                </>
              )}
              {canManageRoles(role) && (
                <button type="button" className="nt" onClick={() => st.go('team')}>
                  <Icon name="users" sm />
                  <b style={{ fontWeight: 600 }}>Manage team and roles</b>
                </button>
              )}
              {!provider.isDemo && (
                <button type="button" className="nt" onClick={st.signOut}>
                  <Icon name="logout" sm />
                  <b style={{ fontWeight: 600 }}>Sign out</b>
                </button>
              )}
            </div>
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--bd)' }} className="mut">
              {provider.isDemo
                ? 'Demo workspace: switching user previews each role in this browser.'
                : 'Signed in with Google. An admin sets your role, and the server checks it on every request.'}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
