import { describe, expect, it } from 'vitest';
import { priceLine } from '../src/pricing.js';
import type { Product } from '../src/types.js';

/**
 * Regression: quantity and weight steps count up FROM the minimum, matching the storefront stepper
 * (min, min+step, min+2*step, ...). The catalog form lets an owner set a minimum that is not a
 * multiple of the step; requiring `value % step === 0` made every value the stepper could produce
 * invalid, so such a product could not be ordered at all.
 */
const base: Product = {
  id: 'p1', branchId: 'b1', businessId: 'biz', categoryId: 'c', name: { he: 'פריט' }, description: {}, dietaryText: {},
  pricingMode: 'unit', priceAgorot: 1000, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
  available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: '', updatedAt: '',
};
const cart = (quantity: number) => ({ lineId: 'l1', productId: 'p1', modifiers: [], quantity, expectedUnitPriceAgorot: 1000 });
const grams = (requestedGrams: number) => ({ lineId: 'l1', productId: 'p1', modifiers: [], quantity: 1, requestedGrams, expectedUnitPriceAgorot: 1000 });
/** The values the storefront Stepper can actually produce for a product. */
const offered = (min: number, step: number, n = 3) => Array.from({ length: n + 1 }, (_, i) => min + i * step);

describe('quantity and weight steps count from the minimum', () => {
  it('accepts every value the stepper offers when the minimum is not a multiple of the step', () => {
    const p = { ...base, minQuantity: 2, quantityStep: 5 }; // stepper offers 2, 7, 12, 17
    for (const q of offered(2, 5)) expect(priceLine(p, cart(q)).problem, `quantity ${q}`).toBeUndefined();
  });

  it('still rejects values between the steps and below the minimum', () => {
    const p = { ...base, minQuantity: 2, quantityStep: 5 };
    for (const q of [1, 3, 6, 8]) expect(priceLine(p, cart(q)).problem?.code, `quantity ${q}`).toBe('invalid_argument');
  });

  it('is unchanged for the ordinary case where the minimum is a multiple of the step', () => {
    const p = { ...base, minQuantity: 12, quantityStep: 12 };
    for (const q of offered(12, 12)) expect(priceLine(p, cart(q)).problem, `quantity ${q}`).toBeUndefined();
    for (const q of [6, 13, 20]) expect(priceLine(p, cart(q)).problem?.code, `quantity ${q}`).toBe('invalid_argument');
  });

  it('applies the same rule to weight-priced items, including the minimum itself', () => {
    const p = { ...base, pricingMode: 'weight' as const, minWeightGrams: 300, weightStepGrams: 250 };
    for (const g of offered(300, 250)) expect(priceLine(p, grams(g)).problem, `${g}g`).toBeUndefined();
    for (const g of [250, 400, 700]) expect(priceLine(p, grams(g)).problem?.code, `${g}g`).toBe('invalid_argument');
  });
});
