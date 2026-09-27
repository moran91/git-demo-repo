/**
 * One-off backfill for the home's dish search (2026-09-26).
 *   node --experimental-strip-types src/dish-index-backfill.ts            -> dry run: prints the plan
 *   node --experimental-strip-types src/dish-index-backfill.ts --apply    -> writes it
 * Uses Application Default Credentials against qareeb-dev (or the emulator when FIRESTORE_EMULATOR_HOST
 * is set). It (1) sets `dishType` on Morano's dishes from the table below, on the private product and
 * its public projection, and (2) builds `publicBranches/{id}/index/dishes` for every visible
 * restaurant branch, exactly as functions/src/lib/projections.ts reprojectCatalog does.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Branch, Business, Category, Product } from '@qareeb/shared';
import { toDishIndexEntry, type DishType } from '../../packages/shared/src/dishIndex.ts';

const APPLY = process.argv.includes('--apply');
const MORANO = { businessId: 'aubsDikSbKp5FjD2xjau', branchId: 'OVEAbTAO0SgWR9qQBSDA' };

/** First matching rule wins; tested against the Hebrew name, then the category name. */
const RULES: Array<[RegExp, DishType]> = [
  [/קומבו/, 'mains'],
  [/פיצה/, 'pizza'],
  [/פסטה|ניוקי|רביולי|מק אנד|מקרוני|פטוצ'יני/, 'pasta'],
  [/המבורגר|בורגר/, 'burger'],
  [/שווארמה/, 'shawarma'],
  [/חומוס/, 'hummus'],
  [/סושי/, 'sushi'],
  [/סלט/, 'salads'],
  [/מטוגנ|צ.?יפס|אצבעות|שניצלונים|טבעות|הום פרייז|פרייז|כנפיים/, 'snacks'],
  [/קינוח|עוגה|גלידה|כנאפה|סופלה|טירמיסו|בראוניז/, 'desserts'],
  [/קולה|ספרייט|סודה|מים|XL|פאנטה|מוח.?יטו|גרוס|לימונדה|ענבים|תפוזים|שתייה|בירה|משקה/i, 'drinks'],
  [/מוקפץ|נודלס|עוף|שרמפס|סטייק|שניצל|פילה|מוקרם/, 'mains'],
];

function classify(name: string, category: string): DishType | undefined {
  for (const [re, t] of RULES) if (re.test(name)) return t;
  for (const [re, t] of RULES) if (re.test(category)) return t;
  return undefined;
}

initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const visible = (b: Business, br: Branch) => b.approval === 'approved' && br.approval === 'approved';

async function main() {
  // 1. Morano dish types
  const base = db.collection('businesses').doc(MORANO.businessId).collection('branches').doc(MORANO.branchId);
  const [cats, prods] = await Promise.all([base.collection('categories').get(), base.collection('products').get()]);
  const catName = new Map(cats.docs.map((d) => [d.id, (d.data() as Category).name.he ?? '']));
  const plan: Array<{ id: string; name: string; category: string; type?: DishType; had?: string }> = [];
  for (const d of prods.docs) {
    const p = d.data() as Product;
    if (p.archived) continue;
    const name = p.name.he ?? p.name.ar ?? p.name.en ?? '';
    const category = catName.get(p.categoryId) ?? '';
    plan.push({ id: p.id, name, category, type: p.dishType ?? classify(name, category), had: p.dishType });
  }
  plan.sort((a, b) => (a.type ?? 'zz').localeCompare(b.type ?? 'zz') || a.name.localeCompare(b.name));
  for (const r of plan) console.log(`${(r.type ?? '—').padEnd(9)} ${r.had ? '(kept) ' : ''}${r.name}  [${r.category}]`);
  console.log(`Morano: ${plan.filter((r) => r.type).length}/${plan.length} typed`);

  if (APPLY) {
    const batch = db.batch();
    for (const r of plan) {
      if (!r.type || r.had) continue;
      batch.update(base.collection('products').doc(r.id), { dishType: r.type });
      const pub = db.collection('publicBranches').doc(MORANO.branchId).collection('products').doc(r.id);
      if ((await pub.get()).exists) batch.update(pub, { dishType: r.type });
    }
    await batch.commit();
  }

  // 2. Dish index for every visible restaurant branch
  const businesses = await db.collection('businesses').where('type', '==', 'restaurant').get();
  for (const bDoc of businesses.docs) {
    const b = bDoc.data() as Business;
    const branches = await bDoc.ref.collection('branches').get();
    for (const brDoc of branches.docs) {
      const br = brDoc.data() as Branch;
      if (!visible(b, br)) continue;
      const products = (await brDoc.ref.collection('products').get()).docs.map((d) => d.data() as Product).filter((p) => !p.archived);
      const dishes = Object.fromEntries(products.map((p) => [p.id, toDishIndexEntry(p)]));
      console.log(`index ${br.id} (${b.name.he ?? b.id}): ${products.length} dishes`);
      if (APPLY) await db.collection('publicBranches').doc(br.id).collection('index').doc('dishes').set({ branchId: br.id, businessId: b.id, dishes, updatedAt: new Date().toISOString() });
    }
  }
  console.log(APPLY ? 'applied' : 'dry run (pass --apply to write)');
}

main().catch((e) => { console.error(e); process.exit(1); });
