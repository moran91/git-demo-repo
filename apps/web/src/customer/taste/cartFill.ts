import { doc, getDoc } from 'firebase/firestore';
import { availableFulfillmentModes, makeId, priceLine, type CartLine, type CartModifierSelection, type Localized, type OrderLine } from '@qareeb/shared';
import { db } from '@/lib/firebase';
import { addLine, cartBelongsTo, cartStore, type CartState } from '@/lib/cart';
import type { PublicProduct } from '../BusinessPage';
import type { PublicBranch, PublicBusiness } from '../hooks';

export interface FilledLine { line: CartLine; meta: CartState['lineMeta'][string] }

export async function loadPlace(branch: PublicBranch, productIds: string[]): Promise<{ business: PublicBusiness; products: Map<string, PublicProduct> }> {
  const [bSnap, ...pSnaps] = await Promise.all([getDoc(doc(db, `publicBusinesses/${branch.businessId}`)), ...productIds.map((id) => getDoc(doc(db, `publicBranches/${branch.id}/products/${id}`)))]);
  if (!bSnap.exists()) throw new Error('missing business');
  const products = new Map<string, PublicProduct>();
  for (const s of pSnaps) if (s.exists()) products.set(s.id, { ...(s.data() as PublicProduct), id: s.id });
  return { business: { ...(bSnap.data() as PublicBusiness), id: bSnap.id }, products };
}

/** The line's real unit price from the menu, or null when the menu no longer allows it. */
function priced(product: PublicProduct, draft: Omit<CartLine, 'expectedUnitPriceAgorot'>): CartLine | null {
  const probe = priceLine(product, { ...draft, expectedUnitPriceAgorot: -1 });
  if (!probe.problem || probe.problem.code !== 'price_changed') return null;
  const line = { ...draft, expectedUnitPriceAgorot: (probe.problem as { actual: number }).actual };
  return priceLine(product, line).problem ? null : line;
}

function meta(product: PublicProduct, line: CartLine, modifierNames: Localized[]): FilledLine['meta'] {
  return {
    name: product.name,
    variantName: product.variants.find((v) => v.id === line.variantId)?.name,
    modifierNames,
    unitLabel: product.unitLabel,
    pricingMode: product.pricingMode,
    imagePath: product.imagePath,
    weightStepGrams: product.weightStepGrams,
    minWeightGrams: product.minWeightGrams,
    quantityStep: product.quantityStep,
    minQuantity: product.minQuantity,
  };
}

/**
 * A meal's dish as a cart line: the cheapest available size and, for each required group, the
 * cheapest options up to its minimum. Paid required options make it dearer than the index's
 * starting price, so the meal sheet totals these lines, not the index.
 */
export function defaultLine(product: PublicProduct, qty: number): FilledLine | null {
  if (!product.available || !product.inStock) return null;
  const size = [...product.variants].filter((v) => v.available).sort((a, b) => a.priceAgorot - b.priceAgorot)[0];
  if (product.variants.length > 0 && !size) return null;
  const modifiers: CartModifierSelection[] = [];
  const names: Localized[] = [];
  for (const g of product.modifierGroups) {
    const need = Math.max(g.minSelect, g.required ? 1 : 0);
    if (need === 0) continue;
    const opts = g.options.filter((o) => o.available).sort((a, b) => a.priceDeltaAgorot - b.priceDeltaAgorot || a.sortOrder - b.sortOrder).slice(0, need);
    if (opts.length < need) return null;
    modifiers.push({ groupId: g.id, optionIds: opts.map((o) => o.id) });
    names.push(...opts.map((o) => o.name));
  }
  const step = product.quantityStep || 1;
  const minQ = product.minQuantity || 1;
  const quantity = product.pricingMode === 'weight' ? 1 : Math.max(minQ, minQ + Math.ceil(Math.max(0, qty - minQ) / step) * step);
  const draft: Omit<CartLine, 'expectedUnitPriceAgorot'> = {
    lineId: makeId(12),
    productId: product.id,
    ...(size ? { variantId: size.id } : {}),
    modifiers,
    quantity,
    ...(product.pricingMode === 'weight' ? { requestedGrams: product.minWeightGrams ?? product.weightStepGrams ?? 100 } : {}),
  };
  const line = priced(product, draft);
  return line ? { line, meta: meta(product, line, names) } : null;
}

/** An earlier order's line, exactly as it was ordered, or null when the menu changed. */
export function lineFromOrder(product: PublicProduct, ol: OrderLine): FilledLine | null {
  const groups = new Map<string, CartModifierSelection>();
  for (const m of ol.modifiers) {
    const g = groups.get(m.groupId) ?? { groupId: m.groupId, optionIds: [] };
    g.optionIds.push(m.optionId);
    if (m.placement && m.placement !== 'whole') g.placements = { ...(g.placements ?? {}), [m.optionId]: m.placement };
    groups.set(m.groupId, g);
  }
  const draft: Omit<CartLine, 'expectedUnitPriceAgorot'> = {
    lineId: makeId(12),
    productId: ol.productId,
    ...(ol.variantId ? { variantId: ol.variantId } : {}),
    modifiers: [...groups.values()],
    quantity: ol.quantity,
    ...(ol.requestedGrams ? { requestedGrams: ol.requestedGrams } : {}),
    ...(ol.note ? { note: ol.note } : {}),
  };
  const line = priced(product, draft);
  return line ? { line, meta: meta(product, line, ol.modifiers.map((m) => m.optionName)) } : null;
}

/** Whether filling would replace another place's cart (the caller asks first). */
export function needsReplace(business: PublicBusiness, branch: PublicBranch): boolean {
  const s = cartStore.get();
  return !!s.cart && !cartBelongsTo(s, business.id, branch.id);
}

/** Puts the lines in the cart, starting a new cart for this place when needed. */
export function fillCart(business: PublicBusiness, branch: PublicBranch, cityId: string, lines: FilledLine[]) {
  const s = cartStore.get();
  if (s.cart && !cartBelongsTo(s, business.id, branch.id)) cartStore.reset();
  const modes = availableFulfillmentModes(business.type, branch, cityId);
  const current = cartStore.get().cart;
  const mode = current && modes.includes(current.mode) ? current.mode : (modes[0] ?? 'pickup');
  for (const l of lines) {
    addLine({ businessId: business.id, branchId: branch.id, mode, cityId, meta: { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale }, line: l.line, lineMeta: l.meta });
  }
  try {
    sessionStorage.removeItem('qareeb.cart.quotedTotal');
    window.dispatchEvent(new Event('qareeb:cart-quote'));
  } catch {
    /* ignore */
  }
}
