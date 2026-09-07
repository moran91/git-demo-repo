import { useMemo, useState } from 'react';
import { formatGrams, makeId, priceLine, weightLineTotal, type CartModifierSelection, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Button, Checkbox, ConfirmDialog, Dialog, Stepper, TextArea, toast } from '@/design/components';
import { addLine, cartBelongsTo, cartStore } from '@/lib/cart';
import { money } from '@/lib/format';
import type { PublicBranch, PublicBusiness } from './hooks';
import { StorageImage } from './StorageImage';

export function ProductSheet({ product, business, branch, mode, cityId, onClose }: { product: Product; business: PublicBusiness; branch: PublicBranch; mode: 'pickup' | 'delivery'; cityId: string; onClose: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const cart = cartStore.use();
  const [variantId, setVariantId] = useState<string | undefined>(product.variants.find((v) => v.available)?.id);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(product.minQuantity || 1);
  const [grams, setGrams] = useState(product.minWeightGrams ?? product.weightStepGrams ?? 100);
  const [note, setNote] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [touched, setTouched] = useState(false);

  const modifiers: CartModifierSelection[] = useMemo(() => Object.entries(selections).map(([groupId, optionIds]) => ({ groupId, optionIds })), [selections]);
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
    const modifierNames = product.modifierGroups.flatMap((g) => (selections[g.id] ?? []).map((id) => g.options.find((o) => o.id === id)?.name ?? {}));
    addLine({
      businessId: business.id,
      branchId: branch.id,
      mode,
      cityId,
      meta,
      line: { ...preview.cartLine, lineId: makeId(12), note: note.trim() || undefined },
      lineMeta: { name: product.name, variantName: product.variants.find((v) => v.id === variantId)?.name, modifierNames, unitLabel: product.unitLabel, pricingMode: product.pricingMode, imagePath: product.imagePath },
    });
    try {
      sessionStorage.removeItem('qareeb.cart.quotedTotal');
      window.dispatchEvent(new Event('qareeb:cart-quote'));
    } catch {
      /* ignore */
    }
    toast(`${t('product.addToCart')} ✓`);
    onClose();
  };
  const submit = () => {
    setTouched(true);
    if (invalid) return;
    if (cart.cart && !cartBelongsTo(cart, business.id, branch.id)) {
      setShowReplace(true);
      return;
    }
    commit();
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={L(product.name, business.defaultLocale)}
        footer={
          <Button block onClick={submit} disabled={touched && invalid}>
            {t('product.addToCart')} · <bdi className="price">{money(preview.total, locale)}</bdi>
          </Button>
        }
      >
        <div className="stack">
          <div className="row row--nowrap" style={{ alignItems: 'flex-start' }}>
            <StorageImage path={product.imagePath} alt="" square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
            <div className="stack--sm stack" style={{ minWidth: 0 }}>
              {L(product.description, business.defaultLocale) ? <p className="wrap-anywhere">{L(product.description, business.defaultLocale)}</p> : null}
              {L(product.dietaryText, business.defaultLocale) ? <p className="muted wrap-anywhere"><strong>{t('business.dietary')}:</strong> {L(product.dietaryText, business.defaultLocale)}</p> : null}
              <div className="price">{product.pricingMode === 'weight' ? <>{money(product.priceAgorot, locale)} <span className="muted">{t('common.perKg')}</span></> : money(preview.unit, locale)}</div>
            </div>
          </div>

          {product.variants.length > 0 ? (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
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
              <fieldset key={g.id} className="field" style={{ border: 0, padding: 0, margin: 0 }} aria-invalid={err || undefined}>
                <legend className="field__label">
                  {L(g.name, business.defaultLocale)} {g.required ? <span className="badge badge--accent">{t('product.required')}</span> : <span className="field__optional">({t('common.optional')})</span>}
                  {rule ? <span className="field__optional">· {rule}</span> : null}
                </legend>
                <div className="radio-list">
                  {g.options.map((o) => {
                    const checked = chosen.includes(o.id);
                    return (
                      <label key={o.id} className={`choice ${checked ? 'is-selected' : ''}`}>
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
            <div className="field">
              <span className="field__label">{t('common.quantity')}</span>
              <Stepper value={qty} min={product.minQuantity || 1} max={99} step={product.quantityStep || 1} onChange={setQty} decLabel={t('product.decrease')} incLabel={t('product.increase')} />
            </div>
          )}

          <TextArea label={t('product.itemNote')} optional placeholder={t('product.itemNotePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={{ minHeight: 72 }} />
          {business.type === 'supermarket' ? <Checkbox label={t('cart.estimatedNote')} disabled checked={product.pricingMode === 'weight'} style={{ display: product.pricingMode === 'weight' ? undefined : 'none' }} /> : null}
        </div>
      </Dialog>
      <ConfirmDialog open={showReplace} onClose={() => setShowReplace(false)} onConfirm={() => { setShowReplace(false); commit(); }} title={t('product.replaceCartTitle')} body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })} confirmLabel={t('product.replaceCartConfirm')} danger />
    </>
  );
}
