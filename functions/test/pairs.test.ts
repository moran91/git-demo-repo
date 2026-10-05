import { describe, expect, it } from 'vitest';
// Imported from source like posts-sweep.test.ts: the schedule never fires in the emulator, and this
// file must not import ./harness.js (second admin app on the same Firestore instance).
import { db } from '../src/lib/firebase.js';
import { rebuildPairs } from '../src/domain/pairs.js';
import { reprojectCatalog } from '../src/lib/projections.js';

describe('rebuildPairs', () => {
  it('writes pairs for a branch with enough recent orders and skips old ones', async () => {
    const branchId = 'br-abu-salim-main';
    const now = new Date('2026-10-05T03:00:00.000Z');
    const recent = new Date(now.getTime() - 5 * 86_400_000).toISOString();
    const old = new Date(now.getTime() - 200 * 86_400_000).toISOString();
    const batch = db.batch();
    for (let i = 0; i < 10; i++) batch.set(db.doc(`orders/pairs-test-${i}`), { branchId, businessId: 'biz-abu-salim', status: 'accepted', placedAt: recent, lines: [{ productId: 'p-shawarma' }, { productId: 'p-cola' }] });
    // Two old orders: inside the window they would pair (count 2), so their absence proves the window.
    for (const k of ['old1', 'old2']) batch.set(db.doc(`orders/pairs-test-${k}`), { branchId, businessId: 'biz-abu-salim', status: 'accepted', placedAt: old, lines: [{ productId: 'p-shawarma' }, { productId: 'p-old-only' }] });
    await batch.commit();

    await rebuildPairs(now);

    const doc = (await db.doc(`publicBranches/${branchId}/index/pairs`).get()).data()!;
    // Other suites' orders may add more pairs; ours must be there and the old order must not.
    expect(doc.pairs['p-shawarma'].map((p: { productId: string }) => p.productId)).toContain('p-cola');
    expect(JSON.stringify(doc.pairs)).not.toContain('p-old-only');
    // The public doc ranks dishes but never publishes sales-volume counts.
    expect(JSON.stringify(doc)).not.toContain('count');
    expect(doc.pairs['p-shawarma'].every((p: object) => Object.keys(p).join() === 'productId')).toBe(true);
    const cleanup = db.batch();
    for (let i = 0; i < 10; i++) cleanup.delete(db.doc(`orders/pairs-test-${i}`));
    for (const k of ['old1', 'old2']) cleanup.delete(db.doc(`orders/pairs-test-${k}`));
    await cleanup.commit();
  });

  it('deletes a stale pairs doc whose branch has no qualifying orders, and never creates pairs for a branch without a dish index', async () => {
    const stale = 'pairs-stale-br';
    const staleDoc = db.doc(`publicBranches/${stale}/index/pairs`);
    const dishes = db.doc(`publicBranches/${stale}/index/dishes`);
    const hiddenOnly = 'pairs-nodish-br';
    const hiddenDoc = db.doc(`publicBranches/${hiddenOnly}/index/pairs`);
    const now = new Date('2026-10-05T03:00:00.000Z');
    await dishes.set({ branchId: stale, businessId: 'biz-x', dishes: {}, updatedAt: now.toISOString() });
    await staleDoc.set({ branchId: stale, pairs: { a: [{ productId: 'b' }] }, updatedAt: '2026-01-01T00:00:00.000Z' });
    await hiddenDoc.set({ branchId: hiddenOnly, pairs: { a: [{ productId: 'b' }] }, updatedAt: '2026-01-01T00:00:00.000Z' });
    // Ten recent orders at a branch with no dish index must not produce a pairs doc.
    const batch = db.batch();
    for (let i = 0; i < 10; i++) batch.set(db.doc(`orders/pairs-nodish-${i}`), { branchId: hiddenOnly, businessId: 'biz-x', status: 'accepted', placedAt: now.toISOString(), lines: [{ productId: 'a' }, { productId: 'b' }] });
    await batch.commit();

    await rebuildPairs(now);

    expect((await staleDoc.get()).exists).toBe(false);
    expect((await hiddenDoc.get()).exists).toBe(false);
    const cleanup = db.batch();
    for (let i = 0; i < 10; i++) cleanup.delete(db.doc(`orders/pairs-nodish-${i}`));
    cleanup.delete(dishes);
    await cleanup.commit();
  });
});

describe('reprojectCatalog and the pairs doc', () => {
  it('keeps the pairs doc of a visible restaurant branch and removes it once the branch is hidden', async () => {
    const businessId = 'pairs-rp-biz';
    const branchId = 'pairs-rp-br';
    const bizRef = db.doc(`businesses/${businessId}`);
    const brRef = db.doc(`businesses/${businessId}/branches/${branchId}`);
    const pairsRef = db.doc(`publicBranches/${branchId}/index/pairs`);
    await bizRef.set({ id: businessId, type: 'restaurant', approval: 'approved' });
    await brRef.set({ id: branchId, businessId, approval: 'approved' });
    await pairsRef.set({ branchId, pairs: { a: [{ productId: 'b' }] }, updatedAt: '2026-01-01T00:00:00.000Z' });

    await reprojectCatalog(businessId, branchId);
    // Reproject never writes pairs, so the nightly doc survives unchanged.
    expect((await pairsRef.get()).data()!.pairs.a).toEqual([{ productId: 'b' }]);

    await brRef.update({ approval: 'pending' });
    await reprojectCatalog(businessId, branchId);
    expect((await pairsRef.get()).exists).toBe(false);

    await Promise.all([bizRef.delete(), brRef.delete(), db.doc(`publicBranches/${branchId}/index/dishes`).delete(), db.doc(`publicBranches/${branchId}/index/deals`).delete()]);
  });
});
