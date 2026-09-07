import type { CallableRequest } from 'firebase-functions/v2/https';
import type { Membership, MembershipRole, UserProfile } from '@qareeb/shared';
import { col, db, type Tx } from './firebase.js';
import { fail } from './errors.js';

export interface Caller {
  uid: string;
  token: CallableRequest['auth'] extends infer A ? (A extends { token: infer T } ? T : never) : never;
  profile: UserProfile;
  isAdmin: boolean;
}

/**
 * Every server operation independently verifies: authenticated, user document exists, not suspended.
 * Custom claims are treated as hints only; the user document is the source of truth for suspension.
 */
export async function requireCaller(req: CallableRequest<unknown>, tx?: Tx): Promise<Caller> {
  if (!req.auth) fail('unauthenticated');
  const ref = col.user(req.auth.uid);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) fail('not_found', { entity: 'user' });
  const profile = snap.data() as UserProfile;
  if (profile.suspended) fail('suspended');
  const isAdmin = profile.isAdmin === true && req.auth.token.admin === true;
  return { uid: req.auth.uid, token: req.auth.token as Caller['token'], profile, isAdmin };
}

export function requireAdmin(c: Caller): void {
  if (!c.isAdmin) fail('forbidden', { reason: 'admin_required' });
}

export function requireVerifiedPhone(c: Caller): void {
  if (!c.profile.phoneVerified || !c.profile.phone) fail('phone_not_verified');
}

export function requireVerifiedEmail(c: Caller): void {
  if (!c.token.email || c.token.email_verified !== true) fail('forbidden', { reason: 'email_not_verified' });
}

export async function getMembership(uid: string, businessId: string, tx?: Tx): Promise<Membership | null> {
  const ref = col.membership(uid, businessId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) return null;
  const m = snap.data() as Membership;
  return m.active ? m : null;
}

export function membershipCoversBranch(m: Membership, branchId: string): boolean {
  return m.allBranches || m.branchIds.includes(branchId);
}

/**
 * Ensures the caller is an active member of the business with one of the allowed roles and, when a
 * branch is given, that their assignment covers it. Platform admins pass with role 'admin'.
 */
export async function requireMembership(
  c: Caller,
  businessId: string,
  roles: MembershipRole[],
  branchId?: string,
  tx?: Tx,
): Promise<{ role: MembershipRole | 'admin'; membership: Membership | null }> {
  if (c.isAdmin) return { role: 'admin', membership: null };
  const m = await getMembership(c.uid, businessId, tx);
  if (!m || !roles.includes(m.role)) fail('forbidden', { reason: 'membership' });
  if (branchId && !membershipCoversBranch(m, branchId)) fail('forbidden', { reason: 'branch' });
  return { role: m.role, membership: m };
}

export async function listMemberships(uid: string): Promise<Membership[]> {
  const q = await col.memberships().where('uid', '==', uid).where('active', '==', true).limit(50).get();
  return q.docs.map((d) => d.data() as Membership);
}

export { db };
