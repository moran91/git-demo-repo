import { describe, expect, it } from 'vitest';
import { DISH_TYPES, matchesQuery, normalizeSearch, rankDishes, toDishIndexEntry, type DishHit, type Product } from '../src/index.js';

const base: Product = {
  id: 'p1', branchId: 'br1', businessId: 'b1', categoryId: 'c1',
  name: { he: 'פיצה נפוליטנית' }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 5500,
  unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false,
  archived: false, sortOrder: 3, createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
};

describe('normalizeSearch', () => {
  it('strips niqqud, harakat and tatweel and folds final letters and alef forms', () => {
    expect(normalizeSearch('פִּיצָה')).toBe('פיצה');
    expect(normalizeSearch('שניצלונים ם ך ן ף ץ')).toBe('שניצלונימ מ כ נ פ צ');
    expect(normalizeSearch('بِيتْزا')).toBe('بيتزا');
    expect(normalizeSearch('أإآا ة ى ـ')).toBe('اااا ه ي');
  });
  it('lowercases, drops geresh/quotes/dashes and collapses spaces', () => {
    expect(normalizeSearch("  Mac & CHEESE  ")).toBe('mac & cheese');
    expect(normalizeSearch('צ׳יפס')).toBe(normalizeSearch("צ'יפס"));
    expect(normalizeSearch('מוח\'יטו')).toBe('מוחיטו');
    expect(normalizeSearch('ק״ג - חצי')).toBe('קג חצי');
  });
});

describe('matchesQuery', () => {
  it('needs every word of the query somewhere in the haystack', () => {
    expect(matchesQuery('פיצה נפוליטנית פסטו מורנו', 'פיצה פסטו')).toBe(true);
    expect(matchesQuery('פיצה נפוליטנית פסטו מורנו', 'פיצה סושי')).toBe(false);
    expect(matchesQuery('pizza', '')).toBe(true);
  });
  it('matches across niqqud and final letters', () => {
    expect(matchesQuery('שניצלונים', 'שניצלונ')).toBe(true);
    expect(matchesQuery('פִּיצָה', 'פיצה')).toBe(true);
  });
});

describe('toDishIndexEntry', () => {
  it('keeps what the home needs and nothing private', () => {
    const e = toDishIndexEntry({ ...base, description: { he: 'בצק דק' }, dishType: 'pizza', imagePath: 'x/y.webp', sku: 'SECRET', stockQty: 4, mostOrdered: true });
    expect(e).toEqual({ name: { he: 'פיצה נפוליטנית' }, description: { he: 'בצק דק' }, priceAgorot: 5500, fromPrice: false, dishType: 'pizza', imagePath: 'x/y.webp', available: true, needsChoice: false, sortOrder: 3, mostOrdered: true });
    expect(JSON.stringify(e)).not.toContain('SECRET');
  });
  it('uses the cheapest available size and marks it as a starting price', () => {
    const e = toDishIndexEntry({ ...base, variants: [
      { id: 'v1', name: { he: 'גדולה' }, priceAgorot: 8600, available: true, sortOrder: 0 },
      { id: 'v2', name: { he: 'אישית' }, priceAgorot: 3800, available: true, sortOrder: 1 },
      { id: 'v3', name: { he: 'מיני' }, priceAgorot: 2000, available: false, sortOrder: 2 },
    ] });
    expect(e.priceAgorot).toBe(3800);
    expect(e.fromPrice).toBe(true);
    expect(e.needsChoice).toBe(true);
  });
  it('needs a choice when any modifier group is required', () => {
    const e = toDishIndexEntry({ ...base, modifierGroups: [{ id: 'g', name: { he: 'רוטב' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [] }] });
    expect(e.needsChoice).toBe(true);
    const optional = toDishIndexEntry({ ...base, modifierGroups: [{ id: 'g', name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 0, sortOrder: 0, options: [] }] });
    expect(optional.needsChoice).toBe(false);
  });
  it('reads as unavailable when out of stock or switched off', () => {
    expect(toDishIndexEntry({ ...base, available: false }).available).toBe(false);
    expect(toDishIndexEntry({ ...base, trackInventory: true, stockQty: 0 }).available).toBe(false);
    expect(toDishIndexEntry({ ...base, trackInventory: true, stockQty: 2 }).available).toBe(true);
  });
  it('omits unset optional fields instead of writing undefined', () => {
    const e = toDishIndexEntry(base);
    expect(Object.keys(e)).not.toContain('dishType');
    expect(Object.keys(e)).not.toContain('imagePath');
    expect(Object.keys(e)).not.toContain('mostOrdered');
    expect(Object.keys(e)).not.toContain('description');
  });
});

describe('rankDishes', () => {
  const hit = (branchId: string, id: string, open: boolean, sortOrder = 0): DishHit => ({
    id, branchId, open, entry: { name: { he: id }, priceAgorot: 1000, fromPrice: false, available: true, needsChoice: false, sortOrder },
  });
  it('puts orderable places first and never promotes one place over another', () => {
    const out = rankDishes([hit('a', 'a1', true, 0), hit('a', 'a2', true, 1), hit('a', 'a3', true, 2), hit('b', 'b1', true, 0), hit('c', 'c1', false, 0)], { seed: 0 });
    expect(out.map((h) => h.id).slice(0, 4).sort()).toEqual(['a1', 'a2', 'a3', 'b1'].sort());
    expect(out.at(-1)!.id).toBe('c1');
    // round robin: the second place's first dish comes before the first place's second dish
    const a2 = out.findIndex((h) => h.id === 'a2');
    const b1 = out.findIndex((h) => h.id === 'b1');
    expect(b1).toBeLessThan(a2);
  });
  it('rotates which place leads from day to day', () => {
    const list = [hit('a', 'a1', true), hit('b', 'b1', true), hit('c', 'c1', true)];
    const leaders = new Set([0, 1, 2].map((seed) => rankDishes(list, { seed })[0]!.branchId));
    expect(leaders.size).toBe(3);
  });
  it('pins the place already in the cart to the top while it is open', () => {
    const out = rankDishes([hit('a', 'a1', true), hit('b', 'b1', true), hit('b', 'b2', true)], { seed: 0, pinBranchId: 'b' });
    expect(out.slice(0, 2).map((h) => h.branchId)).toEqual(['b', 'b']);
    const closed = rankDishes([hit('a', 'a1', true), hit('b', 'b1', false)], { seed: 0, pinBranchId: 'b' });
    expect(closed[0]!.branchId).toBe('a');
  });
  it('keeps each place in its own menu order', () => {
    const out = rankDishes([hit('a', 'a2', true, 5), hit('a', 'a1', true, 1)], { seed: 0 });
    expect(out.map((h) => h.id)).toEqual(['a1', 'a2']);
  });
});

it('has the twelve agreed dish types', () => {
  expect(DISH_TYPES).toEqual(['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'pastries', 'salads', 'mains', 'snacks', 'desserts', 'drinks']);
});
