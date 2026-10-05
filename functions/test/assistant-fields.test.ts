import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, IDS, USERS, type Client } from './harness.js';

/** Automatic tags/serves/type on save, and the owner's choice winning over them. */
let owner1: Client;
let owner2: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); owner2 = await asEmail(USERS.owner2); });
afterAll(async () => { await owner1.close(); await owner2.close(); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
const input = (name: string, extra: Record<string, unknown> = {}) => ({
  categoryId: 'c-mains', name: { he: name }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 5000, unitLabel: {},
  quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, ...extra,
});
const priv = async (id: string) => (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/products/${id}`).get()).data()!;
const entry = async (id: string) => ((await admin.db.doc(`publicBranches/${branchId}/index/dishes`).get()).data() as { dishes: Record<string, { tags?: string[]; serves?: number; dishType?: string }> }).dishes[id];

describe('assistant fields on saveProduct', () => {
  it('a new dish gets automatic tags, serves and type, marked as machine-owned and indexed', async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input('פיצה משפחתית חריפה') });
    const p = await priv(product.id);
    expect(p.dishType).toBe('pizza');
    expect(p.serves).toBe(4);
    expect(p.tags).toEqual(expect.arrayContaining(['spicy', 'vegetarian', 'sharing']));
    expect(p.autoFields).toMatchObject({ dishType: 'pizza', serves: 4 });
    expect(await entry(product.id)).toMatchObject({ dishType: 'pizza', serves: 4 });
  });

  it("the owner's tags win and stay when later saves omit them", async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input('פסטה ארביאטה') });
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input('פסטה ארביאטה', { tags: ['spicy', 'kids'], serves: 3 }) });
    let p = await priv(product.id);
    expect(p.tags).toEqual(['spicy', 'kids']);
    expect(p.serves).toBe(3);
    expect(p.autoFields.tags).toBeUndefined();
    expect(p.autoFields.serves).toBeUndefined();
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input('פסטה ארביאטה') });
    p = await priv(product.id);
    expect(p.tags).toEqual(['spicy', 'kids']);
    expect((await entry(product.id))!.tags).toEqual(['spicy', 'kids']);
  });

  it('the category name feeds the type: a bare "Pepsi" in a drinks category is a drink', async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input('Pepsi', { categoryId: 'c-drinks' }) });
    const p = await priv(product.id);
    expect(p.dishType).toBe('drinks');
    expect(p.autoFields.dishType).toBe('drinks');
  });

  it('a legacy product (no autoFields, no serves) saved without the fields takes the suggestion', async () => {
    const id = 'p-legacy-assistant';
    const path = `businesses/${businessId}/branches/${branchId}/products/${id}`;
    await admin.db.doc(path).set({ id, branchId, businessId, ...input('פיצה משפחתית'), archived: false, sortOrder: 99, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await owner1.call('saveProduct', { businessId, branchId, productId: id, product: input('פיצה משפחתית') });
    const p = await priv(id);
    expect(p.dishType).toBe('pizza');
    expect(p.serves).toBe(4);
    expect(p.autoFields).toMatchObject({ dishType: 'pizza', serves: 4 });
  });

  it('a stale type is dropped from the stored product when the machine-owned suggestion goes away', async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input('פיצה צנועה') });
    expect((await priv(product.id)).dishType).toBe('pizza');
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input('משהו אחר לגמרי') });
    const p = await priv(product.id);
    expect(p.dishType).not.toBe('pizza');
    expect(p.autoFields.dishType).toBe(p.dishType ?? 'none');
  });

  it('a supermarket product gets no tags, serves or autoFields', async () => {
    const { product } = await owner2.call<{ product: { id: string } }>('saveProduct', {
      businessId: IDS.market, branchId: IDS.marketBranch, product: input('פיצה קפואה', { categoryId: 'c-pantry' }),
    });
    const p = (await admin.db.doc(`businesses/${IDS.market}/branches/${IDS.marketBranch}/products/${product.id}`).get()).data()!;
    expect(p.tags).toBeUndefined();
    expect(p.serves).toBeUndefined();
    expect(p.autoFields).toBeUndefined();
    expect(p.dishType).toBeUndefined();
  });
});
