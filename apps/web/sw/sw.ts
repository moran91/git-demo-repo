/// <reference lib="webworker" />
/**
 * Single service worker: Workbox precaching of the app shell + Firebase Cloud Messaging background
 * handler. Private API responses (orders, addresses, Firestore/functions traffic) are NEVER cached:
 * only same-origin build assets are precached, and no runtime caching route touches Firebase hosts.
 * Update strategy: new SW waits until the app prompts the user ("A new version is available"), then
 * skipWaiting + reload — so FCM registrations are never silently invalidated mid-session.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA deep links: serve index.html for navigations (never for API paths, which are cross-origin anyway).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__\//, /\.[a-z0-9]+$/i] }));

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
    const title = payload.notification?.title ?? 'Qareeb';
    const body = payload.notification?.body ?? '';
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
