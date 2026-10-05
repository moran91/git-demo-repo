import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION, afterAdd, homeView, rank, respond, retrieve, type AssistantTurn, type Card, type Conversation } from '../../src/index.js';
import { PLACES, allClosed, fixtureData } from './fixtures.js';

const data = fixtureData();
const opts = { signedIn: true, uiLang: 'he' as const };
const say = (...msgs: string[]) => msgs.reduce<Conversation>((c, m) => respond(c, m, data, opts), EMPTY_CONVERSATION);
const last = (c: Conversation) => c.turns.at(-1) as AssistantTurn;
const ids = (t: AssistantTurn) => t.cards.map((x: Card) => (x.kind === 'dish' ? x.productId : ''));

describe('respond', () => {
  it('answers a craving with three dish cards, refinement chips and "more"', () => {
    const c = say('משהו חריף');
    const t = last(c);
    expect(t.kind).toBe('dish');
    expect(t.cards).toHaveLength(3);
    expect(t.chips.map((x) => x.label)).toContain('יותר זול');
    expect(t.more).toBeDefined();
    expect(c.last!.request.tags).toEqual(['spicy']);
  });

  it('"more" shows the next ranked cards, none of them shown before', () => {
    const c1 = say('משהו חריף');
    const c2 = respond(c1, last(c1).more!, data, opts);
    const first = ids(last(c1));
    const next = ids(last(c2));
    expect(next.length).toBeGreaterThan(0);
    for (const id of next) expect(first).not.toContain(id);
    const r = c1.last!.request;
    const ranked = rank(retrieve(r, data), r, data).map((h) => h.dish.id);
    expect(first).toEqual(ranked.slice(0, 3));
    expect(next).toEqual(ranked.slice(3, 6));
  });

  it('budget too low: names the budget and offers to drop it', () => {
    const c = say('ל-6 עד 30');
    const t = last(c);
    expect(t.kind).toBe('blocked');
    expect(t.text).toContain('₪30');
    expect(t.cards).toEqual([]);
    const drop = t.chips[0]!;
    expect(drop.request?.budgetAgorot).toBeUndefined();
    expect(last(respond(c, drop, data, opts)).kind).toBe('meal');
  });

  it('all closed: says when the first place opens, offers nothing to add', () => {
    const closed = fixtureData({ places: allClosed() });
    const t = last(respond(EMPTY_CONVERSATION, 'פיצה', closed, opts));
    expect(t.kind).toBe('closed');
    expect(t.text).toContain('22:00');
    expect(t.cards).toEqual([]);
    const home = homeView(closed, opts);
    expect(home.closedUntil).toBe('22:00');
    expect(home.cards).toEqual([]);
  });

  it('reprompt ladder: never the same reprompt twice, the second one offers fixed choices only', () => {
    const c1 = say('qwzx');
    expect(last(c1).kind).toBe('reprompt');
    const c2 = respond(c1, 'zzqq', data, opts);
    expect(last(c2).kind).toBe('reprompt');
    expect(last(c2).text).not.toBe(last(c1).text);
    expect(last(c2).cards).toEqual([]);
    expect(last(c2).chips.length).toBeGreaterThanOrEqual(3);
    expect(c2.misses).toBe(2);
    const c3 = respond(c2, 'xqxq', data, opts);
    expect(last(c3).text).not.toBe(last(c2).text);
  });

  it('reads the wrong keyboard', () => {
    const t = last(say('auutrnv'));
    expect(t.kind).toBe('dish');
    expect(ids(t)).toContain('a-shawarma-chicken');
  });

  it('replies in the UI language when the message has no letters', () => {
    expect(last(respond(EMPTY_CONVERSATION, '150', data, opts)).text).toMatch(/[֐-׿]/);
    expect(last(respond(EMPTY_CONVERSATION, '150', data, { ...opts, uiLang: 'ar' })).text).toMatch(/[؀-ۿ]/);
  });

  it('usual: signed in shows it, signed out asks to sign in', () => {
    expect(last(say('הרגיל שלי')).kind).toBe('usual');
    const t = last(respond(EMPTY_CONVERSATION, 'הרגיל שלי', fixtureData({ signedIn: false }), { signedIn: false, uiLang: 'he' }));
    expect(t.signIn).toBe(true);
  });

  it('a refinement after a shortcut drops the shortcut', () => {
    const c = say('הרגיל שלי', 'ל-4');
    expect(last(c).kind).toBe('meal');
    expect(c.last!.request.shortcut).toBeUndefined();
    expect(c.last!.request.people).toBe(4);
  });

  it('every refinement chip is understood in every language', () => {
    for (const [uiLang, msg] of [['he', 'משהו צמחוני'], ['ar', 'اشي نباتي'], ['en', 'something vegetarian']] as const) {
      const o = { signedIn: true, uiLang };
      const c = respond(EMPTY_CONVERSATION, msg, data, o);
      expect(last(c).chips.length).toBe(4);
      for (const chip of last(c).chips) {
        const t = last(respond(c, chip, data, o));
        expect(t.kind, `${uiLang} ${chip.label}`).not.toBe('reprompt');
        expect(t.cards.length, `${uiLang} ${chip.label}`).toBeGreaterThan(0);
      }
    }
  });

  it('a place answer does not repeat the place name', () => {
    const t = last(say('מה יש במורנו'));
    expect(t.kind).toBe('place');
    expect(t.text).not.toContain('מורנו');
  });

  it('one upsell per add, and none after two skips', () => {
    const c1 = afterAdd(say('פיצה'), { branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data);
    expect(last(c1).kind).toBe('upsell');
    expect(last(c1).cards).toEqual([{ kind: 'dish', branchId: 'morano', productId: 'm-coke' }]);
    expect(last(c1).upsold).toBe('m-coke');
    expect(afterAdd(c1, { branchId: 'morano', productId: 'm-coke' }, ['m-margherita', 'm-coke'], data)).toBe(c1);
    let c = respond(c1, 'המבורגר', data, { ...opts, inCart: ['m-margherita'] });
    expect(c.upsellSkips).toBe(1);
    c = afterAdd(c, { branchId: 'burger', productId: 'b-classic' }, ['b-classic'], data);
    expect(last(c).kind).toBe('upsell');
    c = respond(c, 'קינוח', data, { ...opts, inCart: ['b-classic'] });
    expect(c.upsellSkips).toBe(2);
    expect(afterAdd(c, { branchId: 'dolce', productId: 'dl-waffle' }, ['dl-waffle'], data)).toBe(c);
  });

  it('an upsell with no conversation yet speaks the UI language', () => {
    const c = afterAdd(EMPTY_CONVERSATION, { branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data, 'en');
    expect(last(c).text).toMatch(/^[A-Za-z]/);
  });

  it('a people-only meal with no basket shows dishes instead of an empty blocked line', () => {
    const onlyDolce = fixtureData({ places: PLACES.map((p) => ({ ...p, open: p.branchId === 'dolce' })) });
    const t = last(respond(EMPTY_CONVERSATION, 'ל-4', onlyDolce, opts));
    expect(t.kind).not.toBe('blocked');
    expect(t.cards.length).toBeGreaterThan(0);
  });

  it('accepting an upsell is not a skip', () => {
    const c1 = afterAdd(say('פיצה'), { branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data);
    const c2 = afterAdd(c1, { branchId: 'morano', productId: 'm-coke' }, ['m-margherita', 'm-coke'], data);
    const c3 = respond(c2, 'סושי', data, { ...opts, inCart: ['m-margherita', 'm-coke'] });
    expect(c3.upsellSkips).toBe(0);
  });
});

describe('homeView', () => {
  it('greets by the time and offers the usual, a deal and a pick from three different places', () => {
    const home = homeView(data, opts);
    expect(home.greeting).toMatch(/ערב|מה לערב/);
    expect(home.cards.map((c) => c.kind)).toEqual(['usual', 'deal', 'dish']);
    const branches = home.cards.map((c) => (c.kind === 'usual' ? c.usual.branchId : c.kind === 'meal' ? c.basket.branchId : c.branchId));
    expect(new Set(branches).size).toBe(3);
    expect(home.chips.length).toBeGreaterThanOrEqual(3);
  });

  it('every home chip is understood in every language', () => {
    for (const uiLang of ['he', 'ar', 'en'] as const) {
      const o = { signedIn: true, uiLang };
      for (const chip of homeView(data, o).chips) {
        const t = last(respond(EMPTY_CONVERSATION, chip, data, o));
        expect(t.kind, `${uiLang} ${chip.label}`).not.toBe('reprompt');
        expect(t.cards.length, `${uiLang} ${chip.label}`).toBeGreaterThan(0);
      }
    }
  });
});
