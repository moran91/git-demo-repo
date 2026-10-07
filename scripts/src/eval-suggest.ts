/**
 * Wish evaluation against the real model on Vertex AI (spec 9 and 9.1). Run by hand before every
 * prompt or model change; about ₪0.5 per model per run. Needs Application Default Credentials for
 * qareeb-dev (`gcloud auth application-default login`) and the model enabled in Model Garden.
 *
 *   npm run eval:suggest -w scripts                      # Claude Haiku 4.5
 *   npm run eval:suggest -w scripts -- gemini-3-flash-preview # another model id, same prompt
 *
 * 50 fixed wishes (20 Hebrew, 20 Arabic, 10 mixed / Arabizi with typos) against a fixture village.
 * Scores what the selection rule needs: constraint pass rate (budget, party, no drinks, ids only),
 * variety between the two meals, title validity, fallback rate, p95 latency and cost.
 */
import {
  deriveTaste, dishKey, dishSearchFields, parseWish, partySize, scoreDish, validateAiMeals, wishMatchLevel, wishQueries,
  type AiCandidate, type DishIndexEntry, type DishType, type Locale, type MealCandidate,
} from '@qareeb/shared';
import { SYSTEM, schemaFor, userMessage } from '../../functions/src/lib/mealPrompt.ts';
import { aiPrice } from '../../functions/src/lib/prices.ts';
import { pickerFor } from '../../functions/src/lib/claude.ts';

const MODEL = process.argv[2] ?? 'claude-haiku-4-5@20251001';
const PROJECT = process.env.GCLOUD_PROJECT ?? 'qareeb-dev';
const TIMEOUT_MS = 4500;

type Dish = [id: string, he: string, ar: string, type: DishType, shekels: number];
const PLACES: Array<{ id: string; he: string; ar: string; dishes: Dish[] }> = [
  { id: 'pizza-house', he: 'פיצה האוס', ar: 'بيتزا هاوس', dishes: [['margherita', 'מרגריטה', 'مارغريتا', 'pizza', 48], ['family-pizza', 'פיצה משפחתית', 'بيتزا عائلية', 'pizza', 75], ['garlic-bread', 'לחם שום', 'خبز بالثوم', 'snacks', 18], ['cola', 'קולה', 'كولا', 'drinks', 8], ['pasta-alfredo', 'פסטה אלפרדו', 'باستا ألفريدو', 'pasta', 52]] },
  { id: 'abu-salim', he: 'שווארמה אבו סלים', ar: 'شاورما أبو سليم', dishes: [['shawarma', 'שווארמה בפיתה', 'شاورما بالخبز', 'shawarma', 35], ['shawarma-plate', 'צלחת שווארמה', 'صحن شاورما', 'shawarma', 55], ['falafel', 'פלאפל', 'فلافل', 'mains', 22], ['fries', 'צ׳יפס', 'بطاطا مقلية', 'snacks', 12], ['knafeh', 'כנאפה', 'كنافة', 'desserts', 18], ['juice', 'מיץ טבעי', 'عصير طبيعي', 'drinks', 12]] },
  { id: 'burger-bar', he: 'בורגר בר', ar: 'برغر بار', dishes: [['classic-burger', 'בורגר קלאסי', 'برغر كلاسيك', 'burger', 49], ['double-burger', 'דאבל בורגר', 'دبل برغر', 'burger', 69], ['onion-rings', 'טבעות בצל', 'حلقات بصل', 'snacks', 19], ['caesar', 'סלט קיסר', 'سلطة سيزر', 'salads', 38], ['sprite', 'ספרייט', 'سبرايت', 'drinks', 8]] },
  { id: 'hummus-place', he: 'חומוס אל-באב', ar: 'حمص الباب', dishes: [['hummus', 'חומוס', 'حمص', 'hummus', 28], ['hummus-meat', 'חומוס בשר', 'حمص باللحمة', 'hummus', 42], ['salad', 'סלט ערבי', 'سلطة عربية', 'salads', 16], ['pita', 'פיתות', 'خبز', 'pastries', 6]] },
  { id: 'sushi-go', he: 'סושי גו', ar: 'سوشي غو', dishes: [['roll-salmon', 'רול סלמון', 'رول سلمون', 'sushi', 46], ['combo-24', 'קומבו 24 יח׳', 'كومبو 24 قطعة', 'sushi', 119], ['edamame', 'אדממה', 'إدامامي', 'snacks', 18]] },
  { id: 'grill', he: 'המנגל של סאמר', ar: 'مشاوي سامر', dishes: [['kebab', 'קבב', 'كباب', 'mains', 58], ['chicken-skewers', 'שיפודי עוף', 'أسياخ دجاج', 'mains', 54], ['mixed-grill', 'מעורב ירושלמי', 'مشاوي مشكلة', 'mains', 89], ['tahini-salad', 'סלט טחינה', 'سلطة طحينة', 'salads', 14]] },
];

const WISHES: Array<[string, Locale]> = [
  ['לארבעה עד 200, בלי שתייה', 'he'], ['פיצה לשניים', 'he'], ['משהו קל לצהריים', 'he'], ['בורגר וצ׳יפס', 'he'], ['ארוחה למשפחה עד 250', 'he'],
  ['שווארמה לשלושה', 'he'], ['משהו בלי בשר', 'he'], ['סושי לשניים עד 150', 'he'], ['חומוס עם סלט', 'he'], ['ארוחת ערב לחמישה', 'he'],
  ['משהו מתוק אחרי האוכל', 'he'], ['פסטה ל-2 עד 120', 'he'], ['גריל לארבעה', 'he'], ['משהו זול', 'he'], ['ילדים יאכלו את זה', 'he'],
  ['סלט ומשהו חם', 'he'], ['ארוחה מהירה לאחד', 'he'], ['בורגר לשישה בלי שתייה', 'he'], ['משהו חריף', 'he'], ['פלאפל לשניים עד 60', 'he'],
  ['عشاء لأربعة حتى 200 بدون مشروبات', 'ar'], ['بيتزا لشخصين', 'ar'], ['شي خفيف للغدا', 'ar'], ['برغر مع بطاطا', 'ar'], ['وجبة للعيلة حتى 250', 'ar'],
  ['شاورما لثلاثة', 'ar'], ['اكل نباتي', 'ar'], ['سوشي لاثنين حتى 150', 'ar'], ['حمص مع سلطة', 'ar'], ['عشا لخمسة', 'ar'],
  ['حلو بعد الاكل', 'ar'], ['باستا ل2 حتى 120', 'ar'], ['مشاوي لأربعة', 'ar'], ['اشي رخيص', 'ar'], ['اكل للاولاد', 'ar'],
  ['سلطة وشي سخن', 'ar'], ['وجبة سريعة لشخص', 'ar'], ['برغر لستة بدون مشروبات', 'ar'], ['شي حار', 'ar'], ['فلافل لاثنين حتى 60', 'ar'],
  ['שווארמה لأربعة حتى 200', 'he'], ['pizza ל-3', 'he'], ['burger w chips for 2', 'en'], ['shawerma l 4 bdon mashrobat', 'ar'], ['בורגר لاثنين', 'ar'],
  ['hummus w salata', 'ar'], ['פיצא משפחתית', 'he'], ['سوشى لشخصين', 'ar'], ['grill for 5 under 300', 'en'], ['פלפל עם חומוס', 'he'],
];

const now = new Date();
const entries = new Map<string, DishIndexEntry>();
const candidatesAll: Array<MealCandidate & { place: { he: string; ar: string } }> = [];
for (const p of PLACES) {
  p.dishes.forEach(([id, he, ar, type, price], i) => {
    const entry: DishIndexEntry = { name: { he, ar }, priceAgorot: price * 100, fromPrice: false, dishType: type, available: true, needsChoice: false, sortOrder: i };
    entries.set(dishKey(p.id, id), entry);
    candidatesAll.push({ branchId: p.id, productId: id, entry, open: true, score: 0, place: { he: p.he, ar: p.ar } });
  });
}
const derived = deriveTaste({ doc: null, orders: [], feedback: [], now });

process.env.GCLOUD_PROJECT = PROJECT;
const picker = pickerFor(MODEL);
const price = aiPrice(MODEL);
type Row = { wish: string; ok: boolean; meals: number; rejected: string[]; variety: boolean; titlesOk: boolean; ms: number; micro: number; fallback: string | null };
const rows: Row[] = [];

for (const [wish, locale] of WISHES) {
  const facts = parseWish(wish);
  const queries = wishQueries(wish);
  const scored = candidatesAll
    .filter((c) => !(facts.noDrinks && c.entry.dishType === 'drinks'))
    .map((c) => ({ ...c, score: scoreDish(c, { derived, popular: null, daypart: 'evening' }), wish: queries.length ? wishMatchLevel(queries, dishSearchFields(c.entry, c.place)) : undefined }));
  const candidates: AiCandidate[] = scored.sort(() => Math.random() - 0.5).map((c, i) => ({ alias: `c${i + 1}`, branchId: c.branchId, productId: c.productId, entry: c.entry }));
  const placeOf = new Map<string, number>();
  for (const c of candidates) if (!placeOf.has(c.branchId)) placeOf.set(c.branchId, placeOf.size + 1);
  const user = userMessage({ wish, facts, party: partySize(facts, derived), locale, daypart: 'evening', summary: [], candidates, placeOf, locales: new Map(PLACES.map((p) => [p.id, 'he' as Locale])) });
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await picker.pick({ system: SYSTEM, user, schema: schemaFor(), signal: controller.signal });
    const ms = Date.now() - started;
    const json = res.json;
    const raw = (json as { meals?: Array<{ title?: unknown }> } | null)?.meals ?? [];
    const valid = validateAiMeals(json, { candidates: new Map(candidates.map((c) => [c.alias, c])), facts, locale });
    const constraintRejects = valid.rejected.filter((r) => r !== 'title' && r !== 'duplicate');
    rows.push({
      wish, ms, micro: res.inTok * price.input + res.outTok * price.output,
      ok: constraintRejects.length === 0 && valid.meals.length > 0,
      meals: valid.meals.length, rejected: valid.rejected,
      variety: valid.meals.length < 2 || valid.meals[0]!.branchId !== valid.meals[1]!.branchId,
      titlesOk: raw.length === 0 || !valid.rejected.includes('title'),
      fallback: valid.meals.length === 0 ? 'invalid' : null,
    });
  } catch (e) {
    rows.push({ wish, ms: Date.now() - started, micro: 0, ok: false, meals: 0, rejected: [], variety: false, titlesOk: false, fallback: controller.signal.aborted ? 'timeout' : `error: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}` });
  } finally {
    clearTimeout(timer);
  }
  const r = rows[rows.length - 1]!;
  console.log(`${r.ok ? '✓' : '✗'} ${String(r.ms).padStart(5)}ms  ${r.meals} meals  ${r.fallback ?? r.rejected.join(',')}  ${wish}`);
}

const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
const by = (filter: (i: number) => boolean) => rows.filter((_, i) => filter(i));
const pass = (list: Row[]) => (list.length ? `${Math.round((list.filter((r) => r.ok).length / list.length) * 100)}%` : '—');
const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`\nModel ${MODEL}`);
console.log(`Constraint pass: all ${pass(rows)} · Hebrew ${pass(by((i) => i < 20))} · Arabic ${pass(by((i) => i >= 20 && i < 40))} · mixed ${pass(by((i) => i >= 40))}`);
console.log(`Variety ${pct(rows.filter((r) => r.variety).length)} · titles valid ${pct(rows.filter((r) => r.titlesOk).length)} · fallback ${pct(rows.filter((r) => r.fallback).length)}`);
console.log(`Latency p50 ${sorted[Math.floor(sorted.length / 2)]}ms · p95 ${sorted[Math.floor(sorted.length * 0.95)]}ms · cost $${(rows.reduce((s, r) => s + r.micro, 0) / 1e6).toFixed(4)}`);
