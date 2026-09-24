import { useId, useState } from 'react';
import { LOCALES, type Localized } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Icon } from '@/design/Icon';

export type Loc = (typeof LOCALES)[number];

/** Language names ("Hebrew", "עברית", ...) taken from `catalog.nameHe` ("שם (עברית)" → "עברית"). */
export function useLangNames(): Record<Loc, string> {
  const t = useT();
  const lang = (k: 'catalog.nameHe' | 'catalog.nameAr' | 'catalog.nameEn') => t(k).replace(/^[^(]*\(?/, '').replace(/\)\s*$/, '');
  return { he: lang('catalog.nameHe'), ar: lang('catalog.nameAr'), en: lang('catalog.nameEn') };
}

/** The language a form opens in: the UI language when the content has it, else the first filled one. */
export function initialLang(locale: Loc, ...values: Localized[]): Loc {
  if (values.some((v) => v[locale]?.trim())) return locale;
  return LOCALES.find((l) => values.some((v) => v[l]?.trim())) ?? locale;
}

/** Languages that some partly-translated required text lacks (drives the switch's dots). */
export function missingLangs(values: Localized[]): Loc[] {
  const started = values.filter((v) => LOCALES.some((l) => v[l]?.trim()));
  return LOCALES.filter((l) => started.some((v) => !v[l]?.trim()));
}

/** One he/ar/en switch for a whole form. A dot marks a language that some required text lacks. */
export function LangSwitch({ value, onChange, missing = [] }: { value: Loc; onChange: (l: Loc) => void; missing?: readonly Loc[] }) {
  const t = useT();
  const id = useId();
  const { dir } = useI18n();
  const names = useLangNames();
  return (
    <span className="lang-tabs" role="tablist" aria-label={t('catalog.language')}>
      {LOCALES.map((l) => (
        <button key={l} type="button" role="tab" id={`${id}-${l}`} aria-selected={value === l} tabIndex={value === l ? 0 : -1} className="lang-tabs__tab" lang={l} onClick={() => onChange(l)} onKeyDown={(e) => {
          const index = LOCALES.indexOf(l);
          const delta = e.key === 'ArrowRight' ? (dir === 'rtl' ? -1 : 1) : e.key === 'ArrowLeft' ? (dir === 'rtl' ? 1 : -1) : 0;
          const next = e.key === 'Home' ? LOCALES[0] : e.key === 'End' ? LOCALES.at(-1) : delta ? LOCALES[(index + delta + LOCALES.length) % LOCALES.length] : undefined;
          if (!next) return;
          e.preventDefault();
          onChange(next);
          document.getElementById(`${id}-${next}`)?.focus();
        }}>
          {names[l]}
          {missing.includes(l) ? <><span className="lang-tabs__dot" aria-hidden="true" /><span className="visually-hidden">{t('catalog.langMissing')}</span></> : null}
        </button>
      ))}
    </span>
  );
}

/** Three-language text input group. At least one language is required for required content.
 *  Default: compact rows (language tag beside the control). `tabbed`: one control with a he/ar/en
 *  tab strip in the legend, so a form with several localized fields fits on a phone screen. The
 *  control ids (`<id>-<lang>`) and accessible names (`<label> <language>`) are the same in both modes. */
export function LocalizedInput({ label, value, onChange, required, multiline, error, tabbed, lang, bare, onKeyDown }: { label: string; value: Localized; onChange: (v: Localized) => void; required?: boolean; multiline?: boolean; error?: string; tabbed?: boolean; /** Controlled: show only this language (the form has one `LangSwitch`). */ lang?: Loc; /** With `lang`: the control alone, labelled by `aria-label` (table-like rows). */ bare?: boolean; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement> }) {
  const t = useT();
  const id = useId();
  const { locale, dir } = useI18n();
  const [primary] = useState<Loc>(() => value[locale]?.trim() ? locale : LOCALES.find((l) => value[l]?.trim()) ?? locale);
  const [tab, setTab] = useState<Loc>(primary);
  const names = useLangNames();
  const errId = error ? `${id}-err` : undefined;
  const control = (l: Loc) => {
    const rowId = `${id}-${l}`;
    const common = { id: rowId, 'aria-label': `${label} ${names[l]}`, value: value[l] ?? '', lang: l, dir: l === 'en' ? 'ltr' as const : 'rtl' as const, 'aria-invalid': error ? true : undefined, onKeyDown };
    return multiline ? <textarea {...common} className="textarea localized__control" rows={2} onChange={(e) => onChange({ ...value, [l]: e.target.value })} /> : <input {...common} type="text" className="input localized__control" onChange={(e) => onChange({ ...value, [l]: e.target.value })} />;
  };
  const renderRow = (l: Loc) => <div key={l} className="localized__row"><label className="localized__lang" htmlFor={`${id}-${l}`}>{names[l]}</label>{control(l)}</div>;
  if (lang) {
    if (bare) return control(lang);
    return (
      <div className={`field localized localized--single ${error ? 'localized--invalid' : ''}`}>
        <label className="field__label" htmlFor={`${id}-${lang}`}>{label}{required ? null : <span className="field__optional">({t('common.optional')})</span>}</label>
        {control(lang)}
        {error ? <div id={errId} className="field__error" role="alert"><Icon name="alert" size={14} /> {error}</div> : null}
      </div>
    );
  }
  const legendTail = required ? <span className="badge badge--accent">{t('common.required')}</span> : <span className="field__optional">({t('common.optional')})</span>;
  if (tabbed) {
    const filled = LOCALES.filter((l) => value[l]?.trim());
    const missing = LOCALES.filter((l) => !value[l]?.trim());
    return (
      <fieldset className={`localized localized--tabbed ${error ? 'localized--invalid' : ''}`} aria-describedby={errId}>
        <legend className="field__label localized__legend">
          <span className="localized__legend-text">{label}{legendTail}</span>
          <span className="lang-tabs" role="tablist" aria-label={t('catalog.language')}>
            {LOCALES.map((l) => (
              <button key={l} type="button" role="tab" id={`${id}-${l}-tab`} aria-selected={tab === l} tabIndex={tab === l ? 0 : -1} aria-controls={`${id}-${l}-panel`} className="lang-tabs__tab" lang={l} onClick={() => setTab(l)} onKeyDown={(e) => {
                const index = LOCALES.indexOf(l);
                const delta = e.key === 'ArrowRight' ? (dir === 'rtl' ? -1 : 1) : e.key === 'ArrowLeft' ? (dir === 'rtl' ? 1 : -1) : 0;
                const next = e.key === 'Home' ? LOCALES[0] : e.key === 'End' ? LOCALES.at(-1) : delta ? LOCALES[(index + delta + LOCALES.length) % LOCALES.length] : undefined;
                if (!next) return;
                e.preventDefault();
                setTab(next);
                document.getElementById(`${id}-${next}-tab`)?.focus();
              }}>
                {names[l]}{value[l]?.trim() ? <Icon name="check" size={12} /> : null}
              </button>
            ))}
          </span>
        </legend>
        {LOCALES.map((l) => <div key={l} role="tabpanel" id={`${id}-${l}-panel`} aria-labelledby={`${id}-${l}-tab`} hidden={tab !== l} className="localized__panel">{control(l)}</div>)}
        {required ? <p className="field__hint">{filled.length && missing.length ? t('catalog.translationsMissing', { langs: missing.map((l) => names[l]).join(', ') }) : t('owner.oneLanguage')}</p> : null}
        {error ? <div id={errId} className="field__error" role="alert"><Icon name="alert" size={14} /> {error}</div> : null}
      </fieldset>
    );
  }
  return (
    <fieldset className={`localized ${error ? 'localized--invalid' : ''}`} aria-describedby={errId}>
      <legend className="field__label">{label}{legendTail}</legend>
      <div className="localized__rows">
        {renderRow(primary)}
        {/* Required content (names) is entered in all three languages by hand; only optional text collapses. */}
        {required ? LOCALES.filter((l) => l !== primary).map(renderRow) : <details><summary>{t('owner.translations')}</summary>{LOCALES.filter((l) => l !== primary).map(renderRow)}</details>}
        {required ? <p className="field__hint">{t('owner.oneLanguage')}</p> : null}
      </div>
      {error ? <div id={errId} className="field__error" role="alert"><Icon name="alert" size={14} /> {error}</div> : null}
    </fieldset>
  );
}
