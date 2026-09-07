import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, orderBy as fbOrderBy, query, where as fbWhere } from 'firebase/firestore';
import { formatPhoneDisplay, type CashRecord, type Order, type OrderEvent, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, useDoc, usePaged, where, orderBy, limit } from '@/lib/queries';
import { db } from '@/lib/firebase';
import { Button, EmptyState, Skeleton, Alert, Dialog, TextInput, TextArea, Checkbox, Select, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money, formatLocalDateTime, telHref } from '@/lib/format';
import { call, newIdempotencyKey } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { PageTitle, useDash } from './shell';
import { OrderCard, OrderLines, OrderStatusBadge } from './OrderCard';
import { PrintOrderButton } from './PrintOrderButton';
import { AddressSummary } from '@/customer/AddressForm';
import { Summary } from '@/customer/Summary';
import { useNow } from '@/customer/hooks';

function useNewOrderAlert(orders: Order[]) {
  const t = useT();
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('qareeb.sound') === '1'; } catch { return false; } });
  const known = useRef<Set<string> | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const ids = new Set(orders.map((o) => o.id));
    if (known.current === null) {
      known.current = ids;
      return;
    }
    const fresh = orders.filter((o) => !known.current!.has(o.id));
    known.current = ids;
    if (fresh.length > 0) {
      toast(fresh.length === 1 ? t('dash.newOrder') : t('dash.newOrders', { count: fresh.length }));
      if (sound && ctxRef.current) {
        const ctx = ctxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    }
  }, [orders, sound, t]);
  const toggle = () => {
    // Audio must be unlocked by a user gesture; the toggle click is that gesture.
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    void ctxRef.current.resume();
    const next = !sound;
    setSound(next);
    try { localStorage.setItem('qareeb.sound', next ? '1' : '0'); } catch { /* ignore */ }
  };
  return { sound, toggle };
}

export function IncomingOrdersPage() {
  const t = useT();
  const { business, branch } = useDash();
  const placed = useCollection<Order>('orders', [where('businessId', '==', business.id), where('branchId', '==', branch.id), where('status', '==', 'placed'), orderBy('placedAt', 'asc'), limit(50)], [branch.id]);
  const { sound, toggle } = useNewOrderAlert(placed.data);
  const nowMs = useNow().getTime();
  const aging = placed.data.some((o) => nowMs - Date.parse(o.placedAt) > 30 * 60000);
  return (
    <div className="stack">
      <PageTitle title={t('dash.incoming')}>
        <Button size="sm" variant="secondary" icon={sound ? 'volume' : 'volumeOff'} onClick={toggle} aria-pressed={sound} title={t('dash.soundHint')}>{sound ? t('dash.soundOn') : t('dash.soundOff')}</Button>
      </PageTitle>
      {aging ? <Alert tone="warn">{t('dash.agingWarning')}</Alert> : null}
      {placed.error ? <Alert tone="danger">{t('common.errorGeneric')}</Alert> : null}
      {placed.loading ? <div className="orders-grid" aria-busy="true"><Skeleton height={320} radius={16} /><Skeleton height={320} radius={16} /></div> : placed.data.length === 0 ? <EmptyState icon="bell" title={t('dash.noIncoming')} body={t('dash.noIncomingHint')} /> : (
        <div className="orders-grid" aria-live="polite">{placed.data.map((o) => <OrderCard key={o.id} order={o} />)}</div>
      )}
    </div>
  );
}

export function OrderHistoryPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch } = useDash();
  const [filter, setFilter] = useState<'all' | Order['status']>('all');
  const paged = usePaged<Order>(() => {
    const base = collection(db, 'orders');
    return filter === 'all' ? query(base, fbWhere('businessId', '==', business.id), fbWhere('branchId', '==', branch.id), fbOrderBy('placedAt', 'desc')) : query(base, fbWhere('businessId', '==', business.id), fbWhere('branchId', '==', branch.id), fbWhere('status', '==', filter), fbOrderBy('placedAt', 'desc'));
  }, 20, [branch.id, filter]);
  return (
    <div className="stack">
      <PageTitle title={t('dash.history')} />
      <div className="tabs" role="tablist">
        {(['all', 'placed', 'accepted', 'rejected'] as const).map((f) => <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{t(f === 'all' ? 'dash.filterAll' : f === 'placed' ? 'dash.filterPlaced' : f === 'accepted' ? 'dash.filterAccepted' : 'dash.filterRejected')}</button>)}
      </div>
      {paged.error ? <Alert tone="danger">{t('common.errorGeneric')}</Alert> : null}
      {paged.items.length === 0 && !paged.loading ? <EmptyState icon="list" title={t('dash.noOrders')} /> : null}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('orders.order')}</th><th>{t('common.status')}</th><th>{t('dash.customer')}</th><th>{t('common.date')}</th><th>{t('common.total')}</th><th></th></tr></thead>
          <tbody>
            {paged.items.map((o) => (
              <tr key={o.id}>
                <td><span className="order-card__ref" style={{ fontSize: 16 }}>{o.reference}</span><div className="muted">{o.mode === 'delivery' ? t('common.delivery') : t('common.pickup')}</div></td>
                <td><OrderStatusBadge status={o.status} />{o.cashRecordId ? <div className="badge badge--success" style={{ marginTop: 4 }}>{t('receipt.cashReceived')}</div> : null}</td>
                <td>{o.contactName}<div className="muted">{L(o.lines.map((l) => l.name)[0] ?? {})}{o.lines.length > 1 ? ` +${o.lines.length - 1}` : ''}</div></td>
                <td><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></td>
                <td><bdi className="price">{money(o.totals.cashDueAgorot, locale)}</bdi></td>
                <td><Link className="btn btn--ghost btn--sm" to={`/business/${o.businessId}/${o.branchId}/orders/${o.id}`}>{t('dash.orderDetail')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!paged.done ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
    </div>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch, can } = useDash();
  const order = useDoc<Order>(orderId ? `orders/${orderId}` : null);
  const events = useCollection<OrderEvent>(orderId ? `orders/${orderId}/events` : null, [orderBy('at', 'asc'), limit(100)], [orderId]);
  const cash = useDoc<CashRecord>(order.data?.cashRecordId ? `cashRecords/${order.data.cashRecordId}` : null);
  const [revise, setRevise] = useState(false);
  const [recordCash, setRecordCash] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (order.loading) return <Skeleton height={300} radius={16} />;
  if (!order.data || order.data.branchId !== branch.id) return <EmptyState icon="alert" title={t('common.notFound')} />;
  const o = order.data;
  const cashRecord = cash.data && !cash.data.reversed ? cash.data : null;
  const doRecordCash = async () => {
    setBusy(true);
    try {
      const r = await call<{ pointsEarned: number }>('recordCash', { orderId: o.id, amountAgorot: o.totals.cashDueAgorot, expectedVersion: o.version, idempotencyKey: newIdempotencyKey() });
      toast(`${t('dash.cashRecorded', { amount: money(o.totals.cashDueAgorot, locale) })} · ${t('orders.loyaltyEarned')}: ${r.pointsEarned}`);
      setRecordCash(false);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <PageTitle title={t('dash.orderNumber', { reference: o.reference })}>
        <OrderStatusBadge status={o.status} />
        {can('print') ? <PrintOrderButton order={o} /> : null}
      </PageTitle>
      <div className="two-col" style={{ alignItems: 'start' }}>
        <div className="stack">
          <OrderCard order={o} detailLink={false} />
          <section className="card stack">
            <h2>{t('checkout.summary')}</h2>
            <Summary totals={o.totals} mode={o.mode} cashReceived={cashRecord?.amountAgorot} />
            {o.revision > 0 ? <div className="muted">{t('orders.original')}: <bdi>{money(o.originalTotals.cashDueAgorot, locale)}</bdi> · {t('common.version')} {o.version} · rev {o.revision}</div> : null}
            {o.locked ? <Alert tone="info">{t('dash.locked')}</Alert> : null}
            {o.status !== 'rejected' && !o.locked && can('orders') ? <Button variant="secondary" icon="edit" onClick={() => setRevise(true)}>{t('dash.revise')}</Button> : null}
            {o.status === 'accepted' && !o.cashRecordId && can('cash') ? (
              <>
                {o.totals.isEstimated ? <Alert tone="warn">{t('dash.cashBlockedWeights')}</Alert> : null}
                <Button icon="wallet" disabled={o.totals.isEstimated} onClick={() => setRecordCash(true)}>{t('dash.recordCash')}</Button>
              </>
            ) : null}
            {cashRecord ? <div className="alert alert--success"><Icon name="check" size={18} /><div>{t('dash.cashRecorded', { amount: money(cashRecord.amountAgorot, locale) })}<div className="muted">{t('dash.cashRecordedBy', { name: cashRecord.recordedBy === o.decidedBy ? t('dash.actorYou') : cashRecord.recordedBy.slice(0, 6), time: formatLocalDateTime(cashRecord.recordedAt, locale) })}</div></div></div> : null}
            {cashRecord && can('financials') ? <Button variant="danger" size="sm" onClick={() => setReverse(true)}>{t('dash.reverseCash')}</Button> : null}
          </section>
        </div>
        <section className="card stack">
          <h2>{t('dash.events')}</h2>
          <ul className="list">
            {events.data.map((e) => (
              <li key={e.id} className="list__item" style={{ alignItems: 'flex-start' }}>
                <Icon name={e.type === 'placed' ? 'bag' : e.type === 'accepted' ? 'check' : e.type === 'rejected' ? 'x' : e.type === 'printed' ? 'printer' : e.type === 'revised' ? 'edit' : 'wallet'} size={18} />
                <div className="list__grow">
                  <div><strong>{e.type}</strong> · {e.actorRole}{e.phoneAgreement ? ` · ${t('dash.phoneAgreement')}` : ''}</div>
                  {e.reason ? <div className="muted">{e.reason}</div> : null}
                  <div className="muted"><bdi>{formatLocalDateTime(e.at, locale)}</bdi> · v{e.version}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {revise ? <ReviseDialog order={o} onClose={() => setRevise(false)} /> : null}
      <ConfirmDialog open={recordCash} onClose={() => setRecordCash(false)} onConfirm={doRecordCash} loading={busy} title={t('dash.recordCashTitle')} confirmLabel={t('dash.recordCash')} body={<div className="stack--sm stack"><p>{t('dash.recordCashBody')}</p><div className="summary__row summary__row--total"><span>{t('dash.cashAmount')}</span><bdi>{money(o.totals.cashDueAgorot, locale)}</bdi></div><p className="muted">{o.mode === 'delivery' ? t('checkout.cashOnDelivery') : t('checkout.cashOnPickup')} · {L(business.name, business.defaultLocale)}</p></div>} />
      <Dialog open={reverse} onClose={() => setReverse(false)} title={t('dash.reverseCash')} sheet={false} footer={<><Button variant="secondary" onClick={() => setReverse(false)}>{t('common.cancel')}</Button><Button variant="danger-solid" loading={busy} disabled={reverseReason.trim().length < 3} onClick={async () => { setBusy(true); try { await call('reverseCash', { orderId: o.id, reason: reverseReason.trim(), idempotencyKey: newIdempotencyKey() }); setReverse(false); toast(t('common.saved')); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('dash.reverseCash')}</Button></>}>
        <div className="stack"><p>{t('dash.reverseCashBody')}</p><TextArea label={t('common.reason')} required value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} /></div>
      </Dialog>
    </div>
  );
}

type Change = { lineId: string; action: 'remove' | 'set_quantity' | 'set_actual_weight' | 'substitute'; quantity?: number; actualGrams?: number; replacementProductId?: string; replacementVariantId?: string; replacementQuantity?: number; replacementGrams?: number };

function ReviseDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch } = useDash();
  const products = useCollection<Product>(`businesses/${business.id}/branches/${branch.id}/products`, [where('archived', '==', false), limit(500)], [branch.id]);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [reason, setReason] = useState('');
  const [agreement, setAgreement] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (lineId: string, c: Change | null) => setChanges((s) => { const n = { ...s }; if (c) n[lineId] = c; else delete n[lineId]; return n; });
  const list = Object.values(changes);
  const needsAgreement = list.some((c) => c.action === 'remove' || c.action === 'substitute' || (c.action === 'set_quantity' && (c.quantity ?? 0) > (order.lines.find((l) => l.lineId === c.lineId)?.quantity ?? 0)));
  const submit = async () => {
    setBusy(true);
    try {
      await call('reviseOrder', { orderId: order.id, expectedVersion: order.version, idempotencyKey: newIdempotencyKey(), reason: reason.trim(), phoneAgreement: agreement, changes: list });
      toast(t('dash.revisionSaved'));
      onClose();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('dash.reviseTitle')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={list.length === 0 || reason.trim().length < 2 || (needsAgreement && !agreement)} onClick={submit}>{t('dash.saveRevision')}</Button></>}>
      <div className="stack">
        <p className="muted">{t('dash.reviseBody')}</p>
        {order.lines.filter((l) => !l.removed).map((l) => {
          const c = changes[l.lineId];
          return (
            <div key={l.lineId} className="card stack--sm stack">
              <strong>{L(l.name)}{l.variantName ? ` (${L(l.variantName)})` : ''} · {l.pricingMode === 'weight' ? `${l.actualGrams ?? l.requestedGrams} g` : `${l.quantity} ×`}</strong>
              <div className="row">
                {l.pricingMode === 'weight' ? (
                  <TextInput label={t('dash.setActualWeight')} type="number" inputMode="numeric" min={0} ltr value={c?.action === 'set_actual_weight' ? c.actualGrams ?? '' : ''} onChange={(e) => set(l.lineId, e.target.value ? { lineId: l.lineId, action: 'set_actual_weight', actualGrams: Number(e.target.value) } : null)} />
                ) : (
                  <TextInput label={t('dash.newQuantity')} type="number" inputMode="numeric" min={0} max={999} ltr value={c?.action === 'set_quantity' ? c.quantity ?? '' : ''} onChange={(e) => set(l.lineId, e.target.value !== '' ? { lineId: l.lineId, action: 'set_quantity', quantity: Number(e.target.value) } : null)} />
                )}
                <Button size="sm" variant={c?.action === 'remove' ? 'danger-solid' : 'danger'} icon="trash" onClick={() => set(l.lineId, c?.action === 'remove' ? null : { lineId: l.lineId, action: 'remove' })}>{t('dash.removeLine')}</Button>
              </div>
              <Select label={t('dash.substitute')} optional value={c?.action === 'substitute' ? c.replacementProductId ?? '' : ''} onChange={(e) => { const pid = e.target.value; if (!pid) return set(l.lineId, null); const p = products.data.find((x) => x.id === pid)!; set(l.lineId, { lineId: l.lineId, action: 'substitute', replacementProductId: pid, replacementVariantId: p.variants[0]?.id, replacementQuantity: p.pricingMode === 'unit' ? 1 : undefined, replacementGrams: p.pricingMode === 'weight' ? p.minWeightGrams ?? 100 : undefined }); }}>
                <option value="">{t('common.none')}</option>
                {products.data.filter((p) => p.available).map((p) => <option key={p.id} value={p.id}>{L(p.name, business.defaultLocale)}</option>)}
              </Select>
              {c?.action === 'substitute' ? (() => { const p = products.data.find((x) => x.id === c.replacementProductId); if (!p) return null; return (
                <div className="row">
                  {p.variants.length ? <Select label={t('product.size')} value={c.replacementVariantId ?? ''} onChange={(e) => set(l.lineId, { ...c, replacementVariantId: e.target.value })}>{p.variants.map((v) => <option key={v.id} value={v.id}>{L(v.name, business.defaultLocale)}</option>)}</Select> : null}
                  {p.pricingMode === 'weight' ? <TextInput label={t('common.weight')} type="number" ltr value={c.replacementGrams ?? ''} onChange={(e) => set(l.lineId, { ...c, replacementGrams: Number(e.target.value) })} /> : <TextInput label={t('common.quantity')} type="number" ltr value={c.replacementQuantity ?? 1} onChange={(e) => set(l.lineId, { ...c, replacementQuantity: Number(e.target.value) })} />}
                </div>
              ); })() : null}
            </div>
          );
        })}
        <TextInput label={t('dash.reviseReason')} required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        <Checkbox label={t('dash.phoneAgreement')} hint={needsAgreement ? t('dash.phoneAgreementRequired') : undefined} checked={agreement} onChange={(e) => setAgreement(e.target.checked)} />
      </div>
    </Dialog>
  );
}

export { formatPhoneDisplay, telHref, AddressSummary, OrderLines };
