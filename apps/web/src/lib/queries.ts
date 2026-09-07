import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type Query, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

/** Real-time collection subscription with explicit loading/error state. Always bounded by a limit. */
export function useCollection<T = DocumentData>(path: string | null, constraints: QueryConstraint[], deps: unknown[] = []): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: !!path, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const q = query(collection(db, path), ...constraints);
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return state;
}

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  exists: boolean;
}

export function useDoc<T = DocumentData>(path: string | null): DocState<T> {
  const [state, setState] = useState<DocState<T>>({ data: null, loading: !!path, error: null, exists: false });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null, exists: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ data: snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null, loading: false, error: null, exists: snap.exists() }),
      (err) => setState({ data: null, loading: false, error: err, exists: false }),
    );
  }, [path]);
  return state;
}

/** Cursor pagination helper for tables (bounded pages, "Load more"). */
export function usePaged<T = DocumentData>(build: () => Query | null, pageSize = 20, deps: unknown[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const base = useMemo(build, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async (reset = false) => {
    if (!base) return;
    setLoading(true);
    setError(null);
    try {
      const q = reset || !cursor ? query(base, limit(pageSize)) : query(base, startAfter(cursor), limit(pageSize));
      const snap = await getDocs(q);
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      setItems((prev) => (reset ? next : [...prev, ...next]));
      setCursor(snap.docs[snap.docs.length - 1] ?? null);
      setDone(snap.docs.length < pageSize);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setDone(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  return { items, loading, error, done, loadMore: () => load(false), reload: () => load(true) };
}

export { where, orderBy, limit };
