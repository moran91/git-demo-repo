import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { signInWithCustomToken, type ConfirmationResult } from 'firebase/auth';
import { normalizeIsraeliPhone, formatPhoneDisplay, normalizeDigits } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Button, TextInput, Checkbox, Alert } from '@/design/components';
import { call, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { sendSmsCode, SmsAuthError, type SmsStage } from '@/lib/phoneAuth';

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
  const [errorReference, setErrorReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const confirmRef = useRef<ConfirmationResult | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const [smsStage, setSmsStage] = useState<SmsStage | null>(null);
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
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // The channel is passed in, never read from state: setChannel(...) followed by send() in the same
  // handler still saw the previous value, so "Send on WhatsApp" sent an SMS (and vice versa).
  const send = async (ch: 'sms' | 'whatsapp' = channel) => {
    if (sendingRef.current) return;
    setError(null);
    setErrorReference(null);
    if (!e164) return setError(t('auth.phoneInvalid'));
    if (!consent) return setError(t('auth.consentRequired'));
    sendingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    // Dismiss the iPhone keyboard before a verification challenge opens.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    try {
      if (ch === 'whatsapp') {
        const r = await call<{ challengeId: string }>('whatsappStart', { phone: e164, locale, consent: true });
        setChallengeId(r.challengeId);
      } else {
        auth.languageCode = locale;
        const container = captchaContainerRef.current;
        if (!container) return;
        confirmRef.current = await sendSmsCode({ auth, phone: e164, container, signal: controller.signal, onStage: (stage) => {
          if (!controller.signal.aborted) setSmsStage(stage);
        } });
      }
      if (!captchaContainerRef.current) return;
      setChannel(ch);
      setStep('code');
      setCooldown(30);
    } catch (e) {
      if (controller.signal.aborted) return;
      // Record only the error code: phone numbers, SMS codes and tokens must stay out of logs.
      if (e instanceof SmsAuthError) {
        if (e.code === 'auth/verification-cancelled') return;
        const reference = `${e.stage}/${e.code.replace(/^auth\//, '')}`;
        console.warn('[phone-auth] send failed', reference);
        setErrorReference(reference);
        if (e.code === 'auth/verification-timeout') setError(t(e.stage === 'checking' ? 'auth.verificationExpired' : 'auth.verificationUnavailable'));
        else if (e.stage !== 'sending') setError(t('auth.verificationUnavailable'));
        else {
          const key = errorKey(e);
          setError(t(key === 'common.errorGeneric' ? 'auth.smsFailed' : key));
        }
        return;
      }
      if (e instanceof ApiError && e.code === 'not_configured') setError(t('auth.whatsappUnavailable'));
      else setError(t(errorKey(e)));
    } finally {
      abortRef.current = null;
      setSmsStage(null);
      sendingRef.current = false;
      setBusy(false);
    }
  };
  const verify = async () => {
    setError(null);
    setErrorReference(null);
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
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void send('sms'); }}>
          <p className="muted">{t('auth.phoneBody')}</p>
          <TextInput label={t('auth.phone')} required disabled={busy} type="tel" inputMode="tel" autoComplete="tel" ltr value={phone} onChange={(e) => setPhone(e.target.value)} hint={t('auth.phoneHint')} error={phone && !e164 ? t('auth.phoneInvalid') : undefined} />
          <Checkbox label={t('auth.consent')} disabled={busy} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          {error ? <Alert tone="danger"><div>{error}</div>{errorReference ? <small>{t('auth.errorReference', { reference: errorReference })}</small> : null}</Alert> : null}
          <Button type="submit" block loading={busy} onClick={() => setChannel('sms')}>{t('auth.sendCode')}</Button>
          {whatsappAvailable ? <Button type="button" block variant="secondary" loading={busy} onClick={() => { setChannel('whatsapp'); void send('whatsapp'); }}>{t('auth.sendWhatsapp')}</Button> : null}
        </form>
      ) : (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <h2>{t('auth.codeTitle')}</h2>
          <p className="muted">{t('auth.codeBody', { phone: formatPhoneDisplay(e164 ?? phone) })}</p>
          <TextInput label={t('auth.code')} required inputMode="numeric" autoComplete="one-time-code" className="input otp-input" value={code} onChange={(e) => setCode(normalizeDigits(e.target.value).replace(/\D/g, '').slice(0, 8))} />
          {error ? <Alert tone="danger"><div>{error}</div>{errorReference ? <small>{t('auth.errorReference', { reference: errorReference })}</small> : null}</Alert> : null}
          <Button type="submit" block loading={busy} disabled={code.length < 4}>{t('auth.verify')}</Button>
          <div className="row row--between">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => { confirmRef.current = null; setStep('phone'); setCode(''); setError(null); setErrorReference(null); }}>{t('auth.changeNumber')}</Button>
            <Button type="button" variant="ghost" disabled={cooldown > 0 || busy} onClick={() => void send()}>{cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}</Button>
          </div>
        </form>
      )}
      {smsStage ? <p className="muted" role="status">{t(smsStage === 'checking' ? 'auth.completeCaptcha' : smsStage === 'sending' ? 'auth.sendingCode' : 'auth.loadingVerification')}</p> : null}
      {/* Keep the same DOM node through phone/code transitions and SMS resends. */}
      <div ref={captchaContainerRef} id="recaptcha-container" />
      {smsStage && smsStage !== 'sending' ? <Button variant="ghost" onClick={() => abortRef.current?.abort()}>{t('auth.cancelVerification')}</Button> : null}
    </div>
  );
}
