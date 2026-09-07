/**
 * Seed-time projection (mirrors functions/src/lib/projections.ts semantics). Kept separate from the
 * functions bundle so the seed does not need the functions runtime.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { Branch, Business, Category, Product } from '@qareeb/shared';

function visible(b: Business, br: Branch): boolean {
  return b.approval === 'approved' && br.approval === 'approved';
}

export async function reprojectBusinessSeed(db: Firestore, businessId: string): Promise<void> {
  const b = (await db.collection('businesses').doc(businessId).get()).data() as Business;
  const branches = await db.collection('businesses').doc(businessId).collection('branches').get();
  const now = new Date().toISOString();
  const batch = db.batch();
  const anyVisible = branches.docs.some((d) => visible(b, d.data() as Branch));
  const pubBiz = db.collection('publicBusinesses').doc(businessId);
  if (anyVisible) {
    batch.set(pubBiz, { id: b.id, type: b.type, name: b.name, description: b.description, defaultLocale: b.defaultLocale, logoPath: b.logoPath, coverPath: b.coverPath, publicPhone: b.publicPhone, loyaltyEnabled: b.loyalty.enabled, loyaltyMaxDiscountPercent: b.loyalty.maxDiscountPercent, loyaltyRedeemValueAgorot: b.loyalty.redeemValueAgorot, loyaltyEarnPerAgorot: b.loyalty.earnPerAgorot, loyaltyPointsPerStep: b.loyalty.pointsPerStep, updatedAt: now });
  } else batch.delete(pubBiz);
  for (const d of branches.docs) {
    const br = d.data() as Branch;
    const ref = db.collection('publicBranches').doc(br.id);
    const vis = visible(b, br);
    if (!vis) {
      batch.delete(ref);
      continue;
    }
    batch.set(ref, { id: br.id, businessId: b.id, type: b.type, name: br.name, businessName: b.name, businessDefaultLocale: b.defaultLocale, logoPath: b.logoPath, coverPath: b.coverPath, cityId: br.cityId, locationDescription: br.locationDescription, lat: br.lat, lng: br.lng, phone: br.phone, hours: br.hours, hoursOverrides: br.hoursOverrides, pickupEnabled: br.pickupEnabled, deliveryEnabled: br.deliveryEnabled, deliveryCities: br.deliveryCities, deliveryCityIds: br.deliveryEnabled ? br.deliveryCities.map((c) => c.cityId) : [], ordersPaused: br.ordersPaused, visible: true, updatedAt: now });
    const cats = await d.ref.collection('categories').get();
    const prods = await d.ref.collection('products').get();
    for (const c of cats.docs) {
      const cat = c.data() as Category;
      if (!cat.archived) batch.set(ref.collection('categories').doc(cat.id), cat);
    }
    for (const p of prods.docs) {
      const prod = p.data() as Product;
      if (prod.archived) continue;
      const { stockQty, sku: _s, barcode: _b, ...rest } = prod;
      const inStock = !prod.trackInventory || (stockQty ?? 0) > 0 || prod.variants.some((v) => (v.stockQty ?? 0) > 0);
      batch.set(ref.collection('products').doc(prod.id), { ...rest, variants: prod.variants.map(({ stockQty: vs, sku: _vs, ...v }) => ({ ...v, available: v.available && (!prod.trackInventory || vs === undefined || vs > 0) })), inStock, available: prod.available && inStock, stockLeft: prod.trackInventory && stockQty !== undefined ? Math.min(stockQty, 10) : undefined });
    }
  }
  await batch.commit();
}
