import type { BusinessType } from '@qareeb/shared';
import { createStore } from './store';

/** Fulfillment (delivery / pickup / dine-in) is chosen at checkout, not here. */
export interface DiscoveryPrefs {
  cityId: string;
  kind: BusinessType;
  locationEnabled?: boolean;
}
export const discoveryStore = createStore<DiscoveryPrefs>('discovery', { cityId: 'beit-jann', kind: 'restaurant' });
