import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, expectCode, IDS, USERS, type Client } from './harness.js';

/** Shared extras library: one group edited in one place updates every product linked to it. */
let owner1: Client;
const base = { businessId: IDS.restaurant, branchId: IDS.branchA };
const opt = (id: string, he: string, price: number) => ({ id, name: { he }, priceDeltaAgorot: price, available: true, sortOrder: 0 });
const product = (categoryId: string, he: string, modifierGroups: unknown[]) => ({
  categoryId, name: { he }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 5000, unitLabel: {}, quantityStep: 1, minQuantity: 1,
  variants: [], modifierGroups, available: true, trackInventory: false,
});

beforeAll(async () => { owner1 = await asEmail(USERS.owner1); });
afterAll(async () => { await owner1.close(); });

describe('shared extras library', () => {
  it('links, fans out edits, allows per-product detach, and blocks archiving while in use', async () => {
    const cat = await owner1.call<{ category: { id: string } }>('saveCategory', { ...base, category: { name: { he: 'פיצות' } } });
    const { group } = await owner1.call<{ group: { id: string; options: { id: string }[] } }>('saveSharedModifierGroup', {
      ...base, group: { name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 0, placement: true, options: [opt('chicken', 'חזה עוף', 800), opt('olives', 'זיתים', 300)] },
    });
    // Linking: whatever the client sends as content is replaced by the library version.
    const link = { id: 'g-top', sharedGroupId: group.id, name: { he: 'ignored' }, required: true, minSelect: 2, maxSelect: 2, sortOrder: 0, options: [opt('bogus', 'x', 1)] };
    const p1 = (await owner1.call<{ product: { id: string; modifierGroups: any[] } }>('saveProduct', { ...base, product: product(cat.category.id, 'מרגריטה', [link]) })).product;
    const p2 = (await owner1.call<{ product: { id: string } }>('saveProduct', { ...base, product: product(cat.category.id, 'פיצה יוונית', [{ ...link, id: 'g-top2' }]) })).product;
    expect(p1.modifierGroups[0]).toMatchObject({ id: 'g-top', sharedGroupId: group.id, name: { he: 'תוספות' }, required: false, placement: true });
    expect(p1.modifierGroups[0].options.map((o: any) => o.id)).toEqual(['chicken', 'olives']);

    // Unknown / archived library ids are rejected.
    expect(await expectCode(owner1.call('saveProduct', { ...base, product: product(cat.category.id, 'x', [{ ...link, sharedGroupId: 'nope' }]) }))).toBe('invalid_argument');

    // Edit in the library: price change + new option reach both products and the public projection.
    const r = await owner1.call<{ linkedProducts: number }>('saveSharedModifierGroup', {
      ...base, groupId: group.id, group: { name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 0, placement: true, options: [opt('chicken', 'חזה עוף', 900), opt('olives', 'זיתים', 300), opt('corn', 'תירס', 200)] },
    });
    expect(r.linkedProducts).toBe(2);
    for (const id of [p1.id, p2.id]) {
      const priv = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/${id}`).get()).data()!;
      const pub = (await admin.db.doc(`publicBranches/${IDS.branchA}/products/${id}`).get()).data()!;
      for (const doc of [priv, pub]) {
        const g = doc.modifierGroups[0];
        expect(g.options.map((o: any) => [o.id, o.priceDeltaAgorot])).toEqual([['chicken', 900], ['olives', 300], ['corn', 200]]);
      }
    }

    // Archiving is blocked while products still link to the group.
    expect(await expectCode(owner1.call('setSharedModifierGroupArchived', { ...base, groupId: group.id, archived: true }))).toBe('invalid_argument');

    // Detach p1 (drop sharedGroupId, customise price); a later library edit must not touch it, but still reaches p2.
    const detached = { id: 'g-top', name: { he: 'תוספות מיוחדות' }, required: false, minSelect: 0, maxSelect: 0, sortOrder: 0, placement: true, options: [opt('chicken', 'חזה עוף', 1200)] };
    const p1b = (await owner1.call<{ product: { modifierGroups: any[] } }>('saveProduct', { ...base, productId: p1.id, product: product(cat.category.id, 'מרגריטה', [detached]) })).product;
    expect(p1b.modifierGroups[0].sharedGroupId).toBeUndefined();
    expect(p1b.modifierGroups[0].options[0].priceDeltaAgorot).toBe(1200);
    const r2 = await owner1.call<{ linkedProducts: number }>('saveSharedModifierGroup', {
      ...base, groupId: group.id, group: { name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 0, options: [opt('chicken', 'חזה עוף', 1000)] },
    });
    expect(r2.linkedProducts).toBe(1);
    const p1c = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/${p1.id}`).get()).data()!;
    const p2c = (await admin.db.doc(`businesses/${IDS.restaurant}/branches/${IDS.branchA}/products/${p2.id}`).get()).data()!;
    expect(p1c.modifierGroups[0].options[0].priceDeltaAgorot).toBe(1200);
    expect(p1c.modifierGroups[0].sharedGroupId).toBeUndefined();
    expect(p2c.modifierGroups[0].options).toHaveLength(1);
    expect(p2c.modifierGroups[0].options[0].priceDeltaAgorot).toBe(1000);

    // Unlink p2 entirely, then archiving succeeds and the archived group can no longer be linked.
    await owner1.call('saveProduct', { ...base, productId: p2.id, product: product(cat.category.id, 'פיצה יוונית', []) });
    await owner1.call('setSharedModifierGroupArchived', { ...base, groupId: group.id, archived: true });
    expect(await expectCode(owner1.call('saveProduct', { ...base, product: product(cat.category.id, 'y', [link]) }))).toBe('invalid_argument');
  });

  it('is limited to catalog roles of the branch', async () => {
    const staff = await asEmail(USERS.staff);
    expect(await expectCode(staff.call('saveSharedModifierGroup', { ...base, group: { name: { he: 'x' }, required: false, minSelect: 0, maxSelect: 0, options: [opt('a', 'a', 0)] } }))).toBe('forbidden');
    await staff.close();
  });
});
