import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { LOCALES, type Locale } from '@qareeb/shared';
import { LOCALE_NAMES, useI18n, useT } from '@/lib/i18n';
import { Button, EmptyState, Skeleton } from '@/design/components';
import { Icon } from '@/design/Icon';
import { useOnline } from '@/lib/online';
import { applyUpdate, hasUpdate, subscribeNeedRefresh } from '@/lib/sw';
import { useAuth } from '@/lib/auth';
import { call } from '@/lib/api';

export function LanguageSelect({ compact }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  const t = useT();
  const { user } = useAuth();
  return (
    <label className="row row--nowrap" style={{ gap: 6 }}>
      <Icon name="globe" size={18} />
      <span className={compact ? 'visually-hidden' : 'muted'}>{t('common.language')}</span>
      <select
        className="lang-select"
        value={locale}
        aria-label={t('common.language')}
        onChange={(e) => {
          const l = e.target.value as Locale;
          setLocale(l);
          if (user) void call('updateProfile', { locale: l }).catch(() => undefined);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </label>
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
