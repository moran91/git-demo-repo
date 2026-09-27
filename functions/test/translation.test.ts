import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, IDS, sleep, USERS, waitFor, type Client } from './harness.js';

/**
 * Menu auto-translation with the emulator's stub translator ("[ar] <text>"). The owner's own text is
 * never overwritten; machine text follows the source; the public menu and dish index get the result.
 */
let owner1: Client;
let ownerPending: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); ownerPending = await asEmail(USERS.ownerPending); });
afterAll(async () => { await owner1.close(); await ownerPending.close(); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
type P = { name: Record<string, string>; description: Record<string, string>; variants: Array<{ name: Record<string, string> }>; autoTranslated?: Record<string, Record<string, string>> };
const priv = async (id: string) => (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/products/${id}`).get()).data() as P;
const input = (name: Record<string, string>, description: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  categoryId: 'c-mains', name, description, dietaryText: {}, pricingMode: 'unit', priceAgorot: 4200, unitLabel: {},
  quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, ...extra,
});

describe('menu auto-translation', () => {
  it('fills missing languages of a saved dish and shows them to customers', async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input({ he: 'פסטה מבחן' }, { he: 'ברוטב עגבניות' }, { variants: [{ name: { he: 'גדולה' }, priceAgorot: 5000, available: true, sortOrder: 0 }] }) });
    const p = await waitFor(async () => { const x = await priv(product.id); return x.name.ar ? x : null; });
    expect(p.name).toEqual({ he: 'פסטה מבחן', ar: '[ar] פסטה מבחן', en: '[en] פסטה מבחן' });
    expect(p.description.en).toBe('[en] ברוטב עגבניות');
    expect(p.variants[0]!.name.ar).toBe('[ar] גדולה');
    expect(p.autoTranslated!.name).toEqual({ ar: 'פסטה מבחן', en: 'פסטה מבחן' });
    const pub = (await admin.db.doc(`publicBranches/${branchId}/products/${product.id}`).get()).data() as P;
    expect(pub.name.ar).toBe('[ar] פסטה מבחן');
    const idx = (await admin.db.doc(`publicBranches/${branchId}/index/dishes`).get()).data() as { dishes: Record<string, P> };
    expect(idx.dishes[product.id]!.name.en).toBe('[en] פסטה מבחן');
    const jobs = await admin.db.collection('translationJobs').where('path', '==', `businesses/${businessId}/branches/${branchId}/products/${product.id}`).get();
    expect(jobs.size).toBe(0);
  });

  it("never overwrites the owner's own wording and re-translates only machine text when the source changes", async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input({ he: 'מנת בדיקה' }) });
    await waitFor(async () => (await priv(product.id)).name.en);
    // The owner corrects the English: it becomes theirs. (The seed business's default language is
    // Arabic, but its Arabic here is machine-written, so the owner's Hebrew stays the source.)
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input({ he: 'מנת בדיקה', ar: '[ar] מנת בדיקה', en: 'Test plate' }) });
    let p = await priv(product.id);
    expect(p.autoTranslated!.name).toEqual({ ar: 'מנת בדיקה' });
    // The owner renames the dish in Hebrew: the machine Arabic follows, the owner's English stays.
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input({ he: 'מנת בדיקה חדשה', ar: '[ar] מנת בדיקה', en: 'Test plate' }) });
    p = await waitFor(async () => { const x = await priv(product.id); return x.name.ar === '[ar] מנת בדיקה חדשה' ? x : null; });
    expect(p.name.en).toBe('Test plate');
    expect(p.autoTranslated!.name).toEqual({ ar: 'מנת בדיקה חדשה' });
    // Once the owner writes the Arabic (the business's default language), it becomes the source.
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input({ he: 'מנת בדיקה חדשה', ar: 'صحن تجربة', en: 'Test plate' }) });
    p = await priv(product.id);
    expect(p.autoTranslated ?? {}).toEqual({});
  });

  it('translates categories and library extras, and the dishes that use them get the text', async () => {
    const { category } = await owner1.call<{ category: { id: string } }>('saveCategory', { businessId, branchId, category: { name: { he: 'מבחן קטגוריה' } } });
    const cat = await waitFor(async () => { const c = (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/categories/${category.id}`).get()).data(); return c?.name?.ar ? c : null; });
    expect(cat.name.en).toBe('[en] מבחן קטגוריה');
    const pubCat = (await admin.db.doc(`publicBranches/${branchId}/categories/${category.id}`).get()).data()!;
    expect(pubCat.name.ar).toBe('[ar] מבחן קטגוריה');

    const { group } = await owner1.call<{ group: { id: string } }>('saveSharedModifierGroup', { businessId, branchId, group: { name: { he: 'רטבים מבחן' }, required: false, minSelect: 0, maxSelect: 0, options: [{ name: { he: 'שום' }, priceDeltaAgorot: 0, available: true, sortOrder: 0 }] } });
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input({ he: 'עם רטבים', ar: 'مع صلصات', en: 'With sauces' }, {}, { modifierGroups: [{ sharedGroupId: group.id, name: { he: 'x' }, required: false, minSelect: 0, maxSelect: 0, sortOrder: 0, options: [{ name: { he: 'x' }, priceDeltaAgorot: 0, available: true, sortOrder: 0 }] }] }) });
    const linked = await waitFor(async () => {
      const p = (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/products/${product.id}`).get()).data() as { modifierGroups: Array<{ name: Record<string, string>; options: Array<{ name: Record<string, string> }> }> };
      return p.modifierGroups[0]?.options[0]?.name.ar ? p : null;
    });
    expect(linked.modifierGroups[0]!.name.en).toBe('[en] רטבים מבחן');
    expect(linked.modifierGroups[0]!.options[0]!.name.ar).toBe('[ar] שום');
  });

  it('leaves places that are not approved yet untranslated', async () => {
    const { product } = await ownerPending.call<{ product: { id: string } }>('saveProduct', { businessId: IDS.pending, branchId: IDS.pendingBranch, product: { ...input({ ar: 'مناقيش جبنة' }), categoryId: 'c-bakery' } });
    await sleep(3000);
    const p = (await admin.db.doc(`businesses/${IDS.pending}/branches/${IDS.pendingBranch}/products/${product.id}`).get()).data() as P;
    expect(p.name).toEqual({ ar: 'مناقيش جبنة' });
  });
});
