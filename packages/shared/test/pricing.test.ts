import { describe, expect, it } from 'vitest';
import { clampRedemption, computeTotals, maxLoyaltyDiscount, pointsEarned, priceLine, resolveModifiers } from '../src/pricing.js';
import { weightLineTotal, formatILSPlain } from '../src/money.js';
import type { Product } from '../src/types.js';

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
