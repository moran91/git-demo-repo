import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { hasAnyTranslation, type Product, type SharedModifierGroup } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, orderBy, limit } from '@/lib/queries';
import { Button, Dialog, Badge, Alert, EmptyState, IconButton, toast } from '@/design/components';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { PageTitle, useDash } from './shell';
import { LoadError, useDraftSafety } from './BusinessExperience';
import { ModifierGroupFields, newGroupDraft, type GroupDraft } from './ModifierGroupFields';

export function ExtrasLibraryPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const groups = useCollection<SharedModifierGroup>(`${base}/modifierGroups`, [orderBy('sortOrder'), limit(200)], [branch.id]);
  const prods = useCollection<Product>(`${base}/products`, [orderBy('sortOrder'), limit(1000)], [branch.id]);
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<{ id?: string; draft: GroupDraft } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of prods.data) if (!p.archived) for (const g of p.modifierGroups) if (g.sharedGroupId) m.set(g.sharedGroupId, (m.get(g.sharedGroupId) ?? 0) + 1);
    return m;
  }, [prods.data]);
  // Deep link from the product editor: /catalog/extras?edit=<groupId>
  const wanted = params.get('edit');
  const wantedGroup = wanted ? groups.data.find((g) => g.id === wanted) : undefined;
  useEffect(() => {
    if (!wantedGroup) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: open the editor for a deep link, then drop the query
    setEdit({ id: wantedGroup.id, draft: draftOf(wantedGroup) });
    setParams({}, { replace: true });
  }, [wantedGroup, setParams]);
  if (!can('catalog')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  if (groups.error || prods.error) return <LoadError />;
  const visible = groups.data.filter((g) => showArchived || !g.archived);
  return (
    <div className="stack">
      <PageTitle title={t('catalog.library')}>
        <Link className="btn btn--secondary btn--sm" to="../catalog">{t('dash.catalog')}</Link>
        <Button size="sm" variant="secondary" onClick={() => setShowArchived((v) => !v)}>{showArchived ? t('catalog.archived') + ' ✓' : t('catalog.archived')}</Button>
        <Button size="sm" icon="plus" onClick={() => setEdit({ draft: newGroupDraft() })}>{t('catalog.newSharedGroup')}</Button>
      </PageTitle>
      <p className="muted">{t('catalog.libraryHint')}</p>
      {visible.length === 0 && !groups.loading ? <EmptyState icon="tag" title={t('catalog.libraryEmpty')} /> : null}
      <ul className="list">
        {visible.map((g) => (
          <li key={g.id} className="list__item">
            <div className="list__grow">
              <div className="row" style={{ gap: 6 }}><strong>{L(g.name, business.defaultLocale)}</strong>{g.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}{g.placement ? <Badge tone="neutral">{t('catalog.groupPlacement')}</Badge> : null}</div>
              <div className="muted">{g.options.map((o) => `${L(o.name, business.defaultLocale)}${o.priceDeltaAgorot ? ` (${money(o.priceDeltaAgorot, locale)})` : ''}`).join(' · ')}</div>
              <div className="muted">{t('catalog.linkedProducts', { count: usage.get(g.id) ?? 0 })}</div>
            </div>
            <div className="actions actions--icons">
              <IconButton icon="edit" label={t('catalog.editSharedGroup')} onClick={() => setEdit({ id: g.id, draft: draftOf(g) })} />
              <Button size="sm" variant="ghost" onClick={() => call('setSharedModifierGroupArchived', { businessId: business.id, branchId: branch.id, groupId: g.id, archived: !g.archived }).catch((e) => toast(e?.details?.issues?.[0]?.message === 'shared_group_in_use' ? t('catalog.sharedGroupInUse') : t(errorKey(e)), 'danger'))}>{g.archived ? t('catalog.unarchive') : t('catalog.archive')}</Button>
            </div>
          </li>
        ))}
      </ul>
      {edit ? <SharedGroupDialog id={edit.id} initial={edit.draft} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function draftOf(g: SharedModifierGroup): GroupDraft {
  return { name: g.name, required: g.required, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options, placement: g.placement };
}

export function SharedGroupDialog({ id, initial, onClose, onSaved }: { id?: string; initial: GroupDraft; onClose: () => void; onSaved?: (g: SharedModifierGroup) => void }) {
  const t = useT();
  const { business, branch } = useDash();
  const [d, setD] = useState<GroupDraft>(initial);
  const safety = useDraftSafety(d);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (!hasAnyTranslation(d.name) || d.options.some((o) => !hasAnyTranslation(o.name))) return setError(t('validation.atLeastOneLanguage'));
    setBusy(true);
    try {
      const r = await call<{ group: SharedModifierGroup; linkedProducts: number }>('saveSharedModifierGroup', { businessId: business.id, branchId: branch.id, groupId: id, group: d });
      toast(id ? t('catalog.sharedGroupUpdated', { count: r.linkedProducts }) : t('catalog.savedOk'));
      safety.markSaved();
      onSaved?.(r.group);
      onClose();
    } catch (e) {
      setError(t('catalog.saveFailed') + ' ' + t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={() => { if (!busy && safety.confirmDiscard()) onClose(); }} title={id ? t('catalog.editSharedGroup') : t('catalog.newSharedGroup')} footer={<><Button variant="secondary" disabled={busy} onClick={() => { if (safety.confirmDiscard()) onClose(); }}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button></>}>
      <div className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="card stack--sm stack"><ModifierGroupFields value={d} onChange={setD} /></div>
      </div>
    </Dialog>
  );
}
