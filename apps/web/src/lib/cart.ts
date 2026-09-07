import type { Cart, CartLine, CartModifierSelection, FulfillmentMode, Localized } from '@qareeb/shared';
import { createStore } from './store';

export interface CartMeta {
  businessName: Localized;
  branchName: Localized;
  businessDefaultLocale: 'he' | 'ar' | 'en';
}
export interface CartState {
  cart: Cart | null;
  meta: CartMeta | null;
  /** Display snapshot per line so the cart page can render without refetching. */
  lineMeta: Record<string, { name: Localized; variantName?: Localized; modifierNames: Localized[]; unitLabel: Localized; pricingMode: 'unit' | 'weight'; imagePath?: string }>;
}

/** Guest carts persist locally; a cart belongs to exactly one business AND one branch. */
export const cartStore = createStore<CartState>('cart', { cart: null, meta: null, lineMeta: {} });

export function cartCount(s: CartState): number {
  return s.cart?.lines.reduce((n, l) => n + (l.requestedGrams ? 1 : l.quantity), 0) ?? 0;
}

export function cartBelongsTo(s: CartState, businessId: string, branchId: string): boolean {
  return !!s.cart && s.cart.businessId === businessId && s.cart.branchId === branchId;
}

export function sameSelection(a: CartModifierSelection[], b: CartModifierSelection[]): boolean {
  const norm = (m: CartModifierSelection[]) => m.map((x) => `${x.groupId}:${[...x.optionIds].sort().join(',')}`).sort().join('|');
  return norm(a) === norm(b);
}

export function addLine(params: { businessId: string; branchId: string; mode: FulfillmentMode; cityId: string; meta: CartMeta; line: CartLine; lineMeta: CartState['lineMeta'][string] }) {
  cartStore.set((s) => {
    const base: Cart = cartBelongsTo(s, params.businessId, params.branchId) && s.cart ? s.cart : { businessId: params.businessId, branchId: params.branchId, mode: params.mode, cityId: params.cityId, lines: [], updatedAt: new Date().toISOString() };
    const existing = base.lines.find((l) => l.productId === params.line.productId && l.variantId === params.line.variantId && sameSelection(l.modifiers, params.line.modifiers) && (l.note ?? '') === (params.line.note ?? '') && !l.requestedGrams);
    let lines: CartLine[];
    if (existing) lines = base.lines.map((l) => (l.lineId === existing.lineId ? { ...l, quantity: l.quantity + params.line.quantity } : l));
    else lines = [...base.lines, params.line];
    return { cart: { ...base, lines, updatedAt: new Date().toISOString() }, meta: params.meta, lineMeta: { ...(cartBelongsTo(s, params.businessId, params.branchId) ? s.lineMeta : {}), [params.line.lineId]: params.lineMeta } };
  });
}

export function updateLine(lineId: string, patch: Partial<CartLine>) {
  cartStore.set((s) => (s.cart ? { ...s, cart: { ...s.cart, lines: s.cart.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)), updatedAt: new Date().toISOString() } } : s));
}

export function removeLine(lineId: string) {
  cartStore.set((s) => {
    if (!s.cart) return s;
    const lines = s.cart.lines.filter((l) => l.lineId !== lineId);
    if (lines.length === 0) return { cart: null, meta: null, lineMeta: {} };
    const { [lineId]: _removed, ...rest } = s.lineMeta;
    return { ...s, cart: { ...s.cart, lines, updatedAt: new Date().toISOString() }, lineMeta: rest };
  });
}

export function setCartMode(mode: FulfillmentMode, cityId: string) {
  cartStore.set((s) => (s.cart ? { ...s, cart: { ...s.cart, mode, cityId } } : s));
}

export function clearCart() {
  cartStore.reset();
}
