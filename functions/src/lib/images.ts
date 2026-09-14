import { storage } from './firebase.js';

/**
 * Deletes an uploaded image together with the variants `onImageUploaded` derived from it.
 *
 * The resize trigger writes `<base>_thumb.webp` and `<base>_display.webp` next to every original, so
 * deleting only the original leaves both behind — and `allow read: if true` on those paths means a
 * "removed" photo stays publicly fetchable at its variant URL indefinitely, on top of the storage it
 * keeps costing. Confirmed live on qareeb-dev: removing a product photo through the dashboard left
 * `..._thumb.webp` and `..._display.webp` in the bucket with the product's `imagePath` already null.
 *
 * Best-effort by design — an image that is already gone must not fail the callable that removed it.
 */
export async function deleteImageWithVariants(path: string): Promise<void> {
  const base = path.replace(/\.[^.]+$/, '');
  const bucket = storage.bucket();
  await Promise.all(
    [path, `${base}_thumb.webp`, `${base}_display.webp`].map((name) =>
      bucket.file(name).delete({ ignoreNotFound: true }).catch(() => undefined),
    ),
  );
}
