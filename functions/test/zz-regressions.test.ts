import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asUid, deliveryBase, expectCode, IDS, key, shawarmaLine, USERS, type Client } from './harness.js';

/**
 * Regressions for defects found by exercising every callable as owner, staff, customer and admin.
 * Each test fails on the original code and passes on the fix.
 */

let owner1: Client;
let owner2: Client;
let manager: Client;
let customer1: Client;
/** Used by the loyalty test so it cannot disturb customer1's balances, which orders.test.ts asserts on. */
let customer2: Client;
let adminC: Client;

beforeAll(async () => {
  [owner1, owner2, manager, customer1, customer2, adminC] = await Promise.all([asEmail(USERS.owner1), asEmail(USERS.owner2), asEmail(USERS.manager), asUid(USERS.customer1), asUid(USERS.customer2), asEmail(USERS.admin)]);
});
afterAll(async () => {
  await Promise.all([owner1, owner2, manager, customer1, customer2, adminC].map((c) => c.close()));
});

const marketBase = { businessId: IDS.market, branchId: IDS.marketBranch };

describe('printer deactivation', () => {
  it('deactivates the printer and revokes its stations (read-after-write used to abort the transaction)', async () => {
    const role = `kitchen-${Date.now()}`;
    const printer = { name: 'Counter', profileId: 'os_print_dialog', transport: 'os_print_dialog', paperWidthMm: 58, printableDots: 384, receiptLocale: 'he', copies: 1, role, autoPrint: 'off', cutSupported: false, feedLinesAfter: 3 };
    const { printer: p } = await owner2.call<{ printer: { id: string } }>('savePrinter', { ...marketBase, printer });
    await owner2.call('markPrinterVerified', { printerId: p.id, verified: true });
    await owner2.call('savePrinter', { ...marketBase, printerId: p.id, printer: { ...printer, autoPrint: 'when_placed' } });
    const { station } = await owner2.call<{ station: { id: string } }>('registerStation', { printerId: p.id, kind: 'web', label: 'Counter tablet' });

    await owner2.call('deactivatePrinter', { printerId: p.id });

    const after = (await admin.db.collection('printers').doc(p.id).get()).data()!;
    expect(after.active).toBe(false);
    expect(after.autoPrint).toBe('off');
    expect((await admin.db.collection('printStations').doc(station.id).get()).data()!.revoked).toBe(true);
  });
});

describe('stock restoration across variants of one product', () => {
  it('returns every variant to stock when an order with two variants of the same product is rejected', async () => {
    const path = `businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-rice`;
    const before = (await admin.db.doc(path).get()).data()!;
    const qty = (v: FirebaseFirestore.DocumentData, id: string) => v.variants.find((x: { id: string }) => x.id === id).stockQty;
    const before1 = qty(before, 'v-1kg');
    const before5 = qty(before, 'v-5kg');

    const lines = [
      { lineId: 'r1', productId: 'p-rice', variantId: 'v-1kg', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 1990 },
      { lineId: 'r5', productId: 'p-rice', variantId: 'v-5kg', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 7990 },
    ];
    const q = await customer1.call<{ totals: { cashDueAgorot: number } }>('quoteOrder', { ...marketBase, mode: 'delivery', cityId: 'beit-jann', lines });
    const placed = await customer1.call<{ orderId: string }>('placeOrder', { ...marketBase, mode: 'delivery', cityId: 'beit-jann', lines, idempotencyKey: key(), contactName: 'סמיר', contactPhone: '0501111111', addressId: 'addr-home', expectedCashDueAgorot: q.totals.cashDueAgorot, locale: 'he' });

    const held = (await admin.db.doc(path).get()).data()!;
    expect(qty(held, 'v-1kg')).toBe(before1 - 1);
    expect(qty(held, 'v-5kg')).toBe(before5 - 1);

    const order = (await admin.db.collection('orders').doc(placed.orderId).get()).data()!;
    await owner2.call('decideOrder', { orderId: placed.orderId, decision: 'rejected', reason: 'out of stock', expectedVersion: order.version, idempotencyKey: key() });

    const restored = (await admin.db.doc(path).get()).data()!;
    expect(qty(restored, 'v-1kg')).toBe(before1);
    expect(qty(restored, 'v-5kg')).toBe(before5);
  });
});

describe('image paths', () => {
  it('clears a product image when the client sends path: null (null is stripped before validation)', async () => {
    const path = `businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-milk`;
    await admin.db.doc(path).set({ imagePath: `businesses/${IDS.market}/branches/${IDS.marketBranch}/products/p-milk/old.jpg` }, { merge: true });
    await owner2.call('setProductImage', { ...marketBase, productId: 'p-milk', path: null });
    expect((await admin.db.doc(path).get()).data()!.imagePath).toBeUndefined();
  });

  it('clears a business logo when the client sends path: null', async () => {
    await admin.db.collection('businesses').doc(IDS.market).set({ logoPath: `businesses/${IDS.market}/logo.jpg` }, { merge: true });
    await owner2.call('setBusinessImage', { businessId: IDS.market, kind: 'logo', path: null });
    expect((await admin.db.collection('businesses').doc(IDS.market).get()).data()!.logoPath ?? null).toBeNull();
  });

  it('still rejects a path belonging to another tenant', async () => {
    expect(await expectCode(owner2.call('setProductImage', { ...marketBase, productId: 'p-milk', path: 'businesses/other/x.jpg' }))).toBe('invalid_argument');
  });
});

describe('public stock indicator', () => {
  it('reports remaining stock from the variants, not from the always-zero product counter', async () => {
    const category = await owner2.call<{ category: { id: string } }>('saveCategory', { ...marketBase, category: { name: { he: 'רגרסיה' } } });
    const product = await owner2.call<{ product: { id: string } }>('saveProduct', {
      ...marketBase,
      product: {
        categoryId: category.category.id, name: { he: 'קמח' }, description: {}, dietaryText: {},
        pricingMode: 'unit', priceAgorot: 1000, unitLabel: {}, quantityStep: 1, minQuantity: 1,
        variants: [
          { id: 'v-a', name: { he: '1 ק״ג' }, priceAgorot: 1000, available: true, sortOrder: 0, stockQty: 6 },
          { id: 'v-b', name: { he: '2 ק״ג' }, priceAgorot: 1800, available: true, sortOrder: 1, stockQty: 4 },
        ],
        modifierGroups: [], available: true, trackInventory: true,
      },
    });
    const pub = (await admin.db.doc(`publicBranches/${IDS.marketBranch}/products/${product.product.id}`).get()).data()!;
    expect(pub.inStock).toBe(true);
    // 10 units are available; the old projection read the product-level counter and published 0,
    // which the storefront rendered as "only 0 left" on an in-stock item.
    expect(pub.stockLeft).toBe(10);
  });
});

describe('admin user pagination', () => {
  it('pages past users that share a createdAt timestamp', async () => {
    const total = (await admin.db.collection('users').get()).size;
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const r: { users: Array<{ uid: string }>; nextCursor?: string } = await adminC.call('adminListUsers', { limit: 2, ...(cursor ? { cursor } : {}) });
      r.users.forEach((u) => seen.add(u.uid));
      if (!r.nextCursor || r.users.length === 0) break;
      cursor = r.nextCursor;
    }
    expect(seen.size).toBe(total);
  });
});

describe('loyalty debt', () => {
  it('pays debt down with points earned on a later order instead of stranding the customer', async () => {
    // customer2, not customer1: this test settles an order and moves loyalty balances, and
    // orders.test.ts asserts on customer1's points. Vitest runs this file first, so sharing the
    // customer made that suite fail intermittently.
    const accRef = admin.db.collection('loyaltyAccounts').doc(`${IDS.restaurant}_seed-customer2`);
    // A reversal can leave the account in debt; while debt stands, placeOrder refuses redemption.
    await accRef.set({ id: accRef.id, businessId: IDS.restaurant, uid: 'seed-customer2', available: 0, reserved: 0, debt: 40, updatedAt: new Date(0).toISOString() });

    const placed = await customer2.call<{ orderId: string }>('placeOrder', { ...deliveryBase, addressId: 'addr-parents', contactPhone: '050-222-2222', lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    let order = (await admin.db.collection('orders').doc(placed.orderId).get()).data()!;
    await owner1.call('decideOrder', { orderId: placed.orderId, decision: 'accepted', expectedVersion: order.version, idempotencyKey: key() });
    order = (await admin.db.collection('orders').doc(placed.orderId).get()).data()!;
    const res = await owner1.call<{ pointsEarned: number }>('recordCash', { orderId: placed.orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: order.version, idempotencyKey: key() });

    expect(res.pointsEarned).toBeGreaterThan(0);
    const acc = (await accRef.get()).data()!;
    // Earned points cover the debt first (as adminAdjustLoyalty already does); only the surplus is spendable.
    expect(acc.debt).toBe(Math.max(0, 40 - res.pointsEarned));
    expect(acc.available).toBe(Math.max(0, res.pointsEarned - 40));
  });
});

describe('print job lease clearing', () => {
  it('clears the lease so a superseded station cannot reopen a job staff already resolved', async () => {
    const role = `lease-${Date.now()}`;
    const printer = { name: 'Lease', profileId: 'os_print_dialog', transport: 'os_print_dialog', paperWidthMm: 58, printableDots: 384, receiptLocale: 'he', copies: 1, role, autoPrint: 'off', cutSupported: false, feedLinesAfter: 3 };
    const { printer: p } = await owner2.call<{ printer: { id: string } }>('savePrinter', { ...marketBase, printer });
    const { station } = await owner2.call<{ station: { id: string } }>('registerStation', { printerId: p.id, kind: 'web', label: 'Lease station' });
    const job = await owner2.call<{ jobId: string }>('enqueuePrint', { printerId: p.id, template: 'test', idempotencyKey: key() });
    const claim = await owner2.call<{ job: { id: string }; fence: number; attemptId: string }>('claimPrintJob', { stationId: station.id });
    await owner2.call('reportPrintAttempt', { stationId: station.id, jobId: job.jobId, fence: claim.fence, outcome: 'sent', attemptId: claim.attemptId });

    // Assigning `undefined` under ignoreUndefinedProperties left these in place.
    const after = (await admin.db.collection('printJobs').doc(job.jobId).get()).data()!;
    expect(after.leaseStationId).toBeUndefined();
    expect(after.leaseExpiresAt).toBeUndefined();

    // Staff confirm on paper; the stale station must not be able to touch it afterwards.
    await owner2.call('resolvePrintJob', { jobId: job.jobId, resolution: 'confirmed' });
    const resolved = (await admin.db.collection('printJobs').doc(job.jobId).get()).data()!;
    expect(resolved.leaseStationId).toBeUndefined();
    expect(await expectCode(owner2.call('reportPrintAttempt', { stationId: station.id, jobId: job.jobId, fence: claim.fence, outcome: 'failed_before_send' }))).toBe('version_conflict');
    expect((await admin.db.collection('printJobs').doc(job.jobId).get()).data()!.state).toBe('confirmed');
  });
});

describe('print queue starvation', () => {
  it('still claims a fresh job when the oldest queued page is entirely stale', async () => {
    const role = `starve-${Date.now()}`;
    const printer = { name: 'Starve', profileId: 'os_print_dialog', transport: 'os_print_dialog', paperWidthMm: 58, printableDots: 384, receiptLocale: 'he', copies: 1, role, autoPrint: 'off', cutSupported: false, feedLinesAfter: 3 };
    const { printer: p } = await owner2.call<{ printer: { id: string } }>('savePrinter', { ...marketBase, printer });
    const { station } = await owner2.call<{ station: { id: string } }>('registerStation', { printerId: p.id, kind: 'web', label: 'Starve station' });

    // A backlog from a spell with the printer offline: more than one page of jobs, all older than
    // the 10-minute staleness window.
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const batch = admin.db.batch();
    for (let i = 0; i < 12; i++) {
      const ref = admin.db.collection('printJobs').doc(`stale-${role}-${i}`);
      batch.set(ref, { id: ref.id, key: ref.id, businessId: IDS.market, branchId: IDS.marketBranch, printerId: p.id, printerRole: role, template: 'test', trigger: 'test', copyIndex: 0, isReprint: false, state: 'queued', requestedBy: 'system', requestedAt: old, receipt: { version: 1, template: 'test', locale: 'he', dir: 'rtl', paperWidthMm: 58, printableDots: 384, labels: {}, blocks: [], generatedAt: old }, leaseFence: 0, attempts: 0, updatedAt: old });
    }
    await batch.commit();

    // A new job arrives now; auto-print must still reach it.
    const fresh = await owner2.call<{ jobId: string }>('enqueuePrint', { printerId: p.id, template: 'test', idempotencyKey: key() });
    const claim = await owner2.call<{ job: { id: string } | null }>('claimPrintJob', { stationId: station.id });
    expect(claim.job?.id).toBe(fresh.jobId);

    // Staff can still reach the backlog explicitly.
    const stale = await owner2.call<{ job: { id: string } | null }>('claimPrintJob', { stationId: station.id, includeStale: true });
    expect(stale.job?.id).toMatch(new RegExp(`^stale-${role}-`));
  });
});

describe('clearing public contact details', () => {
  it('removes a public phone and email instead of silently keeping the old one', async () => {
    const base = { type: 'supermarket' as const, name: { he: 'סופר' }, description: {}, defaultLocale: 'he' as const };
    await owner2.call('updateBusiness', { businessId: IDS.market, business: { ...base, publicPhone: '04-9990000', publicEmail: 'shop@example.test' } });
    const set = (await admin.db.collection('businesses').doc(IDS.market).get()).data()!;
    expect(set.publicPhone).toBe('+97249990000');
    expect(set.publicEmail).toBe('shop@example.test');
    expect((await admin.db.collection('publicBusinesses').doc(IDS.market).get()).data()!.publicPhone).toBe('+97249990000');

    // Emptying the fields must delete them: assigning `undefined` was dropped by
    // ignoreUndefinedProperties, so the number stayed in the world-readable projection forever.
    await owner2.call('updateBusiness', { businessId: IDS.market, business: { ...base, publicPhone: '', publicEmail: '' } });
    const cleared = (await admin.db.collection('businesses').doc(IDS.market).get()).data()!;
    expect(cleared.publicPhone).toBeUndefined();
    expect(cleared.publicEmail).toBeUndefined();
    expect((await admin.db.collection('publicBusinesses').doc(IDS.market).get()).data()!.publicPhone).toBeUndefined();
  });
});

describe('branch map location', () => {
  it('saves and clears an optional map pin without retaining the old location', async () => {
    const ref = admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}`);
    const original = (await ref.get()).data()!;
    const branch = {
      name: original.name, cityId: original.cityId, locationDescription: original.locationDescription,
      phone: original.phone, hours: original.hours, hoursOverrides: original.hoursOverrides,
      pickupEnabled: original.pickupEnabled, deliveryEnabled: original.deliveryEnabled, deliveryCities: original.deliveryCities,
    };
    try {
      await owner2.call('updateBranch', { ...marketBase, branch: { ...branch, lat: 32.963, lng: 35.383 } });
      expect((await ref.get()).data()!.lat).toBe(32.963);
      expect((await ref.get()).data()!.lng).toBe(35.383);
      await owner2.call('updateBranch', { ...marketBase, branch });
      expect((await ref.get()).data()!.lat).toBeUndefined();
      expect((await ref.get()).data()!.lng).toBeUndefined();
    } finally {
      await owner2.call('updateBranch', { ...marketBase, branch: { ...branch, lat: original.lat, lng: original.lng } });
    }
  });
});
