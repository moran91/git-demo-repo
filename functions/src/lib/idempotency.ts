import { col, nowIso, type Tx } from './firebase.js';

/**
 * Idempotency inside a Firestore transaction: the first call stores its result under
 * idempotency/{uid}_{key}; retries return the stored result without re-applying effects.
 * The record is written in the same transaction as the effects, so it is atomic.
 */
export async function readIdempotent<T>(tx: Tx, uid: string, key: string): Promise<T | undefined> {
  const snap = await tx.get(col.idempotency(uid, key));
  if (!snap.exists) return undefined;
  return snap.data()?.result as T;
}

export function writeIdempotent(tx: Tx, uid: string, key: string, result: unknown, kind: string): void {
  tx.set(col.idempotency(uid, key), { uid, key, kind, result, createdAt: nowIso() });
}
