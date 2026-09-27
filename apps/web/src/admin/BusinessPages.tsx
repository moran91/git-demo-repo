import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatPhoneDisplay, type AuditEvent, type Branch, type Business, type Membership, type Order } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, useDoc, where, orderBy, limit } from '@/lib/queries';
import { money, formatLocalDateTime } from '@/lib/format';
import { Badge, Alert, Button, EmptyState, Skeleton, StackTable } from '@/design/components';
import { LoadError } from '@/business/BusinessExperience';
import { OrderStatusBadge } from '@/business/OrderCard';
import { ApprovalBadge, ApprovalDialog, UserLink, useAdminNames, usePendingBranches, useUsers, type ApprovalState, type ApprovalTarget } from './lib';
import { CashBadge, OrderInspect } from './OrdersPage';
import { AuditList } from './PlatformPages';

export function ApprovalsPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const pendingBiz = useCollection<Business>('businesses', [where('approval', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)]);
  const branches = usePendingBranches();
  const names = useAdminNames();
  const users = useUsers(pendingBiz.data.map((b) => b.ownerUid));
  const [dialog, setDialog] = useState<ApprovalTarget | null>(null);
  return (
    <div className="stack">
      <h1>{t('admin.approvals')}</h1>
      {branches.error ? <Alert tone="danger">{branches.error}</Alert> : null}
      {pendingBiz.error ? <LoadError /> : null}
      {pendingBiz.data.length === 0 && branches.data.length === 0 && !pendingBiz.loading ? <EmptyState icon="check" title={t('admin.noPending')} /> : null}
      {pendingBiz.data.length > 0 ? <section className="stack--sm stack"><h2>{t('admin.businesses')}</h2><StackTable><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('bizProfile.type')}</th><th>{t('admin.owner')}</th><th>{t('admin.created')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{pendingBiz.data.map((b) => {
        const name = L(b.name, b.defaultLocale);
        return <tr key={b.id}><td><Link to={`/admin/businesses/${b.id}`}>{name}</Link></td><td>{t(b.type === 'restaurant' ? 'common.restaurant' : 'common.supermarket')}</td><td>{b.ownerUid ? <UserLink uid={b.ownerUid} name={users.name(b.ownerUid)} /> : <span className="muted">{t('admin.noOwner')}</span>}</td><td><bdi>{formatLocalDateTime(b.createdAt, locale)}</bdi></td><td><div className="actions"><DecisionButtons type="business" business={b} name={name} current={b.approval} onPick={setDialog} /></div></td></tr>;
      })}</tbody></table></StackTable></section> : null}
      {branches.data.length > 0 ? <section className="stack--sm stack"><h2>{t('admin.branches')}</h2><StackTable><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('admin.business')}</th><th>{t('common.city')}</th><th>{t('admin.created')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{branches.data.map((br) => <tr key={br.id}><td>{L(br.name)}</td><td><Link to={`/admin/businesses/${br.businessId}`}>{names.business(br.businessId)}</Link></td><td>{names.city(br.cityId)}</td><td><bdi>{formatLocalDateTime(br.createdAt, locale)}</bdi></td><td><div className="actions"><DecisionButtons type="branch" businessId={br.businessId} branch={br} name={L(br.name)} current={br.approval} onPick={setDialog} /></div></td></tr>)}</tbody></table></StackTable></section> : null}
      {dialog ? <ApprovalDialog target={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

/** The decisions that make sense from each state (pending → approve/reject, approved → suspend, suspended/rejected → reinstate). */
function DecisionButtons({ type, business, businessId, branch, name, current, onPick }: { type: 'business' | 'branch'; business?: Business; businessId?: string; branch?: Branch; name: string; current: string; onPick: (t: ApprovalTarget) => void }) {
  const t = useT();
  const pick = (state: ApprovalState) => onPick({ type, businessId: business?.id ?? businessId ?? branch!.businessId, branchId: branch?.id, name, state, current });
  return (
    <>
      {current === 'pending' ? <><Button size="sm" onClick={() => pick('approved')}>{t('admin.approve')}</Button><Button size="sm" variant="danger" onClick={() => pick('rejected')}>{t('admin.rejectApproval')}</Button></> : null}
      {current === 'approved' ? <Button size="sm" variant="danger" onClick={() => pick('suspended')}>{t('admin.suspend')}</Button> : null}
      {current === 'suspended' || current === 'rejected' ? <Button size="sm" variant="secondary" onClick={() => pick('approved')}>{t('admin.reinstate')}</Button> : null}
    </>
  );
}

const STATUS_FILTERS = ['all', 'pending', 'approved', 'suspended', 'rejected'] as const;

export function BusinessesPage() {
  const t = useT();
  const { L, locale } = useI18n();
  // Businesses are few (a regional marketplace); one live listener keeps search and filters instant.
  const all = useCollection<Business>('businesses', [orderBy('createdAt', 'desc'), limit(500)]);
  const users = useUsers(all.data.map((b) => b.ownerUid));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const needle = q.trim().toLowerCase();
  const rows = all.data.filter((b) => (status === 'all' || b.approval === status) && (!needle || Object.values(b.name).some((n) => n?.toLowerCase().includes(needle)) || users.name(b.ownerUid).toLowerCase().includes(needle)));
  const count = (s: (typeof STATUS_FILTERS)[number]) => (s === 'all' ? all.data.length : all.data.filter((b) => b.approval === s).length);
  return (
    <div className="stack">
      <div className="dash__title"><h1>{t('admin.businesses')}</h1><div className="actions"><Link className="btn btn--secondary" to="/admin/invitations">{t('admin.inviteOwner')}</Link></div></div>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchBusinesses')} aria-label={t('admin.searchBusinesses')} />
      <div className="chips admin-chips" role="group" aria-label={t('common.status')}>{STATUS_FILTERS.map((s) => <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? t('common.all') : t(`admin.state.${s}`)} <span className="num">{count(s)}</span></button>)}</div>
      {all.error ? <LoadError /> : all.loading ? <Skeleton height={160} radius={16} /> : rows.length === 0 ? <EmptyState icon="store" title={t('admin.noResults')} /> : (
        <StackTable><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('bizProfile.type')}</th><th>{t('admin.owner')}</th><th>{t('common.status')}</th><th>{t('admin.created')}</th><th></th></tr></thead><tbody>{rows.map((b) => <tr key={b.id}><td><Link to={`/admin/businesses/${b.id}`}>{L(b.name, b.defaultLocale)}</Link></td><td>{t(b.type === 'restaurant' ? 'common.restaurant' : 'common.supermarket')}</td><td>{b.ownerUid ? <UserLink uid={b.ownerUid} name={users.name(b.ownerUid)} /> : <span className="muted">{t('admin.noOwner')}</span>}</td><td><ApprovalBadge state={b.approval} /></td><td><bdi>{formatLocalDateTime(b.createdAt, locale)}</bdi></td><td><Link className="btn btn--secondary btn--sm" to={`/business/${b.id}`}>{t('admin.openDashboard')}</Link></td></tr>)}</tbody></table></StackTable>
      )}
    </div>
  );
}

export function BusinessDetailPage() {
  const { businessId } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const biz = useDoc<Business>(`businesses/${businessId}`);
  const names = useAdminNames();
  const branches = useCollection<Branch>(`businesses/${businessId}/branches`, [limit(50)], [businessId]);
  const members = useCollection<Membership>('memberships', [where('businessId', '==', businessId ?? '_'), limit(100)], [businessId]);
  const history = useCollection<{ id: string; targetType: 'business' | 'branch'; branchId?: string; state: string; reason: string; actorUid: string; at: string }>(`businesses/${businessId}/approvalHistory`, [orderBy('at', 'desc'), limit(30)], [businessId]);
  const orders = useCollection<Order>('orders', [where('businessId', '==', businessId ?? '_'), orderBy('placedAt', 'desc'), limit(10)], [businessId]);
  const activity = useCollection<AuditEvent>('audit', [where('targetId', '==', businessId ?? '_'), limit(50)], [businessId]);
  const owner = members.data.find((m) => m.role === 'owner');
  const users = useUsers([biz.data?.ownerUid, ...members.data.map((m) => m.uid), ...history.data.map((h) => h.actorUid), ...activity.data.map((a) => a.actorUid)]);
  const [dialog, setDialog] = useState<ApprovalTarget | null>(null);
  const [inspect, setInspect] = useState<Order | null>(null);
  if (biz.loading) return <Skeleton height={200} radius={16} />;
  if (biz.error) return <LoadError />;
  if (!biz.data) return <EmptyState icon="alert" title={t('common.notFound')} action={<Link className="btn btn--secondary" to="/admin/businesses">{t('common.back')}</Link>} />;
  const b = biz.data;
  const name = L(b.name, b.defaultLocale);
  const ownerUid = b.ownerUid || owner?.uid;
  const ownerProfile = users.get(ownerUid);
  const branchName = (id: string) => { const br = branches.data.find((x) => x.id === id); return br ? L(br.name, b.defaultLocale) : id; };
  return (
    <div className="stack">
      <div className="dash__title"><h1>{name}</h1><div className="actions"><Link className="btn btn--secondary" to={`/business/${b.id}`}>{t('admin.openDashboard')}</Link></div></div>
      <div className="admin-cols">
        <section className="card stack--sm stack">
          <div className="row admin-row"><h2>{t('common.status')}</h2><ApprovalBadge state={b.approval} /></div>
          {b.approvalReason && b.approvalReason !== 'seed' ? <p className="muted wrap-anywhere">{t('common.reason')}: <bdi>{b.approvalReason}</bdi></p> : null}
          <div className="actions"><DecisionButtons type="business" business={b} name={name} current={b.approval} onPick={setDialog} /></div>
        </section>
        <section className="card stack--sm stack">
          <h2>{t('admin.owner')}</h2>
          {ownerUid ? <>
            <UserLink uid={ownerUid}><strong>{users.name(ownerUid)}</strong></UserLink>
            <div className="muted admin-contact">{ownerProfile?.email ? <bdi>{ownerProfile.email}</bdi> : null}{ownerProfile?.phone ? <bdi className="num">{formatPhoneDisplay(ownerProfile.phone)}</bdi> : null}</div>
          </> : <p className="muted">{t('admin.noOwner')}</p>}
          <div className="muted">{t(b.type === 'restaurant' ? 'common.restaurant' : 'common.supermarket')} · {t('admin.created')} <bdi>{formatLocalDateTime(b.createdAt, locale)}</bdi>{b.publicPhone ? <> · <bdi className="num">{formatPhoneDisplay(b.publicPhone)}</bdi></> : null}</div>
        </section>
      </div>
      <section className="card stack--sm stack"><h2>{t('admin.branches')}</h2>
        {branches.data.length === 0 && !branches.loading ? <p className="muted">{t('common.none')}</p> : null}
        <ul className="list">{branches.data.map((br) => (
          <li key={br.id} className="list__item admin-item">
            <div className="list__grow">
              <strong>{L(br.name, b.defaultLocale)}</strong>
              <div className="muted">{names.city(br.cityId)}{br.phone ? <> · <bdi className="num">{formatPhoneDisplay(br.phone)}</bdi></> : null}</div>
            </div>
            <div className="admin-item__end">
              {br.ordersPaused ? <Badge tone="muted">{t('common.paused')}</Badge> : null}
              <ApprovalBadge state={br.approval} />
              <DecisionButtons type="branch" businessId={b.id} branch={br} name={L(br.name, b.defaultLocale)} current={br.approval} onPick={setDialog} />
              <Link className="btn btn--ghost btn--sm" to={`/business/${b.id}/${br.id}/orders`}>{t('admin.openDashboard')}</Link>
            </div>
          </li>
        ))}</ul>
      </section>
      <section className="card stack--sm stack"><h2>{t('admin.memberships')}</h2>
        <ul className="list">{members.data.map((m) => (
          <li key={m.id} className="list__item admin-item">
            <div className="list__grow"><UserLink uid={m.uid} name={users.name(m.uid)} /><div className="muted">{t(`staff.role.${m.role}`)} · {m.allBranches ? t('staff.allBranches') : m.branchIds.map(branchName).join(', ')}</div></div>
            {!m.active ? <Badge tone="danger">{t('common.disabled')}</Badge> : null}
          </li>
        ))}</ul>
      </section>
      <section className="card stack--sm stack"><h2>{t('admin.recentOrders')}</h2>
        {orders.data.length === 0 && !orders.loading ? <p className="muted">{t('orders.empty')}</p> : null}
        <ul className="list">{orders.data.map((o) => (
          <li key={o.id} className="list__item admin-item">
            <button type="button" className="admin-item__link list__grow" onClick={() => setInspect(o)}><strong className="num">{o.reference}</strong> <span className="muted">· {L(o.branchName)} · <bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></span></button>
            <div className="admin-item__end"><OrderStatusBadge status={o.status} stage={o.stage} mode={o.mode} /><CashBadge order={o} /><bdi className="money">{money(o.totals.cashDueAgorot, locale)}</bdi></div>
          </li>
        ))}</ul>
      </section>
      <section className="card stack--sm stack"><h2>{t('bizProfile.history')}</h2>
        <ul className="list">{history.data.map((h) => (
          <li key={h.id} className="list__item admin-item">
            <ApprovalBadge state={h.state} />
            <div className="list__grow"><div>{h.targetType === 'branch' && h.branchId ? branchName(h.branchId) : t('admin.entity.business')}{h.reason && h.reason !== 'seed' ? <span className="muted"> · <bdi>{h.reason}</bdi></span> : null}</div><div className="muted">{users.name(h.actorUid)} · <bdi>{formatLocalDateTime(h.at, locale)}</bdi></div></div>
          </li>
        ))}</ul>
      </section>
      {activity.data.length > 0 ? <section className="card stack--sm stack"><h2>{t('admin.activity')}</h2><AuditList rows={[...activity.data].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 20)} names={users.name} /></section> : null}
      {dialog ? <ApprovalDialog target={dialog} onClose={() => setDialog(null)} /> : null}
      <OrderInspect order={inspect} onClose={() => setInspect(null)} />
    </div>
  );
}
