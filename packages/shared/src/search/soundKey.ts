/**
 * A consonant skeleton that is the same for one food word written in Hebrew, Arabic, English or
 * Arabizi (Arabic in Latin letters with digits): كبب, קבב, קובב, kobbab and kubbab all give "KB";
 * باستا, פסטה and pasta give "BST"; פיצה, بيتزا and pizza give "BS".
 *
 * Vowels and vowel letters are dropped, look-alike consonants share one class, repeats collapse.
 * The classes are deliberately coarse (b/p/f/v, s/sh/z/ts/tz/ch) because food words cross scripts
 * through loans that swap exactly these sounds; the tiering in match.ts keeps loose matches below
 * exact ones.
 */
import { normalizeSearch } from '../dishIndex.js';

const HEBREW: Record<string, string> = {
  'ב': 'B', 'פ': 'B', 'ק': 'K', 'כ': 'K', 'ח': 'H', 'ה': 'H', 'ג': 'G', 'ד': 'D', 'ז': 'S', 'ט': 'T', 'ת': 'T',
  'ל': 'L', 'מ': 'M', 'נ': 'N', 'ס': 'S', 'ש': 'S', 'צ': 'S', 'ר': 'R',
  // Vowel letters and gutturals that transliterations drop.
  'א': '', 'ו': '', 'י': '', 'ע': '',
};
const ARABIC: Record<string, string> = {
  'ب': 'B', 'ف': 'B', 'پ': 'B', 'ق': 'K', 'ك': 'K', 'ح': 'H', 'خ': 'H', 'ه': 'H', 'ج': 'G', 'غ': 'G', 'د': 'D', 'ذ': 'D', 'ض': 'D',
  'ز': 'S', 'ظ': 'S', 'س': 'S', 'ش': 'S', 'ص': 'S', 'ط': 'T', 'ت': 'T', 'ث': 'T', 'ل': 'L', 'م': 'M', 'ن': 'N', 'ر': 'R',
  'ا': '', 'و': '', 'ي': '', 'ى': '', 'ع': '', 'ء': '', 'ئ': '', 'ؤ': '',
};
const LATIN: Record<string, string> = {
  b: 'B', p: 'B', f: 'B', v: 'B', k: 'K', q: 'K', c: 'K', h: 'H', g: 'G', j: 'G', d: 'D', t: 'T', l: 'L', m: 'M', n: 'N',
  s: 'S', z: 'S', r: 'R', x: 'KS',
  a: '', e: '', i: '', o: '', u: '', y: '', w: '',
  // Arabizi digits: 2 hamza, 3 ayin (both dropped like the letters), 5 khaa, 6 taa, 7 haa, 9 qaaf.
  '2': '', '3': '', '5': 'H', '6': 'T', '7': 'H', '9': 'K', '8': 'G',
};
/** Latin digraphs first: sh/ch/tz/ts → S, kh → H, gh → G, th/dh → T/D, ph → B, ck → K. */
const DIGRAPHS: Array<[RegExp, string]> = [
  [/sh|ch|tz|ts/g, 's'], [/kh/g, '5'], [/gh/g, '8'], [/th/g, 't'], [/dh/g, 'd'], [/ph/g, 'f'], [/ck/g, 'k'], [/c(?=[eiy])/g, 's'],
];

function keyOfWord(word: string): string {
  let w = word;
  if (/[a-z]/.test(w)) {
    for (const [re, to] of DIGRAPHS) w = w.replace(re, to);
    // A Latin word-final h after a vowel is silent (kibbeh, knafeh).
    w = w.replace(/([aeiouy])h$/, '$1');
  }
  // Word-final ה / ه is a vowel ending in both scripts (פסטה, كبة).
  w = w.replace(/[הه]$/, '');
  let out = '';
  for (const ch of w) out += HEBREW[ch] ?? ARABIC[ch] ?? LATIN[ch] ?? '';
  // Arabic/Hebrew "t + z/s" (بيتزا) is the same affricate as צ: TS → S.
  out = out.replace(/TS/g, 'S');
  // Collapse repeats: kobbab → KBB → KB.
  return out.replace(/(.)\1+/g, '$1');
}

/** Sound key of every word in the text, in order. */
export function soundKeys(text: string): string[] {
  return normalizeSearch(text).split(' ').filter(Boolean).map(keyOfWord);
}

/** Sound key of a single word (the whole text, spaces removed, when given several). */
export function soundKey(text: string): string {
  return soundKeys(text).join('');
}
