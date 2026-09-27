/**
 * Owner-approved corrections of bad machine translations on the live Morano menu (2026-09-26).
 *   npx tsx src/fix-translations.ts           -> shows current text and suspicious machine text
 *   npx tsx src/fix-translations.ts --apply   -> writes the corrections as owner text
 * A correction is owner text: the language is removed from `autoTranslated`, so no later translation
 * job ever overwrites it. The public projection and the dish index get the same text.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Product } from '@qareeb/shared';

const APPLY = process.argv.includes('--apply');
const BIZ = 'aubsDikSbKp5FjD2xjau';
const BRANCH = 'OVEAbTAO0SgWR9qQBSDA';

type Fix = { he: string; field: 'name' | 'description'; lang: 'ar' | 'en'; text: string };
const FIXES: Fix[] = [
  { he: 'חלומי פטריות', field: 'name', lang: 'ar', text: 'حلومي بالفطر' },
  { he: 'חלומי פטריות', field: 'name', lang: 'en', text: 'Halloumi with mushrooms' },
  { he: 'ספרייט', field: 'name', lang: 'ar', text: 'سبرايت' },
  { he: 'ספרייט', field: 'description', lang: 'ar', text: 'سبرايت' },
  // גרוס = blended with ice (the owner's meaning, 2026-09-26).
  { he: 'גרוס מוראנו', field: 'name', lang: 'ar', text: 'مورانو مثلّج' },
  { he: 'גרוס מוראנו', field: 'name', lang: 'en', text: 'Morano Ice Blend' },
  { he: 'גרוס מוראנו', field: 'description', lang: 'ar', text: 'مشروب مورانو مخفوق مع الثلج' },
  { he: 'גרוס מוראנו', field: 'description', lang: 'en', text: 'Morano drink blended with ice' },
];

initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();
const base = db.collection('businesses').doc(BIZ).collection('branches').doc(BRANCH);

const prods = (await base.collection('products').get()).docs.map((d) => d.data() as Product).filter((p) => !p.archived);
const suspicious = /dream|ghost|أحلام|حلم|شبح/i;
for (const p of prods) {
  for (const field of ['name', 'description'] as const) {
    for (const lang of ['ar', 'en'] as const) {
      const text = p[field][lang] ?? '';
      if (suspicious.test(text)) console.log('suspicious:', p.name.he, field, lang, '→', text);
    }
  }
}
for (const f of FIXES) {
  const p = prods.find((x) => x.name.he === f.he);
  if (!p) { console.log('NOT FOUND', f.he); continue; }
  console.log(`${f.he} ${f.field}.${f.lang}: "${p[f.field][f.lang] ?? ''}" → "${f.text}"`);
}

if (APPLY) {
  for (const he of [...new Set(FIXES.map((f) => f.he))]) {
    const p = prods.find((x) => x.name.he === he);
    if (!p) continue;
    const fixes = FIXES.filter((f) => f.he === he);
    const priv: Record<string, unknown> = {};
    const pub: Record<string, unknown> = {};
    for (const f of fixes) {
      priv[`${f.field}.${f.lang}`] = f.text;
      priv[`autoTranslated.${f.field}.${f.lang}`] = FieldValue.delete();
      pub[`${f.field}.${f.lang}`] = f.text;
      pub[`autoTranslated.${f.field}.${f.lang}`] = FieldValue.delete();
    }
    await base.collection('products').doc(p.id).update(priv);
    const pubRef = db.collection('publicBranches').doc(BRANCH).collection('products').doc(p.id);
    if ((await pubRef.get()).exists) await pubRef.update(pub);
    // Dish index: name and description live under dishes.<id>.
    const idxRef = db.collection('publicBranches').doc(BRANCH).collection('index').doc('dishes');
    const args: unknown[] = [];
    for (const f of fixes) args.push(new FieldPath('dishes', p.id, f.field, f.lang), f.text);
    if ((await idxRef.get()).exists) await (idxRef.update as (...a: unknown[]) => Promise<unknown>)(...args);
    console.log('fixed', he);
  }
}
