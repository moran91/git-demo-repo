import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { AggregateField } from 'firebase-admin/firestore';
import {
  DEFAULT_LOYALTY_RULES,
  approvalDecisionSchema,
  businessInputSchema,
  cityInputSchema,
  cleanLocalized,
  idSchema,
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
import { createInvitation } from './businesses.js';
import { reverseCashInternal } from './orders.js';

const opts = { region: REGION } as const;

export const decideApproval = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(approvalDecisionSchema, req.data);
  await db.runTransaction(async (tx) => {
    const ref = input.targetType === 'business' ? col.business(input.businessId) : col.branch(input.businessId, input.branchId ?? '_');
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const before = (snap.data() as Business | Branch).approval;
    const now = nowIso();
    tx.update(ref, { approval: input.state, approvalReason: input.reason, updatedAt: now });
    tx.set(col.approvalHistory(input.businessId).doc(), { targetType: input.targetType, branchId: input.branchId, state: input.state, reason: input.reason, actorUid: c.uid, at: now });
    writeAudit(tx, { actorUid: c.uid, action: `approval.${input.targetType}.${input.state}`, targetType: input.targetType, targetId: input.branchId ?? input.businessId, reason: input.reason, before: { approval: before }, after: { approval: input.state } });
    const ownerUid = (input.targetType === 'business' ? (snap.data() as Business).ownerUid : undefined);
    enqueueEvent(tx, { kind: 'business_approval', ...(ownerUid ? { recipients: [ownerUid] } : { audience: { businessId: input.businessId, branchId: input.branchId ?? '' } }), params: {}, link: `/business/${input.businessId}`, businessId: input.businessId, key: `approval:${input.targetType}:${input.branchId ?? input.businessId}:${now}` });
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
    tx.update(ref, { suspended: input.suspended, suspendedReason: input.suspended ? input.reason : undefined, updatedAt: nowIso() });
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
  return { invitationId: inv.id, businessId, ...(process.env.FUNCTIONS_EMULATOR ? { link: inv.link } : {}) };
}));

export const saveCity = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(cityInputSchema, req.data);
  const slug = (input.name.en ?? input.name.he ?? input.name.ar ?? 'city').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = input.id ?? (slug || col.cities().doc().id);
  const city: City = { id, name: cleanLocalized(input.name), aliases: Array.from(new Set(input.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean))), active: input.active, lat: input.lat, lng: input.lng, sortOrder: input.sortOrder };
  await db.runTransaction(async (tx) => {
    const before = (await tx.get(col.city(id))).data();
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

export const setPlatformConfig = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ defaultCityId: idSchema.optional(), brandTagline: z.object({ he: z.string().max(120).optional(), ar: z.string().max(120).optional(), en: z.string().max(120).optional() }).optional() }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const before = (await tx.get(col.config())).data() as PlatformConfig | undefined;
    const after: PlatformConfig = {
      brand: { name: before?.brand.name ?? 'Qareeb', tagline: input.brandTagline ?? before?.brand.tagline ?? {} },
      monetization: { subscriptionEnabled: false, commissionPercent: 0, paidPromotionEnabled: false },
      whatsappOtpEnabled: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID),
      defaultCityId: input.defaultCityId ?? before?.defaultCityId ?? 'beit-jann',
      updatedAt: nowIso(),
    };
    tx.set(col.config(), after);
    writeAudit(tx, { actorUid: c.uid, action: 'config.update', targetType: 'config', targetId: 'platform', before, after });
  });
  return { ok: true };
}));

/** Real database-backed metrics using aggregation queries and the daily counters. */
export const getAdminMetrics = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const agingSince = new Date(Date.now() - 30 * 60000).toISOString();
  const [placed, accepted, cash, pendingBiz, aging, daily, users, businesses] = await Promise.all([
    col.orders().where('placedAt', '>=', since).aggregate({ count: AggregateField.count(), value: AggregateField.sum('totals.cashDueAgorot') }).get(),
    col.orders().where('placedAt', '>=', since).where('status', '==', 'accepted').aggregate({ count: AggregateField.count(), value: AggregateField.sum('totals.cashDueAgorot') }).get(),
    col.cashRecords().where('recordedAt', '>=', since).where('reversed', '==', false).aggregate({ count: AggregateField.count(), value: AggregateField.sum('amountAgorot') }).get(),
    col.businesses().where('approval', '==', 'pending').count().get(),
    col.orders().where('status', '==', 'placed').where('placedAt', '<', agingSince).count().get(),
    db.collection('metricsDaily').orderBy('date', 'desc').limit(30).get(),
    col.users().count().get(),
    col.businesses().where('approval', '==', 'approved').count().get(),
  ]);
  return {
    last30Days: {
      placedCount: placed.data().count,
      placedValueAgorot: placed.data().value ?? 0,
      acceptedCount: accepted.data().count,
      acceptedValueAgorot: accepted.data().value ?? 0,
      cashRecordsCount: cash.data().count,
      cashRecordedAgorot: cash.data().value ?? 0,
    },
    pendingBusinessApprovals: pendingBiz.data().count,
    agingPlacedOrders: aging.data().count,
    totalUsers: users.data().count,
    approvedBusinesses: businesses.data().count,
    daily: daily.docs.map((d) => d.data()),
  };
}));

/** Bounded user lookup for the admin console (exact email or phone, or recent users). */
export const adminListUsers = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(z.object({ email: z.string().max(120).optional(), phone: z.string().max(30).optional(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(100).optional() }).strict(), req.data ?? {});
  let q: FirebaseFirestore.Query = col.users();
  if (input.email) q = q.where('email', '==', input.email.toLowerCase());
  else if (input.phone) q = q.where('phone', '==', input.phone);
  else {
    q = q.orderBy('createdAt', 'desc');
    if (input.cursor) q = q.startAfter(input.cursor);
  }
  const snap = await q.limit(input.limit).get();
  const users = await Promise.all(
    snap.docs.map(async (d) => {
      const u = d.data() as UserProfile;
      const ms = await col.memberships().where('uid', '==', u.uid).limit(20).get();
      return { uid: u.uid, displayName: u.displayName, email: u.email, phone: u.phone, phoneVerified: u.phoneVerified, suspended: u.suspended, isAdmin: u.isAdmin, createdAt: u.createdAt, memberships: ms.docs.map((m) => m.data() as Membership) };
    }),
  );
  const last = snap.docs[snap.docs.length - 1];
  return { users, nextCursor: last && !input.email && !input.phone ? (last.data() as UserProfile).createdAt : undefined };
}));
