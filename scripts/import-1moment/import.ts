/**
 * Import the 1moment Beit Jann stores (data/stores.json, from scrape.py) into qareeb-dev as HIDDEN
 * drafts: business + branch `approval: 'pending'`, `ownerUid: ''`, no membership and nothing under
 * publicBusinesses/publicBranches. An admin approves one after its owner claims it via an invitation.
 *
 * Ids are deterministic (`1m-<storeId>`, `1m-<itemId>`), so a re-run updates in place. Morano (22) and
 * 1moment's own market (65) are skipped. Photos: the original is uploaded as `orig.<ext>` unless the
 * product already has an image; apply-restyle.ts later swaps in the studio version.
 *
 *   cd functions && npx tsx ../scripts/import-1moment/import.ts            # dry run
 *   cd functions && npx tsx ../scripts/import-1moment/import.ts --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Branch, Business, Category, Localized, ModifierGroup, Product, Variant, WeeklyHours } from '../../packages/shared/src/types.ts';
import { DEFAULT_LOYALTY_RULES } from '../../packages/shared/src/index.ts';
import { productInputSchema } from '../../packages/shared/src/schemas.ts';

const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--store='))?.slice(8);
const SKIP = new Set(['22', '65']);
const IMG = 'https://dpelsox4eb9jh.cloudfront.net';

initializeApp({ projectId: 'qareeb-dev', storageBucket: 'qareeb-dev.firebasestorage.app' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const bucket = getStorage().bucket();
const now = new Date().toISOString();

type Raw = Record<string, any>;
const stores: Record<string, { store: Raw; items: Raw[] }> = JSON.parse(readFileSync(new URL('./data/stores.json', import.meta.url), 'utf8'));

/** Put text under the language its script is written in. */
function loc(text: string | null | undefined): Localized {
  const t = (text ?? '').trim();
  if (!t) return {};
  if (/[֐-׿]/.test(t)) return { he: t };
  if (/[؀-ۿ]/.test(t)) return { ar: t };
  return { en: t };
}
const agorot = (shekels: unknown) => Math.round(Number(shekels || 0) * 100);
const SIZE_GROUP = /^(גודל|גודל המנה|כמות|מספר יחידות|מידה|size|حجم)/i;

function hoursOf(store: Raw): WeeklyHours {
  const h: WeeklyHours = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] };
  const min = (t: string) => { const [a, b, c] = t.split(':').map(Number); return a * 60 + b + (c >= 59 ? 1 : 0); };
  for (const s of store.schedules ?? []) {
    const start = min(s.opening_time);
    let end = min(s.closing_time);
    if (end <= start) end += 1440;
    const day = h[String(s.day) as keyof WeeklyHours];
    if (day && day.length < 4) day.push({ startMin: start, endMin: Math.min(end, start + 1440) });
  }
  return h;
}

function optionsOf(item: Raw): { variants: Variant[]; groups: ModifierGroup[] } {
  const base = agorot(item.price);
  const variants: Variant[] = [];
  const groups: ModifierGroup[] = [];
  if (item.variations?.length) {
    item.variations.slice(0, 30).forEach((v: Raw, i: number) => variants.push({ id: `v${i}`, name: loc(v.type), priceAgorot: agorot(v.price), available: true, sortOrder: i }));
  }
  for (const [gi, g] of (item.food_variations ?? []).entries()) {
    const single = g.type === 'single';
    const required = g.required === 'on';
    if (single && !variants.length && SIZE_GROUP.test(g.name.trim())) {
      g.values.forEach((o: Raw, i: number) => variants.push({ id: `v${i}`, name: loc(o.label), priceAgorot: base + agorot(o.optionPrice), available: true, sortOrder: i }));
      continue;
    }
    const n = g.values.length;
    const max = single ? 1 : Math.min(Number(g.max) || n, n);
    const minSel = required ? (single ? 1 : Math.min(Math.max(1, Number(g.min) || 1), max)) : 0;
    groups.push({
      id: `g${gi}`, name: loc(g.name), required, minSelect: minSel, maxSelect: max, sortOrder: groups.length,
      options: g.values.map((o: Raw, i: number) => ({ id: `o${i}`, name: loc(o.label), priceDeltaAgorot: agorot(o.optionPrice), available: true, sortOrder: i })),
      ...(g.is_pizza === 'on' ? { placement: true } : {}),
    });
  }
  if (item.add_ons?.length) {
    const opts = item.add_ons.slice(0, 30);
    groups.push({
      id: 'addons', name: { he: 'תוספות', ar: 'إضافات', en: 'Add-ons' }, required: false, minSelect: 0, maxSelect: opts.length, sortOrder: groups.length,
      options: opts.map((a: Raw, i: number) => ({ id: `a${a.id}`, name: loc(a.name), priceDeltaAgorot: agorot(a.price), available: true, sortOrder: i })),
    });
  }
  return { variants, groups };
}

async function uploadFrom(url: string, path: string): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) return false;
  const type = res.headers.get('content-type') ?? 'image/png';
  await bucket.file(path).save(Buffer.from(await res.arrayBuffer()), { contentType: type, resumable: false });
  return true;
}
const ext = (name: string) => (name.split('.').pop() ?? 'png').toLowerCase().replace('jpeg', 'jpg');

const totals = { stores: 0, products: 0, photos: 0, invalid: 0 };
for (const [sid, { store, items }] of Object.entries(stores)) {
  if (SKIP.has(sid) || (ONLY && ONLY !== sid)) continue;
  const bizId = `1m-${sid}`;
  const brId = `1m-${sid}-main`;
  const bizRef = db.collection('businesses').doc(bizId);
  const brRef = bizRef.collection('branches').doc(brId);
  const existing = (await bizRef.get()).data() as Business | undefined;
  if (existing?.ownerUid) { console.log(`skip ${sid} ${store.name}: already claimed`); continue; }

  const business: Business = {
    id: bizId, type: store.module_id === 3 ? 'supermarket' : 'restaurant', name: loc(store.name), description: {}, defaultLocale: 'he',
    ownerUid: '', publicPhone: store.phone || undefined, approval: 'pending', approvalReason: 'imported from 1moment',
    loyalty: { ...DEFAULT_LOYALTY_RULES }, logoPath: existing?.logoPath, coverPath: existing?.coverPath, createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  const branch: Branch = {
    id: brId, businessId: bizId, name: { he: 'הסניף', ar: 'الفرع', en: 'Main' }, cityId: 'beit-jann', locationDescription: {},
    lat: Number(store.latitude) || undefined, lng: Number(store.longitude) || undefined, phone: store.phone || '', hours: hoursOf(store), hoursOverrides: [],
    pickupEnabled: true, dineInEnabled: false, deliveryEnabled: false, deliveryCities: [], ordersPaused: false, approval: 'pending', createdAt: now, updatedAt: now,
  };

  // Category = the item's most specific 1moment category, in first-seen order.
  const cats = new Map<string, Category>();
  const products: Product[] = [];
  for (const [i, it] of items.entries()) {
    const c = [...(it.category_ids ?? [])].sort((a: Raw, b: Raw) => b.position - a.position)[0] ?? { id: '0', name: 'כללי' };
    const catId = `1m-c${c.id}`;
    if (!cats.has(catId)) cats.set(catId, { id: catId, branchId: brId, name: loc(c.name), sortOrder: cats.size, archived: false });
    const { variants, groups } = optionsOf(it);
    const p: Product = {
      id: `1m-${it.id}`, branchId: brId, businessId: bizId, categoryId: catId, name: loc(it.name), description: loc(it.description), dietaryText: {},
      pricingMode: 'unit', priceAgorot: variants.length ? Math.min(...variants.map((v) => v.priceAgorot)) : agorot(it.price),
      unitLabel: {}, quantityStep: 1, minQuantity: 1, variants, modifierGroups: groups, available: it.status === 1, trackInventory: false,
      mostOrdered: false, inStories: false, archived: false, sortOrder: i, createdAt: now, updatedAt: now,
    };
    const { id: _i, branchId: _b, businessId: _z, imagePath: _p, createdAt: _c, updatedAt: _u, archived: _a, ...input } = p;
    const check = productInputSchema.safeParse(input);
    if (!check.success) { totals.invalid++; console.warn(`  invalid ${p.id} ${it.name}:`, check.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')); continue; }
    products.push(p);
  }
  totals.stores++; totals.products += products.length;
  console.log(`${sid} ${store.name}: ${business.type}, ${cats.size} categories, ${products.length}/${items.length} products`);
  if (!APPLY) continue;

  if (!business.logoPath && store.logo && await uploadFrom(`${IMG}/store/${store.logo}`, `businesses/${bizId}/logo-1m.${ext(store.logo)}`)) business.logoPath = `businesses/${bizId}/logo-1m.${ext(store.logo)}`;
  if (!business.coverPath && store.cover_photo && await uploadFrom(`${IMG}/store/cover/${store.cover_photo}`, `businesses/${bizId}/cover-1m.${ext(store.cover_photo)}`)) business.coverPath = `businesses/${bizId}/cover-1m.${ext(store.cover_photo)}`;
  await bizRef.set(business);
  await brRef.set(branch);
  if (!existing) await bizRef.collection('approvalHistory').add({ targetType: 'business', state: 'pending', reason: 'imported from 1moment', actorUid: 'import-1moment', at: now });
  let batch = db.batch(); let n = 0;
  const flush = async () => { if (n) await batch.commit(); batch = db.batch(); n = 0; };
  for (const c of cats.values()) { batch.set(brRef.collection('categories').doc(c.id), c); if (++n >= 400) await flush(); }
  const imgQueue: Array<() => Promise<void>> = [];
  for (const p of products) {
    const prev = (await brRef.collection('products').doc(p.id).get()).data() as Product | undefined;
    p.imagePath = prev?.imagePath;
    p.createdAt = prev?.createdAt ?? now;
    const raw = items.find((it) => `1m-${it.id}` === p.id)!;
    if (!p.imagePath && raw.image && !raw.image.includes('def')) {
      const path = `businesses/${bizId}/branches/${brId}/products/${p.id}/orig.${ext(raw.image)}`;
      imgQueue.push(async () => { if (await uploadFrom(`${IMG}/product/${raw.image}`, path).catch(() => false)) { p.imagePath = path; totals.photos++; } });
    }
  }
  for (let i = 0; i < imgQueue.length; i += 8) await Promise.all(imgQueue.slice(i, i + 8).map((f) => f()));
  for (const p of products) { batch.set(brRef.collection('products').doc(p.id), p); if (++n >= 400) await flush(); }
  await flush();
}
console.log(APPLY ? 'APPLIED' : 'DRY RUN', totals);
