import { useSyncExternalStore } from 'react';

/** Tiny persisted store used for the cart, city and preferences (no external state library). */
export function createStore<T>(key: string, initial: T, opts: { persist?: boolean; version?: number } = { persist: true }) {
  let state: T = initial;
  const listeners = new Set<() => void>();
  const storageKey = `qareeb.${key}.v${opts.version ?? 1}`;
  if (opts.persist !== false) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) state = { ...initial, ...(JSON.parse(raw) as T) };
    } catch {
      /* ignore */
    }
  }
  const set = (patch: Partial<T> | ((s: T) => T)) => {
    state = typeof patch === 'function' ? (patch as (s: T) => T)(state) : { ...state, ...patch };
    if (opts.persist !== false) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }
    for (const l of listeners) l();
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const get = () => state;
  const use = () => useSyncExternalStore(subscribe, get, get);
  const reset = () => set(() => initial);
  return { get, set, subscribe, use, reset };
}
