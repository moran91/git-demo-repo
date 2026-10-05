import { describe, expect, it } from 'vitest';
import { autoTags, tokenize, wordForms } from '../../src/index.js';

describe('tokenize', () => {
  it('splits digits from Hebrew/Arabic letters, keeps Arabizi, separates ₪, converts Arabic-Indic digits', () => {
    expect(tokenize('ל-4')).toEqual(['ל', '4']);
    expect(tokenize('ל4')).toEqual(['ל', '4']);
    expect(tokenize('لـ٤')).toEqual(['ل', '4']);
    expect(tokenize('150₪')).toEqual(['150', '₪']);
    expect(tokenize('shi 7ar')).toEqual(['shi', '7ar']);
    expect(tokenize('50 ש"ח')).toEqual(['50', 'שח']);
  });
  it('word forms drop one Hebrew or Arabic prefix', () => {
    expect(wordForms('הפיצה')).toContain('פיצה');
    expect(wordForms('לשניימ')).toContain('שניימ');
    expect(wordForms('والبيتزا')).toContain('بيتزا');
    expect(wordForms('pizza')).toEqual(['pizza']);
  });
});

describe('autoTags', () => {
  it('reads type, serves and taste from a Hebrew name', () => {
    const r = autoTags({ name: { he: 'פיצה משפחתית חריפה' } });
    expect(r.dishType).toBe('pizza');
    expect(r.serves).toBe(4);
    expect(r.tags).toEqual(expect.arrayContaining(['spicy', 'vegetarian', 'sharing']));
  });
  it('meat on a pizza removes vegetarian', () => {
    const r = autoTags({ name: { he: 'פיצה פפרוני' } });
    expect(r.tags).toContain('meat');
    expect(r.tags).not.toContain('vegetarian');
    expect(r.serves).toBe(2);
  });
  it('reads Arabic', () => {
    const r = autoTags({ name: { ar: 'شاورما دجاج حارة' } });
    expect(r.dishType).toBe('shawarma');
    expect(r.tags).toEqual(expect.arrayContaining(['chicken', 'spicy']));
    expect(r.tags).not.toContain('vegetarian');
  });
  it('a chicken burger is not meat', () => {
    const r = autoTags({ name: { en: 'Chicken burger' } });
    expect(r.dishType).toBe('burger');
    expect(r.tags).toContain('chicken');
    expect(r.tags).not.toContain('meat');
  });
  it('iced coffee is a cold drink, not a hot one', () => {
    const r = autoTags({ name: { he: 'אייס קפה' } });
    expect(r.dishType).toBe('drinks');
    expect(r.tags).toContain('cold_drink');
    expect(r.tags).not.toContain('hot_drink');
  });
  it('coffee is a hot drink', () => {
    expect(autoTags({ name: { he: 'קפה הפוך' } }).tags).toContain('hot_drink');
  });
  it('the category names drinks', () => {
    const r = autoTags({ name: { he: 'קוקה קולה' }, categoryName: { he: 'שתייה' } });
    expect(r.dishType).toBe('drinks');
    expect(r.tags).toContain('cold_drink');
  });
  it('serves: tray 6, pair 2, explicit number, slice 1', () => {
    expect(autoTags({ name: { he: 'מגש סושי 40 יחידות' } })).toMatchObject({ dishType: 'sushi', serves: 6 });
    expect(autoTags({ name: { he: 'ארוחה זוגית' } }).serves).toBe(2);
    expect(autoTags({ name: { en: 'Family meal for 5 people' } }).serves).toBe(5);
    expect(autoTags({ name: { he: 'משולש פיצה' } }).serves).toBe(1);
  });
  it('desserts are sweet; a cold salad is not a drink', () => {
    expect(autoTags({ name: { he: 'כנאפה' } })).toMatchObject({ dishType: 'desserts', tags: expect.arrayContaining(['sweet']) });
    const salad = autoTags({ name: { he: 'סלט קר' } });
    expect(salad.dishType).toBe('salads');
    expect(salad.tags).not.toContain('cold_drink');
    expect(salad.tags).toContain('vegetarian');
  });
  it('breakfast pastries and kids', () => {
    expect(autoTags({ name: { ar: 'منقوشة زعتر' } })).toMatchObject({ dishType: 'pastries', tags: expect.arrayContaining(['breakfast', 'vegetarian']) });
    expect(autoTags({ name: { en: 'Kids meal nuggets' } }).tags).toEqual(expect.arrayContaining(['kids', 'chicken']));
  });
  it('an unknown dish gets no type, serves 1', () => {
    expect(autoTags({ name: { he: 'מנת השף' } })).toEqual({ tags: [], serves: 1 });
  });
  it('a stem of two letters or less keeps its prefix (בקר is beef, not cold)', () => {
    const r = autoTags({ name: { he: 'קציצות בקר ברוטב' } });
    expect(r.tags).toContain('meat');
    expect(r.tags).not.toContain('cold_drink');
    expect(r.tags).not.toContain('hot_drink');
    expect(autoTags({ name: { he: 'מרק בקר' } }).tags).not.toContain('cold_drink');
    expect(autoTags({ name: { he: 'שתה' } }).tags).not.toContain('hot_drink');
    expect(wordForms('בקר')).toEqual(['בקר']);
    expect(wordForms('שתה')).toEqual(['שתה']);
  });
  it('a real drink word on a meat or fish dish does not make it a drink', () => {
    const beef = autoTags({ name: { en: 'Beef cold cuts' } });
    expect(beef.tags).toContain('meat');
    expect(beef.tags).not.toContain('cold_drink');
    const tuna = autoTags({ name: { en: 'Tuna iced plate' } });
    expect(tuna.tags).toContain('fish');
    expect(tuna.tags).not.toContain('cold_drink');
  });
  it('כפול (double) is not hummus via the כ prefix', () => {
    expect(autoTags({ name: { he: 'סלט כפול' } }).dishType).toBe('salads');
    expect(autoTags({ name: { he: 'שניצל כפול' } }).dishType).not.toBe('hummus');
    expect(autoTags({ name: { he: 'המבורגר כפול' } }).dishType).toBe('burger');
  });
});
