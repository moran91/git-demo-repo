import { describe, expect, it } from 'vitest';
import { nearestSupportedCity } from '../src/location.js';
import type { City } from '../src/types.js';

const cities: City[] = [
  { id: 'beit-jann', name: { en: 'Beit Jann' }, aliases: [], active: true, sortOrder: 0, lat: 32.9628, lng: 35.3822 },
  { id: 'hurfeish', name: { en: 'Hurfeish' }, aliases: [], active: true, sortOrder: 1, lat: 33.0167, lng: 35.35 },
];

describe('device location selects a nearby supported town', () => {
  it('chooses the closest active town, independent of list order', () => {
    expect(nearestSupportedCity(cities, 33.0165, 35.351)?.id).toBe('hurfeish');
    expect(nearestSupportedCity([...cities].reverse(), 32.963, 35.382)?.id).toBe('beit-jann');
  });
  it('ignores missing coordinates, invalid centres and disabled towns', () => {
    expect(nearestSupportedCity([{ ...cities[0]!, lat: undefined }, { ...cities[1]!, active: false }, { ...cities[0]!, lat: 190 }], 32.9628, 35.3822)).toBeNull();
  });
  it('does not silently switch someone far away into the service area', () => {
    expect(nearestSupportedCity(cities, 51.5074, -0.1278)).toBeNull();
  });
  it('rejects invalid positions and handles an empty service area', () => {
    expect(nearestSupportedCity(cities, NaN, 35)).toBeNull();
    expect(nearestSupportedCity(cities, 32, 181)).toBeNull();
    expect(nearestSupportedCity([], 32.96, 35.38)).toBeNull();
  });
});
