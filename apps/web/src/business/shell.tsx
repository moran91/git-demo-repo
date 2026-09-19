import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import type { Branch, Business, Membership, MembershipRole, Order } from '@qareeb/shared';
import { BRAND } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useCollection, useDoc, where, limit, orderBy } from '@/lib/queries';
import { BrandMark, Icon, type IconName } from '@/design/Icon';
import { Badge, Button, IconButton, Skeleton, EmptyState, toast, ConfirmDialog } from '@/design/components';
import { LanguageSelect, OfflineBanner, UpdateBanner } from '@/app/Shell';
import { call } from '@/lib/api';
import { useOpenState } from '@/customer/hooks';
import { errorKey } from '@/lib/errors';
import { LoadError, useConfirmNavigation } from './BusinessExperience';

export interface DashCtx {
  business: Business;
  branch: Branch;
  branches: Branch[];
  membership: Membership | null;
  role: MembershipRole | 'admin';
  can: (perm: Perm) => boolean;
}
/**
 * `financials` = viewing cash records and the loyalty ledger, which firestore.rules grants to owners
 * AND managers ("staff do not see financial reports"). `reverse_cash` is separate because reversing a
 * recorded payment is owner-only on the server, so a manager must not be offered the button.
 */
export type Perm = 'orders' | 'cash' | 'catalog' | 'settings' | 'staff' | 'financials' | 'reverse_cash' | 'printers_config' | 'print';

const ROLE_PERMS: Record<MembershipRole | 'admin', Perm[]> = {
  owner: ['orders', 'cash', 'catalog', 'settings', 'staff', 'financials', 'reverse_cash', 'printers_config', 'print'],
  admin: ['orders', 'cash', 'catalog', 'settings', 'staff', 'financials', 'reverse_cash', 'printers_config', 'print'],
  manager: ['orders', 'cash', 'catalog', 'settings', 'financials', 'printers_config', 'print'],
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
  const { L, dir } = useI18n();
  const { user, memberships, membershipsError, isAdmin, loading, signOut } = useAuth();
  const { businessId, branchId } = useParams();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const confirmNavigation = useConfirmNavigation();
  const membership = memberships.find((m) => m.businessId === businessId) ?? null;
  const allowed = isAdmin || !!membership;
  const business = useDoc<Business>(allowed && businessId ? `businesses/${businessId}` : null);
  const branchesQ = useBranches(allowed ? businessId ?? null : null, membership, isAdmin);
  const branches = branchesQ.data;
  const branch = branches.find((b) => b.id === branchId) ?? null;
  const openState = useOpenState(branch);
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
  useEffect(() => {
    if (!drawer || !drawerRef.current) return;
    const dialog = drawerRef.current;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = overflow; opener?.focus(); };
  }, [drawer]);
  if (loading || business.loading || branchesQ.loading) return <div className="page stack" aria-busy="true"><Skeleton height={40} /><Skeleton height={200} radius={16} /></div>;
  if (!user) return null;
  if (membershipsError || business.error || branchesQ.error) return <main className="page"><LoadError /></main>;
  if (!allowed || !business.data) return <main className="page"><EmptyState icon="store" title={t('error.forbidden')} action={<Link className="btn btn--secondary" to="/business">{t('common.back')}</Link>} /></main>;
  if (branches.length === 0) return <main className="page stack"><h1>{L(business.data.name, business.data.defaultLocale)}</h1><EmptyState icon="building" title={t('dash.branches')} body={t('bizProfile.created')} action={membership?.role === 'owner' || isAdmin ? <Link className="btn btn--primary" to={`/business/${businessId}/_/branches/new`}>{t('branch.new')}</Link> : undefined} /></main>;
  if (!branch) return null;
  const role: MembershipRole | 'admin' = isAdmin && !membership ? 'admin' : membership!.role;
  const can = (p: Perm) => ROLE_PERMS[role].includes(p);
  const ctx: DashCtx = { business: business.data, branch, branches, membership, role, can };
  const base = `/business/${businessId}/${branch.id}`;
  type NavItem = { to: string; icon: IconName; label: string; perm?: Perm; count?: number };
  const sections: Array<{ label: string; items: NavItem[] }> = [
    { label: t('dash.section.orders'), items: [
      { to: `${base}/orders`, icon: 'bell', label: t('dash.incoming'), count: placed.data.length },
      { to: `${base}/history`, icon: 'list', label: t('dash.history') },
    ] },
    { label: t('dash.section.menu'), items: [
      { to: `${base}/catalog`, icon: 'basket', label: t('dash.catalog'), perm: 'catalog' },
      { to: `${base}/deals`, icon: 'tag', label: t('deals.manage'), perm: 'catalog' },
    ] },
    { label: t('dash.section.manage'), items: [
      { to: `${base}/branch`, icon: 'building', label: t('dash.branchSettings'), perm: 'settings' },
      { to: `${base}/printers`, icon: 'printer', label: t('dash.printers') },
      { to: `${base}/cash`, icon: 'wallet', label: t('dash.cash'), perm: 'financials' },
      { to: `${base}/loyalty`, icon: 'star', label: t('dash.loyalty'), perm: 'financials' },
      { to: `${base}/staff`, icon: 'users', label: t('dash.staff'), perm: 'staff' },
    ] },
    { label: t('dash.section.business'), items: [
      { to: `${base}/business`, icon: 'store', label: t('dash.business'), perm: 'settings' },
      { to: `${base}/qr`, icon: 'qr', label: t('dash.qr'), perm: 'settings' },
    ] },
  ];
  const bizName = L(business.data.name, business.data.defaultLocale);
  const sidebar = (inDrawer: boolean) => (
    <>
      <div className="dash__sidebar-head">
        <Link to="/" className="brand"><BrandMark size={28} label={t('brand.logoLabel')} /><span className="brand__word">{BRAND.wordmark}</span></Link>
        {inDrawer ? <IconButton icon="x" label={t('common.close')} onClick={() => setDrawer(false)} /> : null}
      </div>
      <div className="dash__identity">
        <span className="dash__identity-mark" aria-hidden="true">{bizName.trim().charAt(0)}</span>
        <span className="dash__identity-text">
          <strong className="truncate">{bizName}</strong>
          <span className="truncate muted">{L(branch.name, business.data!.defaultLocale)} · {branch.ordersPaused ? t('dash.ordersPausedShort') : branch.approval !== 'approved' || business.data!.approval !== 'approved' ? t(`admin.state.${branch.approval !== 'approved' ? branch.approval : business.data!.approval}`) : openState.open ? t('dash.acceptingOrders') : t('common.closed')}</span>
        </span>
      </div>
      <nav className="dash__nav" aria-label={t('nav.business')}>
        {sections.map((sec) => {
          const items = sec.items.filter((n) => !n.perm || can(n.perm));
          if (items.length === 0) return null;
          return (
            <div key={sec.label} className="dash__nav-group">
              <div className="dash__nav-label">{sec.label}</div>
              {items.map((n) => (
                <NavLink key={n.to} to={n.to} onClick={() => setDrawer(false)}>
                  <Icon name={n.icon} size={20} /><span className="dash__nav-text">{n.label}</span>{n.count ? <span className="dash__count">{n.count}</span> : null}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="dash__sidebar-foot">
        <LanguageSelect />
        <button type="button" className="dash__signout" onClick={() => { if (confirmNavigation()) void signOut().catch((e) => toast(t(errorKey(e)), 'danger')); }}><Icon name="logout" size={20} directional /><span>{t('common.signOut')}</span></button>
      </div>
    </>
  );
  return (
    <Ctx.Provider value={ctx}>
      <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
      <UpdateBanner />
      <div className="dash">
        <aside className="dash__sidebar">{sidebar(false)}</aside>
        {drawer ? <dialog ref={drawerRef} className="dash__sidebar dash__sidebar--drawer" style={dir === 'rtl' ? { right: 0, left: 'auto' } : { left: 0, right: 'auto' }} aria-label={t('common.menu')} onCancel={(event) => { event.preventDefault(); setDrawer(false); }}>{sidebar(true)}</dialog> : null}
        <header className="dash__header">
          <span style={{ display: 'contents' }} className="no-desktop">
            <Button variant="secondary" icon="menu" onClick={() => setDrawer(true)} className="dash__menu-btn" aria-expanded={drawer} aria-haspopup="dialog">{t('common.menu')}</Button>
          </span>
          <BusinessSwitcher currentBusinessId={businessId!} />
          <div className="dash__header-end row">
            {branch.approval !== 'approved' ? <Badge tone={branch.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${branch.approval}`)}</Badge> : null}
            {business.data.approval !== 'approved' ? <Badge tone={business.data.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${business.data.approval}`)}</Badge> : null}
          </div>
          {/* Zero-height flex item: on a phone the branch picker and the pause button get a full row of
              their own instead of wrapping at whatever point they happen to run out of space. */}
          <span className="dash__header-break" aria-hidden="true" />
          <select className="select dash__branch" value={branch.id} aria-label={t('dash.switchBranch')} onChange={(e) => { const section = location.pathname.split('/')[4] ?? 'orders'; navigate(`/business/${businessId}/${e.target.value}/${section === 'orders' ? 'orders' : section}`); }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{L(b.name, business.data!.defaultLocale)}</option>)}
          </select>
          <PauseControl />
        </header>
        <main className="dash__main" id="main" tabIndex={-1}>
          <OfflineBanner />
          {branch.ordersPaused ? <div className="alert alert--warn" role="status" style={{ marginBottom: 16 }}><Icon name="clock" size={18} /> {t('dash.pausedBanner')}</div> : null}
          <div key={`${businessId}/${branch.id}`}><Outlet /></div>
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
function useBranches(businessId: string | null, membership: Membership | null, isAdmin: boolean): { data: Branch[]; loading: boolean; error?: Error | null } {
  const limited = !!membership && !membership.allBranches && !isAdmin;
  const all = useCollection<Branch>(businessId && !limited ? `businesses/${businessId}/branches` : null, [orderBy('createdAt'), limit(30)], [businessId, limited]);
  const [docs, setDocs] = useState<{ key: string; data: Branch[]; loading: boolean; error?: Error }>({ key: '', data: [], loading: limited });
  const ids = membership?.branchIds.join(',') ?? '';
  const key = `${businessId}:${ids}`;
  useEffect(() => {
    if (!businessId || !limited) return;
    const list = ids.split(',').filter(Boolean);
    if (list.length === 0) {
      setDocs({ key, data: [], loading: false });
      return;
    }
    const map = new Map<string, Branch>();
    const pending = new Set(list);
    const unsubs = list.map((id) =>
      onSnapshot(doc(db, `businesses/${businessId}/branches/${id}`), (snap) => {
        if (snap.exists()) map.set(id, { id: snap.id, ...snap.data() } as Branch);
        else map.delete(id);
        pending.delete(id);
        setDocs({ key, data: list.map((x) => map.get(x)).filter((b): b is Branch => !!b), loading: pending.size > 0 });
      }, (error) => { pending.delete(id); setDocs({ key, data: [], loading: pending.size > 0, error }); }),
    );
    return () => unsubs.forEach((u) => u());
  }, [businessId, limited, ids, key]);
  return limited ? docs.key === key ? docs : { data: [], loading: true } : all;
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
    <select className="select" value={currentBusinessId} aria-label={t('dash.switchBusiness')} onChange={(e) => { navigate(`/business/${e.target.value}`); }}>
      {businesses.data.map((b) => <option key={b.id} value={b.id}>{L(b.name, b.defaultLocale)}</option>)}
    </select>
  );
}

function PauseControl() {
  const t = useT();
  const { business, branch, can } = useDash();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const change = async () => {
    setBusy(true);
    try { await call('setOrdersPaused', { businessId: business.id, branchId: branch.id, paused: !branch.ordersPaused }); setConfirm(false); toast(t('common.saved')); }
    catch (e) { toast(t(errorKey(e)), 'danger'); }
    finally { setBusy(false); }
  };
  if (!can('settings')) return null;
  return <>
    <Button variant={branch.ordersPaused ? 'primary' : 'secondary'} icon={branch.ordersPaused ? 'refresh' : 'clock'} loading={busy} onClick={() => { if (branch.ordersPaused) void change(); else setConfirm(true); }}>
      {branch.ordersPaused ? t('dash.resumeOrders') : t('dash.pauseOrders')}
    </Button>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={change} loading={busy} title={t('owner.pauseConfirm')} body={t('owner.pauseBody')} confirmLabel={t('dash.pauseOrders')} />
  </>;
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="dash__title"><h1>{title}</h1><div className="actions">{children}</div></div>;
}
