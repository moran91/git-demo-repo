import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';
import { DISH_TYPES, matchesQuery, normalizeSearch, toDealsCombo, toDealsIndexDoc, toDealsPromotion, toDishIndexEntry, type Combo, type Product, type Promotion } from '../src/index.js';

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

it('the cravings-home ranking is gone: the assistant ranks (rank.ts)', () => {
  expect(Object.keys(shared)).not.toContain('rankDishes');
});

it('has the twelve agreed dish types', () => {
  expect(DISH_TYPES).toEqual(['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'pastries', 'salads', 'mains', 'snacks', 'desserts', 'drinks']);
});

describe('assistant fields in the indexes', () => {
  it('the dish entry carries tags and serves when set', () => {
    expect(toDishIndexEntry({ ...base, tags: ['spicy'], serves: 2 })).toMatchObject({ tags: ['spicy'], serves: 2 });
    const plain = toDishIndexEntry({ ...base, tags: [] });
    expect('tags' in plain).toBe(false);
    expect('serves' in plain).toBe(false);
  });
  const combo: Combo = { id: 'c1', businessId: 'b1', branchId: 'br1', name: { he: 'קומבו' }, description: {}, items: [{ productId: 'p1', quantity: 2 }], priceAgorot: 6000, promoted: true, active: true, archived: false, sortOrder: 1, createdAt: '', updatedAt: '' };
  const promo: Promotion = { id: 'pr', businessId: 'b1', branchId: 'br1', title: { he: '1+1' }, body: { he: 'רק היום' }, productIds: ['p1'], endsAt: '2030-01-01', active: true, sortOrder: 0, createdAt: '', updatedAt: '' };
  it('deals entries keep what the assistant shows and drop empty text', () => {
    expect(toDealsCombo(combo)).toEqual({ name: { he: 'קומבו' }, priceAgorot: 6000, items: [{ productId: 'p1', quantity: 2 }], sortOrder: 1 });
    expect(toDealsPromotion(promo)).toEqual({ title: { he: '1+1' }, body: { he: 'רק היום' }, productIds: ['p1'], endsAt: '2030-01-01', sortOrder: 0 });
  });
  it('the deals document holds only live combos and promotions, keyed by id', () => {
    const doc = toDealsIndexDoc('br1', 'b1', [combo, { ...combo, id: 'c2', active: false }, { ...combo, id: 'c3', archived: true }], [promo, { ...promo, id: 'pr2', active: false }], '2026-10-05T00:00:00.000Z');
    expect(Object.keys(doc.combos)).toEqual(['c1']);
    expect(Object.keys(doc.promotions)).toEqual(['pr']);
    expect(doc).toMatchObject({ branchId: 'br1', businessId: 'b1', updatedAt: '2026-10-05T00:00:00.000Z' });
  });
});
