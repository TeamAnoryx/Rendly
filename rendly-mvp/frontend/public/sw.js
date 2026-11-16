/* Rendly service worker: shows Web Push notifications and opens the linked page on click. */

// Resolve app paths against the worker's scope so a sub-path deploy (/rendly.app/) works.
const SCOPE = self.registration.scope;
const appUrl = (path) => new URL(String(path).replace(/^\/+/, ''), SCOPE).href;
const ICON = appUrl('/apple-icon.png');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Rendly', body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' ? data.title : 'Rendly';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: ICON,
      badge: ICON,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/dashboard';
  const target = appUrl(path);
  if (event.notification.tag === 'rendly-ongoing') {
    // An ongoing call or huddle lives in the open tab: focus it rather than reloading it
    // (a navigation would drop the call). The page resumes itself on the message.
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
        const same = wins.filter((w) => new URL(w.url).origin === self.location.origin);
        const win = same.find((w) => w.focused) || same[0];
        if (win) {
          win.postMessage({ type: 'rendly-ongoing-resume', url: path });
          return win.focus();
        }
        return self.clients.openWindow(target);
      }),
    );
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'navigate' in w) {
          return w.focus().then(() => w.navigate(target));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
