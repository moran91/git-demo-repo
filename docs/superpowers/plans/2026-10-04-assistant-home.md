# Assistant Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the customer home with a free, on-device food assistant ("✦ מה בא לך?") that understands Hebrew/Arabic/English/Arabizi requests and sells: picks, one-place meals for N people within a budget, deals, upsells and "your usual".

**Architecture:** A pure TypeScript engine in `packages/shared/src/assistant/` (no React, no Firebase, no LLM) reads per-branch public index documents (dishes, plus new deals and pairs documents) and the customer's own orders, and turns a message into a typed `Request`, then into an answer turn made of short text + cards + chips. Cloud Functions add owner-editable dish `tags`/`serves` (auto-filled, owner wins), project a deals index and build a nightly pairs index. The web app adds a `/ask` chat page and a new home section; it reuses the existing quick-add, ProductSheet and ComboSheet flows.

**Tech Stack:** TypeScript, React 19 + react-router, Firebase (Firestore, Cloud Functions v2), zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-assistant-home-design.md`

## Global Constraints

- No LLM or paid API anywhere in this feature (owner decision 2026-10-04).
- Shared package imports use `.js` suffixes (`import { x } from './file.js'`); shared tests live in `packages/shared/test/**` (vitest include `test/**/*.test.ts`).
- Every vocabulary term is folded with `normalizeSearch` (from `packages/shared/src/dishIndex.ts`) before comparison; final letters and `ة→ه`, `أإآ→ا` are folded, geresh/quotes removed.
- Prices are agorot integers (`Agorot = number`).
- Firestore rejects `undefined`: optional fields are set with conditional spreads, never as `undefined` values.
- Owner wins: a value the owner chose is never overwritten by automatic tagging.
- Ranking stays neutral between places (rotation by `daySeed`), except a small boost for the cart's place and for deals; deals are always labelled.
- Supermarkets are out of the assistant (no dish index); they stay in the places list.
- Copy rule: no helper text that restates a label or what a card shows; assistant lines are one short sentence. Hebrew addresses the customer in plural ("תסמכו עליי").
- Numbers and prices inside RTL text are wrapped in `<bdi>`; Arabic highlights use tint, never bold.
- i18n: every new UI key goes into `packages/shared/src/i18n/en.ts`, `he.ts` and `ar.ts` (the `Dictionary` type is derived from `en`).
- Deploys to `qareeb-dev` and the auto-tag `--apply` run only after the user explicitly approves (the dry-run review page comes first).
- The git tree may hold unrelated uncommitted work: stage only the files a task names (`git add <paths>`), never `git add -A`, never `git checkout`/`git restore` a file.

## Review Focus

1. **Mixed digits and glued tokens** ("ל-٤", "لـ٤", "150₪", "ל4"): the reader must still find people/budget. Pinned in Task 6 (`understand.test.ts` → "digits and glued tokens").
2. **A budget below every possible basket** ("ל-6 עד 30"): the answer must say the budget blocked it and offer a chip to drop it, never an empty card list. Pinned in Task 9 (`respond.test.ts` → "budget too low").
3. **Late night, every place closed:** home picks and chat must say when the first place opens and show no add buttons. Pinned in Task 9 (`respond.test.ts` → "all closed").
4. **A conversation restored from sessionStorage after a menu change** (dish removed or sold out): its cards must drop silently, not crash. Pinned in Task 9 (`cards.test.ts`).
5. **"Add all" while the cart holds another place:** one replace-cart confirm before any line is added. Pinned in Task 14 (`e2e/assistant.spec.ts` → "replace cart once").

---

## File Structure

**Shared engine — `packages/shared/src/assistant/`** (exported from `packages/shared/src/index.ts` via `./assistant/index.js`)

| File | Responsibility |
|---|---|
| `text.ts` | tokenize (digits, ₪, glued letters), one-letter prefix forms, term matchers |
| `tags.ts` | `DISH_TAGS`, tag/type/serves vocabularies, `TAG_LABELS`, `autoTags()` |
| `ownership.ts` | `AutoFields`, `resolveAutoFields()`, `isMachineOwned()` |
| `vocab.ts` | request vocabularies (numbers, budget, people, mode, meal, shortcuts, stopwords) |
| `understand.ts` | `Request`, `understand()`, `detectLang()`, `hasSlots()` |
| `data.ts` | `AssistantPlace/Dish/Deal/Data`, `prepareDishes()`, `buildAssistantData()`, time helpers |
| `retrieve.ts` | `retrieve()` with relaxable `Filters`, `placeUsable()` |
| `rank.ts` | `rank()`, `diversify()`, `mealOf()`, `hashUnit()` |
| `mealBuilder.ts` | `buildMeals()`, `applyCombos()`, `servesOf()` |
| `upsell.ts` | `upsellFor()` |
| `profile.ts` | `buildProfile()`, `Usual`, `Profile` |
| `pairs.ts` | `computePairs()` (used by functions) |
| `replies.ts` | reply templates (he/ar/en, 3 wordings), chip labels, slot labels |
| `respond.ts` | `Conversation`, `respond()`, `afterAdd()` |
| `home.ts` | `homeView()` |
| `cards.ts` | `resolveCard()` |
| `index.ts` | re-exports |

**Shared types/schema:** `packages/shared/src/types.ts` (Product fields), `schemas.ts` (productInputSchema), `dishIndex.ts` (entry tags/serves, deals/pairs docs).

**Functions:** `functions/src/domain/catalog.ts` (saveProduct), `functions/src/lib/projections.ts` (deals index), `functions/src/lib/firebase.ts` (col refs), `functions/src/domain/pairs.ts` (new), `functions/src/triggers.ts` + `functions/src/index.ts` (buildPairs).

**Scripts:** `scripts/src/auto-tag.ts` (new).

**Web:** `apps/web/src/customer/dishIndex.ts` (generic index hook), `apps/web/src/customer/assistant/` (new: `useAssistantData.ts`, `useQuickAdd.tsx`, `Cards.tsx`, `AskPage.tsx`, `AssistantHome.tsx`, `conversation.ts`, `assistant.css`), `DiscoveryPage.tsx`, `app/App.tsx`, `business/CatalogPages.tsx` (editor), i18n files. Deleted: `CravingsHome.tsx`, `cravings.css`, `e2e/cravings.spec.ts`.

**Tests:** `packages/shared/test/assistant/*.test.ts`, `functions/test/assistant-fields.test.ts`, `functions/test/deals-index.test.ts`, `functions/test/pairs.test.ts`, `tests/rules/firestore.test.ts`, `e2e/assistant.spec.ts`.

Commands used throughout:
- Shared tests: `npm run test -w packages/shared -- <file>`
- Functions tests (need emulators: `npm run emulators:ci` in another terminal, then): `npm run test -w functions -- <file>`
- Rules tests: `npm run test:rules`
- Typecheck: `npm run typecheck`
- E2E (emulators + seed + web dev running): `npm run test:e2e -- assistant.spec.ts`

---

### Task 1: Text helpers and the automatic tagger

**Files:**
- Create: `packages/shared/src/assistant/text.ts`
- Create: `packages/shared/src/assistant/tags.ts`
- Create: `packages/shared/src/assistant/index.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './assistant/index.js';`)
- Test: `packages/shared/test/assistant/tags.test.ts`

**Interfaces:**
- Produces: `tokenize(text): string[]`, `latinDigits(s)`, `wordForms(word): string[]`, `foldAll(words): string[]`, `termMatcher(terms): TermMatcher`, `prepareText(text): Prepared`, `countMatches(t: Prepared, m: TermMatcher): number`; `DISH_TAGS`, `type DishTag`, `TAG_TERMS`, `TYPE_TERMS`, `PEOPLE_TERMS`, `TAG_MATCHERS`, `TAG_LABELS: Record<DishTag, Record<Locale,string>>`, `explicitPeople(t: Prepared): number | undefined`, `autoTags(input: AutoTagInput): AutoTagResult` where `AutoTagInput = { name: Localized; description?: Localized; categoryName?: Localized }`, `AutoTagResult = { tags: DishTag[]; serves: number; dishType?: DishType }`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/assistant/tags.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { autoTags, tokenize, wordForms } from '../../src/index.js';

describe('tokenize', () => {
  it('splits digits from Hebrew/Arabic letters, keeps Arabizi, separates ₪, converts Arabic-Indic digits', () => {
    expect(tokenize('ל-4')).toEqual(['ל', '4']);
    expect(tokenize('ל4')).toEqual(['ל', '4']);
    expect(tokenize('لـ٤')).toEqual(['ل', '4']);
    expect(tokenize('150₪')).toEqual(['150', '₪']);
    expect(tokenize('shi 7ar')).toEqual(['shi', '7ar']);
    expect(tokenize('50 ש"ח')).toEqual(['50', 'שח']);
  });
  it('word forms drop one Hebrew or Arabic prefix', () => {
    expect(wordForms('הפיצה')).toContain('פיצה');
    expect(wordForms('לשניימ')).toContain('שניימ');
    expect(wordForms('والبيتزا')).toContain('بيتزا');
    expect(wordForms('pizza')).toEqual(['pizza']);
  });
});

describe('autoTags', () => {
  it('reads type, serves and taste from a Hebrew name', () => {
    const r = autoTags({ name: { he: 'פיצה משפחתית חריפה' } });
    expect(r.dishType).toBe('pizza');
    expect(r.serves).toBe(4);
    expect(r.tags).toEqual(expect.arrayContaining(['spicy', 'vegetarian', 'sharing']));
  });
  it('meat on a pizza removes vegetarian', () => {
    const r = autoTags({ name: { he: 'פיצה פפרוני' } });
    expect(r.tags).toContain('meat');
    expect(r.tags).not.toContain('vegetarian');
    expect(r.serves).toBe(2);
  });
  it('reads Arabic', () => {
    const r = autoTags({ name: { ar: 'شاورما دجاج حارة' } });
    expect(r.dishType).toBe('shawarma');
    expect(r.tags).toEqual(expect.arrayContaining(['chicken', 'spicy']));
    expect(r.tags).not.toContain('vegetarian');
  });
  it('a chicken burger is not meat', () => {
    const r = autoTags({ name: { en: 'Chicken burger' } });
    expect(r.dishType).toBe('burger');
    expect(r.tags).toContain('chicken');
    expect(r.tags).not.toContain('meat');
  });
  it('iced coffee is a cold drink, not a hot one', () => {
    const r = autoTags({ name: { he: 'אייס קפה' } });
    expect(r.dishType).toBe('drinks');
    expect(r.tags).toContain('cold_drink');
    expect(r.tags).not.toContain('hot_drink');
  });
  it('coffee is a hot drink', () => {
    expect(autoTags({ name: { he: 'קפה הפוך' } }).tags).toContain('hot_drink');
  });
  it('the category names drinks', () => {
    const r = autoTags({ name: { he: 'קוקה קולה' }, categoryName: { he: 'שתייה' } });
    expect(r.dishType).toBe('drinks');
    expect(r.tags).toContain('cold_drink');
  });
  it('serves: tray 6, pair 2, explicit number, slice 1', () => {
    expect(autoTags({ name: { he: 'מגש סושי 40 יחידות' } })).toMatchObject({ dishType: 'sushi', serves: 6 });
    expect(autoTags({ name: { he: 'ארוחה זוגית' } }).serves).toBe(2);
    expect(autoTags({ name: { en: 'Family meal for 5 people' } }).serves).toBe(5);
    expect(autoTags({ name: { he: 'משולש פיצה' } }).serves).toBe(1);
  });
  it('desserts are sweet; a cold salad is not a drink', () => {
    expect(autoTags({ name: { he: 'כנאפה' } })).toMatchObject({ dishType: 'desserts', tags: expect.arrayContaining(['sweet']) });
    const salad = autoTags({ name: { he: 'סלט קר' } });
    expect(salad.dishType).toBe('salads');
    expect(salad.tags).not.toContain('cold_drink');
    expect(salad.tags).toContain('vegetarian');
  });
  it('breakfast pastries and kids', () => {
    expect(autoTags({ name: { ar: 'منقوشة زعتر' } })).toMatchObject({ dishType: 'pastries', tags: expect.arrayContaining(['breakfast', 'vegetarian']) });
    expect(autoTags({ name: { en: 'Kids meal nuggets' } }).tags).toEqual(expect.arrayContaining(['kids', 'chicken']));
  });
  it('an unknown dish gets no type, serves 1', () => {
    expect(autoTags({ name: { he: 'מנת השף' } })).toEqual({ tags: [], serves: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w packages/shared -- test/assistant/tags.test.ts`
Expected: FAIL — `autoTags` / `tokenize` are not exported.

- [ ] **Step 3: Write `text.ts`**

`packages/shared/src/assistant/text.ts`:
```ts
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

/** A folded word and the same word without one Hebrew or Arabic prefix. */
export function wordForms(word: string): string[] {
  const out = [word];
  if (!HE_OR_AR.test(word.charAt(0))) return out;
  const prefixes = /[֐-׿]/.test(word.charAt(0)) ? HE_PREFIXES : AR_PREFIXES;
  for (const p of prefixes) if (word.startsWith(p) && word.length - p.length >= 2) out.push(word.slice(p.length));
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
```

- [ ] **Step 4: Write `tags.ts`**

`packages/shared/src/assistant/tags.ts`:
```ts
/**
 * Dish tags and the automatic tagger. Tags power the assistant's taste and diet filters ("משהו חריף",
 * "צמחוני", "לילדים"); `serves` powers "for 4". autoTags reads a dish's texts in every language, so
 * imported menus get tags without anyone typing them. Owners can correct the result (owner wins).
 */
import { DISH_TYPES, type DishType } from '../dishIndex.js';
import type { Locale, Localized } from '../types.js';
import { countMatches, foldAll, prepareText, termMatcher, type Prepared, type TermMatcher } from './text.js';

export const DISH_TAGS = ['spicy', 'vegetarian', 'vegan', 'gluten_free', 'kids', 'healthy', 'breakfast', 'sweet', 'cold_drink', 'hot_drink', 'meat', 'chicken', 'fish', 'cheese', 'sharing'] as const;
export type DishTag = (typeof DISH_TAGS)[number];

/** Words that mark each tag, in Hebrew, Arabic, English and Arabizi. */
export const TAG_TERMS: Record<DishTag, readonly string[]> = {
  spicy: ['חריף', 'חריפה', 'חריפים', 'חריפות', 'צ׳ילי', 'צילי', 'חלפיניו', 'חלפניו', 'harif', 'حار', 'حارة', 'حراق', 'شطة', 'spicy', 'chili', 'chilli', 'jalapeno', '7ar', '7ara', 'harr'],
  vegetarian: ['צמחוני', 'צמחונית', 'צמחוניים', 'צמחוניות', 'vegetarian', 'veggie', 'נבאטי', 'نباتي', 'نباتية'],
  vegan: ['טבעוני', 'טבעונית', 'טבעוניים', 'טבעוניות', 'vegan', 'فيغن', 'فيجان', 'نباتي صرف'],
  gluten_free: ['ללא גלוטן', 'בלי גלוטן', 'נטול גלוטן', 'gluten free', 'glutenfree', 'خالي من الغلوتين', 'بدون غلوتين', 'بدون جلوتين'],
  kids: ['ילדים', 'ילד', 'ילדות', 'קידס', 'kids', 'kid', 'children', 'child', 'junior', 'اطفال', 'أطفال', 'ولاد', 'اولاد', 'أولاد', 'صغار', 'كيدز'],
  healthy: ['בריא', 'בריאה', 'בריאים', 'דיאט', 'דיאטטי', 'כושר', 'healthy', 'light', 'diet', 'fit', 'keto', 'protein', 'صحي', 'صحية', 'دايت', 'لايت', 'بروتين'],
  breakfast: ['בוקר', 'שקשוקה', 'חביתה', 'טוסט', 'קרואסון', 'פנקייק', 'פנקייקים', 'לאבנה', 'לבנה', 'breakfast', 'brunch', 'omelette', 'omelet', 'shakshuka', 'croissant', 'toast', 'pancake', 'pancakes', 'labneh', 'فطور', 'ترويقة', 'شكشوكة', 'عجة', 'كرواسون', 'توست', 'منقوشة', 'مناقيش', 'لبنة', 'מנאקיש', 'מנקיש', 'manakish', 'manaqish'],
  sweet: ['מתוק', 'מתוקה', 'קינוח', 'קינוחים', 'שוקולד', 'נוטלה', 'וופל', 'גלידה', 'עוגה', 'עוגת', 'כנאפה', 'קנאפה', 'בקלאווה', 'קרפ', 'מלבי', 'sweet', 'dessert', 'chocolate', 'nutella', 'waffle', 'ice cream', 'cake', 'knafeh', 'kunafa', 'baklava', 'crepe', 'حلو', 'حلويات', 'شوكولا', 'شوكولاته', 'نوتيلا', 'وافل', 'بوظة', 'ايس كريم', 'كيك', 'كنافة', 'بقلاوة', 'كريب', 'مهلبية'],
  cold_drink: ['קולה', 'קוקה', 'ספרייט', 'פאנטה', 'זירו', 'מיץ', 'מים', 'סודה', 'לימונדה', 'שייק', 'מילקשייק', 'אייס', 'קר', 'קרה', 'בירה', 'פריגת', 'גרוס', 'סמוזי', 'cola', 'coke', 'sprite', 'fanta', 'juice', 'water', 'soda', 'lemonade', 'shake', 'milkshake', 'iced', 'ice', 'cold', 'beer', 'smoothie', 'slush', 'redbull', 'red bull', 'كولا', 'كوكا', 'سبرايت', 'فانتا', 'عصير', 'مي', 'مياه', 'صودا', 'ليموناضة', 'شيك', 'مثلج', 'بارد', 'باردة', 'سلاش', 'بيرة'],
  hot_drink: ['קפה', 'תה', 'הפוך', 'אספרסו', 'קפוצ׳ינו', 'קפוצינו', 'לאטה', 'שוקו חם', 'סחלב', 'נס קפה', 'coffee', 'tea', 'espresso', 'cappuccino', 'latte', 'americano', 'macchiato', 'hot chocolate', 'sahlab', 'قهوة', 'شاي', 'اسبريسو', 'كابتشينو', 'كابوتشينو', 'لاتيه', 'سحلب', 'نسكافيه'],
  meat: ['בשר', 'בשרי', 'בקר', 'עגל', 'כבש', 'טלה', 'אנטריקוט', 'סטייק', 'קבב', 'קציצות', 'המבורגר', 'בורגר', 'פפרוני', 'סלמי', 'נקניק', 'נקניקיה', 'נקניקיות', 'קבנוס', 'מרגז', 'כבד', 'meat', 'beef', 'veal', 'lamb', 'steak', 'entrecote', 'kebab', 'kofta', 'burger', 'hamburger', 'pepperoni', 'salami', 'sausage', 'hot dog', 'لحم', 'لحمة', 'عجل', 'غنم', 'خروف', 'ستيك', 'كباب', 'كفتة', 'برغر', 'همبرغر', 'برجر', 'بيبروني', 'سلامي', 'نقانق', 'سجق', 'كبدة'],
  chicken: ['עוף', 'עופות', 'פרגית', 'פרגיות', 'שניצל', 'שניצלונים', 'חזה', 'כנפיים', 'כנפי', 'נאגטס', 'chicken', 'schnitzel', 'wings', 'nuggets', 'taouk', 'دجاج', 'جاج', 'فراخ', 'شنيتسل', 'طاووق', 'اجنحة', 'ناجتس'],
  fish: ['דג', 'דגים', 'סלמון', 'טונה', 'שרימפס', 'לברק', 'דניס', 'fish', 'salmon', 'tuna', 'shrimp', 'shrimps', 'seafood', 'سمك', 'سلمون', 'تونة', 'قريدس', 'جمبري'],
  cheese: ['גבינה', 'גבינות', 'מוצרלה', 'צהובה', 'פטה', 'בולגרית', 'חלומי', 'רוקפור', 'פרמזן', 'צ׳דר', 'צדר', 'cheese', 'mozzarella', 'feta', 'halloumi', 'parmesan', 'cheddar', 'gouda', 'جبنة', 'جبن', 'موزاريلا', 'حلوم', 'فيتا', 'شيدر', 'بارميزان'],
  sharing: ['מגש', 'מגשים', 'פלטה', 'פלטת', 'משפחתי', 'משפחתית', 'זוגי', 'זוגית', 'מארז', 'platter', 'tray', 'family', 'sharing', 'bucket', 'صينية', 'عائلي', 'عائلية', 'بلاتر'],
};

/** Words that name a dish type; a dish's type is the one whose words it uses most (name ×3, category ×2, description ×1). */
export const TYPE_TERMS: Record<DishType, readonly string[]> = {
  pizza: ['פיצה', 'פיצות', 'מרגריטה', 'pizza', 'pizzas', 'margherita', 'بيتزا'],
  pasta: ['פסטה', 'ספגטי', 'פנה', 'רביולי', 'לזניה', 'פטוצ׳יני', 'פטוציני', 'ניוקי', 'מקרוני', 'pasta', 'spaghetti', 'penne', 'ravioli', 'lasagna', 'lasagne', 'fettuccine', 'gnocchi', 'macaroni', 'معكرونة', 'باستا', 'سباغيتي', 'لازانيا', 'رافيولي'],
  burger: ['המבורגר', 'בורגר', 'burger', 'hamburger', 'cheeseburger', 'برغر', 'همبرغر', 'برجر'],
  shawarma: ['שווארמה', 'שוורמה', 'שאוורמה', 'shawarma', 'shawerma', 'شاورما', 'شاورمة'],
  hummus: ['חומוס', 'מסבחה', 'פול', 'hummus', 'humus', 'msabbaha', 'حمص', 'مسبحة', 'فول'],
  sushi: ['סושי', 'מאקי', 'ניגירי', 'סשימי', 'אינסייד', 'רול', 'sushi', 'maki', 'nigiri', 'sashimi', 'roll', 'uramaki', 'سوشي', 'ماكي'],
  pastries: ['מאפה', 'מאפים', 'בורקס', 'בורקה', 'קרואסון', 'מנאקיש', 'מנקיש', 'פטאייר', 'ספיחה', 'burekas', 'pastry', 'pastries', 'croissant', 'manakish', 'manaqish', 'fatayer', 'sfiha', 'مناقيش', 'منقوشة', 'فطاير', 'فطيرة', 'صفيحة', 'معجنات', 'كرواسون'],
  salads: ['סלט', 'סלטים', 'פטוש', 'טבולה', 'salad', 'salads', 'fattoush', 'tabbouleh', 'سلطة', 'سلطات', 'فتوش', 'تبولة'],
  mains: ['שניצל', 'סטייק', 'אנטריקוט', 'קבב', 'שיפוד', 'שיפודים', 'מעורב', 'ארוחה', 'ארוחת', 'מקלובה', 'מנסף', 'מסחן', 'שקשוקה', 'נודלס', 'grill', 'steak', 'schnitzel', 'kebab', 'skewer', 'skewers', 'meal', 'noodles', 'shakshuka', 'musakhan', 'mansaf', 'maqluba', 'مشاوي', 'ستيك', 'كباب', 'وجبة', 'مسخن', 'منسف', 'مقلوبة', 'شكشوكة', 'نودلز'],
  snacks: ['צ׳יפס', 'ציפס', 'טבעות בצל', 'נאגטס', 'כנפיים', 'פלאפל', 'סמבוסק', 'סיגרים', 'chips', 'fries', 'nuggets', 'wings', 'falafel', 'samosa', 'sambusak', 'onion rings', 'snack', 'بطاطا', 'بطاطس', 'فلافل', 'سمبوسك', 'ناجتس', 'اجنحة'],
  desserts: ['קינוח', 'קינוחים', 'עוגה', 'עוגת', 'גלידה', 'וופל', 'קרפ', 'כנאפה', 'קנאפה', 'בקלאווה', 'מלבי', 'סופלה', 'טירמיסו', 'פנקייק', 'dessert', 'cake', 'ice cream', 'waffle', 'crepe', 'knafeh', 'kunafa', 'baklava', 'malabi', 'souffle', 'tiramisu', 'cheesecake', 'brownie', 'pancake', 'pancakes', 'حلويات', 'كيك', 'بوظة', 'وافل', 'كريب', 'كنافة', 'بقلاوة', 'مهلبية', 'تيراميسو', 'سوفليه'],
  drinks: ['שתייה', 'שתיה', 'משקה', 'משקאות', 'קולה', 'ספרייט', 'פאנטה', 'מיץ', 'מים', 'סודה', 'לימונדה', 'שייק', 'קפה', 'תה', 'בירה', 'אספרסו', 'קפוצ׳ינו', 'קפוצינו', 'לאטה', 'drink', 'drinks', 'beverage', 'cola', 'coke', 'sprite', 'fanta', 'juice', 'water', 'soda', 'lemonade', 'shake', 'smoothie', 'coffee', 'tea', 'beer', 'espresso', 'cappuccino', 'latte', 'مشروب', 'مشروبات', 'كولا', 'عصير', 'مي', 'مياه', 'قهوة', 'شاي', 'بيرة'],
};

/** People words: "4 אנשים", "for 4 people", "4 اشخاص". */
export const PEOPLE_TERMS: readonly string[] = ['אנשים', 'איש', 'סועדים', 'סועד', 'נפשות', 'אורחים', 'חברים', 'people', 'persons', 'person', 'pax', 'guests', 'friends', 'اشخاص', 'أشخاص', 'شخص', 'نفر', 'انفار', 'ناس', 'ضيوف'];

/** Display names for tags (editor chips, assistant slot names). */
export const TAG_LABELS: Record<DishTag, Record<Locale, string>> = {
  spicy: { he: 'חריף', ar: 'حار', en: 'spicy' },
  vegetarian: { he: 'צמחוני', ar: 'نباتي', en: 'vegetarian' },
  vegan: { he: 'טבעוני', ar: 'نباتي صرف', en: 'vegan' },
  gluten_free: { he: 'ללא גלוטן', ar: 'بدون غلوتين', en: 'gluten-free' },
  kids: { he: 'לילדים', ar: 'للأطفال', en: 'for kids' },
  healthy: { he: 'בריא', ar: 'صحي', en: 'healthy' },
  breakfast: { he: 'ארוחת בוקר', ar: 'فطور', en: 'breakfast' },
  sweet: { he: 'מתוק', ar: 'حلو', en: 'sweet' },
  cold_drink: { he: 'שתייה קרה', ar: 'مشروب بارد', en: 'cold drink' },
  hot_drink: { he: 'שתייה חמה', ar: 'مشروب ساخن', en: 'hot drink' },
  meat: { he: 'בשר', ar: 'لحم', en: 'meat' },
  chicken: { he: 'עוף', ar: 'دجاج', en: 'chicken' },
  fish: { he: 'דגים', ar: 'سمك', en: 'fish' },
  cheese: { he: 'גבינה', ar: 'جبنة', en: 'cheese' },
  sharing: { he: 'לשיתוף', ar: 'للمشاركة', en: 'to share' },
};

export const TAG_MATCHERS = Object.fromEntries(DISH_TAGS.map((t) => [t, termMatcher(TAG_TERMS[t])])) as Record<DishTag, TermMatcher>;
const TYPE_MATCHERS = Object.fromEntries(DISH_TYPES.map((t) => [t, termMatcher(TYPE_TERMS[t])])) as Record<DishType, TermMatcher>;
const PEOPLE = termMatcher(PEOPLE_TERMS);
const GENERIC_MEAT = termMatcher(['המבורגר', 'בורגר', 'burger', 'hamburger', 'برغر', 'همبرغر', 'برجر']);
const SINGLE_PORTION = termMatcher(['משולש', 'סלייס', 'אישית', 'אישי', 'מיני', 'slice', 'personal', 'mini', 'قطعة', 'شخصية', 'ميني', 'سلايس']);
const SERVES: Array<readonly [number, TermMatcher]> = [
  [6, termMatcher(['מגש', 'מגשים', 'מסיבה', 'אירוח', 'platter', 'party', 'tray', 'صينية', 'عزومة'])],
  [4, termMatcher(['משפחתי', 'משפחתית', 'משפחה', 'ענקית', 'family', 'عائلي', 'عائلية', 'xxl'])],
  [2, termMatcher(['זוגי', 'זוגית', 'לזוג', 'זוג', 'לשניים', 'couple', 'for two', 'duo', 'زوجي', 'لشخصين', 'دبل'])],
];
const FOR_WORDS = new Set(foldAll(['ל', 'for', 'ل']));
const VEGETARIAN_TYPES: readonly DishType[] = ['pizza', 'pasta', 'salads', 'hummus', 'pastries'];
const DRINK_TAGS: readonly DishTag[] = ['cold_drink', 'hot_drink'];

export interface AutoTagInput {
  name: Localized;
  description?: Localized;
  categoryName?: Localized;
}

export interface AutoTagResult {
  tags: DishTag[];
  serves: number;
  dishType?: DishType;
}

const allText = (l?: Localized) => [l?.he, l?.ar, l?.en].filter(Boolean).join(' ');

export function autoTags(input: AutoTagInput): AutoTagResult {
  const name = prepareText(allText(input.name));
  const desc = prepareText(allText(input.description));
  const cat = prepareText(allText(input.categoryName));
  const text: Prepared = { tokens: [...name.tokens, ...desc.tokens], padded: `${name.padded}${desc.padded}` };
  const dishType = pickType(name, cat, desc);
  const tags = new Set<DishTag>();
  for (const t of DISH_TAGS) if (t !== 'sharing' && countMatches(text, TAG_MATCHERS[t]) > 0) tags.add(t);
  // The menu section names drinks, breakfasts and sweets ("שתייה קרה", "قهوة", "ארוחות בוקר").
  for (const t of ['cold_drink', 'hot_drink', 'breakfast', 'sweet', 'kids'] as const) if (countMatches(cat, TAG_MATCHERS[t]) > 0) tags.add(t);
  // A burger word alone is not "meat" when the burger is chicken or fish.
  if (tags.has('meat') && (tags.has('chicken') || tags.has('fish')) && countMatches(text, TAG_MATCHERS.meat) <= countMatches(text, GENERIC_MEAT)) tags.delete('meat');
  if (tags.has('cold_drink')) tags.delete('hot_drink');
  // "סלט קר" is not a drink: drink tags belong to drinks (or to dishes with no known type).
  if (dishType && dishType !== 'drinks') for (const t of DRINK_TAGS) tags.delete(t);
  if (dishType === 'drinks' && !tags.has('hot_drink')) tags.add('cold_drink');
  if (dishType === 'desserts') tags.add('sweet');
  if (tags.has('vegan')) tags.add('vegetarian');
  if (dishType && VEGETARIAN_TYPES.includes(dishType) && !tags.has('meat') && !tags.has('chicken') && !tags.has('fish')) tags.add('vegetarian');
  const serves = pickServes(name, desc, dishType);
  if (serves >= 3) tags.add('sharing');
  return { tags: DISH_TAGS.filter((t) => tags.has(t)), serves, ...(dishType ? { dishType } : {}) };
}

function pickType(name: Prepared, cat: Prepared, desc: Prepared): DishType | undefined {
  let best: DishType | undefined;
  let bestScore = 0;
  for (const t of DISH_TYPES) {
    const m = TYPE_MATCHERS[t];
    const s = countMatches(name, m) * 3 + countMatches(cat, m) * 2 + countMatches(desc, m);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best;
}

function pickServes(name: Prepared, desc: Prepared, dishType: DishType | undefined): number {
  const explicit = explicitPeople(name) ?? explicitPeople(desc);
  if (explicit) return explicit;
  for (const [n, m] of SERVES) if (countMatches(name, m) > 0) return n;
  if (dishType === 'pizza' && countMatches(name, SINGLE_PORTION) === 0) return 2;
  return 1;
}

/** "ל-4", "for 4", "ل4", "4 אנשים", "4 اشخاص" → 4 (2..12). */
export function explicitPeople(t: Prepared): number | undefined {
  const tk = t.tokens;
  for (let i = 0; i < tk.length; i++) {
    const n = Number(tk[i]);
    if (!Number.isInteger(n) || n < 2 || n > 12) continue;
    const before = tk[i - 1];
    const after = tk[i + 1];
    if ((before && FOR_WORDS.has(before)) || (after && countMatches({ tokens: [after], padded: ` ${after} ` }, PEOPLE) > 0)) return n;
  }
  return undefined;
}
```

- [ ] **Step 5: Write the barrel and export it**

`packages/shared/src/assistant/index.ts`:
```ts
export * from './text.js';
export * from './tags.js';
```
In `packages/shared/src/index.ts` append:
```ts
export * from './assistant/index.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -w packages/shared -- test/assistant/tags.test.ts`
Expected: PASS (all cases). If a vocabulary case fails, fix the term lists (fold check: `normalizeSearch(term)`), not the test.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck -w packages/shared` → no errors.
```bash
git add packages/shared/src/assistant/text.ts packages/shared/src/assistant/tags.ts packages/shared/src/assistant/index.ts packages/shared/src/index.ts packages/shared/test/assistant/tags.test.ts
git commit -m "Assistant: text helpers and automatic dish tagger"
```

---

### Task 2: Product tag fields, owner-wins rule, index entry and deals/pairs document types

**Files:**
- Create: `packages/shared/src/assistant/ownership.ts`
- Modify: `packages/shared/src/assistant/index.ts`
- Modify: `packages/shared/src/types.ts` (Product, after `dishType?: DishType;`)
- Modify: `packages/shared/src/schemas.ts` (productInputSchema)
- Modify: `packages/shared/src/dishIndex.ts` (entry fields, deals/pairs docs)
- Test: `packages/shared/test/assistant/ownership.test.ts`, `packages/shared/test/dish-index.test.ts`

**Interfaces:**
- Consumes: `DishTag`, `AutoTagResult` (Task 1).
- Produces: `Product.tags?: DishTag[]`, `Product.serves?: number`, `Product.autoFields?: AutoFields`; `AutoFields = { tags?: DishTag[]; serves?: number; dishType?: DishType }`; `resolveAutoFields(input: AutoInput, existing: Ownable | undefined, suggested: AutoTagResult): { values: AutoFields; autoFields: AutoFields }`; `isMachineOwned(p: Ownable, key: AutoKey): boolean`; `DishIndexEntry.tags?`, `DishIndexEntry.serves?`; `DealsIndexCombo`, `DealsIndexPromotion`, `DealsIndexDoc`, `PairEntry`, `PairsIndexDoc`, `toDealsCombo(c: Combo)`, `toDealsPromotion(p: Promotion)`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/assistant/ownership.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isMachineOwned, resolveAutoFields, type AutoTagResult } from '../../src/index.js';

const suggested: AutoTagResult = { tags: ['spicy', 'vegetarian'], serves: 2, dishType: 'pizza' };

describe('resolveAutoFields', () => {
  it('a new product with nothing sent takes the suggestion, machine-owned', () => {
    const r = resolveAutoFields({}, undefined, suggested);
    expect(r.values).toEqual({ tags: ['spicy', 'vegetarian'], serves: 2, dishType: 'pizza' });
    expect(r.autoFields).toEqual(r.values);
  });
  it('a sent value equal to the suggestion stays machine-owned (order of tags does not matter)', () => {
    const r = resolveAutoFields({ tags: ['vegetarian', 'spicy'], serves: 2, dishType: 'pizza' }, undefined, suggested);
    expect(r.autoFields).toEqual({ tags: ['vegetarian', 'spicy'], serves: 2, dishType: 'pizza' });
  });
  it('a different sent value becomes the owner’s', () => {
    const r = resolveAutoFields({ tags: ['kids'], serves: 3, dishType: 'pasta' }, undefined, suggested);
    expect(r.values).toEqual({ tags: ['kids'], serves: 3, dishType: 'pasta' });
    expect(r.autoFields).toEqual({});
  });
  it('omitted keeps the stored value and its mark', () => {
    const existing = { tags: ['kids' as const], serves: 3, dishType: 'pizza' as const, autoFields: { dishType: 'pizza' as const } };
    const r = resolveAutoFields({}, existing, suggested);
    expect(r.values).toEqual({ tags: ['kids'], serves: 3, dishType: 'pizza' });
    expect(r.autoFields).toEqual({ dishType: 'pizza' });
  });
  it("'none' clears the type and makes it the owner's", () => {
    const r = resolveAutoFields({ dishType: 'none' }, undefined, suggested);
    expect(r.values.dishType).toBeUndefined();
    expect(r.autoFields.dishType).toBeUndefined();
    expect(isMachineOwned({ ...r.values, autoFields: r.autoFields }, 'dishType')).toBe(false);
  });
});

describe('isMachineOwned', () => {
  it('older products (no autoFields) are machine-owned only where empty', () => {
    expect(isMachineOwned({ dishType: 'pizza' }, 'dishType')).toBe(false);
    expect(isMachineOwned({}, 'tags')).toBe(true);
  });
  it('newer products follow the marks', () => {
    expect(isMachineOwned({ tags: [], autoFields: { tags: [] } }, 'tags')).toBe(true);
    expect(isMachineOwned({ tags: [], autoFields: {} }, 'tags')).toBe(false);
  });
});
```

Append to `packages/shared/test/dish-index.test.ts` (inside the file, after the existing `toDishIndexEntry` describe; add `toDealsCombo, toDealsPromotion, type Combo, type Promotion` to its import):
```ts
describe('assistant fields in the indexes', () => {
  it('the dish entry carries tags and serves when set', () => {
    expect(toDishIndexEntry({ ...base, tags: ['spicy'], serves: 2 })).toMatchObject({ tags: ['spicy'], serves: 2 });
    const plain = toDishIndexEntry({ ...base, tags: [] });
    expect('tags' in plain).toBe(false);
    expect('serves' in plain).toBe(false);
  });
  it('deals entries keep what the assistant shows and drop empty text', () => {
    const combo: Combo = { id: 'c1', businessId: 'b1', branchId: 'br1', name: { he: 'קומבו' }, description: {}, items: [{ productId: 'p1', quantity: 2 }], priceAgorot: 6000, promoted: true, active: true, archived: false, sortOrder: 1, createdAt: '', updatedAt: '' };
    expect(toDealsCombo(combo)).toEqual({ name: { he: 'קומבו' }, priceAgorot: 6000, items: [{ productId: 'p1', quantity: 2 }], sortOrder: 1 });
    const promo: Promotion = { id: 'pr', businessId: 'b1', branchId: 'br1', title: { he: '1+1' }, body: { he: 'רק היום' }, productIds: ['p1'], endsAt: '2030-01-01', active: true, sortOrder: 0, createdAt: '', updatedAt: '' };
    expect(toDealsPromotion(promo)).toEqual({ title: { he: '1+1' }, body: { he: 'רק היום' }, productIds: ['p1'], endsAt: '2030-01-01', sortOrder: 0 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w packages/shared -- test/assistant/ownership.test.ts test/dish-index.test.ts`
Expected: FAIL — `resolveAutoFields`, `toDealsCombo` not exported; `tags` not a Product field.

- [ ] **Step 3: Product fields**

In `packages/shared/src/types.ts`, add to the imports:
```ts
import type { DishTag } from './assistant/tags.js';
import type { AutoFields } from './assistant/ownership.js';
```
and in `interface Product`, right after `dishType?: DishType;`:
```ts
  /** Taste, diet and occasion tags for the assistant (DISH_TAGS). */
  tags?: DishTag[];
  /** How many people one portion feeds (1–12); the assistant's "for 4" uses it. */
  serves?: number;
  /** Automatic values still owned by the machine (see ownership.ts); an owner's different choice drops the key for good. */
  autoFields?: AutoFields;
```

- [ ] **Step 4: Schema**

In `packages/shared/src/schemas.ts` add `import { DISH_TAGS } from './assistant/tags.js';` and inside `productInputSchema` after the `dishType` line:
```ts
    /** Omitted keeps the stored value (older clients); see resolveAutoFields. */
    tags: z.array(z.enum(DISH_TAGS)).max(DISH_TAGS.length).optional(),
    serves: z.number().int().min(1).max(12).optional(),
```

- [ ] **Step 5: Ownership**

`packages/shared/src/assistant/ownership.ts`:
```ts
/**
 * Who owns a dish's tags, serves and type: the machine (autoTags) or the owner. A key in `autoFields`
 * means the stored value is still the automatic suggestion and may be re-derived; an owner who saves a
 * different value removes the key, and from then on nothing automatic touches that field again.
 */
import type { DishType } from '../dishIndex.js';
import type { AutoTagResult, DishTag } from './tags.js';

export interface AutoFields {
  tags?: DishTag[];
  serves?: number;
  dishType?: DishType;
}
export type AutoKey = keyof AutoFields;
export type Ownable = AutoFields & { autoFields?: AutoFields };
export interface AutoInput {
  tags?: DishTag[];
  serves?: number;
  dishType?: DishType | 'none';
}

const KEYS: AutoKey[] = ['tags', 'serves', 'dishType'];
const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

export function isMachineOwned(p: Ownable, key: AutoKey): boolean {
  if (p.autoFields) return p.autoFields[key] !== undefined;
  return p[key] === undefined;
}

export function resolveAutoFields(input: AutoInput, existing: Ownable | undefined, suggested: AutoTagResult): { values: AutoFields; autoFields: AutoFields } {
  const values: Record<string, unknown> = {};
  const autoFields: Record<string, unknown> = {};
  for (const k of KEYS) {
    const sentRaw = input[k];
    let value: unknown;
    let machine: boolean;
    if (sentRaw === undefined) {
      if (!existing) {
        value = suggested[k];
        machine = true;
      } else {
        value = existing[k];
        machine = existing.autoFields?.[k] !== undefined;
      }
    } else {
      value = sentRaw === 'none' ? undefined : sentRaw;
      machine = value !== undefined && same(value, suggested[k]);
    }
    if (value !== undefined) values[k] = value;
    if (machine && value !== undefined) autoFields[k] = value;
  }
  return { values: values as AutoFields, autoFields: autoFields as AutoFields };
}
```
Add `export * from './ownership.js';` to `packages/shared/src/assistant/index.ts`.

- [ ] **Step 6: Index entry and deals/pairs documents**

In `packages/shared/src/dishIndex.ts`:
- change the type import to `import type { Agorot, Combo, ComboItem, Localized, Product, Promotion } from './types.js';` and add `import type { DishTag } from './assistant/tags.js';`
- in `DishIndexEntry` after `mostOrdered?: boolean;` add:
```ts
  tags?: DishTag[];
  /** People one portion feeds; missing reads as 1 (2 for a whole pizza). */
  serves?: number;
```
- in `toDishIndexEntry`, before `return entry;` add:
```ts
  if (p.tags?.length) entry.tags = p.tags;
  if (p.serves) entry.serves = p.serves;
```
- append at the end of the file:
```ts
/** `publicBranches/{branchId}/index/deals`: active combos and promotions, so the assistant answers "what's on offer?" across the city in one read per place. */
export interface DealsIndexCombo {
  name: Localized;
  description?: Localized;
  priceAgorot: Agorot;
  items: ComboItem[];
  imagePath?: string;
  sortOrder: number;
}
export interface DealsIndexPromotion {
  title: Localized;
  body?: Localized;
  productIds: string[];
  /** Last valid day, YYYY-MM-DD in Asia/Jerusalem; the client drops expired ones. */
  endsAt: string;
  imagePath?: string;
  sortOrder: number;
}
export interface DealsIndexDoc {
  branchId: string;
  businessId: string;
  combos: Record<string, DealsIndexCombo>;
  promotions: Record<string, DealsIndexPromotion>;
  updatedAt: string;
}
/** `publicBranches/{branchId}/index/pairs`: what customers add together, rebuilt nightly from orders. */
export interface PairEntry {
  productId: string;
  count: number;
}
export interface PairsIndexDoc {
  branchId: string;
  pairs: Record<string, PairEntry[]>;
  updatedAt: string;
}

const hasText = (l?: Localized) => Object.values(l ?? {}).some((v) => v && v.trim());

export function toDealsCombo(c: Combo): DealsIndexCombo {
  const d: DealsIndexCombo = { name: c.name, priceAgorot: c.priceAgorot, items: c.items, sortOrder: c.sortOrder };
  if (hasText(c.description)) d.description = c.description;
  if (c.imagePath) d.imagePath = c.imagePath;
  return d;
}

export function toDealsPromotion(p: Promotion): DealsIndexPromotion {
  const d: DealsIndexPromotion = { title: p.title, productIds: p.productIds, endsAt: p.endsAt, sortOrder: p.sortOrder };
  if (hasText(p.body)) d.body = p.body;
  if (p.imagePath) d.imagePath = p.imagePath;
  return d;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test -w packages/shared`
Expected: PASS (whole shared suite, including the existing dish-index tests).

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck` → no errors in any workspace.
```bash
git add packages/shared/src/assistant/ownership.ts packages/shared/src/assistant/index.ts packages/shared/src/types.ts packages/shared/src/schemas.ts packages/shared/src/dishIndex.ts packages/shared/test/assistant/ownership.test.ts packages/shared/test/dish-index.test.ts
git commit -m "Assistant: dish tags/serves with owner-wins marks; deals and pairs index types"
```

---

### Task 3: saveProduct fills tags/serves/type automatically, owner wins

**Files:**
- Modify: `functions/src/domain/catalog.ts` (imports line 3; `buildProduct` return object, the `dishType` spread line ~148)
- Test: `functions/test/assistant-fields.test.ts`

**Interfaces:**
- Consumes: `autoTags`, `resolveAutoFields` (Tasks 1–2); `toDishIndexEntry` carries `tags`/`serves` (Task 2).
- Produces: every saved product has `autoFields` (possibly `{}`); its index entry carries `tags`/`serves`.

- [ ] **Step 1: Write the failing test**

`functions/test/assistant-fields.test.ts`:
```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, IDS, USERS, type Client } from './harness.js';

/** Automatic tags/serves/type on save, and the owner's choice winning over them. */
let owner1: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); });
afterAll(async () => { await owner1.close(); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
const input = (name: string, extra: Record<string, unknown> = {}) => ({
  categoryId: 'c-mains', name: { he: name }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 5000, unitLabel: {},
  quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, ...extra,
});
const priv = async (id: string) => (await admin.db.doc(`businesses/${businessId}/branches/${branchId}/products/${id}`).get()).data()!;
const entry = async (id: string) => ((await admin.db.doc(`publicBranches/${branchId}/index/dishes`).get()).data() as { dishes: Record<string, { tags?: string[]; serves?: number; dishType?: string }> }).dishes[id];

describe('assistant fields on saveProduct', () => {
  it('a new dish gets automatic tags, serves and type, marked as machine-owned and indexed', async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input('פיצה משפחתית חריפה') });
    const p = await priv(product.id);
    expect(p.dishType).toBe('pizza');
    expect(p.serves).toBe(4);
    expect(p.tags).toEqual(expect.arrayContaining(['spicy', 'vegetarian', 'sharing']));
    expect(p.autoFields).toMatchObject({ dishType: 'pizza', serves: 4 });
    expect(await entry(product.id)).toMatchObject({ dishType: 'pizza', serves: 4 });
  });

  it("the owner's tags win and stay when later saves omit them", async () => {
    const { product } = await owner1.call<{ product: { id: string } }>('saveProduct', { businessId, branchId, product: input('פסטה ארביאטה') });
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input('פסטה ארביאטה', { tags: ['spicy', 'kids'], serves: 3 }) });
    let p = await priv(product.id);
    expect(p.tags).toEqual(['spicy', 'kids']);
    expect(p.serves).toBe(3);
    expect(p.autoFields.tags).toBeUndefined();
    expect(p.autoFields.serves).toBeUndefined();
    await owner1.call('saveProduct', { businessId, branchId, productId: product.id, product: input('פסטה ארביאטה') });
    p = await priv(product.id);
    expect(p.tags).toEqual(['spicy', 'kids']);
    expect((await entry(product.id))!.tags).toEqual(['spicy', 'kids']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (emulators running): `npm run test -w functions -- test/assistant-fields.test.ts`
Expected: FAIL — `p.serves` undefined.

- [ ] **Step 3: Implement**

In `functions/src/domain/catalog.ts` line 3 import list add `autoTags, resolveAutoFields`.
In `buildProduct`, before the `return {`:
```ts
  // Tags, serves and type are suggested from the saved texts; a value the owner chose is kept (ownership.ts).
  const auto = resolveAutoFields({ tags: input.tags, serves: input.serves, dishType: input.dishType }, existing, autoTags({ name: input.name, description: input.description }));
```
Replace the line
```ts
    ...(input.dishType === 'none' ? {} : (input.dishType ?? existing?.dishType) ? { dishType: input.dishType ?? existing?.dishType } : {}),
```
with
```ts
    ...auto.values,
    autoFields: auto.autoFields,
```
(Keep the comment above it updated: `// Tags, serves and type: automatic unless the owner chose (resolveAutoFields).`)

- [ ] **Step 4: Run the new test and the existing dish-index test**

Run: `npm run test -w functions -- test/assistant-fields.test.ts test/dish-index.test.ts`
Expected: PASS. (`dish-index.test.ts` checks that an omitted `dishType` keeps the type and `'none'` clears it; both still hold.)

- [ ] **Step 5: Commit**

```bash
git add functions/src/domain/catalog.ts functions/test/assistant-fields.test.ts
git commit -m "Assistant: saveProduct suggests tags, serves and type; owner's choice wins"
```

---

### Task 4: Deals index projection

**Files:**
- Modify: `functions/src/lib/firebase.ts` (col refs next to `publicDishIndex`)
- Modify: `functions/src/lib/projections.ts` (import line 2; `reprojectCatalog`; `projectComboInTx`; `projectPromotionInTx`; new `projectDealEntry`, `removeDealEntry`)
- Modify: `functions/src/domain/catalog.ts` (deleteCombo ~line 593, removePromotion ~line 689; import line 9)
- Modify: `tests/rules/firestore.test.ts` (public projections describe, after the `index/dishes` assertions ~line 67)
- Modify: `scripts/src/reproject.ts` (seed projection)
- Create: `scripts/src/deals-index-backfill.ts`
- Test: `functions/test/deals-index.test.ts`

**Interfaces:**
- Consumes: `DealsIndexDoc`, `toDealsCombo`, `toDealsPromotion` (Task 2).
- Produces: `publicBranches/{branchId}/index/deals` for visible restaurant branches; `col.publicDealsIndex(branchId)`, `col.publicPairsIndex(branchId)`.

- [ ] **Step 1: Write the failing tests**

`functions/test/deals-index.test.ts`:
```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asEmail, IDS, USERS, type Client } from './harness.js';

let owner1: Client;
beforeAll(async () => { owner1 = await asEmail(USERS.owner1); });
afterAll(async () => { await owner1.close(); });

const businessId = IDS.restaurant;
const branchId = IDS.branchA;
const deals = async () => (await admin.db.doc(`publicBranches/${branchId}/index/deals`).get()).data() as { combos: Record<string, { priceAgorot: number }>; promotions: Record<string, { endsAt: string }> } | undefined;

describe('deals index', () => {
  it('follows combos: saved, archived, deleted', async () => {
    const { combo } = await owner1.call<{ combo: { id: string } }>('saveCombo', { businessId, branchId, combo: { name: { he: 'פלאפל וצ׳יפס' }, description: {}, items: [{ productId: 'p-falafel', variantId: 'v-reg', quantity: 1 }, { productId: 'p-fries', quantity: 1 }], priceAgorot: 3500, promoted: false, active: true } });
    expect((await deals())!.combos[combo.id]).toMatchObject({ priceAgorot: 3500 });
    await owner1.call('setComboArchived', { businessId, branchId, comboId: combo.id, archived: true });
    expect((await deals())!.combos[combo.id]).toBeUndefined();
    await owner1.call('setComboArchived', { businessId, branchId, comboId: combo.id, archived: false });
    expect((await deals())!.combos[combo.id]).toBeDefined();
    await owner1.call('deleteCombo', { businessId, branchId, comboId: combo.id });
    expect((await deals())!.combos[combo.id]).toBeUndefined();
  });

  it('follows promotions: active only, removed on delete', async () => {
    const { promotion } = await owner1.call<{ promotion: { id: string } }>('savePromotion', { businessId, branchId, promotion: { title: { he: 'שווארמה במבצע' }, body: {}, productIds: ['p-shawarma'], active: true, endsAt: '2030-01-01' } });
    expect((await deals())!.promotions[promotion.id]).toMatchObject({ endsAt: '2030-01-01' });
    await owner1.call('savePromotion', { businessId, branchId, promotionId: promotion.id, promotion: { title: { he: 'שווארמה במבצע' }, body: {}, productIds: ['p-shawarma'], active: false, endsAt: '2030-01-01' } });
    expect((await deals())!.promotions[promotion.id]).toBeUndefined();
    await owner1.call('removePromotion', { businessId, branchId, promotionId: promotion.id });
    expect((await deals())!.promotions[promotion.id]).toBeUndefined();
  });
});
```

In `tests/rules/firestore.test.ts`, inside the test that checks `publicBranches/brA/index/dishes` (after line 67), add:
```ts
    for (const id of ['deals', 'pairs']) {
      await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `publicBranches/brA/index/${id}`), { branchId: 'brA' }); });
      await assertSucceeds(getDoc(doc(anon(), `publicBranches/brA/index/${id}`)));
      await assertFails(setDoc(doc(anon(), `publicBranches/brA/index/${id}`), { branchId: 'brA' }));
      await assertFails(setDoc(doc(as('owner1'), `publicBranches/brA/index/${id}`), { branchId: 'brA' }));
    }
```

- [ ] **Step 2: Run them**

Run: `npm run test -w functions -- test/deals-index.test.ts` → FAIL (`deals()` is undefined).
Run: `npm run test:rules` → PASS already (the `match /index/{docId}` rule covers it); keep the test as a guard.

- [ ] **Step 3: Collection refs**

In `functions/src/lib/firebase.ts`, after `publicDishIndex: ...`:
```ts
  /** Active combos and promotions of a restaurant branch, for the assistant's deals. */
  publicDealsIndex: (branchId: string) => db.collection('publicBranches').doc(branchId).collection('index').doc('deals'),
  /** What customers add together at a branch, rebuilt nightly (domain/pairs.ts). */
  publicPairsIndex: (branchId: string) => db.collection('publicBranches').doc(branchId).collection('index').doc('pairs'),
```

- [ ] **Step 4: Projections**

In `functions/src/lib/projections.ts` line 2 add `toDealsCombo, toDealsPromotion, type DealsIndexCombo, type DealsIndexDoc, type DealsIndexPromotion` to the shared import.

Add after `projectDishIndexEntry`:
```ts
/**
 * One combo or promotion entry of the branch's deals index, written without a read (like the dish
 * index). `value: null` removes the entry. Restaurants only; an invisible branch has no index.
 */
export function projectDealEntry(w: Pick<Tx, 'set'> | FirebaseFirestore.WriteBatch, business: Business, branch: Branch, kind: 'combos' | 'promotions', id: string, value: DealsIndexCombo | DealsIndexPromotion | null): void {
  if (business.type !== 'restaurant' || !isPubliclyVisible(business, branch)) return;
  const data = { branchId: branch.id, businessId: business.id, updatedAt: nowIso(), [kind]: { [id]: value ?? FieldValue.delete() } };
  (w as FirebaseFirestore.WriteBatch).set(col.publicDealsIndex(branch.id), data, { mergeFields: ['branchId', 'businessId', 'updatedAt', new FieldPath(kind, id)] });
}

/** Removes an entry where the business and branch are not at hand (deletes); harmless when there is no index. */
export function removeDealEntry(tx: Pick<Tx, 'set'>, branchId: string, kind: 'combos' | 'promotions', id: string): void {
  tx.set(col.publicDealsIndex(branchId), { [kind]: { [id]: FieldValue.delete() } }, { mergeFields: [new FieldPath(kind, id)] });
}
```
In `projectComboInTx`, after the if/else, add:
```ts
  projectDealEntry(tx, business, branch, 'combos', combo.id, !combo.archived && combo.active ? toDealsCombo(combo) : null);
```
In `projectPromotionInTx`, after the if/else, add:
```ts
  projectDealEntry(tx, business, branch, 'promotions', promotion.id, promotion.active ? toDealsPromotion(promotion) : null);
```
In `reprojectCatalog`:
- add `pubDeals` to the destructured `Promise.all` result and `col.publicDealsIndex(branchId).get(),` as the last array item;
- inside `if (business.type === 'restaurant') {` after `publish(col.publicDishIndex(branchId), doc);` add:
```ts
      const liveCombos = combos.docs.map((d) => d.data() as Combo).filter((c) => !c.archived && c.active);
      const livePromos = promos.docs.map((d) => d.data() as Promotion).filter((p) => p.active);
      const deals: DealsIndexDoc = {
        branchId, businessId,
        combos: Object.fromEntries(liveCombos.map((c) => [c.id, toDealsCombo(c)])),
        promotions: Object.fromEntries(livePromos.map((p) => [p.id, toDealsPromotion(p)])),
        updatedAt: nowIso(),
      };
      publish(col.publicDealsIndex(branchId), deals);
```
- after `if (pubIndex.exists && !retained.has(pubIndex.ref.path)) ...` add:
```ts
  if (pubDeals.exists && !retained.has(pubDeals.ref.path)) ops.push((batch) => batch.delete(pubDeals.ref));
```

- [ ] **Step 5: Direct deletes**

In `functions/src/domain/catalog.ts` add `removeDealEntry` to the projections import (line 9). After `tx.delete(col.publicCombos(input.branchId).doc(input.comboId));` add:
```ts
    removeDealEntry(tx, input.branchId, 'combos', input.comboId);
```
After `tx.delete(col.publicPromotions(input.branchId).doc(input.promotionId));` add:
```ts
    removeDealEntry(tx, input.branchId, 'promotions', input.promotionId);
```

- [ ] **Step 5b: Seed projection and a live backfill script**

The emulator seed projects through `scripts/src/reproject.ts` (not the functions), so it must write the deals index too. In that file change the relative import to
```ts
import { toDealsCombo, toDealsPromotion, toDishIndexEntry } from '../../packages/shared/src/dishIndex.ts';
```
and inside `if (b.type === 'restaurant') {` after the dish-index `batch.set(...)` add:
```ts
      const liveCombos = combos.docs.map((c) => c.data() as Combo).filter((c) => !c.archived && c.active);
      const livePromos = promos.docs.map((p) => p.data() as Promotion).filter((p) => p.active);
      batch.set(ref.collection('index').doc('deals'), { branchId: br.id, businessId: b.id, combos: Object.fromEntries(liveCombos.map((c) => [c.id, toDealsCombo(c)])), promotions: Object.fromEntries(livePromos.map((p) => [p.id, toDealsPromotion(p)])), updatedAt: now });
```
Create `scripts/src/deals-index-backfill.ts` for existing live branches (used in Task 16):
```ts
/**
 * One-off: builds publicBranches/{id}/index/deals for every visible restaurant branch, with the same
 * content reprojectCatalog writes. Touches nothing else.
 *   npx tsx scripts/src/deals-index-backfill.ts          -> dry run (prints counts)
 *   npx tsx scripts/src/deals-index-backfill.ts --apply  -> writes
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { toDealsCombo, toDealsPromotion, type Branch, type Business, type Combo, type DealsIndexDoc, type Promotion } from '@qareeb/shared';

const APPLY = process.argv.includes('--apply');
initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();

let n = 0;
for (const bDoc of (await db.collection('businesses').where('type', '==', 'restaurant').get()).docs) {
  const b = bDoc.data() as Business;
  for (const brDoc of (await bDoc.ref.collection('branches').get()).docs) {
    const br = brDoc.data() as Branch;
    if (b.approval !== 'approved' || br.approval !== 'approved') continue;
    const [combos, promos] = await Promise.all([brDoc.ref.collection('combos').get(), brDoc.ref.collection('promotions').get()]);
    const doc: DealsIndexDoc = {
      branchId: brDoc.id, businessId: bDoc.id,
      combos: Object.fromEntries(combos.docs.map((d) => d.data() as Combo).filter((c) => !c.archived && c.active).map((c) => [c.id, toDealsCombo(c)])),
      promotions: Object.fromEntries(promos.docs.map((d) => d.data() as Promotion).filter((p) => p.active).map((p) => [p.id, toDealsPromotion(p)])),
      updatedAt: new Date().toISOString(),
    };
    console.log(`${b.name.he ?? b.name.en ?? bDoc.id}: ${Object.keys(doc.combos).length} combos, ${Object.keys(doc.promotions).length} promotions`);
    if (APPLY) await db.doc(`publicBranches/${brDoc.id}/index/deals`).set(doc);
    n++;
  }
}
console.log(`${n} branches ${APPLY ? 'written' : '(dry run)'}`);
```
Re-seed the emulator (`npm run seed`) and check `publicBranches/<abu-salim branch>/index/deals` exists in the emulator UI or REST.

- [ ] **Step 6: Run the tests**

Run: `npm run test -w functions -- test/deals-index.test.ts test/combos.test.ts test/promotions.test.ts test/dish-index.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/lib/firebase.ts functions/src/lib/projections.ts functions/src/domain/catalog.ts functions/test/deals-index.test.ts tests/rules/firestore.test.ts scripts/src/reproject.ts scripts/src/deals-index-backfill.ts
git commit -m "Assistant: per-branch deals index (combos + promotions)"
```

---

### Task 5: Nightly "goes together" pairs

**Files:**
- Create: `packages/shared/src/assistant/pairs.ts` (+ export in `assistant/index.ts`)
- Create: `functions/src/domain/pairs.ts`
- Modify: `functions/src/triggers.ts`, `functions/src/index.ts` (line 19 export)
- Test: `packages/shared/test/assistant/pairs.test.ts`, `functions/test/pairs.test.ts`

**Interfaces:**
- Consumes: `PairEntry`, `PairsIndexDoc` (Task 2); `col.publicPairsIndex`, `col.publicDishIndex` (Task 4).
- Produces: `computePairs(orders: PairOrder[]): Record<string, PairEntry[]> | null` with `PairOrder = { status: string; lines: Array<{ productId: string; comboId?: string; removed?: boolean }> }`; `rebuildPairs(now?: Date): Promise<{ branches: number }>`; scheduled function `buildPairs`.

- [ ] **Step 1: Write the failing shared test**

`packages/shared/test/assistant/pairs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computePairs, type PairOrder } from '../../src/index.js';

const order = (...ids: string[]): PairOrder => ({ status: 'accepted', lines: ids.map((productId) => ({ productId })) });

describe('computePairs', () => {
  it('needs at least 10 orders', () => {
    expect(computePairs(Array.from({ length: 9 }, () => order('a', 'b')))).toBeNull();
  });
  it('counts products bought together, top first, ignoring rejected, removed, combos and single sightings', () => {
    const orders = [
      ...Array.from({ length: 6 }, () => order('pizza', 'cola')),
      ...Array.from({ length: 3 }, () => order('pizza', 'fries')),
      order('pizza', 'salad'),
      { status: 'rejected', lines: [{ productId: 'pizza' }, { productId: 'beer' }, { productId: 'beer2' }] },
      { status: 'accepted', lines: [{ productId: 'pizza' }, { productId: 'gone', removed: true }, { productId: 'c1', comboId: 'c1' }] },
    ];
    const pairs = computePairs(orders)!;
    expect(pairs.pizza).toEqual([{ productId: 'cola', count: 6 }, { productId: 'fries', count: 3 }]);
    expect(pairs.cola).toEqual([{ productId: 'pizza', count: 6 }]);
    expect(pairs.salad).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test -w packages/shared -- test/assistant/pairs.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement `pairs.ts`**

`packages/shared/src/assistant/pairs.ts`:
```ts
/** Which dishes customers order together at one place, from its recent orders (built nightly). */
import type { PairEntry } from '../dishIndex.js';

export interface PairOrder {
  status: string;
  lines: Array<{ productId: string; comboId?: string; removed?: boolean }>;
}

export const MIN_PAIR_ORDERS = 10;
const TOP = 5;

export function computePairs(orders: PairOrder[]): Record<string, PairEntry[]> | null {
  const live = orders.filter((o) => o.status !== 'rejected');
  if (live.length < MIN_PAIR_ORDERS) return null;
  const counts = new Map<string, Map<string, number>>();
  for (const o of live) {
    const ids = [...new Set(o.lines.filter((l) => !l.removed && !l.comboId).map((l) => l.productId))];
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const m = counts.get(a) ?? new Map<string, number>();
      m.set(b, (m.get(b) ?? 0) + 1);
      counts.set(a, m);
    }
  }
  const out: Record<string, PairEntry[]> = {};
  for (const [a, m] of counts) {
    const list = [...m].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, TOP).map(([productId, count]) => ({ productId, count }));
    if (list.length) out[a] = list;
  }
  return out;
}
```
Add `export * from './pairs.js';` to `assistant/index.ts`. Run the test → PASS.

- [ ] **Step 4: Write the failing functions test**

`functions/test/pairs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
// Imported from source like posts-sweep.test.ts: the schedule never fires in the emulator, and this
// file must not import ./harness.js (second admin app on the same Firestore instance).
import { db } from '../src/lib/firebase.js';
import { rebuildPairs } from '../src/domain/pairs.js';

describe('rebuildPairs', () => {
  it('writes pairs for a branch with enough recent orders and skips old ones', async () => {
    const branchId = 'br-abu-salim-main';
    const now = new Date('2026-10-05T03:00:00.000Z');
    const recent = new Date(now.getTime() - 5 * 86_400_000).toISOString();
    const old = new Date(now.getTime() - 200 * 86_400_000).toISOString();
    const batch = db.batch();
    for (let i = 0; i < 10; i++) batch.set(db.doc(`orders/pairs-test-${i}`), { branchId, businessId: 'biz-abu-salim', status: 'accepted', placedAt: recent, lines: [{ productId: 'p-shawarma' }, { productId: 'p-cola' }] });
    // Two old orders: inside the window they would pair (count 2), so their absence proves the window.
    for (const k of ['old1', 'old2']) batch.set(db.doc(`orders/pairs-test-${k}`), { branchId, businessId: 'biz-abu-salim', status: 'accepted', placedAt: old, lines: [{ productId: 'p-shawarma' }, { productId: 'p-old-only' }] });
    await batch.commit();

    await rebuildPairs(now);

    const doc = (await db.doc(`publicBranches/${branchId}/index/pairs`).get()).data()!;
    // Other suites' orders may add more pairs; ours must be there and the old order must not.
    expect(doc.pairs['p-shawarma'].map((p: { productId: string }) => p.productId)).toContain('p-cola');
    expect(JSON.stringify(doc.pairs)).not.toContain('p-old-only');
    const cleanup = db.batch();
    for (let i = 0; i < 10; i++) cleanup.delete(db.doc(`orders/pairs-test-${i}`));
    for (const k of ['old1', 'old2']) cleanup.delete(db.doc(`orders/pairs-test-${k}`));
    await cleanup.commit();
  });
});
```
Run: `npm run test -w functions -- test/pairs.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement `rebuildPairs` and the schedule**

`functions/src/domain/pairs.ts`:
```ts
/** Nightly "goes together" index per restaurant branch, from the last 90 days of orders. */
import { computePairs, type PairOrder, type PairsIndexDoc } from '@qareeb/shared';
import { col, nowIso } from '../lib/firebase.js';

const WINDOW_DAYS = 90;

export async function rebuildPairs(now = new Date()): Promise<{ branches: number }> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const snap = await col.orders().where('placedAt', '>=', since).get();
  const byBranch = new Map<string, PairOrder[]>();
  for (const d of snap.docs) {
    const o = d.data() as PairOrder & { branchId: string };
    byBranch.set(o.branchId, [...(byBranch.get(o.branchId) ?? []), o]);
  }
  let branches = 0;
  for (const [branchId, orders] of byBranch) {
    // Only branches with a public dish index (visible restaurants) get pairs.
    if (!(await col.publicDishIndex(branchId).get()).exists) continue;
    const pairs = computePairs(orders);
    const ref = col.publicPairsIndex(branchId);
    if (pairs) {
      await ref.set({ branchId, pairs, updatedAt: nowIso() } satisfies PairsIndexDoc);
      branches++;
    } else await ref.delete();
  }
  return { branches };
}
```
In `functions/src/triggers.ts` add `import { rebuildPairs } from './domain/pairs.js';` and:
```ts
export const buildPairs = onSchedule({ region: REGION, schedule: 'every day 03:00', timeZone: 'Asia/Jerusalem' }, async () => {
  const r = await rebuildPairs();
  console.info('pairs rebuilt', r);
});
```
In `functions/src/index.ts` line 19 change to:
```ts
export { onOutboxCreated, scheduledSweeps, onImageUploaded, buildPairs } from './triggers.js';
```

- [ ] **Step 6: Run the tests**

Run: `npm run test -w packages/shared -- test/assistant/pairs.test.ts` and `npm run test -w functions -- test/pairs.test.ts`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/assistant/pairs.ts packages/shared/src/assistant/index.ts packages/shared/test/assistant/pairs.test.ts functions/src/domain/pairs.ts functions/src/triggers.ts functions/src/index.ts functions/test/pairs.test.ts
git commit -m "Assistant: nightly per-branch pairs index from recent orders"
```

---

### Task 6: Reading a request (`understand`)

**Files:**
- Create: `packages/shared/src/assistant/vocab.ts`
- Create: `packages/shared/src/assistant/understand.ts`
- Modify: `packages/shared/src/assistant/index.ts`
- Test: `packages/shared/test/assistant/understand.test.ts`

**Interfaces:**
- Consumes: `tokenize`, `wordForms`, `isIn`, `foldAll` (Task 1); `TAG_TERMS`, `TAG_MATCHERS`, `TYPE_TERMS`, `PEOPLE_TERMS`, `DISH_TAGS` (Task 1); `LEXICON`, `parseQuery`, `prepareFields`, `matchScore` (existing `search/`).
- Produces:
```ts
type Lang = 'he' | 'ar' | 'en';
type Meal = 'breakfast' | 'lunch' | 'dinner' | 'late';
type Shortcut = 'usual' | 'surprise' | 'deals';
interface Exclusions { tags: DishTag[]; words: string[]; dishIds: string[]; branchIds: string[] }
interface Request {
  craving: string[]; tags: DishTag[]; exclude: Exclusions;
  people?: number; budgetAgorot?: number; maxPriceAgorot?: number; cheap?: boolean;
  mode?: FulfillmentMode; placeBranchIds?: string[]; meal?: Meal; shortcut?: Shortcut;
  page: number; lang: Lang;
}
interface PlaceName { branchId: string; name: Localized }
interface Shown { dishIds: string[]; branchIds: string[]; maxTotalAgorot?: number }
interface Previous { request: Request; shown: Shown }
understand(text: string, places: readonly PlaceName[], prev?: Previous): Request
emptyRequest(lang: Lang): Request
detectLang(text: string): Lang
hasSlots(r: Request): boolean
isMealRequest(r: Request): boolean   // people or budget set
```

- [ ] **Step 1: Write the failing test**

`packages/shared/test/assistant/understand.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { detectLang, hasSlots, understand, type PlaceName, type Previous } from '../../src/index.js';

const places: PlaceName[] = [
  { branchId: 'morano', name: { he: 'מורנו', ar: 'مورانو', en: 'Morano' } },
  { branchId: 'abu', name: { he: 'אבו סלים', ar: 'ابو سليم', en: 'Abu Salim' } },
  { branchId: 'burger', name: { he: 'בורגר באזל', ar: 'برغر بازل', en: 'Burger Basil' } },
];
const u = (text: string, prev?: Previous) => understand(text, places, prev);

describe('understand', () => {
  it('taste wishes are tags, food words stay as the craving', () => {
    expect(u('משהו חריף')).toMatchObject({ tags: ['spicy'], craving: [] });
    expect(u('פיצה חריפה')).toMatchObject({ tags: ['spicy'], craving: ['פיצה'] });
    expect(u('ללא גלוטן')).toMatchObject({ tags: ['gluten_free'], exclude: { tags: [], words: [] } });
  });

  it('negation excludes a tag or a word', () => {
    const r = u('פיצה בלי בשר');
    expect(r.craving).toEqual(['פיצה']);
    expect(r.exclude.tags).toEqual(['meat']);
    expect(u('בלי בצל').exclude.words).toEqual(['בצל']);
    expect(u('not spicy shawarma')).toMatchObject({ craving: ['shawarma'], exclude: { tags: ['spicy'] } });
  });

  it('digits and glued tokens', () => {
    for (const s of ['ל-٤', 'لـ٤', 'ל4', 'ל-4', 'for 4', 'for four people', 'לארבעה', 'لأربعة', '4 אנשים']) expect(u(s).people, s).toBe(4);
    expect(u('לשניים').people).toBe(2);
    expect(u('אני ואשתי').people).toBe(2);
    expect(u('למשפחה').people).toBe(4);
    for (const [s, agorot] of [['150₪', 15000], ['עד 50', 5000], ['50 ש"ח', 5000], ['up to 80 shekels', 8000], ['حتى 70 شيكل', 7000], ['under 60', 6000], ['150', 15000]] as const) expect(u(s).budgetAgorot, s).toBe(agorot);
  });

  it('a full request', () => {
    expect(u('משהו חריף ל-4 עד 150')).toMatchObject({ tags: ['spicy'], people: 4, budgetAgorot: 15000, craving: [] });
    expect(u('something spicy for 4 under 150')).toMatchObject({ tags: ['spicy'], people: 4, budgetAgorot: 15000, craving: [] });
    expect(u('اشي حار لأربعة بحدود 150')).toMatchObject({ tags: ['spicy'], people: 4, budgetAgorot: 15000, craving: [] });
  });

  it('mode, meal, cheap and shortcuts', () => {
    expect(u('סושי באיסוף')).toMatchObject({ mode: 'pickup', craving: ['סושי'] });
    expect(u('توصيل شاورما')).toMatchObject({ mode: 'delivery', craving: ['شاورما'] });
    expect(u('ארוחת בוקר')).toMatchObject({ meal: 'breakfast', craving: [] });
    expect(u('הכי זול').cheap).toBe(true);
    expect(u('הרגיל שלי').shortcut).toBe('usual');
    expect(u('زي العادة').shortcut).toBe('usual');
    expect(u('לא יודע').shortcut).toBe('surprise');
    expect(u('מה במבצע?').shortcut).toBe('deals');
  });

  it('places by name, with or without "from"; a food word alone is not a place', () => {
    expect(u('ממורנו').placeBranchIds).toEqual(['morano']);
    expect(u('something from morano').placeBranchIds).toEqual(['morano']);
    expect(u('من مورانو').placeBranchIds).toEqual(['morano']);
    expect(u('בורגר באזל')).toMatchObject({ placeBranchIds: ['burger'], craving: ['בורגר'] });
    expect(u('burger').placeBranchIds).toBeUndefined();
  });

  it('refinements change only what was said', () => {
    const picks: Previous = { request: u('משהו חריף'), shown: { dishIds: ['d1'], branchIds: ['b1'], maxTotalAgorot: 5000 } };
    expect(u('יותר זול', picks)).toMatchObject({ tags: ['spicy'], maxPriceAgorot: 4000 });
    expect(u('משהו אחר', picks).exclude.dishIds).toEqual(['d1']);
    expect(u('ממקום אחר', picks).exclude.branchIds).toEqual(['b1']);
    expect(u('עוד', picks).page).toBe(1);
    expect(u('לא חריף', picks)).toMatchObject({ tags: [], exclude: { tags: ['spicy'] } });
    expect(u('פיצה', picks)).toMatchObject({ craving: ['פיצה'], tags: [] });
    const meal: Previous = { request: u('ל-4 עד 150'), shown: { dishIds: [], branchIds: ['b1'], maxTotalAgorot: 14000 } };
    expect(u('יותר זול', meal)).toMatchObject({ people: 4, budgetAgorot: 11200 });
    expect(u('ל-6 במקום', meal)).toMatchObject({ people: 6, budgetAgorot: 15000 });
  });

  it('language and empty messages', () => {
    expect(detectLang('shi 7ar')).toBe('ar');
    expect(detectLang('pizza')).toBe('en');
    expect(detectLang('פיצה')).toBe('he');
    expect(detectLang('بيتزا')).toBe('ar');
    expect(hasSlots(u('hello'))).toBe(false);
    expect(hasSlots(u('שלום'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w packages/shared -- test/assistant/understand.test.ts`
Expected: FAIL — `understand` not exported.

- [ ] **Step 3: Write `vocab.ts`**

`packages/shared/src/assistant/vocab.ts`:
```ts
/**
 * What the assistant listens for, in Hebrew, Arabic, English and Arabizi. Multi-word entries are
 * matched as phrases (the first word may carry a one-letter prefix: "באיסוף", "للعيلة").
 */
import { normalizeSearch } from '../dishIndex.js';
import type { FulfillmentMode } from '../types.js';
import { TAG_TERMS, type DishTag } from './tags.js';
import { foldAll, tokenize } from './text.js';

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'late';
export type Phrase = string[];

const phrases = (xs: readonly string[]): Phrase[] => xs.map((x) => tokenize(x)).filter((p) => p.length > 0).sort((a, b) => b.length - a.length);
const set = (xs: readonly string[]) => new Set(foldAll(xs));

export const USUAL = phrases(['הרגיל שלי', 'הרגיל', 'כמו פעם שעברה', 'כמו בפעם הקודמת', 'כמו תמיד', 'my usual', 'the usual', 'usual', 'same as last time', 'same again', 'reorder', 'order again', 'زي العادة', 'متل العادة', 'مثل العادة', 'العادة', 'نفس الطلب', 'نفس المرة الماضية', 'زي كل مرة']);
export const SURPRISE = phrases(['תפתיע אותי', 'תפתיעו אותי', 'תפתיע', 'תפתיעו', 'הפתעה', 'תבחר לי', 'תבחרו לי', 'תבחר אתה', 'לא יודע', 'לא יודעת', 'לא יודעים', 'מה שבא', 'surprise me', 'surprise', 'you choose', 'you pick', 'dont know', 'i dont know', 'idk', 'random', 'anything', 'whatever', 'فاجئني', 'فاجئنا', 'مفاجأة', 'اختار انت', 'اختارلي', 'مش عارف', 'مش عارفة', 'اي اشي', 'أي شي', 'ما بعرف', 'بعرفش']);
export const DEALS = phrases(['מה במבצע', 'מבצע', 'מבצעים', 'דיל', 'דילים', 'הנחה', 'הנחות', 'קומבו', 'deal', 'deals', 'offer', 'offers', 'special', 'specials', 'promo', 'promotion', 'promotions', 'discount', 'combo', 'combos', 'عرض', 'عروض', 'خصم', 'خصومات', 'تخفيض', 'تنزيلات', 'كومبو']);
export const OTHER_PLACE = phrases(['מקום אחר', 'מסעדה אחרת', 'another place', 'other place', 'different place', 'another restaurant', 'somewhere else', 'محل تاني', 'مطعم تاني', 'مكان تاني', 'محل ثاني']);
export const CHEAPER = phrases(['יותר זול', 'זול יותר', 'פחות יקר', 'cheaper', 'less expensive', 'ارخص', 'أرخص', 'ارخص شوي']);
export const CHEAP = phrases(['הכי זול', 'זול', 'זולה', 'זולים', 'זולות', 'בזול', 'חסכוני', 'cheap', 'cheapest', 'affordable', 'budget', 'رخيص', 'رخيصة', 'الارخص']);
export const FAMILY = phrases(['משפחה', 'family', 'عيلة', 'عائلة']);
export const COMPANION = phrases(['ואשתי', 'ובעלי', 'וחבר', 'וחברה', 'וחברתי', 'وصاحبي', 'وصاحبتي', 'ومرتي', 'وجوزي', 'وحبيبتي', 'with my wife', 'with my husband', 'with a friend', 'and my wife', 'and my husband', 'and a friend']);
export const MODES: Array<readonly [FulfillmentMode, Phrase[]]> = [
  ['delivery', phrases(['משלוח', 'משלוחים', 'דליברי', 'delivery', 'deliver', 'delivered', 'توصيل', 'ديليفري', 'دليفري'])],
  ['pickup', phrases(['איסוף', 'לאסוף', 'טייק אווי', 'טייקאווי', 'pickup', 'pick up', 'takeaway', 'take away', 'to go', 'استلام', 'تيك اواي'])],
  ['dine_in', phrases(['לשבת במקום', 'לשבת', 'ישיבה', 'dine in', 'eat in', 'sit in', 'جلوس', 'نقعد', 'بالمطعم'])],
];
export const MEALS: Array<readonly [Meal, Phrase[]]> = [
  ['breakfast', phrases(['ארוחת בוקר', 'בוקר', 'breakfast', 'brunch', 'فطور', 'ترويقة', 'الصبح'])],
  ['lunch', phrases(['ארוחת צהריים', 'צהריים', 'lunch', 'غدا', 'غداء'])],
  ['dinner', phrases(['ארוחת ערב', 'ערב', 'dinner', 'supper', 'عشا', 'عشاء'])],
  ['late', phrases(['בלילה', 'לילה', 'מאוחר', 'late night', 'late', 'midnight', 'ليل', 'بالليل', 'سهرة', 'متأخر'])],
];
/** Taste and diet wishes become filters. Food words (עוף, גבינה…) stay in the craving, where search already understands them. */
export const REQUEST_TAGS: Array<readonly [DishTag, Phrase[]]> = [
  ['spicy', phrases(TAG_TERMS.spicy)],
  ['vegetarian', phrases(TAG_TERMS.vegetarian)],
  ['vegan', phrases(TAG_TERMS.vegan)],
  ['gluten_free', phrases(TAG_TERMS.gluten_free)],
  ['kids', phrases(TAG_TERMS.kids)],
  ['healthy', phrases(TAG_TERMS.healthy)],
  ['sweet', phrases(['מתוק', 'מתוקה', 'מתוקים', 'קינוח', 'קינוחים', 'sweet', 'sweets', 'dessert', 'desserts', 'حلو', 'حلويات', 'تحلاية', 'ديزرت'])],
  ['cold_drink', phrases(['שתייה קרה', 'שתיה קרה', 'משקה קר', 'משהו קר לשתות', 'cold drink', 'something cold to drink', 'مشروب بارد', 'اشي بارد'])],
  ['hot_drink', phrases(['שתייה חמה', 'שתיה חמה', 'משקה חם', 'hot drink', 'something hot to drink', 'مشروب ساخن', 'اشي سخن'])],
  ['sharing', phrases(['לשתף', 'לחלוק', 'to share', 'sharing', 'للمشاركة'])],
];
export const MORE = set(['עוד', 'more', 'كمان', 'المزيد', 'اكثر']);
export const OTHER = set(['אחר', 'אחרת', 'אחרים', 'אחרות', 'else', 'other', 'different', 'another', 'تاني', 'ثاني', 'غيره', 'غيرها']);
export const NEGATION = set(['בלי', 'ללא', 'לא', 'בלא', 'without', 'no', 'not', 'non', 'بدون', 'بلا', 'مش', 'لا', 'بلاش', 'غير']);
export const CURRENCY = set(['₪', 'שקל', 'שקלים', 'שח', 'nis', 'ils', 'shekel', 'shekels', 'شيكل', 'شيقل', 'شيكلات', 'شواكل']);
export const BUDGET = set(['עד', 'מקסימום', 'מקס', 'מתחת', 'פחות', 'תקציב', 'בתקציב', 'under', 'below', 'max', 'maximum', 'upto', 'budget', 'less', 'within', 'حتى', 'لحد', 'اقل', 'أقل', 'ميزانية', 'بحدود', 'تحت', 'ماكس']);
export const FOR = set(['ל', 'for', 'ل']);
export const FROM = set(['from', 'מ', 'מן', 'من']);
export const NUMBER_WORDS = new Map<string, number>(
  ([
    ['אחד', 1], ['אחת', 1], ['שניים', 2], ['שתיים', 2], ['שנינו', 2], ['זוג', 2], ['שלושה', 3], ['שלוש', 3], ['שלושתנו', 3], ['ארבעה', 4], ['ארבע', 4], ['חמישה', 5], ['חמש', 5], ['שישה', 6], ['שש', 6], ['שבעה', 7], ['שמונה', 8], ['תשעה', 9], ['עשרה', 10],
    ['واحد', 1], ['وحدة', 1], ['اثنين', 2], ['اثنان', 2], ['ثنين', 2], ['اتنين', 2], ['ثلاثة', 3], ['ثلاث', 3], ['تلاتة', 3], ['اربعة', 4], ['أربعة', 4], ['اربع', 4], ['خمسة', 5], ['خمس', 5], ['ستة', 6], ['سبعة', 7], ['ثمانية', 8], ['تمانية', 8], ['تسعة', 9], ['عشرة', 10],
    ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['couple', 2], ['pair', 2],
  ] as const).map(([w, n]) => [normalizeSearch(w), n]),
);
/** Filler words: dropped before the rest becomes the craving. */
export const STOP = set([
  'משהו', 'אני', 'אנחנו', 'רוצה', 'רוצים', 'בא', 'לי', 'לנו', 'מה', 'יש', 'תן', 'תני', 'תנו', 'תביא', 'תביאו', 'אפשר', 'עם', 'של', 'את', 'גם', 'הכי', 'טוב', 'טובה', 'טעים', 'טעימה', 'בבקשה', 'היום', 'עכשיו', 'קצת', 'איזה', 'ממש', 'רק', 'בשביל', 'עבור', 'להזמין', 'הזמנה', 'לאכול', 'אוכל', 'מנה', 'מנות', 'צריך', 'מחפש', 'מחפשת', 'תמליץ', 'תמליצו', 'המלצה', 'מומלץ', 'או', 'על', 'זה', 'כן', 'היי', 'שלום', 'אהלן', 'תראה', 'תראו', 'במקום', 'ל', 'ב', 'ו', 'ה', 'מ', 'ש',
  'something', 'some', 'i', 'im', 'we', 'want', 'wanna', 'would', 'like', 'me', 'us', 'give', 'get', 'please', 'pls', 'plz', 'good', 'tasty', 'nice', 'now', 'today', 'any', 'a', 'an', 'the', 'and', 'or', 'with', 'of', 'to', 'up', 'for', 'from', 'order', 'eat', 'food', 'dish', 'need', 'looking', 'recommend', 'hi', 'hello', 'hey', 'what', 'whats', 'is', 'are', 'there', 'do', 'you', 'have', 'can', 'could', 'in', 'at', 'my', 'our', 'show', 'instead', 'tonight',
  'شي', 'اشي', 'شيء', 'بدي', 'بدنا', 'ابغى', 'ابي', 'عايز', 'اريد', 'في', 'فيه', 'من', 'مع', 'هلا', 'هسا', 'اليوم', 'لو', 'سمحت', 'طيب', 'زاكي', 'انا', 'احنا', 'ممكن', 'شو', 'ايش', 'عندكم', 'عندك', 'اكل', 'اطلب', 'نطلب', 'عشان', 'ل', 'و', 'او', 'يا', 'مرحبا', 'اهلا', 'هاي', 'بس', 'منيح', 'وريني', 'بدل',
  'shi', 'eshi', 'ishi', 'bdi', 'badi', 'badna', 'ana', 'fi', 'hala', 'halla',
]);
```

- [ ] **Step 4: Write `understand.ts`**

`packages/shared/src/assistant/understand.ts`:
```ts
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
import { foldAll, isIn, tokenize, wordForms } from './text.js';
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
  return r.craving.length > 0 || r.tags.length > 0 || r.exclude.tags.length > 0 || r.exclude.words.length > 0 || r.people !== undefined || r.budgetAgorot !== undefined || r.maxPriceAgorot !== undefined || !!r.cheap || !!r.mode || !!r.placeBranchIds?.length || !!r.meal || !!r.shortcut;
}

export function isMealRequest(r: Request): boolean {
  return r.people !== undefined || r.budgetAgorot !== undefined;
}

export function understand(text: string, places: readonly PlaceName[], prev?: Previous): Request {
  const lang = detectLang(text);
  const tokens = tokenize(text);
  const used = tokens.map(() => false);
  const r = emptyRequest(lang);
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
  // 3. Negation.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (used[i] || used[i + 1] || !V.NEGATION.has(tokens[i]!)) continue;
    const next = tokens[i + 1]!;
    if (V.STOP.has(next) || /^\d+$/.test(next)) continue;
    const tag = tagOf(next);
    if (tag) addTo(r.exclude.tags, tag);
    addTo(r.exclude.words, next);
    used[i] = used[i + 1] = true;
  }
  // 4. Numbers: people or budget.
  readNumbers(tokens, used, r);
  // 5. Family and companions.
  if (eat(tokens, used, V.FAMILY) && r.people === undefined) r.people = 4;
  if (eat(tokens, used, V.COMPANION) && r.people === undefined) r.people = 2;
  // 6. Cheap, mode, meal.
  if (eat(tokens, used, V.CHEAP)) r.cheap = true;
  for (const [mode, list] of V.MODES) if (!r.mode && eat(tokens, used, list)) r.mode = mode;
  for (const [meal, list] of V.MEALS) if (!r.meal && eat(tokens, used, list)) r.meal = meal;
  // 7. Single-word wishes.
  for (const [tag, list] of V.REQUEST_TAGS) while (eat(tokens, used, list)) addTo(r.tags, tag);
  // 8. Filler.
  tokens.forEach((t, i) => {
    if (!used[i] && V.STOP.has(t)) used[i] = true;
  });
  // 9. Places.
  const placeIds = findPlaces(tokens, used, places);
  if (placeIds) r.placeBranchIds = placeIds;
  // 10. The rest is the craving, unless it is only "more" or "something else".
  r.craving = tokens.filter((_, i) => !used[i]);
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
  const m: Request = {
    ...p,
    tags: uniq([...p.tags, ...r.tags]).filter((t) => !exclude.tags.includes(t)),
    exclude,
    people: r.people ?? p.people,
    budgetAgorot: r.budgetAgorot ?? p.budgetAgorot,
    cheap: r.cheap || p.cheap,
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

function eat(tokens: string[], used: boolean[], list: Phrase[]): boolean {
  for (const p of list) {
    for (let i = 0; i + p.length <= tokens.length; i++) {
      const hit = p.every((w, j) => !used[i + j] && (j === 0 ? wordForms(tokens[i]!).includes(w) : tokens[i + j] === w));
      if (hit) {
        for (let j = 0; j < p.length; j++) used[i + j] = true;
        return true;
      }
    }
  }
  return false;
}

function tagOf(word: string): DishTag | undefined {
  const forms = wordForms(word);
  return DISH_TAGS.find((t) => forms.some((f) => TAG_MATCHERS[t].words.has(f)));
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

function readNumbers(tokens: string[], used: boolean[], r: Request): void {
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const num = numberAt(tokens[i]!);
    if (!num) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const upTo = prev === 'to' && tokens[i - 2] === 'up';
    const budgetCue = isIn(next, V.CURRENCY) || isIn(prev, V.CURRENCY) || isIn(prev, V.BUDGET) || upTo;
    const peopleCue = num.forPrefix || isIn(prev, V.FOR) || isIn(next, PEOPLE);
    used[i] = true;
    if (budgetCue) r.budgetAgorot = num.n * 100;
    else if (peopleCue || (num.n >= 1 && num.n <= 12)) r.people = Math.min(20, Math.max(1, num.n));
    else if (num.n >= 20) r.budgetAgorot = num.n * 100;
    const cue = (w: string | undefined) => isIn(w, V.CURRENCY) || isIn(w, V.BUDGET) || isIn(w, V.FOR) || isIn(w, PEOPLE) || w === 'up' || w === 'to';
    for (const j of [i - 2, i - 1, i + 1]) if (j >= 0 && j < tokens.length && !used[j] && cue(tokens[j]) && (j !== i - 2 || upTo)) used[j] = true;
  }
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
      if (/^מ[֐-׿]{2,}$/.test(span[0]!)) variants.push({ words: [span[0]!.slice(1), ...span.slice(1)], from: true });
      for (const v of variants) {
        if (!v.from && v.words.some((w) => wordForms(w).some((f) => FOOD_WORDS.has(f)))) continue;
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
function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
```
Add `export * from './understand.js';` to `assistant/index.ts` (vocab.ts stays internal; `Meal` is re-exported through understand.ts, so exporting both would clash).

- [ ] **Step 5: Run the test**

Run: `npm run test -w packages/shared -- test/assistant/understand.test.ts`
Expected: PASS. When a case fails, fix the vocabulary or step order in `vocab.ts`/`understand.ts` (print `tokenize(text)` to see the folded words); do not weaken the test.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/assistant/vocab.ts packages/shared/src/assistant/understand.ts packages/shared/src/assistant/index.ts packages/shared/test/assistant/understand.test.ts
git commit -m "Assistant: read requests (craving, wishes, people, budget, mode, place, refinements)"
```

---

### Task 7: Assistant data, customer profile, retrieval and ranking

**Files:**
- Create: `packages/shared/src/assistant/profile.ts`
- Create: `packages/shared/src/assistant/data.ts`
- Create: `packages/shared/src/assistant/retrieve.ts`
- Create: `packages/shared/src/assistant/rank.ts`
- Modify: `packages/shared/src/assistant/index.ts`
- Create: `packages/shared/test/assistant/fixtures.ts` (shared by Tasks 7–10)
- Test: `packages/shared/test/assistant/find.test.ts`

**Interfaces:**
- Consumes: `Request`, `PlaceName`, `emptyRequest` (Task 6); `DishIndexDoc`, `DealsIndexDoc`, `PairsIndexDoc`, `PairEntry` (Task 2); `prepareFields`, `parseQuery`, `matchScore` (search); `daySeed`, `DISH_TYPES` (dishIndex); `toLocal` (hours); `dictionaries` (i18n).
- Produces:
```ts
// profile.ts
interface ProfileLine { productId: string; comboId?: string; variantId?: string; modifiers: Array<{ groupId: string; optionId: string; placement?: string }>; quantity: number; requestedGrams?: number; removed?: boolean; name: Localized }
interface ProfileOrder { branchId: string; businessId: string; placedAt: string; mode: FulfillmentMode; status: string; lines: ProfileLine[] }
interface Usual { branchId: string; businessId: string; lines: ProfileLine[]; count: number; lastAt: string; mode: FulfillmentMode }
interface Profile { usuals: Usual[]; favoriteTypes: DishType[]; favoriteBranches: string[]; orderedProductIds: string[]; usualMode?: FulfillmentMode }
buildProfile(orders: ProfileOrder[], typeOf: (branchId: string, productId: string) => DishType | undefined): Profile | undefined
// data.ts
interface AssistantPlace { branchId: string; businessId: string; name: Localized; branchName?: Localized; open: boolean; opensInMin?: number; modes: FulfillmentMode[] }
interface AssistantDish { id: string; branchId: string; entry: DishIndexEntry; search: PreparedFields }
interface AssistantDeal { id: string; branchId: string; kind: 'combo' | 'promotion'; combo?: DealsIndexCombo; promotion?: DealsIndexPromotion }
interface AssistantData { now: Date; seed: number; places: Map<string, AssistantPlace>; placeNames: PlaceName[]; dishes: AssistantDish[]; dishById: Map<string, AssistantDish>; deals: AssistantDeal[]; pairs: Map<string, Record<string, PairEntry[]>>; profile?: Profile; cartBranchId?: string }
dishKey(branchId, productId): string
localizedWords(l?: Localized): string
DISH_TYPE_WORDS: Record<DishType, string>
prepareDishes(places: ReadonlyArray<Pick<AssistantPlace, 'branchId' | 'name'>>, indexes: ReadonlyMap<string, DishIndexDoc>): AssistantDish[]
buildAssistantData(input: { now: Date; places: AssistantPlace[]; dishes: AssistantDish[]; deals?: ReadonlyMap<string, DealsIndexDoc>; pairs?: ReadonlyMap<string, PairsIndexDoc>; orders?: ProfileOrder[]; cartBranchId?: string }): AssistantData
localHour(now: Date): number
clockAt(now: Date, minutesFromNow: number): string   // "HH:MM" Asia/Jerusalem
// retrieve.ts
interface Filters { open: boolean; place: boolean; tags: boolean; exclude: boolean; mode: boolean; budget: boolean }
ALL_FILTERS: Filters
interface Candidate { dish: AssistantDish; match: number }
placeUsable(p: AssistantPlace | undefined, mode?: FulfillmentMode): boolean
retrieve(r: Request, data: AssistantData, f?: Filters): Candidate[]
// rank.ts
interface Hit extends Candidate { points: number }
rank(cands: Candidate[], r: Request, data: AssistantData): Hit[]
diversify<T extends { dish: AssistantDish; points: number }>(sorted: T[]): T[]
mealOf(hour: number): Meal
hashUnit(seed: number, id: string): number   // 0..1
dealProductIds(data: AssistantData): Set<string>   // dishKey()s
popularThenCheap(a: AssistantDish, b: AssistantDish): number
```

- [ ] **Step 1: Write the fixture village**

`packages/shared/test/assistant/fixtures.ts`:
```ts
import { buildAssistantData, prepareDishes, type AssistantData, type AssistantPlace, type DealsIndexDoc, type DishIndexDoc, type DishIndexEntry, type DishTag, type DishType, type Localized, type PairsIndexDoc, type ProfileOrder } from '../../src/index.js';

/** Sunday 4 Oct 2026, 20:00 in Beit Jann (dinner). */
export const NOW = new Date('2026-10-04T17:00:00.000Z');

export const PLACES: AssistantPlace[] = [
  { branchId: 'morano', businessId: 'b-morano', name: { he: 'מורנו', ar: 'مورانو', en: 'Morano' }, open: true, modes: ['pickup', 'delivery', 'dine_in'] },
  { branchId: 'abu', businessId: 'b-abu', name: { he: 'אבו סלים', ar: 'ابو سليم', en: 'Abu Salim' }, open: true, modes: ['pickup', 'delivery'] },
  { branchId: 'sumo', businessId: 'b-sumo', name: { he: 'סומו', ar: 'سومو', en: 'Sumo Asian Kitchen' }, open: true, modes: ['pickup'] },
  { branchId: 'bloom', businessId: 'b-bloom', name: { he: 'בלום', ar: 'بلوم', en: 'Bloom Corner Cafe' }, open: true, modes: ['pickup', 'dine_in'] },
  { branchId: 'burger', businessId: 'b-burger', name: { he: 'בורגר באזל', ar: 'برغر بازل', en: 'Burger Basil' }, open: true, modes: ['pickup', 'delivery'] },
  { branchId: 'baguette', businessId: 'b-baguette', name: { he: 'באגט פארס', ar: 'باجيت فارس', en: 'Baguette Pars' }, open: false, opensInMin: 120, modes: ['pickup'] },
  { branchId: 'madina', businessId: 'b-madina', name: { he: 'מאפיית אלמדינה', ar: 'مخبز المدينة', en: 'Al Madina Bakery' }, open: true, modes: ['pickup'] },
  { branchId: 'dolce', businessId: 'b-dolce', name: { he: 'דולצ׳ה', ar: 'دولتشي', en: 'Dolce Biscotto' }, open: true, modes: ['delivery'] },
];

type D = [id: string, name: Localized, price: number, type: DishType, tags: DishTag[], extra?: Partial<DishIndexEntry>];
const MENUS: Record<string, D[]> = {
  morano: [
    ['m-margherita', { he: 'פיצה מרגריטה', en: 'Margherita pizza', ar: 'بيتزا مارغريتا' }, 4800, 'pizza', ['vegetarian', 'cheese'], { serves: 2, mostOrdered: true, imagePath: 'img/m-margherita.webp' }],
    ['m-pepperoni', { he: 'פיצה פפרוני', en: 'Pepperoni pizza' }, 5600, 'pizza', ['meat', 'cheese'], { serves: 2 }],
    ['m-family', { he: 'פיצה משפחתית', en: 'Family pizza' }, 8900, 'pizza', ['vegetarian', 'cheese', 'sharing'], { serves: 4 }],
    ['m-spicy-family', { he: 'פיצה חריפה משפחתית', en: 'Spicy family pizza', ar: 'بيتزا حارة عائلية' }, 9800, 'pizza', ['spicy', 'vegetarian', 'sharing'], { serves: 4 }],
    ['m-arrabbiata', { he: 'פסטה ארביאטה חריפה', en: 'Spicy arrabbiata pasta' }, 5200, 'pasta', ['spicy', 'vegetarian']],
    ['m-coke', { he: 'קוקה קולה', en: 'Coca-Cola', ar: 'كوكا كولا' }, 900, 'drinks', ['cold_drink'], { mostOrdered: true }],
    ['m-fries', { he: 'צ׳יפס', en: 'Fries', ar: 'بطاطا' }, 1800, 'snacks', ['vegetarian']],
    ['m-tiramisu', { he: 'טירמיסו', en: 'Tiramisu' }, 3200, 'desserts', ['sweet']],
    ['m-espresso', { he: 'אספרסו', en: 'Espresso' }, 900, 'drinks', ['hot_drink']],
  ],
  abu: [
    ['a-shawarma-chicken', { he: 'שווארמה עוף', en: 'Chicken shawarma', ar: 'شاورما دجاج' }, 3800, 'shawarma', ['chicken'], { mostOrdered: true }],
    ['a-shawarma-spicy', { he: 'שווארמה חריפה', en: 'Spicy shawarma', ar: 'شاورما حارة' }, 4000, 'shawarma', ['spicy', 'meat']],
    ['a-falafel', { he: 'פלאפל', en: 'Falafel', ar: 'فلافل' }, 2200, 'snacks', ['vegetarian', 'vegan']],
    ['a-hummus', { he: 'חומוס', en: 'Hummus', ar: 'حمص' }, 2600, 'hummus', ['vegetarian', 'vegan']],
    ['a-cola', { he: 'קולה', en: 'Cola', ar: 'كولا' }, 800, 'drinks', ['cold_drink']],
    ['a-knafeh', { he: 'כנאפה', en: 'Knafeh', ar: 'كنافة' }, 2400, 'desserts', ['sweet']],
    ['a-platter', { he: 'מגש שווארמה משפחתי', en: 'Family shawarma platter' }, 14000, 'shawarma', ['meat', 'sharing'], { serves: 6 }],
  ],
  sumo: [
    ['s-salmon-roll', { he: 'רול סלמון', en: 'Salmon roll', ar: 'رول سلمون' }, 4200, 'sushi', ['fish']],
    ['s-vegan-roll', { he: 'רול טבעוני', en: 'Vegan roll' }, 3600, 'sushi', ['vegan', 'vegetarian']],
    ['s-platter', { he: 'מגש סושי 40 יחידות', en: 'Sushi platter 40 pieces' }, 16000, 'sushi', ['fish', 'sharing'], { serves: 6 }],
    ['s-noodles', { he: 'נודלס חריף', en: 'Spicy noodles', ar: 'نودلز حار' }, 4400, 'mains', ['spicy']],
    ['s-green-tea', { he: 'תה ירוק', en: 'Green tea' }, 1000, 'drinks', ['hot_drink']],
  ],
  bloom: [
    ['bl-shakshuka', { he: 'שקשוקה', en: 'Shakshuka', ar: 'شكشوكة' }, 4200, 'mains', ['breakfast', 'vegetarian']],
    ['bl-croissant', { he: 'קרואסון חמאה', en: 'Butter croissant' }, 1400, 'pastries', ['breakfast', 'vegetarian']],
    ['bl-cappuccino', { he: 'קפוצ׳ינו', en: 'Cappuccino', ar: 'كابتشينو' }, 1200, 'drinks', ['hot_drink']],
    ['bl-iced-coffee', { he: 'אייס קפה', en: 'Iced coffee' }, 1600, 'drinks', ['cold_drink']],
    ['bl-pancakes', { he: 'פנקייק ילדים', en: 'Kids pancakes' }, 2800, 'desserts', ['kids', 'sweet', 'breakfast']],
    ['bl-greek-salad', { he: 'סלט יווני', en: 'Greek salad' }, 3900, 'salads', ['vegetarian', 'healthy', 'cheese']],
  ],
  burger: [
    ['b-classic', { he: 'המבורגר קלאסי', en: 'Classic burger', ar: 'برغر كلاسيك' }, 5200, 'burger', ['meat'], { mostOrdered: true }],
    ['b-chicken', { he: 'בורגר עוף', en: 'Chicken burger' }, 4800, 'burger', ['chicken']],
    ['b-kids-meal', { he: 'ארוחת ילדים', en: 'Kids meal' }, 3500, 'mains', ['kids', 'chicken']],
    ['b-onion-rings', { he: 'טבעות בצל', en: 'Onion rings' }, 1900, 'snacks', ['vegetarian']],
    ['b-sprite', { he: 'ספרייט', en: 'Sprite' }, 900, 'drinks', ['cold_drink']],
    ['b-vegan-burger', { he: 'בורגר טבעוני', en: 'Vegan burger' }, 5000, 'burger', ['vegan', 'vegetarian']],
  ],
  baguette: [
    ['bg-schnitzel', { he: 'באגט שניצל', en: 'Schnitzel baguette' }, 3900, 'mains', ['chicken']],
  ],
  madina: [
    ['md-zaatar', { he: 'מנאקיש זעתר', en: 'Zaatar manakish', ar: 'مناقيش زعتر' }, 1200, 'pastries', ['breakfast', 'vegan', 'vegetarian']],
    ['md-cheese', { he: 'מנאקיש גבינה', en: 'Cheese manakish', ar: 'مناقيش جبنة' }, 1500, 'pastries', ['breakfast', 'vegetarian', 'cheese']],
  ],
  dolce: [
    ['dl-chocolate-cake', { he: 'עוגת שוקולד', en: 'Chocolate cake', ar: 'كيك شوكولاتة' }, 2600, 'desserts', ['sweet']],
    ['dl-waffle', { he: 'וופל בלגי', en: 'Belgian waffle', ar: 'وافل بلجيكي' }, 3200, 'desserts', ['sweet']],
    ['dl-gf-cake', { he: 'עוגה ללא גלוטן', en: 'Gluten-free cake' }, 2900, 'desserts', ['sweet', 'gluten_free']],
  ],
};

export const INDEXES = new Map<string, DishIndexDoc>(Object.entries(MENUS).map(([branchId, dishes]) => {
  const place = PLACES.find((p) => p.branchId === branchId)!;
  const entries = Object.fromEntries(dishes.map(([id, name, price, dishType, tags, extra], i): [string, DishIndexEntry] => [id, { name, priceAgorot: price, fromPrice: false, available: true, needsChoice: false, sortOrder: i, dishType, tags, ...extra }]));
  return [branchId, { branchId, businessId: place.businessId, dishes: entries, updatedAt: '' }];
}));

export const DEALS = new Map<string, DealsIndexDoc>([
  ['morano', {
    branchId: 'morano', businessId: 'b-morano', updatedAt: '',
    combos: { 'm-combo-pair': { name: { he: 'קומבו זוגי', en: 'Combo for two' }, priceAgorot: 6000, items: [{ productId: 'm-margherita', quantity: 1 }, { productId: 'm-coke', quantity: 2 }], sortOrder: 0 } },
    promotions: { 'm-promo-pasta': { title: { he: 'פסטה במבצע', en: 'Pasta deal' }, productIds: ['m-arrabbiata'], endsAt: '2030-01-01', sortOrder: 0 } },
  }],
  ['abu', { branchId: 'abu', businessId: 'b-abu', updatedAt: '', combos: {}, promotions: { 'a-promo-old': { title: { he: 'ישן' }, productIds: ['a-hummus'], endsAt: '2020-01-01', sortOrder: 0 } } }],
  ['burger', { branchId: 'burger', businessId: 'b-burger', updatedAt: '', promotions: {}, combos: { 'b-combo-kids': { name: { he: 'ארוחת ילדים + ספרייט', en: 'Kids meal + Sprite' }, priceAgorot: 3900, items: [{ productId: 'b-kids-meal', quantity: 1 }, { productId: 'b-sprite', quantity: 1 }], sortOrder: 0 } } }],
]);

export const PAIRS = new Map<string, PairsIndexDoc>([
  ['morano', { branchId: 'morano', updatedAt: '', pairs: { 'm-margherita': [{ productId: 'm-coke', count: 9 }] } }],
]);

const line = (productId: string, name: string, quantity = 1) => ({ productId, name: { he: name }, quantity, modifiers: [] });
export const ORDERS: ProfileOrder[] = [
  ...['2026-09-01', '2026-09-10', '2026-09-20'].map((d) => ({ branchId: 'morano', businessId: 'b-morano', placedAt: `${d}T18:00:00.000Z`, mode: 'pickup' as const, status: 'accepted', lines: [line('m-margherita', 'פיצה מרגריטה'), line('m-coke', 'קוקה קולה', 2)] })),
  { branchId: 'abu', businessId: 'b-abu', placedAt: '2026-09-15T18:00:00.000Z', mode: 'delivery', status: 'accepted', lines: [line('a-hummus', 'חומוס')] },
  { branchId: 'abu', businessId: 'b-abu', placedAt: '2026-09-16T18:00:00.000Z', mode: 'delivery', status: 'rejected', lines: [line('a-platter', 'מגש')] },
];

export function fixtureData(opts: { now?: Date; places?: AssistantPlace[]; signedIn?: boolean; cartBranchId?: string } = {}): AssistantData {
  const places = opts.places ?? PLACES;
  return buildAssistantData({
    now: opts.now ?? NOW,
    places,
    dishes: prepareDishes(places, INDEXES),
    deals: DEALS,
    pairs: PAIRS,
    orders: opts.signedIn === false ? undefined : ORDERS,
    cartBranchId: opts.cartBranchId,
  });
}

export const allClosed = (): AssistantPlace[] => PLACES.map((p) => ({ ...p, open: false, opensInMin: 120 }));
```

- [ ] **Step 2: Write the failing test**

`packages/shared/test/assistant/find.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ALL_FILTERS, buildProfile, clockAt, emptyRequest, rank, retrieve, understand, type Request } from '../../src/index.js';
import { NOW, ORDERS, fixtureData } from './fixtures.js';

const data = fixtureData();
const req = (text: string): Request => understand(text, data.placeNames);
const ids = (r: Request, d = data) => retrieve(r, d).map((c) => c.dish.id).sort();

describe('data', () => {
  it('drops expired promotions and keeps live deals', () => {
    expect(data.deals.map((d) => d.id).sort()).toEqual(['b-combo-kids', 'm-combo-pair', 'm-promo-pasta']);
  });
  it('reads Jerusalem time', () => {
    expect(clockAt(NOW, 120)).toBe('22:00');
  });
});

describe('retrieve', () => {
  it('matches the craving across languages at open places only', () => {
    expect(ids(req('פיצה'))).toEqual(['m-family', 'm-margherita', 'm-pepperoni', 'm-spicy-family']);
    expect(ids(req('شاورما'))).toEqual(['a-platter', 'a-shawarma-chicken', 'a-shawarma-spicy']);
    expect(ids(req('באגט'))).toEqual([]);
    expect(retrieve(req('באגט'), data, { ...ALL_FILTERS, open: false }).map((c) => c.dish.id)).toEqual(['bg-schnitzel']);
  });
  it('applies tags, exclusions, mode and price ceilings', () => {
    expect(ids(req('פיצה חריפה'))).toEqual(['m-spicy-family']);
    expect(ids(req('פיצה בלי בשר'))).not.toContain('m-pepperoni');
    expect(ids(req('וופל באיסוף'))).toEqual([]);
    expect(ids({ ...req('פיצה'), maxPriceAgorot: 5000 })).toEqual(['m-margherita']);
  });
});

describe('rank', () => {
  it('cheapest first when asked', () => {
    const r = req('cheapest pizza');
    expect(rank(retrieve(r, data), r, data)[0]!.dish.id).toBe('m-margherita');
  });
  it('spreads the first results across places', () => {
    // Signed out: a profile would (rightly) lift the customer's favourite place above the rotation.
    const anon = fixtureData({ signedIn: false });
    const r = { ...emptyRequest('he'), meal: 'dinner' as const };
    const top = rank(retrieve(r, anon), r, anon).slice(0, 4).map((h) => h.dish.branchId);
    expect(new Set(top).size).toBe(4);
  });
  it('breakfast pushes breakfast dishes and hot drinks first', () => {
    const r = req('ארוחת בוקר');
    const first = rank(retrieve(r, data), r, data)[0]!;
    expect(first.dish.entry.tags).toEqual(expect.arrayContaining([expect.stringMatching(/breakfast|hot_drink/)]));
  });
});

describe('profile', () => {
  it('finds the usual per place from accepted orders', () => {
    const p = buildProfile(ORDERS, (br, id) => data.dishById.get(`${br}/${id}`)?.entry.dishType)!;
    expect(p.usuals[0]).toMatchObject({ branchId: 'morano', count: 3 });
    expect(p.usuals[0]!.lines.map((l) => l.productId)).toEqual(['m-margherita', 'm-coke']);
    expect(p.favoriteBranches).toEqual(['morano']);
    expect(p.orderedProductIds).not.toContain('a-platter');
    expect(p.usualMode).toBe('pickup');
  });
  it('no orders, no profile', () => {
    expect(buildProfile([], () => undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -w packages/shared -- test/assistant/find.test.ts`
Expected: FAIL — `buildAssistantData` not exported.

- [ ] **Step 4: Write `profile.ts`**

`packages/shared/src/assistant/profile.ts`:
```ts
/**
 * What a signed-in customer usually orders, computed on the phone from their last orders (readable
 * by them already). Nothing is stored on the server.
 */
import type { DishType } from '../dishIndex.js';
import type { FulfillmentMode, Localized } from '../types.js';

export interface ProfileLine {
  productId: string;
  comboId?: string;
  variantId?: string;
  modifiers: Array<{ groupId: string; optionId: string; placement?: string }>;
  quantity: number;
  requestedGrams?: number;
  removed?: boolean;
  name: Localized;
}
export interface ProfileOrder {
  branchId: string;
  businessId: string;
  placedAt: string;
  mode: FulfillmentMode;
  status: string;
  lines: ProfileLine[];
}
export interface Usual {
  branchId: string;
  businessId: string;
  /** The latest version of the most repeated order (current option choices). */
  lines: ProfileLine[];
  count: number;
  lastAt: string;
  mode: FulfillmentMode;
}
export interface Profile {
  usuals: Usual[];
  favoriteTypes: DishType[];
  favoriteBranches: string[];
  orderedProductIds: string[];
  usualMode?: FulfillmentMode;
}

export function buildProfile(orders: ProfileOrder[], typeOf: (branchId: string, productId: string) => DishType | undefined): Profile | undefined {
  const live = orders.filter((o) => o.status !== 'rejected' && o.lines.some((l) => !l.removed));
  if (!live.length) return undefined;
  const groups = new Map<string, Usual>();
  const types = new Map<DishType, number>();
  const branches = new Map<string, number>();
  const modes = new Map<FulfillmentMode, number>();
  const products = new Set<string>();
  for (const o of live) {
    const lines = o.lines.filter((l) => !l.removed);
    const sig = `${o.branchId}|${lines.map((l) => `${l.comboId ?? l.productId}:${l.variantId ?? ''}:${l.quantity}`).sort().join(',')}`;
    const g = groups.get(sig);
    if (!g) groups.set(sig, { branchId: o.branchId, businessId: o.businessId, lines, count: 1, lastAt: o.placedAt, mode: o.mode });
    else {
      g.count++;
      if (o.placedAt > g.lastAt) Object.assign(g, { lastAt: o.placedAt, lines, mode: o.mode });
    }
    branches.set(o.branchId, (branches.get(o.branchId) ?? 0) + 1);
    modes.set(o.mode, (modes.get(o.mode) ?? 0) + 1);
    for (const l of lines) {
      products.add(l.productId);
      const t = typeOf(o.branchId, l.productId);
      if (t) types.set(t, (types.get(t) ?? 0) + l.quantity);
    }
  }
  const perPlace = new Map<string, Usual>();
  for (const u of groups.values()) {
    const cur = perPlace.get(u.branchId);
    if (!cur || u.count > cur.count || (u.count === cur.count && u.lastAt > cur.lastAt)) perPlace.set(u.branchId, u);
  }
  const top = <K>(m: Map<K, number>, min: number, n: number) => [...m].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return {
    usuals: [...perPlace.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 3),
    favoriteTypes: top(types, 2, 3),
    favoriteBranches: top(branches, 2, 3),
    orderedProductIds: [...products],
    ...(modes.size ? { usualMode: top(modes, 1, 1)[0] } : {}),
  };
}
```

- [ ] **Step 5: Write `data.ts`**

`packages/shared/src/assistant/data.ts`:
```ts
/**
 * Everything the assistant reasons over, built on the phone from the public per-branch indexes, the
 * customer's own orders and the clock. Dish texts are prepared for search once per index snapshot
 * (prepareDishes); the rest is cheap and rebuilt as time passes (buildAssistantData).
 */
import { DISH_TYPES, daySeed, type DealsIndexCombo, type DealsIndexDoc, type DealsIndexPromotion, type DishIndexDoc, type DishIndexEntry, type DishType, type PairEntry, type PairsIndexDoc } from '../dishIndex.js';
import { toLocal } from '../hours.js';
import { dictionaries } from '../i18n/index.js';
import { prepareFields, type PreparedFields } from '../search/index.js';
import { LOCALES, type FulfillmentMode, type Localized } from '../types.js';
import { buildProfile, type Profile, type ProfileOrder } from './profile.js';
import type { PlaceName } from './understand.js';

export interface AssistantPlace {
  branchId: string;
  businessId: string;
  name: Localized;
  branchName?: Localized;
  /** Can take an order right now (open and not paused). */
  open: boolean;
  opensInMin?: number;
  modes: FulfillmentMode[];
}
export interface AssistantDish {
  id: string;
  branchId: string;
  entry: DishIndexEntry;
  search: PreparedFields;
}
export interface AssistantDeal {
  id: string;
  branchId: string;
  kind: 'combo' | 'promotion';
  combo?: DealsIndexCombo;
  promotion?: DealsIndexPromotion;
}
export interface AssistantData {
  now: Date;
  seed: number;
  places: Map<string, AssistantPlace>;
  placeNames: PlaceName[];
  dishes: AssistantDish[];
  dishById: Map<string, AssistantDish>;
  deals: AssistantDeal[];
  pairs: Map<string, Record<string, PairEntry[]>>;
  profile?: Profile;
  cartBranchId?: string;
}

export const dishKey = (branchId: string, productId: string) => `${branchId}/${productId}`;

export function localizedWords(l?: Localized): string {
  return [l?.he, l?.ar, l?.en].filter(Boolean).join(' ');
}

/** Dish-type names in all three languages, so "פיצה" or "بيتزا" also finds pizzas whose name lacks the word. */
export const DISH_TYPE_WORDS = Object.fromEntries(DISH_TYPES.map((dt) => [dt, LOCALES.map((l) => dictionaries[l][`dishType.${dt}`]).join(' ')])) as Record<DishType, string>;

export function prepareDishes(places: ReadonlyArray<Pick<AssistantPlace, 'branchId' | 'name'>>, indexes: ReadonlyMap<string, DishIndexDoc>): AssistantDish[] {
  const out: AssistantDish[] = [];
  for (const p of places) {
    const idx = indexes.get(p.branchId);
    if (!idx) continue;
    for (const [id, entry] of Object.entries(idx.dishes)) {
      if (!entry.available) continue;
      out.push({ id, branchId: p.branchId, entry, search: prepareFields({ name: localizedWords(entry.name), description: localizedWords(entry.description), type: entry.dishType ? DISH_TYPE_WORDS[entry.dishType] : '', place: localizedWords(p.name) }) });
    }
  }
  return out;
}

export function buildAssistantData(input: { now: Date; places: AssistantPlace[]; dishes: AssistantDish[]; deals?: ReadonlyMap<string, DealsIndexDoc>; pairs?: ReadonlyMap<string, PairsIndexDoc>; orders?: ProfileOrder[]; cartBranchId?: string }): AssistantData {
  const places = new Map(input.places.map((p) => [p.branchId, p]));
  const dishes = input.dishes.filter((d) => places.has(d.branchId));
  const dishById = new Map(dishes.map((d) => [dishKey(d.branchId, d.id), d]));
  const today = toLocal(input.now).date;
  const deals: AssistantDeal[] = [];
  for (const p of input.places) {
    const d = input.deals?.get(p.branchId);
    if (!d) continue;
    for (const [id, combo] of Object.entries(d.combos ?? {})) deals.push({ id, branchId: p.branchId, kind: 'combo', combo });
    // endsAt is the last valid day (same rule as lib/promotions.ts).
    for (const [id, promotion] of Object.entries(d.promotions ?? {})) if (promotion.endsAt >= today) deals.push({ id, branchId: p.branchId, kind: 'promotion', promotion });
  }
  const pairs = new Map<string, Record<string, PairEntry[]>>();
  for (const p of input.places) {
    const doc = input.pairs?.get(p.branchId);
    if (doc) pairs.set(p.branchId, doc.pairs);
  }
  const profile = input.orders?.length ? buildProfile(input.orders, (br, id) => dishById.get(dishKey(br, id))?.entry.dishType) : undefined;
  return {
    now: input.now,
    seed: daySeed(input.now),
    places,
    placeNames: input.places.map((p) => ({ branchId: p.branchId, name: p.name })),
    dishes,
    dishById,
    deals,
    pairs,
    ...(profile ? { profile } : {}),
    ...(input.cartBranchId ? { cartBranchId: input.cartBranchId } : {}),
  };
}

export function localHour(now: Date): number {
  return Math.floor(toLocal(now).minutes / 60);
}

/** Wall-clock "HH:MM" in Asia/Jerusalem, `minutes` from now. */
export function clockAt(now: Date, minutes: number): string {
  const m = (((toLocal(now).minutes + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
```

- [ ] **Step 6: Write `retrieve.ts`**

`packages/shared/src/assistant/retrieve.ts`:
```ts
/**
 * Dishes that fit a request. Each filter can be switched off on its own, so an empty answer can name
 * the wish that blocked it ("nothing vegan open right now") instead of a dead end.
 */
import { matchScore, parseQuery, type SearchQuery } from '../search/index.js';
import type { FulfillmentMode } from '../types.js';
import type { AssistantData, AssistantDish, AssistantPlace } from './data.js';
import type { Request } from './understand.js';

export interface Filters {
  open: boolean;
  place: boolean;
  tags: boolean;
  exclude: boolean;
  mode: boolean;
  budget: boolean;
}
export const ALL_FILTERS: Filters = { open: true, place: true, tags: true, exclude: true, mode: true, budget: true };

export interface Candidate {
  dish: AssistantDish;
  /** matchScore of the craving (lower is better); 0 without a craving. */
  match: number;
}

export function placeUsable(p: AssistantPlace | undefined, mode?: FulfillmentMode): boolean {
  return !!p && p.open && (mode ? p.modes.includes(mode) : p.modes.length > 0);
}

export function retrieve(r: Request, data: AssistantData, f: Filters = ALL_FILTERS): Candidate[] {
  const query = r.craving.length ? parseQuery(`${r.craving.join(' ')} `) : null;
  const excludeQueries = f.exclude ? r.exclude.words.map((w) => parseQuery(`${w} `)).filter((q): q is SearchQuery => !!q) : [];
  const out: Candidate[] = [];
  for (const dish of data.dishes) {
    const place = data.places.get(dish.branchId);
    if (!place || !place.modes.length) continue;
    if (f.open && !place.open) continue;
    if (f.mode && r.mode && !place.modes.includes(r.mode)) continue;
    if (f.place && r.placeBranchIds?.length && !r.placeBranchIds.includes(dish.branchId)) continue;
    if (f.exclude && (r.exclude.branchIds.includes(dish.branchId) || r.exclude.dishIds.includes(dish.id))) continue;
    const tags = dish.entry.tags ?? [];
    if (f.tags && r.tags.some((t) => !tags.includes(t))) continue;
    if (f.exclude && r.exclude.tags.some((t) => tags.includes(t))) continue;
    if (excludeQueries.some((q) => {
      const m = matchScore(q, dish.search);
      return m !== null && m.level <= 6;
    })) continue;
    if (f.budget && r.maxPriceAgorot !== undefined && dish.entry.priceAgorot > r.maxPriceAgorot) continue;
    if (f.budget && r.budgetAgorot !== undefined && r.people === undefined && dish.entry.priceAgorot > r.budgetAgorot) continue;
    let match = 0;
    if (query) {
      const m = matchScore(query, dish.search);
      if (!m) continue;
      match = m.score;
    }
    out.push({ dish, match });
  }
  return out;
}
```

- [ ] **Step 7: Write `rank.ts`**

`packages/shared/src/assistant/rank.ts`:
```ts
/**
 * Orders candidates: craving match first, then taste fit, the time of day, what the customer likes,
 * popularity, photos and deals. Places take turns within each 100-point tier, and equal dishes rotate
 * daily, so no restaurant owns the top of every answer.
 */
import type { AssistantData, AssistantDish } from './data.js';
import { dishKey, localHour } from './data.js';
import type { Candidate } from './retrieve.js';
import type { Meal, Request } from './understand.js';

export interface Hit extends Candidate {
  points: number;
}

export function mealOf(hour: number): Meal {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'late';
}

export function hashUnit(seed: number, id: string): number {
  let h = seed | 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761);
  return ((h >>> 0) % 10000) / 10000;
}

export function dealProductIds(data: AssistantData): Set<string> {
  const ids = new Set<string>();
  for (const d of data.deals) for (const id of d.combo ? d.combo.items.map((i) => i.productId) : d.promotion?.productIds ?? []) ids.add(dishKey(d.branchId, id));
  return ids;
}

export const popularThenCheap = (a: AssistantDish, b: AssistantDish) => Number(!!b.entry.mostOrdered) - Number(!!a.entry.mostOrdered) || a.entry.priceAgorot - b.entry.priceAgorot;

export function rank(cands: Candidate[], r: Request, data: AssistantData): Hit[] {
  const meal = r.meal ?? mealOf(localHour(data.now));
  const prof = data.profile;
  const deals = dealProductIds(data);
  const maxPrice = Math.max(1, ...cands.map((c) => c.dish.entry.priceAgorot));
  const hits = cands.map(({ dish, match }): Hit => {
    const e = dish.entry;
    const tags = e.tags ?? [];
    let points = r.craving.length ? 1000 - match : 0;
    if (meal === 'breakfast' && (tags.includes('breakfast') || tags.includes('hot_drink'))) points += r.meal ? 300 : 60;
    if (r.meal && r.meal !== 'breakfast' && tags.includes('breakfast')) points -= 50;
    if (e.mostOrdered) points += 40;
    if (e.imagePath) points += 15;
    if (prof) {
      if (e.dishType && prof.favoriteTypes.includes(e.dishType)) points += 30;
      if (prof.favoriteBranches.includes(dish.branchId)) points += 20;
      if (prof.orderedProductIds.includes(dish.id)) points += 25;
    }
    if (deals.has(dishKey(dish.branchId, dish.id))) points += 15;
    if (data.cartBranchId === dish.branchId) points += 20;
    if (r.cheap) points += Math.round((1 - e.priceAgorot / maxPrice) * 150);
    if (r.shortcut === 'surprise') points += Math.round(hashUnit(data.seed, dish.id) * 80);
    return { dish, match, points };
  });
  hits.sort((a, b) => b.points - a.points || hashUnit(data.seed, a.dish.id) - hashUnit(data.seed, b.dish.id));
  return diversify(hits);
}

export function diversify<T extends { dish: AssistantDish; points: number }>(sorted: T[]): T[] {
  const tiers = new Map<number, T[]>();
  for (const h of sorted) {
    const k = Math.floor(h.points / 100);
    tiers.set(k, [...(tiers.get(k) ?? []), h]);
  }
  return [...tiers.keys()].sort((a, b) => b - a).flatMap((k) => roundRobin(tiers.get(k)!));
}

function roundRobin<T extends { dish: AssistantDish }>(list: T[]): T[] {
  const out: T[] = [];
  const rest = [...list];
  while (rest.length) {
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; ) {
      const h = rest[i]!;
      if (seen.has(h.dish.branchId)) {
        i++;
        continue;
      }
      seen.add(h.dish.branchId);
      out.push(h);
      rest.splice(i, 1);
    }
  }
  return out;
}
```
Add to `assistant/index.ts`:
```ts
export * from './profile.js';
export * from './data.js';
export * from './retrieve.js';
export * from './rank.js';
```

- [ ] **Step 8: Run the tests**

Run: `npm run test -w packages/shared -- test/assistant/find.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/assistant/profile.ts packages/shared/src/assistant/data.ts packages/shared/src/assistant/retrieve.ts packages/shared/src/assistant/rank.ts packages/shared/src/assistant/index.ts packages/shared/test/assistant/fixtures.ts packages/shared/test/assistant/find.test.ts
git commit -m "Assistant: data model, customer profile, retrieval with relaxable filters, neutral ranking"
```

---

### Task 8: One-place meals and upsell

**Files:**
- Create: `packages/shared/src/assistant/mealBuilder.ts`
- Create: `packages/shared/src/assistant/upsell.ts`
- Modify: `packages/shared/src/assistant/index.ts`
- Test: `packages/shared/test/assistant/meals.test.ts`

**Interfaces:**
- Consumes: `retrieve`, `placeUsable` (Task 7), `Hit`, `popularThenCheap` (Task 7), `AssistantData`, `AssistantDeal`, `AssistantDish`, `dishKey` (Task 7), `emptyRequest`, `Request` (Task 6).
- Produces:
```ts
interface MealLine { productId: string; comboId?: string; qty: number; unitAgorot: number; needsChoice: boolean }
interface MealBasket { branchId: string; lines: MealLine[]; totalAgorot: number; serves: number; savingsAgorot: number; points: number }
servesOf(e: DishIndexEntry): number
buildMeals(r: Request, data: AssistantData, ranked: Hit[]): MealBasket[]          // best basket per place, best first
applyCombos(lines: MealLine[], combos: AssistantDeal[]): { lines: MealLine[]; savings: number }
upsellFor(added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData): AssistantDish | undefined
```
A combo line has `productId === comboId`, `needsChoice: true` (it opens ComboSheet).

- [ ] **Step 1: Write the failing test**

`packages/shared/test/assistant/meals.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCombos, buildMeals, rank, retrieve, understand, upsellFor } from '../../src/index.js';
import { fixtureData } from './fixtures.js';

const data = fixtureData();
const meals = (text: string) => {
  const r = understand(text, data.placeNames);
  return buildMeals(r, data, rank(retrieve(r, data), r, data));
};

describe('buildMeals', () => {
  it('spicy for 4 under ₪150: a family pizza and four drinks at Morano', () => {
    const [b, ...rest] = meals('משהו חריף ל-4 עד 150');
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ branchId: 'morano', totalAgorot: 13400, serves: 4, savingsAgorot: 0 });
    expect(b!.lines).toEqual([
      { productId: 'm-spicy-family', qty: 1, unitAgorot: 9800, needsChoice: false },
      { productId: 'm-coke', qty: 4, unitAgorot: 900, needsChoice: false },
    ]);
  });
  it('pizza for two turns into the cheaper combo plus fries', () => {
    const [b] = meals('pizza for 2');
    expect(b!.branchId).toBe('morano');
    expect(b!.lines).toEqual([
      { productId: 'm-fries', qty: 1, unitAgorot: 1800, needsChoice: false },
      { productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 1, unitAgorot: 6000, needsChoice: true },
    ]);
    expect(b).toMatchObject({ totalAgorot: 7800, savingsAgorot: 600 });
  });
  it('a budget below every basket gives nothing', () => {
    expect(meals('ל-6 עד 30')).toEqual([]);
  });
  it('a budget without people fits one dish', () => {
    const [b] = meals('פיצה עד 50');
    expect(b!.lines).toEqual([{ productId: 'm-margherita', qty: 1, unitAgorot: 4800, needsChoice: false }]);
  });
});

describe('applyCombos', () => {
  it('applies a combo as many times as the lines allow', () => {
    const combos = data.deals.filter((d) => d.kind === 'combo');
    const r = applyCombos([{ productId: 'm-margherita', qty: 2, unitAgorot: 4800, needsChoice: false }, { productId: 'm-coke', qty: 4, unitAgorot: 900, needsChoice: false }], combos);
    expect(r.lines).toEqual([{ productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 2, unitAgorot: 6000, needsChoice: true }]);
    expect(r.savings).toBe(1200);
  });
});

describe('upsellFor', () => {
  it('uses what people buy together first', () => {
    expect(upsellFor({ branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data)?.id).toBe('m-coke');
  });
  it('falls back to a cold drink for a main and a hot one for a pastry', () => {
    expect(upsellFor({ branchId: 'abu', productId: 'a-shawarma-chicken' }, ['a-shawarma-chicken'], data)?.id).toBe('a-cola');
    expect(upsellFor({ branchId: 'bloom', productId: 'bl-croissant' }, ['bl-croissant'], data)?.id).toBe('bl-cappuccino');
  });
  it('never for a closed place', () => {
    expect(upsellFor({ branchId: 'baguette', productId: 'bg-schnitzel' }, [], data)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w packages/shared -- test/assistant/meals.test.ts`
Expected: FAIL — `buildMeals` not exported.

- [ ] **Step 3: Write `mealBuilder.ts`**

`packages/shared/src/assistant/mealBuilder.ts`:
```ts
/**
 * "For 4 under ₪150": a ready basket from ONE place (the cart holds one place). Mains cover the people
 * (serves × qty), then drinks (one each) and sides (one per two) while the budget lasts; a combo
 * replaces its items when it is cheaper. Each place offers its best basket; the best places win.
 */
import type { DishIndexEntry, DishType } from '../dishIndex.js';
import type { AssistantData, AssistantDeal, AssistantDish } from './data.js';
import { popularThenCheap, type Hit } from './rank.js';
import { retrieve } from './retrieve.js';
import { emptyRequest, type Request } from './understand.js';

export interface MealLine {
  productId: string;
  comboId?: string;
  qty: number;
  unitAgorot: number;
  needsChoice: boolean;
}
export interface MealBasket {
  branchId: string;
  lines: MealLine[];
  totalAgorot: number;
  serves: number;
  savingsAgorot: number;
  points: number;
}

const MAIN_TYPES: readonly DishType[] = ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'sushi', 'mains', 'pastries', 'salads'];
const ANCHORS = 4;

export function servesOf(e: DishIndexEntry): number {
  return e.serves ?? (e.dishType === 'pizza' ? 2 : 1);
}

function isMain(e: DishIndexEntry): boolean {
  if (e.dishType) return MAIN_TYPES.includes(e.dishType);
  return !(e.tags ?? []).some((t) => t === 'cold_drink' || t === 'hot_drink' || t === 'sweet');
}

export function buildMeals(r: Request, data: AssistantData, ranked: Hit[]): MealBasket[] {
  const people = r.people ?? 1;
  const budget = r.budgetAgorot ?? Number.POSITIVE_INFINITY;
  const byBranch = new Map<string, Hit[]>();
  for (const h of ranked) byBranch.set(h.dish.branchId, [...(byBranch.get(h.dish.branchId) ?? []), h]);
  const out: MealBasket[] = [];
  for (const [branchId, hits] of byBranch) {
    const mains = hits.filter((h) => isMain(h.dish.entry));
    const anchors = (mains.length ? mains : hits).slice(0, ANCHORS);
    // Drinks and sides come from the whole menu of the place, minus what the customer excluded.
    const extras = retrieve({ ...emptyRequest(r.lang), exclude: r.exclude, ...(r.mode ? { mode: r.mode } : {}), placeBranchIds: [branchId] }, data)
      .map((c) => c.dish)
      .filter((d) => !d.entry.needsChoice);
    const drinks = extras.filter((d) => d.entry.dishType === 'drinks').sort((a, b) => coldFirst(a, b) || popularThenCheap(a, b));
    const sides = extras.filter((d) => d.entry.dishType === 'snacks').sort(popularThenCheap);
    const combos = data.deals.filter((d) => d.branchId === branchId && d.combo);
    let best: MealBasket | undefined;
    for (const a of anchors) {
      const e = a.dish.entry;
      const qty = Math.ceil(people / servesOf(e));
      const lines: MealLine[] = [{ productId: a.dish.id, qty, unitAgorot: e.priceAgorot, needsChoice: e.needsChoice }];
      let total = qty * e.priceAgorot;
      if (total > budget) continue;
      const add = (d: AssistantDish | undefined, want: number) => {
        if (!d || want <= 0 || lines.some((l) => l.productId === d.id)) return;
        const fit = Number.isFinite(budget) ? Math.min(want, Math.floor((budget - total) / d.entry.priceAgorot)) : want;
        if (fit <= 0) return;
        lines.push({ productId: d.id, qty: fit, unitAgorot: d.entry.priceAgorot, needsChoice: false });
        total += fit * d.entry.priceAgorot;
      };
      if (e.dishType !== 'drinks') add(drinks[0], people);
      if (people >= 2 && e.dishType !== 'snacks') add(sides[0], Math.ceil(people / 2));
      const applied = applyCombos(lines, combos);
      const finalTotal = applied.lines.reduce((s, l) => s + l.qty * l.unitAgorot, 0);
      const basket: MealBasket = { branchId, lines: applied.lines, totalAgorot: finalTotal, serves: qty * servesOf(e), savingsAgorot: applied.savings, points: (r.cheap ? -finalTotal / 100 : a.points) + applied.savings / 1000 };
      if (!best || basket.points > best.points || (basket.points === best.points && basket.totalAgorot < best.totalAgorot)) best = basket;
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => y.points - x.points || x.totalAgorot - y.totalAgorot);
}

const coldFirst = (a: AssistantDish, b: AssistantDish) => Number((b.entry.tags ?? []).includes('cold_drink')) - Number((a.entry.tags ?? []).includes('cold_drink'));

export function applyCombos(lines: MealLine[], combos: AssistantDeal[]): { lines: MealLine[]; savings: number } {
  let work = lines.map((l) => ({ ...l }));
  let savings = 0;
  for (let round = 0; round < 5; round++) {
    let pick: { deal: AssistantDeal; saving: number } | undefined;
    for (const d of combos) {
      const c = d.combo!;
      let value = 0;
      let ok = true;
      for (const it of c.items) {
        const l = work.find((x) => x.productId === it.productId && !x.comboId);
        if (!l || l.qty < it.quantity) {
          ok = false;
          break;
        }
        value += it.quantity * l.unitAgorot;
      }
      const saving = value - c.priceAgorot;
      if (ok && saving > 0 && (!pick || saving > pick.saving)) pick = { deal: d, saving };
    }
    if (!pick) break;
    for (const it of pick.deal.combo!.items) work.find((x) => x.productId === it.productId && !x.comboId)!.qty -= it.quantity;
    work = work.filter((l) => l.qty > 0);
    const existing = work.find((l) => l.comboId === pick!.deal.id);
    if (existing) existing.qty += 1;
    else work.push({ productId: pick.deal.id, comboId: pick.deal.id, qty: 1, unitAgorot: pick.deal.combo!.priceAgorot, needsChoice: true });
    savings += pick.saving;
  }
  return { lines: work, savings };
}
```

- [ ] **Step 4: Write `upsell.ts`**

`packages/shared/src/assistant/upsell.ts`:
```ts
/** One "goes well with it" suggestion after an add: what others bought with it, else a sensible complement from the same place. */
import type { DishType } from '../dishIndex.js';
import { dishKey, type AssistantData, type AssistantDish } from './data.js';
import { popularThenCheap } from './rank.js';
import { placeUsable } from './retrieve.js';

const COMPLEMENT: Record<DishType, readonly DishType[]> = {
  pizza: ['drinks', 'snacks', 'desserts'], pasta: ['drinks', 'desserts'], burger: ['drinks', 'snacks'], shawarma: ['drinks', 'snacks'],
  hummus: ['drinks', 'salads'], sushi: ['drinks', 'desserts'], mains: ['drinks', 'snacks', 'salads'], pastries: ['drinks'],
  salads: ['drinks'], snacks: ['drinks'], desserts: ['drinks'], drinks: ['desserts', 'snacks'],
};
const HOT_WITH: readonly DishType[] = ['pastries', 'desserts'];

export function upsellFor(added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData): AssistantDish | undefined {
  if (!placeUsable(data.places.get(added.branchId))) return undefined;
  const pool = data.dishes.filter((d) => d.branchId === added.branchId && d.id !== added.productId && !inCart.includes(d.id) && !d.entry.needsChoice);
  for (const p of data.pairs.get(added.branchId)?.[added.productId] ?? []) {
    const d = pool.find((x) => x.id === p.productId);
    if (d) return d;
  }
  const type = data.dishById.get(dishKey(added.branchId, added.productId))?.entry.dishType ?? 'mains';
  const wantTag = HOT_WITH.includes(type) ? 'hot_drink' : 'cold_drink';
  for (const want of COMPLEMENT[type]) {
    const options = pool.filter((d) => d.entry.dishType === want).sort((a, b) => Number((b.entry.tags ?? []).includes(wantTag)) - Number((a.entry.tags ?? []).includes(wantTag)) || popularThenCheap(a, b));
    if (options[0]) return options[0];
  }
  return undefined;
}
```
Add to `assistant/index.ts`:
```ts
export * from './mealBuilder.js';
export * from './upsell.js';
```

- [ ] **Step 5: Run the tests**

Run: `npm run test -w packages/shared -- test/assistant/meals.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/assistant/mealBuilder.ts packages/shared/src/assistant/upsell.ts packages/shared/src/assistant/index.ts packages/shared/test/assistant/meals.test.ts
git commit -m "Assistant: one-place meals within a budget (combos when cheaper) and upsell"
```

---

### Task 9: Replies, conversation, home picks and card resolution

**Files:**
- Create: `packages/shared/src/assistant/replies.ts`
- Create: `packages/shared/src/assistant/respond.ts`
- Create: `packages/shared/src/assistant/home.ts`
- Create: `packages/shared/src/assistant/cards.ts`
- Modify: `packages/shared/src/assistant/index.ts`
- Test: `packages/shared/test/assistant/respond.test.ts`, `packages/shared/test/assistant/cards.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–8; `layoutAlternatives` (search); `TAG_LABELS` (Task 1); `dictionaries` (i18n).
- Produces:
```ts
// replies.ts
type ReplyKey = 'picks' | 'picksNow' | 'meal' | 'deals' | 'dealsNone' | 'usual' | 'usualNone' | 'usualSignedOut' | 'surprise' | 'place' | 'blocked' | 'closed' | 'closedAll' | 'noMore' | 'reprompt1' | 'reprompt2' | 'upsell' | 'greetMorning' | 'greetNoon' | 'greetEvening' | 'greetNight'
reply(key: ReplyKey, lang: Lang, vars?: Record<string, string | number>, seed?: number): string
type ChipKey = 'cheaper' | 'other' | 'otherPlace' | 'deals' | 'usual' | 'noMeat' | 'drop' | 'more' | 'byBudget' | Meal
chipLabel(key: ChipKey, lang: Lang): string
peopleLabel(n: number, lang: Lang): string
MODE_LABELS: Record<FulfillmentMode, Record<Lang, string>>
// respond.ts
type Card = { kind: 'dish'; branchId: string; productId: string } | { kind: 'meal'; basket: MealBasket } | { kind: 'deal'; branchId: string; dealId: string } | { kind: 'usual'; usual: Usual }
type TurnKind = 'dish' | 'meal' | 'deal' | 'usual' | 'place' | 'surprise' | 'blocked' | 'closed' | 'reprompt' | 'upsell' | 'none'
interface Chip { label: string; send?: string; request?: Request }
interface AssistantTurn { id: string; role: 'assistant'; kind: TurnKind; text: string; cards: Card[]; chips: Chip[]; more?: Chip; signIn?: boolean }
interface UserTurn { id: string; role: 'user'; text: string }
type ConvTurn = AssistantTurn | UserTurn
interface Conversation { turns: ConvTurn[]; last?: Previous; misses: number; upsellSkips: number }
interface RespondOptions { signedIn: boolean; uiLang: Lang }
EMPTY_CONVERSATION: Conversation
respond(conv: Conversation, input: string | Chip, data: AssistantData, opts: RespondOptions): Conversation
afterAdd(conv: Conversation, added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData): Conversation
// home.ts
interface HomeView { greeting: string; cards: Card[]; chips: Chip[]; closedUntil?: string }
homeView(data: AssistantData, opts: RespondOptions): HomeView
// cards.ts
type ResolvedCard = { kind: 'dish'; dish: AssistantDish; place: AssistantPlace } | { kind: 'meal'; basket: MealBasket; place: AssistantPlace; lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> } | { kind: 'deal'; deal: AssistantDeal; place: AssistantPlace; itemNames: Localized[] } | { kind: 'usual'; usual: Usual; place: AssistantPlace; missing: Localized[] }
resolveCard(card: Card, data: AssistantData): ResolvedCard | null
```

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/assistant/respond.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION, afterAdd, homeView, respond, type AssistantTurn, type Conversation } from '../../src/index.js';
import { allClosed, fixtureData } from './fixtures.js';

const data = fixtureData();
const opts = { signedIn: true, uiLang: 'he' as const };
const say = (...msgs: string[]) => msgs.reduce<Conversation>((c, m) => respond(c, m, data, opts), EMPTY_CONVERSATION);
const last = (c: Conversation) => c.turns.at(-1) as AssistantTurn;

describe('respond', () => {
  it('answers a craving with three dish cards, refinement chips and "more"', () => {
    const c = say('משהו חריף');
    const t = last(c);
    expect(t.kind).toBe('dish');
    expect(t.cards).toHaveLength(3);
    expect(t.chips.map((x) => x.label)).toContain('יותר זול');
    expect(t.more).toBeDefined();
    expect(c.last!.request.tags).toEqual(['spicy']);
  });

  it('"more" shows the next cards', () => {
    const c1 = say('משהו חריף');
    const c2 = respond(c1, last(c1).more!, data, opts);
    const ids = (t: AssistantTurn) => t.cards.map((x) => (x.kind === 'dish' ? x.productId : ''));
    expect(ids(last(c2))).not.toEqual(ids(last(c1)));
  });

  it('budget too low: names the budget and offers to drop it', () => {
    const c = say('ל-6 עד 30');
    const t = last(c);
    expect(t.kind).toBe('blocked');
    expect(t.text).toContain('₪30');
    expect(t.cards).toEqual([]);
    const drop = t.chips[0]!;
    expect(drop.request?.budgetAgorot).toBeUndefined();
    expect(last(respond(c, drop, data, opts)).kind).toBe('meal');
  });

  it('all closed: says when the first place opens, offers nothing to add', () => {
    const closed = fixtureData({ places: allClosed() });
    const t = last(respond(EMPTY_CONVERSATION, 'פיצה', closed, opts));
    expect(t.kind).toBe('closed');
    expect(t.text).toContain('22:00');
    expect(t.cards).toEqual([]);
    const home = homeView(closed, opts);
    expect(home.closedUntil).toBe('22:00');
    expect(home.cards).toEqual([]);
  });

  it('reprompt ladder: never the same reprompt twice, the second one offers fixed choices only', () => {
    const c1 = say('qwzx');
    expect(last(c1).kind).toBe('reprompt');
    const c2 = respond(c1, 'zzqq', data, opts);
    expect(last(c2).kind).toBe('reprompt');
    expect(last(c2).text).not.toBe(last(c1).text);
    expect(last(c2).cards).toEqual([]);
    expect(last(c2).chips.length).toBeGreaterThanOrEqual(3);
    expect(c2.misses).toBe(2);
  });

  it('reads the wrong keyboard', () => {
    const t = last(say('auutrnv'));
    expect(t.kind).toBe('dish');
    expect(t.cards.map((x) => (x.kind === 'dish' ? x.productId : ''))).toContain('a-shawarma-chicken');
  });

  it('replies in the UI language when the message has no letters', () => {
    expect(last(respond(EMPTY_CONVERSATION, '150', data, opts)).text).toMatch(/[֐-׿]/);
  });

  it('usual: signed in shows it, signed out asks to sign in', () => {
    expect(last(say('הרגיל שלי')).kind).toBe('usual');
    const t = last(respond(EMPTY_CONVERSATION, 'הרגיל שלי', fixtureData({ signedIn: false }), { signedIn: false, uiLang: 'he' }));
    expect(t.signIn).toBe(true);
  });

  it('one upsell per add, and none after two skips', () => {
    const c1 = afterAdd(say('פיצה'), { branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data);
    expect(last(c1).kind).toBe('upsell');
    expect(last(c1).cards).toEqual([{ kind: 'dish', branchId: 'morano', productId: 'm-coke' }]);
    expect(afterAdd(c1, { branchId: 'morano', productId: 'm-coke' }, ['m-margherita', 'm-coke'], data)).toBe(c1);
    let c = c1;
    c = respond(c, 'סושי', data, opts);
    c = afterAdd(c, { branchId: 'sumo', productId: 's-salmon-roll' }, ['s-salmon-roll'], data);
    c = respond(c, 'קינוח', data, opts);
    expect(c.upsellSkips).toBe(2);
    expect(afterAdd(c, { branchId: 'dolce', productId: 'dl-waffle' }, ['dl-waffle'], data)).toBe(c);
  });
});

describe('homeView', () => {
  it('greets by the time and offers the usual, a deal and a pick from three different places', () => {
    const home = homeView(data, opts);
    expect(home.greeting).toMatch(/ערב|מה לערב/);
    expect(home.cards.map((c) => c.kind)).toEqual(['usual', 'deal', 'dish']);
    expect(home.chips.length).toBeGreaterThanOrEqual(3);
  });
});
```

`packages/shared/test/assistant/cards.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildAssistantData, prepareDishes, resolveCard, type MealBasket } from '../../src/index.js';
import { DEALS, INDEXES, NOW, PLACES, fixtureData } from './fixtures.js';

const data = fixtureData();
const basket: MealBasket = { branchId: 'morano', lines: [{ productId: 'm-margherita', qty: 1, unitAgorot: 4800, needsChoice: false }, { productId: 'm-combo-pair', comboId: 'm-combo-pair', qty: 1, unitAgorot: 6000, needsChoice: true }], totalAgorot: 10800, serves: 2, savingsAgorot: 0, points: 0 };

describe('resolveCard', () => {
  it('resolves every kind', () => {
    expect(resolveCard({ kind: 'dish', branchId: 'morano', productId: 'm-coke' }, data)).toMatchObject({ kind: 'dish', place: { branchId: 'morano' } });
    expect(resolveCard({ kind: 'meal', basket }, data)).toMatchObject({ kind: 'meal', lines: [{ name: { he: 'פיצה מרגריטה' } }, { name: { he: 'קומבו זוגי' } }] });
    expect(resolveCard({ kind: 'deal', branchId: 'morano', dealId: 'm-combo-pair' }, data)).toMatchObject({ kind: 'deal', itemNames: [{ he: 'פיצה מרגריטה' }, { he: 'קוקה קולה' }] });
  });

  it('a restored conversation after a menu change: missing dishes drop the card instead of crashing', () => {
    const morano = INDEXES.get('morano')!;
    const { ['m-margherita']: _gone, ...rest } = morano.dishes;
    const changed = buildAssistantData({ now: NOW, places: PLACES, dishes: prepareDishes(PLACES, new Map([...INDEXES, ['morano', { ...morano, dishes: rest }]])), deals: DEALS });
    expect(resolveCard({ kind: 'dish', branchId: 'morano', productId: 'm-margherita' }, changed)).toBeNull();
    expect(resolveCard({ kind: 'meal', basket }, changed)).toBeNull();
    expect(resolveCard({ kind: 'dish', branchId: 'nowhere', productId: 'x' }, changed)).toBeNull();
    const usual = { branchId: 'morano', businessId: 'b-morano', lines: [{ productId: 'm-margherita', quantity: 1, modifiers: [], name: { he: 'פיצה מרגריטה' } }], count: 3, lastAt: '', mode: 'pickup' as const };
    expect(resolveCard({ kind: 'usual', usual }, changed)).toMatchObject({ missing: [{ he: 'פיצה מרגריטה' }] });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w packages/shared -- test/assistant/respond.test.ts test/assistant/cards.test.ts`
Expected: FAIL — `respond` not exported.

- [ ] **Step 3: Write `replies.ts`**

`packages/shared/src/assistant/replies.ts`:
```ts
/** The assistant's words: three wordings per reply so it never sounds canned, plus chip and slot labels. Hebrew speaks to the customer in plural. */
import type { FulfillmentMode } from '../types.js';
import type { Lang, Meal } from './understand.js';

export type ReplyKey = 'picks' | 'picksNow' | 'meal' | 'deals' | 'dealsNone' | 'usual' | 'usualNone' | 'usualSignedOut' | 'surprise' | 'place' | 'blocked' | 'closed' | 'closedAll' | 'noMore' | 'reprompt1' | 'reprompt2' | 'upsell' | 'greetMorning' | 'greetNoon' | 'greetEvening' | 'greetNight';

const R: Record<ReplyKey, Record<Lang, readonly string[]>> = {
  picks: { he: ['הנה מה שמצאתי:', 'אלה נראים מתאימים:', 'מה דעתכם על אלה?'], ar: ['هاي اللي لقيته:', 'هدول ممكن يعجبوك:', 'شو رأيك بهدول؟'], en: ["Here's what I found:", 'These look right:', 'How about these?'] },
  picksNow: { he: ['כמה רעיונות לעכשיו:', 'מה שהולך עכשיו:', 'שווה לנסות:'], ar: ['شوية أفكار لهلا:', 'اقتراحات لهلا:', 'جرّب هدول:'], en: ['A few ideas for now:', 'Good picks right now:', 'Worth a try:'] },
  meal: { he: ['ארוחה ל־{people}:', 'ככה מסתדרים ל־{people}:', 'מוכן ל־{people}:'], ar: ['وجبة لـ{people}:', 'هيك بتزبط لـ{people}:', 'جاهزة لـ{people}:'], en: ['A meal for {people}:', "Here's how {people} can eat:", 'Ready for {people}:'] },
  deals: { he: ['המבצעים עכשיו:', 'יש מבצעים:', 'שווה עכשיו:'], ar: ['العروض هلا:', 'في عروض:', 'هاي العروض:'], en: ['Deals right now:', 'On offer now:', 'Worth it now:'] },
  dealsNone: { he: ['אין כרגע מבצע מתאים.', 'כרגע אין מבצע כזה.', 'לא מצאתי מבצע מתאים עכשיו.'], ar: ['ما في عرض مناسب هلا.', 'هلا ما في عرض هيك.', 'ما لقيت عرض مناسب هلا.'], en: ['No matching deal right now.', 'No deal like that at the moment.', "I couldn't find a matching deal."] },
  usual: { he: ['כמו תמיד?', 'הרגיל שלכם:', 'שוב את זה?'], ar: ['زي العادة؟', 'طلبك المعتاد:', 'نفس الطلب؟'], en: ['The usual?', 'Your usual:', 'Same again?'] },
  usualNone: { he: ['עוד אין הזמנות קודמות. מה שאהוב עכשיו:', 'אחרי ההזמנה הראשונה אזכור. בינתיים:', 'עוד לא הזמנתם. אולי אחד מאלה?'], ar: ['ما في طلبات قبل. هاي الأكثر طلبًا:', 'بعد أول طلب بتذكّر. هلا:', 'لسا ما طلبت. يمكن واحد من هدول؟'], en: ['No past orders yet. Popular right now:', "I'll remember after your first order. For now:", 'Nothing ordered yet. Maybe one of these?'] },
  usualSignedOut: { he: ['כדי שאזכור את הרגיל שלכם צריך להתחבר. בינתיים:', 'אחרי התחברות אזכור מה אתם אוהבים. בינתיים:', 'התחברו ואזכור את הרגיל. בינתיים:'], ar: ['سجّل دخول عشان أتذكّر طلبك. هلا:', 'بعد تسجيل الدخول بتذكّر شو بتحب. هلا:', 'سجّل دخول وبتذكّر العادة. هلا:'], en: ['Sign in so I can remember your usual. For now:', "Sign in and I'll remember what you like. For now:", "Sign in and I'll keep your usual. For now:"] },
  surprise: { he: ['תסמכו עליי:', 'בחרתי בשבילכם:', 'נסו את זה:'], ar: ['ثق فيّ:', 'اخترتلك:', 'جرّب هاد:'], en: ['Trust me on this one:', 'I picked this for you:', 'Try this:'] },
  place: { he: ['מה שווה ב{place}:', 'הכי מוזמנים ב{place}:', 'ב{place} עכשיו:'], ar: ['أحسن اشي بـ{place}:', 'الأكثر طلبًا بـ{place}:', 'بـ{place} هلا:'], en: ['Best at {place}:', 'Most ordered at {place}:', 'At {place} now:'] },
  blocked: { he: ['לא מצאתי עכשיו משהו עם {slot}.', 'אין כרגע משהו עם {slot}.', 'כרגע אין התאמה עם {slot}.'], ar: ['ما لقيت هلا اشي مع {slot}.', 'هلا ما في اشي مع {slot}.', 'ما في اشي هلا مع {slot}.'], en: ["I couldn't find anything with {slot}.", 'Nothing right now with {slot}.', 'Nothing matches {slot} right now.'] },
  closed: { he: ['סגור עכשיו. נפתח ב־{time}.', 'נפתח ב־{time}.', 'סגור כרגע, נפתח ב־{time}.'], ar: ['مسكّر هلا، بيفتح الساعة {time}.', 'بيفتح الساعة {time}.', 'مسكّر هلا. بيفتح {time}.'], en: ['Closed now, opens at {time}.', 'Opens at {time}.', 'Closed right now, back at {time}.'] },
  closedAll: { he: ['הכול סגור כרגע. הראשון נפתח ב־{time}.', 'כרגע אין מקום פתוח. נפתח ב־{time}.', 'הכול סגור עכשיו, נפתח ב־{time}.'], ar: ['كل اشي مسكّر هلا. أول محل بيفتح {time}.', 'ما في محل فاتح هلا. بيفتح {time}.', 'كله مسكّر، بيفتح {time}.'], en: ['Everything is closed now. First opens at {time}.', 'Nothing is open right now. Opens at {time}.', 'All closed now, opening at {time}.'] },
  noMore: { he: ['זה הכול.', 'אין עוד.', 'זה מה שיש.'], ar: ['هاد كل اشي.', 'ما في كمان.', 'هاد اللي في.'], en: ["That's all.", 'No more.', "That's everything."] },
  reprompt1: { he: ['לא בטוח שהבנתי. אולי אחד מאלה?', 'הכי קרוב שמצאתי:', 'אפשר לנסות ככה:'], ar: ['مش متأكد إني فهمت. يمكن واحد من هدول؟', 'أقرب اشي لقيته:', 'جرّب هيك:'], en: ["Not sure I got that. Maybe one of these?", 'Closest I found:', 'Try one of these:'] },
  reprompt2: { he: ['במה אפשר לעזור?', 'בואו נתחיל מכאן:', 'אפשר לבחור:'], ar: ['كيف بقدر أساعد؟', 'خلينا نبلش من هون:', 'اختار:'], en: ['How can I help?', "Let's start here:", 'Pick one:'] },
  upsell: { he: ['להוסיף גם את זה?', 'הולך טוב עם זה:', 'משהו ליד?'], ar: ['بدك تضيف هاد كمان؟', 'بيزبط معه:', 'اشي جنبه؟'], en: ['Add this too?', 'Goes well with it:', 'Something on the side?'] },
  greetMorning: { he: ['בוקר טוב!', 'בוקר טוב, מה מתחשק?', 'בוקר!'], ar: ['صباح الخير!', 'صباح الخير، شو بدك؟', 'صباح النور!'], en: ['Good morning!', 'Morning! What do you feel like?', 'Morning!'] },
  greetNoon: { he: ['צהריים טובים!', 'מה לצהריים?', 'צהריים!'], ar: ['نهارك سعيد!', 'شو عالغدا؟', 'أهلا!'], en: ['Good afternoon!', "What's for lunch?", 'Hi there!'] },
  greetEvening: { he: ['ערב טוב!', 'מה לערב?', 'ערב טוב, מה מתחשק?'], ar: ['مسا الخير!', 'شو عالعشا؟', 'مسا الخير، شو بدك؟'], en: ['Good evening!', "What's for dinner?", 'Evening! Hungry?'] },
  greetNight: { he: ['עוד ערים?', 'משהו לפני השינה?', 'לילה טוב!'], ar: ['لسا صاحي؟', 'اشي قبل النوم؟', 'سهرة سعيدة!'], en: ['Still up?', 'Something before bed?', 'Late night!'] },
};

export function reply(key: ReplyKey, lang: Lang, vars: Record<string, string | number> = {}, seed = 0): string {
  const list = R[key][lang];
  const text = list[Math.abs(Math.trunc(seed)) % list.length]!;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Reprompts must differ from the one just shown. */
export function replyNot(key: ReplyKey, lang: Lang, avoid: string | undefined, seed = 0): string {
  const first = reply(key, lang, {}, seed);
  return first === avoid ? reply(key, lang, {}, seed + 1) : first;
}

export type ChipKey = 'cheaper' | 'other' | 'otherPlace' | 'deals' | 'usual' | 'noMeat' | 'drop' | 'more' | 'byBudget' | Meal;
const CHIPS: Record<ChipKey, Record<Lang, string>> = {
  cheaper: { he: 'יותר זול', ar: 'أرخص', en: 'Cheaper' },
  other: { he: 'משהו אחר', ar: 'اشي تاني', en: 'Something else' },
  otherPlace: { he: 'ממקום אחר', ar: 'من محل تاني', en: 'Another place' },
  deals: { he: 'מה במבצע?', ar: 'شو في عروض؟', en: 'Any deals?' },
  usual: { he: 'הרגיל שלי', ar: 'زي العادة', en: 'My usual' },
  noMeat: { he: 'בלי בשר', ar: 'بدون لحم', en: 'No meat' },
  drop: { he: 'לחפש בלי זה', ar: 'دوّر بدونها', en: 'Search without it' },
  more: { he: 'עוד', ar: 'كمان', en: 'More' },
  byBudget: { he: 'עד ₪50', ar: 'لحد 50 ₪', en: 'Under ₪50' },
  breakfast: { he: 'ארוחת בוקר', ar: 'فطور', en: 'Breakfast' },
  lunch: { he: 'ארוחת צהריים', ar: 'غدا', en: 'Lunch' },
  dinner: { he: 'ארוחת ערב', ar: 'عشا', en: 'Dinner' },
  late: { he: 'משהו בלילה', ar: 'اشي بالليل', en: 'Late-night bite' },
};

export function chipLabel(key: ChipKey, lang: Lang): string {
  return CHIPS[key][lang];
}

export function peopleLabel(n: number, lang: Lang): string {
  return lang === 'he' ? `ל-${n}` : lang === 'ar' ? `لـ${n}` : `For ${n}`;
}

export const MODE_LABELS: Record<FulfillmentMode, Record<Lang, string>> = {
  delivery: { he: 'משלוח', ar: 'توصيل', en: 'delivery' },
  pickup: { he: 'איסוף', ar: 'استلام', en: 'pickup' },
  dine_in: { he: 'ישיבה במקום', ar: 'جلوس بالمطعم', en: 'dine-in' },
};

export const NO_WORD: Record<Lang, string> = { he: 'בלי', ar: 'بدون', en: 'no' };
```

- [ ] **Step 4: Write `respond.ts`**

`packages/shared/src/assistant/respond.ts`:
```ts
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
import { hashUnit, mealOf, rank, type Hit } from './rank.js';
import { MODE_LABELS, NO_WORD, chipLabel, peopleLabel, reply, replyNot, type ReplyKey } from './replies.js';
import { ALL_FILTERS, placeUsable, retrieve, type Filters } from './retrieve.js';
import { TAG_LABELS } from './tags.js';
import { tokenize } from './text.js';
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
  uiLang: Lang;
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
  const upsellSkips = conv.upsellSkips + (lastAssistant?.kind === 'upsell' ? 1 : 0);
  let request = typeof input !== 'string' && input.request ? input.request : understand(typeof input === 'string' ? input : input.send ?? input.label, data.placeNames, conv.last);
  // "150" alone says nothing about the language: answer in the app's language.
  if (typeof input === 'string' && !/\p{L}/u.test(input)) request = { ...request, lang: opts.uiLang };
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

/** After an add: one "goes well with it" card, never twice in a row, never after two skips. */
export function afterAdd(conv: Conversation, added: { branchId: string; productId: string }, inCart: readonly string[], data: AssistantData): Conversation {
  const lastTurn = conv.turns.at(-1);
  if (conv.upsellSkips >= 2 || (lastTurn?.role === 'assistant' && lastTurn.kind === 'upsell')) return conv;
  const d = upsellFor(added, inCart, data);
  if (!d) return conv;
  const lang = conv.last?.request.lang ?? 'he';
  const turn: AssistantTurn = { id: `t${conv.turns.length}`, role: 'assistant', kind: 'upsell', text: reply('upsell', lang, {}, data.seed + conv.turns.length), cards: [{ kind: 'dish', branchId: d.branchId, productId: d.id }], chips: [] };
  return { ...conv, turns: [...conv.turns, turn] };
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
    const r2 = understand(alt, ctx.data.placeNames);
    if (hasSlots(r2) && retrieve(r2, ctx.data).length) return isMealRequest(r2) ? mealAnswer(r2, ctx) : pickAnswer(r2, ctx, 'dish', false);
  }
  return undefined;
}

function mealAnswer(r: Request, ctx: Ctx): Answer {
  const { data } = ctx;
  const cands = retrieve(r, data);
  if (!cands.length) return wrongKeyboard(r, ctx) ?? emptyAnswer(r, ctx);
  const baskets = buildMeals(r, data, rank(cands, r, data));
  if (!baskets.length) return blocked(r, r.budgetAgorot !== undefined ? 'budget' : 'tags', data);
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
  const place = data.places.get(r.placeBranchIds![0]!)!;
  return {
    kind: 'place',
    text: reply('place', r.lang, { place: place.name[r.lang] ?? place.name.he ?? place.name.en ?? '' }, seedOf(r, data)),
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
  const chips: Chip[] = [{ label: chipLabel(meal, lang), request: { ...emptyRequest(lang), meal } }];
  if (data.deals.length) chips.push({ label: chipLabel('deals', lang), send: chipLabel('deals', lang) });
  if (opts.signedIn && data.profile?.usuals.length) chips.push({ label: chipLabel('usual', lang), send: chipLabel('usual', lang) });
  chips.push({ label: chipLabel('byBudget', lang), request: { ...emptyRequest(lang), budgetAgorot: 5000 } });
  return chips;
}

function refineChips(r: Request, data: AssistantData, kind: 'dish' | 'meal' | 'deal'): Chip[] {
  const L = r.lang;
  const say = (label: string): Chip => ({ label, send: label });
  const chips: Chip[] = [];
  if (kind !== 'deal') chips.push(say(chipLabel('cheaper', L)));
  if (kind === 'meal') chips.push(say(peopleLabel((r.people ?? 1) + 2, L)));
  else if (kind === 'dish' && r.people === undefined) chips.push(say(peopleLabel(4, L)));
  chips.push(say(chipLabel(kind === 'dish' ? 'other' : 'otherPlace', L)));
  if (kind !== 'deal' && !r.exclude.tags.includes('meat') && !r.tags.includes('vegetarian') && !r.tags.includes('vegan')) chips.push(say(chipLabel('noMeat', L)));
  if (data.deals.length && r.shortcut !== 'deals') chips.push(say(chipLabel('deals', L)));
  return chips.slice(0, 4);
}

function noMore(r: Request, ctx: Ctx, kind: 'dish' | 'meal' | 'deal'): Answer {
  return { kind: 'none', text: reply('noMore', r.lang, {}, seedOf(r, ctx.data)), cards: [], chips: refineChips(r, ctx.data, kind), shown: NOTHING_SHOWN, understood: true };
}

const moreChip = (r: Request): Chip => ({ label: chipLabel('more', r.lang), request: { ...r, page: r.page + 1 } });
const dishCard = (h: Hit): Card => ({ kind: 'dish', branchId: h.dish.branchId, productId: h.dish.id });
const dealCard = (d: AssistantDeal): Card => ({ kind: 'deal', branchId: d.branchId, dealId: d.id });
const dealItems = (d: AssistantDeal): string[] => (d.combo ? d.combo.items.map((i) => i.productId) : d.promotion?.productIds ?? []);

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function roundRobin<T>(list: T[], key: (x: T) => string): T[] {
  const out: T[] = [];
  const rest = [...list];
  while (rest.length) {
    const seen = new Set<string>();
    for (let i = 0; i < rest.length; ) {
      const k = key(rest[i]!);
      if (seen.has(k)) {
        i++;
        continue;
      }
      seen.add(k);
      out.push(rest.splice(i, 1)[0]!);
    }
  }
  return out;
}
```

- [ ] **Step 5: Write `home.ts` and `cards.ts`**

`packages/shared/src/assistant/home.ts`:
```ts
/** The home's assistant strip: a time-of-day greeting, up to three ready picks (your usual, the best deal, a pick for now) from different places, and suggestion chips. */
import type { DishType } from '../dishIndex.js';
import { dictionaries } from '../i18n/index.js';
import { clockAt, localHour, type AssistantData } from './data.js';
import { mealOf, rank } from './rank.js';
import { chipLabel, reply, type ReplyKey } from './replies.js';
import type { Card, Chip, RespondOptions } from './respond.js';
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

  const chips: Chip[] = [{ label: chipLabel(meal, lang), request: r }];
  if (data.deals.length) chips.push({ label: chipLabel('deals', lang), send: chipLabel('deals', lang) });
  if (opts.signedIn && data.profile?.usuals.length) chips.push({ label: chipLabel('usual', lang), send: chipLabel('usual', lang) });
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
```

`packages/shared/src/assistant/cards.ts`:
```ts
/** Turns a stored card back into what the UI shows. A card whose dish, deal or place is gone resolves to null and is simply not shown. */
import type { Localized } from '../types.js';
import { dishKey, type AssistantData, type AssistantDeal, type AssistantDish, type AssistantPlace } from './data.js';
import type { MealBasket, MealLine } from './mealBuilder.js';
import type { Usual } from './profile.js';
import type { Card } from './respond.js';

export type ResolvedCard =
  | { kind: 'dish'; dish: AssistantDish; place: AssistantPlace }
  | { kind: 'meal'; basket: MealBasket; place: AssistantPlace; lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> }
  | { kind: 'deal'; deal: AssistantDeal; place: AssistantPlace; itemNames: Localized[] }
  | { kind: 'usual'; usual: Usual; place: AssistantPlace; missing: Localized[] };

export function resolveCard(card: Card, data: AssistantData): ResolvedCard | null {
  switch (card.kind) {
    case 'dish': {
      const dish = data.dishById.get(dishKey(card.branchId, card.productId));
      const place = data.places.get(card.branchId);
      return dish && place ? { kind: 'dish', dish, place } : null;
    }
    case 'meal': {
      const place = data.places.get(card.basket.branchId);
      if (!place) return null;
      const lines: Array<{ line: MealLine; name: Localized; imagePath?: string }> = [];
      for (const line of card.basket.lines) {
        if (line.comboId) {
          const combo = data.deals.find((d) => d.branchId === place.branchId && d.id === line.comboId)?.combo;
          if (!combo) return null;
          lines.push({ line, name: combo.name, ...(combo.imagePath ? { imagePath: combo.imagePath } : {}) });
        } else {
          const d = data.dishById.get(dishKey(place.branchId, line.productId));
          if (!d) return null;
          lines.push({ line, name: d.entry.name, ...(d.entry.imagePath ? { imagePath: d.entry.imagePath } : {}) });
        }
      }
      return { kind: 'meal', basket: card.basket, place, lines };
    }
    case 'deal': {
      const deal = data.deals.find((d) => d.branchId === card.branchId && d.id === card.dealId);
      const place = data.places.get(card.branchId);
      if (!deal || !place) return null;
      const ids = deal.combo ? deal.combo.items.map((i) => i.productId) : deal.promotion?.productIds ?? [];
      return { kind: 'deal', deal, place, itemNames: ids.map((id) => data.dishById.get(dishKey(place.branchId, id))?.entry.name).filter((n): n is Localized => !!n) };
    }
    case 'usual': {
      const place = data.places.get(card.usual.branchId);
      if (!place) return null;
      const missing = card.usual.lines.filter((l) => (l.comboId ? !data.deals.some((d) => d.branchId === place.branchId && d.id === l.comboId) : !data.dishById.has(dishKey(place.branchId, l.productId)))).map((l) => l.name);
      return { kind: 'usual', usual: card.usual, place, missing };
    }
  }
}
```
Add to `assistant/index.ts`:
```ts
export * from './replies.js';
export * from './respond.js';
export * from './home.js';
export * from './cards.js';
```

- [ ] **Step 6: Run the tests**

Run: `npm run test -w packages/shared -- test/assistant/respond.test.ts test/assistant/cards.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/assistant/replies.ts packages/shared/src/assistant/respond.ts packages/shared/src/assistant/home.ts packages/shared/src/assistant/cards.ts packages/shared/src/assistant/index.ts packages/shared/test/assistant/respond.test.ts packages/shared/test/assistant/cards.test.ts
git commit -m "Assistant: conversation turns, blocked/closed/reprompt answers, home picks, card resolution"
```

---

### Task 10: The golden set — what "smart" means

**Files:**
- Create: `packages/shared/test/assistant/golden.test.ts`

**Interfaces:**
- Consumes: `respond`, `EMPTY_CONVERSATION`, `tokenize` and the fixture village (Tasks 1–9).
- Produces: the regression bar. Every later change to the engine keeps this file green; new phrases from real customers are added as cases.

- [ ] **Step 1: Write the golden set**

`packages/shared/test/assistant/golden.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION, respond, tokenize, type AssistantTurn, type Card, type Conversation, type DishTag, type FulfillmentMode, type Lang, type Meal, type Shortcut, type TurnKind } from '../../src/index.js';
import { fixtureData } from './fixtures.js';

interface Case {
  say: string | string[];
  kind?: TurnKind;
  craving?: string[];
  tags?: DishTag[];
  excludeTags?: DishTag[];
  people?: number;
  budget?: number;
  budgetBelow?: number;
  maxPrice?: boolean;
  mode?: FulfillmentMode;
  places?: string[];
  meal?: Meal;
  shortcut?: Shortcut;
  cheap?: boolean;
  page?: number;
  excludeDishes?: boolean;
  lang?: Lang;
  includes?: string;
  first?: string;
  excludes?: string[];
  branch?: string;
  allTagged?: DishTag;
  firstTagIn?: DishTag[];
  cards?: number;
}

const CASES: Case[] = [
  // Cravings in four languages
  { say: 'פיצה', kind: 'dish', craving: ['פיצה'], includes: 'm-margherita' },
  { say: 'בא לי פיצה', kind: 'dish', craving: ['פיצה'] },
  { say: 'pizza', kind: 'dish', craving: ['pizza'], includes: 'm-margherita' },
  { say: 'بيتزا', kind: 'dish', includes: 'm-margherita' },
  { say: 'shawrma', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'שווארמה', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'شاورما', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'shawarma', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'סושי', kind: 'dish', includes: 's-salmon-roll' },
  { say: 'سوشي', kind: 'dish', includes: 's-salmon-roll' },
  { say: 'המבורגר', kind: 'dish', includes: 'b-classic' },
  { say: 'burger', kind: 'dish', includes: 'b-classic' },
  { say: 'برغر', kind: 'dish', includes: 'b-classic' },
  { say: 'חומוס', kind: 'dish', includes: 'a-hummus' },
  { say: 'hummus', kind: 'dish', includes: 'a-hummus' },
  { say: 'קפוצינו', kind: 'dish', includes: 'bl-cappuccino' },
  { say: 'כנאפה', kind: 'dish', includes: 'a-knafeh' },
  { say: 'knafeh', kind: 'dish', includes: 'a-knafeh' },
  { say: 'كنافة', kind: 'dish', includes: 'a-knafeh' },
  { say: 'וופל', kind: 'dish', includes: 'dl-waffle' },
  { say: 'פלאפל', kind: 'dish', includes: 'a-falafel' },
  { say: 'falafel', kind: 'dish', includes: 'a-falafel' },
  { say: 'فلافل', kind: 'dish', includes: 'a-falafel' },
  { say: 'מנאקיש', kind: 'dish', includes: 'md-zaatar' },
  { say: 'manakish', kind: 'dish', includes: 'md-zaatar' },
  { say: 'مناقيش', kind: 'dish', includes: 'md-zaatar' },
  { say: 'קרואסון', kind: 'dish', includes: 'bl-croissant' },
  { say: 'croissant', kind: 'dish', includes: 'bl-croissant' },
  { say: 'שקשוקה', kind: 'dish', includes: 'bl-shakshuka' },
  { say: 'אייס קפה', kind: 'dish', includes: 'bl-iced-coffee' },
  { say: 'iced coffee', kind: 'dish', includes: 'bl-iced-coffee' },
  { say: 'נודלס', kind: 'dish', includes: 's-noodles' },
  { say: 'noodles', kind: 'dish', includes: 's-noodles' },
  { say: 'עוגת שוקולד', kind: 'dish', includes: 'dl-chocolate-cake' },
  { say: 'chocolate cake', kind: 'dish', includes: 'dl-chocolate-cake' },
  { say: 'סלט', kind: 'dish', includes: 'bl-greek-salad' },
  { say: 'salad', kind: 'dish', includes: 'bl-greek-salad' },
  { say: 'bdi pizza', kind: 'dish', craving: ['pizza'] },

  // Taste and diet wishes
  { say: 'משהו חריף', kind: 'dish', tags: ['spicy'], allTagged: 'spicy' },
  { say: 'something spicy', kind: 'dish', tags: ['spicy'], allTagged: 'spicy' },
  { say: 'اشي حار', kind: 'dish', tags: ['spicy'], allTagged: 'spicy' },
  { say: 'shi 7ar', kind: 'dish', tags: ['spicy'], lang: 'ar' },
  { say: 'pizza 7ara', kind: 'dish', tags: ['spicy'], includes: 'm-spicy-family' },
  { say: 'צמחוני', kind: 'dish', tags: ['vegetarian'], allTagged: 'vegetarian' },
  { say: 'vegan', kind: 'dish', tags: ['vegan'], allTagged: 'vegan' },
  { say: 'טבעוני', kind: 'dish', tags: ['vegan'], allTagged: 'vegan' },
  { say: 'نباتي', kind: 'dish', tags: ['vegetarian'], allTagged: 'vegetarian' },
  { say: 'ללא גלוטן', kind: 'dish', tags: ['gluten_free'], includes: 'dl-gf-cake' },
  { say: 'gluten free', kind: 'dish', tags: ['gluten_free'], includes: 'dl-gf-cake' },
  { say: 'לילדים', kind: 'dish', tags: ['kids'], allTagged: 'kids' },
  { say: 'for kids', kind: 'dish', tags: ['kids'], allTagged: 'kids' },
  { say: 'للاولاد', kind: 'dish', tags: ['kids'], allTagged: 'kids' },
  { say: 'משהו מתוק', kind: 'dish', tags: ['sweet'], allTagged: 'sweet' },
  { say: 'something sweet', kind: 'dish', tags: ['sweet'], allTagged: 'sweet' },
  { say: 'اشي حلو', kind: 'dish', tags: ['sweet'], allTagged: 'sweet' },
  { say: 'קינוח', kind: 'dish', tags: ['sweet'], allTagged: 'sweet' },
  { say: 'בריא', kind: 'dish', tags: ['healthy'], includes: 'bl-greek-salad' },
  { say: 'שתייה קרה', kind: 'dish', tags: ['cold_drink'], allTagged: 'cold_drink' },
  { say: 'cold drink', kind: 'dish', tags: ['cold_drink'], allTagged: 'cold_drink' },
  { say: 'שתייה חמה', kind: 'dish', tags: ['hot_drink'], allTagged: 'hot_drink' },
  { say: 'ארוחת ילדים', kind: 'dish', tags: ['kids'], includes: 'b-kids-meal' },
  { say: 'kids meal', kind: 'dish', tags: ['kids'], includes: 'b-kids-meal' },
  { say: 'בורגר טבעוני', kind: 'dish', tags: ['vegan'], includes: 'b-vegan-burger' },
  { say: 'vegan burger', kind: 'dish', tags: ['vegan'], includes: 'b-vegan-burger' },

  // Exclusions
  { say: 'פיצה בלי בשר', kind: 'dish', craving: ['פיצה'], excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: 'pizza no meat', kind: 'dish', excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: 'شاورما بدون لحم', kind: 'dish', excludeTags: ['meat'], includes: 'a-shawarma-chicken', excludes: ['a-shawarma-spicy', 'a-platter'] },
  { say: 'לא חריף', kind: 'dish', excludeTags: ['spicy'] },
  { say: 'not spicy shawarma', kind: 'dish', excludeTags: ['spicy'], excludes: ['a-shawarma-spicy'] },
  { say: 'בלי גבינה', kind: 'dish', excludeTags: ['cheese'] },
  { say: 'בלי בצל', kind: 'dish', excludes: ['b-onion-rings'] },

  // People and budget
  { say: 'ל-4', kind: 'meal', people: 4 },
  { say: 'ל4', kind: 'meal', people: 4 },
  { say: 'לארבעה', kind: 'meal', people: 4 },
  { say: 'for 4', kind: 'meal', people: 4 },
  { say: 'for four people', kind: 'meal', people: 4 },
  { say: 'لأربعة', kind: 'meal', people: 4 },
  { say: 'لـ٤', kind: 'meal', people: 4 },
  { say: '4 אנשים', kind: 'meal', people: 4 },
  { say: 'לשניים', kind: 'meal', people: 2 },
  { say: 'זוג', kind: 'meal', people: 2 },
  { say: 'אני ואשתי', kind: 'meal', people: 2 },
  { say: 'انا وصاحبي', kind: 'meal', people: 2 },
  { say: 'למשפחה', kind: 'meal', people: 4 },
  { say: 'for the family', kind: 'meal', people: 4 },
  { say: 'עד 50', kind: 'meal', budget: 5000 },
  { say: 'עד ₪50', kind: 'meal', budget: 5000 },
  { say: '50 ש"ח', kind: 'meal', budget: 5000 },
  { say: 'under 60', kind: 'meal', budget: 6000 },
  { say: 'up to 80 shekels', kind: 'meal', budget: 8000 },
  { say: 'حتى 70 شيكل', kind: 'meal', budget: 7000 },
  { say: '150₪', kind: 'meal', budget: 15000 },
  { say: 'ל-4 עד 150', kind: 'meal', people: 4, budget: 15000 },
  { say: 'משהו חריף ל-4 עד 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, includes: 'm-spicy-family' },
  { say: 'something spicy for 4 under 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, includes: 'm-spicy-family' },
  { say: 'اشي حار لأربعة بحدود 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, includes: 'm-spicy-family' },
  { say: 'פיצה ל-4', kind: 'meal', people: 4, branch: 'morano' },
  { say: 'pizza for 2', kind: 'meal', people: 2, branch: 'morano', includes: 'm-combo-pair' },
  { say: 'פיצה עד 50', kind: 'meal', budget: 5000, includes: 'm-margherita' },
  { say: 'שווארמה ל-3 במשלוח', kind: 'meal', people: 3, mode: 'delivery', branch: 'abu' },
  { say: 'ל-6 עד 30', kind: 'blocked', people: 6, budget: 3000 },

  // Cheap
  { say: 'זול', kind: 'dish', cheap: true },
  { say: 'הכי זול', kind: 'dish', cheap: true },
  { say: 'cheapest pizza', kind: 'dish', cheap: true, first: 'm-margherita' },
  { say: 'ارخص اشي', kind: 'dish', cheap: true },

  // Mode
  { say: 'משלוח פיצה', kind: 'dish', mode: 'delivery', craving: ['פיצה'] },
  { say: 'pizza delivery', kind: 'dish', mode: 'delivery' },
  { say: 'סושי באיסוף', kind: 'dish', mode: 'pickup', includes: 's-salmon-roll' },
  { say: 'توصيل شاورما', kind: 'dish', mode: 'delivery', includes: 'a-shawarma-chicken' },
  { say: 'וופל באיסוף', kind: 'blocked', mode: 'pickup' },

  // Places
  { say: 'ממורנו', kind: 'place', places: ['morano'] },
  { say: 'מורנו', kind: 'place', places: ['morano'] },
  { say: 'something from morano', kind: 'place', places: ['morano'] },
  { say: 'من مورانو', kind: 'place', places: ['morano'] },
  { say: 'פיצה ממורנו', kind: 'dish', places: ['morano'], craving: ['פיצה'] },
  { say: 'אבו סלים', kind: 'place', places: ['abu'] },
  { say: 'sumo', kind: 'place', places: ['sumo'] },
  { say: 'ابو سليم شاورما', kind: 'dish', places: ['abu'], includes: 'a-shawarma-chicken' },
  { say: 'מבאגט פארס', kind: 'closed' },

  // Shortcuts
  { say: 'הרגיל שלי', kind: 'usual', shortcut: 'usual', includes: 'm-margherita' },
  { say: 'my usual', kind: 'usual', shortcut: 'usual' },
  { say: 'زي العادة', kind: 'usual', shortcut: 'usual' },
  { say: 'כמו פעם שעברה', kind: 'usual', shortcut: 'usual' },
  { say: 'תפתיע אותי', kind: 'surprise', shortcut: 'surprise', cards: 1 },
  { say: 'surprise me', kind: 'surprise', shortcut: 'surprise', cards: 1 },
  { say: 'فاجئني', kind: 'surprise', shortcut: 'surprise' },
  { say: 'לא יודע', kind: 'surprise', shortcut: 'surprise' },
  { say: 'מה במבצע?', kind: 'deal', shortcut: 'deals' },
  { say: 'deals', kind: 'deal', shortcut: 'deals' },
  { say: 'شو في عروض', kind: 'deal', shortcut: 'deals' },
  { say: 'קומבו', kind: 'deal', shortcut: 'deals' },
  { say: 'מבצע על פיצה', kind: 'deal', shortcut: 'deals', first: 'm-combo-pair' },
  { say: 'pasta deal', kind: 'deal', shortcut: 'deals', includes: 'm-promo-pasta' },

  // Time of day
  { say: 'ארוחת בוקר', kind: 'dish', meal: 'breakfast', firstTagIn: ['breakfast', 'hot_drink'] },
  { say: 'breakfast', kind: 'dish', meal: 'breakfast', firstTagIn: ['breakfast', 'hot_drink'] },
  { say: 'فطور', kind: 'dish', meal: 'breakfast', firstTagIn: ['breakfast', 'hot_drink'] },
  { say: 'משהו בלילה', kind: 'dish', meal: 'late' },
  { say: 'dinner', kind: 'dish', meal: 'dinner' },
  { say: 'ארוחת ערב ל-2', kind: 'meal', meal: 'dinner', people: 2 },

  // Refinements
  { say: ['משהו חריף', 'יותר זול'], kind: 'dish', tags: ['spicy'], maxPrice: true },
  { say: ['פיצה', 'משהו אחר'], kind: 'dish', craving: ['פיצה'], excludeDishes: true },
  { say: ['פיצה', 'עוד'], craving: ['פיצה'], page: 1 },
  { say: ['ל-4', 'ל-6 במקום'], kind: 'meal', people: 6 },
  { say: ['שווארמה', 'ממקום אחר'], kind: 'blocked' },
  { say: ['פיצה', 'בלי בשר'], kind: 'dish', craving: ['פיצה'], excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: ['משהו חריף', 'לא חריף'], kind: 'dish', tags: [], excludeTags: ['spicy'] },
  { say: ['ל-4 עד 150', 'יותר זול'], kind: 'meal', people: 4, budgetBelow: 15000 },
  { say: ['סושי', 'במשלוח'], kind: 'blocked', mode: 'delivery' },
  { say: ['פיצה', 'ל-4'], kind: 'meal', craving: ['פיצה'], people: 4, branch: 'morano' },

  // Misunderstandings and closed places
  { say: 'asdkjh', kind: 'reprompt' },
  { say: ['asdkjh', 'qwpoeiru'], kind: 'reprompt', cards: 0 },
  { say: 'hello', kind: 'reprompt' },
  { say: 'גכעבהט', kind: 'reprompt' },
  { say: 'auutrnv', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'באגט', kind: 'closed' },
  { say: 'baguette schnitzel', kind: 'closed' },
];

const data = fixtureData();
const opts = { signedIn: true, uiLang: 'he' as const };

function cardIds(c: Card): string[] {
  switch (c.kind) {
    case 'dish':
      return [c.productId];
    case 'meal':
      return c.basket.lines.map((l) => l.productId);
    case 'deal':
      return [c.dealId];
    case 'usual':
      return c.usual.lines.map((l) => l.productId);
  }
}

describe('golden set', () => {
  for (const c of CASES) {
    const title = [c.say].flat().join(' → ');
    it(title, () => {
      let conv: Conversation = EMPTY_CONVERSATION;
      for (const s of [c.say].flat()) conv = respond(conv, s, data, opts);
      const turn = conv.turns.at(-1) as AssistantTurn;
      const r = conv.last?.request;
      const ids = turn.cards.flatMap(cardIds);
      if (c.kind) expect(turn.kind, `kind for "${title}": ${turn.text}`).toBe(c.kind);
      if (c.craving) expect(r?.craving).toEqual(c.craving.flatMap((w) => tokenize(w)));
      if (c.tags) expect(r?.tags).toEqual(c.tags);
      if (c.excludeTags) expect(r?.exclude.tags).toEqual(expect.arrayContaining(c.excludeTags));
      if (c.people !== undefined) expect(r?.people).toBe(c.people);
      if (c.budget !== undefined) expect(r?.budgetAgorot).toBe(c.budget);
      if (c.budgetBelow !== undefined) expect(r?.budgetAgorot).toBeLessThan(c.budgetBelow);
      if (c.maxPrice) expect(r?.maxPriceAgorot).toBeGreaterThan(0);
      if (c.mode) expect(r?.mode).toBe(c.mode);
      if (c.places) expect(r?.placeBranchIds).toEqual(c.places);
      if (c.meal) expect(r?.meal).toBe(c.meal);
      if (c.shortcut) expect(r?.shortcut).toBe(c.shortcut);
      if (c.cheap) expect(r?.cheap).toBe(true);
      if (c.page !== undefined) expect(r?.page).toBe(c.page);
      if (c.excludeDishes) expect(r?.exclude.dishIds.length).toBeGreaterThan(0);
      if (c.lang) expect(r?.lang).toBe(c.lang);
      if (c.includes) expect(ids).toContain(c.includes);
      if (c.first) expect(ids[0]).toBe(c.first);
      for (const x of c.excludes ?? []) expect(ids).not.toContain(x);
      if (c.branch) expect(turn.cards[0]).toMatchObject({ kind: 'meal', basket: { branchId: c.branch } });
      if (c.cards !== undefined) expect(turn.cards).toHaveLength(c.cards);
      if (c.allTagged) for (const card of turn.cards) if (card.kind === 'dish') expect(data.dishById.get(`${card.branchId}/${card.productId}`)!.entry.tags).toContain(c.allTagged);
      if (c.firstTagIn) {
        const first = turn.cards[0]!;
        expect(first.kind).toBe('dish');
        const tags = data.dishById.get(`${(first as { branchId: string }).branchId}/${(first as { productId: string }).productId}`)!.entry.tags ?? [];
        expect(tags.some((t) => c.firstTagIn!.includes(t))).toBe(true);
      }
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npm run test -w packages/shared -- test/assistant/golden.test.ts`
Expected: PASS for every case. When a case fails, the assertion message shows the reply text and kind. Fix the engine (vocabulary in `vocab.ts`/`tags.ts`, step order in `understand.ts`, or the answer logic in `respond.ts`) so the case passes. Never delete or weaken a case to make it pass; if a case is genuinely wrong (the expectation contradicts the spec), change it and say why in the commit message.

- [ ] **Step 3: Run the whole shared suite**

Run: `npm run test -w packages/shared` → all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/test/assistant/golden.test.ts packages/shared/src/assistant
git commit -m "Assistant: golden set of 150+ real requests in Hebrew, Arabic, English and Arabizi"
```

---

### Task 11: Auto-tag backfill with a review page

**Files:**
- Create: `scripts/src/auto-tag.ts`
- Test: run against the emulator (seeded), then a dry run against qareeb-dev.

**Interfaces:**
- Consumes: `autoTags`, `isMachineOwned`, `toDishIndexEntry` (Tasks 1–2), the projection rules (Tasks 3–4).
- Produces: `--dry` → `docs/mockups/auto-tag-review/index.html` (gitignored) + a summary in the terminal; `--apply` → writes machine-owned `tags`/`serves`/`dishType` + `autoFields` on private products, their public projection and the branch dish index.

- [ ] **Step 1: Write the script**

`scripts/src/auto-tag.ts`:
```ts
/**
 * Fills tags, serves and dish type on every restaurant dish from its texts (autoTags), only where the
 * machine still owns the field (isMachineOwned) — an owner's choice is never touched.
 *   npx tsx scripts/src/auto-tag.ts --dry     -> review page docs/mockups/auto-tag-review/index.html
 *   npx tsx scripts/src/auto-tag.ts --apply   -> writes (only after the owner approved the page)
 * Uses Application Default Credentials against qareeb-dev, or the emulator when FIRESTORE_EMULATOR_HOST is set.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { autoTags, isMachineOwned, toDishIndexEntry, type AutoFields, type Branch, type Business, type Category, type Product } from '@qareeb/shared';

const APPLY = process.argv.includes('--apply');
initializeApp({ projectId: 'qareeb-dev' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

interface Row { business: string; branchId: string; product: Product; next: AutoFields; changed: Array<keyof AutoFields> }
const visible = (b: Business, br: Branch) => b.approval === 'approved' && br.approval === 'approved';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

async function main() {
  const rows: Row[] = [];
  const businesses = await db.collection('businesses').where('type', '==', 'restaurant').get();
  for (const bDoc of businesses.docs) {
    const business = bDoc.data() as Business;
    const branches = await bDoc.ref.collection('branches').get();
    for (const brDoc of branches.docs) {
      const [cats, prods] = await Promise.all([brDoc.ref.collection('categories').get(), brDoc.ref.collection('products').get()]);
      const catName = new Map(cats.docs.map((d) => [d.id, (d.data() as Category).name]));
      for (const d of prods.docs) {
        const p = d.data() as Product;
        if (p.archived) continue;
        const s = autoTags({ name: p.name, description: p.description, categoryName: catName.get(p.categoryId) });
        const next: AutoFields = {};
        const changed: Array<keyof AutoFields> = [];
        for (const k of ['tags', 'serves', 'dishType'] as const) {
          if (!isMachineOwned(p, k) || s[k] === undefined) continue;
          (next as Record<string, unknown>)[k] = s[k];
          if (!same(p[k], s[k])) changed.push(k);
        }
        if (changed.length) rows.push({ business: business.name.he ?? business.name.en ?? bDoc.id, branchId: brDoc.id, product: p, next, changed });
      }
      if (APPLY) await applyBranch(business, brDoc.data() as Branch, rows.filter((r) => r.branchId === brDoc.id));
    }
  }
  console.log(`${rows.length} dishes to update (${APPLY ? 'applied' : 'dry run'})`);
  if (!APPLY) writeReview(rows);
}

async function applyBranch(business: Business, branch: Branch, rows: Row[]) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = db.batch();
    for (const r of rows.slice(i, i + 200)) {
      const p = r.product;
      const autoFields: AutoFields = { ...(p.autoFields ?? {}), ...r.next };
      const updated: Product = { ...p, ...r.next, autoFields };
      const priv = db.doc(`businesses/${p.businessId}/branches/${p.branchId}/products/${p.id}`);
      batch.set(priv, { ...r.next, autoFields }, { merge: true });
      if (visible(business, branch)) {
        batch.set(db.doc(`publicBranches/${p.branchId}/products/${p.id}`), { ...r.next, autoFields }, { merge: true });
        batch.set(db.doc(`publicBranches/${p.branchId}/index/dishes`), { dishes: { [p.id]: toDishIndexEntry(updated) } }, { mergeFields: [new FieldPath('dishes', p.id)] });
      }
    }
    await batch.commit();
  }
}

function writeReview(rows: Row[]) {
  const img = (path?: string) => (path ? `<img loading="lazy" src="https://qareeb-dev.web.app/img/${path.split('/').map(encodeURIComponent).join('/')}" alt="">` : '<span class="noimg"></span>');
  const body = rows.map((r) => `<tr data-tags="${esc((r.next.tags ?? []).join(' '))}"><td>${img(r.product.imagePath)}</td><td><b>${esc(r.product.name.he ?? r.product.name.ar ?? r.product.name.en ?? '')}</b><br><small>${esc(r.business)}</small></td><td>${esc(r.next.dishType ?? r.product.dishType ?? '—')}</td><td>${r.next.serves ?? r.product.serves ?? 1}</td><td>${(r.next.tags ?? []).map((t) => `<span class="tag">${t}</span>`).join(' ')}</td><td>${r.changed.join(', ')}</td></tr>`).join('\n');
  const html = `<title>Auto-tag review</title><style>
body{font:14px system-ui,sans-serif;margin:0;padding:16px;background:#faf8f3;color:#1d2a22}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:start;vertical-align:middle}img,.noimg{width:64px;height:64px;object-fit:cover;border-radius:10px;background:#e8efe9;display:block}.tag{display:inline-block;background:#e3efe6;border-radius:999px;padding:2px 8px;margin:2px}#f{margin-bottom:12px;padding:8px;width:min(400px,100%)}
</style><h1>Auto-tag review — ${rows.length} dishes</h1><input id="f" placeholder="filter by tag (e.g. spicy)"><div style="overflow-x:auto"><table><thead><tr><th></th><th>Dish</th><th>Type</th><th>Serves</th><th>Tags</th><th>Changes</th></tr></thead><tbody>${body}</tbody></table></div>
<script>document.getElementById('f').addEventListener('input',e=>{const q=e.target.value.trim();for(const tr of document.querySelectorAll('tbody tr'))tr.hidden=q&&!tr.dataset.tags.includes(q)})</script>`;
  mkdirSync('docs/mockups/auto-tag-review', { recursive: true });
  writeFileSync('docs/mockups/auto-tag-review/index.html', html);
  console.log('Review page: docs/mockups/auto-tag-review/index.html');
}

await main();
```

- [ ] **Step 2: Run it against the seeded emulator**

Run (emulators running, seeded): `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/src/auto-tag.ts --dry`
Expected: "N dishes to update (dry run)" and the review page path. Open the page and check the seed dishes look right (shawarma/falafel/fries/cola/knafeh types, cola is `cold_drink`).
Then: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/src/auto-tag.ts --apply`, then the dry run again → expected "0 dishes to update".

- [ ] **Step 3: Dry run on qareeb-dev and hand the page to the user**

Run: `npx tsx scripts/src/auto-tag.ts --dry` (ADC, read-only).
Publish `docs/mockups/auto-tag-review/index.html` as an artifact for the user to review. **Do not run `--apply` against qareeb-dev until the user says so** (Task 16).

- [ ] **Step 4: Commit**

```bash
git add scripts/src/auto-tag.ts
git commit -m "Assistant: auto-tag backfill script with a review page (owner values untouched)"
```

---

### Task 12: Web data hook and quick add for the assistant

**Files:**
- Modify: `apps/web/src/customer/dishIndex.ts` (generic `useBranchIndexDocs`)
- Create: `apps/web/src/customer/assistant/useAssistantData.ts`
- Create: `apps/web/src/customer/assistant/useQuickAdd.tsx`
- Create: `apps/web/src/customer/assistant/conversation.ts`

**Interfaces:**
- Consumes: shared `prepareDishes`, `buildAssistantData`, `Usual`, `MealLine`, `Conversation`, `EMPTY_CONVERSATION`; web `useDiscovery`, `useNow`, `useCollection`, `useAuth`, `cartStore`, `addLine`, `cartBelongsTo`, `ProductSheet`, `ComboSheet`, `ConfirmDialog`, `priceLine`, `availableFulfillmentModes`, `evaluateOpen`.
- Produces:
```ts
useBranchIndexDocs<T>(branchIds: string[], docId: 'dishes' | 'deals' | 'pairs'): { docs: Map<string, T>; loading: boolean }
useAssistantData(cityId: string): { data: AssistantData; branches: Map<string, PublicBranch>; loading: boolean; signedIn: boolean }
useQuickAdd(cityId: string): { busy: string | null; addItems(branch: PublicBranch, items: Array<{ productId: string; comboId?: string; qty: number }>): Promise<void>; addUsual(branch: PublicBranch, usual: Usual): Promise<void>; layer: ReactNode }
loadConversation(): Conversation; saveConversation(c: Conversation): void
```

- [ ] **Step 1: Generic index hook**

Replace the body of `apps/web/src/customer/dishIndex.ts` with:
```ts
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import type { DishIndexDoc } from '@qareeb/shared';
import { db } from '@/lib/firebase';

/**
 * Live per-branch index documents (`publicBranches/{id}/index/{dishes|deals|pairs}`): one document per
 * place, so the assistant costs one read per place, not one per dish. A missing or unreadable document
 * just leaves that place out.
 */
export function useBranchIndexDocs<T>(branchIds: string[], docId: 'dishes' | 'deals' | 'pairs'): { docs: Map<string, T>; loading: boolean } {
  const key = [...branchIds].sort().join(',');
  const [state, setState] = useState<{ key: string; docs: Record<string, T | null> }>({ key: '', docs: {} });
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const unsubs = ids.map((id) =>
      onSnapshot(
        doc(db, `publicBranches/${id}/index/${docId}`),
        (snap) => setState((s) => ({ key, docs: { ...(s.key === key ? s.docs : {}), [id]: snap.exists() ? (snap.data() as T) : null } })),
        () => setState((s) => ({ key, docs: { ...(s.key === key ? s.docs : {}), [id]: null } })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [key, docId]);
  return useMemo(() => {
    const ids = key ? key.split(',') : [];
    const docs = state.key === key ? state.docs : {};
    const out = new Map<string, T>();
    for (const id of ids) {
      const d = docs[id];
      if (d) out.set(id, d);
    }
    return { docs: out, loading: ids.some((id) => !(id in docs)) };
  }, [state, key]);
}

export function useDishIndexes(branchIds: string[]): { indexes: Map<string, DishIndexDoc>; loading: boolean } {
  const r = useBranchIndexDocs<DishIndexDoc>(branchIds, 'dishes');
  return { indexes: r.docs, loading: r.loading };
}
```

- [ ] **Step 2: `useAssistantData`**

`apps/web/src/customer/assistant/useAssistantData.ts`:
```ts
import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import { availableFulfillmentModes, buildAssistantData, evaluateOpen, prepareDishes, type AssistantData, type AssistantPlace, type DealsIndexDoc, type DishIndexDoc, type Order, type PairsIndexDoc } from '@qareeb/shared';
import { useAuth } from '@/lib/auth';
import { cartStore } from '@/lib/cart';
import { useCollection } from '@/lib/queries';
import { useBranchIndexDocs } from '../dishIndex';
import { useDiscovery, useNow, type PublicBranch } from '../hooks';

/** Everything the assistant reasons over for the chosen town: restaurants, their dish/deal/pair indexes, the clock, the cart and the customer's own recent orders. */
export function useAssistantData(cityId: string): { data: AssistantData; branches: Map<string, PublicBranch>; loading: boolean; signedIn: boolean } {
  const restaurants = useDiscovery(cityId, 'restaurant');
  const now = useNow();
  const ids = useMemo(() => restaurants.data.map((b) => b.id), [restaurants.data]);
  const dishes = useBranchIndexDocs<DishIndexDoc>(ids, 'dishes');
  const deals = useBranchIndexDocs<DealsIndexDoc>(ids, 'deals');
  const pairs = useBranchIndexDocs<PairsIndexDoc>(ids, 'pairs');
  const { user } = useAuth();
  const orders = useCollection<Order>(user ? 'orders' : null, [where('customer.uid', '==', user?.uid ?? '_'), orderBy('placedAt', 'desc'), limit(50)], [user?.uid]);
  const cart = cartStore.use();
  // Search texts are folded once per index snapshot; open/closed and time follow the clock.
  const prepared = useMemo(() => prepareDishes(restaurants.data.map((b) => ({ branchId: b.id, name: b.businessName })), dishes.docs), [restaurants.data, dishes.docs]);
  const branches = useMemo(() => new Map(restaurants.data.map((b) => [b.id, b])), [restaurants.data]);
  const data = useMemo(() => {
    const places: AssistantPlace[] = restaurants.data.map((b) => {
      const s = evaluateOpen(now, b.hours, b.hoursOverrides ?? []);
      return { branchId: b.id, businessId: b.businessId, name: b.businessName, branchName: b.name, open: s.open && !b.ordersPaused, ...(s.open || s.opensInMin === undefined ? {} : { opensInMin: s.opensInMin }), modes: availableFulfillmentModes('restaurant', b, cityId) };
    });
    return buildAssistantData({ now, places, dishes: prepared, deals: deals.docs, pairs: pairs.docs, orders: orders.data, ...(cart.cart ? { cartBranchId: cart.cart.branchId } : {}) });
  }, [restaurants.data, now, prepared, deals.docs, pairs.docs, orders.data, cart.cart, cityId]);
  return { data, branches, loading: restaurants.loading || dishes.loading, signedIn: !!user };
}
```

- [ ] **Step 3: Conversation persistence**

`apps/web/src/customer/assistant/conversation.ts`:
```ts
import { EMPTY_CONVERSATION, type Conversation } from '@qareeb/shared';

const KEY = 'qareeb.assistant.v1';

/** The chat survives back/forward within the tab; a new tab starts fresh. Cards are resolved against live data, so stale ones simply disappear. */
export function loadConversation(): Conversation {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Conversation) : EMPTY_CONVERSATION;
  } catch {
    return EMPTY_CONVERSATION;
  }
}

export function saveConversation(c: Conversation): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private mode: the chat just won't survive navigation */
  }
}
```

- [ ] **Step 4: Quick add (single dish, a whole meal, a usual)**

`apps/web/src/customer/assistant/useQuickAdd.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { availableFulfillmentModes, makeId, priceLine, type CartLine, type CartModifierSelection, type Combo, type FulfillmentMode, type Localized, type Product, type Usual } from '@qareeb/shared';
import { db } from '@/lib/firebase';
import { addLine, cartBelongsTo, cartStore } from '@/lib/cart';
import { useI18n, useT } from '@/lib/i18n';
import { ConfirmDialog, toast } from '@/design/components';
import type { PublicBranch, PublicBusiness } from '../hooks';
import type { PublicProduct } from '../BusinessPage';
import { ProductSheet } from '../ProductSheet';
import { ComboSheet } from '../ComboSheet';

type Sheet =
  | { kind: 'product'; product: Product; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode; editLine?: CartLine }
  | { kind: 'combo'; combo: Combo; products: Product[]; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode };
interface Item { productId: string; comboId?: string; qty: number }

/**
 * Adds what the assistant offers. Lines with nothing to choose go straight in; a size, a required
 * option or a combo opens its sheet, one after another. A cart from another place is replaced only
 * after one confirmation, before anything is added.
 */
export function useQuickAdd(cityId: string): { busy: string | null; addItems: (branch: PublicBranch, items: Item[]) => Promise<void>; addUsual: (branch: PublicBranch, usual: Usual) => Promise<void>; layer: ReactNode } {
  const t = useT();
  const { L } = useI18n();
  const cart = cartStore.use();
  const [busy, setBusy] = useState<string | null>(null);
  const [queue, setQueue] = useState<Sheet[]>([]);
  const [replace, setReplace] = useState<{ run: () => void } | null>(null);

  const loadProduct = async (branchId: string, id: string) => {
    const s = await getDoc(doc(db, `publicBranches/${branchId}/products/${id}`));
    return s.exists() ? ({ ...(s.data() as PublicProduct), id: s.id } as Product) : null;
  };
  const loadBusiness = async (businessId: string) => {
    const s = await getDoc(doc(db, `publicBusinesses/${businessId}`));
    if (!s.exists()) throw new Error('missing business');
    return { ...(s.data() as PublicBusiness), id: s.id };
  };
  const modeFor = (business: PublicBusiness, branch: PublicBranch): FulfillmentMode => {
    const modes = availableFulfillmentModes(business.type, branch, cityId);
    return cart.cart && cart.cart.branchId === branch.id && modes.includes(cart.cart.mode) ? cart.cart.mode : modes[0] ?? 'pickup';
  };
  const commit = (business: PublicBusiness, branch: PublicBranch, mode: FulfillmentMode, product: Product, line: CartLine, modifierNames: Localized[] = []) => {
    addLine({
      businessId: business.id, branchId: branch.id, mode, cityId,
      meta: { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale },
      line,
      lineMeta: { name: product.name, modifierNames, unitLabel: product.unitLabel, pricingMode: product.pricingMode, imagePath: product.imagePath, weightStepGrams: product.weightStepGrams, minWeightGrams: product.minWeightGrams, quantityStep: product.quantityStep, minQuantity: product.minQuantity },
    });
    try {
      sessionStorage.removeItem('qareeb.cart.quotedTotal');
      window.dispatchEvent(new Event('qareeb:cart-quote'));
    } catch {
      /* ignore */
    }
  };
  /** Runs `work` now, or after confirming that another place's cart will be replaced. */
  const guard = (business: PublicBusiness, branch: PublicBranch, work: () => void) => {
    if (cart.cart && !cartBelongsTo(cart, business.id, branch.id)) setReplace({ run: () => { setReplace(null); work(); } });
    else work();
  };

  const addItems = async (branch: PublicBranch, items: Item[]) => {
    setBusy(branch.id);
    try {
      const business = await loadBusiness(branch.businessId);
      const mode = modeFor(business, branch);
      const simple: Array<{ product: Product; line: CartLine }> = [];
      const sheets: Sheet[] = [];
      for (const it of items) {
        if (it.comboId) {
          const s = await getDoc(doc(db, `publicBranches/${branch.id}/combos/${it.comboId}`));
          if (!s.exists()) throw new Error('missing combo');
          const combo = { ...(s.data() as Combo), id: s.id };
          const products = (await Promise.all(combo.items.map((x) => loadProduct(branch.id, x.productId)))).filter((p): p is Product => !!p);
          for (let i = 0; i < it.qty; i++) sheets.push({ kind: 'combo', combo, products, business, branch, mode });
          continue;
        }
        const product = await loadProduct(branch.id, it.productId);
        if (!product || !product.available) throw new Error('unavailable');
        const needsChoice = product.variants.length > 0 || product.pricingMode === 'weight' || product.modifierGroups.some((g) => g.required || g.minSelect > 0);
        const line: CartLine = { lineId: makeId(12), productId: product.id, modifiers: [], quantity: Math.max(it.qty, product.minQuantity || 1), expectedUnitPriceAgorot: product.priceAgorot };
        if (needsChoice || priceLine(product, line).problem) for (let i = 0; i < it.qty; i++) sheets.push({ kind: 'product', product, business, branch, mode });
        else simple.push({ product, line });
      }
      guard(business, branch, () => {
        for (const s of simple) commit(business, branch, mode, s.product, s.line);
        setQueue(sheets);
      });
    } catch {
      toast(t('common.errorGeneric'), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const addUsual = async (branch: PublicBranch, usual: Usual) => {
    setBusy(branch.id);
    try {
      const business = await loadBusiness(branch.businessId);
      const mode = modeFor(business, branch);
      const ready: Array<{ product: Product; line: CartLine; names: Localized[] }> = [];
      const sheets: Sheet[] = [];
      const combos: Item[] = [];
      for (const l of usual.lines) {
        if (l.comboId) {
          combos.push({ productId: l.comboId, comboId: l.comboId, qty: l.quantity });
          continue;
        }
        const product = await loadProduct(branch.id, l.productId);
        if (!product || !product.available) continue;
        const byGroup = new Map<string, CartModifierSelection>();
        for (const m of l.modifiers) {
          const sel = byGroup.get(m.groupId) ?? { groupId: m.groupId, optionIds: [] };
          sel.optionIds.push(m.optionId);
          if (m.placement) sel.placements = { ...(sel.placements ?? {}), [m.optionId]: m.placement };
          byGroup.set(m.groupId, sel);
        }
        const line: CartLine = { lineId: makeId(12), productId: product.id, ...(l.variantId ? { variantId: l.variantId } : {}), modifiers: [...byGroup.values()], quantity: l.quantity, ...(l.requestedGrams ? { requestedGrams: l.requestedGrams } : {}), expectedUnitPriceAgorot: 0 };
        const priced = priceLine(product, line);
        // A size or option that no longer exists: let the customer choose again.
        if (priced.problem || !priced.line) sheets.push({ kind: 'product', product, business, branch, mode });
        else ready.push({ product, line: { ...line, expectedUnitPriceAgorot: priced.line.unitPriceAgorot }, names: priced.line.modifiers.map((m) => m.optionName) });
      }
      guard(business, branch, () => {
        for (const r of ready) commit(business, branch, mode, r.product, r.line, r.names);
        setQueue(sheets);
        if (combos.length) void addItems(branch, combos);
      });
    } catch {
      toast(t('common.errorGeneric'), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const next = () => setQueue((q) => q.slice(1));
  const sheet = queue[0];
  const layer = (
    <>
      {sheet?.kind === 'product' ? <ProductSheet key={`${sheet.product.id}-${queue.length}`} product={sheet.product} business={sheet.business} branch={sheet.branch} mode={sheet.mode} cityId={cityId} onClose={next} /> : null}
      {sheet?.kind === 'combo' ? <ComboSheet key={`${sheet.combo.id}-${queue.length}`} combo={sheet.combo} products={sheet.products} business={sheet.business} branch={sheet.branch} mode={sheet.mode} cityId={cityId} onClose={next} /> : null}
      <ConfirmDialog
        open={!!replace}
        onClose={() => setReplace(null)}
        onConfirm={() => replace?.run()}
        title={t('product.replaceCartTitle')}
        body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })}
        confirmLabel={t('product.replaceCartConfirm')}
        danger
      />
    </>
  );
  return { busy, addItems, addUsual, layer };
}
```
Note: `ProductSheet`/`ComboSheet` themselves confirm replacing another place's cart; because `guard` runs first, by the time a sheet opens the cart already belongs to this place (or is empty).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w apps/web` → no errors (fix import paths/names the compiler reports, e.g. the exact `OrderLineModifierSnapshot.optionName` field).
```bash
git add apps/web/src/customer/dishIndex.ts apps/web/src/customer/assistant/useAssistantData.ts apps/web/src/customer/assistant/useQuickAdd.tsx apps/web/src/customer/assistant/conversation.ts
git commit -m "Assistant (web): live data hook, conversation storage, quick add for dishes, meals and usuals"
```

---

### Task 13: The chat page (`/ask`) and its cards

**Files:**
- Create: `apps/web/src/customer/assistant/Cards.tsx`
- Create: `apps/web/src/customer/assistant/AskPage.tsx`
- Create: `apps/web/src/customer/assistant/assistant.css`
- Modify: `apps/web/src/app/App.tsx` (route)
- Modify: `packages/shared/src/i18n/en.ts`, `he.ts`, `ar.ts` (keys below)

**Interfaces:**
- Consumes: `useAssistantData`, `useQuickAdd`, `loadConversation`/`saveConversation` (Task 12); shared `respond`, `afterAdd`, `homeView`, `resolveCard`, `parseQuery`, `matchScore`, `EMPTY_CONVERSATION`, `Chip`, `AssistantTurn`.
- Produces: route `/ask`; `AskState = { text?: string; chip?: Chip }` passed in `navigate('/ask', { state })`; `AssistantCard({ card, data, branches, quick })` (used by the home in Task 14).

- [ ] **Step 1: i18n keys**

Add to `en.ts` (and the same keys to `he.ts` and `ar.ts` with the values in the table):
```ts
  'assistant.title': 'Assistant',
  'assistant.ask': 'What are you craving?',
  'assistant.askLabel': 'Ask the assistant',
  'assistant.back': 'Back',
  'assistant.newChat': 'New chat',
  'assistant.send': 'Send',
  'assistant.thinking': 'Thinking',
  'assistant.liveMatches': 'Matching dishes',
  'assistant.add': 'Add {name}',
  'assistant.from': 'From {price}',
  'assistant.addAll': 'Add all',
  'assistant.addDeal': 'Add deal',
  'assistant.seeDeal': 'See deal',
  'assistant.reorder': 'Order again',
  'assistant.deal': 'Deal',
  'assistant.saves': 'Saves {amount}',
  'assistant.missing': 'Not available now: {names}',
  'assistant.signIn': 'Sign in',
  'assistant.toCart': 'To cart',
  'discovery.closedCount': 'Closed now ({count})',
```

| key | he | ar |
|---|---|---|
| assistant.title | עוזר | المساعد |
| assistant.ask | מה בא לך? | شو نفسك؟ |
| assistant.askLabel | לשאול את העוזר | اسأل المساعد |
| assistant.back | חזרה | رجوع |
| assistant.newChat | שיחה חדשה | محادثة جديدة |
| assistant.send | שליחה | إرسال |
| assistant.thinking | חושב | عم يفكر |
| assistant.liveMatches | מנות מתאימות | أطباق مناسبة |
| assistant.add | הוספת {name} | إضافة {name} |
| assistant.from | החל מ־{price} | ابتداءً من {price} |
| assistant.addAll | הוספת הכול | أضف الكل |
| assistant.addDeal | הוספת המבצע | أضف العرض |
| assistant.seeDeal | למבצע | شوف العرض |
| assistant.reorder | להזמין שוב | اطلب مرة ثانية |
| assistant.deal | מבצע | عرض |
| assistant.saves | חוסכים {amount} | بتوفّر {amount} |
| assistant.missing | לא זמין עכשיו: {names} | مش متوفر هلا: {names} |
| assistant.signIn | התחברות | تسجيل الدخول |
| assistant.toCart | לסל | للسلة |
| discovery.closedCount | סגורים כעת ({count}) | مسكّر هلا ({count}) |

- [ ] **Step 2: Cards**

`apps/web/src/customer/assistant/Cards.tsx`:
```tsx
import { Link } from 'react-router';
import { resolveCard, type AssistantData, type AssistantPlace, type Card, type ResolvedCard } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { clockIn, money } from '@/lib/format';
import { Badge } from '@/design/components';
import { Icon } from '@/design/Icon';
import { StorageImage } from '../StorageImage';
import type { PublicBranch } from '../hooks';
import type { useQuickAdd } from './useQuickAdd';

type Quick = ReturnType<typeof useQuickAdd>;
interface Props<K extends ResolvedCard['kind']> { r: Extract<ResolvedCard, { kind: K }>; branch: PublicBranch; quick: Quick }

/** One assistant card: a dish, a ready meal, a deal or "your usual". Gone dishes or places render nothing. */
export function AssistantCard({ card, data, branches, quick }: { card: Card; data: AssistantData; branches: Map<string, PublicBranch>; quick: Quick }) {
  const r = resolveCard(card, data);
  const branch = r ? branches.get(r.place.branchId) : undefined;
  if (!r || !branch) return null;
  switch (r.kind) {
    case 'dish': return <DishCard r={r} branch={branch} quick={quick} />;
    case 'meal': return <MealCard r={r} branch={branch} quick={quick} />;
    case 'deal': return <DealCard r={r} branch={branch} quick={quick} />;
    case 'usual': return <UsualCard r={r} branch={branch} quick={quick} />;
  }
}

function PlaceLink({ place, branch }: { place: AssistantPlace; branch: PublicBranch }) {
  const { L } = useI18n();
  return <Link className="ac__place" to={`/b/${place.businessId}/${place.branchId}`}>{L(place.name, branch.businessDefaultLocale)}</Link>;
}

/** The action of a card: add when the place takes orders, else when it opens. */
function Action({ place, busy, onAdd, text, label }: { place: AssistantPlace; busy: boolean; onAdd: () => void; text?: string; label?: string }) {
  const t = useT();
  if (!place.open) return <Link className="ac__when" to={`/b/${place.businessId}/${place.branchId}`}>{place.opensInMin === undefined ? t('common.closed') : t('discovery.opensAt', { time: clockIn(place.opensInMin) })}</Link>;
  if (text) return <button type="button" className="btn btn--primary ac__cta" onClick={onAdd} disabled={busy} aria-busy={busy || undefined}>{text}</button>;
  return <button type="button" className="ac__add" onClick={onAdd} disabled={busy} aria-label={label} aria-busy={busy || undefined}><Icon name="plus" size={22} /></button>;
}

function DishCard({ r, branch, quick }: Props<'dish'>) {
  const t = useT();
  const { L, locale } = useI18n();
  const { dish, place } = r;
  const name = L(dish.entry.name, branch.businessDefaultLocale);
  const price = money(dish.entry.priceAgorot, locale);
  return (
    <article className="ac ac--dish">
      <StorageImage path={dish.entry.imagePath} alt="" square fallbackLabel="" fallbackMark={name} className="ac__img" />
      <div className="ac__body">
        <h3 className="ac__name">{name}</h3>
        <PlaceLink place={place} branch={branch} />
        <span className="ac__price price"><bdi>{dish.entry.fromPrice ? t('assistant.from', { price }) : price}</bdi></span>
      </div>
      <Action place={place} busy={quick.busy === place.branchId} label={t('assistant.add', { name })} onAdd={() => void quick.addItems(branch, [{ productId: dish.id, qty: 1 }])} />
    </article>
  );
}

function MealCard({ r, branch, quick }: Props<'meal'>) {
  const t = useT();
  const { L, locale } = useI18n();
  const { basket, place, lines } = r;
  return (
    <article className="ac ac--meal">
      <header className="ac__head">
        <PlaceLink place={place} branch={branch} />
        <span className="ac__price price"><bdi>{money(basket.totalAgorot, locale)}</bdi></span>
      </header>
      <ul className="ac__lines">
        {lines.map(({ line, name, imagePath }) => (
          <li key={line.productId}>
            <StorageImage path={imagePath} alt="" square fallbackLabel="" fallbackMark={L(name, branch.businessDefaultLocale)} className="ac__thumb" />
            <span><bdi>{line.qty}×</bdi> {L(name, branch.businessDefaultLocale)}</span>
          </li>
        ))}
      </ul>
      {basket.savingsAgorot > 0 ? <Badge tone="success" icon="tag">{t('assistant.saves', { amount: money(basket.savingsAgorot, locale) })}</Badge> : null}
      <Action place={place} busy={quick.busy === place.branchId} text={t('assistant.addAll')} onAdd={() => void quick.addItems(branch, basket.lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(l.comboId ? { comboId: l.comboId } : {}) })))} />
    </article>
  );
}

function DealCard({ r, branch, quick }: Props<'deal'>) {
  const t = useT();
  const { L, locale } = useI18n();
  const { deal, place, itemNames } = r;
  const title = L(deal.combo ? deal.combo.name : deal.promotion!.title, branch.businessDefaultLocale);
  return (
    <article className="ac ac--deal">
      <StorageImage path={deal.combo?.imagePath ?? deal.promotion?.imagePath} alt="" wide fallbackLabel="" fallbackMark={title} className="ac__img" />
      <div className="ac__body">
        <Badge tone="accent" icon="tag">{t('assistant.deal')}</Badge>
        <h3 className="ac__name">{title}</h3>
        <PlaceLink place={place} branch={branch} />
        {itemNames.length ? <p className="ac__items">{itemNames.map((n) => L(n, branch.businessDefaultLocale)).join(' · ')}</p> : null}
        {deal.combo ? <span className="ac__price price"><bdi>{money(deal.combo.priceAgorot, locale)}</bdi></span> : null}
      </div>
      {deal.combo
        ? <Action place={place} busy={quick.busy === place.branchId} text={t('assistant.addDeal')} onAdd={() => void quick.addItems(branch, [{ productId: deal.id, comboId: deal.id, qty: 1 }])} />
        : <Link className="btn btn--secondary ac__cta" to={`/b/${place.businessId}/${place.branchId}`}>{t('assistant.seeDeal')}</Link>}
    </article>
  );
}

function UsualCard({ r, branch, quick }: Props<'usual'>) {
  const t = useT();
  const { L } = useI18n();
  const { usual, place, missing } = r;
  return (
    <article className="ac ac--usual">
      <header className="ac__head"><PlaceLink place={place} branch={branch} /></header>
      <ul className="ac__lines">{usual.lines.map((l, i) => <li key={i}><span><bdi>{l.quantity}×</bdi> {L(l.name, branch.businessDefaultLocale)}</span></li>)}</ul>
      {missing.length ? <p className="ac__missing">{t('assistant.missing', { names: missing.map((n) => L(n, branch.businessDefaultLocale)).join(', ') })}</p> : null}
      <Action place={place} busy={quick.busy === place.branchId} text={t('assistant.reorder')} onAdd={() => void quick.addUsual(branch, usual)} />
    </article>
  );
}
```

- [ ] **Step 3: The chat page**

`apps/web/src/customer/assistant/AskPage.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { EMPTY_CONVERSATION, afterAdd, homeView, matchScore, parseQuery, respond, type AssistantData, type AssistantDish, type AssistantTurn, type Chip, type Conversation } from '@qareeb/shared';
import { discoveryStore } from '@/lib/city';
import { cartCount, cartStore } from '@/lib/cart';
import { useI18n, useT } from '@/lib/i18n';
import { money } from '@/lib/format';
import { Icon } from '@/design/Icon';
import type { PublicBranch } from '../hooks';
import { AssistantCard } from './Cards';
import { loadConversation, saveConversation } from './conversation';
import { useAssistantData } from './useAssistantData';
import { useQuickAdd } from './useQuickAdd';
import './assistant.css';

export interface AskState {
  text?: string;
  chip?: Chip;
}

/** The assistant: a conversation that answers with cards you can add, plus live dish matches while typing. */
export function AskPage() {
  const t = useT();
  const { locale, L } = useI18n();
  const prefs = discoveryStore.use();
  const { data, branches, loading, signedIn } = useAssistantData(prefs.cityId);
  const opts = useMemo(() => ({ signedIn, uiLang: locale }), [signedIn, locale]);
  const [conv, setConv] = useState<Conversation>(loadConversation);
  const [text, setText] = useState('');
  const quick = useQuickAdd(prefs.cityId);
  const cart = cartStore.use();
  const location = useLocation();
  const navigate = useNavigate();
  const pending = useRef<AskState | null>((location.state as AskState | null) ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const send = (input: string | Chip) => setConv((c) => respond(c, input, data, opts));

  useEffect(() => saveConversation(conv), [conv]);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [conv.turns.length]);
  useEffect(() => {
    if (!pending.current) inputRef.current?.focus();
  }, []);
  // A message or chip sent from the home page is answered once the menus have loaded.
  useEffect(() => {
    const s = pending.current;
    if (loading || !s) return;
    pending.current = null;
    void navigate('.', { replace: true, state: null });
    if (s.chip) send(s.chip);
    else if (s.text) send(s.text);
    // Runs when loading ends; `send` reads the loaded data through the closure of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  // Something was just added: offer one thing that goes with it (afterAdd decides whether).
  const seen = useRef<string[] | null>(null);
  useEffect(() => {
    const lines = cart.cart?.lines ?? [];
    const prev = seen.current;
    seen.current = lines.map((l) => l.lineId);
    if (!prev || !cart.cart) return;
    const added = lines.filter((l) => !prev.includes(l.lineId)).at(-1);
    if (added) setConv((c) => afterAdd(c, { branchId: cart.cart!.branchId, productId: added.productId }, lines.map((l) => l.productId), data));
  }, [cart.cart, data]);

  const matches = useMemo(() => liveMatches(text, data), [text, data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    send(v);
    setText('');
  };
  const starter = conv.turns.length === 0 && !pending.current ? homeView(data, opts) : null;
  const lastAssistant = [...conv.turns].reverse().find((x) => x.role === 'assistant')?.id;
  const count = cartCount(cart);

  return (
    <div className="ask">
      <header className="ask__head">
        <Link to="/" className="ask__back" aria-label={t('assistant.back')}><Icon name="arrow" size={22} /></Link>
        <h1 className="ask__title">✦ {t('assistant.title')}</h1>
        {conv.turns.length ? <button type="button" className="ask__new" onClick={() => setConv(EMPTY_CONVERSATION)}>{t('assistant.newChat')}</button> : null}
      </header>
      <div className="ask__thread" aria-live="polite">
        {starter ? <Bubble turn={{ id: 'start', role: 'assistant', kind: 'none', text: starter.greeting, cards: starter.cards, chips: starter.chips }} last data={data} branches={branches} quick={quick} onChip={send} /> : null}
        {conv.turns.map((turn) => (turn.role === 'user'
          ? <p key={turn.id} className="ask__user" dir="auto">{turn.text}</p>
          : <Bubble key={turn.id} turn={turn} last={turn.id === lastAssistant} data={data} branches={branches} quick={quick} onChip={send} />))}
        {loading && pending.current ? <p className="ask__typing" role="status" aria-label={t('assistant.thinking')}><span /><span /><span /></p> : null}
        <div ref={endRef} />
      </div>
      <form className="ask__bar" onSubmit={submit}>
        {matches.length ? (
          <ul className="ask__live" aria-label={t('assistant.liveMatches')}>
            {matches.map((d) => (
              <li key={`${d.branchId}/${d.id}`}>
                <button type="button" onClick={() => { const b = branches.get(d.branchId); if (b) void quick.addItems(b, [{ productId: d.id, qty: 1 }]); setText(''); }}>
                  <span>{L(d.entry.name, branches.get(d.branchId)?.businessDefaultLocale)}</span>
                  <span className="price"><bdi>{money(d.entry.priceAgorot, locale)}</bdi></span>
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="ask__row">
          <label className="ask__input">
            <span className="visually-hidden">{t('assistant.askLabel')}</span>
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('assistant.ask')} enterKeyHint="send" autoComplete="off" dir="auto" />
          </label>
          <button type="submit" className="ask__send" aria-label={t('assistant.send')} disabled={!text.trim()}><Icon name="arrow" size={22} /></button>
        </div>
      </form>
      {cart.cart && count > 0 ? (
        <Link to="/cart" className="ask__cart">
          <Icon name="cart" size={20} />
          <span>{L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale)}</span>
          <b><bdi>{count}</bdi></b>
          <span className="ask__cart-go">{t('assistant.toCart')}</span>
        </Link>
      ) : null}
      {quick.layer}
    </div>
  );
}

function Bubble({ turn, last, data, branches, quick, onChip }: { turn: AssistantTurn; last: boolean; data: AssistantData; branches: Map<string, PublicBranch>; quick: ReturnType<typeof useQuickAdd>; onChip: (c: Chip) => void }) {
  const t = useT();
  const chips = last ? [...(turn.more ? [turn.more] : []), ...turn.chips] : [];
  return (
    <section className="ask__turn">
      <p className="ask__line" dir="auto">{turn.text}{turn.signIn ? <> <Link to="/signin">{t('assistant.signIn')}</Link></> : null}</p>
      {turn.cards.length ? <div className="ask__cards">{turn.cards.map((c, i) => <AssistantCard key={i} card={c} data={data} branches={branches} quick={quick} />)}</div> : null}
      {chips.length ? <div className="ask__chips" role="group">{chips.map((c, i) => <button key={i} type="button" className="ask__chip" onClick={() => onChip(c)}>{c.label}</button>)}</div> : null}
    </section>
  );
}

/** As-you-type: the closest dishes at open places (exact, start, lexicon or sound matches only). */
function liveMatches(text: string, data: AssistantData): AssistantDish[] {
  if (text.trim().length < 2) return [];
  const q = parseQuery(text);
  if (!q) return [];
  return data.dishes
    .map((d) => ({ d, m: matchScore(q, d.search) }))
    .filter((x) => x.m !== null && x.m.level <= 4 && data.places.get(x.d.branchId)?.open)
    .sort((a, b) => a.m!.score - b.m!.score)
    .slice(0, 5)
    .map((x) => x.d);
}
```

- [ ] **Step 4: Styles**

`apps/web/src/customer/assistant/assistant.css`:
```css
/* ---------- Assistant: chat page, cards, home strip ---------- */
.ask { display: flex; flex-direction: column; min-height: calc(100dvh - 140px); }
.ask__head { display: flex; align-items: center; gap: var(--space-3); padding-block: var(--space-2); }
.ask__back, .ask__send { display: inline-grid; place-items: center; min-width: var(--touch-min); min-height: var(--touch-min); border-radius: 999px; color: var(--color-text); }
[dir='ltr'] .ask__back svg, [dir='rtl'] .ask__send svg { transform: scaleX(-1); }
.ask__title { flex: 1; margin: 0; font-size: var(--text-title); }
.ask__new { min-height: var(--touch-min); padding-inline: var(--space-3); border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text); }
.ask__thread { flex: 1; display: flex; flex-direction: column; gap: var(--space-4); padding-block: var(--space-3) calc(var(--space-8) * 2); }
.ask__user { align-self: flex-end; max-width: 80%; margin: 0; padding: var(--space-2) var(--space-3); border-radius: 18px 18px 4px 18px; background: var(--color-primary); color: var(--color-on-primary); }
[dir='rtl'] .ask__user { border-radius: 18px 18px 18px 4px; }
.ask__turn { display: flex; flex-direction: column; gap: var(--space-3); }
.ask__line { margin: 0; font-size: var(--text-body); }
.ask__line::before { content: '✦ '; color: var(--color-primary); }
.ask__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-3); }
.ask__cards > * { min-width: 0; }
.ask__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.ask__chip { min-height: var(--touch-min); padding-inline: var(--space-4); border: 1px solid var(--color-border-strong); border-radius: 999px; background: var(--color-surface); color: var(--color-text); font: inherit; }
.ask__chip:hover { border-color: var(--color-primary); }
.ask__typing { display: inline-flex; gap: 4px; margin: 0; }
.ask__typing span { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-muted); animation: ask-dot 1s var(--ease-out) infinite; }
.ask__typing span:nth-child(2) { animation-delay: 0.15s; }
.ask__typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes ask-dot { 50% { opacity: 0.3; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .ask__typing span { animation: none; } }

.ask__bar { position: sticky; bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px)); z-index: 2; display: flex; flex-direction: column; gap: var(--space-2); }
.ask__row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); background: var(--color-surface); border: 2px solid var(--color-text); border-radius: 20px; box-shadow: 0 6px 0 var(--color-crave-lift); }
.ask__row:focus-within { border-color: var(--color-primary); }
.ask__input { flex: 1; }
.ask__input input { width: 100%; min-height: 52px; border: 0; background: none; font: inherit; font-size: var(--text-title); color: var(--color-text); outline: none; }
.ask__send:disabled { opacity: 0.4; }
.ask__live { list-style: none; margin: 0; padding: var(--space-1); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 16px; }
.ask__live button { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: var(--touch-min); padding-inline: var(--space-3); border: 0; background: none; font: inherit; color: var(--color-text); text-align: start; }
.ask__live button > span:first-child { flex: 1; }
.ask__cart { position: sticky; bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px)); display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); min-height: var(--touch-min); padding-inline: var(--space-4); border-radius: 999px; background: var(--color-band); color: var(--color-on-band); text-decoration: none; }
.ask__cart > span:nth-child(2) { flex: 1; }

/* Cards */
.ac { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 18px; }
.ac--dish { flex-direction: row; align-items: center; }
.ac--dish .ac__img { flex: none; width: 72px; }
.ac__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ac__name { margin: 0; font-size: var(--text-body); font-weight: 700; }
.ac__place { color: var(--color-text-muted); font-size: var(--text-secondary); text-decoration: none; }
.ac__price { font-weight: 700; }
.ac__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.ac__lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.ac__lines li { display: flex; align-items: center; gap: var(--space-2); }
.ac__thumb { width: 36px; flex: none; }
.ac__items, .ac__missing { margin: 0; color: var(--color-text-muted); font-size: var(--text-secondary); }
.ac__add { flex: none; display: inline-grid; place-items: center; width: var(--touch-min); height: var(--touch-min); border: 0; border-radius: 50%; background: var(--color-primary); color: var(--color-on-primary); }
.ac__cta { align-self: stretch; }
.ac__when { flex: none; color: var(--color-text-muted); font-size: var(--text-secondary); }

/* Home strip */
.assist { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-6); }
.assist__ask { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 64px; margin-top: calc(-1 * (var(--space-8) - var(--space-1))); padding-inline: var(--space-4); position: relative; z-index: 1; background: var(--color-surface); color: var(--color-text-muted); border: 2px solid var(--color-text); border-radius: 20px; box-shadow: 0 6px 0 var(--color-crave-lift); font: inherit; font-size: var(--text-title); text-align: start; }
.assist__ask > svg { color: var(--color-text); }
.assist__greeting { margin: 0; font-size: var(--text-heading); }
.places-closed > summary { min-height: var(--touch-min); display: flex; align-items: center; cursor: pointer; color: var(--color-text-muted); }
```

- [ ] **Step 5: Route**

In `apps/web/src/app/App.tsx` add `import { AskPage } from '@/customer/assistant/AskPage';` and inside the `CustomerLayout` routes, after the index route:
```tsx
        <Route path="ask" element={<AskPage />} />
```

- [ ] **Step 6: Run it**

Run: `npm run typecheck` → no errors. Start emulators + seed + `npm run dev`, open `http://localhost:5173/ask` at 390×844: send "שווארמה", "ל-4 עד 150", "מה במבצע?", "auutrnv"; tap "+" on a dish (cart bar appears, an upsell turn follows); tap "עוד" and a refinement chip. Check RTL in Hebrew and Arabic, and English LTR.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/customer/assistant/Cards.tsx apps/web/src/customer/assistant/AskPage.tsx apps/web/src/customer/assistant/assistant.css apps/web/src/app/App.tsx packages/shared/src/i18n/en.ts packages/shared/src/i18n/he.ts packages/shared/src/i18n/ar.ts
git commit -m "Assistant (web): /ask chat page with dish, meal, deal and usual cards"
```

---

### Task 14: The new home

**Files:**
- Create: `apps/web/src/customer/assistant/AssistantHome.tsx`
- Modify: `apps/web/src/customer/DiscoveryPage.tsx`
- Delete: `apps/web/src/customer/CravingsHome.tsx`, `e2e/cravings.spec.ts`
- Modify: `apps/web/src/customer/cravings.css` (keep `.home` and `.crave-band*`; delete rules whose selectors no longer appear in any `.tsx`)
- Create: `e2e/assistant.spec.ts`

**Interfaces:**
- Consumes: `useAssistantData`, `useQuickAdd`, `AssistantCard`, `AskState` (Tasks 12–13), shared `homeView`.
- Produces: the home order: stories band → ask box → greeting + picks → chips → places (open first, closed folded).

- [ ] **Step 1: Write the failing e2e test**

`e2e/assistant.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

/**
 * The assistant home and chat. Seed: Abu Salim (two branches serving Beit Jann) with shawarma,
 * falafel, fries, cola and knafeh; the market is a supermarket. Run the auto-tag script on the
 * emulator before this suite (Task 11) so seed dishes carry tags.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('cart')) localStorage.removeItem(k);
    sessionStorage.clear();
  });
  await page.reload();
});

test('home: ask box opens the chat; a typed request answers with cards', async ({ page }) => {
  await page.getByRole('button', { name: 'מה בא לך?' }).click();
  await expect(page).toHaveURL(/\/ask$/);
  const input = page.getByRole('textbox', { name: 'לשאול את העוזר' });
  await input.fill('שווארמה');
  await input.press('Enter');
  await expect(page.locator('.ask__user')).toHaveText('שווארמה');
  await expect(page.locator('.ac--dish').first()).toContainText('שווארמה');
});

test('a meal for 2 is added with one tap', async ({ page }) => {
  await page.goto('/ask');
  const input = page.getByRole('textbox', { name: 'לשאול את העוזר' });
  await input.fill('ל-2');
  await input.press('Enter');
  const meal = page.locator('.ac--meal').first();
  await expect(meal).toBeVisible();
  await meal.getByRole('button', { name: 'הוספת הכול' }).click();
  // Lines that need a choice open the product sheet one after another; close them to keep the simple ones.
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()); i++) await page.keyboard.press('Escape');
  await expect(page.locator('.ask__cart')).toBeVisible();
});

test('refinement chip keeps the request and changes one thing', async ({ page }) => {
  await page.goto('/ask');
  const input = page.getByRole('textbox', { name: 'לשאול את העוזר' });
  await input.fill('ל-2');
  await input.press('Enter');
  await page.getByRole('button', { name: 'ל-4' }).click();
  await expect(page.locator('.ask__line').last()).toContainText('4');
});

test('replace cart once: "add all" from another place asks one confirmation before adding', async ({ page }) => {
  await page.goto('/ask');
  const input = page.getByRole('textbox', { name: 'לשאול את העוזר' });
  await input.fill('קולה');
  await input.press('Enter');
  const cards = page.locator('.ac--dish');
  await cards.first().getByRole('button').click();
  await expect(page.locator('.ask__cart')).toBeVisible();
  const firstPlace = await cards.first().locator('.ac__place').textContent();
  // A cola from the other branch belongs to another place.
  const other = cards.filter({ hasNot: page.locator('.ac__place', { hasText: firstPlace ?? '' }) }).first();
  await other.getByRole('button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'החלפת הסל' }).or(page.getByRole('dialog').getByRole('button').last()).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.ask__cart')).toBeVisible();
});

test('home chip opens the chat with an answer', async ({ page }) => {
  await page.getByRole('group', { name: 'הצעות' }).getByRole('button').first().click();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.locator('.ask__turn').last()).toBeVisible();
});
```
Run: `npm run test:e2e -- assistant.spec.ts` → FAIL (no ask button on the home).

- [ ] **Step 2: The home strip**

`apps/web/src/customer/assistant/AssistantHome.tsx`:
```tsx
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { homeView, type Chip } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Icon } from '@/design/Icon';
import { AssistantCard } from './Cards';
import type { AskState } from './AskPage';
import { useAssistantData } from './useAssistantData';
import { useQuickAdd } from './useQuickAdd';
import './assistant.css';

/** The home's assistant: the ask box (opens /ask), a greeting with up to three ready picks, and suggestion chips. */
export function AssistantHome({ cityId }: { cityId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const { data, branches, loading, signedIn } = useAssistantData(cityId);
  const quick = useQuickAdd(cityId);
  const view = useMemo(() => homeView(data, { signedIn, uiLang: locale }), [data, signedIn, locale]);
  const open = (state?: AskState) => void navigate('/ask', state ? { state } : undefined);
  return (
    <section className="assist" aria-label={t('assistant.title')}>
      <button type="button" className="assist__ask" onClick={() => open()}>
        <Icon name="search" size={24} />
        <span>{t('assistant.ask')}</span>
      </button>
      {!loading ? (
        <>
          <p className="assist__greeting">✦ {view.greeting}</p>
          {view.cards.length ? <div className="ask__cards">{view.cards.map((c, i) => <AssistantCard key={i} card={c} data={data} branches={branches} quick={quick} />)}</div> : null}
          {view.chips.length ? (
            <div className="ask__chips" role="group" aria-label={t('assistant.suggestions')}>
              {view.chips.map((c: Chip, i) => <button key={i} type="button" className="ask__chip" onClick={() => open({ chip: c })}>{c.label}</button>)}
            </div>
          ) : null}
        </>
      ) : null}
      {quick.layer}
    </section>
  );
}
```
Add the key `'assistant.suggestions'`: en `Suggestions`, he `הצעות`, ar `اقتراحات` (all three dictionaries).

- [ ] **Step 3: Wire the home**

In `apps/web/src/customer/DiscoveryPage.tsx`:
- replace `import { CravingsHome } from './CravingsHome';` with `import { AssistantHome } from './assistant/AssistantHome';` and add `import './cravings.css';`
- replace `<CravingsHome restaurants={restaurants.data} cityId={prefs.cityId} now={now} />` with `<AssistantHome cityId={prefs.cityId} />`
- the restaurants list only feeds the assistant now; keep `useDiscovery(prefs.cityId, 'restaurant')` for the places list.
- replace the `<ul className="place-list">…</ul>` of the loaded state with open places first and the closed ones folded:
```tsx
          <>
            <ul className="place-list">
              {openNow.map((b) => <PlaceRow key={b.id} branch={b} cityId={prefs.cityId} showBranch={(multiBranch.get(b.businessId) ?? 0) > 1} />)}
            </ul>
            {closedNow.length ? (
              <details className="places-closed">
                <summary>{t('discovery.closedCount', { count: closedNow.length })}</summary>
                <ul className="place-list">
                  {closedNow.map((b) => <PlaceRow key={b.id} branch={b} cityId={prefs.cityId} showBranch={(multiBranch.get(b.businessId) ?? 0) > 1} />)}
                </ul>
              </details>
            ) : null}
          </>
```
with, next to `branches`:
```tsx
  const openNow = useMemo(() => branches.filter((b) => evaluateOpen(now, b.hours, b.hoursOverrides ?? []).open && !b.ordersPaused), [branches, now]);
  const closedNow = useMemo(() => branches.filter((b) => !openNow.includes(b)), [branches, openNow]);
```
- change the section heading key from `cravings.places` to a new key `discovery.places` (en `Places`, he `מקומות`, ar `أماكن`), so no `cravings.*` keys remain in use.

- [ ] **Step 4: Remove the old home**

```bash
git rm apps/web/src/customer/CravingsHome.tsx e2e/cravings.spec.ts
```
Delete every `'cravings.*'` key from `en.ts`, `he.ts`, `ar.ts` (check first: `grep -rn "cravings\." apps/web/src` must print nothing). In `cravings.css` delete the rules for `.crave`, `.crave-search*`, `.crave-chips`, `.crave-chip*`, `.crave-results`, `.crave-list*`, `.crave-dish*`, `.crave-title`, `.crave-sub`, `.crave-for`, `.crave-empty` (check each with `grep -rn "<selector-name>" apps/web/src --include=*.tsx` before deleting); keep `.home` and `.crave-band*`.

- [ ] **Step 5: Run the e2e tests and typecheck**

Run: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/src/auto-tag.ts --apply` (seed dishes get tags), then `npm run typecheck` and `npm run test:e2e -- assistant.spec.ts stories.spec.ts customer.spec.ts`.
Expected: PASS. If `customer.spec.ts` used the old search field (placeholder "מה בא לך?" as a searchbox), update those steps to the ask flow: click the button "מה בא לך?", type into "לשאול את העוזר", press Enter.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/customer/assistant/AssistantHome.tsx apps/web/src/customer/DiscoveryPage.tsx apps/web/src/customer/cravings.css packages/shared/src/i18n/en.ts packages/shared/src/i18n/he.ts packages/shared/src/i18n/ar.ts e2e/assistant.spec.ts e2e/customer.spec.ts
git commit -m "Assistant home: ask box, greeting with ready picks, chips; open places first, closed folded"
```

---

### Task 15: Tags and serves in the product editor

**Files:**
- Modify: `apps/web/src/business/CatalogPages.tsx` (`draftFrom` ~line 69–76; hero fields ~line 259; save ~line 178)
- Add i18n keys: `'catalog.tags'` (en `Tags`, he `תגיות`, ar `وسوم`), `'catalog.serves'` (en `Serves`, he `מספיק ל־`, ar `بكفي لـ`)

**Interfaces:**
- Consumes: shared `autoTags`, `isMachineOwned`, `DISH_TAGS`, `TAG_LABELS`.
- Produces: the editor sends `tags`, `serves` and `dishType` on every save; values still owned by the machine follow the name and description live until the owner changes them.

- [ ] **Step 1: Draft and machine-owned preview**

In `draftFrom`, add `autoFields: _af` to the destructured server-owned fields (the save schema is strict):
```ts
  const { id: _i, branchId: _b, businessId: _bz, archived: _a, createdAt: _c, updatedAt: _u, autoTranslated: _t, autoFields: _af, imagePath, sortOrder, ...rest } = normalized;
```
In the editor component, after `d` (the draft) is available, add:
```tsx
  // Tags, serves and type follow the dish's texts until the owner changes them (owner wins on the server too).
  const [touched, setTouched] = useState<Set<'tags' | 'serves' | 'dishType'>>(new Set());
  const suggestion = useMemo(() => autoTags({ name: d.name, description: d.description }), [d.name, d.description]);
  const machine = (k: 'tags' | 'serves' | 'dishType') => !touched.has(k) && (!initial || isMachineOwned(initial, k));
  const shown = {
    tags: machine('tags') ? suggestion.tags : d.tags ?? [],
    serves: machine('serves') ? suggestion.serves : d.serves ?? 1,
    dishType: machine('dishType') ? suggestion.dishType ?? 'none' : d.dishType ?? 'none',
  };
  const touch = (k: 'tags' | 'serves' | 'dishType', patch: Partial<Draft>) => { setTouched((s) => new Set(s).add(k)); set(patch); };
```
Change the dish-type `Select` to use `value={shown.dishType}` and `onChange={(e) => touch('dishType', { dishType: e.target.value as Draft['dishType'] })}`, and add right after it (restaurants only, same `!supermarket` guard):
```tsx
            <fieldset className="pe-tags">
              <legend>{t('catalog.tags')}</legend>
              {DISH_TAGS.map((tag) => {
                const on = shown.tags.includes(tag);
                return <button key={tag} type="button" className="ask__chip" aria-pressed={on} onClick={() => touch('tags', { tags: on ? shown.tags.filter((x) => x !== tag) : [...shown.tags, tag] })}>{TAG_LABELS[tag][locale]}</button>;
              })}
            </fieldset>
            <TextInput label={t('catalog.serves')} type="number" inputMode="numeric" min={1} max={12} ltr value={String(shown.serves)} onChange={(e) => touch('serves', { serves: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })} />
```
(`locale` comes from `useI18n()`; import `autoTags, isMachineOwned, DISH_TAGS, TAG_LABELS` from `@qareeb/shared`; `.ask__chip` styling is global once `assistant.css` is imported — add `import '@/customer/assistant/assistant.css';` at the top of CatalogPages.tsx, and `.pe-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); border: 0; padding: 0; margin: 0; } .ask__chip[aria-pressed='true'] { background: var(--color-primary); color: var(--color-on-primary); border-color: var(--color-primary); }` to `assistant.css`.)

- [ ] **Step 2: Send the shown values**

In the save call (line ~178), build the product with the shown values:
```ts
      const product = { ...draftProduct, tags: shown.tags, serves: shown.serves, dishType: shown.dishType };
```
where `draftProduct` is the object currently passed as `product` (rename the existing local accordingly). The server keeps them machine-owned when they equal its own suggestion (same `autoTags` on the same name and description) and owner-owned otherwise.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` and the existing editor e2e: `npm run test:e2e -- owner-usability.spec.ts z-business.spec.ts`.
Manually (emulator): new dish "פיצה משפחתית חריפה" → chips show spicy/vegetarian/sharing, serves 4, type pizza without touching anything; save; reopen → same. Untick "חריף", save; rename the dish → tags no longer follow the name (owner-owned), serves still does.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/business/CatalogPages.tsx apps/web/src/customer/assistant/assistant.css packages/shared/src/i18n/en.ts packages/shared/src/i18n/he.ts packages/shared/src/i18n/ar.ts
git commit -m "Product editor: automatic tags and serves, editable (owner wins)"
```

---

### Task 16: Review, deploy and backfill (user approval gates)

- [ ] **Step 1: Full verification**

Run: `npm run typecheck`, `npm run lint`, `npm run test -w packages/shared`, `npm run test -w functions` (emulators), `npm run test:rules`, `npm run test:e2e`.
Expected: all green; report any failure verbatim instead of skipping it.

- [ ] **Step 2: Branch review**

Use superpowers:requesting-code-review on the branch (spec + plan as context). Fix confirmed findings.

- [ ] **Step 3: Ask the user before anything live**

Show the user: the auto-tag review page artifact (Task 11 Step 3), phone screenshots of the home and `/ask` (he/ar/en). Ask explicitly for: (a) approval to deploy rules/indexes, functions and hosting to qareeb-dev, (b) approval to run the auto-tag `--apply` on qareeb-dev.

- [ ] **Step 4: Deploy (only after (a))**

```bash
firebase deploy --only firestore:rules,firestore:indexes --project qareeb-dev --non-interactive
firebase deploy --only functions --project qareeb-dev --non-interactive
```
Then backfill the deals index for existing branches: `npx tsx scripts/src/deals-index-backfill.ts` (dry run, check the counts), then `--apply`. Then hosting. Move `apps/web/.env.local` aside for the production build (it holds the App Check debug token) and restore it afterwards:
```bash
mv apps/web/.env.local apps/web/.env.local.deploy-bak && npm run build -w apps/web && firebase deploy --only hosting --project qareeb-dev --non-interactive; mv apps/web/.env.local.deploy-bak apps/web/.env.local
```

- [ ] **Step 5: Backfill tags (only after (b))**

Run: `npx tsx scripts/src/auto-tag.ts --apply`, then the dry run again → "0 dishes to update".

- [ ] **Step 6: Live check**

Open https://qareeb-dev.web.app at 390×844: home shows the ask box, greeting and picks; "ל-4 עד 150", "משהו חריף", "מה במבצע?" answer with cards; add all → cart. Report to the user with screenshots.
