import { useEffect, useMemo, useRef, useState } from 'react';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { MAX_STORY_ITEMS, hasAnyTranslation, makeId, productInputSchema, type Category, type Localized, type ModifierGroup, type Product, type ProductInput, type SharedModifierGroup } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, limit } from '@/lib/queries';
import { Button, Dialog, TextInput, Select, Segmented, IconButton, Badge, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload } from '@/lib/images';
import { useDash } from './shell';
import { FormError, useDraftSafety } from './BusinessExperience';
import { StorageImage } from '@/customer/StorageImage';
import { LangSwitch, LocalizedInput, initialLang, missingLangs, type Loc } from './LocalizedInput';
import { ModifierGroupFields, agorotInput, effectiveMin, newGroupDraft, parseAgorot } from './ModifierGroupFields';
import { EditLines, MoneyInput } from './EditLines';
import { SharedGroupDialog } from './ExtrasLibraryPage';
import { ActionSheet, LedgerRow, Switch, storyIssue, type SheetAction } from './CatalogControls';
import './catalog.css';

export { LocalizedInput };


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

export function CopyDialog({ productId, onClose }: { productId?: string; onClose: () => void }) {
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
  if (!p) return { categoryId, name: {}, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 0, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, stockQty: 0, weightStepGrams: 100, minWeightGrams: 100, mostOrdered: false, inStories: false };
  // Callable responses encode omitted optional values as null; Firestore snapshots omit them.
  // Normalize both sources, including variant/extra fields, before editing and validating.
  const normalized = JSON.parse(JSON.stringify(p, (_key, value) => value === null ? undefined : value)) as Product;
  const { id: _i, branchId: _b, businessId: _bz, archived: _a, createdAt: _c, updatedAt: _u, imagePath, sortOrder, ...rest } = normalized;
  return { ...rest, imagePath, sortOrder };
}

type GroupIn = ProductInput['modifierGroups'][number];

/** Materialised product-side copy of a library group (same shape the server writes on save). */
function linkGroup(s: SharedModifierGroup, id: string, sortOrder: number): ModifierGroup {
  return { id, sortOrder, sharedGroupId: s.id, name: s.name, required: s.required, minSelect: s.minSelect, maxSelect: s.maxSelect, options: s.options.map((o) => ({ ...o })), placement: s.placement };
}

/** Item sheet: photo + name hero, sizes and extras as one-line rows, the rest under "More". One language
 *  switch in the header drives every text field. An extras group opens as a second page of the same sheet. */
export function ProductEditor({ initial, categoryId, categories, onClose }: { initial?: Product; categoryId: string; categories: Category[]; onClose: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, branches } = useDash();
  const [savedProduct, setSavedProduct] = useState(initial);
  const [stockOpen, setStockOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [d, setD] = useState<Draft>(() => draftFrom(initial, categoryId));
  const safety = useDraftSafety({ ...d, imagePath: undefined });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [lang, setLang] = useState<Loc>(() => initialLang(locale as Loc, d.name, d.description));
  const [groupAt, setGroupAt] = useState<number | null>(null);
  const [promote, setPromote] = useState<number | null>(null); // index of a local group being saved to the library
  const [editShared, setEditShared] = useState<{ index: number; shared: SharedModifierGroup } | null>(null);
  // A photo picked before the first save is held here and uploaded right after the save succeeds.
  const [held, setHeld] = useState<File | null>(null);
  const heldUrl = useMemo(() => (held ? URL.createObjectURL(held) : null), [held]);
  useEffect(() => () => { if (heldUrl) URL.revokeObjectURL(heldUrl); }, [heldUrl]);
  const heroRef = useRef<HTMLDivElement>(null);
  const library = useCollection<SharedModifierGroup>(`businesses/${business.id}/branches/${branch.id}/modifierGroups`, [orderBy('sortOrder'), limit(200)], [branch.id]);
  const byId = useMemo(() => new Map(library.data.map((g) => [g.id, g])), [library.data]);
  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));
  const close = () => { if (!busy && safety.confirmDiscard()) onClose(); };
  const productId = savedProduct?.id;
  const name = (l: Localized) => l[lang]?.trim() || L(l, business.defaultLocale);

  const upload = async (file: File, id: string) => {
    setUploadError(null);
    try {
      const image = await prepareImageUpload(file);
      const path = `businesses/${business.id}/branches/${branch.id}/products/${id}/${makeId(10)}.${image.ext}`;
      await uploadBytes(sref(storage, path), image.blob, { contentType: image.contentType });
      await recordUpload(path, () => call('setProductImage', { businessId: business.id, branchId: branch.id, productId: id, path }));
      set({ imagePath: path });
      return true;
    } catch (e) {
      setUploadError(t(uploadErrorKey(e)));
      return false;
    }
  };
  const pickPhoto = async (file: File) => {
    if (!productId) { setUploadError(null); setHeld(file); return; }
    setBusy(true);
    await upload(file, productId);
    setBusy(false);
  };
  const removePhoto = async () => {
    if (held) { setHeld(null); return; }
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

  /** `close`: save and leave. `another`: save, then start a blank item in the same category. */
  const save = async (then: 'close' | 'another') => {
    setError(null);
    if (!hasAnyTranslation(d.name)) return setError(t('validation.atLeastOneLanguage'));
    const { imagePath: _image, ...product } = d;
    if (!productInputSchema.safeParse(product).success) return setError(t('owner.invalidProduct'));
    setBusy(true);
    let saved: Product;
    try {
      const res = await call<{ product: Product }>('saveProduct', { businessId: business.id, branchId: branch.id, productId, product: { ...product, variants: product.variants.map((v) => ({ ...v, id: v.id || makeId(8) })), modifierGroups: product.modifierGroups.map((g) => ({ ...g, id: g.id || makeId(8), options: g.options.map((o) => ({ ...o, id: o.id || makeId(8) })) })) } });
      saved = res.product;
    } catch (e) {
      setError(storyIssue(e) ? t('catalog.storiesLimit', { max: MAX_STORY_ITEMS }) : t('catalog.saveFailed') + ' ' + t(errorKey(e)));
      setBusy(false);
      return;
    }
    toast(t('catalog.savedOk'));
    const next = draftFrom(saved, saved.categoryId);
    safety.markSaved({ ...next, imagePath: undefined });
    setD(next);
    setSavedProduct(saved);
    // A failed photo upload keeps the sheet open on the saved item so the owner can retry.
    if (held) {
      const ok = await upload(held, saved.id);
      if (!ok) { setBusy(false); return; }
      setHeld(null);
    }
    setBusy(false);
    if (then === 'close') { onClose(); return; }
    const fresh = draftFrom(undefined, saved.categoryId);
    safety.markSaved({ ...fresh, imagePath: undefined });
    setD(fresh);
    setSavedProduct(undefined);
    heroRef.current?.querySelector('input')?.focus();
  };

  const weight = d.pricingMode === 'weight';
  const supermarket = business.type === 'supermarket';
  const groups = d.modifierGroups;
  const setGroups = (modifierGroups: GroupIn[]) => set({ modifierGroups });
  const updateGroup = (i: number, next: GroupIn) => setGroups(groups.map((x, j) => (j === i ? next : x)));
  const ident = (g: GroupIn, i: number) => ({ id: g.id ?? makeId(8), sortOrder: g.sortOrder ?? i });
  const withIds = (o: GroupIn['options']) => o.map((x) => ({ ...x, id: x.id ?? makeId(8) }));
  // Linked: show the library's current content (what the server will write on save).
  const viewOf = (g: GroupIn, i: number): GroupIn => { const s = g.sharedGroupId ? byId.get(g.sharedGroupId) : undefined; return s ? linkGroup(s, ident(g, i).id, ident(g, i).sortOrder) : g; };
  const missing = missingLangs([d.name, ...d.variants.map((v) => v.name), ...groups.filter((g) => !g.sharedGroupId).flatMap((g) => [g.name, ...g.options.map((o) => o.name)])]);
  const langSwitch = <LangSwitch value={lang} onChange={setLang} missing={missing} />;

  const addVariant = () => set({ variants: [...d.variants, { id: makeId(8), name: {}, priceAgorot: d.variants.at(-1)?.priceAgorot ?? d.priceAgorot, available: true, sortOrder: d.variants.length, stockQty: d.trackInventory ? 0 : undefined }] });
  const setVariant = (i: number, patch: Partial<Draft['variants'][number]>) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const sizeName = (v: Draft['variants'][number]) => v.name[lang] || t('product.size');

  const pricing = (
    <section className="pe-sec">
      <div className="pe-sec__head"><h3>{t('catalog.pricing')}</h3></div>
      <Segmented label={t('catalog.pricing')} value={d.pricingMode} onChange={(pricingMode) => set({ pricingMode, variants: pricingMode === 'weight' ? [] : d.variants, modifierGroups: pricingMode === 'weight' ? [] : d.modifierGroups })} options={[{ value: 'unit', label: t('catalog.pricingUnit') }, { value: 'weight', label: t('catalog.pricingWeight') }]} />
      <div className="pgrid2">
        {weight ? <><TextInput label={t('catalog.weightStep')} type="number" ltr value={d.weightStepGrams ?? 100} onChange={(e) => set({ weightStepGrams: Number(e.target.value) })} /><TextInput label={t('catalog.minWeight')} type="number" ltr value={d.minWeightGrams ?? 100} onChange={(e) => set({ minWeightGrams: Number(e.target.value) })} /><TextInput label={t('catalog.estimatedGrams')} type="number" ltr optional value={d.estimatedGramsPerUnit ?? ''} onChange={(e) => set({ estimatedGramsPerUnit: e.target.value ? Number(e.target.value) : undefined })} /></> : <><TextInput label={t('catalog.quantityStep')} type="number" ltr min={1} value={d.quantityStep} onChange={(e) => set({ quantityStep: Math.max(1, Number(e.target.value)) })} /><TextInput label={t('catalog.minQuantity')} type="number" ltr min={1} value={d.minQuantity} onChange={(e) => set({ minQuantity: Math.max(1, Number(e.target.value)) })} /></>}
      </div>
      <LocalizedInput lang={lang} label={t('catalog.unitLabel')} value={d.unitLabel} onChange={(unitLabel) => set({ unitLabel })} />
    </section>
  );

  const photoPath = d.imagePath;
  const hasPhoto = !!(photoPath || heldUrl);
  const itemPage = (
    <fieldset className="form-fields pe-page" disabled={busy}>
      <FormError message={error} />
      <div className="pe-hero">
        <div className="pe-hero__photo">
          {heldUrl ? <img src={heldUrl} alt="" /> : photoPath ? <StorageImage path={photoPath} alt="" square fallbackLabel={t('discovery.imageFallback')} /> : null}
          <label className={`pe-hero__cam ${hasPhoto ? '' : 'pe-hero__cam--empty'}`} title={hasPhoto ? t('catalog.changePhoto') : t('catalog.uploadPhoto')}>
            <Icon name="image" size={hasPhoto ? 20 : 28} />
            <span className="visually-hidden">{hasPhoto ? t('catalog.changePhoto') : t('catalog.uploadPhoto')}</span>
            <input type="file" accept={UPLOAD_ACCEPT} className="visually-hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); e.target.value = ''; }} />
          </label>
          {hasPhoto ? <IconButton icon="x" size={16} label={t('catalog.removePhoto')} className="pe-hero__remove" onClick={() => void removePhoto()} /> : null}
        </div>
        <div className="pe-hero__fields" ref={heroRef}>
          <LocalizedInput lang={lang} label={t('common.name')} value={d.name} required onChange={(name) => set({ name })} />
          <Select label={t('catalog.category')} value={d.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{L(c.name, business.defaultLocale)}</option>)}</Select>
          {d.variants.length === 0 ? <TextInput label={weight ? t('catalog.pricePerKg') : t('catalog.basePrice')} type="number" inputMode="decimal" min={0} step="0.1" ltr value={agorotInput(d.priceAgorot)} onChange={(e) => set({ priceAgorot: parseAgorot(e.target.value) })} /> : null}
        </div>
      </div>
      {uploadError ? <div className="field__error pe-hero__error" role="alert"><Icon name="alert" size={14} /> {uploadError}</div> : null}
      <div className="kvrow-list pe-toggles">
        <LedgerRow label={t('catalog.available')}><Switch checked={d.available} label={t('catalog.available')} onChange={(available) => set({ available })} /></LedgerRow>
        <LedgerRow label={t('product.mostOrdered')}><Switch checked={!!d.mostOrdered} label={t('product.mostOrdered')} onChange={(mostOrdered) => set({ mostOrdered })} /></LedgerRow>
        <LedgerRow label={t('catalog.inStories')} hint={hasPhoto ? undefined : t('catalog.storiesNeedsPhoto')}><Switch checked={!!d.inStories} disabled={!hasPhoto && !d.inStories} label={t('catalog.inStories')} onChange={(inStories) => set({ inStories })} /></LedgerRow>
      </div>
      {supermarket ? pricing : null}
      <section className="pe-sec">
        <LocalizedInput lang={lang} label={t('catalog.descHe').replace(/ \(.*\)/, '')} value={d.description} multiline onChange={(description) => set({ description })} />
      </section>
      {!weight ? (
        <section className="pe-sec">
          <div className="pe-sec__head"><h3>{t('catalog.sizes')}</h3><Button variant="ghost" icon="plus" onClick={addVariant}>{t('common.add')}</Button></div>
          <EditLines
            priceLabel={t('product.price')}
            rows={d.variants.map((v, i) => ({
              key: v.id ?? String(i),
              name: <LocalizedInput lang={lang} bare label={t('product.size')} value={v.name} required onChange={(name) => setVariant(i, { name })} />,
              price: <MoneyInput label={`${t('product.price')}: ${sizeName(v)}`} agorot={v.priceAgorot} onChange={(priceAgorot) => setVariant(i, { priceAgorot })} />,
              available: <Switch checked={v.available} label={`${t('catalog.available')}: ${sizeName(v)}`} onChange={(available) => setVariant(i, { available })} />,
              removeLabel: `${t('common.remove')}: ${sizeName(v)}`,
              onRemove: () => set({ variants: d.variants.filter((_, j) => j !== i) }),
            }))}
            onAddLast={addVariant}
          />
        </section>
      ) : null}
      {!weight ? <GroupsList groups={groups} viewOf={viewOf} library={library.data} lang={lang} onOpen={setGroupAt} onChange={setGroups} /> : null}
      <details className="pe-more2">
        <summary><b>{t('common.more')}</b><span>{t('catalog.moreSummary')}</span><Icon name="chevronDown" size={22} /></summary>
        <div className="pe-more2__body">
          <section className="pe-sec pe-sec--first">
            <LocalizedInput lang={lang} label={t('catalog.dietary')} value={d.dietaryText} onChange={(dietaryText) => set({ dietaryText })} />
            {supermarket ? (
              <div className="pgrid2"><TextInput label={t('catalog.brand')} optional value={d.brand ?? ''} onChange={(e) => set({ brand: e.target.value || undefined })} /><TextInput label={t('catalog.sku')} optional ltr value={d.sku ?? ''} onChange={(e) => set({ sku: e.target.value || undefined })} /><TextInput label={t('catalog.barcode')} optional ltr inputMode="numeric" value={d.barcode ?? ''} onChange={(e) => set({ barcode: e.target.value || undefined })} /><TextInput label={t('catalog.packageSize')} optional value={d.packageSize ?? ''} onChange={(e) => set({ packageSize: e.target.value || undefined })} /></div>
            ) : null}
          </section>
          {supermarket ? null : pricing}
          <section className="pe-sec">
            <div className="kvrow-list pe-toggles">
              <LedgerRow label={t('catalog.trackInventory')}><Switch checked={d.trackInventory} label={t('catalog.trackInventory')} onChange={(trackInventory) => set({ trackInventory })} /></LedgerRow>
            </div>
            {/* Opening stock is set here once; later changes go through "Adjust stock" (audited). */}
            {d.trackInventory && !savedProduct?.trackInventory ? (
              d.variants.length === 0
                ? <TextInput label={t('catalog.stockQty')} type="number" ltr min={0} value={d.stockQty ?? 0} onChange={(e) => set({ stockQty: Number(e.target.value) })} hint={weight ? '(g)' : undefined} />
                : <div className="pgrid2">{d.variants.map((v, i) => <TextInput key={v.id ?? i} label={`${t('catalog.stockQty')}: ${sizeName(v)}`} type="number" ltr min={0} value={v.stockQty ?? 0} onChange={(e) => setVariant(i, { stockQty: Number(e.target.value) })} />)}</div>
            ) : null}
          </section>
          {savedProduct && (savedProduct.trackInventory || branches.length > 1) ? (
            <section className="pe-sec pe-actions">
              {savedProduct.trackInventory ? <Button variant="secondary" icon="scale" onClick={() => setStockOpen(true)}>{t('catalog.stockAdjust')}</Button> : null}
              {branches.length > 1 ? <Button variant="secondary" icon="copy" onClick={() => setCopyOpen(true)}>{t('catalog.copyTo')}</Button> : null}
            </section>
          ) : null}
        </div>
      </details>
    </fieldset>
  );

  const openGroup = groupAt !== null ? groups[groupAt] : undefined;
  const openShared = openGroup?.sharedGroupId ? byId.get(openGroup.sharedGroupId) : undefined;
  const groupActions = (gi: number): SheetAction[] => {
    const g = groups[gi]!;
    const view = viewOf(g, gi);
    return [
      { label: t('catalog.moveUp'), icon: 'chevronDown', flip: true, disabled: gi === 0, onSelect: () => { const next = [...groups]; [next[gi - 1], next[gi]] = [next[gi]!, next[gi - 1]!]; setGroups(next.map((x, k) => ({ ...x, sortOrder: k }))); setGroupAt(gi - 1); } },
      { label: t('catalog.moveDown'), icon: 'chevronDown', disabled: gi === groups.length - 1, onSelect: () => { const next = [...groups]; [next[gi + 1], next[gi]] = [next[gi]!, next[gi + 1]!]; setGroups(next.map((x, k) => ({ ...x, sortOrder: k }))); setGroupAt(gi + 1); } },
      g.sharedGroupId
        ? { label: t('catalog.detach'), icon: 'edit', hint: t('catalog.linkedGroupHint'), onSelect: () => { const { sharedGroupId: _s, ...rest } = view; updateGroup(gi, rest); toast(t('catalog.detached')); } }
        : { label: t('catalog.saveToLibrary'), icon: 'tag', onSelect: () => setPromote(gi) },
      { label: t('common.remove'), icon: 'trash', danger: true, onSelect: () => { setGroupAt(null); setGroups(groups.filter((_, j) => j !== gi)); } },
    ];
  };
  const groupPage = openGroup && groupAt !== null ? (
    openGroup.sharedGroupId ? (
      <div className="pe-page">
        <div className="pe-sec pe-sec--first"><Badge tone="accent" icon="tag">{t('catalog.linkedGroup')}</Badge></div>
        {/* Linked content is edited in the library; here it is shown read-only. */}
        <fieldset disabled className="pe-readonly"><ModifierGroupFields value={{ ...viewOf(openGroup, groupAt), options: withIds(viewOf(openGroup, groupAt).options) }} onChange={() => undefined} lang={lang} /></fieldset>
      </div>
    ) : (
      <div className="pe-page">
        <ModifierGroupFields value={{ name: openGroup.name, required: openGroup.required, minSelect: openGroup.minSelect, maxSelect: openGroup.maxSelect, options: withIds(openGroup.options), placement: openGroup.placement }} onChange={(next) => updateGroup(groupAt, { ...openGroup, ...next })} lang={lang} />
      </div>
    )
  ) : null;

  const onGroupPage = !!groupPage;
  const back = () => setGroupAt(null);
  const title = onGroupPage && openGroup ? (name(viewOf(openGroup, groupAt!).name) || t('catalog.editGroup')) : savedProduct ? t('catalog.editProduct') : t('catalog.newProduct');
  const footer = onGroupPage && groupAt !== null ? (
    <>
      <ActionSheet title={title} actions={groupActions(groupAt)} className="pe-foot__more" />
      {openShared ? <Button variant="secondary" icon="external" onClick={() => setEditShared({ index: groupAt, shared: openShared })}>{t('catalog.editInLibrary')}</Button> : null}
      <Button onClick={back}>{t('deals.done')}</Button>
    </>
  ) : (
    <>
      {initial ? <IconButton icon={initial.archived ? 'refresh' : 'trash'} label={initial.archived ? t('catalog.unarchive') : t('catalog.archive')} className={`pe-archive ${initial.archived ? 'pe-archive--restore' : ''}`} disabled={busy} onClick={() => setArchiveConfirm(true)} /> : null}
      <span className={`pe-status ${safety.dirty ? 'pe-status--dirty' : ''}`} role="status">{safety.dirty ? t('owner.unsavedShort') : safety.savedOnce ? <><Icon name="check" size={18} /> {t('owner.savedShort')}</> : null}</span>
      {initial ? null : <Button variant="secondary" className="pe-another" disabled={busy} onClick={() => void save('another')}>{t('catalog.addAnother')}</Button>}
      <Button className="pe-save" loading={busy} onClick={() => void save('close')}>{t('common.save')}</Button>
    </>
  );
  return (
    <Dialog open expanded onClose={onGroupPage ? back : close} title={title} className="pe2" hideClose={onGroupPage}
      headerStart={onGroupPage ? <button type="button" className="btn--icon pe-back" aria-label={t('common.back')} title={t('common.back')} onClick={back}><Icon name="arrowBack" size={22} directional /></button> : undefined}
      headerEnd={langSwitch} footer={footer}>
      {groupPage ?? itemPage}
      <ConfirmDialog open={archiveConfirm} onClose={() => setArchiveConfirm(false)} danger={!initial?.archived} title={initial?.archived ? t('catalog.unarchive') : t('catalog.archive')} confirmLabel={t('common.confirm')} onConfirm={async () => { setArchiveConfirm(false); try { await call('setProductArchived', { businessId: business.id, branchId: branch.id, productId: initial!.id, archived: !initial!.archived }); safety.markSaved(); onClose(); } catch (e) { toast(t(errorKey(e)), 'danger'); } }} />
      {stockOpen && savedProduct ? <StockDialog product={savedProduct} onClose={() => setStockOpen(false)} /> : null}
      {copyOpen && savedProduct ? <CopyDialog productId={savedProduct.id} onClose={() => setCopyOpen(false)} /> : null}
      {promote !== null && groups[promote] ? (
        <SharedGroupDialog initial={{ name: groups[promote].name, required: groups[promote].required, minSelect: groups[promote].minSelect, maxSelect: groups[promote].maxSelect, options: withIds(groups[promote].options), placement: groups[promote].placement }} onClose={() => setPromote(null)} onSaved={(s) => { const { id, sortOrder } = ident(groups[promote]!, promote); updateGroup(promote, linkGroup(s, id, sortOrder)); toast(t('catalog.savedToLibrary')); }} />
      ) : null}
      {editShared ? (
        <SharedGroupDialog id={editShared.shared.id} initial={{ name: editShared.shared.name, required: editShared.shared.required, minSelect: editShared.shared.minSelect, maxSelect: editShared.shared.maxSelect, options: editShared.shared.options, placement: editShared.shared.placement }} onClose={() => setEditShared(null)} onSaved={(s) => { const { id, sortOrder } = ident(groups[editShared.index]!, editShared.index); updateGroup(editShared.index, linkGroup(s, id, sortOrder)); }} />
      ) : null}
    </Dialog>
  );
}

/** Extras on the item page: one tappable row per group (name, rule, options), "+ Add" for a new group
 *  or one from the library. */
function GroupsList({ groups, viewOf, library, lang, onOpen, onChange }: { groups: GroupIn[]; viewOf: (g: GroupIn, i: number) => GroupIn; library: SharedModifierGroup[]; lang: Loc; onOpen: (i: number) => void; onChange: (g: GroupIn[]) => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { business } = useDash();
  const name = (l: Localized) => l[lang]?.trim() || L(l, business.defaultLocale);
  const linkable = library.filter((g) => !g.archived && !groups.some((x) => x.sharedGroupId === g.id));
  const addLocal = () => { onChange([...groups, { id: makeId(8), sortOrder: groups.length, ...newGroupDraft() }]); onOpen(groups.length); };
  const addActions: SheetAction[] = [
    { label: t('catalog.addGroup'), icon: 'plus', onSelect: addLocal },
    ...linkable.map((s): SheetAction => ({ label: L(s.name, business.defaultLocale), icon: 'tag', hint: t('catalog.addFromLibrary'), onSelect: () => onChange([...groups, linkGroup(s, makeId(8), groups.length)]) })),
  ];
  const rule = (g: GroupIn) => {
    const min = effectiveMin(g);
    if (min >= 1) return `${t('catalog.groupRequired')} · ${g.maxSelect === 0 ? `${min}+` : g.maxSelect === min ? min : `${min}–${g.maxSelect}`}`;
    return g.maxSelect > 0 ? t('catalog.upTo', { count: g.maxSelect }) : null;
  };
  const summary = (g: GroupIn) => g.options.map((o) => `${name(o.name)}${o.priceDeltaAgorot ? ` (${money(o.priceDeltaAgorot, locale)})` : ''}`).join(' · ');
  return (
    <section className="pe-sec">
      <div className="pe-sec__head">
        <h3>{t('catalog.extras')}</h3>
        {linkable.length ? <ActionSheet icon="plus" label={t('common.add')} title={t('catalog.extras')} actions={addActions} labelled variant="ghost" /> : <Button variant="ghost" icon="plus" onClick={addLocal}>{t('common.add')}</Button>}
      </div>
      {groups.length ? (
        <ul className="pe-groups">
          {groups.map((g, gi) => {
            const view = viewOf(g, gi);
            const r = rule(view);
            return (
              <li key={g.id ?? gi}>
                <button type="button" className="pe-group" onClick={() => onOpen(gi)}>
                  <span className="pe-group__body">
                    <span className="pe-group__head">
                      <span className="pe-group__name">{name(view.name) || t('catalog.editGroup')}</span>
                      {r ? <Badge tone="neutral">{r}</Badge> : null}
                      {g.sharedGroupId ? <Badge tone="accent" icon="tag">{t('catalog.linkedGroup')}</Badge> : null}
                    </span>
                    <span className="pe-group__opts">{summary(view)}</span>
                  </span>
                  <Icon name="chevron" size={20} directional />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
