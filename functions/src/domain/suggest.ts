import { createHash } from 'node:crypto';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  buildMeals, daypartOf, deriveTaste, dishSearchFields, emptyTasteDoc, evaluateOpen, parseWish, partySize, scoreDish, setAiDailyCapSchema,
  suggestMealsSchema, summaryLines, validateAiMeals, wishMatchLevel, wishQueries,
  type AiCandidate, type AiOutcome, type DerivedTaste, type DishFeedback, type DishIndexDoc, type DishType, type Locale, type Meal, type MealCandidate, type NoFit, type Order,
  type PlatformConfig, type PopularDayparts, type PublicPopular, type SuggestMealsInput, type TasteDoc,
} from '@qareeb/shared';
import { REGION, col, db, nowIso } from '../lib/firebase.js';
import { handled } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireAdmin, requireCaller } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { writeAudit } from '../lib/audit.js';
import { MAX_OUT_TOKENS, aiEnabled, getMealPicker } from '../lib/claude.js';
import { bumpTasteMetrics, recordAiSpend, reserveAiBudget } from '../lib/spend.js';
import { aiPrice } from '../lib/prices.js';
import { SYSTEM, schemaFor, userMessage } from '../lib/mealPrompt.js';
import type { PublicBranchDoc } from '../lib/projections.js';

const opts = { region: REGION, memory: '512MiB', timeoutSeconds: 30 } as const;
const AI_TIMEOUT_MS = 4500;
const PER_BRANCH = 6;
const BRANCHES = 8;
// The emulator reads fresh every call, so tests see menu changes at once.
const CACHE_MS = process.env.FUNCTIONS_EMULATOR === 'true' ? 0 : 60_000;
/** matchScore's level for a match on the place name only. */
const PLACE_LEVEL = 7;

type CityMenu = { at: number; branches: PublicBranchDoc[]; indexes: Map<string, DishIndexDoc>; popular: PopularDayparts | null };
const cityCache = new Map<string, CityMenu>();

/** The city's visible restaurants, their dish indexes and popular ranks, cached for a minute per instance. */
async function loadCity(cityId: string): Promise<CityMenu> {
  const hit = cityCache.get(cityId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const base = col.publicBranches().where('visible', '==', true).where('type', '==', 'restaurant');
  const [local, delivering, pop] = await Promise.all([base.where('cityId', '==', cityId).limit(60).get(), base.where('deliveryCityIds', 'array-contains', cityId).limit(60).get(), col.publicPopular(cityId).get()]);
  const seen = new Set<string>();
  const branches: PublicBranchDoc[] = [];
  for (const d of [...local.docs, ...delivering.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    branches.push(d.data() as PublicBranchDoc);
  }
  const idx = await Promise.all(branches.map((b) => col.publicDishIndex(b.id).get()));
  const indexes = new Map<string, DishIndexDoc>();
  idx.forEach((s, i) => { if (s.exists) indexes.set(branches[i]!.id, s.data() as DishIndexDoc); });
  const menu: CityMenu = { at: Date.now(), branches, indexes, popular: pop.exists ? (pop.data() as PublicPopular).dayparts : null };
  cityCache.set(cityId, menu);
  return menu;
}

/** Seeded shuffle, so candidate positions do not bias the model the same way on every call. */
function shuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const REFINE_WORD: Record<Locale, string> = { he: 'חריף', ar: 'حار', en: 'spicy' };

interface Profile { derived: DerivedTaste; aiConsent: boolean; uid: string | null }

async function loadProfile(req: CallableRequest<unknown>, input: Pick<SuggestMealsInput, 'ai' | 'anon'>, now: Date): Promise<Profile> {
  if (req.auth) {
    const c = await requireCaller(req);
    const [taste, orders, feedback] = await Promise.all([
      col.taste(c.uid).get(),
      col.orders().where('customer.uid', '==', c.uid).orderBy('placedAt', 'desc').limit(50).get(),
      col.dishFeedback(c.uid).limit(200).get(),
    ]);
    const doc = taste.exists ? (taste.data() as TasteDoc) : null;
    const derived = deriveTaste({ doc, orders: orders.docs.map((d) => d.data() as Order), feedback: feedback.docs.map((d) => d.data() as DishFeedback), now });
    return { derived, aiConsent: doc?.consent?.ai === true, uid: c.uid };
  }
  const iso = now.toISOString();
  const anonDoc: TasteDoc = {
    ...emptyTasteDoc(iso),
    consent: { orders: true, learn: !!input.anon, ai: input.ai === true, version: 1, locale: 'he', at: iso },
    quiz: input.anon ? { party: input.anon.party ?? null, pairs: input.anon.pairs, at: iso } : null,
  };
  return { derived: deriveTaste({ doc: anonDoc, orders: [], feedback: [], now }), aiConsent: input.ai === true, uid: null };
}

/**
 * A wish typed in search, answered with up to two meals that are open now. Code picks the candidates
 * and checks every fact; the AI (with consent, under the daily cap) only chooses among them. Any
 * failure falls back to the code builder, so the customer always gets an answer.
 */
export const suggestMeals = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const input = parse(suggestMealsSchema, req.data);
  const now = new Date();
  const ipKey = createHash('sha256').update(req.rawRequest?.ip ?? 'unknown').digest('hex').slice(0, 16);
  await rateLimit(req.auth ? `suggest:${req.auth.uid}` : `suggest:ip:${ipKey}`, 30, 3600);
  const profile = await loadProfile(req, input, now);
  const { derived } = profile;

  const wish = input.refine === 'spicier' ? `${input.wish} ${REFINE_WORD[input.locale]}` : input.wish;
  const facts = parseWish(wish);
  if (input.refine === 'cheaper' && input.prev?.minTotalAgorot) facts.budgetAgorot = Math.min(facts.budgetAgorot ?? Infinity, input.prev.minTotalAgorot - 100);
  const excluded = new Set(input.refine === 'other' ? input.prev?.branchIds ?? [] : []);
  const party = partySize(facts, derived);
  const daypart = daypartOf(now);

  // Candidates: available dishes from open places, scored by the wish's food words and the profile.
  const city = await loadCity(input.cityId);
  const queries = wishQueries(wish);
  const all: MealCandidate[] = [];
  const locales = new Map<string, Locale>();
  for (const b of city.branches) {
    if (excluded.has(b.id)) continue;
    const idx = city.indexes.get(b.id);
    if (!idx) continue;
    locales.set(b.id, b.businessDefaultLocale);
    const open = evaluateOpen(now, b.hours, b.hoursOverrides ?? []).open && !b.ordersPaused;
    for (const [productId, entry] of Object.entries(idx.dishes)) {
      if (!entry.available || (facts.noDrinks && entry.dishType === 'drinks')) continue;
      const d = { branchId: b.id, productId, entry, open };
      const score = scoreDish(d, { derived, popular: city.popular, daypart });
      if (score === -Infinity && open) continue;
      const level = queries.length ? wishMatchLevel(queries, dishSearchFields(entry, b.businessName)) : undefined;
      all.push({ ...d, score, ...(level !== undefined ? { wish: level } : {}) });
    }
  }
  // A place-name match ("שווארמה אבו סלים") makes every dish there match; it only counts when no
  // dish matches by its own name, type or description.
  if (all.some((c) => c.wish !== undefined && c.wish <= PLACE_LEVEL - 1)) for (const c of all) if (c.wish !== undefined && c.wish >= PLACE_LEVEL) delete c.wish;
  const wishMatched = all.some((c) => c.open && c.wish !== undefined);
  const rank = (a: MealCandidate, b: MealCandidate) => (wishMatched ? (a.wish ?? 99) - (b.wish ?? 99) : 0) || b.score - a.score || a.productId.localeCompare(b.productId);
  const openOnes = all.filter((c) => c.open);
  const byBranch = new Map<string, MealCandidate[]>();
  for (const c of openOnes) byBranch.set(c.branchId, [...(byBranch.get(c.branchId) ?? []), c]);
  const topBranches = [...byBranch.entries()].map(([id, list]) => ({ id, list: list.sort(rank) })).sort((a, b) => rank(a.list[0]!, b.list[0]!)).slice(0, BRANCHES);
  // A wish that names a food keeps to the dishes that match it, plus each place's sides.
  const picked = topBranches.flatMap((b) => b.list.filter((c) => !wishMatched || c.wish !== undefined || (c.entry.dishType && ['snacks', 'salads', 'pastries', 'desserts'].includes(c.entry.dishType))).slice(0, PER_BRANCH));

  // The food asked for exists only at places that are closed now: say so rather than offer other food.
  const closedOnly = queries.length > 0 && !wishMatched && all.some((c) => !c.open && c.wish !== undefined);
  const rules = closedOnly ? { meals: [] as Meal[], noFit: 'closed' as NoFit } : buildMeals({ candidates: picked.length ? picked : all, facts, derived, popular: city.popular, now });
  let meals: Meal[] = rules.meals;
  let noFit: NoFit = rules.noFit;
  let source: 'ai' | 'rules' = 'rules';

  let outcome: AiOutcome = 'skipped';
  let usage: { model?: string; inTok?: number; outTok?: number; ms?: number } = {};
  let pickPosition = 0;
  const aiAllowed = aiEnabled() && profile.aiConsent && picked.length > 0 && !closedOnly;
  const picker = getMealPicker();
  const price = aiPrice(picker.model);
  // Worst case for one call: the prompt (about 4 characters a token, rounded up generously) and a full answer.
  const reserved = Math.ceil(((SYSTEM.length + 120 * (picked.length + 12)) / 3) * price.input + MAX_OUT_TOKENS * price.output);
  const anon = !profile.uid;
  // A contended or failed hold must not break the wish: it is answered by code, counted as an error.
  const held = aiAllowed ? await reserveAiBudget(reserved, now, anon).catch((e: unknown) => { console.error('AI budget hold failed', e instanceof Error ? e.message : e); return null; }) : false;
  let summaryText: string | null = null;
  if (aiAllowed && held === null) outcome = 'error';
  else if (aiAllowed && !held) outcome = 'capped';
  else if (aiAllowed) {
    const shuffled = shuffle(picked, now.getTime() % 100_000);
    const candidates = shuffled.map((c, i): AiCandidate => ({ alias: `c${i + 1}`, branchId: c.branchId, productId: c.productId, entry: c.entry }));
    const placeOf = new Map<string, number>();
    for (const c of candidates) if (!placeOf.has(c.branchId)) placeOf.set(c.branchId, placeOf.size + 1);
    const typeOf = (b: string, p: string): DishType | undefined => city.indexes.get(b)?.dishes[p]?.dishType;
    const summary = summaryLines(derived, input.locale, typeOf);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const res = await picker.pick({ system: SYSTEM, user: userMessage({ wish, facts, party, locale: input.locale, daypart, summary, candidates, placeOf, locales }), schema: schemaFor(), signal: controller.signal });
      usage = { model: picker.model, inTok: res.inTok, outTok: res.outTok, ms: Date.now() - started };
      const valid = validateAiMeals(res.json, { candidates: new Map(candidates.map((c) => [c.alias, c])), facts, locale: input.locale });
      // Position bias: which slot (in sixes) of the shuffled list held the first dish the model chose.
      const firstPick = valid.meals[0]?.items[0];
      const slot = firstPick ? candidates.findIndex((c) => c.branchId === valid.meals[0]!.branchId && c.productId === firstPick.productId) : -1;
      if (slot >= 0) pickPosition = Math.floor(slot / 6) + 1;
      if (valid.meals.length === 0) {
        outcome = 'invalid';
      } else {
        outcome = 'ok';
        source = 'ai';
        // Fewer than two good meals: fill from the code builder, from another place where possible.
        const fill = rules.meals.filter((m) => !valid.meals.some((v) => v.branchId === m.branchId));
        meals = [...valid.meals, ...fill].slice(0, 2);
        noFit = 'none';
      }
      summaryText = summary.join('\n');
    } catch (e) {
      const aborted = controller.signal.aborted;
      outcome = aborted ? 'timeout' : 'error';
      usage = { model: picker.model, ms: Date.now() - started };
      console.error('suggestMeals AI failed', aborted ? 'timeout' : e instanceof Error ? e.message : e);
    } finally {
      clearTimeout(timer);
    }
  }
  // What was sent is kept for the knows-me page, unless AI consent was withdrawn during the call.
  if (profile.uid && summaryText !== null) {
    const ref = col.taste(profile.uid);
    const text = summaryText;
    await db.runTransaction(async (tx) => {
      const doc = (await tx.get(ref)).data() as TasteDoc | undefined;
      if (doc?.consent?.ai === true) tx.set(ref, { lastAiSummary: { text, at: nowIso() } }, { merge: true });
    }).catch((e: unknown) => console.error('AI summary save failed', e instanceof Error ? e.message : e));
  }
  await bumpTasteMetrics({
    suggestionsShown: meals.length,
    aiCalls: outcome === 'ok' || outcome === 'invalid' || outcome === 'timeout' || outcome === 'error' ? 1 : 0,
    aiFallbacks: outcome === 'invalid' || outcome === 'timeout' || outcome === 'error' || outcome === 'capped' ? 1 : 0,
    aiTimeouts: outcome === 'timeout' ? 1 : 0,
    ...(pickPosition ? { [`aiPickPos${pickPosition}`]: 1 } : {}),
  }, now).catch((e: unknown) => console.error('taste metrics failed', e instanceof Error ? e.message : e));
  await recordAiSpend({ outcome, ...usage, ...(held ? { reserved } : {}), anon }, now).catch((e: unknown) => console.error('spend record failed', e instanceof Error ? e.message : e));

  // Names and prices stay out: the client renders them from its live dish indexes.
  return {
    meals: meals.map((m) => ({ branchId: m.branchId, items: m.items, reason: m.reason, source: m.source, ...(m.title ? { title: m.title } : {}) })),
    noFit,
    source,
    party,
    ...(facts.budgetAgorot !== undefined && Number.isFinite(facts.budgetAgorot) ? { budgetAgorot: facts.budgetAgorot } : {}),
  };
}));

/** Admin: the daily AI spend cap, from $0 (AI off) to $50. */
export const setAiDailyCap = onCall({ region: REGION }, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireAdmin(c);
  const input = parse(setAiDailyCapSchema, req.data);
  const micro = Math.round(input.usd * 1_000_000);
  await db.runTransaction(async (tx) => {
    const before = (await tx.get(col.config())).data() as PlatformConfig | undefined;
    tx.set(col.config(), { aiDailyCapMicroUsd: micro, updatedAt: nowIso() }, { merge: true });
    writeAudit(tx, { actorUid: c.uid, action: 'config.aiDailyCap', targetType: 'config', targetId: 'platform', before: { aiDailyCapMicroUsd: before?.aiDailyCapMicroUsd ?? null }, after: { aiDailyCapMicroUsd: micro } });
  });
  return { ok: true, aiDailyCapMicroUsd: micro };
}));


const TASTE_EVENTS = ['meal_added', 'usual_reorder', 'try_tap'] as const;
const EVENT_FIELD: Record<(typeof TASTE_EVENTS)[number], string> = { meal_added: 'mealsAdded', usual_reorder: 'usualReorders', try_tap: 'tryTaps' };

/** Counts a home-band or wish action that only the client sees. Sign-in optional; counts only. */
export const trackTaste = onCall({ region: REGION }, handled(async (req: CallableRequest<unknown>) => {
  const input = parse(z.object({ event: z.enum(TASTE_EVENTS) }).strict(), req.data);
  const ipKey = createHash('sha256').update(req.rawRequest?.ip ?? 'unknown').digest('hex').slice(0, 16);
  await rateLimit(req.auth ? `track:${req.auth.uid}` : `track:ip:${ipKey}`, 120, 3600);
  await bumpTasteMetrics({ [EVENT_FIELD[input.event]]: 1 });
  return { ok: true };
}));
