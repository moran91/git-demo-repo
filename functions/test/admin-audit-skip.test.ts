import { afterEach, describe, expect, it } from 'vitest';
// Imported from source, not through the functions emulator: FUNCTION_TARGET is fixed per emulated
// function, so the skip list is exercised by calling the hook directly. Like posts-sweep.test.ts, this
// file must not import ./harness.js (its admin app would share the default Firestore instance).
import { db } from '../src/lib/firebase.js';
import { bindCaller, flushAdminAudit, markAdminScope } from '../src/lib/adminAudit.js';

const previousTarget = process.env.FUNCTION_TARGET;
afterEach(() => { process.env.FUNCTION_TARGET = previousTarget; });

/** Runs the hook as if `target` had just succeeded for an admin, and returns the audit actions written for `businessId`. */
async function flushAs(target: string, businessId: string): Promise<string[]> {
  process.env.FUNCTION_TARGET = target;
  const req = { data: { businessId } };
  const caller = {};
  bindCaller(caller, req as never);
  markAdminScope(caller, { uid: 'admin-unit', businessId });
  await flushAdminAudit(req);
  return (await db.collection('audit').where('targetId', '==', businessId).get()).docs.map((d) => d.data().action as string);
}

describe('admin audit skip list', () => {
  it('writes one row for an ordinary business callable', async () => {
    expect(await flushAs('saveProduct', `unit-${Date.now()}-save`)).toEqual(['admin.saveProduct']);
  });

  it('writes nothing for read-only or polled callables (a print station polls claimPrintJob every few seconds)', async () => {
    for (const name of ['claimPrintJob', 'stationHeartbeat', 'listMembers']) {
      expect(await flushAs(name, `unit-${Date.now()}-${name}`)).toEqual([]);
    }
  });
});
