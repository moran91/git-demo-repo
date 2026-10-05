/**
 * One conversation step: message (or tapped chip) → Request → answer turn (short line + cards + chips).
 * The answer kind follows the request: usual, deals, a meal (people or budget), a surprise, one place,
 * or dish picks. Empty answers name the wish that blocked them; misunderstandings climb a reprompt
 * ladder that never repeats itself. The whole Conversation is plain JSON (kept in sessionStorage).
 */
import { layoutAlternatives } from '../search/index.js';
import { clockAt, dishKey, localHour, type AssistantData, type AssistantDeal } from './data.js';
import { buildMeals, type MealBasket } from './mealBuilder.js';
import type { Usual } from './profile.js';
import { hashUnit, mealOf, rank, roundRobin, type Hit } from './rank.js';
import { MODE_LABELS, NO_WORD, chipLabel, peopleLabel, reply, replyNot, type ReplyKey } from './replies.js';
import { ALL_FILTERS, placeUsable, retrieve, type Filters } from './retrieve.js';
import { TAG_LABELS } from './tags.js';
import { tokenize, uniq } from './text.js';
import { emptyRequest, hasSlots, isMealRequest, understand, type Lang, type Previous, type Request, type Shown } from './understand.js';
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
  understood: boolean;
}
interface Ctx {
  text: string;
  data: AssistantData;
  opts: RespondOptions;
  misses: number;
  lastText?: string;
}

const PAGE = 3;
const MEAL_PAGE = 2;
const NOTHING_SHOWN: Shown = { dishIds: [], branchIds: [] };

export function respond(conv: Conversation, input: string | Chip, data: AssistantData, opts: RespondOptions): Conversation {
  const text = (typeof input === 'string' ? input : input.label).trim();
  if (!text) return conv;
  const lastAssistant = [...conv.turns].reverse().find((t): t is AssistantTurn => t.role === 'assistant');
  const tookUpsell = !!lastAssistant?.upsold && !!opts.inCart?.includes(lastAssistant.upsold);
  const upsellSkips = conv.upsellSkips + (lastAssistant?.kind === 'upsell' && !tookUpsell ? 1 : 0);
  const request = readRequest(input, conv, data, opts);
  const answer = answerFor(request, { text, data, opts, misses: conv.misses, lastText: lastAssistant?.text });
  const n = conv.turns.length;
  const turn: AssistantTurn = { id: `t${n + 1}`, role: 'assistant', kind: answer.kind, text: answer.text, cards: answer.cards, chips: answer.chips, ...(answer.more ? { more: answer.more } : {}), ...(answer.signIn ? { signIn: true } : {}) };
  return {
    turns: [...conv.turns, { id: `t${n}`, role: 'user', text }, turn],
    ...(answer.understood ? { last: { request, shown: answer.shown ?? NOTHING_SHOWN } } : conv.last ? { last: conv.last } : {}),
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
  if (!hasSlots(r)) return reprompt(r.lang, ctx);
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
  const cands = retrieve(r, data);
  if (!cands.length) return (retry && wrongKeyboard(r, ctx)) || emptyAnswer(r, ctx);
  const ranked = rank(cands, r, data);
  const size = kind === 'surprise' ? 1 : PAGE;
  const page = ranked.slice(r.page * size, r.page * size + size);
  if (!page.length) return noMore(r, ctx, 'dish');
  const key: ReplyKey = kind === 'surprise' ? 'surprise' : r.craving.length || r.tags.length ? 'picks' : 'picksNow';
  return {
    kind,
    text: reply(key, r.lang, {}, seedOf(r, data)),
    cards: page.map(dishCard),
    chips: refineChips(r, data, 'dish'),
    ...(kind === 'dish' && ranked.length > (r.page + 1) * size ? { more: moreChip(r) } : {}),
    shown: { dishIds: page.map((h) => h.dish.id), branchIds: uniq(page.map((h) => h.dish.branchId)), maxTotalAgorot: Math.max(...page.map((h) => h.dish.entry.priceAgorot)) },
    understood: true,
  };
}

/** "auutrnv" was typed on the wrong keyboard: read it as "שווארמה". */
function wrongKeyboard(r: Request, ctx: Ctx): Answer | undefined {
  if (!r.craving.length) return undefined;
  for (const alt of layoutAlternatives(ctx.text)) {
    const r2 = understand(alt, ctx.data.placeNames, undefined, ctx.opts.uiLang);
    if (hasSlots(r2) && retrieve(r2, ctx.data).length) return isMealRequest(r2) ? mealAnswer(r2, ctx) : pickAnswer(r2, ctx, 'dish', false);
  }
  return undefined;
}

function mealAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  const cands = retrieve(r, data);
  if (!cands.length) return wrongKeyboard(r, ctx) ?? emptyAnswer(r, ctx);
  const baskets = buildMeals(r, data, rank(cands, r, data));
  if (!baskets.length) {
    if (r.budgetAgorot !== undefined) return blocked(r, 'budget', data);
    if (r.tags.length) return blocked(r, 'tags', data);
    // Nothing to name (e.g. only a dessert place is open): show the dishes that fit.
    const { people: _p, ...solo } = r;
    return pickAnswer(solo, ctx, 'dish', false);
  }
  const page = baskets.slice(r.page * MEAL_PAGE, r.page * MEAL_PAGE + MEAL_PAGE);
  if (!page.length) return noMore(r, ctx, 'meal');
  return {
    kind: 'meal',
    text: reply('meal', r.lang, { people: r.people ?? 1 }, seedOf(r, data)),
    cards: page.map((basket) => ({ kind: 'meal', basket })),
    chips: refineChips(r, data, 'meal'),
    ...(baskets.length > (r.page + 1) * MEAL_PAGE ? { more: moreChip(r) } : {}),
    shown: { dishIds: page.flatMap((b) => b.lines.map((l) => l.productId)), branchIds: page.map((b) => b.branchId), maxTotalAgorot: Math.max(...page.map((b) => b.totalAgorot)) },
    understood: true,
  };
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
  if (r.craving.length || r.tags.length) {
    const { shortcut: _s, people: _p, budgetAgorot: _b, ...rest } = r;
    const match = new Set(retrieve(rest, data).map((c) => dishKey(c.dish.branchId, c.dish.id)));
    deals = deals.filter((d) => dealItems(d).some((id) => match.has(dishKey(d.branchId, id))));
  }
  if (r.budgetAgorot !== undefined) deals = deals.filter((d) => !d.combo || d.combo.priceAgorot <= r.budgetAgorot!);
  if (!deals.length) return { kind: 'deal', text: reply('dealsNone', r.lang, {}, seedOf(r, data)), cards: [], chips: suggestionChips(r.lang, ctx).slice(0, 3), shown: NOTHING_SHOWN, understood: true };
  const ordered = roundRobin(deals.sort((a, b) => Number(!a.combo) - Number(!b.combo) || (a.combo?.sortOrder ?? a.promotion!.sortOrder) - (b.combo?.sortOrder ?? b.promotion!.sortOrder)), (d) => d.branchId);
  const page = ordered.slice(r.page * PAGE, r.page * PAGE + PAGE);
  if (!page.length) return noMore(r, ctx, 'deal');
  return {
    kind: 'deal',
    text: reply('deals', r.lang, {}, seedOf(r, data)),
    cards: page.map(dealCard),
    chips: refineChips(r, data, 'deal'),
    ...(ordered.length > (r.page + 1) * PAGE ? { more: moreChip(r) } : {}),
    shown: { dishIds: [], branchIds: uniq(page.map((d) => d.branchId)) },
    understood: true,
  };
}

function usualAnswer(r: Request, ctx: Ctx): Answer {
  const { data, opts } = ctx;
  if (!opts.signedIn) return { ...popular(r, ctx, 'usualSignedOut'), signIn: true };
  const usuals = (data.profile?.usuals ?? []).filter((u) => data.places.has(u.branchId)).slice(0, 2);
  if (!usuals.length) return popular(r, ctx, 'usualNone');
  return { kind: 'usual', text: reply('usual', r.lang, {}, seedOf(r, data)), cards: usuals.map((usual) => ({ kind: 'usual', usual })), chips: suggestionChips(r.lang, ctx).filter((c) => c.label !== chipLabel('usual', r.lang)).slice(0, 3), shown: { dishIds: [], branchIds: usuals.map((u) => u.branchId) }, understood: true };
}

function popular(r: Request, ctx: Ctx, key: ReplyKey): Answer {
  const base = emptyRequest(r.lang);
  const ranked = rank(retrieve(base, ctx.data), base, ctx.data);
  const top = [...ranked.filter((h) => h.dish.entry.mostOrdered), ...ranked.filter((h) => !h.dish.entry.mostOrdered)].slice(0, PAGE);
  return { kind: 'usual', text: reply(key, r.lang, {}, seedOf(r, ctx.data)), cards: top.map(dishCard), chips: suggestionChips(r.lang, ctx).slice(0, 3), shown: NOTHING_SHOWN, understood: true };
}

type Slot = 'tags' | 'exclude' | 'budget' | 'mode' | 'place';

/** Nothing fits: matches only at closed places → when they open; a wish that blocks → name it and offer to drop it; else reprompt. */
function emptyAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  const atClosed = retrieve(r, data, { ...ALL_FILTERS, open: false });
  if (atClosed.length) return closedAnswer(r, data, Math.min(...atClosed.map((c) => data.places.get(c.dish.branchId)?.opensInMin ?? Number.POSITIVE_INFINITY)), 'closed');
  for (const slot of ['tags', 'exclude', 'budget', 'mode', 'place'] as const) {
    const relaxed: Filters = { ...ALL_FILTERS, [slot]: false };
    if (retrieve(r, data, relaxed).length) return blocked(r, slot, data);
  }
  const places = [...data.places.values()];
  if (!places.some((p) => p.open)) return closedAnswer(r, data, Math.min(...places.map((p) => p.opensInMin ?? Number.POSITIVE_INFINITY)), 'closedAll');
  return reprompt(r.lang, ctx);
}

function closedAnswer(r: Request, data: AssistantData, minutes: number, key: 'closed' | 'closedAll'): Answer {
  const time = Number.isFinite(minutes) ? clockAt(data.now, minutes) : '';
  return { kind: 'closed', text: reply(key, r.lang, { time }, seedOf(r, data)), cards: [], chips: [], shown: NOTHING_SHOWN, understood: true };
}

function blocked(r: Request, slot: Slot, data: AssistantData): Answer {
  return {
    kind: 'blocked',
    text: reply('blocked', r.lang, { slot: slotLabel(r, slot, data) }, seedOf(r, data)),
    cards: [],
    chips: [{ label: chipLabel('drop', r.lang), request: dropSlot(r, slot) }],
    shown: NOTHING_SHOWN,
    understood: true,
  };
}

function slotLabel(r: Request, slot: Slot, data: AssistantData): string {
  const L = r.lang;
  switch (slot) {
    case 'tags':
      return r.tags.map((t) => TAG_LABELS[t][L]).join(', ');
    case 'exclude': {
      const said = uniq([...r.exclude.tags.map((t) => TAG_LABELS[t][L]), ...r.exclude.words]);
      return said.length ? `${NO_WORD[L]} ${said.join(', ')}` : chipLabel(r.exclude.branchIds.length ? 'otherPlace' : 'other', L);
    }
    case 'budget':
      return `₪${Math.round((r.budgetAgorot ?? r.maxPriceAgorot ?? 0) / 100)}`;
    case 'mode':
      return r.mode ? MODE_LABELS[r.mode][L] : '';
    case 'place':
      return (r.placeBranchIds ?? []).map((id) => data.places.get(id)?.name[L] ?? '').filter(Boolean).join(', ');
  }
}

function dropSlot(r: Request, slot: Slot): Request {
  const { budgetAgorot: _b, maxPriceAgorot: _m, mode: _mo, placeBranchIds: _p, ...rest } = r;
  switch (slot) {
    case 'tags':
      return { ...r, tags: [], page: 0 };
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
  if (kind === 'meal') chips.push(sayChip(peopleLabel((r.people ?? 1) + 2, L)));
  else if (kind === 'dish' && r.people === undefined) chips.push(sayChip(peopleLabel(4, L)));
  chips.push(sayChip(chipLabel(kind === 'dish' ? 'other' : 'otherPlace', L)));
  if (kind !== 'deal' && !r.exclude.tags.includes('meat') && !r.tags.includes('vegetarian') && !r.tags.includes('vegan')) chips.push(sayChip(chipLabel('noMeat', L)));
  if (data.deals.length && r.shortcut !== 'deals') chips.push(shortcutChip('deals', L));
  return chips.slice(0, 4);
}

function noMore(r: Request, ctx: Ctx, kind: 'dish' | 'meal' | 'deal'): Answer {
  return { kind: 'none', text: reply('noMore', r.lang, {}, seedOf(r, ctx.data)), cards: [], chips: refineChips(r, ctx.data, kind), shown: NOTHING_SHOWN, understood: true };
}

const sayChip = (label: string): Chip => ({ label, send: label });
const shortcutChip = (shortcut: 'deals' | 'usual', lang: Lang): Chip => ({ label: chipLabel(shortcut, lang), request: { ...emptyRequest(lang), shortcut } });
const moreChip = (r: Request): Chip => ({ label: chipLabel('more', r.lang), request: { ...r, page: r.page + 1 } });
const dishCard = (h: Hit): Card => ({ kind: 'dish', branchId: h.dish.branchId, productId: h.dish.id });
const dealCard = (d: AssistantDeal): Card => ({ kind: 'deal', branchId: d.branchId, dealId: d.id });
const dealItems = (d: AssistantDeal): string[] => (d.combo ? d.combo.items.map((i) => i.productId) : d.promotion?.productIds ?? []);
