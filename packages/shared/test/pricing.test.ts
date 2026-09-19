import { describe, expect, it } from 'vitest';
import { clampRedemption, comboTotal, computeTotals, maxLoyaltyDiscount, pointsEarned, priceComboLine, priceLine, resolveModifiers } from '../src/pricing.js';
import { weightLineTotal, formatILSPlain } from '../src/money.js';
import type { Product } from '../src/types.js';
import { normalizePlacement } from '../src/placement.js';
import { toppingPlacementSchema } from '../src/schemas.js';

const base: Product = {
  id: 'p1', branchId: 'b1', businessId: 'biz', categoryId: 'c', name: { he: 'שווארמה' }, description: {}, dietaryText: {},
  pricingMode: 'unit', priceAgorot: 3500, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
  available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: '', updatedAt: '',
};

describe('modifier validation', () => {
  const product: Product = {
    ...base,
    modifierGroups: [
      { id: 'g1', name: { en: 'Bread' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [
        { id: 'o1', name: { en: 'Pita' }, priceDeltaAgorot: 0, available: true, sortOrder: 0 },
        { id: 'o2', name: { en: 'Laffa' }, priceDeltaAgorot: 500, available: true, sortOrder: 1 },
      ] },
      { id: 'g2', name: { en: 'Extras' }, required: false, minSelect: 0, maxSelect: 2, sortOrder: 1, options: [
        { id: 'x1', name: { en: 'Fries' }, priceDeltaAgorot: 800, available: true, sortOrder: 0 },
        { id: 'x2', name: { en: 'Hummus' }, priceDeltaAgorot: 400, available: false, sortOrder: 1 },
        { id: 'x3', name: { en: 'Pickles' }, priceDeltaAgorot: 0, available: true, sortOrder: 2 },
      ] },
    ],
  };
  it('requires the required group', () => {
    expect(resolveModifiers(product, [])).toMatchObject({ ok: false });
  });
  it('rejects too many selections and unavailable options', () => {
    expect(resolveModifiers(product, [{ groupId: 'g1', optionIds: ['o1'] }, { groupId: 'g2', optionIds: ['x1', 'x3', 'x1'] }])).toMatchObject({ ok: true });
    expect(resolveModifiers(product, [{ groupId: 'g1', optionIds: ['o1', 'o2'] }])).toMatchObject({ ok: false });
    expect(resolveModifiers(product, [{ groupId: 'g1', optionIds: ['o1'] }, { groupId: 'g2', optionIds: ['x2'] }])).toMatchObject({ ok: false });
    expect(resolveModifiers(product, [{ groupId: 'g1', optionIds: ['o1'] }, { groupId: 'nope', optionIds: [] }])).toMatchObject({ ok: false });
  });
  it('prices with deltas and detects price change', () => {
    const r = priceLine(product, { lineId: 'l1', productId: 'p1', modifiers: [{ groupId: 'g1', optionIds: ['o2'] }, { groupId: 'g2', optionIds: ['x1'] }], quantity: 2, expectedUnitPriceAgorot: 4800 });
    expect(r.line?.lineTotalAgorot).toBe(9600);
    const stale = priceLine(product, { lineId: 'l1', productId: 'p1', modifiers: [{ groupId: 'g1', optionIds: ['o2'] }], quantity: 1, expectedUnitPriceAgorot: 3500 });
    expect(stale.problem).toMatchObject({ code: 'price_changed', actual: 4000 });
  });
});

describe('weight pricing', () => {
  it('rounds half up per documented policy', () => {
    expect(weightLineTotal(1290, 333)).toBe(430); // 429.57 -> 430
    expect(weightLineTotal(1000, 1250)).toBe(1250);
    expect(weightLineTotal(999, 500)).toBe(500); // 499.5 -> 500
  });
  it('validates steps and minimums', () => {
    const p: Product = { ...base, pricingMode: 'weight', priceAgorot: 900, weightStepGrams: 100, minWeightGrams: 200 };
    expect(priceLine(p, { lineId: 'l', productId: 'p1', modifiers: [], quantity: 1, requestedGrams: 150, expectedUnitPriceAgorot: 900 }).problem?.code).toBe('invalid_argument');
    expect(priceLine(p, { lineId: 'l', productId: 'p1', modifiers: [], quantity: 1, requestedGrams: 100, expectedUnitPriceAgorot: 900 }).problem?.code).toBe('invalid_argument');
    expect(priceLine(p, { lineId: 'l', productId: 'p1', modifiers: [], quantity: 1, requestedGrams: 1300, expectedUnitPriceAgorot: 900 }).line?.lineTotalAgorot).toBe(1170);
  });
});

describe('loyalty math', () => {
  const rules = { enabled: true, earnPerAgorot: 1000, pointsPerStep: 1, redeemValueAgorot: 100, maxDiscountPercent: 10 };
  it('caps redemption at max percent and balance', () => {
    expect(clampRedemption(100, 50, rules, 20000)).toEqual({ points: 20, discount: 2000 });
    expect(clampRedemption(10, 5, rules, 20000)).toEqual({ points: 5, discount: 500 });
    expect(clampRedemption(10, 50, { ...rules, enabled: false }, 20000)).toEqual({ points: 0, discount: 0 });
    expect(maxLoyaltyDiscount(rules, 999)).toBe(99);
  });
  it('earns per full step on merchandise actually paid; delivery excluded', () => {
    expect(pointsEarned(rules, 9999)).toBe(9);
    expect(pointsEarned(rules, 10000)).toBe(10);
    expect(pointsEarned(rules, 0)).toBe(0);
    const totals = computeTotals([{ lineId: 'a', productId: 'p', name: {}, pricingMode: 'unit', unitLabel: {}, unitPriceAgorot: 5000, modifiers: [], quantity: 2, lineTotalAgorot: 10000, trackInventory: false }], 1000, 1500);
    expect(totals.cashDueAgorot).toBe(10500);
    expect(pointsEarned(rules, totals.merchandiseSubtotalAgorot - totals.loyaltyDiscountAgorot)).toBe(9);
  });
  it('formats ILS plainly', () => {
    expect(formatILSPlain(1250)).toBe('₪12.50');
    expect(formatILSPlain(1200)).toBe('₪12');
    expect(formatILSPlain(-5)).toBe('-₪0.05');
  });
});

describe('pizza topping placement', () => {
  const pizza: Product = {
    ...base,
    modifierGroups: [
      { id: 'top', name: { he: 'תוספות מעל' }, required: false, minSelect: 1, maxSelect: 10, sortOrder: 0, placement: true, options: [
        { id: 'corn', name: { he: 'תירס' }, priceDeltaAgorot: 300, available: true, sortOrder: 0 },
        { id: 'olive', name: { he: 'זיתים' }, priceDeltaAgorot: 300, available: true, sortOrder: 1 },
      ] },
      { id: 'cheese', name: { he: 'גבינות' }, required: false, minSelect: 1, maxSelect: 3, sortOrder: 1, options: [
        { id: 'bulg', name: { he: 'בולגרית' }, priceDeltaAgorot: 800, available: true, sortOrder: 0 },
      ] },
    ],
  };
  it('records placement per topping, defaults to whole, and never changes the price', () => {
    const r = resolveModifiers(pizza, [{ groupId: 'top', optionIds: ['corn', 'olive'], placements: { corn: 'bl+tl' } }, { groupId: 'cheese', optionIds: ['bulg'], placements: { bulg: 'right' } }]);
    expect(r).toMatchObject({ ok: true, delta: 1400 });
    if (!r.ok) return;
    expect(r.snapshots.map((s) => [s.optionId, s.placement])).toEqual([['corn', 'tl+bl'], ['olive', 'whole'], ['bulg', undefined]]);
  });
  it('a half topping costs the same as a whole one', () => {
    const whole = priceLine(pizza, { lineId: 'l', productId: 'p1', modifiers: [{ groupId: 'top', optionIds: ['corn'] }], quantity: 1, expectedUnitPriceAgorot: 3800 });
    const half = priceLine(pizza, { lineId: 'l', productId: 'p1', modifiers: [{ groupId: 'top', optionIds: ['corn'], placements: { corn: 'tr' } }], quantity: 1, expectedUnitPriceAgorot: 3800 });
    expect(whole.line?.lineTotalAgorot).toBe(3800);
    expect(half.line?.lineTotalAgorot).toBe(3800);
    expect(half.line?.modifiers[0]?.placement).toBe('tr');
  });
});

describe('legacy placement values', () => {
  it('maps left/right from older clients to quarter sets', () => {
    expect(normalizePlacement('left')).toBe('tl+bl');
    expect(normalizePlacement('right')).toBe('tr+br');
    expect(toppingPlacementSchema.safeParse('right').success).toBe(true);
    expect(toppingPlacementSchema.safeParse('middle').success).toBe(false);
  });
});

describe('combo pricing', () => {
  const shawarma: Product = { ...base, id: 'p-shawarma', priceAgorot: 3500 };
  const fries: Product = { ...base, id: 'p-fries', priceAgorot: 1200, trackInventory: true, stockQty: 5 };
  const products = new Map([[shawarma.id, shawarma], [fries.id, fries]]);
  const combo = { id: 'combo1', businessId: 'biz', branchId: 'b1', name: { en: 'Two + fries' }, description: {}, items: [{ productId: 'p-shawarma', quantity: 2 }, { productId: 'p-fries', quantity: 1 }], priceAgorot: 6970, promoted: true, active: true, archived: false, sortOrder: 0, createdAt: '', updatedAt: '' };
  it('charges the fixed combo price and snapshots the members', () => {
    expect(comboTotal(8200, 15, 1)).toBe(6970);
    const r = priceComboLine(combo, products, { lineId: 'c', productId: 'combo1', comboId: 'combo1', modifiers: [], quantity: 2, expectedUnitPriceAgorot: 6970 });
    expect(r.line?.lineTotalAgorot).toBe(13940);
    expect(r.line?.comboItems?.map((i) => [i.productId, i.quantity, i.trackInventory])).toEqual([['p-shawarma', 2, false], ['p-fries', 1, true]]);
    expect(r.line?.comboDiscountPercent).toBeUndefined();
    expect(r.line?.unitPriceAgorot).toBe(6970);
    // Legacy percentage combos keep pricing from the members' sum until re-saved with a fixed price.
    expect(priceComboLine({ ...combo, priceAgorot: undefined as unknown as number, discountPercent: 15 }, products, { lineId: 'c', productId: 'combo1', comboId: 'combo1', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 6970 }).line?.unitPriceAgorot).toBe(6970);
  });
  it('flags stale prices and unavailable members', () => {
    expect(priceComboLine(combo, products, { lineId: 'c', productId: 'combo1', comboId: 'combo1', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 8200 }).problem).toMatchObject({ code: 'price_changed', actual: 6970 });
    const off = new Map(products); off.set('p-fries', { ...fries, available: false });
    expect(priceComboLine(combo, off, { lineId: 'c', productId: 'combo1', comboId: 'combo1', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 6970 }).problem?.code).toBe('item_unavailable');
    expect(priceComboLine({ ...combo, active: false }, products, { lineId: 'c', productId: 'combo1', comboId: 'combo1', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 6970 }).problem?.code).toBe('item_unavailable');
  });
});
