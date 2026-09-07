import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

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
if (import.meta.env.VITE_APPCHECK_SITE_KEY) {
  if (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string;
  }
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(import.meta.env.VITE_APPCHECK_SITE_KEY as string), isTokenAutoRefreshEnabled: true });
}

export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence);
export const db = USE_EMULATORS ? getFirestore(app) : initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const storage = getStorage(app);

if (USE_EMULATORS) {
  const host = typeof location !== 'undefined' ? location.hostname : '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
