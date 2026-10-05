import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, IDS, USERS, type Client } from './harness.js';

/** The per-branch deals index (live combos and promotions) the assistant reads. */
let owner1: Client;
let owner2: Client;
let ownerPending: Client;
beforeAll(async () => { [owner1, owner2, ownerPending] = await Promise.all([asEmail(USERS.owner1), asEmail(USERS.owner2), asEmail(USERS.ownerPending)]); });
afterAll(async () => { await Promise.all([owner1, owner2, ownerPending].map((c) => c.close())); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
type DealsDoc = { branchId: string; businessId: string; combos: Record<string, { priceAgorot: number }>; promotions: Record<string, { endsAt: string }> };
const dealsAt = async (id: string) => (await admin.db.doc(`publicBranches/${id}/index/deals`).get()).data() as DealsDoc | undefined;
const deals = () => dealsAt(branchId);
const comboInput = (name: string) => ({ name: { he: name }, description: {}, items: [{ productId: 'p-fries', quantity: 1 }, { productId: 'p-cola', quantity: 1 }], priceAgorot: 1800, promoted: false, active: true });

describe('deals index', () => {
  it('is built for the seeded restaurant branch (combo and promotion), and not for a supermarket', async () => {
    const d = await deals();
    expect(d).toMatchObject({ branchId, businessId });
    expect(d!.combos['combo-family']).toMatchObject({ priceAgorot: 6990 });
    expect(d!.promotions['promo-shawarma-week']).toMatchObject({ endsAt: '2099-12-31' });
    expect(await dealsAt(IDS.marketBranch)).toBeUndefined();
  });

  it('follows combos: saved, archived, deleted', async () => {
    const { combo } = await owner1.call<{ combo: { id: string } }>('saveCombo', { businessId, branchId, combo: { name: { he: 'פלאפל וצ׳יפס' }, description: {}, items: [{ productId: 'p-falafel', variantId: 'v-reg', quantity: 1 }, { productId: 'p-fries', quantity: 1 }], priceAgorot: 3500, promoted: false, active: true } });
    expect((await deals())!.combos[combo.id]).toMatchObject({ priceAgorot: 3500 });
    await owner1.call('setComboArchived', { businessId, branchId, comboId: combo.id, archived: true });
    expect((await deals())!.combos[combo.id]).toBeUndefined();
    await owner1.call('setComboArchived', { businessId, branchId, comboId: combo.id, archived: false });
    expect((await deals())!.combos[combo.id]).toBeDefined();
    await owner1.call('deleteCombo', { businessId, branchId, comboId: combo.id });
    expect((await deals())!.combos[combo.id]).toBeUndefined();
  });

  it('follows promotions: active only, removed on delete', async () => {
    const { promotion } = await owner1.call<{ promotion: { id: string } }>('savePromotion', { businessId, branchId, promotion: { title: { he: 'שווארמה במבצע' }, body: {}, productIds: ['p-shawarma'], active: true, endsAt: '2030-01-01' } });
    expect((await deals())!.promotions[promotion.id]).toMatchObject({ endsAt: '2030-01-01' });
    await owner1.call('savePromotion', { businessId, branchId, promotionId: promotion.id, promotion: { title: { he: 'שווארמה במבצע' }, body: {}, productIds: ['p-shawarma'], active: false, endsAt: '2030-01-01' } });
    expect((await deals())!.promotions[promotion.id]).toBeUndefined();
    await owner1.call('removePromotion', { businessId, branchId, promotionId: promotion.id });
    expect((await deals())!.promotions[promotion.id]).toBeUndefined();
  });

  it('deleting the last deal leaves no stray entry and keeps the rest', async () => {
    const before = await deals();
    const { combo } = await owner1.call<{ combo: { id: string } }>('saveCombo', { businessId, branchId: IDS.branchB, combo: comboInput('ארוחה אחרונה') });
    const { promotion } = await owner1.call<{ promotion: { id: string } }>('savePromotion', { businessId, branchId: IDS.branchB, promotion: { title: { he: 'מבצע אחרון' }, body: {}, productIds: ['p-shawarma'], active: true, endsAt: '2030-01-01' } });
    let b = await dealsAt(IDS.branchB);
    expect(Object.keys(b!.combos)).toEqual([combo.id]);
    expect(Object.keys(b!.promotions)).toEqual([promotion.id]);
    await owner1.call('deleteCombo', { businessId, branchId: IDS.branchB, comboId: combo.id });
    await owner1.call('removePromotion', { businessId, branchId: IDS.branchB, promotionId: promotion.id });
    b = await dealsAt(IDS.branchB);
    expect(b).toBeDefined();
    expect(Object.keys(b!.combos)).toEqual([]);
    expect(Object.keys(b!.promotions)).toEqual([]);
    // The other branch is untouched.
    expect(Object.keys((await deals())!.combos)).toEqual(expect.arrayContaining(Object.keys(before!.combos)));
  });

  it('deleting a deal at a supermarket or hidden branch creates no index document', async () => {
    const now = new Date().toISOString();
    const combo = (biz: string, br: string, id: string) => ({ id, businessId: biz, branchId: br, name: { he: 'x' }, description: {}, items: [{ productId: 'p-a', quantity: 1 }], priceAgorot: 100, promoted: false, active: true, archived: false, sortOrder: 0, createdAt: now, updatedAt: now });
    const promo = (biz: string, br: string, id: string) => ({ id, businessId: biz, branchId: br, title: { he: 'x' }, body: {}, productIds: [], endsAt: '2099-01-01', active: true, sortOrder: 0, createdAt: now, updatedAt: now });
    const cases: Array<[Client, string, string]> = [[owner2, IDS.market, IDS.marketBranch], [ownerPending, IDS.pending, IDS.pendingBranch]];
    for (const [client, biz, br] of cases) {
      const base = admin.db.collection('businesses').doc(biz).collection('branches').doc(br);
      await base.collection('combos').doc('zz-del').set(combo(biz, br, 'zz-del'));
      await base.collection('promotions').doc('zz-del').set(promo(biz, br, 'zz-del'));
      await client.call('deleteCombo', { businessId: biz, branchId: br, comboId: 'zz-del' });
      await client.call('removePromotion', { businessId: biz, branchId: br, promotionId: 'zz-del' });
      expect(await dealsAt(br)).toBeUndefined();
    }
  });
});
