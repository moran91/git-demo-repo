import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asUid, deliveryBase, expectCode, IDS, key, shawarmaLine, USERS, type Client } from './harness.js';

let adminC: Client;
let owner1: Client;
let owner2: Client;
let customer2: Client;
let adminUid: string;
let owner1Uid: string;

beforeAll(async () => {
  [adminC, owner1, owner2, customer2] = await Promise.all([asEmail(USERS.admin), asEmail(USERS.owner1), asEmail(USERS.owner2), asUid(USERS.customer2)]);
  adminUid = (await admin.auth.getUserByEmail(USERS.admin)).uid;
  owner1Uid = (await admin.auth.getUserByEmail(USERS.owner1)).uid;
});
afterAll(async () => {
  await Promise.all([adminC, owner1, owner2, customer2].map((c) => c.close()));
});

const base = { businessId: IDS.restaurant, branchId: IDS.branchA };

async function rowsSince(since: string, filter: (row: FirebaseFirestore.DocumentData) => boolean) {
  const q = await admin.db.collection('audit').where('at', '>=', since).get();
  return q.docs.map((d) => d.data()).filter(filter);
}

describe('platform admin acting inside a business', () => {
  it('runs business callables without a membership; each success writes one admin audit row', async () => {
    const since = new Date().toISOString();
    await adminC.call('saveCategory', { ...base, category: { name: { he: 'בדיקת מנהל' } } });
    await adminC.call('setOrdersPaused', { ...base, paused: true });
    await adminC.call('setOrdersPaused', { ...base, paused: false });
    const cat = await rowsSince(since, (r) => r.action === 'admin.saveCategory');
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({ actorUid: adminUid, targetType: 'business', targetId: IDS.restaurant, after: { branchId: IDS.branchA, ids: { businessId: IDS.restaurant, branchId: IDS.branchA } } });
    expect(cat[0]!.after.fields).toEqual(['businessId', 'branchId', 'category']);
    expect(JSON.stringify(cat[0]!.after)).not.toContain('בדיקת מנהל');
    expect(await rowsSince(since, (r) => r.action === 'admin.setOrdersPaused')).toHaveLength(2);
  });

  it('writes no admin row when the admin call fails', async () => {
    const since = new Date().toISOString();
    expect(await expectCode(adminC.call('saveCategory', { ...base, category: { name: {} } }))).toBe('invalid_argument');
    expect(await rowsSince(since, (r) => String(r.action).startsWith('admin.'))).toHaveLength(0);
  });

  it('writes no admin row for members, skips read-only listMembers, and still refuses non-members', async () => {
    const since = new Date().toISOString();
    await owner1.call('saveCategory', { ...base, category: { name: { he: 'בדיקת בעלים' } } });
    await adminC.call('listMembers', { businessId: IDS.restaurant });
    expect(await expectCode(owner2.call('saveCategory', { ...base, category: { name: { he: 'x' } } }))).toBe('forbidden');
    const adminRows = await rowsSince(since, (r) => String(r.action).startsWith('admin.'));
    expect(adminRows.filter((r) => r.actorUid === owner1Uid)).toHaveLength(0);
    expect(adminRows.filter((r) => r.action === 'admin.listMembers')).toHaveLength(0);
  });

  it('admin accepts an order and records cash; events carry actorRole admin and both actions are audited', async () => {
    const since = new Date().toISOString();
    const { orderId } = await customer2.call<{ orderId: string }>('placeOrder', { ...deliveryBase, addressId: 'addr-parents', lines: [shawarmaLine()], idempotencyKey: key(), expectedCashDueAgorot: 9600 });
    await adminC.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    const order = (await admin.db.collection('orders').doc(orderId).get()).data()!;
    await adminC.call('recordCash', { orderId, amountAgorot: order.totals.cashDueAgorot, expectedVersion: order.version, idempotencyKey: key() });
    const events = (await admin.db.collection('orders').doc(orderId).collection('events').get()).docs.map((d) => d.data());
    expect(events.find((e) => e.type === 'cash_recorded')!.actorRole).toBe('admin');
    const actions = (await rowsSince(since, (r) => r.targetId === IDS.restaurant)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.decideOrder', 'admin.recordCash']));
  });

  it('an admin who is also a member of the business acts as that member: no admin audit row', async () => {
    const since = new Date().toISOString();
    const ref = admin.db.collection('memberships').doc(`${adminUid}_${IDS.market}`);
    await ref.set({ id: ref.id, uid: adminUid, businessId: IDS.market, role: 'owner', allBranches: true, branchIds: [], active: true });
    try {
      await adminC.call('saveCategory', { businessId: IDS.market, branchId: IDS.marketBranch, category: { name: { he: 'מנהל שהוא בעלים' } } });
      expect(await rowsSince(since, (r) => String(r.action).startsWith('admin.') && r.targetId === IDS.market)).toHaveLength(0);
    } finally {
      await ref.delete();
    }
  });
});
