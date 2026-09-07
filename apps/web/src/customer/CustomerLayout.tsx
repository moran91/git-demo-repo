import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { BRAND } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { cartCount, cartStore } from '@/lib/cart';
import { BrandMark, Icon } from '@/design/Icon';
import { LanguageSelect, OfflineBanner, UpdateBanner } from '@/app/Shell';
import { money } from '@/lib/format';
import { useCollection, where, limit } from '@/lib/queries';
import { onForegroundMessage } from '@/lib/push';
import { toast } from '@/design/components';

export function CustomerLayout() {
  const t = useT();
  const { locale } = useI18n();
  const { user, memberships, isAdmin } = useAuth();
  const cart = cartStore.use();
  const count = cartCount(cart);
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useCollection<{ id: string }>(user ? `users/${user.uid}/notifications` : null, [where('read', '==', false), limit(20)], [user?.uid]);
  const [cartTotal, setCartTotal] = useState<number | null>(null);
  useEffect(() => {
    // The cart bar shows the last server-quoted total (kept in session by the cart page/checkout).
    const read = () => {
      try {
        const v = sessionStorage.getItem('qareeb.cart.quotedTotal');
        setCartTotal(v ? Number(v) : null);
      } catch {
        setCartTotal(null);
      }
    };
    read();
    window.addEventListener('qareeb:cart-quote', read);
    return () => window.removeEventListener('qareeb:cart-quote', read);
  }, [cart]);
  useEffect(() => {
    let off = () => undefined as void;
    void onForegroundMessage((title, body, link) => {
      toast(`${title} — ${body}`);
      void link;
    }).then((fn) => (off = fn));
    return () => off();
  }, []);

  const hideCartBar = location.pathname.startsWith('/cart') || location.pathname.startsWith('/checkout') || location.pathname.startsWith('/signin');
  return (
    <>
      <a className="skip-link" href="#main">{t('common.skipToContent')}</a>
      <UpdateBanner />
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="brand">
            <BrandMark size={32} label={t('brand.logoLabel')} />
            <span className="brand__word">{BRAND.wordmark}</span>
          </Link>
          <nav className="topbar__nav" aria-label={t('nav.mainNavigation')}>
            <NavLink to="/" end><Icon name="compass" size={18} /> {t('nav.explore')}</NavLink>
            <NavLink to="/favorites"><Icon name="heart" size={18} /> {t('nav.favorites')}</NavLink>
            <NavLink to="/cart"><Icon name="cart" size={18} /> {t('nav.cart')}{count > 0 ? ` (${count})` : ''}</NavLink>
            <NavLink to="/account"><Icon name="user" size={18} /> {t('nav.account')}{unread.data.length ? ` (${unread.data.length})` : ''}</NavLink>
            {memberships.length > 0 ? <NavLink to="/business"><Icon name="store" size={18} /> {t('nav.business')}</NavLink> : null}
            {isAdmin ? <NavLink to="/admin"><Icon name="shield" size={18} /> {t('nav.admin')}</NavLink> : null}
          </nav>
          <LanguageSelect compact />
        </div>
        <OfflineBanner />
      </header>
      <main id="main" className="page page--customer">
        <Outlet />
      </main>
      {count > 0 && !hideCartBar ? (
        <div className="cart-bar">
          <button type="button" className="btn btn--primary" onClick={() => navigate('/cart')} aria-label={t('cart.summaryAria', { count, total: cartTotal !== null ? money(cartTotal, locale) : '' })}>
            <span className="icon-text"><Icon name="cart" size={18} /> {t('cart.viewCart')} · {count === 1 ? t('cart.item') : t('cart.items', { count })}</span>
            {cartTotal !== null ? <bdi className="price">{money(cartTotal, locale)}</bdi> : null}
          </button>
        </div>
      ) : null}
      <nav className="bottom-nav" aria-label={t('nav.mainNavigation')}>
        <NavLink to="/" end><Icon name="compass" /> <span>{t('nav.explore')}</span></NavLink>
        <NavLink to="/favorites"><Icon name="heart" /> <span>{t('nav.favorites')}</span></NavLink>
        <NavLink to="/cart"><Icon name="cart" /> <span>{t('nav.cart')}</span>{count > 0 ? <span className="bottom-nav__count" aria-hidden="true">{count}</span> : null}</NavLink>
        <NavLink to="/account"><Icon name="user" /> <span>{t('nav.account')}</span>{unread.data.length ? <span className="bottom-nav__count" aria-hidden="true">{unread.data.length}</span> : null}</NavLink>
      </nav>
    </>
  );
}
