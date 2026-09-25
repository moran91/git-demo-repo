import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, orderBy as fbOrderBy, query, where as fbWhere } from 'firebase/firestore';
import { formatPhoneDisplay, revisionAgreementReason, startOfLocalDay, toLocal, type CashRecord, type Order, type OrderEvent, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, useDoc, usePaged, where, orderBy, limit } from '@/lib/queries';
import { db } from '@/lib/firebase';
import { Button, EmptyState, Skeleton, Alert, Dialog, TextInput, TextArea, Checkbox, Select, toast, ConfirmDialog } from '@/design/components';
import './orders.css';
import { Icon } from '@/design/Icon';
import { money, formatLocalDateTime, telHref } from '@/lib/format';
import { call, newIdempotencyKey } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { PageTitle, useDash } from './shell';
import { OrderCard, OrderLines, OrderStatusBadge, OrderModeBadges, ElapsedChip, useOrderDecision, useOrderStage, completeLabel, boardColumn, RejectDialog, refLabel, type BoardColumn } from './OrderCard';
import { PrintOrderButton } from './PrintOrderButton';
import { AddressSummary } from '@/customer/AddressForm';
import { Summary } from '@/customer/Summary';
import { useNow } from '@/customer/hooks';
import { useAuth } from '@/lib/auth';
import { GoLiveCard, LoadError } from './BusinessExperience';

function useNewOrderAlert(orders: Order[], loading: boolean) {
  const t = useT();
  // Browsers require a fresh gesture after a reload: the stored preference is only re-armed by the
  // first tap/keypress on the page, and "sound on" is never claimed before the context is running.
  const [sound, setSound] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const arm = async (): Promise<boolean> => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    await ctxRef.current.resume();
    return ctxRef.current.state === 'running';
  };
  useEffect(() => {
    let wanted = false;
    try { wanted = localStorage.getItem('qareeb.sound') === '1'; } catch { /* ignore */ }
    if (!wanted) return;
    const onGesture = () => { void arm().then((ok) => { if (ok) { setSound(true); remove(); } }).catch(() => undefined); };
    const remove = () => { document.removeEventListener('pointerdown', onGesture, true); document.removeEventListener('keydown', onGesture, true); };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    return remove;
  }, []);
  useEffect(() => {
    if (loading) return;
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
  }, [orders, loading, sound, t]);
  useEffect(() => () => { void ctxRef.current?.close().catch(() => undefined); }, []);
  const toggle = async () => {
    const next = !sound;
    try { localStorage.setItem('qareeb.sound', next ? '1' : '0'); } catch { /* ignore */ }
    if (!next) { setSound(false); return; }
    try { setSound(await arm()); } catch { toast(t('common.errorGeneric'), 'danger'); }
  };
  return { sound, toggle };
}

const COLUMNS: readonly BoardColumn[] = ['new', 'preparing', 'ready'] as const;

/**
 * Order board: three columns that mirror the kitchen flow — New (awaiting acceptance) → Preparing →
 * Ready (waiting for the customer / courier). Accepting moves a card to Preparing; "Mark ready" and the
 * hand-over action move it on; completed and rejected orders leave the board and live in History.
 * All three columns are always on screen side by side — phones included — and each card shows what its column needs
 * (see OrderCard); narrow columns switch cards to a compact form through a container query.
 */
export function IncomingOrdersPage() {
  const t = useT();
  const { business, branch } = useDash();
  const placed = useCollection<Order>('orders', [where('businessId', '==', business.id), where('branchId', '==', branch.id), where('status', '==', 'placed'), orderBy('placedAt', 'asc'), limit(50)], [branch.id]);
  const active = useCollection<Order>('orders', [where('businessId', '==', business.id), where('branchId', '==', branch.id), where('stage', 'in', ['preparing', 'ready']), orderBy('placedAt', 'asc'), limit(100)], [branch.id]);
  const { sound, toggle } = useNewOrderAlert(placed.data, placed.loading);
  const nowMs = useNow().getTime();
  const aging = placed.data.some((o) => nowMs - Date.parse(o.placedAt) > 30 * 60000);
  const byColumn = useMemo(() => {
    const m: Record<BoardColumn, Order[]> = { new: placed.data, preparing: [], ready: [] };
    for (const o of active.data) { const c = boardColumn(o); if (c === 'preparing' || c === 'ready') m[c].push(o); }
    // Ready column: longest-waiting first so nothing is forgotten at the counter.
    m.ready.sort((x, y) => Date.parse(x.readyAt ?? x.stageUpdatedAt ?? x.placedAt) - Date.parse(y.readyAt ?? y.stageUpdatedAt ?? y.placedAt));
    return m;
  }, [placed.data, active.data]);
  const loading = placed.loading || active.loading;
  const error = placed.error || active.error;
  const labels: Record<BoardColumn, string> = { new: t('dash.board.new'), preparing: t('dash.board.preparing'), ready: t('dash.board.ready') };
  const empties: Record<BoardColumn, string> = { new: t('dash.board.emptyNew'), preparing: t('dash.board.emptyPreparing'), ready: t('dash.board.emptyReady') };
  return (
    <div className="stack incoming-title board-page">
      <div className="dash__title incoming-head">
        <h1>{t('dash.incoming')}</h1>
        {!placed.loading && byColumn.new.length > 0 ? <span className="incoming-count" role="status" aria-label={t('dash.newOrders', { count: byColumn.new.length })}>{byColumn.new.length}</span> : null}
        <div className="actions">
          <button type="button" className="oc-iconbtn" onClick={toggle} aria-pressed={sound} aria-label={sound ? t('dash.soundOn') : t('dash.soundOff')} title={`${t('dash.soundHint')} ${t('owner.soundHelp')}`}><Icon name={sound ? 'volume' : 'volumeOff'} size={22} /></button>
        </div>
      </div>
      {aging ? <Alert tone="warn">{t('dash.agingWarning')}</Alert> : null}
      {error ? <LoadError /> : null}
      <GoLiveCard />
      <div className="board">
        {COLUMNS.map((c) => (
          <section key={c} id={`board-col-${c}`} aria-labelledby={`board-h-${c}`} className={`board__col board__col--${c}`}>
            <header className="board__head">
              <span className="board__dot" aria-hidden="true" />
              <h2 id={`board-h-${c}`} className="board__h2">{labels[c]}</h2>
              <span className="board__count" aria-hidden="true">{loading ? '…' : byColumn[c].length}</span>{!loading ? <span className="visually-hidden">{t('dash.board.columnCount', { count: byColumn[c].length })}</span> : null}
            </header>
            {loading ? <div className="board__list" aria-busy="true"><Skeleton height={180} radius={12} /></div>
              : byColumn[c].length === 0 ? <div className="board__empty"><Icon name={c === 'new' ? 'bell' : c === 'preparing' ? 'utensils' : 'bag'} size={24} /><span>{empties[c]}</span></div>
              : <div className="board__list" aria-live={c === 'new' ? 'polite' : undefined}>{byColumn[c].map((o) => <OrderCard key={o.id} order={o} />)}</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

type Period = 'today' | 'week' | 'month' | 'all';

function periodStart(p: Period): string | null {
  if (p === 'all') return null;
  const now = new Date();
  // Week/month are rolling windows and zone-independent. "Today" is a calendar boundary, so it must
  // use Asia/Jerusalem — the zone every timestamp on this page is rendered in — not the device zone.
  if (p !== 'today') return new Date(now.getTime() - (p === 'week' ? 7 : 30) * 86400000).toISOString();
  return startOfLocalDay(now).toISOString();
}

function modeLabel(o: Order, t: ReturnType<typeof useT>): string {
  return o.mode === 'delivery' ? t('common.delivery') : o.mode === 'dine_in' ? (o.tableNumber ? t('orders.table', { n: o.tableNumber }) : t('common.dineIn')) : t('common.pickup');
}

export function OrderHistoryPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { business, branch } = useDash();
  const [filter, setFilter] = useState<'all' | Order['status']>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [search, setSearch] = useState('');
  const today = toLocal(useNow()).date;
  const paged = usePaged<Order>(() => {
    const base = collection(db, 'orders');
    const since = periodStart(period);
    const clauses = [fbWhere('businessId', '==', business.id), fbWhere('branchId', '==', branch.id)];
    if (filter !== 'all') clauses.push(fbWhere('status', '==', filter));
    if (since) clauses.push(fbWhere('placedAt', '>=', since));
    return query(base, ...clauses, fbOrderBy('placedAt', 'desc'));
  }, 20, [branch.id, filter, period, period === 'today' ? today : null]);
  const q = search.trim().toLowerCase().replace(/[\s#-]/g, '');
  const items = useMemo(() => q ? paged.items.filter((o) => o.reference.toLowerCase().replace(/[\s-]/g, '').includes(q) || o.contactName.toLowerCase().replace(/\s/g, '').includes(q) || o.contactPhone.replace(/[\s-]/g, '').includes(q) || formatPhoneDisplay(o.contactPhone).replace(/[\s-]/g, '').includes(q)) : paged.items, [paged.items, q]);
  const firstLine = (o: Order) => `${L(o.lines.map((l) => l.name)[0] ?? {})}${o.lines.length > 1 ? ` +${o.lines.length - 1}` : ''}`;
  const statusText = (s: Order['status'], stage?: Order['stage']) => s === 'accepted' && stage ? t(`dash.stage.${stage}`) : t(s === 'placed' ? 'dash.filterPlaced' : s === 'accepted' ? 'dash.filterAccepted' : 'dash.filterRejected');
  return (
    <div className="stack">
      <PageTitle title={t('dash.history')} />
      <div className="hist-filters">
        <div className="hist-filters__row">
          <TextInput label={t('dash.searchOrders')} type="search" placeholder={t('dash.searchOrdersPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label={t('dash.period')} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="all">{t('dash.period.all')}</option>
            <option value="today">{t('common.today')}</option>
            <option value="week">{t('dash.period.week')}</option>
            <option value="month">{t('dash.period.month')}</option>
          </Select>
        </div>
        <div className="hist-chips" role="group" aria-label={t('common.status')}>
          {(['all', 'placed', 'accepted', 'rejected'] as const).map((f) => <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? t('dash.filterAll') : statusText(f)}</button>)}
        </div>
      </div>
      {paged.error ? <LoadError retry={paged.reload} /> : null}
      {paged.loading && paged.items.length === 0 ? <div className="stack stack--sm" aria-busy="true"><Skeleton height={72} radius={16} /><Skeleton height={72} radius={16} /><Skeleton height={72} radius={16} /></div> : null}
      {items.length === 0 && !paged.loading && !paged.error && (paged.done || !q) ? <EmptyState icon="list" title={t('dash.noOrders')} /> : null}
      {items.length > 0 ? <p className="hist-count" role="status">{t('dash.showingCount', { count: items.length })}</p> : null}
      {items.length > 0 ? (
        <ul className="ledger history-cards" aria-label={t('dash.history')}>
          {items.map((o) => (
            <li key={o.id}>
              <Link className="ledger__row" to={`/business/${o.businessId}/${o.branchId}/orders/${o.id}`} aria-label={`${t('dash.orderDetail')} ${o.reference}`}>
                <div className="ledger__main">
                  <div className="ledger__line"><span className="ledger__ref">{refLabel(o.reference)}</span><span className="ledger__name">{o.contactName}</span></div>
                  <div className="ledger__sub"><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi> · {modeLabel(o, t)} · {firstLine(o)}{o.cashRecordId && !o.cashReversedAt ? ` · ${t('receipt.cashReceived')}` : ''}</div>
                </div>
                <div className="ledger__end">
                  <bdi className="ledger__amount">{money(o.totals.cashDueAgorot, locale)}</bdi>
                  <span className={`ledger__status ledger__status--${o.status} ${o.stage ? `ledger__status--${o.stage}` : ''}`}><span className="ledger__dot" aria-hidden="true" />{statusText(o.status, o.stage)}</span>
                </div>
                <span className="ledger__chev"><Icon name="chevron" directional size={20} /></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <div className="table-wrap history-table">
          <table className="table">
            <thead><tr><th>{t('orders.order')}</th><th>{t('common.status')}</th><th>{t('dash.customer')}</th><th>{t('common.date')}</th><th className="num-cell">{t('common.total')}</th><th></th></tr></thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td><span className="ledger__ref">{refLabel(o.reference)}</span><div className="muted">{modeLabel(o, t)}</div></td>
                  <td><span className={`ledger__status ledger__status--${o.status} ${o.stage ? `ledger__status--${o.stage}` : ''}`}><span className="ledger__dot" aria-hidden="true" />{statusText(o.status, o.stage)}</span>{o.cashRecordId && !o.cashReversedAt ? <div className="badge badge--success">{t('receipt.cashReceived')}</div> : null}</td>
                  <td>{o.contactName}<div className="muted">{firstLine(o)}</div></td>
                  <td className="num-cell"><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></td>
                  <td className="num-cell"><bdi className="price">{money(o.totals.cashDueAgorot, locale)}</bdi></td>
                  <td><Link className="btn btn--ghost btn--sm" to={`/business/${o.businessId}/${o.branchId}/orders/${o.id}`}>{t('dash.orderDetail')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!paged.done ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
    </div>
  );
}

/** Fulfillment steps: placed → accepted → ready → completed. Printing and payment are independent facts shown as chips in the header. */
function StatusSteps({ order }: { order: Order }) {
  const t = useT();
  const rejected = order.status === 'rejected';
  const stage = order.status === 'accepted' ? order.stage ?? 'preparing' : undefined;
  const steps = [
    { key: 'placed', label: t('dash.step.placed'), done: true, current: order.status === 'placed' },
    { key: 'accepted', label: rejected ? t('dash.rejected') : stage === 'preparing' ? t('dash.stage.preparing') : t('dash.step.accepted'), done: order.status === 'accepted', current: rejected || stage === 'preparing' },
    { key: 'ready', label: t('dash.step.ready'), done: stage === 'ready' || stage === 'completed', current: stage === 'ready' },
    { key: 'completed', label: t('dash.step.completed'), done: stage === 'completed', current: stage === 'completed' },
  ];
  return (
    <ol className="steps" aria-label={t('dash.orderStatus')}>
      {steps.map((s) => {
        const cls = rejected && s.key === 'accepted' ? 'steps__step--danger' : s.done ? 'steps__step--done' : '';
        return (
          <li key={s.key} className={`steps__step ${cls} ${s.current && !cls ? 'steps__step--current' : ''}`} aria-current={s.current ? 'step' : undefined}>
            <span className="steps__dot" aria-hidden="true">{cls === 'steps__step--done' ? <Icon name="check" size={14} /> : cls === 'steps__step--danger' ? <Icon name="x" size={14} /> : null}</span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const t = useT();
  const { business, branch, can } = useDash();
  const order = useDoc<Order>(orderId ? `orders/${orderId}` : null);
  const events = useCollection<OrderEvent>(orderId ? `orders/${orderId}/events` : null, [orderBy('at', 'asc'), limit(100)], [orderId]);
  const cash = useDoc<CashRecord>(can('financials') && order.data?.cashRecordId ? `cashRecords/${order.data.cashRecordId}` : null);
  const backHref = `/business/${business.id}/${branch.id}/orders`;
  if (order.loading) return <div className="stack" aria-busy="true"><Skeleton height={80} radius={16} /><Skeleton height={160} radius={16} /><Skeleton height={240} radius={16} /></div>;
  if (order.error) return <LoadError />;
  if (!order.data || order.data.branchId !== branch.id) return <div className="stack"><Link className="oc-iconbtn oc-iconbtn--back" to={backHref} aria-label={t('dash.backToOrders')} title={t('dash.backToOrders')}><Icon name="arrow" size={22} /></Link><EmptyState icon="alert" title={t('common.notFound')} /></div>;
  return <OrderDetailBody o={order.data} events={events} cashRecordData={cash.data} backHref={backHref} />;
}

/** Split from the page so the decision hook runs only once the order is loaded (no hooks after early returns). */
function OrderDetailBody({ o, events, cashRecordData, backHref }: { o: Order; events: { data: OrderEvent[]; error: unknown }; cashRecordData: CashRecord | null | undefined; backHref: string }) {
  const { user } = useAuth();
  const userUid = user?.uid;
  const t = useT();
  const { L, locale } = useI18n();
  const { business, can } = useDash();
  const businessName = L(business.name, business.defaultLocale);
  const [revise, setRevise] = useState(false);
  const [recordCash, setRecordCash] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const d = useOrderDecision(o);
  const st = useOrderStage(o);
  // Staff cannot read cashRecords (owner/manager only), so settlement state has to come from the
  // order or the person who took the money sees no confirmation at all. The cash record is still
  // read for the "recorded by" detail, and simply stays absent for staff.
  const cashPaidAgorot = o.cashRecordId && !o.cashReversedAt ? o.totals.cashDueAgorot : undefined;
  const cashRecord = cashRecordData && !cashRecordData.reversed ? cashRecordData : null;
  const printed = events.data.some((e) => e.type === 'printed');
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
  const canAccept = o.status === 'placed' && can('orders');
  const column = boardColumn(o);
  const canReady = column === 'preparing' && can('orders');
  const canComplete = column === 'ready' && can('orders');
  const canRecordCash = o.status === 'accepted' && !o.cashRecordId && can('cash');
  const canRevise = o.status !== 'rejected' && !o.locked && can('orders');
  const canReverse = cashPaidAgorot !== undefined && can('reverse_cash');
  const hasBar = canAccept || canReady || canComplete || canRecordCash || canRevise || canReverse;
  const anyBusy = d.busy !== null || st.busy !== null;
  return (
    <div className="stack odetail">
      <div className="odetail__nav">
        <Link className="oc-iconbtn oc-iconbtn--back" to={backHref} aria-label={t('dash.backToOrders')} title={t('dash.backToOrders')}><Icon name="arrow" size={22} /></Link>
        <PageTitle title={t('dash.orderNumber', { reference: refLabel(o.reference) })}>
          <OrderStatusBadge status={o.status} stage={o.stage} mode={o.mode} />
        </PageTitle>
        {can('print') ? <PrintOrderButton order={o} iconOnly /> : null}
      </div>
      <StatusSteps order={o} />
      <div className="odetail__cols">
        <div className="stack">
          <section className="card stack" aria-label={t('dash.customer')}>
            <div className="odetail__customer">
              <div className="odetail__customer-text">
                <div className="odetail__customer-head"><strong>{o.contactName}</strong><OrderModeBadges order={o} /></div>
                <div className="odetail__meta"><span>{t('dash.placedLabel')} <bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></span>{column ? <ElapsedChip placedAt={o.placedAt} column={column} /> : null}{printed ? <span className="badge badge--muted"><Icon name="printer" size={14} /> {t('dash.step.printed')}</span> : null}</div>
                <a className="order-card__tel" href={telHref(o.contactPhone)}><Icon name="phone" size={14} /><bdi className="num">{formatPhoneDisplay(o.contactPhone)}</bdi></a>
              </div>
              <a className="oc-iconbtn oc-iconbtn--soft" href={telHref(o.contactPhone)} aria-label={`${t('dash.callCustomer')} ${o.contactName}`} title={t('dash.callCustomer')}><Icon name="phone" size={22} /></a>
            </div>
            {o.mode === 'delivery' && o.address ? (
              <div className="odetail__block"><Icon name="house" size={20} /><div><div style={{ fontWeight: 600, marginBottom: 4 }}>{t('dash.houseDescription')}</div><AddressSummary a={{ ...o.address, cityName: o.address.cityName }} /></div></div>
            ) : o.mode === 'dine_in' ? (
              <div className="odetail__block"><Icon name="chair" size={20} /><div>{o.tableNumber ? t('orders.table', { n: o.tableNumber }) : t('dash.dineInNoTable')}</div></div>
            ) : (
              <div className="odetail__block"><Icon name="bag" size={20} /><div>{t('dash.pickupOrder')}</div></div>
            )}
            {o.customerNote ? <div className="odetail__block"><Icon name="info" size={20} /><div><strong>{t('common.notes')}:</strong> {o.customerNote}</div></div> : null}
            {o.status === 'rejected' || (o.status === 'accepted' && !o.stage) ? <div className={`status-banner status-banner--${o.status}`} style={{ padding: 12 }}><Icon name={o.status === 'accepted' ? 'check' : 'x'} size={18} /><div className="status-banner__text"><strong>{o.status === 'accepted' ? t('dash.accepted') : t('dash.rejected')}</strong>{o.decisionReason ? <div className="wrap-anywhere" dir="auto">{o.decisionReason}</div> : null}</div></div> : null}
          </section>
          <section className="card stack stack--sm" aria-label={t('orders.items')}>
            <h2 className="odetail__h2">{t('orders.items')}</h2>
            <OrderLines order={o} />
            <div className="summary-ledger"><Summary totals={o.totals} mode={o.mode} cashReceived={cashPaidAgorot} rejected={o.status === 'rejected'} /></div>
            {o.revision > 0 ? <div className="summary__row muted"><span>{t('orders.original')} · {t('common.version')} {o.version} · rev {o.revision}</span><bdi className="num">{money(o.originalTotals.cashDueAgorot, locale)}</bdi></div> : null}
            {o.locked ? <Alert tone="info">{t('dash.locked')}</Alert> : null}
            {canRecordCash && o.totals.isEstimated ? <Alert tone="warn">{t('dash.cashBlockedWeights')}</Alert> : null}
            {cashPaidAgorot !== undefined ? <Alert tone="success"><div>{t('dash.cashRecorded', { amount: money(cashPaidAgorot, locale) })}{cashRecord ? <div className="muted">{t('dash.cashRecordedBy', { name: cashRecord.recordedBy === userUid ? t('dash.actorYou') : cashRecord.recordedBy.slice(0, 6), time: formatLocalDateTime(cashRecord.recordedAt, locale) })}</div> : o.cashSettledAt ? <div className="muted"><bdi>{formatLocalDateTime(o.cashSettledAt, locale)}</bdi></div> : null}</div></Alert> : null}
          </section>
        </div>
        <section className="card stack stack--sm" aria-label={t('dash.events')}>
          <h2 className="odetail__h2">{t('dash.events')}</h2>
          {events.error ? <LoadError /> : null}
          <ul className="list">
            {events.data.map((e) => (
              <li key={e.id} className="list__item" style={{ alignItems: 'flex-start' }}>
                <Icon name={e.type === 'placed' ? 'bag' : e.type === 'accepted' ? 'check' : e.type === 'rejected' ? 'x' : e.type === 'ready' ? 'bell' : e.type === 'completed' ? 'check' : e.type === 'printed' ? 'printer' : e.type === 'revised' ? 'edit' : 'wallet'} size={18} />
                <div className="list__grow">
                  <div><strong>{e.type === 'adjustment' ? t('loyalty.entry.admin_adjust') : t(`owner.event.${e.type}`)}</strong> · {e.actorRole === 'owner' || e.actorRole === 'manager' || e.actorRole === 'staff' ? t(`staff.role.${e.actorRole}`) : t(`owner.actor.${e.actorRole}`)}{e.phoneAgreement ? ` · ${t('dash.phoneAgreement')}` : ''}</div>
                  {e.reason ? <div className="muted">{e.reason}</div> : null}
                  <div className="muted"><bdi>{formatLocalDateTime(e.at, locale)}</bdi> · v{e.version}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {d.conflict && !d.rejecting ? <Alert tone="warn">{d.conflict}</Alert> : st.conflict ? <Alert tone="warn">{st.conflict}</Alert> : null}
      {hasBar ? (
        <div className="odetail__bar">
          {canAccept ? <Button className="odetail__bar-primary" icon="check" loading={d.busy === 'accepted'} disabled={anyBusy} onClick={() => d.decide('accepted')}>{t('dash.accept')}</Button>
            : canReady ? <Button className="odetail__bar-primary" icon="bell" loading={st.busy === 'ready'} disabled={anyBusy} onClick={() => st.advance('ready')}>{t('dash.markReady')}</Button>
            : canComplete ? <Button className="odetail__bar-primary" icon={o.mode === 'delivery' ? 'truck' : o.mode === 'dine_in' ? 'chair' : 'check'} loading={st.busy === 'completed'} disabled={anyBusy} onClick={() => st.advance('completed')}>{completeLabel(o.mode, t)}</Button>
            : canRecordCash ? <Button className="odetail__bar-primary" icon="wallet" disabled={o.totals.isEstimated} onClick={() => setRecordCash(true)}>{t('dash.recordCash')}</Button> : null}
          <div className="odetail__bar-row">
            {canAccept ? <Button variant="danger" icon="x" aria-label={t('dash.reject')} title={t('dash.reject')} disabled={anyBusy} onClick={() => d.setRejecting(true)}>{t('dash.rejectShort')}</Button> : null}
            {canComplete ? <Button variant="secondary" icon="arrowBack" loading={st.busy === 'preparing'} disabled={anyBusy} onClick={() => st.advance('preparing')}>{t('dash.backToPreparing')}</Button> : null}
            {(canReady || canComplete) && canRecordCash ? <Button variant="secondary" icon="wallet" disabled={o.totals.isEstimated} onClick={() => setRecordCash(true)}>{t('dash.recordCash')}</Button> : null}
            {canRevise ? <Button variant="secondary" icon="edit" aria-label={t('dash.revise')} title={t('dash.revise')} onClick={() => setRevise(true)}>{t('dash.reviseShort')}</Button> : null}
            {canReverse ? <Button variant="danger" onClick={() => setReverse(true)}>{t('dash.reverseCash')}</Button> : null}
          </div>
        </div>
      ) : null}
      <RejectDialog d={d} />
      {revise ? <ReviseDialog order={o} onClose={() => setRevise(false)} /> : null}
      <ConfirmDialog open={recordCash} onClose={() => setRecordCash(false)} onConfirm={doRecordCash} loading={busy} title={t('dash.recordCashTitle')} confirmLabel={t('dash.recordCash')} body={<div className="stack--sm stack"><p>{t('dash.recordCashBody')}</p><div className="summary__row summary__row--total"><span>{t('dash.cashAmount')}</span><bdi>{money(o.totals.cashDueAgorot, locale)}</bdi></div><p className="muted">{o.mode === 'delivery' ? t('checkout.cashOnDelivery') : o.mode === 'dine_in' ? t('checkout.cashAtTable') : t('checkout.cashOnPickup')} · {businessName}</p></div>} />
      <Dialog open={reverse} onClose={() => setReverse(false)} title={t('dash.reverseCash')} footer={<><Button variant="secondary" onClick={() => setReverse(false)}>{t('common.cancel')}</Button><Button variant="danger-solid" loading={busy} disabled={reverseReason.trim().length < 3} onClick={async () => { setBusy(true); try { await call('reverseCash', { orderId: o.id, reason: reverseReason.trim(), idempotencyKey: newIdempotencyKey() }); setReverse(false); toast(t('common.saved')); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('dash.reverseCash')}</Button></>}>
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
  // The same function reviseOrder uses, so the dialog cannot drift from what the server enforces.
  const needsAgreement = list.some((c) => revisionAgreementReason(order.lines.find((l) => l.lineId === c.lineId), c) !== null);
  const invalidChanges = list.some((c) => c.action === 'set_quantity' ? !Number.isInteger(c.quantity) || c.quantity! < 0 || c.quantity! > 999 : c.action === 'set_actual_weight' ? !Number.isInteger(c.actualGrams) || c.actualGrams! <= 0 : c.action === 'substitute' ? (c.replacementQuantity !== undefined && (!Number.isInteger(c.replacementQuantity) || c.replacementQuantity < 1)) || (c.replacementGrams !== undefined && (!Number.isInteger(c.replacementGrams) || c.replacementGrams < 1)) : false);
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
    <Dialog open onClose={onClose} title={t('dash.reviseTitle')} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={invalidChanges || list.length === 0 || reason.trim().length < 2 || (needsAgreement && !agreement)} onClick={submit}>{t('dash.saveRevision')}</Button></>}>
      <div className="stack">
        <p className="muted">{t('dash.reviseBody')}</p>
        {order.lines.filter((l) => !l.removed).map((l) => {
          const c = changes[l.lineId];
          return (
            <div key={l.lineId} className="card stack--sm stack">
              <strong>{L(l.name)}{l.variantName ? ` (${L(l.variantName)})` : ''} · {l.pricingMode === 'weight' ? `${l.actualGrams ?? l.requestedGrams} g` : `${l.quantity} ×`}</strong>
              <div className="row row--end">
                {l.comboItems ? null : l.pricingMode === 'weight' ? (
                  <TextInput label={t('dash.setActualWeight')} type="number" inputMode="numeric" min={1} ltr value={c?.action === 'set_actual_weight' ? c.actualGrams ?? '' : ''} onChange={(e) => set(l.lineId, e.target.value ? { lineId: l.lineId, action: 'set_actual_weight', actualGrams: Number(e.target.value) } : null)} />
                ) : (
                  <TextInput label={t('dash.newQuantity')} type="number" inputMode="numeric" min={0} max={999} ltr value={c?.action === 'set_quantity' ? c.quantity ?? '' : ''} onChange={(e) => set(l.lineId, e.target.value !== '' ? { lineId: l.lineId, action: 'set_quantity', quantity: Number(e.target.value) } : null)} />
                )}
                <Button size="sm" variant={c?.action === 'remove' ? 'danger-solid' : 'danger'} icon="trash" onClick={() => set(l.lineId, c?.action === 'remove' ? null : { lineId: l.lineId, action: 'remove' })}>{t('dash.removeLine')}</Button>
              </div>
              {!l.comboItems ? <Select label={t('dash.substitute')} optional value={c?.action === 'substitute' ? c.replacementProductId ?? '' : ''} onChange={(e) => { const pid = e.target.value; if (!pid) return set(l.lineId, null); const p = products.data.find((x) => x.id === pid)!; set(l.lineId, { lineId: l.lineId, action: 'substitute', replacementProductId: pid, replacementVariantId: p.variants[0]?.id, replacementQuantity: p.pricingMode === 'unit' ? p.minQuantity : undefined, replacementGrams: p.pricingMode === 'weight' ? p.minWeightGrams ?? 100 : undefined }); }}>
                <option value="">{t('common.none')}</option>
                {products.data.filter((p) => p.available && !p.modifierGroups.some((g) => g.required || g.minSelect > 0)).map((p) => <option key={p.id} value={p.id}>{L(p.name, business.defaultLocale)}</option>)}
              </Select> : null}
              {c?.action === 'substitute' ? (() => { const p = products.data.find((x) => x.id === c.replacementProductId); if (!p) return null; return (
                <div className="form-row">
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
