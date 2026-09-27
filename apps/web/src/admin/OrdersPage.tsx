import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { collection, orderBy as fbOrderBy, query, where as fbWhere } from 'firebase/firestore';
import { formatPhoneDisplay, type Order, type OrderEvent } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { db } from '@/lib/firebase';
import { useCollection, usePaged, orderBy, limit } from '@/lib/queries';
import { call, newIdempotencyKey } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { money, formatLocalDateTime } from '@/lib/format';
import { Badge, Button, Dialog, EmptyState, StackTable, TextArea, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { LoadError } from '@/business/BusinessExperience';
import { OrderLines, OrderStatusBadge } from '@/business/OrderCard';
import { AddressSummary } from '@/customer/AddressForm';
import { Summary } from '@/customer/Summary';
import { UserLink, minutesSince, modeLabel, useUsers } from './lib';

type Filter = 'all' | 'placed';

export function OrdersPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('filter') === 'placed' ? 'placed' : 'all';
  const ref = params.get('ref')?.trim() ?? '';
  const [draft, setDraft] = useState(ref);
  const paged = usePaged<Order>(() => (ref ? query(collection(db, 'orders'), fbWhere('reference', '==', ref)) : filter === 'placed' ? query(collection(db, 'orders'), fbWhere('status', '==', 'placed'), fbOrderBy('placedAt', 'asc')) : query(collection(db, 'orders'), fbOrderBy('placedAt', 'desc'))), 25, [filter, ref]);
  const [inspect, setInspect] = useState<Order | null>(null);
  const setFilter = (f: Filter) => setParams(f === 'placed' ? { filter: f } : {}, { replace: true });
  return (
    <div className="stack">
      <h1>{t('admin.orders')}</h1>
      <form className="row admin-search" role="search" onSubmit={(e) => { e.preventDefault(); setParams(draft.trim() ? { ref: draft.trim() } : {}, { replace: true }); }}>
        <input className="input" type="search" inputMode="numeric" dir="ltr" value={draft} onChange={(e) => { setDraft(e.target.value); if (!e.target.value) setParams({}, { replace: true }); }} placeholder={t('admin.orderSearch')} aria-label={t('admin.orderSearch')} />
        <Button type="submit" variant="secondary">{t('common.search')}</Button>
      </form>
      {ref ? null : <div className="tabs" role="tablist"><button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>{t('dash.filterAll')}</button><button type="button" role="tab" aria-selected={filter === 'placed'} onClick={() => setFilter('placed')}>{t('dash.awaitingAcceptance')}</button></div>}
      {paged.error ? <LoadError retry={paged.reload} /> : !paged.loading && paged.items.length === 0 ? <EmptyState icon="bag" title={ref ? t('admin.noResults') : t('dash.noOrders')} /> : (
        <StackTable><table className="table"><thead><tr><th>{t('orders.order')}</th><th>{t('admin.business')}</th><th>{t('common.status')}</th><th>{t('common.date')}</th><th>{t('common.total')}</th><th></th></tr></thead><tbody>{paged.items.map((o) => {
          const waited = o.status === 'placed' ? minutesSince(o.placedAt) : 0;
          return <tr key={o.id}><td><span className="order-card__ref admin-ref">{o.reference}</span></td><td><Link to={`/admin/businesses/${o.businessId}`}>{L(o.businessName)}</Link><div className="muted">{L(o.branchName)}</div></td><td><div className="admin-badges"><OrderStatusBadge status={o.status} stage={o.stage} mode={o.mode} /><CashBadge order={o} />{waited >= 30 ? <Badge tone="danger" icon="clock">{t('admin.waiting', { minutes: waited })}</Badge> : null}</div></td><td><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></td><td><bdi className="money">{money(o.totals.cashDueAgorot, locale)}</bdi></td><td><Button size="sm" variant="ghost" onClick={() => setInspect(o)}>{t('admin.orderInspect')}</Button></td></tr>;
        })}</tbody></table></StackTable>
      )}
      {!paged.done && !paged.error ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
      <OrderInspect order={inspect} onClose={() => setInspect(null)} onChanged={paged.reload} />
    </div>
  );
}

export function CashBadge({ order }: { order: Order }) {
  const t = useT();
  if (!order.cashRecordId) return null;
  return order.cashReversedAt ? <Badge tone="muted">{t('owner.cashReversed')}</Badge> : <Badge tone="success">{t('receipt.cashReceived')}</Badge>;
}

const EVENT_ICON: Record<OrderEvent['type'], 'bag' | 'check' | 'x' | 'bell' | 'printer' | 'edit' | 'wallet'> = { placed: 'bag', accepted: 'check', rejected: 'x', ready: 'bell', completed: 'check', printed: 'printer', revised: 'edit', cash_recorded: 'wallet', cash_reversed: 'wallet', adjustment: 'wallet' };

/** Read-only order summary for the admin, with the event trail and the one admin-only action (cash reversal). */
export function OrderInspect({ order, onClose, onChanged }: { order: Order | null; onClose: () => void; onChanged?: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const events = useCollection<OrderEvent>(order ? `orders/${order.id}/events` : null, [orderBy('at', 'asc'), limit(50)], [order?.id]);
  const users = useUsers(events.data.map((e) => e.actorUid));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const o = order;
  const settled = !!o?.cashRecordId && !o.cashReversedAt;
  const reverse = async () => {
    if (!o) return;
    setBusy(true);
    try {
      await call('adminReverseCash', { orderId: o.id, reason: reason.trim(), idempotencyKey: newIdempotencyKey() });
      toast(t('common.saved'));
      setReason('');
      onClose();
      onChanged?.();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!o} onClose={onClose} title={o ? t('dash.orderNumber', { reference: o.reference }) : ''}>
      {o ? (
        <div className="stack">
          <div className="admin-badges"><OrderStatusBadge status={o.status} stage={o.stage} mode={o.mode} /><CashBadge order={o} /><Badge tone="neutral">{modeLabel(o, t)}</Badge></div>
          <div className="kvlist">
            <div><span className="muted">{t('admin.business')}</span><span><Link to={`/admin/businesses/${o.businessId}`} onClick={onClose}>{L(o.businessName)}</Link> · {L(o.branchName)}</span></div>
            <div><span className="muted">{t('admin.customer')}</span><span><UserLink uid={o.customer.uid} name={o.contactName} onClick={onClose} /> · <bdi className="num">{formatPhoneDisplay(o.contactPhone)}</bdi></span></div>
            <div><span className="muted">{t('dash.placedLabel')}</span><span><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></span></div>
            {o.decisionReason ? <div><span className="muted">{t('common.reason')}</span><span><bdi>{o.decisionReason}</bdi></span></div> : null}
            {o.customerNote ? <div><span className="muted">{t('common.notes')}</span><span><bdi>{o.customerNote}</bdi></span></div> : null}
          </div>
          {o.address ? <div className="address-block"><AddressSummary a={{ ...o.address, cityName: o.address.cityName }} /></div> : null}
          <OrderLines order={o} />
          <div className="summary-ledger"><Summary totals={o.totals} mode={o.mode} cashReceived={settled ? o.totals.cashDueAgorot : undefined} rejected={o.status === 'rejected'} /></div>
          <section className="stack--sm stack">
            <h3>{t('dash.events')}</h3>
            <ul className="list">{events.data.map((e) => (
              <li key={e.id} className="list__item admin-item">
                <Icon name={EVENT_ICON[e.type]} size={18} />
                <div className="list__grow">
                  <div><strong>{e.type === 'adjustment' ? t('loyalty.entry.admin_adjust') : t(`owner.event.${e.type}`)}</strong> · {e.actorRole === 'owner' || e.actorRole === 'manager' || e.actorRole === 'staff' ? t(`staff.role.${e.actorRole}`) : t(`owner.actor.${e.actorRole}`)}{e.actorRole !== 'customer' && e.actorRole !== 'system' ? ` · ${users.name(e.actorUid)}` : ''}</div>
                  {e.reason ? <div className="muted"><bdi>{e.reason}</bdi></div> : null}
                  <div className="muted"><bdi>{formatLocalDateTime(e.at, locale)}</bdi></div>
                </div>
              </li>
            ))}</ul>
          </section>
          <Link className="btn btn--secondary" to={`/business/${o.businessId}/${o.branchId}/orders/${o.id}`}>{t('admin.openInDashboard')}</Link>
          {settled ? (
            <div className="card stack--sm stack">
              <h3>{t('admin.cashReconcile')}</h3>
              <p className="muted">{t('admin.cashReconcileBody')}</p>
              <TextArea label={t('common.reason')} required value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void reverse()}>{t('dash.reverseCash')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
