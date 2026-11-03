import { useEffect, useRef, type RefObject } from 'react';
import { provider } from '@/data/provider';
import { useStore } from '@/store/store';
import { PAGE_TITLES, parsePath, pathFor } from '@/store/nav';
import { mailAlerts, reminderAlerts } from '@/lib/notify';
import { canNotify, show } from './notifier';
import { loadJSON, saveJSON } from '@/lib/storage';

/**
 * On first mount with a real provider: load the server snapshot, and handle the
 * redirect back from Google sign-in (?connected=… or ?error=…).
 */
export function useBootstrap(): void {
  useEffect(() => {
    if (provider.isDemo) return;
    const s = useStore.getState();
    const q = new URLSearchParams(window.location.search);
    const connected = q.get('connected');
    const error = q.get('error');
    // A notification clicked after the tab was closed opens the app on its email.
    const open = q.get('open');
    if (connected || error || open) window.history.replaceState(null, '', window.location.pathname);
    if (error) {
      s.showToast('Google sign-in failed: ' + error);
      void s.hydrate();
      return;
    }
    if (connected) {
      s.patch({ page: 'accounts' });
      s.showToast('Google account connected. Syncing your mail…');
      s.refreshAll();
      return;
    }
    // Show what is stored right away, then fetch new mail in the background.
    void s.hydrate().then(() => {
      if (open && useStore.getState().emails.some((e) => e.id === open)) useStore.getState().openEmail(open);
      return s.autoSync();
    });
  }, []);
}

/**
 * Keep mail fresh without the Sync button, as often as Settings → Sync frequency says, and on return to the tab.
 * A background tab syncs too while browser notifications are on: otherwise no new mail arrives to announce.
 */
export function useAutoSync(): void {
  const freq = useStore((s) => s.S.syncFreq);
  const background = useStore((s) => s.S.notif.browser);
  useEffect(() => {
    if (provider.isDemo || freq === 'manual') return;
    const every = (Number(freq) || 5) * 60_000;
    let last = Date.now();
    const run = () => {
      if (document.visibilityState !== 'visible' && !background) return;
      last = Date.now();
      void useStore.getState().autoSync();
    };
    const t = setInterval(run, every);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > every / 2) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [freq, background]);
}

/** Keep the URL and document title in step with the current page, and honor back/forward. */
export function useUrlSync(): void {
  const page = useStore((s) => s.page);
  const view = useStore((s) => s.view);
  const calView = useStore((s) => s.calView);
  const patch = useStore((s) => s.patch);

  useEffect(() => {
    const p = pathFor(page, view, calView);
    if (window.location.pathname !== p) window.history.pushState(null, '', p);
    document.title = PAGE_TITLES[page] + ' · InterviewFlow AI';
  }, [page, view, calView]);

  useEffect(() => {
    const onPop = () => {
      const r = parsePath(window.location.pathname);
      patch({ page: r.page, ...(r.view ? { view: r.view } : {}), ...(r.calView ? { calView: r.calView } : {}), notifOpen: false, acMenuOpen: false, userMenuOpen: false });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [patch]);
}

/** Escape closes the topmost dialog or popover. */
export function useEscapeKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useStore.getState();
      if (s.sendOpen) s.closeSend();
      else if (s.cfOpen) s.closeCf();
      else if (s.schedOpen) s.closeSched();
      else if (s.addCalOpen) s.closeAddCal();
      else if (s.addAcctOpen) s.patch({ addAcctOpen: false });
      else if (s.notifOpen || s.acMenuOpen || s.userMenuOpen) s.patch({ notifOpen: false, acMenuOpen: false, userMenuOpen: false });
      else if (s.appSel) s.patch({ appSel: '' });
      else if (s.calSel && s.page === 'cal') s.patch({ calSel: '' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Call `onOutside` when a pointer-down lands outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [active, onOutside]);
  return ref;
}

const NOTIFIED_KEY = 'iflow.notified';

/**
 * Browser notifications, when switched on in Settings: new mail in a starred conversation,
 * calendar bookings and reminder emails, plus the interview reminders set for calendar events.
 * What was announced is remembered in this browser so a reload doesn't repeat it.
 */
export function useBrowserNotifications(): void {
  useEffect(() => {
    const saved = loadJSON<{ mail?: string[]; rem?: string[] }>(NOTIFIED_KEY);
    const seen = new Set(saved?.mail ?? []);
    const fired = new Set(saved?.rem ?? []);
    const save = () => saveJSON(NOTIFIED_KEY, { mail: [...seen].slice(-1500), rem: [...fired].slice(-500) });
    const check = () => {
      const s = useStore.getState();
      // Mark mail seen even while off, so switching on later doesn't replay it.
      const alerts = mailAlerts(s.emails, seen).concat(reminderAlerts(s.events, s.S, fired, new Date()));
      save();
      if (canNotify()) alerts.forEach((a) => void show(a));
    };
    check();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.emails !== prev.emails || s.events !== prev.events) check();
    });
    const t = setInterval(check, 30_000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, []);
}
