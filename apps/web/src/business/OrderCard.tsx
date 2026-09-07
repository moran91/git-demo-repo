import { useState } from 'react';
import { Link } from 'react-router';
import { formatPhoneDisplay, type Order } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Button, Badge, Dialog, TextArea, toast, Alert } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money, formatLocalDateTime, telHref } from '@/lib/format';
import { call, newIdempotencyKey, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { AddressSummary } from '@/customer/AddressForm';
import { useDash } from './shell';
import { useNow } from '@/customer/hooks';
import { PrintOrderButton } from './PrintOrderButton';

export function OrderStatusBadge({ status }: { status: Order['status'] }) {
  const t = useT();
  return <Badge tone={status === 'accepted' ? 'success' : status === 'rejected' ? 'danger' : 'accent'} icon={status === 'accepted' ? 'check' : status === 'rejected' ? 'x' : 'clock'}>{status === 'placed' ? t('dash.awaitingAcceptance') : status === 'accepted' ? t('dash.accepted') : t('dash.rejected')}</Badge>;
}

export function OrderLines({ order, compact }: { order: Order; compact?: boolean }) {
  const t = useT();
  const { L, locale } = useI18n();
  return (
    <ul className="order-lines">
      {order.lines.map((l) => (
        <li key={l.lineId} className={`order-line ${l.removed ? 'order-line--removed' : ''}`}>
          <span className="wrap-anywhere">
            {l.removed ? <span className="badge badge--danger">{t('orders.removed')}</span> : l.substitutedFromLineId ? <span className="badge badge--accent">{t('orders.substituted')}</span> : null}{' '}
            <strong>{l.pricingMode === 'weight' ? (l.actualGrams !== undefined ? `${l.actualGrams} g` : `${l.requestedGrams ?? 0} g`) : `${l.quantity} ×`}</strong> {L(l.name)}{l.variantName ? ` (${L(l.variantName)})` : ''}
            {l.pricingMode === 'weight' && l.actualGrams !== undefined ? <span className="muted"> · {t('orders.requestedWeight')} {l.requestedGrams} g</span> : null}
            {l.modifiers.length ? <div className="order-line__mods">+ {l.modifiers.map((m) => L(m.optionName)).join(', ')}</div> : null}
            {l.note ? <div className="order-line__mods">“{l.note}”</div> : null}
          </span>
          {!compact ? <bdi className="num">{l.removed ? '' : money(l.lineTotalAgorot, locale)}</bdi> : null}
        </li>
      ))}
    </ul>
  );
}

/** Incoming-order card: reference, Placed label, time, customer, items, house description, cash total, Accept/Reject side by side. */
export function OrderCard({ order, detailLink }: { order: Order; detailLink?: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { can } = useDash();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'accepted' | 'rejected' | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const decide = async (decision: 'accepted' | 'rejected') => {
    setBusy(decision);
    setConflict(null);
    try {
      await call('decideOrder', { orderId: order.id, decision, reason: decision === 'rejected' ? reason.trim() : undefined, expectedVersion: order.version, idempotencyKey: newIdempotencyKey() });
      setRejecting(false);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'version_conflict' || e.code === 'invalid_status_transition')) setConflict(t('dash.decisionConflict'));
      else toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(null);
    }
  };
  const now = useNow();
  const waiting = Math.max(0, Math.round((now.getTime() - Date.parse(order.placedAt)) / 60000));
  return (
    <article className={`order-card ${order.status === 'placed' ? 'order-card--placed' : ''}`} aria-labelledby={`o-${order.id}`}>
      <div className="order-card__head">
        <div className="stack--sm stack">
          <span id={`o-${order.id}`} className="order-card__ref">{order.reference}</span>
          <div className="row" style={{ gap: 8 }}>
            <OrderStatusBadge status={order.status} />
            <Badge tone="neutral" icon={order.mode === 'delivery' ? 'truck' : 'bag'}>{order.mode === 'delivery' ? t('dash.deliveryOrder') : t('common.pickup')}</Badge>
            {order.revision > 0 ? <Badge tone="accent">{t('orders.revised')}</Badge> : null}
          </div>
        </div>
        <div className="muted" style={{ textAlign: 'end' }}>
          <div>{t('dash.placedLabel')}: <bdi>{formatLocalDateTime(order.placedAt, locale)}</bdi></div>
          {order.status === 'placed' ? <div className={waiting > 15 ? 'badge badge--accent' : ''}>{t('dash.aging', { minutes: waiting })}</div> : null}
        </div>
      </div>
      <div className="row row--between">
        <div><strong>{t('dash.customer')}:</strong> {order.contactName}</div>
        <a className="btn btn--secondary btn--sm" href={telHref(order.contactPhone)}><Icon name="phone" size={16} /> {t('dash.callCustomer')} <bdi className="num">{formatPhoneDisplay(order.contactPhone)}</bdi></a>
      </div>
      <OrderLines order={order} />
      {order.customerNote ? <div className="soft-block"><strong>{t('common.notes')}:</strong> {order.customerNote}</div> : null}
      {order.mode === 'delivery' && order.address ? (
        <div className="address-block">
          <div className="address-block__title"><Icon name="house" size={18} /> {t('dash.houseDescription')}</div>
          <AddressSummary a={{ ...order.address, cityName: order.address.cityName }} />
        </div>
      ) : (
        <div className="muted icon-text"><Icon name="bag" size={16} /> {t('dash.pickupOrder')}</div>
      )}
      <div className="row row--between">
        <span className="muted">{t('dash.cashTotal')} {order.totals.isEstimated ? `(${t('common.estimated')})` : ''}</span>
        <bdi className="price price--lg">{money(order.totals.cashDueAgorot, locale)}</bdi>
      </div>
      {conflict ? <Alert tone="warn">{conflict}</Alert> : null}
      {order.status === 'placed' && can('orders') ? (
        <div className="order-card__actions">
          <Button icon="check" loading={busy === 'accepted'} disabled={busy !== null} onClick={() => decide('accepted')}>{t('dash.accept')}</Button>
          <Button variant="danger" icon="x" disabled={busy !== null} onClick={() => setRejecting(true)}>{t('dash.reject')}</Button>
        </div>
      ) : order.status !== 'placed' ? (
        <div className={`status-banner status-banner--${order.status}`} style={{ padding: 12 }}>
          <Icon name={order.status === 'accepted' ? 'check' : 'x'} size={18} /> <strong>{order.status === 'accepted' ? t('dash.accepted') : t('dash.rejected')}</strong>{order.decisionReason ? <span> — {order.decisionReason}</span> : null}
        </div>
      ) : null}
      <div className="row">
        {can('print') ? <PrintOrderButton order={order} /> : null}
        {detailLink !== false ? <Link className="btn btn--ghost btn--sm" to={`/business/${order.businessId}/${order.branchId}/orders/${order.id}`}>{t('dash.orderDetail')} <Icon name="chevron" directional size={16} /></Link> : null}
      </div>
      <Dialog open={rejecting} onClose={() => setRejecting(false)} title={t('dash.rejectTitle')} sheet={false} footer={<><Button variant="secondary" onClick={() => setRejecting(false)}>{t('common.cancel')}</Button><Button variant="danger-solid" loading={busy === 'rejected'} disabled={reason.trim().length < 2} onClick={() => decide('rejected')}>{t('dash.reject')}</Button></>}>
        <TextArea label={t('dash.rejectReason')} required placeholder={t('dash.rejectReasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Dialog>
    </article>
  );
}
