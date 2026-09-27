import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Business } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { EmptyState, Skeleton, Badge, Button, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { errorKey } from '@/lib/errors';
import { LoadError } from './BusinessExperience';
import { LanguageSelect } from '@/app/Shell';
import { useSwitchableBusinesses } from './shell';

/** Entry: lists the caller's businesses (or sends a single-membership user straight in); a platform admin without memberships gets every business. */
export function BusinessHome() {
  const t = useT();
  const { L } = useI18n();
  const { user, memberships, membershipsError, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const { businesses: list, loading: listLoading } = useSwitchableBusinesses();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!loading && !user) navigate('/business/signin', { replace: true });
  }, [loading, user, navigate]);
  useEffect(() => {
    if (memberships.length === 1) navigate(`/business/${memberships[0]!.businessId}`, { replace: true });
  }, [memberships, navigate]);
  if (loading || listLoading) return <main className="page"><Skeleton height={200} radius={16} /></main>;
  if (membershipsError) return <main className="page"><LoadError /></main>;
  if (!user) return null;
  return (
    <main className="page stack home">
      <div className="home__head"><h1>{t('dash.title')}</h1><LanguageSelect compact /></div>
      {isAdmin && memberships.length === 0 ? (
        <section className="stack" aria-label={t('admin.allBusinesses')}>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchBusinesses')} aria-label={t('admin.searchBusinesses')} />
          <BusinessGrid businesses={list.filter((b) => L(b.name, b.defaultLocale).toLowerCase().includes(q.trim().toLowerCase()))} />
        </section>
      ) : memberships.length === 0 ? (
        <EmptyState icon="store" title={t('dash.noBusiness')} action={<div className="home__actions"><Link className="btn btn--primary" to="/business/new">{t('dash.createBusiness')}</Link><Link className="btn btn--ghost" to="/">{t('common.goHome')}</Link></div>} />
      ) : (
        <BusinessGrid businesses={list} />
      )}
      <div className="home__actions">
        {memberships.length > 0 ? <Link className="btn btn--secondary" to="/business/new">{t('dash.createBusiness')}</Link> : null}
        {isAdmin ? <Link className="btn btn--secondary" to="/admin">{t('nav.admin')}</Link> : null}
        <Button variant="ghost" onClick={() => void signOut().catch((err) => toast(t(errorKey(err)), 'danger'))}>{t('common.signOut')}</Button>
      </div>
    </main>
  );
}

function BusinessGrid({ businesses }: { businesses: Business[] }) {
  const t = useT();
  const { L } = useI18n();
  return (
    <ul className="grid-cards">
      {businesses.map((b) => (
        <li key={b.id}>
          <Link to={`/business/${b.id}`} className="card card--interactive home__card">
            <span className="dash__identity-mark" aria-hidden="true">{L(b.name, b.defaultLocale).trim().charAt(0)}</span>
            <span className="home__card-text">
              <strong className="truncate">{L(b.name, b.defaultLocale)}</strong>
              <span className="muted">{b.type === 'restaurant' ? t('common.restaurant') : t('common.supermarket')}</span>
              <Badge tone={b.approval === 'approved' ? 'success' : b.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${b.approval}`)}</Badge>
            </span>
            <Icon name="chevron" size={20} directional className="icon icon--dir home__card-chev" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
