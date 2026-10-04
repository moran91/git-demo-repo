/**
 * Swap the restyled photos (out/<storeId>-<itemId>.webp, fetched from the qareeb-restyle Volume) into
 * the imported 1moment products. Only products still showing the imported original (`/orig.`) are
 * switched, so a photo an owner uploaded after claiming is never replaced. The original stays in
 * Storage for revert. Idempotent.
 *
 *   cd functions && npx tsx ../scripts/import-1moment/apply-restyle.ts [--variant=plated] [--apply]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const APPLY = process.argv.includes('--apply');
/** --variant=plated swaps in the replated photos (plated/ -> plated.webp) over the studio ones. */
const VARIANT = process.argv.find((a) => a.startsWith('--variant='))?.slice(10) ?? 'studio';
const OUT = new URL(VARIANT === 'studio' ? './out/' : `./${VARIANT}/`, import.meta.url);
initializeApp({ projectId: 'qareeb-dev', storageBucket: 'qareeb-dev.firebasestorage.app' });
const db = getFirestore();
const bucket = getStorage().bucket();

/** Photos rejected by hand after looking at them (data/v2-my-rejects.txt): never applied, and sent back to studio. */
const REJECT_FILE = VARIANT === 'plated3' ? './data/v3-rejects.txt' : './data/v2-my-rejects.txt';
const REJECTED = new Set((() => { try { return readFileSync(new URL(REJECT_FILE, import.meta.url), 'utf8').split(/\s+/).filter(Boolean); } catch { return []; } })());
/** plated3 = composites redone as real edits (meta3); plated2 = the main v2 pass (meta2). */
const META_DIR = VARIANT === 'plated3' ? 'meta3' : 'meta2';
/** Plated photos only count when the labeller named a real food category (a logo-only photo gets its text back). */
const FOOD = new Set(['SERVED', 'TAKEAWAY', 'HANDHELD', 'LOOSE', 'CUP_DRINK']);
const labelled = (f: string) => {
  if (VARIANT === 'plated2' || VARIANT === 'plated3') {
    if (REJECTED.has(f.replace('.webp', ''))) return false;
    try { return JSON.parse(readFileSync(new URL(`../${META_DIR}/${f.replace('.webp', '.json')}`, OUT), 'utf8')).final === 'plated'; } catch { return false; }
  }
  if (VARIANT !== 'plated') return true;
  try { return FOOD.has(JSON.parse(readFileSync(new URL(`../meta/${f.replace('.webp', '.json')}`, OUT), 'utf8')).category); } catch { return false; }
};
const all = readdirSync(OUT).filter((f) => /^\d+-\d+\.webp$/.test(f));
const files = all.filter(labelled);
const totals = { files: files.length, unlabelled: all.length - files.length, switched: 0, already: 0, ownerPhoto: 0, missing: 0 };
async function one(f: string) {
  const [sid, itemId] = f.replace('.webp', '').split('-');
  const ref = db.doc(`businesses/1m-${sid}/branches/1m-${sid}-main/products/1m-${itemId}`);
  const p = (await ref.get()).data();
  if (!p) { totals.missing++; return; }
  if (p.imagePath?.endsWith(`/${VARIANT}.webp`)) { totals.already++; return; }
  if (p.imagePath && !/\/(orig\.[a-z]+|studio\.webp|plated2?\.webp)$/.test(p.imagePath)) { totals.ownerPhoto++; return; }
  totals.switched++;
  if (!APPLY) return;
  const path = `businesses/1m-${sid}/branches/1m-${sid}-main/products/1m-${itemId}/${VARIANT}.webp`;
  await bucket.file(path).save(readFileSync(new URL(f, OUT)), { contentType: 'image/webp', resumable: false });
  await ref.update({ imagePath: path, updatedAt: new Date().toISOString() });
}
for (let i = 0; i < files.length; i += 10) await Promise.all(files.slice(i, i + 10).map(one));

// v2 keeps the studio photo when replating was not safe: products still showing a v1 plated photo go back to it.
if (VARIANT === 'plated2' || VARIANT === 'plated3') {
  const META = new URL(`../${META_DIR}/`, OUT);
  const keep = readdirSync(META).filter((f) => f.endsWith('.json') && (REJECTED.has(f.replace('.json', '')) || JSON.parse(readFileSync(new URL(f, META), 'utf8')).final === 'keep'));
  let reverted = 0;
  for (const f of keep) {
    const [sid, itemId] = f.replace('.json', '').split('-');
    const ref = db.doc(`businesses/1m-${sid}/branches/1m-${sid}-main/products/1m-${itemId}`);
    const p = (await ref.get()).data();
    if (!/\/plated2?\.webp$/.test(p?.imagePath ?? '')) continue;
    reverted++;
    if (APPLY) await ref.update({ imagePath: p!.imagePath.replace(/plated2?\.webp$/, 'studio.webp'), updatedAt: new Date().toISOString() });
  }
  console.log('reverted to studio:', reverted);
}
console.log(APPLY ? 'APPLIED' : 'DRY RUN', totals);
