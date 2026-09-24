import { useEffect, useRef, useState } from 'react';
import type { Cart, OrderLine, OrderTotals, LoyaltyRules } from '@qareeb/shared';
import { call, ApiError } from '@/lib/api';
import { cartStore } from '@/lib/cart';

export interface QuoteResult {
  lines: OrderLine[];
  totals: OrderTotals;
  redeemPoints: number;
  loyalty?: { available: number; debt: number };
  rules?: LoyaltyRules;
}

/**
 * In-flight/recent quotes keyed by cart contents. The cart page and checkout both quote the same
 * cart back to back, and the cart is quoted as soon as it changes (see the subscription below), so
 * opening the cart normally finds the answer already here instead of waiting on the round trip.
 * Entries are short-lived: prices, availability and opening state can change under us.
 */
const QUOTE_TTL_MS = 45_000;
const cache = new Map<string, { at: number; promise: Promise<QuoteResult> }>();

function quoteKey(cart: Cart, redeemPoints: number): string {
  return JSON.stringify({ businessId: cart.businessId, branchId: cart.branchId, mode: cart.mode, cityId: cart.cityId, lines: cart.lines, redeemPoints: redeemPoints || 0 });
}

export function fetchQuote(cart: Cart, redeemPoints: number, opts: { fresh?: boolean } = {}): Promise<QuoteResult> {
  const key = quoteKey(cart, redeemPoints);
  const hit = cache.get(key);
  if (hit && !opts.fresh && Date.now() - hit.at < QUOTE_TTL_MS) return hit.promise;
  const promise = call<QuoteResult>('quoteOrder', { businessId: cart.businessId, branchId: cart.branchId, mode: cart.mode, cityId: cart.cityId, lines: cart.lines, redeemPoints: redeemPoints || undefined });
  cache.set(key, { at: Date.now(), promise });
  // A rejected quote must not be served from cache: the customer may fix the cart and retry.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/** Quote the cart as soon as it settles, so the cart page opens with the total already known. */
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== 'undefined') {
  cartStore.subscribe(() => {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      const { cart } = cartStore.get();
      if (cart && cart.lines.length > 0) fetchQuote(cart, 0).catch(() => undefined);
    }, 300);
  });
}

/** Server-validated quote for the current cart (prices, availability, minimums, opening state). */
export function useQuote(cart: Cart | null, redeemPoints: number, deps: unknown[] = []) {
  const [state, setState] = useState<{ quote: QuoteResult | null; error: ApiError | null; loading: boolean }>({ quote: null, error: null, loading: !!cart });
  const depsKey = JSON.stringify(deps);
  const lastDepsKey = useRef(depsKey);
  useEffect(() => {
    // `deps` changing is an explicit "re-quote now" (e.g. after price_changed), so bypass the cache.
    const fresh = lastDepsKey.current !== depsKey;
    lastDepsKey.current = depsKey;
    if (!cart) {
      setState({ quote: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetchQuote(cart, redeemPoints, { fresh })
      .then((quote) => {
        if (!alive) return;
        setState({ quote, error: null, loading: false });
        try {
          sessionStorage.setItem('qareeb.cart.quotedTotal', String(quote.totals.cashDueAgorot));
          window.dispatchEvent(new Event('qareeb:cart-quote'));
        } catch {
          /* ignore */
        }
      })
      .catch((e: ApiError) => alive && setState({ quote: null, error: e, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart ? JSON.stringify(cart) : null, redeemPoints, ...deps]);
  return state;
}
