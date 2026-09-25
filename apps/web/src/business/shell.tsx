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
import { IconButton, Skeleton, EmptyState, toast, ConfirmDialog, Spinner } from '@/design/components';
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

export type NavItem = { to: string; icon: IconName; label: string; perm?: Perm; count?: number };
export type NavSection = { id: 'orders' | 'menu' | 'branch' | 'business'; label: string; items: NavItem[] };

/** The dashboard's navigation, already filtered by the caller's permissions. Shared by the desktop
 * sidebar, the phone drawer, the bottom tab bar and the More page so every surface agrees. */
export function useNavSections(placedCount = 0): NavSection[] {
  const t = useT();
  const { business, branch, can, role } = useDash();
  const base = `/business/${business.id}/${branch.id}`;
  const sections: NavSection[] = [
    { id: 'orders', label: t('dash.section.orders'), items: [
      { to: `${base}/orders`, icon: 'bell', label: t('dash.incoming'), count: placedCount },
      { to: `${base}/history`, icon: 'list', label: t('dash.history') },
    ] },
    { id: 'menu', label: t('dash.section.menu'), items: [
      { to: `${base}/catalog`, icon: 'basket', label: t('dash.catalog'), perm: 'catalog' },
      { to: `${base}/deals`, icon: 'tag', label: t('deals.manage'), perm: 'catalog' },
    ] },
    { id: 'branch', label: t('dash.switchBranch'), items: [
      { to: `${base}/posts`, icon: 'flame', label: t('posts.manage'), perm: 'catalog' },
      { to: `${base}/branch`, icon: 'building', label: t('dash.branchSettings'), perm: 'settings' },
      // createBranch is owner-only on the server, and the route lives outside the branch shell. Without
      // this the page was reachable only while the business had no branch at all.
      ...(role === 'owner' || role === 'admin' ? [{ to: `/business/${business.id}/_/branches/new`, icon: 'plus' as IconName, label: t('branch.new') }] : []),
      { to: `${base}/printers`, icon: 'printer', label: t('dash.printers') },
      { to: `${base}/cash`, icon: 'wallet', label: t('dash.cash'), perm: 'financials' },
      { to: `${base}/qr`, icon: 'qr', label: t('dash.qr'), perm: 'settings' },
    ] },
    { id: 'business', label: t('dash.section.business'), items: [
      { to: `${base}/business`, icon: 'store', label: t('dash.business'), perm: 'settings' },
      { to: `${base}/staff`, icon: 'users', label: t('dash.staff'), perm: 'staff' },
      { to: `${base}/loyalty`, icon: 'star', label: t('dash.loyalty'), perm: 'financials' },
      { to: `${base}/catalog/extras`, icon: 'layers', label: t('catalog.library'), perm: 'catalog' },
    ] },
  ];
  return sections.map((s) => ({ ...s, items: s.items.filter((n) => !n.perm || can(n.perm)) })).filter((s) => s.items.length > 0);
}

export type BranchStatus = { tone: 'success' | 'accent' | 'danger' | 'muted'; label: string; short: string };
/** One status for the branch, shown as the header pill and in every identity block. */
export function useBranchStatus(): BranchStatus {
  const t = useT();
  const { business, branch } = useDash();
  const openState = useOpenState(branch);
  if (branch.ordersPaused) return { tone: 'accent', label: t('dash.ordersPausedShort'), short: t('dash.pausedPill') };
  const approval = branch.approval !== 'approved' ? branch.approval : business.approval !== 'approved' ? business.approval : null;
  if (approval) return { tone: approval === 'pending' ? 'accent' : 'danger', label: t(`admin.state.${approval}`), short: t(`admin.state.${approval}`) };
  if (openState.open) return { tone: 'success', label: t('dash.acceptingOrders'), short: t('common.open') };
  return { tone: 'muted', label: t('common.closed'), short: t('common.closed') };
}

/** Picks the business/branch from the route and enforces membership client-side (server enforces again). */
export function DashboardShell() {
  const t = useT();
  const { L } = useI18n();
  const { user, memberships, membershipsError, isAdmin, loading } = useAuth();
  const { businessId, branchId } = useParams();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
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
  return (
    <Ctx.Provider value={ctx}>
      <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
      <UpdateBanner />
      <div className="dash">
        <aside className="dash__sidebar">
          <div className="dash__sidebar-head">
            <Link to="/" className="brand"><BrandMark size={28} label={t('brand.logoLabel')} /><span className="brand__word">{BRAND.wordmark}</span></Link>
          </div>
          <BranchChip variant="identity" />
          <NavGroups placedCount={placed.data.length} />
          <SidebarFoot compact />
        </aside>
        {drawer ? (
          <dialog ref={drawerRef} className="dash__sidebar dash__sidebar--drawer" aria-label={t('common.menu')} onCancel={(event) => { event.preventDefault(); setDrawer(false); }}>
            <div className="dash__sidebar-head">
              <Link to="/" className="brand" onClick={() => setDrawer(false)}><BrandMark size={28} label={t('brand.logoLabel')} /><span className="brand__word">{BRAND.wordmark}</span></Link>
              <IconButton icon="x" label={t('common.close')} onClick={() => setDrawer(false)} />
            </div>
            <NavGroups placedCount={placed.data.length} onNavigate={() => setDrawer(false)} />
            <SidebarFoot />
          </dialog>
        ) : null}
        <header className={`dash__header${branch.ordersPaused ? ' dash__header--paused' : ''}`}>
          <IconButton icon="menu" label={t('common.menu')} className="dash__menu-btn no-desktop" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-haspopup="dialog" />
          <BranchChip variant="header" />
          <StatusControl />
        </header>
        <main className="dash__main" id="main" tabIndex={-1}>
          <OfflineBanner />
          {branch.ordersPaused ? <div className="alert alert--warn dash__paused" role="status"><Icon name="clock" size={18} /> {t('dash.pausedBanner')}</div> : null}
          <div key={`${businessId}/${branch.id}`}><Outlet /></div>
        </main>
        <TabBar placedCount={placed.data.length} />
      </div>
    </Ctx.Provider>
  );
}

function NavGroups({ placedCount, onNavigate }: { placedCount: number; onNavigate?: () => void }) {
  const t = useT();
  const sections = useNavSections(placedCount);
  return (
    <nav className="dash__nav" aria-label={t('nav.business')}>
      {sections.map((sec) => (
        <div key={sec.id} className="dash__nav-group">
          <div className="dash__nav-label">{sec.label}</div>
          {sec.items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to.endsWith('/catalog')} onClick={onNavigate}>
              <Icon name={n.icon} size={20} /><span className="dash__nav-text">{n.label}</span>{n.count ? <span className="dash__count">{n.count}</span> : null}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** `compact` (desktop sidebar): language as a menu button beside Sign out so the footer is one row. */
function SidebarFoot({ compact }: { compact?: boolean }) {
  const t = useT();
  const { business } = useDash();
  const { memberships, signOut } = useAuth();
  const confirmNavigation = useConfirmNavigation();
  return (
    <div className={`dash__sidebar-foot${compact ? ' dash__sidebar-foot--row' : ''}`}>
      {memberships.length > 1 ? <BusinessSwitcher currentBusinessId={business.id} /> : null}
      <LanguageSelect compact={compact} />
      <button type="button" className="dash__signout" onClick={() => { if (confirmNavigation()) void signOut().catch((e) => toast(t(errorKey(e)), 'danger')); }}><Icon name="logout" size={20} directional /><span>{t('common.signOut')}</span></button>
    </div>
  );
}

/** Phone-only bottom tabs. Tabs the caller cannot use are dropped and the rest stretch. */
function TabBar({ placedCount }: { placedCount: number }) {
  const t = useT();
  const { business, branch, can } = useDash();
  const base = `/business/${business.id}/${branch.id}`;
  const tabs: Array<NavItem & { end?: boolean }> = [
    { to: `${base}/orders`, icon: 'bell', label: t('dash.tab.orders'), count: placedCount },
    { to: `${base}/history`, icon: 'list', label: t('dash.tab.history') },
    { to: `${base}/catalog`, icon: 'basket', label: t('dash.tab.menu'), perm: 'catalog', end: true },
    { to: `${base}/deals`, icon: 'tag', label: t('dash.tab.deals'), perm: 'catalog' },
    { to: `${base}/more`, icon: 'grid', label: t('dash.tab.more') },
  ];
  return (
    <nav className="dash__tabs no-desktop" aria-label={t('nav.business')}>
      {tabs.filter((n) => !n.perm || can(n.perm)).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}>
          <span className="dash__tab-icon"><Icon name={n.icon} size={24} />{n.count ? <span className="dash__tab-count" aria-hidden="true">{n.count}</span> : null}</span>
          <span className="dash__tab-label">{n.label}</span>
          {n.count ? <span className="visually-hidden">{n.count === 1 ? t('dash.newOrder') : t('dash.newOrders', { count: n.count })}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The branch switcher, drawn as a chip (header) or an identity block (sidebar, More page). A native
 * `<select>` covers the whole chip so a tap anywhere opens the platform picker and the accessible
 * combobox keeps its 'Branch' name; the visible text underneath shows the branch and business.
 */
export function BranchChip({ variant }: { variant: 'header' | 'identity' }) {
  const t = useT();
  const { L } = useI18n();
  const { business, branch, branches } = useDash();
  const navigate = useNavigate();
  const location = useLocation();
  const bizName = L(business.name, business.defaultLocale);
  const branchName = L(branch.name, business.defaultLocale);
  // A single branch has nothing to switch to: no chevron, no picker.
  const switchable = branches.length > 1;
  const select = switchable ? (
    <select className="dash__chip-select" value={branch.id} aria-label={t('dash.switchBranch')} onChange={(e) => { const section = location.pathname.split('/').slice(4).join('/') || 'orders'; navigate(`/business/${business.id}/${e.target.value}/${section.startsWith('orders/') ? 'orders' : section}`); }}>
      {branches.map((b) => <option key={b.id} value={b.id}>{L(b.name, business.defaultLocale)}</option>)}
    </select>
  ) : null;
  if (variant === 'header') {
    return (
      <div className="dash__chip">
        <Icon name="building" size={20} />
        <span className="dash__chip-text"><strong className="truncate">{branchName}</strong></span>
        {switchable ? <Icon name="chevronDown" size={18} className="icon dash__chip-chev" /> : null}
        {select}
      </div>
    );
  }
  return (
    <div className={`dash__identity${switchable ? ' dash__identity--switch' : ''}`}>
      <span className="dash__identity-mark" aria-hidden="true">{bizName.trim().charAt(0)}</span>
      {/* Status lives in the header control beside this block; the branch line only when it adds information. */}
      <span className="dash__identity-text">
        <strong className="truncate">{bizName}</strong>
        {branchName.trim() && branchName.trim() !== bizName.trim() ? <span className="truncate muted">{branchName}</span> : null}
      </span>
      {switchable ? <Icon name="chevronDown" size={18} className="icon dash__chip-chev" /> : null}
      {select}
    </div>
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
    if (list.length === 0) return; // no branches: answered synchronously below, no state needed
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
  if (!limited) return all;
  if (!ids) return { data: [], loading: false };
  return docs.key === key ? docs : { data: [], loading: true };
}

/** Select between the caller's businesses (only rendered when there is more than one). */
export function BusinessSwitcher({ currentBusinessId }: { currentBusinessId: string }) {
  const t = useT();
  const { L } = useI18n();
  const { memberships } = useAuth();
  const navigate = useNavigate();
  const ids = memberships.map((m) => m.businessId);
  const businesses = useCollection<Business>(ids.length ? 'businesses' : null, [where('__name__', 'in', ids.slice(0, 10)), limit(10)], [ids.join(',')]);
  if (memberships.length <= 1) return null;
  return (
    <select className="select" value={currentBusinessId} aria-label={t('dash.switchBusiness')} onChange={(e) => { navigate(`/business/${e.target.value}`); }}>
      {businesses.data.map((b) => <option key={b.id} value={b.id}>{L(b.name, b.defaultLocale)}</option>)}
    </select>
  );
}

/**
 * Header status + pause/resume as ONE control: the status word is the button, tinted by tone, and a
 * trailing icon names the action (pause while taking orders, resume while paused). Members without
 * `settings` see the same box as a plain status.
 */
function StatusControl() {
  const t = useT();
  const { business, branch, can } = useDash();
  const status = useBranchStatus();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const change = async () => {
    setBusy(true);
    try { await call('setOrdersPaused', { businessId: business.id, branchId: branch.id, paused: !branch.ordersPaused }); setConfirm(false); toast(t('common.saved')); }
    catch (e) { toast(t(errorKey(e)), 'danger'); }
    finally { setBusy(false); }
  };
  const cls = `dash__status dash__status--${status.tone}`;
  if (!can('settings')) return <span className={cls} role="status"><span className="dash__status-text">{status.short}</span></span>;
  const action = branch.ordersPaused ? t('dash.resumeOrders') : t('dash.pauseOrders');
  return <>
    <button type="button" className={`${cls} dash__status--action`} disabled={busy} aria-busy={busy || undefined} aria-label={`${status.short} · ${action}`} title={action} onClick={() => { if (branch.ordersPaused) void change(); else setConfirm(true); }}>
      <span className="dash__status-text">{status.short}</span>
      {busy ? <Spinner size={18} /> : <Icon name={branch.ordersPaused ? 'refresh' : 'pause'} size={18} className="icon dash__status-icon" />}
    </button>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={change} loading={busy} title={t('owner.pauseConfirm')} body={t('owner.pauseBody')} confirmLabel={t('dash.pauseOrders')} />
  </>;
}

export function PageTitle({ title, back, children }: { title: string; back?: string; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="dash__title">
      {back ? <Link to={back} className="btn--icon dash__back no-desktop" aria-label={t('common.back')}><Icon name="arrowBack" size={22} directional /></Link> : null}
      <h1>{title}</h1>
      <div className="actions">{children}</div>
    </div>
  );
}
