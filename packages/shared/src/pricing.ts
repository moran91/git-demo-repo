import { unitLineTotal, weightLineTotal } from './money.js';
import type {
  Agorot,
  CartLine,
  CartModifierSelection,
  LoyaltyRules,
  Localized,
  OrderLine,
  OrderLineModifierSnapshot,
  OrderTotals,
  Product,
} from './types.js';

export type PricingProblem =
  | { code: 'item_unavailable'; lineId: string }
  | { code: 'invalid_modifiers'; lineId: string; reason: string }
  | { code: 'price_changed'; lineId: string; expected: Agorot; actual: Agorot }
  | { code: 'invalid_argument'; lineId: string; reason: string };

export interface PricedLineResult {
  line?: OrderLine;
  problem?: PricingProblem;
}

/** Validates a modifier selection against a product and returns snapshots + delta. */
export function resolveModifiers(
  product: Product,
  selections: CartModifierSelection[],
): { ok: true; snapshots: OrderLineModifierSnapshot[]; delta: Agorot } | { ok: false; reason: string } {
  const snapshots: OrderLineModifierSnapshot[] = [];
  let delta = 0;
  const byGroup = new Map(selections.map((s) => [s.groupId, s.optionIds]));
  for (const s of selections) {
    if (!product.modifierGroups.some((g) => g.id === s.groupId)) return { ok: false, reason: `unknown group ${s.groupId}` };
  }
  for (const group of product.modifierGroups) {
    const chosen = Array.from(new Set(byGroup.get(group.id) ?? []));
    if (group.required && chosen.length < Math.max(1, group.minSelect)) return { ok: false, reason: `group ${group.id} requires selection` };
    if (chosen.length < group.minSelect && chosen.length > 0) return { ok: false, reason: `group ${group.id} below minimum` };
    if (!group.required && chosen.length > 0 && chosen.length < group.minSelect) return { ok: false, reason: `group ${group.id} below minimum` };
    if (group.maxSelect > 0 && chosen.length > group.maxSelect) return { ok: false, reason: `group ${group.id} above maximum` };
    for (const optId of chosen) {
      const opt = group.options.find((o) => o.id === optId);
      if (!opt) return { ok: false, reason: `unknown option ${optId}` };
      if (!opt.available) return { ok: false, reason: `option ${optId} unavailable` };
      delta += opt.priceDeltaAgorot;
      snapshots.push({ groupId: group.id, groupName: group.name, optionId: opt.id, optionName: opt.name, priceDeltaAgorot: opt.priceDeltaAgorot });
    }
  }
  return { ok: true, snapshots, delta };
}

/** Prices a single cart line against the current product. Pure; used by client preview and server. */
export function priceLine(product: Product, cart: CartLine): PricedLineResult {
  if (product.archived || !product.available) return { problem: { code: 'item_unavailable', lineId: cart.lineId } };
  let basePrice = product.priceAgorot;
  let variantName: Localized | undefined;
  if (product.variants.length > 0) {
    const v = product.variants.find((x) => x.id === cart.variantId);
    if (!v) return { problem: { code: 'invalid_modifiers', lineId: cart.lineId, reason: 'variant required' } };
    if (!v.available) return { problem: { code: 'item_unavailable', lineId: cart.lineId } };
    basePrice = v.priceAgorot;
    variantName = v.name;
  } else if (cart.variantId) {
    return { problem: { code: 'invalid_modifiers', lineId: cart.lineId, reason: 'unexpected variant' } };
  }
  const mods = resolveModifiers(product, cart.modifiers);
  if (!mods.ok) return { problem: { code: 'invalid_modifiers', lineId: cart.lineId, reason: mods.reason } };

  if (product.pricingMode === 'weight') {
    const step = product.weightStepGrams ?? 100;
    const grams = cart.requestedGrams ?? 0;
    const min = product.minWeightGrams ?? step;
    if (!Number.isInteger(grams) || grams < min || grams % step !== 0) {
      return { problem: { code: 'invalid_argument', lineId: cart.lineId, reason: `weight must be a multiple of ${step}g and at least ${min}g` } };
    }
    if (cart.expectedUnitPriceAgorot !== basePrice) {
      return { problem: { code: 'price_changed', lineId: cart.lineId, expected: cart.expectedUnitPriceAgorot, actual: basePrice } };
    }
    return {
      line: {
        lineId: cart.lineId,
        productId: product.id,
        name: product.name,
        pricingMode: 'weight',
        unitLabel: product.unitLabel,
        unitPriceAgorot: basePrice,
        modifiers: mods.snapshots,
        quantity: 1,
        requestedGrams: grams,
        note: cart.note?.trim() || undefined,
        lineTotalAgorot: weightLineTotal(basePrice, grams),
        trackInventory: product.trackInventory,
      },
    };
  }

  const qty = cart.quantity;
  const step = product.quantityStep || 1;
  const minQ = product.minQuantity || 1;
  if (!Number.isInteger(qty) || qty < minQ || qty % step !== 0 || qty > 999) {
    return { problem: { code: 'invalid_argument', lineId: cart.lineId, reason: `quantity must be a multiple of ${step} and at least ${minQ}` } };
  }
  const unitPrice = basePrice + mods.delta;
  if (cart.expectedUnitPriceAgorot !== unitPrice) {
    return { problem: { code: 'price_changed', lineId: cart.lineId, expected: cart.expectedUnitPriceAgorot, actual: unitPrice } };
  }
  return {
    line: {
      lineId: cart.lineId,
      productId: product.id,
      name: product.name,
      variantId: cart.variantId,
      variantName,
      pricingMode: 'unit',
      unitLabel: product.unitLabel,
      unitPriceAgorot: basePrice,
      modifiers: mods.snapshots,
      quantity: qty,
      note: cart.note?.trim() || undefined,
      lineTotalAgorot: unitLineTotal(basePrice, mods.delta, qty),
      trackInventory: product.trackInventory,
    },
  };
}

export function lineIsEstimated(line: OrderLine): boolean {
  return line.pricingMode === 'weight' && line.actualGrams === undefined && !line.removed;
}

export function recomputeLineTotal(line: OrderLine): Agorot {
  if (line.removed) return 0;
  if (line.pricingMode === 'weight') {
    return weightLineTotal(line.unitPriceAgorot, line.actualGrams ?? line.requestedGrams ?? 0);
  }
  const delta = line.modifiers.reduce((s, m) => s + m.priceDeltaAgorot, 0);
  return unitLineTotal(line.unitPriceAgorot, delta, line.quantity);
}

export function merchandiseSubtotal(lines: OrderLine[]): Agorot {
  return lines.reduce((s, l) => s + (l.removed ? 0 : l.lineTotalAgorot), 0);
}

/** Maximum discount in agorot allowed by the rules for a given merchandise subtotal. */
export function maxLoyaltyDiscount(rules: Pick<LoyaltyRules, 'maxDiscountPercent'>, subtotal: Agorot): Agorot {
  return Math.floor((subtotal * rules.maxDiscountPercent) / 100);
}

/** Points needed to cover a discount (ceil), and the discount a number of points yields. */
export function pointsToDiscount(points: number, redeemValueAgorot: Agorot): Agorot {
  return Math.max(0, Math.floor(points) * redeemValueAgorot);
}

/**
 * Computes how many points to reserve for a requested redemption, clamped by balance and the max
 * discount rule. Returns {points, discount}.
 */
export function clampRedemption(
  requestedPoints: number,
  availablePoints: number,
  rules: Pick<LoyaltyRules, 'maxDiscountPercent' | 'redeemValueAgorot' | 'enabled'>,
  subtotal: Agorot,
): { points: number; discount: Agorot } {
  if (!rules.enabled || requestedPoints <= 0 || availablePoints <= 0) return { points: 0, discount: 0 };
  const cap = maxLoyaltyDiscount(rules, subtotal);
  const maxPointsByCap = Math.floor(cap / rules.redeemValueAgorot);
  const points = Math.max(0, Math.min(Math.floor(requestedPoints), availablePoints, maxPointsByCap));
  return { points, discount: pointsToDiscount(points, rules.redeemValueAgorot) };
}

export function computeTotals(lines: OrderLine[], loyaltyDiscount: Agorot, deliveryFee: Agorot): OrderTotals {
  const merchandiseSubtotalAgorot = merchandiseSubtotal(lines);
  const loyaltyDiscountAgorot = Math.min(loyaltyDiscount, merchandiseSubtotalAgorot);
  return {
    merchandiseSubtotalAgorot,
    loyaltyDiscountAgorot,
    deliveryFeeAgorot: deliveryFee,
    cashDueAgorot: merchandiseSubtotalAgorot - loyaltyDiscountAgorot + deliveryFee,
    isEstimated: lines.some(lineIsEstimated),
  };
}

/** Points earned for a finalised merchandise amount actually paid (after discount). Delivery earns nothing. */
export function pointsEarned(rules: Pick<LoyaltyRules, 'enabled' | 'earnPerAgorot' | 'pointsPerStep'>, paidMerchandiseAgorot: Agorot): number {
  if (!rules.enabled || rules.earnPerAgorot <= 0 || paidMerchandiseAgorot <= 0) return 0;
  return Math.floor(paidMerchandiseAgorot / rules.earnPerAgorot) * rules.pointsPerStep;
}

export const DEFAULT_LOYALTY_RULES: LoyaltyRules = {
  enabled: false,
  version: 1,
  earnPerAgorot: 1000,
  pointsPerStep: 1,
  redeemValueAgorot: 100,
  maxDiscountPercent: 10,
};

export const LOYALTY_BOUNDS = {
  earnPerAgorot: { min: 100, max: 100000 },
  pointsPerStep: { min: 1, max: 100 },
  redeemValueAgorot: { min: 1, max: 10000 },
  maxDiscountPercent: { min: 0, max: 50 },
} as const;
