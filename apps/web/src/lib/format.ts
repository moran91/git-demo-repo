import { formatILS, formatGrams, formatLocalDateTime, formatLocalTime, formatPhoneDisplay, type Locale } from '@qareeb/shared';
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
