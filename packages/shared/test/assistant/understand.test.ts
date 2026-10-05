import { describe, expect, it } from 'vitest';
import { detectLang, hasSlots, understand, uniq, type PlaceName, type Previous } from '../../src/index.js';

const places: PlaceName[] = [
  { branchId: 'morano', name: { he: 'מורנו', ar: 'مورانو', en: 'Morano' } },
  { branchId: 'abu', name: { he: 'אבו סלים', ar: 'ابو سليم', en: 'Abu Salim' } },
  { branchId: 'burger', name: { he: 'בורגר באזל', ar: 'برغر بازل', en: 'Burger Basil' } },
];
const u = (text: string, prev?: Previous) => understand(text, places, prev);

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

  it('uniq keeps first occurrences', () => {
    expect(uniq(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
});
