import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, expectCode, IDS, USERS, type Client } from './harness.js';

/** Promotions: owner-managed cards projected to the public business doc (active only). */
let owner1: Client;
let staff: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); staff = await asEmail(USERS.staff); });
afterAll(async () => { await owner1.close(); await staff.close(); });

describe('promotions', () => {
  it('upserts, projects only active ones, removes, and enforces role + cap', async () => {
    const businessId = IDS.restaurant;
    const base = { title: { he: '1+1 על פיצות' }, body: { he: 'ראשון עד רביעי' }, active: true, endsAt: '2030-09-30' };
    const { promotion } = await owner1.call<{ promotion: { id: string; sortOrder: number } }>('savePromotion', { businessId, promotion: base });
    expect(promotion.sortOrder).toBe(0);
    const hidden = (await owner1.call<{ promotion: { id: string } }>('savePromotion', { businessId, promotion: { title: { he: 'מוסתר' }, body: {}, active: false } })).promotion;

    let pub = (await admin.db.doc(`publicBusinesses/${businessId}`).get()).data()!;
    expect(pub.promotions.map((p: any) => p.id)).toEqual([promotion.id]);
    expect(pub.promotions[0]).toMatchObject({ title: { he: '1+1 על פיצות' }, endsAt: '2030-09-30' });

    // Edit: clearing the date removes the field; flipping active on brings it into the projection.
    await owner1.call('savePromotion', { businessId, promotionId: hidden.id, promotion: { title: { he: 'כבר מוצג' }, body: {}, active: true } });
    await owner1.call('savePromotion', { businessId, promotionId: promotion.id, promotion: { ...base, endsAt: undefined } });
    const priv = (await admin.db.doc(`businesses/${businessId}`).get()).data()!;
    expect(priv.promotions.find((p: any) => p.id === promotion.id).endsAt).toBeUndefined();
    pub = (await admin.db.doc(`publicBusinesses/${businessId}`).get()).data()!;
    expect(pub.promotions.map((p: any) => p.id)).toEqual([promotion.id, hidden.id]);

    // Validation / auth.
    expect(await expectCode(owner1.call('savePromotion', { businessId, promotion: { title: {}, body: {}, active: true } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('savePromotion', { businessId, promotion: { ...base, endsAt: '30/09/2030' } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('savePromotion', { businessId, promotionId: 'nope', promotion: base }))).toBe('not_found');
    expect(await expectCode(staff.call('savePromotion', { businessId, promotion: base }))).toBe('forbidden');
    expect(await expectCode(staff.call('removePromotion', { businessId, promotionId: promotion.id }))).toBe('forbidden');

    // Cap at 10.
    for (let i = 2; i < 10; i++) await owner1.call('savePromotion', { businessId, promotion: { title: { he: `מבצע ${i}` }, body: {}, active: true } });
    expect(await expectCode(owner1.call('savePromotion', { businessId, promotion: base }))).toBe('invalid_argument');

    // Remove.
    await owner1.call('removePromotion', { businessId, promotionId: promotion.id });
    expect(await expectCode(owner1.call('removePromotion', { businessId, promotionId: promotion.id }))).toBe('not_found');
    pub = (await admin.db.doc(`publicBusinesses/${businessId}`).get()).data()!;
    expect(pub.promotions.some((p: any) => p.id === promotion.id)).toBe(false);
  });
});
