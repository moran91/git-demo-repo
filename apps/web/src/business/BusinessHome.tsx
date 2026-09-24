import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Business } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { useCollection, where, limit } from '@/lib/queries';
import { EmptyState, Skeleton, Badge, Button, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { errorKey } from '@/lib/errors';
import { LoadError } from './BusinessExperience';
import { LanguageSelect } from '@/app/Shell';

/** Entry: lists the caller's businesses (or sends a single-membership user straight in). */
export function BusinessHome() {
  const t = useT();
  const { L } = useI18n();
  const { user, memberships, membershipsError, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const ids = memberships.map((m) => m.businessId);
  const businesses = useCollection<Business>(ids.length ? 'businesses' : null, [where('__name__', 'in', ids.slice(0, 10)), limit(10)], [ids.join(',')]);
  useEffect(() => {
    if (!loading && !user) navigate('/business/signin', { replace: true });
  }, [loading, user, navigate]);
  useEffect(() => {
    if (memberships.length === 1) navigate(`/business/${memberships[0]!.businessId}`, { replace: true });
  }, [memberships, navigate]);
  if (loading || businesses.loading) return <main className="page"><Skeleton height={200} radius={16} /></main>;
  if (membershipsError || businesses.error) return <main className="page"><LoadError /></main>;
  if (!user) return null;
  return (
    <main className="page stack home">
      <div className="home__head"><h1>{t('dash.title')}</h1><LanguageSelect compact /></div>
      {memberships.length === 0 ? (
        <EmptyState icon="store" title={t('dash.noBusiness')} action={<div className="home__actions"><Link className="btn btn--primary" to="/business/new">{t('dash.createBusiness')}</Link>{isAdmin ? <Link className="btn btn--secondary" to="/admin">{t('nav.admin')}</Link> : null}<Link className="btn btn--ghost" to="/">{t('common.goHome')}</Link></div>} />
      ) : (
        <ul className="grid-cards">
          {businesses.data.map((b) => (
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
      )}
      <div className="home__actions">
        {memberships.length > 0 ? <Link className="btn btn--secondary" to="/business/new">{t('dash.createBusiness')}</Link> : null}
        <Button variant="ghost" onClick={() => void signOut().catch((err) => toast(t(errorKey(err)), 'danger'))}>{t('common.signOut')}</Button>
      </div>
    </main>
  );
}
