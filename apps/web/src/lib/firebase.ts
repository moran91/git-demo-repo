import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === '1';
export const FUNCTIONS_REGION = (import.meta.env.VITE_FUNCTIONS_REGION as string) || 'me-west1';
export const VAPID_KEY = (import.meta.env.VITE_FCM_VAPID_KEY as string) || '';

export const app = getApps()[0] ?? initializeApp(firebaseConfig);

// App Check (reCAPTCHA v3) — only when a site key is configured. Debug token for local dev.
// Imported lazily: a static import kept the whole app-check + reCAPTCHA module in the main bundle
// even with no site key, because Firebase modules register components as a side effect.
if (import.meta.env.VITE_APPCHECK_SITE_KEY) {
  if (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string;
  }
  void import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaV3Provider }) =>
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(import.meta.env.VITE_APPCHECK_SITE_KEY as string), isTokenAutoRefreshEnabled: true }),
  );
}

export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence);
// Single-tab persistence, not multi-tab. With the multi-tab manager every query from a new tab is
// served by whichever tab holds the primary lease, and a backgrounded (frozen or discarded) tab —
// routine on phones — keeps that lease for up to ~5 s without answering, so a fresh open of the site
// showed skeletons for 4–9 s before the new tab could take over. In single-tab mode the second tab
// simply falls back to an in-memory cache and queries the server at once, while the first keeps the
// on-device cache that makes a repeat visit render before the network answers.
export const db = USE_EMULATORS ? getFirestore(app) : initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }) });
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);

if (USE_EMULATORS) {
  const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
