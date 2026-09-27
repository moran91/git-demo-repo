/**
 * Cross-language dish matching, built for search-as-you-type. Each query word gets a level (lower is
 * better) at the best place it fits:
 *   0 a whole word of the dish name or dish-type words      1 the start of a name word
 *   2 inside a name word (3+ letters)                        3 a name word from the food word list
 *                                                              for the half-typed word ("chi" → עוף)
 *   4 sounds like a name word (باستا → פסטה)                 5 a typo of a name word or food word, or
 *                                                              a loose sound match while still typing
 *   6 the description (exact words only)                     7 the place name
 * Word-list translations (دجاج → עוף) count as the word itself. Every query word must match; a dish
 * scores by its worst word, then the sum. The last word is still being typed unless a space follows.
 */
import { normalizeSearch } from '../dishIndex.js';
import { LEXICON } from './lexicon.js';
import { soundKey } from './soundKey.js';

export interface MatchFields {
  /** Dish name in every language, space-joined. */
  name: string;
  /** Description in every language. */
  description: string;
  /** Dish-type words in every language (DISH_TYPE_WORDS). */
  type: string;
  /** Place (business) name in every language. */
  place: string;
}

/** A dish's texts folded and sound-keyed once (per index snapshot), not on every keystroke. */
export interface PreparedFields {
  name: string;
  nameWords: string[];
  /** [sound key, word] of each name word (and its stem without an article). */
  nameKeys: Array<[string, string]>;
  description: string;
  place: string;
  placeKeys: Array<[string, string]>;
}

interface QueryWord {
  /** What was typed, plus the word without an article (الفلافل → فلافل, הפיצה → פיצה). */
  typed: string[];
  /** Word-list translations of the typed word. */
  meanings: string[];
  /** Word-list entries the half-typed word begins (last word only). */
  partial: string[];
  /** Word-list entries one or two typos away. */
  typoMeanings: string[];
  /** Still being typed: the last word, no space after it. */
  open: boolean;
}

export interface SearchQuery {
  words: QueryWord[];
}

/** Levels past this are description and place matches; MAX_LEVEL + 1 means no match. */
const MAX_LEVEL = 7;

const lexiconIndex: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of LEXICON) {
    const norm = group.map(normalizeSearch).filter(Boolean);
    for (const w of norm) m.set(w, [...new Set([...(m.get(w) ?? []), ...norm])]);
  }
  return m;
})();
const lexiconWords = [...lexiconIndex.keys()];

/** The word plus every translation / spelling the food word list knows for it. */
export function expandQueryWord(word: string): string[] {
  const w = normalizeSearch(word);
  const group = lexiconIndex.get(w);
  return group ? [w, ...group.filter((g) => g !== w)] : [w];
}

/** Arabic ال and Hebrew ה are "the": الفلافل is فلافل, הפיצה is פיצה. */
function stems(word: string): string[] {
  if (word.length >= 5 && word.startsWith('ال')) return [word, word.slice(2)];
  if (word.length >= 4 && word.startsWith('ה')) return [word, word.slice(1)];
  return [word];
}

/** Optimal string alignment distance, giving up once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      cur.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Typos allowed in a word. Latin: none below 5 letters (cola ≠ coca), one, then two from 8. Hebrew and
 * Arabic skip most vowels, so one letter is a different word sooner (פלאפל / פלפל): from 6 and 9.
 */
function typoBudget(word: string): number {
  const min = /[a-z]/.test(word) ? 5 : 6;
  return word.length >= min + 3 ? 2 : word.length >= min ? 1 : 0;
}

/** Parse once per keystroke; null for an empty query. */
export function parseQuery(raw: string): SearchQuery | null {
  const words = normalizeSearch(raw).split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const endsOpen = !/\s$/.test(raw);
  return {
    words: words.map((w, i) => {
      const open = endsOpen && i === words.length - 1;
      const typed = stems(w);
      const meanings = [...new Set(typed.flatMap((t) => expandQueryWord(t)))].filter((m) => !typed.includes(m));
      const known = new Set([...typed, ...meanings]);
      const partial = open && w.length >= 3
        ? [...new Set(lexiconWords.filter((lw) => lw.split(' ').some((p) => p.startsWith(w))).flatMap((lw) => lexiconIndex.get(lw)!))].filter((m) => !known.has(m))
        : [];
      const budget = typoBudget(w);
      const typoMeanings = budget && !lexiconIndex.has(w)
        ? [...new Set(lexiconWords.filter((lw) => editDistance(w, lw, budget) <= budget).flatMap((lw) => lexiconIndex.get(lw)!))].filter((m) => !known.has(m))
        : [];
      return { typed, meanings, partial, typoMeanings, open };
    }),
  };
}

export function prepareFields(f: MatchFields): PreparedFields {
  const name = normalizeSearch(`${f.name} ${f.type}`);
  const nameWords = name.split(' ').filter(Boolean);
  const place = normalizeSearch(f.place);
  const keysOf = (words: string[]) => words.flatMap(stems).map((w): [string, string] => [soundKey(w), w]).filter(([k]) => k);
  return {
    name,
    nameWords,
    nameKeys: keysOf(nameWords),
    description: normalizeSearch(f.description),
    place,
    placeKeys: keysOf(place.split(' ').filter(Boolean)),
  };
}

/**
 * Where a variant sits in the text: 0 whole word, 1 start of a word, 2 inside a word, or null.
 * One- and two-letter variants only count as a whole word or, when typed, a word start: "תה" (tea) is
 * not "פיתה", but typing "פי" already shows פיצה.
 */
function position(v: string, text: string, typed: boolean): 0 | 1 | 2 | null {
  const padded = ` ${text} `;
  if (padded.includes(` ${v} `)) return 0;
  if (v.length <= 2 && !typed) return null;
  if (padded.includes(` ${v}`)) return 1;
  if (v.length >= 3 && text.includes(v)) return 2;
  return null;
}

/**
 * Sound match: the typed word needs 3+ letters and a key of 2+ sounds. A 2-sound key must equal a
 * word's key (קבב ≠ כבד); a longer key may be the start of a word's key (past → pasta). With `loose`,
 * a half-typed Latin word of 5+ letters (vowels and all) may start a word's key too (shawar →
 * שווארמה). Only what the customer typed is sounded out, never word-list translations: "دجاج" →
 * "עופות" (B-T) would otherwise match "בטטה".
 */
function soundsLike(q: QueryWord, keys: Array<[string, string]>, loose = false): boolean {
  return q.typed.some((t) => {
    if (t.replace(/\s/g, '').length < 3) return false;
    const key = soundKey(t);
    if (key.length < 2) return false;
    return keys.some(([k, word]) => (key.length === 2 && !(loose && t.length >= 5 && /[a-z]/.test(t)) ? k === key : k.startsWith(key)) && !otherFood(q, word));
  });
}

/**
 * A word the food word list knows as a different food than the typed one: פלאפל and פלפל (falafel,
 * pepper) share every consonant, so a sound or typo match must not cross between known foods.
 */
function otherFood(q: QueryWord, word: string): boolean {
  // A half-typed word counts as the foods it begins: "גבינ" (cheese…) is not "עגבניות" (tomatoes).
  if (q.meanings.length === 0 && q.partial.length === 0) return false;
  return lexiconIndex.has(word) && !q.typed.includes(word) && !q.meanings.includes(word) && !q.partial.includes(word);
}

function typoOf(q: QueryWord, words: string[]): boolean {
  return q.typed.some((w) => {
    const budget = typoBudget(w);
    if (!budget) return false;
    // A half-typed word is compared with the start of each word too: "hambr" is "hambu(rger)".
    return words.some((x) => !otherFood(q, x) && (editDistance(w, x, budget) <= budget || (q.open && x.length > w.length && editDistance(w, x.slice(0, w.length), 1) <= 1)));
  });
}

function wordLevel(q: QueryWord, f: PreparedFields): number {
  let best = MAX_LEVEL + 1;
  for (const v of q.typed) {
    const p = position(v, f.name, true);
    if (p !== null) best = Math.min(best, p);
  }
  for (const v of q.meanings) {
    const p = position(v, f.name, false);
    if (p !== null) best = Math.min(best, p);
  }
  if (best <= 2) return best;
  if (q.partial.some((v) => position(v, f.name, false) !== null)) return 3;
  // A half-typed word the word list already reads as foods ("mushro") is not sounded out: its
  // translations cover it, and its sound only adds look-alikes (mozzarella).
  const sound = !(q.open && q.meanings.length === 0 && q.partial.length > 0);
  if (sound && soundsLike(q, f.nameKeys)) return 4;
  if (typoOf(q, f.nameWords) || q.typoMeanings.some((v) => position(v, f.name, false) !== null) || (sound && q.open && soundsLike(q, f.nameKeys, true))) return 5;
  // Descriptions and place names match exact words only (a lone letter never does): sounding out long
  // texts found "slush" in "صلصة" (sauce).
  if ([...q.typed, ...q.meanings, ...q.partial].some((v) => position(v, f.description, false) !== null)) return 6;
  if ([...q.typed, ...q.meanings].some((v) => position(v, f.place, false) !== null) || soundsLike(q, f.placeKeys)) return 7;
  return MAX_LEVEL + 1;
}

/** Sort key (lower is better) when every query word matches, else null. `level` is the worst word's level. */
export function matchScore(query: SearchQuery, f: PreparedFields): { level: number; score: number } | null {
  let worst = 0;
  let sum = 0;
  for (const w of query.words) {
    const level = wordLevel(w, f);
    if (level > MAX_LEVEL) return null;
    worst = Math.max(worst, level);
    sum += level;
  }
  return { level: worst, score: worst * 100 + sum };
}

/**
 * The coarse tier (1 name or type, 2 sounds like the name, 3 description, 4 place) for a finished
 * query, or null when some word matches nowhere.
 */
export function matchTier(query: string, fields: MatchFields): number | null {
  const q = parseQuery(`${query} `);
  const m = q ? matchScore(q, prepareFields(fields)) : null;
  if (!m) return null;
  return m.level <= 3 ? 1 : m.level <= 5 ? 2 : m.level === 6 ? 3 : 4;
}

/**
 * Character ranges of `text` (as displayed) that the query matched directly, for highlighting:
 * the typed word or a word-list translation at a word start, or anywhere for 3+ letters.
 */
export function highlightRanges(text: string, query: SearchQuery): Array<[number, number]> {
  // Fold each character alone, remembering where it came from, so ranges map back to `text`.
  const src = text.normalize('NFC');
  let folded = '';
  const from: number[] = [];
  let i = 0;
  for (const ch of src) {
    const n = normalizeSearch(ch) || (/[\s\-–—_.,;:!?()[\]{}/\\]/.test(ch) ? ' ' : '');
    for (const c of n) {
      folded += c;
      from.push(i);
    }
    i += ch.length;
  }
  from.push(i);
  const ranges: Array<[number, number]> = [];
  for (const w of query.words) {
    for (const v of [...w.typed, ...w.meanings]) {
      let at = folded.indexOf(v);
      while (at !== -1) {
        const start = at === 0 || folded[at - 1] === ' ';
        const end = at + v.length === folded.length || folded[at + v.length] === ' ';
        // Same rule as matching: short variants only as a whole word, or a word start when typed.
        if (v.length >= 3 || (start && (end || w.typed.includes(v)))) ranges.push([from[at]!, from[at + v.length - 1]! + 1]);
        at = folded.indexOf(v, at + 1);
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  // Keep combining marks (niqqud, harakat) with their letter.
  return merged.map(([s, e]) => {
    while (e < src.length && /[֑-ׇؐ-ًؚ-ٰٟ]/.test(src[e]!)) e++;
    return [s, e];
  });
}
