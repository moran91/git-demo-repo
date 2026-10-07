import { describe, expect, it } from 'vitest';
import type { DishIndexEntry, DishType } from '../src/dishIndex.js';
import { cleanAiTitle, validateAiMeals, type AiCandidate } from '../src/taste/index.js';

const entry = (dishType: DishType, price: number): DishIndexEntry => ({ name: { he: 'x' }, priceAgorot: price * 100, fromPrice: false, dishType, available: true, needsChoice: false, sortOrder: 0 });
const cands = new Map<string, AiCandidate>([
  ['c1', { alias: 'c1', branchId: 'b1', productId: 'pz', entry: entry('pizza', 60) }],
  ['c2', { alias: 'c2', branchId: 'b1', productId: 'fr', entry: entry('snacks', 15) }],
  ['c3', { alias: 'c3', branchId: 'b1', productId: 'cola', entry: entry('drinks', 8) }],
  ['c4', { alias: 'c4', branchId: 'b2', productId: 'bg', entry: entry('burger', 45) }],
  ['c5', { alias: 'c5', branchId: 'b2', productId: 'sal', entry: entry('salads', 20) }],
]);
const ctx = (facts: { party?: number; budgetAgorot?: number; noDrinks?: boolean } = {}) => ({ candidates: cands, facts: { noDrinks: false, ...facts }, locale: 'he' as const });
const meal = (items: Array<[string, number]>, over: Record<string, unknown> = {}) => ({ title: 'ערב פיצה', reason: 'fits_wish', items: items.map(([id, qty]) => ({ id, qty })), ...over });

describe('validateAiMeals', () => {
  it('maps a good answer to real dishes', () => {
    const r = validateAiMeals({ meals: [meal([['c1', 2], ['c2', 1]]), meal([['c4', 4]], { title: 'בורגרים', reason: 'new_for_you' })], noFit: 'none' }, ctx({ party: 4 }));
    expect(r.rejected).toEqual([]);
    expect(r.meals).toEqual([
      { branchId: 'b1', items: [{ productId: 'pz', qty: 2 }, { productId: 'fr', qty: 1 }], title: 'ערב פיצה', reason: 'fits_wish', source: 'ai' },
      { branchId: 'b2', items: [{ productId: 'bg', qty: 4 }], title: 'בורגרים', reason: 'new_for_you', source: 'ai' },
    ]);
  });

  it('rejects unknown ids and meals that mix places', () => {
    expect(validateAiMeals({ meals: [meal([['c9', 1]])] }, ctx()).rejected).toEqual(['unknown_id']);
    expect(validateAiMeals({ meals: [meal([['c1', 1], ['c4', 1]])] }, ctx()).rejected).toEqual(['mixed_branches']);
  });

  it('clamps quantities to 1–10 and merges repeated ids', () => {
    const r = validateAiMeals({ meals: [meal([['c1', 40], ['c2', 0], ['c2', 1.6]])] }, ctx());
    expect(r.meals[0]!.items).toEqual([{ productId: 'pz', qty: 10 }, { productId: 'fr', qty: 3 }]);
  });

  it('enforces the budget from the live prices', () => {
    expect(validateAiMeals({ meals: [meal([['c1', 2]])] }, ctx({ budgetAgorot: 10000 })).rejected).toEqual(['over_budget']);
    expect(validateAiMeals({ meals: [meal([['c1', 1]])] }, ctx({ budgetAgorot: 10000 })).meals).toHaveLength(1);
  });

  it('enforces enough portions for the party (a pizza feeds two)', () => {
    expect(validateAiMeals({ meals: [meal([['c1', 1]])] }, ctx({ party: 3 })).rejected).toEqual(['too_few_portions']);
    expect(validateAiMeals({ meals: [meal([['c1', 2]])] }, ctx({ party: 3 })).meals).toHaveLength(1);
    expect(validateAiMeals({ meals: [meal([['c2', 4]])] }, ctx({ party: 2 })).rejected).toEqual(['too_few_portions']);
  });

  it('rejects drinks when the wish said none', () => {
    expect(validateAiMeals({ meals: [meal([['c1', 1], ['c3', 2]])] }, ctx({ noDrinks: true })).rejected).toEqual(['drinks']);
  });

  it('drops a second meal that repeats the first', () => {
    const r = validateAiMeals({ meals: [meal([['c1', 1], ['c2', 1]]), meal([['c1', 1], ['c2', 2]])] }, ctx());
    expect(r.meals).toHaveLength(1);
    expect(r.rejected).toEqual(['duplicate']);
    expect(validateAiMeals({ meals: [meal([['c1', 1], ['c2', 1]]), meal([['c1', 1]])] }, ctx()).meals).toHaveLength(1);
  });

  it('keeps at most two meals, turns an unknown reason into fits_wish, survives junk', () => {
    const r = validateAiMeals({ meals: [meal([['c1', 1]], { reason: 'because' }), meal([['c4', 1]]), meal([['c5', 1]])] }, ctx());
    expect(r.meals).toHaveLength(2);
    expect(r.meals[0]!.reason).toBe('fits_wish');
    expect(validateAiMeals('nonsense', ctx())).toEqual({ meals: [], rejected: ['shape'], noFit: 'none' });
    expect(validateAiMeals({ meals: [{ items: 'x' }] }, ctx()).rejected).toEqual(['shape']);
  });

  it('passes noFit through only from the closed list', () => {
    expect(validateAiMeals({ meals: [], noFit: 'diet' }, ctx()).noFit).toBe('diet');
    expect(validateAiMeals({ meals: [], noFit: 'whatever' }, ctx()).noFit).toBe('none');
  });
});

describe('cleanAiTitle', () => {
  it.each([
    ['ערב פיצה משפחתי', 'he', 'ערב פיצה משפחתי'],
    ['פיצה ב-50', 'he', undefined],
    ['מבצע ₪', 'he', undefined],
    ['פיצה פתוחה עכשיו', 'he', undefined],
    ['משלוח מהיר', 'he', undefined],
    ['ארוחה בריאה', 'he', undefined],
    ['www.pizza.com', 'en', undefined],
    ['Pizza night', 'he', undefined],
    ['عشاء بيتزا', 'he', undefined],
    ['عشاء بيتزا', 'ar', 'عشاء بيتزا'],
    ['سعر خاص', 'ar', undefined],
    ['Burger night', 'en', 'Burger night'],
    ['Open late burgers', 'en', undefined],
    ['א'.repeat(29), 'he', undefined],
    [42, 'he', undefined],
  ])('%s (%s)', (title, locale, expected) => {
    expect(cleanAiTitle(title, locale as 'he' | 'ar' | 'en')).toBe(expected);
  });
});
