import { col, db } from './firebase.js';
import { fail } from './errors.js';

/** Simple fixed-window rate limiter backed by Firestore (adequate for OTP/order abuse guards). */
export async function rateLimit(key: string, max: number, windowSec: number): Promise<void> {
  const ref = col.rateLimits().doc(key.replace(/[^A-Za-z0-9_+:.-]/g, '_').slice(0, 200));
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() as { windowStart: number; count: number } | undefined;
    if (!d || now - d.windowStart > windowSec * 1000) {
      tx.set(ref, { windowStart: now, count: 1, expiresAt: new Date(now + windowSec * 1000 * 2) });
      return;
    }
    if (d.count >= max) fail('rate_limited');
    tx.update(ref, { count: d.count + 1 });
  });
}
