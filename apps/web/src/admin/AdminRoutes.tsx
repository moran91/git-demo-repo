import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router';
import { BRAND } from '@qareeb/shared';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { errorKey } from '@/lib/errors';
import { BrandMark, Icon, type IconName } from '@/design/Icon';
import { EmptyState, IconButton, Skeleton, toast } from '@/design/components';
import { LanguageSelect, OfflineBanner, UpdateBanner } from '@/app/Shell';
import { useAdminCounts } from './lib';
import { OverviewPage } from './OverviewPage';
import { ApprovalsPage, BusinessDetailPage, BusinessesPage } from './BusinessPages';
import { UserDetailPage, UsersPage } from './UserPages';
import { OrdersPage } from './OrdersPage';
import { AuditPage, CitiesPage, ConfigPage } from './PlatformPages';
import { InvitationsPage } from './InvitationsPage';
import { CostsPage } from './CostsPage';
import './admin.css';

type NavItem = { to: string; icon: IconName; label: string; count?: number; end?: boolean };

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const counts = useAdminCounts();
  const sections: Array<{ id: string; label: string; items: NavItem[] }> = [
    { id: 'ops', label: t('admin.nav.operations'), items: [
      { to: '/admin', icon: 'compass', label: t('admin.overview'), end: true },
      { to: '/admin/approvals', icon: 'check', label: t('admin.approvals'), count: counts.approvals },
      { to: '/admin/orders', icon: 'bag', label: t('admin.orders'), count: counts.waitingOrders },
    ] },
    { id: 'accounts', label: t('admin.nav.accounts'), items: [
      { to: '/admin/businesses', icon: 'store', label: t('admin.businesses') },
      { to: '/admin/users', icon: 'users', label: t('admin.users') },
      { to: '/admin/invitations', icon: 'share', label: t('admin.invitations') },
    ] },
    { id: 'platform', label: t('admin.nav.platform'), items: [
      { to: '/admin/cities', icon: 'pin', label: t('admin.cities') },
      { to: '/admin/costs', icon: 'wallet', label: t('admin.costs') },
      { to: '/admin/audit', icon: 'list', label: t('admin.audit') },
      { to: '/admin/config', icon: 'settings', label: t('admin.config') },
    ] },
  ];
  return (
    <nav className="dash__nav" aria-label={t('nav.admin')}>
      {sections.map((sec) => (
        <div key={sec.id} className="dash__nav-group">
          <div className="dash__nav-label">{sec.label}</div>
          {sec.items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate}>
              <Icon name={n.icon} size={20} /><span className="dash__nav-text">{n.label}</span>{n.count ? <span className="dash__count">{n.count > 98 ? '99+' : n.count}</span> : null}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarFoot({ compact }: { compact?: boolean }) {
  const t = useT();
  const { signOut } = useAuth();
  return (
    <div className={`dash__sidebar-foot${compact ? ' dash__sidebar-foot--row' : ''}`}>
      <LanguageSelect />
      <button type="button" className="dash__signout" onClick={() => void signOut().catch((e) => toast(t(errorKey(e)), 'danger'))}><Icon name="logout" size={20} directional /><span>{t('common.signOut')}</span></button>
    </div>
  );
}

function AdminShell() {
  const t = useT();
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
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
  if (loading) return <main className="page"><Skeleton height={200} radius={16} /></main>;
  if (!user) return null;
  if (!isAdmin) return <main className="page"><EmptyState icon="shield" title={t('error.forbidden')} body={t('admin.bootstrapNote')} action={<Link className="btn btn--secondary" to="/">{t('common.goHome')}</Link>} /></main>;
  const brand = (onClick?: () => void) => <Link to="/admin" className="brand" onClick={onClick}><BrandMark size={28} label={t('brand.logoLabel')} /><span className="brand__word">{BRAND.wordmark}</span></Link>;
  return (
    <>
      <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
      <UpdateBanner />
      <div className="dash">
        <aside className="dash__sidebar">
          <div className="dash__sidebar-head">{brand()}</div>
          <AdminNav />
          <SidebarFoot compact />
        </aside>
        {drawer ? (
          <dialog ref={drawerRef} className="dash__sidebar dash__sidebar--drawer" aria-label={t('common.menu')} onCancel={(event) => { event.preventDefault(); setDrawer(false); }}>
            <div className="dash__sidebar-head">{brand(() => setDrawer(false))}<IconButton icon="x" label={t('common.close')} onClick={() => setDrawer(false)} /></div>
            <AdminNav onNavigate={() => setDrawer(false)} />
            <SidebarFoot />
          </dialog>
        ) : null}
        <header className="dash__header">
          <IconButton icon="menu" label={t('common.menu')} className="dash__menu-btn no-desktop" onClick={() => setDrawer(true)} aria-expanded={drawer} aria-haspopup="dialog" />
          <strong>{t('admin.title')}</strong>
        </header>
        <main className="dash__main" id="main" tabIndex={-1}><OfflineBanner /><Outlet /></main>
      </div>
    </>
  );
}

function AdminNotFound() {
  const t = useT();
  return <EmptyState icon="compass" title={t('common.notFound')} action={<Link className="btn btn--secondary" to="/admin">{t('admin.overview')}</Link>} />;
}

export function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="businesses" element={<BusinessesPage />} />
        <Route path="businesses/:businessId" element={<BusinessDetailPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:uid" element={<UserDetailPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="invitations" element={<InvitationsPage />} />
        <Route path="invite" element={<Navigate to="/admin/invitations" replace />} />
        <Route path="cities" element={<CitiesPage />} />
        <Route path="costs" element={<CostsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="*" element={<AdminNotFound />} />
      </Route>
    </Routes>
  );
}
