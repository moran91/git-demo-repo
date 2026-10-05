/** Nightly "goes together" index per restaurant branch, from the last 90 days of orders. */
import { computePairs, type PairOrder, type PairsIndexDoc } from '@qareeb/shared';
import { col, db, nowIso } from '../lib/firebase.js';

const WINDOW_DAYS = 90;

export async function rebuildPairs(now = new Date()): Promise<{ branches: number }> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const [snap, existing] = await Promise.all([
    col.orders().where('placedAt', '>=', since).get(),
    // Branches that already have a pairs doc are revisited too, so a stale one is deleted once its
    // orders age out of the window. `select()` reads no fields, so the big dish index docs stay cheap.
    db.collectionGroup('index').select().get(),
  ]);
  const byBranch = new Map<string, PairOrder[]>();
  for (const d of snap.docs) {
    const o = d.data() as PairOrder & { branchId: string };
    byBranch.set(o.branchId, [...(byBranch.get(o.branchId) ?? []), o]);
  }
  const hadPairs = new Set(existing.docs.filter((d) => d.id === 'pairs' && d.ref.parent.parent?.parent.id === 'publicBranches').map((d) => d.ref.parent.parent!.id));
  let branches = 0;
  for (const branchId of new Set([...byBranch.keys(), ...hadPairs])) {
    const ref = col.publicPairsIndex(branchId);
    // Only branches with a public dish index (visible restaurants) get pairs.
    const pairs = (await col.publicDishIndex(branchId).get()).exists ? computePairs(byBranch.get(branchId) ?? []) : null;
    if (pairs) {
      await ref.set({ branchId, pairs, updatedAt: nowIso() } satisfies PairsIndexDoc);
      branches++;
    } else if (hadPairs.has(branchId)) await ref.delete();
  }
  return { branches };
}
