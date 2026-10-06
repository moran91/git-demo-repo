import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { emptyTasteDoc, mergeTasteSchema, saveTasteSchema, type TasteDoc } from '@qareeb/shared';
import { REGION, col, commitInChunks, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';

const opts = { region: REGION } as const;
const QUIZ_MAX_AGE_MS = 90 * 86_400_000;

/** Learn and AI consent are what allow a quiz and an AI summary to be kept at all. */
function enforceConsent(doc: TasteDoc): void {
  if (doc.consent?.learn !== true) doc.quiz = null;
  if (doc.consent?.ai !== true) doc.lastAiSummary = null;
}

/** A device's quiz time is kept when believable; otherwise the quiz counts from now. */
function quizAt(at: string | undefined, now: string): string {
  const t = at ? Date.parse(at) : NaN;
  const n = Date.parse(now);
  return Number.isFinite(t) && t <= n && n - t < QUIZ_MAX_AGE_MS ? new Date(t).toISOString() : now;
}

/**
 * Consent, quiz and removed items for the signed-in customer. The client never writes the taste doc;
 * this callable checks that a quiz is only kept with learn consent.
 */
export const saveTaste = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(saveTasteSchema, req.data);
  await rateLimit(`taste:${c.uid}`, 60, 3600);
  const ref = col.taste(c.uid);
  const taste = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const doc: TasteDoc = snap.exists ? (snap.data() as TasteDoc) : emptyTasteDoc(now);
    if (input.consent) doc.consent = { ...input.consent, at: now };
    if (input.clearQuiz) doc.quiz = null;
    if (input.quiz) {
      if (doc.consent?.learn !== true) fail('invalid_argument', { issues: [{ path: 'quiz', message: 'learn_consent_required' }] });
      doc.quiz = { party: input.quiz.party ?? null, pairs: input.quiz.pairs, at: now };
    }
    if (input.suppressed) doc.suppressed = [...new Set(input.suppressed)].slice(0, 100);
    enforceConsent(doc);
    doc.updatedAt = now;
    tx.set(ref, doc);
    return doc;
  });
  return { taste };
}));

/** Right after sign-in: keep the picks made on this device ("link") or start from the account ("fresh"). */
export const mergeTaste = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(mergeTasteSchema, req.data);
  await rateLimit(`taste:${c.uid}`, 60, 3600);
  const ref = col.taste(c.uid);
  const taste = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const existing = snap.exists ? (snap.data() as TasteDoc) : null;
    const doc: TasteDoc = existing ?? emptyTasteDoc(now);
    if (input.choice === 'link') {
      const empty = !existing || (existing.consent === null && existing.quiz === null);
      if (empty && input.local.consent) {
        doc.consent = { ...input.local.consent, at: now };
        const q = input.local.quiz;
        if (q && doc.consent.learn) doc.quiz = { party: q.party ?? null, pairs: q.pairs, at: quizAt(q.at, now) };
      }
      doc.suppressed = [...new Set([...doc.suppressed, ...(input.local.suppressed ?? [])])].slice(0, 100);
    }
    enforceConsent(doc);
    doc.updatedAt = now;
    tx.set(ref, doc);
    return doc;
  });
  return { taste };
}));

/** "Delete everything Qareeb learned": feedback goes, the quiz goes, and older orders stop teaching. */
export const deleteTaste = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  parse(z.object({}).strict(), req.data ?? {});
  await rateLimit(`taste:${c.uid}`, 60, 3600);
  const feedback = await col.dishFeedback(c.uid).select().get();
  await commitInChunks(feedback.docs.map((d) => (batch) => batch.delete(d.ref)));
  const ref = col.taste(c.uid);
  const taste = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const prev = snap.exists ? (snap.data() as TasteDoc) : null;
    const doc: TasteDoc = { ...emptyTasteDoc(now), consent: prev?.consent ?? null, ignoreOrdersBefore: now };
    tx.set(ref, doc);
    return doc;
  });
  return { taste };
}));
