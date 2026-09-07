import { Link, useParams, useLocation } from 'react-router';
import { formatPhoneDisplay, type CashRecord, type Order, type OrderEvent } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useCollection, useDoc, orderBy, where, limit } from '@/lib/queries';
import { Badge, EmptyState, Skeleton, Alert } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money, formatLocalDateTime, telHref } from '@/lib/format';
import { Summary } from './Summary';
import { AddressSummary } from './AddressForm';
import { NotificationPrompt } from './NotificationPrompt';

export function StatusBadge({ status }: { status: Order['status'] }) {
  const t = useT();
  const tone = status === 'accepted' ? 'success' : status === 'rejected' ? 'danger' : 'accent';
  const icon = status === 'accepted' ? 'check' : status === 'rejected' ? 'x' : 'clock';
  return <Badge tone={tone} icon={icon}>{t(`orders.statusShort.${status}`)}</Badge>;
}

export function OrdersPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { user, loading } = useAuth();
  const orders = useCollection<Order>(user ? 'orders' : null, [where('customer.uid', '==', user?.uid ?? '_'), orderBy('placedAt', 'desc'), limit(50)], [user?.uid]);
  if (loading || (user && orders.loading)) return <div className="stack" aria-busy="true"><Skeleton height={32} width="40%" /><Skeleton height={90} radius={16} /><Skeleton height={90} radius={16} /></div>;
  if (!user) return <EmptyState icon="user" title={t('account.guest')} body={t('account.guestHint')} action={<Link className="btn btn--primary" to="/signin">{t('common.signIn')}</Link>} />;
  return (
    <div className="stack">
      <h1>{t('orders.title')}</h1>
      {orders.error ? <Alert tone="danger">{t('common.errorGeneric')}</Alert> : null}
      {orders.data.length === 0 ? <EmptyState icon="bag" title={t('orders.empty')} body={t('orders.emptyHint')} action={<Link className="btn btn--primary" to="/">{t('cart.browse')}</Link>} /> : null}
      <ul className="stack--sm stack">
        {orders.data.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${o.id}`} className="card card--interactive stack--sm stack" style={{ textDecoration: 'none', color: 'inherit', display: 'flex' }}>
              <div className="row row--between">
                <strong className="order-card__ref">{o.reference}</strong>
                <StatusBadge status={o.status} />
              </div>
              <div className="wrap-anywhere">{L(o.businessName)} · {o.mode === 'delivery' ? t('orders.mode.delivery') : t('orders.mode.pickup')}</div>
              <div className="row row--between muted"><span><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></span><bdi className="price">{money(o.totals.cashDueAgorot, locale)}</bdi></div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrderPage() {
  const { orderId } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const { user, loading } = useAuth();
  const location = useLocation();
  const order = useDoc<Order>(user && orderId ? `orders/${orderId}` : null);
  const events = useCollection<OrderEvent>(user && orderId && order.data ? `orders/${orderId}/events` : null, [orderBy('at', 'asc'), limit(50)], [orderId, !!order.data]);
  const cash = useDoc<CashRecord>(order.data?.cashRecordId ? `cashRecords/${order.data.cashRecordId}` : null);
  if (loading || order.loading) return <div className="stack" aria-busy="true"><Skeleton height={40} width="40%" /><Skeleton height={80} radius={16} /><Skeleton height={200} radius={16} /></div>;
  if (!user) return <EmptyState icon="user" title={t('account.guest')} action={<Link className="btn btn--primary" to="/signin">{t('common.signIn')}</Link>} />;
  if (!order.data) return <EmptyState icon="alert" title={t('common.notFound')} action={<Link className="btn btn--secondary" to="/orders">{t('orders.title')}</Link>} />;
  const o = order.data;
  const placedJustNow = (location.state as { placed?: boolean } | null)?.placed;
  const revised = o.revision > 0;
  const cashRecord = cash.data && !cash.data.reversed ? cash.data : null;
  return (
    <div className="stack">
      {placedJustNow ? <Alert tone="success">{t('checkout.success')} — {t('checkout.successBody')}</Alert> : null}
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="stack--sm stack">
          <span className="muted">{t('checkout.orderReference')}</span>
          <span className="order-ref">{o.reference}</span>
        </div>
        <StatusBadge status={o.status} />
      </div>
      <div className={`status-banner status-banner--${o.status}`}>
        <Icon name={o.status === 'accepted' ? 'check' : o.status === 'rejected' ? 'x' : 'clock'} size={22} />
        <div>
          <strong>{t(`orders.status.${o.status}`)}</strong>
          {o.status === 'placed' ? <div>{t('orders.awaiting')}</div> : null}
          {o.status === 'rejected' && o.decisionReason ? <div>{t('orders.rejectionReason')}: {o.decisionReason}</div> : null}
        </div>
      </div>
      <a className="btn btn--primary" href={telHref(o.branchPhone)}><Icon name="phone" size={18} /> {t('orders.callBusiness')} · <bdi className="num">{formatPhoneDisplay(o.branchPhone)}</bdi></a>
      {placedJustNow ? <NotificationPrompt /> : null}
      <p className="muted">{t('orders.contactBusiness')}</p>
      <section className="card stack--sm stack">
        <strong className="wrap-anywhere">{L(o.businessName)} · {L(o.branchName)}</strong>
        <div className="muted"><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi> · {o.mode === 'delivery' ? t('orders.mode.delivery') : t('orders.mode.pickup')}</div>
        {o.mode === 'delivery' && o.address ? <div className="address-block"><div className="address-block__title"><Icon name="house" size={18} /> {t('dash.houseDescription')}</div><AddressSummary a={{ ...o.address, cityName: o.address.cityName }} /></div> : <div className="muted">{o.contactName} · <bdi className="num">{formatPhoneDisplay(o.contactPhone)}</bdi></div>}
        {o.customerNote ? <div className="muted">“{o.customerNote}”</div> : null}
      </section>
      {revised ? <Alert tone="warn">{t('orders.revised')} — {t('orders.revisedNote')}</Alert> : null}
      <section className="card">
        <h2>{t('orders.items')}</h2>
        <ul className="order-lines" style={{ marginTop: 8 }}>
          {o.lines.map((l) => (
            <li key={l.lineId} className={`order-line ${l.removed ? 'order-line--removed' : ''}`}>
              <span className="wrap-anywhere">
                {l.removed ? <span className="badge badge--danger">{t('orders.removed')}</span> : l.substitutedFromLineId ? <span className="badge badge--accent">{t('orders.substituted')}</span> : null}{' '}
                {l.pricingMode === 'weight' ? (l.actualGrams !== undefined ? `${t('orders.actualWeight')} ${l.actualGrams / 1000} kg` : `${t('orders.requestedWeight')} ${(l.requestedGrams ?? 0) / 1000} kg`) : `${l.quantity} ×`} {L(l.name)}{l.variantName ? ` (${L(l.variantName)})` : ''}
                {l.modifiers.length ? <span className="order-line__mods"> {l.modifiers.map((m) => L(m.optionName)).join(', ')}</span> : null}
                {l.note ? <span className="muted"> “{l.note}”</span> : null}
              </span>
              <bdi className="num">{l.removed ? '' : money(l.lineTotalAgorot, locale)}</bdi>
            </li>
          ))}
        </ul>
      </section>
      <Summary totals={o.totals} mode={o.mode} cashReceived={cashRecord?.amountAgorot} />
      {revised ? <div className="muted">{t('orders.original')} {t('common.total')}: <bdi className="num">{money(o.originalTotals.cashDueAgorot, locale)}</bdi></div> : null}
      {o.loyalty && o.loyalty.pointsReserved > 0 ? <div className="muted">{t('orders.loyaltyReserved')}: {o.loyalty.pointsReserved}</div> : null}
      {events.data.some((e) => e.type === 'cash_recorded') ? <div className="muted">{t('orders.loyaltyEarned')}: {(events.data.find((e) => e.type === 'cash_recorded')?.after as { pointsEarned?: number } | undefined)?.pointsEarned ?? 0}</div> : null}
    </div>
  );
}
