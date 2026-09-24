import { useMemo, useState } from 'react';
import { formatGrams, makeId, placementSuffix, priceLine, weightLineTotal, type CartLine, type CartModifierSelection, type FulfillmentMode, type Product, type ToppingPlacement } from '@qareeb/shared';
import { PlacementPicker } from './PizzaPlacement';
import { useI18n, useT } from '@/lib/i18n';
import { Button, Checkbox, ConfirmDialog, Dialog, Stepper, TextArea, toast } from '@/design/components';
import { addLine, cartBelongsTo, cartStore, replaceLine } from '@/lib/cart';
import { money } from '@/lib/format';
import type { PublicBranch, PublicBusiness } from './hooks';
import { StorageImage } from './StorageImage';
import { PhotoLightbox } from './PhotoLightbox';

/** When `editLine` is given the sheet opens prefilled and "Save" replaces that cart line in place. */
export function ProductSheet({ product, business, branch, mode, cityId, onClose, editLine }: { product: Product; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode; cityId: string; onClose: () => void; editLine?: CartLine }) {
  const t = useT();
  const { L, locale } = useI18n();
  const cart = cartStore.use();
  // Prefill from the edited line, but only with options that still exist and are still selectable:
  // an option removed from the menu since the line was added must not survive as a phantom pick.
  const initial = useMemo(() => {
    if (!editLine) return null;
    const sel: Record<string, string[]> = {};
    const pl: Record<string, Record<string, ToppingPlacement>> = {};
    for (const m of editLine.modifiers) {
      const g = product.modifierGroups.find((x) => x.id === m.groupId);
      if (!g) continue;
      const ids = m.optionIds.filter((id) => g.options.some((o) => o.id === id && o.available));
      if (ids.length === 0) continue;
      sel[g.id] = g.maxSelect === 1 ? ids.slice(0, 1) : g.maxSelect > 0 ? ids.slice(0, g.maxSelect) : ids;
      if (g.placement) pl[g.id] = Object.fromEntries(sel[g.id]!.map((id) => [id, m.placements?.[id] ?? 'whole']));
    }
    const variant = product.variants.find((v) => v.id === editLine.variantId && v.available)?.id;
    return { sel, pl, variant };
  }, [editLine, product]);
  const [variantId, setVariantId] = useState<string | undefined>(initial?.variant ?? product.variants.find((v) => v.available)?.id);
  const [selections, setSelections] = useState<Record<string, string[]>>(initial?.sel ?? {});
  const [placements, setPlacements] = useState<Record<string, Record<string, ToppingPlacement>>>(initial?.pl ?? {});
  const [qty, setQty] = useState(Math.max(editLine?.quantity ?? 0, product.minQuantity || 1));
  const [grams, setGrams] = useState(editLine?.requestedGrams ?? product.minWeightGrams ?? product.weightStepGrams ?? 100);
  const [note, setNote] = useState(editLine?.note ?? '');
  const [showReplace, setShowReplace] = useState(false);
  const [touched, setTouched] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);

  const modifiers: CartModifierSelection[] = useMemo(
    () => Object.entries(selections).map(([groupId, optionIds]) => {
      const group = product.modifierGroups.find((g) => g.id === groupId);
      const chosen = Object.fromEntries(optionIds.map((id) => [id, placements[groupId]?.[id] ?? 'whole'] as const));
      return group?.placement ? { groupId, optionIds, placements: chosen } : { groupId, optionIds };
    }),
    [selections, placements, product.modifierGroups],
  );
  const preview = useMemo(() => {
    const variant = product.variants.find((v) => v.id === variantId);
    const base = variant ? variant.priceAgorot : product.priceAgorot;
    const delta = product.modifierGroups.reduce((s, g) => s + (selections[g.id] ?? []).reduce((a, id) => a + (g.options.find((o) => o.id === id)?.priceDeltaAgorot ?? 0), 0), 0);
    const unit = base + delta;
    const cartLine = { lineId: 'preview', productId: product.id, variantId, modifiers, quantity: qty, requestedGrams: product.pricingMode === 'weight' ? grams : undefined, note, expectedUnitPriceAgorot: product.pricingMode === 'weight' ? base : unit };
    const priced = priceLine(product, cartLine);
    return { unit, base, total: priced.line?.lineTotalAgorot ?? (product.pricingMode === 'weight' ? weightLineTotal(base, grams) : unit * qty), problem: priced.problem, cartLine };
  }, [product, variantId, selections, qty, grams, note, modifiers]);

  const groupError = (g: Product['modifierGroups'][number]) => {
    const chosen = selections[g.id] ?? [];
    if (g.required && chosen.length < Math.max(1, g.minSelect)) return true;
    if (chosen.length > 0 && chosen.length < g.minSelect) return true;
    return false;
  };
  const invalid = !!preview.problem;

  const commit = () => {
    const meta = { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale };
    const modifierNames = product.modifierGroups.flatMap((g) => (selections[g.id] ?? []).map((id) => {
      const nm = g.options.find((o) => o.id === id)?.name ?? {};
      const suffix = g.placement ? placementSuffix(placements[g.id]?.[id], t) : '';
      return suffix ? Object.fromEntries(Object.entries(nm).map(([k, v]) => [k, `${v}${suffix}`])) : nm;
    }));
    const lineMeta = { name: product.name, variantName: product.variants.find((v) => v.id === variantId)?.name, modifierNames, unitLabel: product.unitLabel, pricingMode: product.pricingMode, imagePath: product.imagePath, weightStepGrams: product.weightStepGrams, minWeightGrams: product.minWeightGrams, quantityStep: product.quantityStep, minQuantity: product.minQuantity };
    const { lineId: _preview, ...body } = preview.cartLine;
    if (editLine) {
      replaceLine(editLine.lineId, { ...body, note: note.trim() || undefined }, lineMeta);
    } else {
      addLine({ businessId: business.id, branchId: branch.id, mode, cityId, meta, line: { ...body, lineId: makeId(12), note: note.trim() || undefined }, lineMeta });
    }
    try {
      sessionStorage.removeItem('qareeb.cart.quotedTotal');
      window.dispatchEvent(new Event('qareeb:cart-quote'));
    } catch {
      /* ignore */
    }
    toast(`${editLine ? t('product.saveChanges') : t('product.addToCart')} ✓`);
    onClose();
  };
  const submit = () => {
    setTouched(true);
    if (invalid) return;
    if (!editLine && cart.cart && !cartBelongsTo(cart, business.id, branch.id)) {
      setShowReplace(true);
      return;
    }
    commit();
  };

  return (
    <>
      <Dialog
        open
        expanded
        onClose={onClose}
        title={L(product.name, business.defaultLocale)}
        footer={
          <Button block onClick={submit} disabled={touched && invalid}>
            {editLine ? t('product.saveChanges') : t('product.addToCart')} · <bdi className="price">{money(preview.total, locale)}</bdi>
          </Button>
        }
      >
        <div className="stack">
          <div className="row row--nowrap" style={{ alignItems: 'flex-start' }}>
            <StorageImage path={product.imagePath} alt={t('product.photoAlt', { name: L(product.name, business.defaultLocale) })} square className="product__img" fallbackLabel={t('discovery.imageFallback')} onClick={() => setShowPhoto(true)} />
            <div className="stack--sm stack" style={{ minWidth: 0 }}>
              {L(product.description, business.defaultLocale) ? <p className="wrap-anywhere">{L(product.description, business.defaultLocale)}</p> : null}
              {L(product.dietaryText, business.defaultLocale) ? <p className="muted wrap-anywhere"><strong>{t('business.dietary')}:</strong> {L(product.dietaryText, business.defaultLocale)}</p> : null}
              <div className="price">{product.pricingMode === 'weight' ? <>{money(product.priceAgorot, locale)} <span className="muted">{t('common.perKg')}</span></> : money(preview.unit, locale)}</div>
            </div>
          </div>

          {product.variants.length > 0 ? (
            <fieldset className="field option-group">
              <legend className="field__label">{t('product.size')} <span className="badge badge--accent">{t('product.required')}</span></legend>
              <div className="radio-list">
                {product.variants.map((v) => (
                  <label key={v.id} className={`choice ${variantId === v.id ? 'is-selected' : ''}`}>
                    <input type="radio" name="variant" value={v.id} checked={variantId === v.id} disabled={!v.available} onChange={() => setVariantId(v.id)} />
                    <span className="choice__label">{L(v.name, business.defaultLocale)}{!v.available ? ` · ${t('common.unavailable')}` : ''}</span>
                    <span className="choice__price"><bdi>{money(v.priceAgorot, locale)}</bdi></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {product.modifierGroups.map((g) => {
            const chosen = selections[g.id] ?? [];
            const single = g.maxSelect === 1;
            const err = touched && groupError(g);
            const rule = g.required && g.maxSelect === 1 ? t('product.chooseExactly', { count: 1 }) : g.maxSelect > 0 ? t('product.chooseUpTo', { max: g.maxSelect }) : g.minSelect > 0 ? t('product.chooseAtLeast', { min: g.minSelect }) : '';
            return (
              <fieldset key={g.id} className="field option-group" aria-invalid={err || undefined}>
                <legend className="field__label">
                  {L(g.name, business.defaultLocale)} {g.required ? <span className="badge badge--accent">{t('product.required')}</span> : <span className="field__optional">({t('common.optional')})</span>}
                  {rule ? <span className="field__optional">· {rule}</span> : null}
                </legend>
                <div className="radio-list">
                  {g.options.map((o) => {
                    const checked = chosen.includes(o.id);
                    return (
                      <div key={o.id} className={`choice-block ${g.placement && checked ? 'has-extra' : ''}`}>
                      <label className={`choice ${checked ? 'is-selected' : ''}`}>
                        <input
                          type={single ? 'radio' : 'checkbox'}
                          name={`g-${g.id}`}
                          checked={checked}
                          disabled={!o.available || (!checked && g.maxSelect > 0 && chosen.length >= g.maxSelect && !single)}
                          onChange={() => setSelections((s) => ({ ...s, [g.id]: single ? [o.id] : checked ? chosen.filter((x) => x !== o.id) : [...chosen, o.id] }))}
                        />
                        <span className="choice__label">{L(o.name, business.defaultLocale)}{!o.available ? ` · ${t('common.unavailable')}` : ''}</span>
                        {o.priceDeltaAgorot ? <span className="choice__price"><bdi>{o.priceDeltaAgorot > 0 ? '+' : ''}{money(o.priceDeltaAgorot, locale)}</bdi></span> : null}
                      </label>
                      {g.placement && checked ? <PlacementPicker value={placements[g.id]?.[o.id]} onChange={(pl) => setPlacements((s) => ({ ...s, [g.id]: { ...(s[g.id] ?? {}), [o.id]: pl } }))} /> : null}
                      </div>
                    );
                  })}
                </div>
                {err ? <div className="field__error" role="alert">{t('product.selectionInvalid')}</div> : null}
              </fieldset>
            );
          })}

          {product.pricingMode === 'weight' ? (
            <div className="field">
              <span className="field__label">{t('product.weightLabel')}</span>
              <Stepper value={grams} min={product.minWeightGrams ?? product.weightStepGrams ?? 100} max={20000} step={product.weightStepGrams ?? 100} onChange={setGrams} decLabel={t('product.decrease')} incLabel={t('product.increase')} format={(v) => formatGrams(v, locale)} />
              <div className="field__hint">{t('product.weightExplainer')} · {t('product.estimatedPrice')}: <bdi className="price">{money(preview.total, locale)}</bdi></div>
            </div>
          ) : (
            <div className="field field--inline">
              <span className="field__label">{t('common.quantity')}</span>
              <Stepper value={qty} min={product.minQuantity || 1} max={99} step={product.quantityStep || 1} onChange={setQty} decLabel={t('product.decrease')} incLabel={t('product.increase')} />
            </div>
          )}

          <TextArea label={t('product.itemNote')} optional placeholder={t('product.itemNotePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={{ minHeight: 72 }} />
          {/* Only weight-priced items are estimated; `style` on Checkbox lands on the input, not the label. */}
          {business.type === 'supermarket' && product.pricingMode === 'weight' ? <Checkbox label={t('cart.estimatedNote')} disabled checked /> : null}
        </div>
      </Dialog>
      {showPhoto && product.imagePath ? <PhotoLightbox path={product.imagePath} alt={t('product.photoAlt', { name: L(product.name, business.defaultLocale) })} onClose={() => setShowPhoto(false)} /> : null}
      <ConfirmDialog open={showReplace} onClose={() => setShowReplace(false)} onConfirm={() => { setShowReplace(false); commit(); }} title={t('product.replaceCartTitle')} body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })} confirmLabel={t('product.replaceCartConfirm')} danger />
    </>
  );
}
