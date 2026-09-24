import { makeId, type Localized, type ModifierOption } from '@qareeb/shared';
import { useT } from '@/lib/i18n';
import { Button, Stepper } from '@/design/components';
import { LocalizedInput, type Loc } from './LocalizedInput';
import { LedgerRow, Switch } from './CatalogControls';
import { EditLines, MoneyInput } from './EditLines';

/** The editable content of an option group, shared by the product editor and the extras library. */
export interface GroupDraft {
  name: Localized;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
  placement?: boolean;
}

export function newOption(sortOrder: number): ModifierOption {
  return { id: makeId(8), name: {}, priceDeltaAgorot: 0, available: true, sortOrder };
}
export function newGroupDraft(): GroupDraft {
  return { name: {}, required: false, minSelect: 0, maxSelect: 0, options: [newOption(0)] };
}

export { agorotInput, parseAgorot } from './EditLines';

const SELECT_MAX = 30; // schemas.ts caps minSelect/maxSelect at 30

/** "Required" is not a separate control: a group is required exactly when the customer must pick at
 *  least one. Legacy groups stored `required` with minSelect 0, which meant the same as a minimum of 1. */
export function effectiveMin(g: Pick<GroupDraft, 'required' | 'minSelect'>) { return g.required ? Math.max(1, g.minSelect) : g.minSelect; }

export function ModifierGroupFields({ value: g, onChange, lang }: { value: GroupDraft; onChange: (g: GroupDraft) => void; lang: Loc }) {
  const t = useT();
  const set = (patch: Partial<GroupDraft>) => onChange({ ...g, ...patch });
  const min = effectiveMin(g);
  const setMin = (v: number) => set({ minSelect: v, required: v >= 1, maxSelect: g.maxSelect && g.maxSelect < v ? v : g.maxSelect });
  // Max 0 means "no limit"; stepping a limit below the minimum pulls the minimum down with it.
  const setMax = (v: number) => set({ maxSelect: v, ...(v > 0 && v < min ? { minSelect: v, required: v >= 1 } : {}) });
  const setOpt = (i: number, patch: Partial<ModifierOption>) => set({ options: g.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const optName = (o: ModifierOption) => o.name[lang] || t('catalog.option');
  return (
    <>
      <div className="pe-sec pe-sec--first">
        <LocalizedInput lang={lang} label={t('common.name')} value={g.name} required onChange={(name) => set({ name })} />
        <div className="pe-rule">
          <div className="field"><span className="field__label">{t('catalog.atLeast')}</span><Stepper value={min} max={SELECT_MAX} onChange={setMin} decLabel={`${t('catalog.atLeast')}: ${t('common.decrease')}`} incLabel={`${t('catalog.atLeast')}: ${t('common.increase')}`} /></div>
          <div className="field"><span className="field__label">{t('catalog.upToLabel')}</span><Stepper value={g.maxSelect} max={SELECT_MAX} onChange={setMax} format={(v) => (v === 0 ? '∞' : String(v))} decLabel={`${t('catalog.upToLabel')}: ${t('common.decrease')}`} incLabel={`${t('catalog.upToLabel')}: ${t('common.increase')}`} /></div>
        </div>
        <div className="kvrow-list">
          <LedgerRow label={t('catalog.groupPlacement')}><Switch checked={!!g.placement} label={t('catalog.groupPlacement')} onChange={(placement) => set({ placement })} /></LedgerRow>
        </div>
      </div>
      <div className="pe-sec">
        <div className="pe-sec__head">
          <h3>{t('catalog.options')}</h3>
          <Button variant="ghost" icon="plus" onClick={() => set({ options: [...g.options, newOption(g.options.length)] })}>{t('common.add')}</Button>
        </div>
        <EditLines
          priceLabel={t('catalog.priceDelta')}
          rows={g.options.map((o, oi) => ({
            key: o.id ?? String(oi),
            name: <LocalizedInput lang={lang} bare label={t('catalog.option')} value={o.name} required onChange={(name) => setOpt(oi, { name })} />,
            price: <MoneyInput label={`${t('catalog.priceDelta')}: ${optName(o)}`} agorot={o.priceDeltaAgorot} onChange={(priceDeltaAgorot) => setOpt(oi, { priceDeltaAgorot })} />,
            available: <Switch checked={o.available} label={`${t('catalog.available')}: ${optName(o)}`} onChange={(available) => setOpt(oi, { available })} />,
            removeLabel: `${t('common.remove')}: ${optName(o)}`,
            onRemove: g.options.length > 1 ? () => set({ options: g.options.filter((_, k) => k !== oi) }) : undefined,
          }))}
          onAddLast={() => set({ options: [...g.options, newOption(g.options.length)] })}
        />
      </div>
    </>
  );
}
