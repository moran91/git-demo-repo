import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { daypartOf, toLocal } from '@qareeb/shared';
import { admin, asEmail, asUid, deliveryBase, key, quoteBase, shawarmaLine, USERS, waitFor, type Client } from './harness.js';

let customer: Client;
let manager: Client;
beforeAll(async () => { [customer, manager] = await Promise.all([asUid(USERS.customer2), asEmail(USERS.manager)]); });
afterAll(async () => { await Promise.all([customer.close(), manager.close()]); });

describe('popularity from real orders', () => {
  it('an accepted order adds 1 to its dish in the city and daypart', async () => {
    // Dine-in, like the customer2 test in orders.test.ts: no saved address needed.
    const lines = [shawarmaLine()];
    const q = await customer.call<{ totals: { cashDueAgorot: number } }>('quoteOrder', { ...quoteBase, mode: 'dine_in', lines });
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', { ...deliveryBase, mode: 'dine_in', addressId: undefined, contactName: 'Maha', contactPhone: '0502222222', tableNumber: '7', lines, idempotencyKey: key(), expectedCashDueAgorot: q.totals.cashDueAgorot });
    const order = (await admin.db.doc(`orders/${orderId}`).get()).data()!;
    const placed = new Date(order.placedAt as string);
    const ref = admin.db.doc(`popularityDaily/beit-jann_${toLocal(placed).date}`);
    const field = `${daypartOf(placed)}|${order.branchId}|p-shawarma`;
    const before = ((await ref.get()).data()?.counts?.[field] as number | undefined) ?? 0;
    await manager.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    const after = await waitFor(async () => {
      const n = (await ref.get()).data()?.counts?.[field] as number | undefined;
      return n !== undefined && n > before ? n : undefined;
    });
    expect(after).toBe(before + 1);
  });
});
