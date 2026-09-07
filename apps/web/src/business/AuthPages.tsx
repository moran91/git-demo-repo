import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { useI18n, useT } from '@/lib/i18n';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Button, TextInput, Alert } from '@/design/components';
import { LanguageSelect } from '@/app/Shell';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';

function AuthFrame({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <main className="page stack auth-card">
      <div className="row row--between"><h1>{title}</h1><LanguageSelect compact /></div>
      {body ? <p className="muted">{body}</p> : null}
      {children}
    </main>
  );
}

export function EmailSignInPage() {
  const t = useT();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!loading && user) navigate(user.emailVerified || !user.email ? '/business' : '/business/verify-email', { replace: true });
  }, [user, loading, navigate]);
  return (
    <AuthFrame title={t('auth.emailTitle')} body={t('auth.emailBody')}>
      <form className="card stack" noValidate onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(null); try { await signInWithEmailAndPassword(auth, email.trim(), password); } catch (err) { setError(t(errorKey(err))); } finally { setBusy(false); } }}>
        <TextInput label={t('auth.email')} type="email" required ltr autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label={t('auth.password')} type="password" required ltr autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" block loading={busy}>{t('common.signIn')}</Button>
        <div className="row row--between"><Link to="/business/reset">{t('auth.forgot')}</Link><Link to="/business/register">{t('auth.noAccount')}</Link></div>
      </form>
      <Link to="/" className="btn btn--ghost">{t('common.goHome')}</Link>
    </AuthFrame>
  );
}

export function OwnerRegisterPage() {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame title={t('auth.ownerSignupTitle')} body={t('auth.ownerSignupBody')}>
      <form className="card stack" noValidate onSubmit={async (e) => { e.preventDefault(); setError(null); if (password.length < 8) return setError(t('validation.password')); setBusy(true); try { auth.languageCode = locale; const cred = await createUserWithEmailAndPassword(auth, email.trim(), password); await updateProfile(cred.user, { displayName: name.trim() }); await call('ensureProfile', { displayName: name.trim(), locale }); await sendEmailVerification(cred.user); navigate('/business/verify-email'); } catch (err) { setError(t(errorKey(err))); } finally { setBusy(false); } }}>
        <TextInput label={t('common.name')} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <TextInput label={t('auth.email')} type="email" required ltr autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label={t('auth.password')} type="password" required ltr autoComplete="new-password" hint={t('auth.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" block loading={busy}>{t('auth.createAccount')}</Button>
        <Link to="/business/signin">{t('auth.haveAccount')}</Link>
      </form>
    </AuthFrame>
  );
}

export function ResetPasswordPage() {
  const t = useT();
  const { locale } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame title={t('auth.resetTitle')}>
      <form className="card stack" noValidate onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { auth.languageCode = locale; await sendPasswordResetEmail(auth, email.trim()); } catch { /* do not reveal whether the account exists */ } finally { setSent(true); setBusy(false); } }}>
        <TextInput label={t('auth.email')} type="email" required ltr value={email} onChange={(e) => setEmail(e.target.value)} />
        {sent ? <Alert tone="success">{t('auth.resetSent')}</Alert> : null}
        <Button type="submit" block loading={busy}>{t('auth.sendReset')}</Button>
        <Link to="/business/signin">{t('common.back')}</Link>
      </form>
    </AuthFrame>
  );
}

export function VerifyEmailPage() {
  const t = useT();
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [sentAgain, setSentAgain] = useState(false);
  return (
    <AuthFrame title={t('auth.verifyEmailTitle')} body={t('auth.verifyEmailBody', { email: user?.email ?? '' })}>
      <div className="card stack">
        <Button block loading={busy} onClick={async () => { setBusy(true); await user?.reload(); await user?.getIdToken(true); await refreshProfile(); setBusy(false); if (auth.currentUser?.emailVerified) navigate('/business'); }}>{t('auth.iVerified')}</Button>
        <Button block variant="secondary" disabled={sentAgain} onClick={async () => { if (user) { await sendEmailVerification(user); setSentAgain(true); } }}>{t('auth.resendVerification')}</Button>
        {sentAgain ? <Alert tone="success">{t('auth.resetSent')}</Alert> : null}
      </div>
    </AuthFrame>
  );
}

/** Invitation acceptance: fetch invite → create/sign in with the invited email → verify email → accept. */
export function InviteAcceptPage() {
  const t = useT();
  const { locale, L } = useI18n();
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ email: string; role: string; businessName: Record<string, string> } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<{ email: string; role: string; businessName: Record<string, string> }>('getInvitation', { id, token }).then(setInvite).catch(() => setInvalid(true));
  }, [id, token]);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!auth.currentUser) {
        auth.languageCode = locale;
        if (mode === 'create') {
          const cred = await createUserWithEmailAndPassword(auth, invite!.email, password);
          await updateProfile(cred.user, { displayName: name.trim() });
          await call('ensureProfile', { displayName: name.trim(), locale });
          await sendEmailVerification(cred.user);
        } else {
          await signInWithEmailAndPassword(auth, invite!.email, password);
        }
      }
      await auth.currentUser?.reload();
      if (!auth.currentUser?.emailVerified) {
        try { sessionStorage.setItem('qareeb.pendingInvite', JSON.stringify({ id, token })); } catch { /* ignore */ }
        navigate('/business/verify-email');
        return;
      }
      await auth.currentUser.getIdToken(true);
      const r = await call<{ businessId?: string }>('acceptInvitation', { id, token });
      await refreshProfile();
      navigate(r.businessId ? `/business/${r.businessId}` : '/business/new');
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };
  if (invalid) return <AuthFrame title={t('auth.inviteTitle')}><Alert tone="danger">{t('auth.inviteInvalid')}</Alert></AuthFrame>;
  if (!invite) return <AuthFrame title={t('auth.inviteTitle')}><div className="skeleton" style={{ height: 120 }} /></AuthFrame>;
  return (
    <AuthFrame title={t('auth.inviteTitle')} body={t('auth.inviteBody', { business: L(invite.businessName) || t('brand.name') })}>
      <form className="card stack" noValidate onSubmit={(e) => { e.preventDefault(); void accept(); }}>
        <TextInput label={t('auth.email')} type="email" ltr value={invite.email} readOnly />
        {!user ? (
          <>
            <div className="row"><Button type="button" size="sm" variant={mode === 'create' ? 'primary' : 'secondary'} onClick={() => setMode('create')}>{t('auth.createAccount')}</Button><Button type="button" size="sm" variant={mode === 'signin' ? 'primary' : 'secondary'} onClick={() => setMode('signin')}>{t('common.signIn')}</Button></div>
            {mode === 'create' ? <TextInput label={t('common.name')} required value={name} onChange={(e) => setName(e.target.value)} /> : null}
            <TextInput label={mode === 'create' ? t('auth.setPassword') : t('auth.password')} type="password" required ltr hint={t('auth.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} />
          </>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" block loading={busy}>{t('common.confirm')}</Button>
      </form>
    </AuthFrame>
  );
}
