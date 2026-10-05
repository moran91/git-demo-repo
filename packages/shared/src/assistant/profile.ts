/**
 * What a signed-in customer usually orders, computed on the phone from their last orders (readable
 * by them already). Nothing is stored on the server.
 */
import type { DishType } from '../dishIndex.js';
import type { FulfillmentMode, Localized } from '../types.js';

export interface ProfileLine {
  productId: string;
  comboId?: string;
  variantId?: string;
  modifiers: Array<{ groupId: string; optionId: string; placement?: string }>;
  quantity: number;
  requestedGrams?: number;
  removed?: boolean;
  name: Localized;
}
export interface ProfileOrder {
  branchId: string;
  businessId: string;
  placedAt: string;
  mode: FulfillmentMode;
  status: string;
  lines: ProfileLine[];
}
export interface Usual {
  branchId: string;
  businessId: string;
  /** The latest version of the most repeated order (current option choices). */
  lines: ProfileLine[];
  count: number;
  lastAt: string;
  mode: FulfillmentMode;
}
export interface Profile {
  usuals: Usual[];
  favoriteTypes: DishType[];
  favoriteBranches: string[];
  orderedProductIds: string[];
  usualMode?: FulfillmentMode;
}

export function buildProfile(orders: ProfileOrder[], typeOf: (branchId: string, productId: string) => DishType | undefined): Profile | undefined {
  const live = orders.filter((o) => o.status === 'accepted' && o.lines.some((l) => !l.removed));
  if (!live.length) return undefined;
  const groups = new Map<string, Usual>();
  const types = new Map<DishType, number>();
  const branches = new Map<string, number>();
  const modes = new Map<FulfillmentMode, number>();
  const modeLastAt = new Map<FulfillmentMode, string>();
  const products = new Set<string>();
  for (const o of live) {
    const lines = o.lines.filter((l) => !l.removed);
    const sig = `${o.branchId}|${lines.map((l) => `${l.comboId ?? l.productId}:${l.variantId ?? ''}:${l.quantity}`).sort().join(',')}`;
    const g = groups.get(sig);
    if (!g) groups.set(sig, { branchId: o.branchId, businessId: o.businessId, lines, count: 1, lastAt: o.placedAt, mode: o.mode });
    else {
      g.count++;
      if (o.placedAt > g.lastAt) Object.assign(g, { lastAt: o.placedAt, lines, mode: o.mode });
    }
    branches.set(o.branchId, (branches.get(o.branchId) ?? 0) + 1);
    modes.set(o.mode, (modes.get(o.mode) ?? 0) + 1);
    if (o.placedAt > (modeLastAt.get(o.mode) ?? '')) modeLastAt.set(o.mode, o.placedAt);
    // A type counts once per order: two Cokes with every pizza do not make drinks the favourite.
    const orderTypes = new Set<DishType>();
    for (const l of lines) {
      products.add(l.productId);
      const t = typeOf(o.branchId, l.productId);
      if (t) orderTypes.add(t);
    }
    for (const t of orderTypes) types.set(t, (types.get(t) ?? 0) + 1);
  }
  // Drinks go with everything; they say nothing about what the customer wants to eat.
  types.delete('drinks');
  const perPlace = new Map<string, Usual>();
  for (const u of groups.values()) {
    const cur = perPlace.get(u.branchId);
    if (!cur || u.count > cur.count || (u.count === cur.count && u.lastAt > cur.lastAt)) perPlace.set(u.branchId, u);
  }
  const top = <K>(m: Map<K, number>, min: number, n: number) => [...m].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return {
    usuals: [...perPlace.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 3),
    favoriteTypes: top(types, 2, 3),
    favoriteBranches: top(branches, 2, 3),
    orderedProductIds: [...products],
    // Most orders wins; a tie goes to the mode of the most recent order.
    usualMode: [...modes].sort((a, b) => b[1] - a[1] || (modeLastAt.get(b[0]) ?? '').localeCompare(modeLastAt.get(a[0]) ?? ''))[0]![0],
  };
}
