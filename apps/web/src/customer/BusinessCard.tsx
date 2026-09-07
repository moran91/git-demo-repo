import { Link } from 'react-router';
import { useI18n, useT } from '@/lib/i18n';
import { Badge, IconButton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { minutesToHHMM } from '@qareeb/shared';
import { useFavorites, useOpenState, type PublicBranch } from './hooks';
import { StorageImage } from './StorageImage';
import { useNavigate } from 'react-router';

export function BusinessCard({ branch, mode, cityId }: { branch: PublicBranch; mode: 'pickup' | 'delivery'; cityId: string }) {
  const t = useT();
  const { L, locale } = useI18n();
  const open = useOpenState(branch);
  const { ids, toggle, signedIn } = useFavorites();
  const navigate = useNavigate();
  const rule = branch.deliveryCities.find((d) => d.cityId === cityId);
  const name = L(branch.businessName, branch.businessDefaultLocale);
  const branchName = L(branch.name, branch.businessDefaultLocale);
  const isFav = ids.has(branch.businessId);
  const closed = !open.open || branch.ordersPaused;
  const closesAt = open.open && open.closesInMin !== undefined ? minutesToHHMM(new Date().getHours() * 60 + new Date().getMinutes() + open.closesInMin) : undefined;
  return (
    <article className={`biz-card card--interactive ${closed ? 'biz-card--closed' : ''}`}>
      <div className="biz-card__media">
        <Link to={`/b/${branch.businessId}/${branch.id}`} aria-label={name} tabIndex={-1}>
          <StorageImage path={branch.coverPath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} />
        </Link>
        <div className="biz-card__fav">
          <IconButton
            icon="heart"
            label={isFav ? t('discovery.unfavorite') : t('discovery.favorite')}
            pressed={isFav}
            onClick={async () => {
              if (!signedIn) {
                navigate('/signin', { state: { from: location.pathname } });
                return;
              }
              await toggle({ id: branch.businessId, kind: 'business', businessId: branch.businessId }).catch(() => toast(t('common.errorGeneric'), 'danger'));
            }}
          />
        </div>
      </div>
      <div className="biz-card__body">
        <div className="biz-card__title">
          <div style={{ minWidth: 0 }}>
            <h3 className="wrap-anywhere"><Link to={`/b/${branch.businessId}/${branch.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{name}</Link></h3>
            {branchName && branchName !== name ? <div className="muted wrap-anywhere">{branchName}</div> : null}
          </div>
          {branch.ordersPaused ? <Badge tone="accent" icon="clock">{t('common.paused')}</Badge> : open.open ? <Badge tone="success" icon="check">{t('common.open')}</Badge> : <Badge tone="muted" icon="clock">{t('common.closed')}</Badge>}
        </div>
        <div className="biz-card__meta">
          <span className="icon-text"><Icon name={branch.type === 'restaurant' ? 'utensils' : 'basket'} size={16} /> {branch.type === 'restaurant' ? t('common.restaurant') : t('common.supermarket')}</span>
          {mode === 'delivery' && rule ? (
            <>
              <span className="icon-text"><Icon name="truck" size={16} /> {rule.feeAgorot === 0 ? t('discovery.freeDelivery') : t('discovery.deliveryFee', { amount: money(rule.feeAgorot, locale) })}</span>
              {rule.minSubtotalAgorot > 0 ? <span>{t('discovery.minOrder', { amount: money(rule.minSubtotalAgorot, locale) })}</span> : null}
            </>
          ) : null}
          {branch.pickupEnabled ? <span className="icon-text"><Icon name="bag" size={16} /> {t('discovery.pickupAvailable')}</span> : null}
          {!open.open && open.opensInMin !== undefined ? <span>{t('discovery.opensAt', { time: minutesToHHMM(new Date().getHours() * 60 + new Date().getMinutes() + open.opensInMin) })}</span> : null}
          {closesAt ? <span>{t('discovery.closesAt', { time: closesAt })}</span> : null}
        </div>
      </div>
    </article>
  );
}
