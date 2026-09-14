import { deleteObject, ref } from 'firebase/storage';
import type { HeifDecoder } from 'libheif-js/wasm-bundle';
import { storage, USE_EMULATORS, firebaseConfig } from './firebase';

export type ImageSize = 'thumb' | 'display';

/** Variants that 404'd (no resize yet), and when — see the retry note in `imageSources`. */
const missingVariantAt = new Map<string, number>();
const RETRY_VARIANT_AFTER_MS = 60_000;

/**
 * Public, unauthenticated URL for a catalog photo.
 *
 * In production this is the same-origin `/img/<path>` route: Firebase Hosting rewrites it to the
 * `serveImage` function and caches the response on its global CDN. Fetching straight from
 * `firebasestorage.googleapis.com` meant every picture crossed the world to the me-west1 bucket —
 * 5–8 s per thumbnail from Thailand. Against the emulators the Storage emulator is read directly.
 */
export function publicImageUrl(path: string): string {
  if (USE_EMULATORS) return `http://${location.hostname}:9199/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
  return `/img/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export interface ImageSources {
  /** What to load first: the compressed variant, or the original while the variant is known missing. */
  src: string;
  /** What to load if `src` fails (the original), or null when `src` already is the original. */
  fallback: string | null;
}

/**
 * Resolves a Storage path to the URLs to show. Prefers the server-generated compressed variant
 * (`_thumb.webp` / `_display.webp`) and falls back to the original.
 *
 * Synchronous on purpose. This used to call `getDownloadURL` per image, which is a metadata round
 * trip (~300 ms from Israel, more on a phone network) that had to finish — after the JS bundle, the
 * SDK and auth had all initialised — before the browser could even start fetching the picture. On a
 * page with 40 products that was 40 extra requests, and a missing variant cost a second one. Every
 * path under `businesses/` is publicly readable by the Storage rules, so the URL can be built
 * directly and the `<img>` starts loading the moment it renders.
 *
 * The resize trigger runs after the upload finishes, so a photo viewed in that window has no variant
 * yet; the `<img>` reports the 404 through `noteVariantMissing` and reloads with the original. That
 * miss is retried after a minute rather than remembered for the session, so the ~30 KB variant takes
 * over from the multi-MB original once it exists.
 */
export function imageSources(path: string | undefined | null, size: ImageSize = 'thumb'): ImageSources | null {
  if (!path) return null;
  const original = publicImageUrl(path);
  const variant = publicImageUrl(variantPath(path, size));
  const missedAt = missingVariantAt.get(variant);
  if (missedAt !== undefined) {
    if (Date.now() - missedAt <= RETRY_VARIANT_AFTER_MS) return { src: original, fallback: null };
    missingVariantAt.delete(variant);
  }
  return { src: variant, fallback: original };
}

export function noteVariantMissing(variantUrl: string) {
  missingVariantAt.set(variantUrl, Date.now());
}

function variantPath(path: string, size: ImageSize): string {
  return `${path.replace(/\.[^.]+$/, '')}_${size}.webp`;
}

/**
 * Runs the callable that records an uploaded object's path, and removes the object if that fails.
 *
 * An upload is two steps — `uploadBytes`, then a callable that writes the path — and only the
 * callable's failure is reported to the user. Without this, every such failure leaked a publicly
 * readable object under the business prefix that nothing referenced and nothing would ever delete
 * (the server only cleans up the *previous* path when a new one is recorded). Best-effort: the
 * original error is what the user sees either way.
 */
export async function recordUpload<T>(path: string, record: () => Promise<T>): Promise<T> {
  try {
    return await record();
  } catch (e) {
    await deleteObject(ref(storage, path)).catch(() => undefined);
    throw e;
  }
}

/* ---------- upload preparation ---------- */

/** Storage rules cap an upload at 5 MB and accept only these three types. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
const MAX_EDGE = 1600;
/**
 * Guards on the input. Decoding is what costs memory — a 108 MP photo is ~430 MB as RGBA, and the
 * target device is a cheap Android phone — so the byte limit is checked before `createImageBitmap`
 * runs. The pixel limit can only be checked after it: dimensions are not knowable without decoding,
 * so it bounds the canvas that follows, not the decode itself. Anything a phone camera produces is
 * far inside both.
 */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60e6;

export type UploadFailure = 'unsupported' | 'tooLarge' | 'unreadable';
export class ImagePrepError extends Error {
  constructor(readonly kind: UploadFailure) {
    super(kind);
  }
}
export interface PreparedImage { blob: Blob; contentType: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg' }

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close(): void };
/** The picked file's bytes, read once (see `readPickedFile`), plus what the picker said about it. */
type Picked = { blob: Blob; bytes: ArrayBuffer; name: string; type: string; size: number };

/**
 * Reads the picked file into memory once, right after the pick, and retries a failed read.
 *
 * A `File` from a mobile picker is a handle, not bytes: iOS hands over a temporary copy (it converts
 * HEIC to JPEG on the fly for a JPEG-only `accept`) and Android a content-provider stream, and either
 * can fail with `NotReadableError` the first time it is opened — the pick "works" on a retry because
 * the second copy is complete. Every decoder below used to open the handle independently, so one
 * flaky read surfaced as an untyped DOMException and a generic "something went wrong". Reading once
 * here bounds that to a single, retried read, and every later step works on bytes that cannot vanish.
 */
async function readPickedFile(file: File): Promise<Picked> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength === 0 && file.size > 0) throw new Error('empty read');
      return { blob: new Blob([bytes], { type: file.type }), bytes, name: file.name, type: file.type, size: bytes.byteLength };
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  console.error('[upload] picked file could not be read', { name: file.name, type: file.type, size: file.size }, lastError);
  throw new ImagePrepError('unreadable');
}

/** HEIC/HEIF sniff by the ISO-BMFF `ftyp` brand; the picker often hands over an empty `file.type`. */
function isHeif(file: Picked): boolean {
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
  const head = new Uint8Array(file.bytes, 0, Math.min(32, file.bytes.byteLength));
  if (head.length < 12 || String.fromCharCode(...head.subarray(4, 8)) !== 'ftyp') return false;
  const brand = String.fromCharCode(...head.subarray(8, 12));
  return /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(brand);
}

async function decodeNative(file: Picked): Promise<Decoded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file.blob, { imageOrientation: 'from-image' });
  } catch (e) {
    // Older engines reject the options bag itself (a TypeError) rather than ignoring it; a decode
    // failure is anything else and is not worth a second full decode.
    if (!(e instanceof TypeError)) throw e;
    bitmap = await createImageBitmap(file.blob);
  }
  return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
}

/** The `<img>` decoder accepts some files `createImageBitmap` rejects (odd JPEG variants, ICC edge cases). */
function decodeViaImg(file: Picked): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file.blob);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (!width || !height) {
        URL.revokeObjectURL(url);
        reject(new Error('empty image'));
        return;
      }
      resolve({ source: img, width, height, close: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('img decode failed'));
    };
    img.src = url;
  });
}

/**
 * Chrome and Firefox (desktop and Android) do not decode HEIC at all, and that is the default camera
 * format on iPhones and many Samsung phones, so the "HEIC is welcome" hint under the button was a
 * lie there. libheif compiled to wasm handles it; it is a separate ~2 MB chunk fetched only on the
 * first HEIC pick and never precached.
 */
let heifDecoder: Promise<HeifDecoder> | null = null;
async function decodeHeif(file: Picked): Promise<Decoded> {
  // One decoder for the session: libheif only frees the previous context on the next decode() of
  // the same decoder, so a fresh decoder per pick would pin every picked file in wasm memory.
  heifDecoder ??= import('libheif-js/wasm-bundle').then((m) => new m.default.HeifDecoder());
  const decoder = await heifDecoder;
  const images = decoder.decode(new Uint8Array(file.bytes));
  try {
    const image = images[0];
    if (!image) throw new Error('no image in HEIF container');
    const width = image.get_width();
    const height = image.get_height();
    if (width * height > MAX_INPUT_PIXELS) throw new ImagePrepError('tooLarge');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const data = ctx.createImageData(width, height);
    await new Promise<void>((resolve, reject) => image.display(data, (out) => (out ? resolve() : reject(new Error('HEIF display failed')))));
    ctx.putImageData(data, 0, 0);
    return { source: canvas, width, height, close: () => undefined };
  } finally {
    for (const i of images) i.free?.();
    // Release the file bytes and context now rather than at the next pick. libheif logs a parse
    // failure for the empty buffer, which is expected here, so that one log line is muted.
    const log = console.log;
    console.log = () => undefined;
    try {
      decoder.decode(new Uint8Array(0));
    } finally {
      console.log = log;
    }
  }
}

async function decode(file: Picked): Promise<Decoded> {
  const failures: unknown[] = [];
  for (const step of [decodeNative, decodeViaImg]) {
    try {
      return await step(file);
    } catch (e) {
      if (e instanceof ImagePrepError) throw e;
      failures.push(e);
    }
  }
  if (isHeif(file)) {
    try {
      return await decodeHeif(file);
    } catch (e) {
      if (e instanceof ImagePrepError) throw e;
      failures.push(e);
    }
  }
  console.warn('image decode failed', { name: file.name, type: file.type, size: file.size }, ...failures);
  throw new ImagePrepError('unsupported');
}

/**
 * Re-encodes a picked image to a WebP (or JPEG) under the Storage limit.
 *
 * A photo taken on a phone is routinely 4–12 MB and is often HEIC, so the old "reject anything over
 * 5 MB that is not JPEG/PNG/WebP" check turned an ordinary camera roll pick into a dead button —
 * doubly so because the rejection message was the very hint already printed under it. Downscaling to
 * a long edge of 1600px is lossless for every place the app shows an image (the largest is the 16:9
 * cover) and brings a camera photo to a few hundred KB.
 *
 * Decoding tries the native bitmap decoder, then the `<img>` decoder, then (for HEIC/HEIF) the wasm
 * decoder; only when all three fail does the pick surface as `unsupported`.
 */
export async function prepareImageUpload(picked: File): Promise<PreparedImage> {
  if (picked.size > MAX_INPUT_BYTES) throw new ImagePrepError('tooLarge');
  const file = await readPickedFile(picked);
  if (file.size > MAX_INPUT_BYTES) throw new ImagePrepError('tooLarge');
  const bitmap = await decode(file);
  try {
    if (bitmap.width * bitmap.height > MAX_INPUT_PIXELS) throw new ImagePrepError('tooLarge');
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImagePrepError('unsupported');
    // WebP keeps the alpha channel a logo may rely on; a browser without WebP encoding returns a PNG
    // blob from toBlob (the spec's fallback), which Storage rules reject — hence the type check. The
    // JPEG fallback has no alpha, so the canvas is flattened onto white first: without this a
    // transparent logo composites onto black.
    for (const [type, ext] of [['image/webp', 'webp'], ['image/jpeg', 'jpg']] as const) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(bitmap.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await encode(canvas, type, quality);
        if (blob && blob.type === type && blob.size <= MAX_UPLOAD_BYTES) return { blob, contentType: type, ext };
      }
    }
    throw new ImagePrepError('tooLarge');
  } finally {
    bitmap.close();
  }
}
