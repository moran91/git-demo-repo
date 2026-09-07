import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asGuest, asUid, deliveryBase, quoteBase, expectCode, IDS, key, shawarmaLine, USERS, waitFor, type Client } from './harness.js';

let customer1: Client;
let customer2: Client;
let owner1: Client;
let manager: Client;
let staff: Client;
let owner2: Client;

beforeAll(async () => {
  [customer1, customer2, owner1, manager, staff, owner2] = await Promise.all([asUid(USERS.customer1), asUid(USERS.customer2), asEmail(USERS.owner1), asEmail(USERS.manager), asEmail(USERS.staff), asEmail(USERS.owner2)]);
});
afterAll(async () => {
  await Promise.all([customer1, customer2, owner1, manager, staff, owner2].map((c) => c.close()));
});

describe('quote + place order', () => {
  it('quotes a restaurant cart with validated modifiers for a guest', async () => {
    const guest = await asGuest();
    const q = await guest.call<{ totals: { cashDueAgorot: number; merchandiseSubtotalAgorot: number; deliveryFeeAgorot: number } }>('quoteOrder', { ...quoteBase, lines: [shawarmaLine()] });
    expect(q.totals.merchandiseSubtotalAgorot).toBe(8600);
    expect(q.totals.deliveryFeeAgorot).toBe(1000);
    expect(q.totals.cashDueAgorot).toBe(9600);
    await guest.close();
  });

  it('requires a verified phone to place (email-only owner is refused)', async () => {
    expect(await expectCode(owner1.call('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 }))).toBe('phone_not_verified');
  });

  it('rejects invalid modifiers, stale prices, wrong-city delivery, below minimum, unapproved business, other-branch products', async () => {
    expect(await expectCode(customer1.call('placeOrder', { ...deliveryBase, lines: [shawarmaLine('l1', { modifiers: [] })], idempotencyKey: key(), expectedCashDueAgorot: 9600 }))).toBe('invalid_modifiers');
    expect(await expectCode(customer1.call('placeOrder', { ...deliveryBase, lines: [shawarmaLine('l1', { expectedUnitPriceAgorot: 3500 })], idempotencyKey: key(), expectedCashDueAgorot: 8000 }))).toBe('price_changed');
    expect(await expectCode(customer1.call('placeOrder', { ...deliveryBase, cityId: 'pekiin', lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 }))).toBe('delivery_not_available');
    expect(await expectCode(customer1.call('quoteOrder', { ...quoteBase, lines: [{ lineId: 'x', productId: 'p-fries', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 1200 }] }))).toBe('below_minimum');
    expect(await expectCode(customer1.call('quoteOrder', { businessId: IDS.pending, branchId: IDS.pendingBranch, mode: 'pickup', cityId: 'beit-jann', lines: [{ lineId: 'x', productId: 'p-manaqish', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 900 }] }))).toBe('business_not_approved');
    expect(await expectCode(customer1.call('quoteOrder', { ...quoteBase, lines: [{ lineId: 'x', productId: 'p-tomato', modifiers: [], quantity: 1, requestedGrams: 500, expectedUnitPriceAgorot: 890 }] }))).toBe('item_unavailable');
    expect(await expectCode(customer1.call('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 1 }))).toBe('price_changed');
  });

  it('places a delivery order with only city + house description + recipient + phone, idempotently, and notifies branch staff', async () => {
    const k = key();
    const payload = { ...deliveryBase, addressId: undefined, address: { houseDescription: 'ליד בית הספר, השער הירוק', cityId: 'beit-jann', recipientName: 'סמיר', recipientPhone: '0501111111' }, lines: [shawarmaLine()], idempotencyKey: k, expectedCashDueAgorot: 9600, customerNote: 'בלי בצל' };
    const a = await customer1.call<{ orderId: string; reference: string; replay: boolean }>('placeOrder', payload);
    const b = await customer1.call<{ orderId: string; reference: string; replay: boolean }>('placeOrder', payload);
    expect(a.orderId).toBe(b.orderId);
    expect(b.replay).toBe(true);
    expect(a.reference).toMatch(/^Q-[A-Z2-9]{5}$/);
    const order = (await admin.db.collection('orders').doc(a.orderId).get()).data()!;
    expect(order.status).toBe('placed');
    expect(order.address.houseDescription).toBe('ליד בית הספר, השער הירוק');
    expect(order.address.street).toBeUndefined();
    expect(order.totals.cashDueAgorot).toBe(9600);
    expect(order.version).toBe(1);
    // Outbox → inbox for owner (all branches) and manager (branch A) but NOT staff (branch B only).
    const ownerNotif = await waitFor(async () => (await admin.db.collection('users').doc('seed-owner1').collection('notifications').where('orderId', '==', a.orderId).get()).docs[0]);
    expect(ownerNotif.data().kind).toBe('order_placed');
    expect(JSON.stringify(ownerNotif.data())).not.toContain('השער הירוק');
    const managerNotif = await waitFor(async () => (await admin.db.collection('users').doc('seed-manager').collection('notifications').where('orderId', '==', a.orderId).get()).docs[0]);
    expect(managerNotif).toBeTruthy();
    const staffNotifs = await admin.db.collection('users').doc('seed-staff').collection('notifications').where('orderId', '==', a.orderId).get();
    expect(staffNotifs.empty).toBe(true);
  });

  it('keeps the order address snapshot unchanged when the saved address is edited later', async () => {
    const res = await customer1.call<{ orderId: string }>('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    await customer1.call('saveAddress', { id: 'addr-home', address: { houseDescription: 'תיאור חדש לגמרי', cityId: 'beit-jann', recipientName: 'סמיר ח׳טיב', recipientPhone: '0501111111', label: 'בית' } });
    const order = (await admin.db.collection('orders').doc(res.orderId).get()).data()!;
    expect(order.address.houseDescription).toContain('השער הכחול');
    const addr = (await admin.db.collection('users').doc('seed-customer1').collection('addresses').doc('addr-home').get()).data()!;
    expect(addr.houseDescription).toBe('תיאור חדש לגמרי');
  });
});

describe('decisions', () => {
  async function place(client: Client) {
    return client.call<{ orderId: string }>('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
  }
  it('staff limited to branch B cannot decide a branch A order; manager of branch A can; replay is idempotent; version conflicts are detected', async () => {
    const { orderId } = await place(customer1);
    expect(await expectCode(staff.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() }))).toBe('forbidden');
    const k = key();
    const r1 = await manager.call<{ status: string; version: number }>('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: k });
    const r2 = await manager.call<{ status: string; version: number; replay: boolean }>('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: k });
    expect(r1.status).toBe('accepted');
    expect(r2.replay).toBe(true);
    expect(await expectCode(owner1.call('decideOrder', { orderId, decision: 'rejected', reason: 'x', expectedVersion: 2, idempotencyKey: key() }))).toBe('invalid_status_transition');
    const events = await admin.db.collection('orders').doc(orderId).collection('events').get();
    expect(events.docs.map((d) => d.data().type).sort()).toEqual(['accepted', 'placed']);
    const notif = await waitFor(async () => (await admin.db.collection('users').doc('seed-customer1').collection('notifications').where('orderId', '==', orderId).where('kind', '==', 'order_accepted').get()).docs[0]);
    expect(notif).toBeTruthy();
  });
  it('rejection requires a reason and releases tracked stock exactly once', async () => {
    const before = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-cola`).get()).data()!.stockQty;
    const { orderId } = await customer2.call<{ orderId: string }>('placeOrder', { ...deliveryBase, addressId: 'addr-parents', contactName: 'Maha', contactPhone: '0502222222', lines: [shawarmaLine(), { lineId: 'c', productId: 'p-cola', modifiers: [], quantity: 3, expectedUnitPriceAgorot: 800 }], idempotencyKey: key(), expectedCashDueAgorot: 12000 });
    const mid = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-cola`).get()).data()!.stockQty;
    expect(mid).toBe(before - 3);
    const pub = (await admin.db.doc(`publicBranches/${IDS.branchA}/products/p-cola`).get()).data()!;
    expect(pub.stockQty).toBeUndefined();
    expect(await expectCode(owner1.call('decideOrder', { orderId, decision: 'rejected', expectedVersion: 1, idempotencyKey: key() }))).toBe('invalid_argument');
    const k = key();
    await owner1.call('decideOrder', { orderId, decision: 'rejected', reason: 'Out of turkey, agreed by phone', expectedVersion: 1, idempotencyKey: k });
    await owner1.call('decideOrder', { orderId, decision: 'rejected', reason: 'Out of turkey, agreed by phone', expectedVersion: 1, idempotencyKey: k });
    const after = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-cola`).get()).data()!.stockQty;
    expect(after).toBe(before);
    const order = (await admin.db.collection('orders').doc(orderId).get()).data()!;
    expect(order.status).toBe('rejected');
    expect(order.decisionReason).toContain('agreed by phone');
    expect(await expectCode(owner1.call('recordCash', { orderId, amountAgorot: 12000, expectedVersion: order.version, idempotencyKey: key() }))).toBe('invalid_status_transition');
  });
});

describe('stock race', () => {
  it('two simultaneous orders for the last labneh: exactly one succeeds', async () => {
    const mk = (c: Client, addressId: string, phone: string) => c.call('placeOrder', { businessId: IDS.market, branchId: IDS.marketBranch, mode: 'pickup', cityId: 'beit-jann', contactName: 'x', contactPhone: phone, lines: [{ lineId: 'l', productId: 'p-labneh', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 1490 }, { lineId: 'm', productId: 'p-milk', modifiers: [], quantity: 10, expectedUnitPriceAgorot: 690 }], idempotencyKey: key(), expectedCashDueAgorot: 8390, locale: 'he', addressId });
    const results = await Promise.allSettled([mk(customer1, 'addr-home', '0501111111'), mk(customer2, 'addr-parents', '0502222222')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0]!.reason as { details?: { code?: string } }).details?.code).toBe('out_of_stock');
    const stock = (await admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-labneh`).get()).data()!.stockQty;
    expect(stock).toBe(0);
    const pub = (await admin.db.doc(`publicBranches/${IDS.marketBranch}/products/p-labneh`).get()).data()!;
    expect(pub.inStock).toBe(false);
  });
});

describe('weights, substitutions, cash, loyalty', () => {
  it('runs the supermarket lifecycle: estimated → revised with actual weight and substitution → cash → points earned once → reversal creates ledger entries', async () => {
    const lines = [
      { lineId: 't', productId: 'p-tomato', modifiers: [], quantity: 1, requestedGrams: 1500, expectedUnitPriceAgorot: 890 },
      { lineId: 'r', productId: 'p-rice', variantId: 'v-5kg', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 7990 },
    ];
    const q = await customer1.call<{ totals: { cashDueAgorot: number; isEstimated: boolean } }>('quoteOrder', { businessId: IDS.market, branchId: IDS.marketBranch, mode: 'delivery', cityId: 'beit-jann', lines });
    expect(q.totals.isEstimated).toBe(true);
    expect(q.totals.cashDueAgorot).toBe(1335 + 7990);
    const { orderId } = await customer1.call<{ orderId: string }>('placeOrder', { businessId: IDS.market, branchId: IDS.marketBranch, mode: 'delivery', cityId: 'beit-jann', contactName: 'סמיר', contactPhone: '0501111111', addressId: 'addr-home', lines, idempotencyKey: key(), expectedCashDueAgorot: 9325, locale: 'he' });
    const tomatoBefore = (await admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-tomato`).get()).data()!.stockQty;
    expect(tomatoBefore).toBe(25000 - 1500);
    await owner2.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    // Acceptance alone earns nothing.
    expect((await admin.db.collection('loyaltyAccounts').doc(`${IDS.market}_seed-customer1`).get()).exists).toBe(false);
    // Cash blocked while weights are estimated.
    expect(await expectCode(owner2.call('recordCash', { orderId, amountAgorot: 9325, expectedVersion: 2, idempotencyKey: key() }))).toBe('invalid_argument');
    // Substitution without phone agreement is refused.
    expect(await expectCode(owner2.call('reviseOrder', { orderId, expectedVersion: 2, idempotencyKey: key(), reason: 'no 5kg', phoneAgreement: false, changes: [{ lineId: 'r', action: 'substitute', replacementProductId: 'p-rice', replacementVariantId: 'v-1kg', replacementQuantity: 3 }] }))).toBe('invalid_argument');
    const rev = await owner2.call<{ version: number; revision: number }>('reviseOrder', { orderId, expectedVersion: 2, idempotencyKey: key(), reason: 'weighed; 5kg out, agreed 3x1kg', phoneAgreement: true, changes: [ { lineId: 't', action: 'set_actual_weight', actualGrams: 1620 }, { lineId: 'r', action: 'substitute', replacementProductId: 'p-rice', replacementVariantId: 'v-1kg', replacementQuantity: 3 } ] });
    expect(rev.revision).toBe(1);
    const order = (await admin.db.collection('orders').doc(orderId).get()).data()!;
    expect(order.totals.isEstimated).toBe(false);
    expect(order.totals.merchandiseSubtotalAgorot).toBe(1442 + 3 * 1990);
    expect(order.originalTotals.cashDueAgorot).toBe(9325);
    expect(order.lines.find((l: { lineId: string }) => l.lineId === 'r').removed).toBe(true);
    const rice = (await admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-rice`).get()).data()!;
    expect(rice.variants.find((v: { id: string }) => v.id === 'v-5kg').stockQty).toBe(3);
    expect(rice.variants.find((v: { id: string }) => v.id === 'v-1kg').stockQty).toBe(9);
    const tomatoAfter = (await admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-tomato`).get()).data()!.stockQty;
    expect(tomatoAfter).toBe(25000 - 1620);
    await waitFor(async () => (await admin.db.collection('users').doc('seed-customer1').collection('notifications').where('orderId', '==', orderId).where('kind', '==', 'order_revised').get()).docs[0]);
    // Stale version is rejected.
    expect(await expectCode(owner2.call('recordCash', { orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: 2, idempotencyKey: key() }))).toBe('version_conflict');
    const k = key();
    const cash = await owner2.call<{ pointsEarned: number; cashRecordId: string }>('recordCash', { orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: order.version, idempotencyKey: k });
    expect(cash.pointsEarned).toBe(Math.floor((1442 + 5970) / 1000));
    const again = await owner2.call<{ pointsEarned: number; replay: boolean }>('recordCash', { orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: order.version, idempotencyKey: k });
    expect(again.replay).toBe(true);
    expect(await expectCode(owner2.call('recordCash', { orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: order.version + 1, idempotencyKey: key() }))).toBe('already_settled');
    const acc = (await admin.db.collection('loyaltyAccounts').doc(`${IDS.market}_seed-customer1`).get()).data()!;
    expect(acc.available).toBe(7);
    expect(acc.reserved).toBe(0);
    const settled = (await admin.db.collection('orders').doc(orderId).get()).data()!;
    expect(settled.status).toBe('accepted');
    expect(settled.locked).toBe(true);
    expect(await expectCode(owner2.call('reviseOrder', { orderId, expectedVersion: settled.version, idempotencyKey: key(), reason: 'late', phoneAgreement: true, changes: [{ lineId: 't', action: 'remove' }] }))).toBe('already_settled');

    // Redeem those points on the next market order (capped at 10% of merchandise); cross-business use fails.
    const nextLines = [{ lineId: 'm', productId: 'p-milk', modifiers: [], quantity: 12, expectedUnitPriceAgorot: 690 }];
    const q2 = await customer1.call<{ redeemPoints: number; totals: { loyaltyDiscountAgorot: number; cashDueAgorot: number } }>('quoteOrder', { businessId: IDS.market, branchId: IDS.marketBranch, mode: 'pickup', cityId: 'beit-jann', lines: nextLines, redeemPoints: 7 });
    expect(q2.redeemPoints).toBe(7);
    expect(q2.totals.loyaltyDiscountAgorot).toBe(700);
    expect(await expectCode(customer1.call('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], redeemPoints: 5, idempotencyKey: key(), expectedCashDueAgorot: 9100 }))).toBe('loyalty_insufficient');
    const o2 = await customer1.call<{ orderId: string }>('placeOrder', { businessId: IDS.market, branchId: IDS.marketBranch, mode: 'pickup', cityId: 'beit-jann', contactName: 'סמיר', contactPhone: '0501111111', lines: nextLines, redeemPoints: 7, idempotencyKey: key(), expectedCashDueAgorot: q2.totals.cashDueAgorot, locale: 'he' });
    const acc2 = (await admin.db.collection('loyaltyAccounts').doc(`${IDS.market}_seed-customer1`).get()).data()!;
    expect(acc2).toMatchObject({ available: 0, reserved: 7 });
    await owner2.call('decideOrder', { orderId: o2.orderId, decision: 'rejected', reason: 'closing early, agreed', expectedVersion: 1, idempotencyKey: key() });
    const acc3 = (await admin.db.collection('loyaltyAccounts').doc(`${IDS.market}_seed-customer1`).get()).data()!;
    expect(acc3).toMatchObject({ available: 7, reserved: 0 });

    // Owner reverses the settled cash: earned points reversed → available 0, ledger has compensating entries; stock returned.
    await owner2.call('reverseCash', { orderId, reason: 'Order could not be supplied, cash returned', idempotencyKey: key() });
    const acc4 = (await admin.db.collection('loyaltyAccounts').doc(`${IDS.market}_seed-customer1`).get()).data()!;
    expect(acc4.available).toBe(0);
    expect(acc4.debt).toBe(0);
    const ledger = await admin.db.collection('loyaltyLedger').where('orderId', '==', orderId).get();
    expect(ledger.docs.map((d) => d.data().type).sort()).toEqual(['earn', 'reverse_earn']);
    const tomatoFinal = (await admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-tomato`).get()).data()!.stockQty;
    expect(tomatoFinal).toBe(25000);
    // Spend-then-reverse creates transparent debt that blocks redemption.
    await admin.db.collection('loyaltyAccounts').doc(`${IDS.market}_seed-customer1`).set({ available: 3, reserved: 0, debt: 4, updatedAt: new Date().toISOString() }, { merge: true });
    expect(await expectCode(customer1.call('placeOrder', { businessId: IDS.market, branchId: IDS.marketBranch, mode: 'pickup', cityId: 'beit-jann', contactName: 'x', contactPhone: '0501111111', lines: nextLines, redeemPoints: 1, idempotencyKey: key(), expectedCashDueAgorot: 8180, locale: 'he' }))).toBe('loyalty_debt');
  });
});
