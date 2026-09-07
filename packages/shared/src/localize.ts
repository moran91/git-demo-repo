import { LOCALES, type Locale, type Localized } from './types.js';

/**
 * Resolves business-supplied content: requested language → business default language → any supplied
 * translation. Never invents a translation; returns '' only when nothing was supplied.
 */
export function resolveLocalized(value: Localized | undefined | null, locale: Locale, businessDefault?: Locale): string {
  if (!value) return '';
  const direct = value[locale];
  if (direct && direct.trim()) return direct;
  if (businessDefault) {
    const d = value[businessDefault];
    if (d && d.trim()) return d;
  }
  for (const l of LOCALES) {
    const v = value[l];
    if (v && v.trim()) return v;
  }
  return '';
}

/** Which locale the resolved string actually is in (for lang= attributes / direction). */
export function resolvedLocaleOf(value: Localized | undefined | null, locale: Locale, businessDefault?: Locale): Locale | undefined {
  if (!value) return undefined;
  if (value[locale]?.trim()) return locale;
  if (businessDefault && value[businessDefault]?.trim()) return businessDefault;
  return LOCALES.find((l) => value[l]?.trim());
}

export function hasAnyTranslation(value: Localized | undefined | null): boolean {
  return !!value && LOCALES.some((l) => !!value[l]?.trim());
}

export function cleanLocalized(value: Localized | undefined | null): Localized {
  const out: Localized = {};
  if (!value) return out;
  for (const l of LOCALES) {
    const v = value[l];
    if (typeof v === 'string' && v.trim()) out[l] = v.trim();
  }
  return out;
}

export function isRtl(locale: Locale): boolean {
  return locale === 'he' || locale === 'ar';
}

export function dirOf(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}
