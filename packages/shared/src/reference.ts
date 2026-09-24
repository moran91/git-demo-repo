/** Order references are per-business sequential numbers ("1001", "1002", …) handed out by placeOrder — short and
 *  digits-only so staff can call them out at the counter. Orders placed before this keep their legacy "Q-XXXXX". */
export const FIRST_ORDER_NUMBER = 1001;
export function isNumericReference(ref: string): boolean {
  return /^\d+$/.test(ref);
}
export function makeId(len = 20, random: () => number = Math.random): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(random() * chars.length)];
  return s;
}
