import { makeId, type Localized, type ModifierOption } from '@qareeb/shared';
import { useT } from '@/lib/i18n';
import { Button, TextInput, Checkbox, IconButton } from '@/design/components';
import { LocalizedInput } from './CatalogPages';

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

export function agorotInput(v: number) { return (v / 100).toString(); }
export function parseAgorot(s: string) { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; }

export function ModifierGroupFields({ value: g, onChange, foot }: { value: GroupDraft; onChange: (g: GroupDraft) => void; foot?: React.ReactNode }) {
  const t = useT();
  const set = (patch: Partial<GroupDraft>) => onChange({ ...g, ...patch });
  const setOpt = (i: number, patch: Partial<ModifierOption>) => set({ options: g.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  return (
    <>
      <div className="edit-row edit-row--plain">
        <div className="edit-row__main">
          <LocalizedInput label={t('common.name')} value={g.name} required onChange={(name) => set({ name })} />
          <div className="form-row">
            <Checkbox label={t('catalog.groupRequired')} checked={g.required} onChange={(e) => set({ required: e.target.checked, minSelect: e.target.checked ? Math.max(1, g.minSelect) : g.minSelect })} />
            <TextInput label={t('catalog.minSelect')} type="number" ltr min={0} value={g.minSelect} onChange={(e) => set({ minSelect: Number(e.target.value) })} />
            <TextInput label={t('catalog.maxSelect')} type="number" ltr min={0} value={g.maxSelect} onChange={(e) => set({ maxSelect: Number(e.target.value) })} />
          </div>
          <Checkbox label={t('catalog.groupPlacement')} checked={!!g.placement} onChange={(e) => set({ placement: e.target.checked })} />
        </div>
        {foot ? <div className="edit-row__foot">{foot}</div> : null}
      </div>
      {g.options.map((o, oi) => (
        <div key={o.id ?? oi} className="soft-block stack--sm stack">
          <div className="edit-row edit-row--plain">
            <div className="edit-row__main">
              <LocalizedInput label={t('common.name')} value={o.name} required onChange={(name) => setOpt(oi, { name })} />
              <div className="form-row">
                <TextInput label={t('catalog.priceDelta')} type="number" ltr step="0.1" value={agorotInput(o.priceDeltaAgorot)} onChange={(e) => setOpt(oi, { priceDeltaAgorot: parseAgorot(e.target.value) })} />
                <Checkbox label={t('catalog.available')} checked={o.available} onChange={(e) => setOpt(oi, { available: e.target.checked })} />
              </div>
            </div>
            <div className="edit-row__foot"><IconButton icon="trash" label={t('common.remove')} disabled={g.options.length <= 1} onClick={() => set({ options: g.options.filter((_, k) => k !== oi) })} /></div>
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon="plus" onClick={() => set({ options: [...g.options, newOption(g.options.length)] })}>{t('catalog.addOption')}</Button>
    </>
  );
}
