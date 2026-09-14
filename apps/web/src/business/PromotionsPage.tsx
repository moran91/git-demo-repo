import { useState } from 'react';
import { MAX_PROMOTIONS, hasAnyTranslation, type Localized, type Promotion } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, IconButton, TextInput, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useDash } from './shell';
import { LocalizedInput } from './LocalizedInput';
import { formatDay, promotionExpired } from '@/lib/promotions';

interface Draft { title: Localized; body: Localized; endsAt: string; active: boolean }
const emptyDraft = (): Draft => ({ title: {}, body: {}, endsAt: '', active: true });
const draftOf = (p: Promotion): Draft => ({ title: p.title, body: p.body, endsAt: p.endsAt ?? '', active: p.active });

export function PromotionsSection() {
  const t = useT();
  const { L } = useI18n();
  const { business, can } = useDash();
  const [edit, setEdit] = useState<{ id?: string; draft: Draft } | null>(null);
  const [remove, setRemove] = useState<Promotion | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can('settings')) return null;
  const list = [...(business.promotions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const full = list.length >= MAX_PROMOTIONS;

  const save = async () => {
    if (!edit) return;
    if (!hasAnyTranslation(edit.draft.title)) return toast(t('validation.atLeastOneLanguage'), 'danger');
    setBusy(true);
    try {
      const promotion = { title: edit.draft.title, body: edit.draft.body, active: edit.draft.active, ...(edit.draft.endsAt ? { endsAt: edit.draft.endsAt } : {}) };
      await call('savePromotion', { businessId: business.id, promotionId: edit.id, promotion });
      toast(t('catalog.savedOk'));
      setEdit(null);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const confirmRemove = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      await call('removePromotion', { businessId: business.id, promotionId: remove.id });
      toast(t('catalog.savedOk'));
      setRemove(null);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" aria-labelledby="promotions-h">
      <div className="row row--between">
        <h2 id="promotions-h">{t('promotions.title')}</h2>
        <Button size="sm" icon="plus" disabled={full} onClick={() => setEdit({ draft: emptyDraft() })}>{t('promotions.new')}</Button>
      </div>
      <Alert tone="info">{t('promotions.help', { max: MAX_PROMOTIONS })}</Alert>
      {full ? <Alert tone="warn">{t('promotions.limit', { max: MAX_PROMOTIONS })}</Alert> : null}
      {list.length === 0 ? (
        <EmptyState icon="tag" title={t('promotions.empty')} body={t('promotions.emptyBody')} action={<Button icon="plus" onClick={() => setEdit({ draft: emptyDraft() })}>{t('promotions.new')}</Button>} />
      ) : (
        <section className="card stack--sm stack">
          <h2>{t('promotions.list')}</h2>
          <ul className="list">
            {list.map((p) => {
              const expired = promotionExpired(p);
              const shown = p.active && !expired;
              return (
                <li key={p.id} className="list__item" style={shown ? undefined : { opacity: 0.7 }}>
                  <span className={`promo-icon ${shown ? '' : 'promo-icon--off'}`}><Icon name="tag" size={18} /></span>
                  <div className="list__grow">
                    <div className="row" style={{ gap: 6 }}>
                      <strong className="wrap-anywhere">{L(p.title, business.defaultLocale)}</strong>
                      {expired ? <Badge tone="muted">{t('promotions.expired')}</Badge> : p.active ? <Badge tone="success">{t('promotions.shown')}</Badge> : <Badge tone="muted">{t('promotions.hidden')}</Badge>}
                    </div>
                    <div className="muted wrap-anywhere">
                      {L(p.body, business.defaultLocale)}
                      {p.endsAt ? <>{L(p.body, business.defaultLocale) ? ' · ' : ''}<bdi>{t('promotions.until', { date: formatDay(p.endsAt) })}</bdi></> : null}
                    </div>
                  </div>
                  <div className="actions actions--icons">
                    <IconButton icon="edit" label={t('promotions.edit')} onClick={() => setEdit({ id: p.id, draft: draftOf(p) })} />
                    <IconButton icon="trash" label={t('common.remove')} onClick={() => setRemove(p)} style={{ color: 'var(--color-danger)' }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('promotions.edit') : t('promotions.new')} closeLabel={t('common.close')} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{t('common.save')}</Button></>}>
        {edit ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <LocalizedInput label={t('promotions.promoTitle')} value={edit.draft.title} required onChange={(title) => setEdit({ ...edit, draft: { ...edit.draft, title } })} />
            <LocalizedInput label={t('promotions.body')} value={edit.draft.body} multiline onChange={(body) => setEdit({ ...edit, draft: { ...edit.draft, body } })} />
            <div className="form-row form-cols--tight">
              <TextInput label={t('promotions.endsAt')} optional type="date" value={edit.draft.endsAt} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, endsAt: e.target.value } })} />
              <Checkbox label={t('promotions.active')} checked={edit.draft.active} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, active: e.target.checked } })} />
            </div>
          </form>
        ) : null}
      </Dialog>
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} onConfirm={confirmRemove} title={t('promotions.removeConfirm')} body={remove ? L(remove.title, business.defaultLocale) : undefined} confirmLabel={t('common.remove')} danger loading={busy} />
    </section>
  );
}
