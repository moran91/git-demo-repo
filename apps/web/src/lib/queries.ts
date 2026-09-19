import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type Query, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from './firebase';

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

/** Real-time collection subscription with explicit loading/error state. Always bounded by a limit. */
export function useCollection<T = DocumentData>(path: string | null, constraints: QueryConstraint[], deps: unknown[] = []): QueryState<T> {
  const key = JSON.stringify([path, ...deps]);
  const [state, setState] = useState<QueryState<T> & { key: string }>({ key, data: [], loading: !!path, error: null });
  useEffect(() => {
    if (!path) {
      setState({ key, data: [], loading: false, error: null });
      return;
    }
    setState({ key, data: [], loading: true, error: null });
    const q = query(collection(db, path), ...constraints);
    return onSnapshot(
      q,
      (snap) => setState({ key, data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T), loading: false, error: null }),
      (err) => setState({ key, data: [], loading: false, error: err }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { data: [], loading: !!path, error: null };
}

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  exists: boolean;
}

export function useDoc<T = DocumentData>(path: string | null): DocState<T> {
  const [state, setState] = useState<DocState<T> & { path: string | null }>({ path, data: null, loading: !!path, error: null, exists: false });
  useEffect(() => {
    if (!path) {
      setState({ path, data: null, loading: false, error: null, exists: false });
      return;
    }
    setState({ path, data: null, loading: true, error: null, exists: false });
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ path, data: snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null, loading: false, error: null, exists: snap.exists() }),
      (err) => setState({ path, data: null, loading: false, error: err, exists: false }),
    );
  }, [path]);
  return state.path === path ? state : { data: null, loading: !!path, error: null, exists: false };
}

/** Cursor pagination helper for tables (bounded pages, "Load more"). */
export function usePaged<T = DocumentData>(build: () => Query | null, pageSize = 20, deps: unknown[] = []) {
  const base = useMemo(build, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const generation = useRef(0);
  const pending = useRef(false);
  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const [state, setState] = useState<{ base: Query | null; items: T[]; loading: boolean; error: Error | null; done: boolean }>({ base, items: [], loading: !!base, error: null, done: !base });
  const load = async (reset = false) => {
    if (!base || (!reset && pending.current)) return;
    const request = reset ? ++generation.current : generation.current;
    pending.current = true;
    setState((s) => ({ ...s, base, items: reset ? [] : s.items, loading: true, error: null }));
    try {
      const q = reset || !cursor.current ? query(base, limit(pageSize)) : query(base, startAfter(cursor.current), limit(pageSize));
      const snap = await getDocs(q);
      if (request !== generation.current) return;
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      cursor.current = snap.docs[snap.docs.length - 1] ?? null;
      setState((s) => ({ base, items: reset ? next : [...s.items, ...next], loading: false, error: null, done: snap.docs.length < pageSize }));
    } catch (e) {
      if (request === generation.current) setState((s) => ({ ...s, loading: false, error: e as Error }));
    } finally {
      if (request === generation.current) pending.current = false;
    }
  };
  useEffect(() => {
    cursor.current = null;
    pending.current = false;
    if (base) void load(true);
    else setState({ base, items: [], loading: false, error: null, done: true });
    return () => { generation.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  const current = state.base === base ? state : { items: [], loading: !!base, error: null, done: !base };
  return { ...current, loadMore: () => load(false), reload: () => load(true) };
}

export { where, orderBy, limit };
