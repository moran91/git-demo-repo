import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { addressInputSchema, idSchema, localeSchema, normalizeIsraeliPhone, type SavedAddress, type UserProfile } from '@qareeb/shared';
import { REGION, auth, col, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller } from '../lib/auth.js';

const opts = { region: REGION, enforceAppCheck: false } as const;

/**
 * Creates or refreshes the caller's profile from the verified Firebase Auth token. Phone verification
 * is taken ONLY from the token's phone_number claim (set by Firebase after SMS OTP, or by our custom
 * token after WhatsApp verification) — never from client input.
 */
export const ensureProfile = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  if (!req.auth) fail('unauthenticated');
  const input = parse(z.object({ displayName: z.string().trim().max(80).optional(), locale: localeSchema.optional() }).strict(), req.data ?? {});
  const uid = req.auth.uid;
  const token = req.auth.token;
  const ref = col.user(uid);
  // Source of truth for the verified phone is the Auth user record (set by Firebase after SMS OTP, or
  // by our WhatsApp flow via the Admin SDK) — never client input.
  const userRecord = await auth.getUser(uid);
  if (userRecord.disabled) fail('suspended');
  const rawPhone = userRecord.phoneNumber ?? token.phone_number;
  const profile = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const phone = rawPhone ? normalizeIsraeliPhone(rawPhone) ?? rawPhone : undefined;
    if (!snap.exists) {
      const p: UserProfile = {
        uid,
        displayName: input.displayName || (token.name as string | undefined) || '',
        phone,
        phoneVerified: !!phone,
        email: token.email,
        locale: input.locale ?? 'he',
        suspended: false,
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(ref, p);
      return p;
    }
    const existing = snap.data() as UserProfile;
    if (existing.suspended) fail('suspended');
    const patch: Partial<UserProfile> = { updatedAt: now };
    if (phone && existing.phone !== phone) {
      patch.phone = phone;
      patch.phoneVerified = true;
    }
    if (token.email && existing.email !== token.email) patch.email = token.email;
    if (input.displayName !== undefined && input.displayName !== existing.displayName) patch.displayName = input.displayName;
    if (input.locale && input.locale !== existing.locale) patch.locale = input.locale;
    tx.set(ref, patch, { merge: true });
    return { ...existing, ...patch };
  });
  return { profile };
}));

export const saveAddress = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ id: idSchema.optional(), address: addressInputSchema }).strict(), req.data);
  const phone = normalizeIsraeliPhone(input.address.recipientPhone);
  if (!phone) fail('invalid_argument', { issues: [{ path: 'address.recipientPhone', message: 'invalid_phone' }] });
  const citySnap = await col.city(input.address.cityId).get();
  if (!citySnap.exists || citySnap.data()?.active !== true) fail('invalid_argument', { issues: [{ path: 'address.cityId', message: 'unknown_city' }] });
  const ref = input.id ? col.addresses(c.uid).doc(input.id) : col.addresses(c.uid).doc();
  const saved = await db.runTransaction(async (tx) => {
    const existing = input.id ? await tx.get(ref) : null;
    if (input.id && !existing?.exists) fail('not_found');
    const all = await tx.get(col.addresses(c.uid));
    const now = nowIso();
    const makeDefault = input.address.isDefault === true || all.empty;
    const doc: SavedAddress = {
      id: ref.id,
      label: input.address.label ?? '',
      houseDescription: input.address.houseDescription,
      cityId: input.address.cityId,
      recipientName: input.address.recipientName,
      recipientPhone: phone,
      neighborhood: input.address.neighborhood,
      street: input.address.street,
      buildingNumber: input.address.buildingNumber,
      apartment: input.address.apartment,
      floor: input.address.floor,
      entrance: input.address.entrance,
      deliveryInstructions: input.address.deliveryInstructions,
      lat: input.address.lat,
      lng: input.address.lng,
      isDefault: makeDefault || (existing?.data() as SavedAddress | undefined)?.isDefault === true,
      createdAt: (existing?.data() as SavedAddress | undefined)?.createdAt ?? now,
      updatedAt: now,
    };
    if (makeDefault) for (const d of all.docs) if (d.id !== ref.id && d.data().isDefault) tx.update(d.ref, { isDefault: false });
    if (all.size >= 20 && !input.id) fail('invalid_argument', { issues: [{ path: 'address', message: 'too_many_addresses' }] });
    tx.set(ref, doc);
    return doc;
  });
  return { address: saved };
}));

export const deleteAddress = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { id } = parse(z.object({ id: idSchema }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const ref = col.addresses(c.uid).doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const wasDefault = snap.data()?.isDefault === true;
    const rest = wasDefault ? await tx.get(col.addresses(c.uid).orderBy('updatedAt', 'desc').limit(5)) : undefined;
    tx.delete(ref);
    if (rest) {
      const next = rest.docs.find((d) => d.id !== id);
      if (next) tx.update(next.ref, { isDefault: true });
    }
  });
  return { ok: true };
}));

export const setDefaultAddress = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { id } = parse(z.object({ id: idSchema }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const all = await tx.get(col.addresses(c.uid));
    if (!all.docs.some((d) => d.id === id)) fail('not_found');
    for (const d of all.docs) tx.update(d.ref, { isDefault: d.id === id });
  });
  return { ok: true };
}));

export const updateProfile = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ displayName: z.string().trim().min(1).max(80).optional(), locale: localeSchema.optional() }).strict(), req.data);
  await col.user(c.uid).set({ ...input, updatedAt: nowIso() }, { merge: true });
  return { ok: true };
}));
