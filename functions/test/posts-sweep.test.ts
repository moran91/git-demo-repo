import { describe, expect, it } from 'vitest';
// Imported from source, not through the functions emulator: the sweep runs inside `scheduledSweeps`,
// which the emulator never fires. This file must not import ./harness.js, whose admin app would be
// the same default Firestore instance that src/lib/firebase.ts configures (settings() only once).
import { db } from '../src/lib/firebase.js';
import { sweepExpiredPosts } from '../src/domain/posts.js';

describe('expired post sweep', () => {
  it('deletes expired posts and their projections, and keeps live ones', async () => {
    const businessId = 'biz-abu-salim';
    const branchId = 'br-abu-salim-main';
    const priv = (id: string) => db.doc(`businesses/${businessId}/branches/${branchId}/posts/${id}`);
    const pub = (id: string) => db.doc(`publicBranches/${branchId}/posts/${id}`);
    const expired = { businessId, branchId, caption: {}, createdAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z' };
    const live = { ...expired, expiresAt: '2099-01-01T00:00:00.000Z' };
    await priv('sweep-exp').set({ ...expired, id: 'sweep-exp' });
    await pub('sweep-exp').set({ ...expired, id: 'sweep-exp' });
    await priv('sweep-live').set({ ...live, id: 'sweep-live' });
    await pub('sweep-live').set({ ...live, id: 'sweep-live' });

    const { deleted } = await sweepExpiredPosts();

    expect(deleted).toBeGreaterThanOrEqual(2);
    expect((await priv('sweep-exp').get()).exists).toBe(false);
    expect((await pub('sweep-exp').get()).exists).toBe(false);
    expect((await priv('sweep-live').get()).exists).toBe(true);
    expect((await pub('sweep-live').get()).exists).toBe(true);
    await priv('sweep-live').delete();
    await pub('sweep-live').delete();
  });
});
