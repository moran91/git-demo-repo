import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeIsraeliPhone, whatsappCheckSchema, whatsappStartSchema, type UserProfile } from '@qareeb/shared';
import { REGION, auth, col, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { rateLimit } from '../lib/ratelimit.js';

/**
 * Optional WhatsApp OTP through Twilio Verify (channel "whatsapp"). Entirely configuration-gated:
 * when the three secrets are absent the callables return `not_configured` and the web app hides the
 * option. Codes are generated and checked by Twilio; we never see or log them. A Firebase custom token
 * is issued only after Twilio reports `approved`, bound to the challenge's phone number.
 * Docs: https://www.twilio.com/docs/verify/whatsapp
 */
const opts = { region: REGION, secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'] as string[] };

function twilioConfig() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) return null;
  return { sid, token, service };
}

export function whatsappConfigured(): boolean {
  return twilioConfig() !== null;
}

async function twilio(path: string, body: Record<string, string>): Promise<{ status: string; sid?: string }> {
  const cfg = twilioConfig();
  if (!cfg) fail('not_configured');
  const res = await fetch(`https://verify.twilio.com/v2/Services/${cfg.service}/${path}`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; sid?: string; code?: number };
  if (!res.ok) {
    if (res.status === 429 || json.code === 60203) fail('rate_limited');
    if (json.code === 60200 || json.code === 60202) fail('invalid_argument', { issues: [{ path: 'code', message: 'invalid_or_expired' }] });
    console.error('twilio verify error', res.status, json.code);
    fail('internal');
  }
  return { status: json.status ?? '', sid: json.sid };
}

interface Challenge {
  id: string;
  phoneHash: string;
  phone: string;
  locale: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumed: boolean;
  /** Bound to the anonymous client session that started the challenge (rate-limit key). */
  clientKey: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export const whatsappStart = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  if (!whatsappConfigured()) fail('not_configured');
  const input = parse(whatsappStartSchema, req.data);
  const phone = normalizeIsraeliPhone(input.phone);
  if (!phone) fail('invalid_argument', { issues: [{ path: 'phone', message: 'invalid_phone' }] });
  const clientKey = req.rawRequest.ip ?? 'unknown';
  await rateLimit(`wa:${hash(phone)}`, 3, 600);
  await rateLimit(`wa-ip:${hash(clientKey)}`, 10, 600);
  // Never link a WhatsApp challenge to a platform admin account.
  const existing = await col.users().where('phone', '==', phone).limit(1).get();
  if (!existing.empty && (existing.docs[0]!.data() as UserProfile).isAdmin) fail('forbidden', { reason: 'admin_phone' });
  await twilio('Verifications', { To: phone, Channel: 'whatsapp', Locale: input.locale });
  const id = randomUUID();
  const now = new Date();
  const ch: Challenge = { id, phoneHash: hash(phone), phone, locale: input.locale, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60000).toISOString(), attempts: 0, consumed: false, clientKey: hash(clientKey) };
  await col.otpChallenges().doc(id).set(ch);
  return { challengeId: id, expiresAt: ch.expiresAt };
}));

export const whatsappCheck = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  if (!whatsappConfigured()) fail('not_configured');
  const input = parse(whatsappCheckSchema, req.data);
  const ref = col.otpChallenges().doc(input.challengeId);
  const ch = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const c = snap.data() as Challenge;
    if (c.consumed || c.expiresAt < nowIso()) fail('invalid_argument', { issues: [{ path: 'code', message: 'expired' }] });
    if (c.attempts >= 5) fail('rate_limited');
    if (c.clientKey !== hash(req.rawRequest.ip ?? 'unknown')) fail('forbidden', { reason: 'session_mismatch' });
    tx.update(ref, { attempts: c.attempts + 1 });
    return c;
  });
  const result = await twilio('VerificationCheck', { To: ch.phone, Code: input.code });
  if (result.status !== 'approved') fail('invalid_argument', { issues: [{ path: 'code', message: 'invalid_or_expired' }] });
  await ref.update({ consumed: true, consumedAt: nowIso() });
  // Same verified phone → same Firebase UID across SMS and WhatsApp.
  let uid: string;
  try {
    const u = await auth.getUserByPhoneNumber(ch.phone);
    uid = u.uid;
    if (u.disabled) fail('suspended');
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') {
      const created = await auth.createUser({ phoneNumber: ch.phone });
      uid = created.uid;
    } else throw e;
  }
  const profile = await col.user(uid).get();
  if (profile.exists && (profile.data() as UserProfile).isAdmin) fail('forbidden', { reason: 'admin_phone' });
  if (profile.exists && (profile.data() as UserProfile).suspended) fail('suspended');
  const token = await auth.createCustomToken(uid, { whatsapp_verified: true });
  return { customToken: token };
}));

export const authOptions = onCall({ region: REGION }, handled(async () => {
  return { whatsapp: whatsappConfigured() };
}));
