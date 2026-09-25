import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, expectCode, IDS, USERS, type Client } from './harness.js';

/** Menu items featured in a branch's stories: `inStories` on the product, projected, capped at 10. */
let owner1: Client;
let staff: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); staff = await asEmail(USERS.staff); });
afterAll(async () => { await owner1.close(); await staff.close(); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
const pub = (id: string) => admin.db.doc(`publicBranches/${branchId}/products/${id}`).get();
const productInput = (name: string, inStories?: boolean) => ({
  categoryId: 'c-mains', name: { he: name }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 1000, unitLabel: {},
  quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false,
  ...(inStories === undefined ? {} : { inStories }),
});

describe('story items', () => {
  it('toggles an item in and out of stories, projects it, and keeps it when an old client saves', async () => {
    await owner1.call('setProductInStories', { businessId, branchId, productId: 'p-fries', inStories: true });
    expect((await pub('p-fries')).data()!.inStories).toBe(true);

    // A save without the field (an older client) leaves the flag alone; an explicit false clears it.
    const { product } = await owner1.call<{ product: { id: string; inStories: boolean } }>('saveProduct', { businessId, branchId, product: productInput('נשאר בסטוריז', true) });
    expect(product.inStories).toBe(true);
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: productInput('נשאר בסטוריז') });
    expect((await pub(product.id)).data()!.inStories).toBe(true);
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: productInput('נשאר בסטוריז', false) });
    expect((await pub(product.id)).data()!.inStories).toBe(false);

    await owner1.call('setProductInStories', { businessId, branchId, productId: 'p-fries', inStories: false });
    expect((await pub('p-fries')).data()!.inStories).toBe(false);

    expect(await expectCode(staff.call('setProductInStories', { businessId, branchId, productId: 'p-fries', inStories: true }))).toBe('forbidden');
    expect(await expectCode(owner1.call('setProductInStories', { businessId, branchId, productId: 'nope', inStories: true }))).toBe('not_found');
  });

  it('caps a branch at 10 story items, through both the toggle and the editor save', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: productInput(`סטורי ${i}`, true) });
      ids.push(product.id);
    }
    expect(await expectCode(owner1.call('setProductInStories', { businessId, branchId, productId: 'p-fries', inStories: true }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('saveProduct', { businessId, branchId, product: productInput('אחד עשר', true) }))).toBe('invalid_argument');
    // Re-saving one of the ten is not a new feature and still works.
    await owner1.call('saveProduct', { businessId, branchId, productId: ids[0], product: productInput('סטורי 0 שונה', true) });
    // An archived item does not hold a place.
    await owner1.call('setProductArchived', { businessId, branchId, productId: ids[1], archived: true });
    await owner1.call('setProductInStories', { businessId, branchId, productId: 'p-fries', inStories: true });
    for (const id of ids) await owner1.call('setProductInStories', { businessId, branchId, productId: id, inStories: false });
    await owner1.call('setProductInStories', { businessId, branchId, productId: 'p-fries', inStories: false });
  });
});
