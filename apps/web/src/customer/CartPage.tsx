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

export function CartPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const state = cartStore.use();
  const navigate = useNavigate();
  const { quote, error, loading } = useQuote(state.cart, 0);
  const [confirmClear, setConfirmClear] = useState(false);
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
      {error && error.code !== 'price_changed' && error.code !== 'item_unavailable' && error.code !== 'invalid_modifiers' && error.code !== 'invalid_argument' ? <Alert tone="warn">{t(errorKey(error))}</Alert> : null}
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
            <li key={l.lineId} className="list__item" style={{ alignItems: 'flex-start' }}>
              <StorageImage path={meta?.imagePath} alt="" square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
              <div className="list__grow stack--sm stack">
                <strong className="wrap-anywhere">{L(meta?.name ?? {}, dl)}{meta?.variantName ? ` · ${L(meta.variantName, dl)}` : ''}</strong>
                {meta?.modifierNames.length ? <div className="muted">{meta.modifierNames.map((m) => L(m, dl)).join(', ')}</div> : null}
                {l.note ? <div className="muted">“{l.note}”</div> : null}
                {prob?.code === 'price_changed' && prob.actual !== undefined ? <div className="field__error">{t('cart.priceChangedLine', { old: money(l.expectedUnitPriceAgorot, locale), new: money(prob.actual, locale) })}</div> : prob ? <div className="field__error">{t('cart.unavailableLine')}</div> : null}
                <div className="row row--between">
                  {l.requestedGrams ? (
                    <Stepper value={l.requestedGrams} min={100} max={20000} step={100} onChange={(g) => updateLine(l.lineId, { requestedGrams: g })} decLabel={t('product.decrease')} incLabel={t('product.increase')} format={(v) => formatGrams(v, locale)} />
                  ) : (
                    <Stepper value={l.quantity} min={0} max={99} onChange={(q) => (q === 0 ? removeLine(l.lineId) : updateLine(l.lineId, { quantity: q }))} decLabel={t('product.decrease')} incLabel={t('product.increase')} />
                  )}
                  <span className="price"><bdi>{priced ? money(priced.lineTotalAgorot, locale) : '…'}</bdi>{l.requestedGrams ? <span className="muted"> ({t('common.estimated')})</span> : null}</span>
                </div>
              </div>
              <IconButton icon="x" label={t('common.remove')} onClick={() => removeLine(l.lineId)} />
            </li>
          );
        })}
      </ul>
      {quote ? <Summary totals={quote.totals} mode={cart.mode} /> : null}
      {quote?.totals.isEstimated ? <p className="muted">{t('cart.estimatedNote')}</p> : null}
      <Button block disabled={!canCheckout} onClick={() => navigate('/checkout')}>{t('cart.checkout')}</Button>
      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={() => { clearCart(); setConfirmClear(false); }} title={t('cart.clear')} body={t('cart.clearConfirm')} confirmLabel={t('cart.clear')} danger />
    </div>
  );
}
