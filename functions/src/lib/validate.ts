import type { ZodType } from 'zod';
import { fail } from './errors.js';

/** Callable clients serialise `undefined` as `null`; treat null as "absent" for optional fields. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(stripNulls(data));
  if (!r.success) {
    const issues = r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }));
    fail('invalid_argument', { issues });
  }
  return r.data;
}
