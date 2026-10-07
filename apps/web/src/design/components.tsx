import { createContext, forwardRef, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { useT } from '@/lib/i18n';

/* ---------- Button ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', block, size = 'md', icon, loading, className = '', children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} type={rest.type ?? 'button'} className={`btn btn--${variant} ${block ? 'btn--block' : ''} ${size === 'sm' ? 'btn--sm' : ''} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon, label, active, pressed, className = '', size = 20, ...rest }: { icon: IconName; label: string; active?: boolean; pressed?: boolean; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn--icon ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="spinner">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeDasharray="42 20" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

/* ---------- Fields ---------- */
interface FieldBase {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  id?: string;
}
export function Field({ label, hint, error, optional, id, children, required }: FieldBase & { children: (p: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; required?: boolean }) {
  const t = useT();
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fid}>
        {label}
        {optional && !required ? <span className="field__optional">({t('common.optional')})</span> : null}
      </label>
      {children({ id: fid, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {hint ? <div id={hintId} className="field__hint">{hint}</div> : null}
      {error ? (
        <div id={errId} className="field__error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </div>
      ) : null}
    </div>
  );
}

export function TextInput({ label, hint, error, optional, ltr, ...rest }: FieldBase & { ltr?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} id={rest.id} required={rest.required}>
      {({ id, describedBy, invalid }) => <input id={id} className={`input ${ltr ? 'input--ltr' : ''}`} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, optional, ...rest }: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} id={rest.id} required={rest.required}>
      {({ id, describedBy, invalid }) => <textarea id={id} className="textarea" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />}
    </Field>
  );
}

export function Select({ label, hint, error, optional, children, ...rest }: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} id={rest.id} required={rest.required}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="select" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, hint, ...rest }: { label: ReactNode; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>
        {label}
        {hint ? <div className="field__hint">{hint}</div> : null}
      </span>
    </label>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({ label, value, onChange, options, stacked }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: IconName }>; /** Icon above the label: fits three options at phone width. */ stacked?: boolean }) {
  return (
    <div className={`segmented ${stacked ? 'segmented--stacked' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="segmented__btn" onClick={() => onChange(o.value)}>
          {o.icon ? <Icon name={o.icon} size={18} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Badge ---------- */
export function Badge({ tone = 'neutral', children, icon }: { tone?: 'neutral' | 'muted' | 'accent' | 'success' | 'danger' | 'primary'; children: ReactNode; icon?: IconName }) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/* ---------- Alert ---------- */
export function Alert({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'danger' | 'success'; children: ReactNode; action?: ReactNode }) {
  const icon: IconName = tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : tone === 'success' ? 'check' : 'info';
  return (
    <div className={`alert alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={18} />
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

/* ---------- Dialog / Sheet (native <dialog> for focus trapping + restoration) ---------- */
/** `headerStart` renders before the title (e.g. a Back button, which then replaces Close when `hideClose`);
 *  `headerEnd` renders between the title and Close (e.g. a language switch). */
export interface DialogChrome { headerStart?: ReactNode; headerEnd?: ReactNode; hideClose?: boolean; className?: string }
type DialogProps = { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; sheet?: boolean; expanded?: boolean; closeLabel?: string } & DialogChrome;
/** Matches --duration-exit; 0 under reduced motion, where the CSS exit is 0ms too. */
function exitMs() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
}
function sameProps(a: object, b: object) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
const LeavingContext = createContext(false);
/** For a sheet mounted as `{item ? <Sheet item={item} /> : null}`: keeps the last item rendered while
 *  the Dialog inside plays its exit, so closing is not an instant cut. */
export function Presence<T>({ value, children }: { value: T | null; children: (value: T) => ReactNode }) {
  const [kept, setKept] = useState(value);
  if (value !== null && value !== kept) setKept(value);
  useEffect(() => {
    if (value !== null || kept === null) return;
    const id = window.setTimeout(() => setKept(null), exitMs());
    return () => window.clearTimeout(id);
  }, [value, kept]);
  const shown = value ?? kept;
  if (shown === null) return null;
  return <LeavingContext.Provider value={value === null}>{children(shown)}</LeavingContext.Provider>;
}
export function Dialog({ open: openProp, ...props }: DialogProps) {
  const leaving = useContext(LeavingContext);
  const open = openProp && !leaving;
  // Stay mounted for the exit animation, showing the last open render: callers often clear the
  // content with the flag (`open={!!item}` + `{item && …}`), which would collapse the sheet mid-exit.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const [last, setLast] = useState(props);
  if (open && !sameProps(last, props)) setLast(props);
  useEffect(() => {
    if (open || !shown) return;
    const id = window.setTimeout(() => setShown(false), exitMs());
    return () => window.clearTimeout(id);
  }, [open, shown]);
  if (!shown) return null;
  const { onClose, title, children, footer, sheet = true, expanded = false, closeLabel, ...chrome } = open ? props : last;
  return <DialogInner onClose={onClose} title={title} footer={footer} sheet={sheet} expanded={expanded} closeLabel={closeLabel} closing={!open} {...chrome}>{children}</DialogInner>;
}

/** Native <dialog> (focus trap + Escape) mounted only while open; focus is restored to the opener on unmount. */
function DialogInner({ onClose, title, children, footer, sheet, expanded, closeLabel, closing, headerStart, headerEnd, hideClose, className = '' }: { onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; sheet: boolean; expanded: boolean; closeLabel?: string; closing: boolean } & DialogChrome) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Callers pass inline `onClose` arrows, so it changes every render. Read it through a ref: with
  // `onClose` in the deps, every keystroke inside the dialog re-ran this effect (close → showModal),
  // which blurred the focused input after each character.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const onClick = (e: MouseEvent) => {
      // Padding inside a dialog is not its backdrop. Business forms must not disappear
      // when an imprecise tap lands outside a field.
      const bounds = d.getBoundingClientRect();
      const outside = e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom;
      if (e.target === d && outside && !d.closest('.business-app')) onCloseRef.current();
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('click', onClick);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('click', onClick);
      // A dialog opened while this one was leaving already holds focus; do not pull it back out.
      const active = document.activeElement;
      if (d.open) d.close();
      if (!active || active === document.body || d.contains(active)) opener?.focus?.();
    };
  }, []);
  // Swipe-to-dismiss (mobile bottom sheet): a downward touch drag from the header, or from the body
  // while it is scrolled to the top, follows the finger and closes past a distance/velocity threshold.
  useEffect(() => {
    const d = ref.current;
    if (!d || !sheet || d.closest('.business-app') || !window.matchMedia('(max-width: 639px)').matches) return;
    const body = d.querySelector<HTMLElement>('.dialog__body');
    let startY = 0, startT = 0, dy = 0, active = false, decided = false, fromBody = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest('.dialog__footer, .location-map')) return;
      fromBody = !!body && body.contains(target);
      if (fromBody && (body!.scrollTop > 0 || target.closest('textarea, input[type="range"]'))) return;
      startY = e.touches[0]!.clientY; startT = e.timeStamp; dy = 0; active = true; decided = false;
      d.classList.remove('is-settling');
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const y = e.touches[0]!.clientY - startY;
      if (!decided) {
        if (Math.abs(y) < 6) return;
        decided = true;
        if (y < 0) { active = false; return; } // upward: hand over to native scroll
      }
      dy = Math.max(0, y);
      e.preventDefault();
      d.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const v = dy / Math.max(1, e.timeStamp - startT);
      if (dy > 96 || (dy > 24 && v > 0.5)) {
        d.classList.add('is-settling');
        d.style.transform = 'translateY(100%)';
        window.setTimeout(() => onCloseRef.current(), 160);
        return;
      }
      d.classList.add('is-settling');
      d.style.transform = '';
    };
    d.addEventListener('touchstart', onStart, { passive: true });
    d.addEventListener('touchmove', onMove, { passive: false });
    d.addEventListener('touchend', onEnd);
    d.addEventListener('touchcancel', onEnd);
    return () => {
      d.removeEventListener('touchstart', onStart);
      d.removeEventListener('touchmove', onMove);
      d.removeEventListener('touchend', onEnd);
      d.removeEventListener('touchcancel', onEnd);
    };
  }, [sheet]);
  return (
    <dialog ref={ref} className={`dialog ${sheet ? 'dialog--sheet' : ''} ${sheet && expanded ? 'dialog--expanded' : ''} ${closing ? 'is-closing' : ''} ${className}`} aria-labelledby={titleId} aria-hidden={closing || undefined}>
      {sheet ? <div className="dialog__grabber" aria-hidden="true" /> : null}
      <div className="dialog__header">
        {headerStart}
        <h2 id={titleId}>{title}</h2>
        {headerEnd}
        {hideClose ? null : <IconButton icon="x" label={closeLabel ?? t('common.close')} onClick={onClose} />}
      </div>
      <div className="dialog__body">{children}</div>
      {footer ? <div className="dialog__footer">{footer}</div> : null}
    </dialog>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; loading?: boolean }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={() => { if (!loading) onClose(); }} title={title} sheet={false} footer={<><Button variant="secondary" disabled={loading} onClick={onClose}>{t('common.cancel')}</Button><Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      {body}
    </Dialog>
  );
}

/* ---------- Skeleton / Empty ---------- */
export function Skeleton({ height = 16, width = '100%', radius, style }: { height?: number | string; width?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" aria-hidden="true" style={{ height, width, borderRadius: radius, ...style }} />;
}

export function EmptyState({ icon = 'info', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={40} />
      {/* A heading never ends in a full stop, even when the message is a sentence ("The cart is empty."). */}
      <h2>{title.replace(/\.$/, '')}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

/* ---------- Toasts ---------- */
export interface ToastItem { id: number; text: string; tone?: 'default' | 'danger'; leaving?: boolean; action?: { label: string; onClick: () => void } }
let toastListeners: Array<(t: ToastItem) => void> = [];
let toastId = 0;
export function toast(text: string, tone: ToastItem['tone'] = 'default', action?: ToastItem['action']) {
  const item = { id: ++toastId, text, tone, action };
  for (const l of toastListeners) l(item);
}
export function ToastRegion() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, leaving: true } : x))), 4500 - exitMs());
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4500);
    };
    toastListeners.push(l);
    return () => {
      toastListeners = toastListeners.filter((x) => x !== l);
    };
  }, []);
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'danger' ? 'toast--danger' : ''} ${t.leaving ? 'is-leaving' : ''}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
          {t.text}
          {t.action ? <button type="button" className="toast__action" onClick={() => { t.action!.onClick(); setItems((prev) => prev.filter((x) => x.id !== t.id)); }}>{t.action.label}</button> : null}
        </div>
      ))}
    </div>
  );
}

/* ---------- Stepper ---------- */
export function Stepper({ value, min = 0, max = 999, step = 1, onChange, onRemove, decLabel, incLabel, removeLabel, format, size = 'md' }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; onRemove?: () => void; decLabel: string; incLabel: string; removeLabel?: string; format?: (v: number) => string; size?: 'sm' | 'md' }) {
  // Stepping below the minimum removes the line when the caller allows it, so the decrement button
  // turns into a trash can at the floor instead of going dead.
  const atFloor = value - step < min;
  const removes = atFloor && !!onRemove;
  return (
    <div className={`stepper stepper--${size}`}>
      <button type="button" className={removes ? 'stepper__remove' : undefined} aria-label={removes ? removeLabel ?? decLabel : decLabel} onClick={() => (removes ? onRemove!() : onChange(Math.max(min, value - step)))} disabled={atFloor && !onRemove}><Icon name={removes ? 'trash' : 'minus'} size={18} /></button>
      <output aria-live="polite" className="num">{format ? format(value) : value}</output>
      <button type="button" aria-label={incLabel} onClick={() => onChange(Math.min(max, value + step))} disabled={value + step > max}><Icon name="plus" size={18} /></button>
    </div>
  );
}

/**
 * A table that turns into one labelled card per row on phones (see `.table-wrap--stack`). Each cell is labelled with
 * its column header after every render, so callers keep writing a plain <table>.
 */
export function StackTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const table = ref.current?.querySelector('table');
    if (!table) return;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    table.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => td.setAttribute('data-label', heads[i] ?? '')));
  });
  return <div ref={ref} className="table-wrap table-wrap--stack">{children}</div>;
}
