/**
 * Make the imported 1moment businesses visible on qareeb-dev: approve business + branch and rebuild the
 * public projection (publicBusinesses, publicBranches, products, dish index). Orders stay paused because
 * nobody owns these businesses yet; `--orders=on` unpauses, `--hide` sets them back to pending.
 *
 *   cd functions && npx tsx ../scripts/import-1moment/enable.ts [--orders=on] [--hide]
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { reprojectBusinessSeed } from '../src/reproject.ts';

const HIDE = process.argv.includes('--hide');
const ORDERS_ON = process.argv.includes('--orders=on');
initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const now = new Date().toISOString();
const state = HIDE ? 'pending' : 'approved';

const snap = await db.collection('businesses').where('approvalReason', '==', 'imported from 1moment').get();
let n = 0;
for (const biz of snap.docs) {
  if (biz.data().ownerUid) continue; // claimed: the owner/admin flow owns its state now
  await biz.ref.update({ approval: state, updatedAt: now });
  const branches = await biz.ref.collection('branches').get();
  for (const br of branches.docs) await br.ref.update({ approval: state, ordersPaused: !ORDERS_ON, updatedAt: now });
  await biz.ref.collection('approvalHistory').add({ targetType: 'business', state, reason: HIDE ? 'import hidden' : 'import preview', actorUid: 'import-1moment', at: now });
  await reprojectBusinessSeed(db, biz.id);
  n++;
}
console.log(`${state}: ${n} businesses, orders ${ORDERS_ON ? 'on' : 'paused'}`);
