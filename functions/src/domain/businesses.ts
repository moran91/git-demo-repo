import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_LOYALTY_RULES,
  branchInputSchema,
  businessInputSchema,
  cleanLocalized,
  idSchema,
  loyaltyRulesInputSchema,
  membershipInputSchema,
  normalizeIsraeliPhone,
  type Branch,
  type Business,
  type Membership,
} from '@qareeb/shared';
import { APP_ORIGIN, REGION, auth, col, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller, requireMembership, requireVerifiedEmail } from '../lib/auth.js';
import { projectBranchInTx, reprojectBusiness } from '../lib/projections.js';
import { writeAudit } from '../lib/audit.js';
import { enqueueEvent } from '../lib/outbox.js';

const opts = { region: REGION } as const;

/** Owners self-register: requires a verified email account. Business starts as `pending`. */
export const createBusiness = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireVerifiedEmail(c);
  const input = parse(businessInputSchema, req.data);
  const existing = await col.memberships().where('uid', '==', c.uid).where('role', '==', 'owner').limit(20).get();
  if (existing.size >= 10) fail('invalid_argument', { issues: [{ path: 'business', message: 'too_many_businesses' }] });
  const ref = col.businesses().doc();
  const now = nowIso();
  const business: Business = {
    id: ref.id,
    type: input.type,
    name: cleanLocalized(input.name),
    description: cleanLocalized(input.description),
    defaultLocale: input.defaultLocale,
    ownerUid: c.uid,
    publicPhone: input.publicPhone ? normalizeIsraeliPhone(input.publicPhone) ?? input.publicPhone : undefined,
    publicEmail: input.publicEmail,
    approval: 'pending',
    loyalty: { ...DEFAULT_LOYALTY_RULES },
    createdAt: now,
    updatedAt: now,
  };
  const membership: Membership = { id: `${c.uid}_${ref.id}`, uid: c.uid, businessId: ref.id, role: 'owner', allBranches: true, branchIds: [], active: true, createdAt: now, updatedAt: now };
  await db.runTransaction(async (tx) => {
    tx.set(ref, business);
    tx.set(col.membership(c.uid, ref.id), membership);
    tx.set(col.approvalHistory(ref.id).doc(), { targetType: 'business', state: 'pending', reason: 'created', actorUid: c.uid, at: now });
  });
  return { business };
}));

export const updateBusiness = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, business: businessInputSchema.partial() }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner']);
  await db.runTransaction(async (tx) => {
    const ref = col.business(input.businessId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const patch: Partial<Business> = { updatedAt: nowIso() };
    if (input.business.name) patch.name = cleanLocalized(input.business.name);
    if (input.business.description) patch.description = cleanLocalized(input.business.description);
    if (input.business.defaultLocale) patch.defaultLocale = input.business.defaultLocale;
    if (input.business.type) patch.type = input.business.type;
    if (input.business.publicPhone !== undefined) patch.publicPhone = input.business.publicPhone ? normalizeIsraeliPhone(input.business.publicPhone) ?? input.business.publicPhone : undefined;
    if (input.business.publicEmail !== undefined) patch.publicEmail = input.business.publicEmail;
    tx.set(ref, patch, { merge: true });
  });
  await reprojectBusiness(input.businessId);
  return { ok: true };
}));

/** Sets the logo/cover path after the client uploaded to the tenant-scoped Storage path. */
export const setBusinessImage = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, kind: z.enum(['logo', 'cover']), path: z.string().max(400).nullable() }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner', 'manager']);
  if (input.path && !input.path.startsWith(`businesses/${input.businessId}/`)) fail('invalid_argument', { issues: [{ path: 'path', message: 'wrong_tenant_path' }] });
  await col.business(input.businessId).set({ [input.kind === 'logo' ? 'logoPath' : 'coverPath']: input.path ?? null, updatedAt: nowIso() }, { merge: true });
  await reprojectBusiness(input.businessId);
  return { ok: true };
}));

export const setLoyaltyRules = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, rules: loyaltyRulesInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner']);
  await db.runTransaction(async (tx) => {
    const ref = col.business(input.businessId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const b = snap.data() as Business;
    const before = b.loyalty;
    const after = { ...input.rules, version: before.version + 1 };
    tx.set(ref, { loyalty: after, updatedAt: nowIso() }, { merge: true });
    writeAudit(tx, { actorUid: c.uid, action: 'loyalty.rules.update', targetType: 'business', targetId: input.businessId, before, after });
  });
  await reprojectBusiness(input.businessId);
  return { ok: true };
}));

function normaliseBranchInput(input: z.infer<typeof branchInputSchema>) {
  const phone = normalizeIsraeliPhone(input.phone);
  if (!phone) fail('invalid_argument', { issues: [{ path: 'phone', message: 'invalid_phone' }] });
  const seen = new Set<string>();
  for (const d of input.deliveryCities) {
    if (seen.has(d.cityId)) fail('invalid_argument', { issues: [{ path: 'deliveryCities', message: 'duplicate_city' }] });
    seen.add(d.cityId);
  }
  return { ...input, phone, name: cleanLocalized(input.name), locationDescription: cleanLocalized(input.locationDescription) };
}

export const createBranch = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branch: branchInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner']);
  const data = normaliseBranchInput(input.branch);
  const cityIds = [data.cityId, ...data.deliveryCities.map((d) => d.cityId)];
  const cities = await Promise.all(cityIds.map((id) => col.city(id).get()));
  if (cities.some((s) => !s.exists)) fail('invalid_argument', { issues: [{ path: 'cityId', message: 'unknown_city' }] });
  const ref = col.branches(input.businessId).doc();
  const now = nowIso();
  const branch: Branch = { id: ref.id, businessId: input.businessId, ...data, ordersPaused: false, approval: 'pending', createdAt: now, updatedAt: now };
  await db.runTransaction(async (tx) => {
    const count = await tx.get(col.branches(input.businessId));
    if (count.size >= 30) fail('invalid_argument', { issues: [{ path: 'branch', message: 'too_many_branches' }] });
    tx.set(ref, branch);
    tx.set(col.approvalHistory(input.businessId).doc(), { targetType: 'branch', branchId: ref.id, state: 'pending', reason: 'created', actorUid: c.uid, at: now });
  });
  return { branch };
}));

export const updateBranch = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, branch: branchInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner', 'manager'], input.branchId);
  const data = normaliseBranchInput(input.branch);
  const cityIds = [data.cityId, ...data.deliveryCities.map((d) => d.cityId)];
  const cities = await Promise.all(cityIds.map((id) => col.city(id).get()));
  if (cities.some((s) => !s.exists)) fail('invalid_argument', { issues: [{ path: 'cityId', message: 'unknown_city' }] });
  await db.runTransaction(async (tx) => {
    const [bSnap, brSnap] = await Promise.all([tx.get(col.business(input.businessId)), tx.get(col.branch(input.businessId, input.branchId))]);
    if (!bSnap.exists || !brSnap.exists) fail('not_found');
    const branch = { ...(brSnap.data() as Branch), ...data, updatedAt: nowIso() };
    tx.set(brSnap.ref, branch);
    projectBranchInTx(tx, bSnap.data() as Business, branch);
  });
  return { ok: true };
}));

export const setOrdersPaused = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, paused: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner', 'manager'], input.branchId);
  await db.runTransaction(async (tx) => {
    const [bSnap, brSnap] = await Promise.all([tx.get(col.business(input.businessId)), tx.get(col.branch(input.businessId, input.branchId))]);
    if (!bSnap.exists || !brSnap.exists) fail('not_found');
    const branch = { ...(brSnap.data() as Branch), ordersPaused: input.paused, updatedAt: nowIso() };
    tx.set(brSnap.ref, branch);
    projectBranchInTx(tx, bSnap.data() as Business, branch);
  });
  return { ok: true };
}));

/** ---------- Memberships & invitations ---------- */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface InvitationDoc {
  id: string;
  email: string;
  businessId?: string;
  role: 'owner' | 'manager' | 'staff';
  allBranches: boolean;
  branchIds: string[];
  tokenHash: string;
  invitedBy: string;
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedUid?: string;
}

export async function createInvitation(params: Omit<InvitationDoc, 'id' | 'tokenHash' | 'status' | 'expiresAt' | 'createdAt'>): Promise<{ id: string; link: string }> {
  const token = randomBytes(24).toString('base64url');
  const ref = col.invitations().doc();
  const now = new Date();
  const doc: InvitationDoc = {
    ...params,
    id: ref.id,
    email: params.email.toLowerCase(),
    tokenHash: hashToken(token),
    status: 'pending',
    expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
    createdAt: now.toISOString(),
  };
  await ref.set(doc);
  const link = `${APP_ORIGIN}/business/invite/${ref.id}?token=${token}`;
  // Email delivery: Firebase Auth password-reset emails are used for password setup on acceptance.
  // The invitation link itself is delivered by the platform's transactional email in production;
  // in the emulator it is logged so testers can open it.
  console.info(`[invitation] ${doc.email} → ${link}`);
  return { id: ref.id, link };
}

/** Owner invites a manager or staff member by email, with branch limits. */
export const inviteMember = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(membershipInputSchema, req.data);
  await requireMembership(c, input.businessId, ['owner']);
  if (!input.allBranches && input.branchIds.length === 0) fail('invalid_argument', { issues: [{ path: 'branchIds', message: 'branch_required' }] });
  const branches = await col.branches(input.businessId).get();
  const valid = new Set(branches.docs.map((d) => d.id));
  if (input.branchIds.some((b) => !valid.has(b))) fail('invalid_argument', { issues: [{ path: 'branchIds', message: 'unknown_branch' }] });
  const email = input.email.toLowerCase();
  // If the user already exists, grant membership directly (they sign in with their own password).
  let existingUid: string | undefined;
  try {
    const u = await auth.getUserByEmail(email);
    existingUid = u.uid;
  } catch {
    existingUid = undefined;
  }
  if (existingUid) {
    const target = await col.user(existingUid).get();
    if (target.data()?.isAdmin) fail('forbidden', { reason: 'cannot_add_admin' });
    const now = nowIso();
    const m: Membership = { id: `${existingUid}_${input.businessId}`, uid: existingUid, businessId: input.businessId, role: input.role, allBranches: input.allBranches, branchIds: input.branchIds, active: true, invitedBy: c.uid, createdAt: now, updatedAt: now };
    await db.runTransaction(async (tx) => {
      const ex = await tx.get(col.membership(existingUid!, input.businessId));
      if (ex.exists && (ex.data() as Membership).role === 'owner') fail('forbidden', { reason: 'cannot_change_owner' });
      tx.set(col.membership(existingUid!, input.businessId), m, { merge: true });
      writeAudit(tx, { actorUid: c.uid, action: 'membership.grant', targetType: 'membership', targetId: m.id, after: m });
      enqueueEvent(tx, { kind: 'membership_changed', recipients: [existingUid!], params: {}, link: '/business', businessId: input.businessId, key: `membership:${m.id}:${now}` });
    });
    return { mode: 'granted', uid: existingUid };
  }
  const inv = await createInvitation({ email, businessId: input.businessId, role: input.role, allBranches: input.allBranches, branchIds: input.branchIds, invitedBy: c.uid });
  return { mode: 'invited', invitationId: inv.id, ...(process.env.FUNCTIONS_EMULATOR ? { link: inv.link } : {}) };
}));

/** Public (unauthenticated) lookup so the invite page can show the business name before sign-up. */
export const getInvitation = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const { id, token } = parse(z.object({ id: idSchema, token: z.string().min(10).max(100) }).strict(), req.data);
  const snap = await col.invitations().doc(id).get();
  if (!snap.exists) fail('not_found');
  const inv = snap.data() as InvitationDoc;
  if (inv.status !== 'pending' || inv.tokenHash !== hashToken(token) || inv.expiresAt < nowIso()) fail('not_found');
  let businessName = {};
  if (inv.businessId) businessName = (await col.business(inv.businessId).get()).data()?.name ?? {};
  return { email: inv.email, role: inv.role, businessName };
}));

/**
 * Accepts an invitation: the caller must be signed in with a verified email matching the invitation.
 * (The client creates the account with the invitation email, verifies it, then calls this.)
 */
export const acceptInvitation = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireVerifiedEmail(c);
  const { id, token } = parse(z.object({ id: idSchema, token: z.string().min(10).max(100) }).strict(), req.data);
  const result = await db.runTransaction(async (tx) => {
    const ref = col.invitations().doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const inv = snap.data() as InvitationDoc;
    if (inv.status !== 'pending' || inv.tokenHash !== hashToken(token) || inv.expiresAt < nowIso()) fail('not_found');
    if ((c.token.email ?? '').toLowerCase() !== inv.email) fail('forbidden', { reason: 'email_mismatch' });
    if (c.profile.isAdmin) fail('forbidden', { reason: 'admin_cannot_accept' });
    const now = nowIso();
    tx.update(ref, { status: 'accepted', acceptedAt: now, acceptedUid: c.uid });
    if (inv.businessId) {
      const m: Membership = { id: `${c.uid}_${inv.businessId}`, uid: c.uid, businessId: inv.businessId, role: inv.role, allBranches: inv.allBranches, branchIds: inv.branchIds, active: true, invitedBy: inv.invitedBy, createdAt: now, updatedAt: now };
      tx.set(col.membership(c.uid, inv.businessId), m);
      writeAudit(tx, { actorUid: c.uid, action: 'membership.accept', targetType: 'membership', targetId: m.id, after: m });
      return { businessId: inv.businessId, role: inv.role };
    }
    return { businessId: undefined, role: inv.role };
  });
  return result;
}));

export const updateMembership = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, uid: idSchema, role: z.enum(['manager', 'staff']).optional(), allBranches: z.boolean().optional(), branchIds: z.array(idSchema).max(50).optional(), active: z.boolean().optional() }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner']);
  if (input.uid === c.uid) fail('forbidden', { reason: 'self' });
  await db.runTransaction(async (tx) => {
    const ref = col.membership(input.uid, input.businessId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const before = snap.data() as Membership;
    if (before.role === 'owner') fail('forbidden', { reason: 'cannot_change_owner' });
    const after: Membership = { ...before, ...input, uid: before.uid, businessId: before.businessId, id: before.id, updatedAt: nowIso() } as Membership;
    tx.set(ref, after);
    writeAudit(tx, { actorUid: c.uid, action: 'membership.update', targetType: 'membership', targetId: before.id, before, after });
    enqueueEvent(tx, { kind: 'membership_changed', recipients: [input.uid], params: {}, link: '/business', businessId: input.businessId, key: `membership:${before.id}:${after.updatedAt}` });
  });
  if (input.active === false) {
    // Prompt revocation: existing ID tokens are re-checked against the membership doc on every server call
    // and by security rules; revoking refresh tokens forces re-authentication within the token lifetime.
    await auth.revokeRefreshTokens(input.uid).catch(() => undefined);
  }
  return { ok: true };
}));

export const listMembers = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { businessId } = parse(z.object({ businessId: idSchema }).strict(), req.data);
  await requireMembership(c, businessId, ['owner']);
  const [ms, invs] = await Promise.all([
    col.memberships().where('businessId', '==', businessId).limit(100).get(),
    col.invitations().where('businessId', '==', businessId).where('status', '==', 'pending').limit(50).get(),
  ]);
  const members = await Promise.all(
    ms.docs.map(async (d) => {
      const m = d.data() as Membership;
      const u = await col.user(m.uid).get();
      return { ...m, displayName: u.data()?.displayName ?? '', email: u.data()?.email ?? '' };
    }),
  );
  return { members, invitations: invs.docs.map((d) => { const i = d.data() as InvitationDoc; return { id: i.id, email: i.email, role: i.role, allBranches: i.allBranches, branchIds: i.branchIds, expiresAt: i.expiresAt }; }) };
}));
