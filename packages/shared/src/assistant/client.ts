/**
 * The pure half of the web layer around the assistant (apps/web/src/customer/assistant): which places
 * it may talk about, how "order again" rebuilds cart lines at today's prices, the one-confirm rule for
 * replacing another place's cart, and reading a stored conversation back. Kept here so it is unit-tested
 * next to the engine; the React hooks only wire these to Firestore and the cart store.
 */
import { availableFulfillmentModes, type FulfillmentBranchLike } from '../fulfillment.js';
import { evaluateOpen } from '../hours.js';
import { priceComboLine, priceLine } from '../pricing.js';
import type { BusinessType, CartLine, CartModifierSelection, Combo, FulfillmentMode, HoursOverride, Localized, OrderLine, Product, WeeklyHours } from '../types.js';
import type { AssistantPlace } from './data.js';
import type { ProfileLine } from './profile.js';
import { EMPTY_CONVERSATION, type Conversation } from './respond.js';

// ---------- Places ----------

export interface AssistantBranchLike extends FulfillmentBranchLike {
  id: string;
  businessId: string;
  type: BusinessType;
  name: Localized;
  businessName: Localized;
  hours: WeeklyHours;
  hoursOverrides?: HoursOverride[];
  ordersPaused: boolean;
}

/**
 * The places the assistant reasons over: restaurants only. A supermarket has no dish index, so naming
 * one ("פיצה ב<supermarket>") must never narrow the answer to a place with nothing to offer; leaving
 * them out here keeps them out of `understand`'s place names too. They stay in the places list.
 */
export function toAssistantPlaces(branches: readonly AssistantBranchLike[], now: Date, cityId: string): AssistantPlace[] {
  return branches
    .filter((b) => b.type === 'restaurant')
    .map((b) => {
      const s = evaluateOpen(now, b.hours, b.hoursOverrides ?? []);
      return {
        branchId: b.id,
        businessId: b.businessId,
        name: b.businessName,
        branchName: b.name,
        open: s.open && !b.ordersPaused,
        ...(s.open || s.opensInMin === undefined ? {} : { opensInMin: s.opensInMin }),
        modes: availableFulfillmentModes(b.type, b, cityId),
      };
    });
}

/** The first preferred mode the place serves for this customer (the cart's, then the usual's), else its first mode. */
export function pickMode(modes: readonly FulfillmentMode[], preferred: ReadonlyArray<FulfillmentMode | undefined>): FulfillmentMode {
  return preferred.find((m): m is FulfillmentMode => !!m && modes.includes(m)) ?? modes[0] ?? 'pickup';
}

// ---------- Order again ----------

export interface UsualReady {
  product: Product;
  /** The cart line without its id, priced at today's menu. */
  line: Omit<CartLine, 'lineId'>;
  /** The server's view of the same line (names of the size and options for the cart). */
  priced: OrderLine;
}
export interface UsualCombo {
  combo: Combo;
  products: ReadonlyMap<string, Product>;
  quantity: number;
}
export interface UsualPlan {
  /** Straight into the cart. */
  ready: UsualReady[];
  /** Still on the menu, but now needs a choice the old line cannot answer (a new required option, a new size, a new minimum). */
  sheets: Product[];
  combos: UsualCombo[];
  /** Product, size, option or combo gone or unavailable: left out, and named to the customer. */
  dropped: Localized[];
}

/**
 * Rebuilds a usual's order lines as cart lines at the current prices. A line whose product, size or
 * option is gone is dropped (and named), never reopened; only a real new choice opens the sheet.
 * Prices follow `priceLine` exactly, the same function the server quotes with.
 */
export function planUsual(
  lines: readonly ProfileLine[],
  found: { products: ReadonlyMap<string, Product>; combos: ReadonlyMap<string, { combo: Combo; products: ReadonlyMap<string, Product> }> },
): UsualPlan {
  const plan: UsualPlan = { ready: [], sheets: [], combos: [], dropped: [] };
  for (const l of lines) {
    if (l.comboId) {
      const c = found.combos.get(l.comboId);
      if (!c || !comboOrderable(c.combo, c.products)) plan.dropped.push(l.name);
      else plan.combos.push({ combo: c.combo, products: c.products, quantity: l.quantity });
      continue;
    }
    const product = found.products.get(l.productId);
    if (!product || gone(product, l)) {
      plan.dropped.push(l.name);
      continue;
    }
    const byGroup = new Map<string, CartModifierSelection>();
    for (const m of l.modifiers) {
      const sel = byGroup.get(m.groupId) ?? { groupId: m.groupId, optionIds: [] };
      sel.optionIds.push(m.optionId);
      if (m.placement) sel.placements = { ...(sel.placements ?? {}), [m.optionId]: m.placement };
      byGroup.set(m.groupId, sel);
    }
    const line: Omit<CartLine, 'lineId'> = {
      productId: product.id,
      ...(l.variantId ? { variantId: l.variantId } : {}),
      modifiers: [...byGroup.values()],
      quantity: l.quantity,
      ...(l.requestedGrams ? { requestedGrams: l.requestedGrams } : {}),
      expectedUnitPriceAgorot: 0,
    };
    // priceLine reports the real unit price as `actual` once everything else about the line is valid.
    let priced = priceLine(product, { ...line, lineId: '' });
    if (priced.problem?.code === 'price_changed') {
      line.expectedUnitPriceAgorot = priced.problem.actual;
      priced = priceLine(product, { ...line, lineId: '' });
    }
    if (priced.line) plan.ready.push({ product, line, priced: priced.line });
    else plan.sheets.push(product);
  }
  return plan;
}

/** The product, the size or an option of this line is no longer on the menu (or switched off). */
function gone(p: Product, l: ProfileLine): boolean {
  if (p.archived || !p.available) return true;
  if (l.variantId) {
    const v = p.variants.find((x) => x.id === l.variantId);
    if (!v || !v.available) return true;
  }
  return l.modifiers.some((m) => {
    const o = p.modifierGroups.find((g) => g.id === m.groupId)?.options.find((x) => x.id === m.optionId);
    return !o || !o.available;
  });
}

/** Same rule the server prices combos with: off, archived, or a member gone means it cannot be ordered. */
export function comboOrderable(combo: Combo, products: ReadonlyMap<string, Product>): boolean {
  const r = priceComboLine(combo, new Map(products), { lineId: '', productId: combo.id, comboId: combo.id, modifiers: [], quantity: 1, expectedUnitPriceAgorot: -1 });
  return r.problem?.code !== 'item_unavailable';
}

// ---------- One replace confirm ----------

export interface CartOwner {
  businessId: string;
  branchId: string;
}

/** The cart holds one place (business AND branch); anything else must replace it. */
export function needsReplace(owner: CartOwner | null | undefined, target: CartOwner): boolean {
  return !!owner && (owner.businessId !== target.businessId || owner.branchId !== target.branchId);
}

export interface QuickAddEffects<L, S> {
  /** The cart's place now (read at call time, not from a stale render). */
  owner(): CartOwner | null;
  /** Shows the single "replace cart?" dialog; `run` is called on yes. */
  confirm(run: () => void): void;
  clear(): void;
  add(line: L, target: CartOwner): void;
  queue(sheets: S[]): void;
}

/**
 * One add action: lines that are ready go in, the rest open their sheets in order. Another place's
 * cart is replaced only after ONE confirm, and the confirmed path empties it first, so the sheets
 * (which ask on their own when the cart is another place's) never ask a second time.
 */
export function applyQuickAdd<L, S>(target: CartOwner, ready: readonly L[], sheets: readonly S[], fx: QuickAddEffects<L, S>): void {
  if (!ready.length && !sheets.length) return;
  const work = () => {
    for (const l of ready) fx.add(l, target);
    if (sheets.length) fx.queue([...sheets]);
  };
  if (needsReplace(fx.owner(), target)) {
    fx.confirm(() => {
      fx.clear();
      work();
    });
  } else work();
}

// ---------- Stored conversation ----------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const strs = (x: unknown): boolean => Array.isArray(x) && x.every(isStr);
const every = (x: unknown, ok: (v: unknown) => boolean): boolean => Array.isArray(x) && x.every(ok);
const opt = (x: unknown, ok: (v: unknown) => boolean): boolean => x === undefined || ok(x);

function isRequest(x: unknown): boolean {
  if (!isObj(x) || !isObj(x.exclude)) return false;
  const e = x.exclude;
  return strs(x.craving) && strs(x.tags) && strs(e.tags) && strs(e.words) && strs(e.dishIds) && strs(e.branchIds)
    && isNum(x.page) && (x.lang === 'he' || x.lang === 'ar' || x.lang === 'en')
    && opt(x.people, isNum) && opt(x.budgetAgorot, isNum) && opt(x.maxPriceAgorot, isNum) && opt(x.cheap, isBool) && opt(x.warm, isBool)
    && opt(x.mode, isStr) && opt(x.meal, isStr) && opt(x.shortcut, isStr) && opt(x.placeBranchIds, strs)
    && opt(x.groups, (gs) => every(gs, (g) => isObj(g) && strs(g.craving) && strs(g.tags) && isStr(g.said) && opt(g.warm, isBool)));
}
const isChip = (x: unknown): boolean => isObj(x) && isStr(x.label) && opt(x.send, isStr) && opt(x.request, isRequest);
const isProfileLine = (x: unknown): boolean =>
  isObj(x) && isStr(x.productId) && opt(x.comboId, isStr) && opt(x.variantId, isStr) && isNum(x.quantity) && opt(x.requestedGrams, isNum) && isObj(x.name)
  && every(x.modifiers, (m) => isObj(m) && isStr(m.groupId) && isStr(m.optionId) && opt(m.placement, isStr));
const isMealLine = (x: unknown): boolean => isObj(x) && isStr(x.productId) && opt(x.comboId, isStr) && isNum(x.qty) && isNum(x.unitAgorot) && isBool(x.needsChoice);
function isCard(x: unknown): boolean {
  if (!isObj(x)) return false;
  switch (x.kind) {
    case 'dish':
      return isStr(x.branchId) && isStr(x.productId);
    case 'deal':
      return isStr(x.branchId) && isStr(x.dealId);
    case 'meal': {
      const b = x.basket;
      return isObj(b) && isStr(b.branchId) && isStr(b.anchorId) && every(b.lines, isMealLine) && isNum(b.totalAgorot) && isNum(b.serves) && isNum(b.savingsAgorot) && isNum(b.points);
    }
    case 'usual': {
      const u = x.usual;
      return isObj(u) && isStr(u.branchId) && isStr(u.businessId) && every(u.lines, isProfileLine) && isNum(u.count) && isStr(u.lastAt) && isStr(u.mode);
    }
    default:
      return false;
  }
}
function isTurn(x: unknown): boolean {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.text)) return false;
  if (x.role === 'user') return true;
  return x.role === 'assistant' && isStr(x.kind) && every(x.cards, isCard) && every(x.chips, isChip) && opt(x.more, isChip) && opt(x.signIn, isBool) && opt(x.upsold, isStr);
}

/**
 * Reads a stored conversation back. Anything that does not parse or misses a field the engine relies
 * on (an older shape included, e.g. groups without `said`) starts a fresh chat: half-shaped state is
 * never fed to `respond`.
 */
export function parseConversation(raw: string | null | undefined): Conversation {
  if (!raw) return EMPTY_CONVERSATION;
  let c: unknown;
  try {
    c = JSON.parse(raw);
  } catch {
    return EMPTY_CONVERSATION;
  }
  if (!isObj(c) || !isNum(c.misses) || !isNum(c.upsellSkips) || !every(c.turns, isTurn)) return EMPTY_CONVERSATION;
  if (c.last !== undefined) {
    const l = c.last;
    if (!isObj(l) || !isRequest(l.request) || !isObj(l.shown) || !strs(l.shown.dishIds) || !strs(l.shown.branchIds) || !opt(l.shown.maxTotalAgorot, isNum)) return EMPTY_CONVERSATION;
  }
  return c as unknown as Conversation;
}
