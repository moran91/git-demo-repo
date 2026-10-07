import { toLocal } from '../hours.js';

/**
 * spendDaily/{YYYY-MM-DD} (Israeli date): what the AI and translation cost that day, in micro-USD.
 * Bumped with FieldValue.increment by the functions; read live by the admin costs page. Counts and
 * costs only: no wish text, uid or IP.
 */
export interface SpendDay {
  ai: {
    microUsd: number;
    /** Worst-case cost held for AI calls in flight (see reserveAiBudget); released as each call settles. */
    reservedMicroUsd?: number;
    /** Spend and holds of signed-out wishes, limited to a share of the cap. */
    anonMicroUsd?: number;
    anonReservedMicroUsd?: number;
    /** Wishes handled by suggestMeals, AI or not. */
    calls: number;
    /** Answered by the AI. */
    ok: number;
    /** No AI consent, or the AI is switched off. */
    skipped: number;
    fallback: { timeout: number; invalid: number; error: number; capped: number };
    inTok: number;
    outTok: number;
    inMicroUsd: number;
    outMicroUsd: number;
    /** AI calls answered within 3 s. */
    fast: number;
    byModel: Record<string, { microUsd: number; calls: number }>;
  };
  translate: { microUsd: number; chars: number; jobs: number };
  /** '00'–'23' Israeli hour → micro-USD. */
  byHour: Record<string, { aiIn?: number; aiOut?: number; translate?: number }>;
  updatedAt: string;
}

export type AiOutcome = 'ok' | 'timeout' | 'invalid' | 'error' | 'capped' | 'skipped';

/** $2 a day unless an admin sets another cap (config/platform.aiDailyCapMicroUsd). */
export const DEFAULT_AI_CAP_MICRO_USD = 2_000_000;
/** Cloud Translation: $20 per million characters, the first 500,000 each month free. */
export const TRANSLATE_MICRO_USD_PER_CHAR = 20;
export const TRANSLATE_FREE_CHARS = 500_000;

export function israelDay(now: Date): string {
  return toLocal(now).date;
}

export function israelHour(now: Date): string {
  return String(Math.floor(toLocal(now).minutes / 60)).padStart(2, '0');
}

export function hourTotal(h: SpendDay['byHour'][string] | undefined): number {
  return (h?.aiIn ?? 0) + (h?.aiOut ?? 0) + (h?.translate ?? 0);
}

export function dayTotal(d: Pick<SpendDay, 'ai' | 'translate'> | null | undefined): number {
  return (d?.ai?.microUsd ?? 0) + (d?.translate?.microUsd ?? 0);
}

/**
 * Today's spend so far plus, for each hour still to come, that hour's average over the previous
 * days given (normally the last 7).
 */
export function projectEndOfDay(today: SpendDay | null, previous: SpendDay[], hour: number): number {
  let total = dayTotal(today);
  if (previous.length === 0) return total;
  for (let h = hour + 1; h < 24; h++) {
    const key = String(h).padStart(2, '0');
    total += previous.reduce((s, d) => s + hourTotal(d.byHour?.[key]), 0) / previous.length;
  }
  return Math.round(total);
}

/**
 * Month to date, and the month's projection: month to date plus the average of the last 7 days
 * before today (or today alone when there is no history) for each day left in the month.
 */
export function projectMonth(days: Array<{ id: string; total: number }>, now: Date): { monthToDate: number; projection: number } {
  const local = toLocal(now);
  const month = local.date.slice(0, 7);
  const today = local.date;
  const monthToDate = days.filter((d) => d.id.startsWith(month) && d.id <= today).reduce((s, d) => s + d.total, 0);
  const before = days.filter((d) => d.id < today).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 7);
  const avg = before.length ? before.reduce((s, d) => s + d.total, 0) / before.length : (days.find((d) => d.id === today)?.total ?? 0);
  const daysInMonth = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
  return { monthToDate, projection: Math.round(monthToDate + avg * (daysInMonth - local.day)) };
}
