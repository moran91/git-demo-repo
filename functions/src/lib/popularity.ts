import { POPULAR_WINDOW_DAYS, daypartOf, popularCountKey, rankPopular, sumCounts, toLocal, type Order, type PublicPopular } from '@qareeb/shared';
import { FieldValue, col, commitInChunks, db, nowIso } from './firebase.js';

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

/**
 * Rebuilds publicPopular/{cityId} for every city from the last 28 Israeli days of counts (ranks only,
 * 3-order floor), then deletes daily counts that fell out of the window.
 */
export async function publishPopularity(now = new Date()): Promise<{ cities: number; deleted: number }> {
  // Stepping back in 24-hour hops can land on the same date twice around a clock change; dedupe.
  const dates = [...new Set(Array.from({ length: POPULAR_WINDOW_DAYS }, (_, i) => toLocal(new Date(now.getTime() - i * 86_400_000)).date))];
  const cities = await col.cities().get();
  for (const city of cities.docs) {
    const snaps = await db.getAll(...dates.map((d) => col.popularityDaily(`${city.id}_${d}`)));
    const counts = sumCounts(snaps.map((s) => (s.data() as { counts?: Record<string, number> } | undefined)?.counts));
    const doc: PublicPopular = { cityId: city.id, dayparts: rankPopular(counts), updatedAt: nowIso() };
    await col.publicPopular(city.id).set(doc);
  }
  const oldest = dates[dates.length - 1]!;
  const stale = await col.popularityDays().where('date', '<', oldest).limit(400).get();
  await commitInChunks(stale.docs.map((d) => (batch) => batch.delete(d.ref)));
  return { cities: cities.size, deleted: stale.size };
}
