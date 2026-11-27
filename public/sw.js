// Offline support for the app shell. API calls always go to the network.
// Service workers only run in secure contexts (https:// or localhost), so on a plain-http
// home hub the app simply works online without this.
const CACHE = 'ff-shell-v21';
const SHELL = [
  './', 'index.html', 'boot.js', 'theme-init.js', 'app.js', 'local-backend.js', 'peer-backend.js', 'peer-link.js', 'styles.css', 'manifest.webmanifest',
  'shared/models.js', 'shared/tone.js', 'shared/errors.js', 'shared/plans.js', 'shared/asks.js', 'shared/core.js', 'shared/store.js', 'shared/peer-host.js', 'shared/peer-client.js', 'shared/signal.js',
  'ui/actions.js', 'ui/backend.js', 'ui/dom.js', 'ui/family.js', 'ui/forms.js', 'ui/give.js', 'ui/guide.js', 'ui/inbox.js', 'ui/plans.js', 'ui/push.js', 'ui/router.js', 'ui/sent.js', 'ui/state.js', 'ui/sync.js', 'ui/theme.js', 'ui/welcome.js',
  'vendor/qrcode.mjs', 'vendor/jsQR.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Network first so updates show up right away; fall back to the cached shell when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

// ---------- notifications (Web Push from the home hub) ----------
// A push carries nothing about the message, so the notification only says that something is new.
// The badge count comes from the hub itself, with this device's sign-in.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    // Show it first, before asking the hub anything: away from home the hub can't be reached, and
    // iPhones stop delivering pushes to apps that don't show a notification within about 30 seconds.
    await self.registration.showNotification('Echoes', {
      body: 'You have something new.', tag: 'echoes', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#/inbox' },
    });
    const open = await self.clients.matchAll({ type: 'window' });
    for (const c of open) c.postMessage({ type: 'something-new' });
    // Then the app-icon badge, if the hub answers quickly (it only can on the home Wi-Fi).
    try {
      const signal = AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined;
      const res = await fetch('api/state', { credentials: 'same-origin', cache: 'no-store', signal });
      const me = (await res.json()).me;
      const count = me ? (me.unread || 0) + (me.responses || 0) + (me.asks || 0) + (me.plansDue || 0) : 0;
      if (self.navigator.setAppBadge) await (count ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge());
    } catch { /* away from home, or no badges here: the notification is enough */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('./#/inbox', self.registration.scope).href;
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if ('focus' in c) {
        await c.focus();
        c.postMessage({ type: 'open-inbox' });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// The browser renewed the subscription: subscribe again with the same hub key and tell the hub.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const key = event.oldSubscription?.options?.applicationServerKey;
    if (!key) return;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('api/push/subscribe', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  })());
});
