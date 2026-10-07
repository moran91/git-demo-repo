import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { AggregateField, FieldPath, FieldValue } from 'firebase-admin/firestore';
import {
  DEFAULT_LOYALTY_RULES,
  approvalDecisionSchema,
  businessInputSchema,
  cityInputSchema,
  cleanLocalized,
  idSchema,
  normalizeIsraeliPhone,
  reverseCashSchema,
  type Branch,
  type Business,
  type City,
  type LoyaltyAccount,
  type LoyaltyLedgerEntry,
  type Membership,
  type PlatformConfig,
  type UserProfile,
} from '@qareeb/shared';
import { REGION, auth, col, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireAdmin, requireCaller } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { reprojectBusiness } from '../lib/projections.js';
import { enqueueEvent } from '../lib/outbox.js';
import { createInvitation, hashToken, invitationLink, type InvitationDoc } from './businesses.js';
import { reverseCashInternal } from './orders.js';
import { whatsappConfigured, whatsappOpts } from './whatsapp.js';

const opts = { region: REGION } as const;
// setPlatformConfig reports whether WhatsApp OTP is configured, which means reading the Twilio
// secrets — a callable only gets the secrets it declares (see whatsapp.ts).
const configOpts = whatsappOpts;

export const decideApproval = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(approvalDecisionSchema, req.data);
  await db.runTransaction(async (tx) => {
    const ref = input.targetType === 'business' ? col.business(input.businessId) : col.branch(input.businessId, input.branchId ?? '_');
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    // All reads must precede writes in a transaction.
    const pendingBranches = input.targetType === 'business' && input.state === 'approved' ? await tx.get(col.branches(input.businessId).where('approval', '==', 'pending')) : { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
    const before = (snap.data() as Business | Branch).approval;
    const now = nowIso();
    tx.update(ref, { approval: input.state, approvalReason: input.reason, updatedAt: now });
    tx.set(col.approvalHistory(input.businessId).doc(), { targetType: input.targetType, branchId: input.branchId, state: input.state, reason: input.reason, actorUid: c.uid, at: now });
    writeAudit(tx, { actorUid: c.uid, action: `approval.${input.targetType}.${input.state}`, targetType: input.targetType, targetId: input.branchId ?? input.businessId, reason: input.reason, before: { approval: before }, after: { approval: input.state } });
    const ownerUid = (input.targetType === 'business' ? (snap.data() as Business).ownerUid : undefined);
    enqueueEvent(tx, { kind: 'business_approval', ...(ownerUid ? { recipients: [ownerUid] } : { audience: { businessId: input.businessId, branchId: input.branchId ?? '' } }), params: {}, link: `/business/${input.businessId}`, businessId: input.businessId, key: `approval:${input.targetType}:${input.branchId ?? input.businessId}:${now}` });
    // Approving a business also approves its branches that are still pending, so one admin decision
    // makes the business discoverable. Branches created later still get their own approval.
    if (input.targetType === 'business' && input.state === 'approved') {
      for (const d of pendingBranches.docs) {
        const br = d.data() as Branch;
        if (br.approval !== 'pending') continue;
        tx.update(d.ref, { approval: 'approved', approvalReason: input.reason, updatedAt: now });
        tx.set(col.approvalHistory(input.businessId).doc(), { targetType: 'branch', branchId: br.id, state: 'approved', reason: input.reason, actorUid: c.uid, at: now });
        writeAudit(tx, { actorUid: c.uid, action: 'approval.branch.approved', targetType: 'branch', targetId: br.id, reason: input.reason, before: { approval: 'pending' }, after: { approval: 'approved' } });
      }
    }
  });
  await reprojectBusiness(input.businessId);
  return { ok: true };
}));

export const setUserSuspended = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ uid: idSchema, suspended: z.boolean(), reason: z.string().trim().min(2).max(300) }).strict(), req.data);
  if (input.uid === c.uid) fail('forbidden', { reason: 'self' });
  await db.runTransaction(async (tx) => {
    const ref = col.user(input.uid);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const u = snap.data() as UserProfile;
    if (u.isAdmin) fail('forbidden', { reason: 'cannot_suspend_admin' });
    // `undefined` is dropped (ignoreUndefinedProperties), so reinstating has to delete the reason explicitly.
    tx.update(ref, { suspended: input.suspended, suspendedReason: input.suspended ? input.reason : FieldValue.delete(), updatedAt: nowIso() });
    writeAudit(tx, { actorUid: c.uid, action: input.suspended ? 'user.suspend' : 'user.reinstate', targetType: 'user', targetId: input.uid, reason: input.reason });
  });
  // Block promptly even with an older token: disable the Auth user and revoke refresh tokens; rules and
  // callables additionally check the `suspended` flag on the user document.
  await auth.updateUser(input.uid, { disabled: input.suspended }).catch(() => undefined);
  if (input.suspended) await auth.revokeRefreshTokens(input.uid).catch(() => undefined);
  return { ok: true };
}));

/** Admin invites an owner by email; optionally creates the business now (pending approval) for them. */
export const inviteOwner = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ email: z.string().email().max(120), business: businessInputSchema.optional() }).strict(), req.data);
  let businessId: string | undefined;
  if (input.business) {
    const ref = col.businesses().doc();
    const now = nowIso();
    const b: Business = { id: ref.id, type: input.business.type, name: cleanLocalized(input.business.name), description: cleanLocalized(input.business.description), defaultLocale: input.business.defaultLocale, ownerUid: '', publicPhone: input.business.publicPhone, publicEmail: input.business.publicEmail, approval: 'pending', loyalty: { ...DEFAULT_LOYALTY_RULES }, createdAt: now, updatedAt: now };
    await ref.set(b);
    businessId = ref.id;
  }
  const inv = await createInvitation({ email: input.email, businessId, role: 'owner', allBranches: true, branchIds: [], invitedBy: c.uid });
  await db.runTransaction(async (tx) => writeAudit(tx, { actorUid: c.uid, action: 'owner.invite', targetType: 'invitation', targetId: inv.id, after: { email: input.email.toLowerCase(), businessId } }));
  // Nothing sends email, so the admin delivers the link (copy / WhatsApp).
  return { invitationId: inv.id, businessId, link: inv.link };
}));

export const saveCity = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(cityInputSchema, req.data);
  const slug = (input.name.en ?? input.name.he ?? input.name.ar ?? 'city').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = input.id ?? (slug || col.cities().doc().id);
  const city: City = { id, name: cleanLocalized(input.name), aliases: Array.from(new Set(input.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean))), active: input.active, lat: input.lat, lng: input.lng, sortOrder: input.sortOrder };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(col.city(id));
    const before = snap.data();
    // The id is derived from the name, so two different cities can resolve to the same slug. A create
    // that lands on an existing document would replace it (aliases, coordinates and all).
    if (!input.id && snap.exists) fail('invalid_argument', { issues: [{ path: 'name', message: 'city_exists' }] });
    tx.set(col.city(id), city);
    writeAudit(tx, { actorUid: c.uid, action: 'city.save', targetType: 'city', targetId: id, before, after: city });
  });
  return { city };
}));

export const adminAdjustLoyalty = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ businessId: idSchema, uid: idSchema, points: z.number().int().min(-100000).max(100000).refine((v) => v !== 0), reason: z.string().trim().min(3).max(300) }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const bSnap = await tx.get(col.business(input.businessId));
    if (!bSnap.exists) fail('not_found');
    const accRef = col.loyaltyAccount(input.businessId, input.uid);
    const acc = (await tx.get(accRef)).data() as LoyaltyAccount | undefined;
    let available = (acc?.available ?? 0) + input.points;
    let debt = acc?.debt ?? 0;
    if (input.points > 0 && debt > 0) {
      const cover = Math.min(debt, input.points);
      debt -= cover;
      available -= cover;
    }
    if (available < 0) {
      debt += -available;
      available = 0;
    }
    const now = nowIso();
    tx.set(accRef, { id: accRef.id, businessId: input.businessId, uid: input.uid, available, reserved: acc?.reserved ?? 0, debt, updatedAt: now } satisfies LoyaltyAccount);
    const key = `admin:${input.businessId}:${input.uid}:${now}`;
    const ref = col.loyaltyLedger().doc(key.replace(/[^A-Za-z0-9_:-]/g, '_'));
    tx.set(ref, { id: ref.id, businessId: input.businessId, uid: input.uid, type: 'admin_adjust', points: input.points, reservedDelta: 0, rulesVersion: (bSnap.data() as Business).loyalty.version, reason: input.reason, actorUid: c.uid, at: now, key } satisfies LoyaltyLedgerEntry);
    writeAudit(tx, { actorUid: c.uid, action: 'loyalty.adjust', targetType: 'loyaltyAccount', targetId: accRef.id, reason: input.reason, before: acc, after: { available, debt } });
  });
  return { ok: true };
}));

export const adminReverseCash = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(reverseCashSchema, req.data);
  return reverseCashInternal(c, input, true);
}));

export const moderateProduct = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, archived: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    tx.update(ref, { archived: input.archived, updatedAt: nowIso() });
    writeAudit(tx, { actorUid: c.uid, action: 'catalog.moderate', targetType: 'product', targetId: `${input.branchId}/${input.productId}`, reason: input.reason, after: { archived: input.archived } });
  });
  const { reprojectCatalog } = await import('../lib/projections.js');
  await reprojectCatalog(input.businessId, input.branchId);
  return { ok: true };
}));

export const setPlatformConfig = onCall(configOpts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ defaultCityId: idSchema.optional(), brandTagline: z.object({ he: z.string().max(120).optional(), ar: z.string().max(120).optional(), en: z.string().max(120).optional() }).optional() }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const before = (await tx.get(col.config())).data() as PlatformConfig | undefined;
    const after: PlatformConfig = {
      brand: { name: before?.brand.name ?? 'Qareeb', tagline: input.brandTagline ?? before?.brand.tagline ?? {} },
      monetization: { subscriptionEnabled: false, commissionPercent: 0, paidPromotionEnabled: false },
      whatsappOtpEnabled: whatsappConfigured(),
      defaultCityId: input.defaultCityId ?? before?.defaultCityId ?? 'beit-jann',
      ...(before?.aiDailyCapMicroUsd !== undefined ? { aiDailyCapMicroUsd: before.aiDailyCapMicroUsd } : {}),
      ...(before?.aiModel !== undefined ? { aiModel: before.aiModel } : {}),
      updatedAt: nowIso(),
    };
    tx.set(col.config(), after);
    writeAudit(tx, { actorUid: c.uid, action: 'config.update', targetType: 'config', targetId: 'platform', before, after });
  });
  return { ok: true };
}));

/**
 * Real database-backed metrics using aggregation queries and the daily counters. Each query needs its
 * own composite index in production (the emulator does not check), so one missing index degrades that
 * number to null instead of failing the whole overview.
 */
export const getAdminMetrics = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const agingSince = new Date(Date.now() - 30 * 60000).toISOString();
  const settle = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try { return await run(); } catch (e) { console.error(`getAdminMetrics: ${name} failed`, e); return null; }
  };
  const sumQuery = (q: FirebaseFirestore.Query, field: string) => settle(field, async () => {
    const d = (await q.aggregate({ count: AggregateField.count(), value: AggregateField.sum(field) }).get()).data();
    return { count: d.count, value: d.value ?? 0 };
  });
  const count = (name: string, q: FirebaseFirestore.Query) => settle(name, async () => (await q.count().get()).data().count);
  const [placed, accepted, cash, pendingBiz, pendingBranches, aging, daily, users, businesses] = await Promise.all([
    sumQuery(col.orders().where('placedAt', '>=', since), 'totals.cashDueAgorot'),
    sumQuery(col.orders().where('placedAt', '>=', since).where('status', '==', 'accepted'), 'totals.cashDueAgorot'),
    sumQuery(col.cashRecords().where('recordedAt', '>=', since).where('reversed', '==', false), 'amountAgorot'),
    count('pendingBusinesses', col.businesses().where('approval', '==', 'pending')),
    // The orderBy lets the count use the (approval, createdAt) collection-group index the approvals list already needs.
    count('pendingBranches', db.collectionGroup('branches').where('approval', '==', 'pending').orderBy('createdAt', 'desc')),
    count('agingOrders', col.orders().where('status', '==', 'placed').where('placedAt', '<', agingSince)),
    settle('daily', async () => (await db.collection('metricsDaily').orderBy('date', 'desc').limit(30).get()).docs.map((d) => d.data())),
    count('users', col.users()),
    count('approvedBusinesses', col.businesses().where('approval', '==', 'approved')),
  ]);
  return {
    last30Days: {
      placedCount: placed?.count ?? null,
      placedValueAgorot: placed?.value ?? null,
      acceptedCount: accepted?.count ?? null,
      acceptedValueAgorot: accepted?.value ?? null,
      cashRecordsCount: cash?.count ?? null,
      cashRecordedAgorot: cash?.value ?? null,
    },
    pendingBusinessApprovals: pendingBiz,
    pendingBranchApprovals: pendingBranches,
    agingPlacedOrders: aging,
    totalUsers: users,
    approvedBusinesses: businesses,
    daily: daily ?? [],
  };
}));

/**
 * Bounded user lookup for the admin console: exact email, phone in any local/international form, a
 * display-name prefix, or recent users (the only mode that pages).
 */
export const adminListUsers = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ email: z.string().max(120).optional(), phone: z.string().max(30).optional(), name: z.string().trim().min(1).max(60).optional(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(100).optional() }).strict(), req.data ?? {});
  let q: FirebaseFirestore.Query = col.users();
  const listing = !input.email && !input.phone && !input.name;
  if (input.email) q = q.where('email', '==', input.email.trim().toLowerCase());
  else if (input.phone) q = q.where('phone', '==', normalizeIsraeliPhone(input.phone) ?? input.phone.trim());
  else if (input.name) q = q.orderBy('displayName').startAt(input.name).endAt(`${input.name}\uf8ff`);
  else {
    // Tiebreak on the document id: users created in the same instant share a `createdAt`, and a
    // cursor on that field alone skips every one of them. Matching directions keep this served by
    // the automatic single-field index.
    q = q.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (input.cursor) {
      const sep = input.cursor.lastIndexOf('|');
      if (sep > 0) q = q.startAfter(input.cursor.slice(0, sep), input.cursor.slice(sep + 1));
    }
  }
  const snap = await q.limit(input.limit).get();
  const users = await Promise.all(
    snap.docs.map(async (d) => {
      const u = d.data() as UserProfile;
      const ms = await col.memberships().where('uid', '==', u.uid).limit(20).get();
      return { uid: u.uid, displayName: u.displayName, email: u.email, phone: u.phone, phoneVerified: u.phoneVerified, suspended: u.suspended, suspendedReason: u.suspendedReason, isAdmin: u.isAdmin, createdAt: u.createdAt, memberships: ms.docs.map((m) => m.data() as Membership) };
    }),
  );
  // A short page is the last one; returning a cursor there shows a "Load more" that loads nothing.
  const last = snap.docs[snap.docs.length - 1];
  return { users, nextCursor: listing && last && snap.size === input.limit ? `${(last.data() as UserProfile).createdAt}|${last.id}` : undefined };
}));

type InvitationRow = Omit<InvitationDoc, 'tokenHash' | 'status'> & { status: InvitationDoc['status'] | 'expired' };

/** Every invitation, newest first (owner invitations from the admin and staff invitations from owners). */
export const adminListInvitations = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ limit: z.number().int().min(1).max(50).default(30), cursor: z.string().max(100).optional() }).strict(), req.data ?? {});
  let q = col.invitations().orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (input.cursor) {
    const sep = input.cursor.lastIndexOf('|');
    if (sep > 0) q = q.startAfter(input.cursor.slice(0, sep), input.cursor.slice(sep + 1));
  }
  const snap = await q.limit(input.limit).get();
  const now = nowIso();
  const invitations: InvitationRow[] = snap.docs.map((d) => {
    const { tokenHash: _hash, ...inv } = d.data() as InvitationDoc;
    return { ...inv, status: inv.status === 'pending' && inv.expiresAt < now ? 'expired' : inv.status };
  });
  const last = snap.docs[snap.docs.length - 1];
  return { invitations, nextCursor: last && snap.size === input.limit ? `${(last.data() as InvitationDoc).createdAt}|${last.id}` : undefined };
}));

/**
 * Revokes an open invitation, or renews one (a new token, so only the new link works, and seven more
 * days). The token is stored hashed, so renewing is the only way to hand out a link again.
 */
export const adminInvitationAction = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ id: idSchema, action: z.enum(['revoke', 'renew']) }).strict(), req.data);
  const token = randomBytes(24).toString('base64url');
  await db.runTransaction(async (tx) => {
    const ref = col.invitations().doc(input.id);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const inv = snap.data() as InvitationDoc;
    if (inv.status === 'accepted') fail('invalid_argument', { issues: [{ path: 'id', message: 'already_accepted' }] });
    const now = new Date();
    if (input.action === 'revoke') tx.update(ref, { status: 'revoked' });
    else tx.update(ref, { status: 'pending', tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString() });
    writeAudit(tx, { actorUid: c.uid, action: `invitation.${input.action}`, targetType: 'invitation', targetId: inv.id, before: { status: inv.status }, after: { email: inv.email, businessId: inv.businessId } });
  });
  return input.action === 'renew' ? { link: invitationLink(input.id, token) } : { ok: true };
}));
