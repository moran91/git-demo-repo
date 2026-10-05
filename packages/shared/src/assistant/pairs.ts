/** Which dishes customers order together at one place, from its recent orders (built nightly). */
import type { PairEntry } from '../dishIndex.js';

export interface PairOrder {
  status: string;
  lines: Array<{ productId: string; comboId?: string; removed?: boolean }>;
}

export const MIN_PAIR_ORDERS = 10;
const TOP = 5;

export function computePairs(orders: PairOrder[]): Record<string, PairEntry[]> | null {
  const live = orders.filter((o) => o.status !== 'rejected');
  if (live.length < MIN_PAIR_ORDERS) return null;
  const counts = new Map<string, Map<string, number>>();
  for (const o of live) {
    const ids = [...new Set(o.lines.filter((l) => !l.removed && !l.comboId).map((l) => l.productId))];
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const m = counts.get(a) ?? new Map<string, number>();
      m.set(b, (m.get(b) ?? 0) + 1);
      counts.set(a, m);
    }
  }
  const out: Record<string, PairEntry[]> = {};
  for (const [a, m] of counts) {
    const list = [...m].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, TOP).map(([productId, count]) => ({ productId, count }));
    if (list.length) out[a] = list;
  }
  return out;
}
