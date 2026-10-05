/** The home's assistant strip: a time-of-day greeting, up to three ready picks (your usual, the best deal, a pick for now) from different places, and suggestion chips. */
import type { DishType } from '../dishIndex.js';
import { dictionaries } from '../i18n/index.js';
import { clockAt, localHour, type AssistantData } from './data.js';
import { mealOf, rank } from './rank.js';
import { chipLabel, reply, type ReplyKey } from './replies.js';
import { shortcutChips, type Card, type Chip, type RespondOptions } from './respond.js';
import { placeUsable, retrieve } from './retrieve.js';
import { emptyRequest } from './understand.js';

export interface HomeView {
  greeting: string;
  cards: Card[];
  chips: Chip[];
  /** Set when every place is closed: when the first one opens. */
  closedUntil?: string;
}

const GREETING: Record<ReturnType<typeof mealOf>, ReplyKey> = { breakfast: 'greetMorning', lunch: 'greetNoon', dinner: 'greetEvening', late: 'greetNight' };

export function homeView(data: AssistantData, opts: RespondOptions): HomeView {
  const lang = opts.uiLang;
  const meal = mealOf(localHour(data.now));
  const places = [...data.places.values()];
  if (!places.some((p) => p.open)) {
    const minutes = Math.min(...places.map((p) => p.opensInMin ?? Number.POSITIVE_INFINITY));
    const time = Number.isFinite(minutes) ? clockAt(data.now, minutes) : '';
    return { greeting: reply('closedAll', lang, { time }, data.seed), cards: [], chips: [], ...(time ? { closedUntil: time } : {}) };
  }
  const cards: Card[] = [];
  const used = new Set<string>();
  const usual = opts.signedIn ? data.profile?.usuals.find((u) => placeUsable(data.places.get(u.branchId))) : undefined;
  if (usual) {
    cards.push({ kind: 'usual', usual });
    used.add(usual.branchId);
  }
  const deal = data.deals
    .filter((d) => placeUsable(data.places.get(d.branchId)) && !used.has(d.branchId))
    .sort((a, b) => Number(!a.combo) - Number(!b.combo) || Number(!(a.combo?.imagePath ?? a.promotion?.imagePath)) - Number(!(b.combo?.imagePath ?? b.promotion?.imagePath)))[0];
  if (deal) {
    cards.push({ kind: 'deal', branchId: deal.branchId, dealId: deal.id });
    used.add(deal.branchId);
  }
  const r = { ...emptyRequest(lang), meal };
  const pick = rank(retrieve(r, data), r, data).find((h) => !used.has(h.dish.branchId));
  if (pick) cards.push({ kind: 'dish', branchId: pick.dish.branchId, productId: pick.dish.id });

  const chips: Chip[] = [{ label: chipLabel(meal, lang), request: r }, ...shortcutChips(lang, data, opts.signedIn)];
  const type = topType(data);
  if (type) {
    const label = dictionaries[lang][`dishType.${type}`];
    chips.push({ label, send: label });
  }
  return { greeting: reply(GREETING[meal], lang, {}, data.seed), cards, chips: chips.slice(0, 4) };
}

function topType(data: AssistantData): DishType | undefined {
  const counts = new Map<DishType, number>();
  for (const d of data.dishes) if (d.entry.dishType && d.entry.dishType !== 'drinks' && placeUsable(data.places.get(d.branchId))) counts.set(d.entry.dishType, (counts.get(d.entry.dishType) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}
