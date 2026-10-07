import type { DishIndexEntry, DishType } from '../dishIndex.js';
import { daypartOf } from './daypart.js';
import type { BandDish } from './home.js';
import { dishKey, type DerivedTaste, type Party, type PopularDayparts, type ReasonCode } from './types.js';
import type { WishFacts } from './wish.js';

/** Types that make a meal on their own. */
export const MAIN_TYPES: readonly DishType[] = ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'mains'];
/** Types added as the one side dish. */
export const SIDE_TYPES: readonly DishType[] = ['snacks', 'salads', 'pastries', 'desserts'];
const MAX_QTY = 10;

export type NoFit = 'none' | 'closed' | 'budget' | 'diet';

export interface MealItem { productId: string; qty: number }

/** A meal from one place. Names and prices are never part of it: the client renders them live. */
export interface Meal {
  branchId: string;
  items: MealItem[];
  /** The AI's short title; absent means the client shows "a meal from {place}". */
  title?: string;
  reason: ReasonCode;
  source: 'ai' | 'rules';
}

/** A dish that may go in a meal, with its profile score and, when it matched the wish, the match level (lower is better). */
export interface MealCandidate extends BandDish {
  score: number;
  wish?: number;
}

/** Pizza mains feed two; every other dish counts as one portion. */
export function portionsOf(type: DishType | undefined): number {
  return type === 'pizza' ? 2 : 1;
}

/** Portions of the main dishes in a meal (side dishes and drinks feed nobody). */
export function mealPortions(branchId: string, items: MealItem[], lookup: Map<string, DishIndexEntry>): number {
  let n = 0;
  for (const it of items) {
    const e = lookup.get(dishKey(branchId, it.productId));
    if (!e || e.dishType === 'drinks' || (e.dishType && SIDE_TYPES.includes(e.dishType))) continue;
    n += portionsOf(e.dishType) * it.qty;
  }
  return n;
}

export function mealTotal(branchId: string, items: MealItem[], lookup: Map<string, DishIndexEntry>): number {
  return items.reduce((sum, it) => sum + (lookup.get(dishKey(branchId, it.productId))?.priceAgorot ?? 0) * it.qty, 0);
}

const PARTY_SIZE: Record<Party, number> = { solo: 1, two: 2, family: 4, friends: 3 };

/** Party size for a wish: what the wish said, else what the customer told the game, else one. */
export function partySize(facts: WishFacts, derived: DerivedTaste): number {
  return facts.party ?? (derived.party ? PARTY_SIZE[derived.party] : 1);
}

interface Built { meal: Meal; total: number; mainScore: number; fresh: number }

/**
 * The code meal builder: the fallback when the AI fails and the whole answer without AI consent.
 * Per open place it builds one meal (mains for the party, plus one side when the budget allows,
 * never a drink), then returns the best two from different places: one close to the profile, one new.
 */
export function buildMeals(input: { candidates: MealCandidate[]; facts: WishFacts; derived: DerivedTaste; popular: PopularDayparts | null; now: Date }): { meals: Meal[]; noFit: NoFit } {
  const { facts, derived } = input;
  // Dishes with sizes or required options are kept: the meal sheet adds them with the cheapest
  // choices, which is the price the index already shows.
  const usable = input.candidates.filter((d) => d.open && d.entry.available && d.entry.dishType !== 'drinks' && d.score > -Infinity);
  if (usable.length === 0) return { meals: [], noFit: 'closed' };
  const party = partySize(facts, derived);
  const wishActive = usable.some((d) => d.wish !== undefined);
  const ordered = new Set(derived.orderedBefore);
  const usualKeys = new Set(derived.usual.map((u) => dishKey(u.branchId, u.productId)));
  const popularList = input.popular?.[daypartOf(input.now)] ?? [];
  const popRank = (d: BandDish) => {
    const i = popularList.findIndex((p) => p.branchId === d.branchId && p.productId === d.productId);
    return i < 0 ? Infinity : i;
  };

  const byBranch = new Map<string, MealCandidate[]>();
  for (const d of usable) byBranch.set(d.branchId, [...(byBranch.get(d.branchId) ?? []), d]);

  const fits: Built[] = [];
  const cheapest: Built[] = [];
  for (const [branchId, dishes] of byBranch) {
    const matched = dishes.filter((d) => d.wish !== undefined);
    const mains = (wishActive && matched.length ? matched : dishes.filter((d) => d.entry.dishType && MAIN_TYPES.includes(d.entry.dishType)))
      .sort((a, b) => (a.wish ?? 99) - (b.wish ?? 99) || b.score - a.score || a.productId.localeCompare(b.productId));
    if (mains.length === 0) continue;
    const sides = dishes.filter((d) => d.entry.dishType && SIDE_TYPES.includes(d.entry.dishType)).sort((a, b) => b.score - a.score || a.entry.priceAgorot - b.entry.priceAgorot);
    const option = (main: MealCandidate): Built => {
      const qty = Math.min(MAX_QTY, Math.ceil(party / portionsOf(main.entry.dishType)));
      const items: MealItem[] = [{ productId: main.productId, qty }];
      let total = main.entry.priceAgorot * qty;
      const side = sides.find((s) => s.productId !== main.productId);
      if (side && (facts.budgetAgorot === undefined || total + side.entry.priceAgorot <= facts.budgetAgorot)) {
        items.push({ productId: side.productId, qty: 1 });
        total += side.entry.priceAgorot;
      }
      const fresh = ordered.has(dishKey(branchId, main.productId)) ? 0 : 1;
      return { meal: { branchId, items, reason: 'fits_wish', source: 'rules' }, total, mainScore: main.score, fresh };
    };
    const within = mains.map(option).find((b) => facts.budgetAgorot === undefined || b.total <= facts.budgetAgorot);
    if (within) fits.push(within);
    const low = [...mains].sort((a, b) => a.entry.priceAgorot * Math.ceil(party / portionsOf(a.entry.dishType)) - b.entry.priceAgorot * Math.ceil(party / portionsOf(b.entry.dishType)))[0]!;
    const qty = Math.min(MAX_QTY, Math.ceil(party / portionsOf(low.entry.dishType)));
    cheapest.push({ meal: { branchId, items: [{ productId: low.productId, qty }], reason: 'fits_wish', source: 'rules' }, total: low.entry.priceAgorot * qty, mainScore: low.score, fresh: 0 });
  }

  if (fits.length === 0) {
    if (cheapest.length === 0) return { meals: [], noFit: 'closed' };
    return { meals: cheapest.sort((a, b) => a.total - b.total || a.meal.branchId.localeCompare(b.meal.branchId)).slice(0, 2).map((b) => b.meal), noFit: 'budget' };
  }

  const mainOf = (b: Built): MealCandidate => byBranch.get(b.meal.branchId)!.find((d) => d.productId === b.meal.items[0]!.productId)!;
  const first = [...fits].sort((a, b) => b.mainScore - a.mainScore || a.meal.branchId.localeCompare(b.meal.branchId))[0]!;
  const second = fits
    .filter((b) => b.meal.branchId !== first.meal.branchId)
    .sort((a, b) => b.fresh - a.fresh || popRank(mainOf(a)) - popRank(mainOf(b)) || b.mainScore - a.mainScore || a.meal.branchId.localeCompare(b.meal.branchId))[0];

  const reasonFirst = (m: MealCandidate): ReasonCode => {
    const key = dishKey(m.branchId, m.productId);
    if (usualKeys.has(key)) return 'usual';
    if (ordered.has(key) || derived.loved.includes(key)) return 'ordered_before';
    if (m.wish !== undefined) return 'fits_wish';
    if (m.entry.dishType && (derived.affinity[m.entry.dishType] ?? 0) > 0) return 'you_picked';
    return popRank(m) < Infinity ? 'popular_now' : 'fits_wish';
  };
  const reasonSecond = (m: MealCandidate): ReasonCode => {
    if (derived.learnedOrders > 0 && !ordered.has(dishKey(m.branchId, m.productId))) return 'new_for_you';
    if (popRank(m) < Infinity) return 'popular_now';
    return reasonFirst(m);
  };
  const meals: Meal[] = [{ ...first.meal, reason: reasonFirst(mainOf(first)) }];
  if (second) meals.push({ ...second.meal, reason: reasonSecond(mainOf(second)) });
  return { meals, noFit: 'none' };
}
