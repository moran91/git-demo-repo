import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatPhoneDisplay, type AuditEvent, type LoyaltyAccount, type Membership, type Order, type UserProfile } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useCollection, useDoc, where, orderBy, limit } from '@/lib/queries';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { money, formatLocalDateTime } from '@/lib/format';
import { Alert, Badge, Button, Dialog, EmptyState, Select, Skeleton, StackTable, TextArea, TextInput, toast } from '@/design/components';
import { LoadError } from '@/business/BusinessExperience';
import { OrderStatusBadge } from '@/business/OrderCard';
import { useAdminNames, useUsers } from './lib';
import { CashBadge, OrderInspect } from './OrdersPage';
import { AuditList } from './PlatformPages';

type UserRow = { uid: string; displayName: string; email?: string; phone?: string; suspended: boolean; suspendedReason?: string; isAdmin: boolean; createdAt: string; memberships: Membership[] };

/** Email when it has an @, phone when it is mostly digits, otherwise a name prefix. */
function searchInput(q: string): Record<string, string> {
  const s = q.trim();
  if (!s) return {};
  if (s.includes('@')) return { email: s };
  if (/^[+\d\s()\-٠-٩۰-۹]+$/.test(s) && s.replace(/\D/g, '').length >= 7) return { phone: s };
  return { name: s };
}

function UserStatus({ u }: { u: Pick<UserProfile, 'isAdmin' | 'suspended'> }) {
  const t = useT();
  return u.isAdmin ? <Badge tone="primary">{t('staff.role.admin')}</Badge> : u.suspended ? <Badge tone="danger">{t('admin.userSuspended')}</Badge> : <Badge tone="success">{t('admin.active')}</Badge>;
}

export function UsersPage() {
  const t = useT();
  const { locale } = useI18n();
  const names = useAdminNames();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ users: UserRow[]; nextCursor?: string } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = async (cursor?: string) => {
    setLoading(true);
    try {
      const r = await call<{ users: UserRow[]; nextCursor?: string }>('adminListUsers', cursor ? { cursor } : searchInput(q));
      setData((prev) => (cursor && prev ? { users: [...prev.users, ...r.users], nextCursor: r.nextCursor } : r));
      setError(false);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
      setError(!cursor);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let live = true;
    call<{ users: UserRow[]; nextCursor?: string }>('adminListUsers', {}).then((r) => { if (live) setData(r); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, []);
  return (
    <div className="stack">
      <h1>{t('admin.users')}</h1>
      <form className="row admin-search" role="search" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.userSearch')} aria-label={t('admin.userSearch')} />
        <Button type="submit" variant="secondary" loading={loading && !data}>{t('common.search')}</Button>
      </form>
      {error ? <LoadError retry={() => void load()} /> : !data ? <Skeleton height={200} radius={16} /> : data.users.length === 0 ? <EmptyState icon="users" title={t('admin.noResults')} /> : (
        <StackTable><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('common.email')} / {t('common.phone')}</th><th>{t('admin.memberships')}</th><th>{t('common.status')}</th><th>{t('admin.joined')}</th></tr></thead><tbody>
          {data.users.map((u) => <tr key={u.uid}><td><Link to={`/admin/users/${u.uid}`}>{u.displayName || '—'}</Link></td><td><div className="admin-contact">{u.email ? <bdi>{u.email}</bdi> : null}{u.phone ? <bdi className="num">{formatPhoneDisplay(u.phone)}</bdi> : null}</div></td><td>{u.memberships.length ? u.memberships.map((m) => `${t(`staff.role.${m.role}`)} · ${names.business(m.businessId)}`).join(', ') : <span className="muted">{t('admin.customer')}</span>}</td><td><UserStatus u={u} /></td><td><bdi>{formatLocalDateTime(u.createdAt, locale)}</bdi></td></tr>)}
        </tbody></table></StackTable>
      )}
      {data?.nextCursor ? <div className="pagination"><Button variant="secondary" loading={loading} onClick={() => void load(data.nextCursor)}>{t('dash.loadMore')}</Button></div> : null}
    </div>
  );
}

export function UserDetailPage() {
  const { uid = '' } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const { user: me } = useAuth();
  const names = useAdminNames();
  const profile = useDoc<UserProfile>(`users/${uid}`);
  const memberships = useCollection<Membership>('memberships', [where('uid', '==', uid), limit(20)], [uid]);
  const loyalty = useCollection<LoyaltyAccount>('loyaltyAccounts', [where('uid', '==', uid), orderBy('updatedAt', 'desc'), limit(20)], [uid]);
  const orders = useCollection<Order>('orders', [where('customer.uid', '==', uid), orderBy('placedAt', 'desc'), limit(10)], [uid]);
  const activity = useCollection<AuditEvent>('audit', [where('targetId', '==', uid), limit(50)], [uid]);
  const users = useUsers(activity.data.map((a) => a.actorUid));
  const [suspend, setSuspend] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [inspect, setInspect] = useState<Order | null>(null);
  if (profile.loading) return <Skeleton height={200} radius={16} />;
  if (profile.error) return <LoadError />;
  if (!profile.data) return <EmptyState icon="users" title={t('common.notFound')} action={<Link className="btn btn--secondary" to="/admin/users">{t('common.back')}</Link>} />;
  const u = profile.data;
  const canSuspend = !u.isAdmin && u.uid !== me?.uid;
  return (
    <div className="stack">
      <div className="dash__title"><h1>{u.displayName || '—'}</h1><div className="actions">{canSuspend ? <Button variant={u.suspended ? 'secondary' : 'danger'} onClick={() => setSuspend(true)}>{u.suspended ? t('admin.reinstateUser') : t('admin.suspendUser')}</Button> : null}<Button variant="secondary" onClick={() => setAdjust(true)}>{t('admin.loyaltyAdjust')}</Button></div></div>
      {u.suspended ? <Alert tone="danger"><span>{t('admin.suspendedReason', { reason: u.suspendedReason ?? '—' })}</span></Alert> : null}
      <section className="card stack--sm stack">
        <div className="row admin-row"><UserStatus u={u} />{u.phone && !u.phoneVerified ? <Badge tone="muted">{t('admin.phoneUnverified')}</Badge> : null}<bdi className="muted admin-uid" dir="ltr">{u.uid}</bdi></div>
        <div className="kvlist">
          {u.email ? <div><span className="muted">{t('common.email')}</span><span><bdi>{u.email}</bdi></span></div> : null}
          {u.phone ? <div><span className="muted">{t('common.phone')}</span><span><bdi className="num">{formatPhoneDisplay(u.phone)}</bdi></span></div> : null}
          <div><span className="muted">{t('admin.joined')}</span><span><bdi>{formatLocalDateTime(u.createdAt, locale)}</bdi></span></div>
        </div>
      </section>
      {memberships.data.length > 0 ? <section className="card stack--sm stack"><h2>{t('admin.memberships')}</h2><ul className="list">{memberships.data.map((m) => <li key={m.id} className="list__item admin-item"><div className="list__grow"><Link to={`/admin/businesses/${m.businessId}`}>{names.business(m.businessId)}</Link><div className="muted">{t(`staff.role.${m.role}`)}{m.allBranches ? ` · ${t('staff.allBranches')}` : ''}</div></div>{!m.active ? <Badge tone="danger">{t('common.disabled')}</Badge> : null}</li>)}</ul></section> : null}
      <section className="card stack--sm stack"><h2>{t('admin.loyaltyBalances')}</h2>
        {loyalty.data.length === 0 && !loyalty.loading ? <p className="muted">{t('common.none')}</p> : <ul className="list">{loyalty.data.map((a) => <li key={a.id} className="list__item admin-item"><div className="list__grow">{names.business(a.businessId)}</div><span className="num">{t('admin.pointsBalance', { available: a.available })}</span>{a.debt ? <Badge tone="danger">{t('admin.pointsDebt', { debt: a.debt })}</Badge> : null}</li>)}</ul>}
      </section>
      <section className="card stack--sm stack"><h2>{t('admin.customerOrders')}</h2>
        {orders.error ? <LoadError /> : orders.data.length === 0 && !orders.loading ? <p className="muted">{t('orders.empty')}</p> : null}
        <ul className="list">{orders.data.map((o) => (
          <li key={o.id} className="list__item admin-item">
            <button type="button" className="admin-item__link list__grow" onClick={() => setInspect(o)}><strong className="num">{o.reference}</strong> <span className="muted">· {L(o.businessName)} · <bdi>{formatLocalDateTime(o.placedAt, locale)}</bdi></span></button>
            <div className="admin-item__end"><OrderStatusBadge status={o.status} stage={o.stage} mode={o.mode} /><CashBadge order={o} /><bdi className="money">{money(o.totals.cashDueAgorot, locale)}</bdi></div>
          </li>
        ))}</ul>
      </section>
      {activity.data.length > 0 ? <section className="card stack--sm stack"><h2>{t('admin.activity')}</h2><AuditList rows={[...activity.data].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 20)} names={users.name} /></section> : null}
      <SuspendDialog open={suspend} user={u} onClose={() => setSuspend(false)} />
      <LoyaltyDialog open={adjust} uid={u.uid} accounts={loyalty.data} fallbackBusinessId={orders.data[0]?.businessId ?? memberships.data[0]?.businessId} onClose={() => setAdjust(false)} />
      <OrderInspect order={inspect} onClose={() => setInspect(null)} />
    </div>
  );
}

function SuspendDialog({ open, user, onClose }: { open: boolean; user: UserProfile; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const suspending = !user.suspended;
  const submit = async () => {
    setBusy(true);
    try {
      await call('setUserSuspended', { uid: user.uid, suspended: suspending, reason: reason.trim() });
      toast(t('common.saved'));
      setReason('');
      onClose();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={suspending ? t('admin.suspendUser') : t('admin.reinstateUser')} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant={suspending ? 'danger-solid' : 'primary'} loading={busy} disabled={reason.trim().length < 2} onClick={() => void submit()}>{suspending ? t('admin.suspendUser') : t('admin.reinstateUser')}</Button></>}>
      <TextArea label={t('common.reason')} required hint={t('admin.reasonRequired')} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Dialog>
  );
}

function LoyaltyDialog({ open, uid, accounts, fallbackBusinessId, onClose }: { open: boolean; uid: string; accounts: LoyaltyAccount[]; fallbackBusinessId?: string; onClose: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const { businesses } = useAdminNames();
  const [businessId, setBusinessId] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = businessId || accounts[0]?.businessId || fallbackBusinessId || '';
  const balance = accounts.find((a) => a.businessId === chosen);
  const n = Number(points);
  const valid = !!chosen && Number.isInteger(n) && n !== 0 && reason.trim().length >= 3;
  const submit = async () => {
    setBusy(true);
    try {
      await call('adminAdjustLoyalty', { uid, businessId: chosen, points: n, reason: reason.trim() });
      toast(t('common.saved'));
      setPoints('');
      setReason('');
      onClose();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('admin.loyaltyAdjust')} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={!valid} onClick={() => void submit()}>{t('common.confirm')}</Button></>}>
      <div className="stack">
        <Select label={t('admin.business')} value={chosen} onChange={(e) => setBusinessId(e.target.value)} hint={balance ? t('admin.pointsBalance', { available: balance.available }) : undefined}>
          {chosen ? null : <option value="">—</option>}
          {businesses.filter((b) => b.approval === 'approved' || b.id === chosen).map((b) => <option key={b.id} value={b.id}>{L(b.name, b.defaultLocale)}</option>)}
        </Select>
        <TextInput label={t('admin.points')} type="number" inputMode="numeric" step={1} ltr value={points} onChange={(e) => setPoints(e.target.value)} />
        <TextArea label={t('common.reason')} required hint={t('admin.reasonRequired')} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}
