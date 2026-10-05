/**
 * "For 4 under ₪150": a ready basket from ONE place (the cart holds one place). Mains cover the people
 * (serves × qty), then drinks (enough to go round: a big bottle serves several) and sides (one per two)
 * while the budget lasts; a combo replaces its items when it is cheaper. Each place offers its best
 * basket; the best places win.
 */
import type { DishIndexEntry, DishType } from '../dishIndex.js';
import type { AssistantData, AssistantDeal, AssistantDish } from './data.js';
import type { DishTag } from './tags.js';
import { hashUnit, popularThenCheap, type Hit } from './rank.js';
import { placeUsable, retrieve } from './retrieve.js';
import { emptyRequest, type Request } from './understand.js';
import { drinkSuits } from './upsell.js';

export interface MealLine {
  productId: string;
  comboId?: string;
  qty: number;
  unitAgorot: number;
  needsChoice: boolean;
}
export interface MealBasket {
  branchId: string;
  /** The main the basket is built around (also when a combo now holds it): "something else" skips it. */
  anchorId: string;
  lines: MealLine[];
  totalAgorot: number;
  serves: number;
  savingsAgorot: number;
  points: number;
}

const MAIN_TYPES: readonly DishType[] = ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'mains', 'pastries', 'salads'];
const ANCHORS = 4;
const DIET_TAGS: readonly DishTag[] = ['vegan', 'vegetarian', 'gluten_free'];
/** Tags that say the customer wants a dessert or a drink itself, so a place with only those can answer. */
const EXTRAS_TAGS: readonly DishTag[] = ['sweet', 'cold_drink', 'hot_drink'];

export function servesOf(e: DishIndexEntry): number {
  return e.serves ?? (e.dishType === 'pizza' ? 2 : 1);
}

function isMain(e: DishIndexEntry): boolean {
  if (e.dishType) return MAIN_TYPES.includes(e.dishType);
  return !(e.tags ?? []).some((t) => t === 'cold_drink' || t === 'hot_drink' || t === 'sweet');
}

export function buildMeals(r: Request, data: AssistantData, ranked: Hit[]): MealBasket[] {
  const people = r.people ?? 1;
  const budget = r.budgetAgorot ?? Number.POSITIVE_INFINITY;
  const byBranch = new Map<string, Hit[]>();
  for (const h of ranked) byBranch.set(h.dish.branchId, [...(byBranch.get(h.dish.branchId) ?? []), h]);
  const out: MealBasket[] = [];
  // Dessert or drink only places are not a meal, unless the customer asked for one of those.
  const askedForExtras = r.craving.length > 0 || r.tags.some((t) => EXTRAS_TAGS.includes(t));
  // A kids meal feeds a child, so it anchors a basket only when kids were asked for.
  const mainsOf = (hits: Hit[]) => hits.filter((h) => isMain(h.dish.entry) && (r.tags.includes('kids') || !(h.dish.entry.tags ?? []).includes('kids')));
  // "Pizza and cola for 2": a place with only the cola is not a meal while another place has the pizza.
  const someMains = ranked.some((h) => placeUsable(data.places.get(h.dish.branchId), r.mode) && mainsOf([h]).length > 0);
  // Drinks and sides come from the whole menu of each place, minus what the customer excluded (one pass for all places).
  const extrasByBranch = new Map<string, AssistantDish[]>();
  for (const c of retrieve({ ...emptyRequest(r.lang), exclude: r.exclude, ...(r.mode ? { mode: r.mode } : {}), placeBranchIds: [...byBranch.keys()] }, data)) {
    if (c.dish.entry.needsChoice) continue;
    const list = extrasByBranch.get(c.dish.branchId);
    if (list) list.push(c.dish);
    else extrasByBranch.set(c.dish.branchId, [c.dish]);
  }
  for (const [branchId, hits] of byBranch) {
    if (!placeUsable(data.places.get(branchId), r.mode)) continue;
    const mains = mainsOf(hits);
    const anchors = (mains.length ? mains : askedForExtras && !someMains ? hits : []).slice(0, ANCHORS);
    const extras = extrasByBranch.get(branchId) ?? [];
    const allDrinks = extras.filter((d) => d.entry.dishType === 'drinks');
    // A side must carry every diet tag that was asked for ("vegan" does not get onion rings).
    const dietTags = r.tags.filter((t) => DIET_TAGS.includes(t));
    const sides = extras.filter((d) => d.entry.dishType === 'snacks' && dietTags.every((t) => (d.entry.tags ?? []).includes(t))).sort(popularThenCheap);
    const combos = data.deals.filter((d) => d.branchId === branchId && d.combo);
    let best: MealBasket | undefined;
    for (const a of anchors) {
      const e = a.dish.entry;
      const qty = Math.ceil(people / servesOf(e));
      const lines: MealLine[] = [{ productId: a.dish.id, qty, unitAgorot: e.priceAgorot, needsChoice: e.needsChoice }];
      let total = qty * e.priceAgorot;
      if (total > budget) continue;
      const add = (d: AssistantDish | undefined, want: number) => {
        if (!d || want <= 0 || lines.some((l) => l.productId === d.id)) return;
        const fit = Number.isFinite(budget) ? Math.min(want, Math.floor((budget - total) / d.entry.priceAgorot)) : want;
        if (fit <= 0) return;
        lines.push({ productId: d.id, qty: fit, unitAgorot: d.entry.priceAgorot, needsChoice: false });
        total += fit * d.entry.priceAgorot;
      };
      // The drink suits the main: a cold one, or a hot one with a pastry or dessert; never the wrong temperature.
      const drink = allDrinks.filter((d) => drinkSuits(d, e.dishType)).sort((x, y) => coldFirst(x, y, e.dishType) || popularThenCheap(x, y))[0];
      // Enough to go round: a 1.5 L bottle serves 4 (servesOf), so "for 4" gets one, not four.
      if (e.dishType !== 'drinks' && drink) add(drink, Math.ceil(people / servesOf(drink.entry)));
      // Sides go with a main, never with a dessert or a coffee ("כנאפה ל-4" gets no falafel).
      if (people >= 2 && isMain(e)) add(sides[0], Math.ceil(people / 2));
      const applied = applyCombos(lines, combos);
      const finalTotal = applied.lines.reduce((s, l) => s + l.qty * l.unitAgorot, 0);
      const basket: MealBasket = { branchId, anchorId: a.dish.id, lines: applied.lines, totalAgorot: finalTotal, serves: qty * servesOf(e), savingsAgorot: applied.savings, points: (r.cheap ? -finalTotal / 100 : a.points) + applied.savings / 1000 };
      if (!best || basket.points > best.points || (basket.points === best.points && basket.totalAgorot < best.totalAgorot)) best = basket;
    }
    if (best) out.push(best);
  }
  // Equal places take turns by the daily seed.
  return out.sort((x, y) => y.points - x.points || x.totalAgorot - y.totalAgorot || hashUnit(data.seed, x.branchId) - hashUnit(data.seed, y.branchId));
}

const coldFirst = (a: AssistantDish, b: AssistantDish, anchor: DishType | undefined) => {
  const want = anchor === 'pastries' || anchor === 'desserts' ? 'hot_drink' : 'cold_drink';
  return Number((b.entry.tags ?? []).includes(want)) - Number((a.entry.tags ?? []).includes(want));
};

/** What a combo takes from the basket, per product: two rows of the same product (two sizes) need that many units. */
function needs(items: ReadonlyArray<{ productId: string; quantity: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.productId, (m.get(it.productId) ?? 0) + it.quantity);
  return m;
}

export function applyCombos(lines: MealLine[], combos: AssistantDeal[]): { lines: MealLine[]; savings: number } {
  let work = lines.map((l) => ({ ...l }));
  let savings = 0;
  // Every round turns at least one unit of some line into a combo, so quantities only fall and this ends.
  for (;;) {
    let pick: { deal: AssistantDeal; saving: number } | undefined;
    for (const d of combos) {
      const c = d.combo!;
      let value = 0;
      let ok = true;
      for (const [productId, quantity] of needs(c.items)) {
        const l = work.find((x) => x.productId === productId && !x.comboId);
        if (!l || l.qty < quantity) {
          ok = false;
          break;
        }
        value += quantity * l.unitAgorot;
      }
      const saving = value - c.priceAgorot;
      if (ok && saving > 0 && (!pick || saving > pick.saving)) pick = { deal: d, saving };
    }
    if (!pick) break;
    for (const [productId, quantity] of needs(pick.deal.combo!.items)) work.find((x) => x.productId === productId && !x.comboId)!.qty -= quantity;
    work = work.filter((l) => l.qty > 0);
    const existing = work.find((l) => l.comboId === pick!.deal.id);
    if (existing) existing.qty += 1;
    else work.push({ productId: pick.deal.id, comboId: pick.deal.id, qty: 1, unitAgorot: pick.deal.combo!.priceAgorot, needsChoice: true });
    savings += pick.saving;
  }
  return { lines: work, savings };
}
