import type { HoursOverride, OpeningInterval, WeeklyHours } from './types.js';

export const TIMEZONE = 'Asia/Jerusalem';

export interface LocalDateTime {
  /** YYYY-MM-DD in Asia/Jerusalem */
  date: string;
  /** 0-6, Sunday = 0 */
  weekday: number;
  /** minutes since local midnight */
  minutes: number;
  year: number;
  month: number;
  day: number;
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Converts an instant into Asia/Jerusalem wall-clock parts (DST handled by Intl). */
export function toLocal(instant: Date): LocalDateTime {
  const parts = Object.fromEntries(partsFmt.formatToParts(instant).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: WEEKDAYS.indexOf(parts.weekday as string),
    minutes: hour * 60 + minute,
    year,
    month,
    day,
  };
}

function previousDate(d: LocalDateTime): { date: string; weekday: number } {
  const utc = Date.UTC(d.year, d.month - 1, d.day) - 86400000;
  const p = new Date(utc);
  const date = `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, '0')}-${String(p.getUTCDate()).padStart(2, '0')}`;
  return { date, weekday: (d.weekday + 6) % 7 };
}

function intervalsFor(date: string, weekday: number, hours: WeeklyHours, overrides: HoursOverride[]): OpeningInterval[] {
  const ov = overrides.find((o) => o.date === date);
  if (ov) return ov.intervals;
  return hours[String(weekday) as keyof WeeklyHours] ?? [];
}

export interface OpenState {
  open: boolean;
  /** Minutes until the current interval closes (if open) or next opening today (if closed and known). */
  closesInMin?: number;
  opensInMin?: number;
}

/**
 * Evaluates whether a branch is open at the given instant. Overnight intervals (endMin > 1440)
 * spill into the next local day. An override for a date replaces the weekly schedule for that date.
 */
export function evaluateOpen(instant: Date, hours: WeeklyHours, overrides: HoursOverride[] = []): OpenState {
  const now = toLocal(instant);
  const today = intervalsFor(now.date, now.weekday, hours, overrides);
  for (const iv of today) {
    if (now.minutes >= iv.startMin && now.minutes < iv.endMin) {
      return { open: true, closesInMin: iv.endMin - now.minutes };
    }
  }
  // Overnight spill from yesterday
  const prev = previousDate(now);
  const yesterday = intervalsFor(prev.date, prev.weekday, hours, overrides);
  for (const iv of yesterday) {
    if (iv.endMin > 1440 && now.minutes + 1440 < iv.endMin && now.minutes + 1440 >= iv.startMin) {
      return { open: true, closesInMin: iv.endMin - 1440 - now.minutes };
    }
  }
  const upcoming = today.filter((iv) => iv.startMin > now.minutes).sort((a, b) => a.startMin - b.startMin)[0];
  return { open: false, opensInMin: upcoming ? upcoming.startMin - now.minutes : undefined };
}

export function minutesToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function validateInterval(iv: OpeningInterval): boolean {
  return (
    Number.isInteger(iv.startMin) &&
    Number.isInteger(iv.endMin) &&
    iv.startMin >= 0 &&
    iv.startMin < 1440 &&
    iv.endMin > iv.startMin &&
    iv.endMin <= 2880
  );
}

export const EMPTY_WEEK: WeeklyHours = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] };

/** Format an ISO instant for operational display in Asia/Jerusalem. */
export function formatLocalDateTime(iso: string | Date, locale: 'he' | 'ar' | 'en' = 'he'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const l = { he: 'he-IL', ar: 'ar-IL', en: 'en-IL' }[locale] + '-u-nu-latn';
  return new Intl.DateTimeFormat(l, {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function formatLocalTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
