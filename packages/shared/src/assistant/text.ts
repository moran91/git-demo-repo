/**
 * Text helpers shared by the tagger and the request reader: folding (normalizeSearch), Arabic-Indic
 * digits, digits glued to Hebrew/Arabic letters ("ל4" → "ל 4"; Arabizi "7ar" stays whole), ₪ as its own
 * word, and one-letter prefixes (הפיצה → פיצה, والبيتزا → بيتزا).
 */
import { normalizeSearch } from '../dishIndex.js';

const HE_PREFIXES = ['וה', 'שה', 'מה', 'לה', 'בה', 'כש', 'ה', 'ו', 'ב', 'ל', 'ש', 'מ', 'כ'];
const AR_PREFIXES = ['وال', 'بال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف'];
const HE_OR_AR = /[֐-׿؀-ۿ]/;

/** Arabic-Indic and Persian digits to Latin digits. */
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Folded words. */
export function tokenize(text: string): string[] {
  const s = latinDigits(text)
    .replace(/₪/g, ' ₪ ')
    .replace(/(\d)([֐-׿؀-ۿ])/g, '$1 $2')
    .replace(/([֐-׿؀-ۿ])(\d)/g, '$1 $2');
  return normalizeSearch(s).split(' ').filter(Boolean);
}

/** A folded word and the same word without one Hebrew or Arabic prefix (never leaving a stem of 2 letters or less: בקר stays בקר, not קר). */
export function wordForms(word: string): string[] {
  const out = [word];
  if (!HE_OR_AR.test(word.charAt(0))) return out;
  const prefixes = /[֐-׿]/.test(word.charAt(0)) ? HE_PREFIXES : AR_PREFIXES;
  for (const p of prefixes) if (word.startsWith(p) && word.length - p.length >= 3) out.push(word.slice(p.length));
  return out;
}

export function foldAll(words: readonly string[]): string[] {
  return words.map((w) => normalizeSearch(w)).filter(Boolean);
}

/** Single words are looked up by any word form; multi-word terms match as a phrase. */
export interface TermMatcher {
  words: Set<string>;
  phrases: string[];
}

export function termMatcher(terms: readonly string[]): TermMatcher {
  const folded = foldAll(terms);
  return { words: new Set(folded.filter((t) => !t.includes(' '))), phrases: folded.filter((t) => t.includes(' ')) };
}

export interface Prepared {
  tokens: string[];
  padded: string;
}

export function prepareText(text: string): Prepared {
  const tokens = tokenize(text);
  return { tokens, padded: ` ${tokens.join(' ')} ` };
}

/** Number of words (and phrases) of `t` found in `m`. */
export function countMatches(t: Prepared, m: TermMatcher): number {
  let n = 0;
  for (const w of t.tokens) if (wordForms(w).some((f) => m.words.has(f))) n++;
  for (const p of m.phrases) if (t.padded.includes(` ${p} `)) n++;
  return n;
}

export function isIn(word: string | undefined, set: ReadonlySet<string>): boolean {
  return !!word && wordForms(word).some((f) => set.has(f));
}
