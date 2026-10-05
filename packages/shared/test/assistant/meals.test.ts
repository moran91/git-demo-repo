import { describe, expect, it } from 'vitest';
import { ALL_FILTERS, applyCombos, buildAssistantData, buildMeals, hashUnit, prepareDishes, rank, retrieve, understand, upsellFor, type AssistantDeal, type AssistantPlace } from '../../src/index.js';
import { allClosed, fixtureData, INDEXES, PLACES } from './fixtures.js';

const data = fixtureData();
const meals = (text: string) => {
  const r = understand(text, data.placeNames);
  return buildMeals(r, data, rank(retrieve(r, data), r, data));
};

describe('buildMeals', () => {
  it('spicy for 4 under ₪150: a family pizza and four drinks at Morano', () => {
    const [b, ...rest] = meals('משהו חריף ל-4 עד 150');
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ branchId: 'morano', totalAgorot: 13400, serves: 4, savingsAgorot: 0 });
    expect(b!.lines).toEqual([
      { productId: 'm-spicy-family', qty: 1, unitAgorot: 9800, needsChoice: false },
      { productId: 'm-coke', qty: 4, unitAgorot: 900, needsChoice: false },
    ]);
  });
  it('pizza for two turns into the cheaper combo plus fries', () => {
    const [b] = meals('pizza for 2');
    expect(b!.branchId).toBe('morano');
    expect(b!.lines).toEqual([
      { productId: 'm-fries', qty: 1, unitAgorot: 1800, needsChoice: false },
      { productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 1, unitAgorot: 6000, needsChoice: true },
    ]);
    expect(b).toMatchObject({ totalAgorot: 7800, savingsAgorot: 600 });
  });
  it('a budget below every basket gives nothing', () => {
    expect(meals('ל-6 עד 30')).toEqual([]);
  });
  it('a budget without people fits one dish', () => {
    const [b] = meals('פיצה עד 50');
    expect(b!.lines).toEqual([{ productId: 'm-margherita', qty: 1, unitAgorot: 4800, needsChoice: false }]);
  });
});

describe('buildMeals, fix round', () => {
  const dishTypeOf = (id: string) => data.dishes.find((d) => d.id === id)!.entry;
  it('sides carry every diet tag that was asked for', () => {
    const all = meals('טבעוני ל-4');
    expect(all.length).toBeGreaterThan(0);
    for (const b of all) for (const l of b.lines) {
      const e = dishTypeOf(l.productId).dishType === 'snacks' ? dishTypeOf(l.productId) : undefined;
      if (e) expect(e.tags).toContain('vegan');
    }
    const burger = all.find((b) => b.branchId === 'burger');
    expect(burger?.lines.map((l) => l.productId)).not.toContain('b-onion-rings');
  });
  it('a dessert-only place is not a meal, unless a dessert was asked for', () => {
    expect(meals('ל-4').map((b) => b.branchId)).not.toContain('dolce');
    expect(meals('cake for 4').map((b) => b.branchId)).toContain('dolce');
  });
  it('a sold-out cold drink is not replaced by a hot one next to a pizza', () => {
    const d = fixtureData();
    d.dishes = d.dishes.filter((x) => x.id !== 'm-coke');
    const r = understand('pizza for 2', d.placeNames);
    const [b] = buildMeals(r, d, rank(retrieve(r, d), r, d));
    expect(b!.branchId).toBe('morano');
    expect(b!.lines.map((l) => l.productId)).not.toContain('m-espresso');
  });
  it('a closed place never forms a basket, even when its hits are passed in', () => {
    const closed = fixtureData({ places: allClosed() });
    const r = understand('ל-2', closed.placeNames);
    const hits = rank(retrieve(r, closed, { ...ALL_FILTERS, open: false }), r, closed);
    expect(hits.length).toBeGreaterThan(0);
    expect(buildMeals(r, closed, hits)).toEqual([]);
  });
  it('equal places take turns by the daily seed', () => {
    const places: AssistantPlace[] = ['x1', 'x2'].map((branchId) => ({ ...PLACES[0]!, branchId, businessId: `b-${branchId}`, name: { en: branchId } }));
    const indexes = new Map(places.map((p) => [p.branchId, { ...INDEXES.get('morano')!, branchId: p.branchId }]));
    const orders = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const d = buildAssistantData({ now: new Date('2026-10-04T17:00:00.000Z'), places, dishes: prepareDishes(places, indexes) });
      d.seed = seed;
      const r = understand('pizza for 2', d.placeNames);
      const got = buildMeals(r, d, rank(retrieve(r, d), r, d)).map((b) => b.branchId);
      expect(got).toHaveLength(2);
      expect(got).toEqual(['x1', 'x2'].sort((a, b) => hashUnit(seed, a) - hashUnit(seed, b)));
      orders.add(got.join());
    }
    expect(orders.size).toBe(2);
  });
  it('"meal" is not a dish: a meal for 3 vegetarian gives a vegetarian basket', () => {
    const all = meals('meal for 3 vegetarian');
    expect(all.length).toBeGreaterThan(0);
    for (const b of all) expect(dishTypeOf(b.lines[0]!.productId).tags).toContain('vegetarian');
  });
  it('"ארוחה ל-4 עד 150" is an adult basket, not kids meals', () => {
    const all = meals('ארוחה ל-4 עד 150');
    expect(all.length).toBeGreaterThan(1);
    expect(all.flatMap((b) => b.lines.map((l) => l.productId))).not.toContain('b-kids-meal');
  });
});

describe('applyCombos, fix round', () => {
  const deal = (id: string, price: number, items: Array<[string, number]>): AssistantDeal => ({ id, branchId: 'morano', kind: 'combo', combo: { name: { he: id }, priceAgorot: price, items: items.map(([productId, quantity]) => ({ productId, quantity })), sortOrder: 0 } });
  const line = (productId: string, qty: number, unitAgorot: number) => ({ productId, qty, unitAgorot, needsChoice: false });
  it('a combo listing a product twice needs both units', () => {
    const twice = deal('c2', 9000, [['m-margherita', 1], ['m-margherita', 1]]);
    expect(applyCombos([line('m-margherita', 1, 4800)], [twice])).toEqual({ lines: [line('m-margherita', 1, 4800)], savings: 0 });
    const r = applyCombos([line('m-margherita', 2, 4800)], [twice]);
    expect(r.savings).toBe(600);
    expect(r.lines).toEqual([{ productId: 'c2', comboId: 'c2', qty: 1, unitAgorot: 9000, needsChoice: true }]);
  });
  it('has no cap on how many times a combo applies', () => {
    const combos = data.deals.filter((d) => d.kind === 'combo');
    const r = applyCombos([line('m-margherita', 20, 4800), line('m-coke', 40, 900)], combos);
    expect(r.lines).toEqual([{ productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 20, unitAgorot: 6000, needsChoice: true }]);
    expect(r.savings).toBe(12000);
  });
});

describe('applyCombos', () => {
  it('applies a combo as many times as the lines allow', () => {
    const combos = data.deals.filter((d) => d.kind === 'combo');
    const r = applyCombos([{ productId: 'm-margherita', qty: 2, unitAgorot: 4800, needsChoice: false }, { productId: 'm-coke', qty: 4, unitAgorot: 900, needsChoice: false }], combos);
    expect(r.lines).toEqual([{ productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 2, unitAgorot: 6000, needsChoice: true }]);
    expect(r.savings).toBe(1200);
  });
});

describe('upsellFor', () => {
  it('uses what people buy together first', () => {
    expect(upsellFor({ branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data)?.id).toBe('m-coke');
  });
  it('falls back to a cold drink for a main and a hot one for a pastry', () => {
    expect(upsellFor({ branchId: 'abu', productId: 'a-shawarma-chicken' }, ['a-shawarma-chicken'], data)?.id).toBe('a-cola');
    expect(upsellFor({ branchId: 'bloom', productId: 'bl-croissant' }, ['bl-croissant'], data)?.id).toBe('bl-cappuccino');
  });
  it('ranks by list position and skips what is already in the cart', () => {
    const d = fixtureData();
    d.pairs.set('morano', { 'm-margherita': [{ productId: 'm-fries' }, { productId: 'm-coke' }] });
    const added = { branchId: 'morano', productId: 'm-margherita' };
    expect(upsellFor(added, ['m-margherita'], d)?.id).toBe('m-fries');
    expect(upsellFor(added, ['m-margherita', 'm-fries'], d)?.id).toBe('m-coke');
  });
  it('does not suggest what is already inside an added combo', () => {
    expect(upsellFor({ branchId: 'morano', productId: 'm-combo-pair' }, ['m-combo-pair'], data)?.id).toBe('m-fries');
    expect(upsellFor({ branchId: 'morano', productId: 'm-fries' }, ['m-fries', 'm-combo-pair'], data)?.id).not.toBe('m-coke');
  });
  it('skips a type that is already in the cart, and never offers a hot drink with a main', () => {
    expect(upsellFor({ branchId: 'morano', productId: 'm-margherita' }, ['m-margherita', 'm-coke'], { ...data, pairs: new Map() })?.id).toBe('m-fries');
  });
  it('never for a closed place', () => {
    expect(upsellFor({ branchId: 'baguette', productId: 'bg-schnitzel' }, [], data)).toBeUndefined();
  });
});
