import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, asUid, expectCode, makeClient, USERS, type Client } from './harness.js';
import { signInWithCustomToken } from 'firebase/auth';
import { readFileSync } from 'node:fs';

type UserRow = { uid: string; displayName: string; suspended: boolean; suspendedReason?: string };
type InvitationRow = { id: string; email: string; status: string; businessId?: string };

let adminC: Client;
let owner1: Client;

beforeAll(async () => {
  [adminC, owner1] = await Promise.all([asEmail(USERS.admin), asEmail(USERS.owner1)]);
});
afterAll(async () => {
  await Promise.all([adminC, owner1].map((c) => c.close()));
});

const linkParts = (link: string) => {
  const url = new URL(link);
  return { id: url.pathname.split('/').pop()!, token: url.searchParams.get('token')! };
};

describe('admin panel callables', () => {
  it('reinstating a user deletes the suspension reason instead of keeping the old one', async () => {
    await adminC.call('setUserSuspended', { uid: USERS.customer2, suspended: true, reason: 'בדיקה' });
    expect((await admin.db.collection('users').doc(USERS.customer2).get()).data()!.suspendedReason).toBe('בדיקה');
    await adminC.call('setUserSuspended', { uid: USERS.customer2, suspended: false, reason: 'חזר' });
    const u = (await admin.db.collection('users').doc(USERS.customer2).get()).data()!;
    expect(u.suspended).toBe(false);
    expect(u).not.toHaveProperty('suspendedReason');
  });

  it('user lookup: local phone forms, name prefix, and no cursor on a short page', async () => {
    const byPhone = await adminC.call<{ users: UserRow[]; nextCursor?: string }>('adminListUsers', { phone: '050-111-1111' });
    expect(byPhone.users.map((u) => u.uid)).toEqual([USERS.customer1]);
    const byName = await adminC.call<{ users: UserRow[] }>('adminListUsers', { name: 'Rania' });
    expect(byName.users.map((u) => u.displayName)).toEqual(['Rania Saad']);
    const recent = await adminC.call<{ users: UserRow[]; nextCursor?: string }>('adminListUsers', { limit: 50 });
    expect(recent.users.length).toBeLessThan(50);
    expect(recent.nextCursor ?? null).toBeNull();
    const paged = await adminC.call<{ users: UserRow[]; nextCursor?: string }>('adminListUsers', { limit: 2 });
    expect(paged.nextCursor).toBeTruthy();
    expect(await expectCode(owner1.call('adminListUsers', {}))).toBe('forbidden');
  });

  it('owner invitation: the admin gets the link, can renew (old link dies) and revoke; accepting sets the owner', async () => {
    const email = `owner.${Date.now()}@qareeb.test`;
    const inv = await adminC.call<{ invitationId: string; businessId: string; link: string }>('inviteOwner', { email, business: { type: 'restaurant', name: { ar: 'مطعم جديد' }, description: {}, defaultLocale: 'ar' } });
    expect(inv.link).toContain(`/business/invite/${inv.invitationId}?token=`);

    const list = await adminC.call<{ invitations: InvitationRow[] }>('adminListInvitations', {});
    const row = list.invitations.find((i) => i.id === inv.invitationId)!;
    expect(row).toMatchObject({ email, status: 'pending', businessId: inv.businessId });
    expect(row).not.toHaveProperty('tokenHash');

    const renewed = await adminC.call<{ link: string }>('adminInvitationAction', { id: inv.invitationId, action: 'renew' });
    const guest = makeClient();
    expect(await expectCode(guest.call('getInvitation', linkParts(inv.link)))).toBe('not_found');
    expect(await guest.call<{ email: string }>('getInvitation', linkParts(renewed.link))).toMatchObject({ email });

    const user = await admin.auth.createUser({ email, emailVerified: true, password: 'Qareeb-Test-1234' });
    const invitee = makeClient();
    await signInWithCustomToken(invitee.auth, await admin.auth.createCustomToken(user.uid));
    await invitee.call('ensureProfile', {});
    await invitee.call('acceptInvitation', linkParts(renewed.link));
    expect((await admin.db.collection('businesses').doc(inv.businessId).get()).data()!.ownerUid).toBe(user.uid);
    expect(await expectCode(adminC.call('adminInvitationAction', { id: inv.invitationId, action: 'revoke' }))).toBe('invalid_argument');

    const second = await adminC.call<{ invitationId: string; link: string }>('inviteOwner', { email: `x.${Date.now()}@qareeb.test` });
    await adminC.call('adminInvitationAction', { id: second.invitationId, action: 'revoke' });
    expect(await expectCode(guest.call('getInvitation', linkParts(second.link)))).toBe('not_found');
    const audit = await admin.db.collection('audit').where('targetId', '==', second.invitationId).get();
    expect(audit.docs.map((d) => d.data().action)).toEqual(expect.arrayContaining(['owner.invite', 'invitation.revoke']));
    await Promise.all([guest.close(), invitee.close()]);
  });

  it('staff invitations return the link to the owner too', async () => {
    const r = await owner1.call<{ mode: string; link?: string }>('inviteMember', { businessId: 'biz-abu-salim', email: `staff.${Date.now()}@qareeb.test`, role: 'staff', allBranches: true, branchIds: [] });
    expect(r.mode).toBe('invited');
    expect(r.link).toContain('/business/invite/');
  });

  it('overview metrics: every number is present, and each aggregate query has its production index', async () => {
    const m = await adminC.call<{ last30Days: Record<string, number | null>; pendingBusinessApprovals: number | null; pendingBranchApprovals: number | null; agingPlacedOrders: number | null; totalUsers: number | null; approvedBusinesses: number | null }>('getAdminMetrics', {});
    for (const v of [...Object.values(m.last30Days), m.pendingBusinessApprovals, m.pendingBranchApprovals, m.agingPlacedOrders, m.totalUsers, m.approvedBusinesses]) expect(typeof v).toBe('number');
    // The emulator never asks for indexes; production failed the whole overview without these.
    const { indexes } = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }> };
    const has = (group: string, scope: string, fields: string[]) => indexes.some((i) => i.collectionGroup === group && i.queryScope === scope && i.fields.map((f) => `${f.fieldPath}:${f.order}`).join(',') === fields.join(','));
    expect(has('orders', 'COLLECTION', ['placedAt:ASCENDING', 'totals.cashDueAgorot:ASCENDING'])).toBe(true);
    expect(has('orders', 'COLLECTION', ['status:ASCENDING', 'placedAt:ASCENDING', 'totals.cashDueAgorot:ASCENDING'])).toBe(true);
    expect(has('cashRecords', 'COLLECTION', ['reversed:ASCENDING', 'recordedAt:ASCENDING', 'amountAgorot:ASCENDING'])).toBe(true);
    expect(has('branches', 'COLLECTION_GROUP', ['approval:ASCENDING', 'createdAt:DESCENDING'])).toBe(true);
  });

  it('non-admins cannot list or act on invitations', async () => {
    const customer = await asUid(USERS.customer1);
    expect(await expectCode(customer.call('adminListInvitations', {}))).toBe('forbidden');
    expect(await expectCode(owner1.call('adminInvitationAction', { id: 'x', action: 'revoke' }))).toBe('forbidden');
    await customer.close();
  });
});
