import { useMemo, useState } from 'react';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { comboUnitPrice, hasAnyTranslation, makeId, type Category, type Combo, type ComboItem, type Localized, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { Button, Dialog, TextInput, Badge, Alert, EmptyState, IconButton, Stepper, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { imageSources, recordUpload } from '@/lib/images';
import { PromotionsSection } from './PromotionsPage';
import { PageTitle, useDash } from './shell';
import { LoadError, useDraftSafety } from './BusinessExperience';
import { LocalizedInput } from './LocalizedInput';
import { ItemPickerDialog } from './ItemPicker';
import { StorageImage } from '@/customer/StorageImage';
import { ComboMedia } from '@/customer/ComboMedia';
import { composePromo, type PromoResult } from '@/deals/promoImage';

type Draft = { name: Localized; description: Localized; items: ComboItem[]; priceAgorot: number; promoted: boolean; active: boolean };
const empty = (): Draft => ({ name: {}, description: {}, items: [], priceAgorot: 0, promoted: true, active: true });

/** Sum of the members' current catalog prices — shown to the owner only, never to customers. */
function sumOf(items: ComboItem[], products: Product[]): number | null {
  let sum = 0;
  for (const it of items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p || p.pricingMode !== 'unit') return null;
    const v = p.variants.find((x) => x.id === it.variantId);
    if (p.variants.length > 0 && !v) return null;
    sum += (v?.priceAgorot ?? p.priceAgorot) * it.quantity;
  }
  return sum;
}

/** Legacy percentage combos open in the editor with the price they were selling at. */
function priceOf(c: Combo, products: Product[]): number {
  if (c.priceAgorot) return c.priceAgorot;
  const sum = sumOf(c.items, products);
  return sum === null ? 0 : comboUnitPrice(c, sum);
}

const toShekels = (agorot: number) => (agorot ? (agorot / 100).toFixed(agorot % 100 === 0 ? 0 : 2) : '');
const toAgorot = (s: string) => Math.max(0, Math.round((Number(s.replace(',', '.')) || 0) * 100));

export function DealsPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const canCombos = can('catalog');
  const combos = useCollection<Combo>(canCombos ? `${base}/combos` : null, [orderBy('sortOrder'), limit(100)], [branch.id]);
  const products = useCollection<Product>(canCombos ? `${base}/products` : null, [where('archived', '==', false), limit(1000)], [branch.id]);
  const categories = useCollection<Category>(canCombos ? `${base}/categories` : null, [orderBy('sortOrder'), limit(200)], [branch.id]);
  const [edit, setEdit] = useState<{ id?: string; d: Draft; imagePath?: string } | null>(null);
  const [remove, setRemove] = useState<Combo | null>(null);
  if (!canCombos) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  if (combos.error || products.error || categories.error) return <LoadError />;
  const live = combos.data.filter((c) => !c.archived);
  const promoted = live.filter((c) => c.active).length;
  const liveCategories = categories.data.filter((c) => !c.archived);
  const openNew = () => setEdit({ d: empty() });
  return (
    <div className="stack stack--lg">
      <div>
        <PageTitle title={t('deals.manage')} />
        <p className="tool__lead">{t('deals.subtitle')}</p>
      </div>
      <section className="tool" aria-labelledby="combos-h">
        <div className="tool__head">
          <span className="tool__icon tool__icon--combo"><Icon name="basket" size={22} /></span>
          <div className="tool__text">
            <h2 id="combos-h">{t('deals.combos')}</h2>
            <p className="tool__pitch">{t('deals.comboPitch')}</p>
            <div className="tool__chips">
              <Badge tone="neutral" icon="eye">{t('deals.comboWhere')}</Badge>
              <Badge tone="neutral" icon="shield">{t('deals.comboPrivate')}</Badge>
              {live.length > 0 ? <Badge tone="success" icon="star">{t('deals.summary', { n: live.length, promoted })}</Badge> : null}
            </div>
          </div>
          <div className="tool__cta"><Button size="sm" icon="plus" onClick={openNew}>{t('deals.new')}</Button></div>
        </div>
        <div className="tool__body">
          {combos.data.length === 0 && !combos.loading ? (
            <div className="pitch">
              <div className="pitch__copy">
                <h3 className="pitch__title">{t('deals.emptyTitle')}</h3>
                <ul className="pitch__list">
                  {(['deals.emptyPoint1', 'deals.emptyPoint2', 'deals.emptyPoint3'] as const).map((k) => <li key={k} className="pitch__item"><Icon name="check" size={16} />{t(k)}</li>)}
                </ul>
                <p className="pitch__tip">{t('deals.emptyTip')}</p>
                <div><Button icon="plus" onClick={openNew}>{t('deals.firstCta')}</Button></div>
              </div>
              <div className="pitch__preview" aria-hidden="true">
                <span className="pitch__label">{t('deals.exampleLabel')}</span>
                <div className="mock-deal">
                  <div className="mock-deal__media"><span className="deal-card__badge">{t('deals.combo')}</span></div>
                  <div className="deal-card__body">
                    <strong>{t('deals.mockName')}</strong>
                    <span className="muted">{t('deals.mockItems')}</span>
                    <span className="deal-card__prices"><bdi className="price price--lg">{money(5100, locale)}</bdi></span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {combos.data.length > 0 ? <div className="grid-cards">
            {combos.data.map((c) => {
              const sum = sumOf(c.items, products.data);
              const price = priceOf(c, products.data);
              return (
                <section key={c.id} className="card stack--sm stack" style={{ opacity: c.archived ? 0.6 : 1 }}>
                  <div className="deal-card__media" style={{ borderRadius: 12, overflow: 'hidden' }}><ComboMedia combo={c} products={products.data} fallbackLabel={t('discovery.imageFallback')} />{c.imagePath ? null : <span className="deal-card__badge">{t('deals.combo')}</span>}</div>
                  <div className="row" style={{ gap: 6 }}><strong>{L(c.name, business.defaultLocale)}</strong>{!c.active ? <Badge tone="muted">{t('common.disabled')}</Badge> : null}{c.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}</div>
                  <div className="muted wrap-anywhere">{c.items.map((it) => { const p = products.data.find((x) => x.id === it.productId); return `${it.quantity} × ${p ? L(p.name, business.defaultLocale) : '?'}`; }).join(' + ')}</div>
                  {sum !== null ? <div className="row"><bdi className="price">{money(price, locale)}</bdi><span className="muted owner-only"><Icon name="shield" size={14} /><bdi>{t('deals.itemsWorth', { price: money(sum, locale) })}</bdi></span></div> : <Badge tone="danger">{t('deals.unavailable')}</Badge>}
                  <div className="row" style={{ gap: 4 }}>
                    <IconButton icon="edit" label={t('deals.edit')} onClick={() => setEdit({ id: c.id, d: { name: c.name, description: c.description, items: c.items, priceAgorot: price, promoted: c.promoted, active: c.active }, imagePath: c.imagePath })} />
                    <IconButton icon="trash" label={`${t('deals.delete')}: ${L(c.name, business.defaultLocale)}`} onClick={() => setRemove(c)} />
                  </div>
                </section>
              );
            })}
          </div> : null}
        </div>
        {edit ? <ComboEditor initial={edit} products={products.data} categories={liveCategories} onClose={() => setEdit(null)} /> : null}
      </section>
      <PromotionsSection products={products.data} categories={liveCategories} />
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger title={t('deals.delete')} body={t('deals.deleteBody')} confirmLabel={t('common.delete')} onConfirm={async () => { const c = remove!; setRemove(null); await call('deleteCombo', { businessId: business.id, branchId: branch.id, comboId: c.id }).then(() => toast(t('deals.deleted'))).catch((e) => toast(t(errorKey(e)), 'danger')); }} />
    </div>
  );
}

function ComboEditor({ initial, products, categories, onClose }: { initial: { id?: string; d: Draft; imagePath?: string }; products: Product[]; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L, locale, dir } = useI18n();
  const { business, branch } = useDash();
  const [d, setD] = useState<Draft>(initial.d);
  const safety = useDraftSafety(d);
  const [priceText, setPriceText] = useState(toShekels(initial.d.priceAgorot));
  const [comboId, setComboId] = useState(initial.id);
  const [imagePath, setImagePath] = useState(initial.imagePath);
  const [mode, setMode] = useState<'edit' | 'pick'>('edit');
  const [showDesc, setShowDesc] = useState(hasAnyTranslation(initial.d.description));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PromoResult | null>(null);
  const set = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));
  const eligible = useMemo(() => products.filter((p) => p.pricingMode === 'unit' && p.available && (p.variants.length === 0 || p.variants.some((v) => v.available))), [products]);
  const sum = sumOf(d.items, products);
  const price = d.priceAgorot;
  const priceAboveSum = sum !== null && price > sum;
  const units = d.items.reduce((n, it) => n + it.quantity, 0);
  const name = L(d.name, business.defaultLocale) || t('deals.combo');
  const lineName = (it: ComboItem) => { const p = products.find((x) => x.id === it.productId); const v = p?.variants.find((x) => x.id === it.variantId); return p ? `${L(p.name, business.defaultLocale)}${v ? ` (${L(v.name, business.defaultLocale)})` : ''}` : it.productId; };
  const upsert = (productId: string, variantId: string | undefined, qty: number) => set({ items: qty <= 0 ? d.items.filter((i) => !(i.productId === productId && i.variantId === variantId)) : d.items.some((i) => i.productId === productId && i.variantId === variantId) ? d.items.map((i) => (i.productId === productId && i.variantId === variantId ? { ...i, quantity: qty } : i)) : [...d.items, { productId, variantId, quantity: qty }] });

  const save = async (keepBusy = false): Promise<string | null> => {
    setError(null);
    if (!hasAnyTranslation(d.name)) { setError(t('validation.atLeastOneLanguage')); return null; }
    if (d.items.length < 2) { setError(t('deals.minItems')); return null; }
    if (price < 1) { setError(t('deals.priceRequired')); return null; }
    if (priceAboveSum) { setError(t('deals.priceAboveSum')); return null; }
    setBusy(true);
    try {
      const r = await call<{ combo: Combo }>('saveCombo', { businessId: business.id, branchId: branch.id, comboId, combo: { ...d, promoted: d.active } });
      setComboId(r.combo.id);
      toast(t('catalog.savedOk'));
      safety.markSaved();
      return r.combo.id;
    } catch (e) { setError(t('catalog.saveFailed') + ' ' + t(errorKey(e))); return null; } finally { if (!keepBusy) setBusy(false); }
  };

  const generate = async () => {
    setGenerating(true);
    setPreview(null);
    try {
      const sources = d.items.map((it) => { const p = products.find((x) => x.id === it.productId); const srcs = imageSources(p?.imagePath, 'display'); return { url: srcs?.src, fallbackUrl: srcs?.fallback ?? undefined, label: p ? L(p.name, business.defaultLocale) : '', quantity: it.quantity }; });
      const res = await composePromo(sources, { title: name, stickerText: money(price, locale), badgeText: t('deals.combo'), dir });
      setPreview(res);
      if (sources.every((s) => !s.url)) toast(t('deals.noPhotos'));
    } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setGenerating(false); }
  };

  const usePhoto = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const id = comboId ?? (await save(true));
      if (!id) return;
      const path = `businesses/${business.id}/branches/${branch.id}/combos/${id}/${makeId(10)}.jpg`;
      await uploadBytes(sref(storage, path), preview.blob, { contentType: 'image/jpeg' });
      await recordUpload(path, () => call('setComboImage', { businessId: business.id, branchId: branch.id, comboId: id, path }));
      setImagePath(path);
      setPreview(null);
      toast(t('deals.imageSaved'));
    } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); }
  };

  if (mode === 'pick') {
    return (
      <ItemPickerDialog
        products={eligible}
        categories={categories}
        title={t('deals.pickItems')}
        withVariants
        summary={<><strong>{t('deals.unitsInCombo', { n: units })}</strong>{sum !== null ? <span className="muted"><bdi>{t('deals.itemsWorth', { price: money(sum, locale) })}</bdi></span> : null}</>}
        count={(p) => d.items.filter((i) => i.productId === p.id).reduce((n, i) => n + i.quantity, 0)}
        pickedVariant={(p) => d.items.find((i) => i.productId === p.id)?.variantId}
        onPick={(p, vid) => { const needsVariant = p.variants.length > 0; const existing = d.items.find((i) => i.productId === p.id && (!needsVariant || i.variantId === vid)); upsert(p.id, needsVariant ? vid : undefined, (existing?.quantity ?? 0) + 1); }}
        onClose={() => setMode('edit')}
      />
    );
  }

  return (
    <Dialog open onClose={() => { if (!busy && safety.confirmDiscard()) onClose(); }} title={comboId ? t('deals.edit') : t('deals.new')} footer={<><Button variant="secondary" disabled={busy} onClick={() => { if (safety.confirmDiscard()) onClose(); }}>{t('common.cancel')}</Button><Button loading={busy} onClick={async () => { if (await save()) onClose(); }}>{t('common.save')}</Button></>}>
      <div className="combo-editor">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="combo-preview" aria-hidden="true">
          <div className="combo-section__head">
            <span className="combo-preview__label">{t('deals.customerPreview')}</span>
            {d.active ? <Badge tone="success" icon="eye">{t('deals.activeShort')}</Badge> : <Badge tone="muted">{t('common.disabled')}</Badge>}
          </div>
          <div className="deal-card">
            <div className="deal-card__media">
              {preview ? <img className="promo-canvas" src={preview.dataUrl} alt="" /> : <ComboMedia combo={{ items: d.items, imagePath }} products={products} fallbackLabel={t('discovery.imageFallback')} />}
              {preview || imagePath ? null : <span className="deal-card__badge">{t('deals.combo')}</span>}
            </div>
            <div className="deal-card__body">
              <strong>{name}</strong>
              {d.items.length > 0 ? <span className="muted wrap-anywhere">{d.items.map((it) => `${it.quantity} × ${lineName(it)}`).join(' + ')}</span> : <span className="muted">{t('deals.minItems')}</span>}
              {price > 0 && d.items.length > 0 ? <span className="deal-card__prices"><bdi className="price price--lg">{money(price, locale)}</bdi></span> : null}
            </div>
          </div>
        </div>

        <section className="combo-section">
          <h3>{t('deals.details')}</h3>
          <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => set({ name })} />
          {showDesc ? <LocalizedInput label={t('business.about')} value={d.description} multiline onChange={(description) => set({ description })} />
            : <div><Button variant="ghost" size="sm" icon="plus" onClick={() => setShowDesc(true)}>{t('deals.addDescription')}</Button></div>}
        </section>

        <section className="combo-section">
          <div className="combo-section__head">
            <h3>{t('deals.items')}</h3>
            {d.items.length > 0 ? <Badge tone="neutral">{t('deals.itemsCount', { n: d.items.length })}</Badge> : null}
          </div>
          {d.items.length === 0 ? <p className="muted">{t('deals.minItems')}</p> : <div className="combo-list">
            {d.items.map((it) => { const p = products.find((x) => x.id === it.productId); const v = p?.variants.find((x) => x.id === it.variantId); return (
              <div key={`${it.productId}:${it.variantId ?? ''}`} className="combo-line">
                <StorageImage path={p?.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} />
                <div className="combo-line__text">
                  <span className="combo-line__name">{lineName(it)}</span>
                  <span className="muted"><bdi>{t('deals.unitPrice', { price: money(v?.priceAgorot ?? p?.priceAgorot ?? 0, locale) })}</bdi></span>
                </div>
                <Stepper size="sm" value={it.quantity} min={1} max={20} onChange={(n) => upsert(it.productId, it.variantId, n)} onRemove={() => upsert(it.productId, it.variantId, 0)} decLabel={t('product.decrease')} incLabel={t('product.increase')} removeLabel={`${t('common.remove')}: ${lineName(it)}`} />
              </div>
            ); })}
          </div>}
          <Button variant="secondary" block icon="plus" onClick={() => setMode('pick')}>{t('deals.pickItems')}</Button>
        </section>

        <section className="combo-section">
          <h3>{t('deals.priceTitle')}</h3>
          <TextInput label={t('deals.price')} type="number" ltr inputMode="decimal" min={0} step="0.5" value={priceText} hint={t('deals.priceHint')} error={priceAboveSum ? t('deals.priceAboveSum') : undefined} onChange={(e) => { setPriceText(e.target.value); set({ priceAgorot: toAgorot(e.target.value) }); }} />
          {sum !== null && d.items.length > 0 ? <div className="combo-summary summary">
            <div className="summary__row"><span className="owner-only"><Icon name="shield" size={14} />{t('deals.sum')}</span><bdi className="num">{money(sum, locale)}</bdi></div>
            {price > 0 && !priceAboveSum ? <div className="summary__row summary__row--saves"><span>{t('deals.customerSaves')}</span><bdi className="num">{money(sum - price, locale)}</bdi></div> : null}
            <div className="summary__row summary__row--total"><span>{t('deals.comboPrice')}</span><bdi className="num">{price > 0 ? money(price, locale) : '—'}</bdi></div>
            <span className="combo-summary__note"><Icon name="shield" size={16} />{t('deals.sumPrivate')}</span>
          </div> : null}
        </section>

        <section className="combo-section">
          <h3>{t('deals.visibility')}</h3>
          <label className={`choice choice--stack ${d.active ? 'is-selected' : ''}`}>
            <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked, promoted: e.target.checked })} />
            <span className="choice__text"><strong>{t('deals.active')}</strong><span className="choice__hint">{t('deals.activeHint')}</span></span>
            <span className="choice__trail"><Icon name="eye" size={20} /></span>
          </label>
        </section>

        <section className="combo-section">
          <div className="combo-section__head">
            <h3>{t('deals.promoImage')}</h3>
            {preview ? <Badge tone="accent">{t('deals.imageDraft')}</Badge> : imagePath ? <Badge tone="success" icon="check">{t('deals.imageSavedBadge')}</Badge> : null}
          </div>
          <div className="combo-promo">
            {preview ? <img className="promo-canvas" src={preview.dataUrl} alt={t('deals.promoImage')} />
              : imagePath ? <StorageImage path={imagePath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} />
              : <div className="combo-promo--empty"><Icon name="image" size={20} />{t('deals.noImageYet')}</div>}
          </div>
          <div className="row row--nowrap">
            <Button variant={preview ? 'secondary' : 'primary'} block icon={preview || imagePath ? 'refresh' : 'image'} loading={generating} disabled={d.items.length < 2 || price < 1} onClick={generate}>{generating ? t('deals.generating') : preview || imagePath ? t('deals.regenerate') : t('deals.generateImage')}</Button>
            {preview ? <Button block icon="check" loading={busy} onClick={usePhoto}>{t('deals.usePhoto')}</Button> : null}
          </div>
          <p className="muted">{t('deals.generateHelp')}</p>
        </section>
      </div>
    </Dialog>
  );
}
