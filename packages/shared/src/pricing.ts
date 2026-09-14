import { normalizePlacement } from './placement.js';
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
  const placementsByGroup = new Map(selections.map((s) => [s.groupId, s.placements ?? {}]));
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
      // Placement never changes the price (a half topping costs the same as a whole one); it only
      // travels to the kitchen. Placements sent for non-placement groups are ignored, not rejected.
      const placement = group.placement ? normalizePlacement(placementsByGroup.get(group.id)?.[opt.id]) : undefined;
      snapshots.push({ groupId: group.id, groupName: group.name, optionId: opt.id, optionName: opt.name, priceDeltaAgorot: opt.priceDeltaAgorot, ...(placement ? { placement } : {}) });
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
    // Steps count up FROM the minimum (as the customer's stepper does). Requiring `grams % step`
    // instead would reject the minimum itself whenever it is not a multiple of the step, leaving the
    // product impossible to order.
    if (!Number.isInteger(grams) || grams < min || (grams - min) % step !== 0) {
      return { problem: { code: 'invalid_argument', lineId: cart.lineId, reason: `weight must be at least ${min}g and increase in steps of ${step}g` } };
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
  // Same rule as weights: quantities are minQ, minQ+step, minQ+2*step, ... which is exactly what the
  // storefront stepper offers. `qty % step` would make every offered value invalid whenever the
  // minimum is not itself a multiple of the step.
  if (!Number.isInteger(qty) || qty < minQ || (qty - minQ) % step !== 0 || qty > 999) {
    return { problem: { code: 'invalid_argument', lineId: cart.lineId, reason: `quantity must be at least ${minQ} and increase in steps of ${step}` } };
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

/** Staff may weigh slightly over the request; beyond this the customer has to have agreed by phone. */
export const WEIGHT_OVER_TOLERANCE = 1.25;

/** The shape reviseOrder accepts, loose enough for the dashboard to pass a half-filled draft. */
export interface RevisionChangeLike {
  action: 'remove' | 'set_quantity' | 'set_actual_weight' | 'substitute';
  quantity?: number;
  actualGrams?: number;
}

/**
 * Why a revision needs the customer's phone agreement, or null if it does not.
 *
 * Both sides must ask exactly this question: the server rejects a revision without agreement, and
 * the dashboard has to require the checkbox for the same cases. They were written separately once
 * and drifted — the dialog missed "quantity set to 0" and "weight over tolerance", so staff filled
 * the form and got an opaque rejection. One function, two callers.
 */
export function revisionAgreementReason(
  line: Pick<OrderLine, 'quantity' | 'requestedGrams'> | undefined,
  change: RevisionChangeLike,
): 'removal' | 'increase' | 'substitution' | null {
  switch (change.action) {
    case 'remove':
      return 'removal';
    case 'substitute':
      return 'substitution';
    case 'set_quantity':
      if ((change.quantity ?? 0) === 0) return 'removal';
      return (change.quantity ?? 0) > (line?.quantity ?? 0) ? 'increase' : null;
    case 'set_actual_weight':
      return (change.actualGrams ?? 0) > Math.ceil((line?.requestedGrams ?? 0) * WEIGHT_OVER_TOLERANCE) ? 'increase' : null;
    default:
      return null;
  }
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
