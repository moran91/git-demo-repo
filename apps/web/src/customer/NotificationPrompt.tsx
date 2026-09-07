import { useEffect, useState } from 'react';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { Button, Alert } from '@/design/components';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { getRegistration } from '@/lib/sw';

/** Asks for notification permission at a useful moment (right after an order is placed), never on first visit. */
export function NotificationPrompt() {
  const t = useT();
  const { locale } = useI18n();
  const { user } = useAuth();
  const [state, setState] = useState<PushState | 'dismissed' | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (!user || state === null || state === 'granted' || state === 'dismissed' || state === 'unsupported' || state === 'not_configured' || state === 'denied') return null;
  return (
    <Alert tone="info" action={<div className="row" style={{ gap: 4 }}><Button size="sm" variant="ghost" onClick={() => setState('dismissed')}>{t('notif.permissionLater')}</Button><Button size="sm" onClick={async () => setState(await enablePush(user.uid, locale, getRegistration()))}>{t('account.pushEnable')}</Button></div>}>
      {t('notif.permissionPrompt')}
    </Alert>
  );
}
