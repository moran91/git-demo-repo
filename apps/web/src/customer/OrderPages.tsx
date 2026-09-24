import { Link, useParams, useLocation } from 'react-router';
import { formatGrams, formatPhoneDisplay, orderProgress, placementSuffix, type Order, type OrderEvent, type OrderProgress } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useCollection, useDoc, orderBy, where, limit } from '@/lib/queries';
import { Badge, EmptyState, Skeleton, Alert } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money, formatLocalDateTime, telHref } from '@/lib/format';
import { Summary } from './Summary';
import { AddressSummary } from './AddressForm';
import { NotificationPrompt } from './NotificationPrompt';

const PROGRESS_TONE: Record<OrderProgress, 'accent' | 'success' | 'danger' | 'primary' | 'neutral'> = { placed: 'accent', accepted: 'success', preparing: 'primary', ready: 'success', completed: 'neutral', rejected: 'danger' };
const PROGRESS_ICON: Record<OrderProgress, 'clock' | 'check' | 'x' | 'utensils' | 'bell'> = { placed: 'clock', accepted: 'check', preparing: 'utensils', ready: 'bell', completed: 'check', rejected: 'x' };

export function StatusBadge({ status }: { status: OrderProgress }) {
  const t = useT();
  return <Badge tone={PROGRESS_TONE[status]} icon={PROGRESS_ICON[status]}>{t(`orders.statusShort.${status}`)}</Badge>;
}

/** Four-step tracker: placed → preparing → ready → done. Hidden for rejected orders (the banner says why). */
function OrderTrack({ progress }: { progress: OrderProgress }) {
  const t = useT();
  const idx = progress === 'placed' ? 0 : progress === 'accepted' || progress === 'preparing' ? 1 : progress === 'ready' ? 2 : 3;
  const steps = [t('orders.track.placed'), progress === 'accepted' ? t('orders.track.accepted') : t('orders.track.preparing'), t('orders.track.ready'), t('orders.track.done')];
  return (
    <ol className="otrack" aria-label={t('orders.track.label')}>
      {steps.map((label, i) => (
        <li key={label} className={`otrack__step ${i < idx || (i === idx && idx === 3) ? 'otrack__step--done' : i === idx ? 'otrack__step--current' : ''}`} aria-current={i === idx ? 'step' : undefined}>
          <span className="otrack__dot" aria-hidden="true">{i < idx || (i === idx && idx === 3) ? <Icon name="check" size={14} /> : null}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** Banner headline for the customer, worded per fulfillment mode once the order is ready or done. The
 *  hint only carries what the headline does not already say. */
function progressCopy(o: Order, progress: OrderProgress, t: ReturnType<typeof useT>): { title: string; hint?: string } {
  if (progress === 'ready') return { title: t(`orders.ready.${o.mode}`), hint: o.mode === 'pickup' ? t('orders.readyHint.pickup') : undefined };
  if (progress === 'completed') return { title: t(`orders.completed.${o.mode}`) };
  if (progress === 'preparing') return { title: t('orders.status.preparing') };
  if (progress === 'placed') return { title: t('orders.status.placed') };
  if (progress === 'rejected') return { title: t('orders.status.rejected'), hint: o.decisionReason ? `${t('orders.rejectionReason')}: ${o.decisionReason}` : undefined };
  return { title: t('orders.status.accepted') };
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
                <StatusBadge status={orderProgress(o)} />
              </div>
              <div className="wrap-anywhere">{L(o.businessName)} · {o.mode === 'delivery' ? t('orders.mode.delivery') : o.mode === 'dine_in' ? (o.tableNumber ? `${t('orders.mode.dineIn')} · ${t('orders.table', { n: o.tableNumber })}` : t('orders.mode.dineIn')) : t('orders.mode.pickup')}</div>
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
  if (loading || order.loading) return <div className="stack" aria-busy="true"><Skeleton height={40} width="40%" /><Skeleton height={80} radius={16} /><Skeleton height={200} radius={16} /></div>;
  if (!user) return <EmptyState icon="user" title={t('account.guest')} action={<Link className="btn btn--primary" to="/signin">{t('common.signIn')}</Link>} />;
  if (!order.data) return <EmptyState icon="alert" title={t('common.notFound')} action={<Link className="btn btn--secondary" to="/orders">{t('orders.title')}</Link>} />;
  const o = order.data;
  // The "sent, awaiting a decision" banner only while the order is still awaiting that decision.
  const placedJustNow = (location.state as { placed?: boolean } | null)?.placed && o.status === 'placed';
  const revised = o.revision > 0;
  // cashRecords is owner/manager-only in firestore.rules, so a customer's read of it always failed
  // and every settled order fell back to "cash on delivery". Settlement state comes from the order:
  // recordCash rejects any amount other than the cash due and then locks the order.
  const cashPaidAgorot = o.cashRecordId && !o.cashReversedAt ? o.totals.cashDueAgorot : undefined;
  const progress = orderProgress(o);
  const copy = progressCopy(o, progress, t);
  return (
    <div className="stack">
      {placedJustNow ? <Alert tone="success">{t('checkout.success')} — {t('checkout.successBody')}</Alert> : null}
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="stack--sm stack">
          <span className="muted">{t('checkout.orderReference')}</span>
          <span className="order-ref">{o.reference}</span>
        </div>
        <StatusBadge status={progress} />
      </div>
      <div className={`status-banner status-banner--${progress}`} role="status">
        <Icon name={PROGRESS_ICON[progress]} size={22} />
        <div className="status-banner__text">
          <strong>{copy.title}</strong>
          {copy.hint ? <div>{copy.hint}</div> : null}
        </div>
      </div>
      {progress !== 'rejected' ? <OrderTrack progress={progress} /> : null}
      <a className="btn btn--primary" href={telHref(o.branchPhone)}><Icon name="phone" size={18} /> {t('orders.callBusiness')} · <bdi className="num">{formatPhoneDisplay(o.branchPhone)}</bdi></a>
      {placedJustNow ? <NotificationPrompt /> : null}
      <p className="muted">{t('orders.contactBusiness')}</p>
      <section className="card stack--sm stack">
        <strong className="wrap-anywhere">{L(o.businessName)} · {L(o.branchName)}</strong>
        <div className="muted"><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi> · {o.mode === 'delivery' ? t('orders.mode.delivery') : o.mode === 'dine_in' ? (o.tableNumber ? `${t('orders.mode.dineIn')} · ${t('orders.table', { n: o.tableNumber })}` : t('orders.mode.dineIn')) : t('orders.mode.pickup')}</div>
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
                {l.pricingMode === 'weight' ? (l.actualGrams !== undefined ? `${t('orders.actualWeight')} ${formatGrams(l.actualGrams, locale)}` : `${t('orders.requestedWeight')} ${formatGrams(l.requestedGrams ?? 0, locale)}`) : `${l.quantity} ×`} {L(l.name)}{l.variantName ? ` (${L(l.variantName)})` : ''}
                {l.comboItems ? <span className="order-line__mods"> ({l.comboItems.map((ci) => `${ci.quantity} × ${L(ci.name)}`).join(' + ')})</span> : null}
                {l.modifiers.length ? <span className="order-line__mods"> {l.modifiers.map((m) => L(m.optionName) + placementSuffix(m.placement, t)).join(', ')}</span> : null}
                {l.note ? <span className="muted"> “{l.note}”</span> : null}
              </span>
              <bdi className="num">{l.removed ? '' : money(l.lineTotalAgorot, locale)}</bdi>
            </li>
          ))}
        </ul>
      </section>
      <Summary totals={o.totals} mode={o.mode} cashReceived={cashPaidAgorot} rejected={o.status === 'rejected'} />
      {revised ? <div className="muted">{t('orders.original')} {t('common.total')}: <bdi className="num">{money(o.originalTotals.cashDueAgorot, locale)}</bdi></div> : null}
      {o.loyalty && o.loyalty.pointsReserved > 0 ? <div className="muted">{t('orders.loyaltyReserved')}: {o.loyalty.pointsReserved}</div> : null}
      {events.data.some((e) => e.type === 'cash_recorded') ? <div className="muted">{t('orders.loyaltyEarned')}: {(events.data.find((e) => e.type === 'cash_recorded')?.after as { pointsEarned?: number } | undefined)?.pointsEarned ?? 0}</div> : null}
    </div>
  );
}
