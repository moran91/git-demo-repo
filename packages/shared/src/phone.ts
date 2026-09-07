/**
 * Israeli phone normalisation to E.164.
 * Accepts: 05X-XXXXXXX, 05XXXXXXXX, +9725XXXXXXXX, 9725XXXXXXXX, 0[2-9]XXXXXXX (landlines),
 * also Arabic-Indic and Eastern Arabic-Indic digits.
 */
const DIGIT_MAP: Record<string, string> = {};
for (let i = 0; i < 10; i++) {
  DIGIT_MAP[String.fromCharCode(0x0660 + i)] = String(i); // Arabic-Indic
  DIGIT_MAP[String.fromCharCode(0x06f0 + i)] = String(i); // Eastern Arabic-Indic
}

export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (c) => DIGIT_MAP[c] ?? c);
}

export function normalizeIsraeliPhone(input: string): string | null {
  let s = normalizeDigits(input).replace(/[\s\-().‎‏‪-‮]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+972')) s = '0' + s.slice(4);
  else if (s.startsWith('972')) s = '0' + s.slice(3);
  if (!/^0\d{8,9}$/.test(s)) return null;
  // Mobile 05X (10 digits) or landline 0[2-4,8-9]X (9 digits) or 07X (10 digits)
  if (/^05\d{8}$/.test(s) || /^07[2-9]\d{7}$/.test(s)) return '+972' + s.slice(1);
  if (/^0[2-489]\d{7}$/.test(s)) return '+972' + s.slice(1);
  return null;
}

export function isE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

/** Displays +972501234567 as 050-123-4567 for local readability. Wrap in <bdi> in UI. */
export function formatPhoneDisplay(e164: string): string {
  if (!e164.startsWith('+972')) return e164;
  const local = '0' + e164.slice(4);
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  if (local.length === 9) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  return local;
}
