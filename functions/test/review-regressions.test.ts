import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin, asEmail, IDS, USERS, type Client } from './harness.js';

let owner: Client;
let staff: Client;
const branchId = 'review-catalog';
const base = { businessId: IDS.restaurant, branchId };
const branchPath = `businesses/${IDS.restaurant}/branches/${branchId}`;
const publicPath = `publicBranches/${branchId}`;
const productPath = `${branchPath}/products/product`;

beforeAll(async () => {
  [owner, staff] = await Promise.all([asEmail(USERS.owner1), asEmail(USERS.staff)]);
  const branch = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}`).get()).data()!;
  const source = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/p-falafel`).get()).data()!;
  await admin.db.doc(branchPath).set({ ...branch, id: branchId });
  await admin.db.doc(`${branchPath}/categories/cat`).set({ id: 'cat', branchId, name: { en: 'Review' }, sortOrder: 0, archived: false });
  await admin.db.doc(productPath).set({ ...source, id: 'product', branchId, categoryId: 'cat', sortOrder: 90, trackInventory: true, stockQty: 0, variants: [{ id: 'size', name: { en: 'Large' }, available: true, priceAgorot: 1200, stockQty: 17, sortOrder: 0 }] });
});
afterAll(async () => {
  await admin.db.recursiveDelete(admin.db.doc(branchPath));
  await admin.db.recursiveDelete(admin.db.doc(publicPath));
  await Promise.all([owner.close(), staff.close()]);
});

it('availability changes preserve current product fields and enforce branch permissions', async () => {
  await admin.db.doc(productPath).update({ name: { en: 'Concurrent edit' }, priceAgorot: 4321 });
  await owner.call('setProductAvailable', { ...base, productId: 'product', available: false });
  const saved = (await admin.db.doc(productPath).get()).data()!;
  expect(saved.available).toBe(false);
  expect(saved.name.en).toBe('Concurrent edit');
  expect(saved.priceAgorot).toBe(4321);
  expect(saved.variants[0].stockQty).toBe(17);
  expect((await admin.db.doc(`${publicPath}/products/product`).get()).data()!.available).toBe(false);
  await expect(staff.call('setProductAvailable', { ...base, productId: 'product', available: true })).rejects.toThrow();
});

it('new products append after existing sort values rather than the document count', async () => {
  const product = { categoryId: 'cat', name: { en: 'Appended' }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 100, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false };
  const result = await owner.call<{ product: { sortOrder: number } }>('saveProduct', { ...base, product });
  expect(result.product.sortOrder).toBe(91);
});

it('copying resets variant stock and avoids archived destination categories', async () => {
  const destinationId = 'review-copy';
  const destinationPath = `businesses/${IDS.restaurant}/branches/${destinationId}`;
  try {
    const branch = (await admin.db.doc(branchPath).get()).data()!;
    await admin.db.doc(destinationPath).set({ ...branch, id: destinationId });
    await admin.db.doc(`${destinationPath}/categories/archived`).set({ id: 'archived', branchId: destinationId, name: { en: 'Review' }, sortOrder: 0, archived: true });
    const result = await owner.call<{ copied: number }>('copyToBranch', { businessId: IDS.restaurant, fromBranchId: branchId, toBranchId: destinationId, productId: 'product' });
    expect(result.copied).toBe(1);
    const products = await admin.db.collection(`${destinationPath}/products`).get();
    const copy = products.docs[0]!.data();
    expect(copy.stockQty).toBe(0);
    expect(copy.variants[0].stockQty).toBe(0);
    expect(copy.categoryId).not.toBe('archived');
    expect((await admin.db.doc(`publicBranches/${destinationId}/products/${copy.id}`).get()).data()!.inStock).toBe(false);
  } finally {
    await admin.db.recursiveDelete(admin.db.doc(destinationPath));
    await admin.db.recursiveDelete(admin.db.doc(`publicBranches/${destinationId}`));
  }
});

it('republishes a large menu without deleting live products and removes obsolete projections', async () => {
  const template = (await admin.db.doc(productPath).get()).data()!;
  const batch = admin.db.batch();
  for (let i = 0; i < 460; i++) {
    const id = `bulk-${i}`;
    batch.set(admin.db.doc(`${branchPath}/products/${id}`), { ...template, id, sortOrder: i });
  }
  await batch.commit();
  await owner.call('updateBusiness', { businessId: IDS.restaurant, business: {} });
  await admin.db.doc(`${publicPath}/products/obsolete`).set({ id: 'obsolete' });
  let disappeared = false;
  let stop = () => {};
  await new Promise<void>((resolve, reject) => {
    stop = admin.db.doc(`${publicPath}/products/bulk-0`).onSnapshot((snapshot) => {
      if (!snapshot.exists) disappeared = true;
      resolve();
    }, reject);
  });
  try {
    await owner.call('updateBusiness', { businessId: IDS.restaurant, business: {} });
    expect((await admin.db.collection(`${publicPath}/products`).get()).size).toBe(462);
    expect((await admin.db.doc(`${publicPath}/products/obsolete`).get()).exists).toBe(false);
    expect((await admin.db.doc(`${publicPath}/products/product`).get()).data()!.name.en).toBe('Concurrent edit');
    expect(disappeared).toBe(false);
  } finally {
    stop();
  }
});
