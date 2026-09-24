import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Membership, UserProfile } from '@qareeb/shared';
import { auth, db } from './firebase';
import { call } from './api';
import { useI18n } from './i18n';
import { clearCart } from './cart';
import { disablePush, syncPushToken } from './push';
import { getRegistration } from './sw';

interface AuthCtx {
  user: User | null;
  profile: UserProfile | null;
  memberships: Membership[];
  membershipsError: Error | null;
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
  const [membershipsError, setMembershipsError] = useState<Error | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [membershipUid, setMembershipUid] = useState<string | null>(null);
  /**
   * The token listener below is registered once, so a captured `locale` would be frozen at mount.
   * Firebase refreshes the ID token about hourly, and each refresh re-sends it to ensureProfile —
   * with a stale value that silently overwrote the language the user had chosen since, which is what
   * notifications are translated into. Read the current locale through a ref instead.
   */
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

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
    let generation = 0;
    const unsubscribe = onIdTokenChanged(auth, async (u) => {
      const current = ++generation;
      setUser(u);
      if (!u) {
        setProfile(null);
        setMemberships([]);
        setMembershipUid(null);
        setMembershipsError(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      try {
        const token = await u.getIdTokenResult();
        if (current !== generation) return;
        setIsAdmin(token.claims.admin === true);
        const res = await call<{ profile: UserProfile }>('ensureProfile', { locale: localeRef.current });
        if (current !== generation) return;
        setProfile(res.profile);
        // Sign-out deletes this device's token but leaves the browser permission granted, so a new
        // session has to register again or it silently receives nothing.
        void syncPushToken(u.uid, localeRef.current, getRegistration());
      } catch {
        if (current !== generation) return;
        setProfile(null);
      }
      setLoading(false);
    });
    return () => { generation++; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    // `profile?.uid` is in the deps on purpose: firestore.rules only allows this query once
    // users/{uid} exists, which ensureProfile creates. A brand-new owner subscribed first, was
    // denied, and the dashboard showed a load error for the rest of the session.
    const q = query(collection(db, 'memberships'), where('uid', '==', user.uid), where('active', '==', true));
    return onSnapshot(q, (snap) => { setMemberships(snap.docs.map((d) => d.data() as Membership)); setMembershipsError(null); setMembershipUid(user.uid); }, (error) => { setMemberships([]); setMembershipsError(error); setMembershipUid(user.uid); });
  }, [user, profile?.uid]);

  const signOut = useCallback(async () => {
    // Clear account-specific state on sign-out (cart, prefs stay device-local but are cleared for privacy).
    clearCart();
    // The checkout form (name, phone, note, chosen address) lives in sessionStorage and survives a
    // sign-out in the same tab, so the next person to sign in inherited it.
    try {
      sessionStorage.removeItem('qareeb.checkout.form');
      sessionStorage.removeItem('qareeb.cart.quotedTotal');
    } catch {
      /* ignore */
    }
    // Forgetting the token locally is not enough: it stays registered under the signed-out user, so
    // the server keeps pushing their notifications to this device. Unregister before losing auth.
    const uid = auth.currentUser?.uid;
    if (uid) await disablePush(uid).catch(() => undefined);
    await fbSignOut(auth);
  }, []);

  const ready = !loading && (!user || membershipUid === user.uid);
  const value = useMemo(() => ({ user, profile, membershipsError, memberships: ready ? memberships : [], isAdmin: isAdmin && profile?.isAdmin === true, loading: !ready, refreshProfile, signOut }), [user, profile, memberships, membershipsError, isAdmin, ready, refreshProfile, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
