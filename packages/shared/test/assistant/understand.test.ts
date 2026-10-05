import { describe, expect, it } from 'vitest';
import { detectLang, emptyRequest, hasSlots, understand, uniq, type Lang, type PlaceName, type Previous, type Request } from '../../src/index.js';

const places: PlaceName[] = [
  { branchId: 'morano', name: { he: 'מורנו', ar: 'مورانو', en: 'Morano' } },
  { branchId: 'abu', name: { he: 'אבו סלים', ar: 'ابو سليم', en: 'Abu Salim' } },
  { branchId: 'burger', name: { he: 'בורגר באזל', ar: 'برغر بازل', en: 'Burger Basil' } },
];
const u = (text: string, prev?: Previous) => understand(text, places, prev);
/** The whole request: an empty one in `lang` with only the stated slots set. */
const want = (lang: Lang, patch: Partial<Request>): Request => ({ ...emptyRequest(lang), ...patch });
const noWords = (tags: Request['exclude']['tags'], words: string[]) => ({ tags, words, dishIds: [], branchIds: [] });

describe('understand', () => {
  it('taste wishes are tags, food words stay as the craving', () => {
    expect(u('משהו חריף')).toMatchObject({ tags: ['spicy'], craving: [] });
    expect(u('פיצה חריפה')).toMatchObject({ tags: ['spicy'], craving: ['פיצה'] });
    expect(u('ללא גלוטן')).toMatchObject({ tags: ['gluten_free'], exclude: { tags: [], words: [] } });
  });

  it('negation excludes a tag or a word', () => {
    const r = u('פיצה בלי בשר');
    expect(r.craving).toEqual(['פיצה']);
    expect(r.exclude.tags).toEqual(['meat']);
    expect(u('בלי בצל').exclude.words).toEqual(['בצל']);
    expect(u('not spicy shawarma')).toMatchObject({ craving: ['shawarma'], exclude: { tags: ['spicy'] } });
  });

  it('digits and glued tokens', () => {
    for (const s of ['ל-٤', 'لـ٤', 'ל4', 'ל-4', 'for 4', 'for four people', 'לארבעה', 'لأربعة', '4 אנשים']) expect(u(s).people, s).toBe(4);
    expect(u('לשניים').people).toBe(2);
    expect(u('אני ואשתי').people).toBe(2);
    expect(u('למשפחה').people).toBe(4);
    for (const [s, agorot] of [['150₪', 15000], ['עד 50', 5000], ['50 ש"ח', 5000], ['up to 80 shekels', 8000], ['حتى 70 شيكل', 7000], ['under 60', 6000], ['150', 15000]] as const) expect(u(s).budgetAgorot, s).toBe(agorot);
  });

  it('budget cues leave no craving and no people', () => {
    expect(u('מתחת ל-50')).toMatchObject({ budgetAgorot: 5000, craving: [] });
    expect(u('מתחת ל-50').people).toBeUndefined();
    expect(u('בתקציב של 100')).toMatchObject({ budgetAgorot: 10000, craving: [] });
    expect(u('עד ₪50')).toMatchObject({ budgetAgorot: 5000, craving: [] });
    expect(u('15')).toMatchObject({ budgetAgorot: 1500 });
  });

  it('a full request', () => {
    expect(u('משהו חריף ל-4 עד 150')).toMatchObject({ tags: ['spicy'], people: 4, budgetAgorot: 15000, craving: [] });
    expect(u('something spicy for 4 under 150')).toMatchObject({ tags: ['spicy'], people: 4, budgetAgorot: 15000, craving: [] });
    expect(u('اشي حار لأربعة بحدود 150')).toMatchObject({ tags: ['spicy'], people: 4, budgetAgorot: 15000, craving: [] });
  });

  it('mode, meal, cheap and shortcuts', () => {
    expect(u('סושי באיסוף')).toMatchObject({ mode: 'pickup', craving: ['סושי'] });
    expect(u('توصيل شاورما')).toMatchObject({ mode: 'delivery', craving: ['شاورما'] });
    expect(u('ארוחת בוקר')).toMatchObject({ meal: 'breakfast', craving: [] });
    expect(u('הכי זול').cheap).toBe(true);
    expect(u('הרגיל שלי').shortcut).toBe('usual');
    expect(u('زي العادة').shortcut).toBe('usual');
    expect(u('לא יודע').shortcut).toBe('surprise');
    expect(u('מה במבצע?').shortcut).toBe('deals');
  });

  it('"meal" words are filler, not a dish to search for', () => {
    expect(u('ארוחה ל-4 עד 150')).toMatchObject({ craving: [], people: 4, budgetAgorot: 15000 });
    expect(u('meal for 3 vegetarian')).toMatchObject({ craving: [], people: 3, tags: ['vegetarian'] });
    expect(u('وجبة ل 4')).toMatchObject({ craving: [], people: 4 });
    expect(u('wajbe la 2')).toMatchObject({ craving: [], people: 2 });
    expect(u('ארוחת ילדים')).toMatchObject({ craving: [] });
  });

  it('places by name, with or without "from"; a food word alone is not a place', () => {
    expect(u('ממורנו').placeBranchIds).toEqual(['morano']);
    expect(u('something from morano').placeBranchIds).toEqual(['morano']);
    expect(u('من مورانو').placeBranchIds).toEqual(['morano']);
    expect(u('בורגר באזל')).toMatchObject({ placeBranchIds: ['burger'], craving: ['בורגר'] });
    expect(u('burger').placeBranchIds).toBeUndefined();
  });

  it('refinements change only what was said', () => {
    const picks: Previous = { request: u('משהו חריף'), shown: { dishIds: ['d1'], branchIds: ['b1'], maxTotalAgorot: 5000 } };
    expect(u('יותר זול', picks)).toMatchObject({ tags: ['spicy'], maxPriceAgorot: 4000 });
    expect(u('משהו אחר', picks).exclude.dishIds).toEqual(['d1']);
    expect(u('ממקום אחר', picks).exclude.branchIds).toEqual(['b1']);
    expect(u('עוד', picks).page).toBe(1);
    expect(u('לא חריף', picks)).toMatchObject({ tags: [], exclude: { tags: ['spicy'] } });
    expect(u('פיצה', picks)).toMatchObject({ craving: ['פיצה'], tags: [] });
    const meal: Previous = { request: u('ל-4 עד 150'), shown: { dishIds: [], branchIds: ['b1'], maxTotalAgorot: 14000 } };
    expect(u('יותר זול', meal)).toMatchObject({ people: 4, budgetAgorot: 11200 });
    expect(u('ל-6 במקום', meal)).toMatchObject({ people: 6, budgetAgorot: 15000 });
  });

  it('language and empty messages', () => {
    expect(detectLang('shi 7ar')).toBe('ar');
    expect(detectLang('pizza')).toBe('en');
    expect(detectLang('פיצה')).toBe('he');
    expect(detectLang('بيتزا')).toBe('ar');
    expect(hasSlots(u('hello'))).toBe(false);
    expect(hasSlots(u('שלום'))).toBe(false);
  });

  it('negation chains over "and": without X and Y excludes both', () => {
    expect(u('בלי בצל ובלי עגבניות')).toEqual(want('he', { exclude: noWords([], ['בצל', 'עגבניות']) }));
    expect(u('שווארמה בלי בצל ועגבניה')).toEqual(want('he', { craving: ['שווארמה'], exclude: noWords([], ['בצל', 'עגבניה']) }));
    expect(u('شاورما بدون بصل وبدون بندورة')).toEqual(want('ar', { craving: ['شاورما'], exclude: noWords([], ['بصل', 'بندوره']) }));
    expect(u('burger without onion and tomato')).toEqual(want('en', { craving: ['burger'], exclude: noWords([], ['onion', 'tomato']) }));
  });

  it('a people word after the number beats a budget word before it', () => {
    expect(u('עד 4 אנשים')).toEqual(want('he', { people: 4 }));
    expect(u('up to 4 people')).toEqual(want('en', { people: 4 }));
    expect(u('max 6 people')).toEqual(want('en', { people: 6 }));
    expect(u('עד 50 שקל')).toEqual(want('he', { budgetAgorot: 5000 }));
  });

  it('a message without letters keeps the previous language, else the fallback', () => {
    const he: Previous = { request: u('משהו חריף'), shown: { dishIds: [], branchIds: [] } };
    const ar: Previous = { request: u('اشي حار'), shown: { dishIds: [], branchIds: [] } };
    expect(u('2', he).lang).toBe('he');
    expect(u('150', he)).toMatchObject({ lang: 'he', budgetAgorot: 15000 });
    expect(u('2', ar).lang).toBe('ar');
    expect(u('150₪', ar)).toMatchObject({ lang: 'ar', budgetAgorot: 15000 });
    expect(understand('30', places).lang).toBe('he');
    expect(understand('30', places, undefined, 'ar').lang).toBe('ar');
    expect(understand('pizza', places, ar, 'ar').lang).toBe('en');
  });

  it('arabizi: people, budget, taste and exclusions', () => {
    expect(u('shi 7ar la 4 la7ad 150')).toEqual(want('ar', { tags: ['spicy'], people: 4, budgetAgorot: 15000 }));
    expect(u('7ar bdun la7meh')).toEqual(want('ar', { tags: ['spicy'], exclude: noWords(['meat'], ['la7meh']) }));
    expect(u('pizza la arba3a 7atta 100')).toEqual(want('ar', { craving: ['pizza'], people: 4, budgetAgorot: 10000 }));
    expect(u('pizza bidun jebne')).toEqual(want('en', { craving: ['pizza'], exclude: noWords(['cheese'], ['jebne']) }));
  });

  it('number words: two, "for two people", tens and hundreds', () => {
    expect(u('שתי פיצות')).toEqual(want('he', { craving: ['פיצות'], people: 2 }));
    expect(u('שני שווארמות')).toEqual(want('he', { craving: ['שווארמות'], people: 2 }));
    expect(u('بيتزا لشخصين')).toEqual(want('ar', { craving: ['بيتزا'], people: 2 }));
    expect(u('لتنين')).toEqual(want('ar', { people: 2 }));
    expect(u('עד מאה שקל')).toEqual(want('he', { budgetAgorot: 10000 }));
    expect(u('עד חמישים')).toEqual(want('he', { budgetAgorot: 5000 }));
    expect(u('حتى مية شيكل')).toEqual(want('ar', { budgetAgorot: 10000 }));
    expect(u('بحدود خمسين')).toEqual(want('ar', { budgetAgorot: 5000 }));
    expect(u('under fifty')).toEqual(want('en', { budgetAgorot: 5000 }));
    expect(u('up to a hundred shekels')).toEqual(want('en', { budgetAgorot: 10000 }));
  });

  it('intensifiers after a negation belong to it', () => {
    expect(u('not too spicy')).toEqual(want('en', { exclude: noWords(['spicy'], ['spicy']) }));
    expect(u('לא חריף מדי')).toEqual(want('he', { exclude: noWords(['spicy'], ['חריפ']) }));
    expect(u('לא כל כך חריף')).toEqual(want('he', { exclude: noWords(['spicy'], ['חריפ']) }));
    expect(u('مش حار كتير')).toEqual(want('ar', { exclude: noWords(['spicy'], ['حار']) }));
  });

  it('"no more than N" is a budget, not an exclusion', () => {
    expect(u('no more than 100')).toEqual(want('en', { budgetAgorot: 10000 }));
    expect(u('not more than 100')).toEqual(want('en', { budgetAgorot: 10000 }));
    expect(u('לא יותר מ-100')).toEqual(want('he', { budgetAgorot: 10000 }));
  });

  it('places named with a ב or ל prefix', () => {
    expect(u('במורנו')).toEqual(want('he', { placeBranchIds: ['morano'] }));
    expect(u('למורנו')).toEqual(want('he', { placeBranchIds: ['morano'] }));
  });

  it('"we are N" is a head count', () => {
    expect(u('אנחנו 15')).toEqual(want('he', { people: 15 }));
    expect(u('we are 15')).toEqual(want('en', { people: 15 }));
    expect(u('احنا 5')).toEqual(want('ar', { people: 5 }));
    expect(u('احنا 15')).toEqual(want('ar', { people: 15 }));
  });

  it('uniq keeps first occurrences', () => {
    expect(uniq(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
});
