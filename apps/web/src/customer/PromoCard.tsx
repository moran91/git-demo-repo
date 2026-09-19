import type { Locale, Localized, Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Icon } from '@/design/Icon';
import { formatDay } from '@/lib/promotions';
import { StorageImage } from './StorageImage';

export type PromoCardProduct = Pick<Product, 'id' | 'name' | 'imagePath'>;

/**
 * A limited-time promotion as customers see it: optional banner, the "limited time · until" line,
 * headline, details, and the featured items as tappable chips (plain chips without `onProduct`,
 * e.g. in the owner's preview).
 */
export function PromoCard({ promotion, products, defaultLocale, onProduct, className = '' }: {
  promotion: { title: Localized; body: Localized; endsAt?: string; imagePath?: string };
  products: PromoCardProduct[];
  defaultLocale: Locale;
  onProduct?: (product: PromoCardProduct) => void;
  className?: string;
}) {
  const t = useT();
  const { L } = useI18n();
  const body = L(promotion.body, defaultLocale);
  return (
    <article className={`promo ${promotion.imagePath ? 'promo--media' : ''} ${className}`}>
      {promotion.imagePath ? <div className="promo__media"><StorageImage path={promotion.imagePath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} /></div> : null}
      <div className="promo__head">
        <Icon name="clock" size={18} />
        <span className="promo__kicker">{t('promotions.limited')}</span>
        {promotion.endsAt ? <span className="promo__until"><bdi>{t('promotions.until', { date: formatDay(promotion.endsAt) })}</bdi></span> : null}
      </div>
      <h2 className="promo__title wrap-anywhere" lang={defaultLocale}>{L(promotion.title, defaultLocale) || t('promotions.promoTitle')}</h2>
      {body ? <p className="promo__body wrap-anywhere">{body}</p> : null}
      {products.length > 0 ? (
        <div className="promo__items">
          {products.map((p) => {
            const name = L(p.name, defaultLocale);
            const inner = <><StorageImage path={p.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} /><span>{name}</span></>;
            return onProduct
              ? <button key={p.id} type="button" className="promo__item" onClick={() => onProduct(p)}>{inner}</button>
              : <span key={p.id} className="promo__item">{inner}</span>;
          })}
        </div>
      ) : null}
    </article>
  );
}
