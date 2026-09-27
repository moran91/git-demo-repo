import { formatILS, formatGrams, formatLocalDateTime, formatLocalTime, formatPhoneDisplay, minutesToHHMM, toLocal, type Locale } from '@qareeb/shared';
export { formatILS, formatGrams, formatLocalDateTime, formatLocalTime, formatPhoneDisplay };

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

export function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
}

export function money(agorot: number, locale: Locale): string {
  return formatILS(agorot, locale);
}

/** Local wall-clock time `inMin` minutes from now, as "9:30" or "00:30" (only a leading zero before a single-digit hour is dropped). */
export function clockIn(inMin: number): string {
  return minutesToHHMM(toLocal(new Date()).minutes + inMin).replace(/^0(?=[1-9]:)/, '');
}
