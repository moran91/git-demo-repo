import type { ToppingPlacement } from './types.js';

/** Pizza quarters as seen by the customer: top-left, top-right, bottom-left, bottom-right. */
export const QUARTERS = ['tl', 'tr', 'bl', 'br'] as const;
export type Quarter = (typeof QUARTERS)[number];

/** Common shapes offered as one-tap presets; any other quarter set is still valid. */
export const PLACEMENT_PRESETS = { whole: 'whole', left: 'tl+bl', right: 'tr+br', top: 'tl+tr', bottom: 'bl+br' } as const;

export function isQuarter(s: string): s is Quarter {
  return (QUARTERS as readonly string[]).includes(s);
}

/** Canonical form: 'whole', or a '+'-joined sorted subset of quarters. Empty/invalid/all four → 'whole'. */
/** Values sent by clients built before quarters existed (still cached in some browsers). */
const LEGACY: Record<string, string> = { left: PLACEMENT_PRESETS.left, right: PLACEMENT_PRESETS.right, top: PLACEMENT_PRESETS.top, bottom: PLACEMENT_PRESETS.bottom };

export function normalizePlacement(p: string | undefined): ToppingPlacement {
  if (!p || p === 'whole') return 'whole';
  const raw = LEGACY[p] ?? p;
  const qs = QUARTERS.filter((q) => raw.split('+').includes(q));
  return qs.length === 0 || qs.length === 4 ? 'whole' : qs.join('+');
}

export function placementQuarters(p: string | undefined): Quarter[] {
  const n = normalizePlacement(p);
  return n === 'whole' ? [...QUARTERS] : (n.split('+') as Quarter[]);
}

export function placementFromQuarters(qs: Iterable<Quarter>): ToppingPlacement {
  return normalizePlacement([...qs].join('+'));
}

export const PLACEMENT_LABEL_KEY = {
  'tl+bl': 'product.placementLeft',
  'tr+br': 'product.placementRight',
  'tl+tr': 'product.placementTop',
  'bl+br': 'product.placementBottom',
  tl: 'product.quarterTL',
  tr: 'product.quarterTR',
  bl: 'product.quarterBL',
  br: 'product.quarterBR',
} as const;
export const QUARTER_KEY = { tl: 'product.quarterTL', tr: 'product.quarterTR', bl: 'product.quarterBL', br: 'product.quarterBR' } as const;
export type PlacementKey = (typeof PLACEMENT_LABEL_KEY)[keyof typeof PLACEMENT_LABEL_KEY] | 'product.placementWhole' | 'product.placementQuarters';

/** Human label for a placement: '' for whole, else e.g. 'חצי ימני' or 'רבעים: …'. */
export function placementLabel(placement: string | undefined, t: (key: PlacementKey, params?: Record<string, string | number>) => string): string {
  const n = normalizePlacement(placement);
  if (n === 'whole') return '';
  const key = (PLACEMENT_LABEL_KEY as Record<string, PlacementKey>)[n];
  if (key) return t(key);
  return t('product.placementQuarters', { list: placementQuarters(n).map((q) => t(QUARTER_KEY[q])).join(', ') });
}

/** " (חצי ימני)" for partial placements, empty for whole/none. Kitchen tickets and order views share it. */
export function placementSuffix(placement: string | undefined, t: (key: PlacementKey, params?: Record<string, string | number>) => string): string {
  const label = placementLabel(placement, t);
  return label ? ` (${label})` : '';
}
