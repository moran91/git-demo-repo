/**
 * Everything the assistant reasons over, built on the phone from the public per-branch indexes, the
 * customer's own orders and the clock. Dish texts are prepared for search once per index snapshot
 * (prepareDishes); the rest is cheap and rebuilt as time passes (buildAssistantData).
 */
import { DISH_TYPES, daySeed, type DealsIndexCombo, type DealsIndexDoc, type DealsIndexPromotion, type DishIndexDoc, type DishIndexEntry, type DishType, type PairEntry, type PairsIndexDoc } from '../dishIndex.js';
import { toLocal } from '../hours.js';
import { dictionaries } from '../i18n/index.js';
import { prepareFields, type PreparedFields } from '../search/index.js';
import { LOCALES, type FulfillmentMode, type Localized } from '../types.js';
import { allText } from './tags.js';
import { buildProfile, type Profile, type ProfileOrder } from './profile.js';
import type { PlaceName } from './understand.js';

export interface AssistantPlace {
  branchId: string;
  businessId: string;
  name: Localized;
  branchName?: Localized;
  /** Can take an order right now (open and not paused). */
  open: boolean;
  opensInMin?: number;
  modes: FulfillmentMode[];
}
export interface AssistantDish {
  id: string;
  branchId: string;
  entry: DishIndexEntry;
  search: PreparedFields;
}
export interface AssistantDeal {
  id: string;
  branchId: string;
  kind: 'combo' | 'promotion';
  combo?: DealsIndexCombo;
  promotion?: DealsIndexPromotion;
}
export interface AssistantData {
  now: Date;
  seed: number;
  places: Map<string, AssistantPlace>;
  placeNames: PlaceName[];
  dishes: AssistantDish[];
  dishById: Map<string, AssistantDish>;
  deals: AssistantDeal[];
  pairs: Map<string, Record<string, PairEntry[]>>;
  profile?: Profile;
  cartBranchId?: string;
}

export const dishKey = (branchId: string, productId: string) => `${branchId}/${productId}`;

/** Dish-type names in all three languages, so "פיצה" or "بيتزا" also finds pizzas whose name lacks the word. */
export const DISH_TYPE_WORDS = Object.fromEntries(DISH_TYPES.map((dt) => [dt, LOCALES.map((l) => dictionaries[l][`dishType.${dt}`]).join(' ')])) as Record<DishType, string>;

export function prepareDishes(places: ReadonlyArray<Pick<AssistantPlace, 'branchId' | 'name'>>, indexes: ReadonlyMap<string, DishIndexDoc>): AssistantDish[] {
  const out: AssistantDish[] = [];
  for (const p of places) {
    const idx = indexes.get(p.branchId);
    if (!idx) continue;
    for (const [id, entry] of Object.entries(idx.dishes)) {
      if (!entry.available) continue;
      out.push({ id, branchId: p.branchId, entry, search: prepareFields({ name: allText(entry.name), description: allText(entry.description), type: entry.dishType ? DISH_TYPE_WORDS[entry.dishType] : '', place: allText(p.name) }) });
    }
  }
  return out;
}

export function buildAssistantData(input: { now: Date; places: AssistantPlace[]; dishes: AssistantDish[]; deals?: ReadonlyMap<string, DealsIndexDoc>; pairs?: ReadonlyMap<string, PairsIndexDoc>; orders?: ProfileOrder[]; cartBranchId?: string }): AssistantData {
  const places = new Map(input.places.map((p) => [p.branchId, p]));
  const dishes = input.dishes.filter((d) => places.has(d.branchId));
  const dishById = new Map(dishes.map((d) => [dishKey(d.branchId, d.id), d]));
  const today = toLocal(input.now).date;
  const deals: AssistantDeal[] = [];
  for (const p of input.places) {
    const d = input.deals?.get(p.branchId);
    if (!d) continue;
    for (const [id, combo] of Object.entries(d.combos ?? {})) deals.push({ id, branchId: p.branchId, kind: 'combo', combo });
    // endsAt is the last valid day (same rule as lib/promotions.ts).
    for (const [id, promotion] of Object.entries(d.promotions ?? {})) if (promotion.endsAt >= today) deals.push({ id, branchId: p.branchId, kind: 'promotion', promotion });
  }
  const pairs = new Map<string, Record<string, PairEntry[]>>();
  for (const p of input.places) {
    const doc = input.pairs?.get(p.branchId);
    if (doc) pairs.set(p.branchId, doc.pairs);
  }
  const profile = input.orders?.length ? buildProfile(input.orders, (br, id) => dishById.get(dishKey(br, id))?.entry.dishType) : undefined;
  return {
    now: input.now,
    seed: daySeed(input.now),
    places,
    placeNames: input.places.map((p) => ({ branchId: p.branchId, name: p.name })),
    dishes,
    dishById,
    deals,
    pairs,
    ...(profile ? { profile } : {}),
    ...(input.cartBranchId ? { cartBranchId: input.cartBranchId } : {}),
  };
}

export function localHour(now: Date): number {
  return Math.floor(toLocal(now).minutes / 60);
}

/** Wall-clock "HH:MM" in Asia/Jerusalem, `minutes` from now. */
export function clockAt(now: Date, minutes: number): string {
  const m = (((toLocal(now).minutes + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
