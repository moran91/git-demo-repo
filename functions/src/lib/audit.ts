import type { AuditEvent } from '@qareeb/shared';
import { col, nowIso, type Tx } from './firebase.js';

export function writeAudit(tx: Tx, e: Omit<AuditEvent, 'id' | 'at'>): void {
  const ref = col.audit().doc();
  tx.set(ref, { ...e, id: ref.id, at: nowIso() } satisfies AuditEvent);
}
