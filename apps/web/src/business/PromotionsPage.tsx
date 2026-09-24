import { useState } from 'react';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { MAX_PROMOTIONS, MAX_PROMO_PRODUCTS, hasAnyTranslation, makeId, toLocal, type Category, type Localized, type Product, type Promotion } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import type { QueryState } from '@/lib/queries';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, IconButton, TextInput, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { call } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload } from '@/lib/images';
import { useDash } from './shell';
import { LoadError, useDraftSafety } from './BusinessExperience';
import { LocalizedInput } from './LocalizedInput';
import { ItemPickerDialog } from './ItemPicker';
import { formatDay, promotionExpired } from '@/lib/promotions';
import { StorageImage } from '@/customer/StorageImage';
import { DealSlide, PromoSlide } from '@/customer/DealSlide';
import './settings.css';

interface Draft { title: Localized; body: Localized; productIds: string[]; endsAt: string; active: boolean }
const emptyDraft = (): Draft => ({ title: {}, body: {}, productIds: [], endsAt: '', active: true });
const draftOf = (p: Promotion): Draft => ({ title: p.title, body: p.body, productIds: p.productIds ?? [], endsAt: p.endsAt ?? '', active: p.active });

/** Limited-time promotions of the current branch: a headline, featured items and an optional banner, always with an end date. */
export function PromotionsSection({ products, categories, promotions }: { products: Product[]; categories: Category[]; promotions: QueryState<Promotion> }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, can } = useDash();
  const [edit, setEdit] = useState<{ id?: string; draft: Draft; imagePath?: string } | null>(null);
  const [remove, setRemove] = useState<Promotion | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can('catalog')) return null;
  if (promotions.error) return <LoadError />;
  const list = promotions.data;
  const full = list.length >= MAX_PROMOTIONS;

  const confirmRemove = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      await call('removePromotion', { businessId: business.id, branchId: branch.id, promotionId: remove.id });
      toast(t('catalog.savedOk'));
      setRemove(null);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const shownCount = list.filter((p) => p.active && !promotionExpired(p)).length;
  const openNew = () => setEdit({ draft: emptyDraft() });
  const today = toLocal(new Date()).date;
  const daysLeft = (endsAt: string) => Math.round((Date.parse(endsAt) - Date.parse(today)) / 86400000);
  return (
    <>
      <div className="sx-section__head">
        <div><h2 id="promotions-h">{t('promotions.title')}</h2>{list.length > 0 ? <p className="sx-card__sub">{t('promotions.summary', { shown: shownCount, max: MAX_PROMOTIONS })}</p> : null}</div>
        <Button variant="secondary" icon="plus" disabled={full} onClick={openNew}>{t('promotions.new')}</Button>
      </div>
      {full ? <Alert tone="warn">{t('promotions.limit', { max: MAX_PROMOTIONS })}</Alert> : null}
      {list.length === 0 && !promotions.loading ? (
        <div className="sx-card">
          <div className="pitch">
            <div className="pitch__copy">
              <h3 className="pitch__title">{t('promotions.emptyTitle')}</h3>
              <ul className="pitch__list">
                {(['promotions.emptyPoint1', 'promotions.emptyPoint2', 'promotions.emptyPoint3'] as const).map((k) => <li key={k} className="pitch__item"><Icon name="check" size={16} />{t(k)}</li>)}
              </ul>
              <div><Button icon="plus" onClick={openNew}>{t('promotions.firstCta')}</Button></div>
            </div>
            <div className="pitch__preview" aria-hidden="true">
              <span className="pitch__label">{t('deals.exampleLabel')}</span>
              <DealSlide tone="promo" kind={<><Icon name="clock" size={13} />{t('promotions.limited')}</>} name={t('promotions.mockTitle')} sub={t('promotions.mockBody')} pill={t('promotions.mockUntil')} paths={[]} />
            </div>
          </div>
        </div>
      ) : list.length > 0 ? (
        <div className="sx-grid">
          {list.map((p) => {
            const expired = promotionExpired(p);
            const shown = p.active && !expired;
            const names = (p.productIds ?? []).map((id) => products.find((x) => x.id === id)).filter(Boolean).map((x) => L(x!.name, business.defaultLocale));
            const left = p.endsAt ? daysLeft(p.endsAt) : 0;
            const title = L(p.title, business.defaultLocale);
            return (
              <article key={p.id} className={`sx-deal ${shown ? '' : 'sx-deal--off'}`} aria-label={title}>
                <div className={`sx-deal__ends ${expired ? 'sx-deal__ends--muted' : left <= 1 ? 'sx-deal__ends--danger' : ''}`}>
                  <Icon name="clock" size={16} />
                  <bdi>{!p.endsAt ? t('promotions.endsAtRequired') : expired ? t('promotions.ended', { date: formatDay(p.endsAt) }) : left <= 0 ? t('promotions.endsToday') : t('promotions.endsIn', { date: formatDay(p.endsAt), days: left })}</bdi>
                </div>
                <div className="sx-deal__top">
                  {p.imagePath ? <span className="sx-deal__thumb"><StorageImage path={p.imagePath} alt="" size="thumb" square fallbackLabel={t('discovery.imageFallback')} /></span> : null}
                  <div className="sx-deal__text">
                    <div className="sx-deal__name"><strong className="wrap-anywhere">{title}</strong>{expired ? <Badge tone="muted">{t('promotions.expired')}</Badge> : p.active ? <Badge tone="success" icon="eye">{t('promotions.shown')}</Badge> : <Badge tone="muted">{t('promotions.hidden')}</Badge>}</div>
                    <p className="sx-deal__items">{names.length ? `${names.join(', ')} · ${(names.length === 1 ? t('promotions.itemsCount.one') : t('promotions.itemsCount', { n: names.length }))}` : L(p.body, business.defaultLocale)}</p>
                  </div>
                </div>
                <div className="sx-deal__actions">
                  <Button variant="secondary" icon="edit" onClick={() => setEdit({ id: p.id, draft: draftOf(p), imagePath: p.imagePath })}>{t('promotions.edit')}</Button>
                  <IconButton icon="trash" label={`${t('common.remove')}: ${title}`} onClick={() => setRemove(p)} style={{ color: 'var(--color-danger)' }} />
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {edit ? <PromotionEditor initial={edit} products={products} categories={categories} onClose={() => setEdit(null)} /> : null}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} onConfirm={confirmRemove} title={t('promotions.removeConfirm')} body={remove ? L(remove.title, business.defaultLocale) : undefined} confirmLabel={t('common.remove')} danger loading={busy} />
    </>
  );
}

function PromotionEditor({ initial, products, categories, onClose }: { initial: { id?: string; draft: Draft; imagePath?: string }; products: Product[]; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const [d, setD] = useState<Draft>(initial.draft);
  const safety = useDraftSafety(d);
  const [promotionId, setPromotionId] = useState(initial.id);
  const [imagePath, setImagePath] = useState(initial.imagePath);
  const [mode, setMode] = useState<'edit' | 'pick'>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));
  const today = toLocal(new Date()).date;
  const eligible = products.filter((p) => p.available);
  const featured = d.productIds.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p);
  const toggleProduct = (p: Product) => {
    // The server caps productIds at 10 (promotionInputSchema); say so instead of ignoring the tap.
    if (!d.productIds.includes(p.id) && d.productIds.length >= MAX_PROMO_PRODUCTS) { toast(t('catalog.maxItemsReached', { max: MAX_PROMO_PRODUCTS }), 'danger'); return; }
    set({ productIds: d.productIds.includes(p.id) ? d.productIds.filter((id) => id !== p.id) : [...d.productIds, p.id] });
  };

  const save = async (keepBusy = false): Promise<string | null> => {
    setError(null);
    setDateError(null);
    if (!hasAnyTranslation(d.title)) { setError(t('validation.atLeastOneLanguage')); return null; }
    if (!d.endsAt) { setDateError(t('promotions.endsAtRequired')); return null; }
    if (d.endsAt < today) { setDateError(t('promotions.endsAtPast')); return null; }
    setBusy(true);
    try {
      const r = await call<{ promotion: Promotion }>('savePromotion', { businessId: business.id, branchId: branch.id, promotionId, promotion: d });
      setPromotionId(r.promotion.id);
      toast(t('catalog.savedOk'));
      safety.markSaved();
      return r.promotion.id;
    } catch (e) { setError(t('catalog.saveFailed') + ' ' + t(errorKey(e))); return null; } finally { if (!keepBusy) setBusy(false); }
  };

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      // The banner lives under the promotion's id, so a brand-new promotion is saved first.
      const id = promotionId ?? (await save(true));
      if (!id) return;
      const image = await prepareImageUpload(file);
      const path = `businesses/${business.id}/branches/${branch.id}/promotions/${id}/${makeId(10)}.${image.ext}`;
      await uploadBytes(sref(storage, path), image.blob, { contentType: image.contentType });
      await recordUpload(path, () => call('setPromotionImage', { businessId: business.id, branchId: branch.id, promotionId: id, path }));
      setImagePath(path);
      toast(t('promotions.imageSaved'));
    } catch (e) { setError(t(uploadErrorKey(e))); } finally { setBusy(false); }
  };
  const clearImage = async () => {
    if (!promotionId) return;
    setBusy(true);
    try {
      await call('setPromotionImage', { businessId: business.id, branchId: branch.id, promotionId, path: null });
      setImagePath(undefined);
    } catch (e) { setError(t(errorKey(e))); } finally { setBusy(false); }
  };

  if (mode === 'pick') {
    return (
      <ItemPickerDialog
        products={eligible}
        categories={categories}
        title={t('promotions.pickItems')}
        toggle
        summary={<strong>{(d.productIds.length === 1 ? t('promotions.itemsCount.one') : t('promotions.itemsCount', { n: d.productIds.length }))}</strong>}
        count={(p) => (d.productIds.includes(p.id) ? 1 : 0)}
        onPick={(p) => toggleProduct(p)}
        onClose={() => setMode('edit')}
      />
    );
  }

  return (
    <Dialog open onClose={() => { if (!busy && safety.confirmDiscard()) onClose(); }} title={promotionId ? t('promotions.edit') : t('promotions.new')} closeLabel={t('common.close')} footer={<><Button variant="secondary" disabled={busy} onClick={() => { if (safety.confirmDiscard()) onClose(); }}>{t('common.cancel')}</Button><Button loading={busy} onClick={async () => { if (await save()) onClose(); }}>{t('common.save')}</Button></>}>
      <div className="combo-editor">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="combo-preview" aria-hidden="true">
          <div className="combo-section__head">
            <span className="combo-preview__label">{t('deals.customerPreview')}</span>
            {d.active ? <Badge tone="success" icon="eye">{t('promotions.shown')}</Badge> : <Badge tone="muted">{t('promotions.hidden')}</Badge>}
          </div>
          <PromoSlide promotion={{ title: d.title, body: d.body, endsAt: d.endsAt, imagePath }} products={featured} defaultLocale={business.defaultLocale} />
        </div>

        <section className="combo-section">
          <h3>{t('promotions.details')}</h3>
          <LocalizedInput label={t('promotions.promoTitle')} value={d.title} required onChange={(title) => set({ title })} />
          <LocalizedInput label={t('promotions.body')} value={d.body} multiline onChange={(body) => set({ body })} />
        </section>

        <section className="combo-section">
          <h3>{t('promotions.validity')}</h3>
          <TextInput label={t('promotions.endsAt')} type="date" ltr required min={today} value={d.endsAt} hint={t('promotions.endsAtHint')} error={dateError ?? undefined} onChange={(e) => { setDateError(null); set({ endsAt: e.target.value }); }} />
          <Checkbox label={t('promotions.active')} checked={d.active} onChange={(e) => set({ active: e.target.checked })} />
        </section>

        <section className="combo-section">
          <div className="combo-section__head">
            <h3>{t('promotions.items')}</h3>
            {featured.length > 0 ? <Badge tone="neutral">{(featured.length === 1 ? t('promotions.itemsCount.one') : t('promotions.itemsCount', { n: featured.length }))}</Badge> : null}
          </div>
          {featured.length === 0 ? null : <div className="combo-list">
            {featured.map((p) => (
              <div key={p.id} className="combo-line">
                <StorageImage path={p.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} />
                <div className="combo-line__text"><span className="combo-line__name">{L(p.name, business.defaultLocale)}</span></div>
                <IconButton icon="x" label={`${t('common.remove')}: ${L(p.name, business.defaultLocale)}`} onClick={() => toggleProduct(p)} />
              </div>
            ))}
          </div>}
          <Button variant="secondary" block icon="plus" onClick={() => setMode('pick')}>{t('promotions.pickItems')}</Button>
        </section>

        <section className="combo-section">
          <div className="combo-section__head">
            <h3>{t('promotions.image')}</h3>
            {imagePath ? <Badge tone="success" icon="check">{t('deals.imageSavedBadge')}</Badge> : null}
          </div>
          <div className="combo-promo">
            {imagePath ? <StorageImage path={imagePath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} />
              : <div className="combo-promo--empty"><Icon name="image" size={20} />{t('promotions.noImage')}</div>}
          </div>
          <div className="row row--nowrap">
            <label className={`btn btn--secondary btn--block ${busy ? 'is-busy' : ''}`}><Icon name="image" size={18} /> {imagePath ? t('promotions.replaceImage') : t('promotions.uploadImage')}<input type="file" accept={UPLOAD_ACCEPT} className="visually-hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
            {imagePath ? <Button variant="ghost" icon="trash" loading={busy} onClick={clearImage}>{t('promotions.removeImage')}</Button> : null}
          </div>
          <p className="muted">{t('promotions.imageHint')}</p>
        </section>
      </div>
    </Dialog>
  );
}
