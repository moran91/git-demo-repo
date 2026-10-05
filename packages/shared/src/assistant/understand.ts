/**
 * Turns a message into a Request: what the customer craves, taste and diet wishes, exclusions, how many
 * people, budget, mode, place, meal time and shortcuts. Steps run in a fixed order and each consumes the
 * words it used; whatever is left is the craving (matched later by the existing smart search). A message
 * with wishes but no craving of its own refines the previous request ("יותר זול", "ל-6", "בלי בשר").
 */
import { normalizeSearch } from '../dishIndex.js';
import { LEXICON, expandQueryWord, matchScore, parseQuery, prepareFields, type PreparedFields } from '../search/index.js';
import type { FulfillmentMode, Localized } from '../types.js';
import { DISH_TYPE_WORDS } from './data.js';
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
  /**
   * Two or more things asked for at once ("פיצה ושתייה קרה", "hot dog and fries"), split where they were
   * joined. `craving` is all their words; each group keeps its own words and its taste/temperature wishes.
   */
  groups?: CravingGroup[];
  mode?: FulfillmentMode;
  placeBranchIds?: string[];
  meal?: Meal;
  shortcut?: Shortcut;
  page: number;
  lang: Lang;
}

export interface CravingGroup {
  craving: string[];
  /** The group's words as typed, in order, without a joining "and" prefix ("פטריות" from "ופטריות"): for naming it. */
  said: string;
  /** Wishes said with this thing only (diet wishes stay on the whole request). */
  tags: DishTag[];
  warm?: boolean;
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
/** Words that name a kind of dish ("פיצה", "pizza", "קינוחים"), from the tagger and the search type words. */
const TYPE_WORDS = new Set(foldAll([...Object.values(TYPE_TERMS).flat(), ...Object.values(DISH_TYPE_WORDS).flatMap((w) => w.split(' '))]));

/** A word naming a kind of dish ("שווארמה", "pizza", "צ׳יפס", "קולה"). */
export function isDishWord(word: string): boolean {
  return wordForms(word).some((f) => TYPE_WORDS.has(f));
}

/** Exactly this word is known, without taking a prefix off ("וופל", "وافل" are waffles, not "and …"). */
const knownExact = (w: string): boolean => TYPE_WORDS.has(w) || expandQueryWord(w).length > 1;

/** A word the food word list or the dish types know ("בירה", "water", "pizza"): not a typo, so it never stands for a dish that only sounds like it. */
export function isKnownFood(word: string): boolean {
  return wordForms(word).some(knownExact);
}
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
  // Where each wish was said, so a wish belongs to the thing it was said with ("פיצה ושתייה קרה").
  const marks: Mark[] = [];
  const wish = (at: number, m: Omit<Mark, 'at'>): void => {
    marks.push({ at, ...m });
    if (m.tag) addTo(r.tags, m.tag);
    if (m.warm) r.warm = true;
  };
  // 2. Multi-word wishes before negation: "ללא גלוטן" is a wish, not an exclusion.
  for (const [tag, list] of V.REQUEST_TAGS) {
    const at = eatStart(tokens, used, list.filter((p) => p.length > 1));
    if (at >= 0) wish(at, { tag });
  }
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
  for (const [tag, list] of V.REQUEST_TAGS) for (let at = eatStart(tokens, used, list); at >= 0; at = eatStart(tokens, used, list)) wish(at, { tag });
  for (let at = eatStart(tokens, used, V.WARM); at >= 0; at = eatStart(tokens, used, V.WARM)) wish(at, { warm: true });
  for (let at = eatStart(tokens, used, V.COLD); at >= 0; at = eatStart(tokens, used, V.COLD)) marks.push({ at, cold: true });
  for (const [word, list] of V.TYPE_WISHES) for (let at = eatStart(tokens, used, list); at >= 0; at = eatStart(tokens, used, list)) marks.push({ at, kind: word[lang] });
  // 7b. Where two things are joined, and "with" a topping ("פיצה עם גבינה": cheese pizza, one thing).
  const cuts = joinerCuts(tokens, used, wish);
  // 8. Filler (also with a prefix: "ומשביע"), and hunger words ("רעב", "what's open"), which ask for ideas, not a dish.
  tokens.forEach((t, i) => {
    if (!used[i] && (isIn(t, V.STOP) || isIn(t, V.HUNGRY))) used[i] = true;
  });
  // 9. Places.
  const placeIds = findPlaces(tokens, used, places);
  if (placeIds) r.placeBranchIds = placeIds;
  // 10. The rest is the craving, unless it is only "more" or "something else".
  const groups = splitGroups(text, tokens, used, marks, cuts);
  if (groups.length > 1) {
    r.groups = groups;
    r.craving = groups.flatMap((g) => g.craving);
    for (const g of groups) for (const t of g.tags) addTo(r.tags, t);
  } else {
    r.craving = [...tokens.filter((_, i) => !used[i]), ...marks.flatMap((m) => (m.kind ? tokenize(m.kind) : []))];
    if (marks.some((m) => m.cold) && coldIsDrink(r.craving, r.tags)) addTo(r.tags, 'cold_drink');
  }
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
  // Inside the things asked for, the temperature swaps: "פיצה ושתייה קרה" then "משהו חם" wants a hot drink.
  const swap = (t: DishTag): DishTag => (hot && t === 'cold_drink' ? 'hot_drink' : cold && t === 'hot_drink' ? 'cold_drink' : t);
  const groups = p.groups?.map(({ warm, ...g }) => ({ ...g, tags: uniq(g.tags.map(swap)), ...(warm && !cold ? { warm } : {}) }));
  const m: Request = {
    ...p,
    tags: uniq([...kept, ...r.tags, ...(groups ?? []).flatMap((g) => g.tags)]).filter((t) => !exclude.tags.includes(t)),
    ...(groups ? { groups } : {}),
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

/** Consumes the first phrase of `list` found in the tokens; returns the index of its first token, or -1. */
function eatStart(tokens: string[], used: boolean[], list: Phrase[]): number {
  for (const p of list) {
    for (let i = 0; i + p.length <= tokens.length; i++) {
      const hit = p.every((w, j) => !used[i + j] && (j === 0 ? wordForms(tokens[i]!).includes(w) : tokens[i + j] === w));
      if (hit) {
        for (let j = 0; j < p.length; j++) used[i + j] = true;
        return i;
      }
    }
  }
  return -1;
}

/** Consumes the first phrase of `list` found in the tokens; returns the index of its last token, or -1. */
function eatAt(tokens: string[], used: boolean[], list: Phrase[]): number {
  for (const p of list) {
    const i = eatStart(tokens, used, [p]);
    if (i >= 0) return i + p.length - 1;
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

interface Mark {
  at: number;
  tag?: DishTag;
  warm?: boolean;
  cold?: boolean;
  /** A dish-type word asked for by a verb ("לשתות" → שתייה). */
  kind?: string;
}

/** A lone cold word asks for a cold drink when nothing else is asked for, or beside a drink ("קפה קר"); beside a dish it is how the dish is served. */
function coldIsDrink(craving: readonly string[], tags: readonly DishTag[]): boolean {
  return (!craving.length && !tags.length) || craving.some((w) => isIn(w, V.DRINK_WORDS));
}

/** A dish, drink or side ("שווארמה עם צ׳יפס", "pizza with cola"), so "with" adds a second thing. */
const isSecondThing = (t: string): boolean => isDishWord(t) || isIn(t, V.DRINK_WORDS);

/** "ופלאפל", "وكولا", "ושתייה", "ומשהו": an "and" prefix, but never on a word known as itself ("וופל", "וניל"). */
function andJoins(t: string): boolean {
  if (!andPrefixed(t) || knownExact(t)) return false;
  const rest = t.slice(1);
  return isKnownFood(rest) || isDishWord(rest) || V.SOMETHING.has(rest);
}

interface Cuts {
  /** Joiner words ("and", "with" before a side): a new thing starts after them. */
  words: Set<number>;
}

/**
 * Finds the joiner words. "With" before a dish, drink or side joins; before anything else it is a topping:
 * the words after it are taken as that dish's wishes ("עם גבינה" → cheese) or dropped ("with mushrooms").
 */
function joinerCuts(tokens: string[], used: boolean[], wish: (at: number, m: Omit<Mark, 'at'>) => void): Cuts {
  const words = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (used[i]) continue;
    if (V.JOIN.has(t)) {
      words.add(i);
      continue;
    }
    if (!V.WITH.has(t)) continue;
    const next = tokens.findIndex((x, j) => j > i && !used[j] && !isIn(x, V.STOP));
    if (next >= 0 && isSecondThing(tokens[next]!)) {
      words.add(i);
      continue;
    }
    for (let k = i + 1; k < tokens.length; k++) {
      const x = tokens[k]!;
      if (V.JOIN.has(x) || V.WITH.has(x) || andJoins(x)) break;
      if (used[k] || isIn(x, V.STOP)) continue;
      if (isDishWord(x)) break;
      const tag = tagOf(x);
      used[k] = true;
      if (tag) wish(k, { tag });
    }
  }
  return { words };
}

/**
 * The craving split into the things asked for, cut at joiner words and at an "and" prefix. Each group
 * gets the words, dish-type wishes and taste/temperature wishes said inside it. One group (or none) means one thing.
 */
function splitGroups(text: string, tokens: string[], used: boolean[], marks: readonly Mark[], cuts: Cuts): CravingGroup[] {
  const starts = new Set(marks.filter((m) => !m.kind).map((m) => m.at));
  const kindStarts = new Set(marks.filter((m) => m.kind).map((m) => m.at));
  const typed = typedWords(text, tokens.length);
  const groupOf: number[] = [];
  const word: string[] = [];
  let g = 0;
  tokens.forEach((t, i) => {
    if (cuts.words.has(i)) {
      groupOf.push(-1);
      word.push('');
      g++;
      return;
    }
    // A new thing starts at an "and"-prefixed craving word, dish-type wish ("ושתייה קרה", "ומשהו לשתות") or "ומשהו".
    // A taste or temperature word alone ("וחריף", "וקרה") is a wish on the thing before it.
    const startsThing = !used[i] || kindStarts.has(i) || V.SOMETHING.has(t.slice(1)) || (starts.has(i) && isDishWord(t.slice(1)));
    const prefixed = i > 0 && startsThing && andJoins(t);
    if (prefixed) g++;
    groupOf.push(g);
    word.push(prefixed ? t.slice(1) : t);
  });
  const out: CravingGroup[] = [];
  for (let k = 0; k <= g; k++) {
    const idx = tokens.map((_, i) => i).filter((i) => groupOf[i] === k);
    const mine = marks.filter((m) => groupOf[m.at] === k);
    const craving = [...idx.filter((i) => !used[i]).map((i) => word[i]!), ...mine.flatMap((m) => (m.kind ? tokenize(m.kind) : []))];
    const tags = uniq(mine.flatMap((m) => (m.tag && !V.DIET_TAGS.includes(m.tag) ? [m.tag] : [])));
    if (mine.some((m) => m.cold) && coldIsDrink(craving, tags)) tags.push('cold_drink');
    const warm = mine.some((m) => m.warm);
    if (!craving.length && !tags.length && !warm) continue;
    const own = idx.filter((i) => !used[i]);
    out.push({ craving, said: saidOf(typed, own, word), tags, ...(warm ? { warm: true } : {}) });
  }
  return out;
}

/** Which typed word (split on spaces) each token came from, or null when they do not line up. */
function typedWords(text: string, count: number): { words: string[]; of: number[] } | null {
  const words = text.split(/\s+/).filter(Boolean);
  const of: number[] = [];
  words.forEach((w, k) => tokenize(w).forEach(() => of.push(k)));
  return of.length === count ? { words, of } : null;
}

/** The typed words of these tokens, in order, each once, without a joining "and" prefix and end punctuation. */
function saidOf(typed: ReturnType<typeof typedWords>, idx: readonly number[], word: readonly string[]): string {
  if (!typed) return idx.map((i) => word[i]).join(' ');
  const seen = new Set<number>();
  const out: string[] = [];
  for (const i of idx) {
    const k = typed.of[i]!;
    if (seen.has(k)) continue;
    seen.add(k);
    const w = typed.words[k]!.replace(/[?!.,;:؟،]+$/u, '');
    // The token lost its "and" (ופטריות → פטריות): so does the typed word.
    out.push(word[i] !== tokenize(w)[0] && /^[ו\u0648]/.test(w) ? w.slice(1) : w);
  }
  return out.join(' ');
}

function addTo<T>(list: T[], v: T): void {
  if (!list.includes(v)) list.push(v);
}
