import type { BusinessType, FulfillmentMode } from '@qareeb/shared';
import { createStore } from './store';

export interface DiscoveryPrefs {
  cityId: string;
  mode: FulfillmentMode;
  kind: BusinessType;
}
export const discoveryStore = createStore<DiscoveryPrefs>('discovery', { cityId: 'beit-jann', mode: 'delivery', kind: 'restaurant' });
