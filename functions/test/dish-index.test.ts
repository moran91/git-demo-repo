import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { admin, asEmail, asGuest, expectCode, IDS, USERS, type Client } from './harness.js';

/** The per-branch dish index behind the home page's dish chips and search. */
let owner1: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); });
afterAll(async () => { await owner1.close(); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
type Entry = { name: Record<string, string>; priceAgorot: number; fromPrice: boolean; dishType?: string; available: boolean; needsChoice: boolean; sortOrder: number };
const index = async () => (await admin.db.doc(`publicBranches/${branchId}/index/dishes`).get()).data() as { branchId: string; businessId: string; dishes: Record<string, Entry> } | undefined;
const productInput = (name: string, extra: Record<string, unknown> = {}) => ({
  categoryId: 'c-mains', name: { he: name }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 4200, unitLabel: {},
  quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, ...extra,
});

describe('dish index', () => {
  it('is built for a seeded restaurant branch with each dish, its type and its choice flag', async () => {
    const idx = await index();
    expect(idx?.branchId).toBe(branchId);
    expect(idx?.businessId).toBe(businessId);
    expect(idx!.dishes['p-shawarma']).toMatchObject({ dishType: 'shawarma', needsChoice: true, available: true });
    expect(idx!.dishes['p-cola']).toMatchObject({ dishType: 'drinks', needsChoice: false });
    expect(idx!.dishes['p-falafel']).toMatchObject({ fromPrice: true, priceAgorot: 2800 });
  });

  it('follows saves, availability and archiving one entry at a time', async () => {
    const before = await index();
    const { product } = await owner1.call<{ product: { id: string; dishType?: string } }>('saveProduct', { businessId, branchId, product: productInput('פיצה מבחן', { dishType: 'pizza' }) });
    expect(product.dishType).toBe('pizza');
    let idx = await index();
    expect(idx!.dishes[product.id]).toMatchObject({ name: { he: 'פיצה מבחן' }, dishType: 'pizza', priceAgorot: 4200, available: true });
    // Other dishes are untouched by a single-product write.
    expect(idx!.dishes['p-shawarma']).toEqual(before!.dishes['p-shawarma']);

    // An older client that omits the field keeps the type; 'none' clears it.
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: productInput('פיצה מבחן') });
    expect((await index())!.dishes[product.id]!.dishType).toBe('pizza');
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: productInput('פיצה מבחן', { dishType: 'none' }) });
    idx = await index();
    expect(idx!.dishes[product.id]!.dishType).toBeUndefined();
    const priv = (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/products/${product.id}`).get()).data()!;
    expect(priv.dishType).toBeUndefined();

    await owner1.call('setProductAvailable', { businessId, branchId, productId: product.id, available: false });
    expect((await index())!.dishes[product.id]!.available).toBe(false);

    await owner1.call('setProductArchived', { businessId, branchId, productId: product.id, archived: true });
    idx = await index();
    expect(idx!.dishes[product.id]).toBeUndefined();
    expect(idx!.dishes['p-shawarma']).toBeDefined();
  });

  it('rejects an unknown dish type', async () => {
    expect(await expectCode(owner1.call('saveProduct', { businessId, branchId, product: productInput('x', { dishType: 'kebab-ish' }) }))).toBe('invalid_argument');
  });

  it('has no index for a supermarket branch', async () => {
    const snap = await admin.db.doc(`publicBranches/${IDS.marketBranch}/index/dishes`).get();
    expect(snap.exists).toBe(false);
  });

  it('can be read by anyone and written by no client', async () => {
    const guest = await asGuest();
    try {
      const ref = doc(guest.db, `publicBranches/${branchId}/index/dishes`);
      expect((await getDoc(ref)).exists()).toBe(true);
      await expect(setDoc(ref, { dishes: {} })).rejects.toThrow();
    } finally {
      await guest.close();
    }
  });
});
