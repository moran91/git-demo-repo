import type { TranslationKey } from '@qareeb/shared';
import { ApiError } from './api';
import { ImagePrepError } from './images';

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
      if (code === 'auth/error-code:-39') return 'auth.smsDeliveryUnavailable';
      if (['auth/captcha-check-failed', 'auth/invalid-app-credential', 'auth/missing-app-credential', 'auth/missing-recaptcha-token', 'auth/invalid-recaptcha-token'].includes(code)) return 'auth.captchaFailed';
      if (['auth/operation-not-allowed', 'auth/quota-exceeded', 'auth/billing-not-enabled', 'auth/app-not-authorized', 'auth/unauthorized-domain'].includes(code)) return 'auth.smsUnavailable';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'auth.invalidCredentials';
      if (code === 'auth/email-already-in-use') return 'auth.emailInUse';
      if (code === 'auth/weak-password') return 'auth.weakPassword';
      if (code === 'auth/user-disabled') return 'auth.suspended';
      if (code === 'auth/network-request-failed') return 'error.network';
    }
  }
  return 'common.errorGeneric';
}

/**
 * Photo-upload failures, told apart. They used to collapse into one message that repeated the hint
 * already printed under the button, so a rejected pick (a >5 MB camera photo, or a Storage rule
 * denial) was indistinguishable from the button doing nothing.
 */
export function uploadErrorKey(e: unknown): TranslationKey {
  if (e instanceof ImagePrepError) {
    if (e.kind === 'unreadable') return 'catalog.photoUnreadable';
    return e.kind === 'unsupported' ? 'catalog.photoUnsupported' : 'catalog.photoTooLarge';
  }
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  // The translated message deliberately carries no raw code, which left a Storage denial with no
  // trace anywhere — the reason an upload outage on qareeb-dev went three days without a diagnosis.
  // The code alone is not enough either: `storage/unauthorized` is what the service returns both
  // for a genuine permission denial and for a *failed* cross-service Firestore lookup in
  // storage.rules, so the log names that ambiguity rather than leaving the next reader to rediscover it.
  if (code.startsWith('storage/')) {
    console.error('[upload] storage error', code, e);
    if (code === 'storage/unauthorized') {
      console.error('[upload] storage/unauthorized means either the rules denied this member, or the cross-service firestore.get() in storage.rules could not resolve. Run `npm run check:storage-upload` to tell them apart.');
    }
  }
  if (code === 'storage/unauthorized') return 'catalog.photoForbidden';
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/canceled') return 'error.network';
  if (code.startsWith('storage/')) return 'catalog.photoFailed';
  // Anything else reaches the user as a generic message, which is exactly what made a one-off
  // failure on a phone undiagnosable after the fact; the console keeps the real error.
  if (!(e instanceof ApiError)) console.error('[upload] unexpected error', e);
  return errorKey(e);
}
