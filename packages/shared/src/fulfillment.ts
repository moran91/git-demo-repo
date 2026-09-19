import type { BusinessType, FulfillmentMode } from './types.js';

export interface FulfillmentBranchLike {
  cityId: string;
  pickupEnabled: boolean;
  /** Effective delivery rules (the public projection already expands "deliver to own city"). */
  deliveryCities: ReadonlyArray<{ cityId: string; feeAgorot: number; minSubtotalAgorot: number }>;
}

/**
 * Single source of truth for "which fulfillment modes can this branch serve for a customer in
 * cityId". Used by the server (quote/place) and the storefront + checkout so the two never drift.
 * Dine-in exists only for restaurants and only when the customer is at the branch's own city.
 */
export function availableFulfillmentModes(businessType: BusinessType, branch: FulfillmentBranchLike, cityId: string): FulfillmentMode[] {
  const modes: FulfillmentMode[] = [];
  if (branch.deliveryCities.some((d) => d.cityId === cityId)) modes.push('delivery');
  if (branch.pickupEnabled && branch.cityId === cityId) modes.push('pickup');
  if (businessType === 'restaurant' && branch.cityId === cityId) modes.push('dine_in');
  return modes;
}

/** Modes a branch can serve at all (any city) — what a business card advertises. */
export function offeredFulfillmentModes(businessType: BusinessType, branch: FulfillmentBranchLike): FulfillmentMode[] {
  const modes: FulfillmentMode[] = [];
  if (branch.deliveryCities.length > 0) modes.push('delivery');
  if (branch.pickupEnabled) modes.push('pickup');
  if (businessType === 'restaurant') modes.push('dine_in');
  return modes;
}
