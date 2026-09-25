import { useState, type ReactNode } from 'react';
import { Button, Dialog, IconButton } from '@/design/components';
import { Icon, type IconName } from '@/design/Icon';
import { useT } from '@/lib/i18n';

export interface SheetAction {
  label: string;
  icon?: IconName;
  /** Rotate the icon 180° (an "up" arrow from a "down" chevron). */
  flip?: boolean;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Toggle state, shown with a check mark. */
  pressed?: boolean;
  onSelect: () => void;
}

/** Overflow menu drawn as a bottom sheet: one icon button that opens a list of 56px rows. Every
 *  secondary action of a row lives here, so the row itself keeps one switch and one Edit control. */
export function ActionSheet({ title, actions, label, icon = 'more', className = '', labelled, variant = 'secondary' }: { title: string; actions: SheetAction[]; label?: string; icon?: IconName; className?: string; /** Render a labelled button ("+ Add") instead of a bare icon button. */ labelled?: boolean; variant?: 'secondary' | 'ghost' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const text = label ?? t('common.more');
  return (
    <>
      {labelled
        ? <Button variant={variant} icon={icon} className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{text}</Button>
        : <IconButton icon={icon} label={text} className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} />}
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <ul className="asheet">
          {actions.map((a, i) => (
            <li key={i}>
              <button type="button" className={`asheet__row ${a.danger ? 'asheet__row--danger' : ''}`} disabled={a.disabled} aria-pressed={a.pressed} onClick={() => { setOpen(false); a.onSelect(); }}>
                {a.icon ? <Icon name={a.icon} size={22} className={a.flip ? 'icon icon--flip' : 'icon'} /> : null}
                <span className="asheet__text">{a.label}{a.hint ? <span className="asheet__hint">{a.hint}</span> : null}</span>
                {a.pressed ? <Icon name="check" size={20} /> : null}
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

/** Availability toggle: `role=switch` in a 56×48 hit area; the knob mirrors in RTL via CSS. */
export function Switch({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className="cswitch" disabled={disabled} aria-busy={busy || undefined} onClick={() => onChange(!checked)}>
      <span className="cswitch__knob" aria-hidden="true" />
    </button>
  );
}

/** "Ledger" row: label at the inline start, the value or control at the inline end, on a 1px rule. */
export function LedgerRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="kvrow">
      <div className="kvrow__label">{label}{hint ? <div className="field__hint">{hint}</div> : null}</div>
      <div className="kvrow__value">{children}</div>
    </div>
  );
}

/** True when a save was refused because the branch already features the maximum of story items. */
export function storyIssue(e: unknown): boolean {
  const details = (e as { details?: { issues?: Array<{ message?: string }> } } | null)?.details;
  return details?.issues?.some((i) => i.message === 'too_many_story_items') ?? false;
}
