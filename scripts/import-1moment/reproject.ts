/**
 * Rebuild only the public projection (publicBusinesses / publicBranches / products / dish index) of the
 * imported 1moment businesses from their private docs. Changes no approval or ordering state.
 *
 *   cd functions && npx tsx ../scripts/import-1moment/reproject.ts
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { reprojectBusinessSeed } from '../src/reproject.ts';

initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const snap = await db.collection('businesses').where('approvalReason', '==', 'imported from 1moment').get();
for (const b of snap.docs) await reprojectBusinessSeed(db, b.id);
console.log(`reprojected ${snap.size} businesses`);
