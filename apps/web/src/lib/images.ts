import { getDownloadURL, ref } from 'firebase/storage';
import { storage, USE_EMULATORS, firebaseConfig } from './firebase';

const cache = new Map<string, Promise<string>>();

/**
 * Resolves a Storage path to a display URL. Prefers the server-generated compressed variant
 * (`_thumb.webp` / `_display.webp`) and falls back to the original.
 */
export function imageUrl(path: string | undefined | null, size: 'thumb' | 'display' = 'thumb'): Promise<string> | null {
  if (!path) return null;
  const base = path.replace(/\.[^.]+$/, '');
  const variant = `${base}_${size}.webp`;
  const key = `${variant}`;
  let p = cache.get(key);
  if (!p) {
    p = getDownloadURL(ref(storage, variant)).catch(() => getDownloadURL(ref(storage, path)));
    cache.set(key, p);
  }
  return p;
}

/** Public, unauthenticated URL shape (used for <img> src in lists without a round trip). */
export function publicImageUrl(path: string): string {
  const bucket = firebaseConfig.storageBucket;
  const encoded = encodeURIComponent(path);
  if (USE_EMULATORS) return `http://${location.hostname}:9199/v0/b/${bucket}/o/${encoded}?alt=media`;
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?alt=media`;
}
