import { describe, expect, it } from 'vitest';
import { applyCombos, buildMeals, rank, retrieve, understand, upsellFor } from '../../src/index.js';
import { fixtureData } from './fixtures.js';

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
  it('never for a closed place', () => {
    expect(upsellFor({ branchId: 'baguette', productId: 'bg-schnitzel' }, [], data)).toBeUndefined();
  });
});
