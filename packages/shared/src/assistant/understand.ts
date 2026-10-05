/**
 * Turns a message into a Request: what the customer craves, taste and diet wishes, exclusions, how many
 * people, budget, mode, place, meal time and shortcuts. Steps run in a fixed order and each consumes the
 * words it used; whatever is left is the craving (matched later by the existing smart search). A message
 * with wishes but no craving of its own refines the previous request ("יותר זול", "ל-6", "בלי בשר").
 */
import { normalizeSearch } from '../dishIndex.js';
import { LEXICON, matchScore, parseQuery, prepareFields, type PreparedFields } from '../search/index.js';
import type { FulfillmentMode, Localized } from '../types.js';
import { DISH_TAGS, PEOPLE_TERMS, TAG_MATCHERS, TYPE_TERMS, type DishTag } from './tags.js';
import { foldAll, isIn, tokenize, uniq, wordForms } from './text.js';
import * as V from './vocab.js';
import type { Meal, Phrase } from './vocab.js';

export type { Meal } from './vocab.js';
export type Lang = 'he' | 'ar' | 'en';
export type Shortcut = 'usual' | 'surprise' | 'deals';

export interface Exclusions {
  tags: DishTag[];
  words: string[];
  dishIds: string[];
  branchIds: string[];
}

export interface Request {
  craving: string[];
  tags: DishTag[];
  exclude: Exclusions;
  people?: number;
  /** Total for a meal (agorot). */
  budgetAgorot?: number;
  /** Per-dish ceiling, from "cheaper" after dish picks. */
  maxPriceAgorot?: number;
  cheap?: boolean;
  /** "Something warm": a hot dish or drink (no cold drinks, salads, sushi or desserts). A wish of the tags slot. */
  warm?: boolean;
  /** The craving words were joined ("פיצה עם קולה", "pizza and sushi"): two things, so each may be answered alone. */
  joined?: boolean;
  mode?: FulfillmentMode;
  placeBranchIds?: string[];
  meal?: Meal;
  shortcut?: Shortcut;
  page: number;
  lang: Lang;
}

export interface PlaceName {
  branchId: string;
  name: Localized;
}
export interface Shown {
  dishIds: string[];
  branchIds: string[];
  /** Largest price (picks) or total (meals) shown; "cheaper" goes 20% under it. */
  maxTotalAgorot?: number;
}
export interface Previous {
  request: Request;
  shown: Shown;
}

type Refine = 'more' | 'other' | 'otherPlace' | 'cheaper';

const PEOPLE = new Set(foldAll(PEOPLE_TERMS));
const FOOD_WORDS = new Set([...LEXICON.flat(), ...Object.values(TYPE_TERMS).flat()].map((w) => normalizeSearch(w)));

export function emptyRequest(lang: Lang): Request {
  return { craving: [], tags: [], exclude: { tags: [], words: [], dishIds: [], branchIds: [] }, page: 0, lang };
}

export function detectLang(text: string): Lang {
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  if (he || ar) return he >= ar ? 'he' : 'ar';
  // Arabizi writes ح ع ق as 7 3 2 inside words ("7ar", "3ala").
  return /\b[a-z]*[2375][a-z]+\b/i.test(text) ? 'ar' : 'en';
}

export function hasSlots(r: Request): boolean {
  return r.craving.length > 0 || r.tags.length > 0 || r.exclude.tags.length > 0 || r.exclude.words.length > 0 || r.exclude.dishIds.length > 0 || r.exclude.branchIds.length > 0 || r.people !== undefined || r.budgetAgorot !== undefined || r.maxPriceAgorot !== undefined || !!r.cheap || !!r.warm || !!r.mode || !!r.placeBranchIds?.length || !!r.meal || !!r.shortcut;
}

/** A message with no wish of its own that still asks for ideas: "אני רעב", "what's open", "בא לי משהו טוב". */
export function wantsIdeas(text: string): boolean {
  const tokens = tokenize(text);
  return tokens.some((t) => isIn(t, V.HUNGRY)) || eat(tokens, tokens.map(() => false), V.HUNGRY_PHRASES);
}

export function isMealRequest(r: Request): boolean {
  return r.people !== undefined || r.budgetAgorot !== undefined;
}

/**
 * `fallbackLang` is the customer's UI language: a message with no letters ("2", "150₪") carries no language
 * of its own, so it keeps the previous request's, and with no previous request takes the fallback.
 */
export function understand(text: string, places: readonly PlaceName[], prev?: Previous, fallbackLang: Lang = 'he'): Request {
  const lang = /\p{L}/u.test(text) ? detectLang(text) : (prev?.request.lang ?? fallbackLang);
  const tokens = tokenize(text);
  const used = tokens.map(() => false);
  const r = emptyRequest(lang);
  const budgetEnds = new Set<number>();
  let refine: Refine | undefined;

  // 1. Phrases that set the kind of request.
  if (eat(tokens, used, V.OTHER_PLACE)) refine = 'otherPlace';
  if (eat(tokens, used, V.CHEAPER)) {
    if (prev) refine = refine ?? 'cheaper';
    else r.cheap = true;
  }
  if (eat(tokens, used, V.USUAL)) r.shortcut = 'usual';
  else if (eat(tokens, used, V.SURPRISE)) r.shortcut = 'surprise';
  else if (eat(tokens, used, V.DEALS)) r.shortcut = 'deals';
  // 2. Multi-word wishes before negation: "ללא גלוטן" is a wish, not an exclusion.
  for (const [tag, list] of V.REQUEST_TAGS) if (eat(tokens, used, list.filter((p) => p.length > 1))) addTo(r.tags, tag);
  // 2b. "No more than 100" is a budget ceiling, not an exclusion of "more".
  const capEnd = eatAt(tokens, used, V.NO_MORE);
  if (capEnd >= 0) budgetEnds.add(capEnd);
  // 3. Negation.
  negate(tokens, used, r);
  // 4. Numbers: people or budget.
  readNumbers(tokens, used, r, budgetEnds);
  // 5. Family and companions.
  if (eat(tokens, used, V.FAMILY) && r.people === undefined) r.people = 4;
  if (eat(tokens, used, V.COMPANION) && r.people === undefined) r.people = 2;
  // 6. Cheap, mode, meal.
  if (eat(tokens, used, V.CHEAP)) r.cheap = true;
  for (const [mode, list] of V.MODES) if (!r.mode && eat(tokens, used, list)) r.mode = mode;
  for (const [meal, list] of V.MEALS) if (!r.meal && eat(tokens, used, list)) r.meal = meal;
  // 7. Single-word wishes, "something warm", and words naming a whole kind of dish ("משהו לשתות").
  for (const [tag, list] of V.REQUEST_TAGS) while (eat(tokens, used, list)) addTo(r.tags, tag);
  while (eat(tokens, used, V.WARM)) r.warm = true;
  let cold = false;
  while (eat(tokens, used, V.COLD)) cold = true;
  const kinds: string[] = [];
  for (const [word, list] of V.TYPE_WISHES) while (eat(tokens, used, list)) addTo(kinds, word[lang]);
  // 8. Filler (also with a prefix: "ומשביע"), and hunger words ("רעב", "what's open"), which ask for ideas, not a dish.
  const joiner = tokens.some((t, i) => !used[i] && V.JOIN.has(t));
  tokens.forEach((t, i) => {
    if (!used[i] && (isIn(t, V.STOP) || isIn(t, V.HUNGRY))) used[i] = true;
  });
  // 9. Places.
  const placeIds = findPlaces(tokens, used, places);
  if (placeIds) r.placeBranchIds = placeIds;
  // 10. The rest is the craving, unless it is only "more" or "something else".
  r.craving = [...tokens.filter((_, i) => !used[i]), ...kinds.flatMap((w) => tokenize(w))];
  if (r.craving.length > 1 && (joiner || r.craving.slice(1).some(andPrefixed))) r.joined = true;
  if (cold && ((!r.craving.length && !r.tags.length) || r.craving.some((w) => isIn(w, V.DRINK_WORDS)))) addTo(r.tags, 'cold_drink');
  if (r.craving.length && r.craving.every((w) => V.MORE.has(w))) {
    r.craving = [];
    refine = refine ?? 'more';
  } else if (r.craving.length && r.craving.every((w) => V.OTHER.has(w))) {
    r.craving = [];
    refine = refine ?? 'other';
  }
  return prev ? mergeWithPrevious(r, prev, refine) : r;
}

function mergeWithPrevious(r: Request, prev: Previous, refine: Refine | undefined): Request {
  const own = r.craving.length > 0 || !!r.placeBranchIds?.length || !!r.shortcut;
  if (own || (!refine && !hasSlots(r))) return r;
  const p = prev.request;
  const exclude: Exclusions = {
    tags: uniq([...p.exclude.tags, ...r.exclude.tags]),
    words: uniq([...p.exclude.words, ...r.exclude.words]),
    dishIds: [...p.exclude.dishIds],
    branchIds: [...p.exclude.branchIds],
  };
  // Hot and cold replace each other: "משהו חם" then "משהו קר" wants cold now.
  const cold = r.tags.includes('cold_drink');
  const hot = !!r.warm || r.tags.includes('hot_drink');
  const kept = p.tags.filter((t) => !(cold && t === 'hot_drink') && !(hot && t === 'cold_drink'));
  const m: Request = {
    ...p,
    tags: uniq([...kept, ...r.tags]).filter((t) => !exclude.tags.includes(t)),
    exclude,
    people: r.people ?? p.people,
    budgetAgorot: r.budgetAgorot ?? p.budgetAgorot,
    cheap: r.cheap || p.cheap,
    warm: cold ? undefined : r.warm || p.warm,
    mode: r.mode ?? p.mode,
    meal: r.meal ?? p.meal,
    page: 0,
    lang: r.lang,
  };
  if (refine === 'more') m.page = p.page + 1;
  if (refine === 'other') m.exclude.dishIds = uniq([...m.exclude.dishIds, ...prev.shown.dishIds]);
  if (refine === 'otherPlace') m.exclude.branchIds = uniq([...m.exclude.branchIds, ...prev.shown.branchIds]);
  if (refine === 'cheaper') {
    const base = prev.shown.maxTotalAgorot;
    const cut = (n: number) => Math.floor((n * 0.8) / 100) * 100;
    if (isMealRequest(p)) m.budgetAgorot = cut(base ?? p.budgetAgorot ?? 0) || undefined;
    else if (base) m.maxPriceAgorot = cut(base);
    else m.cheap = true;
  }
  return m;
}

/** Consumes the first phrase of `list` found in the tokens; returns the index of its last token, or -1. */
function eatAt(tokens: string[], used: boolean[], list: Phrase[]): number {
  for (const p of list) {
    for (let i = 0; i + p.length <= tokens.length; i++) {
      const hit = p.every((w, j) => !used[i + j] && (j === 0 ? wordForms(tokens[i]!).includes(w) : tokens[i + j] === w));
      if (hit) {
        for (let j = 0; j < p.length; j++) used[i + j] = true;
        return i + p.length - 1;
      }
    }
  }
  return -1;
}

function eat(tokens: string[], used: boolean[], list: Phrase[]): boolean {
  return eatAt(tokens, used, list) >= 0;
}

/** The tag a negated word excludes as a whole: only words that name the tag itself ("בשר", "חריף"), never one dish ("קולה", "שוקולד"). */
function tagOf(word: string): DishTag | undefined {
  const forms = wordForms(word);
  return V.EXCLUDE_TAG_WORDS.find(([, words]) => forms.some((f) => words.has(f)))?.[0];
}

/** A whole word the tagger knows (וופל), so its first letter is not read as "and". */
function isTagWord(word: string): boolean {
  const forms = wordForms(word);
  return DISH_TAGS.some((t) => forms.some((f) => TAG_MATCHERS[t].words.has(f)));
}

/** First index at or after `k` that is not an intensifier ("too", "מדי", "כל כך", "كتير"). */
function skipIntensifiers(tokens: string[], k: number): number {
  for (;;) {
    const phrase = V.INTENSIFIER_PHRASES.find((p) => p.every((w, j) => tokens[k + j] === w));
    if (phrase) k += phrase.length;
    else if (isIn(tokens[k], V.INTENSIFIER)) k++;
    else return k;
  }
}

/** After a negation, also past "want" words: "לא רוצה חריף", "don't want spicy", "ما بدي حار". */
function skipToNegated(tokens: string[], k: number): number {
  for (;;) {
    const next = skipIntensifiers(tokens, k);
    if (isIn(tokens[next], V.NOT_WANT)) k = next + 1;
    else return next;
  }
}

/** "ועגבניה" and "وبندورة" carry "and" as a one-letter prefix. */
const andPrefixed = (t: string | undefined): boolean => !!t && /^[ו\u0648]/.test(t) && t.length >= 4;

/** "Without X": X is excluded, and so is every further item joined by "and" ("without onion and tomato", "בלי בצל ועגבניה"). */
function negate(tokens: string[], used: boolean[], r: Request): void {
  const free = (k: number) => k < tokens.length && !used[k] && !V.STOP.has(tokens[k]!) && !/^\d+$/.test(tokens[k]!) && !isIn(tokens[k], V.NEGATION);
  for (let i = 0; i < tokens.length; i++) {
    if (used[i] || !isIn(tokens[i], V.NEGATION)) continue;
    let k = skipToNegated(tokens, i + 1);
    if (!free(k)) continue;
    for (let j = i; j < k; j++) used[j] = true;
    let chained = false;
    for (;;) {
      const t = tokens[k]!;
      const word = chained && andPrefixed(t) && !isTagWord(t) && !tagOf(t) ? t.slice(1) : t;
      const tag = tagOf(word);
      if (tag) addTo(r.exclude.tags, tag);
      addTo(r.exclude.words, word);
      used[k] = true;
      let m = skipIntensifiers(tokens, k + 1);
      for (let j = k + 1; j < m; j++) used[j] = true;
      const joined = m < tokens.length && !used[m] && V.CONJ.has(tokens[m]!);
      if (joined) used[m++] = true;
      if (!free(m) || !(joined || andPrefixed(tokens[m]))) break;
      k = m;
      chained = true;
    }
  }
}

function numberAt(token: string): { n: number; forPrefix: boolean } | undefined {
  if (/^\d+$/.test(token)) return { n: Number(token), forPrefix: false };
  const forms = wordForms(token);
  for (let k = 0; k < forms.length; k++) {
    const n = V.NUMBER_WORDS.get(forms[k]!);
    if (n !== undefined) return { n, forPrefix: k > 0 && /^[לل]/.test(token) };
  }
  return undefined;
}

/** Looks back up to three tokens from a number, over connectors ("ל", "של", "₪", "מ", "up to"), for a budget word ("מתחת ל-50", "בתקציב של 100", "עד ₪50"). */
function budgetBefore(tokens: string[], used: boolean[], i: number, budgetEnds: ReadonlySet<number>): number[] | undefined {
  const eaten: number[] = [];
  for (let j = i - 1; j >= 0 && i - j <= 3; j--) {
    if (budgetEnds.has(j)) return eaten;
    if (used[j]) return undefined;
    const w = tokens[j]!;
    if (w === 'to' && tokens[j - 1] === 'up' && !used[j - 1]) return [...eaten, j, j - 1];
    if (isIn(w, V.BUDGET)) return [...eaten, j];
    if (!isIn(w, V.CONNECT) && !isIn(w, V.CURRENCY)) return undefined;
    eaten.push(j);
  }
  return undefined;
}

function readNumbers(tokens: string[], used: boolean[], r: Request, budgetEnds: ReadonlySet<number>): void {
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const num = numberAt(tokens[i]!);
    if (!num) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const before = budgetBefore(tokens, used, i, budgetEnds);
    const currencyAfter = isIn(next, V.CURRENCY);
    const currencyBefore = isIn(prev, V.CURRENCY);
    const peopleAfter = isIn(next, PEOPLE);
    const weBefore = isIn(prev, V.WE) || (prev === 'are' && isIn(tokens[i - 2], V.WE));
    used[i] = true;
    if (currencyAfter || currencyBefore || (before && !peopleAfter)) {
      r.budgetAgorot = num.n * 100;
      for (const j of before ?? []) used[j] = true;
      if (!before && currencyBefore) used[i - 1] = true;
      if (currencyAfter) used[i + 1] = true;
      continue;
    }
    // A people word right after the number wins over a budget word before it: "עד 4 אנשים", "up to 4 people".
    const peopleCue = num.forPrefix || peopleAfter || isIn(prev, V.FOR) || (weBefore && num.n <= 30);
    if (peopleCue || (num.n >= 1 && num.n <= 12)) {
      r.people = Math.min(20, Math.max(1, num.n));
      for (const j of before ?? []) used[j] = true;
      if (isIn(prev, V.FOR) && !used[i - 1]) used[i - 1] = true;
      if (peopleAfter) used[i + 1] = true;
    } else if (num.n >= 13) r.budgetAgorot = num.n * 100;
  }
}

/** A food word, also misspelled ("burgr" is a burger, not the place Burger Basil): naming a place with it needs "from". */
const foodWordMemo = new Map<string, boolean>();
function isFoodWord(w: string): boolean {
  let known = foodWordMemo.get(w);
  if (known === undefined) {
    const q = parseQuery(`${w} `)?.words[0];
    known = wordForms(w).some((f) => FOOD_WORDS.has(f)) || (!!q && (q.meanings.length > 0 || q.typoMeanings.length > 0));
    foodWordMemo.set(w, known);
  }
  return known;
}

interface PreparedPlace {
  branchId: string;
  fields: PreparedFields;
}
const placeCache = new WeakMap<readonly PlaceName[], PreparedPlace[]>();

function preparePlaces(places: readonly PlaceName[]): PreparedPlace[] {
  let p = placeCache.get(places);
  if (!p) {
    p = places.map((x) => ({ branchId: x.branchId, fields: prepareFields({ name: [x.name.he, x.name.ar, x.name.en].filter(Boolean).join(' '), description: '', type: '', place: '' }) }));
    placeCache.set(places, p);
  }
  return p;
}

/** Longest span of 1–3 words naming a place. A span of food words needs "from" (ממורנו / from / من). */
function findPlaces(tokens: string[], used: boolean[], places: readonly PlaceName[]): string[] | undefined {
  if (!places.length) return undefined;
  const prepared = preparePlaces(places);
  for (let len = Math.min(3, tokens.length); len >= 1; len--) {
    for (let i = 0; i + len <= tokens.length; i++) {
      const idx = Array.from({ length: len }, (_, j) => i + j);
      if (idx.some((j) => used[j] || V.STOP.has(tokens[j]!))) continue;
      const span = idx.map((j) => tokens[j]!);
      if (span.every((w) => w.length < 3)) continue;
      const fromBefore = i > 0 && V.FROM.has(tokens[i - 1]!);
      const variants: Array<{ words: string[]; from: boolean }> = [{ words: span, from: fromBefore }];
      // A one-letter prefix glued to the name: ממורנו, במורנו, למורנו. ב/ל are not stripped from a food word ("בורגר").
      const first = span[0]!;
      const fromPrefix = first.startsWith('מ');
      if (/^[מבל][֐-׿]{2,}$/.test(first) && (fromPrefix || !wordForms(first).some((f) => FOOD_WORDS.has(f)))) variants.push({ words: [first.slice(1), ...span.slice(1)], from: fromPrefix });
      for (const v of variants) {
        if (!v.from && v.words.some(isFoodWord)) continue;
        const q = parseQuery(`${v.words.join(' ')} `);
        if (!q) continue;
        const hits = prepared.filter((p) => {
          const m = matchScore(q, p.fields);
          return m !== null && m.level <= 4;
        });
        if (hits.length) {
          idx.forEach((j) => (used[j] = true));
          if (fromBefore) used[i - 1] = true;
          return hits.map((p) => p.branchId);
        }
      }
    }
  }
  return undefined;
}

function addTo<T>(list: T[], v: T): void {
  if (!list.includes(v)) list.push(v);
}
