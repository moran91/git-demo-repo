/**
 * "For 4 under ₪150": a ready basket from ONE place (the cart holds one place). Mains cover the people
 * (serves × qty), then drinks (one each) and sides (one per two) while the budget lasts; a combo
 * replaces its items when it is cheaper. Each place offers its best basket; the best places win.
 */
import type { DishIndexEntry, DishType } from '../dishIndex.js';
import type { AssistantData, AssistantDeal, AssistantDish } from './data.js';
import { popularThenCheap, type Hit } from './rank.js';
import { retrieve } from './retrieve.js';
import { emptyRequest, type Request } from './understand.js';

export interface MealLine {
  productId: string;
  comboId?: string;
  qty: number;
  unitAgorot: number;
  needsChoice: boolean;
}
export interface MealBasket {
  branchId: string;
  lines: MealLine[];
  totalAgorot: number;
  serves: number;
  savingsAgorot: number;
  points: number;
}

const MAIN_TYPES: readonly DishType[] = ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'mains', 'pastries', 'salads'];
const ANCHORS = 4;

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
  for (const [branchId, hits] of byBranch) {
    const mains = hits.filter((h) => isMain(h.dish.entry));
    const anchors = (mains.length ? mains : hits).slice(0, ANCHORS);
    // Drinks and sides come from the whole menu of the place, minus what the customer excluded.
    const extras = retrieve({ ...emptyRequest(r.lang), exclude: r.exclude, ...(r.mode ? { mode: r.mode } : {}), placeBranchIds: [branchId] }, data)
      .map((c) => c.dish)
      .filter((d) => !d.entry.needsChoice);
    const drinks = extras.filter((d) => d.entry.dishType === 'drinks').sort((a, b) => coldFirst(a, b) || popularThenCheap(a, b));
    const sides = extras.filter((d) => d.entry.dishType === 'snacks').sort(popularThenCheap);
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
      if (e.dishType !== 'drinks') add(drinks[0], people);
      if (people >= 2 && e.dishType !== 'snacks') add(sides[0], Math.ceil(people / 2));
      const applied = applyCombos(lines, combos);
      const finalTotal = applied.lines.reduce((s, l) => s + l.qty * l.unitAgorot, 0);
      const basket: MealBasket = { branchId, lines: applied.lines, totalAgorot: finalTotal, serves: qty * servesOf(e), savingsAgorot: applied.savings, points: (r.cheap ? -finalTotal / 100 : a.points) + applied.savings / 1000 };
      if (!best || basket.points > best.points || (basket.points === best.points && basket.totalAgorot < best.totalAgorot)) best = basket;
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => y.points - x.points || x.totalAgorot - y.totalAgorot);
}

const coldFirst = (a: AssistantDish, b: AssistantDish) => Number((b.entry.tags ?? []).includes('cold_drink')) - Number((a.entry.tags ?? []).includes('cold_drink'));

export function applyCombos(lines: MealLine[], combos: AssistantDeal[]): { lines: MealLine[]; savings: number } {
  let work = lines.map((l) => ({ ...l }));
  let savings = 0;
  for (let round = 0; round < 5; round++) {
    let pick: { deal: AssistantDeal; saving: number } | undefined;
    for (const d of combos) {
      const c = d.combo!;
      let value = 0;
      let ok = true;
      for (const it of c.items) {
        const l = work.find((x) => x.productId === it.productId && !x.comboId);
        if (!l || l.qty < it.quantity) {
          ok = false;
          break;
        }
        value += it.quantity * l.unitAgorot;
      }
      const saving = value - c.priceAgorot;
      if (ok && saving > 0 && (!pick || saving > pick.saving)) pick = { deal: d, saving };
    }
    if (!pick) break;
    for (const it of pick.deal.combo!.items) work.find((x) => x.productId === it.productId && !x.comboId)!.qty -= it.quantity;
    work = work.filter((l) => l.qty > 0);
    const existing = work.find((l) => l.comboId === pick!.deal.id);
    if (existing) existing.qty += 1;
    else work.push({ productId: pick.deal.id, comboId: pick.deal.id, qty: 1, unitAgorot: pick.deal.combo!.priceAgorot, needsChoice: true });
    savings += pick.saving;
  }
  return { lines: work, savings };
}
