import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
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
export function Segmented<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: IconName }> }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
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
export function Dialog({ open, onClose, title, children, footer, sheet = true, closeLabel }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; sheet?: boolean; closeLabel?: string }) {
  if (!open) return null;
  return <DialogInner onClose={onClose} title={title} footer={footer} sheet={sheet} closeLabel={closeLabel}>{children}</DialogInner>;
}

/** Native <dialog> (focus trap + Escape) mounted only while open; focus is restored to the opener on unmount. */
function DialogInner({ onClose, title, children, footer, sheet, closeLabel }: { onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; sheet: boolean; closeLabel?: string }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (e.target === d) onClose();
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('click', onClick);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('click', onClick);
      if (d.open) d.close();
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <dialog ref={ref} className={`dialog ${sheet ? 'dialog--sheet' : ''}`} aria-labelledby={titleId}>
      <div className="dialog__header">
        <h2 id={titleId}>{title}</h2>
        <IconButton icon="x" label={closeLabel ?? t('common.close')} onClick={onClose} />
      </div>
      <div className="dialog__body">{children}</div>
      {footer ? <div className="dialog__footer">{footer}</div> : null}
    </dialog>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel, danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; loading?: boolean }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={title} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
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
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

/* ---------- Toasts ---------- */
export interface ToastItem { id: number; text: string; tone?: 'default' | 'danger' }
let toastListeners: Array<(t: ToastItem) => void> = [];
let toastId = 0;
export function toast(text: string, tone: ToastItem['tone'] = 'default') {
  const item = { id: ++toastId, text, tone };
  for (const l of toastListeners) l(item);
}
export function ToastRegion() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
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
        <div key={t.id} className={`toast ${t.tone === 'danger' ? 'toast--danger' : ''}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- Stepper ---------- */
export function Stepper({ value, min = 0, max = 999, step = 1, onChange, decLabel, incLabel, format }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; decLabel: string; incLabel: string; format?: (v: number) => string }) {
  return (
    <div className="stepper">
      <button type="button" aria-label={decLabel} onClick={() => onChange(Math.max(min, value - step))} disabled={value - step < min}><Icon name="minus" size={18} /></button>
      <output aria-live="polite" className="num">{format ? format(value) : value}</output>
      <button type="button" aria-label={incLabel} onClick={() => onChange(Math.min(max, value + step))} disabled={value + step > max}><Icon name="plus" size={18} /></button>
    </div>
  );
}
