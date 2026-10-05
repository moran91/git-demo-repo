/**
 * Dishes that fit a request. Each filter can be switched off on its own, so an empty answer can name
 * the wish that blocked it ("nothing vegan open right now") instead of a dead end.
 */
import { expandQueryWord, matchScore, parseQuery, type SearchQuery } from '../search/index.js';
import type { DishType } from '../dishIndex.js';
import type { FulfillmentMode } from '../types.js';
import type { AssistantData, AssistantDish, AssistantPlace } from './data.js';
import { wordForms } from './text.js';
import type { Request } from './understand.js';
import { CRAVING_FAMILIES } from './vocab.js';

export interface Filters {
  open: boolean;
  place: boolean;
  tags: boolean;
  exclude: boolean;
  mode: boolean;
  budget: boolean;
}
export const ALL_FILTERS: Filters = { open: true, place: true, tags: true, exclude: true, mode: true, budget: true };

export interface Candidate {
  dish: AssistantDish;
  /** matchScore of the craving (lower is better); 0 without a craving. */
  match: number;
}

export function placeUsable(p: AssistantPlace | undefined, mode?: FulfillmentMode): boolean {
  return !!p && p.open && (mode ? p.modes.includes(mode) : p.modes.length > 0);
}

/**
 * matchScore levels (search/match.ts): 0 whole word, 1 word start, 2 inside a word, 3 half-typed food word,
 * 4 sound, 5 typo, 6 description, 7 place name. Levels group into tiers; only the best tier any dish
 * reaches is kept, so "cola" is Coca-Cola, not the "cola" inside "chocolate", and a typo or sound match
 * only answers when nothing matches by spelling. A place name (7) never counts.
 */
const tierOf = (level: number) => (level <= 1 ? 0 : level <= 3 ? 1 : level <= 5 ? 2 : 3);
const WEAK_LEVEL = 6;

/** Served cold or sweet: not what "something warm" means. */
const NOT_WARM: readonly DishType[] = ['salads', 'sushi', 'desserts'];

/** Plural to singular: פיצות → פיצה, קרואסונים → קרואסון, pizzas → pizza, sandwiches → sandwich (stems of 3+ letters). */
function singulars(w: string): string[] {
  const out: string[] = [];
  const stem = (n: number) => (w.length - n >= 3 ? w.slice(0, w.length - n) : '');
  if (/^[֐-׿]+$/.test(w)) {
    if (w.endsWith('ות') && stem(2)) out.push(`${stem(2)}ה`, stem(2));
    if (w.endsWith('ימ') && stem(2)) out.push(stem(2));
  } else if (/^[a-z]+$/.test(w)) {
    if (w.endsWith('es') && stem(2)) out.push(stem(2));
    if (w.endsWith('s') && !w.endsWith('ss') && stem(1)) out.push(stem(1));
  }
  return out;
}

interface Variant {
  text: string;
  /** The swapped-in word and its translations: only a dish whose name holds one can match this variant. */
  needs?: string[];
}

/**
 * The craving as typed, plus variants with one word swapped: a plural for its singular, and a family word
 * for each member ("קפה" → "אספרסו", "cappuccino"…).
 */
function cravingVariants(craving: readonly string[]): Variant[] {
  const out: Variant[] = [{ text: craving.join(' ') }];
  craving.forEach((w, i) => {
    const members = CRAVING_FAMILIES.find(([words]) => words.has(w))?.[1] ?? [];
    for (const m of [...singulars(w), ...members]) out.push({ text: [...craving.slice(0, i), m, ...craving.slice(i + 1)].join(' '), needs: expandQueryWord(m) });
  });
  return out;
}

/** A word the food word list knows ("בירה", "water"): it is not a typo, so it never stands for a dish that only sounds like it. */
export function isKnownFood(word: string): boolean {
  return wordForms(word).some((f) => expandQueryWord(f).length > 1);
}

export type CravingMatches = Map<AssistantDish, { level: number; score: number }>;
const memo = new WeakMap<AssistantData, Map<string, CravingMatches>>();

/**
 * The dishes a craving matches, best tier only. Decided over the whole index, before any filter, so a
 * strong match hidden by a filter (a closed place, a price ceiling) does not let weak ones through, and
 * so the relaxation passes of one question all reuse the same answer.
 */
export function cravingMatches(data: AssistantData, craving: readonly string[]): CravingMatches {
  const key = craving.join(' ');
  let byCraving = memo.get(data);
  if (!byCraving) memo.set(data, (byCraving = new Map()));
  const hit = byCraving.get(key);
  if (hit) return hit;
  const variants = cravingVariants(craving);
  const all: CravingMatches = new Map();
  let best = 4;
  // Sound and typo matches are for misspellings; a craving of known food words takes only spelling and description matches.
  const known = craving.every(isKnownFood);
  for (const v of variants) {
    const query = parseQuery(`${v.text} `);
    if (!query) continue;
    for (const dish of data.dishes) {
      // A swapped-in word counts only by spelling, so a dish whose name lacks it is skipped without scoring.
      if (v.needs && !v.needs.some((x) => dish.search.name.includes(x))) continue;
      const m = matchScore(query, dish.search);
      if (!m || m.level > WEAK_LEVEL || (known && tierOf(m.level) === 2) || (v.needs && m.level > 3)) continue;
      const had = all.get(dish);
      if (had && (had.level < m.level || (had.level === m.level && had.score <= m.score))) continue;
      all.set(dish, m);
      best = Math.min(best, tierOf(m.level));
    }
  }
  const out: CravingMatches = new Map([...all].filter(([, m]) => tierOf(m.level) === best));
  byCraving.set(key, out);
  return out;
}

export function retrieve(r: Request, data: AssistantData, f: Filters = ALL_FILTERS): Candidate[] {
  const matches = r.craving.length ? cravingMatches(data, r.craving) : null;
  const excludeQueries = f.exclude ? r.exclude.words.map((w) => parseQuery(`${w} `)).filter((q): q is SearchQuery => !!q) : [];
  const out: Candidate[] = [];
  for (const dish of data.dishes) {
    const place = data.places.get(dish.branchId);
    if (!place || !place.modes.length) continue;
    if (f.open && !place.open) continue;
    if (f.mode && r.mode && !place.modes.includes(r.mode)) continue;
    if (f.place && r.placeBranchIds?.length && !r.placeBranchIds.includes(dish.branchId)) continue;
    if (f.exclude && (r.exclude.branchIds.includes(dish.branchId) || r.exclude.dishIds.includes(dish.id))) continue;
    const tags = dish.entry.tags ?? [];
    if (f.tags && r.tags.some((t) => !tags.includes(t))) continue;
    if (f.exclude && r.exclude.tags.some((t) => tags.includes(t))) continue;
    if (f.tags && r.warm && (tags.includes('cold_drink') || (!!dish.entry.dishType && NOT_WARM.includes(dish.entry.dishType)))) continue;
    if (f.budget && r.maxPriceAgorot !== undefined && dish.entry.priceAgorot > r.maxPriceAgorot) continue;
    if (f.budget && r.budgetAgorot !== undefined && r.people === undefined && dish.entry.priceAgorot > r.budgetAgorot) continue;
    const m = matches?.get(dish);
    if (matches && !m) continue;
    // The costly check comes last: it only runs for dishes that already fit everything else.
    if (excludeQueries.some((q) => {
      const x = matchScore(q, dish.search);
      return x !== null && x.level <= WEAK_LEVEL;
    })) continue;
    out.push({ dish, match: m?.score ?? 0 });
  }
  return out;
}
