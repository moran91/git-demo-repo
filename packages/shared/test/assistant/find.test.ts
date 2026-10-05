import { describe, expect, it } from 'vitest';
import { ALL_FILTERS, buildProfile, clockAt, emptyRequest, placeUsable, rank, retrieve, roundRobin, understand, type Request } from '../../src/index.js';
import { NOW, ORDERS, PLACES, fixtureData } from './fixtures.js';

const data = fixtureData();
const req = (text: string): Request => understand(text, data.placeNames);
const ids = (r: Request, d = data) => retrieve(r, d).map((c) => c.dish.id).sort();

describe('data', () => {
  it('drops expired promotions and keeps live deals', () => {
    expect(data.deals.map((d) => d.id).sort()).toEqual(['b-combo-kids', 'm-combo-pair', 'm-promo-pasta']);
  });
  it('reads Jerusalem time', () => {
    expect(clockAt(NOW, 120)).toBe('22:00');
  });
});

describe('retrieve', () => {
  it('matches the craving across languages at open places only', () => {
    expect(ids(req('פיצה'))).toEqual(['m-family', 'm-margherita', 'm-pepperoni', 'm-spicy-family']);
    expect(ids(req('شاورما'))).toEqual(['a-platter', 'a-shawarma-chicken', 'a-shawarma-spicy']);
    expect(ids(req('באגט'))).toEqual([]);
    expect(retrieve(req('באגט'), data, { ...ALL_FILTERS, open: false }).map((c) => c.dish.id)).toEqual(['bg-schnitzel']);
  });
  it('applies tags, exclusions, mode and price ceilings', () => {
    expect(ids(req('פיצה חריפה'))).toEqual(['m-spicy-family']);
    expect(ids(req('פיצה בלי בשר'))).not.toContain('m-pepperoni');
    expect(ids(req('וופל באיסוף'))).toEqual([]);
    expect(ids({ ...req('פיצה'), maxPriceAgorot: 5000 })).toEqual(['m-margherita']);
  });
});

describe('retrieve: place names are not cravings, weak tiers are a fallback', () => {
  it('burger finds burgers, not the drink or the sides of Burger Basil', () => {
    for (const q of ['burger', 'בורגר', 'برغر']) {
      const got = ids(req(q));
      expect(got, q).toEqual(expect.arrayContaining(['b-classic', 'b-chicken', 'b-vegan-burger']));
      expect(got, q).not.toContain('b-sprite');
      expect(got, q).not.toContain('b-onion-rings');
    }
  });
  it('coffee does not return shakshuka because the place is a Cafe', () => {
    for (const q of ['קפה', 'coffee']) {
      const got = ids(req(q));
      expect(got, q).not.toContain('bl-shakshuka');
      expect(got, q).toContain('bl-iced-coffee');
    }
  });
  it('pizza does not return the sushi platter ("pieces")', () => {
    for (const q of ['פיצה', 'pizza']) expect(ids(req(q)), q).not.toContain('s-platter');
  });
  it('falls back to sound and typo matches only when nothing matches strongly', () => {
    expect(ids(req('pizzaa'))).toEqual(expect.arrayContaining(['m-margherita']));
    expect(ids(req('wafle'))).toEqual(['dl-waffle']);
  });
  it('a strong match hidden by a filter does not let weak matches through', () => {
    expect(ids({ ...req('פיצה'), maxPriceAgorot: 100 })).toEqual([]);
  });
});

describe('retrieve: filters switch off one at a time', () => {
  it('each relaxation lets its own wish through', () => {
    const r = req('פיצה חריפה');
    expect(retrieve(r, data, { ...ALL_FILTERS, tags: false }).map((c) => c.dish.id).sort()).toEqual(['m-family', 'm-margherita', 'm-pepperoni', 'm-spicy-family']);
    const cheap = { ...req('פיצה'), maxPriceAgorot: 5000 };
    expect(retrieve(cheap, data, { ...ALL_FILTERS, budget: false })).toHaveLength(4);
  });
  it('knows which places can take an order', () => {
    expect(placeUsable(PLACES[0])).toBe(true);
    expect(placeUsable(PLACES[2], 'delivery')).toBe(false);
    expect(placeUsable(PLACES.find((p) => p.branchId === 'baguette'))).toBe(false);
    expect(placeUsable(undefined)).toBe(false);
  });
});

describe('roundRobin', () => {
  it('takes turns across keys, keeping order inside a key', () => {
    expect(roundRobin(['a1', 'a2', 'b1', 'a3', 'c1', 'b2'], (x) => x[0]!)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
  });
});

describe('rank', () => {
  it('cheapest first when asked', () => {
    const r = req('cheapest pizza');
    expect(rank(retrieve(r, data), r, data)[0]!.dish.id).toBe('m-margherita');
  });
  it('spreads the first results across places', () => {
    // Signed out: a profile would (rightly) lift the customer's favourite place above the rotation.
    const anon = fixtureData({ signedIn: false });
    const r = { ...emptyRequest('he'), meal: 'dinner' as const };
    const top = rank(retrieve(r, anon), r, anon).slice(0, 4).map((h) => h.dish.branchId);
    expect(new Set(top).size).toBe(4);
  });
  it('breakfast pushes breakfast dishes and hot drinks first', () => {
    const r = req('ארוחת בוקר');
    const first = rank(retrieve(r, data), r, data)[0]!;
    expect(first.dish.entry.tags).toEqual(expect.arrayContaining([expect.stringMatching(/breakfast|hot_drink/)]));
  });
});

describe('profile', () => {
  it('finds the usual per place from accepted orders', () => {
    const p = buildProfile(ORDERS, (br, id) => data.dishById.get(`${br}/${id}`)?.entry.dishType)!;
    expect(p.usuals[0]).toMatchObject({ branchId: 'morano', count: 3 });
    expect(p.usuals[0]!.lines.map((l) => l.productId)).toEqual(['m-margherita', 'm-coke']);
    expect(p.favoriteBranches).toEqual(['morano']);
    expect(p.orderedProductIds).not.toContain('a-platter');
    expect(p.usualMode).toBe('pickup');
  });
  it('no orders, no profile', () => {
    expect(buildProfile([], () => undefined)).toBeUndefined();
  });
});
