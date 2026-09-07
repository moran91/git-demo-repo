import type { OrderTotals } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { money } from '@/lib/format';

export function Summary({ totals, mode, cashReceived }: { totals: OrderTotals; mode: 'pickup' | 'delivery'; cashReceived?: number }) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <div className="summary card">
      <div className="summary__row"><span>{t('common.subtotal')}</span><bdi className="num">{money(totals.merchandiseSubtotalAgorot, locale)}</bdi></div>
      {totals.loyaltyDiscountAgorot > 0 ? <div className="summary__row"><span>{t('common.loyaltyDiscount')}</span><bdi className="num">-{money(totals.loyaltyDiscountAgorot, locale)}</bdi></div> : null}
      {mode === 'delivery' ? <div className="summary__row"><span>{t('common.deliveryFee')}</span><bdi className="num">{totals.deliveryFeeAgorot === 0 ? t('common.free') : money(totals.deliveryFeeAgorot, locale)}</bdi></div> : null}
      <div className="summary__row summary__row--total"><span>{totals.isEstimated ? t('checkout.estimatedTotal') : t('common.cashDue')}</span><bdi className="num">{money(totals.cashDueAgorot, locale)}</bdi></div>
      <div className="muted" style={{ textAlign: 'end' }}>{cashReceived !== undefined ? t('dash.cashRecorded', { amount: money(cashReceived, locale) }) : mode === 'delivery' ? t('checkout.cashOnDelivery') : t('checkout.cashOnPickup')}</div>
      <div className="muted">{t('checkout.summaryNote')}</div>
    </div>
  );
}
