import { daySeed, rankDishes, type DishIndexEntry } from '../dishIndex.js';
import { daypartOf } from './daypart.js';
import type { TasteOrder } from './derive.js';
import { dishKey, type Daypart, type DerivedTaste, type PopularDayparts } from './types.js';

/** One dish from a live dish index, with whether its place can take an order right now. */
export interface BandDish {
  branchId: string;
  productId: string;
  entry: DishIndexEntry;
  open: boolean;
}

export interface ScoreContext {
  derived: DerivedTaste;
  popular: PopularDayparts | null;
  daypart: Daypart;
}

/**
 * How well a dish suits this customer now. Closed, unavailable and "not again" dishes are ruled out;
 * the rest add their usual, ordered-before and loved boosts, quiz type affinity and the dish's
 * popularity rank in the current daypart.
 */
export function scoreDish(d: BandDish, ctx: ScoreContext): number {
  if (!d.open || !d.entry.available) return -Infinity;
  const key = dishKey(d.branchId, d.productId);
  const { derived } = ctx;
  if (derived.notAgain.includes(key)) return -Infinity;
  let s = 0;
  if (derived.usual.some((u) => u.branchId === d.branchId && u.productId === d.productId)) s += 5;
  if (derived.orderedBefore.includes(key)) s += 2;
  if (derived.loved.includes(key)) s += 3;
  if (d.entry.dishType) s += 2 * (derived.affinity[d.entry.dishType] ?? 0);
  const list = ctx.popular?.[ctx.daypart] ?? [];
  const rank = list.findIndex((p) => p.branchId === d.branchId && p.productId === d.productId);
  if (rank >= 0) s += 2 * ((list.length - rank) / list.length);
  return s;
}

export interface HomeBand {
  /** The order to repeat with "order again", and the usual dish that put it there. */
  usual: { order: TasteOrder; productId: string } | null;
  /** One popular dish the customer has never ordered. */
  tryPick: BandDish | null;
  /** Up to two popular open dishes. */
  popular: BandDish[];
  /** An order to ask "how was it?" about. */
  feedbackOrder: TasteOrder | null;
}

const MIN = 60_000;
const FEEDBACK_AFTER_MS = 90 * MIN;
const FEEDBACK_UNTIL_MS = 7 * 86_400_000;

/** Lines a reorder or a rating looks at: combos and lines removed by a revision are left out. */
const rateable = (o: TasteOrder) => o.lines.filter((l) => !l.comboId && !l.removed);

/** The home band's picks. Pure and deterministic, so the same inputs always show the same band. */
export function pickHomeBand(input: {
  derived: DerivedTaste;
  orders: TasteOrder[];
  /** Orders that already have a dishFeedback doc. */
  ratedOrderIds: string[];
  ordersConsent: boolean;
  dishes: BandDish[];
  popular: PopularDayparts | null;
  now: Date;
}): HomeBand {
  const { derived, now } = input;
  const daypart = daypartOf(now);
  const byKey = new Map(input.dishes.map((d) => [dishKey(d.branchId, d.productId), d]));
  const orderable = (branchId: string, productId: string) => {
    const d = byKey.get(dishKey(branchId, productId));
    return !!d && d.open && d.entry.available;
  };
  const newestFirst = [...input.orders].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  const ctx: ScoreContext = { derived, popular: input.popular, daypart };
  const ok = (d: BandDish) => scoreDish(d, ctx) > -Infinity;

  // Usual: the newest learned order with a usual dish that can be ordered again exactly as it was.
  const learned = new Set(derived.learnedOrderIds);
  const usualKeys = new Set(derived.usual.map((u) => dishKey(u.branchId, u.productId)));
  let usual: HomeBand['usual'] = null;
  for (const o of newestFirst) {
    if (!learned.has(o.id) || o.lines.some((l) => l.comboId && !l.removed)) continue;
    const lines = rateable(o);
    const hit = lines.find((l) => usualKeys.has(dishKey(o.branchId, l.productId)));
    if (!hit || !lines.every((l) => orderable(o.branchId, l.productId))) continue;
    usual = { order: o, productId: hit.productId };
    break;
  }

  // Popular: this daypart's ranks, else the dishes owners marked as most ordered.
  const ranked = (input.popular?.[daypart] ?? []).map((p) => byKey.get(dishKey(p.branchId, p.productId))).filter((d): d is BandDish => !!d && ok(d));
  const pool = ranked.length ? ranked : rankDishes(input.dishes.filter((d) => d.entry.mostOrdered && ok(d)).map((d) => ({ ...d, id: d.productId })), { seed: daySeed(now) });
  const popular = pool.slice(0, 2).map(({ branchId, productId, entry, open }) => ({ branchId, productId, entry, open }));

  const ordered = new Set(derived.orderedBefore);
  const tryPool = pool.filter((d) => !ordered.has(dishKey(d.branchId, d.productId)) && (d.entry.dishType ? (derived.affinity[d.entry.dishType] ?? 0) >= 0 : true));
  const t = tryPool[0];
  const tryPick = t ? { branchId: t.branchId, productId: t.productId, entry: t.entry, open: t.open } : null;

  const rated = new Set(input.ratedOrderIds);
  const feedbackOrder = input.ordersConsent
    ? newestFirst.find((o) => {
        const age = now.getTime() - Date.parse(o.placedAt);
        return o.status === 'accepted' && age >= FEEDBACK_AFTER_MS && age <= FEEDBACK_UNTIL_MS && !rated.has(o.id) && rateable(o).length > 0;
      }) ?? null
    : null;

  return { usual, tryPick, popular, feedbackOrder };
}
