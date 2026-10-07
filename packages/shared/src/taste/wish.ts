/**
 * What code can read from a wish with confidence: party size, budget and "no drinks". These facts
 * check and clamp the meals; they never choose dishes. Hebrew, Arabic and English, mixed freely.
 */
export interface WishFacts {
  party?: number;
  budgetAgorot?: number;
  noDrinks: boolean;
}

const NUMBER_WORDS: Array<[number, string[]]> = [
  [1, ['אחד', 'אחת', 'one', 'واحد']],
  [2, ['שניים', 'שנים', 'שתיים', 'זוג', 'two', 'اثنين', 'اثنان', 'اتنين']],
  [3, ['שלושה', 'שלוש', 'three', 'ثلاثة', 'ثلاث', 'تلاتة']],
  [4, ['ארבעה', 'ארבע', 'four', 'أربعة', 'اربعة', 'أربع', 'اربع']],
  [5, ['חמישה', 'חמש', 'five', 'خمسة', 'خمس']],
  [6, ['שישה', 'שש', 'six', 'ستة']],
  [7, ['שבעה', 'שבע', 'seven', 'سبعة', 'سبع']],
  [8, ['שמונה', 'eight', 'ثمانية', 'تمانية', 'ثمان']],
  [9, ['תשעה', 'תשע', 'nine', 'تسعة', 'تسع']],
  [10, ['עשרה', 'עשר', 'ten', 'عشرة', 'عشر']],
];
const WORD_VALUE = new Map(NUMBER_WORDS.flatMap(([n, ws]) => ws.map((w) => [w, n] as const)));
const NUM_WORD = NUMBER_WORDS.flatMap(([, ws]) => ws).sort((a, b) => b.length - a.length).join('|');
// A word boundary that also works for Hebrew and Arabic letters.
const START = '(?:^|[\\s,.;:!?()])';
const END = '(?=$|[\\s,.;:!?()])';

const PARTY_PATTERNS: RegExp[] = [
  // ל-4, ל 4, ל4, لـ4, ل 3
  new RegExp(`${START}(?:ל|لـ|ل)\\s?-?\\s?(\\d{1,3})${END}`, 'u'),
  // לארבעה, לשניים, لأربعة, لاثنين
  new RegExp(`${START}(?:ל|لـ|ل)-?(${NUM_WORD})${END}`, 'u'),
  // for 4, for four
  new RegExp(`${START}for\\s+(\\d{1,3}|${NUM_WORD})${END}`, 'iu'),
  // 4 people, 5 אנשים, 3 أشخاص
  new RegExp(`${START}(\\d{1,3}|${NUM_WORD})\\s+(?:people|persons|ppl|guests|אנשים|איש|סועדים|أشخاص|اشخاص|نفر|انفار|أنفار)${END}`, 'iu'),
];

const BUDGET_PATTERNS: RegExp[] = [
  new RegExp(`${START}(?:עד|up to|under|max|maximum|below|حتى|لحد|ل حد)\\s*-?\\s*₪?\\s*(\\d{1,6})${END}`, 'iu'),
  /₪\s*(\d{1,6})/u,
  /(\d{1,6})\s*(?:₪|ש["״']?ח|שקל(?:ים)?|nis|ils|shekels?|شيكل|شيقل|شواقل)/iu,
];

const NO_DRINKS: RegExp[] = [
  /(?:בלי|ללא)\s+(?:שתי+ה|שתיות|משקאות|שתייה)/u,
  /\b(?:no|without)\s+(?:drinks?|beverages?|sodas?)\b/iu,
  /(?:بدون|بلا|من غير)\s+(?:مشروبات|مشروب|مشاريب|كولا)/u,
];

const MIN_BUDGET = 20;
const MAX_BUDGET = 5000;
const MAX_PARTY = 20;

function toNumber(raw: string): number | undefined {
  if (/^\d+$/.test(raw)) return Number(raw);
  return WORD_VALUE.get(raw.toLowerCase());
}

export function parseWish(text: string): WishFacts {
  const t = text.normalize('NFC');
  const facts: WishFacts = { noDrinks: NO_DRINKS.some((r) => r.test(t)) };
  for (const r of PARTY_PATTERNS) {
    const m = r.exec(t);
    const n = m?.[1] ? toNumber(m[1]) : undefined;
    if (n !== undefined && n >= 1 && n <= MAX_PARTY) {
      facts.party = n;
      break;
    }
  }
  for (const r of BUDGET_PATTERNS) {
    const m = r.exec(t);
    const n = m?.[1] ? Number(m[1]) : undefined;
    if (n !== undefined && n >= MIN_BUDGET && n <= MAX_BUDGET) {
      facts.budgetAgorot = n * 100;
      break;
    }
  }
  return facts;
}

const WISH_WORDS = new Set(['עד', 'בלי', 'ללא', 'for', 'without', 'no', 'بدون', 'حتى', 'بلا']);

/**
 * Whether the search text reads as a wish rather than a dish name, which offers the "ask Qareeb"
 * row: three or more words, a number, a wish word, or a party size.
 */
export function isWish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const words = t.split(/\s+/);
  if (words.length >= 3) return true;
  if (/\d/.test(t)) return true;
  if (words.some((w) => WISH_WORDS.has(w.toLowerCase()) || w.startsWith('ל-'))) return true;
  return parseWish(t).party !== undefined;
}
