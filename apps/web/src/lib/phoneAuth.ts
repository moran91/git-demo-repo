import { RecaptchaVerifier, signInWithPhoneNumber, type Auth } from 'firebase/auth';

export type SmsStage = 'initializing' | 'loading-check' | 'checking' | 'sending';

export class SmsAuthError extends Error {
  constructor(public readonly stage: SmsStage, public readonly code: string) {
    super(code);
  }
}

/** Only short codes reach logs/support references; never exception messages, tokens or phone data. */
function safeCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    // Firebase also returns numeric delivery errors, e.g. "Error code: 39" becomes
    // auth/error-code:-39. Restricting codes to letters hid the useful provider response.
    if (/^auth\/(?:[a-z-]{1,64}|error-code:-?\d{1,6})$/.test(error.code)) return error.code;
  }
  if (error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)) return error.name;
  return 'unknown';
}

/** Visible verification works without an invisible popup or third-party auth iframe on iPhone. */
export async function sendSmsCode({ auth, phone, container, signal, onStage }: {
  auth: Auth;
  phone: string;
  container: HTMLElement;
  signal: AbortSignal;
  onStage: (stage: SmsStage) => void;
}) {
  let stage: SmsStage = 'initializing';
  let verifier: RecaptchaVerifier | undefined;
  // Each attempt owns its node. A slow script finishing after cancellation cannot overwrite
  // the next attempt's widget or send an SMS for a number the customer has already changed.
  const mount = document.createElement('div');
  container.append(mount);
  let rejectCheck!: (error: SmsAuthError) => void;
  const checkFailure = new Promise<never>((_resolve, reject) => { rejectCheck = reject; });
  void checkFailure.catch(() => undefined);
  const cancel = () => rejectCheck(new SmsAuthError(stage, 'auth/verification-cancelled'));
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const wait = async <T,>(operation: Promise<T>, milliseconds: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        checkFailure,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new SmsAuthError(stage, 'auth/verification-timeout')), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const advance = (next: SmsStage) => { stage = next; onStage(next); };
  try {
    advance('initializing');
    await wait(auth.authStateReady(), 15_000);
    advance('loading-check');
    verifier = new RecaptchaVerifier(auth, mount, {
      size: 'normal',
      'error-callback': () => rejectCheck(new SmsAuthError(stage, 'auth/captcha-check-failed')),
      'expired-callback': () => rejectCheck(new SmsAuthError(stage, 'auth/verification-timeout')),
    });
    await wait(verifier.render(), 20_000);
    advance('checking');
    container.scrollIntoView({ block: 'nearest' });
    // Complete the challenge before starting an SMS request. Cancellation/timeouts only affect
    // this pre-send phase, so retrying cannot race an earlier delivery request.
    const token = await wait(verifier.verify(), 120_000);
    if (signal.aborted) throw new SmsAuthError(stage, 'auth/verification-cancelled');
    verifier.verify = async () => token;
    advance('sending');
    return await signInWithPhoneNumber(auth, phone, verifier);
  } catch (error) {
    throw error instanceof SmsAuthError ? error : new SmsAuthError(stage, safeCode(error));
  } finally {
    signal.removeEventListener('abort', cancel);
    // A widget cleanup exception must never turn a successful SMS request into an error.
    try { verifier?.clear(); } catch { /* The widget may already have been removed by the browser. */ }
    mount.remove();
  }
}
