import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { MAX_STORY_ITEMS, type BranchPost } from '@qareeb/shared';
import { db } from '@/lib/firebase';
import { createStore } from '@/lib/store';
import { useDiscovery, type PublicBranch } from './hooks';
import type { PublicProduct } from './BusinessPage';

/**
 * One photo in a story. `seenKey` is what marks it seen on this device: a post once, a featured menu
 * item once per day (it stays in the story, so it comes back as new the next day).
 */
export type StorySlide =
  | { kind: 'post'; key: string; seenKey: string; post: BranchPost }
  | { kind: 'item'; key: string; seenKey: string; product: PublicProduct };

/** One circle in the stories row: a branch's live posts (oldest first), then its featured menu items. */
export interface StoryGroup {
  branch: PublicBranch;
  slides: StorySlide[];
  /** Newest post time, or '' for a story made only of menu items (listed after stories with posts). */
  latestAt: string;
}

/** A featured item plays only when a customer could actually see and order it. */
export function isStoryItem(p: PublicProduct): boolean {
  return !!p.inStories && !!p.imagePath && !p.archived && p.available && p.inStock !== false;
}

/** Branches read per visit; a village has far fewer, this only bounds a town that grows. */
const MAX_BRANCHES = 20;

/**
 * Seen posts, per device (persisted by the store). Kept small: posts expire after 24 hours, so ids
 * older than two days are dropped whenever one is added.
 */
type Seen = Record<string, number>;
export const seenStore = createStore<{ seen: Seen }>('storiesSeen', { seen: {} });
export function markSeen(postId: string) {
  const current = seenStore.get().seen;
  if (current[postId]) return;
  const cutoff = Date.now() - 48 * 3600_000;
  const next: Seen = { [postId]: Date.now() };
  for (const [id, at] of Object.entries(current)) if (at > cutoff) next[id] = at;
  seenStore.set({ seen: next });
}

/** Unseen stories first, then the most recently posted. */
export function orderGroups(groups: StoryGroup[], seen: Seen): StoryGroup[] {
  const unseen = (g: StoryGroup) => g.slides.some((s) => !seen[s.seenKey]);
  return [...groups].sort((a, b) => Number(unseen(b)) - Number(unseen(a)) || b.latestAt.localeCompare(a.latestAt));
}

/**
 * Live posts and featured menu items of every branch that serves the town (the home page's own
 * discovery queries, both kinds), grouped per branch. One-shot reads: stories change a few times a day, and the row reloads
 * whenever the town or the list of branches changes.
 */
export function useStories(cityId: string) {
  const restaurants = useDiscovery(cityId, 'restaurant');
  const markets = useDiscovery(cityId, 'supermarket');
  const branches = useMemo(() => [...restaurants.data, ...markets.data].slice(0, MAX_BRANCHES), [restaurants.data, markets.data]);
  const loadingBranches = restaurants.loading || markets.loading;
  const key = branches.map((b) => b.id).join(',');
  const [state, setState] = useState<{ key: string; groups: StoryGroup[] }>({ key: '', groups: [] });

  useEffect(() => {
    if (loadingBranches) return;
    let cancelled = false;
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    Promise.all(
      branches.map(async (branch): Promise<StoryGroup | null> => {
        const [postSnap, itemSnap] = await Promise.all([
          getDocs(query(collection(db, `publicBranches/${branch.id}/posts`), where('expiresAt', '>', now), limit(20))),
          getDocs(query(collection(db, `publicBranches/${branch.id}/products`), where('inStories', '==', true), limit(MAX_STORY_ITEMS * 2))),
        ]);
        const posts = postSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as BranchPost).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const items = itemSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as PublicProduct).filter(isStoryItem).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, MAX_STORY_ITEMS);
        const slides: StorySlide[] = [
          ...posts.map((post) => ({ kind: 'post' as const, key: `post-${post.id}`, seenKey: post.id, post })),
          ...items.map((product) => ({ kind: 'item' as const, key: `item-${product.id}`, seenKey: `${product.id}@${day}`, product })),
        ];
        return slides.length ? { branch, slides, latestAt: posts.length ? posts[posts.length - 1]!.createdAt : '' } : null;
      }),
    ).then(
      (rows) => { if (!cancelled) setState({ key, groups: rows.filter((r): r is StoryGroup => !!r) }); },
      // Stories are an extra on the home page: a failed read hides the row instead of an error.
      () => { if (!cancelled) setState({ key, groups: [] }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadingBranches]);

  return state.key === key ? state.groups : [];
}
