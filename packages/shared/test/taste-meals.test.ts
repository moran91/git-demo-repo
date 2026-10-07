import { describe, expect, it } from 'vitest';
import type { DishIndexEntry, DishType } from '../src/dishIndex.js';
import { buildMeals, deriveTaste, emptyTasteDoc, mealPortions, type MealCandidate } from '../src/taste/index.js';

const NOW = new Date('2026-10-06T18:00:00.000Z');
const entry = (dishType: DishType | undefined, price: number, over: Partial<DishIndexEntry> = {}): DishIndexEntry => ({
  name: { he: 'x' }, priceAgorot: price * 100, fromPrice: false, ...(dishType ? { dishType } : {}), available: true, needsChoice: false, sortOrder: 0, ...over,
});
const c = (branchId: string, productId: string, type: DishType | undefined, price: number, over: Partial<MealCandidate> = {}): MealCandidate => ({
  branchId, productId, entry: entry(type, price), open: true, score: 0, ...over,
});
const empty = deriveTaste({ doc: emptyTasteDoc(NOW.toISOString()), orders: [], feedback: [], now: NOW });
const run = (candidates: MealCandidate[], facts: { party?: number; budgetAgorot?: number; noDrinks?: boolean } = {}, derived = empty) =>
  buildMeals({ candidates, facts: { noDrinks: false, ...facts }, derived, popular: null, now: NOW });

describe('portions', () => {
  it('a pizza feeds two, other mains one', () => {
    const lookup = new Map([['b/p', entry('pizza', 50)], ['b/s', entry('shawarma', 40)], ['b/f', entry('snacks', 15)]]);
    expect(mealPortions('b', [{ productId: 'p', qty: 2 }, { productId: 's', qty: 1 }, { productId: 'f', qty: 3 }], lookup)).toBe(5);
  });
});

describe('buildMeals', () => {
  it('feeds the party: two pizzas for four, one burger each for three', () => {
    const r = run([c('b1', 'pz', 'pizza', 60, { score: 2 }), c('b2', 'bg', 'burger', 40, { score: 1 })], { party: 4 });
    const pz = r.meals.find((m) => m.branchId === 'b1')!;
    const bg = r.meals.find((m) => m.branchId === 'b2')!;
    expect(pz.items).toEqual([{ productId: 'pz', qty: 2 }]);
    expect(bg.items).toEqual([{ productId: 'bg', qty: 4 }]);
    expect(r.meals.every((m) => m.source === 'rules')).toBe(true);
  });

  it('returns two meals from different places, the profile pick first', () => {
    const r = run([c('b1', 'a', 'pizza', 50, { score: 1 }), c('b1', 'a2', 'pasta', 40, { score: 0.5 }), c('b2', 'b', 'burger', 40, { score: 4 }), c('b3', 'x', 'sushi', 70, { score: 3 })]);
    expect(r.meals).toHaveLength(2);
    expect(r.meals[0]!.branchId).toBe('b2');
    expect(new Set(r.meals.map((m) => m.branchId)).size).toBe(2);
  });

  it('adds one side when the budget allows, never a drink', () => {
    const cands = [c('b1', 'm', 'mains', 50), c('b1', 'f', 'snacks', 15, { score: 1 }), c('b1', 'cola', 'drinks', 8, { score: 9 })];
    expect(run(cands).meals[0]!.items).toEqual([{ productId: 'm', qty: 1 }, { productId: 'f', qty: 1 }]);
    expect(run(cands, { budgetAgorot: 6000 }).meals[0]!.items).toEqual([{ productId: 'm', qty: 1 }]);
  });

  it('keeps every meal within the budget, picking a cheaper main when needed', () => {
    const r = run([c('b1', 'big', 'pizza', 90, { score: 5 }), c('b1', 'small', 'pizza', 45, { score: 1 })], { party: 2, budgetAgorot: 6000 });
    expect(r.meals[0]!.items).toEqual([{ productId: 'small', qty: 1 }]);
    expect(r.noFit).toBe('none');
  });

  it('says "budget" and offers the cheapest meals when nothing fits', () => {
    const r = run([c('b1', 'a', 'pizza', 90), c('b2', 'b', 'burger', 70), c('b3', 'd', 'mains', 120)], { party: 2, budgetAgorot: 5000 });
    expect(r.noFit).toBe('budget');
    expect(r.meals.map((m) => m.branchId)).toEqual(['b1', 'b2']);
  });

  it('says "closed" when nothing is open', () => {
    const r = run([c('b1', 'a', 'pizza', 50, { open: false })]);
    expect(r).toEqual({ meals: [], noFit: 'closed' });
  });

  it('leaves out unavailable and "not again" dishes', () => {
    const r = run([c('b1', 'gone', 'pizza', 40, { entry: entry('pizza', 40, { available: false }), score: 9 }), c('b1', 'bad', 'pizza', 40, { score: -Infinity }), c('b1', 'ok', 'pizza', 40)]);
    expect(r.meals[0]!.items).toEqual([{ productId: 'ok', qty: 1 }]);
  });

  it('keeps dishes that need a choice (added with the cheapest choices)', () => {
    const r = run([c('b1', 'sized', 'pizza', 40, { entry: entry('pizza', 40, { needsChoice: true, fromPrice: true }) })]);
    expect(r.meals[0]!.items).toEqual([{ productId: 'sized', qty: 1 }]);
  });

  it('builds the meal around what the wish named, even a non-main type', () => {
    const r = run([c('b1', 'pz', 'pizza', 50, { score: 3 }), c('b1', 'sal', 'salads', 30, { wish: 1 })], { party: 2 });
    expect(r.meals[0]!.items[0]).toEqual({ productId: 'sal', qty: 2 });
    expect(r.meals[0]!.reason).toBe('fits_wish');
  });

  it('gives the second meal a new-for-you reason when the customer has orders', () => {
    const orders = [
      { id: 'o1', branchId: 'b1', placedAt: '2026-10-01T18:00:00.000Z', status: 'accepted' as const, lines: [{ productId: 'a' }] },
      { id: 'o2', branchId: 'b1', placedAt: '2026-10-03T18:00:00.000Z', status: 'accepted' as const, lines: [{ productId: 'a' }] },
    ];
    const derived = deriveTaste({ doc: null, orders, feedback: [], now: NOW });
    const r = run([c('b1', 'a', 'pizza', 50, { score: 7 }), c('b2', 'b', 'burger', 40)], {}, derived);
    expect(r.meals.map((m) => m.reason)).toEqual(['usual', 'new_for_you']);
  });
});
