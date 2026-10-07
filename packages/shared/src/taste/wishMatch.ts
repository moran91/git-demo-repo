import { DISH_TYPES, type DishIndexEntry, type DishType } from '../dishIndex.js';
import { dictionaries } from '../i18n/index.js';
import { matchScore, parseQuery, prepareFields, type PreparedFields, type SearchQuery } from '../search/index.js';
import type { Localized } from '../types.js';

/** Every locale's words for a name, so a search in any of the three languages finds it. */
export function allWords(l: Localized | undefined): string {
  return l ? [l.he, l.ar, l.en].filter(Boolean).join(' ') : '';
}

/** Dish-type names in all three languages, so "פיצה" or "بيتزا" also finds pizzas whose name lacks the word. */
export const DISH_TYPE_WORDS = Object.fromEntries(DISH_TYPES.map((dt) => [dt, (['he', 'ar', 'en'] as const).map((l) => dictionaries[l][`dishType.${dt}`]).join(' ')])) as Record<DishType, string>;

/** The fields a dish is searched by, prepared once per menu update. */
export function dishSearchFields(entry: DishIndexEntry, placeName: Localized): PreparedFields {
  return prepareFields({ name: allWords(entry.name), description: allWords(entry.description), type: entry.dishType ? DISH_TYPE_WORDS[entry.dishType] : '', place: allWords(placeName) });
}

// Words that carry the wish's shape (party, budget, politeness) rather than a food.
const STOP = new Set([
  'עד', 'בלי', 'ללא', 'עם', 'של', 'או', 'גם', 'רק', 'משהו', 'משהוא', 'רוצה', 'רוצים', 'בא', 'לי', 'לנו', 'אני', 'אנחנו', 'מה', 'יש', 'אוכל', 'ארוחה', 'ארוחת', 'טעים', 'טעימה', 'הערב', 'ערב', 'צהריים', 'בוקר', 'לילה', 'היום', 'עכשיו', 'אנשים', 'איש', 'שקל', 'שקלים', 'שח', 'ש"ח', 'ש״ח', 'בבקשה', 'תודה', 'זול', 'זולה', 'הכי', 'טוב', 'טובה', 'שתייה', 'שתיה', 'משקאות',
  'بدون', 'بلا', 'حتى', 'مع', 'او', 'أو', 'بدي', 'اريد', 'أريد', 'شي', 'شيء', 'اكل', 'أكل', 'وجبة', 'عشاء', 'غداء', 'فطور', 'اليوم', 'الآن', 'اشخاص', 'أشخاص', 'شيكل', 'من', 'فضلك', 'لو', 'رخيص', 'مشروبات', 'مشروب',
  'for', 'up', 'to', 'under', 'max', 'no', 'without', 'with', 'and', 'or', 'something', 'some', 'want', 'food', 'meal', 'dinner', 'lunch', 'breakfast', 'tonight', 'today', 'now', 'people', 'person', 'please', 'cheap', 'good', 'nice', 'drinks', 'drink', 'a', 'the', 'me', 'us', 'i', 'we',
]);

/**
 * The food words of a wish, each as its own finished query: "פיצה לארבעה עד 200" asks for pizza,
 * not for a dish whose name holds every word.
 */
export function wishQueries(wish: string): SearchQuery[] {
  const out: SearchQuery[] = [];
  for (const raw of wish.split(/[\s,.;:!?()]+/)) {
    const w = raw.trim();
    if (!w || /\d/.test(w) || STOP.has(w.toLowerCase()) || /^(ל|ل|لـ)-?$/.test(w)) continue;
    // Party words with a prefix (לארבעה, لأربعة) are not food either.
    if (/^(ל|ل)/.test(w) && /^(ל|ل)-?(שניים|שתיים|שלושה|ארבעה|חמישה|שישה|זוג|اثنين|ثلاثة|أربعة|اربعة|خمسة|ستة)$/.test(w)) continue;
    const q = parseQuery(`${w} `);
    if (q) out.push(q);
  }
  return out;
}

/** How well a dish answers the wish's food words: the best level of any word (lower is better), or undefined. */
export function wishMatchLevel(queries: SearchQuery[], fields: PreparedFields): number | undefined {
  let best: number | undefined;
  for (const q of queries) {
    const m = matchScore(q, fields);
    if (m && (best === undefined || m.level < best)) best = m.level;
  }
  return best;
}
