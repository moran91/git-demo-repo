import { useState } from 'react';
import { comboUnitPrice, makeId, type Combo, type FulfillmentMode, type Localized, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Button, ConfirmDialog, Dialog, Stepper, TextArea, toast } from '@/design/components';
import { addLine, cartBelongsTo, cartStore } from '@/lib/cart';
import { money } from '@/lib/format';
import type { PublicBranch, PublicBusiness } from './hooks';
import { ComboMedia, comboMemberImages } from './ComboMedia';

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
      lineMeta: { name: combo.name, modifierNames: combo.items.map((it, i) => ({ en: `${it.quantity} × ${L(names[i] ?? {}, business.defaultLocale)}` })), unitLabel: {}, pricingMode: 'unit', imagePath: combo.imagePath ?? comboMemberImages(combo, products)[0], isCombo: true },
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
      <Dialog open onClose={onClose} title={L(combo.name, business.defaultLocale)} footer={<Button block disabled={!pricing} onClick={submit}>{t('deals.addCombo')} · <bdi className="price">{money((pricing?.price ?? 0) * qty, locale)}</bdi></Button>}>
        <div className="stack">
          <div className="deal-card__media" style={{ borderRadius: 12, overflow: 'hidden' }}>
            <ComboMedia combo={combo} products={products} fallbackLabel={t('discovery.imageFallback')} priority />
            {combo.imagePath ? null : <span className="deal-card__badge">{t('deals.combo')}</span>}
          </div>
          {L(combo.description, business.defaultLocale) ? <p className="wrap-anywhere">{L(combo.description, business.defaultLocale)}</p> : null}
          <div className="stack--sm stack">
            <strong>{t('deals.includes')}</strong>
            <ul className="order-lines">
              {combo.items.map((it, i) => { const p = products.find((x) => x.id === it.productId); const v = p?.variants.find((x) => x.id === it.variantId); return <li key={i} className="order-line"><span>{it.quantity} × {p ? L(p.name, business.defaultLocale) : '…'}{v ? ` (${L(v.name, business.defaultLocale)})` : ''}</span></li>; })}
            </ul>
          </div>
          {pricing ? (
            <div className="summary card">
              <div className="summary__row summary__row--total"><span>{t('deals.comboPrice')}</span><bdi className="num">{money(pricing.price, locale)}</bdi></div>
            </div>
          ) : <div className="badge badge--muted">{t('deals.unavailable')}</div>}
          <div className="field"><span className="field__label">{t('common.quantity')}</span><Stepper value={qty} min={1} max={20} onChange={setQty} decLabel={t('product.decrease')} incLabel={t('product.increase')} /></div>
          <TextArea label={t('product.itemNote')} optional value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={{ minHeight: 64 }} />
        </div>
      </Dialog>
      <ConfirmDialog open={showReplace} onClose={() => setShowReplace(false)} onConfirm={() => { setShowReplace(false); commit(); }} title={t('product.replaceCartTitle')} body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })} confirmLabel={t('product.replaceCartConfirm')} danger />
    </>
  );
}
