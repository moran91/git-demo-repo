import { describe, expect, it } from 'vitest';
// Imported from source like posts-sweep.test.ts. This file must not import ./harness.js (the admin
// app there is the same default Firestore instance src/lib/firebase.ts configures).
import { db } from '../src/lib/firebase.js';
import { countAcceptedOrder, publishPopularity } from '../src/lib/popularity.js';

const CITY = `pop-city-${Date.now()}`;
const baseOrder = { businessId: 'biz-pop', branchId: 'br-pop', businessType: 'restaurant', cityId: CITY, customer: { uid: 'u-pop' }, status: 'accepted' };

async function seed(id: string, order: Record<string, unknown>) {
  await db.doc(`orders/${id}`).set({ id, ...baseOrder, ...order });
  // The emulator's onOutboxCreated trigger may also count this event; the result must still be one.
  await db.doc(`outbox/${id}`).set({ id, kind: 'order_accepted', orderId: id, recipients: [], params: {}, link: '/', key: id, attempts: 0, status: 'pending', createdAt: new Date().toISOString() });
}

describe('countAcceptedOrder', () => {
  it('counts each dish once per order, skips combos and removed lines, and survives retries', async () => {
    const id = `pop-o1-${Date.now()}`;
    // 20:30 UTC on 15 Jan = 22:30 in Israel: late, same date.
    await seed(id, { placedAt: '2026-01-15T20:30:00.000Z', lines: [{ productId: 'p1' }, { productId: 'p1' }, { productId: 'p2', removed: true }, { productId: 'c1', comboId: 'combo1' }] });
    await countAcceptedOrder(id);
    await countAcceptedOrder(id);
    await new Promise((r) => setTimeout(r, 1500));
    await countAcceptedOrder(id);
    const day = (await db.doc(`popularityDaily/${CITY}_2026-01-15`).get()).data()!;
    expect(day).toMatchObject({ cityId: CITY, date: '2026-01-15' });
    expect(day.counts).toEqual({ 'late|br-pop|p1': 1 });
    expect((await db.doc(`outbox/${id}`).get()).data()!.popularityCountedAt).toBeTruthy();
  });

  it('files a 00:30 order under the Israeli date', async () => {
    const id = `pop-o2-${Date.now()}`;
    // 22:30 UTC on 15 Jan = 00:30 on 16 Jan in Israel.
    await seed(id, { placedAt: '2026-01-15T22:30:00.000Z', lines: [{ productId: 'p9' }] });
    await countAcceptedOrder(id);
    expect((await db.doc(`popularityDaily/${CITY}_2026-01-16`).get()).data()!.counts).toEqual({ 'late|br-pop|p9': 1 });
  });

  it('ignores supermarket orders and events that are not acceptances', async () => {
    const id = `pop-o3-${Date.now()}`;
    await seed(id, { businessType: 'supermarket', placedAt: '2026-01-20T10:00:00.000Z', lines: [{ productId: 'milk' }] });
    expect(await countAcceptedOrder(id)).toBe(false);
    expect((await db.doc(`popularityDaily/${CITY}_2026-01-20`).get()).exists).toBe(false);
    expect(await countAcceptedOrder('no-such-event')).toBe(false);
  });
});

describe('publishPopularity', () => {
  it('publishes ranks over 28 days with the 3-order floor and deletes older days', async () => {
    const city = `pub-city-${Date.now()}`;
    await db.doc(`cities/${city}`).set({ id: city, name: { en: 'Test' }, aliases: [], active: false, sortOrder: 99 });
    await db.doc(`popularityDaily/${city}_2026-03-10`).set({ cityId: city, date: '2026-03-10', counts: { 'evening|brA|p1': 2, 'evening|brA|p2': 2, 'noon|brB|p9': 3 } });
    await db.doc(`popularityDaily/${city}_2026-02-12`).set({ cityId: city, date: '2026-02-12', counts: { 'evening|brA|p1': 2 } });
    await db.doc(`popularityDaily/${city}_2026-01-01`).set({ cityId: city, date: '2026-01-01', counts: { 'evening|brA|p3': 50 } });

    const r = await publishPopularity(new Date('2026-03-10T12:00:00.000Z'));

    expect(r.deleted).toBeGreaterThanOrEqual(1);
    const pub = (await db.doc(`publicPopular/${city}`).get()).data()!;
    expect(pub.cityId).toBe(city);
    expect(pub.dayparts).toEqual({ morning: [], noon: [{ branchId: 'brB', productId: 'p9' }], evening: [{ branchId: 'brA', productId: 'p1' }], late: [] });
    expect(JSON.stringify(pub)).not.toContain('counts');
    expect((await db.doc(`popularityDaily/${city}_2026-01-01`).get()).exists).toBe(false);
    expect((await db.doc(`popularityDaily/${city}_2026-02-12`).get()).exists).toBe(true);
    await db.doc(`cities/${city}`).delete();
  });
});
