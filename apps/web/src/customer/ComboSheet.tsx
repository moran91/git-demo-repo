import { useState } from 'react';
import { comboUnitPrice, makeId, type Combo, type FulfillmentMode, type Localized, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Alert, Button, ConfirmDialog, Dialog, Stepper, TextArea, toast } from '@/design/components';
import { addLine, cartBelongsTo, cartStore } from '@/lib/cart';
import { money } from '@/lib/format';
import type { PublicBranch, PublicBusiness } from './hooks';
import { comboMemberImages } from './ComboMedia';
import { DealSlide } from './DealSlide';
import { StorageImage } from './StorageImage';

/**
 * Client-side mirror of the server pricing: every member must be live, and the charged price is the
 * combo's fixed price. The members' sum is only computed for legacy percentage combos and is never shown.
 */
export function comboPricing(combo: Combo, products: Product[]): { price: number } | null {
  let sum = 0;
  for (const it of combo.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p || !p.available || p.pricingMode !== 'unit') return null;
    let unit = p.priceAgorot;
    if (p.variants.length > 0) {
      const v = p.variants.find((x) => x.id === it.variantId);
      if (!v || !v.available) return null;
      unit = v.priceAgorot;
    }
    sum += unit * it.quantity;
  }
  return { price: comboUnitPrice(combo, sum) };
}

export function ComboSheet({ combo, products, business, branch, mode, cityId, onClose }: { combo: Combo; products: Product[]; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode; cityId: string; onClose: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const cart = cartStore.use();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const name = L(combo.name, business.defaultLocale);
  const pricing = comboPricing(combo, products);
  const commit = () => {
    if (!pricing) return;
    const names: Localized[] = combo.items.map((it) => { const p = products.find((x) => x.id === it.productId); return p ? { ...p.name } : {}; });
    addLine({
      businessId: business.id,
      branchId: branch.id,
      mode,
      cityId,
      meta: { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale },
      line: { lineId: makeId(12), comboId: combo.id, productId: combo.id, modifiers: [], quantity: qty, note: note.trim() || undefined, expectedUnitPriceAgorot: pricing.price },
      lineMeta: { name: combo.name, modifierNames: combo.items.map((it, i) => ({ en: `${it.quantity} × ${L(names[i] ?? {}, business.defaultLocale)}` })), unitLabel: {}, pricingMode: 'unit', imagePath: comboMemberImages(combo, products)[0], isCombo: true },
    });
    try { sessionStorage.removeItem('qareeb.cart.quotedTotal'); window.dispatchEvent(new Event('qareeb:cart-quote')); } catch { /* ignore */ }
    toast(`${t('deals.addCombo')} ✓`);
    onClose();
  };
  const submit = () => {
    if (cart.cart && !cartBelongsTo(cart, business.id, branch.id)) { setShowReplace(true); return; }
    commit();
  };
  return (
    <>
      <Dialog open onClose={onClose} className="dialog--deal" title={name} footer={<Button block className="btn--split" disabled={!pricing} onClick={submit}><span>{t('deals.addCombo')}</span><bdi className="price">{money((pricing?.price ?? 0) * qty, locale)}</bdi></Button>}>
        <div className="stack">
          <div className="deal-band" aria-hidden="true">
            <DealSlide band tone="combo" kind={t('deals.combo')} name={name} lang={business.defaultLocale} pill={pricing ? <bdi>{money(pricing.price, locale)}</bdi> : undefined} paths={comboMemberImages(combo, products)} />
          </div>
          {L(combo.description, business.defaultLocale) ? <p className="wrap-anywhere">{L(combo.description, business.defaultLocale)}</p> : null}
          {pricing ? null : <Alert tone="warn">{t('deals.unavailable')}</Alert>}
          <div className="stack--sm stack">
            <h3>{t('deals.includes')}</h3>
            <ul className="deal-lines">
              {combo.items.map((it, i) => {
                const p = products.find((x) => x.id === it.productId);
                const v = p?.variants.find((x) => x.id === it.variantId);
                return (
                  <li key={i} className="deal-line">
                    <span className="deal-line__img"><StorageImage path={p?.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} /></span>
                    <span className="deal-line__qty num">{it.quantity}×</span>
                    <span className="deal-line__text wrap-anywhere">{p ? L(p.name, business.defaultLocale) : '…'}{v ? <small>{L(v.name, business.defaultLocale)}</small> : null}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="deal-qty"><h3>{t('common.quantity')}</h3><Stepper value={qty} min={1} max={20} onChange={setQty} decLabel={t('product.decrease')} incLabel={t('product.increase')} /></div>
          {showNote || note ? <TextArea label={t('product.itemNote')} optional autoFocus={showNote && !note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={{ minHeight: 64 }} />
            : <div><Button variant="ghost" size="sm" icon="plus" onClick={() => setShowNote(true)}>{t('product.itemNote')}</Button></div>}
        </div>
      </Dialog>
      <ConfirmDialog open={showReplace} onClose={() => setShowReplace(false)} onConfirm={() => { setShowReplace(false); commit(); }} title={t('product.replaceCartTitle')} body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })} confirmLabel={t('product.replaceCartConfirm')} danger />
    </>
  );
}
