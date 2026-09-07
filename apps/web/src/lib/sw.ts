import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;
let updateFn: ((reload?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();
let needRefresh = false;

/** Registers the single app service worker (precache + FCM). Updates are user-prompted. */
export function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
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
