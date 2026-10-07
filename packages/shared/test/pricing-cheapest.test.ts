import { describe, expect, it } from 'vitest';
import { cheapestChoices, priceLine, type Product } from '../src/index.js';

const base = (over: Partial<Product> = {}): Product => ({
  id: 'p', branchId: 'b', businessId: 'biz', categoryId: 'c', name: { he: 'x' }, description: {}, dietaryText: {},
  pricingMode: 'unit', priceAgorot: 3000, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
  available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: '', updatedAt: '', ...over,
} as Product);
const opt = (id: string, delta: number, available = true) => ({ id, name: { he: id }, priceDeltaAgorot: delta, available, sortOrder: 0 });

describe('cheapestChoices', () => {
  it('is the plain price when nothing must be chosen', () => {
    expect(cheapestChoices(base())).toEqual({ modifiers: [], unitPriceAgorot: 3000 });
  });

  it('takes the cheapest available size and the cheapest required options up to the minimum', () => {
    const p = base({
      variants: [{ id: 'l', name: { he: 'L' }, priceAgorot: 5000, available: true, sortOrder: 0 }, { id: 'm', name: { he: 'M' }, priceAgorot: 4000, available: true, sortOrder: 1 }, { id: 's', name: { he: 'S' }, priceAgorot: 3000, available: false, sortOrder: 2 }],
      modifierGroups: [
        { id: 'bread', name: { he: 'לחם' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [opt('laffa', 500), opt('pita', 300), opt('free', 0, false)] },
        { id: 'sauces', name: { he: 'רטבים' }, required: false, minSelect: 2, maxSelect: 3, sortOrder: 1, options: [opt('a', 200), opt('b', 0), opt('c', 100)] },
        { id: 'extras', name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 3, sortOrder: 2, options: [opt('x', 900)] },
      ],
    });
    const c = cheapestChoices(p)!;
    expect(c).toEqual({ variantId: 'm', modifiers: [{ groupId: 'bread', optionIds: ['pita'] }, { groupId: 'sauces', optionIds: ['b', 'c'] }], unitPriceAgorot: 4000 + 300 + 100 });
    // The menu agrees: the line prices exactly as computed.
    expect(priceLine(p, { lineId: 'l1', productId: 'p', variantId: c.variantId, modifiers: c.modifiers, quantity: 1, expectedUnitPriceAgorot: c.unitPriceAgorot }).line?.unitPriceAgorot).toBe(4000);
    expect(priceLine(p, { lineId: 'l1', productId: 'p', variantId: c.variantId, modifiers: c.modifiers, quantity: 1, expectedUnitPriceAgorot: c.unitPriceAgorot }).problem).toBeUndefined();
  });

  it('is null when a required choice cannot be made', () => {
    expect(cheapestChoices(base({ modifierGroups: [{ id: 'g', name: { he: 'g' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [opt('o', 0, false)] }] }))).toBeNull();
    expect(cheapestChoices(base({ variants: [{ id: 'v', name: { he: 'v' }, priceAgorot: 1, available: false, sortOrder: 0 }] }))).toBeNull();
    expect(cheapestChoices(base({ available: false }))).toBeNull();
  });
});
