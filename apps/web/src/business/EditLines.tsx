import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { IconButton } from '@/design/components';

export interface EditLine {
  key: string;
  name: ReactNode;
  price: ReactNode;
  available: ReactNode;
  removeLabel: string;
  /** Omitted: the row cannot be removed (e.g. a group's last option). */
  onRemove?: () => void;
}

/** One-line editable rows (sizes, options): name · ₪ price · availability · remove, under a single
 *  column header. Enter in a text field moves to the next row, or adds a row after the last one. */
export function EditLines({ rows, priceLabel, onAddLast }: { rows: EditLine[]; priceLabel: string; onAddLast: () => void }) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    list.current?.querySelector<HTMLInputElement>(':scope > li:last-child input')?.focus();
  }, [rows.length]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLLIElement>, i: number) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || (e.target as HTMLElement).tagName !== 'INPUT') return;
    e.preventDefault();
    if (i < rows.length - 1) list.current?.querySelectorAll<HTMLLIElement>(':scope > li')[i + 1]?.querySelector('input')?.focus();
    else { focusLast.current = true; onAddLast(); }
  };
  if (!rows.length) return null;
  return (
    <div className="pe-lines">
      <div className="pe-line pe-line--head" aria-hidden="true"><span>{t('common.name')}</span><span>{priceLabel}</span></div>
      <ul ref={list} className="pe-lines__list">
        {rows.map((r, i) => (
          <li key={r.key} className="pe-line" onKeyDown={(e) => onKeyDown(e, i)}>
            {r.name}
            {r.price}
            {r.available}
            {r.onRemove ? <IconButton icon="trash" label={r.removeLabel} onClick={r.onRemove} /> : <span />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function agorotInput(v: number) { return (v / 100).toString(); }
export function parseAgorot(s: string) { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; }

/** Shekel amount stored in agorot. */
export function MoneyInput({ label, agorot, onChange }: { label: string; agorot: number; onChange: (agorot: number) => void }) {
  return (
    <span className="pe-money">
      <input type="number" inputMode="decimal" step="0.1" className="input" aria-label={label} value={agorotInput(agorot)} onChange={(e) => onChange(parseAgorot(e.target.value))} />
      <span className="pe-money__sym" aria-hidden="true">₪</span>
    </span>
  );
}
