import { Link, useNavigate } from 'react-router';
import { formatGrams } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { cartStore, removeLine, updateLine, clearCart } from '@/lib/cart';
import { Button, EmptyState, Stepper, Alert, ConfirmDialog, IconButton } from '@/design/components';
import { money } from '@/lib/format';
import { useQuote } from './quote';
import { useState } from 'react';
import { StorageImage } from './StorageImage';
import { errorKey } from '@/lib/errors';
import { Summary } from './Summary';
import { PhotoLightbox } from './PhotoLightbox';
import { ProductSheet } from './ProductSheet';
import { useDoc } from '@/lib/queries';
import type { PublicBranch, PublicBusiness } from './hooks';
import type { PublicProduct } from './BusinessPage';
import type { CartLine } from '@qareeb/shared';

export function CartPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const state = cartStore.use();
  const navigate = useNavigate();
  const { quote, error, loading } = useQuote(state.cart, 0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [photo, setPhoto] = useState<{ path: string; alt: string } | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  if (!state.cart || !state.meta) {
    return <EmptyState icon="cart" title={t('cart.empty')} body={t('cart.emptyHint')} action={<Link className="btn btn--primary" to="/">{t('cart.browse')}</Link>} />;
  }
  const cart = state.cart;
  const problems = (error?.details.problems as Array<{ lineId: string; code: string; expected?: number; actual?: number }> | undefined) ?? [];
  const problemFor = (lineId: string) => problems.find((p) => p.lineId === lineId);
  const canCheckout = !!quote && !error;
  const dl = state.meta.businessDefaultLocale;
  return (
    <div className="stack">
      <div className="row row--between">
        <h1>{t('cart.title')}</h1>
        <IconButton icon="trash" label={t('cart.clear')} onClick={() => setConfirmClear(true)} />
      </div>
      <p className="muted">{t('cart.from', { business: L(state.meta.businessName, dl) })} · {L(state.meta.branchName, dl)} · {cart.mode === 'delivery' ? t('common.delivery') : t('common.pickup')}</p>
      {/* Per-line problems are shown inline below, so those codes are suppressed here — but only when
          there actually is a line to attach them to. A whole-cart rejection (e.g. more than the 60
          lines the server accepts) carries no `problems`, and used to leave the cart silently dead:
          no total, no checkout, no message. */}
      {error && error.code !== 'price_changed' && error.code !== 'item_unavailable' && error.code !== 'invalid_modifiers' && !(error.code === 'invalid_argument' && problems.length > 0) ? <Alert tone="warn">{t(errorKey(error))}</Alert> : null}
      {problems.length > 0 ? (
        <Alert tone="warn" action={<Button size="sm" variant="secondary" onClick={() => { for (const p of problems) { if (p.code === 'price_changed' && p.actual !== undefined) updateLine(p.lineId, { expectedUnitPriceAgorot: p.actual }); else removeLine(p.lineId); } }}>{t('cart.acceptChanges')}</Button>}>
          {t('cart.reviewChanges')}
        </Alert>
      ) : null}
      <ul className="list card" aria-busy={loading}>
        {cart.lines.map((l) => {
          const meta = state.lineMeta[l.lineId];
          const priced = quote?.lines.find((x) => x.lineId === l.lineId);
          const prob = problemFor(l.lineId);
          return (
            <li key={l.lineId} className="list__item cart-line">
              <StorageImage path={meta?.imagePath} alt={t('product.photoAlt', { name: L(meta?.name ?? {}, dl) })} square className="cart-line__img" fallbackLabel={t('discovery.imageFallback')} onClick={() => meta?.imagePath && setPhoto({ path: meta.imagePath, alt: t('product.photoAlt', { name: L(meta.name, dl) }) })} />
              <div className="cart-line__body">
                <div className="cart-line__head">
                  <strong className="wrap-anywhere">{L(meta?.name ?? {}, dl)}{meta?.variantName ? ` · ${L(meta.variantName, dl)}` : ''}</strong>
                  <IconButton icon="edit" size={18} label={`${t('common.edit')}: ${L(meta?.name ?? {}, dl)}`} onClick={() => setEditing(l)} />
                  <IconButton icon="x" size={18} label={t('common.remove')} onClick={() => removeLine(l.lineId)} />
                </div>
                {meta?.modifierNames.length ? <div className="muted">{meta.modifierNames.map((m) => L(m, dl)).join(', ')}</div> : null}
                {l.note ? <div className="muted">“{l.note}”</div> : null}
                {prob?.code === 'price_changed' && prob.actual !== undefined ? <div className="field__error">{t('cart.priceChangedLine', { old: money(l.expectedUnitPriceAgorot, locale), new: money(prob.actual, locale) })}</div> : prob ? <div className="field__error">{t('cart.unavailableLine')}</div> : null}
                <div className="cart-line__foot">
                  {l.requestedGrams ? (
                    // Steps must match the product's own rules, or the edited amount is rejected at
                    // checkout. Carts stored before these fields existed fall back to the line value.
                    <Stepper size="sm" value={l.requestedGrams} min={meta?.minWeightGrams ?? l.requestedGrams} max={20000} step={meta?.weightStepGrams ?? 100} onChange={(g) => updateLine(l.lineId, { requestedGrams: g })} onRemove={() => removeLine(l.lineId)} decLabel={t('product.decrease')} incLabel={t('product.increase')} removeLabel={t('common.remove')} format={(v) => formatGrams(v, locale)} />
                  ) : (
                    // Below the product minimum the decrement becomes "remove"; the step follows the product.
                    <Stepper size="sm" value={l.quantity} min={meta?.minQuantity ?? 1} max={99} step={meta?.quantityStep ?? 1} onChange={(q) => updateLine(l.lineId, { quantity: q })} onRemove={() => removeLine(l.lineId)} decLabel={t('product.decrease')} incLabel={t('product.increase')} removeLabel={t('common.remove')} />
                  )}
                  <span className="price"><bdi>{priced ? money(priced.lineTotalAgorot, locale) : '…'}</bdi>{l.requestedGrams ? <span className="muted"> ({t('common.estimated')})</span> : null}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {quote ? <Summary totals={quote.totals} mode={cart.mode} /> : null}
      {quote?.totals.isEstimated ? <p className="muted">{t('cart.estimatedNote')}</p> : null}
      <Button block disabled={!canCheckout} onClick={() => navigate('/checkout')}>{t('cart.checkout')}</Button>
      {editing ? <EditLineSheet cart={cart} line={editing} onClose={() => setEditing(null)} /> : null}
      {photo ? <PhotoLightbox path={photo.path} alt={photo.alt} onClose={() => setPhoto(null)} /> : null}
      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={() => { clearCart(); setConfirmClear(false); }} title={t('cart.clear')} body={t('cart.clearConfirm')} confirmLabel={t('cart.clear')} danger />
    </div>
  );
}

/**
 * The cart only stores a display snapshot per line, so editing refetches the live product (and the
 * public business/branch the sheet needs for names and the default locale). If the product has
 * vanished or become unavailable the customer is told and the line stays as it was.
 */
function EditLineSheet({ cart, line, onClose }: { cart: { businessId: string; branchId: string; mode: 'pickup' | 'delivery'; cityId: string }; line: CartLine; onClose: () => void }) {
  const t = useT();
  const business = useDoc<PublicBusiness>(`publicBusinesses/${cart.businessId}`);
  const branch = useDoc<PublicBranch>(`publicBranches/${cart.branchId}`);
  const product = useDoc<PublicProduct>(`publicBranches/${cart.branchId}/products/${line.productId}`);
  if (business.loading || branch.loading || product.loading) return null;
  const p = product.data;
  if (!business.data || !branch.data || !p || !p.available || !p.inStock) {
    return <ConfirmDialog open onClose={onClose} onConfirm={onClose} title={t('common.edit')} body={t('cart.editUnavailable')} confirmLabel={t('common.close')} />;
  }
  return <ProductSheet product={p} business={business.data} branch={branch.data} mode={cart.mode} cityId={cart.cityId} editLine={line} onClose={onClose} />;
}
