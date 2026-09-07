import type { TranslationKey } from '@qareeb/shared';
import { ApiError } from './api';

/** Maps an ApiError to a translated message key. Never shows raw codes. */
export function errorKey(e: unknown): TranslationKey {
  if (e instanceof ApiError) {
    if (e.code === 'network') return 'error.network';
    return `error.${e.code}` as TranslationKey;
  }
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    const code = (e as { code: string }).code;
    if (code.startsWith('auth/')) {
      if (code === 'auth/invalid-verification-code') return 'auth.codeInvalid';
      if (code === 'auth/code-expired') return 'auth.codeExpired';
      if (code === 'auth/too-many-requests') return 'auth.tooMany';
      if (code === 'auth/invalid-phone-number') return 'auth.phoneInvalid';
      if (code === 'auth/captcha-check-failed') return 'auth.captchaFailed';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'auth.invalidCredentials';
      if (code === 'auth/email-already-in-use') return 'auth.emailInUse';
      if (code === 'auth/weak-password') return 'auth.weakPassword';
      if (code === 'auth/user-disabled') return 'auth.suspended';
      if (code === 'auth/network-request-failed') return 'error.network';
    }
  }
  return 'common.errorGeneric';
}
