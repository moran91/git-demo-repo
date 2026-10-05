/**
 * Everything the assistant reasons over, built on the phone from the public per-branch indexes, the
 * customer's own orders and the clock. Dish texts are prepared for search once per index snapshot
 * (prepareDishes); the rest is cheap and rebuilt as time passes (buildAssistantData).
 */
import { daySeed, type DealsIndexCombo, type DealsIndexDoc, type DealsIndexPromotion, type DishIndexDoc, type DishIndexEntry, type DishType, type PairEntry, type PairsIndexDoc } from '../dishIndex.js';
import { toLocal } from '../hours.js';
import { prepareFields, type PreparedFields } from '../search/index.js';
import type { FulfillmentMode, Localized } from '../types.js';
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

/**
 * What each dish type is called when searching, in every language. Deliberately not the UI labels:
 * "Fries & snacks" would make every snack a match for "fries", and "Sambusak & pastries" every pastry a
 * match for "sambusak". Only words that name the whole type belong here.
 */
export const DISH_TYPE_WORDS: Record<DishType, string> = {
  pizza: 'פיצה pizza بيتزا',
  pasta: 'פסטה pasta باستا',
  burger: 'המבורגר בורגר burger برغر',
  shawarma: 'שווארמה shawarma شاورما',
  hummus: 'חומוס hummus حمص',
  sushi: 'סושי sushi سوشي',
  pastries: 'מאפים pastries معجنات',
  salads: 'סלט סלטים salad salads سلطة سلطات',
  mains: 'עיקריות mains أطباق رئيسية',
  snacks: 'נשנושים snacks مقبلات',
  desserts: 'קינוחים desserts حلويات',
  drinks: 'שתייה משקאות drinks مشروبات',
};

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

/** Wall-clock "HH:MM" in Asia/Jerusalem, `minutes` from now. Adds to the instant, so DST changes are right. */
export function clockAt(now: Date, minutes: number): string {
  const m = toLocal(new Date(now.getTime() + Math.round(minutes) * 60_000)).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
