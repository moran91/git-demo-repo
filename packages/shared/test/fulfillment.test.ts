import { describe, expect, it } from 'vitest';
import { availableFulfillmentModes, offeredFulfillmentModes } from '../src/fulfillment.js';

const branch = { cityId: 'haifa', pickupEnabled: true, deliveryCities: [{ cityId: 'haifa', feeAgorot: 0, minSubtotalAgorot: 0 }] };

describe('dine-in switch', () => {
  it('is on for restaurants saved before the switch existed', () => {
    expect(availableFulfillmentModes('restaurant', branch, 'haifa')).toEqual(['delivery', 'pickup', 'dine_in']);
  });
  it('can be switched off by the owner', () => {
    expect(availableFulfillmentModes('restaurant', { ...branch, dineInEnabled: false }, 'haifa')).toEqual(['delivery', 'pickup']);
    expect(offeredFulfillmentModes('restaurant', { ...branch, dineInEnabled: false })).toEqual(['delivery', 'pickup']);
  });
  it('never applies to supermarkets or other cities', () => {
    expect(availableFulfillmentModes('supermarket', { ...branch, dineInEnabled: true }, 'haifa')).not.toContain('dine_in');
    expect(availableFulfillmentModes('restaurant', { ...branch, dineInEnabled: true }, 'acre')).not.toContain('dine_in');
  });
});
