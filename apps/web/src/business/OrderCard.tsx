import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatGrams, isNumericReference, placementSuffix, type Order, type OrderStage } from '@qareeb/shared';
import { PizzaIcon } from '@/customer/PizzaPlacement';
import { useI18n, useT } from '@/lib/i18n';
import { Button, Badge, Dialog, TextArea, toast, Alert } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money, telHref } from '@/lib/format';
import { call, newIdempotencyKey, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useDash } from './shell';
import { useNow } from '@/customer/hooks';
import { PrintOrderButton } from './PrintOrderButton';

export function OrderStatusBadge({ status, stage, mode }: { status: Order['status']; stage?: OrderStage; mode?: Order['mode'] }) {
  const t = useT();
  if (status === 'accepted' && stage) {
    const label = stage === 'ready' && mode ? t(`dash.stage.ready.${mode}`) : t(`dash.stage.${stage}`);
    return <Badge tone={stage === 'completed' ? 'neutral' : stage === 'ready' ? 'success' : 'primary'} icon={stage === 'preparing' ? 'utensils' : stage === 'ready' ? 'bell' : 'check'}>{label}</Badge>;
  }
  return <Badge tone={status === 'accepted' ? 'success' : status === 'rejected' ? 'danger' : 'accent'} icon={status === 'accepted' ? 'check' : status === 'rejected' ? 'x' : 'clock'}>{status === 'placed' ? t('dash.awaitingAcceptance') : status === 'accepted' ? t('dash.accepted') : t('dash.rejected')}</Badge>;
}

/** Board column an order belongs to; null once it leaves the board (rejected / completed / legacy accepted without a stage). */
export type BoardColumn = 'new' | 'preparing' | 'ready';
export function boardColumn(o: Pick<Order, 'status' | 'stage'>): BoardColumn | null {
  if (o.status === 'placed') return 'new';
  if (o.status === 'accepted' && (o.stage === 'preparing' || o.stage === 'ready')) return o.stage;
  return null;
}

/** Move an accepted order between kitchen stages with version checks; shared by the board card and the detail page. */
export function useOrderStage(order: Order) {
  const t = useT();
  const [busy, setBusy] = useState<OrderStage | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const advance = async (stage: OrderStage) => {
    setBusy(stage);
    setConflict(null);
    try {
      await call('advanceOrder', { orderId: order.id, stage, expectedVersion: order.version, idempotencyKey: newIdempotencyKey() });
      toast(t(stage === 'ready' ? 'owner.stageReady' : stage === 'completed' ? 'owner.stageCompleted' : 'owner.stageBack', { reference: order.reference }));
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'version_conflict' || e.code === 'invalid_status_transition')) setConflict(t('dash.decisionConflict'));
      else setConflict(t(errorKey(e)));
    } finally {
      setBusy(null);
    }
  };
  return { busy, conflict, advance };
}

/** Label of the "done" action: what physically happened depends on the fulfillment mode. */
export function completeLabel(mode: Order['mode'], t: ReturnType<typeof useT>): string {
  return t(`dash.complete.${mode}`);
}

/** Fulfillment badges: delivery / pickup / dine-in (+ table), and the revised marker. */
export function OrderModeBadges({ order }: { order: Order }) {
  const t = useT();
  return (
    <>
      <Badge tone="neutral" icon={order.mode === 'delivery' ? 'truck' : order.mode === 'dine_in' ? 'chair' : 'bag'}>{order.mode === 'delivery' ? t('common.delivery') : order.mode === 'dine_in' ? t('common.dineIn') : t('common.pickup')}</Badge>
      {order.mode === 'dine_in' && order.tableNumber ? <Badge tone="primary">{t('orders.table', { n: order.tableNumber })}</Badge> : null}
      {order.revision > 0 ? <Badge tone="accent">{t('orders.revised')}</Badge> : null}
    </>
  );
}

/** Per-column [warn, late] thresholds, in minutes since the order was received. */
const ELAPSED_THRESHOLDS: Record<BoardColumn, readonly [number, number]> = { new: [10, 20], preparing: [20, 35], ready: [30, 45] };

/** Live counter: whole minutes since the order was received (placedAt), on every board column. Ticks every 15s; the tone escalates per column. */
export function ElapsedChip({ placedAt, column = 'new', className = '' }: { placedAt: string; column?: BoardColumn; className?: string }) {
  const t = useT();
  const now = useNow(15000);
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(placedAt)) / 60000));
  const [warn, late] = ELAPSED_THRESHOLDS[column];
  const label = t('dash.sinceReceived', { minutes });
  return (
    <span role="timer" aria-live="off" className={`elapsed ${minutes >= late ? 'elapsed--late' : minutes >= warn ? 'elapsed--warn' : ''} ${className}`} aria-label={label} title={label}>
      <Icon name="clock" size={14} />
      <bdi>{t('dash.elapsedMin', { minutes })}</bdi>
    </span>
  );
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
            <strong>{l.pricingMode === 'weight' ? (l.actualGrams !== undefined ? formatGrams(l.actualGrams, locale) : formatGrams(l.requestedGrams ?? 0, locale)) : `${l.quantity} ×`}</strong> {L(l.name)}{l.variantName ? ` (${L(l.variantName)})` : ''}
            {l.pricingMode === 'weight' && l.actualGrams !== undefined ? <span className="muted"> · {t("orders.requestedWeight")} {formatGrams(l.requestedGrams ?? 0, locale)}</span> : null}
            {l.comboItems ? <div className="order-line__combo">{t('deals.combo')}: {l.comboItems.map((ci) => `${ci.quantity * l.quantity} × ${L(ci.name)}${ci.variantName ? ` (${L(ci.variantName)})` : ''}`).join(' + ')}</div> : null}
            {l.modifiers.length ? <div className="order-line__mods">+ {l.modifiers.map((m, i) => <span key={m.optionId + i}>{i ? ', ' : ''}{m.placement && m.placement !== 'whole' ? <PizzaIcon placement={m.placement} size={18} label={placementSuffix(m.placement, t)} /> : null} {L(m.optionName)}{placementSuffix(m.placement, t)}</span>)}</div> : null}
            {l.note ? <div className="order-line__mods">“{l.note}”</div> : null}
          </span>
          {!compact ? <bdi className="num">{l.removed ? '' : money(l.lineTotalAgorot, locale)}</bdi> : null}
        </li>
      ))}
    </ul>
  );
}

/** Accept / reject an order with version checks; shared by the incoming card and the detail page. */
export function useOrderDecision(order: Order) {
  const t = useT();
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
      toast(t(decision === 'accepted' ? 'owner.accepted' : 'owner.rejected', { reference: order.reference }));
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'version_conflict' || e.code === 'invalid_status_transition')) setConflict(t('dash.decisionConflict'));
      else setConflict(t(errorKey(e)));
    } finally {
      setBusy(null);
    }
  };
  return { rejecting, setRejecting, reason, setReason, busy, conflict, decide };
}

export type OrderDecision = ReturnType<typeof useOrderDecision>;

/** Bottom-sheet reject dialog: the textarea stays above the phone keyboard. */
export function RejectDialog({ d }: { d: OrderDecision }) {
  const t = useT();
  return (
    <Dialog open={d.rejecting} onClose={() => { if (!d.busy) d.setRejecting(false); }} title={t('dash.rejectTitle')} footer={<><Button variant="secondary" disabled={!!d.busy} onClick={() => d.setRejecting(false)}>{t('common.cancel')}</Button><Button variant="danger-solid" loading={d.busy === 'rejected'} disabled={d.reason.trim().length < 2} onClick={() => d.decide('rejected')}>{t('dash.reject')}</Button></>}>
      <div className="stack">{d.conflict ? <Alert tone="danger">{d.conflict}</Alert> : null}<TextArea label={t('dash.rejectReason')} required placeholder={t('dash.rejectReasonPlaceholder')} value={d.reason} onChange={(e) => d.setReason(e.target.value)} maxLength={300} /></div>
    </Dialog>
  );
}

/** Display form of an order reference: numeric references read as "#1001"; legacy "Q-XXXXX" stay as they are. */
export function refLabel(reference: string): string {
  return isNumericReference(reference) ? `#${reference}` : reference;
}

/** Board order card: a tap target, not a receipt. It shows only what's needed to find and move the order: the number,
 *  live minutes since it was received, how it's fulfilled (and the table), customer + amount, a notes flag, and the one
 *  action for its column (Accept / Mark ready / Handed over · Delivered · Served). What the order contains, the address
 *  and the less frequent actions live on the detail page, which tapping the card opens. Wide columns (≥ 260px) also get
 *  Reject / Undo, call and print (not Preparing); narrow columns (phones, tablets) keep only the primary action. */
export function OrderCard({ order }: { order: Order }) {
  const t = useT();
  const { locale } = useI18n();
  const { can } = useDash();
  const navigate = useNavigate();
  const d = useOrderDecision(order);
  const st = useOrderStage(order);
  const column = boardColumn(order);
  const detailHref = `/business/${order.businessId}/${order.branchId}/orders/${order.id}`;
  const openDetail = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    void navigate(detailHref);
  };
  const acting = can('orders');
  const anyBusy = d.busy !== null || st.busy !== null;
  const table = order.mode === 'dine_in' && order.tableNumber ? order.tableNumber : null;
  const callBtn = <a className="oc-iconbtn" href={telHref(order.contactPhone)} aria-label={`${t('dash.callCustomer')} ${order.contactName}`} title={t('dash.callCustomer')}><Icon name="phone" size={22} /></a>;
  const printBtn = can('print') ? <PrintOrderButton order={order} iconOnly /> : null;
  return (
    <article className={`order-card ocard ${column ? `order-card--${column}` : ''}`} aria-labelledby={`o-${order.id}`}>
      {/* Pointer shortcut only: the number link is the keyboard/AT route to the detail, so no nested-interactive role here. */}
      <div className="ocard__tap" onClick={openDetail}>
        <div className="ocard__top">
          <Link id={`o-${order.id}`} className="ocard__ref" to={detailHref}><bdi>{refLabel(order.reference)}</bdi></Link>
          {column ? <ElapsedChip placedAt={order.placedAt} column={column} /> : <OrderStatusBadge status={order.status} stage={order.stage} mode={order.mode} />}
        </div>
        <div className={`ocard__mode ${table ? 'ocard__mode--table' : ''}`}>
          <Icon name={order.mode === 'delivery' ? 'truck' : order.mode === 'dine_in' ? 'chair' : 'bag'} size={16} />
          <span className="ocard__mode-text">{order.mode === 'delivery' ? t('common.delivery') : order.mode === 'dine_in' ? t('common.dineIn') : t('common.pickup')}</span>
          {table ? <span className="ocard__table">{t('orders.table', { n: table })}</span> : null}
        </div>
        <div className="ocard__who">
          <span className="ocard__name" dir="auto">{order.contactName}</span>
          <bdi className="ocard__total">{money(order.totals.cashDueAgorot, locale)}{order.totals.isEstimated ? '*' : ''}</bdi>
        </div>
        {order.customerNote ? <span className="ocard__flag"><Icon name="info" size={14} />{t('common.notes')}</span> : null}
      </div>
      {d.conflict && !d.rejecting ? <Alert tone="warn">{d.conflict}</Alert> : st.conflict ? <Alert tone="warn">{st.conflict}</Alert> : null}
      {/* One compact row: the column's action (soft, 40px — 36px on phone cards) plus, on wide cards, Reject/Undo, call and
       *  print as 40px icons. Preparing gets no call/print (printing is on the detail page). */}
      <div className="ocard__actions">
        {!acting ? null : column === 'new' ? (
          <Button className="ocard__primary" icon="check" aria-label={t('dash.accept')} loading={d.busy === 'accepted'} disabled={anyBusy} onClick={() => d.decide('accepted')}><span className="oc-wide">{t('dash.accept')}</span><span className="oc-compact">{t('dash.acceptShort')}</span></Button>
        ) : column === 'preparing' ? (
          <Button className="ocard__primary" icon="bell" aria-label={t('dash.markReady')} loading={st.busy === 'ready'} disabled={anyBusy} onClick={() => st.advance('ready')}><span className="oc-wide">{t('dash.markReady')}</span><span className="oc-compact">{t('dash.readyShort')}</span></Button>
        ) : column === 'ready' ? (
          <Button className="ocard__primary" icon={order.mode === 'delivery' ? 'truck' : order.mode === 'dine_in' ? 'chair' : 'check'} loading={st.busy === 'completed'} disabled={anyBusy} onClick={() => st.advance('completed')}>{completeLabel(order.mode, t)}</Button>
        ) : null}
        {column === 'new' && acting ? <Button variant="danger" className="ocard__icon oc-wide" icon="x" aria-label={t('dash.reject')} title={t('dash.reject')} disabled={anyBusy} onClick={() => d.setRejecting(true)} />
          : column === 'ready' && acting ? <Button variant="secondary" className="ocard__icon oc-backbtn oc-wide" icon="arrowBack" aria-label={t('dash.backToPreparing')} title={t('dash.backToPreparing')} loading={st.busy === 'preparing'} disabled={anyBusy} onClick={() => st.advance('preparing')} />
          : null}
        {column !== 'preparing' ? <span className="oc-wide oc-slot">{callBtn}{printBtn}</span> : null}
      </div>
      <RejectDialog d={d} />
    </article>
  );
}
