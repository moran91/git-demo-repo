import { daypartOf, popularCountKey, toLocal, type Order } from '@qareeb/shared';
import { FieldValue, col, db, nowIso } from './firebase.js';

/**
 * Adds an accepted restaurant order to its city's daily dish counts: each distinct dish counts once
 * per order, by the Israeli date and daypart it was placed in. The outbox doc carries a marker, so a
 * retried event (or the trigger and the sweeper racing) never counts twice.
 */
export async function countAcceptedOrder(outboxId: string): Promise<boolean> {
  const outboxRef = col.outbox().doc(outboxId);
  return db.runTransaction(async (tx) => {
    const e = (await tx.get(outboxRef)).data() as { kind?: string; orderId?: string; popularityCountedAt?: string } | undefined;
    if (!e || e.kind !== 'order_accepted' || !e.orderId || e.popularityCountedAt) return false;
    const order = (await tx.get(col.order(e.orderId))).data() as Order | undefined;
    const productIds = order && order.businessType === 'restaurant' && order.status === 'accepted'
      ? [...new Set(order.lines.filter((l) => !l.comboId && !l.removed).map((l) => l.productId))]
      : [];
    if (order && productIds.length > 0) {
      const placed = new Date(order.placedAt);
      const date = toLocal(placed).date;
      const daypart = daypartOf(placed);
      const counts: Record<string, FirebaseFirestore.FieldValue> = {};
      for (const productId of productIds) counts[popularCountKey(daypart, order.branchId, productId)] = FieldValue.increment(1);
      tx.set(col.popularityDaily(`${order.cityId}_${date}`), { cityId: order.cityId, date, counts }, { merge: true });
    }
    tx.update(outboxRef, { popularityCountedAt: nowIso() });
    return productIds.length > 0;
  });
}
