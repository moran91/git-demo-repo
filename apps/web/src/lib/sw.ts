import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateFn: ((reload?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();
let needRefresh = false;

/** Registers the single app service worker (precache + FCM). Updates are user-prompted. */
export function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // Registered only after the page has loaded and the main thread is idle. Installing the SW
  // downloads the whole precache (every route chunk plus the fonts), and registering it at startup
  // made that download compete with the first Firestore query and the first images on slow links.
  const register = () => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(doRegister, { timeout: 4000 });
    else setTimeout(doRegister, 2500);
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
function doRegister() {
  updateFn = registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
    },
    onNeedRefresh() {
      needRefresh = true;
      for (const l of listeners) l();
    },
  });
}
export function getRegistration() {
  return registration;
}
export function subscribeNeedRefresh(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function hasUpdate() {
  return needRefresh;
}
export async function applyUpdate() {
  await updateFn?.(true);
}
