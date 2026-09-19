import type { City } from './types.js';

/** Town centres are an approximation, not delivery boundaries. Never pick a remote town. */
export const MAX_CITY_DISTANCE_KM = 25;

export function nearestSupportedCity(cities: City[], latitude: number, longitude: number): City | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  let nearest: City | null = null;
  let best = MAX_CITY_DISTANCE_KM;
  for (const city of cities) {
    if (!city.active || city.lat == null || city.lng == null || !Number.isFinite(city.lat) || !Number.isFinite(city.lng) || Math.abs(city.lat) > 90 || Math.abs(city.lng) > 180) continue;
    const a = Math.sin(radians(city.lat - latitude) / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(city.lat)) * Math.sin(radians(city.lng - longitude) / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    if (distance < best) { best = distance; nearest = city; }
  }
  return nearest;
}
