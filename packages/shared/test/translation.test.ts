import { describe, expect, it } from 'vitest';
import { applyTranslations, protectNames, reconcileAuto, sourceOf, textFields, translationTargets, type Product } from '../src/index.js';

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', branchId: 'br', businessId: 'b', categoryId: 'c', name: { he: 'פסטה רוזה' }, description: { he: 'ברוטב שמנת' }, dietaryText: {},
  pricingMode: 'unit', priceAgorot: 5000, unitLabel: {}, quantityStep: 1, minQuantity: 1,
  variants: [{ id: 'v1', name: { he: 'גדולה' }, priceAgorot: 6000, available: true, sortOrder: 0 }],
  modifierGroups: [
    { id: 'g1', name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 0, sortOrder: 0, options: [{ id: 'o1', name: { he: 'פטריות' }, priceDeltaAgorot: 300, available: true, sortOrder: 0 }] },
    { id: 'g2', name: { he: 'מספרייה' }, required: false, minSelect: 0, maxSelect: 0, sortOrder: 1, sharedGroupId: 'lib1', options: [] },
  ],
  available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: '', updatedAt: '', ...over,
});

describe('textFields', () => {
  it('lists every customer-visible text of a dish, skipping library copies', () => {
    expect(textFields('product', product()).map((f) => f.path)).toEqual(['name', 'description', 'variants/v1/name', 'modifierGroups/g1/name', 'modifierGroups/g1/options/o1/name']);
  });
});

describe('sourceOf', () => {
  it('prefers the business default language, then he, ar, en, never a machine-written one', () => {
    expect(sourceOf({ he: 'א', ar: 'ب' }, 'ar')).toEqual({ lang: 'ar', text: 'ب' });
    expect(sourceOf({ ar: 'ب' }, 'he')).toEqual({ lang: 'ar', text: 'ب' });
    expect(sourceOf({ he: 'מכונה', ar: 'بعل' }, 'he', ['he'])).toEqual({ lang: 'ar', text: 'بعل' });
    expect(sourceOf({}, 'he')).toBeNull();
  });
});

describe('translationTargets', () => {
  it('asks for every missing language of every field', () => {
    const t = translationTargets(textFields('product', product()), {}, 'he');
    expect(t).toHaveLength(10);
    expect(t[0]).toEqual({ path: 'name', from: 'he', to: 'ar', text: 'פסטה רוזה' });
  });
  it('re-translates machine text whose source changed, never owner text', () => {
    const fields = textFields('category', { name: { he: 'פסטות חדשות', ar: 'باستا', en: 'Pastas' } });
    const auto = { name: { ar: 'פסטות' } };
    expect(translationTargets(fields, auto, 'he')).toEqual([{ path: 'name', from: 'he', to: 'ar', text: 'פסטות חדשות' }]);
    // up to date: nothing to do
    expect(translationTargets(fields, { name: { ar: 'פסטות חדשות' } }, 'he')).toEqual([]);
  });
});

describe('reconcileAuto', () => {
  const prev = { name: { he: 'פסטה', ar: 'باستا', en: 'Pasta' } };
  const auto = { name: { ar: 'פסטה', en: 'פסטה' } };
  it('keeps unchanged machine text as machine text', () => {
    expect(reconcileAuto(textFields('category', prev), auto, textFields('category', prev))).toEqual(auto);
  });
  it('an owner edit makes that language theirs', () => {
    const next = { name: { he: 'פסטה', ar: 'معكرونة', en: 'Pasta' } };
    expect(reconcileAuto(textFields('category', prev), auto, textFields('category', next))).toEqual({ name: { en: 'פסטה' } });
  });
  it('drops marks of fields that no longer exist or were emptied', () => {
    const next = { name: { he: 'פסטה', en: 'Pasta' } };
    expect(reconcileAuto(textFields('category', prev), auto, textFields('category', next))).toEqual({ name: { en: 'פסטה' } });
    expect(reconcileAuto(textFields('category', prev), { gone: { ar: 'x' } }, textFields('category', prev))).toEqual({});
  });
});

describe('applyTranslations', () => {
  it('fills targets and marks them machine-written', () => {
    const doc = { name: { he: 'פסטה' } };
    const out = applyTranslations('category', doc, {}, 'he', [{ path: 'name', to: 'ar', text: 'باستا', fromText: 'פסטה' }]);
    expect(out.doc.name).toEqual({ he: 'פסטה', ar: 'باستا' });
    expect(out.auto).toEqual({ name: { ar: 'פסטה' } });
    expect(out.changed).toBe(true);
  });
  it('never overwrites owner text and drops results for a source that changed meanwhile', () => {
    const doc = { name: { he: 'פסטה חדשה', ar: 'معكرونة' } };
    const out = applyTranslations('category', doc, {}, 'he', [
      { path: 'name', to: 'ar', text: 'باستا', fromText: 'פסטה חדשה' },
      { path: 'name', to: 'en', text: 'Pasta', fromText: 'פסטה' },
    ]);
    expect(out.doc.name).toEqual({ he: 'פסטה חדשה', ar: 'معكرونة' });
    expect(out.changed).toBe(false);
  });
  it('re-translating one language keeps the other stale one marked for the next run', () => {
    const doc = { name: { he: 'פסטה חדשה', ar: 'باستا', en: 'Pasta' } };
    const out = applyTranslations('category', doc, { name: { ar: 'פסטה', en: 'פסטה' } }, 'he', [{ path: 'name', to: 'ar', text: 'باستا جديدة', fromText: 'פסטה חדשה' }]);
    expect(out.auto).toEqual({ name: { ar: 'פסטה חדשה', en: 'פסטה' } });
    expect(translationTargets(textFields('category', out.doc), out.auto, 'he')).toEqual([{ path: 'name', from: 'he', to: 'en', text: 'פסטה חדשה' }]);
  });
  it('writes nested option names', () => {
    const out = applyTranslations('product', product(), {}, 'he', [{ path: 'modifierGroups/g1/options/o1/name', to: 'en', text: 'Mushrooms', fromText: 'פטריות' }]);
    expect(out.doc.modifierGroups[0]!.options[0]!.name).toEqual({ he: 'פטריות', en: 'Mushrooms' });
  });
});

describe('protectNames', () => {
  it('shields the business name, even spelled differently, so it is not translated', () => {
    const html = protectNames('גרוס מוראנו', { he: 'מורנו', en: 'Morano' }, 'en');
    expect(html).toBe('גרוס <span translate="no">Morano</span>');
    // No name in the target language: the original word is kept untranslated.
    expect(protectNames('גרוס מוראנו', { he: 'מורנו' }, 'ar')).toBe('גרוס <span translate="no">מוראנו</span>');
  });
  it('protects a multi-word name only as a whole phrase, never its food words', () => {
    const name = { he: 'שווארמה אבו סלים', en: 'Abu Salim Shawarma' };
    expect(protectNames('שווארמה בפיתה', name, 'en')).toBe('שווארמה בפיתה');
    expect(protectNames('המנה של שווארמה אבו סלים', name, 'en')).toBe('המנה של <span translate="no">Abu Salim Shawarma</span>');
  });
  it('escapes the rest of the text as HTML', () => {
    expect(protectNames('מק & צ׳יז <חדש>', {}, 'en')).toBe('מק &amp; צ׳יז &lt;חדש&gt;');
  });
});
