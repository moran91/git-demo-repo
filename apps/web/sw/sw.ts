/// <reference lib="webworker" />
/**
 * Single service worker: Workbox precaching of the app shell + Firebase Cloud Messaging background
 * handler. Private API responses (orders, addresses, Firestore/functions traffic) are NEVER cached:
 * only same-origin build assets are precached, and the single runtime route is pinned to the public
 * catalog photos under `businesses/` in the Storage bucket (`allow read: if true` in storage.rules).
 * Update strategy: new SW waits until the app prompts the user ("A new version is available"), then
 * skipWaiting + reload — so FCM registrations are never silently invalidated mid-session.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA deep links: serve index.html for navigations (never for API paths, which are cross-origin anyway).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__\//, /\.[a-z0-9]+$/i] }));

/**
 * Catalog photos (product / logo / cover) are immutable once written — a replacement gets a new
 * random file name — so they are served cache-first. The browser's HTTP cache already honours their
 * `immutable` header, but on phones it is small and evicted early; this keeps a business's menu
 * photos across visits so the second open needs no network for them. The route matches only public
 * paths and only image downloads (`alt=media`): metadata and upload traffic never enters the cache.
 * The photos are same-origin (`/img/**`, rewritten by Hosting to the `serveImage` function and cached
 * on the Hosting CDN), so only real 200s are stored — a 404 for a not-yet-resized variant is never
 * cached.
 */
registerRoute(
  ({ request, url }) => request.method === 'GET' && request.destination === 'image' && url.origin === self.location.origin && url.pathname.startsWith('/img/businesses/'),
  new CacheFirst({
    cacheName: 'catalog-images-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

try {
  const app = initializeApp(cfg);
  const messaging = getMessaging(app);
  onBackgroundMessage(messaging, (payload) => {
    // Payloads carry only references + a deep link (no addresses/phones/totals).
    // Sent data-only (see outbox.ts sendPush) so this handler is the only thing that displays.
    const title = payload.data?.title ?? payload.notification?.title ?? 'Qareeb';
    const body = payload.data?.body ?? payload.notification?.body ?? '';
    const link = payload.data?.link ?? '/';
    void self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', data: { link }, tag: payload.data?.notificationId });
  });
} catch {
  // Messaging is unsupported in this browser; the app shell still works offline.
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | undefined)?.link ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          void c.navigate(link);
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
