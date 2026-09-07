import { beforeAll, afterAll, describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

let env: RulesTestEnvironment;
const PROJECT = 'qareeb-rules-test';

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/cust1'), { uid: 'cust1', suspended: false, isAdmin: false });
    await setDoc(doc(db, 'users/cust2'), { uid: 'cust2', suspended: false, isAdmin: false });
    await setDoc(doc(db, 'users/susp'), { uid: 'susp', suspended: true, isAdmin: false });
    await setDoc(doc(db, 'users/owner1'), { uid: 'owner1', suspended: false, isAdmin: false });
    await setDoc(doc(db, 'users/owner2'), { uid: 'owner2', suspended: false, isAdmin: false });
    await setDoc(doc(db, 'users/staffB'), { uid: 'staffB', suspended: false, isAdmin: false });
    await setDoc(doc(db, 'users/admin'), { uid: 'admin', suspended: false, isAdmin: true });
    await setDoc(doc(db, 'memberships/owner1_biz1'), { uid: 'owner1', businessId: 'biz1', role: 'owner', allBranches: true, branchIds: [], active: true });
    await setDoc(doc(db, 'memberships/owner2_biz2'), { uid: 'owner2', businessId: 'biz2', role: 'owner', allBranches: true, branchIds: [], active: true });
    await setDoc(doc(db, 'memberships/staffB_biz1'), { uid: 'staffB', businessId: 'biz1', role: 'staff', allBranches: false, branchIds: ['brB'], active: true });
    await setDoc(doc(db, 'businesses/biz1'), { id: 'biz1', approval: 'pending', ownerUid: 'owner1' });
    await setDoc(doc(db, 'businesses/biz2'), { id: 'biz2', approval: 'approved', ownerUid: 'owner2' });
    await setDoc(doc(db, 'businesses/biz1/branches/brA'), { id: 'brA' });
    await setDoc(doc(db, 'businesses/biz1/branches/brB'), { id: 'brB' });
    await setDoc(doc(db, 'publicBusinesses/biz2'), { id: 'biz2' });
    await setDoc(doc(db, 'users/cust1/addresses/a1'), { houseDescription: 'blue gate' });
    await setDoc(doc(db, 'orders/o1'), { id: 'o1', businessId: 'biz1', branchId: 'brA', customer: { uid: 'cust1' }, status: 'placed', totals: { cashDueAgorot: 100 } });
    await setDoc(doc(db, 'orders/o2'), { id: 'o2', businessId: 'biz1', branchId: 'brB', customer: { uid: 'cust2' }, status: 'placed', totals: { cashDueAgorot: 100 } });
    await setDoc(doc(db, 'cashRecords/c1'), { businessId: 'biz1', branchId: 'brB', amountAgorot: 100 });
    await setDoc(doc(db, 'loyaltyAccounts/biz1_cust1'), { businessId: 'biz1', uid: 'cust1', available: 5 });
    await setDoc(doc(db, 'users/cust1/notifications/n1'), { read: false, title: 'x' });
    await setDoc(doc(db, 'audit/a1'), { action: 'x' });
  });
});
afterAll(async () => env.cleanup());

const as = (uid: string, claims: Record<string, unknown> = {}) => env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('public projections', () => {
  it('anyone reads public projections and cities; nobody writes them', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'publicBusinesses/biz2')));
    await assertFails(setDoc(doc(anon(), 'publicBusinesses/biz1'), { id: 'biz1' }));
    await assertFails(setDoc(doc(as('owner1'), 'publicBusinesses/biz1'), { id: 'biz1' }));
  });
  it('unapproved private business data is not readable by the public', async () => {
    await assertFails(getDoc(doc(anon(), 'businesses/biz1')));
    await assertFails(getDoc(doc(as('cust1'), 'businesses/biz1')));
  });
});

describe('customers', () => {
  it('cannot read other customers\' addresses or orders; can read their own', async () => {
    await assertSucceeds(getDoc(doc(as('cust1'), 'users/cust1/addresses/a1')));
    await assertFails(getDoc(doc(as('cust2'), 'users/cust1/addresses/a1')));
    await assertSucceeds(getDoc(doc(as('cust1'), 'orders/o1')));
    await assertFails(getDoc(doc(as('cust2'), 'orders/o1')));
    await assertFails(getDocs(query(collection(as('cust2'), 'orders'), where('customer.uid', '==', 'cust1'))));
  });
  it('cannot write orders, roles, verified phone, totals or loyalty balances', async () => {
    await assertFails(updateDoc(doc(as('cust1'), 'orders/o1'), { status: 'accepted' }));
    await assertFails(updateDoc(doc(as('cust1'), 'orders/o1'), { 'totals.cashDueAgorot': 1 }));
    await assertFails(updateDoc(doc(as('cust1'), 'users/cust1'), { isAdmin: true }));
    await assertFails(updateDoc(doc(as('cust1'), 'users/cust1'), { phoneVerified: true }));
    await assertFails(updateDoc(doc(as('cust1'), 'loyaltyAccounts/biz1_cust1'), { available: 9999 }));
    await assertFails(setDoc(doc(as('cust1'), 'memberships/cust1_biz1'), { uid: 'cust1', businessId: 'biz1', role: 'owner', active: true }));
    await assertFails(setDoc(doc(as('cust1'), 'users/cust1/addresses/a2'), { houseDescription: 'x' }));
  });
  it('can manage favourites, device tokens and mark notifications read (only the read flag)', async () => {
    await assertSucceeds(setDoc(doc(as('cust1'), 'users/cust1/favorites/biz2'), { id: 'biz2', kind: 'business', businessId: 'biz2', createdAt: 'now' }));
    await assertFails(setDoc(doc(as('cust1'), 'users/cust1/favorites/x'), { id: 'x', kind: 'weird', businessId: 'biz2', createdAt: 'now' }));
    await assertSucceeds(deleteDoc(doc(as('cust1'), 'users/cust1/favorites/biz2')));
    await assertSucceeds(setDoc(doc(as('cust1'), 'users/cust1/deviceTokens/tok'), { token: 'tok', uid: 'cust1', platform: 'web', locale: 'he', createdAt: 'n', lastSeenAt: 'n', invalid: false }));
    await assertFails(setDoc(doc(as('cust1'), 'users/cust1/deviceTokens/tok2'), { token: 'tok2', uid: 'cust2', platform: 'web', locale: 'he', createdAt: 'n', lastSeenAt: 'n', invalid: false }));
    await assertSucceeds(updateDoc(doc(as('cust1'), 'users/cust1/notifications/n1'), { read: true }));
    await assertFails(updateDoc(doc(as('cust1'), 'users/cust1/notifications/n1'), { title: 'hacked' }));
  });
  it('suspended users lose access even with a valid token', async () => {
    await assertFails(getDoc(doc(as('susp'), 'users/susp/addresses/x')));
    await assertFails(setDoc(doc(as('susp'), 'users/susp/favorites/biz2'), { id: 'biz2', kind: 'business', businessId: 'biz2', createdAt: 'now' }));
  });
});

describe('businesses and staff', () => {
  it('owner reads own business, branches and orders; not another business', async () => {
    await assertSucceeds(getDoc(doc(as('owner1'), 'businesses/biz1')));
    await assertSucceeds(getDoc(doc(as('owner1'), 'businesses/biz1/branches/brA')));
    await assertSucceeds(getDoc(doc(as('owner1'), 'orders/o1')));
    await assertFails(getDoc(doc(as('owner1'), 'businesses/biz2')));
    await assertFails(getDoc(doc(as('owner2'), 'orders/o1')));
    await assertFails(updateDoc(doc(as('owner1'), 'businesses/biz1'), { approval: 'approved' }));
  });
  it('staff limited to branch B cannot read branch A orders/branch docs, nor financials', async () => {
    await assertSucceeds(getDoc(doc(as('staffB'), 'orders/o2')));
    await assertFails(getDoc(doc(as('staffB'), 'orders/o1')));
    await assertFails(getDoc(doc(as('staffB'), 'businesses/biz1/branches/brA')));
    await assertSucceeds(getDoc(doc(as('staffB'), 'businesses/biz1/branches/brB')));
    await assertFails(getDoc(doc(as('staffB'), 'cashRecords/c1')));
    await assertSucceeds(getDoc(doc(as('owner1'), 'cashRecords/c1')));
    await assertFails(updateDoc(doc(as('staffB'), 'memberships/staffB_biz1'), { role: 'owner' }));
  });
  it('admin claim alone is not enough for admin-only data unless token carries admin', async () => {
    await assertFails(getDoc(doc(as('owner1'), 'audit/a1')));
    await assertSucceeds(getDoc(doc(as('admin', { admin: true }), 'audit/a1')));
    await assertSucceeds(getDoc(doc(as('admin', { admin: true }), 'orders/o1')));
  });
  it('server-only collections are closed to everyone', async () => {
    for (const p of ['outbox/x', 'idempotency/x', 'otpChallenges/x', 'rateLimits/x', 'orderRefs/x', 'invitations/x']) {
      await assertFails(getDoc(doc(as('admin', { admin: true }), p)));
      await assertFails(setDoc(doc(as('owner1'), p), { a: 1 }));
    }
  });
});
