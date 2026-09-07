import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, dirOf, makeTranslator, parseLocale, resolveLocalized, type Locale, type Localized, type TranslateParams, type TranslationKey } from '@qareeb/shared';

const STORAGE_KEY = 'qareeb.locale';

interface I18nCtx {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, params?: TranslateParams) => string;
  /** Resolves business-supplied content for the current locale. */
  L: (value: Localized | undefined | null, businessDefault?: Locale) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function initialLocale(): Locale {
  try {
    const stored = parseLocale(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);
  const value = useMemo<I18nCtx>(() => {
    const t = makeTranslator(locale);
    return { locale, dir: dirOf(locale), setLocale, t, L: (v, d) => resolveLocalized(v, locale, d) };
  }, [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}
export function useT() {
  return useI18n().t;
}

export const LOCALE_NAMES: Record<Locale, string> = { he: 'עברית', ar: 'العربية', en: 'English' };
