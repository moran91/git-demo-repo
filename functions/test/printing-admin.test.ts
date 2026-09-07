import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asUid, deliveryBase, expectCode, IDS, key, shawarmaLine, USERS, waitFor, type Client } from './harness.js';

let customer1: Client;
let owner1: Client;
let manager: Client;
let staff: Client;
let adminC: Client;
let ownerPending: Client;

beforeAll(async () => {
  [customer1, owner1, manager, staff, adminC, ownerPending] = await Promise.all([asUid(USERS.customer1), asEmail(USERS.owner1), asEmail(USERS.manager), asEmail(USERS.staff), asEmail(USERS.admin), asEmail(USERS.ownerPending)]);
});
afterAll(async () => {
  await Promise.all([customer1, owner1, manager, staff, adminC, ownerPending].map((c) => c.close()));
});

const printerInput = { name: 'Kitchen 58mm', profileId: 'generic_escpos_ble_ff00', transport: 'web_bluetooth_ble', paperWidthMm: 58, printableDots: 384, receiptLocale: 'ar', copies: 1, role: 'kitchen', autoPrint: 'off', cutSupported: false, feedLinesAfter: 3 };

describe('printer setup and print jobs', () => {
  let printerId: string;
  it('staff cannot configure printers; manager can; auto-print requires a verified test print', async () => {
    expect(await expectCode(staff.call('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchB, printer: printerInput }))).toBe('forbidden');
    expect(await expectCode(manager.call('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchB, printer: printerInput }))).toBe('forbidden'); // manager limited to branch A
    expect(await expectCode(manager.call('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchA, printer: { ...printerInput, autoPrint: 'when_placed' } }))).toBe('printer_setup_required');
    const res = await manager.call<{ printer: { id: string; setupVerified: boolean } }>('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchA, printer: printerInput });
    printerId = res.printer.id;
    expect(res.printer.setupVerified).toBe(false);
    expect(await expectCode(manager.call('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchA, printer: { ...printerInput, profileId: 'nope' } }))).toBe('invalid_argument');
    expect(await expectCode(manager.call('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchA, printer: { ...printerInput, transport: 'android_rfcomm' } }))).toBe('invalid_argument');
  });

  it('test print job carries a multilingual receipt model; station registration is exclusive; claim/report with fences', async () => {
    const test = await manager.call<{ jobId: string }>('enqueuePrint', { printerId, template: 'test', idempotencyKey: key() });
    const job = (await admin.db.collection('printJobs').doc(test.jobId).get()).data()!;
    expect(job.state).toBe('queued');
    expect(job.receipt.version).toBe(1);
    const text = JSON.stringify(job.receipt.blocks);
    expect(text).toContain('عبري');
    expect(text).toContain('עברית');
    expect(text).toContain('Hebrew');
    expect(text).toContain('₪');
    // Station A (manager's phone) registers; station B (owner tablet) conflicts unless it takes over.
    const st1 = await manager.call<{ station: { id: string } }>('registerStation', { printerId, kind: 'web', label: 'Manager phone' });
    expect(await expectCode(owner1.call('registerStation', { printerId, kind: 'web', label: 'Owner tablet' }))).toBe('invalid_argument');
    const claim = await manager.call<{ job: { id: string; state: string } | null; fence: number; attemptId: string; printer: { printableDots: number } }>('claimPrintJob', { stationId: st1.station.id });
    expect(claim.job?.id).toBe(test.jobId);
    expect(claim.job?.state).toBe('sending');
    expect(claim.fence).toBe(1);
    expect(claim.printer.printableDots).toBe(384);
    // Nothing else to claim now.
    const none = await manager.call<{ job: null }>('claimPrintJob', { stationId: st1.station.id });
    expect(none.job).toBeNull();
    // Owner takes over as station; manager's stale fence can no longer report after a re-claim.
    const st2 = await owner1.call<{ station: { id: string } }>('registerStation', { printerId, kind: 'android', label: 'Owner tablet', takeOver: true });
    expect(await expectCode(owner1.call('reportPrintAttempt', { stationId: st2.station.id, jobId: test.jobId, fence: 1, outcome: 'sent' }))).toBe('version_conflict');
    // Manager station reports partial transmission → needs_review (never silently retransmitted), staff notified.
    const rep = await manager.call<{ state: string }>('reportPrintAttempt', { stationId: st1.station.id, jobId: test.jobId, fence: 1, attemptId: claim.attemptId, outcome: 'partial', stripsSent: 2, stripsTotal: 5, error: 'GATT disconnected' });
    expect(rep.state).toBe('needs_review');
    const attempts = await admin.db.collection('printJobs').doc(test.jobId).collection('attempts').get();
    expect(attempts.size).toBe(1);
    expect(attempts.docs[0]!.data().outcome).toBe('partial');
    await waitFor(async () => (await admin.db.collection('users').doc('seed-owner1').collection('notifications').where('kind', '==', 'print_needs_review').get()).docs[0]);
    // Staff resolve: confirm on paper.
    await manager.call('resolvePrintJob', { jobId: test.jobId, resolution: 'confirmed' });
    expect((await admin.db.collection('printJobs').doc(test.jobId).get()).data()!.state).toBe('confirmed');
    // Verify setup, then enable automatic printing when placed.
    await manager.call('markPrinterVerified', { printerId, verified: true });
    await manager.call('savePrinter', { businessId: IDS.restaurant, branchId: IDS.branchA, printerId, printer: { ...printerInput, autoPrint: 'when_placed' } });
  });

  it('a placed order creates exactly one automatic job (deterministic key), placement is not acceptance; manual duplicates need reprint; revised copies are labelled', async () => {
    const { orderId } = await customer1.call<{ orderId: string }>('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    const jobs = await admin.db.collection('printJobs').where('orderId', '==', orderId).get();
    expect(jobs.size).toBe(1);
    const auto = jobs.docs[0]!.data();
    expect(auto.trigger).toBe('auto_placed');
    expect(auto.key).toBe(`${orderId}:0:auto_placed:kitchen:order_ticket:0`);
    expect(JSON.stringify(auto.receipt.blocks)).toContain('بانتظار القبول');
    expect((await admin.db.collection('orders').doc(orderId).get()).data()!.status).toBe('placed');
    // Manual first copy for the same role/revision is a duplicate unless reprint is explicit.
    expect(await expectCode(manager.call('enqueuePrint', { printerId, orderId, template: 'order_ticket', idempotencyKey: key() }))).toBe('duplicate_copy');
    const re = await manager.call<{ jobId: string }>('enqueuePrint', { printerId, orderId, template: 'order_ticket', reprint: true, reprintReason: 'paper jam', idempotencyKey: key() });
    const reJob = (await admin.db.collection('printJobs').doc(re.jobId).get()).data()!;
    expect(reJob.isReprint).toBe(true);
    expect(reJob.receipt.labels.copy).toBe(true);
    // Staff (branch B) cannot print branch A orders.
    expect(await expectCode(staff.call('enqueuePrint', { printerId, orderId, template: 'customer_copy', idempotencyKey: key() }))).toBe('forbidden');
    // Customer copy is a different template → allowed as a first copy.
    await manager.call('enqueuePrint', { printerId, orderId, template: 'customer_copy', idempotencyKey: key() });
    // Accept, revise, then a revised reprint gets the REVISED label.
    await manager.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    await manager.call('reviseOrder', { orderId, expectedVersion: 2, idempotencyKey: key(), reason: 'one less, agreed', phoneAgreement: true, changes: [{ lineId: 'l1', action: 'set_quantity', quantity: 1 }] });
    const rev = await manager.call<{ jobId: string }>('enqueuePrint', { printerId, orderId, template: 'order_ticket', idempotencyKey: key() });
    const revJob = (await admin.db.collection('printJobs').doc(rev.jobId).get()).data()!;
    expect(revJob.orderRevision).toBe(1);
    expect(revJob.receipt.labels.revised).toBe(true);
    expect(JSON.stringify(revJob.receipt.blocks)).toContain('معدّل');
    const printed = await admin.db.collection('orders').doc(orderId).collection('events').where('type', '==', 'printed').get();
    expect(printed.size).toBe(3);
  });
});

describe('approvals, suspension, memberships', () => {
  it('pending business is hidden; admin approval publishes it; rejection hides it again', async () => {
    expect((await admin.db.collection('publicBusinesses').doc(IDS.pending).get()).exists).toBe(false);
    expect(await expectCode(ownerPending.call('decideApproval', { targetType: 'business', businessId: IDS.pending, state: 'approved', reason: 'self' }))).toBe('forbidden');
    await adminC.call('decideApproval', { targetType: 'business', businessId: IDS.pending, state: 'approved', reason: 'Documents verified' });
    expect((await admin.db.collection('publicBusinesses').doc(IDS.pending).get()).exists).toBe(false); // branch still pending
    await adminC.call('decideApproval', { targetType: 'branch', businessId: IDS.pending, branchId: IDS.pendingBranch, state: 'approved', reason: 'Visited the shop' });
    expect((await admin.db.collection('publicBusinesses').doc(IDS.pending).get()).exists).toBe(true);
    const pubBranch = (await admin.db.collection('publicBranches').doc(IDS.pendingBranch).get()).data()!;
    expect(pubBranch.visible).toBe(true);
    expect((await admin.db.collection('publicBranches').doc(IDS.pendingBranch).collection('products').doc('p-manaqish').get()).exists).toBe(true);
    await adminC.call('decideApproval', { targetType: 'business', businessId: IDS.pending, state: 'suspended', reason: 'Complaint under review' });
    expect((await admin.db.collection('publicBusinesses').doc(IDS.pending).get()).exists).toBe(false);
    expect((await admin.db.collection('publicBranches').doc(IDS.pendingBranch).get()).exists).toBe(false);
    expect(await expectCode(customer1.call('quoteOrder', { businessId: IDS.pending, branchId: IDS.pendingBranch, mode: 'pickup', cityId: 'beit-jann', lines: [{ lineId: 'x', productId: 'p-manaqish', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 900 }] }))).toBe('business_not_approved');
    const history = await admin.db.collection('businesses').doc(IDS.pending).collection('approvalHistory').get();
    expect(history.size).toBeGreaterThanOrEqual(4);
    const audit = await admin.db.collection('audit').where('targetType', '==', 'business').get();
    expect(audit.docs.some((d) => d.data().reason === 'Complaint under review')).toBe(true);
  });

  it('owner self-registers a business (pending), prepares a branch and catalog hidden from the public', async () => {
    const biz = await owner1.call<{ business: { id: string; approval: string } }>('createBusiness', { type: 'supermarket', name: { he: 'חנות חדשה' }, description: {}, defaultLocale: 'he' });
    expect(biz.business.approval).toBe('pending');
    const br = await owner1.call<{ branch: { id: string; approval: string } }>('createBranch', { businessId: biz.business.id, branch: { name: { he: 'ראשי' }, cityId: 'beit-jann', locationDescription: {}, phone: '0501234567', hours: { '0': [{ startMin: 0, endMin: 1440 }], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] }, hoursOverrides: [], pickupEnabled: true, deliveryEnabled: false, deliveryCities: [] } });
    expect(br.branch.approval).toBe('pending');
    const cat = await owner1.call<{ category: { id: string } }>('saveCategory', { businessId: biz.business.id, branchId: br.branch.id, category: { name: { he: 'כללי' } } });
    expect(await expectCode(owner1.call('saveProduct', { businessId: biz.business.id, branchId: br.branch.id, product: { categoryId: cat.category.id, name: {}, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 100, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false } }))).toBe('invalid_argument');
    await owner1.call('saveProduct', { businessId: biz.business.id, branchId: br.branch.id, product: { categoryId: cat.category.id, name: { he: 'מוצר' }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 100, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false } });
    expect((await admin.db.collection('publicBranches').doc(br.branch.id).get()).exists).toBe(false);
    // Another owner cannot touch it.
    expect(await expectCode(ownerPending.call('saveCategory', { businessId: biz.business.id, branchId: br.branch.id, category: { name: { he: 'x' } } }))).toBe('forbidden');
  });

  it('owner grants and revokes staff access; revoked staff is blocked promptly; user suspension blocks calls', async () => {
    // Grant staff (branch B) access to branch A too, then remove.
    await owner1.call('updateMembership', { businessId: IDS.restaurant, uid: 'seed-staff', allBranches: false, branchIds: [IDS.branchA, IDS.branchB] });
    const { orderId } = await customer1.call<{ orderId: string }>('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    const dec = await staff.call<{ status: string }>('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    expect(dec.status).toBe('accepted');
    await owner1.call('updateMembership', { businessId: IDS.restaurant, uid: 'seed-staff', active: false });
    expect(await expectCode(staff.call('enqueuePrint', { printerId: 'any', orderId, template: 'order_ticket', idempotencyKey: key() }))).toMatch(/forbidden|not_found/);
    const { orderId: o2 } = await customer1.call<{ orderId: string }>('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    expect(await expectCode(staff.call('decideOrder', { orderId: o2, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() }))).toBe('forbidden');
    // Staff cannot grant roles; manager cannot change memberships.
    expect(await expectCode(manager.call('updateMembership', { businessId: IDS.restaurant, uid: 'seed-staff', active: true }))).toBe('forbidden');
    // Suspend customer → next call refused; unsuspend → works again.
    await adminC.call('setUserSuspended', { uid: 'seed-customer1', suspended: true, reason: 'abuse report' });
    expect(await expectCode(customer1.call('placeOrder', { ...deliveryBase, lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 }))).toBe('suspended');
    await adminC.call('setUserSuspended', { uid: 'seed-customer1', suspended: false, reason: 'resolved' });
    // Nobody can grant admin through callables; ensureProfile ignores client claims.
    await customer1.call('ensureProfile', { isAdmin: true }).catch(() => undefined);
    expect((await admin.db.collection('users').doc('seed-customer1').get()).data()!.isAdmin).toBe(false);
    expect(await expectCode(owner1.call('setUserSuspended', { uid: 'seed-customer2', suspended: true, reason: 'x' }))).toBe('forbidden');
  });

  it('admin metrics distinguish placed, accepted and cash-recorded values', async () => {
    const m = await adminC.call<{ last30Days: { placedCount: number; placedValueAgorot: number; acceptedValueAgorot: number; cashRecordedAgorot: number }; agingPlacedOrders: number }>('getAdminMetrics', {});
    expect(m.last30Days.placedCount).toBeGreaterThan(3);
    expect(m.last30Days.placedValueAgorot).toBeGreaterThan(m.last30Days.acceptedValueAgorot);
    expect(m.last30Days.acceptedValueAgorot).toBeGreaterThan(0);
    expect(m.last30Days.cashRecordedAgorot).toBeGreaterThanOrEqual(0);
    expect(await expectCode(owner1.call('getAdminMetrics', {}))).toBe('forbidden');
  });
});
