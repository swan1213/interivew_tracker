import type { Alert } from '@/lib/notify';
import { useStore } from '@/store/store';

/** Browser notifications are available here at all. */
export const notifySupported = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

/** The browser's answer for this site: 'granted', 'denied', 'default', or 'unsupported'. */
export const permission = (): NotificationPermission | 'unsupported' => (notifySupported() ? Notification.permission : 'unsupported');

/** Browser notifications are switched on and the browser allows them. */
export const canNotify = (): boolean => permission() === 'granted' && useStore.getState().S.notif.browser;

let reg: Promise<ServiceWorkerRegistration | undefined> | undefined;

/**
 * The service worker that shows notifications. Some browsers (Chrome on Android, installed apps) refuse
 * `new Notification()`, and only a worker can open the email after the tab was closed.
 */
function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!reg) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) reg = Promise.resolve(undefined);
    else {
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; emailId?: string }>) => {
        if (e.data?.type === 'open-email' && e.data.emailId) useStore.getState().openEmail(e.data.emailId);
      });
      const ready = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
      const late = new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000));
      reg = Promise.race([ready, late]).catch(() => undefined);
    }
  }
  return reg;
}

/** Show one notification; resolves false if the browser refused it. */
export async function show(a: Alert): Promise<boolean> {
  const opts: NotificationOptions = { body: a.body, tag: a.key, icon: '/notify-icon.png', data: { emailId: a.emailId || '' } };
  try {
    const r = await registration();
    if (r) {
      await r.showNotification(a.title, opts);
      return true;
    }
    const n = new Notification(a.title, opts);
    n.onclick = () => {
      window.focus();
      n.close();
      if (a.emailId) useStore.getState().openEmail(a.emailId);
    };
    return true;
  } catch {
    return false;
  }
}

/** Ask the browser if needed; resolves the resulting permission. */
export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notifySupported()) return 'unsupported';
  void registration();
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

export const sendTest = (): Promise<boolean> =>
  show({ key: 'test-' + Date.now(), title: 'InterviewFlow notifications work', body: 'You will be told about starred mail, calendar bookings and reminders.' });
