import { useMemo, useState } from 'react';
import { MAX_COMBO_ITEMS, MAX_PROMOTIONS, comboUnitPrice, hasAnyTranslation, type Category, type Combo, type ComboItem, type Localized, type Product, type Promotion } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { Button, Dialog, TextInput, Badge, Alert, EmptyState, IconButton, Stepper, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { PromotionsSection } from './PromotionsPage';
import { PageTitle, useDash } from './shell';
import { LoadError, useDraftSafety } from './BusinessExperience';
import { LocalizedInput } from './LocalizedInput';
import { ItemPickerDialog } from './ItemPicker';
import { StorageImage } from '@/customer/StorageImage';
import { ComboMedia } from '@/customer/ComboMedia';
import { ComboSlide, DealSlide } from '@/customer/DealSlide';
import './settings.css';

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
  const promotions = useCollection<Promotion>(canCombos ? `${base}/promotions` : null, [orderBy('sortOrder'), limit(MAX_PROMOTIONS)], [branch.id]);
  const [edit, setEdit] = useState<{ id?: string; d: Draft } | null>(null);
  const [remove, setRemove] = useState<Combo | null>(null);
  const [tab, setTab] = useState<'combos' | 'promotions'>('combos');
  if (!canCombos) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  if (combos.error || products.error || categories.error) return <LoadError />;
  const live = combos.data.filter((c) => !c.archived);
  const promoted = live.filter((c) => c.active).length;
  const liveCategories = categories.data.filter((c) => !c.archived);
  const openNew = () => setEdit({ d: empty() });
  const tabId = (k: 'combos' | 'promotions') => `deals-tab-${k}`;
  return (
    <div className="sx-page sx-page--wide">
      <PageTitle title={t('deals.manage')} />
      <div className="sx-tabs" role="tablist" aria-label={t('deals.manage')} onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 'combos' : e.key === 'End' ? 'promotions' : tab === 'combos' ? 'promotions' : 'combos';
        setTab(next);
        document.getElementById(tabId(next))?.focus();
      }}>
        <button type="button" role="tab" tabIndex={tab === 'combos' ? 0 : -1} id={tabId('combos')} aria-selected={tab === 'combos'} aria-controls="deals-panel-combos" onClick={() => setTab('combos')}>{t('deals.tabCombos', { n: live.length })}</button>
        <button type="button" role="tab" tabIndex={tab === 'promotions' ? 0 : -1} id={tabId('promotions')} aria-selected={tab === 'promotions'} aria-controls="deals-panel-promotions" onClick={() => setTab('promotions')}>{t('deals.tabPromotions', { n: promotions.data.length })}</button>
      </div>

      <section id="deals-panel-combos" role="tabpanel" aria-labelledby={tabId('combos')} hidden={tab !== 'combos'} className="sx-section">
        <div className="sx-section__head">
          <div><h2 id="combos-h">{t('deals.combos')}</h2>{live.length > 0 ? <p className="sx-card__sub">{t(live.length === 1 ? 'deals.comboCount.one' : 'deals.comboCount.other', { n: live.length, promoted })}</p> : null}</div>
          <Button icon="plus" onClick={openNew}>{t('deals.new')}</Button>
        </div>
        {combos.data.length === 0 && !combos.loading ? (
          <div className="sx-card">
            <div className="pitch">
              <div className="pitch__copy">
                <h3 className="pitch__title">{t('deals.emptyTitle')}</h3>
                <ul className="pitch__list">
                  {(['deals.emptyPoint1', 'deals.emptyPoint2', 'deals.emptyPoint3'] as const).map((k) => <li key={k} className="pitch__item"><Icon name="check" size={16} />{t(k)}</li>)}
                </ul>
                <div><Button icon="plus" onClick={openNew}>{t('deals.firstCta')}</Button></div>
              </div>
              <div className="pitch__preview" aria-hidden="true">
                <span className="pitch__label">{t('deals.exampleLabel')}</span>
                <DealSlide tone="combo" kind={t('deals.combo')} name={t('deals.mockName')} sub={t('deals.mockItems')} pill={<bdi>{money(5100, locale)}</bdi>} paths={[]} />
              </div>
            </div>
          </div>
        ) : null}
        {combos.data.length > 0 ? <div className="sx-grid">
          {combos.data.map((c) => {
            const sum = sumOf(c.items, products.data);
            const price = priceOf(c, products.data);
            const name = L(c.name, business.defaultLocale);
            return (
              <article key={c.id} className={`sx-deal ${c.archived || !c.active ? 'sx-deal--off' : ''}`} aria-label={name}>
                <div className="sx-deal__top">
                  <span className="sx-deal__thumb"><ComboMedia combo={c} products={products.data} fallbackLabel={t('discovery.imageFallback')} /><span className="deal-card__badge">{t('deals.combo')}</span></span>
                  <div className="sx-deal__text">
                    <div className="sx-deal__name"><strong>{name}</strong>{c.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : c.active ? <Badge tone="success" icon="eye">{t('deals.activeShort')}</Badge> : <Badge tone="muted">{t('common.disabled')}</Badge>}</div>
                    <p className="sx-deal__items">{c.items.map((it) => { const p = products.data.find((x) => x.id === it.productId); return `${it.quantity} × ${p ? L(p.name, business.defaultLocale) : '?'}`; }).join(' · ')}</p>
                  </div>
                </div>
                <div className="sx-deal__price">
                  {sum !== null ? <span className="sx-deal__worth"><Icon name="shield" size={14} /><bdi>{t('deals.itemsWorth', { price: money(sum, locale) })}</bdi> · {t('deals.ownerOnly')}</span> : <Badge tone="danger">{t('deals.unavailable')}</Badge>}
                  <bdi className="sx-deal__amount">{money(price, locale)}</bdi>
                </div>
                <div className="sx-deal__actions">
                  <Button variant="secondary" icon="edit" onClick={() => setEdit({ id: c.id, d: { name: c.name, description: c.description, items: c.items, priceAgorot: price, promoted: c.promoted, active: c.active }})}>{t('deals.edit')}</Button>
                  <IconButton icon="trash" label={`${t('deals.delete')}: ${name}`} onClick={() => setRemove(c)} />
                </div>
              </article>
            );
          })}
        </div> : null}
        {edit ? <ComboEditor initial={edit} products={products.data} categories={liveCategories} onClose={() => setEdit(null)} /> : null}
      </section>

      <section id="deals-panel-promotions" role="tabpanel" aria-labelledby={tabId('promotions')} hidden={tab !== 'promotions'} className="sx-section">
        <PromotionsSection products={products.data} categories={liveCategories} promotions={promotions} />
      </section>
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger title={t('deals.delete')} body={t('deals.deleteBody')} confirmLabel={t('common.delete')} onConfirm={async () => { const c = remove!; setRemove(null); await call('deleteCombo', { businessId: business.id, branchId: branch.id, comboId: c.id }).then(() => toast(t('deals.deleted'))).catch((e) => toast(t(errorKey(e)), 'danger')); }} />
    </div>
  );
}

function ComboEditor({ initial, products, categories, onClose }: { initial: { id?: string; d: Draft }; products: Product[]; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch } = useDash();
  const [d, setD] = useState<Draft>(initial.d);
  const safety = useDraftSafety(d);
  const [priceText, setPriceText] = useState(toShekels(initial.d.priceAgorot));
  const [comboId, setComboId] = useState(initial.id);
  const [mode, setMode] = useState<'edit' | 'pick'>('edit');
  const [showDesc, setShowDesc] = useState(hasAnyTranslation(initial.d.description));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));
  const eligible = useMemo(() => products.filter((p) => p.pricingMode === 'unit' && p.available && (p.variants.length === 0 || p.variants.some((v) => v.available))), [products]);
  const sum = sumOf(d.items, products);
  const price = d.priceAgorot;
  const priceAboveSum = sum !== null && price > sum;
  const units = d.items.reduce((n, it) => n + it.quantity, 0);
  const name = L(d.name, business.defaultLocale) || t('deals.combo');
  const lineName = (it: ComboItem) => { const p = products.find((x) => x.id === it.productId); const v = p?.variants.find((x) => x.id === it.variantId); return p ? `${L(p.name, business.defaultLocale)}${v ? ` (${L(v.name, business.defaultLocale)})` : ''}` : it.productId; };
  const upsert = (productId: string, variantId: string | undefined, qty: number) => set({ items: qty <= 0 ? d.items.filter((i) => !(i.productId === productId && i.variantId === variantId)) : d.items.some((i) => i.productId === productId && i.variantId === variantId) ? d.items.map((i) => (i.productId === productId && i.variantId === variantId ? { ...i, quantity: qty } : i)) : [...d.items, { productId, variantId, quantity: qty }] });

  const save = async (): Promise<string | null> => {
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
    } catch (e) { setError(t('catalog.saveFailed') + ' ' + t(errorKey(e))); return null; } finally { setBusy(false); }
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
        onPick={(p, vid) => { const needsVariant = p.variants.length > 0; const existing = d.items.find((i) => i.productId === p.id && (!needsVariant || i.variantId === vid)); if (!existing && d.items.length >= MAX_COMBO_ITEMS) { toast(t('catalog.maxItemsReached', { max: MAX_COMBO_ITEMS }), 'danger'); return; } upsert(p.id, needsVariant ? vid : undefined, (existing?.quantity ?? 0) + 1); }}
        onClose={() => setMode('edit')}
      />
    );
  }

  return (
    <Dialog open onClose={() => { if (!busy && safety.confirmDiscard()) onClose(); }} title={comboId ? t('deals.edit') : t('deals.new')} footer={<><Button variant="secondary" disabled={busy} onClick={() => { if (safety.confirmDiscard()) onClose(); }}>{t('common.cancel')}</Button><Button loading={busy} onClick={async () => { if (await save()) onClose(); }}>{t('common.save')}</Button></>}>
      <fieldset className="combo-editor form-fields" disabled={busy}>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="combo-preview" aria-hidden="true">
          <div className="combo-section__head">
            <span className="combo-preview__label">{t('deals.customerPreview')}</span>
            {d.active ? <Badge tone="success" icon="eye">{t('deals.activeShort')}</Badge> : <Badge tone="muted">{t('common.disabled')}</Badge>}
          </div>
          {d.items.length > 0 ? <ComboSlide combo={{ name: d.name, items: d.items }} products={products} defaultLocale={business.defaultLocale} price={price > 0 ? price : null} />
            : <DealSlide tone="combo" kind={t('deals.combo')} name={name} sub={t('deals.minItems')} paths={[]} />}
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
            {d.items.length > 0 ? <Badge tone="neutral">{t(d.items.length === 1 ? 'deals.itemCount.one' : 'deals.itemCount.other', { n: d.items.length })}</Badge> : null}
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
          <TextInput label={t('deals.price')} type="number" ltr inputMode="decimal" min={0} step="0.5" value={priceText} error={priceAboveSum ? t('deals.priceAboveSum') : undefined} onChange={(e) => { setPriceText(e.target.value); set({ priceAgorot: toAgorot(e.target.value) }); }} />
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

      </fieldset>
    </Dialog>
  );
}
