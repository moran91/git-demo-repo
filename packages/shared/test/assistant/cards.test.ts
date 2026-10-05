import { describe, expect, it } from 'vitest';
import { buildAssistantData, prepareDishes, resolveCard, type MealBasket } from '../../src/index.js';
import { DEALS, INDEXES, NOW, PLACES, fixtureData } from './fixtures.js';

const data = fixtureData();
const basket: MealBasket = { branchId: 'morano', lines: [{ productId: 'm-margherita', qty: 1, unitAgorot: 4800, needsChoice: false }, { productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 1, unitAgorot: 6000, needsChoice: true }], totalAgorot: 10800, serves: 2, savingsAgorot: 0, points: 0 };

describe('resolveCard', () => {
  it('resolves every kind', () => {
    expect(resolveCard({ kind: 'dish', branchId: 'morano', productId: 'm-coke' }, data)).toMatchObject({ kind: 'dish', place: { branchId: 'morano' } });
    expect(resolveCard({ kind: 'meal', basket }, data)).toMatchObject({ kind: 'meal', lines: [{ name: { he: 'פיצה מרגריטה' } }, { name: { he: 'קומבו זוגי' } }] });
    expect(resolveCard({ kind: 'deal', branchId: 'morano', dealId: 'm-combo-pair' }, data)).toMatchObject({ kind: 'deal', itemNames: [{ he: 'פיצה מרגריטה' }, { he: 'קוקה קולה' }] });
    const usual = data.profile!.usuals[0]!;
    expect(resolveCard({ kind: 'usual', usual }, data)).toMatchObject({ kind: 'usual', missing: [] });
  });

  it('a restored conversation after a menu change: missing dishes drop the card instead of crashing', () => {
    const morano = INDEXES.get('morano')!;
    const { ['m-margherita']: _gone, ...rest } = morano.dishes;
    const changed = buildAssistantData({ now: NOW, places: PLACES, dishes: prepareDishes(PLACES, new Map([...INDEXES, ['morano', { ...morano, dishes: rest }]])), deals: DEALS });
    expect(resolveCard({ kind: 'dish', branchId: 'morano', productId: 'm-margherita' }, changed)).toBeNull();
    expect(resolveCard({ kind: 'meal', basket }, changed)).toBeNull();
    expect(resolveCard({ kind: 'dish', branchId: 'nowhere', productId: 'x' }, changed)).toBeNull();
    expect(resolveCard({ kind: 'deal', branchId: 'morano', dealId: 'gone' }, changed)).toBeNull();
    const usual = { branchId: 'morano', businessId: 'b-morano', lines: [{ productId: 'm-margherita', quantity: 1, modifiers: [], name: { he: 'פיצה מרגריטה' } }], count: 3, lastAt: '', mode: 'pickup' as const };
    expect(resolveCard({ kind: 'usual', usual }, changed)).toMatchObject({ missing: [{ he: 'פיצה מרגריטה' }] });
  });

  it('a sold-out dish (unavailable in the index) resolves to null', () => {
    const morano = INDEXES.get('morano')!;
    const soldOut = { ...morano, dishes: { ...morano.dishes, 'm-coke': { ...morano.dishes['m-coke']!, available: false } } };
    const changed = buildAssistantData({ now: NOW, places: PLACES, dishes: prepareDishes(PLACES, new Map([...INDEXES, ['morano', soldOut]])), deals: DEALS });
    expect(resolveCard({ kind: 'dish', branchId: 'morano', productId: 'm-coke' }, changed)).toBeNull();
  });
});

describe('resolveCard after a combo member is removed', () => {
  it('drops a deal or meal whose combo lost a product, and lists it on a usual', () => {
    const morano = INDEXES.get('morano')!;
    const { ['m-coke']: _gone, ...rest } = morano.dishes;
    const changed = buildAssistantData({ now: NOW, places: PLACES, dishes: prepareDishes(PLACES, new Map([...INDEXES, ['morano', { ...morano, dishes: rest }]])), deals: DEALS });
    expect(resolveCard({ kind: 'deal', branchId: 'morano', dealId: 'm-combo-pair' }, changed)).toBeNull();
    const comboOnly: MealBasket = { ...basket, lines: [basket.lines[1]!] };
    expect(resolveCard({ kind: 'meal', basket: comboOnly }, changed)).toBeNull();
    const usual = { branchId: 'morano', businessId: 'b-morano', lines: [{ productId: 'm-combo-pair', comboId: 'm-combo-pair', quantity: 1, modifiers: [], name: { he: 'קומבו זוגי' } }], count: 3, lastAt: '', mode: 'pickup' as const };
    expect(resolveCard({ kind: 'usual', usual }, changed)).toMatchObject({ missing: [{ he: 'קומבו זוגי' }] });
    expect(resolveCard({ kind: 'deal', branchId: 'morano', dealId: 'm-promo-pasta' }, changed)).not.toBeNull();
  });
});
