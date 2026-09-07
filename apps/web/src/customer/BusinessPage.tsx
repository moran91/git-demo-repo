import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { formatPhoneDisplay, minutesToHHMM, type Category, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, useDoc, orderBy, where, limit } from '@/lib/queries';
import { Badge, Button, Skeleton, EmptyState, Alert, IconButton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { discoveryStore } from '@/lib/city';
import { cartStore } from '@/lib/cart';
import { money } from '@/lib/format';
import { telHref } from '@/lib/format';
import { ErrorView } from '@/app/Shell';
import { useFavorites, useOpenState, type PublicBranch, type PublicBusiness } from './hooks';
import { StorageImage } from './StorageImage';
import { ProductSheet } from './ProductSheet';

export type PublicProduct = Product & { inStock: boolean; stockLeft?: number };

export function BusinessPage() {
  const { businessId, branchId } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const navigate = useNavigate();
  const prefs = discoveryStore.use();
  const business = useDoc<PublicBusiness>(businessId ? `publicBusinesses/${businessId}` : null);
  const branches = useCollection<PublicBranch>('publicBranches', [where('businessId', '==', businessId ?? '_'), where('visible', '==', true), limit(30)], [businessId]);
  const branch = branches.data.find((b) => b.id === branchId) ?? null;
  useEffect(() => {
    if (!branchId && branches.data.length > 0 && businessId) navigate(`/b/${businessId}/${branches.data[0]!.id}`, { replace: true });
  }, [branchId, branches.data, businessId, navigate]);
  const categories = useCollection<Category>(branch ? `publicBranches/${branch.id}/categories` : null, [orderBy('sortOrder'), limit(100)], [branch?.id]);
  const products = useCollection<PublicProduct>(branch ? `publicBranches/${branch.id}/products` : null, [orderBy('sortOrder'), limit(500)], [branch?.id]);
  const open = useOpenState(branch);
  const { ids, toggle, signedIn } = useFavorites();
  const [active, setActive] = useState<PublicProduct | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const cart = cartStore.use();

  const grouped = useMemo(() => {
    const map = new Map<string, PublicProduct[]>();
    for (const p of products.data) {
      if (!map.has(p.categoryId)) map.set(p.categoryId, []);
      map.get(p.categoryId)!.push(p);
    }
    return map;
  }, [products.data]);

  if (business.loading || branches.loading) {
    return <div className="stack" aria-busy="true"><Skeleton height={0} style={{ aspectRatio: '16/9' }} radius={16} /><Skeleton height={32} width="60%" /><Skeleton height={80} radius={16} /></div>;
  }
  if (!business.data || (!branches.loading && branches.data.length === 0)) return <EmptyState icon="store" title={t('common.notFound')} body={t('checkout.notApproved')} action={<Link className="btn btn--secondary" to="/">{t('common.goHome')}</Link>} />;
  if (!branch) return null;
  if (business.error || products.error) return <ErrorView message={t('common.errorGeneric')} />;

  const biz = business.data;
  const name = L(biz.name, biz.defaultLocale);
  const orderable = open.open && !branch.ordersPaused;
  const deliveryRule = branch.deliveryCities.find((d) => d.cityId === prefs.cityId);
  const modeMismatch = prefs.mode === 'delivery' ? !deliveryRule : branch.cityId !== prefs.cityId || !branch.pickupEnabled;
  const isFav = ids.has(biz.id);

  return (
    <div className="stack">
      <header className="biz-header">
        <div className="biz-header__cover">
          <StorageImage path={biz.coverPath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} />
        </div>
        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
          <div className="stack--sm stack" style={{ minWidth: 0 }}>
            <h1 className="wrap-anywhere" lang={biz.defaultLocale}>{name}</h1>
            {biz.description ? <p className="muted wrap-anywhere">{L(biz.description, biz.defaultLocale)}</p> : null}
            <div className="row">
              {branch.ordersPaused ? <Badge tone="accent" icon="clock">{t('common.paused')}</Badge> : open.open ? <Badge tone="success" icon="check">{t('business.openNow')}{open.closesInMin !== undefined ? ` · ${t('discovery.closesAt', { time: minutesToHHMM(new Date().getHours() * 60 + new Date().getMinutes() + open.closesInMin) })}` : ''}</Badge> : <Badge tone="muted" icon="clock">{t('business.closedNow')}{open.opensInMin !== undefined ? ` · ${t('discovery.opensAt', { time: minutesToHHMM(new Date().getHours() * 60 + new Date().getMinutes() + open.opensInMin) })}` : ''}</Badge>}
              <span className="muted icon-text"><Icon name="pin" size={16} /> {L(branch.locationDescription, biz.defaultLocale)}</span>
            </div>
          </div>
          <IconButton icon="heart" label={isFav ? t('discovery.unfavorite') : t('discovery.favorite')} pressed={isFav} onClick={async () => { if (!signedIn) { navigate('/signin'); return; } await toggle({ id: biz.id, kind: 'business', businessId: biz.id }).catch(() => toast(t('common.errorGeneric'), 'danger')); }} />
        </div>
        <div className="row">
          <a className="btn btn--secondary" href={telHref(branch.phone)}><Icon name="phone" size={18} /> {t('business.callBusiness')} <bdi className="num">{formatPhoneDisplay(branch.phone)}</bdi></a>
          {branches.data.length > 1 ? (
            <label className="row row--nowrap" style={{ gap: 8 }}>
              <span className="muted">{t('business.branch')}</span>
              <select className="select" style={{ width: 'auto', minHeight: 44 }} value={branch.id} aria-label={t('business.chooseBranch')} onChange={(e) => navigate(`/b/${biz.id}/${e.target.value}`)}>
                {branches.data.map((b) => <option key={b.id} value={b.id}>{L(b.name, biz.defaultLocale)}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {!orderable ? <Alert tone="warn">{branch.ordersPaused ? t('checkout.paused') : t('business.notOrderable')}</Alert> : null}
        {orderable && modeMismatch ? <Alert tone="info">{prefs.mode === 'delivery' ? t('business.noDeliveryToCity', { city: L((prefs as unknown as { cityName?: Record<string, string> }).cityName ?? {}) || prefs.cityId }) : t('checkout.pickupUnavailable')} <Button size="sm" variant="ghost" onClick={() => discoveryStore.set({ mode: prefs.mode === 'delivery' ? 'pickup' : 'delivery' })}>{t('checkout.changeMode')}</Button></Alert> : null}
      </header>

      {categories.data.length > 0 ? (
        <nav className="cat-nav" aria-label={t('business.categories')}>
          {categories.data.filter((c) => grouped.has(c.id)).map((c) => (
            <a key={c.id} href={`#cat-${c.id}`} className={activeCat === c.id ? 'active' : ''} onClick={() => setActiveCat(c.id)}>{L(c.name, biz.defaultLocale)}</a>
          ))}
        </nav>
      ) : null}

      {products.loading ? <div className="product-grid" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="product"><Skeleton height={96} width={96} radius={12} /><div className="stack--sm stack"><Skeleton height={18} width="70%" /><Skeleton height={14} width="90%" /><Skeleton height={18} width="30%" /></div></div>)}</div> : null}
      {!products.loading && products.data.length === 0 ? <EmptyState icon="basket" title={t('business.noProducts')} /> : null}
      {categories.data.filter((c) => grouped.has(c.id)).map((c) => (
        <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="stack">
          <h2 id={`cat-h-${c.id}`}>{L(c.name, biz.defaultLocale)}</h2>
          <div className="product-grid">
            {grouped.get(c.id)!.map((p) => {
              const unavailable = !p.available || !p.inStock;
              const priceLabel = p.pricingMode === 'weight' ? `${money(p.priceAgorot, locale)} / ${t('common.perKg').replace('per ', '')}` : p.variants.length ? `${money(Math.min(...p.variants.map((v) => v.priceAgorot)), locale)}+` : money(p.priceAgorot, locale);
              const inCart = cart.cart?.branchId === branch.id ? cart.cart.lines.filter((l) => l.productId === p.id).reduce((n, l) => n + (l.requestedGrams ? 1 : l.quantity), 0) : 0;
              return (
                <article key={p.id} className={`product ${unavailable ? 'product--unavailable' : ''}`}>
                  <StorageImage path={p.imagePath} alt={t('product.photoAlt', { name: L(p.name, biz.defaultLocale) })} square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
                  <div className="product__body">
                    <h3 className="wrap-anywhere">{L(p.name, biz.defaultLocale)}</h3>
                    {L(p.description, biz.defaultLocale) ? <p className="muted wrap-anywhere">{L(p.description, biz.defaultLocale)}</p> : null}
                    <div className="row" style={{ gap: 6 }}>
                      {p.brand ? <span className="badge badge--muted">{p.brand}</span> : null}
                      {p.packageSize ? <span className="badge badge--muted">{p.packageSize}</span> : null}
                      {p.pricingMode === 'weight' ? <span className="badge badge--neutral"><Icon name="scale" size={12} /> {t('common.weight')}</span> : null}
                      {p.trackInventory && p.inStock && p.stockLeft !== undefined && p.stockLeft <= 5 ? <span className="badge badge--accent">{t('business.lowStock', { count: p.stockLeft })}</span> : null}
                      {unavailable ? <span className="badge badge--danger">{p.inStock ? t('common.unavailable') : t('business.outOfStock')}</span> : null}
                    </div>
                    <div className="product__footer">
                      <span className="price"><bdi>{priceLabel}</bdi>{p.pricingMode === 'weight' ? <span className="muted"> {t('common.perKg')}</span> : null}</span>
                      <Button size="sm" variant={inCart > 0 ? 'secondary' : 'primary'} icon="plus" disabled={unavailable || !orderable || modeMismatch} onClick={() => setActive(p)} aria-label={`${t('product.addToCart')}: ${L(p.name, biz.defaultLocale)}`}>
                        {inCart > 0 ? `${t('product.addToCart')} (${inCart})` : t('product.addToCart')}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {active ? <ProductSheet product={active} business={biz} branch={branch} mode={prefs.mode} cityId={prefs.cityId} onClose={() => setActive(null)} /> : null}
    </div>
  );
}
