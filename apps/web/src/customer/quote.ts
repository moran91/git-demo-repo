import { useEffect, useState } from 'react';
import type { Cart, OrderLine, OrderTotals, LoyaltyRules } from '@qareeb/shared';
import { call, ApiError } from '@/lib/api';

export interface QuoteResult {
  lines: OrderLine[];
  totals: OrderTotals;
  redeemPoints: number;
  loyalty?: { available: number; debt: number };
  rules?: LoyaltyRules;
}

/** Server-validated quote for the current cart (prices, availability, minimums, opening state). */
export function useQuote(cart: Cart | null, redeemPoints: number, deps: unknown[] = []) {
  const [state, setState] = useState<{ quote: QuoteResult | null; error: ApiError | null; loading: boolean }>({ quote: null, error: null, loading: !!cart });
  useEffect(() => {
    if (!cart) {
      setState({ quote: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    call<QuoteResult>('quoteOrder', { businessId: cart.businessId, branchId: cart.branchId, mode: cart.mode, cityId: cart.cityId, lines: cart.lines, redeemPoints: redeemPoints || undefined })
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
