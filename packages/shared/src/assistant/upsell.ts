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
const NOT_A_MAIN: readonly DishType[] = ['drinks', 'snacks', 'desserts'];

/** A hot drink goes with a pastry or a dessert, a cold one with everything else; an untagged drink goes with anything. */
export function drinkSuits(d: AssistantDish, anchor: DishType | undefined): boolean {
  return !(d.entry.tags ?? []).includes(HOT_WITH.includes(anchor ?? 'mains') ? 'cold_drink' : 'hot_drink');
}

/** A combo id stands for its member products; anything else stands for itself. */
function expand(ids: readonly string[], branchId: string, data: AssistantData): string[] {
  return ids.flatMap((id) => {
    if (data.dishById.has(dishKey(branchId, id))) return [id];
    const combo = data.deals.find((d) => d.kind === 'combo' && d.branchId === branchId && d.id === id)?.combo;
    return combo ? combo.items.map((i) => i.productId) : [id];
  });
}

export function upsellFor(added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData): AssistantDish | undefined {
  if (!placeUsable(data.places.get(added.branchId))) return undefined;
  const addedIds = expand([added.productId], added.branchId, data);
  const typeOfId = (id: string) => data.dishById.get(dishKey(added.branchId, id))?.entry.dishType;
  // The dish the suggestion is about: the added dish, or the first main inside an added combo.
  const anchorId = addedIds.find((id) => { const t = typeOfId(id); return t && !NOT_A_MAIN.includes(t); }) ?? addedIds[0] ?? added.productId;
  const have = new Set([...addedIds, ...expand(inCart, added.branchId, data)]);
  const haveTypes = new Set([...have].map(typeOfId));
  const pool = data.dishes.filter((d) => d.branchId === added.branchId && !have.has(d.id) && !d.entry.needsChoice);
  for (const p of data.pairs.get(added.branchId)?.[anchorId] ?? []) {
    const d = pool.find((x) => x.id === p.productId);
    if (d) return d;
  }
  const type = typeOfId(anchorId) ?? 'mains';
  const wantTag = HOT_WITH.includes(type) ? 'hot_drink' : 'cold_drink';
  for (const want of COMPLEMENT[type]) {
    if (haveTypes.has(want)) continue;
    const options = pool
      .filter((d) => d.entry.dishType === want && (want !== 'drinks' || drinkSuits(d, type)))
      .sort((a, b) => Number((b.entry.tags ?? []).includes(wantTag)) - Number((a.entry.tags ?? []).includes(wantTag)) || popularThenCheap(a, b));
    if (options[0]) return options[0];
  }
  return undefined;
}
