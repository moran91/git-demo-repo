import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { hasAnyTranslation, makeId, productInputSchema, type Category, type Localized, type ModifierGroup, type Product, type ProductInput, type SharedModifierGroup } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, limit } from '@/lib/queries';
import { Button, Dialog, TextInput, Select, Checkbox, Segmented, IconButton, Badge, Alert, EmptyState, Skeleton, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload } from '@/lib/images';
import { PageTitle, useDash } from './shell';
import { FormError, LoadError, SaveStatus, useDraftSafety } from './BusinessExperience';
import { StorageImage } from '@/customer/StorageImage';
import { LocalizedInput } from './LocalizedInput';
import { ModifierGroupFields, agorotInput, newGroupDraft, parseAgorot } from './ModifierGroupFields';
import { SharedGroupDialog } from './ExtrasLibraryPage';
import { ActionSheet, LedgerRow, Switch, type SheetAction } from './CatalogControls';
import './catalog.css';

export { LocalizedInput };


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
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const term = search.trim().toLocaleLowerCase();
  const matches = (name: Localized) => Object.values(name).some((text) => text?.toLocaleLowerCase().includes(term));
  const [stockEdit, setStockEdit] = useState<{ product: Product; variantId?: string } | null>(null);
  const [copyTarget, setCopyTarget] = useState<{ productId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const grouped = useMemo(() => { const m = new Map<string, Product[]>(); for (const p of prods.data) { if (!m.has(p.categoryId)) m.set(p.categoryId, []); m.get(p.categoryId)!.push(p); } return m; }, [prods.data]);
  const liveCats = cats.data.filter((c) => !c.archived);
  const chipCats = cats.data.filter((c) => showArchived || !c.archived);
  const visibleCats = chipCats.filter((c) => (!catFilter || c.id === catFilter) && (!term || matches(c.name) || (grouped.get(c.id) ?? []).some((p) => (showArchived || !p.archived) && matches(p.name))));
  // Reordering sends the visible order, so it is only offered while the full list is on screen.
  const reorderLocked = !!term || !!catFilter;
  const fail = (e: unknown) => toast(t(errorKey(e)), 'danger');
  const name = (l: Localized) => L(l, business.defaultLocale);
  const move = async (list: string[], id: string, dir: -1 | 1, fn: 'reorderCategories' | 'reorderProducts') => {
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    await call(fn, { businessId: business.id, branchId: branch.id, orderedIds: next }).catch(fail);
  };
  const saveCategory = async () => {
    if (!catEdit || !hasAnyTranslation(catEdit.name)) return toast(t('validation.atLeastOneLanguage'), 'danger');
    setBusy(true);
    try { await call('saveCategory', { businessId: business.id, branchId: branch.id, categoryId: catEdit.id, category: { name: catEdit.name } }); setCatEdit(null); toast(t('catalog.savedOk')); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  /** Save only availability so another editor's changes remain intact. */
  const setAvailable = async (p: Product, available: boolean) => {
    setPending((ids) => new Set(ids).add(p.id));
    try {
      await call('setProductAvailable', { businessId: business.id, branchId: branch.id, productId: p.id, available });
    } catch (e) { fail(e); } finally { setPending((ids) => { const next = new Set(ids); next.delete(p.id); return next; }); }
  };
  const reorderHint = reorderLocked ? t('catalog.reorderDisabled') : undefined;
  const categoryActions = (c: Category): SheetAction[] => {
    const ids = visibleCats.map((x) => x.id);
    return [
      { label: t('catalog.editCategory'), icon: 'edit', onSelect: () => setCatEdit({ id: c.id, name: c.name }) },
      { label: t('catalog.moveUp'), icon: 'chevronDown', flip: true, disabled: reorderLocked || ids[0] === c.id, hint: reorderHint, onSelect: () => void move(ids, c.id, -1, 'reorderCategories') },
      { label: t('catalog.moveDown'), icon: 'chevronDown', disabled: reorderLocked || ids.at(-1) === c.id, hint: reorderHint, onSelect: () => void move(ids, c.id, 1, 'reorderCategories') },
      { label: c.archived ? t('catalog.unarchive') : t('catalog.archive'), icon: c.archived ? 'refresh' : 'trash', danger: !c.archived, onSelect: () => void call('setCategoryArchived', { businessId: business.id, branchId: branch.id, categoryId: c.id, archived: !c.archived }).catch((e) => toast(e?.details?.issues?.[0]?.message === 'category_has_products' ? t('catalog.deleteCategoryBlocked') : t(errorKey(e)), 'danger')) },
    ];
  };
  const productActions = (p: Product, i: number, arr: Product[]): SheetAction[] => {
    const ids = arr.map((x) => x.id);
    const items: SheetAction[] = [
      { label: t('product.mostOrdered'), icon: 'star', pressed: !!p.mostOrdered, onSelect: () => void call('setProductMostOrdered', { businessId: business.id, branchId: branch.id, productId: p.id, mostOrdered: !p.mostOrdered }).catch(fail) },
    ];
    if (p.trackInventory) items.push({ label: t('catalog.stockAdjust'), icon: 'scale', onSelect: () => setStockEdit({ product: p, variantId: p.variants[0]?.id }) });
    if (branches.length > 1) items.push({ label: t('catalog.copyTo'), icon: 'copy', onSelect: () => setCopyTarget({ productId: p.id }) });
    items.push(
      { label: t('catalog.moveUp'), icon: 'chevronDown', flip: true, disabled: reorderLocked || i === 0, hint: reorderHint, onSelect: () => void move(ids, p.id, -1, 'reorderProducts') },
      { label: t('catalog.moveDown'), icon: 'chevronDown', disabled: reorderLocked || i === arr.length - 1, hint: reorderHint, onSelect: () => void move(ids, p.id, 1, 'reorderProducts') },
      { label: p.archived ? t('catalog.unarchive') : t('catalog.archive'), icon: p.archived ? 'refresh' : 'trash', danger: !p.archived, onSelect: () => void call('setProductArchived', { businessId: business.id, branchId: branch.id, productId: p.id, archived: !p.archived }).catch(fail) },
    );
    return items;
  };
  if (!can('catalog')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  if (cats.error || prods.error) return <LoadError />;
  if (cats.loading || prods.loading) return <Skeleton height={260} />;
  const priceLabel = (p: Product) => {
    if (!p.variants.length) return money(p.priceAgorot, locale);
    const prices = p.variants.map((v) => v.priceAgorot);
    const lo = Math.min(...prices); const hi = Math.max(...prices);
    return lo === hi ? money(lo, locale) : `${money(lo, locale)}–${money(hi, locale)}`;
  };
  const variantsLabel = (p: Product) => p.variants.map((v) => `${name(v.name)} ${money(v.priceAgorot, locale)}`).join(' · ');
  return (
    <div className="stack catalog">
      <PageTitle title={t('dash.catalog')}>
        <Link className="btn btn--secondary" to="extras"><Icon name="tag" size={18} /> {t('catalog.library')}</Link>
        <Button icon="plus" disabled={liveCats.length === 0} onClick={() => setProdEdit({ categoryId: liveCats[0]!.id })}>{t('catalog.newProduct')}</Button>
      </PageTitle>
      <div className="catalog-search">
        <label htmlFor="catalog-search" className="visually-hidden">{t('owner.searchCatalog')}</label>
        <Icon name="search" size={22} className="icon catalog-search__icon" />
        <input id="catalog-search" type="search" className="input" placeholder={t('owner.searchCatalog')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {cats.data.length > 0 ? (
        <div className="chips catalog-chips" role="group" aria-label={t('catalog.category')}>
          <button type="button" className="chip" aria-pressed={catFilter === null} onClick={() => setCatFilter(null)}>{t('deals.allCategories')}</button>
          {chipCats.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={catFilter === c.id} onClick={() => setCatFilter(catFilter === c.id ? null : c.id)}>
              {name(c.name)} <span className="chip__count">{(grouped.get(c.id) ?? []).filter((p) => showArchived || !p.archived).length}</span>
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={showArchived} onClick={() => { setShowArchived((v) => !v); setCatFilter(null); }}>{t('catalog.archived')}</button>
        </div>
      ) : null}
      {liveCats.length === 0 && !showArchived ? <EmptyState icon="basket" title={t('catalog.noCategories')} body={t('owner.catalogStart')} action={<Button icon="plus" onClick={() => setCatEdit({ name: {} })}>{t('catalog.newCategory')}</Button>} /> : visibleCats.length === 0 ? <EmptyState title={t('owner.noMatches')} /> : null}
      {visibleCats.map((c) => {
        const items = (grouped.get(c.id) ?? []).filter((p) => (showArchived || !p.archived) && (!term || matches(c.name) || matches(p.name)));
        return (
          <section key={c.id} className="card ccat" aria-labelledby={`c-${c.id}`}>
            <div className="ccat__head">
              <h2 id={`c-${c.id}`} className="ccat__title">
                {name(c.name)}
                <span className="ccat__count">{t(items.length === 1 ? 'catalog.productCount.one' : 'catalog.productCount.other', { count: items.length })}</span>
                {c.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}
              </h2>
              <IconButton icon="plus" label={t('catalog.newProduct')} disabled={c.archived} onClick={() => setProdEdit({ categoryId: c.id })} />
              <ActionSheet title={name(c.name)} actions={categoryActions(c)} />
            </div>
            {items.length === 0 ? <p className="muted ccat__empty">{t('catalog.categoryEmpty')}</p> : (
              <ul className="ccat__list">
                {items.map((p, i, arr) => (
                  <li key={p.id} className={`list__item--catalog prow ${p.archived ? 'prow--archived' : ''}`}>
                    <StorageImage path={p.imagePath} alt="" square className="prow__img" fallbackLabel={t('discovery.imageFallback')} />
                    <div className="prow__body">
                      <span className="prow__name">{name(p.name)}</span>
                      {(p.mostOrdered || p.archived || p.pricingMode === 'weight') ? (
                        <div className="prow__badges">
                          {p.mostOrdered ? <Badge tone="accent" icon="star">{t('product.mostOrdered')}</Badge> : null}
                          {p.archived ? <Badge tone="muted">{t('catalog.archived')}</Badge> : null}
                          {p.pricingMode === 'weight' ? <Badge tone="neutral">{t('common.perKg')}</Badge> : null}
                        </div>
                      ) : null}
                      <div className="prow__meta">
                        <bdi className="prow__price">{priceLabel(p)}</bdi>
                        {p.variants.length ? <span className="prow__variants" title={variantsLabel(p)}>{variantsLabel(p)}</span> : null}
                        {p.variants.length ? <span className="prow__vcount">{t(p.variants.length === 1 ? 'catalog.variantCount.one' : 'catalog.variantCount.other', { count: p.variants.length })}</span> : null}
                        {p.trackInventory ? <span className="prow__stock">{t('dash.stock')}: <bdi>{p.variants.length ? p.variants.map((v) => `${name(v.name)} ${v.stockQty ?? 0}`).join(', ') : p.stockQty ?? 0}</bdi></span> : null}
                      </div>
                    </div>
                    <div className="prow__ctl">
                      <Switch checked={p.available} label={`${t('catalog.available')}: ${name(p.name)}`} busy={pending.has(p.id)} disabled={pending.has(p.id) || p.archived} onChange={(available) => void setAvailable(p, available)} />
                      <span className="prow__ctl-end">
                        <IconButton icon="edit" size={22} label={`${t('common.edit')}: ${name(p.name)}`} className="prow__edit" onClick={() => setProdEdit({ product: p, categoryId: p.categoryId })} />
                        <ActionSheet title={name(p.name)} actions={productActions(p, i, arr)} className="prow__more" />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {liveCats.length > 0 ? (
        <div className="catalog-foot">
          <Button variant="secondary" icon="plus" block onClick={() => setCatEdit({ name: {} })}>{t('catalog.newCategory')}</Button>
          {branches.length > 1 ? <Button variant="ghost" icon="copy" block onClick={() => setCopyTarget({})}>{t('catalog.copyTo')}</Button> : null}
        </div>
      ) : null}
      <Dialog open={!!catEdit} onClose={() => setCatEdit(null)} title={catEdit?.id ? t('catalog.editCategory') : t('catalog.newCategory')} footer={<><Button variant="secondary" onClick={() => setCatEdit(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={saveCategory}>{t('common.save')}</Button></>}>
        {catEdit ? <LocalizedInput tabbed label={t('common.name')} value={catEdit.name} required onChange={(name) => setCatEdit({ ...catEdit, name })} /> : null}
      </Dialog>
      {prodEdit ? <ProductEditor initial={prodEdit.product} categoryId={prodEdit.categoryId} categories={liveCats} onClose={() => setProdEdit(null)} /> : null}
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
  // Typed quantities are kept per variant, so switching the size shows that size's current stock.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const qty = typed[variantId ?? ''] ?? String(current);
  const setQty = (v: string) => setTyped((s) => ({ ...s, [variantId ?? '']: v }));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={`${t('catalog.stockAdjust')} · ${L(product.name, business.defaultLocale)}`} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={reason.trim().length < 2 || qty.trim() === '' || !Number.isInteger(Number(qty)) || Number(qty) < 0 || Number(qty) > 1000000} onClick={async () => { setBusy(true); try { await call('adjustStock', { businessId: business.id, branchId: branch.id, productId: product.id, variantId, newQty: Number(qty), reason: reason.trim() }); toast(t('catalog.savedOk')); onClose(); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('common.save')}</Button></>}>
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
  if (!p) return { categoryId, name: {}, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 0, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, stockQty: 0, weightStepGrams: 100, minWeightGrams: 100, mostOrdered: false };
  // Callable responses encode omitted optional values as null; Firestore snapshots omit them.
  // Normalize both sources, including variant/extra fields, before editing and validating.
  const normalized = JSON.parse(JSON.stringify(p, (_key, value) => value === null ? undefined : value)) as Product;
  const { id: _i, branchId: _b, businessId: _bz, archived: _a, createdAt: _c, updatedAt: _u, imagePath, sortOrder, ...rest } = normalized;
  return { ...rest, imagePath, sortOrder };
}

export function ProductEditor({ initial, categoryId, categories, onClose }: { initial?: Product; categoryId: string; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const [savedProduct, setSavedProduct] = useState(initial);
  const [d, setD] = useState<Draft>(() => draftFrom(initial, categoryId));
  const safety = useDraftSafety({ ...d, imagePath: undefined });
  const close = () => { if (!busy && safety.confirmDiscard()) onClose(); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));
  const save = async () => {
    setError(null);
    if (!hasAnyTranslation(d.name)) return setError(t('validation.atLeastOneLanguage'));
    const { imagePath: _image, ...validated } = d;
    if (!productInputSchema.safeParse(validated).success) return setError(t('owner.invalidProduct'));
    setBusy(true);
    try {
      const { imagePath: _ip, ...product } = d;
      const res = await call<{ product: Product }>('saveProduct', { businessId: business.id, branchId: branch.id, productId: savedProduct?.id, product: { ...product, variants: product.variants.map((v) => ({ ...v, id: v.id || makeId(8) })), modifierGroups: product.modifierGroups.map((g) => ({ ...g, id: g.id || makeId(8), options: g.options.map((o) => ({ ...o, id: o.id || makeId(8) })) })) } });
      toast(t('catalog.savedOk'));
      const next = draftFrom(res.product, res.product.categoryId);
      safety.markSaved({ ...next, imagePath: undefined });
      setD(next);
      setSavedProduct(res.product);
      if (savedProduct) onClose();
      return res.product.id;
    } catch (e) {
      setError(t('catalog.saveFailed') + ' ' + t(errorKey(e)));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const productId = savedProduct?.id;
  const upload = async (file: File) => {
    setUploadError(null);
    if (!productId) return; // the input is disabled without one; the prompt is shown under the button
    setBusy(true);
    try {
      const image = await prepareImageUpload(file);
      const path = `businesses/${business.id}/branches/${branch.id}/products/${productId}/${makeId(10)}.${image.ext}`;
      await uploadBytes(sref(storage, path), image.blob, { contentType: image.contentType });
      await recordUpload(path, () => call('setProductImage', { businessId: business.id, branchId: branch.id, productId, path }));
      set({ imagePath: path });
    } catch (e) {
      setUploadError(t(uploadErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  const removePhoto = async () => {
    if (!productId || !d.imagePath) return;
    setBusy(true);
    try {
      // `setProductImage` deletes the object and the `_thumb`/`_display` variants the resize trigger
      // derived from it. Deleting from here too would race the server and, because the client only
      // ever knew the original's path, could never have cleaned up the variants anyway.
      await call('setProductImage', { businessId: business.id, branchId: branch.id, productId, path: null });
      set({ imagePath: undefined });
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const weight = d.pricingMode === 'weight';
  // Pricing mode + steps: on the first screen for supermarkets (weighed goods are the norm), under
  // "more settings" for restaurants, where nearly everything is priced per unit.
  const pricing = (
    <section className="pe-card">
      <h3>{t('catalog.pricing')}</h3>
      <Segmented label={t('catalog.pricing')} value={d.pricingMode} onChange={(pricingMode) => set({ pricingMode, variants: pricingMode === 'weight' ? [] : d.variants, modifierGroups: pricingMode === 'weight' ? [] : d.modifierGroups })} options={[{ value: 'unit', label: t('catalog.pricingUnit') }, { value: 'weight', label: t('catalog.pricingWeight') }]} />
      <div className="pgrid2">
        {weight ? <><TextInput label={t('catalog.weightStep')} type="number" ltr value={d.weightStepGrams ?? 100} onChange={(e) => set({ weightStepGrams: Number(e.target.value) })} /><TextInput label={t('catalog.minWeight')} type="number" ltr value={d.minWeightGrams ?? 100} onChange={(e) => set({ minWeightGrams: Number(e.target.value) })} /><TextInput label={t('catalog.estimatedGrams')} type="number" ltr optional value={d.estimatedGramsPerUnit ?? ''} onChange={(e) => set({ estimatedGramsPerUnit: e.target.value ? Number(e.target.value) : undefined })} /></> : <><TextInput label={t('catalog.quantityStep')} type="number" ltr min={1} value={d.quantityStep} onChange={(e) => set({ quantityStep: Math.max(1, Number(e.target.value)) })} /><TextInput label={t('catalog.minQuantity')} type="number" ltr min={1} value={d.minQuantity} onChange={(e) => set({ minQuantity: Math.max(1, Number(e.target.value)) })} /></>}
      </div>
      <LocalizedInput tabbed label={t('catalog.unitLabel')} value={d.unitLabel} onChange={(unitLabel) => set({ unitLabel })} />
    </section>
  );
  const supermarket = business.type === 'supermarket';
  return (
    <Dialog open onClose={close} title={savedProduct ? t('catalog.editProduct') : t('catalog.newProduct')} footer={<>
      <div className="pe-foot__status"><SaveStatus {...safety} /></div>
      {initial ? <IconButton icon={initial.archived ? 'refresh' : 'trash'} label={initial.archived ? t('catalog.unarchive') : t('catalog.archive')} className={`pe-archive ${initial.archived ? 'pe-archive--restore' : ''}`} disabled={busy} onClick={() => setArchiveConfirm(true)} /> : null}
      <Button variant="secondary" disabled={busy} onClick={close}>{t(savedProduct && !safety.dirty ? 'deals.done' : 'common.cancel')}</Button>
      <Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
    </>}>
      <fieldset className="stack form-fields" disabled={busy}>
        <FormError message={error} />
        {!initial && savedProduct ? <Alert tone="success">{t('owner.productCreated')}</Alert> : null}
        <section className="card pe-card">
          <LocalizedInput tabbed label={t('common.name')} value={d.name} required onChange={(name) => set({ name })} />
          <div className="pgrid2">
            <Select label={t('catalog.category')} value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{L(c.name, business.defaultLocale)}</option>)}</Select>
            <TextInput label={weight ? t('catalog.pricePerKg') : t('catalog.basePrice')} type="number" inputMode="decimal" min={0} step="0.1" ltr value={agorotInput(d.priceAgorot)} onChange={(e) => set({ priceAgorot: parseAgorot(e.target.value) })} />
          </div>
          <div className="kvrow-list">
            <LedgerRow label={t('catalog.available')}><Switch checked={d.available} label={t('catalog.available')} onChange={(available) => set({ available })} /></LedgerRow>
          </div>
        </section>
        {supermarket ? pricing : null}
        <section className="card pe-card">
          <h3>{t('catalog.photo')}</h3>
          <div className="pe-photo">
            <StorageImage path={d.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} />
            <div className="pe-photo__actions">
              <label className={`btn btn--secondary ${!productId || busy ? 'is-busy' : ''}`}><Icon name="image" size={18} /> {busy ? t('catalog.photoUploading') : t('catalog.uploadPhoto')}<input type="file" accept={UPLOAD_ACCEPT} className="visually-hidden" disabled={!productId || busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
              {d.imagePath ? <Button variant="danger" onClick={removePhoto}>{t('catalog.removePhoto')}</Button> : null}
              {uploadError ? <div className="field__error" role="alert"><Icon name="alert" size={14} /> {uploadError}</div> : null}
              <div className="field__hint">{productId ? t('catalog.photoHint') : t('catalog.photoSaveFirst')}</div>
            </div>
          </div>
        </section>
        {!weight ? <ModifierGroupsSection groups={d.modifierGroups} onChange={(modifierGroups) => set({ modifierGroups })} /> : null}
        <details className="pe-more">
          <summary>{t('owner.advanced')}<Icon name="chevronDown" size={22} /></summary>
          <div className="stack pe-more__body">
            <LocalizedInput tabbed label={t('catalog.descHe').replace(/ \(.*\)/, '')} value={d.description} multiline onChange={(description) => set({ description })} />
            <LocalizedInput tabbed label={t('catalog.dietary')} value={d.dietaryText} onChange={(dietaryText) => set({ dietaryText })} />
            {supermarket ? (
              <div className="pgrid2"><TextInput label={t('catalog.brand')} optional value={d.brand ?? ''} onChange={(e) => set({ brand: e.target.value || undefined })} /><TextInput label={t('catalog.sku')} optional ltr value={d.sku ?? ''} onChange={(e) => set({ sku: e.target.value || undefined })} /><TextInput label={t('catalog.barcode')} optional ltr inputMode="numeric" value={d.barcode ?? ''} onChange={(e) => set({ barcode: e.target.value || undefined })} /><TextInput label={t('catalog.packageSize')} optional value={d.packageSize ?? ''} onChange={(e) => set({ packageSize: e.target.value || undefined })} /></div>
            ) : null}
            <section className="pe-card">
              <h3>{t('catalog.availability')}</h3>
              <div className="kvrow-list">
                <LedgerRow label={t('product.mostOrdered')}><Switch checked={!!d.mostOrdered} label={t('product.mostOrdered')} onChange={(mostOrdered) => set({ mostOrdered })} /></LedgerRow>
                <LedgerRow label={t('catalog.trackInventory')}><Switch checked={d.trackInventory} label={t('catalog.trackInventory')} onChange={(trackInventory) => set({ trackInventory })} /></LedgerRow>
              </div>
              {d.trackInventory && d.variants.length === 0 && !savedProduct?.trackInventory ? <TextInput label={t('catalog.stockQty')} type="number" ltr min={0} value={d.stockQty ?? 0} onChange={(e) => set({ stockQty: Number(e.target.value) })} hint={weight ? '(g)' : undefined} /> : null}
            </section>
            {supermarket ? null : pricing}
            {!weight ? (
              <section className="pe-card">
                <div className="section-head"><h3>{t('catalog.variants')}</h3><Button size="sm" variant="secondary" icon="plus" onClick={() => set({ variants: [...d.variants, { id: makeId(8), name: {}, priceAgorot: d.priceAgorot, available: true, sortOrder: d.variants.length, stockQty: d.trackInventory ? 0 : undefined }] })}>{t('catalog.addVariant')}</Button></div>
                {d.variants.length ? (
                  <ul className="crows">
                    {d.variants.map((v, i) => (
                      <li key={v.id ?? i} className="crow">
                        <div className="crow__body">
                          <LocalizedInput tabbed label={t('common.name')} value={v.name} required onChange={(name) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, name } : x)) })} />
                          <div className="pgrid2">
                            <TextInput label={t('product.price')} type="number" ltr step="0.1" value={agorotInput(v.priceAgorot)} onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, priceAgorot: parseAgorot(e.target.value) } : x)) })} />
                            {d.trackInventory && !savedProduct?.trackInventory ? <TextInput label={t('catalog.stockQty')} type="number" ltr value={v.stockQty ?? 0} onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, stockQty: Number(e.target.value) } : x)) })} /> : null}
                            <Checkbox label={t('catalog.available')} checked={v.available} onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, available: e.target.checked } : x)) })} />
                          </div>
                        </div>
                        <IconButton icon="trash" label={t('common.remove')} className="crow__self-start" onClick={() => set({ variants: d.variants.filter((_, j) => j !== i) })} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </div>
        </details>
        <ConfirmDialog open={archiveConfirm} onClose={() => setArchiveConfirm(false)} danger={!initial?.archived} title={initial?.archived ? t('catalog.unarchive') : t('catalog.archive')} confirmLabel={t('common.confirm')} onConfirm={async () => { setArchiveConfirm(false); try { await call('setProductArchived', { businessId: business.id, branchId: branch.id, productId: initial!.id, archived: !initial!.archived }); safety.markSaved(); onClose(); } catch (e) { toast(t(errorKey(e)), 'danger'); } }} />
      </fieldset>
    </Dialog>
  );
}

/** Materialised product-side copy of a library group (same shape the server writes on save). */
function linkGroup(s: SharedModifierGroup, id: string, sortOrder: number): ModifierGroup {
  return { id, sortOrder, sharedGroupId: s.id, name: s.name, required: s.required, minSelect: s.minSelect, maxSelect: s.maxSelect, options: s.options.map((o) => ({ ...o })), placement: s.placement };
}

type GroupIn = ProductInput['modifierGroups'][number];
/** Option groups as a row list: name + badges + option summary, one Edit control, the rest in a sheet.
 *  A local group opens in its own sheet; a linked one opens the library editor. */
function ModifierGroupsSection({ groups, onChange }: { groups: GroupIn[]; onChange: (g: GroupIn[]) => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch } = useDash();
  const library = useCollection<SharedModifierGroup>(`businesses/${business.id}/branches/${branch.id}/modifierGroups`, [orderBy('sortOrder'), limit(200)], [branch.id]);
  const byId = useMemo(() => new Map(library.data.map((g) => [g.id, g])), [library.data]);
  const [promote, setPromote] = useState<number | null>(null); // index of a local group being saved to the library
  const [editShared, setEditShared] = useState<{ index: number; shared: SharedModifierGroup } | null>(null);
  const [editLocal, setEditLocal] = useState<number | null>(null);
  const update = (i: number, next: GroupIn) => onChange(groups.map((x, j) => (j === i ? next : x)));
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= groups.length) return; const next = [...groups]; [next[i], next[j]] = [next[j]!, next[i]!]; onChange(next.map((g, k) => ({ ...g, sortOrder: k }))); };
  const withIds = (o: GroupIn['options']) => o.map((x) => ({ ...x, id: x.id ?? makeId(8) }));
  const ident = (g: GroupIn, i: number) => ({ id: g.id ?? makeId(8), sortOrder: g.sortOrder ?? i });
  const linkable = library.data.filter((g) => !g.archived && !groups.some((x) => x.sharedGroupId === g.id));
  const name = (l: Localized) => L(l, business.defaultLocale);
  const addLocal = () => { onChange([...groups, { id: makeId(8), sortOrder: groups.length, ...newGroupDraft() }]); setEditLocal(groups.length); };
  const addActions: SheetAction[] = [
    { label: t('catalog.addGroup'), icon: 'plus', onSelect: addLocal },
    ...linkable.map((s): SheetAction => ({ label: name(s.name), icon: 'tag', hint: t('catalog.addFromLibrary'), onSelect: () => onChange([...groups, linkGroup(s, makeId(8), groups.length)]) })),
  ];
  const summary = (g: GroupIn) => g.options.map((o) => `${name(o.name)}${o.priceDeltaAgorot ? ` (${money(o.priceDeltaAgorot, locale)})` : ''}`).join(' · ');
  const editing = editLocal !== null ? groups[editLocal] : undefined;
  return (
    <section className="card pe-card">
      <div className="section-head">
        <h3>{t('catalog.modifierGroups')}</h3>
        {linkable.length ? <ActionSheet icon="plus" label={t('common.add')} title={t('catalog.modifierGroups')} actions={addActions} labelled /> : <Button variant="secondary" icon="plus" aria-label={t('catalog.addGroup')} onClick={addLocal}>{t('common.add')}</Button>}
      </div>
      {groups.length === 0 ? <p className="field__hint">{t('catalog.noGroups')}</p> : null}
      {groups.map((g, gi) => {
        const shared = g.sharedGroupId ? byId.get(g.sharedGroupId) : undefined;
        // Linked: show the library's current content (what the server will write) read-only.
        const view = shared ? linkGroup(shared, ident(g, gi).id, ident(g, gi).sortOrder) : g;
        const actions: SheetAction[] = [
          { label: t('catalog.moveUp'), icon: 'chevronDown', flip: true, disabled: gi === 0, onSelect: () => move(gi, -1) },
          { label: t('catalog.moveDown'), icon: 'chevronDown', disabled: gi === groups.length - 1, onSelect: () => move(gi, 1) },
          g.sharedGroupId
            ? { label: t('catalog.detach'), icon: 'edit', hint: t('catalog.linkedGroupHint'), onSelect: () => { const { sharedGroupId: _s, ...rest } = view; update(gi, rest); toast(t('catalog.detached')); } }
            : { label: t('catalog.saveToLibrary'), icon: 'tag', onSelect: () => setPromote(gi) },
          { label: t('common.remove'), icon: 'trash', danger: true, onSelect: () => onChange(groups.filter((_, j) => j !== gi)) },
        ];
        return (
          <div key={g.id ?? gi} className="grow">
            <div className="grow__body">
              <div className="grow__head">
                <span>{name(view.name) || t('catalog.editGroup')}</span>
                {view.required ? <Badge tone="neutral">{t('catalog.groupRequired')}</Badge> : null}
                {g.sharedGroupId ? <Badge tone="accent" icon="tag">{t('catalog.linkedGroup')}</Badge> : null}
              </div>
              <div className="muted grow__opts">{summary(view)}</div>
            </div>
            {shared ? <IconButton icon="external" label={t('catalog.editInLibrary')} className="prow__edit" onClick={() => setEditShared({ index: gi, shared })} /> : !g.sharedGroupId ? <IconButton icon="edit" label={t('common.edit')} className="prow__edit" onClick={() => setEditLocal(gi)} /> : null}
            <ActionSheet title={name(view.name) || t('catalog.editGroup')} actions={actions} />
          </div>
        );
      })}
      {editing && editLocal !== null ? (
        <Dialog open onClose={() => setEditLocal(null)} title={t('catalog.editGroup')} footer={<Button onClick={() => setEditLocal(null)}>{t('deals.done')}</Button>}>
          <div className="stack">
            <ModifierGroupFields value={{ name: editing.name, required: editing.required, minSelect: editing.minSelect, maxSelect: editing.maxSelect, options: withIds(editing.options), placement: editing.placement }} onChange={(next) => update(editLocal, { ...editing, ...next })} />
          </div>
        </Dialog>
      ) : null}
      {promote !== null && groups[promote] ? (
        <SharedGroupDialog initial={{ name: groups[promote].name, required: groups[promote].required, minSelect: groups[promote].minSelect, maxSelect: groups[promote].maxSelect, options: withIds(groups[promote].options), placement: groups[promote].placement }} onClose={() => setPromote(null)} onSaved={(s) => { const { id, sortOrder } = ident(groups[promote]!, promote); update(promote, linkGroup(s, id, sortOrder)); toast(t('catalog.savedToLibrary')); }} />
      ) : null}
      {editShared ? (
        <SharedGroupDialog id={editShared.shared.id} initial={{ name: editShared.shared.name, required: editShared.shared.required, minSelect: editShared.shared.minSelect, maxSelect: editShared.shared.maxSelect, options: editShared.shared.options, placement: editShared.shared.placement }} onClose={() => setEditShared(null)} onSaved={(s) => { const { id, sortOrder } = ident(groups[editShared.index]!, editShared.index); update(editShared.index, linkGroup(s, id, sortOrder)); }} />
      ) : null}
    </section>
  );
}
