import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { MAX_PROMOTIONS, MAX_STORY_ITEMS, categoryInputSchema, cleanLocalized, comboInputSchema, idSchema, productInputSchema, promotionInputSchema, sharedModifierGroupInputSchema, makeId, type Branch, type Business, type Category, type Combo, type ModifierGroup, type Product, type Promotion, type SharedModifierGroup } from '@qareeb/shared';
import { REGION, col, db, nowIso, storage, commitInChunks } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller, requireMembership } from '../lib/auth.js';
import { isPubliclyVisible, projectCategoryInTx, projectComboInTx, projectProductInTx, projectPromotionInTx, reprojectCatalog, toPublicProduct } from '../lib/projections.js';
import { writeAudit } from '../lib/audit.js';
import { deleteImageWithVariants } from '../lib/images.js';

const opts = { region: REGION } as const;
const CATALOG_ROLES = ['owner', 'manager'] as const;

async function loadContext(tx: FirebaseFirestore.Transaction, businessId: string, branchId: string): Promise<{ business: Business; branch: Branch }> {
  const [b, br] = await Promise.all([tx.get(col.business(businessId)), tx.get(col.branch(businessId, branchId))]);
  if (!b.exists || !br.exists) fail('not_found');
  return { business: b.data() as Business, branch: br.data() as Branch };
}

export const saveCategory = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, categoryId: idSchema.optional(), category: categoryInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const ref = input.categoryId ? col.categories(input.businessId, input.branchId).doc(input.categoryId) : col.categories(input.businessId, input.branchId).doc();
  const category = await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const existing = await tx.get(ref);
    if (input.categoryId && !existing.exists) fail('not_found');
    const all = await tx.get(col.categories(input.businessId, input.branchId));
    const cat: Category = {
      id: ref.id,
      branchId: input.branchId,
      name: cleanLocalized(input.category.name),
      sortOrder: input.category.sortOrder ?? (existing.data() as Category | undefined)?.sortOrder ?? all.size,
      archived: (existing.data() as Category | undefined)?.archived ?? false,
    };
    tx.set(ref, cat);
    projectCategoryInTx(tx, ctx.business, ctx.branch, cat);
    return cat;
  });
  return { category };
}));

export const setCategoryArchived = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, categoryId: idSchema, archived: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.categories(input.businessId, input.branchId).doc(input.categoryId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    if (input.archived) {
      const live = await tx.get(col.products(input.businessId, input.branchId).where('categoryId', '==', input.categoryId).where('archived', '==', false).limit(1));
      if (!live.empty) fail('invalid_argument', { issues: [{ path: 'category', message: 'category_has_products' }] });
    }
    const cat = { ...(snap.data() as Category), archived: input.archived };
    tx.set(ref, cat);
    projectCategoryInTx(tx, ctx.business, ctx.branch, cat);
  });
  return { ok: true };
}));

export const reorderCategories = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, orderedIds: z.array(idSchema).min(1).max(200) }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const all = await tx.get(col.categories(input.businessId, input.branchId));
    const byId = new Map(all.docs.map((d) => [d.id, d.data() as Category]));
    input.orderedIds.forEach((id, i) => {
      const cat = byId.get(id);
      if (!cat) return;
      const next = { ...cat, sortOrder: i };
      tx.set(col.categories(input.businessId, input.branchId).doc(id), next);
      projectCategoryInTx(tx, ctx.business, ctx.branch, next);
    });
  });
  return { ok: true };
}));

/** The product-side copy of a library group: library content, product-side identity and position. */
function materializeShared(g: Pick<ModifierGroup, 'id' | 'sortOrder'>, s: SharedModifierGroup): ModifierGroup {
  return { id: g.id, sortOrder: g.sortOrder, sharedGroupId: s.id, name: s.name, required: s.required, minSelect: s.minSelect, maxSelect: s.maxSelect, options: s.options.map((o) => ({ ...o })), placement: s.placement };
}

function buildProduct(existing: Product | undefined, input: z.infer<typeof productInputSchema>, ids: { id: string; branchId: string; businessId: string }, now: string, shared: Map<string, SharedModifierGroup>, defaultSortOrder = 0): Product {
  if (input.pricingMode === 'weight' && input.variants.length > 0) fail('invalid_argument', { issues: [{ path: 'variants', message: 'weight_items_cannot_have_variants' }] });
  if (input.pricingMode === 'weight' && input.modifierGroups.length > 0) fail('invalid_argument', { issues: [{ path: 'modifierGroups', message: 'weight_items_cannot_have_modifiers' }] });
  const variants = input.variants.map((v, i) => ({ ...v, id: v.id ?? makeId(8), name: cleanLocalized(v.name), sortOrder: v.sortOrder ?? i }));
  const modifierGroups: ModifierGroup[] = input.modifierGroups.map((g, i) => {
    const id = g.id ?? makeId(8);
    // Array order is authoritative: client-side add/remove/move can leave stale or duplicate sortOrders.
    const sortOrder = i;
    if (g.sharedGroupId) {
      // Linked groups are owned by the library: whatever the client sent for the content is replaced
      // by the library's current version, so the product can never drift from it while linked.
      const s = shared.get(g.sharedGroupId);
      if (!s || s.archived) fail('invalid_argument', { issues: [{ path: 'modifierGroups', message: 'unknown_shared_group' }] });
      return materializeShared({ id, sortOrder }, s);
    }
    const { sharedGroupId: _none, ...rest } = g;
    return { ...rest, id, name: cleanLocalized(g.name), sortOrder, options: g.options.map((o, j) => ({ ...o, id: o.id ?? makeId(8), name: cleanLocalized(o.name), sortOrder: o.sortOrder ?? j })) };
  });
  const uniq = (arr: string[]) => new Set(arr).size === arr.length;
  if (!uniq(variants.map((v) => v.id)) || !uniq(modifierGroups.map((g) => g.id)) || modifierGroups.some((g) => !uniq(g.options.map((o) => o.id)))) {
    fail('invalid_argument', { issues: [{ path: 'ids', message: 'duplicate_ids' }] });
  }
  return {
    id: ids.id,
    branchId: ids.branchId,
    businessId: ids.businessId,
    categoryId: input.categoryId,
    name: cleanLocalized(input.name),
    description: cleanLocalized(input.description),
    dietaryText: cleanLocalized(input.dietaryText),
    imagePath: existing?.imagePath,
    pricingMode: input.pricingMode,
    priceAgorot: input.priceAgorot,
    estimatedGramsPerUnit: input.estimatedGramsPerUnit,
    weightStepGrams: input.pricingMode === 'weight' ? input.weightStepGrams ?? 100 : undefined,
    minWeightGrams: input.pricingMode === 'weight' ? input.minWeightGrams ?? input.weightStepGrams ?? 100 : undefined,
    brand: input.brand,
    sku: input.sku,
    barcode: input.barcode,
    packageSize: input.packageSize,
    unitLabel: cleanLocalized(input.unitLabel),
    quantityStep: input.quantityStep,
    minQuantity: input.minQuantity,
    variants,
    modifierGroups,
    available: input.available,
    trackInventory: input.trackInventory,
    // Stock is only changed through adjustStock (audited) once tracking exists, except initial set.
    stockQty: input.trackInventory ? (existing?.trackInventory ? existing.stockQty ?? input.stockQty ?? 0 : input.stockQty ?? 0) : undefined,
    mostOrdered: input.mostOrdered ?? false,
    // An older client that does not send the field keeps what the product had.
    inStories: input.inStories ?? existing?.inStories ?? false,
    archived: existing?.archived ?? false,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? defaultSortOrder,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export const saveProduct = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema.optional(), product: productInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const ref = input.productId ? col.products(input.businessId, input.branchId).doc(input.productId) : col.products(input.businessId, input.branchId).doc();
  const product = await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const catSnap = await tx.get(col.categories(input.businessId, input.branchId).doc(input.product.categoryId));
    if (!catSnap.exists) fail('invalid_argument', { issues: [{ path: 'categoryId', message: 'unknown_category' }] });
    const existingSnap = await tx.get(ref);
    if (input.productId && !existingSnap.exists) fail('not_found');
    // A new product goes to the end of the menu. Without this every product ties at sortOrder 0 and
    // the orderBy('sortOrder') lists fall back to document-id order, i.e. an arbitrary menu.
    let nextSortOrder = 0;
    if (!input.productId) {
      const count = await tx.get(col.products(input.businessId, input.branchId).limit(1000));
      if (count.size >= 1000) fail('invalid_argument', { issues: [{ path: 'product', message: 'too_many_products' }] });
      nextSortOrder = count.docs.reduce((next, doc) => Math.max(next, (doc.data().sortOrder ?? 0) + 1), 0);
    }
    const existing = existingSnap.data() as Product | undefined;
    const sharedIds = [...new Set(input.product.modifierGroups.map((g) => g.sharedGroupId).filter((x): x is string => !!x))];
    const sharedSnaps = await Promise.all(sharedIds.map((id) => tx.get(col.modifierGroups(input.businessId, input.branchId).doc(id))));
    const shared = new Map(sharedSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as SharedModifierGroup]));
    const now = nowIso();
    const p = buildProduct(existing, input.product, { id: ref.id, branchId: input.branchId, businessId: input.businessId }, now, shared, nextSortOrder);
    if (p.inStories && !existing?.inStories) await assertStoryRoom(tx, input.businessId, input.branchId, ref.id);
    tx.set(ref, p);
    projectProductInTx(tx, ctx.business, ctx.branch, p);
    return p;
  });
  return { product };
}));

export const setProductArchived = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, archived: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const p = { ...(snap.data() as Product), archived: input.archived, updatedAt: nowIso() };
    tx.set(ref, p);
    projectProductInTx(tx, ctx.business, ctx.branch, p);
  });
  return { ok: true };
}));

/** Change availability without overwriting another editor's product fields. */
export const setProductAvailable = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, available: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const product = { ...(snap.data() as Product), available: input.available, updatedAt: nowIso() };
    tx.set(ref, product);
    projectProductInTx(tx, ctx.business, ctx.branch, product);
  });
  return { ok: true };
}));

export const reorderProducts = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, orderedIds: z.array(idSchema).min(1).max(500) }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const snaps = await Promise.all(input.orderedIds.map((id) => tx.get(col.products(input.businessId, input.branchId).doc(id))));
    snaps.forEach((s, i) => {
      if (!s.exists) return;
      const p = { ...(s.data() as Product), sortOrder: i };
      tx.set(s.ref, p);
      projectProductInTx(tx, ctx.business, ctx.branch, p);
    });
  });
  return { ok: true };
}));

/** Audited stock adjustment (owners/managers). Reservations by orders happen in the order transaction. */
export const adjustStock = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, variantId: idSchema.optional(), newQty: z.number().int().min(0).max(1_000_000), reason: z.string().trim().min(1).max(200) }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const p = snap.data() as Product;
    if (!p.trackInventory) fail('invalid_argument', { issues: [{ path: 'productId', message: 'not_tracked' }] });
    let before: number | undefined;
    let next: Product;
    if (input.variantId) {
      const v = p.variants.find((x) => x.id === input.variantId);
      if (!v) fail('not_found');
      before = v.stockQty;
      next = { ...p, variants: p.variants.map((x) => (x.id === input.variantId ? { ...x, stockQty: input.newQty } : x)), updatedAt: nowIso() };
    } else {
      before = p.stockQty;
      next = { ...p, stockQty: input.newQty, updatedAt: nowIso() };
    }
    tx.set(ref, next);
    projectProductInTx(tx, ctx.business, ctx.branch, next);
    writeAudit(tx, { actorUid: c.uid, action: 'stock.adjust', targetType: 'product', targetId: `${input.branchId}/${input.productId}${input.variantId ? '/' + input.variantId : ''}`, reason: input.reason, before: { stockQty: before }, after: { stockQty: input.newQty } });
  });
  return { ok: true };
}));

/** Records the uploaded image path (client uploads to businesses/{businessId}/branches/{branchId}/products/{productId}/...). */
export const setProductImage = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  // `path` is stripped when the client sends null (see stripNulls), so absent also means "clear".
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, path: z.string().max(400).nullable().optional() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const prefix = `businesses/${input.businessId}/branches/${input.branchId}/products/${input.productId}/`;
  if (input.path && !input.path.startsWith(prefix)) fail('invalid_argument', { issues: [{ path: 'path', message: 'wrong_tenant_path' }] });
  let removed: string | undefined;
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const p = snap.data() as Product;
    if (input.path) {
      // Validate the uploaded object: content type and size are re-checked server-side.
      const [meta] = await storage.bucket().file(input.path).getMetadata().catch(() => [undefined]);
      if (!meta) fail('invalid_argument', { issues: [{ path: 'path', message: 'missing_object' }] });
      const ct = String(meta.contentType ?? '');
      const size = Number(meta.size ?? 0);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct) || size > 5 * 1024 * 1024) fail('invalid_argument', { issues: [{ path: 'path', message: 'invalid_image' }] });
    }
    if (p.imagePath && p.imagePath !== input.path) removed = p.imagePath;
    const next = { ...p, imagePath: input.path ?? undefined, updatedAt: nowIso() };
    tx.set(ref, next);
    projectProductInTx(tx, ctx.business, ctx.branch, next);
  });
  if (removed) await deleteImageWithVariants(removed);
  return { ok: true };
}));

/** Explicit independent copy of one product (or a whole catalog) into another branch of the same business. */
export const copyToBranch = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, fromBranchId: idSchema, toBranchId: idSchema, productId: idSchema.optional() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.fromBranchId);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.toBranchId);
  if (input.fromBranchId === input.toBranchId) fail('invalid_argument', { issues: [{ path: 'toBranchId', message: 'same_branch' }] });
  const [srcCats, srcProds, dstCats, dstProds, destination] = await Promise.all([
    col.categories(input.businessId, input.fromBranchId).where('archived', '==', false).get(),
    input.productId ? col.products(input.businessId, input.fromBranchId).doc(input.productId).get().then((s) => (s.exists ? [s] : [])) : col.products(input.businessId, input.fromBranchId).where('archived', '==', false).get().then((q) => q.docs),
    col.categories(input.businessId, input.toBranchId).get(),
    col.products(input.businessId, input.toBranchId).get(),
    col.branch(input.businessId, input.toBranchId).get(),
  ]);
  if (!destination.exists) fail('not_found');
  if (input.productId && srcProds.length === 0) fail('not_found');
  if (dstProds.size + srcProds.length > 1000) fail('invalid_argument', { issues: [{ path: 'product', message: 'too_many_products' }] });
  const now = nowIso();
  // Queued and committed in chunks: one batch is capped at 500 operations, and a branch can hold 1000
  // products, so a full copy used to fail outright with a generic error.
  const ops: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  // Map source categories to destination categories by identical name (create when missing).
  const nameKey = (name: Category['name']) => JSON.stringify(Object.entries(name).sort(([a], [b]) => a.localeCompare(b)));
  const dstByName = new Map(dstCats.docs.filter((d) => !d.data().archived).map((d) => [nameKey((d.data() as Category).name), d.id]));
  const catMap = new Map<string, string>();
  let sort = dstCats.docs.reduce((next, d) => Math.max(next, (d.data().sortOrder ?? 0) + 1), 0);
  let productSort = dstProds.docs.reduce((next, d) => Math.max(next, (d.data().sortOrder ?? 0) + 1), 0);
  const usedCategories = new Set(srcProds.map((d) => (d.data() as Product).categoryId));
  for (const d of [...srcCats.docs].sort((a, b) => a.data().sortOrder - b.data().sortOrder)) {
    const cat = d.data() as Category;
    if (!usedCategories.has(cat.id)) continue;
    const key = nameKey(cat.name);
    let id = dstByName.get(key);
    if (!id) {
      const ref = col.categories(input.businessId, input.toBranchId).doc();
      id = ref.id;
      const cs = { ...cat, id, branchId: input.toBranchId, sortOrder: sort++ } satisfies Category;
      ops.push((b) => b.set(ref, cs));
      dstByName.set(key, id);
    }
    catMap.set(cat.id, id);
  }
  let copied = 0;
  for (const d of [...srcProds].sort((a, b) => (a.data() as Product).sortOrder - (b.data() as Product).sortOrder)) {
    const p = d.data() as Product;
    const ref = col.products(input.businessId, input.toBranchId).doc();
    const categoryId = catMap.get(p.categoryId);
    if (!categoryId) continue;
    // Images are not duplicated (tenant path is branch-scoped); the copy starts without a photo.
    // Library links are branch-scoped; the copy keeps the current content as independent groups.
    const modifierGroups = p.modifierGroups.map(({ sharedGroupId: _s, ...g }) => g);
    const variants = p.variants.map((v) => ({ ...v, stockQty: p.trackInventory ? 0 : undefined }));
    const next = { ...p, id: ref.id, branchId: input.toBranchId, categoryId, modifierGroups, variants, sortOrder: productSort++, imagePath: undefined, inStories: false, stockQty: p.trackInventory ? 0 : undefined, createdAt: now, updatedAt: now } satisfies Product;
    ops.push((b) => b.set(ref, next));
    copied++;
  }
  await commitInChunks(ops);
  await reprojectCatalog(input.businessId, input.toBranchId);
  return { copied };
}));

// ---------- shared extras library ----------

/** Rewrites the materialised copy in every product linked to `group`; returns how many were updated. */
async function syncLinkedProducts(businessId: string, branchId: string, group: SharedModifierGroup): Promise<number> {
  const [bSnap, brSnap, prods] = await Promise.all([col.business(businessId).get(), col.branch(businessId, branchId).get(), col.products(businessId, branchId).get()]);
  if (!bSnap.exists || !brSnap.exists) return 0;
  const visible = isPubliclyVisible(bSnap.data() as Business, brSnap.data() as Branch);
  const now = nowIso();
  const linked = prods.docs.map((d) => d.data() as Product).filter((p) => p.modifierGroups.some((g) => g.sharedGroupId === group.id));
  // 2 writes per product (private + public); stay under the 500-op batch limit.
  for (let i = 0; i < linked.length; i += 200) {
    const batch = db.batch();
    for (const p of linked.slice(i, i + 200)) {
      const next: Product = { ...p, modifierGroups: p.modifierGroups.map((g) => (g.sharedGroupId === group.id ? materializeShared(g, group) : g)), updatedAt: now };
      batch.set(col.products(businessId, branchId).doc(p.id), next);
      const pub = col.publicProducts(branchId).doc(p.id);
      if (visible && !next.archived) batch.set(pub, toPublicProduct(next));
      else batch.delete(pub);
    }
    await batch.commit();
  }
  return linked.length;
}

export const saveSharedModifierGroup = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, groupId: idSchema.optional(), group: sharedModifierGroupInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const ref = input.groupId ? col.modifierGroups(input.businessId, input.branchId).doc(input.groupId) : col.modifierGroups(input.businessId, input.branchId).doc();
  const group = await db.runTransaction(async (tx) => {
    await loadContext(tx, input.businessId, input.branchId);
    const existingSnap = await tx.get(ref);
    if (input.groupId && !existingSnap.exists) fail('not_found');
    let nextSortOrder = 0;
    if (!input.groupId) {
      const count = await tx.get(col.modifierGroups(input.businessId, input.branchId).limit(200));
      if (count.size >= 200) fail('invalid_argument', { issues: [{ path: 'group', message: 'too_many_groups' }] });
      nextSortOrder = count.docs.reduce((next, doc) => Math.max(next, (doc.data().sortOrder ?? 0) + 1), 0);
    }
    const existing = existingSnap.data() as SharedModifierGroup | undefined;
    const options = input.group.options.map((o, j) => ({ ...o, id: o.id ?? makeId(8), name: cleanLocalized(o.name), sortOrder: o.sortOrder ?? j }));
    if (new Set(options.map((o) => o.id)).size !== options.length) fail('invalid_argument', { issues: [{ path: 'ids', message: 'duplicate_ids' }] });
    const now = nowIso();
    const g: SharedModifierGroup = {
      id: ref.id,
      businessId: input.businessId,
      branchId: input.branchId,
      name: cleanLocalized(input.group.name),
      required: input.group.required,
      minSelect: input.group.minSelect,
      maxSelect: input.group.maxSelect,
      options,
      placement: input.group.placement,
      sortOrder: input.group.sortOrder ?? existing?.sortOrder ?? nextSortOrder,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(ref, g);
    return g;
  });
  // Fan-out happens after the library write so a product saved concurrently re-reads the new version.
  const linkedProducts = input.groupId ? await syncLinkedProducts(input.businessId, input.branchId, group) : 0;
  return { group, linkedProducts };
}));

export const setSharedModifierGroupArchived = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, groupId: idSchema, archived: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    await loadContext(tx, input.businessId, input.branchId);
    const ref = col.modifierGroups(input.businessId, input.branchId).doc(input.groupId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    if (input.archived) {
      // Like categories: an archived library group must not leave dangling links behind.
      const prods = await tx.get(col.products(input.businessId, input.branchId).where('archived', '==', false));
      if (prods.docs.some((d) => (d.data() as Product).modifierGroups.some((g) => g.sharedGroupId === input.groupId))) {
        fail('invalid_argument', { issues: [{ path: 'group', message: 'shared_group_in_use' }] });
      }
    }
    tx.set(ref, { ...(snap.data() as SharedModifierGroup), archived: input.archived, updatedAt: nowIso() });
  });
  return { ok: true };
}));
/** Refuses a branch's next story item once `MAX_STORY_ITEMS` are featured (reads must precede writes). */
async function assertStoryRoom(tx: FirebaseFirestore.Transaction, businessId: string, branchId: string, productId: string): Promise<void> {
  const featured = await tx.get(col.products(businessId, branchId).where('inStories', '==', true).limit(MAX_STORY_ITEMS + 1));
  if (featured.docs.filter((d) => d.id !== productId && !(d.data() as Product).archived).length >= MAX_STORY_ITEMS) {
    fail('invalid_argument', { issues: [{ path: 'inStories', message: 'too_many_story_items' }] });
  }
}

/** Features a menu item in the branch's stories, or takes it out (owners and managers of the branch). */
export const setProductInStories = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, inStories: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const current = snap.data() as Product;
    if (input.inStories && !current.inStories) await assertStoryRoom(tx, input.businessId, input.branchId, input.productId);
    const p = { ...current, inStories: input.inStories, updatedAt: nowIso() };
    tx.set(ref, p);
    projectProductInTx(tx, ctx.business, ctx.branch, p);
  });
  return { ok: true };
}));

/** Owner-controlled "Most ordered" highlight (owners and managers of the branch). */
export const setProductMostOrdered = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, mostOrdered: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.products(input.businessId, input.branchId).doc(input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const p = { ...(snap.data() as Product), mostOrdered: input.mostOrdered, updatedAt: nowIso() };
    tx.set(ref, p);
    projectProductInTx(tx, ctx.business, ctx.branch, p);
  });
  return { ok: true };
}));

/** ---------- Combo deals ---------- */

export const saveCombo = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, comboId: idSchema.optional(), combo: comboInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const ref = input.comboId ? col.combos(input.businessId, input.branchId).doc(input.comboId) : col.combos(input.businessId, input.branchId).doc();
  const combo = await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const existingSnap = await tx.get(ref);
    if (input.comboId && !existingSnap.exists) fail('not_found');
    let nextSortOrder = 0;
    if (!input.comboId) {
      const count = await tx.get(col.combos(input.businessId, input.branchId).limit(100));
      nextSortOrder = count.docs.reduce((next, doc) => Math.max(next, (doc.data().sortOrder ?? 0) + 1), 0);
    }
    // Every bundled item must be a live, unit-priced product of this branch (weight items cannot be bundled).
    const seen = new Set<string>();
    let sum = 0;
    for (const it of input.combo.items) {
      const key = `${it.productId}:${it.variantId ?? ''}`;
      if (seen.has(key)) fail('invalid_argument', { issues: [{ path: 'items', message: 'duplicate_item' }] });
      seen.add(key);
      const ps = await tx.get(col.products(input.businessId, input.branchId).doc(it.productId));
      const p = ps.data() as Product | undefined;
      if (!p || p.archived) fail('invalid_argument', { issues: [{ path: 'items', message: 'unknown_product', productId: it.productId }] });
      if (p.pricingMode !== 'unit') fail('invalid_argument', { issues: [{ path: 'items', message: 'weight_items_cannot_be_bundled', productId: it.productId }] });
      const v = p.variants.find((x) => x.id === it.variantId);
      if (p.variants.length > 0 && !v) fail('invalid_argument', { issues: [{ path: 'items', message: 'variant_required', productId: it.productId }] });
      sum += (v?.priceAgorot ?? p.priceAgorot) * it.quantity;
    }
    // A combo that costs more than its members bought separately is a mistake, not a bundle.
    if (input.combo.priceAgorot > sum) fail('invalid_argument', { issues: [{ path: 'priceAgorot', message: 'price_above_items', itemsSumAgorot: sum }] });
    const existing = existingSnap.data() as Combo | undefined;
    const now = nowIso();
    const doc: Combo = {
      id: ref.id,
      businessId: input.businessId,
      branchId: input.branchId,
      name: cleanLocalized(input.combo.name),
      description: cleanLocalized(input.combo.description),
      items: input.combo.items,
      priceAgorot: input.combo.priceAgorot,
      imagePath: existing?.imagePath,
      promoted: input.combo.promoted,
      active: input.combo.active,
      archived: existing?.archived ?? false,
      sortOrder: input.combo.sortOrder ?? existing?.sortOrder ?? nextSortOrder,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(ref, doc);
    projectComboInTx(tx, ctx.business, ctx.branch, doc);
    writeAudit(tx, { actorUid: c.uid, action: 'combo.save', targetType: 'combo', targetId: `${input.branchId}/${ref.id}`, before: existing, after: doc });
    return doc;
  });
  return { combo };
}));

export const setComboArchived = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, comboId: idSchema, archived: z.boolean() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.combos(input.businessId, input.branchId).doc(input.comboId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const combo = { ...(snap.data() as Combo), archived: input.archived, updatedAt: nowIso() };
    tx.set(ref, combo);
    projectComboInTx(tx, ctx.business, ctx.branch, combo);
  });
  return { ok: true };
}));

/**
 * Permanently deletes a combo, its public projection and its promo image. Past orders keep their own
 * line snapshots, so nothing else references the document.
 */
export const deleteCombo = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, comboId: idSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  let imagePath: string | undefined;
  await db.runTransaction(async (tx) => {
    const ref = col.combos(input.businessId, input.branchId).doc(input.comboId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const combo = snap.data() as Combo;
    imagePath = combo.imagePath;
    tx.delete(ref);
    tx.delete(col.publicCombos(input.branchId).doc(input.comboId));
    writeAudit(tx, { actorUid: c.uid, action: 'combo.delete', targetType: 'combo', targetId: `${input.branchId}/${input.comboId}`, before: combo, after: undefined });
  });
  if (imagePath) await deleteImageWithVariants(imagePath);
  return { ok: true };
}));

/** Records the locally generated promo image uploaded to businesses/{b}/branches/{br}/combos/{id}/; an absent/null path clears it (nulls are stripped before parsing). */
export const setComboImage = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, comboId: idSchema, path: z.string().max(400).optional() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const prefix = `businesses/${input.businessId}/branches/${input.branchId}/combos/${input.comboId}/`;
  if (input.path && !input.path.startsWith(prefix)) fail('invalid_argument', { issues: [{ path: 'path', message: 'wrong_tenant_path' }] });
  let removed: string | undefined;
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.combos(input.businessId, input.branchId).doc(input.comboId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const combo = snap.data() as Combo;
    if (input.path) {
      const [meta] = await storage.bucket().file(input.path).getMetadata().catch(() => [undefined]);
      if (!meta) fail('invalid_argument', { issues: [{ path: 'path', message: 'missing_object' }] });
      const ct = String(meta.contentType ?? '');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct) || Number(meta.size ?? 0) > 5 * 1024 * 1024) fail('invalid_argument', { issues: [{ path: 'path', message: 'invalid_image' }] });
    }
    if (combo.imagePath && combo.imagePath !== input.path) removed = combo.imagePath;
    const next = { ...combo, imagePath: input.path ?? undefined, updatedAt: nowIso() };
    tx.set(ref, next);
    projectComboInTx(tx, ctx.business, ctx.branch, next);
  });
  if (removed) await deleteImageWithVariants(removed);
  return { ok: true };
}));

/** ---------- Limited-time promotions ---------- */

/**
 * Upsert one promotion of a branch. Owners and managers of the branch; capped per branch so the
 * storefront strip stays short. Featured products must be live products of the same branch.
 */
export const savePromotion = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, promotionId: idSchema.optional(), promotion: promotionInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const ref = input.promotionId ? col.promotions(input.businessId, input.branchId).doc(input.promotionId) : col.promotions(input.businessId, input.branchId).doc();
  const promotion = await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const existingSnap = await tx.get(ref);
    if (input.promotionId && !existingSnap.exists) fail('not_found');
    const all = await tx.get(col.promotions(input.businessId, input.branchId));
    if (!existingSnap.exists && all.size >= MAX_PROMOTIONS) fail('invalid_argument', { issues: [{ path: 'promotion', message: 'too_many_promotions' }] });
    const productIds = Array.from(new Set(input.promotion.productIds));
    for (const productId of productIds) {
      const ps = await tx.get(col.products(input.businessId, input.branchId).doc(productId));
      const p = ps.data() as Product | undefined;
      if (!p || p.archived) fail('invalid_argument', { issues: [{ path: 'productIds', message: 'unknown_product', productId }] });
    }
    const existing = existingSnap.data() as Promotion | undefined;
    const now = nowIso();
    const doc: Promotion = {
      id: ref.id,
      businessId: input.businessId,
      branchId: input.branchId,
      title: cleanLocalized(input.promotion.title),
      body: cleanLocalized(input.promotion.body),
      productIds,
      imagePath: existing?.imagePath,
      endsAt: input.promotion.endsAt,
      active: input.promotion.active,
      sortOrder: existing?.sortOrder ?? (all.empty ? 0 : Math.max(...all.docs.map((d) => (d.data() as Promotion).sortOrder)) + 1),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(ref, doc);
    projectPromotionInTx(tx, ctx.business, ctx.branch, doc);
    writeAudit(tx, { actorUid: c.uid, action: existing ? 'promotion.update' : 'promotion.create', targetType: 'promotion', targetId: `${input.branchId}/${ref.id}`, before: existing, after: doc });
    return doc;
  });
  return { promotion };
}));

/** Permanently removes a promotion, its public projection and its banner. */
export const removePromotion = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, promotionId: idSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  let imagePath: string | undefined;
  await db.runTransaction(async (tx) => {
    const ref = col.promotions(input.businessId, input.branchId).doc(input.promotionId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const promotion = snap.data() as Promotion;
    imagePath = promotion.imagePath;
    tx.delete(ref);
    tx.delete(col.publicPromotions(input.branchId).doc(input.promotionId));
    writeAudit(tx, { actorUid: c.uid, action: 'promotion.remove', targetType: 'promotion', targetId: `${input.branchId}/${input.promotionId}`, before: promotion, after: undefined });
  });
  if (imagePath) await deleteImageWithVariants(imagePath);
  return { ok: true };
}));

/** Records a banner uploaded to businesses/{b}/branches/{br}/promotions/{id}/; an absent/null path clears it (nulls are stripped before parsing). */
export const setPromotionImage = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, promotionId: idSchema, path: z.string().max(400).optional() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.branchId);
  const prefix = `businesses/${input.businessId}/branches/${input.branchId}/promotions/${input.promotionId}/`;
  if (input.path && !input.path.startsWith(prefix)) fail('invalid_argument', { issues: [{ path: 'path', message: 'wrong_tenant_path' }] });
  let removed: string | undefined;
  await db.runTransaction(async (tx) => {
    const ctx = await loadContext(tx, input.businessId, input.branchId);
    const ref = col.promotions(input.businessId, input.branchId).doc(input.promotionId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not_found');
    const promotion = snap.data() as Promotion;
    if (input.path) {
      const [meta] = await storage.bucket().file(input.path).getMetadata().catch(() => [undefined]);
      if (!meta) fail('invalid_argument', { issues: [{ path: 'path', message: 'missing_object' }] });
      const ct = String(meta.contentType ?? '');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct) || Number(meta.size ?? 0) > 5 * 1024 * 1024) fail('invalid_argument', { issues: [{ path: 'path', message: 'invalid_image' }] });
    }
    if (promotion.imagePath && promotion.imagePath !== input.path) removed = promotion.imagePath;
    const next = { ...promotion, imagePath: input.path ?? undefined, updatedAt: nowIso() };
    tx.set(ref, next);
    projectPromotionInTx(tx, ctx.business, ctx.branch, next);
  });
  if (removed) await deleteImageWithVariants(removed);
  return { ok: true };
}));
