import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateFn: ((reload?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();
let needRefresh = false;
let registering = false;

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
  if (registering) return;
  registering = true;
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
/** Push needs the app worker immediately, even before the idle registration callback runs. */
export async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) throw new Error('Service worker unavailable');
  doRegister();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Service worker unavailable')), 15000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
