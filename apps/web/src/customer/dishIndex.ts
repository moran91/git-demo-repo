import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DishIndexDoc } from '@qareeb/shared';
import { db } from '@/lib/firebase';

/**
 * Live dish indexes (`publicBranches/{id}/index/dishes`) for the given restaurant branches: one
 * document per place, so the home's search and chips cost one read per place, not one per dish.
 * Sold-out and switched-off dishes update in place through the listeners.
 */
export function useDishIndexes(branchIds: string[]): { indexes: Map<string, DishIndexDoc>; loading: boolean } {
  const key = [...branchIds].sort().join(',');
  const [state, setState] = useState<{ key: string; docs: Record<string, DishIndexDoc | null> }>({ key: '', docs: {} });
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const unsubs = ids.map((id) =>
      onSnapshot(
        doc(db, `publicBranches/${id}/index/dishes`),
        (snap) => setState((s) => ({ key, docs: { ...(s.key === key ? s.docs : {}), [id]: snap.exists() ? (snap.data() as DishIndexDoc) : null } })),
        // A missing or unreadable index just leaves that place out of dish search.
        () => setState((s) => ({ key, docs: { ...(s.key === key ? s.docs : {}), [id]: null } })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return useMemo(() => {
    const ids = key ? key.split(',') : [];
    const docs = state.key === key ? state.docs : {};
    const indexes = new Map<string, DishIndexDoc>();
    for (const id of ids) {
      const d = docs[id];
      if (d) indexes.set(id, d);
    }
    return { indexes, loading: ids.some((id) => !(id in docs)) };
  }, [state, key]);
}
