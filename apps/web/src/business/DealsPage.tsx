import { useMemo, useState } from 'react';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { comboTotal, hasAnyTranslation, makeId, type Combo, type ComboItem, type Localized, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { Button, Dialog, TextInput, Checkbox, Select, Stepper, Badge, Alert, EmptyState, IconButton, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { imageSources } from '@/lib/images';
import { PromotionsSection } from './PromotionsPage';
import { PageTitle, useDash } from './shell';
import { LocalizedInput } from './CatalogPages';
import { StorageImage } from '@/customer/StorageImage';
import { composePromo, type PromoResult } from '@/deals/promoImage';

type Draft = { name: Localized; description: Localized; items: ComboItem[]; discountPercent: number; promoted: boolean; active: boolean };
const empty = (): Draft => ({ name: {}, description: {}, items: [], discountPercent: 10, promoted: true, active: true });

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

export function DealsPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const combos = useCollection<Combo>(can('catalog') ? `${base}/combos` : null, [orderBy('sortOrder'), limit(100)], [branch.id]);
  const products = useCollection<Product>(can('catalog') ? `${base}/products` : null, [where('archived', '==', false), limit(1000)], [branch.id]);
  const [edit, setEdit] = useState<{ id?: string; d: Draft; imagePath?: string } | null>(null);
  const [archive, setArchive] = useState<Combo | null>(null);
  const canCombos = can('catalog');
  const canPromos = can('settings');
  if (!canCombos && !canPromos) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="stack">
      <PageTitle title={t('deals.manage')}>{canCombos ? <Button size="sm" icon="plus" onClick={() => setEdit({ d: empty() })}>{t('deals.new')}</Button> : null}</PageTitle>
      {canCombos ? <>
      <p className="muted">{t('deals.help')}</p>
      {combos.data.length === 0 && !combos.loading ? <EmptyState icon="tag" title={t('deals.noCombos')} /> : null}
      <div className="grid-cards">
        {combos.data.map((c) => {
          const sum = sumOf(c.items, products.data);
          return (
            <section key={c.id} className="card stack--sm stack" style={{ opacity: c.archived ? 0.6 : 1 }}>
              <div className="deal-card__media" style={{ borderRadius: 12, overflow: 'hidden' }}><StorageImage path={c.imagePath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} /><span className="deal-card__badge">-{c.discountPercent}%</span></div>
              <div className="row" style={{ gap: 6 }}><strong>{L(c.name, business.defaultLocale)}</strong>{c.promoted ? <Badge tone="success" icon="star">{t('deals.promoted').split(' ')[0]}</Badge> : null}{!c.active ? <Badge tone="muted">{t('common.disabled')}</Badge> : null}{c.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}</div>
              <div className="muted wrap-anywhere">{c.items.map((it) => { const p = products.data.find((x) => x.id === it.productId); return `${it.quantity} × ${p ? L(p.name, business.defaultLocale) : '?'}`; }).join(' + ')}</div>
              {sum !== null ? <div className="row"><bdi className="price">{money(comboTotal(sum, c.discountPercent, 1), locale)}</bdi><bdi className="deal-card__was">{money(sum, locale)}</bdi></div> : <Badge tone="danger">{t('deals.unavailable')}</Badge>}
              <div className="row" style={{ gap: 4 }}>
                <IconButton icon="edit" label={t('deals.edit')} onClick={() => setEdit({ id: c.id, d: { name: c.name, description: c.description, items: c.items, discountPercent: c.discountPercent, promoted: c.promoted, active: c.active }, imagePath: c.imagePath })} />
                <Button size="sm" variant="ghost" onClick={() => setArchive(c)}>{c.archived ? t('catalog.unarchive') : t('catalog.archive')}</Button>
              </div>
            </section>
          );
        })}
      </div>
      {edit ? <ComboEditor initial={edit} products={products.data} onClose={() => setEdit(null)} /> : null}
      </> : null}
      {canPromos ? <PromotionsSection /> : null}
      <ConfirmDialog open={!!archive} onClose={() => setArchive(null)} danger={!archive?.archived} title={archive?.archived ? t('catalog.unarchive') : t('catalog.archive')} confirmLabel={t('common.confirm')} onConfirm={async () => { const c = archive!; setArchive(null); await call('setComboArchived', { businessId: business.id, branchId: branch.id, comboId: c.id, archived: !c.archived }).catch((e) => toast(t(errorKey(e)), 'danger')); }} />
    </div>
  );
}

function ComboEditor({ initial, products, onClose }: { initial: { id?: string; d: Draft; imagePath?: string }; products: Product[]; onClose: () => void }) {
  const t = useT();
  const { L, locale, dir } = useI18n();
  const { business, branch } = useDash();
  const [d, setD] = useState<Draft>(initial.d);
  const [comboId, setComboId] = useState(initial.id);
  const [imagePath, setImagePath] = useState(initial.imagePath);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [preview, setPreview] = useState<PromoResult | null>(null);
  const [cutout, setCutout] = useState(false);
  const set = (p: Partial<Draft>) => setD((s) => ({ ...s, ...p }));
  const eligible = useMemo(() => products.filter((p) => p.pricingMode === 'unit' && p.available), [products]);
  const filtered = useMemo(() => { const n = q.trim().toLowerCase(); return n ? eligible.filter((p) => Object.values(p.name).some((x) => x?.toLowerCase().includes(n))) : eligible; }, [eligible, q]);
  const sum = sumOf(d.items, products);
  const price = sum !== null ? comboTotal(sum, d.discountPercent, 1) : null;
  const upsert = (productId: string, variantId: string | undefined, qty: number) => set({ items: qty <= 0 ? d.items.filter((i) => !(i.productId === productId && i.variantId === variantId)) : d.items.some((i) => i.productId === productId && i.variantId === variantId) ? d.items.map((i) => (i.productId === productId && i.variantId === variantId ? { ...i, quantity: qty } : i)) : [...d.items, { productId, variantId, quantity: qty }] });

  const save = async (): Promise<string | null> => {
    setError(null);
    if (!hasAnyTranslation(d.name)) { setError(t('validation.atLeastOneLanguage')); return null; }
    if (d.items.length < 2) { setError(t('deals.minItems')); return null; }
    setBusy(true);
    try {
      const r = await call<{ combo: Combo }>('saveCombo', { businessId: business.id, branchId: branch.id, comboId, combo: d });
      setComboId(r.combo.id);
      toast(t('catalog.savedOk'));
      return r.combo.id;
    } catch (e) { setError(t('catalog.saveFailed') + ' ' + t(errorKey(e))); return null; } finally { setBusy(false); }
  };

  const generate = async () => {
    setGenerating('compose');
    setPreview(null);
    try {
      const sources = await Promise.all(d.items.map(async (it) => { const p = products.find((x) => x.id === it.productId); const srcs = imageSources(p?.imagePath, 'display'); return { url: srcs?.src, fallbackUrl: srcs?.fallback ?? undefined, label: p ? L(p.name, business.defaultLocale) : '', quantity: it.quantity }; }));
      const res = await composePromo(sources, { discountPercent: d.discountPercent, title: L(d.name, business.defaultLocale) || t('deals.combo'), badgeText: t('deals.save', { percent: d.discountPercent }), cutout, dir, onProgress: (stage, detail) => setGenerating(detail ?? stage) });
      setPreview(res);
      if (cutout && !res.cutoutUsed) toast(t('deals.cutoutFailed'), 'danger');
      if (sources.every((s) => !s.url)) toast(t('deals.noPhotos'));
    } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setGenerating(null); }
  };

  const usePhoto = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const id = comboId ?? (await save());
      if (!id) return;
      const path = `businesses/${business.id}/branches/${branch.id}/combos/${id}/${makeId(10)}.jpg`;
      await uploadBytes(sref(storage, path), preview.blob, { contentType: 'image/jpeg' });
      await call('setComboImage', { businessId: business.id, branchId: branch.id, comboId: id, path });
      setImagePath(path);
      setPreview(null);
      toast(t('deals.imageSaved'));
    } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} title={comboId ? t('deals.edit') : t('deals.new')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={async () => { if (await save()) onClose(); }}>{t('common.save')}</Button></>}>
      <div className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => set({ name })} />
        <LocalizedInput label={t('business.about')} value={d.description} multiline onChange={(description) => set({ description })} />
        <section className="stack--sm stack">
          <h3>{t('deals.items')}</h3>
          {d.items.length === 0 ? <p className="muted">{t('deals.minItems')}</p> : null}
          {d.items.map((it) => { const p = products.find((x) => x.id === it.productId); const v = p?.variants.find((x) => x.id === it.variantId); return (
            <div key={`${it.productId}:${it.variantId ?? ''}`} className="combo-picker__row">
              <StorageImage path={p?.imagePath} alt="" square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
              <span className="list__grow">{p ? L(p.name, business.defaultLocale) : it.productId}{v ? ` (${L(v.name, business.defaultLocale)})` : ''} <span className="muted"><bdi>{money((v?.priceAgorot ?? p?.priceAgorot ?? 0) * it.quantity, locale)}</bdi></span></span>
              <Stepper value={it.quantity} min={0} max={20} onChange={(n) => upsert(it.productId, it.variantId, n)} decLabel={t('product.decrease')} incLabel={t('product.increase')} />
            </div>
          ); })}
          <h3>{t('deals.pickItems')}</h3>
          <TextInput label={t('deals.searchMenu')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="combo-picker">
            {filtered.map((p) => {
              const needsVariant = p.variants.length > 0;
              const vid = d.items.find((i) => i.productId === p.id)?.variantId ?? p.variants.find((v) => v.available)?.id;
              return (
                <div key={p.id} className="combo-picker__row">
                  <StorageImage path={p.imagePath} alt="" square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
                  <span className="list__grow">{L(p.name, business.defaultLocale)} <span className="muted"><bdi>{money(p.priceAgorot, locale)}</bdi></span></span>
                  {needsVariant ? <Select label={t('deals.variant', { name: L(p.name, business.defaultLocale) })} value={vid ?? ''} onChange={(e) => upsert(p.id, e.target.value, 1)}>{p.variants.filter((v) => v.available).map((v) => <option key={v.id} value={v.id}>{L(v.name, business.defaultLocale)}</option>)}</Select> : null}
                  <button type="button" className="btn--add" aria-label={`${t('common.add')}: ${L(p.name, business.defaultLocale)}`} onClick={() => { const existing = d.items.find((i) => i.productId === p.id && (!needsVariant || i.variantId === vid)); upsert(p.id, needsVariant ? vid : undefined, (existing?.quantity ?? 0) + 1); }}><Icon name="plus" size={22} /></button>
                </div>
              );
            })}
          </div>
        </section>
        <div className="row">
          <TextInput label={t('deals.discount')} type="number" ltr min={1} max={90} value={d.discountPercent} onChange={(e) => set({ discountPercent: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })} />
          <Checkbox label={t('deals.promoted')} checked={d.promoted} onChange={(e) => set({ promoted: e.target.checked })} />
          <Checkbox label={t('deals.active')} checked={d.active} onChange={(e) => set({ active: e.target.checked })} />
        </div>
        {sum !== null ? <div className="summary card"><div className="summary__row"><span>{t('deals.sum')}</span><bdi className="num">{money(sum, locale)}</bdi></div><div className="summary__row summary__row--total"><span>{t('deals.comboPrice')} · -{d.discountPercent}%</span><bdi className="num">{money(price ?? 0, locale)}</bdi></div></div> : null}
        <section className="stack--sm stack">
          <h3>{t('deals.promoImage')}</h3>
          <p className="muted">{t('deals.generateHelp')}</p>
          {imagePath && !preview ? <StorageImage path={imagePath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} /> : null}
          {preview ? <img className="promo-canvas" src={preview.dataUrl} alt={t('deals.promoImage')} /> : null}
          <Checkbox label={t('deals.cutout')} checked={cutout} onChange={(e) => setCutout(e.target.checked)} />
          <div className="row">
            <Button variant="secondary" icon="image" loading={!!generating} disabled={d.items.length < 2} onClick={generate}>{generating ? t('deals.generating') : t('deals.generateImage')}</Button>
            {preview ? <Button icon="check" loading={busy} onClick={usePhoto}>{t('deals.usePhoto')}</Button> : null}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
