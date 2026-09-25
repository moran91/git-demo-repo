import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, expectCode, IDS, USERS, type Client } from './harness.js';

/** Explore-feed posts: a photo live for 24 hours, projected to publicBranches/{br}/posts. */
let owner1: Client;
let owner2: Client;
let staff: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); owner2 = await asEmail(USERS.owner2); staff = await asEmail(USERS.staff); });
afterAll(async () => { await owner1.close(); await owner2.close(); await staff.close(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function upload(path: string, contentType = 'image/png', body: Buffer = PNG) {
  const res = await fetch(`http://127.0.0.1:9199/upload/storage/v1/b/qareeb-dev.firebasestorage.app/o?uploadType=media&name=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  expect(res.ok).toBe(true);
}
const objectExists = async (path: string) => (await fetch(`http://127.0.0.1:9199/v0/b/qareeb-dev.firebasestorage.app/o/${encodeURIComponent(path)}`, { headers: { Authorization: 'Bearer owner' } })).ok;
const step = async <T,>(name: string, p: Promise<T>): Promise<T> => { try { return await p; } catch (e) { const err = e as { message?: string; details?: unknown }; throw new Error(`${name}: ${err.message} ${JSON.stringify(err.details)}`); } };

describe('explore posts', () => {
  // Storage is not wiped between runs (only Firestore/Auth are), so ids are unique per run.
  const run = Date.now().toString(36);
  const businessId = IDS.restaurant;
  const branchId = IDS.branchA;
  const dir = (postId: string) => `businesses/${businessId}/branches/${branchId}/posts/${postId}`;
  const pub = (postId: string) => admin.db.doc(`publicBranches/${branchId}/posts/${postId}`).get();
  const priv = (postId: string) => admin.db.doc(`${dir(postId)}`).get();

  it('publishes a 24-hour post with an optional linked dish, and removes it with its photo', async () => {
    const postId = `post-${run}-1`;
    const path = `${dir(postId)}/photo.png`;
    await upload(path);
    const { post } = await step('publish', owner1.call<{ post: { id: string; createdAt: string; expiresAt: string; productId?: string; caption: Record<string, string> } }>('publishPost', { businessId, branchId, postId, path, caption: { he: 'יצא עכשיו מהתנור' }, productId: 'p-shawarma' }));
    expect(post.id).toBe(postId);
    expect(post.productId).toBe('p-shawarma');
    expect(new Date(post.expiresAt).getTime() - new Date(post.createdAt).getTime()).toBe(24 * 3600_000);
    expect((await pub(postId)).data()).toMatchObject({ imagePath: path, caption: { he: 'יצא עכשיו מהתנור' }, businessId, branchId });

    // The same id cannot be published twice.
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId, path, caption: {} }))).toBe('invalid_argument');

    await step('remove', owner1.call('removePost', { businessId, branchId, postId }));
    expect((await pub(postId)).exists).toBe(false);
    expect((await priv(postId)).exists).toBe(false);
    expect(await objectExists(path)).toBe(false);
    expect(await expectCode(owner1.call('removePost', { businessId, branchId, postId }))).toBe('not_found');
  });

  it('validates the photo, the path, the linked dish and the caller', async () => {
    const postId = `post-${run}-2`;
    const path = `${dir(postId)}/photo.png`;
    // Nothing uploaded yet.
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId, path, caption: {} }))).toBe('invalid_argument');
    await upload(path);
    // Path of another post / another branch.
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId: 'other', path, caption: {} }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId: IDS.branchB, postId, path, caption: {} }))).toBe('invalid_argument');
    // A product from another business, and an over-long caption.
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId, path, caption: {}, productId: 'p-tomato' }))).toBe('invalid_argument');
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId, path, caption: { he: 'x'.repeat(301) } }))).toBe('invalid_argument');
    // Not an image.
    const textPath = `${dir(postId)}/note.txt`;
    await upload(textPath, 'text/plain', Buffer.from('hello'));
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId, path: textPath, caption: {} }))).toBe('invalid_argument');
    // Wrong roles: staff of the branch, and the owner of another business.
    expect(await expectCode(staff.call('publishPost', { businessId, branchId, postId, path, caption: {} }))).toBe('forbidden');
    expect(await expectCode(owner2.call('publishPost', { businessId, branchId, postId, path, caption: {} }))).toBe('forbidden');
    expect((await priv(postId)).exists).toBe(false);
  });

  it('caps live posts per branch and ignores expired ones', async () => {
    const col = admin.db.collection(`businesses/${businessId}/branches/${branchId}/posts`);
    for (const d of (await col.get()).docs) await d.ref.delete();
    // An expired post does not count toward the cap.
    await col.doc('post-old').set({ id: 'post-old', businessId, branchId, imagePath: `${dir('post-old')}/x.png`, caption: {}, createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' });
    for (let i = 0; i < 10; i++) {
      const postId = `post-${run}-cap-${i}`;
      await upload(`${dir(postId)}/p.png`);
      await step(`cap ${i}`, owner1.call('publishPost', { businessId, branchId, postId, path: `${dir(postId)}/p.png`, caption: {} }));
    }
    const extra = `post-${run}-cap-10`;
    await upload(`${dir(extra)}/p.png`);
    expect(await expectCode(owner1.call('publishPost', { businessId, branchId, postId: extra, path: `${dir(extra)}/p.png`, caption: {} }))).toBe('invalid_argument');
    for (let i = 0; i < 10; i++) await owner1.call('removePost', { businessId, branchId, postId: `post-${run}-cap-${i}` });
    await col.doc('post-old').delete();
  });
});
