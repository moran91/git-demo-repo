import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * Live per-branch index documents (`publicBranches/{id}/index/{dishes|deals|pairs}`): one document per
 * place, so the home and the assistant cost one read per place, not one per dish. Sold-out and
 * switched-off dishes update in place through the listeners. A missing or unreadable document just
 * leaves that place out.
 */
export function useBranchIndexDocs<T>(branchIds: string[], docId: 'dishes' | 'deals' | 'pairs'): { docs: Map<string, T>; loading: boolean } {
  const key = [...branchIds].sort().join(',');
  const [state, setState] = useState<{ key: string; docs: Record<string, T | null> }>({ key: '', docs: {} });
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const stateKey = `${docId}|${key}`;
    const unsubs = ids.map((id) =>
      onSnapshot(
        doc(db, `publicBranches/${id}/index/${docId}`),
        (snap) => setState((s) => ({ key: stateKey, docs: { ...(s.key === stateKey ? s.docs : {}), [id]: snap.exists() ? (snap.data() as T) : null } })),
        () => setState((s) => ({ key: stateKey, docs: { ...(s.key === stateKey ? s.docs : {}), [id]: null } })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [key, docId]);
  return useMemo(() => {
    const ids = key ? key.split(',') : [];
    const docs = state.key === `${docId}|${key}` ? state.docs : {};
    const out = new Map<string, T>();
    for (const id of ids) {
      const d = docs[id];
      if (d) out.set(id, d);
    }
    return { docs: out, loading: ids.some((id) => !(id in docs)) };
  }, [state, key, docId]);
}
