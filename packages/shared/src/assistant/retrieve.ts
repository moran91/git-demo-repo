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

/** matchScore levels (search/match.ts): 0-3 are the dish name or type word, 4-6 sound/typo/description, 7 the place name. */
const STRONG_LEVEL = 3;
const WEAK_LEVEL = 6;

export function retrieve(r: Request, data: AssistantData, f: Filters = ALL_FILTERS): Candidate[] {
  const query = r.craving.length ? parseQuery(`${r.craving.join(' ')} `) : null;
  const excludeQueries = f.exclude ? r.exclude.words.map((w) => parseQuery(`${w} `)).filter((q): q is SearchQuery => !!q) : [];
  // The craving is matched against every dish first: sound, typo and description matches (level 4-6)
  // only count when no dish anywhere matches by name, and a place name (level 7) never counts, so
  // "burger" is not Burger Basil's Sprite and "קפה" is not a Cafe's shakshuka. Deciding this before the
  // filters keeps a filtered-out strong match ("בגט" at a closed place) from letting weak ones in.
  const matches = new Map<AssistantDish, { level: number; score: number }>();
  let strong = false;
  if (query) {
    for (const dish of data.dishes) {
      const m = matchScore(query, dish.search);
      if (!m || m.level > WEAK_LEVEL) continue;
      matches.set(dish, m);
      if (m.level <= STRONG_LEVEL) strong = true;
    }
  }
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
    if (excludeQueries.some((q) => {
      const m = matchScore(q, dish.search);
      return m !== null && m.level <= WEAK_LEVEL;
    })) continue;
    if (f.budget && r.maxPriceAgorot !== undefined && dish.entry.priceAgorot > r.maxPriceAgorot) continue;
    if (f.budget && r.budgetAgorot !== undefined && r.people === undefined && dish.entry.priceAgorot > r.budgetAgorot) continue;
    let match = 0;
    if (query) {
      const m = matches.get(dish);
      if (!m || (strong && m.level > STRONG_LEVEL)) continue;
      match = m.score;
    }
    out.push({ dish, match });
  }
  return out;
}
