import type { Agorot, Grams, Locale } from './types.js';

/**
 * Rounding policy (documented, deterministic):
 * - All stored amounts are integer agorot; all stored weights are integer grams.
 * - Weight line totals: round(pricePerKg * grams / 1000) using round-half-up on a non-negative value.
 * - Loyalty discount: floor(points * redeemValue); cap = floor(subtotal * maxPercent / 100).
 * - Earned points: floor(paidMerchandise / earnPerAgorot) * pointsPerStep.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function weightLineTotal(pricePerKgAgorot: Agorot, grams: Grams): Agorot {
  if (grams <= 0 || pricePerKgAgorot < 0) return 0;
  return roundHalfUp((pricePerKgAgorot * grams) / 1000);
}

export function unitLineTotal(unitPriceAgorot: Agorot, modifiersDeltaAgorot: Agorot, quantity: number): Agorot {
  return Math.max(0, (unitPriceAgorot + modifiersDeltaAgorot) * quantity);
}

const currencyLocale: Record<Locale, string> = { he: 'he-IL', ar: 'ar-IL', en: 'en-IL' };

/** Formats agorot as ILS. Uses Latin digits everywhere for consistent numeric rendering. */
export function formatILS(agorot: Agorot, locale: Locale = 'he'): string {
  const value = agorot / 100;
  const fmt = new Intl.NumberFormat(currencyLocale[locale] + '-u-nu-latn', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return fmt.format(value);
}

/** Plain formatting used on receipts: "₪12.50" */
export function formatILSPlain(agorot: Agorot): string {
  const sign = agorot < 0 ? '-' : '';
  const abs = Math.abs(agorot);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}₪${whole}${frac === 0 ? '' : '.' + String(frac).padStart(2, '0')}`;
}

export function formatGrams(grams: Grams, locale: Locale = 'he'): string {
  const kg = grams / 1000;
  const nf = new Intl.NumberFormat(currencyLocale[locale] + '-u-nu-latn', { maximumFractionDigits: 3 });
  if (grams >= 1000) return `${nf.format(kg)} ${unitKg[locale]}`;
  return `${nf.format(grams)} ${unitG[locale]}`;
}
const unitKg: Record<Locale, string> = { he: 'ק״ג', ar: 'كغ', en: 'kg' };
const unitG: Record<Locale, string> = { he: 'גרם', ar: 'غرام', en: 'g' };

export function parseILSInput(input: string): Agorot | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return roundHalfUp(n * 100);
}
