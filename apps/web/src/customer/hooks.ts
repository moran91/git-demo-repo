import { useEffect, useMemo, useState } from 'react';
import { doc, deleteDoc, setDoc } from 'firebase/firestore';
import { evaluateOpen, type City, type Combo, type Favorite, type HoursOverride, type Promotion, type WeeklyHours } from '@qareeb/shared';
import { db } from '@/lib/firebase';
import { useCollection, useDoc, orderBy, where, limit } from '@/lib/queries';
import { useAuth } from '@/lib/auth';

export interface PublicBranch {
  id: string;
  businessId: string;
  type: 'restaurant' | 'supermarket';
  name: Record<string, string>;
  businessName: Record<string, string>;
  businessDefaultLocale: 'he' | 'ar' | 'en';
  logoPath?: string;
  coverPath?: string;
  cityId: string;
  locationDescription: Record<string, string>;
  phone: string;
  hours: WeeklyHours;
  hoursOverrides: HoursOverride[];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryCities: Array<{ cityId: string; feeAgorot: number; minSubtotalAgorot: number }>;
  deliveryCityIds: string[];
  ordersPaused: boolean;
  visible: boolean;
}

export interface PublicBusiness {
  id: string;
  type: 'restaurant' | 'supermarket';
  name: Record<string, string>;
  description: Record<string, string>;
  defaultLocale: 'he' | 'ar' | 'en';
  logoPath?: string;
  coverPath?: string;
  publicPhone?: string;
  loyaltyEnabled: boolean;
  loyaltyMaxDiscountPercent: number;
  loyaltyRedeemValueAgorot: number;
}

/** Ticks every 30s so open/closed state follows server-defined hours without a reload. */
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useOpenState(branch: Pick<PublicBranch, 'hours' | 'hoursOverrides'> | null | undefined) {
  const now = useNow();
  return useMemo(() => (branch ? evaluateOpen(now, branch.hours, branch.hoursOverrides ?? []) : { open: false }), [branch, now]);
}

export function useCities() {
  const { data, loading, error } = useCollection<City>('cities', [where('active', '==', true), orderBy('sortOrder'), limit(100)]);
  return { cities: data, loading, error };
}

export function useCity(cityId: string) {
  return useDoc<City>(`cities/${cityId}`);
}

export function useDiscovery(cityId: string, kind: 'restaurant' | 'supermarket') {
  // Fulfillment is picked at checkout, so the home page lists every branch that can serve the city
  // in at least one way: delivers to it, or is located in it (pickup / dine-in). Two queries merged
  // client-side because Firestore cannot OR an array-contains with an equality on another field.
  const delivering = useCollection<PublicBranch>('publicBranches', [where('visible', '==', true), where('type', '==', kind), where('deliveryCityIds', 'array-contains', cityId), limit(60)], [cityId, kind]);
  const local = useCollection<PublicBranch>('publicBranches', [where('visible', '==', true), where('type', '==', kind), where('cityId', '==', cityId), limit(60)], [cityId, kind]);
  return useMemo(() => {
    const seen = new Set<string>();
    const data: PublicBranch[] = [];
    for (const b of [...local.data, ...delivering.data]) {
      if (seen.has(b.id)) continue;
      // A local branch with neither pickup nor delivery nor dine-in (supermarket) cannot be ordered from.
      if (b.cityId === cityId && !b.pickupEnabled && b.type !== 'restaurant' && !b.deliveryCityIds.includes(cityId)) continue;
      seen.add(b.id);
      data.push(b);
    }
    return { data, loading: delivering.loading || local.loading, error: delivering.error ?? local.error };
  }, [delivering, local, cityId]);
}

export function useFavorites() {
  const { user } = useAuth();
  const { data } = useCollection<Favorite>(user ? `users/${user.uid}/favorites` : null, [limit(200)], [user?.uid]);
  const ids = useMemo(() => new Set(data.map((f) => f.id)), [data]);
  const toggle = async (fav: Omit<Favorite, 'createdAt'>) => {
    if (!user) return false;
    const ref = doc(db, `users/${user.uid}/favorites/${fav.id}`);
    if (ids.has(fav.id)) await deleteDoc(ref);
    else await setDoc(ref, { ...fav, createdAt: new Date().toISOString() });
    return true;
  };
  return { favorites: data, ids, toggle, signedIn: !!user };
}

export function useCombos(branchId: string | null) {
  return useCollection<Combo>(branchId ? `publicBranches/${branchId}/combos` : null, [orderBy('sortOrder'), limit(50)], [branchId]);
}

/** Active promotions of a branch; expiry (`endsAt`) is applied by the caller. */
export function usePromotions(branchId: string | null) {
  return useCollection<Promotion>(branchId ? `publicBranches/${branchId}/promotions` : null, [orderBy('sortOrder'), limit(20)], [branchId]);
}
