import { httpsCallable } from 'firebase/functions';
import type { QareebErrorCode } from '@qareeb/shared';
import { functions } from './firebase';

export class ApiError extends Error {
  constructor(public readonly code: QareebErrorCode | 'network', public readonly details: Record<string, unknown> = {}) {
    super(code);
  }
}

/** Typed callable wrapper. Converts HttpsError → ApiError with the structured QareebErrorCode. */
export async function call<TRes = unknown, TReq = unknown>(name: string, data?: TReq): Promise<TRes> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('network');
  try {
    const res = await httpsCallable<TReq, TRes>(functions, name)(data as TReq);
    return res.data;
  } catch (e) {
    const err = e as { code?: string; details?: { code?: QareebErrorCode } & Record<string, unknown>; message?: string };
    const code = err.details?.code;
    if (code) throw new ApiError(code, err.details ?? {});
    if (err.code === 'functions/unauthenticated') throw new ApiError('unauthenticated');
    if (err.code === 'functions/internal' || err.code === 'functions/unavailable' || err.code === 'functions/deadline-exceeded') {
      throw new ApiError(err.message?.includes('fetch') ? 'network' : 'internal');
    }
    throw new ApiError('internal');
  }
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
