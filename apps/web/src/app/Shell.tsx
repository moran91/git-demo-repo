import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LOCALES, type Locale } from '@qareeb/shared';
import { LOCALE_NAMES, useI18n, useT } from '@/lib/i18n';
import { Button, EmptyState, Skeleton } from '@/design/components';
import { Icon } from '@/design/Icon';
import { useOnline } from '@/lib/online';
import { applyUpdate, hasUpdate, subscribeNeedRefresh } from '@/lib/sw';
import { useAuth } from '@/lib/auth';
import { call } from '@/lib/api';

/**
 * Language control. Full form: a three-way segmented control (settings pages, the dashboard sidebar).
 * Compact form: a globe pill that opens a small menu — the customer topbar has no room for a select.
 */
export function LanguageSelect({ compact }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  const t = useT();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pick = (l: Locale) => {
    setLocale(l);
    setOpen(false);
    if (user) void call('updateProfile', { locale: l }).catch(() => undefined);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!compact) {
    return (
      <div className="lang-seg" role="radiogroup" aria-label={t('common.language')}>
        {LOCALES.map((l) => (
          <button key={l} type="button" role="radio" lang={l} aria-checked={l === locale} className={`lang-seg__opt ${l === locale ? 'is-active' : ''}`} onClick={() => pick(l)}>{LOCALE_NAMES[l]}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="lang-menu" ref={rootRef}>
      <button type="button" className="lang-menu__btn" aria-haspopup="menu" aria-expanded={open} aria-label={`${t('common.language')}: ${LOCALE_NAMES[locale]}`} onClick={() => setOpen((o) => !o)}>
        <Icon name="globe" size={18} />
        <span className="lang-menu__name" lang={locale}>{LOCALE_NAMES[locale]}</span>
        <Icon name="chevronDown" size={16} className="icon lang-menu__chev" />
      </button>
      {open ? (
        <div className="lang-menu__list" role="menu" aria-label={t('common.language')}>
          {LOCALES.map((l) => (
            <button key={l} type="button" role="menuitemradio" lang={l} aria-checked={l === locale} className={`lang-menu__item ${l === locale ? 'is-active' : ''}`} onClick={() => pick(l)}>
              <span>{LOCALE_NAMES[l]}</span>
              {l === locale ? <Icon name="check" size={18} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const t = useT();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="wifiOff" size={16} /> {t('common.offline')}
    </div>
  );
}

export function UpdateBanner() {
  const t = useT();
  const [show, setShow] = useState(hasUpdate());
  useEffect(() => subscribeNeedRefresh(() => setShow(true)), []);
  if (!show) return null;
  return (
    <div className="update-banner" role="status">
      <span>{t('common.updateAvailable')}</span>
      <Button size="sm" variant="secondary" onClick={() => void applyUpdate()}>{t('common.reload')}</Button>
    </div>
  );
}

export function NotFound() {
  const t = useT();
  return (
    <main className="page">
      <EmptyState icon="compass" title={t('common.notFound')} body={t('common.notFoundBody')} action={<Link className="btn btn--primary" to="/">{t('common.goHome')}</Link>} />
    </main>
  );
}

export function PageFallback() {
  return (
    <main className="page stack" aria-busy="true">
      <Skeleton height={32} width="50%" />
      <Skeleton height={120} radius={16} />
      <Skeleton height={120} radius={16} />
    </main>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return <EmptyState icon="alert" title={message} action={onRetry ? <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button> : undefined} />;
}
