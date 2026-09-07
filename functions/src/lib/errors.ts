import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import type { QareebErrorCode } from '@qareeb/shared';

const codeMap: Record<QareebErrorCode, FunctionsErrorCode> = {
  unauthenticated: 'unauthenticated',
  phone_not_verified: 'failed-precondition',
  suspended: 'permission-denied',
  forbidden: 'permission-denied',
  not_found: 'not-found',
  invalid_argument: 'invalid-argument',
  business_not_approved: 'failed-precondition',
  branch_not_approved: 'failed-precondition',
  branch_closed: 'failed-precondition',
  orders_paused: 'failed-precondition',
  delivery_not_available: 'failed-precondition',
  pickup_not_available: 'failed-precondition',
  below_minimum: 'failed-precondition',
  price_changed: 'failed-precondition',
  item_unavailable: 'failed-precondition',
  invalid_modifiers: 'invalid-argument',
  out_of_stock: 'failed-precondition',
  mixed_branch_cart: 'invalid-argument',
  invalid_status_transition: 'failed-precondition',
  version_conflict: 'aborted',
  already_settled: 'failed-precondition',
  loyalty_insufficient: 'failed-precondition',
  loyalty_debt: 'failed-precondition',
  rate_limited: 'resource-exhausted',
  not_configured: 'unavailable',
  printer_setup_required: 'failed-precondition',
  duplicate_copy: 'already-exists',
  internal: 'internal',
};

/**
 * Structured error carrying a stable QareebErrorCode. Converted to HttpsError at the boundary; the
 * `details` payload must never contain private data.
 */
export class QareebError extends Error {
  constructor(
    public readonly code: QareebErrorCode,
    public readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? code);
  }
  toHttps(): HttpsError {
    return new HttpsError(codeMap[this.code], this.code, { code: this.code, ...(this.details ?? {}) });
  }
}

export function fail(code: QareebErrorCode, details?: Record<string, unknown>, message?: string): never {
  throw new QareebError(code, details, message);
}

/** Wraps a callable handler: validates, maps errors, redacts unexpected failures. */
export function handled<TReq, TRes>(fn: (req: TReq) => Promise<TRes>): (req: TReq) => Promise<TRes> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof QareebError) throw e.toHttps();
      if (e instanceof HttpsError) throw e;
      // Redact: log server-side without request payloads, return a generic error.
      console.error('unhandled error', e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e);
      throw new HttpsError('internal', 'internal', { code: 'internal' });
    }
  };
}
