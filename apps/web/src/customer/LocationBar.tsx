import { useI18n, useT } from '@/lib/i18n';
import { Icon } from '@/design/Icon';
import { Button } from '@/design/components';

/** Which enable-steps to show when the OS/browser has hard-blocked the prompt. */
export function locationPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export interface DeviceLocation { busy: boolean; blocked: boolean; error: string | null; detect: () => Promise<boolean | null> }

/** Shown inside the town picker after a failed lookup: what went wrong, and the way back in. */
export function LocationTrouble({ location, onRetry }: { location: DeviceLocation; onRetry: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  if (!location.error) return null;
  const platform = locationPlatform();
  return (
    <div className="loctrouble" role="status" lang={locale}>
      <Icon name="alert" size={18} />
      <div className="stack stack--sm" style={{ flex: 1 }}>
        <span>{location.error}</span>
        {location.blocked ? (
          <div className="loctrouble__steps">
            <strong>{t('location.enableTitle')}</strong>
            <span>{t('location.enableIntro')}</span>
            <span>{t(platform === 'ios' ? 'location.steps.ios' : platform === 'android' ? 'location.steps.android' : 'location.steps.desktop')}</span>
          </div>
        ) : null}
        <div className="row"><Button variant="secondary" size="sm" icon="refresh" loading={location.busy} onClick={onRetry}>{t('location.tryAgain')}</Button></div>
      </div>
    </div>
  );
}
