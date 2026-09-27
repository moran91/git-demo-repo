/**
 * Wrong-keyboard fix: text typed with the keyboard set to the wrong language, read back as the
 * letters the same keys give on the other layouts. "phmv" on an English keyboard is "פיצה" on the
 * Hebrew one; "زهففش" typed on Arabic is "pizza". Layouts: Israeli SI-1452 and Arabic (101).
 */
const QWERTY = "qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const HEBREW = "/'קראטוןםפ][שדגכעיחלךף,זסבהנמצתץ.";
const ARABIC = 'ضصثقفغعهخحجدشسيبلاتنمكطئءؤرلاىةوزظ';

// The Arabic row has one two-letter key: b → لا. Split so indexes line up with QWERTY.
const ARABIC_KEYS = [...ARABIC.replace('رلاى', 'ر\u0000ى')].map((c) => (c === '\u0000' ? 'لا' : c));

function table(from: string[], to: string[]): Map<string, string> {
  const m = new Map<string, string>();
  from.forEach((f, i) => {
    if (to[i] !== undefined && !m.has(f)) m.set(f, to[i]!);
  });
  return m;
}

const LATIN_TO_HE = table([...QWERTY], [...HEBREW]);
const LATIN_TO_AR = table([...QWERTY], ARABIC_KEYS);
const HE_TO_LATIN = table([...HEBREW], [...QWERTY]);
const AR_TO_LATIN = table(ARABIC_KEYS, [...QWERTY]);

function convert(text: string, map: Map<string, string>): string {
  let out = '';
  // لا is one key; read it before its two letters.
  const src = map === AR_TO_LATIN ? text.replace(/لا/g, '\u0000') : text;
  for (const ch of src) out += ch === '\u0000' ? (map.get('لا') ?? '') : (map.get(ch) ?? ch);
  return out;
}

/** The query as it would read on the other keyboards, most likely first; empty when nothing changes. */
export function layoutAlternatives(raw: string): string[] {
  const text = raw.toLowerCase();
  const out: string[] = [];
  if (/[a-z]/.test(text) && !/[֐-׿؀-ۿ]/.test(text)) out.push(convert(text, LATIN_TO_HE), convert(text, LATIN_TO_AR));
  else if (/[֐-׿]/.test(text) && !/[a-z؀-ۿ]/.test(text)) out.push(convert(text, HE_TO_LATIN));
  else if (/[؀-ۿ]/.test(text) && !/[a-z֐-׿]/.test(text)) out.push(convert(text, AR_TO_LATIN));
  return out.filter((alt) => alt.trim() && alt !== text);
}
