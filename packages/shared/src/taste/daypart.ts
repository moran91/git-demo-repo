import { toLocal } from '../hours.js';
import type { Daypart } from './types.js';

/** The daypart an instant falls in, by Israeli wall-clock time. */
export function daypartOf(instant: Date): Daypart {
  const hour = Math.floor(toLocal(instant).minutes / 60);
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'noon';
  if (hour >= 16 && hour < 22) return 'evening';
  return 'late';
}
