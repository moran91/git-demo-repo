import { useMemo } from 'react';
import { buildAssistantData, prepareDishes, toAssistantPlaces, type AssistantData, type DealsIndexDoc, type DishIndexDoc, type Order, type PairsIndexDoc } from '@qareeb/shared';
import { useAuth } from '@/lib/auth';
import { cartStore } from '@/lib/cart';
import { useCollection, limit, orderBy, where } from '@/lib/queries';
import { useBranchIndexDocs } from '../dishIndex';
import { useDiscovery, useNow, type PublicBranch } from '../hooks';

/**
 * Everything the assistant reasons over for the chosen town: its restaurants (never supermarkets),
 * their dish, deal and pair indexes, the clock, the cart's place and the customer's own last orders
 * (already readable by them; the profile is computed here and never stored).
 */
export function useAssistantData(cityId: string): { data: AssistantData; branches: Map<string, PublicBranch>; loading: boolean; signedIn: boolean } {
  const restaurants = useDiscovery(cityId, 'restaurant');
  const now = useNow();
  const ids = useMemo(() => restaurants.data.map((b) => b.id), [restaurants.data]);
  const dishes = useBranchIndexDocs<DishIndexDoc>(ids, 'dishes');
  const deals = useBranchIndexDocs<DealsIndexDoc>(ids, 'deals');
  const pairs = useBranchIndexDocs<PairsIndexDoc>(ids, 'pairs');
  const { user, loading: authLoading } = useAuth();
  // The same query as the orders page, so it shares its index and its cache.
  const orders = useCollection<Order>(user ? 'orders' : null, [where('customer.uid', '==', user?.uid ?? '_'), orderBy('placedAt', 'desc'), limit(50)], [user?.uid]);
  const cartBranchId = cartStore.use().cart?.branchId;
  // Search texts are folded once per index snapshot; open/closed and the time follow the clock.
  const prepared = useMemo(() => prepareDishes(restaurants.data.map((b) => ({ branchId: b.id, name: b.businessName })), dishes.docs), [restaurants.data, dishes.docs]);
  const branches = useMemo(() => new Map(restaurants.data.map((b) => [b.id, b])), [restaurants.data]);
  const data = useMemo(
    () => buildAssistantData({ now, places: toAssistantPlaces(restaurants.data, now, cityId), dishes: prepared, deals: deals.docs, pairs: pairs.docs, orders: orders.data, ...(cartBranchId ? { cartBranchId } : {}) }),
    [restaurants.data, now, cityId, prepared, deals.docs, pairs.docs, orders.data, cartBranchId],
  );
  // Pairs only shape the upsell after an add, so the first answer does not wait for them.
  const loading = restaurants.loading || dishes.loading || deals.loading || authLoading || (!!user && orders.loading);
  return { data, branches, loading, signedIn: !!user };
}
