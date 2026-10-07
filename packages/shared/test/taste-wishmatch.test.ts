import { describe, expect, it } from 'vitest';
import type { DishIndexEntry, DishType } from '../src/dishIndex.js';
import { dishSearchFields, wishMatchLevel, wishQueries } from '../src/taste/index.js';

const entry = (he: string, dishType?: DishType): DishIndexEntry => ({ name: { he }, priceAgorot: 5000, fromPrice: false, ...(dishType ? { dishType } : {}), available: true, needsChoice: false, sortOrder: 0 });
const place = { he: 'מורנו' };

describe('wishQueries', () => {
  it('keeps the food words and drops party, budget and filler words', () => {
    expect(wishQueries('בא לי פיצה לארבעה עד 200 בלי שתייה').length).toBe(1);
    expect(wishQueries('dinner for 4 up to 250').length).toBe(0);
    expect(wishQueries('بدي شاورما لأربعة').length).toBe(1);
  });
});

describe('wishMatchLevel', () => {
  it('matches a dish by name or type from any one food word', () => {
    const qs = wishQueries('פיצה או בורגר לארבעה');
    expect(wishMatchLevel(qs, dishSearchFields(entry('נפוליטנית', 'pizza'), place))).toBeDefined();
    expect(wishMatchLevel(qs, dishSearchFields(entry('צ׳יזבורגר', 'burger'), place))).toBeDefined();
    expect(wishMatchLevel(qs, dishSearchFields(entry('סלט ירקות', 'salads'), place))).toBeUndefined();
  });

  it('finds Arabic wishes against Hebrew menus through the type words', () => {
    expect(wishMatchLevel(wishQueries('بيتزا'), dishSearchFields(entry('מרגריטה', 'pizza'), place))).toBeDefined();
  });

  it('nothing to match means no level', () => {
    expect(wishMatchLevel([], dishSearchFields(entry('מרגריטה', 'pizza'), place))).toBeUndefined();
  });
});
