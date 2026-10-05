import { describe, expect, it } from 'vitest';
import { ALL_FILTERS, buildProfile, clockAt, cravingMatches, emptyRequest, placeUsable, rank, retrieve, roundRobin, understand, type Request } from '../../src/index.js';
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
  it('adds minutes to the instant, not to the wall clock, across DST', () => {
    // Clocks go back 02:00 -> 01:00 on 25 Oct 2026, and forward 02:00 -> 03:00 on 27 Mar 2026.
    expect(clockAt(new Date('2026-10-24T21:30:00.000Z'), 120)).toBe('01:30');
    expect(clockAt(new Date('2026-03-26T23:30:00.000Z'), 120)).toBe('04:30');
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

describe('retrieve: strongest tier only, type words are not names', () => {
  it('fries finds the fries, not onion rings or falafel', () => {
    for (const q of ['fries', 'צ׳יפס', 'ציפס']) expect(ids(req(q)), q).toEqual(['m-fries']);
  });
  it('cola finds cola, not the chocolate cake ("cola" inside "chocolate")', () => {
    for (const q of ['cola', 'קולה', 'كولا']) {
      const got = ids(req(q));
      expect(got, q).toEqual(expect.arrayContaining(['m-coke']));
      expect(got, q).not.toContain('dl-chocolate-cake');
    }
  });
  it('type words still find dishes whose name lacks the word', () => {
    expect(ids(req('snacks'))).toEqual(expect.arrayContaining(['b-onion-rings', 'a-falafel', 'm-fries']));
    expect(ids(req('مقبلات'))).toEqual(expect.arrayContaining(['b-onion-rings']));
  });
  it('keeps only the best tier present', () => {
    // "cola": whole word (tier 0) beats inside-a-word and sound matches.
    const levels = retrieve(req('cola'), data).map((c) => c.match);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(100);
  });
  it('reuses the craving match map across calls on the same data', () => {
    const a = cravingMatches(data, ['פיצה']);
    expect(cravingMatches(data, ['פיצה'])).toBe(a);
    expect(cravingMatches(data, ['pizza'])).not.toBe(a);
    retrieve(req('פיצה'), data, { ...ALL_FILTERS, open: false });
    expect(cravingMatches(data, ['פיצה'])).toBe(a);
    expect(cravingMatches(fixtureData(), ['פיצה'])).not.toBe(a);
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

describe('rank: no craving', () => {
  it('a signed-in customer is never led to a drink, on any day', () => {
    for (let day = 0; day < 20; day++) {
      const d = fixtureData({ now: new Date(NOW.getTime() + day * 86_400_000) });
      for (const text of ['תפתיע אותי', 'what should I eat']) {
        const r = understand(text, d.placeNames);
        const top = rank(retrieve(r, d), r, d).slice(0, 3).map((h) => h.dish.entry.dishType);
        expect(top, `${text} day ${day}`).not.toContain('drinks');
      }
      const dinner = { ...emptyRequest('he'), meal: 'dinner' as const };
      expect(rank(retrieve(dinner, d), dinner, d)[0]!.dish.entry.dishType, `dinner day ${day}`).not.toBe('drinks');
    }
  });
  it('still serves a drink when one is asked for', () => {
    const r = req('קולה');
    expect(rank(retrieve(r, data), r, data)[0]!.dish.entry.dishType).toBe('drinks');
  });
});

describe('profile', () => {
  it('favourite types count orders, not quantities, and never include drinks', () => {
    const p = buildProfile(ORDERS, (br, id) => data.dishById.get(`${br}/${id}`)?.entry.dishType)!;
    expect(p.favoriteTypes).toEqual(['pizza']);
  });
  it('only accepted orders count: placed ones are still pending', () => {
    const placed = ORDERS.map((o) => ({ ...o, status: 'placed' }));
    expect(buildProfile(placed, () => undefined)).toBeUndefined();
  });
  it('a tie between modes goes to the most recent order', () => {
    const line = { productId: 'x', name: { he: 'x' }, quantity: 1, modifiers: [] };
    const o = (placedAt: string, mode: 'pickup' | 'delivery') => ({ branchId: 'morano', businessId: 'b-morano', placedAt, mode, status: 'accepted', lines: [line] });
    expect(buildProfile([o('2026-09-01T10:00:00Z', 'delivery'), o('2026-09-05T10:00:00Z', 'pickup')], () => undefined)!.usualMode).toBe('pickup');
    expect(buildProfile([o('2026-09-05T10:00:00Z', 'pickup'), o('2026-09-01T10:00:00Z', 'delivery')], () => undefined)!.usualMode).toBe('pickup');
  });
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
