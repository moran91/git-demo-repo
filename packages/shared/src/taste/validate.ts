import type { DishIndexEntry } from '../dishIndex.js';
import type { Locale } from '../types.js';
import { mealPortions, mealTotal, type Meal, type MealItem, type NoFit } from './meals.js';
import { dishKey, type ReasonCode } from './types.js';
import type { WishFacts } from './wish.js';

/** A dish offered to the AI under a short alias (c1, c2 …); the AI only ever names aliases. */
export interface AiCandidate {
  alias: string;
  branchId: string;
  productId: string;
  entry: DishIndexEntry;
}

export const REASON_CODES: readonly ReasonCode[] = ['usual', 'ordered_before', 'you_picked', 'popular_now', 'new_for_you', 'fits_wish'];
export const NO_FITS: readonly NoFit[] = ['none', 'closed', 'budget', 'diet'];
export const AI_TITLE_MAX = 28;
const MAX_MEALS = 2;

export type AiRejection = 'shape' | 'unknown_id' | 'mixed_branches' | 'over_budget' | 'too_few_portions' | 'drinks' | 'duplicate' | 'title';

// Words that would state a fact (open, price, time, delivery) or a health claim.
const BLOCKED = [
  'פתוח', 'פתוחה', 'סגור', 'סגורה', 'מחיר', 'דקות', 'דקה', 'משלוח', 'שקל', 'שקלים', 'בריא', 'בריאה', 'דיאט', 'דיאטה', 'חינם', 'הנחה', 'מבצע',
  'مفتوح', 'مغلق', 'سعر', 'دقائق', 'دقيقة', 'توصيل', 'شيكل', 'صحي', 'صحية', 'دايت', 'رجيم', 'مجان', 'خصم',
  'open', 'closed', 'price', 'minute', 'minutes', 'delivery', 'free', 'healthy', 'health', 'diet', 'shekel', 'discount', 'deal',
];
const HEBREW = /[֐-׿]/;
const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

/** The AI's title when it is safe to show in this locale, else undefined (the client uses "a meal from {place}"). */
export function cleanAiTitle(raw: unknown, locale: Locale): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const title = raw.trim().replace(/\s+/g, ' ');
  if (!title || title.length > AI_TITLE_MAX) return undefined;
  if (/[\d₪%$€]/.test(title) || /https?:|www\.|\.(com|net|org|co|il)\b/i.test(title)) return undefined;
  const words = title.toLowerCase().split(/[\s,.!?;:'"״׳-]+/);
  if (words.some((w) => BLOCKED.some((b) => w === b || (b.length > 3 && w.startsWith(b))))) return undefined;
  const he = HEBREW.test(title), ar = ARABIC.test(title), latin = LATIN.test(title);
  if (locale === 'he' && (!he || ar)) return undefined;
  if (locale === 'ar' && (!ar || he)) return undefined;
  if (locale === 'en' && (!latin || he || ar)) return undefined;
  return title;
}

/**
 * Checks the AI's answer against live data: every id is a candidate, one place per meal, quantities
 * 1–10, the budget, the party's portions and "no drinks" hold on recomputed totals, and the two meals
 * differ. What fails is dropped; the caller fills the gap from buildMeals.
 */
export function validateAiMeals(raw: unknown, ctx: { candidates: Map<string, AiCandidate>; facts: WishFacts; locale: Locale }): { meals: Meal[]; rejected: AiRejection[]; noFit: NoFit } {
  const rejected: AiRejection[] = [];
  const meals: Meal[] = [];
  const obj = raw && typeof raw === 'object' ? (raw as { meals?: unknown; noFit?: unknown }) : null;
  const noFit: NoFit = obj && NO_FITS.includes(obj.noFit as NoFit) ? (obj.noFit as NoFit) : 'none';
  if (!obj || !Array.isArray(obj.meals)) return { meals, rejected: ['shape'], noFit };
  const lookup = new Map([...ctx.candidates.values()].map((c) => [dishKey(c.branchId, c.productId), c.entry]));

  for (const m of obj.meals as unknown[]) {
    if (meals.length >= MAX_MEALS) break;
    const rawItems = m && typeof m === 'object' ? (m as { items?: unknown }).items : undefined;
    if (!Array.isArray(rawItems) || rawItems.length === 0) { rejected.push('shape'); continue; }
    const qty = new Map<string, number>();
    let fail: AiRejection | null = null;
    let branchId: string | null = null;
    for (const it of rawItems as unknown[]) {
      const id = it && typeof it === 'object' ? (it as { id?: unknown }).id : undefined;
      const q = it && typeof it === 'object' ? Number((it as { qty?: unknown }).qty) : NaN;
      const c = typeof id === 'string' ? ctx.candidates.get(id) : undefined;
      if (!c) { fail = 'unknown_id'; break; }
      if (branchId !== null && c.branchId !== branchId) { fail = 'mixed_branches'; break; }
      branchId = c.branchId;
      qty.set(c.productId, (qty.get(c.productId) ?? 0) + (Number.isFinite(q) ? Math.max(1, Math.round(q)) : 1));
    }
    if (fail || !branchId) { rejected.push(fail ?? 'shape'); continue; }
    const items: MealItem[] = [...qty].map(([productId, n]) => ({ productId, qty: Math.min(10, Math.max(1, n)) }));
    if (ctx.facts.noDrinks && items.some((i) => lookup.get(dishKey(branchId!, i.productId))?.dishType === 'drinks')) { rejected.push('drinks'); continue; }
    if (ctx.facts.budgetAgorot !== undefined && mealTotal(branchId, items, lookup) > ctx.facts.budgetAgorot) { rejected.push('over_budget'); continue; }
    if (ctx.facts.party !== undefined && mealPortions(branchId, items, lookup) < ctx.facts.party) { rejected.push('too_few_portions'); continue; }
    const first = meals[0];
    if (first && first.branchId === branchId) {
      const shared = items.filter((i) => first.items.some((f) => f.productId === i.productId)).length;
      if (shared * 2 >= Math.min(items.length, first.items.length)) { rejected.push('duplicate'); continue; }
    }
    const rec = m as { title?: unknown; reason?: unknown };
    const title = cleanAiTitle(rec.title, ctx.locale);
    if (rec.title !== undefined && title === undefined) rejected.push('title');
    const reason = REASON_CODES.includes(rec.reason as ReasonCode) ? (rec.reason as ReasonCode) : 'fits_wish';
    meals.push({ branchId, items, ...(title ? { title } : {}), reason, source: 'ai' });
  }
  return { meals, rejected, noFit };
}
