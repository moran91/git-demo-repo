import { useId } from 'react';
import { LOCALES, type Localized } from '@qareeb/shared';
import { useT } from '@/lib/i18n';
import { Icon } from '@/design/Icon';

/** Three-language text input group. At least one language is required for required content.
 *  Rendered as compact rows (language tag beside the control) instead of three full labelled
 *  fields, so a title + body pair fits on one phone screen. */
export function LocalizedInput({ label, value, onChange, required, multiline, error }: { label: string; value: Localized; onChange: (v: Localized) => void; required?: boolean; multiline?: boolean; error?: string }) {
  const t = useT();
  const id = useId();
  // `catalog.nameHe` reads "שם (עברית)"; keep only the language name.
  const lang = (k: 'catalog.nameHe' | 'catalog.nameAr' | 'catalog.nameEn') => t(k).replace(/^[^(]*\(?/, '').replace(/\)\s*$/, '');
  const names: Record<(typeof LOCALES)[number], string> = { he: lang('catalog.nameHe'), ar: lang('catalog.nameAr'), en: lang('catalog.nameEn') };
  const errId = error ? `${id}-err` : undefined;
  return (
    <fieldset className={`localized ${error ? 'localized--invalid' : ''}`} aria-describedby={errId}>
      <legend className="field__label">{label}{required ? <span className="badge badge--accent">{t('common.required')}</span> : <span className="field__optional">({t('common.optional')})</span>}</legend>
      <div className="localized__rows">
        {LOCALES.map((l) => {
          const rowId = `${id}-${l}`;
          const common = { id: rowId, 'aria-label': `${label} ${names[l]}`, value: value[l] ?? '', lang: l, dir: l === 'en' ? 'ltr' as const : 'rtl' as const, 'aria-invalid': error ? true : undefined };
          return (
            <div key={l} className="localized__row">
              <label className="localized__lang" htmlFor={rowId}>{names[l]}</label>
              {multiline
                ? <textarea {...common} className="textarea localized__control" rows={2} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
                : <input {...common} type="text" className="input localized__control" onChange={(e) => onChange({ ...value, [l]: e.target.value })} />}
            </div>
          );
        })}
      </div>
      {error ? <div id={errId} className="field__error" role="alert"><Icon name="alert" size={14} /> {error}</div> : null}
    </fieldset>
  );
}
