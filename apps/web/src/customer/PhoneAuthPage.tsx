import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RecaptchaVerifier, signInWithPhoneNumber, signInWithCustomToken, type ConfirmationResult } from 'firebase/auth';
import { normalizeIsraeliPhone, formatPhoneDisplay } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Button, TextInput, Checkbox, Alert } from '@/design/components';
import { call, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/errors';

/**
 * Phone sign-in. SMS through Firebase Authentication (reCAPTCHA, resend cooldown, expiry handling);
 * WhatsApp through the optional server-side Twilio Verify integration (shown only when configured).
 * The cart and checkout form live in local/session storage, so they survive this round-trip.
 */
export function PhoneAuthPage() {
  const t = useT();
  const { locale } = useI18n();
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/account';
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const confirmRef = useRef<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const e164 = normalizeIsraeliPhone(phone);

  useEffect(() => {
    call<{ whatsapp: boolean }>('authOptions').then((r) => setWhatsappAvailable(r.whatsapp)).catch(() => setWhatsappAvailable(false));
  }, []);
  useEffect(() => {
    if (user && profile?.phoneVerified) navigate(from, { replace: true });
  }, [user, profile, from, navigate]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
  useEffect(() => () => verifierRef.current?.clear(), []);

  const send = async () => {
    setError(null);
    if (!e164) return setError(t('auth.phoneInvalid'));
    if (!consent) return setError(t('auth.consentRequired'));
    setBusy(true);
    try {
      if (channel === 'whatsapp') {
        const r = await call<{ challengeId: string }>('whatsappStart', { phone: e164, locale, consent: true });
        setChallengeId(r.challengeId);
      } else {
        auth.languageCode = locale;
        if (!verifierRef.current) verifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
        confirmRef.current = await signInWithPhoneNumber(auth, e164, verifierRef.current);
      }
      setStep('code');
      setCooldown(30);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_configured') setError(t('auth.whatsappUnavailable'));
      else setError(t(errorKey(e)));
      verifierRef.current?.clear();
      verifierRef.current = null;
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      if (channel === 'whatsapp' && challengeId) {
        const r = await call<{ customToken: string }>('whatsappCheck', { challengeId, code });
        await signInWithCustomToken(auth, r.customToken);
      } else if (confirmRef.current) {
        await confirmRef.current.confirm(code);
      }
      await refreshProfile();
      navigate(from, { replace: true });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack auth-card">
      <h1>{t('auth.phoneTitle')}</h1>
      {step === 'phone' ? (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <p className="muted">{t('auth.phoneBody')}</p>
          <TextInput label={t('auth.phone')} required type="tel" inputMode="tel" autoComplete="tel" ltr value={phone} onChange={(e) => setPhone(e.target.value)} hint={t('auth.phoneHint')} error={phone && !e164 ? t('auth.phoneInvalid') : undefined} />
          <Checkbox label={t('auth.consent')} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" block loading={busy} onClick={() => setChannel('sms')}>{t('auth.sendCode')}</Button>
          {whatsappAvailable ? <Button type="button" block variant="secondary" loading={busy} onClick={() => { setChannel('whatsapp'); void send(); }}>{t('auth.sendWhatsapp')}</Button> : null}
          <div id="recaptcha-container" />
        </form>
      ) : (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <h2>{t('auth.codeTitle')}</h2>
          <p className="muted">{t('auth.codeBody', { phone: formatPhoneDisplay(e164 ?? phone) })}</p>
          <TextInput label={t('auth.code')} required inputMode="numeric" autoComplete="one-time-code" className="input otp-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" block loading={busy} disabled={code.length < 4}>{t('auth.verify')}</Button>
          <div className="row row--between">
            <Button type="button" variant="ghost" onClick={() => { setStep('phone'); setCode(''); setError(null); }}>{t('auth.changeNumber')}</Button>
            <Button type="button" variant="ghost" disabled={cooldown > 0 || busy} onClick={() => void send()}>{cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}</Button>
          </div>
          <div id="recaptcha-container" />
        </form>
      )}
    </div>
  );
}
