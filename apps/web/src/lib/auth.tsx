import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Membership, UserProfile } from '@qareeb/shared';
import { auth, db } from './firebase';
import { call } from './api';
import { useI18n } from './i18n';
import { clearCart } from './cart';

interface AuthCtx {
  user: User | null;
  profile: UserProfile | null;
  memberships: Membership[];
  isAdmin: boolean;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const res = await call<{ profile: UserProfile }>('ensureProfile', { locale });
      setProfile(res.profile);
    } catch {
      /* keep previous profile; suspended users get errors on actions */
    }
  }, [locale]);

  useEffect(() => {
    return onIdTokenChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setProfile(null);
        setMemberships([]);
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const token = await u.getIdTokenResult();
      setIsAdmin(token.claims.admin === true);
      try {
        const res = await call<{ profile: UserProfile }>('ensureProfile', { locale });
        setProfile(res.profile);
      } catch {
        setProfile(null);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'memberships'), where('uid', '==', user.uid), where('active', '==', true));
    return onSnapshot(q, (snap) => setMemberships(snap.docs.map((d) => d.data() as Membership)), () => setMemberships([]));
  }, [user]);

  const signOut = useCallback(async () => {
    // Clear account-specific state on sign-out (cart, prefs stay device-local but are cleared for privacy).
    clearCart();
    try {
      localStorage.removeItem('qareeb.push.token');
    } catch {
      /* ignore */
    }
    await fbSignOut(auth);
  }, []);

  const value = useMemo(() => ({ user, profile, memberships, isAdmin: isAdmin && profile?.isAdmin === true, loading, refreshProfile, signOut }), [user, profile, memberships, isAdmin, loading, refreshProfile, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
