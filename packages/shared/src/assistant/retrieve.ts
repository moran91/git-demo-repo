/**
 * Dishes that fit a request. Each filter can be switched off on its own, so an empty answer can name
 * the wish that blocked it ("nothing vegan open right now") instead of a dead end.
 */
import { matchScore, parseQuery, type SearchQuery } from '../search/index.js';
import type { FulfillmentMode } from '../types.js';
import type { AssistantData, AssistantDish, AssistantPlace } from './data.js';
import type { Request } from './understand.js';

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
  const query = parseQuery(`${key} `);
  const all: CravingMatches = new Map();
  let best = 4;
  if (query) {
    for (const dish of data.dishes) {
      const m = matchScore(query, dish.search);
      if (!m || m.level > WEAK_LEVEL) continue;
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
