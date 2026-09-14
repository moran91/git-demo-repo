import { PLACEMENT_PRESETS, placementFromQuarters, placementLabel, placementQuarters, QUARTERS, type Quarter, type ToppingPlacement } from '@qareeb/shared';
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

/** Pizza drawing with the chosen quarters filled. Read-only unless onToggle is given. */
export function PizzaIcon({ placement, size = 24, onToggle, label }: { placement: ToppingPlacement | undefined; size?: number; onToggle?: (q: Quarter) => void; label?: string }) {
  const on = new Set(placementQuarters(placement));
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

/** Tap quarters on the big pizza, or pick a preset (whole / halves). Quarter is the minimum resolution. */
export function PlacementPicker({ value, onChange }: { value: ToppingPlacement | undefined; onChange: (p: ToppingPlacement) => void }) {
  const t = useT();
  const current = value ?? 'whole';
  const toggle = (q: Quarter) => {
    const set = new Set(placementQuarters(current));
    if (current === 'whole') { set.clear(); set.add(q); } // from "whole", a tap means "only this quarter"
    else if (set.has(q)) set.delete(q);
    else set.add(q);
    onChange(set.size === 0 ? 'whole' : placementFromQuarters(set));
  };
  const presets = Object.values(PLACEMENT_PRESETS);
  return (
    <div className="placement">
      <PizzaIcon placement={current} size={88} onToggle={toggle} label={t('product.placementHint')} />
      <div className="placement__side">
        <div className="placement__presets" role="radiogroup" aria-label={t('product.placement')}>
          {presets.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={current === p} aria-label={placementLabel(p, t) || t('product.placementWhole')} className={`placement__preset ${current === p ? 'is-active' : ''}`} onClick={() => onChange(p)}>
              <PizzaIcon placement={p} size={30} />
            </button>
          ))}
        </div>
        <div className="placement__label">{placementLabel(current, t) || t('product.placementWhole')}</div>
      </div>
    </div>
  );
}
