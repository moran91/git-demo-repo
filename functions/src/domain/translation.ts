/**
 * Menu auto-translation jobs (docs/superpowers/specs/2026-09-26-smart-search-design.md, part 2).
 *
 * A catalog save writes the owner's text at once and queues `translationJobs/{doc}` (latest save
 * wins). The trigger translates the missing / stale machine languages outside any transaction, then
 * writes inside one only what is still valid: the source text must be unchanged and the language
 * still empty or machine-written, so an owner's own text is never overwritten. The public menu and
 * the dish index are updated in the same transaction.
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import {
  applyTranslations, fromTranslatedHtml, protectNames, textFields, translationTargets,
  type AutoTranslated, type Branch, type Business, type Category, type Locale, type Product, type SharedModifierGroup, type TranslatableKind, type TranslationResult,
} from '@qareeb/shared';
import { REGION, col, db, nowIso, type Tx } from '../lib/firebase.js';
import { isPubliclyVisible, projectCategoryInTx, projectProductInTx } from '../lib/projections.js';
import { getTranslator } from '../lib/translator.js';
import { syncLinkedProducts } from './catalog.js';

export interface TranslationJob {
  path: string;
  kind: TranslatableKind;
  businessId: string;
  branchId: string;
  requestedAt: string;
  /** Set by the sweep to run a job again. */
  retriedAt?: string;
  attempts: number;
  lastError?: string;
}

type Translatable = (Product | Category | SharedModifierGroup) & { autoTranslated?: AutoTranslated };

const MAX_ATTEMPTS = 10;
const jobId = (path: string) => path.replace(/\//g, '__');

/** True when some text of the document still needs a machine translation. */
export function needsTranslation(kind: TranslatableKind, doc: Translatable, defaultLocale: Locale): boolean {
  return translationTargets(textFields(kind, doc), doc.autoTranslated ?? {}, defaultLocale).length > 0;
}

/**
 * Queues a job for a saved document when its place is public and something needs translating. Only
 * approved, visible places are translated (the backfill script covers places approved later).
 */
export function enqueueTranslationInTx(tx: Tx, ref: DocumentReference, kind: TranslatableKind, business: Business, branch: Branch, doc: Translatable): void {
  if (!isPubliclyVisible(business, branch) || !needsTranslation(kind, doc, business.defaultLocale)) return;
  const job: TranslationJob = { path: ref.path, kind, businessId: business.id, branchId: branch.id, requestedAt: nowIso(), attempts: 0 };
  tx.set(col.translationJobs().doc(jobId(ref.path)), job);
}

export async function processTranslationJob(id: string): Promise<'done' | 'failed' | 'gone'> {
  const jobRef = col.translationJobs().doc(id);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return 'gone';
  const job = jobSnap.data() as TranslationJob;
  const docRef = db.doc(job.path);
  const [docSnap, bSnap] = await Promise.all([docRef.get(), col.business(job.businessId).get()]);
  if (!docSnap.exists || !bSnap.exists) {
    await jobRef.delete();
    return 'gone';
  }
  const business = bSnap.data() as Business;
  const doc = docSnap.data() as Translatable;
  const targets = translationTargets(textFields(job.kind, doc), doc.autoTranslated ?? {}, business.defaultLocale);

  const results: TranslationResult[] = [];
  try {
    const byPair = new Map<string, typeof targets>();
    for (const t of targets) byPair.set(`${t.from}>${t.to}`, [...(byPair.get(`${t.from}>${t.to}`) ?? []), t]);
    const translator = getTranslator();
    for (const [pair, list] of byPair) {
      const [from, to] = pair.split('>') as [Locale, Locale];
      const out = await translator.translate(list.map((t) => protectNames(t.text, business.name, to)), from, to);
      list.forEach((t, i) => results.push({ path: t.path, to, text: fromTranslatedHtml(out[i] ?? ''), fromText: t.text }));
    }
  } catch (e) {
    console.error('translation failed', { job: id, error: String(e) });
    await jobRef.update({ attempts: FieldValue.increment(1), lastError: String(e).slice(0, 500) });
    return 'failed';
  }

  let group: SharedModifierGroup | undefined;
  await db.runTransaction(async (tx) => {
    const [j, d, b, br] = await Promise.all([tx.get(jobRef), tx.get(docRef), tx.get(col.business(job.businessId)), tx.get(col.branch(job.businessId, job.branchId))]);
    if (d.exists && b.exists) {
      const current = d.data() as Translatable;
      const biz = b.data() as Business;
      const applied = applyTranslations(job.kind, current, current.autoTranslated ?? {}, biz.defaultLocale, results);
      if (applied.changed) {
        const next = { ...applied.doc, autoTranslated: applied.auto } as Translatable;
        tx.set(docRef, next);
        const branch = br.exists ? (br.data() as Branch) : undefined;
        if (branch && job.kind === 'product') projectProductInTx(tx, biz, branch, next as Product);
        if (branch && job.kind === 'category') projectCategoryInTx(tx, biz, branch, next as Category);
        if (job.kind === 'group') group = next as SharedModifierGroup;
      }
    }
    // A newer save re-queued the job meanwhile: leave it, its own event runs it.
    if (j.exists && (j.data() as TranslationJob).requestedAt === job.requestedAt) tx.delete(jobRef);
  });
  // Library groups reach the dishes that use them through the usual fan-out.
  if (group) await syncLinkedProducts(job.businessId, job.branchId, group);
  return 'done';
}

export const onTranslationJob = onDocumentWritten({ region: REGION, document: 'translationJobs/{id}' }, async (event) => {
  const before = event.data?.before.data() as TranslationJob | undefined;
  const after = event.data?.after.data() as TranslationJob | undefined;
  if (!after) return;
  // Ignore our own bookkeeping (attempts / lastError); run on a new request or a sweep retry only.
  if (before && before.requestedAt === after.requestedAt && before.retriedAt === after.retriedAt) return;
  await processTranslationJob(event.params.id);
});

/** Sweep: re-run jobs left behind (failed call, missed trigger) up to MAX_ATTEMPTS. */
export async function retryTranslationJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const stale = await col.translationJobs().where('requestedAt', '<', cutoff).limit(50).get();
  let retried = 0;
  for (const d of stale.docs) {
    const job = d.data() as TranslationJob;
    if (job.attempts >= MAX_ATTEMPTS) continue;
    if (job.retriedAt && job.retriedAt > cutoff) continue;
    await d.ref.update({ retriedAt: nowIso() });
    retried++;
  }
  return retried;
}
