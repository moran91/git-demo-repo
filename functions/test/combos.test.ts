import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asUid, deliveryBase, expectCode, IDS, key, USERS, type Client } from './harness.js';

let customer1: Client;
let owner1: Client;
let manager: Client;
let staff: Client;
beforeAll(async () => {
  [customer1, owner1, manager, staff] = await Promise.all([asUid(USERS.customer1), asEmail(USERS.owner1), asEmail(USERS.manager), asEmail(USERS.staff)]);
});
afterAll(async () => { await Promise.all([customer1, owner1, manager, staff].map((c) => c.close())); });

describe('most ordered + combos', () => {
  it('manager marks a product as most ordered; the public projection shows it; staff cannot', async () => {
    await manager.call('setProductMostOrdered', { businessId: IDS.restaurant, branchId: IDS.branchA, productId: 'p-shawarma', mostOrdered: true });
    expect((await admin.db.doc(`publicBranches/${IDS.branchA}/products/p-shawarma`).get()).data()!.mostOrdered).toBe(true);
    expect(await expectCode(staff.call('setProductMostOrdered', { businessId: IDS.restaurant, branchId: IDS.branchB, productId: 'p-shawarma', mostOrdered: true }))).toBe('forbidden');
  });

  it('owner creates a promoted combo with quantities; weight items and duplicates are rejected; public projection follows active/archived', async () => {
    expect(await expectCode(owner1.call('saveCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, combo: { name: { en: 'x' }, description: {}, items: [{ productId: 'p-fries', quantity: 1 }, { productId: 'p-fries', quantity: 2 }], priceAgorot: 1000, promoted: true, active: true } }))).toBe('invalid_argument');
    // Fixed price above the members' sum (2×2800 + 1200 + 2×800 = 8400) is rejected.
    expect(await expectCode(owner1.call('saveCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, combo: { name: { en: 'x' }, description: {}, items: [{ productId: 'p-falafel', variantId: 'v-reg', quantity: 2 }, { productId: 'p-fries', quantity: 1 }, { productId: 'p-cola', quantity: 2 }], priceAgorot: 8401, promoted: true, active: true } }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('saveCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, combo: { name: { en: 'x' }, description: {}, items: [{ productId: 'p-fries', quantity: 1 }, { productId: 'p-cola', quantity: 1 }], discountPercent: 10, promoted: true, active: true } }))).toBe('invalid_argument'); // percentages are gone
    expect(await expectCode(owner1.call('saveCombo', { businessId: IDS.market, branchId: IDS.marketBranch, combo: { name: { en: 'x' }, description: {}, items: [{ productId: 'p-tomato', quantity: 1 }, { productId: 'p-milk', quantity: 1 }], priceAgorot: 1000, promoted: true, active: true } }))).toBe('forbidden'); // other business
    const r = await owner1.call<{ combo: { id: string } }>('saveCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, combo: { name: { en: 'Two falafel + fries', he: 'שני פלאפל + צ׳יפס' }, description: {}, items: [{ productId: 'p-falafel', variantId: 'v-reg', quantity: 2 }, { productId: 'p-fries', quantity: 1 }, { productId: 'p-cola', quantity: 2 }], priceAgorot: 6500, promoted: true, active: true } });
    const pub = (await admin.db.doc(`publicBranches/${IDS.branchA}/combos/${r.combo.id}`).get()).data()!;
    expect(pub.priceAgorot).toBe(6500);
    expect(pub.discountPercent).toBeUndefined();
    expect(pub.items).toHaveLength(3);
    await owner1.call('setComboArchived', { businessId: IDS.restaurant, branchId: IDS.branchA, comboId: r.combo.id, archived: true });
    expect((await admin.db.doc(`publicBranches/${IDS.branchA}/combos/${r.combo.id}`).get()).exists).toBe(false);
    await owner1.call('setComboArchived', { businessId: IDS.restaurant, branchId: IDS.branchA, comboId: r.combo.id, archived: false });
  });

  it('owner deletes a combo permanently; staff cannot; the public projection is gone', async () => {
    const r = await owner1.call<{ combo: { id: string } }>('saveCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, combo: { name: { en: 'Throwaway' }, description: {}, items: [{ productId: 'p-fries', quantity: 1 }, { productId: 'p-cola', quantity: 1 }], priceAgorot: 1800, promoted: true, active: true } });
    expect((await admin.db.doc(`publicBranches/${IDS.branchA}/combos/${r.combo.id}`).get()).exists).toBe(true);
    expect(await expectCode(staff.call('deleteCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, comboId: r.combo.id }))).toBe('forbidden');
    await owner1.call('deleteCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, comboId: r.combo.id });
    expect((await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/combos/${r.combo.id}`).get()).exists).toBe(false);
    expect((await admin.db.doc(`publicBranches/${IDS.branchA}/combos/${r.combo.id}`).get()).exists).toBe(false);
    expect(await expectCode(owner1.call('deleteCombo', { businessId: IDS.restaurant, branchId: IDS.branchA, comboId: r.combo.id }))).toBe('not_found');
  });

  it('a combo order is charged the fixed price, reserves member stock, releases it on rejection', async () => {
    const combos = await admin.db.collection(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/combos`).where('archived', '==', false).limit(1).get();
    const comboId = combos.docs[0]!.id;
    // Members: 2×2800 + 1200 + 2×800 = 8400; the charged price is the owner's fixed price, not the sum.
    const unit = combos.docs[0]!.data().priceAgorot as number;
    expect(unit).toBeLessThan(8400);
    const line = { lineId: 'cb', comboId, productId: comboId, modifiers: [], quantity: 2, expectedUnitPriceAgorot: unit };
    const q = await customer1.call<{ totals: { merchandiseSubtotalAgorot: number }; lines: Array<{ comboItems?: unknown[] }> }>('quoteOrder', { businessId: IDS.restaurant, branchId: IDS.branchA, mode: 'pickup', cityId: 'beit-jann', lines: [line] });
    expect(q.totals.merchandiseSubtotalAgorot).toBe(unit * 2);
    expect(q.lines[0]!.comboItems).toHaveLength(3);
    expect(await expectCode(customer1.call('quoteOrder', { businessId: IDS.restaurant, branchId: IDS.branchA, mode: 'pickup', cityId: 'beit-jann', lines: [{ ...line, expectedUnitPriceAgorot: 8400 }] }))).toBe('price_changed');
    const colaBefore = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-cola`).get()).data()!.stockQty as number;
    const { orderId } = await customer1.call<{ orderId: string }>('placeOrder', { ...deliveryBase, mode: 'pickup', addressId: undefined, lines: [line], idempotencyKey: key(), expectedCashDueAgorot: unit * 2 });
    const colaMid = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-cola`).get()).data()!.stockQty as number;
    expect(colaMid).toBe(colaBefore - 4); // 2 colas per combo × 2 combos
    const order = (await admin.db.collection('orders').doc(orderId).get()).data()!;
    expect(order.lines[0].comboDiscountPercent).toBeUndefined();
    expect(order.lines[0].unitPriceAgorot).toBe(unit);
    expect(order.lines[0].comboItems[0].name.en).toBe('Falafel plate');
    // Combo lines can only be removed in a revision, never re-quantified.
    expect(await expectCode(manager.call('reviseOrder', { orderId, expectedVersion: 1, idempotencyKey: key(), reason: 'x', phoneAgreement: true, changes: [{ lineId: 'cb', action: 'set_quantity', quantity: 1 }] }))).toBe('invalid_argument');
    await manager.call('decideOrder', { orderId, decision: 'rejected', reason: 'test', expectedVersion: 1, idempotencyKey: key() });
    const colaAfter = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-cola`).get()).data()!.stockQty as number;
    expect(colaAfter).toBe(colaBefore);
  });
});
