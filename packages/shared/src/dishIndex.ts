/**
 * Cross-restaurant dish search for the customer home ("what do I feel like eating?").
 *
 * Each visible restaurant branch has one public document, `publicBranches/{branchId}/index/dishes`,
 * holding a compact entry per live product. The home reads one such document per branch in the city
 * and searches in memory, so a load costs one read per place instead of one per dish.
 */
import type { DishTag } from './assistant/tags.js';
import type { Agorot, Combo, ComboItem, Localized, Product, Promotion } from './types.js';

/** Fixed dish-type list, owner-assigned per product. Order is the order chips appear in. */
export const DISH_TYPES = ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'pastries', 'salads', 'mains', 'snacks', 'desserts', 'drinks'] as const;
export type DishType = (typeof DISH_TYPES)[number];

export interface DishIndexEntry {
  name: Localized;
  /** Description in every language it has; searched below the name. Omitted when empty. */
  description?: Localized;
  /** Unit price, or the cheapest available size when the dish has sizes. */
  priceAgorot: Agorot;
  /** True when the dish has more than one size, so the price is a starting price. */
  fromPrice: boolean;
  dishType?: DishType;
  imagePath?: string;
  /** Orderable now: switched on and in stock. */
  available: boolean;
  /** A size or a required option must be picked, so quick add opens the product sheet. */
  needsChoice: boolean;
  sortOrder: number;
  mostOrdered?: boolean;
  tags?: DishTag[];
  /** People one portion feeds; missing reads as 1 (2 for a whole pizza). */
  serves?: number;
}

export interface DishIndexDoc {
  branchId: string;
  businessId: string;
  /** productId -> entry. Written per key so one product change never rewrites the others. */
  dishes: Record<string, DishIndexEntry>;
  updatedAt: string;
}

/** A size, a required option or a weight must be picked, so quick add opens the product sheet instead of adding directly. */
export function needsChoice(p: Pick<Product, 'variants' | 'modifierGroups' | 'pricingMode'>): boolean {
  return p.variants.length > 0 || p.modifierGroups.some((g) => g.required || g.minSelect > 0) || p.pricingMode === 'weight';
}

export function toDishIndexEntry(p: Product): DishIndexEntry {
  const inStock = !p.trackInventory || (p.stockQty ?? 0) > 0 || (p.variants.length > 0 && p.variants.some((v) => (v.stockQty ?? 0) > 0));
  const sizes = p.variants.filter((v) => v.available && (!p.trackInventory || v.stockQty === undefined || v.stockQty > 0));
  const price = sizes.length > 0 ? Math.min(...sizes.map((v) => v.priceAgorot)) : p.priceAgorot;
  const entry: DishIndexEntry = {
    name: p.name,
    priceAgorot: price,
    fromPrice: p.variants.length > 1,
    available: p.available && inStock,
    needsChoice: needsChoice(p),
    sortOrder: p.sortOrder,
  };
  // Firestore rejects undefined, so optional fields are only set when present.
  if (Object.values(p.description ?? {}).some((v) => v && v.trim())) entry.description = p.description;
  if (p.dishType) entry.dishType = p.dishType;
  if (p.imagePath) entry.imagePath = p.imagePath;
  if (p.mostOrdered) entry.mostOrdered = true;
  if (p.tags?.length) entry.tags = p.tags;
  if (p.serves) entry.serves = p.serves;
  return entry;
}

/** Hebrew niqqud & cantillation, Arabic harakat, Quranic marks and tatweel. */
const MARKS = /[֑-ׇؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const FOLD: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي' };

/** Folds text so "פִּיצָה" finds "פיצה", "צ׳יפס" finds "צ'יפס" and "برغر" ignores harakat. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFC')
    .replace(MARKS, '')
    .replace(/[ךםןףץأإآةى]/g, (c) => FOLD[c] ?? c)
    .toLocaleLowerCase()
    // Geresh and quotes sit inside words (צ׳יפס, מוח'יטו, ק״ג), so they are dropped, not spaced.
    .replace(/[׳״'"`’‘]/g, '')
    .replace(/[\-–—_.,;:!?()[\]{}/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word of the query must appear somewhere in the haystack (both sides normalised). */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const h = normalizeSearch(haystack);
  return q.split(' ').every((w) => h.includes(w));
}

/** Day number used as the rotation seed, so the order is stable within a day. */
export function daySeed(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** `publicBranches/{branchId}/index/deals`: active combos and promotions, so the assistant answers "what's on offer?" across the city in one read per place. */
export interface DealsIndexCombo {
  name: Localized;
  description?: Localized;
  priceAgorot: Agorot;
  items: ComboItem[];
  imagePath?: string;
  sortOrder: number;
}
export interface DealsIndexPromotion {
  title: Localized;
  body?: Localized;
  productIds: string[];
  /** Last valid day, YYYY-MM-DD in Asia/Jerusalem; the client drops expired ones. */
  endsAt: string;
  imagePath?: string;
  sortOrder: number;
}
export interface DealsIndexDoc {
  branchId: string;
  businessId: string;
  combos: Record<string, DealsIndexCombo>;
  promotions: Record<string, DealsIndexPromotion>;
  updatedAt: string;
}
/** `publicBranches/{branchId}/index/pairs`: what customers add together, rebuilt nightly from orders. */
/** Ranked best-first; the co-order count is deliberately not published (it is sales volume). */
export interface PairEntry {
  productId: string;
}
export interface PairsIndexDoc {
  branchId: string;
  pairs: Record<string, PairEntry[]>;
  updatedAt: string;
}

const hasText = (l?: Localized) => Object.values(l ?? {}).some((v) => v && v.trim());

export function toDealsCombo(c: Combo): DealsIndexCombo {
  const d: DealsIndexCombo = { name: c.name, priceAgorot: c.priceAgorot, items: c.items, sortOrder: c.sortOrder };
  if (hasText(c.description)) d.description = c.description;
  if (c.imagePath) d.imagePath = c.imagePath;
  return d;
}

export function toDealsPromotion(p: Promotion): DealsIndexPromotion {
  const d: DealsIndexPromotion = { title: p.title, productIds: p.productIds, endsAt: p.endsAt, sortOrder: p.sortOrder };
  if (hasText(p.body)) d.body = p.body;
  if (p.imagePath) d.imagePath = p.imagePath;
  return d;
}

/** The whole deals document for one branch: only active, unarchived combos and active promotions, keyed by id. */
export function toDealsIndexDoc(branchId: string, businessId: string, combos: Combo[], promos: Promotion[], now: string): DealsIndexDoc {
  return {
    branchId,
    businessId,
    combos: Object.fromEntries(combos.filter((c) => c.active && !c.archived).map((c) => [c.id, toDealsCombo(c)])),
    promotions: Object.fromEntries(promos.filter((p) => p.active).map((p) => [p.id, toDealsPromotion(p)])),
    updatedAt: now,
  };
}
