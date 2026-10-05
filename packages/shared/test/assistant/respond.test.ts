import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION, afterAdd, formatILS, homeView, rank, reply, respond, retrieve, type AssistantTurn, type Card, type Conversation, type ReplyKey } from '../../src/index.js';
import { NOW, PLACES, allClosed, fixtureData } from './fixtures.js';

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
    // The same money format as the cards and the cart ("‏30 ‏₪"), not a home-made "₪30".
    expect(t.text).toContain(formatILS(3000, 'he'));
    expect(t.text).not.toContain('₪30');
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

describe('fix round 1', () => {
  const he = opts;
  const onDay = (k: number, o: Parameters<typeof fixtureData>[0] = {}) => fixtureData({ ...o, now: new Date(NOW.getTime() + k * 86_400_000) });
  const closedSome = (ids: string[], opensInMin?: number) => PLACES.map((p) => (ids.includes(p.branchId) ? { ...p, open: false, ...(opensInMin !== undefined ? { opensInMin } : { opensInMin: undefined }) } : p));
  const noTime = () => PLACES.map((p) => ({ ...p, open: false, opensInMin: undefined }));
  const brokenTime = /ב־(\.|,|$)|at \.|الساعة \.|بيفتح \./;

  it('1. the usual skips closed places and names when they open', () => {
    const d = fixtureData({ places: closedSome(['morano', 'abu'], 300) });
    const t = last(respond(EMPTY_CONVERSATION, 'הרגיל שלי', d, he));
    expect(t.cards.filter((c) => c.kind === 'usual')).toEqual([]);
    expect(t.kind).toBe('closed');
    expect(t.text).toContain('מורנו');
    expect(t.text).toContain('01:00');
  });

  it('1. deals and a signed-out usual when everything is closed say when the first place opens', () => {
    const closed = fixtureData({ places: allClosed() });
    const deals = last(respond(EMPTY_CONVERSATION, 'מבצעים', closed, he));
    expect(deals.kind).toBe('closed');
    expect(deals.text).toContain('22:00');
    const out = fixtureData({ places: allClosed(), signedIn: false });
    const usual = last(respond(EMPTY_CONVERSATION, 'הרגיל שלי', out, { signedIn: false, uiLang: 'he' }));
    expect(usual.kind).toBe('closed');
    expect(usual.text).toContain('22:00');
  });

  it('1. a signed-out usual with nothing to show falls back to the closed answer', () => {
    const places = [...allClosed(), { branchId: 'empty', businessId: 'b-empty', name: { he: 'ריק' }, open: true, modes: ['pickup' as const] }];
    const d = fixtureData({ places, signedIn: false });
    const t = last(respond(EMPTY_CONVERSATION, 'הרגיל שלי', d, { signedIn: false, uiLang: 'he' }));
    expect(t.kind).toBe('closed');
    expect(t.text).toContain('22:00');
  });

  it('2. refinement chips work after a wrong-keyboard answer', () => {
    const c = say('auutrnv');
    expect(c.last!.request.craving).toEqual(['שווארמה']);
    for (const label of ['יותר זול', 'משהו אחר']) {
      const chip = last(c).chips.find((x) => x.label === label)!;
      const t = last(respond(c, chip, data, opts));
      expect(t.kind, label).not.toBe('reprompt');
    }
  });

  it('3. the tags drop chip drops one blocking tag and never reprompts', () => {
    const c = say('משהו טבעוני חריף');
    expect(last(c).kind).toBe('blocked');
    const drop = last(c).chips[0]!;
    expect(drop.request!.tags).toHaveLength(1);
    const t = last(respond(c, drop, data, opts));
    expect(t.kind).not.toBe('reprompt');
    expect(t.cards.length).toBeGreaterThan(0);
  });

  it('3. a drop chip that leaves no slots answers with picks for now', () => {
    const d = fixtureData({ places: PLACES.filter((p) => p.branchId === 'morano') });
    const c = respond(EMPTY_CONVERSATION, 'משהו טבעוני', d, opts);
    expect(last(c).kind).toBe('blocked');
    const t = last(respond(c, last(c).chips[0]!, d, opts));
    expect(t.kind).toBe('dish');
    expect(t.cards.length).toBeGreaterThan(0);
  });

  it('4. a dish only at a closed place names the place and offers chips', () => {
    const t = last(say('שניצל'));
    expect(t.kind).toBe('closed');
    expect(t.text).toContain('באגט פארס');
    expect(t.text).toContain('22:00');
    expect(t.chips.length).toBeGreaterThan(0);
  });

  it('4. when everything is closed the line is about everything, not one place', () => {
    const t = last(respond(EMPTY_CONVERSATION, 'פיצה', fixtureData({ places: allClosed() }), he));
    expect(t.text).toMatch(/הכול|אין כרגע מקום/);
    expect(t.text).not.toContain('מורנו');
  });

  it('5. no opening time never leaves a broken line', () => {
    for (const lang of ['he', 'ar', 'en'] as const) {
      const o = { signedIn: true, uiLang: lang };
      const all = fixtureData({ places: noTime() });
      const msg = lang === 'he' ? 'פיצה' : lang === 'ar' ? 'بيتزا' : 'pizza';
      const t = last(respond(EMPTY_CONVERSATION, msg, all, o));
      expect(t.kind).toBe('closed');
      expect(t.text, lang).not.toMatch(brokenTime);
      const home = homeView(all, o);
      expect(home.greeting, lang).not.toMatch(brokenTime);
      expect(home.closedUntil).toBeUndefined();
      const one = fixtureData({ places: closedSome(['baguette']) });
      const s = last(respond(EMPTY_CONVERSATION, lang === 'he' ? 'שניצל' : lang === 'ar' ? 'شنيتسل' : 'schnitzel', one, o));
      if (s.kind === 'closed') expect(s.text, lang).not.toMatch(brokenTime);
    }
    const s = last(respond(EMPTY_CONVERSATION, 'שניצל', fixtureData({ places: closedSome(['baguette']) }), he));
    expect(s.kind).toBe('closed');
    expect(s.text).toContain('באגט פארס');
  });

  it('6. "something else" never repeats anything shown before, across pages and "no more"', () => {
    const seen = (c: Conversation) => c.turns.flatMap((t) => (t.role === 'assistant' ? ids(t) : []));
    const c1 = say('משהו חריף', 'עוד');
    const before = seen(c1);
    const c2 = respond(c1, 'משהו אחר', data, opts);
    for (const id of ids(last(c2))) expect(before).not.toContain(id);
    const p1 = say('pizza', 'cheaper', 'more');
    expect(last(p1).kind).toBe('none');
    const shownBefore = seen(p1);
    const p2 = respond(p1, 'something else', data, opts);
    for (const id of ids(last(p2))) expect(shownBefore).not.toContain(id);
  });

  it('7. the home deal and the first deal rotate between places by day', () => {
    const homeLead = new Set<string>();
    const dealLead = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const d = onDay(k, { signedIn: false });
      const o = { signedIn: false, uiLang: 'he' as const };
      const deal = homeView(d, o).cards.find((c) => c.kind === 'deal');
      if (deal?.kind === 'deal') homeLead.add(deal.branchId);
      const first = last(respond(EMPTY_CONVERSATION, 'מבצעים', d, o)).cards[0];
      if (first?.kind === 'deal') dealLead.add(first.branchId);
    }
    expect([...homeLead].sort()).toEqual(['burger', 'morano']);
    expect([...dealLead].sort()).toEqual(['burger', 'morano']);
  });

  it('8. each blocked slot has its own wording, and the newest wish is blamed first', () => {
    const c = say('פיצה בלי גבינה', 'יותר זול');
    const t = last(c);
    expect(t.kind).toBe('blocked');
    expect(t.text).toContain('₪');
    expect(t.text).not.toMatch(/עם בלי|בלי גבינה/);
    expect(t.chips[0]!.request!.maxPriceAgorot).toBeUndefined();
    const ar = respond(respond(EMPTY_CONVERSATION, 'بيتزا بدون جبنة', data, { ...opts, uiLang: 'ar' }), 'أرخص', data, { ...opts, uiLang: 'ar' });
    expect(last(ar).text).not.toContain('مع بدون');
    const ex = last(say('פיצה בלי גבינה בלי חריף'));
    expect(ex.kind).toBe('blocked');
    expect(ex.text).toContain('בלי');
    expect(ex.text).not.toContain('עם');
  });

  it('9. every reply is one sentence', () => {
    const keys: ReplyKey[] = ['picks', 'picksNow', 'meal', 'mealBudget', 'deals', 'dealsNone', 'usual', 'usualNone', 'usualSignedOut', 'surprise', 'place', 'blockedTags', 'blockedExclude', 'blockedOther', 'blockedBudget', 'blockedMode', 'blockedPlace', 'closed', 'closedNoTime', 'closedAll', 'closedAllNoTime', 'noMore', 'reprompt1', 'reprompt2', 'upsell', 'greetMorning', 'greetNoon', 'greetEvening', 'greetNight'];
    for (const k of keys) for (const lang of ['he', 'ar', 'en'] as const) for (let s = 0; s < 3; s++) {
      expect(reply(k, lang, { place: 'X', time: '22:00', slot: 'Y', people: 4, budget: '₪50' }, s), `${k} ${lang} ${s}`).not.toMatch(/[.!?؟]\s+\S/);
    }
  });

  it('10. "no matching deal" does not offer the deals chip again', () => {
    const t = last(say('מבצע על סושי'));
    expect(t.cards).toEqual([]);
    expect(t.chips.map((c) => c.label)).not.toContain('מה במבצע?');
  });

  it('11. the place line does not claim a ranking', () => {
    for (const lang of ['he', 'ar', 'en'] as const) for (let s = 0; s < 3; s++) expect(reply('place', lang, {}, s)).not.toMatch(/הכי|أحسن|الأكثر|Best|Most/);
  });

  it('12. a reprompt with no cards never says it found something close', () => {
    for (let k = 0; k < 10; k++) {
      const d = onDay(k);
      for (const msg of ['qwzx', 'שדגכשדג', 'ضصثقضصث']) {
        const t = last(respond(EMPTY_CONVERSATION, msg, d, opts));
        if (t.kind === 'reprompt' && !t.cards.length) expect(t.text).not.toMatch(/הכי קרוב|أقرب|Closest/);
      }
    }
  });

  it('13. a budget-only meal does not claim a head count', () => {
    for (let k = 0; k < 6; k++) {
      const t = last(respond(EMPTY_CONVERSATION, '150', onDay(k), opts));
      expect(t.kind).toBe('meal');
      expect(t.text).not.toMatch(/ל־1|ל-1/);
    }
  });

  it('14. gibberish read on another keyboard as one-letter words climbs the ladder', () => {
    for (const g of ['xqxq', 'pqpq']) expect(last(say(g)).kind, g).toBe('reprompt');
    const c = say('qwzx', 'zzqq', 'xqxq');
    expect(last(c).kind).toBe('reprompt');
    expect(last(c).cards).toEqual([]);
  });

  it('15. "more" after the usual does not repeat the usual cards', () => {
    const c = say('הרגיל שלי', 'עוד');
    expect(last(c).cards.filter((x) => x.kind === 'usual')).toEqual([]);
    expect(last(c).kind).toBe('none');
  });
});
