/**
 * One conversation step: message (or tapped chip) → Request → answer turn (short line + cards + chips).
 * The answer kind follows the request: usual, deals, a meal (people or budget), a surprise, one place,
 * or dish picks. Empty answers name the wish that blocked them; misunderstandings climb a reprompt
 * ladder that never repeats itself. The whole Conversation is plain JSON (kept in sessionStorage).
 */
import { layoutAlternatives } from '../search/index.js';
import { clockAt, dishKey, localHour, type AssistantData, type AssistantDeal, type AssistantPlace } from './data.js';
import { buildMeals, type MealBasket } from './mealBuilder.js';
import type { Usual } from './profile.js';
import { hashUnit, mealOf, rank, roundRobin, type Hit } from './rank.js';
import { MODE_LABELS, chipLabel, peopleLabel, reply, replyNot, type ReplyKey } from './replies.js';
import { ALL_FILTERS, cravingMatches, placeUsable, retrieve, strongLevel, type Candidate, type Filters } from './retrieve.js';
import { TAG_LABELS, type DishTag } from './tags.js';
import { tokenize, uniq, wordForms } from './text.js';
import { emptyRequest, hasSlots, isDishWord, isKnownFood, isMealRequest, understand, wantsIdeas, type CravingGroup, type Lang, type Previous, type Request, type Shown } from './understand.js';
import { upsellFor } from './upsell.js';

export type Card =
  | { kind: 'dish'; branchId: string; productId: string }
  | { kind: 'meal'; basket: MealBasket }
  | { kind: 'deal'; branchId: string; dealId: string }
  | { kind: 'usual'; usual: Usual };
export type TurnKind = 'dish' | 'meal' | 'deal' | 'usual' | 'place' | 'surprise' | 'blocked' | 'closed' | 'reprompt' | 'upsell' | 'none';
export interface Chip {
  label: string;
  /** Sent as if typed. */
  send?: string;
  /** Used as-is (chips the reader would not need to parse). */
  request?: Request;
}
export interface AssistantTurn {
  id: string;
  role: 'assistant';
  kind: TurnKind;
  text: string;
  cards: Card[];
  chips: Chip[];
  more?: Chip;
  signIn?: boolean;
  /** On an upsell turn: the product offered, so taking it is not counted as a skip. */
  upsold?: string;
}
export interface UserTurn {
  id: string;
  role: 'user';
  text: string;
}
export type ConvTurn = AssistantTurn | UserTurn;
export interface Conversation {
  turns: ConvTurn[];
  last?: Previous;
  misses: number;
  upsellSkips: number;
}
export interface RespondOptions {
  signedIn: boolean;
  /** The app's language: used when a message has no letters and there is no earlier request. */
  uiLang: Lang;
  /** Product ids in the cart now; an upsold product found here was taken, not skipped. */
  inCart?: readonly string[];
}

export const EMPTY_CONVERSATION: Conversation = { turns: [], misses: 0, upsellSkips: 0 };

interface Answer {
  kind: TurnKind;
  text: string;
  cards: Card[];
  chips: Chip[];
  more?: Chip;
  signIn?: boolean;
  shown?: Shown;
  /** The request actually answered, when it is not the one read (a wrong-keyboard reading, a meal shown as dishes). */
  request?: Request;
  understood: boolean;
}
interface Ctx {
  text: string;
  data: AssistantData;
  opts: RespondOptions;
  misses: number;
  lastText?: string;
  prev?: Previous;
  /** The input was a chip carrying its own request. */
  chip: boolean;
}

const PAGE = 3;
const MEAL_PAGE = 2;
const NOTHING_SHOWN: Shown = { dishIds: [], branchIds: [] };
type Slot = 'tags' | 'exclude' | 'budget' | 'mode' | 'place';
const SLOTS: readonly Slot[] = ['tags', 'exclude', 'budget', 'mode', 'place'];

export function respond(conv: Conversation, input: string | Chip, data: AssistantData, opts: RespondOptions): Conversation {
  const text = (typeof input === 'string' ? input : input.label).trim();
  if (!text) return conv;
  const lastAssistant = [...conv.turns].reverse().find((t): t is AssistantTurn => t.role === 'assistant');
  const tookUpsell = !!lastAssistant?.upsold && !!opts.inCart?.includes(lastAssistant.upsold);
  const upsellSkips = conv.upsellSkips + (lastAssistant?.kind === 'upsell' && !tookUpsell ? 1 : 0);
  const request = readRequest(input, conv, data, opts);
  const ctx: Ctx = { text, data, opts, misses: conv.misses, chip: typeof input !== 'string' && !!input.request, ...(lastAssistant ? { lastText: lastAssistant.text } : {}), ...(conv.last ? { prev: conv.last } : {}) };
  const answer = answerFor(request, ctx);
  const n = conv.turns.length;
  const turn: AssistantTurn = { id: `t${n + 1}`, role: 'assistant', kind: answer.kind, text: answer.text, cards: answer.cards, chips: answer.chips, ...(answer.more ? { more: answer.more } : {}), ...(answer.signIn ? { signIn: true } : {}) };
  return {
    turns: [...conv.turns, { id: `t${n}`, role: 'user', text }, turn],
    ...(answer.understood ? { last: { request: answer.request ?? request, shown: answer.shown ?? NOTHING_SHOWN } } : conv.last ? { last: conv.last } : {}),
    misses: answer.understood ? 0 : conv.misses + 1,
    upsellSkips,
  };
}

/**
 * After an add: one "goes well with it" card, never twice in a row, never after two skips. Speaks the
 * conversation's language, else `uiLang` (an add from the home before any message).
 */
export function afterAdd(conv: Conversation, added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData, uiLang: Lang = 'he'): Conversation {
  const lastTurn = conv.turns.at(-1);
  if (conv.upsellSkips >= 2 || (lastTurn?.role === 'assistant' && lastTurn.kind === 'upsell')) return conv;
  const d = upsellFor(added, inCart, data);
  if (!d) return conv;
  const lang = conv.last?.request.lang ?? uiLang;
  const turn: AssistantTurn = { id: `t${conv.turns.length}`, role: 'assistant', kind: 'upsell', text: reply('upsell', lang, {}, data.seed + conv.turns.length), cards: [{ kind: 'dish', branchId: d.branchId, productId: d.id }], chips: [], upsold: d.id };
  return { ...conv, turns: [...conv.turns, turn] };
}

/**
 * The deals and "my usual" chips, shared by the chat's suggestions and the home strip. They carry their
 * request, so a label the reader would not parse ("شو في عروض؟") still works.
 */
export function shortcutChips(lang: Lang, data: AssistantData, signedIn: boolean): Chip[] {
  const chips: Chip[] = [];
  if (data.deals.length) chips.push(shortcutChip('deals', lang));
  if (signedIn && data.profile?.usuals.length) chips.push(shortcutChip('usual', lang));
  return chips;
}

/** When no place can take an order: the line saying so, and when the first one opens (if known). */
export function closedAllLine(lang: Lang, data: AssistantData, seed: number): { text: string; time?: string } | undefined {
  const places = [...data.places.values()];
  return places.some((p) => placeUsable(p)) ? undefined : closedLine(lang, data, seed, places);
}

function closedLine(lang: Lang, data: AssistantData, seed: number, places: readonly AssistantPlace[]): { text: string; time?: string } {
  const { time } = firstToOpen(places, data);
  return time ? { text: reply('closedAll', lang, { time }, seed), time } : { text: reply('closedAllNoTime', lang, {}, seed) };
}

function firstToOpen(places: readonly AssistantPlace[], data: AssistantData): { place?: AssistantPlace; time?: string } {
  const first = places.filter((p) => p.opensInMin !== undefined).sort((a, b) => a.opensInMin! - b.opensInMin!)[0];
  return first ? { place: first, time: clockAt(data.now, first.opensInMin!) } : {};
}

function readRequest(input: string | Chip, conv: Conversation, data: AssistantData, opts: RespondOptions): Request {
  if (typeof input !== 'string' && input.request) return input.request;
  const said = typeof input === 'string' ? input : input.send ?? input.label;
  const r = understand(said, data.placeNames, conv.last, opts.uiLang);
  // A refinement after a shortcut ("הרגיל שלי" → "ל-4") follows the new wishes; "more" / "other" keep the shortcut.
  if (r.shortcut && r.shortcut === conv.last?.request.shortcut) {
    const own = understand(said, data.placeNames, undefined, r.lang);
    if (!own.shortcut && hasSlots(own)) {
      const { shortcut: _s, ...rest } = r;
      return rest;
    }
  }
  return r;
}

function answerFor(r: Request, ctx: Ctx): Answer {
  // A tapped chip always means something: with no wish left (a dropped filter) it shows picks for now.
  // So do "I'm hungry" and its follow-ups ("עוד"), which name no dish but ask for ideas.
  if (!hasSlots(r)) return ctx.chip || r.page > 0 || wantsIdeas(ctx.text) ? pickAnswer(r, ctx, 'dish', false) : reprompt(r.lang, ctx);
  const closed = closedAllLine(r.lang, ctx.data, seedOf(r, ctx.data));
  if (closed) return { kind: 'closed', text: closed.text, cards: [], chips: [], shown: NOTHING_SHOWN, understood: true };
  if (r.shortcut === 'usual') return usualAnswer(r, ctx);
  if (r.shortcut === 'deals') return dealsAnswer(r, ctx);
  if (isMealRequest(r)) return mealAnswer(r, ctx);
  if (r.shortcut === 'surprise') return pickAnswer(r, ctx, 'surprise', true);
  if (r.placeBranchIds?.length && !r.craving.length && !r.tags.length) return placeAnswer(r, ctx);
  return pickAnswer(r, ctx, 'dish', true);
}

function seedOf(r: Request, data: AssistantData): number {
  return Math.floor(hashUnit(data.seed, JSON.stringify(r)) * 1000);
}

function pickAnswer(r: Request, ctx: Ctx, kind: 'dish' | 'surprise', retry: boolean): Answer {
  const { data } = ctx;
  const ranked = rankedFor(r, data);
  if (!ranked.length) return (retry && wrongKeyboard(r, ctx)) || emptyAnswer(r, ctx);
  const size = kind === 'surprise' ? 1 : PAGE;
  const page = ranked.slice(r.page * size, r.page * size + size);
  if (!page.length) return noMore(r, ctx, refineChips(r, data, 'dish'));
  // Everything shown so far, so "something else" after "more" skips every page.
  const seen = ranked.slice(0, r.page * size + page.length);
  const key: ReplyKey = kind === 'surprise' ? 'surprise' : r.craving.length || r.tags.length ? 'picks' : 'picksNow';
  return {
    kind,
    text: partialLine(r, ctx) ?? reply(key, r.lang, {}, seedOf(r, data)),
    cards: page.map(dishCard),
    chips: refineChips(r, data, 'dish'),
    ...(kind === 'dish' && ranked.length > (r.page + 1) * size ? { more: moreChip(r) } : {}),
    shown: { dishIds: seen.map((h) => h.dish.id), branchIds: uniq(seen.map((h) => h.dish.branchId)), maxTotalAgorot: Math.max(...page.map((h) => h.dish.entry.priceAgorot)) },
    request: r,
    understood: true,
  };
}

/** The request for one of the things asked for: its own words and wishes, plus the diet wishes of the whole message. */
function partOf(r: Request, g: CravingGroup, groups: readonly CravingGroup[]): Request {
  const owned = new Set(groups.flatMap((x) => x.tags));
  const { groups: _g, warm: _w, ...rest } = r;
  const warm = g.warm || (r.warm && !groups.some((x) => x.warm));
  return { ...rest, craving: g.craving, tags: uniq([...r.tags.filter((t) => !owned.has(t)), ...g.tags]), ...(warm ? { warm: true } : {}) };
}

/**
 * One thing asked for, made answerable: as said, or without a word that names nothing beside a dish word
 * ("שווארמה בפיתה"). A name of two words that no dish has ("hot dog", "עוגת גבינה") is not answerable:
 * it is never replaced by what each word alone names.
 */
function answerable(p: Request, data: AssistantData): Request | undefined {
  if (!p.craving.length || cravingMatches(data, p.craving).size) return p;
  if (p.craving.length < 2) return undefined;
  // Each word in its best form: the bare word first, a whole-word match ends the search.
  const forms = p.craving.map((word) => {
    let form: string | undefined;
    let best = 4;
    for (const f of wordForms(word)) {
      if (f.length < 2) continue;
      const level = strongLevel(data, f);
      if (level < best) [form, best] = [f, level];
      if (best <= 1) break;
    }
    return form;
  });
  const named = forms.filter((f): f is string => !!f);
  return named.length && named.length < forms.length && named.some(isDishWord) ? { ...p, craving: named } : undefined;
}

interface Parts {
  requests: Request[];
  /** Things asked for that no place has, as typed ("hot dog" in "fries and hot dog"). */
  missing: string[];
}

/**
 * What to look for: each thing asked for ("פיצה ושתייה קרה" is a pizza and a cold drink), made answerable.
 * Things no place has are named, never swapped for look-alikes; when none is answerable the request stays
 * whole, for the honest "not on the menu" answer.
 */
function parts(r: Request, data: AssistantData): Parts {
  const groups = r.groups ?? [];
  const raw = groups.length > 1 ? groups.map((g) => ({ p: partOf(r, g, groups), said: g.said })) : [{ p: r, said: '' }];
  const requests: Request[] = [];
  const missing: string[] = [];
  for (const { p, said } of raw) {
    const q = answerable(p, data);
    if (q) requests.push(q);
    else missing.push(said);
  }
  return requests.length ? { requests, missing } : { requests: [r], missing: [] };
}

/** Dishes that fit, over all parts (unranked: for "is there anything" checks). */
function candidates(r: Request, data: AssistantData, f: Filters = ALL_FILTERS): Candidate[] {
  return parts(r, data).requests.flatMap((p) => retrieve(p, data, f));
}

/** Ranked dishes for a request; parts take turns, so "פיצה עם קולה" shows both. Empty when nothing fits. */
function rankedFor(r: Request, data: AssistantData, f: Filters = ALL_FILTERS): Hit[] {
  const lists = parts(r, data).requests.map((p) => rank(retrieve(p, data, f), p, data));
  if (lists.length === 1) return lists[0]!;
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const h = l[i];
      if (!h || seen.has(dishKey(h.dish.branchId, h.dish.id))) continue;
      seen.add(dishKey(h.dish.branchId, h.dish.id));
      out.push(h);
    }
  }
  return out;
}

/**
 * "auutrnv" was typed on the wrong keyboard: read it as "שווארמה". Only a strong match counts (whole word,
 * word start, lexicon), and never one-letter words, so gibberish ("xqxq" → "ס/ס/") is not read as food.
 */
function wrongKeyboard(r: Request, ctx: Ctx): Answer | undefined {
  if (!r.craving.length) return undefined;
  for (const alt of layoutAlternatives(ctx.text)) {
    const r2 = understand(alt, ctx.data.placeNames, undefined, ctx.opts.uiLang);
    if (!hasSlots(r2)) continue;
    if (r2.craving.length && (r2.craving.some((w) => w.length < 2) || ![...cravingMatches(ctx.data, r2.craving).values()].some((m) => m.level <= 3))) continue;
    if (retrieve(r2, ctx.data).length) return isMealRequest(r2) ? mealAnswer(r2, ctx) : pickAnswer(r2, ctx, 'dish', false);
  }
  return undefined;
}

function mealAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  const ranked = rankedFor(r, data);
  if (!ranked.length) return wrongKeyboard(r, ctx) ?? emptyAnswer(r, ctx);
  const baskets = buildMeals(r, data, ranked);
  if (!baskets.length) {
    const why = mealBlocked(r, ctx);
    if (why) return why;
    if (r.budgetAgorot !== undefined) return blocked(r, 'budget', data);
    if (wishesOf(r).length) return blocked(r, 'tags', data);
    // Nothing to name (e.g. only a dessert place is open): show the dishes that fit.
    const { people: _p, ...solo } = r;
    return pickAnswer(solo, ctx, 'dish', false);
  }
  const page = baskets.slice(r.page * MEAL_PAGE, r.page * MEAL_PAGE + MEAL_PAGE);
  if (!page.length) return noMore(r, ctx, refineChips(r, data, 'meal'));
  const seen = baskets.slice(0, r.page * MEAL_PAGE + page.length);
  return {
    kind: 'meal',
    text: partialLine(r, ctx, true) ?? (r.people !== undefined ? reply('meal', r.lang, { people: r.people }, seedOf(r, data)) : reply('mealBudget', r.lang, { budget: shekels(r.budgetAgorot ?? 0) }, seedOf(r, data))),
    cards: page.map((basket) => ({ kind: 'meal', basket })),
    chips: refineChips(r, data, 'meal'),
    ...(baskets.length > (r.page + 1) * MEAL_PAGE ? { more: moreChip(r) } : {}),
    // "Something else" skips the mains shown, not their drink and side: the next basket still gets a drink.
    shown: { dishIds: seen.map((b) => b.anchorId), branchIds: seen.map((b) => b.branchId), maxTotalAgorot: Math.max(...page.map((b) => b.totalAgorot)) },
    request: r,
    understood: true,
  };
}

/**
 * No basket: blame the wish whose removal alone gives one, the one the latest message changed first.
 * After "something else" that is what was already shown, never a tag the customer kept from before.
 */
function mealBlocked(r: Request, ctx: Ctx): Answer | undefined {
  const { data } = ctx;
  for (const slot of slotOrder(r, ctx.prev?.request)) {
    if (!slotSet(r, slot)) continue;
    const loose = dropSlot(r, slot, wishesOf(r));
    if (!candidates(loose, data).length) continue;
    if (buildMeals(loose, data, rankedFor(loose, data)).length) return blocked(r, slot, data);
  }
  return undefined;
}

function slotSet(r: Request, slot: Slot): boolean {
  const x = r.exclude;
  switch (slot) {
    case 'tags':
      return wishesOf(r).length > 0;
    case 'exclude':
      return x.tags.length + x.words.length + x.dishIds.length + x.branchIds.length > 0;
    case 'budget':
      return r.budgetAgorot !== undefined || r.maxPriceAgorot !== undefined;
    case 'mode':
      return !!r.mode;
    case 'place':
      return !!r.placeBranchIds?.length;
  }
}

function placeAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  const cands = retrieve(r, data);
  if (!cands.length) return emptyAnswer(r, ctx);
  const dishes = rank(cands, r, data).slice(0, PAGE);
  const deals = data.deals.filter((d) => r.placeBranchIds!.includes(d.branchId)).slice(0, 2);
  return {
    kind: 'place',
    // The cards name the place; the line does not repeat it.
    text: reply('place', r.lang, {}, seedOf(r, data)),
    cards: [...deals.map(dealCard), ...dishes.map(dishCard)],
    chips: refineChips(r, data, 'dish'),
    shown: { dishIds: dishes.map((h) => h.dish.id), branchIds: uniq(dishes.map((h) => h.dish.branchId)), maxTotalAgorot: Math.max(...dishes.map((h) => h.dish.entry.priceAgorot)) },
    understood: true,
  };
}

function dealsAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  let deals = data.deals.filter((d) => placeUsable(data.places.get(d.branchId), r.mode) && (!r.placeBranchIds?.length || r.placeBranchIds.includes(d.branchId)) && !r.exclude.branchIds.includes(d.branchId));
  const { shortcut: _s, people: _p, budgetAgorot: _b, ...rest } = r;
  const wanted = r.craving.length > 0 || r.tags.length > 0;
  // Deals holding a dish that fits the craving ("מבצע על פיצה"), at open places or, with `open` off, at any.
  const fits = (list: AssistantDeal[], f: Filters) => {
    if (!wanted) return list;
    const match = new Set(candidates(rest, data, f).map((c) => dishKey(c.dish.branchId, c.dish.id)));
    return list.filter((d) => dealItems(d).some((id) => match.has(dishKey(d.branchId, id))));
  };
  deals = fits(deals, ALL_FILTERS);
  if (r.budgetAgorot !== undefined) deals = deals.filter((d) => !d.combo || d.combo.priceAgorot <= r.budgetAgorot!);
  if (!deals.length) {
    // The deals are there but their places are closed: say which one opens first, and when.
    const atClosed = data.deals.filter((d) => {
      const p = data.places.get(d.branchId);
      return !!p && !p.open && (!r.placeBranchIds?.length || r.placeBranchIds.includes(d.branchId)) && !r.exclude.branchIds.includes(d.branchId);
    });
    const closedAt = uniq(fits(atClosed, { ...ALL_FILTERS, open: false }).map((d) => d.branchId));
    if (closedAt.length) return closedPlaceAnswer(r, ctx, closedAt.map((id) => data.places.get(id)!));
    return { kind: 'deal', text: reply('dealsNone', r.lang, {}, seedOf(r, data)), cards: [], chips: suggestionChips(r.lang, ctx).filter((c) => c.request?.shortcut !== 'deals').slice(0, 3), shown: NOTHING_SHOWN, understood: true };
  }
  // Combos first; which place leads rotates by day, so no restaurant always opens the list.
  const sorted = deals.sort((a, b) => Number(!a.combo) - Number(!b.combo) || hashUnit(data.seed, a.branchId) - hashUnit(data.seed, b.branchId) || dealOrder(a) - dealOrder(b));
  const ordered = roundRobin(sorted, (d) => d.branchId);
  const page = ordered.slice(r.page * PAGE, r.page * PAGE + PAGE);
  if (!page.length) return noMore(r, ctx, refineChips(r, data, 'deal'));
  return {
    kind: 'deal',
    text: reply('deals', r.lang, {}, seedOf(r, data)),
    cards: page.map(dealCard),
    chips: refineChips(r, data, 'deal'),
    ...(ordered.length > (r.page + 1) * PAGE ? { more: moreChip(r) } : {}),
    shown: { dishIds: [], branchIds: uniq(ordered.slice(0, r.page * PAGE + page.length).map((d) => d.branchId)) },
    understood: true,
  };
}

function usualAnswer(r: Request, ctx: Ctx): Answer {
  const { data, opts } = ctx;
  if (r.page > 0) return noMore(r, ctx, suggestionChips(r.lang, ctx).filter((c) => c.request?.shortcut !== 'usual').slice(0, 3));
  if (!opts.signedIn) {
    const a = popular(r, ctx, 'usualSignedOut');
    return a.kind === 'usual' ? { ...a, signIn: true } : a;
  }
  const known = (data.profile?.usuals ?? []).filter((u) => data.places.has(u.branchId));
  const usuals = known.filter((u) => placeUsable(data.places.get(u.branchId))).slice(0, 2);
  if (!usuals.length) return known.length ? closedPlaceAnswer(r, ctx, uniq(known.map((u) => u.branchId)).map((id) => data.places.get(id)!)) : popular(r, ctx, 'usualNone');
  return { kind: 'usual', text: reply('usual', r.lang, {}, seedOf(r, data)), cards: usuals.map((usual) => ({ kind: 'usual', usual })), chips: suggestionChips(r.lang, ctx).filter((c) => c.request?.shortcut !== 'usual').slice(0, 3), shown: { dishIds: [], branchIds: usuals.map((u) => u.branchId) }, understood: true };
}

function popular(r: Request, ctx: Ctx, key: ReplyKey): Answer {
  const { data } = ctx;
  const base = emptyRequest(r.lang);
  const ranked = rank(retrieve(base, data), base, data);
  const top = [...ranked.filter((h) => h.dish.entry.mostOrdered), ...ranked.filter((h) => !h.dish.entry.mostOrdered)].slice(0, PAGE);
  if (!top.length) {
    // Nothing can be ordered: say when the closed places open instead of an empty list.
    const line = closedLine(r.lang, data, seedOf(r, data), [...data.places.values()].filter((p) => !placeUsable(p)));
    return { kind: 'closed', text: line.text, cards: [], chips: [], shown: NOTHING_SHOWN, understood: true };
  }
  return { kind: 'usual', text: reply(key, r.lang, {}, seedOf(r, data)), cards: top.map(dishCard), chips: suggestionChips(r.lang, ctx).slice(0, 3), shown: NOTHING_SHOWN, understood: true };
}

/** Nothing fits: matches only at closed places → which one and when it opens; a wish that blocks → name it and offer to drop it; else reprompt. */
function emptyAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  const atClosed = candidates(r, data, { ...ALL_FILTERS, open: false });
  if (atClosed.length) return closedPlaceAnswer(r, ctx, uniq(atClosed.map((c) => c.dish.branchId)).map((id) => data.places.get(id)!));
  return blockedAnswer(r, ctx) ?? notOnMenu(r, ctx) ?? reprompt(r.lang, ctx);
}

/** "מיץ", "water", "بوظة": a food the customer named clearly that no place sells. Say so, rather than "I didn't get that". */
function notOnMenu(r: Request, ctx: Ctx): Answer | undefined {
  // Never "nothing for X" while X names dishes (a filter blocks them; that is the blocked answer's job).
  if (!r.craving.length || cravingMatches(ctx.data, r.craving).size) return undefined;
  // Every word a known food, or a two-word name with a known food in it ("hot dog", "מרק עוף").
  const known = r.craving.every(isKnownFood) || (r.craving.length > 1 && r.craving.some(isKnownFood));
  if (!known) return undefined;
  const label = r.groups?.length ? r.groups.map((g) => g.said).join(', ') : typedLabel(r.craving, ctx.text);
  return { kind: 'blocked', text: reply('blockedTags', r.lang, { slot: label }, seedOf(r, ctx.data)), cards: [], chips: suggestionChips(r.lang, ctx).slice(0, 3), shown: NOTHING_SHOWN, request: r, understood: true };
}

/**
 * One thing's words as the customer typed them ("מרק עוף", not the folded "עופ"), in order and each once,
 * without a joining "and" prefix. A message that does not hold them (a refinement) falls back to the words.
 */
function typedLabel(words: readonly string[], text: string): string {
  const typed: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/[?!.,;:؟،]+$/u, '');
    const t = tokenize(w)[0];
    if (!t) continue;
    const label = words.includes(t) ? w : words.includes(t.slice(1)) && /^[ו\u0648]/.test(w) ? w.slice(1) : undefined;
    if (label && !typed.includes(label)) typed.push(label);
  }
  return (typed.length ? typed : words).join(' ');
}

/**
 * The line over the cards when an asked-for thing is missing: one sentence naming it, and for a meal
 * still saying who it is for ("אין כרגע hot dog, אבל הנה ארוחה ל־2:").
 */
function partialLine(r: Request, ctx: Ctx, meal = false): string | undefined {
  const { missing } = parts(r, ctx.data);
  if (!missing.length) return undefined;
  const vars = { missing: missing.join(', '), people: r.people ?? 1, budget: shekels(r.budgetAgorot ?? 0) };
  const key: ReplyKey = !meal ? 'partial' : r.people !== undefined ? 'mealPartial' : 'mealBudgetPartial';
  return reply(key, r.lang, vars, seedOf(r, ctx.data));
}

/** Some places are open, but what was asked for is at closed ones: name the first to open. */
function closedPlaceAnswer(r: Request, ctx: Ctx, places: readonly AssistantPlace[]): Answer {
  const L = r.lang;
  const { place: first, time } = firstToOpen(places, ctx.data);
  const place = first ?? places[0]!;
  const name = place.name[L] ?? place.name.he ?? place.name.en ?? '';
  const seed = seedOf(r, ctx.data);
  return { kind: 'closed', text: time ? reply('closed', L, { place: name, time }, seed) : reply('closedNoTime', L, { place: name }, seed), cards: [], chips: suggestionChips(L, ctx).slice(0, 3), shown: NOTHING_SHOWN, understood: true };
}

/** The wish the latest message added or changed is blamed first; among tags, the one whose removal alone finds something. */
function blockedAnswer(r: Request, ctx: Ctx): Answer | undefined {
  const { data } = ctx;
  const p = ctx.prev?.request;
  for (const slot of slotOrder(r, p)) {
    if (slot === 'tags') {
      const wishes = wishesOf(r);
      if (!wishes.length) continue;
      // "Warm" is how a dish is served, so it goes before the dish wish itself ("קינוח חם" blames חם); then the newest tag.
      const order = uniq<Wish>([...(r.warm ? ['warm' as const] : []), ...r.tags.filter((t) => !p?.tags.includes(t)).reverse(), ...[...r.tags].reverse()]);
      const one = order.find((w) => candidates(withoutWishes(r, [w]), data).length > 0);
      if (one) return blocked(r, 'tags', data, [one]);
    }
    if (candidates(r, data, { ...ALL_FILTERS, [slot]: false }).length) return blocked(r, slot, data);
  }
  return undefined;
}

function slotOrder(r: Request, p: Request | undefined): Slot[] {
  if (!p) return [...SLOTS];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed: Record<Slot, boolean> = {
    tags: !same(r.tags, p.tags) || !!r.warm !== !!p.warm,
    exclude: !same(r.exclude, p.exclude),
    budget: r.budgetAgorot !== p.budgetAgorot || r.maxPriceAgorot !== p.maxPriceAgorot,
    mode: r.mode !== p.mode,
    place: !same(r.placeBranchIds, p.placeBranchIds),
  };
  return [...SLOTS.filter((s) => changed[s]), ...SLOTS.filter((s) => !changed[s])];
}

/** A wish of the tags slot: a dish tag, or "warm". */
type Wish = DishTag | 'warm';
const WARM_LABEL: Record<Lang, string> = { he: 'חם', ar: 'سخن', en: 'warm' };
const wishesOf = (r: Request): Wish[] => [...(r.warm || r.groups?.some((g) => g.warm) ? ['warm' as const] : []), ...r.tags];
function withoutWishes(r: Request, wishes: readonly Wish[]): Request {
  const noWarm = wishes.includes('warm');
  const { warm: _w, ...rest } = r;
  const tags = r.tags.filter((t) => !wishes.includes(t));
  const groups = r.groups?.map(({ warm, ...g }) => ({ ...g, tags: g.tags.filter((t) => !wishes.includes(t)), ...(warm && !noWarm ? { warm } : {}) }));
  return { ...(noWarm ? rest : r), tags, ...(groups ? { groups } : {}) };
}

function blocked(r: Request, slot: Slot, data: AssistantData, tags: readonly Wish[] = wishesOf(r)): Answer {
  const { key, label } = slotWords(r, slot, data, tags);
  return {
    kind: 'blocked',
    text: reply(key, r.lang, { slot: label }, seedOf(r, data)),
    cards: [],
    chips: [{ label: chipLabel('drop', r.lang), request: dropSlot(r, slot, tags) }],
    shown: NOTHING_SHOWN,
    understood: true,
  };
}

function slotWords(r: Request, slot: Slot, data: AssistantData, tags: readonly Wish[]): { key: ReplyKey; label: string } {
  const L = r.lang;
  switch (slot) {
    case 'tags':
      return { key: 'blockedTags', label: tags.map((t) => (t === 'warm' ? WARM_LABEL[L] : TAG_LABELS[t][L])).join(', ') };
    case 'exclude': {
      const said = uniq([...r.exclude.tags.map((t) => TAG_LABELS[t][L]), ...r.exclude.words]);
      return said.length ? { key: 'blockedExclude', label: said.join(', ') } : { key: 'blockedOther', label: '' };
    }
    case 'budget':
      return { key: 'blockedBudget', label: shekels(r.budgetAgorot ?? r.maxPriceAgorot ?? 0) };
    case 'mode':
      return { key: 'blockedMode', label: r.mode ? MODE_LABELS[r.mode][L] : '' };
    case 'place':
      return { key: 'blockedPlace', label: (r.placeBranchIds ?? []).map((id) => data.places.get(id)?.name[L] ?? '').filter(Boolean).join(', ') };
  }
}

function dropSlot(r: Request, slot: Slot, tags: readonly Wish[]): Request {
  const { budgetAgorot: _b, maxPriceAgorot: _m, mode: _mo, placeBranchIds: _p, ...rest } = r;
  switch (slot) {
    case 'tags':
      return { ...withoutWishes(r, tags), page: 0 };
    case 'exclude':
      return { ...r, exclude: { tags: [], words: [], dishIds: [], branchIds: [] }, page: 0 };
    case 'budget':
      return { ...rest, ...(r.mode ? { mode: r.mode } : {}), ...(r.placeBranchIds ? { placeBranchIds: r.placeBranchIds } : {}), page: 0 };
    case 'mode':
      return { ...rest, ...(r.budgetAgorot !== undefined ? { budgetAgorot: r.budgetAgorot } : {}), ...(r.maxPriceAgorot !== undefined ? { maxPriceAgorot: r.maxPriceAgorot } : {}), ...(r.placeBranchIds ? { placeBranchIds: r.placeBranchIds } : {}), page: 0 };
    case 'place':
      return { ...rest, ...(r.budgetAgorot !== undefined ? { budgetAgorot: r.budgetAgorot } : {}), ...(r.maxPriceAgorot !== undefined ? { maxPriceAgorot: r.maxPriceAgorot } : {}), ...(r.mode ? { mode: r.mode } : {}), page: 0 };
  }
}

/** First miss: closest dishes for any single word + three suggestions. Second miss and after: fixed choices only. */
function reprompt(lang: Lang, ctx: Ctx): Answer {
  const { data } = ctx;
  if (ctx.misses === 0) {
    const seen = new Map<string, Hit>();
    for (const w of tokenize(ctx.text).filter((x) => x.length >= 2)) {
      const r1 = { ...emptyRequest(lang), craving: [w] };
      for (const h of rank(retrieve(r1, data), r1, data).slice(0, PAGE)) seen.set(dishKey(h.dish.branchId, h.dish.id), h);
    }
    return { kind: 'reprompt', text: replyNot('reprompt1', lang, ctx.lastText, data.seed), cards: [...seen.values()].slice(0, PAGE).map(dishCard), chips: suggestionChips(lang, ctx).slice(0, 3), understood: false };
  }
  return { kind: 'reprompt', text: replyNot('reprompt2', lang, ctx.lastText, data.seed + ctx.misses), cards: [], chips: suggestionChips(lang, ctx), understood: false };
}

function suggestionChips(lang: Lang, ctx: Ctx): Chip[] {
  const { data, opts } = ctx;
  const meal = mealOf(localHour(data.now));
  return [
    { label: chipLabel(meal, lang), request: { ...emptyRequest(lang), meal } },
    ...shortcutChips(lang, data, opts.signedIn),
    { label: chipLabel('byBudget', lang), request: { ...emptyRequest(lang), budgetAgorot: 5000 } },
  ];
}

function refineChips(r: Request, data: AssistantData, kind: 'dish' | 'meal' | 'deal'): Chip[] {
  const L = r.lang;
  const chips: Chip[] = [];
  if (kind !== 'deal') chips.push(sayChip(chipLabel('cheaper', L)));
  if (kind === 'meal') chips.push(sayChip(peopleLabel(r.people !== undefined ? r.people + 2 : 2, L)));
  else if (kind === 'dish' && r.people === undefined) chips.push(sayChip(peopleLabel(4, L)));
  chips.push(sayChip(chipLabel(kind === 'dish' ? 'other' : 'otherPlace', L)));
  if (kind !== 'deal' && !r.exclude.tags.includes('meat') && !r.tags.includes('vegetarian') && !r.tags.includes('vegan')) chips.push(sayChip(chipLabel('noMeat', L)));
  if (data.deals.length && r.shortcut !== 'deals') chips.push(shortcutChip('deals', L));
  return chips.slice(0, 4);
}

/** Past the last page: say so, and keep what was shown so "something else" still skips it. */
function noMore(r: Request, ctx: Ctx, chips: Chip[]): Answer {
  return { kind: 'none', text: reply('noMore', r.lang, {}, seedOf(r, ctx.data)), cards: [], chips, shown: ctx.prev?.shown ?? NOTHING_SHOWN, understood: true };
}

const shekels = (agorot: number) => `₪${Math.round(agorot / 100)}`;
const sayChip = (label: string): Chip => ({ label, send: label });
const shortcutChip = (shortcut: 'deals' | 'usual', lang: Lang): Chip => ({ label: chipLabel(shortcut, lang), request: { ...emptyRequest(lang), shortcut } });
const moreChip = (r: Request): Chip => ({ label: chipLabel('more', r.lang), request: { ...r, page: r.page + 1 } });
const dishCard = (h: Hit): Card => ({ kind: 'dish', branchId: h.dish.branchId, productId: h.dish.id });
const dealCard = (d: AssistantDeal): Card => ({ kind: 'deal', branchId: d.branchId, dealId: d.id });
const dealItems = (d: AssistantDeal): string[] => (d.combo ? d.combo.items.map((i) => i.productId) : d.promotion?.productIds ?? []);
const dealOrder = (d: AssistantDeal): number => d.combo?.sortOrder ?? d.promotion?.sortOrder ?? 0;
