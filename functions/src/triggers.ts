import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import sharp from 'sharp';
import { REGION, storage } from './lib/firebase.js';
import { processOutboxEvent, sweepOutbox } from './lib/outbox.js';
import { sweepPrintLeases } from './domain/printing.js';

export const onOutboxCreated = onDocumentCreated({ region: REGION, document: 'outbox/{id}', retry: true }, async (event) => {
  await processOutboxEvent(event.params.id);
});

export const scheduledSweeps = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: 'Asia/Jerusalem' }, async () => {
  const outbox = await sweepOutbox();
  const print = await sweepPrintLeases();
  console.info('sweeps', { outbox, ...print });
});

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Validates uploads under businesses/{businessId}/... (tenant-scoped, rules-enforced path) and
 * generates compressed display sizes next to the original: `<name>_thumb.webp` (400px) and
 * `<name>_display.webp` (1200px). Invalid objects are deleted.
 */
export const onImageUploaded = onObjectFinalized({ region: REGION, memory: '1GiB' }, async (event) => {
  const name = event.data.name;
  if (!name.startsWith('businesses/')) return;
  if (/_(thumb|display)\.webp$/.test(name)) return;
  const bucket = storage.bucket(event.data.bucket);
  const file = bucket.file(name);
  const contentType = event.data.contentType ?? '';
  const size = Number(event.data.size ?? 0);
  if (!ALLOWED.has(contentType) || size > MAX_BYTES) {
    console.warn('deleting invalid upload', { name, contentType, size });
    await file.delete({ ignoreNotFound: true });
    return;
  }
  const [buf] = await file.download();
  // Content sniffing: sharp fails on non-image bytes regardless of the declared content type.
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    await file.delete({ ignoreNotFound: true });
    return;
  }
  if (!meta.width || !meta.height || meta.width > 8000 || meta.height > 8000) {
    await file.delete({ ignoreNotFound: true });
    return;
  }
  const base = name.replace(/\.[^.]+$/, '');
  const isCover = /\/cover[^/]*$/.test(name);
  const thumb = await sharp(buf).rotate().resize(isCover ? { width: 640, height: 360, fit: 'cover' } : { width: 400, height: 400, fit: 'cover' }).webp({ quality: 78 }).toBuffer();
  const display = await sharp(buf).rotate().resize(isCover ? { width: 1600, height: 900, fit: 'cover' } : { width: 1200, height: 1200, fit: 'inside' }).webp({ quality: 82 }).toBuffer();
  await Promise.all([
    bucket.file(`${base}_thumb.webp`).save(thumb, { contentType: 'image/webp', metadata: { cacheControl: 'public,max-age=31536000,immutable' } }),
    bucket.file(`${base}_display.webp`).save(display, { contentType: 'image/webp', metadata: { cacheControl: 'public,max-age=31536000,immutable' } }),
  ]);
});
