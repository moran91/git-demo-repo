import { DAYPARTS, type Daypart, type PopularDayparts } from './types.js';

/** A dish must appear in this many orders over the window before it is shown as popular. */
export const POPULAR_MIN_ORDERS = 3;
export const POPULAR_TOP = 12;
export const POPULAR_WINDOW_DAYS = 28;

/** Key in popularityDaily.counts. Branch and product ids never contain "|". */
export function popularCountKey(daypart: Daypart, branchId: string, productId: string): string {
  return `${daypart}|${branchId}|${productId}`;
}

export function sumCounts(docs: Array<Record<string, number> | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of docs) for (const [k, v] of Object.entries(d ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Ranks only: the published document never carries a count. */
export function rankPopular(counts: Record<string, number>): PopularDayparts {
  const out: PopularDayparts = { morning: [], noon: [], evening: [], late: [] };
  const rows: Array<{ daypart: Daypart; branchId: string; productId: string; n: number }> = [];
  for (const [key, n] of Object.entries(counts)) {
    const [daypart, branchId, productId] = key.split('|');
    if (!daypart || !branchId || !productId || !(DAYPARTS as readonly string[]).includes(daypart) || n < POPULAR_MIN_ORDERS) continue;
    rows.push({ daypart: daypart as Daypart, branchId, productId, n });
  }
  rows.sort((a, b) => b.n - a.n || a.branchId.localeCompare(b.branchId) || a.productId.localeCompare(b.productId));
  for (const r of rows) {
    const list = out[r.daypart];
    if (list.length < POPULAR_TOP) list.push({ branchId: r.branchId, productId: r.productId });
  }
  return out;
}
