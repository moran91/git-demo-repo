import { toLocal, type Promotion } from '@qareeb/shared';

/** `endsAt` is a calendar day in Asia/Jerusalem; the promotion is still valid on that day. */
export function promotionExpired(p: Pick<Promotion, 'endsAt'>, now = new Date()): boolean {
  return !p.endsAt || p.endsAt < toLocal(now).date;
}

/** D.M.YYYY from a YYYY-MM-DD day — no timezone conversion, it is already a local calendar day. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}
