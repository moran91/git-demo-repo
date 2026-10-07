import { describe, expect, it } from 'vitest';
import { isWish, parseWish } from '../src/taste/index.js';

describe('parseWish', () => {
  it.each([
    ['לארבעה עד 200, בלי שתייה', { party: 4, budgetAgorot: 20000, noDrinks: true }],
    ['פיצה ל-3', { party: 3, budgetAgorot: undefined, noDrinks: false }],
    ['משהו לשניים', { party: 2, budgetAgorot: undefined, noDrinks: false }],
    ['ארוחה ל 5 אנשים ב-₪150', { party: 5, budgetAgorot: 15000, noDrinks: false }],
    ['ללא שתיה 120 ש"ח', { party: undefined, budgetAgorot: 12000, noDrinks: true }],
    ['dinner for 4 up to 250 no drinks', { party: 4, budgetAgorot: 25000, noDrinks: true }],
    ['something for two under 90', { party: 2, budgetAgorot: 9000, noDrinks: false }],
    ['6 people, max 300', { party: 6, budgetAgorot: 30000, noDrinks: false }],
    ['عشاء لأربعة حتى 200 بدون مشروبات', { party: 4, budgetAgorot: 20000, noDrinks: true }],
    ['بيتزا ل3', { party: 3, budgetAgorot: undefined, noDrinks: false }],
    ['اكل لاثنين بلا مشروب', { party: 2, budgetAgorot: undefined, noDrinks: true }],
    ['שווארמה לארבעה حتى 200', { party: 4, budgetAgorot: 20000, noDrinks: false }],
  ])('%s', (text, expected) => {
    const got = parseWish(text);
    expect({ party: got.party, budgetAgorot: got.budgetAgorot, noDrinks: got.noDrinks }).toEqual(expected);
  });

  it('ignores absurd numbers', () => {
    expect(parseWish('ל-500').party).toBeUndefined();
    expect(parseWish('עד 5').budgetAgorot).toBeUndefined();
    expect(parseWish('עד 99999').budgetAgorot).toBeUndefined();
  });

  it('a bare dish word carries no facts', () => {
    expect(parseWish('פיצה')).toEqual({ party: undefined, budgetAgorot: undefined, noDrinks: false });
  });
});

describe('isWish', () => {
  it.each([
    ['פיצה', false],
    ['פיצה מרגריטה', false],
    ['burger', false],
    ['משהו טעים וחריף', true],
    ['ל-4', true],
    ['פיצה עד 80', true],
    ['בלי גלוטן', true],
    ['for kids', true],
    ['without onions', true],
    ['بدون بصل', true],
    ['حتى 100', true],
    ['لأربعة', true],
    ['لحمة', false],
    ['לחם', false],
  ])('%s → %s', (text, expected) => {
    expect(isWish(text)).toBe(expected);
  });
});
