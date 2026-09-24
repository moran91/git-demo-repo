import type { Locale, Product, Promotion } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Dialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { formatDay } from '@/lib/promotions';
import { DealSlide } from './DealSlide';
import { StorageImage } from './StorageImage';

/**
 * A limited-time promotion opened from the deals carousel: its band, details, and the featured items.
 * An item is a button only when the tap leads somewhere: the product sheet ('add') or its photo ('photo').
 */
export function PromoSheet({ promotion, products, defaultLocale, actionOf, onProduct, onClose }: {
  promotion: Promotion; products: Product[]; defaultLocale: Locale;
  actionOf: (p: Product) => 'add' | 'photo' | null; onProduct: (p: Product) => void; onClose: () => void;
}) {
  const t = useT();
  const { L, locale } = useI18n();
  const title = L(promotion.title, defaultLocale) || t('promotions.promoTitle');
  const body = L(promotion.body, defaultLocale);
  const paths = products.map((p) => p.imagePath).filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  const priceOf = (p: Product) => p.pricingMode === 'weight' ? `${money(p.priceAgorot, locale)} ${t('common.perKg')}`
    : p.variants.length ? `${money(Math.min(...p.variants.map((v) => v.priceAgorot)), locale)}+` : money(p.priceAgorot, locale);
  return (
    <Dialog open onClose={onClose} className="dialog--deal" title={title}>
      <div className="stack">
        <div className="deal-band" aria-hidden="true">
          <DealSlide band tone="promo" kind={<><Icon name="clock" size={13} />{t('promotions.limited')}</>} name={title} lang={defaultLocale}
            pill={promotion.endsAt ? <bdi>{t('promotions.until', { date: formatDay(promotion.endsAt) })}</bdi> : undefined} banner={promotion.imagePath} paths={paths} />
        </div>
        {promotion.endsAt ? <p className="visually-hidden">{t('promotions.until', { date: formatDay(promotion.endsAt) })}</p> : null}
        {body ? <p className="wrap-anywhere">{body}</p> : null}
        {products.length > 0 ? (
          <ul className="deal-lines">
            {products.map((p) => {
              const inner = (
                <>
                  <span className="deal-line__img"><StorageImage path={p.imagePath} alt="" square fallbackLabel={t('discovery.imageFallback')} /></span>
                  <span className="deal-line__text wrap-anywhere" lang={defaultLocale}>{L(p.name, defaultLocale)}<small><bdi>{priceOf(p)}</bdi></small></span>
                </>
              );
              const action = actionOf(p);
              return (
                <li key={p.id}>
                  {action
                    ? <button type="button" className="deal-line deal-line--tap" onClick={() => onProduct(p)}>{inner}{action === 'add' ? <span className="deal-line__add" aria-hidden="true"><Icon name="plus" size={20} /></span> : null}</button>
                    : <span className="deal-line">{inner}</span>}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
