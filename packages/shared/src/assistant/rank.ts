/**
 * Orders candidates: craving match first, then taste fit, the time of day, what the customer likes,
 * popularity, photos and deals. Places take turns within each 100-point tier, and equal dishes rotate
 * daily, so no restaurant owns the top of every answer.
 */
import type { AssistantData, AssistantDish } from './data.js';
import { dishKey, localHour } from './data.js';
import type { Candidate } from './retrieve.js';
import type { Meal, Request } from './understand.js';

export interface Hit extends Candidate {
  points: number;
}

export function mealOf(hour: number): Meal {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'late';
}

export function hashUnit(seed: number, id: string): number {
  let h = seed | 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
  return ((h >>> 0) % 10000) / 10000;
}

export function dealProductIds(data: AssistantData): Set<string> {
  const ids = new Set<string>();
  for (const d of data.deals) for (const id of d.combo ? d.combo.items.map((i) => i.productId) : d.promotion?.productIds ?? []) ids.add(dishKey(d.branchId, id));
  return ids;
}

export const popularThenCheap = (a: AssistantDish, b: AssistantDish) => Number(!!b.entry.mostOrdered) - Number(!!a.entry.mostOrdered) || a.entry.priceAgorot - b.entry.priceAgorot;

export function rank(cands: Candidate[], r: Request, data: AssistantData): Hit[] {
  const meal = r.meal ?? mealOf(localHour(data.now));
  const prof = data.profile;
  const deals = dealProductIds(data);
  const maxPrice = Math.max(1, ...cands.map((c) => c.dish.entry.priceAgorot));
  const hits = cands.map(({ dish, match }): Hit => {
    const e = dish.entry;
    const tags = e.tags ?? [];
    let points = r.craving.length ? 1000 - match : 0;
    if (meal === 'breakfast' && (tags.includes('breakfast') || tags.includes('hot_drink'))) points += r.meal ? 300 : 60;
    if (r.meal && r.meal !== 'breakfast' && tags.includes('breakfast')) points -= 50;
    if (e.mostOrdered) points += 40;
    if (e.imagePath) points += 15;
    if (prof) {
      if (e.dishType && prof.favoriteTypes.includes(e.dishType)) points += 30;
      if (prof.favoriteBranches.includes(dish.branchId)) points += 20;
      if (prof.orderedProductIds.includes(dish.id)) points += 25;
    }
    if (deals.has(dishKey(dish.branchId, dish.id))) points += 15;
    if (data.cartBranchId === dish.branchId) points += 20;
    if (r.cheap) points += Math.round((1 - e.priceAgorot / maxPrice) * 150);
    if (r.shortcut === 'surprise') points += Math.round(hashUnit(data.seed, dish.id) * 80);
    return { dish, match, points };
  });
  hits.sort((a, b) => b.points - a.points || hashUnit(data.seed, a.dish.id) - hashUnit(data.seed, b.dish.id));
  return diversify(hits);
}

export function diversify<T extends { dish: AssistantDish; points: number }>(sorted: T[]): T[] {
  const tiers = new Map<number, T[]>();
  for (const h of sorted) {
    const k = Math.floor(h.points / 100);
    tiers.set(k, [...(tiers.get(k) ?? []), h]);
  }
  return [...tiers.keys()].sort((a, b) => b - a).flatMap((k) => roundRobin(tiers.get(k)!, (h) => h.dish.branchId));
}

/** Takes turns across keys (places), keeping the given order inside each key. */
export function roundRobin<T>(list: readonly T[], key: (x: T) => string): T[] {
  const out: T[] = [];
  const rest = [...list];
  while (rest.length) {
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; ) {
      const k = key(rest[i]!);
      if (seen.has(k)) {
        i++;
        continue;
      }
      seen.add(k);
      out.push(rest[i]!);
      rest.splice(i, 1);
    }
  }
  return out;
}
