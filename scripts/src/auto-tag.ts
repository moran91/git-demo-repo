/**
 * Fills tags, serves and dish type on every restaurant dish from its texts (autoTags), only where the
 * machine still owns the field (ownership.ts) - an owner's choice is never touched.
 *   npx tsx scripts/src/auto-tag.ts --dry     -> review page docs/mockups/auto-tag-review/index.html (read-only)
 *   npx tsx scripts/src/auto-tag.ts --apply   -> writes (only after the owner approved the page)
 * Uses Application Default Credentials against qareeb-dev, or the emulator when FIRESTORE_EMULATOR_HOST is set.
 * --apply against anything but the emulator also needs --live.
 *
 * The new values are exactly what saveProduct stores when the owner sends no auto fields:
 * resolveAutoFields({}, existing, autoTags(...)). Owner-wins, legacy products and the empty marks all come from there.
 * Projection mirrors functions/src/lib/projections.ts: the public product gets the same fields, the branch dish
 * index entry is toDishIndexEntry of the updated product, written per key like projectDishIndexEntry.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type DocumentReference, type Timestamp } from 'firebase-admin/firestore';
import { autoTags, resolveAutoFields, same, toDishIndexEntry, type AutoFields, type AutoValues, type Branch, type Business, type Category, type Product } from '@qareeb/shared';

const APPLY = process.argv.includes('--apply');
const LIVE = process.argv.includes('--live');
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
if (APPLY && !EMULATOR && !LIVE) {
  console.error('Refusing --apply: FIRESTORE_EMULATOR_HOST is not set, so this would write to the live project. Pass --live to do that on purpose.');
  process.exit(1);
}
if (APPLY && process.argv.includes('--dry')) {
  console.error('Pass either --dry or --apply, not both.');
  process.exit(1);
}

initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();

const KEYS = ['tags', 'serves', 'dishType'] as const;
type Key = (typeof KEYS)[number];

interface Row {
  business: Business;
  branch: Branch;
  product: Product;
  ref: DocumentReference;
  updateTime: Timestamp;
  values: AutoValues;
  autoFields: AutoFields;
  changed: Array<Key | 'marks'>;
}

const visible = (b: Business, br: Branch) => b.approval === 'approved' && br.approval === 'approved';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** An empty type and empty tags compare as absent, like ownership.ts. */
const norm = (k: Key, v: unknown) => (k === 'dishType' ? (v ?? 'none') : k === 'tags' ? (v ?? []) : v);
const label = (l: { he?: string; ar?: string; en?: string } | undefined) => l?.he || l?.ar || l?.en || '';

const stats = { businesses: 0, branches: 0, dishes: 0, archived: 0, unchanged: 0 };
const kept: Record<Key, number> = { tags: 0, serves: 0, dishType: 0 };

async function scanBranch(business: Business, branch: Branch, brDoc: FirebaseFirestore.QueryDocumentSnapshot): Promise<Row[]> {
  const [cats, prods] = await Promise.all([brDoc.ref.collection('categories').get(), brDoc.ref.collection('products').get()]);
  const catName = new Map(cats.docs.map((d) => [d.id, (d.data() as Category).name]));
  const rows: Row[] = [];
  for (const d of prods.docs) {
    const p = d.data() as Product;
    if (p.archived) { stats.archived++; continue; }
    stats.dishes++;
    const { values, autoFields } = resolveAutoFields({}, p, autoTags({ name: p.name, description: p.description, categoryName: catName.get(p.categoryId) }));
    const changed: Row['changed'] = KEYS.filter((k) => !same(norm(k, values[k]), norm(k, p[k])));
    for (const k of KEYS) if (p.autoFields?.[k] === undefined && autoFields[k] === undefined) kept[k]++;
    if (!changed.length && KEYS.some((k) => !same(autoFields[k], p.autoFields?.[k]))) changed.push('marks');
    if (!changed.length) { stats.unchanged++; continue; }
    rows.push({ business, branch, product: p, ref: d.ref, updateTime: d.updateTime, values, autoFields, changed });
  }
  return rows;
}

/** The fields written to a product document (private and public alike). A dropped type is deleted, never undefined. */
function updateData(r: Row): Record<string, unknown> {
  const data: Record<string, unknown> = { ...r.values, autoFields: r.autoFields };
  if (r.values.dishType === undefined && r.product.dishType !== undefined) data.dishType = FieldValue.delete();
  return data;
}

async function applyBranch(rows: Row[]): Promise<{ written: number; skipped: number }> {
  const { business, branch } = rows[0]!;
  const show = visible(business, branch);
  const pubRefs = rows.map((r) => db.doc(`publicBranches/${branch.id}/products/${r.product.id}`));
  const pubExists = show ? new Set((await db.getAll(...pubRefs)).filter((s) => s.exists).map((s) => s.id)) : new Set<string>();
  const done: Row[] = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 25) {
    await Promise.all(rows.slice(i, i + 25).map(async (r) => {
      const data = updateData(r);
      const batch = db.batch();
      // The precondition makes an owner's save between our read and this write win: that product is skipped.
      batch.update(r.ref, data, { lastUpdateTime: r.updateTime });
      if (pubExists.has(r.product.id)) batch.update(db.doc(`publicBranches/${branch.id}/products/${r.product.id}`), data);
      try {
        await batch.commit();
        done.push(r);
      } catch (e) {
        skipped++;
        console.error(`skipped ${r.product.id} (${label(r.product.name)}): ${(e as Error).message}`);
      }
    }));
  }
  // The branch's dish index: one entry per written dish, replacing exactly that key (restaurants of a visible branch only).
  if (show && business.type === 'restaurant') {
    for (let i = 0; i < done.length; i += 200) {
      const part = done.slice(i, i + 200);
      const dishes = Object.fromEntries(part.map((r) => [r.product.id, toDishIndexEntry({ ...r.product, ...r.values, dishType: r.values.dishType, autoFields: r.autoFields })]));
      await db.doc(`publicBranches/${branch.id}/index/dishes`).set(
        { branchId: branch.id, businessId: business.id, updatedAt: new Date().toISOString(), dishes },
        { mergeFields: ['branchId', 'businessId', 'updatedAt', ...part.map((r) => new FieldPath('dishes', r.product.id))] },
      );
    }
  }
  return { written: done.length, skipped };
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'Dry run'} on ${EMULATOR ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : 'LIVE project qareeb-dev'}`);
  const all: Row[] = [];
  let written = 0;
  let skipped = 0;
  const businesses = await db.collection('businesses').where('type', '==', 'restaurant').get();
  for (const bDoc of businesses.docs) {
    const business = bDoc.data() as Business;
    if (business.type === 'supermarket') continue; // supermarkets get no automatic fields
    stats.businesses++;
    for (const brDoc of (await bDoc.ref.collection('branches').get()).docs) {
      stats.branches++;
      const rows = await scanBranch(business, brDoc.data() as Branch, brDoc);
      all.push(...rows);
      if (APPLY && rows.length) {
        const r = await applyBranch(rows);
        written += r.written;
        skipped += r.skipped;
      }
    }
  }
  const byKey = (k: Row['changed'][number]) => all.filter((r) => r.changed.includes(k)).length;
  console.log(`${stats.businesses} restaurants, ${stats.branches} branches, ${stats.dishes} live dishes (${stats.archived} archived skipped)`);
  console.log(`${all.length} dishes to update (${stats.unchanged} already right): tags ${byKey('tags')}, serves ${byKey('serves')}, dishType ${byKey('dishType')}, marks only ${all.filter((r) => r.changed.length === 1 && r.changed[0] === 'marks').length}`);
  console.log(`owner-owned (left alone): tags ${kept.tags}, serves ${kept.serves}, dishType ${kept.dishType}`);
  if (APPLY) {
    console.log(`applied: ${written} written, ${skipped} skipped`);
    if (skipped) process.exitCode = 1;
  } else writeReview(all);
}

function writeReview(rows: Row[]) {
  const img = (path?: string) => (path ? `<img loading="lazy" src="https://qareeb-dev.web.app/img/${path.split('/').map(encodeURIComponent).join('/')}" alt="">` : '<span class="noimg"></span>');
  const body = rows.map((r) => {
    const name = label(r.product.name);
    const biz = label(r.business.name);
    const type = r.values.dishType ?? '';
    const serves = r.values.serves ?? 1;
    const tags = r.values.tags ?? [];
    const changes = r.changed.join(', ');
    return `<tr data-q="${esc(`${name} ${biz} ${type} ${tags.join(' ')}`.toLowerCase())}" data-s0="${esc(name)}" data-s1="${esc(biz)}" data-s2="${type}" data-s3="${serves}" data-s4="${tags.join(' ')}" data-s5="${changes}"><td>${img(r.product.imagePath)}</td><td><b><bdi>${esc(name)}</bdi></b></td><td><bdi>${esc(biz)}</bdi></td><td>${type || '-'}</td><td>${serves}</td><td>${tags.map((t) => `<span class="tag">${t}</span>`).join(' ')}</td><td>${changes}</td></tr>`;
  }).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto-tag review</title><style>
body{font:14px system-ui,sans-serif;margin:0;padding:16px;background:#faf8f3;color:#1d2a22}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:start;vertical-align:middle}th[data-c]{cursor:pointer;user-select:none;white-space:nowrap}th[data-c]:hover{background:#efeae0}th[aria-sort=ascending]::after{content:' \\25B2'}th[aria-sort=descending]::after{content:' \\25BC'}img,.noimg{width:64px;height:64px;object-fit:cover;border-radius:10px;background:#e8efe9;display:block}.tag{display:inline-block;background:#e3efe6;border-radius:999px;padding:2px 8px;margin:2px}#f{margin-bottom:12px;padding:8px;width:min(400px,100%);box-sizing:border-box}
</style><h1>Auto-tag review - <span id="n">${rows.length}</span> dishes</h1><input id="f" type="search" placeholder="filter: dish, place, type or tag"><div style="overflow-x:auto"><table><thead><tr><th></th><th data-c="0">Dish</th><th data-c="1">Place</th><th data-c="2">Type</th><th data-c="3" data-num>Serves</th><th data-c="4">Tags</th><th data-c="5">Changes</th></tr></thead><tbody>${body}</tbody></table></div>
<script>
const tb=document.querySelector('tbody'),f=document.getElementById('f'),n=document.getElementById('n');
f.addEventListener('input',()=>{const q=f.value.trim().toLowerCase();let c=0;for(const tr of tb.rows){tr.hidden=!!q&&!tr.dataset.q.includes(q);if(!tr.hidden)c++}n.textContent=c});
for(const th of document.querySelectorAll('th[data-c]'))th.addEventListener('click',()=>{
  const c=th.dataset.c,num='num' in th.dataset,dir=th.getAttribute('aria-sort')==='ascending'?-1:1;
  for(const o of document.querySelectorAll('th[aria-sort]'))o.removeAttribute('aria-sort');
  th.setAttribute('aria-sort',dir===1?'ascending':'descending');
  const key=tr=>tr.dataset['s'+c],rows=[...tb.rows];
  rows.sort((a,b)=>dir*(num?key(a)-key(b):key(a).localeCompare(key(b))));
  tb.append(...rows)});
</script>`;
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/mockups/auto-tag-review/index.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`Review page: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
