import { useEffect, useMemo, useState } from 'react';
import { ref as sref, uploadBytes, deleteObject } from 'firebase/storage';
import { LOCALES, hasAnyTranslation, makeId, type Category, type Localized, type Product, type ProductInput } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, limit } from '@/lib/queries';
import { Button, Dialog, TextInput, TextArea, Select, Checkbox, Segmented, IconButton, Badge, Alert, EmptyState, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { PageTitle, useDash } from './shell';
import { StorageImage } from '@/customer/StorageImage';

/** Three-language text input group. At least one language is required for required content. */
export function LocalizedInput({ label, value, onChange, required, multiline, error }: { label: string; value: Localized; onChange: (v: Localized) => void; required?: boolean; multiline?: boolean; error?: string }) {
  const t = useT();
  const names: Record<string, string> = { he: t('catalog.nameHe').replace(/^[^(]*/, ''), ar: t('catalog.nameAr').replace(/^[^(]*/, ''), en: t('catalog.nameEn').replace(/^[^(]*/, '') };
  return (
    <fieldset className="stack--sm stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field__label">{label}{required ? <span className="badge badge--accent">{t('common.required')}</span> : <span className="field__optional">({t('common.optional')})</span>}</legend>
      {LOCALES.map((l) => multiline ? (
        <TextArea key={l} label={`${label} ${names[l]}`} value={value[l] ?? ''} lang={l} dir={l === 'en' ? 'ltr' : 'rtl'} onChange={(e) => onChange({ ...value, [l]: e.target.value })} style={{ minHeight: 64 }} />
      ) : (
        <TextInput key={l} label={`${label} ${names[l]}`} value={value[l] ?? ''} lang={l} dir={l === 'en' ? 'ltr' : 'rtl'} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
      ))}
      {error ? <div className="field__error" role="alert"><Icon name="alert" size={14} /> {error}</div> : null}
    </fieldset>
  );
}

function agorotInput(v: number) { return (v / 100).toString(); }
function parseAgorot(s: string) { const n = Number(s.replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; }

export function CatalogPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, branches, can } = useDash();
  const base = `businesses/${business.id}/branches/${branch.id}`;
  const cats = useCollection<Category>(`${base}/categories`, [orderBy('sortOrder'), limit(200)], [branch.id]);
  const prods = useCollection<Product>(`${base}/products`, [orderBy('sortOrder'), limit(1000)], [branch.id]);
  const [catEdit, setCatEdit] = useState<{ id?: string; name: Localized } | null>(null);
  const [prodEdit, setProdEdit] = useState<{ product?: Product; categoryId: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [stockEdit, setStockEdit] = useState<{ product: Product; variantId?: string } | null>(null);
  const [copyTarget, setCopyTarget] = useState<{ productId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const grouped = useMemo(() => { const m = new Map<string, Product[]>(); for (const p of prods.data) { if (!m.has(p.categoryId)) m.set(p.categoryId, []); m.get(p.categoryId)!.push(p); } return m; }, [prods.data]);
  const visibleCats = cats.data.filter((c) => showArchived || !c.archived);
  const move = async (list: string[], id: string, dir: -1 | 1, fn: 'reorderCategories' | 'reorderProducts') => {
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    await call(fn, { businessId: business.id, branchId: branch.id, orderedIds: next }).catch((e) => toast(t(errorKey(e)), 'danger'));
  };
  const saveCategory = async () => {
    if (!catEdit || !hasAnyTranslation(catEdit.name)) return toast(t('validation.atLeastOneLanguage'), 'danger');
    setBusy(true);
    try { await call('saveCategory', { businessId: business.id, branchId: branch.id, categoryId: catEdit.id, category: { name: catEdit.name } }); setCatEdit(null); toast(t('catalog.savedOk')); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); }
  };
  if (!can('catalog')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="stack">
      <PageTitle title={t('dash.catalog')}>
        <Checkbox label={t('catalog.archived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        {branches.length > 1 ? <Button size="sm" variant="secondary" icon="copy" onClick={() => setCopyTarget({})}>{t('catalog.copyTo')}</Button> : null}
        <Button size="sm" variant="secondary" icon="plus" onClick={() => setCatEdit({ name: {} })}>{t('catalog.newCategory')}</Button>
        <Button size="sm" icon="plus" disabled={cats.data.filter((c) => !c.archived).length === 0} onClick={() => setProdEdit({ categoryId: cats.data.find((c) => !c.archived)!.id })}>{t('catalog.newProduct')}</Button>
      </PageTitle>
      {cats.data.length === 0 && !cats.loading ? <EmptyState icon="basket" title={t('catalog.noCategories')} /> : null}
      {visibleCats.map((c) => (
        <section key={c.id} className="card stack" aria-labelledby={`c-${c.id}`}>
          <div className="row row--between">
            <h2 id={`c-${c.id}`} className="row">{L(c.name, business.defaultLocale)} {c.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}</h2>
            <div className="row" style={{ gap: 4 }}>
              <IconButton icon="arrow" label={t('catalog.moveUp')} onClick={() => move(visibleCats.map((x) => x.id), c.id, -1, 'reorderCategories')} style={{ transform: 'rotate(-90deg)' }} />
              <IconButton icon="arrow" label={t('catalog.moveDown')} onClick={() => move(visibleCats.map((x) => x.id), c.id, 1, 'reorderCategories')} style={{ transform: 'rotate(90deg)' }} />
              <IconButton icon="edit" label={t('catalog.editCategory')} onClick={() => setCatEdit({ id: c.id, name: c.name })} />
              <Button size="sm" variant="ghost" onClick={() => call('setCategoryArchived', { businessId: business.id, branchId: branch.id, categoryId: c.id, archived: !c.archived }).catch((e) => toast(e?.details?.issues?.[0]?.message === 'category_has_products' ? t('catalog.deleteCategoryBlocked') : t(errorKey(e)), 'danger'))}>{c.archived ? t('catalog.unarchive') : t('catalog.archive')}</Button>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setProdEdit({ categoryId: c.id })}>{t('catalog.newProduct')}</Button>
            </div>
          </div>
          <ul className="list">
            {(grouped.get(c.id) ?? []).filter((p) => showArchived || !p.archived).map((p, i, arr) => (
              <li key={p.id} className="list__item">
                <StorageImage path={p.imagePath} alt="" square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
                <div className="list__grow">
                  <div className="row" style={{ gap: 6 }}><strong>{L(p.name, business.defaultLocale)}</strong>{p.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}{!p.available ? <Badge tone="danger">{t('common.unavailable')}</Badge> : null}{p.pricingMode === 'weight' ? <Badge tone="neutral">{t('common.perKg')}</Badge> : null}</div>
                  <div className="muted">
                    <bdi>{money(p.priceAgorot, locale)}</bdi>
                    {p.trackInventory ? <> · {t('dash.stock')}: <bdi className="num">{p.variants.length ? p.variants.map((v) => `${L(v.name, business.defaultLocale)} ${v.stockQty ?? 0}`).join(', ') : p.stockQty ?? 0}</bdi></> : null}
                  </div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <IconButton icon="arrow" label={t('catalog.moveUp')} disabled={i === 0} onClick={() => move(arr.map((x) => x.id), p.id, -1, 'reorderProducts')} style={{ transform: 'rotate(-90deg)' }} />
                  <IconButton icon="arrow" label={t('catalog.moveDown')} disabled={i === arr.length - 1} onClick={() => move(arr.map((x) => x.id), p.id, 1, 'reorderProducts')} style={{ transform: 'rotate(90deg)' }} />
                  {p.trackInventory ? <IconButton icon="scale" label={t('catalog.stockAdjust')} onClick={() => setStockEdit({ product: p, variantId: p.variants[0]?.id })} /> : null}
                  {branches.length > 1 ? <IconButton icon="copy" label={t('catalog.copyTo')} onClick={() => setCopyTarget({ productId: p.id })} /> : null}
                  <IconButton icon="edit" label={t('catalog.editProduct')} onClick={() => setProdEdit({ product: p, categoryId: p.categoryId })} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Dialog open={!!catEdit} onClose={() => setCatEdit(null)} title={catEdit?.id ? t('catalog.editCategory') : t('catalog.newCategory')} sheet={false} footer={<><Button variant="secondary" onClick={() => setCatEdit(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={saveCategory}>{t('common.save')}</Button></>}>
        {catEdit ? <LocalizedInput label={t('common.name')} value={catEdit.name} required onChange={(name) => setCatEdit({ ...catEdit, name })} /> : null}
      </Dialog>
      {prodEdit ? <ProductEditor initial={prodEdit.product} categoryId={prodEdit.categoryId} categories={cats.data.filter((c) => !c.archived)} onClose={() => setProdEdit(null)} /> : null}
      {stockEdit ? <StockDialog product={stockEdit.product} onClose={() => setStockEdit(null)} /> : null}
      {copyTarget ? <CopyDialog productId={copyTarget.productId} onClose={() => setCopyTarget(null)} /> : null}
    </div>
  );
}

function StockDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const current = variantId ? product.variants.find((v) => v.id === variantId)?.stockQty ?? 0 : product.stockQty ?? 0;
  const [qty, setQty] = useState(String(current));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setQty(String(current)), [current]);
  return (
    <Dialog open onClose={onClose} title={`${t('catalog.stockAdjust')} · ${L(product.name, business.defaultLocale)}`} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); try { await call('adjustStock', { businessId: business.id, branchId: branch.id, productId: product.id, variantId, newQty: Number(qty), reason: reason.trim() }); toast(t('catalog.savedOk')); onClose(); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('common.save')}</Button></>}>
      <div className="stack">
        {product.variants.length ? <Select label={t('product.size')} value={variantId} onChange={(e) => setVariantId(e.target.value)}>{product.variants.map((v) => <option key={v.id} value={v.id}>{L(v.name, business.defaultLocale)}</option>)}</Select> : null}
        <TextInput label={t('catalog.stockNew')} type="number" inputMode="numeric" min={0} ltr value={qty} onChange={(e) => setQty(e.target.value)} hint={product.pricingMode === 'weight' ? t('common.weight') + ' (g)' : undefined} />
        <TextInput label={t('catalog.stockReason')} required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}

function CopyDialog({ productId, onClose }: { productId?: string; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, branches } = useDash();
  const others = branches.filter((b) => b.id !== branch.id);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog open onClose={onClose} loading={busy} title={t('catalog.copyTo')} confirmLabel={t('common.copy')} body={<div className="stack"><p className="muted">{t('catalog.copyToBody')}</p><Select label={t('dash.branches')} value={target} onChange={(e) => setTarget(e.target.value)}>{others.map((b) => <option key={b.id} value={b.id}>{L(b.name, business.defaultLocale)}</option>)}</Select></div>} onConfirm={async () => { setBusy(true); try { const r = await call<{ copied: number }>('copyToBranch', { businessId: business.id, fromBranchId: branch.id, toBranchId: target, productId }); toast(`${t('catalog.copied')} (${r.copied})`); onClose(); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }} />
  );
}

type Draft = ProductInput & { imagePath?: string };
function draftFrom(p: Product | undefined, categoryId: string): Draft {
  if (!p) return { categoryId, name: {}, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 0, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, stockQty: 0, weightStepGrams: 100, minWeightGrams: 100 };
  const { id: _i, branchId: _b, businessId: _bz, archived: _a, createdAt: _c, updatedAt: _u, imagePath, sortOrder, ...rest } = p;
  return { ...rest, imagePath, sortOrder };
}

export function ProductEditor({ initial, categoryId, categories, onClose }: { initial?: Product; categoryId: string; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const [d, setD] = useState<Draft>(() => draftFrom(initial, categoryId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));
  const save = async () => {
    setError(null);
    if (!hasAnyTranslation(d.name)) return setError(t('validation.atLeastOneLanguage'));
    if (d.priceAgorot < 0) return setError(t('validation.positive'));
    setBusy(true);
    try {
      const { imagePath: _ip, ...product } = d;
      const res = await call<{ product: Product }>('saveProduct', { businessId: business.id, branchId: branch.id, productId: initial?.id, product: { ...product, variants: product.variants.map((v) => ({ ...v, id: v.id || makeId(8) })), modifierGroups: product.modifierGroups.map((g) => ({ ...g, id: g.id || makeId(8), options: g.options.map((o) => ({ ...o, id: o.id || makeId(8) })) })) } });
      toast(t('catalog.savedOk'));
      if (!initial) {
        // Keep editing the new product so a photo can be attached.
        setD(draftFrom(res.product, res.product.categoryId));
      }
      if (initial) onClose();
      return res.product.id;
    } catch (e) {
      setError(t('catalog.saveFailed') + ' ' + t(errorKey(e)));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const productId = initial?.id;
  const upload = async (file: File) => {
    setUploadError(null);
    if (!productId) return setUploadError(t('common.saved') + '?');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return setUploadError(t('catalog.photoHint'));
    setBusy(true);
    try {
      const path = `businesses/${business.id}/branches/${branch.id}/products/${productId}/${makeId(10)}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`;
      await uploadBytes(sref(storage, path), file, { contentType: file.type });
      await call('setProductImage', { businessId: business.id, branchId: branch.id, productId, path });
      set({ imagePath: path });
    } catch {
      setUploadError(t('catalog.photoFailed'));
    } finally {
      setBusy(false);
    }
  };
  const removePhoto = async () => {
    if (!productId || !d.imagePath) return;
    setBusy(true);
    try {
      await call('setProductImage', { businessId: business.id, branchId: branch.id, productId, path: null });
      await deleteObject(sref(storage, d.imagePath)).catch(() => undefined);
      set({ imagePath: undefined });
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={initial ? t('catalog.editProduct') : t('catalog.newProduct')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button></>}>
      <div className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <section className="stack--sm stack">
          <h3>{t('catalog.photo')}</h3>
          <div className="photo-area">
            <StorageImage path={d.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} />
            <div className="stack--sm stack">
              <label className="btn btn--secondary" style={{ cursor: productId ? 'pointer' : 'not-allowed', opacity: productId ? 1 : 0.6 }}><Icon name="image" size={18} /> {t('catalog.uploadPhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" disabled={!productId || busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} /></label>
              {d.imagePath ? <Button size="sm" variant="danger" onClick={removePhoto}>{t('catalog.removePhoto')}</Button> : null}
              <div className="muted">{t('catalog.photoHint')}{!productId ? ` (${t('common.save')} →)` : ''}</div>
              {uploadError ? <div className="field__error" role="alert">{uploadError}</div> : null}
            </div>
          </div>
        </section>
        <p className="muted">{t('catalog.translationsHint')}</p>
        <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => set({ name })} />
        <LocalizedInput label={t('catalog.descHe').replace(/ \(.*\)/, '')} value={d.description} multiline onChange={(description) => set({ description })} />
        <LocalizedInput label={t('catalog.dietary')} value={d.dietaryText} onChange={(dietaryText) => set({ dietaryText })} />
        <Select label={t('catalog.category')} value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{L(c.name, business.defaultLocale)}</option>)}</Select>
        <section className="stack--sm stack">
          <h3>{t('catalog.pricing')}</h3>
          <Segmented label={t('catalog.pricing')} value={d.pricingMode} onChange={(pricingMode) => set({ pricingMode, variants: pricingMode === 'weight' ? [] : d.variants, modifierGroups: pricingMode === 'weight' ? [] : d.modifierGroups })} options={[{ value: 'unit', label: t('catalog.pricingUnit') }, { value: 'weight', label: t('catalog.pricingWeight') }]} />
          <div className="row">
            <TextInput label={d.pricingMode === 'weight' ? t('catalog.pricePerKg') : t('catalog.basePrice')} type="number" inputMode="decimal" min={0} step="0.1" ltr value={agorotInput(d.priceAgorot)} onChange={(e) => set({ priceAgorot: parseAgorot(e.target.value) })} />
            {d.pricingMode === 'weight' ? <><TextInput label={t('catalog.weightStep')} type="number" ltr value={d.weightStepGrams ?? 100} onChange={(e) => set({ weightStepGrams: Number(e.target.value) })} /><TextInput label={t('catalog.minWeight')} type="number" ltr value={d.minWeightGrams ?? 100} onChange={(e) => set({ minWeightGrams: Number(e.target.value) })} /><TextInput label={t('catalog.estimatedGrams')} type="number" ltr optional value={d.estimatedGramsPerUnit ?? ''} onChange={(e) => set({ estimatedGramsPerUnit: e.target.value ? Number(e.target.value) : undefined })} /></> : <><TextInput label={t('catalog.quantityStep')} type="number" ltr min={1} value={d.quantityStep} onChange={(e) => set({ quantityStep: Math.max(1, Number(e.target.value)) })} /><TextInput label={t('catalog.minQuantity')} type="number" ltr min={1} value={d.minQuantity} onChange={(e) => set({ minQuantity: Math.max(1, Number(e.target.value)) })} /></>}
          </div>
          <LocalizedInput label={t('catalog.unitLabel')} value={d.unitLabel} onChange={(unitLabel) => set({ unitLabel })} />
        </section>
        {business.type === 'supermarket' ? (
          <section className="stack--sm stack">
            <div className="row"><TextInput label={t('catalog.brand')} optional value={d.brand ?? ''} onChange={(e) => set({ brand: e.target.value || undefined })} /><TextInput label={t('catalog.sku')} optional ltr value={d.sku ?? ''} onChange={(e) => set({ sku: e.target.value || undefined })} /><TextInput label={t('catalog.barcode')} optional ltr inputMode="numeric" value={d.barcode ?? ''} onChange={(e) => set({ barcode: e.target.value || undefined })} /><TextInput label={t('catalog.packageSize')} optional value={d.packageSize ?? ''} onChange={(e) => set({ packageSize: e.target.value || undefined })} /></div>
          </section>
        ) : null}
        <section className="stack--sm stack">
          <h3>{t('catalog.availability')}</h3>
          <Checkbox label={t('catalog.available')} checked={d.available} onChange={(e) => set({ available: e.target.checked })} />
          <Checkbox label={t('catalog.trackInventory')} checked={d.trackInventory} onChange={(e) => set({ trackInventory: e.target.checked })} />
          {d.trackInventory && d.variants.length === 0 && !initial?.trackInventory ? <TextInput label={t('catalog.stockQty')} type="number" ltr min={0} value={d.stockQty ?? 0} onChange={(e) => set({ stockQty: Number(e.target.value) })} hint={d.pricingMode === 'weight' ? '(g)' : undefined} /> : null}
        </section>
        {d.pricingMode === 'unit' ? (
          <>
            <section className="stack--sm stack">
              <div className="row row--between"><h3>{t('catalog.variants')}</h3><Button size="sm" variant="secondary" icon="plus" onClick={() => set({ variants: [...d.variants, { id: makeId(8), name: {}, priceAgorot: d.priceAgorot, available: true, sortOrder: d.variants.length, stockQty: d.trackInventory ? 0 : undefined }] })}>{t('catalog.addVariant')}</Button></div>
              {d.variants.map((v, i) => (
                <div key={v.id ?? i} className="card stack--sm stack">
                  <LocalizedInput label={t('common.name')} value={v.name} required onChange={(name) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, name } : x)) })} />
                  <div className="row">
                    <TextInput label={t('product.price')} type="number" ltr step="0.1" value={agorotInput(v.priceAgorot)} onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, priceAgorot: parseAgorot(e.target.value) } : x)) })} />
                    {d.trackInventory && !initial?.trackInventory ? <TextInput label={t('catalog.stockQty')} type="number" ltr value={v.stockQty ?? 0} onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, stockQty: Number(e.target.value) } : x)) })} /> : null}
                    <Checkbox label={t('catalog.available')} checked={v.available} onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, available: e.target.checked } : x)) })} />
                    <IconButton icon="trash" label={t('common.remove')} onClick={() => set({ variants: d.variants.filter((_, j) => j !== i) })} />
                  </div>
                </div>
              ))}
            </section>
            <section className="stack--sm stack">
              <div className="row row--between"><h3>{t('catalog.modifierGroups')}</h3><Button size="sm" variant="secondary" icon="plus" onClick={() => set({ modifierGroups: [...d.modifierGroups, { id: makeId(8), name: {}, required: false, minSelect: 0, maxSelect: 0, options: [{ id: makeId(8), name: {}, priceDeltaAgorot: 0, available: true, sortOrder: 0 }], sortOrder: d.modifierGroups.length }] })}>{t('catalog.addGroup')}</Button></div>
              {d.modifierGroups.map((g, gi) => (
                <div key={g.id ?? gi} className="card stack--sm stack">
                  <LocalizedInput label={t('common.name')} value={g.name} required onChange={(name) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, name } : x)) })} />
                  <div className="row">
                    <Checkbox label={t('catalog.groupRequired')} checked={g.required} onChange={(e) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, required: e.target.checked, minSelect: e.target.checked ? Math.max(1, x.minSelect) : x.minSelect } : x)) })} />
                    <TextInput label={t('catalog.minSelect')} type="number" ltr min={0} value={g.minSelect} onChange={(e) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, minSelect: Number(e.target.value) } : x)) })} />
                    <TextInput label={t('catalog.maxSelect')} type="number" ltr min={0} value={g.maxSelect} onChange={(e) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, maxSelect: Number(e.target.value) } : x)) })} />
                    <IconButton icon="trash" label={t('common.remove')} onClick={() => set({ modifierGroups: d.modifierGroups.filter((_, j) => j !== gi) })} />
                  </div>
                  {g.options.map((o, oi) => (
                    <div key={o.id ?? oi} className="soft-block stack--sm stack">
                      <LocalizedInput label={t('common.name')} value={o.name} required onChange={(name) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, name } : y)) } : x)) })} />
                      <div className="row">
                        <TextInput label={t('catalog.priceDelta')} type="number" ltr step="0.1" value={agorotInput(o.priceDeltaAgorot)} onChange={(e) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, priceDeltaAgorot: parseAgorot(e.target.value) } : y)) } : x)) })} />
                        <Checkbox label={t('catalog.available')} checked={o.available} onChange={(e) => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, options: x.options.map((y, k) => (k === oi ? { ...y, available: e.target.checked } : y)) } : x)) })} />
                        <IconButton icon="trash" label={t('common.remove')} disabled={g.options.length <= 1} onClick={() => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, options: x.options.filter((_, k) => k !== oi) } : x)) })} />
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon="plus" onClick={() => set({ modifierGroups: d.modifierGroups.map((x, j) => (j === gi ? { ...x, options: [...x.options, { id: makeId(8), name: {}, priceDeltaAgorot: 0, available: true, sortOrder: x.options.length }] } : x)) })}>{t('catalog.addOption')}</Button>
                </div>
              ))}
            </section>
          </>
        ) : null}
        {initial ? <Button variant={initial.archived ? 'secondary' : 'danger'} onClick={() => setArchiveConfirm(true)}>{initial.archived ? t('catalog.unarchive') : t('catalog.archive')}</Button> : null}
        <ConfirmDialog open={archiveConfirm} onClose={() => setArchiveConfirm(false)} danger={!initial?.archived} title={initial?.archived ? t('catalog.unarchive') : t('catalog.archive')} confirmLabel={t('common.confirm')} onConfirm={async () => { setArchiveConfirm(false); await call('setProductArchived', { businessId: business.id, branchId: branch.id, productId: initial!.id, archived: !initial!.archived }).catch((e) => toast(t(errorKey(e)), 'danger')); onClose(); }} />
      </div>
    </Dialog>
  );
}
