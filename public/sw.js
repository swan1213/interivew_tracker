// Shows the app's browser notifications and opens the right email when one is clicked,
// even after the tab was closed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const emailId = (e.notification.data && e.notification.data.emailId) || '';
  e.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        if (emailId) tab.postMessage({ type: 'open-email', emailId });
        return;
      }
      await self.clients.openWindow('/' + (emailId ? '?open=' + encodeURIComponent(emailId) : ''));
    })(),
  );
});
