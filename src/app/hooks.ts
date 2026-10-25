import { useEffect, useRef, type RefObject } from 'react';
import { provider } from '@/data/provider';
import { useStore } from '@/store/store';
import { PAGE_TITLES, parsePath, pathFor } from '@/store/nav';

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
    if (connected || error) window.history.replaceState(null, '', window.location.pathname);
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
    void s.hydrate().then(() => s.autoSync());
  }, []);
}

const AUTO_SYNC_MS = 5 * 60_000;

/** Keep mail fresh without the Sync button: every few minutes while the tab is visible, and on return to the tab. */
export function useAutoSync(): void {
  useEffect(() => {
    if (provider.isDemo) return;
    let last = Date.now();
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      last = Date.now();
      void useStore.getState().autoSync();
    };
    const t = setInterval(run, AUTO_SYNC_MS);
    const onVisible = () => {
      if (Date.now() - last > AUTO_SYNC_MS / 2) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
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
