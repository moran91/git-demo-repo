import { onRequest } from 'firebase-functions/v2/https';
import { REGION, storage } from './lib/firebase.js';

/**
 * Serves the public catalog photos (`businesses/**` in the bucket) through Firebase Hosting, so the
 * Hosting CDN caches them at the edge near the customer.
 *
 * Why: the bucket is regional (me-west1) and `firebasestorage.googleapis.com` has no CDN in front of
 * it, so a customer far from Israel paid a full intercontinental round trip — plus a slow throughput
 * path — for every single picture: a 20 KB thumbnail took 5–8 s from Thailand while data from
 * Firestore arrived in 3 s. Hosting rewrites `/img/**` here; the response carries a one-year public
 * `Cache-Control`, which the Hosting CDN honours, so after the first request per edge location every
 * later customer nearby gets the photo from the edge. Being same-origin it also needs no CORS.
 *
 * Only `businesses/` paths are served (exactly the prefix that is `allow read: if true` in
 * storage.rules); everything else is a 404, and misses are never cached.
 */
export const serveImage = onRequest({ region: REGION, memory: '256MiB', maxInstances: 10, concurrency: 80 }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.set('Allow', 'GET, HEAD').status(405).end();
    return;
  }
  // `/img/<object path>`; Hosting passes the path through URL-encoded.
  const raw = req.path.replace(/^\/img\//, '');
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(raw);
  } catch {
    res.status(400).end();
    return;
  }
  if (!objectPath.startsWith('businesses/') || objectPath.includes('..') || objectPath.includes('//') || !/\.(webp|jpe?g|png)$/i.test(objectPath)) {
    res.set('Cache-Control', 'no-store').status(404).end();
    return;
  }
  const file = storage.bucket().file(objectPath);
  const [meta] = await file.getMetadata().catch(() => [null]);
  if (!meta) {
    res.set('Cache-Control', 'no-store').status(404).end();
    return;
  }
  res.set('Content-Type', String(meta.contentType ?? 'application/octet-stream'));
  if (meta.size !== undefined) res.set('Content-Length', String(meta.size));
  if (meta.etag) res.set('ETag', String(meta.etag));
  res.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }
  await new Promise<void>((resolve) => {
    file
      .createReadStream({ validation: false })
      .on('error', () => {
        if (!res.headersSent) res.set('Cache-Control', 'no-store').status(502);
        res.end();
        resolve();
      })
      .on('end', resolve)
      .pipe(res);
  });
});
