import { Link } from 'react-router';
import { useI18n, useT } from '@/lib/i18n';
import { Badge, IconButton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { clockIn, money } from '@/lib/format';
import { offersDineIn } from '@qareeb/shared';
import { useFavorites, useOpenState, type PublicBranch } from './hooks';
import { StorageImage } from './StorageImage';
import { useNavigate } from 'react-router';

/** `showType` is off where a filter already names the type; `showBranch` is off where no other branch of the business is listed. */
export function BusinessCard({ branch, cityId, showType = true, showBranch = true }: { branch: PublicBranch; cityId: string; showType?: boolean; showBranch?: boolean }) {
  const t = useT();
  const { L, locale } = useI18n();
  const rule = branch.deliveryCities.find((d) => d.cityId === cityId);
  const name = L(branch.businessName, branch.businessDefaultLocale);
  const branchName = L(branch.name, branch.businessDefaultLocale);
  const open = useOpenState(branch);
  const closed = !open.open || branch.ordersPaused;
  return (
    <article className={`biz-card card--interactive ${closed ? 'biz-card--closed' : ''}`}>
      <div className="biz-card__media">
        <Link to={`/b/${branch.businessId}/${branch.id}`} aria-label={name} tabIndex={-1}>
          <StorageImage path={branch.coverPath} size="thumb" alt="" wide fallbackLabel={t('discovery.imageFallback')} fallbackMark={name} />
        </Link>
        <div className="biz-card__fav">
          <FavoriteButton businessId={branch.businessId} />
        </div>
      </div>
      <div className="biz-card__body">
        <div className="biz-card__title">
          <div style={{ minWidth: 0 }}>
            <h3 className="wrap-anywhere"><Link to={`/b/${branch.businessId}/${branch.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{name}</Link></h3>
            {showBranch && branchName && branchName !== name ? <div className="muted wrap-anywhere">{branchName}</div> : null}
          </div>
          <BranchStatusBadge branch={branch} />
        </div>
        <div className="biz-card__meta">
          {showType ? <span className="icon-text"><Icon name={branch.type === 'restaurant' ? 'utensils' : 'basket'} size={16} /> {branch.type === 'restaurant' ? t('common.restaurant') : t('common.supermarket')}</span> : null}
          {rule ? (
            <>
              <span className="icon-text"><Icon name="truck" size={16} /> {rule.feeAgorot === 0 ? t('discovery.freeDelivery') : t('discovery.deliveryFee', { amount: money(rule.feeAgorot, locale) })}</span>
              {rule.minSubtotalAgorot > 0 ? <span>{t('discovery.minOrder', { amount: money(rule.minSubtotalAgorot, locale) })}</span> : null}
            </>
          ) : null}
          {branch.pickupEnabled ? <span className="icon-text"><Icon name="bag" size={16} /> {t('discovery.pickupAvailable')}</span> : null}
          {offersDineIn(branch.type, branch) ? <span className="icon-text"><Icon name="chair" size={16} /> {t('discovery.dineInAvailable')}</span> : null}
        </div>
      </div>
    </article>
  );
}

/** Heart toggle for a business; sends signed-out visitors to sign in first. */
export function FavoriteButton({ businessId, className }: { businessId: string; className?: string }) {
  const t = useT();
  const { ids, toggle, signedIn } = useFavorites();
  const navigate = useNavigate();
  const isFav = ids.has(businessId);
  return (
    <IconButton
      icon="heart"
      className={className}
      label={isFav ? t('discovery.unfavorite') : t('discovery.favorite')}
      pressed={isFav}
      onClick={async () => {
        if (!signedIn) {
          navigate('/signin', { state: { from: location.pathname } });
          return;
        }
        await toggle({ id: businessId, kind: 'business', businessId }).catch(() => toast(t('common.errorGeneric'), 'danger'));
      }}
    />
  );
}

/** Compact place listing for the home: photo, name, status and delivery fee on one row, heart beside. */
export function PlaceRow({ branch, cityId, showBranch = true }: { branch: PublicBranch; cityId: string; showBranch?: boolean }) {
  const t = useT();
  const { L, locale } = useI18n();
  const open = useOpenState(branch);
  const rule = branch.deliveryCities.find((d) => d.cityId === cityId);
  const name = L(branch.businessName, branch.businessDefaultLocale);
  const branchName = L(branch.name, branch.businessDefaultLocale);
  const closed = !open.open || branch.ordersPaused;
  return (
    <li className={`place-row ${closed ? 'place-row--closed' : ''}`}>
      <Link className="place-row__main" to={`/b/${branch.businessId}/${branch.id}`}>
        <span className="place-row__img">
          <StorageImage path={branch.coverPath ?? branch.logoPath} alt="" square fallbackLabel={t('discovery.imageFallback')} fallbackMark={name} />
        </span>
        <span className="place-row__text">
          <span className="place-row__name wrap-anywhere">{name}{showBranch && branchName && branchName !== name ? <span className="muted"> {branchName}</span> : null}</span>
          <span className="place-row__meta">
            <BranchStatusBadge branch={branch} />
            {rule ? <span>{rule.feeAgorot === 0 ? t('discovery.freeDelivery') : t('discovery.deliveryFee', { amount: money(rule.feeAgorot, locale) })}</span> : null}
          </span>
        </span>
      </Link>
      <FavoriteButton businessId={branch.businessId} className="place-row__fav" />
    </li>
  );
}

/** Paused / open until / opens at, the one status line every place listing shows. */
export function BranchStatusBadge({ branch }: { branch: PublicBranch }) {
  const t = useT();
  const open = useOpenState(branch);
  if (branch.ordersPaused) return <Badge tone="accent" icon="clock">{t('common.paused')}</Badge>;
  if (open.open) return <Badge tone="success" icon="check">{open.closesInMin !== undefined && open.closesInMin < 1440 ? t('discovery.openUntil', { time: clockIn(open.closesInMin) }) : t('common.open')}</Badge>;
  return <Badge tone="muted" icon="clock">{open.opensInMin !== undefined ? t('discovery.opensAt', { time: clockIn(open.opensInMin) }) : t('common.closed')}</Badge>;
}
