import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { TasteMerge } from './taste/TasteSheets';
import { BRAND } from '@qareeb/shared';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { cartCount, cartStore } from '@/lib/cart';
import { BrandMark, Icon } from '@/design/Icon';
import { LanguageSelect, OfflineBanner, UpdateBanner } from '@/app/Shell';
import { useCollection, where, limit } from '@/lib/queries';
import { onForegroundMessage } from '@/lib/push';
import { useHeightVar } from '@/lib/stickyVars';
import { toast } from '@/design/components';
import { flyToCart } from '@/lib/flyToCart';
import { CityControl } from './CityControl';

export function CustomerLayout() {
  const t = useT();
  const { user, memberships, isAdmin } = useAuth();
  const cart = cartStore.use();
  const count = cartCount(cart);
  const location = useLocation();
  const unread = useCollection<{ id: string }>(user ? `users/${user.uid}/notifications` : null, [where('read', '==', false), limit(20)], [user?.uid]);
  // Adding to the basket is acknowledged by the cart icon itself (fly-in + bump), not a toast; the
  // hidden live region keeps it audible for screen readers.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const onAdd = () => {
      flyToCart();
      setAnnounce('');
      requestAnimationFrame(() => setAnnounce(`${t('product.addToCart')} ✓`));
    };
    window.addEventListener('qareeb:cart-add', onAdd);
    return () => window.removeEventListener('qareeb:cart-add', onAdd);
  }, [t]);
  useEffect(() => {
    let off = () => undefined as void;
    void onForegroundMessage((title, body, link) => {
      toast(`${title} — ${body}`);
      void link;
    }).then((fn) => (off = fn));
    return () => off();
  }, []);

  const topbarRef = useHeightVar<HTMLElement>('--topbar-height');
  // The town only matters where it changes what is listed or orderable: home and a business page.
  const showCity = location.pathname === '/' || location.pathname.startsWith('/b/');
  return (
    <>
      <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
      <UpdateBanner />
      <header className="topbar" ref={topbarRef}>
        <div className="topbar__inner">
          <Link to="/" className="brand">
            <BrandMark size={32} label={t('brand.logoLabel')} />
            <span className="brand__word">{BRAND.wordmark}</span>
          </Link>
          {showCity ? <CityControl /> : null}
          <nav className="topbar__nav" aria-label={t('nav.mainNavigation')}>
            <NavLink to="/" end><Icon name="compass" size={18} /> {t('nav.explore')}</NavLink>
            <NavLink to="/favorites"><Icon name="heart" size={18} /> {t('nav.favorites')}</NavLink>
            <NavLink to="/cart"><span className="cart-icon" data-cart-target><Icon name="cart" size={18} /></span> {t('nav.cart')}{count > 0 ? ` (${count})` : ''}</NavLink>
            <NavLink to="/account"><Icon name="user" size={18} /> {t('nav.account')}{unread.data.length ? ` (${unread.data.length})` : ''}</NavLink>
            {memberships.length > 0 ? <NavLink to="/business"><Icon name="store" size={18} /> {t('nav.business')}</NavLink> : null}
            {isAdmin ? <NavLink to="/admin"><Icon name="shield" size={18} /> {t('nav.admin')}</NavLink> : null}
          </nav>
          <LanguageSelect />
        </div>
        <OfflineBanner />
      </header>
      <main id="main" className="page page--customer">
        <Outlet />
        <TasteMerge />
      </main>
      <span className="visually-hidden" aria-live="polite">{announce}</span>
      <nav className="bottom-nav" aria-label={t('nav.mainNavigation')}>
        <NavLink to="/" end><Icon name="compass" /> <span>{t('nav.explore')}</span></NavLink>
        <NavLink to="/favorites"><Icon name="heart" /> <span>{t('nav.favorites')}</span></NavLink>
        <NavLink to="/cart" className={count > 0 ? 'has-items' : undefined} aria-label={count > 0 ? `${t('nav.cart')} (${count})` : undefined}><span className="cart-icon" data-cart-target><Icon name="cart" /></span> <span>{t('nav.cart')}</span>{count > 0 ? <span key={count} className="bottom-nav__count" aria-hidden="true">{count}</span> : null}</NavLink>
        <NavLink to="/account"><Icon name="user" /> <span>{t('nav.account')}</span>{unread.data.length ? <span className="bottom-nav__count" aria-hidden="true">{unread.data.length}</span> : null}</NavLink>
      </nav>
    </>
  );
}
