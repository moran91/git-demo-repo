import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import type { Branch, Business, Membership, MembershipRole, Order } from '@qareeb/shared';
import { BRAND } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useCollection, useDoc, where, limit, orderBy } from '@/lib/queries';
import { BrandMark, Icon, type IconName } from '@/design/Icon';
import { Badge, Button, IconButton, Skeleton, EmptyState, toast } from '@/design/components';
import { LanguageSelect, OfflineBanner, UpdateBanner } from '@/app/Shell';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';

export interface DashCtx {
  business: Business;
  branch: Branch;
  branches: Branch[];
  membership: Membership | null;
  role: MembershipRole | 'admin';
  can: (perm: Perm) => boolean;
}
export type Perm = 'orders' | 'cash' | 'catalog' | 'settings' | 'staff' | 'financials' | 'printers_config' | 'print';

const ROLE_PERMS: Record<MembershipRole | 'admin', Perm[]> = {
  owner: ['orders', 'cash', 'catalog', 'settings', 'staff', 'financials', 'printers_config', 'print'],
  admin: ['orders', 'cash', 'catalog', 'settings', 'staff', 'financials', 'printers_config', 'print'],
  manager: ['orders', 'cash', 'catalog', 'settings', 'printers_config', 'print'],
  staff: ['orders', 'cash', 'print'],
};

const Ctx = createContext<DashCtx | null>(null);
export function useDash(): DashCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('dash ctx');
  return c;
}

/** Picks the business/branch from the route and enforces membership client-side (server enforces again). */
export function DashboardShell() {
  const t = useT();
  const { L } = useI18n();
  const { user, memberships, isAdmin, loading, signOut } = useAuth();
  const { businessId, branchId } = useParams();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const membership = memberships.find((m) => m.businessId === businessId) ?? null;
  const allowed = isAdmin || !!membership;
  const business = useDoc<Business>(allowed && businessId ? `businesses/${businessId}` : null);
  const branchesQ = useBranches(allowed ? businessId ?? null : null, membership, isAdmin);
  const branches = branchesQ.data;
  const branch = branches.find((b) => b.id === branchId) ?? null;
  const placed = useCollection<Order>(branch ? 'orders' : null, [where('businessId', '==', businessId ?? '_'), where('branchId', '==', branch?.id ?? '_'), where('status', '==', 'placed'), limit(50)], [branch?.id]);
  useEffect(() => {
    // No branch in the URL, or a branch this membership does not cover → first permitted branch.
    if (!branchesQ.loading && branches.length > 0 && businessId && (!branchId || !branches.some((b) => b.id === branchId))) {
      navigate(`/business/${businessId}/${branches[0]!.id}/orders`, { replace: true });
    }
  }, [branchId, branches, branchesQ.loading, businessId, navigate]);
  useEffect(() => {
    if (!loading && !user) navigate('/business/signin', { replace: true });
  }, [loading, user, navigate]);
  if (loading || business.loading || branchesQ.loading) return <div className="page stack" aria-busy="true"><Skeleton height={40} /><Skeleton height={200} radius={16} /></div>;
  if (!user) return null;
  if (!allowed || !business.data) return <main className="page"><EmptyState icon="store" title={t('error.forbidden')} action={<Link className="btn btn--secondary" to="/business">{t('common.back')}</Link>} /></main>;
  if (branches.length === 0) return <main className="page stack"><h1>{L(business.data.name, business.data.defaultLocale)}</h1><EmptyState icon="building" title={t('dash.branches')} body={t('bizProfile.created')} action={membership?.role === 'owner' || isAdmin ? <Link className="btn btn--primary" to={`/business/${businessId}/_/branches/new`}>{t('branch.new')}</Link> : undefined} /></main>;
  if (!branch) return null;
  const role: MembershipRole | 'admin' = isAdmin && !membership ? 'admin' : membership!.role;
  const can = (p: Perm) => ROLE_PERMS[role].includes(p);
  const ctx: DashCtx = { business: business.data, branch, branches, membership, role, can };
  const base = `/business/${businessId}/${branch.id}`;
  const nav: Array<{ to: string; icon: IconName; label: string; perm?: Perm; count?: number }> = [
    { to: `${base}/orders`, icon: 'bell', label: t('dash.incoming'), count: placed.data.length },
    { to: `${base}/history`, icon: 'list', label: t('dash.history') },
    { to: `${base}/catalog`, icon: 'basket', label: t('dash.catalog'), perm: 'catalog' },
    { to: `${base}/branch`, icon: 'building', label: t('dash.branchSettings'), perm: 'settings' },
    { to: `${base}/printers`, icon: 'printer', label: t('dash.printers') },
    { to: `${base}/cash`, icon: 'wallet', label: t('dash.cash'), perm: 'financials' },
    { to: `${base}/loyalty`, icon: 'star', label: t('dash.loyalty'), perm: 'financials' },
    { to: `${base}/staff`, icon: 'users', label: t('dash.staff'), perm: 'staff' },
    { to: `${base}/business`, icon: 'store', label: t('dash.business'), perm: 'settings' },
  ];
  const sidebar = (
    <>
      <Link to="/" className="brand" style={{ marginBottom: 8 }}><BrandMark size={28} label={t('brand.logoLabel')} /><span className="brand__word">{BRAND.wordmark}</span></Link>
      <nav className="dash__nav stack--sm stack" aria-label={t('nav.business')}>
        {nav.filter((n) => !n.perm || can(n.perm)).map((n) => (
          <NavLink key={n.to} to={n.to} onClick={() => setDrawer(false)}>
            <Icon name={n.icon} size={20} /> {n.label} {n.count ? <Badge tone="accent">{n.count}</Badge> : null}
          </NavLink>
        ))}
      </nav>
      <div style={{ marginTop: 'auto' }} className="stack--sm stack">
        <LanguageSelect />
        <Button variant="ghost" icon="logout" onClick={() => void signOut()}>{t('common.signOut')}</Button>
      </div>
    </>
  );
  return (
    <Ctx.Provider value={ctx}>
      <UpdateBanner />
      <div className="dash">
        <aside className="dash__sidebar">{sidebar}</aside>
        {drawer ? (
          <>
            <button type="button" className="drawer-backdrop" aria-label={t('common.close')} onClick={() => setDrawer(false)} />
            <aside className="dash__sidebar dash__sidebar--drawer" role="dialog" aria-modal="true" aria-label={t('common.menu')}>{sidebar}</aside>
          </>
        ) : null}
        <header className="dash__header">
          <span style={{ display: 'contents' }} className="no-desktop">
            <IconButton icon="menu" label={t('common.menu')} onClick={() => setDrawer(true)} className="dash__menu-btn" aria-expanded={drawer} />
          </span>
          <BusinessSwitcher currentBusinessId={businessId!} />
          <select className="select" value={branch.id} aria-label={t('dash.switchBranch')} onChange={(e) => navigate(`/business/${businessId}/${e.target.value}/orders`)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{L(b.name, business.data!.defaultLocale)}</option>)}
          </select>
          <PauseControl />
          <div style={{ marginInlineStart: 'auto' }} className="row">
            {branch.approval !== 'approved' ? <Badge tone={branch.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${branch.approval}`)}</Badge> : null}
            {business.data.approval !== 'approved' ? <Badge tone={business.data.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${business.data.approval}`)}</Badge> : null}
          </div>
        </header>
        <main className="dash__main" id="main">
          <OfflineBanner />
          {branch.ordersPaused ? <div className="alert alert--warn" role="status" style={{ marginBottom: 16 }}><Icon name="clock" size={18} /> {t('dash.pausedBanner')}</div> : null}
          <Outlet />
        </main>
      </div>
      <style>{`@media (min-width: 900px) { .dash__menu-btn { display: none; } }`}</style>
    </Ctx.Provider>
  );
}

/**
 * Branch list respecting membership limits. Firestore list queries must be provable by rules, and a
 * branch-limited membership cannot prove a collection query, so limited members read their permitted
 * branches document by document; owners/admins query the collection.
 */
function useBranches(businessId: string | null, membership: Membership | null, isAdmin: boolean): { data: Branch[]; loading: boolean } {
  const limited = !!membership && !membership.allBranches && !isAdmin;
  const all = useCollection<Branch>(businessId && !limited ? `businesses/${businessId}/branches` : null, [orderBy('createdAt'), limit(30)], [businessId, limited]);
  const [docs, setDocs] = useState<{ data: Branch[]; loading: boolean }>({ data: [], loading: limited });
  const ids = membership?.branchIds.join(',') ?? '';
  useEffect(() => {
    if (!businessId || !limited) return;
    const list = ids.split(',').filter(Boolean);
    if (list.length === 0) {
      setDocs({ data: [], loading: false });
      return;
    }
    const map = new Map<string, Branch>();
    let pending = list.length;
    const unsubs = list.map((id) =>
      onSnapshot(doc(db, `businesses/${businessId}/branches/${id}`), (snap) => {
        if (snap.exists()) map.set(id, { id: snap.id, ...snap.data() } as Branch);
        else map.delete(id);
        pending = Math.max(0, pending - 1);
        setDocs({ data: list.map((x) => map.get(x)).filter((b): b is Branch => !!b), loading: pending > 0 });
      }, () => { pending = Math.max(0, pending - 1); setDocs((s) => ({ ...s, loading: pending > 0 })); }),
    );
    return () => unsubs.forEach((u) => u());
  }, [businessId, limited, ids]);
  return limited ? docs : all;
}

function BusinessSwitcher({ currentBusinessId }: { currentBusinessId: string }) {
  const t = useT();
  const { L } = useI18n();
  const { memberships } = useAuth();
  const navigate = useNavigate();
  const ids = memberships.map((m) => m.businessId);
  const businesses = useCollection<Business>(ids.length ? 'businesses' : null, [where('__name__', 'in', ids.slice(0, 10)), limit(10)], [ids.join(',')]);
  if (memberships.length <= 1) return <strong className="truncate" style={{ maxWidth: 220 }}>{businesses.data[0] ? L(businesses.data[0].name, businesses.data[0].defaultLocale) : ''}</strong>;
  return (
    <select className="select" value={currentBusinessId} aria-label={t('dash.switchBusiness')} onChange={(e) => navigate(`/business/${e.target.value}`)}>
      {businesses.data.map((b) => <option key={b.id} value={b.id}>{L(b.name, b.defaultLocale)}</option>)}
    </select>
  );
}

function PauseControl() {
  const t = useT();
  const { business, branch, can } = useDash();
  const [busy, setBusy] = useState(false);
  if (!can('settings')) return null;
  return (
    <Button size="sm" variant={branch.ordersPaused ? 'primary' : 'secondary'} icon={branch.ordersPaused ? 'refresh' : 'clock'} loading={busy} onClick={async () => { setBusy(true); try { await call('setOrdersPaused', { businessId: business.id, branchId: branch.id, paused: !branch.ordersPaused }); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>
      {branch.ordersPaused ? t('dash.resumeOrders') : t('dash.pauseOrders')}
    </Button>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="dash__title"><h1>{title}</h1><div className="row">{children}</div></div>;
}
