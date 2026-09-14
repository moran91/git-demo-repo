import { deleteToken, getMessaging, getToken, isSupported, onMessage, type Messaging } from 'firebase/messaging';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import type { Locale } from '@qareeb/shared';
import { app, db, VAPID_KEY } from './firebase';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied' | 'not_configured';

export async function pushState(): Promise<PushState> {
  if (typeof Notification === 'undefined' || !(await isSupported().catch(() => false))) return 'unsupported';
  if (!VAPID_KEY) return 'not_configured';
  return Notification.permission as PushState;
}

let messaging: Messaging | null = null;
async function getMsg(): Promise<Messaging | null> {
  if (messaging) return messaging;
  if (!(await isSupported().catch(() => false))) return null;
  messaging = getMessaging(app);
  return messaging;
}

/**
 * Requests permission (only from a user action) and registers this device token for the signed-in
 * user. Tokens are stored under users/{uid}/deviceTokens and invalidated server-side on send failure.
 */
export async function enablePush(uid: string, locale: Locale, registration: ServiceWorkerRegistration | undefined): Promise<PushState> {
  const state = await pushState();
  if (state === 'unsupported' || state === 'not_configured') return state;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm as PushState;
  const m = await getMsg();
  if (!m) return 'unsupported';
  const token = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return 'denied';
  const now = new Date().toISOString();
  await setDoc(doc(db, `users/${uid}/deviceTokens/${token}`), { token, uid, platform: 'web', locale, createdAt: now, lastSeenAt: now, invalid: false }, { merge: true });
  try {
    localStorage.setItem('qareeb.push.token', token);
  } catch {
    /* ignore */
  }
  return 'granted';
}

/**
 * Unregisters this device from the signed-out account. Without it the token stays under the previous
 * user's deviceTokens and the server keeps pushing their order notifications to this device — which
 * the next person to sign in on it would receive.
 */
export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem('qareeb.push.token');
  } catch {
    /* ignore */
  }
  if (token) {
    await deleteDoc(doc(db, `users/${uid}/deviceTokens/${token}`)).catch(() => undefined);
    const m = await getMsg().catch(() => null);
    if (m) await deleteToken(m).catch(() => undefined);
  }
  try {
    localStorage.removeItem('qareeb.push.token');
  } catch {
    /* ignore */
  }
}

export async function onForegroundMessage(cb: (title: string, body: string, link: string) => void): Promise<() => void> {
  const m = await getMsg();
  if (!m) return () => undefined;
  // Notifications are sent data-only (see functions/src/lib/outbox.ts); the notification fallbacks
  // keep any older in-flight message rendering correctly.
  return onMessage(m, (p) => cb(p.data?.title ?? p.notification?.title ?? '', p.data?.body ?? p.notification?.body ?? '', p.data?.link ?? '/'));
}
