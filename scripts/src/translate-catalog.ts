/**
 * Backfill menu auto-translation for every approved restaurant (2026-09-26 smart-search spec, part 2).
 *   node --experimental-strip-types src/translate-catalog.ts [--out plan.json]   -> dry run: calls Cloud
 *        Translation and prints every proposed translation; writes nothing to Firestore
 *   node --experimental-strip-types src/translate-catalog.ts --apply            -> queues one
 *        translationJobs doc per document that needs it; the deployed onTranslationJob trigger does the
 *        writing through the same owner-wins rules as a normal save
 * ADC against qareeb-dev.
 */
import { writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import type { Branch, Business, Locale } from '@qareeb/shared';
import { fromTranslatedHtml, protectNames, textFields, translationTargets, type TranslatableKind } from '../../packages/shared/src/translation.ts';

const APPLY = process.argv.includes('--apply');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : undefined;
const PROJECT = 'qareeb-dev';

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function translate(html: string[], from: Locale, to: Locale): Promise<string[]> {
  const client = await auth.getClient();
  const res = await client.request<{ translations: Array<{ translatedText: string }> }>({
    url: `https://translation.googleapis.com/v3/projects/${PROJECT}/locations/global:translateText`,
    method: 'POST',
    headers: { 'x-goog-user-project': PROJECT },
    data: { contents: html, sourceLanguageCode: from, targetLanguageCode: to, mimeType: 'text/html' },
  });
  return res.data.translations.map((t) => t.translatedText);
}

type Row = { business: string; kind: TranslatableKind; doc: string; field: string; from: Locale; to: Locale; source: string; proposed?: string };

async function main() {
  const rows: Row[] = [];
  let jobs = 0;
  const businesses = await db.collection('businesses').where('type', '==', 'restaurant').get();
  for (const bDoc of businesses.docs) {
    const business = bDoc.data() as Business;
    if (business.approval !== 'approved') continue;
    for (const brDoc of (await bDoc.ref.collection('branches').get()).docs) {
      const branch = brDoc.data() as Branch;
      if (branch.approval !== 'approved') continue;
      const sets: Array<[TranslatableKind, string]> = [['product', 'products'], ['category', 'categories'], ['group', 'modifierGroups']];
      for (const [kind, sub] of sets) {
        for (const d of (await brDoc.ref.collection(sub).get()).docs) {
          const doc = d.data() as { archived?: boolean; autoTranslated?: Record<string, Record<string, string>> } & Record<string, unknown>;
          if (doc.archived) continue;
          const targets = translationTargets(textFields(kind, doc as never), (doc.autoTranslated ?? {}) as never, business.defaultLocale);
          if (!targets.length) continue;
          for (const t of targets) rows.push({ business: business.name.he ?? bDoc.id, kind, doc: d.id, field: t.path, from: t.from, to: t.to, source: t.text });
          if (APPLY) {
            await db.collection('translationJobs').doc(d.ref.path.replace(/\//g, '__')).set({ path: d.ref.path, kind, businessId: bDoc.id, branchId: brDoc.id, requestedAt: new Date().toISOString(), attempts: 0 });
            jobs++;
          }
        }
      }
      if (!APPLY) {
        // Dry run: translate every pending row of this branch, grouped by language pair.
        const pending = rows.filter((r) => r.proposed === undefined && r.business === (business.name.he ?? bDoc.id));
        const pairs = new Map<string, Row[]>();
        for (const r of pending) pairs.set(`${r.from}>${r.to}`, [...(pairs.get(`${r.from}>${r.to}`) ?? []), r]);
        for (const [pair, list] of pairs) {
          const [from, to] = pair.split('>') as [Locale, Locale];
          for (let i = 0; i < list.length; i += 200) {
            const chunk = list.slice(i, i + 200);
            const out = await translate(chunk.map((r) => protectNames(r.source, business.name, to)), from, to);
            chunk.forEach((r, k) => { r.proposed = fromTranslatedHtml(out[k] ?? ''); });
          }
        }
      }
    }
  }
  for (const r of rows) console.log(`${r.business} | ${r.kind} ${r.field} | ${r.from}→${r.to} | ${r.source} → ${r.proposed ?? '(queued)'}`);
  console.log(APPLY ? `queued ${jobs} jobs for ${rows.length} texts` : `dry run: ${rows.length} texts`);
  if (OUT) writeFileSync(OUT, JSON.stringify(rows, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
