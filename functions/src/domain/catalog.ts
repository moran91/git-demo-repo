import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { categoryInputSchema, cleanLocalized, idSchema, productInputSchema, makeId, type Branch, type Business, type Category, type Product } from '@qareeb/shared';
import { REGION, col, db, nowIso, storage } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller, requireMembership } from '../lib/auth.js';
import { projectCategoryInTx, projectProductInTx, reprojectCatalog } from '../lib/projections.js';
import { writeAudit } from '../lib/audit.js';

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

function buildProduct(existing: Product | undefined, input: z.infer<typeof productInputSchema>, ids: { id: string; branchId: string; businessId: string }, now: string): Product {
  if (input.pricingMode === 'weight' && input.variants.length > 0) fail('invalid_argument', { issues: [{ path: 'variants', message: 'weight_items_cannot_have_variants' }] });
  if (input.pricingMode === 'weight' && input.modifierGroups.length > 0) fail('invalid_argument', { issues: [{ path: 'modifierGroups', message: 'weight_items_cannot_have_modifiers' }] });
  const variants = input.variants.map((v, i) => ({ ...v, id: v.id ?? makeId(8), name: cleanLocalized(v.name), sortOrder: v.sortOrder ?? i }));
  const modifierGroups = input.modifierGroups.map((g, i) => ({
    ...g,
    id: g.id ?? makeId(8),
    name: cleanLocalized(g.name),
    sortOrder: g.sortOrder ?? i,
    options: g.options.map((o, j) => ({ ...o, id: o.id ?? makeId(8), name: cleanLocalized(o.name), sortOrder: o.sortOrder ?? j })),
  }));
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
    archived: existing?.archived ?? false,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
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
    if (!input.productId) {
      const count = await tx.get(col.products(input.businessId, input.branchId).limit(1000));
      if (count.size >= 1000) fail('invalid_argument', { issues: [{ path: 'product', message: 'too_many_products' }] });
    }
    const existing = existingSnap.data() as Product | undefined;
    const now = nowIso();
    const p = buildProduct(existing, input.product, { id: ref.id, branchId: input.branchId, businessId: input.businessId }, now);
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
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, productId: idSchema, path: z.string().max(400).nullable() }).strict(), req.data);
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
  if (removed) await storage.bucket().file(removed).delete({ ignoreNotFound: true }).catch(() => undefined);
  return { ok: true };
}));

/** Explicit independent copy of one product (or a whole catalog) into another branch of the same business. */
export const copyToBranch = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, fromBranchId: idSchema, toBranchId: idSchema, productId: idSchema.optional() }).strict(), req.data);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.fromBranchId);
  await requireMembership(c, input.businessId, [...CATALOG_ROLES], input.toBranchId);
  if (input.fromBranchId === input.toBranchId) fail('invalid_argument', { issues: [{ path: 'toBranchId', message: 'same_branch' }] });
  const [srcCats, srcProds, dstCats] = await Promise.all([
    col.categories(input.businessId, input.fromBranchId).where('archived', '==', false).get(),
    input.productId ? col.products(input.businessId, input.fromBranchId).doc(input.productId).get().then((s) => (s.exists ? [s] : [])) : col.products(input.businessId, input.fromBranchId).where('archived', '==', false).get().then((q) => q.docs),
    col.categories(input.businessId, input.toBranchId).get(),
  ]);
  if (input.productId && srcProds.length === 0) fail('not_found');
  const now = nowIso();
  const batch = db.batch();
  // Map source categories to destination categories by identical name (create when missing).
  const dstByName = new Map(dstCats.docs.map((d) => [JSON.stringify((d.data() as Category).name), d.id]));
  const catMap = new Map<string, string>();
  let sort = dstCats.size;
  for (const d of srcCats.docs) {
    const cat = d.data() as Category;
    const key = JSON.stringify(cat.name);
    let id = dstByName.get(key);
    if (!id) {
      const ref = col.categories(input.businessId, input.toBranchId).doc();
      id = ref.id;
      batch.set(ref, { ...cat, id, branchId: input.toBranchId, sortOrder: sort++ } satisfies Category);
      dstByName.set(key, id);
    }
    catMap.set(cat.id, id);
  }
  let copied = 0;
  for (const d of srcProds) {
    const p = d.data() as Product;
    const ref = col.products(input.businessId, input.toBranchId).doc();
    const categoryId = catMap.get(p.categoryId);
    if (!categoryId) continue;
    // Images are not duplicated (tenant path is branch-scoped); the copy starts without a photo.
    batch.set(ref, { ...p, id: ref.id, branchId: input.toBranchId, categoryId, imagePath: undefined, stockQty: p.trackInventory ? 0 : undefined, createdAt: now, updatedAt: now } satisfies Product);
    copied++;
  }
  await batch.commit();
  await reprojectCatalog(input.businessId, input.toBranchId);
  return { copied };
}));
