/**
 * One "goes well with it" suggestion after an add: what others bought with it, else a sensible complement
 * from the same place. The pairs list is already ranked best-first (no counts are public), so the order
 * of the list is the rank.
 */
import type { DishType } from '../dishIndex.js';
import { dishKey, type AssistantData, type AssistantDish } from './data.js';
import { popularThenCheap } from './rank.js';
import { placeUsable } from './retrieve.js';

const COMPLEMENT: Record<DishType, readonly DishType[]> = {
  pizza: ['drinks', 'snacks', 'desserts'], pasta: ['drinks', 'desserts'], burger: ['drinks', 'snacks'], shawarma: ['drinks', 'snacks'],
  hummus: ['drinks', 'salads'], sushi: ['drinks', 'desserts'], mains: ['drinks', 'snacks', 'salads'], pastries: ['drinks'],
  salads: ['drinks'], snacks: ['drinks'], desserts: ['drinks'], drinks: ['desserts', 'snacks'],
};
const HOT_WITH: readonly DishType[] = ['pastries', 'desserts'];

export function upsellFor(added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData): AssistantDish | undefined {
  if (!placeUsable(data.places.get(added.branchId))) return undefined;
  const pool = data.dishes.filter((d) => d.branchId === added.branchId && d.id !== added.productId && !inCart.includes(d.id) && !d.entry.needsChoice);
  for (const p of data.pairs.get(added.branchId)?.[added.productId] ?? []) {
    const d = pool.find((x) => x.id === p.productId);
    if (d) return d;
  }
  const type = data.dishById.get(dishKey(added.branchId, added.productId))?.entry.dishType ?? 'mains';
  const wantTag = HOT_WITH.includes(type) ? 'hot_drink' : 'cold_drink';
  for (const want of COMPLEMENT[type]) {
    const options = pool.filter((d) => d.entry.dishType === want).sort((a, b) => Number((b.entry.tags ?? []).includes(wantTag)) - Number((a.entry.tags ?? []).includes(wantTag)) || popularThenCheap(a, b));
    if (options[0]) return options[0];
  }
  return undefined;
}
