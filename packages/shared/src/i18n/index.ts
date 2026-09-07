import { en, type Dictionary, type TranslationKey } from './en.js';
import { he } from './he.js';
import { ar } from './ar.js';
import type { Locale } from '../types.js';

export type { Dictionary, TranslationKey };

export const dictionaries: Record<Locale, Dictionary> = { he, ar, en };

export type TranslateParams = Record<string, string | number>;

/** Interpolates {name} placeholders. Numbers are rendered with Latin digits. */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

/**
 * Creates a translator bound to a locale. Falls back to English if a key is somehow missing
 * (should not happen because dictionaries are fully typed), never returning a raw key.
 */
export function makeTranslator(locale: Locale) {
  const dict = dictionaries[locale];
  return (key: TranslationKey, params?: TranslateParams): string => {
    const raw = dict[key] ?? en[key] ?? '';
    return interpolate(raw, params);
  };
}

export type Translator = ReturnType<typeof makeTranslator>;

export function parseLocale(value: unknown): Locale | undefined {
  return value === 'he' || value === 'ar' || value === 'en' ? value : undefined;
}
