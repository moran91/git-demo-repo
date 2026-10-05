/**
 * One-off: builds publicBranches/{id}/index/deals for every visible restaurant branch, with the same
 * content reprojectCatalog writes. Touches nothing else.
 *   npx tsx scripts/src/deals-index-backfill.ts          -> dry run (prints counts)
 *   npx tsx scripts/src/deals-index-backfill.ts --apply  -> writes
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Branch, Business, Combo, Promotion } from '@qareeb/shared';
// Relative .ts import for the runtime function, like reproject.ts: the package's re-exports are .js-suffixed.
import { toDealsIndexDoc } from '../../packages/shared/src/dishIndex.ts';

const APPLY = process.argv.includes('--apply');
initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();

let n = 0;
for (const bDoc of (await db.collection('businesses').where('type', '==', 'restaurant').get()).docs) {
  const b = bDoc.data() as Business;
  for (const brDoc of (await bDoc.ref.collection('branches').get()).docs) {
    const br = brDoc.data() as Branch;
    if (b.approval !== 'approved' || br.approval !== 'approved') continue;
    const [combos, promos] = await Promise.all([brDoc.ref.collection('combos').get(), brDoc.ref.collection('promotions').get()]);
    const doc = toDealsIndexDoc(brDoc.id, bDoc.id, combos.docs.map((d) => d.data() as Combo), promos.docs.map((d) => d.data() as Promotion), new Date().toISOString());
    console.log(`${b.name.he ?? b.name.en ?? bDoc.id}: ${Object.keys(doc.combos).length} combos, ${Object.keys(doc.promotions).length} promotions`);
    if (APPLY) await db.doc(`publicBranches/${brDoc.id}/index/deals`).set(doc);
    n++;
  }
}
console.log(`${n} branches ${APPLY ? 'written' : '(dry run)'}`);
