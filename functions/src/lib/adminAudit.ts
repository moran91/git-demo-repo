import type { CallableRequest } from 'firebase-functions/v2/https';
import type { AuditEvent } from '@qareeb/shared';
import { col, nowIso } from './firebase.js';

/**
 * Central audit for platform admins acting inside a business. `requireMembership` marks the request
 * when an admin passes it; `handled()` flushes one `admin.<callable>` row after the callable resolves.
 * Only ids and field names are stored, never input values.
 */
export interface AdminScope { uid: string; businessId: string; branchId?: string }

const requestOf = new WeakMap<object, CallableRequest<unknown>>();
const scopes = new WeakMap<object, AdminScope>();
/** Read-only or polled callables: auditing them would only add noise (a print station calls
 *  stationHeartbeat and claimPrintJob every few seconds while idle). */
const SKIP = new Set(['listMembers', 'stationHeartbeat', 'claimPrintJob']);

export function bindCaller(caller: object, req: CallableRequest<unknown>): void {
  requestOf.set(caller, req);
}

export function markAdminScope(caller: object, scope: AdminScope): void {
  const req = requestOf.get(caller);
  if (req) scopes.set(req, scope);
}

export function summarizeInput(data: unknown): { ids: Record<string, string>; fields: string[] } {
  const ids: Record<string, string> = {};
  const fields: string[] = [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      fields.push(k);
      if (typeof v === 'string' && k.endsWith('Id')) ids[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { id?: unknown }).id === 'string') ids[`${k}.id`] = (v as { id: string }).id;
    }
  }
  return { ids, fields };
}

export async function flushAdminAudit(req: object): Promise<void> {
  const scope = scopes.get(req);
  if (!scope) return;
  scopes.delete(req);
  const name = process.env.FUNCTION_TARGET || 'unknown';
  if (SKIP.has(name)) return;
  try {
    const ref = col.audit().doc();
    const { ids, fields } = summarizeInput((req as CallableRequest<unknown>).data);
    const after = { ...(scope.branchId ? { branchId: scope.branchId } : {}), ids, fields };
    await ref.set({ id: ref.id, actorUid: scope.uid, action: `admin.${name}`, targetType: 'business', targetId: scope.businessId, after, at: nowIso() } satisfies AuditEvent);
  } catch (e) {
    // The callable already committed; a missing audit row must not turn a success into an error.
    console.error('admin audit write failed', e instanceof Error ? e.message : e);
  }
}
