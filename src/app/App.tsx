import { useStore } from '@/store/store';
import { isDarkTheme } from '@/store/selectors';
import { cx } from '@/lib/util';
import { Icon } from '@/ui/Icon';
import { useBootstrap, useEscapeKey, useUrlSync } from './hooks';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Dashboard } from '@/pages/Dashboard';
import { Inbox } from '@/pages/Inbox';
import { CalendarPage } from '@/pages/Calendar';
import { Tracker } from '@/pages/Tracker';
import { Analytics } from '@/pages/Analytics';
import { Accounts } from '@/pages/Accounts';
import { SettingsPage } from '@/pages/Settings';
import { Team } from '@/pages/Team';
import { canSee, currentRole, homePage } from '@/lib/roles';
import { Modals } from '@/modals/Modals';

export function App() {
  const role = useStore(currentRole);
  const want = useStore((s) => s.page);
  // Render only what the current role may see, even for the instant before the store guard corrects the page.
  const page = canSee(role, want) ? want : homePage(role);
  const syncing = useStore((s) => s.syncing);
  const toast = useStore((s) => s.toast);
  const themePref = useStore((s) => s.themePref);
  const sysDark = useStore((s) => s.sysDark);
  useUrlSync();
  useEscapeKey();
  useBootstrap();
  const dark = isDarkTheme(themePref, sysDark);

  return (
    <div className={cx('if', 'if-root', dark && 'dark')}>
      <div className="shell">
        <Sidebar />
        <div className="main">
          <TopBar />
          {syncing && <div className="syncbar" />}
          <div className="content">
            {page === 'dash' && <Dashboard />}
            {page === 'inbox' && <Inbox />}
            {page === 'cal' && <CalendarPage />}
            {page === 'track' && <Tracker />}
            {page === 'analytics' && <Analytics />}
            {page === 'accounts' && <Accounts />}
            {page === 'team' && <Team />}
            {page === 'settings' && <SettingsPage />}
          </div>
        </div>
      </div>
      <Modals />
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" sm />
          {toast}
        </div>
      )}
    </div>
  );
}
