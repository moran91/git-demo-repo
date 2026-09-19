import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, expectCode, IDS, USERS, type Client } from './harness.js';

/** Promotions: limited-time cards of a branch, projected to publicBranches/{br}/promotions (active only). */
let owner1: Client;
let staff: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); staff = await asEmail(USERS.staff); });
afterAll(async () => { await owner1.close(); await staff.close(); });

const step = async <T,>(name: string, p: Promise<T>): Promise<T> => { try { return await p; } catch (e) { const err = e as { message?: string; details?: unknown }; throw new Error(`${name}: ${err.message} ${JSON.stringify(err.details)}`); } };

describe('promotions', () => {
  it('upserts, projects only active ones, removes, and enforces role + cap + end date', async () => {
    const businessId = IDS.restaurant;
    const branchId = IDS.branchA;
    const pub = (id: string) => admin.db.doc(`publicBranches/${branchId}/promotions/${id}`).get();
    const base = { title: { he: '1+1 על פיצות' }, body: { he: 'ראשון עד רביעי' }, productIds: ['p-shawarma'], active: true, endsAt: '2030-09-30' };
    const { promotion } = await owner1.call<{ promotion: { id: string; sortOrder: number; productIds: string[] } }>('savePromotion', { businessId, branchId, promotion: base });
    expect(promotion.productIds).toEqual(['p-shawarma']);
    const hidden = (await owner1.call<{ promotion: { id: string } }>('savePromotion', { businessId, branchId, promotion: { title: { he: 'מוסתר' }, body: {}, productIds: [], active: false, endsAt: '2030-01-01' } })).promotion;
    expect((await pub(promotion.id)).data()).toMatchObject({ title: { he: '1+1 על פיצות' }, endsAt: '2030-09-30', branchId });
    expect((await pub(hidden.id)).exists).toBe(false);

    // Edit: flipping active on brings it into the projection; the private doc keeps the sort order.
    await owner1.call('savePromotion', { businessId, branchId, promotionId: hidden.id, promotion: { title: { he: 'כבר מוצג' }, body: {}, productIds: [], active: true, endsAt: '2030-01-01' } });
    expect((await pub(hidden.id)).exists).toBe(true);
    const priv = (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/promotions/${hidden.id}`).get()).data()!;
    expect(priv.sortOrder).toBeGreaterThan(promotion.sortOrder);

    // Validation / auth: an end date is mandatory, featured products must exist in the branch.
    expect(await expectCode(owner1.call('savePromotion', { businessId, branchId, promotion: { title: {}, body: {}, productIds: [], active: true, endsAt: '2030-01-01' } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('savePromotion', { businessId, branchId, promotion: { ...base, endsAt: undefined } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('savePromotion', { businessId, branchId, promotion: { ...base, endsAt: '30/09/2030' } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('savePromotion', { businessId, branchId, promotion: { ...base, productIds: ['p-tomato'] } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('savePromotion', { businessId, branchId, promotionId: 'nope', promotion: base }))).toBe('not_found');
    expect(await expectCode(staff.call('savePromotion', { businessId, branchId, promotion: base }))).toBe('forbidden');
    expect(await expectCode(staff.call('removePromotion', { businessId, branchId, promotionId: promotion.id }))).toBe('forbidden');
    expect(await expectCode(owner1.call('setPromotionImage', { businessId, branchId, promotionId: promotion.id, path: `businesses/${businessId}/branches/${IDS.branchB}/promotions/${promotion.id}/x.jpg` }))).toBe('invalid_argument');

    // Banner: an object uploaded under the promotion's prefix is recorded and projected; null clears it.
    const imagePath = `businesses/${businessId}/branches/${branchId}/promotions/${promotion.id}/banner.png`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await fetch(`http://127.0.0.1:9199/upload/storage/v1/b/qareeb-dev.firebasestorage.app/o?uploadType=media&name=${encodeURIComponent(imagePath)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    expect(up.ok).toBe(true);
    expect(await expectCode(owner1.call('setPromotionImage', { businessId, branchId, promotionId: promotion.id, path: `${imagePath}.missing` }))).toBe('invalid_argument');
    await step('set image', owner1.call('setPromotionImage', { businessId, branchId, promotionId: promotion.id, path: imagePath }));
    expect((await pub(promotion.id)).data()!.imagePath).toBe(imagePath);
    await step('clear image', owner1.call('setPromotionImage', { businessId, branchId, promotionId: promotion.id, path: null }));
    expect((await pub(promotion.id)).data()!.imagePath).toBeUndefined();

    // Cap at 10 per branch (the seed already has one).
    const existing = (await admin.db.collection(`businesses/${businessId}/branches/${branchId}/promotions`).get()).size;
    for (let i = existing; i < 10; i++) await step(`cap ${i}`, owner1.call('savePromotion', { businessId, branchId, promotion: { title: { he: `מבצע ${i}` }, body: {}, productIds: [], active: true, endsAt: '2030-01-01' } }));
    expect(await expectCode(owner1.call('savePromotion', { businessId, branchId, promotion: base }))).toBe('invalid_argument');

    // Remove.
    await step('remove', owner1.call('removePromotion', { businessId, branchId, promotionId: promotion.id }));
    expect(await expectCode(owner1.call('removePromotion', { businessId, branchId, promotionId: promotion.id }))).toBe('not_found');
    expect((await pub(promotion.id)).exists).toBe(false);
  });
});
