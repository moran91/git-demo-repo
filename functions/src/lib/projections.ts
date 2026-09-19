import type { Branch, Business, Category, Combo, Product, Promotion } from '@qareeb/shared';
import { col, db, nowIso, type Tx } from './firebase.js';

/**
 * Public projections: what anonymous customers may read. Written only by the server, and only when
 * the business AND branch are approved. Private fields (exact stock, SKU cost, owner uid, approval
 * reasons) never appear here. Firestore rules are not query filters, so discovery queries read these
 * collections exclusively.
 */
export interface PublicBusinessDoc {
  id: string;
  type: Business['type'];
  name: Business['name'];
  description: Business['description'];
  defaultLocale: Business['defaultLocale'];
  logoPath?: string;
  coverPath?: string;
  publicPhone?: string;
  loyaltyEnabled: boolean;
  loyaltyMaxDiscountPercent: number;
  loyaltyRedeemValueAgorot: number;
  loyaltyEarnPerAgorot: number;
  loyaltyPointsPerStep: number;
  updatedAt: string;
}

export interface PublicBranchDoc {
  id: string;
  businessId: string;
  type: Business['type'];
  name: Branch['name'];
  businessName: Business['name'];
  businessDefaultLocale: Business['defaultLocale'];
  logoPath?: string;
  coverPath?: string;
  cityId: string;
  locationDescription: Branch['locationDescription'];
  lat?: number;
  lng?: number;
  phone: string;
  hours: Branch['hours'];
  hoursOverrides: Branch['hoursOverrides'];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryCities: Branch['deliveryCities'];
  deliveryCityIds: string[];
  ordersPaused: boolean;
  visible: boolean;
  updatedAt: string;
}

export type PublicProductDoc = Omit<Product, 'stockQty' | 'sku' | 'barcode'> & {
  /** Capped stock indicator for "only N left"; exact quantities stay private. */
  stockLeft?: number;
  inStock: boolean;
};

export function isPubliclyVisible(business: Business, branch: Branch): boolean {
  return business.approval === 'approved' && branch.approval === 'approved';
}

export function toPublicBusiness(b: Business): PublicBusinessDoc {
  return {
    id: b.id,
    type: b.type,
    name: b.name,
    description: b.description,
    defaultLocale: b.defaultLocale,
    logoPath: b.logoPath,
    coverPath: b.coverPath,
    publicPhone: b.publicPhone,
    loyaltyEnabled: b.loyalty.enabled,
    loyaltyMaxDiscountPercent: b.loyalty.maxDiscountPercent,
    loyaltyRedeemValueAgorot: b.loyalty.redeemValueAgorot,
    loyaltyEarnPerAgorot: b.loyalty.earnPerAgorot,
    loyaltyPointsPerStep: b.loyalty.pointsPerStep,
    updatedAt: nowIso(),
  };
}

/** Legacy branches saved delivery enabled with no delivery areas; treat that as "own city, free" so
 *  the branch is discoverable and orderable in delivery mode instead of silently vanishing. */
export function effectiveDeliveryCities(br: Pick<Branch, 'cityId' | 'deliveryEnabled' | 'deliveryCities'>): Branch['deliveryCities'] {
  return br.deliveryEnabled && br.deliveryCities.length === 0 ? [{ cityId: br.cityId, feeAgorot: 0, minSubtotalAgorot: 0 }] : br.deliveryCities;
}

export function toPublicBranch(b: Business, br: Branch): PublicBranchDoc {
  const deliveryCities = effectiveDeliveryCities(br);
  return {
    id: br.id,
    businessId: b.id,
    type: b.type,
    name: br.name,
    businessName: b.name,
    businessDefaultLocale: b.defaultLocale,
    logoPath: b.logoPath,
    coverPath: b.coverPath,
    cityId: br.cityId,
    locationDescription: br.locationDescription,
    lat: br.lat,
    lng: br.lng,
    phone: br.phone,
    hours: br.hours,
    hoursOverrides: br.hoursOverrides,
    pickupEnabled: br.pickupEnabled,
    deliveryEnabled: br.deliveryEnabled,
    deliveryCities,
    deliveryCityIds: br.deliveryEnabled ? deliveryCities.map((c) => c.cityId) : [],
    ordersPaused: br.ordersPaused,
    visible: isPubliclyVisible(b, br),
    updatedAt: nowIso(),
  };
}

export function toPublicProduct(p: Product): PublicProductDoc {
  const { stockQty, sku, barcode, ...rest } = p;
  void sku;
  void barcode;
  const inStock = !p.trackInventory || (stockQty ?? 0) > 0 || (p.variants.length > 0 && p.variants.some((v) => (v.stockQty ?? 0) > 0));
  // Products with variants keep their stock on the variants; the product-level counter stays 0 there,
  // so the "only N left" indicator has to come from the variants or it would always read zero.
  const remaining = p.variants.length > 0 ? p.variants.reduce((sum, v) => sum + (v.stockQty ?? 0), 0) : stockQty;
  return {
    ...rest,
    variants: p.variants.map(({ stockQty: vs, sku: _s, ...v }) => ({ ...v, stockQty: undefined, available: v.available && (!p.trackInventory || vs === undefined || vs > 0) })),
    inStock,
    available: p.available && inStock,
    stockLeft: p.trackInventory && remaining !== undefined ? Math.min(remaining, 10) : undefined,
  };
}

/** Re-projects a business and all of its branches (used after approval changes / profile edits). */
export async function reprojectBusiness(businessId: string): Promise<void> {
  const bSnap = await col.business(businessId).get();
  if (!bSnap.exists) return;
  const business = bSnap.data() as Business;
  const branches = await col.branches(businessId).get();
  const batch = db.batch();
  const anyVisible = branches.docs.some((d) => isPubliclyVisible(business, d.data() as Branch));
  if (anyVisible) batch.set(col.publicBusiness(businessId), toPublicBusiness(business));
  else batch.delete(col.publicBusiness(businessId));
  for (const d of branches.docs) {
    const br = d.data() as Branch;
    const pub = toPublicBranch(business, br);
    if (pub.visible) batch.set(col.publicBranch(br.id), pub);
    else batch.delete(col.publicBranch(br.id));
  }
  await batch.commit();
  for (const d of branches.docs) await reprojectCatalog(businessId, d.id);
}

export async function reprojectCatalog(businessId: string, branchId: string): Promise<void> {
  const [bSnap, brSnap] = await Promise.all([col.business(businessId).get(), col.branch(businessId, branchId).get()]);
  if (!bSnap.exists || !brSnap.exists) return;
  const visible = isPubliclyVisible(bSnap.data() as Business, brSnap.data() as Branch);
  const [cats, prods, combos, promos, pubCats, pubProds, pubCombos, pubPromos] = await Promise.all([
    col.categories(businessId, branchId).get(),
    col.products(businessId, branchId).get(),
    col.combos(businessId, branchId).get(),
    col.promotions(businessId, branchId).get(),
    col.publicCategories(branchId).get(),
    col.publicProducts(branchId).get(),
    col.publicCombos(branchId).get(),
    col.publicPromotions(branchId).get(),
  ]);
  const batch = db.batch();
  for (const d of pubCats.docs) batch.delete(d.ref);
  for (const d of pubProds.docs) batch.delete(d.ref);
  for (const d of pubCombos.docs) batch.delete(d.ref);
  for (const d of pubPromos.docs) batch.delete(d.ref);
  if (visible) {
    for (const d of combos.docs) {
      const c = d.data() as Combo;
      if (!c.archived && c.active) batch.set(col.publicCombos(branchId).doc(c.id), c);
    }
    for (const d of promos.docs) {
      const p = d.data() as Promotion;
      if (p.active) batch.set(col.publicPromotions(branchId).doc(p.id), p);
    }
    for (const d of cats.docs) {
      const c = d.data() as Category;
      if (!c.archived) batch.set(col.publicCategories(branchId).doc(c.id), c);
    }
    for (const d of prods.docs) {
      const p = d.data() as Product;
      if (!p.archived) batch.set(col.publicProducts(branchId).doc(p.id), toPublicProduct(p));
    }
  }
  await batch.commit();
}

/** Within a transaction: update a single product's public projection if the branch is visible. */
export function projectProductInTx(tx: Tx, business: Business, branch: Branch, product: Product): void {
  const ref = col.publicProducts(branch.id).doc(product.id);
  if (isPubliclyVisible(business, branch) && !product.archived) tx.set(ref, toPublicProduct(product));
  else tx.delete(ref);
}

export function projectComboInTx(tx: Tx, business: Business, branch: Branch, combo: Combo): void {
  const ref = col.publicCombos(branch.id).doc(combo.id);
  if (isPubliclyVisible(business, branch) && !combo.archived && combo.active) tx.set(ref, combo);
  else tx.delete(ref);
}

/** Active promotions are public; expiry is applied by the client so the projection needs no clock. */
export function projectPromotionInTx(tx: Tx, business: Business, branch: Branch, promotion: Promotion): void {
  const ref = col.publicPromotions(branch.id).doc(promotion.id);
  if (isPubliclyVisible(business, branch) && promotion.active) tx.set(ref, promotion);
  else tx.delete(ref);
}

export function projectCategoryInTx(tx: Tx, business: Business, branch: Branch, category: Category): void {
  const ref = col.publicCategories(branch.id).doc(category.id);
  if (isPubliclyVisible(business, branch) && !category.archived) tx.set(ref, category);
  else tx.delete(ref);
}

export function projectBranchInTx(tx: Tx, business: Business, branch: Branch): void {
  const pub = toPublicBranch(business, branch);
  if (pub.visible) tx.set(col.publicBranch(branch.id), pub);
  else tx.delete(col.publicBranch(branch.id));
}
