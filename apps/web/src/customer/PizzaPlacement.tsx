import { placementFromQuarters, placementLabel, placementQuarters, QUARTERS, type Quarter, type ToppingPlacement } from '@qareeb/shared';
import { useState } from 'react';
import { useT } from '@/lib/i18n';

// Quadrant wedges of a unit circle centred at (50,50), r=44. Screen left is the customer's left.
const WEDGE: Record<Quarter, string> = {
  tl: 'M50 50 L6 50 A44 44 0 0 1 50 6 Z',
  tr: 'M50 50 L50 6 A44 44 0 0 1 94 50 Z',
  br: 'M50 50 L94 50 A44 44 0 0 1 50 94 Z',
  bl: 'M50 50 L50 94 A44 44 0 0 1 6 50 Z',
};
const DOTS: Record<Quarter, [number, number][]> = {
  tl: [[30, 30], [22, 44], [40, 20]],
  tr: [[70, 30], [78, 44], [60, 20]],
  br: [[70, 70], [78, 56], [60, 80]],
  bl: [[30, 70], [22, 56], [40, 80]],
};

/** Pizza drawing with the chosen quarters filled. Read-only unless onToggle is given. `quarters` overrides `placement` (lets the picker draw an empty pizza). */
export function PizzaIcon({ placement, quarters, size = 24, onToggle, label }: { placement: ToppingPlacement | undefined; quarters?: Iterable<Quarter>; size?: number; onToggle?: (q: Quarter) => void; label?: string }) {
  const on = new Set(quarters ?? placementQuarters(placement));
  return (
    <svg className={`pizza ${onToggle ? 'pizza--interactive' : ''}`} viewBox="0 0 100 100" width={size} height={size} role={onToggle ? 'group' : 'img'} aria-label={label}>
      <circle cx="50" cy="50" r="47" className="pizza__crust" />
      {QUARTERS.map((q) => (
        <g key={q} className={`pizza__q ${on.has(q) ? 'is-on' : ''}`} onClick={onToggle ? () => onToggle(q) : undefined} role={onToggle ? 'checkbox' : undefined} aria-checked={onToggle ? on.has(q) : undefined} tabIndex={onToggle ? 0 : undefined} onKeyDown={onToggle ? (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(q); } } : undefined}>
          <path d={WEDGE[q]} className="pizza__wedge" />
          {on.has(q) ? DOTS[q].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" className="pizza__dot" />) : null}
        </g>
      ))}
      <line x1="50" y1="6" x2="50" y2="94" className="pizza__cut" />
      <line x1="6" y1="50" x2="94" y2="50" className="pizza__cut" />
    </svg>
  );
}

/** One control: the pizza starts empty and asks "where?". Tap quarters, or "whole" to fill it. Empty or all four = whole; two adjacent quarters read as a half. */
export function PlacementPicker({ value, onChange }: { value: ToppingPlacement | undefined; onChange: (p: ToppingPlacement) => void }) {
  const t = useT();
  const [picked, setPicked] = useState<Quarter[]>(() => (!value ? [] : value === 'whole' ? [...QUARTERS] : placementQuarters(value)));
  const apply = (qs: Quarter[]) => {
    setPicked(qs);
    onChange(qs.length === 0 ? 'whole' : placementFromQuarters(qs));
  };
  const toggle = (q: Quarter) => apply(picked.includes(q) ? picked.filter((x) => x !== q) : [...picked, q]);
  const empty = picked.length === 0;
  const full = picked.length === 4;
  const label = empty ? t('product.placementAsk') : full ? t('product.placementWhole') : placementLabel(placementFromQuarters(picked), t);
  const hint = empty ? t('product.placementHintEmpty') : full ? t('product.placementHintFull') : t('product.placementHint');
  return (
    <div className="placement">
      <PizzaIcon placement={value} quarters={picked} size={64} onToggle={toggle} label={t('product.placement')} />
      <div className="placement__text">
        <div className="placement__value">{label}</div>
        <div className="placement__hint">{hint}</div>
      </div>
      {empty
        ? <button type="button" className="placement__whole" onClick={() => apply([...QUARTERS])}>{t('product.placementWhole')}</button>
        : <button type="button" className="placement__reset" onClick={() => apply([])}>{t('product.placementClear')}</button>}
    </div>
  );
}
