import { useState } from 'react';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { MAX_PROMOTIONS, hasAnyTranslation, makeId, toLocal, type Category, type Localized, type Product, type Promotion } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, limit } from '@/lib/queries';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, IconButton, TextInput, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { call } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload } from '@/lib/images';
import { useDash } from './shell';
import { LocalizedInput } from './LocalizedInput';
import { ItemPickerDialog } from './ItemPicker';
import { formatDay, promotionExpired } from '@/lib/promotions';
import { StorageImage } from '@/customer/StorageImage';
import { PromoCard } from '@/customer/PromoCard';

interface Draft { title: Localized; body: Localized; productIds: string[]; endsAt: string; active: boolean }
const emptyDraft = (): Draft => ({ title: {}, body: {}, productIds: [], endsAt: '', active: true });
const draftOf = (p: Promotion): Draft => ({ title: p.title, body: p.body, productIds: p.productIds ?? [], endsAt: p.endsAt ?? '', active: p.active });

/** Limited-time promotions of the current branch: a headline, featured items and an optional banner, always with an end date. */
export function PromotionsSection({ products, categories }: { products: Product[]; categories: Category[] }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const promotions = useCollection<Promotion>(can('catalog') ? `${base}/promotions` : null, [orderBy('sortOrder'), limit(MAX_PROMOTIONS)], [branch.id]);
  const [edit, setEdit] = useState<{ id?: string; draft: Draft; imagePath?: string } | null>(null);
  const [remove, setRemove] = useState<Promotion | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can('catalog')) return null;
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
  return (
    <section className="tool" aria-labelledby="promotions-h">
      <div className="tool__head">
        <span className="tool__icon tool__icon--promo"><Icon name="tag" size={22} /></span>
        <div className="tool__text">
          <h2 id="promotions-h">{t('promotions.title')}</h2>
          <p className="tool__pitch">{t('promotions.pitch')}</p>
          <div className="tool__chips">
            <Badge tone="neutral" icon="clock">{t('promotions.autoExpire')}</Badge>
            <Badge tone="neutral" icon="utensils">{t('promotions.withItems')}</Badge>
            {list.length > 0 ? <Badge tone={shownCount > 0 ? 'success' : 'muted'} icon="eye">{t('promotions.summary', { shown: shownCount, max: MAX_PROMOTIONS })}</Badge> : <Badge tone="neutral">{t('promotions.maxChip', { max: MAX_PROMOTIONS })}</Badge>}
          </div>
        </div>
        <div className="tool__cta"><Button size="sm" icon="plus" disabled={full} onClick={openNew}>{t('promotions.new')}</Button></div>
      </div>
      <div className="tool__body">
        {full ? <Alert tone="warn">{t('promotions.limit', { max: MAX_PROMOTIONS })}</Alert> : null}
        {list.length === 0 && !promotions.loading ? (
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
              <article className="promo promo--mock">
                <div className="promo__head"><Icon name="clock" size={18} /><span className="promo__kicker">{t('promotions.limited')}</span><span className="promo__until">{t('promotions.mockUntil')}</span></div>
                <h2 className="promo__title">{t('promotions.mockTitle')}</h2>
                <p className="promo__body">{t('promotions.mockBody')}</p>
              </article>
            </div>
          </div>
        ) : list.length > 0 ? (
          <ul className="list">
            {list.map((p) => {
              const expired = promotionExpired(p);
              const shown = p.active && !expired;
              const names = (p.productIds ?? []).map((id) => products.find((x) => x.id === id)).filter(Boolean).map((x) => L(x!.name, business.defaultLocale));
              return (
                <li key={p.id} className="list__item" style={shown ? undefined : { opacity: 0.7 }}>
                  {p.imagePath ? <span className="promo-thumb"><StorageImage path={p.imagePath} alt="" size="thumb" fallbackLabel={t('discovery.imageFallback')} /></span> : <span className={`promo-icon ${shown ? '' : 'promo-icon--off'}`}><Icon name="tag" size={18} /></span>}
                  <div className="list__grow">
                    <div className="row" style={{ gap: 6 }}>
                      <strong className="wrap-anywhere">{L(p.title, business.defaultLocale)}</strong>
                      {expired ? <Badge tone="muted">{t('promotions.expired')}</Badge> : p.active ? <Badge tone="success">{t('promotions.shown')}</Badge> : <Badge tone="muted">{t('promotions.hidden')}</Badge>}
                    </div>
                    <div className="muted wrap-anywhere">
                      <bdi>{t('promotions.until', { date: formatDay(p.endsAt) })}</bdi>
                      {names.length ? ` · ${names.join(', ')}` : ''}
                    </div>
                  </div>
                  <div className="actions actions--icons">
                    <IconButton icon="edit" label={t('promotions.edit')} onClick={() => setEdit({ id: p.id, draft: draftOf(p), imagePath: p.imagePath })} />
                    <IconButton icon="trash" label={t('common.remove')} onClick={() => setRemove(p)} style={{ color: 'var(--color-danger)' }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {edit ? <PromotionEditor initial={edit} products={products} categories={categories} onClose={() => setEdit(null)} /> : null}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} onConfirm={confirmRemove} title={t('promotions.removeConfirm')} body={remove ? L(remove.title, business.defaultLocale) : undefined} confirmLabel={t('common.remove')} danger loading={busy} />
    </section>
  );
}

function PromotionEditor({ initial, products, categories, onClose }: { initial: { id?: string; draft: Draft; imagePath?: string }; products: Product[]; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const [d, setD] = useState<Draft>(initial.draft);
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
  const toggleProduct = (p: Product) => set({ productIds: d.productIds.includes(p.id) ? d.productIds.filter((id) => id !== p.id) : d.productIds.length >= 10 ? d.productIds : [...d.productIds, p.id] });

  const save = async (): Promise<string | null> => {
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
      return r.promotion.id;
    } catch (e) { setError(t('catalog.saveFailed') + ' ' + t(errorKey(e))); return null; } finally { setBusy(false); }
  };

  const upload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      // The banner lives under the promotion's id, so a brand-new promotion is saved first.
      const id = promotionId ?? (await save());
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
        summary={<strong>{t('promotions.itemsCount', { n: d.productIds.length })}</strong>}
        count={(p) => (d.productIds.includes(p.id) ? 1 : 0)}
        onPick={(p) => toggleProduct(p)}
        onClose={() => setMode('edit')}
      />
    );
  }

  return (
    <Dialog open onClose={onClose} title={promotionId ? t('promotions.edit') : t('promotions.new')} closeLabel={t('common.close')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={async () => { if (await save()) onClose(); }}>{t('common.save')}</Button></>}>
      <div className="combo-editor">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="combo-preview" aria-hidden="true">
          <div className="combo-section__head">
            <span className="combo-preview__label">{t('deals.customerPreview')}</span>
            {d.active ? <Badge tone="success" icon="eye">{t('promotions.shown')}</Badge> : <Badge tone="muted">{t('promotions.hidden')}</Badge>}
          </div>
          <PromoCard promotion={{ title: d.title, body: d.body, endsAt: d.endsAt, imagePath }} products={featured} defaultLocale={business.defaultLocale} />
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
            {featured.length > 0 ? <Badge tone="neutral">{t('promotions.itemsCount', { n: featured.length })}</Badge> : null}
          </div>
          {featured.length === 0 ? <p className="muted">{t('promotions.itemsHint')}</p> : <div className="combo-list">
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
