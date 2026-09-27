import { describe, expect, it } from 'vitest';
import { expandQueryWord, highlightRanges, layoutAlternatives, matchScore, matchTier, normalizeSearch, parseQuery, prepareFields, soundKey } from '../src/index.js';

describe('soundKey: one skeleton across Hebrew, Arabic, Latin and Arabizi', () => {
  const same = (words: string[]) => {
    const keys = new Set(words.map(soundKey));
    expect([...keys], words.join(' / ')).toHaveLength(1);
  };
  it('kubbeh in every spelling the user named', () => same(['كبب', 'קבב', 'קובב', 'kobbab', 'kubbab', 'kubbeh', 'kibbeh']));
  it('pasta', () => same(['باستا', 'פסטה', 'pasta']));
  it('pizza', () => same(['פיצה', 'بيتزا', 'pizza']));
  it('hummus, including Arabizi 7', () => same(['חומוס', 'حمص', 'hummus', 'humus', '7ummus', 'حُمُّص']));
  it('shawarma', () => same(['שווארמה', 'شاورما', 'shawarma', 'shawerma']));
  it('falafel', () => same(['פלאפל', 'فلافل', 'falafel']));
  it('burger', () => same(['בורגר', 'برغر', 'burger']));
  it('chips / fries spelled from Hebrew with a geresh', () => same(['צ׳יפס', "צ'יפס", 'ציפס', 'chips', 'شيبس']));
  it('halloumi', () => same(['חלומי', 'حلوم', 'halloumi', 'hallumi']));
  it('Arabizi 3 and 2 drop like ayin and hamza', () => same(['3arayes', 'arayes', 'عرايس', 'ערייס']));
  it('keeps different foods apart', () => {
    expect(soundKey('פסטה')).not.toBe(soundKey('פיצה'));
    expect(soundKey('קולה')).not.toBe(soundKey('קלאסית'));
  });
});

describe('expandQueryWord: the built-in food word list', () => {
  it('maps a word to its translations', () => {
    // Expansions come back normalised (final letters folded), the same form matching uses.
    const n = (xs: string[]) => xs.map(normalizeSearch);
    expect(expandQueryWord('دجاج')).toEqual(expect.arrayContaining(n(['עוף', 'chicken'])));
    expect(expandQueryWord('גבינה')).toEqual(expect.arrayContaining(n(['جبنة', 'cheese'])));
    expect(expandQueryWord('cheese')).toEqual(expect.arrayContaining(n(['גבינה'])));
  });
  it('leaves an unknown word alone', () => {
    expect(expandQueryWord('xyzzy')).toEqual(['xyzzy']);
  });
});

describe('matchTier: best tier or null', () => {
  const dish = (name: string, description = '', type = '', place = 'מורנו') => ({ name, description, type, place });
  it('tier 1: exact word in the name or the dish type', () => {
    expect(matchTier('פסטה', dish('פסטה רוזה'))).toBe(1);
    expect(matchTier('פיצה', dish('מרגריטה', '', 'פיצה بيتزا pizza'))).toBe(1);
  });
  it('an Arabic query finds a Hebrew-only dish by its name (sound or word list)', () => {
    const byName = (t: number | null) => t !== null && t <= 2;
    expect(byName(matchTier('باستا', dish('פסטה רוזה')))).toBe(true);
    expect(byName(matchTier('كبب', dish('קובב אפוי')))).toBe(true);
    expect(byName(matchTier('kubbab', dish('كبب مقلي')))).toBe(true);
    expect(byName(matchTier('קובב', dish('كبب مقلي')))).toBe(true);
  });
  it('an Arabic query finds a Hebrew-only dish by meaning', () => {
    expect(matchTier('دجاج', dish('מוקרם עוף בטטה'))).toBe(1);
    expect(matchTier('chicken', dish('מוקרם עוף בטטה'))).toBe(1);
  });
  it('tier 3: only the description matches; tier 4: only the place', () => {
    expect(matchTier('פטריות', dish('פסטה אלפרדו', 'ברוטב שמנת עם פטריות'))).toBe(3);
    expect(matchTier('מורנו', dish('פסטה אלפרדו'))).toBe(4);
  });
  it('every query word must match somewhere', () => {
    expect(matchTier('פסטה פטריות', dish('פסטה אלפרדו', 'עם פטריות'))).toBe(3);
    expect(matchTier('פסטה סושי', dish('פסטה אלפרדו'))).toBeNull();
  });
  it('guards against loose sound matches', () => {
    // Two letters never sound-match.
    expect(matchTier('קב', dish('כבד עוף'))).toBeNull();
    // A two-sound key must equal a word's key, not just start it.
    expect(matchTier('קולה', dish('פיצה קלאסית'))).toBeNull();
    expect(matchTier('קבב', dish('כבד עוף'))).toBeNull();
  });
  it('never sounds out word-list translations (chicken is not sweet potato)', () => {
    // دجاج expands to עופות (key B-T), which sounds like בטטה (B-T).
    expect(matchTier('دجاج', dish('רביולי בטטה', 'רביולי עבודת יד במילוי בטטה'))).toBeNull();
    expect(matchTier('chicken', dish('רביולי בטטה'))).toBeNull();
    expect(matchTier('دجاج', dish('מוקרם עוף בטטה'))).toBe(1);
  });
  it('does not sound out descriptions ("slush" is not "صلصة")', () => {
    expect(matchTier('slush', dish('פסטה אלפרדו', 'باستا بصلصة الفريدو'))).toBeNull();
  });
  it('finds the blended ice drink by any of its words', () => {
    for (const q of ['slush', 'frozen', 'سلاش', 'مثلج']) expect(matchTier(q, dish('גרוס מוראנו')), q).toBe(1);
  });
  it('a longer key may match the start of a word', () => {
    expect(matchTier('past', dish('פסטה רוזה'))).toBe(2);
  });
});

describe('search as you type: matchScore', () => {
  const dish = (name: string, description = '', type = '', place = 'מורנו') => prepareFields({ name, description, type, place });
  const level = (q: string, d: ReturnType<typeof dish>) => {
    const parsed = parseQuery(q);
    return parsed ? (matchScore(parsed, d)?.level ?? null) : null;
  };
  it('finds dishes from the first letters, word starts before word insides', () => {
    expect(level('פ', dish('פיצה מרגריטה'))).toBe(1);
    expect(level('פי', dish('פיצה מרגריטה'))).toBe(1);
    expect(level('פ', dish('ספרייט'))).toBeNull();
    expect(level('גריט', dish('פיצה מרגריטה'))).toBe(2);
    expect(level('פיצה', dish('פיצה מרגריטה'))).toBe(0);
  });
  it('a half-typed word finds its translations ("chi" → עוף, "دجا" → עוף)', () => {
    expect(level('chi', dish('שניצל עוף'))).toBe(3);
    expect(level('دجا', dish('שניצל עוף'))).toBe(3);
    // Finished word: no guessing.
    expect(level('chi ', dish('שניצל עוף'))).toBeNull();
  });
  it('a half-typed word sounds out once it is long enough', () => {
    expect(level('shawar', dish('שווארמה בפיתה'))).toBeLessThanOrEqual(5);
    expect(level('arays', dish('ערייס'))).toBe(4);
    expect(level('hambur', dish('המבורגר'))).toBeLessThanOrEqual(4);
    expect(level('شاورم', dish('שווארמה'))).toBeLessThanOrEqual(4);
  });
  it('forgives typos in longer words', () => {
    expect(level('hamburgr', dish('Hamburger'))).toBeLessThanOrEqual(5);
    expect(level('marghetita', dish('Pizza Margherita'))).toBe(5);
    expect(level('chiken', dish('שניצל עוף'))).toBe(5);
    // Not in short words, and never falafel for pepper.
    expect(level('cola', dish('Coca'))).toBeNull();
    expect(level('פלאפל ', dish('פלפל ממולא'))).toBeNull();
    expect(level('falafel ', dish('فلفل محشي'))).toBeNull();
    expect(level('גבינ', dish('פסטה עגבניות'))).toBeNull();
  });
  it('reads past the article (الفلافل, הפיצה)', () => {
    expect(level('الفلافل', dish('فلافل'))).toBe(0);
    expect(level('הפיצה', dish('פיצה מרגריטה'))).toBe(0);
    expect(level('falafel', dish('الفلافل'))).toBeLessThanOrEqual(4);
  });
  it('ranks the name above the description above the place', () => {
    const inName = matchScore(parseQuery('פטריות')!, dish('פיצה פטריות'))!.score;
    const inDesc = matchScore(parseQuery('פטריות')!, dish('פסטה', 'עם פטריות'))!.score;
    const inPlace = matchScore(parseQuery('מורנו')!, dish('פסטה'))!.score;
    expect(inName).toBeLessThan(inDesc);
    expect(inDesc).toBeLessThan(inPlace);
  });
  it('a single letter never matches descriptions or places', () => {
    expect(level('ע', dish('פסטה', 'עם פטריות'))).toBeNull();
    expect(level('מ', dish('פסטה'))).toBeNull();
  });
});

describe('layoutAlternatives: typed on the wrong keyboard', () => {
  it('English keys to Hebrew and Arabic', () => {
    expect(layoutAlternatives('phmv')).toContain('פיצה');
    expect(layoutAlternatives('fvyv')).toContain('برغر');
  });
  it('Hebrew or Arabic keys back to English', () => {
    expect(layoutAlternatives('פןזזש')).toEqual(['pizza']);
    expect(layoutAlternatives('حهئئش')).toEqual(['pizza']);
    expect(layoutAlternatives('لاعقلثق')).toEqual(['burger']);
  });
  it('mixed scripts are left alone', () => {
    expect(layoutAlternatives('pizza פיצה')).toEqual([]);
  });
});

describe('highlightRanges', () => {
  const marks = (text: string, q: string) => highlightRanges(text, parseQuery(q)!).map(([s, e]) => text.slice(s, e));
  it('marks the typed start of a word', () => expect(marks('פיצה מרגריטה', 'פי')).toEqual(['פי']));
  it('maps back through final letters and niqqud', () => expect(marks('שָׁלוֹם עוף', 'שלומ')).toEqual(['שָׁלוֹם']));
  it('marks a translation', () => expect(marks('שניצל עוף', 'chicken')).toEqual(['עוף']));
  it('leaves a short word inside another word alone', () => expect(marks('פיתה', 'תה')).toEqual([]));
});
