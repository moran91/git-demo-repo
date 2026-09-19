import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { availableFulfillmentModes, formatPhoneDisplay, minutesToHHMM, type Category, type Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, useDoc, orderBy, where, limit } from '@/lib/queries';
import { Badge, Skeleton, EmptyState, Alert, IconButton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { discoveryStore } from '@/lib/city';
import { cartStore } from '@/lib/cart';
import { money } from '@/lib/format';
import { telHref } from '@/lib/format';
import { ErrorView } from '@/app/Shell';
import { useCity, useCombos, useFavorites, useOpenState, usePromotions, type PublicBranch, type PublicBusiness } from './hooks';
import { StorageImage } from './StorageImage';
import { ProductSheet } from './ProductSheet';
import { PhotoLightbox } from './PhotoLightbox';
import { useHeightVar } from '@/lib/stickyVars';
import { useScrollSpy } from '@/lib/scrollSpy';
import { promotionExpired } from '@/lib/promotions';
import { PromoCard } from './PromoCard';
import { ComboSheet, comboPricing } from './ComboSheet';
import { ComboMedia } from './ComboMedia';
import type { Combo } from '@qareeb/shared';

export type PublicProduct = Product & { inStock: boolean; stockLeft?: number };

export function BusinessPage() {
  const { businessId, branchId } = useParams();
  const t = useT();
  const { L, locale } = useI18n();
  const navigate = useNavigate();
  const prefs = discoveryStore.use();
  const city = useCity(prefs.cityId);
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
  const [photo, setPhoto] = useState<{ path: string; alt: string } | null>(null);
  const [activeCombo, setActiveCombo] = useState<Combo | null>(null);
  const combos = useCombos(branch?.id ?? null);
  const promotionsQ = usePromotions(branch?.id ?? null);
  const cart = cartStore.use();
  // The category nav is sticky under the topbar; publishing its height lets a #cat- anchor jump clear
  // both bars instead of parking the heading behind them.
  const catNavRef = useHeightVar<HTMLElement>('--cat-nav-height');

  const grouped = useMemo(() => {
    const map = new Map<string, PublicProduct[]>();
    for (const p of products.data) {
      if (!map.has(p.categoryId)) map.set(p.categoryId, []);
      map.get(p.categoryId)!.push(p);
    }
    return map;
  }, [products.data]);

  // A category only earns a pill once its products have arrived. Gating on categories.data alone
  // rendered an empty 16px pill bar during the product fetch — a visible flash, and the height that
  // the sticky-chrome measurement latched onto.
  const shownCategories = categories.data.filter((c) => grouped.has(c.id));
  const sectionIds = useMemo(() => shownCategories.map((c) => `cat-${c.id}`), [categories.data, grouped]); // eslint-disable-line react-hooks/exhaustive-deps
  // Scroll-spy: the pill for the section currently under the sticky chrome is highlighted, and
  // the pill row scrolls sideways so that pill stays in view.
  const activeCat = useScrollSpy(sectionIds)?.replace(/^cat-/, '') ?? null;
  const navEl = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = navEl.current;
    if (!nav || !activeCat) return;
    const pill = nav.querySelector<HTMLElement>(`a[href="#cat-${CSS.escape(activeCat)}"]`);
    if (!pill) return;
    const target = pill.offsetLeft - (nav.clientWidth - pill.offsetWidth) / 2;
    nav.scrollTo({ left: target, behavior: 'smooth' });
  }, [activeCat]);

  if (business.loading || branches.loading) {
    return <div className="stack" aria-busy="true"><Skeleton height={0} style={{ aspectRatio: '16/9' }} radius={16} /><Skeleton height={32} width="60%" /><Skeleton height={80} radius={16} /></div>;
  }
  if (!business.data || (!branches.loading && branches.data.length === 0)) return <EmptyState icon="store" title={t('common.notFound')} body={t('checkout.notApproved')} action={<Link className="btn btn--secondary" to="/">{t('common.goHome')}</Link>} />;
  if (!branch) return null;
  if (business.error || products.error) return <ErrorView message={t('common.errorGeneric')} />;

  const biz = business.data;
  const name = L(biz.name, biz.defaultLocale);
  const orderable = open.open && !branch.ordersPaused;
  // Fulfillment is chosen at checkout; here we only need "can this branch serve the city at all" and
  // a sensible default for the cart (kept if the existing cart already has a valid one).
  const modes = availableFulfillmentModes(biz.type, branch, prefs.cityId);
  const modeMismatch = modes.length === 0;
  const cartMode = cart.cart && cart.cart.branchId === branch.id && modes.includes(cart.cart.mode) ? cart.cart.mode : (modes[0] ?? 'pickup');
  const isFav = ids.has(biz.id);
  const promotions = promotionsQ.data.filter((p) => !promotionExpired(p));

  return (
    <div className="stack">
      <header className="biz-header">
        <div className="biz-header__cover">
          <StorageImage path={biz.coverPath} size="display" alt="" wide priority fallbackLabel={t('discovery.imageFallback')} />
        </div>
        <div className="row row--between row--nowrap" style={{ alignItems: 'flex-start' }}>
          <div className="stack--sm stack" style={{ minWidth: 0, flex: '1 1 0' }}>
            <h1 className="wrap-anywhere" lang={biz.defaultLocale}>{name}</h1>
            {biz.description ? <p className="muted wrap-anywhere">{L(biz.description, biz.defaultLocale)}</p> : null}
            <div className="row">
              {branch.ordersPaused ? <Badge tone="accent" icon="clock">{t('common.paused')}</Badge> : open.open ? <Badge tone="success" icon="check">{t('business.openNow')}{open.closesInMin !== undefined ? ` · ${t('discovery.closesAt', { time: minutesToHHMM(new Date().getHours() * 60 + new Date().getMinutes() + open.closesInMin).replace(/^0/, "") })}` : ''}</Badge> : <Badge tone="muted" icon="clock">{t('business.closedNow')}{open.opensInMin !== undefined ? ` · ${t('discovery.opensAt', { time: minutesToHHMM(new Date().getHours() * 60 + new Date().getMinutes() + open.opensInMin).replace(/^0/, "") })}` : ''}</Badge>}
              {L(branch.locationDescription, biz.defaultLocale) ? <span className="muted icon-text"><Icon name="pin" size={16} /> {L(branch.locationDescription, biz.defaultLocale)}</span> : null}
              <a className="biz-phone" href={telHref(branch.phone)} aria-label={`${t('business.callBusiness')} ${formatPhoneDisplay(branch.phone)}`}><span className="biz-phone__icon"><Icon name="phone" size={16} /></span><bdi className="num">{formatPhoneDisplay(branch.phone)}</bdi></a>
            </div>
          </div>
          <IconButton icon="heart" label={isFav ? t('discovery.unfavorite') : t('discovery.favorite')} pressed={isFav} onClick={async () => { if (!signedIn) { navigate('/signin'); return; } await toggle({ id: biz.id, kind: 'business', businessId: biz.id }).catch(() => toast(t('common.errorGeneric'), 'danger')); }} />
        </div>
        {branches.data.length > 1 ? (
          <div className="row">
            <label className="row row--nowrap" style={{ gap: 8 }}>
              <span className="muted">{t('business.branch')}</span>
              <select className="select" style={{ width: 'auto', minHeight: 44 }} value={branch.id} aria-label={t('business.chooseBranch')} onChange={(e) => navigate(`/b/${biz.id}/${e.target.value}`)}>
                {branches.data.map((b) => <option key={b.id} value={b.id}>{L(b.name, biz.defaultLocale)}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        {!orderable ? <Alert tone="warn">{branch.ordersPaused ? t('checkout.paused') : t('business.notOrderable')}</Alert> : null}
        {orderable && modeMismatch ? <Alert tone="info">{t('checkout.noModeAvailable', { city: city.data ? L(city.data.name) : prefs.cityId })} <Link className="btn btn--ghost btn--sm" to="/">{t('discovery.changeCity')}</Link></Alert> : null}
      </header>

      {promotions.length > 0 ? (
        <section className="promo-strip" aria-label={t('promotions.section')}>
          {promotions.map((p) => {
            const featured = (p.productIds ?? []).map((id) => products.data.find((x) => x.id === id)).filter((x): x is PublicProduct => !!x);
            return <PromoCard key={p.id} promotion={p} products={featured} defaultLocale={biz.defaultLocale} onProduct={(fp) => { const full = products.data.find((x) => x.id === fp.id); if (!full) return; if (full.available && orderable && !modeMismatch) setActive(full); else if (full.imagePath) setPhoto({ path: full.imagePath, alt: t('product.photoAlt', { name: L(full.name, biz.defaultLocale) }) }); }} />;
          })}
        </section>
      ) : null}

      {combos.data.filter((c) => c.promoted).length > 0 ? (
        <section aria-labelledby="deals-h" className="stack--sm stack">
          <h2 id="deals-h">{t('deals.title')}</h2>
          <div className="deals">
            {combos.data.filter((c) => c.promoted).map((c) => {
              const pricing = comboPricing(c, products.data);
              const off = !orderable || modeMismatch || !pricing;
              return (
                <button key={c.id} type="button" className={`deal-card card--interactive ${off ? 'deal-card--off' : ''}`} onClick={() => setActiveCombo(c)} aria-label={`${t('deals.combo')}: ${L(c.name, biz.defaultLocale)}`}>
                  <div className="deal-card__media">
                    <ComboMedia combo={c} products={products.data} fallbackLabel={t('discovery.imageFallback')} />
                    {c.imagePath ? null : <span className="deal-card__badge">{t('deals.combo')}</span>}
                  </div>
                  <div className="deal-card__body">
                    <strong className="wrap-anywhere">{L(c.name, biz.defaultLocale)}</strong>
                    <span className="muted wrap-anywhere">{c.items.map((it) => { const p = products.data.find((x) => x.id === it.productId); return p ? `${it.quantity} × ${L(p.name, biz.defaultLocale)}` : null; }).filter(Boolean).join(' + ')}</span>
                    {pricing ? <span className="deal-card__prices"><bdi className="price price--lg">{money(pricing.price, locale)}</bdi></span> : <span className="badge badge--muted">{t('deals.unavailable')}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {shownCategories.length > 0 ? (
        <nav className="cat-nav" ref={(el) => { navEl.current = el; catNavRef(el); }} aria-label={t('business.categories')}>
          {shownCategories.map((c) => (
            <a key={c.id} href={`#cat-${c.id}`} className={activeCat === c.id ? 'active' : ''} aria-current={activeCat === c.id ? 'true' : undefined}>{L(c.name, biz.defaultLocale)}</a>
          ))}
        </nav>
      ) : null}

      {products.loading ? <div className="product-grid" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="product"><Skeleton height={96} width={96} radius={12} /><div className="stack--sm stack"><Skeleton height={18} width="70%" /><Skeleton height={14} width="90%" /><Skeleton height={18} width="30%" /></div></div>)}</div> : null}
      {!products.loading && products.data.length === 0 ? <EmptyState icon="basket" title={t('business.noProducts')} /> : null}
      {shownCategories.map((c) => (
        <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="stack">
          <h2 id={`cat-h-${c.id}`}>{L(c.name, biz.defaultLocale)}</h2>
          <div className="product-grid">
            {grouped.get(c.id)!.map((p) => {
              const unavailable = !p.available || !p.inStock;
              // The unit is appended once by the footer below. Building it in here too printed it
              // twice — `.replace('per ', '')` is a no-op in he/ar, and even in English produced
              // "₪8.90 / kg per kg".
              const priceLabel = p.pricingMode === 'weight' ? money(p.priceAgorot, locale) : p.variants.length ? `${money(Math.min(...p.variants.map((v) => v.priceAgorot)), locale)}+` : money(p.priceAgorot, locale);
              const inCart = cart.cart?.branchId === branch.id ? cart.cart.lines.filter((l) => l.productId === p.id).reduce((n, l) => n + (l.requestedGrams ? 1 : l.quantity), 0) : 0;
              return (
                <article
                  key={p.id}
                  className={`product ${unavailable ? 'product--unavailable' : ''} ${!(unavailable || !orderable || modeMismatch) ? 'product--clickable' : ''}`}
                  onClick={(e) => { if (unavailable || !orderable || modeMismatch) return; if ((e.target as HTMLElement).closest('button, a')) return; setActive(p); }}
                  onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!(unavailable || !orderable || modeMismatch)) setActive(p); } }}
                  tabIndex={!(unavailable || !orderable || modeMismatch) ? 0 : undefined}
                  role={!(unavailable || !orderable || modeMismatch) ? 'button' : undefined}
                  aria-label={!(unavailable || !orderable || modeMismatch) ? L(p.name, biz.defaultLocale) : undefined}
                >
                  <StorageImage path={p.imagePath} alt={t('product.photoAlt', { name: L(p.name, biz.defaultLocale) })} square className="product__img" fallbackLabel={t('discovery.imageFallback')} onClick={() => { if (!(unavailable || !orderable || modeMismatch)) setActive(p); else if (p.imagePath) setPhoto({ path: p.imagePath, alt: t('product.photoAlt', { name: L(p.name, biz.defaultLocale) }) }); }} />
                  <div className="product__body">
                    {p.mostOrdered ? <span className="most-ordered">{t('product.mostOrdered')}</span> : null}
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
                      <button type="button" className="btn--add" disabled={unavailable || !orderable || modeMismatch} onClick={() => setActive(p)} aria-label={`${t('product.addToCart')}: ${L(p.name, biz.defaultLocale)}${inCart > 0 ? ` (${t('product.inCartCount', { count: inCart })})` : ''}`} title={t('product.addToCart')}>
                        <Icon name="plus" size={22} />
                        {inCart > 0 ? <span className="btn--add__count" aria-hidden="true">{inCart}</span> : null}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {active ? <ProductSheet product={active} business={biz} branch={branch} mode={cartMode} cityId={prefs.cityId} onClose={() => setActive(null)} /> : null}
      {photo ? <PhotoLightbox path={photo.path} alt={photo.alt} onClose={() => setPhoto(null)} /> : null}
      {activeCombo ? <ComboSheet combo={activeCombo} products={products.data} business={biz} branch={branch} mode={cartMode} cityId={prefs.cityId} onClose={() => setActiveCombo(null)} /> : null}
    </div>
  );
}
