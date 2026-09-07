import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router';
import { collection, collectionGroup, orderBy as fbOrderBy, query, where as fbWhere } from 'firebase/firestore';
import { BRAND, LOCALES, type AuditEvent, type Branch, type Business, type City, type Membership, type Order, type PlatformConfig } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { useCollection, useDoc, usePaged, where, orderBy, limit } from '@/lib/queries';
import { BrandMark, Icon, type IconName } from '@/design/Icon';
import { Button, Badge, Alert, Dialog, TextInput, TextArea, Select, Checkbox, EmptyState, Skeleton, IconButton, toast, ConfirmDialog } from '@/design/components';
import { LanguageSelect, NotFound, OfflineBanner } from '@/app/Shell';
import { call, newIdempotencyKey } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { money, formatLocalDateTime } from '@/lib/format';
import { LocalizedInput } from '@/business/CatalogPages';
import { OrderLines, OrderStatusBadge } from '@/business/OrderCard';
import { AddressSummary } from '@/customer/AddressForm';

function AdminShell() {
  const t = useT();
  const { user, isAdmin, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!loading && !user) navigate('/business/signin', { replace: true });
  }, [loading, user, navigate]);
  if (loading) return <main className="page"><Skeleton height={200} radius={16} /></main>;
  if (!isAdmin) return <main className="page"><EmptyState icon="shield" title={t('error.forbidden')} body={t('admin.bootstrapNote')} action={<Link className="btn btn--secondary" to="/">{t('common.goHome')}</Link>} /></main>;
  const nav: Array<{ to: string; icon: IconName; label: string }> = [
    { to: '/admin', icon: 'compass', label: t('admin.overview') },
    { to: '/admin/approvals', icon: 'check', label: t('admin.approvals') },
    { to: '/admin/businesses', icon: 'store', label: t('admin.businesses') },
    { to: '/admin/users', icon: 'users', label: t('admin.users') },
    { to: '/admin/orders', icon: 'bag', label: t('admin.orders') },
    { to: '/admin/cities', icon: 'pin', label: t('admin.cities') },
    { to: '/admin/audit', icon: 'list', label: t('admin.audit') },
    { to: '/admin/config', icon: 'settings', label: t('admin.config') },
  ];
  const sidebar = (
    <>
      <Link to="/" className="brand"><BrandMark size={28} label={t('brand.logoLabel')} /><span className="brand__word">{BRAND.wordmark}</span></Link>
      <div className="badge badge--primary" style={{ alignSelf: 'flex-start' }}>{t('admin.title')}</div>
      <nav className="dash__nav stack--sm stack" aria-label={t('nav.admin')}>{nav.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/admin'} onClick={() => setDrawer(false)}><Icon name={n.icon} size={20} /> {n.label}</NavLink>)}</nav>
      <div style={{ marginTop: 'auto' }} className="stack--sm stack"><LanguageSelect /><Button variant="ghost" icon="logout" onClick={() => void signOut()}>{t('common.signOut')}</Button></div>
    </>
  );
  return (
    <div className="dash">
      <aside className="dash__sidebar">{sidebar}</aside>
      {drawer ? <><button type="button" className="drawer-backdrop" aria-label={t('common.close')} onClick={() => setDrawer(false)} /><aside className="dash__sidebar dash__sidebar--drawer" role="dialog" aria-modal="true">{sidebar}</aside></> : null}
      <header className="dash__header"><IconButton icon="menu" label={t('common.menu')} className="dash__menu-btn" onClick={() => setDrawer(true)} /><strong>{t('admin.title')}</strong></header>
      <main className="dash__main" id="main"><OfflineBanner /><Outlet /></main>
      <style>{`@media (min-width: 900px) { .dash__menu-btn { display: none; } }`}</style>
    </div>
  );
}

function Overview() {
  const t = useT();
  const { locale } = useI18n();
  const [m, setM] = useState<{ last30Days: { placedCount: number; placedValueAgorot: number; acceptedCount: number; acceptedValueAgorot: number; cashRecordsCount: number; cashRecordedAgorot: number }; pendingBusinessApprovals: number; agingPlacedOrders: number; totalUsers: number; approvedBusinesses: number; daily: Array<{ date: string; placedCount?: number; placedValueAgorot?: number; acceptedValueAgorot?: number; cashRecordedAgorot?: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { call<typeof m>('getAdminMetrics', {}).then(setM).catch((e) => setError(t(errorKey(e)))); }, [t]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!m) return <div className="metrics" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={90} radius={16} />)}</div>;
  return (
    <div className="stack">
      <h1>{t('admin.overview')}</h1>
      <Alert tone="info">{t('admin.metrics.note')}</Alert>
      <h2>{t('admin.metrics.last30')}</h2>
      <div className="metrics">
        <div className="metric"><span className="metric__value num">{m.last30Days.placedCount}</span><span className="metric__label">{t('admin.metrics.placedCount')}</span></div>
        <div className="metric"><span className="metric__value"><bdi>{money(m.last30Days.placedValueAgorot, locale)}</bdi></span><span className="metric__label">{t('admin.metrics.placedValue')}</span></div>
        <div className="metric"><span className="metric__value"><bdi>{money(m.last30Days.acceptedValueAgorot, locale)}</bdi></span><span className="metric__label">{t('admin.metrics.acceptedValue')}</span></div>
        <div className="metric"><span className="metric__value"><bdi>{money(m.last30Days.cashRecordedAgorot, locale)}</bdi></span><span className="metric__label">{t('admin.metrics.cashRecorded')}</span></div>
        <Link to="/admin/approvals" className="metric" style={{ textDecoration: 'none', color: 'inherit', borderColor: m.pendingBusinessApprovals ? 'var(--color-accent-text)' : undefined }}><span className="metric__value num">{m.pendingBusinessApprovals}</span><span className="metric__label">{t('admin.metrics.pendingApprovals')}</span></Link>
        <Link to="/admin/orders" className="metric" style={{ textDecoration: 'none', color: 'inherit', borderColor: m.agingPlacedOrders ? 'var(--color-danger)' : undefined }}><span className="metric__value num">{m.agingPlacedOrders}</span><span className="metric__label">{t('admin.metrics.agingOrders')}</span></Link>
        <div className="metric"><span className="metric__value num">{m.totalUsers}</span><span className="metric__label">{t('admin.users')}</span></div>
        <div className="metric"><span className="metric__value num">{m.approvedBusinesses}</span><span className="metric__label">{t('admin.businesses')}</span></div>
      </div>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('admin.metrics.placedCount')}</th><th>{t('admin.metrics.placedValue')}</th><th>{t('admin.metrics.acceptedValue')}</th><th>{t('admin.metrics.cashRecorded')}</th></tr></thead><tbody>{m.daily.map((d) => <tr key={d.date}><td dir="ltr">{d.date}</td><td className="num">{d.placedCount ?? 0}</td><td><bdi>{money(d.placedValueAgorot ?? 0, locale)}</bdi></td><td><bdi>{money(d.acceptedValueAgorot ?? 0, locale)}</bdi></td><td><bdi>{money(d.cashRecordedAgorot ?? 0, locale)}</bdi></td></tr>)}</tbody></table></div>
    </div>
  );
}

function ApprovalDialog({ target, onClose }: { target: { type: 'business' | 'branch'; businessId: string; branchId?: string; name: string; state: string; current: string }; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = target.state === 'approved' ? t('admin.approve') : target.state === 'rejected' ? t('admin.rejectApproval') : target.state === 'suspended' ? t('admin.suspend') : t('admin.reinstate');
  return (
    <Dialog open onClose={onClose} title={`${label}: ${target.name}`} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant={target.state === 'approved' ? 'primary' : 'danger-solid'} loading={busy} disabled={reason.trim().length < 2} onClick={async () => { setBusy(true); try { await call('decideApproval', { targetType: target.type, businessId: target.businessId, branchId: target.branchId, state: target.state, reason: reason.trim() }); toast(t('common.saved')); onClose(); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{label}</Button></>}>
      <div className="stack"><p className="muted">{t('admin.entity')}: {target.type} · {target.name} · {t('common.status')}: {t(`admin.state.${target.current as 'pending'}`)}</p><TextArea label={t('common.reason')} required hint={t('admin.reasonRequired')} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    </Dialog>
  );
}

function Approvals() {
  const t = useT();
  const { L } = useI18n();
  const pendingBiz = useCollection<Business>('businesses', [where('approval', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)]);
  const pendingBranches = useCollection<Branch>(null, []);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [dialog, setDialog] = useState<Parameters<typeof ApprovalDialog>[0]['target'] | null>(null);
  useEffect(() => {
    import('firebase/firestore').then(({ getDocs, collectionGroup, query, where, orderBy, limit }) => getDocs(query(collectionGroup(db, 'branches'), where('approval', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)))).then((s) => setBranches(s.docs.map((d) => d.data() as Branch))).catch(() => setBranches([]));
  }, [pendingBiz.data.length, dialog]);
  void pendingBranches;
  return (
    <div className="stack">
      <h1>{t('admin.approvals')}</h1>
      {pendingBiz.data.length === 0 && branches.length === 0 && !pendingBiz.loading ? <EmptyState icon="check" title={t('admin.noPending')} /> : null}
      {pendingBiz.data.length > 0 ? <section className="stack--sm stack"><h2>{t('admin.businesses')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('bizProfile.type')}</th><th>{t('admin.owner')}</th><th>{t('common.date')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{pendingBiz.data.map((b) => <tr key={b.id}><td><Link to={`/admin/businesses/${b.id}`}>{L(b.name, b.defaultLocale)}</Link></td><td>{b.type}</td><td dir="ltr">{b.ownerUid.slice(0, 8)}</td><td><bdi>{formatLocalDateTime(b.createdAt, 'en')}</bdi></td><td className="row"><Button size="sm" onClick={() => setDialog({ type: 'business', businessId: b.id, name: L(b.name, b.defaultLocale), state: 'approved', current: b.approval })}>{t('admin.approve')}</Button><Button size="sm" variant="danger" onClick={() => setDialog({ type: 'business', businessId: b.id, name: L(b.name, b.defaultLocale), state: 'rejected', current: b.approval })}>{t('admin.rejectApproval')}</Button></td></tr>)}</tbody></table></div></section> : null}
      {branches.length > 0 ? <section className="stack--sm stack"><h2>{t('admin.branches')}</h2><div className="table-wrap"><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('admin.businesses')}</th><th>{t('common.city')}</th><th>{t('common.actions')}</th></tr></thead><tbody>{branches.map((b) => <tr key={b.id}><td>{L(b.name)}</td><td><Link to={`/admin/businesses/${b.businessId}`} dir="ltr">{b.businessId}</Link></td><td>{b.cityId}</td><td className="row"><Button size="sm" onClick={() => setDialog({ type: 'branch', businessId: b.businessId, branchId: b.id, name: L(b.name), state: 'approved', current: b.approval })}>{t('admin.approve')}</Button><Button size="sm" variant="danger" onClick={() => setDialog({ type: 'branch', businessId: b.businessId, branchId: b.id, name: L(b.name), state: 'rejected', current: b.approval })}>{t('admin.rejectApproval')}</Button></td></tr>)}</tbody></table></div></section> : null}
      {dialog ? <ApprovalDialog target={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function Businesses() {
  const t = useT();
  const { L } = useI18n();
  const paged = usePaged<Business>(() => query(collection(db, 'businesses'), fbOrderBy('createdAt', 'desc')), 25, []);
  return (
    <div className="stack">
      <div className="row row--between"><h1>{t('admin.businesses')}</h1><Link className="btn btn--secondary" to="/admin/invite">{t('admin.inviteOwner')}</Link></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('bizProfile.type')}</th><th>{t('common.status')}</th><th>{t('common.date')}</th></tr></thead><tbody>{paged.items.map((b) => <tr key={b.id}><td><Link to={`/admin/businesses/${b.id}`}>{L(b.name, b.defaultLocale)}</Link></td><td>{b.type}</td><td><Badge tone={b.approval === 'approved' ? 'success' : b.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${b.approval}`)}</Badge></td><td><bdi>{formatLocalDateTime(b.createdAt, 'en')}</bdi></td></tr>)}</tbody></table></div>
      {!paged.done ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
    </div>
  );
}

function BusinessDetail() {
  const { businessId } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const biz = useDoc<Business>(`businesses/${businessId}`);
  const branches = useCollection<Branch>(`businesses/${businessId}/branches`, [limit(50)], [businessId]);
  const members = useCollection<Membership>('memberships', [where('businessId', '==', businessId ?? '_'), limit(100)], [businessId]);
  const history = useCollection<{ id: string; targetType: string; branchId?: string; state: string; reason: string; actorUid: string; at: string }>(`businesses/${businessId}/approvalHistory`, [orderBy('at', 'desc'), limit(30)], [businessId]);
  const [dialog, setDialog] = useState<Parameters<typeof ApprovalDialog>[0]['target'] | null>(null);
  if (biz.loading) return <Skeleton height={200} radius={16} />;
  if (!biz.data) return <EmptyState icon="alert" title={t('common.notFound')} />;
  const b = biz.data;
  const name = L(b.name, b.defaultLocale);
  const actions = (type: 'business' | 'branch', current: string, branch?: Branch) => (
    <div className="row" style={{ gap: 4 }}>
      {current !== 'approved' ? <Button size="sm" onClick={() => setDialog({ type, businessId: b.id, branchId: branch?.id, name: branch ? L(branch.name) : name, state: 'approved', current })}>{t('admin.approve')}</Button> : null}
      {current === 'pending' ? <Button size="sm" variant="danger" onClick={() => setDialog({ type, businessId: b.id, branchId: branch?.id, name: branch ? L(branch.name) : name, state: 'rejected', current })}>{t('admin.rejectApproval')}</Button> : null}
      {current === 'approved' ? <Button size="sm" variant="danger" onClick={() => setDialog({ type, businessId: b.id, branchId: branch?.id, name: branch ? L(branch.name) : name, state: 'suspended', current })}>{t('admin.suspend')}</Button> : null}
      {current === 'suspended' ? <Button size="sm" variant="secondary" onClick={() => setDialog({ type, businessId: b.id, branchId: branch?.id, name: branch ? L(branch.name) : name, state: 'approved', current })}>{t('admin.reinstate')}</Button> : null}
    </div>
  );
  return (
    <div className="stack">
      <div className="row row--between"><h1>{name}</h1><Badge tone={b.approval === 'approved' ? 'success' : b.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${b.approval}`)}</Badge></div>
      <div className="muted">{b.type} · {t('admin.owner')}: <span dir="ltr">{b.ownerUid}</span> · {b.publicPhone ? <bdi className="num">{b.publicPhone}</bdi> : null}</div>
      <section className="card stack"><h2>{t('admin.approvals')}</h2>{actions('business', b.approval)}{b.approvalReason ? <p className="muted">{b.approvalReason}</p> : null}</section>
      <section className="card stack"><h2>{t('admin.branches')}</h2><ul className="list">{branches.data.map((br) => <li key={br.id} className="list__item"><div className="list__grow"><strong>{L(br.name, b.defaultLocale)}</strong> <span className="muted">· {br.cityId} · <bdi className="num">{br.phone}</bdi></span></div><Badge tone={br.approval === 'approved' ? 'success' : br.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${br.approval}`)}</Badge>{actions('branch', br.approval, br)}</li>)}</ul></section>
      <section className="card stack"><h2>{t('admin.memberships')}</h2><ul className="list">{members.data.map((m) => <li key={m.id} className="list__item"><span className="list__grow"><span dir="ltr">{m.uid}</span> · {t(`staff.role.${m.role}`)} · {m.allBranches ? t('staff.allBranches') : m.branchIds.join(', ')}</span>{!m.active ? <Badge tone="danger">{t('common.disabled')}</Badge> : null}</li>)}</ul></section>
      <section className="card stack"><h2>{t('bizProfile.history')}</h2><ul className="list">{history.data.map((h) => <li key={h.id} className="list__item"><Badge tone={h.state === 'approved' ? 'success' : h.state === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${h.state as 'pending'}`)}</Badge><span className="list__grow">{h.targetType}{h.branchId ? ` · ${h.branchId}` : ''} · {h.reason} · <span dir="ltr">{h.actorUid}</span></span><span className="muted"><bdi>{formatLocalDateTime(h.at, locale)}</bdi></span></li>)}</ul></section>
      {dialog ? <ApprovalDialog target={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function Users() {
  const t = useT();
  const { locale } = useI18n();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ users: Array<{ uid: string; displayName: string; email?: string; phone?: string; suspended: boolean; isAdmin: boolean; createdAt: string; memberships: Membership[] }>; nextCursor?: string } | null>(null);
  const [susp, setSusp] = useState<{ uid: string; suspended: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [loy, setLoy] = useState<{ uid: string } | null>(null);
  const [loyForm, setLoyForm] = useState({ businessId: '', points: 0, reason: '' });
  const load = (cursor?: string) => call<typeof data>('adminListUsers', q.includes('@') ? { email: q.trim() } : q.startsWith('+') ? { phone: q.trim() } : { cursor }).then((r) => setData((prev) => (cursor && prev && r ? { users: [...prev.users, ...r.users], nextCursor: r.nextCursor } : r))).catch((e) => toast(t(errorKey(e)), 'danger'));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <h1>{t('admin.users')}</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void load(); }}><div style={{ flex: 1 }}><TextInput label={t('common.search')} ltr placeholder="email@ / +972…" value={q} onChange={(e) => setQ(e.target.value)} /></div><Button type="submit" variant="secondary" style={{ alignSelf: 'flex-end' }}>{t('common.search')}</Button></form>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('common.email')} / {t('common.phone')}</th><th>{t('admin.memberships')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead><tbody>
        {data?.users.map((u) => <tr key={u.uid}><td>{u.displayName || '—'}<div className="muted" dir="ltr">{u.uid}</div></td><td dir="ltr">{u.email ?? ''} {u.phone ?? ''}</td><td>{u.memberships.map((m) => `${m.role}@${m.businessId}`).join(', ')}</td><td>{u.isAdmin ? <Badge tone="primary">{t('staff.role.admin')}</Badge> : u.suspended ? <Badge tone="danger">{t('admin.userSuspended')}</Badge> : <Badge tone="success">{t('admin.active')}</Badge>}</td><td className="row" style={{ gap: 4 }}>{!u.isAdmin ? <Button size="sm" variant={u.suspended ? 'secondary' : 'danger'} onClick={() => { setReason(''); setSusp({ uid: u.uid, suspended: !u.suspended }); }}>{u.suspended ? t('admin.reinstateUser') : t('admin.suspendUser')}</Button> : null}<Button size="sm" variant="ghost" onClick={() => { setLoyForm({ businessId: u.memberships[0]?.businessId ?? '', points: 0, reason: '' }); setLoy({ uid: u.uid }); }}>{t('admin.loyaltyAdjust')}</Button></td></tr>)}
      </tbody></table></div>
      {data?.nextCursor ? <div className="pagination"><Button variant="secondary" onClick={() => load(data.nextCursor)}>{t('dash.loadMore')}</Button></div> : null}
      <Dialog open={!!susp} onClose={() => setSusp(null)} title={susp?.suspended ? t('admin.suspendUser') : t('admin.reinstateUser')} sheet={false} footer={<><Button variant="secondary" onClick={() => setSusp(null)}>{t('common.cancel')}</Button><Button variant={susp?.suspended ? 'danger-solid' : 'primary'} disabled={reason.trim().length < 2} onClick={async () => { try { await call('setUserSuspended', { uid: susp!.uid, suspended: susp!.suspended, reason: reason.trim() }); setSusp(null); await load(); } catch (e) { toast(t(errorKey(e)), 'danger'); } }}>{t('common.confirm')}</Button></>}><TextArea label={t('common.reason')} required hint={t('admin.reasonRequired')} value={reason} onChange={(e) => setReason(e.target.value)} /></Dialog>
      <Dialog open={!!loy} onClose={() => setLoy(null)} title={t('admin.loyaltyAdjust')} sheet={false} footer={<><Button variant="secondary" onClick={() => setLoy(null)}>{t('common.cancel')}</Button><Button disabled={!loyForm.businessId || !loyForm.points || loyForm.reason.trim().length < 3} onClick={async () => { try { await call('adminAdjustLoyalty', { uid: loy!.uid, ...loyForm, reason: loyForm.reason.trim() }); toast(t('common.saved')); setLoy(null); } catch (e) { toast(t(errorKey(e)), 'danger'); } }}>{t('common.confirm')}</Button></>}><div className="stack"><p className="muted">{t('admin.loyaltyAdjustBody')}</p><TextInput label={t('admin.businesses')} ltr value={loyForm.businessId} onChange={(e) => setLoyForm({ ...loyForm, businessId: e.target.value })} /><TextInput label={t('admin.points')} type="number" ltr value={loyForm.points} onChange={(e) => setLoyForm({ ...loyForm, points: Number(e.target.value) })} /><TextArea label={t('common.reason')} required value={loyForm.reason} onChange={(e) => setLoyForm({ ...loyForm, reason: e.target.value })} /></div></Dialog>
      <span className="visually-hidden">{formatLocalDateTime(new Date(), locale)}</span>
    </div>
  );
}

function Orders() {
  const t = useT();
  const { L, locale } = useI18n();
  const [filter, setFilter] = useState<'all' | 'placed'>('all');
  const paged = usePaged<Order>(() => (filter === 'placed' ? query(collection(db, 'orders'), fbWhere('status', '==', 'placed'), fbOrderBy('placedAt', 'asc')) : query(collection(db, 'orders'), fbOrderBy('placedAt', 'desc'))), 25, [filter]);
  const [inspect, setInspect] = useState<Order | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  return (
    <div className="stack">
      <h1>{t('admin.orders')}</h1>
      <div className="tabs" role="tablist"><button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>{t('dash.filterAll')}</button><button role="tab" aria-selected={filter === 'placed'} onClick={() => setFilter('placed')}>{t('admin.metrics.agingOrders')}</button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('orders.order')}</th><th>{t('admin.businesses')}</th><th>{t('common.status')}</th><th>{t('common.date')}</th><th>{t('common.total')}</th><th></th></tr></thead><tbody>{paged.items.map((o) => <tr key={o.id}><td><span className="order-card__ref" style={{ fontSize: 16 }}>{o.reference}</span></td><td>{L(o.businessName)} · {L(o.branchName)}</td><td><OrderStatusBadge status={o.status} />{o.cashRecordId ? <Badge tone="success">{t('receipt.cashReceived')}</Badge> : null}</td><td><bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></td><td><bdi>{money(o.totals.cashDueAgorot, locale)}</bdi></td><td><Button size="sm" variant="ghost" onClick={() => setInspect(o)}>{t('admin.orderInspect')}</Button></td></tr>)}</tbody></table></div>
      {!paged.done ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
      {inspect ? (
        <Dialog open onClose={() => setInspect(null)} title={t('dash.orderNumber', { reference: inspect.reference })}>
          <div className="stack">
            <div className="row"><OrderStatusBadge status={inspect.status} /><span className="muted">{L(inspect.businessName)} · v{inspect.version} · rev {inspect.revision}</span></div>
            <div className="muted">{inspect.contactName} · <bdi className="num">{inspect.contactPhone}</bdi> · {inspect.mode}</div>
            {inspect.address ? <div className="address-block"><AddressSummary a={{ ...inspect.address, cityName: inspect.address.cityName }} /></div> : null}
            <OrderLines order={inspect} />
            <div className="summary__row summary__row--total"><span>{t('common.cashDue')}</span><bdi>{money(inspect.totals.cashDueAgorot, locale)}</bdi></div>
            {inspect.cashRecordId ? <div className="card stack--sm stack"><h3>{t('admin.cashReconcile')}</h3><p className="muted">{t('admin.cashReconcileBody')}</p><TextArea label={t('common.reason')} required value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} /><Button variant="danger" disabled={reverseReason.trim().length < 3} onClick={async () => { try { await call('adminReverseCash', { orderId: inspect.id, reason: reverseReason.trim(), idempotencyKey: newIdempotencyKey() }); toast(t('common.saved')); setInspect(null); } catch (e) { toast(t(errorKey(e)), 'danger'); } }}>{t('dash.reverseCash')}</Button></div> : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function Cities() {
  const t = useT();
  const { L } = useI18n();
  const cities = useCollection<City>('cities', [orderBy('sortOrder'), limit(200)]);
  const [edit, setEdit] = useState<{ id?: string; name: Record<string, string>; aliases: string; active: boolean; sortOrder: number; lat?: number; lng?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <div className="row row--between"><h1>{t('admin.cities')}</h1><Button icon="plus" onClick={() => setEdit({ name: {}, aliases: '', active: true, sortOrder: cities.data.length })}>{t('admin.newCity')}</Button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.name')}</th><th>ID</th><th>{t('admin.aliases')}</th><th>{t('admin.active')}</th><th></th></tr></thead><tbody>{cities.data.map((c) => <tr key={c.id}><td>{LOCALES.map((l) => c.name[l]).filter(Boolean).join(' · ')}</td><td dir="ltr">{c.id}</td><td>{c.aliases.join(', ')}</td><td>{c.active ? t('common.yes') : t('common.no')}</td><td><IconButton icon="edit" label={t('common.edit')} onClick={() => setEdit({ id: c.id, name: c.name, aliases: c.aliases.join(', '), active: c.active, sortOrder: c.sortOrder, lat: c.lat, lng: c.lng })} /></td></tr>)}</tbody></table></div>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `${t('common.edit')}: ${L(edit.name)}` : t('admin.newCity')} sheet={false} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={async () => { if (!edit) return; setBusy(true); try { await call('saveCity', { id: edit.id, name: edit.name, aliases: edit.aliases.split(',').map((s) => s.trim()).filter(Boolean), active: edit.active, sortOrder: edit.sortOrder, lat: edit.lat, lng: edit.lng }); toast(t('common.saved')); setEdit(null); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('common.save')}</Button></>}>
        {edit ? <div className="stack"><LocalizedInput label={t('common.name')} required value={edit.name} onChange={(name) => setEdit({ ...edit, name })} /><TextInput label={t('admin.aliases')} value={edit.aliases} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} /><div className="row"><TextInput label="Sort" type="number" ltr value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} /><Checkbox label={t('admin.active')} checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /></div></div> : null}
      </Dialog>
    </div>
  );
}

function Audit() {
  const t = useT();
  const { locale } = useI18n();
  const paged = usePaged<AuditEvent>(() => query(collection(db, 'audit'), fbOrderBy('at', 'desc')), 30, []);
  return (
    <div className="stack">
      <h1>{t('admin.audit')}</h1>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('admin.actor')}</th><th>{t('admin.action')}</th><th>{t('admin.target')}</th><th>{t('common.reason')}</th></tr></thead><tbody>{paged.items.map((a) => <tr key={a.id}><td><bdi>{formatLocalDateTime(a.at, locale)}</bdi></td><td dir="ltr">{a.actorUid.slice(0, 10)}</td><td dir="ltr">{a.action}</td><td dir="ltr">{a.targetType}/{a.targetId}</td><td>{a.reason ?? ''}</td></tr>)}</tbody></table></div>
      {!paged.done ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
    </div>
  );
}

function Config() {
  const t = useT();
  const { L } = useI18n();
  const cfg = useDoc<PlatformConfig>('config/platform');
  const cities = useCollection<City>('cities', [orderBy('sortOrder'), limit(200)]);
  const [cityId, setCityId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (cfg.data) setCityId(cfg.data.defaultCityId); }, [cfg.data]);
  return (
    <div className="stack">
      <h1>{t('admin.config')}</h1>
      <Alert tone="info">{t('admin.futureMonetization')}</Alert>
      <section className="card stack">
        <Select label={t('admin.defaultCity')} value={cityId} onChange={(e) => setCityId(e.target.value)}>{cities.data.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
        <div className="muted">{t('admin.whatsapp')}: {t('admin.whatsappStatus', { status: cfg.data?.whatsappOtpEnabled ? t('common.enabled') : t('common.disabled') })}</div>
        <div className="muted">Subscriptions: {t('common.disabled')} · Commission: 0% · Paid promotion: {t('common.disabled')}</div>
        <Button loading={busy} onClick={async () => { setBusy(true); try { await call('setPlatformConfig', { defaultCityId: cityId }); toast(t('common.saved')); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('common.save')}</Button>
      </section>
    </div>
  );
}

function InviteOwner() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [createBiz, setCreateBiz] = useState(false);
  const [name, setName] = useState<Record<string, string>>({});
  const [type, setType] = useState<'restaurant' | 'supermarket'>('restaurant');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link?: string; businessId?: string } | null>(null);
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1>{t('admin.inviteOwner')}</h1>
      <p className="muted">{t('admin.inviteOwnerBody')}</p>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await call<{ link?: string; businessId?: string }>('inviteOwner', { email: email.trim(), business: createBiz ? { type, name, description: {}, defaultLocale: 'he' } : undefined }); setResult(r); toast(t('staff.invited')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setBusy(false); } }}>
        <TextInput label={t('common.email')} type="email" required ltr value={email} onChange={(e) => setEmail(e.target.value)} />
        <Checkbox label={t('admin.createBusinessFor')} checked={createBiz} onChange={(e) => setCreateBiz(e.target.checked)} />
        {createBiz ? <><Select label={t('bizProfile.type')} value={type} onChange={(e) => setType(e.target.value as 'restaurant')}><option value="restaurant">{t('common.restaurant')}</option><option value="supermarket">{t('common.supermarket')}</option></Select><LocalizedInput label={t('common.name')} required value={name} onChange={setName} /></> : null}
        <Button type="submit" loading={busy}>{t('staff.invite')}</Button>
        {result?.link ? <Alert tone="info"><span className="muted">{t('staff.inviteLinkNote')}</span><br /><a href={result.link} dir="ltr">{result.link}</a></Alert> : null}
      </form>
    </div>
  );
}

export function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<Overview />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="businesses" element={<Businesses />} />
        <Route path="businesses/:businessId" element={<BusinessDetail />} />
        <Route path="users" element={<Users />} />
        <Route path="orders" element={<Orders />} />
        <Route path="cities" element={<Cities />} />
        <Route path="audit" element={<Audit />} />
        <Route path="config" element={<Config />} />
        <Route path="invite" element={<InviteOwner />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
void collectionGroup;
void ConfirmDialog;
