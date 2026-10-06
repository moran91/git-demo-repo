# Taste Profile, Phase 1 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server and shared foundations of the taste profile (types, the pure `deriveTaste`, the taste and feedback callables, Firestore rules, and server-side popularity), with no customer UI yet.

**Architecture:** Pure logic lives in `packages/shared/src/taste/` so the browser (phase 2) and the functions run the same code. Four signed-in callables in `functions/src/domain/taste.ts` own every write to `users/{uid}/taste/profile` and `users/{uid}/dishFeedback/*`; clients only read. Popularity is counted from the existing outbox `order_accepted` event (once per event, inside a transaction) and published hourly as ranks only to `publicPopular/{cityId}`.

**Tech Stack:** TypeScript, zod 4, Firebase Functions v2 (`onCall`, `onSchedule`), Firestore, vitest, `@firebase/rules-unit-testing`, Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-10-06-taste-profile-design.md` (sections 6, 7.1, 7.2, 10, 13, 14 phase 1).

## Global Constraints

- Daypart boundaries in Asia/Jerusalem: morning 06–11, noon 11–16, evening 16–22, late 22–06.
- Usual dishes: top 3 `(branchId, productId)` by recency-weighted frequency, half-life 60 days, each in at least 2 orders.
- Usual daypart: only with 3 or more orders and at least 60% in one daypart.
- Quiz affinity: picked +1, both +0.5 each, neither −0.5 each. Weight 1 for 0–2 learned orders, 0.5 for 3–9, 0 at 10+ or 90 days after the quiz.
- `deriveTaste` ignores every order when `consent.orders` is false, orders before `ignoreOrdersBefore`, orders whose feedback says `forSomeoneElse`, and every suppressed key.
- `suppressed` is capped at 100 keys.
- `publicPopular`: top 12 per daypart, ranks only (no counts), each dish in at least 3 orders over 28 days.
- Rules: `users/{uid}/taste/{doc}` and `users/{uid}/dishFeedback/{id}` owner read, `write: if false`; `publicPopular/{cityId}` `read: if true; write: if false`; everything else new falls to the catch-all deny.
- Never collect allergies, health, religion or "eater type". Wish text is never stored.
- Callables use the existing `onCall(opts, handled(...))` pattern, `requireCaller`, `parse(schema, req.data)` and `fail(code)`.
- `parse()` runs `stripNulls` first, so **no input may use `null` as a meaningful value**. Clearing is done with explicit flags or the string `'none'`.
- Timestamps are ISO strings from `nowIso()` (the codebase convention), not Firestore `Timestamp`s.
- Never run `git reset`, `git checkout <file>`, `git restore` or `git stash` in this repo. Commit only the files a task names.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Decisions this plan makes where the spec is loose (also written back into the spec in Task 10):**
- A doc with `consent === null` (never asked) learns from orders, because tier 1 is "on by default". The quiz is used only when `consent.learn === true`.
- Popularity counts **orders**, not quantities: each distinct dish counts 1 per accepted order. The "at least 3 orders" threshold then means 3 orders.
- Only restaurant orders count. Combo lines (`comboId`) and removed lines are ignored for popularity, usual and feedback.
- Publishing runs in its own scheduled function `popularityHourly` instead of an hourly branch inside the 5-minute `scheduledSweeps`.

## Review Focus

1. **An outbox event retried after popularity was already counted** (the notification half failed). The dish must still count once. Test in Task 8.
2. **An order placed at 00:30 Israel time** must land in `late` and in the Israeli date's doc, not the UTC date. Tests in Task 1 and Task 8.
3. **Orders with combo lines or lines removed by a revision.** Neither may count toward popularity or usual, nor be rated. Tests in Tasks 3, 7 and 8.
4. **`mergeTaste` sent twice** (the client retries after a dropped response). It must not overwrite consent or duplicate suppressed keys. Test in Task 6.
5. **A customer withdraws the `learn` consent.** The stored quiz must be deleted, and `deriveTaste` must stop using it. Tests in Tasks 3 and 6.

## File map

| File | Responsibility |
|---|---|
| `packages/shared/src/taste/types.ts` (new) | Taste types, constants, dish keys |
| `packages/shared/src/taste/daypart.ts` (new) | `daypartOf` |
| `packages/shared/src/taste/derive.ts` (new) | `deriveTaste`, `quizWeight` |
| `packages/shared/src/taste/popular.ts` (new) | `popularCountKey`, `sumCounts`, `rankPopular` |
| `packages/shared/src/taste/index.ts` (new) | Barrel |
| `packages/shared/src/schemas.ts` | Taste zod schemas |
| `packages/shared/src/index.ts` | Export `./taste/index.js` |
| `packages/shared/test/taste-*.test.ts` (new) | Unit tests |
| `firestore.rules`, `tests/rules/firestore.test.ts` | Rules and rules tests |
| `functions/src/lib/firebase.ts` | `col.taste`, `col.dishFeedback`, `col.popularityDaily`, `col.popularityDays`, `col.publicPopular` |
| `functions/src/domain/taste.ts` (new) | `saveTaste`, `mergeTaste`, `deleteTaste`, `saveDishFeedback` |
| `functions/src/lib/popularity.ts` (new) | `countAcceptedOrder`, `publishPopularity` |
| `functions/src/lib/outbox.ts` | Calls `countAcceptedOrder` for `order_accepted` |
| `functions/src/triggers.ts`, `functions/src/index.ts` | `popularityHourly` and new exports |
| `functions/test/taste.test.ts`, `functions/test/popularity.test.ts`, `functions/test/popularity-source.test.ts` (new) | Emulator tests |
| `docs/DATA_MODEL.md` | New collections |

## How to run tests

- Shared unit tests: `npm run test -w packages/shared -- taste`
- Rules and functions tests need the emulators, which need Java 21 (the system Java is 19):
  ```bash
  # once per machine: a Temurin 21 JDK in the scratchpad
  curl -L -o /tmp/jdk21.tgz 'https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse'
  mkdir -p "$SCRATCH/jdk21" && tar -xzf /tmp/jdk21.tgz -C "$SCRATCH/jdk21" --strip-components=1
  export JAVA_HOME="$SCRATCH/jdk21/Contents/Home" PATH="$SCRATCH/jdk21/Contents/Home/bin:$PATH"
  npm run build -w functions          # the emulator loads functions/lib
  bash scripts/emulators.sh           # run in the background; wait for "All emulators ready"
  ```
  Then: `env -u HTTPS_PROXY -u https_proxy npm run test -w tests/rules` and `env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- taste popularity`. Rebuild functions (`npm run build -w functions`) after every functions change; the emulator hot-reloads `lib/`.

---

### Task 1: Taste types and `daypartOf`

**Files:**
- Create: `packages/shared/src/taste/types.ts`, `packages/shared/src/taste/daypart.ts`, `packages/shared/src/taste/index.ts`
- Modify: `packages/shared/src/index.ts` (add one export line)
- Test: `packages/shared/test/taste-daypart.test.ts`

**Interfaces:**
- Consumes: `toLocal(instant: Date): LocalDateTime` (`packages/shared/src/hours.ts`), `DishType` (`dishIndex.ts`), `Locale` (`types.ts`).
- Produces: every type below, `DAYPARTS`, `PARTIES`, `PAIR_ANSWERS`, `TASTE_CONSENT_VERSION`, `dishKey(branchId, productId): string`, `splitDishKey(key): [string, string]`, `emptyTasteDoc(now: string): TasteDoc`, `daypartOf(instant: Date): Daypart`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/taste-daypart.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { daypartOf, dishKey, emptyTasteDoc, splitDishKey } from '../src/taste/index.js';

describe('daypartOf (Asia/Jerusalem)', () => {
  // January is UTC+2, July is UTC+3.
  it.each([
    ['2026-01-15T03:59:00.000Z', 'late'],     // 05:59
    ['2026-01-15T04:00:00.000Z', 'morning'],  // 06:00
    ['2026-01-15T08:59:00.000Z', 'morning'],  // 10:59
    ['2026-01-15T09:00:00.000Z', 'noon'],     // 11:00
    ['2026-01-15T14:00:00.000Z', 'evening'],  // 16:00
    ['2026-01-15T19:59:00.000Z', 'evening'],  // 21:59
    ['2026-01-15T20:00:00.000Z', 'late'],     // 22:00
    ['2026-01-15T22:30:00.000Z', 'late'],     // 00:30 the next local day
    ['2026-07-01T13:00:00.000Z', 'evening'],  // 16:00 in summer time
  ])('%s is %s', (iso, expected) => {
    expect(daypartOf(new Date(iso))).toBe(expected);
  });
});

describe('dish keys', () => {
  it('round-trips branch and product ids', () => {
    expect(dishKey('br-1', 'p_2')).toBe('br-1/p_2');
    expect(splitDishKey('br-1/p_2')).toEqual(['br-1', 'p_2']);
  });
});

describe('emptyTasteDoc', () => {
  it('starts with nothing learned', () => {
    expect(emptyTasteDoc('2026-10-06T10:00:00.000Z')).toEqual({ v: 1, consent: null, quiz: null, suppressed: [], ignoreOrdersBefore: null, lastAiSummary: null, updatedAt: '2026-10-06T10:00:00.000Z' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/shared -- taste-daypart`
Expected: FAIL, cannot resolve `../src/taste/index.js`.

- [ ] **Step 3: Write the implementation**

`packages/shared/src/taste/types.ts`:
```ts
/**
 * Taste profile: what Qareeb has learned about one customer. Stored at users/{uid}/taste/profile
 * (server-written) or in localStorage as qareeb.taste.v1 while signed out. See
 * docs/superpowers/specs/2026-10-06-taste-profile-design.md.
 */
import type { DishType } from '../dishIndex.js';
import type { Locale } from '../types.js';

export const PARTIES = ['solo', 'two', 'family', 'friends'] as const;
export type Party = (typeof PARTIES)[number];
/** 06–11, 11–16, 16–22, 22–06 in Asia/Jerusalem. */
export const DAYPARTS = ['morning', 'noon', 'evening', 'late'] as const;
export type Daypart = (typeof DAYPARTS)[number];
export const PAIR_ANSWERS = ['a', 'b', 'neither', 'both'] as const;
export type PairAnswer = (typeof PAIR_ANSWERS)[number];
export type DishVerdict = 'loved' | 'not_again';
/** Bumped whenever the consent sheet's wording changes. */
export const TASTE_CONSENT_VERSION = 1;

export interface TasteConsent {
  /** Tier 1: learn from my orders and ratings (default on, with notice). */
  orders: boolean;
  /** Tier 2: taste game and profile building (opt-in). */
  learn: boolean;
  /** Tier 2: send my taste summary to the AI to answer wishes (opt-in). */
  ai: boolean;
  version: number;
  locale: Locale;
  at: string;
}

export interface TastePair { a: DishType; b: DishType; answer: PairAnswer }

export interface TasteQuiz {
  party: Party | null;
  pairs: TastePair[];
  at: string;
}

export interface TasteDoc {
  v: 1;
  /** null = never asked. */
  consent: TasteConsent | null;
  quiz: TasteQuiz | null;
  /** Knows-item keys the customer removed. */
  suppressed: string[];
  /** Set by "delete everything": older orders no longer teach. */
  ignoreOrdersBefore: string | null;
  lastAiSummary: { text: string; at: string } | null;
  updatedAt: string;
}

/** users/{uid}/dishFeedback/{orderId} */
export interface DishFeedback {
  orderId: string;
  branchId: string;
  placedAt: string;
  /** productId → verdict. */
  items: Record<string, DishVerdict>;
  /** true: this order teaches nothing. */
  forSomeoneElse: boolean;
  /** The card was closed without answers. */
  dismissed: boolean;
  updatedAt: string;
}

export type KnowsItem =
  | { key: 'party'; source: 'told'; party: Party }
  | { key: `type:${DishType}`; source: 'told'; dishType: DishType }
  | { key: `usual:${string}`; source: 'orders'; branchId: string; productId: string }
  | { key: `daypart:${Daypart}`; source: 'orders'; daypart: Daypart }
  | { key: `loved:${string}`; source: 'rated'; branchId: string; productId: string }
  | { key: `notAgain:${string}`; source: 'rated'; branchId: string; productId: string };

export type ReasonCode = 'usual' | 'ordered_before' | 'you_picked' | 'popular_now' | 'new_for_you' | 'fits_wish';

export interface UsualDish { branchId: string; productId: string; score: number }

export interface DerivedTaste {
  items: KnowsItem[];
  /** Quiz-based type affinity, already multiplied by the quiz weight. Missing types are 0. */
  affinity: Partial<Record<DishType, number>>;
  usual: UsualDish[];
  /** dishKey of every dish in a learned order. */
  orderedBefore: string[];
  loved: string[];
  notAgain: string[];
  daypart: Daypart | null;
  party: Party | null;
  /** Accepted orders that count toward learning. */
  learnedOrders: number;
}

export interface PopularRef { branchId: string; productId: string }
export type PopularDayparts = Record<Daypart, PopularRef[]>;
/** publicPopular/{cityId}: ranks only, never counts. */
export interface PublicPopular { cityId: string; dayparts: PopularDayparts; updatedAt: string }

export function dishKey(branchId: string, productId: string): string {
  return `${branchId}/${productId}`;
}

export function splitDishKey(key: string): [string, string] {
  const i = key.indexOf('/');
  return [key.slice(0, i), key.slice(i + 1)];
}

export function emptyTasteDoc(now: string): TasteDoc {
  return { v: 1, consent: null, quiz: null, suppressed: [], ignoreOrdersBefore: null, lastAiSummary: null, updatedAt: now };
}
```

`packages/shared/src/taste/daypart.ts`:
```ts
import { toLocal } from '../hours.js';
import type { Daypart } from './types.js';

/** The daypart an instant falls in, by Israeli wall-clock time. */
export function daypartOf(instant: Date): Daypart {
  const hour = Math.floor(toLocal(instant).minutes / 60);
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'noon';
  if (hour >= 16 && hour < 22) return 'evening';
  return 'late';
}
```

`packages/shared/src/taste/index.ts`:
```ts
export * from './types.js';
export * from './daypart.js';
```

`packages/shared/src/index.ts`, append after `export * from './translation.js';`:
```ts
export * from './taste/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w packages/shared -- taste-daypart`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/taste/types.ts packages/shared/src/taste/daypart.ts packages/shared/src/taste/index.ts packages/shared/src/index.ts packages/shared/test/taste-daypart.test.ts
git commit -m "taste: shared types and daypartOf

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Taste input schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append at the end)
- Test: `packages/shared/test/taste-schemas.test.ts`

**Interfaces:**
- Consumes: `PARTIES`, `PAIR_ANSWERS`, `DAYPARTS` (Task 1), `DISH_TYPES`, `idSchema`, `localeSchema`.
- Produces: `knowsKeySchema`, `tasteConsentInputSchema`, `tasteQuizInputSchema`, `saveTasteSchema`, `mergeTasteSchema`, `saveDishFeedbackSchema`, and their inferred types `SaveTasteInput`, `MergeTasteInput`, `SaveDishFeedbackInput`.

Inputs never carry `null` (see Global Constraints): clearing the quiz is `clearQuiz: true`, and undoing a verdict is `'none'`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/taste-schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { knowsKeySchema, mergeTasteSchema, saveDishFeedbackSchema, saveTasteSchema } from '../src/schemas.js';

const consent = { orders: true, learn: true, ai: false, version: 1, locale: 'ar' as const };

describe('saveTasteSchema', () => {
  it('accepts consent, a quiz and suppressed keys', () => {
    const r = saveTasteSchema.safeParse({ consent, quiz: { party: 'family', pairs: [{ a: 'burger', b: 'pizza', answer: 'b' }] }, suppressed: ['party', 'type:pizza', 'usual:br-1/p-2', 'daypart:evening'] });
    expect(r.success).toBe(true);
  });
  it('rejects a pair of the same type, more than 3 pairs, unknown types and extra fields', () => {
    expect(saveTasteSchema.safeParse({ quiz: { party: null, pairs: [{ a: 'pizza', b: 'pizza', answer: 'a' }] } }).success).toBe(false);
    const pair = { a: 'burger', b: 'pizza', answer: 'a' };
    expect(saveTasteSchema.safeParse({ quiz: { party: 'solo', pairs: [pair, pair, pair, pair] } }).success).toBe(false);
    expect(saveTasteSchema.safeParse({ quiz: { party: 'solo', pairs: [{ a: 'kebab', b: 'pizza', answer: 'a' }] } }).success).toBe(false);
    expect(saveTasteSchema.safeParse({ consent: { ...consent, allergies: ['nuts'] } }).success).toBe(false);
  });
  it('accepts a missing party (stripNulls drops null before parsing)', () => {
    expect(saveTasteSchema.safeParse({ quiz: { pairs: [] } }).success).toBe(true);
  });
  it('caps suppressed at 100', () => {
    expect(saveTasteSchema.safeParse({ suppressed: Array.from({ length: 101 }, () => 'party') }).success).toBe(false);
  });
});

describe('knowsKeySchema', () => {
  it.each(['party', 'type:sushi', 'usual:b/p', 'loved:b-1/p_1', 'notAgain:b/p', 'daypart:late'])('accepts %s', (k) => {
    expect(knowsKeySchema.safeParse(k).success).toBe(true);
  });
  it.each(['', 'usual:b', 'daypart:night', 'loved:b/p/x', 'phone:0501234567', 'type:Pizza'])('rejects %s', (k) => {
    expect(knowsKeySchema.safeParse(k).success).toBe(false);
  });
});

describe('mergeTasteSchema', () => {
  it('accepts an empty local profile and a full one', () => {
    expect(mergeTasteSchema.safeParse({ choice: 'fresh', local: {} }).success).toBe(true);
    expect(mergeTasteSchema.safeParse({ choice: 'link', local: { consent, quiz: { party: 'two', pairs: [], at: '2026-10-01T10:00:00.000Z' }, suppressed: ['party'] } }).success).toBe(true);
  });
  it('rejects an unknown choice', () => {
    expect(mergeTasteSchema.safeParse({ choice: 'both', local: {} }).success).toBe(false);
  });
});

describe('saveDishFeedbackSchema', () => {
  it('accepts verdicts including none, and the two flags', () => {
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o1', items: { p1: 'loved', p2: 'not_again', p3: 'none' }, forSomeoneElse: false, dismissed: true }).success).toBe(true);
  });
  it('rejects other verdicts, bad ids and more than 50 dishes', () => {
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o1', items: { p1: 'meh' } }).success).toBe(false);
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o/1', items: {} }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, 'loved']));
    expect(saveDishFeedbackSchema.safeParse({ orderId: 'o1', items: many }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/shared -- taste-schemas`
Expected: FAIL, the schemas are not exported.

- [ ] **Step 3: Write the implementation**

At the top of `packages/shared/src/schemas.ts`, next to the existing `import { DISH_TYPES } from './dishIndex.js';`, add:
```ts
import { PAIR_ANSWERS, PARTIES } from './taste/types.js';
```

Append to the end of `packages/shared/src/schemas.ts`:
```ts
// ---------- taste profile ----------

const dishTypeSchema = z.enum(DISH_TYPES);
const dishRefPart = '[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}';
/** A knows-item key the customer can remove (see KnowsItem). */
export const knowsKeySchema = z.string().regex(new RegExp(`^(party|type:[a-z]+|daypart:(morning|noon|evening|late)|(usual|loved|notAgain):${dishRefPart})$`));

export const tasteConsentInputSchema = z
  .object({ orders: z.boolean(), learn: z.boolean(), ai: z.boolean(), version: z.number().int().min(1).max(1000), locale: localeSchema })
  .strict();

const tastePairSchema = z
  .object({ a: dishTypeSchema, b: dishTypeSchema, answer: z.enum(PAIR_ANSWERS) })
  .strict()
  .refine((p) => p.a !== p.b, { message: 'same_type' });

/** The server sets `at`; a missing party means the question was skipped. */
export const tasteQuizInputSchema = z
  .object({ party: z.enum(PARTIES).optional(), pairs: z.array(tastePairSchema).max(3) })
  .strict();

export const saveTasteSchema = z
  .object({
    consent: tasteConsentInputSchema.optional(),
    quiz: tasteQuizInputSchema.optional(),
    /** Deletes the stored quiz. */
    clearQuiz: z.boolean().optional(),
    suppressed: z.array(knowsKeySchema).max(100).optional(),
  })
  .strict();
export type SaveTasteInput = z.infer<typeof saveTasteSchema>;

export const mergeTasteSchema = z
  .object({
    choice: z.enum(['link', 'fresh']),
    local: z
      .object({
        consent: tasteConsentInputSchema.optional(),
        quiz: tasteQuizInputSchema.extend({ at: z.string().max(40).optional() }).strict().optional(),
        suppressed: z.array(knowsKeySchema).max(100).optional(),
      })
      .strict(),
  })
  .strict();
export type MergeTasteInput = z.infer<typeof mergeTasteSchema>;

export const saveDishFeedbackSchema = z
  .object({
    orderId: idSchema,
    /** 'none' removes an earlier verdict (undo). */
    items: z.record(idSchema, z.enum(['loved', 'not_again', 'none'])).refine((items) => Object.keys(items).length <= 50, { message: 'too_many_items' }),
    forSomeoneElse: z.boolean().optional(),
    dismissed: z.boolean().optional(),
  })
  .strict();
export type SaveDishFeedbackInput = z.infer<typeof saveDishFeedbackSchema>;
```

Note for zod 4: `.extend()` on a schema built with `.strict()` keeps strictness only if `.strict()` is called again, which the code does.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w packages/shared -- taste-schemas`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w packages/shared`. Expected: no errors.
```bash
git add packages/shared/src/schemas.ts packages/shared/test/taste-schemas.test.ts
git commit -m "taste: input schemas for the taste and feedback callables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `deriveTaste`

**Files:**
- Create: `packages/shared/src/taste/derive.ts`
- Modify: `packages/shared/src/taste/index.ts` (add `export * from './derive.js';`)
- Test: `packages/shared/test/taste-derive.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `daypartOf`, `dishKey`, `splitDishKey`, `DISH_TYPES`, `OrderStatus`.
- Produces:
  - `interface TasteOrder { id: string; branchId: string; placedAt: string; status: OrderStatus; lines: Array<{ productId: string; comboId?: string; removed?: boolean }> }`. A full `Order` satisfies it.
  - `quizWeight(learnedOrders: number, quizAt: string | undefined, now: Date): number`
  - `deriveTaste(input: { doc: TasteDoc | null; orders: TasteOrder[]; feedback: DishFeedback[]; now: Date }): DerivedTaste`
  - Constants `USUAL_HALF_LIFE_DAYS = 60`, `QUIZ_MAX_AGE_DAYS = 90`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/taste-derive.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { deriveTaste, emptyTasteDoc, quizWeight, type DishFeedback, type TasteDoc, type TasteOrder } from '../src/taste/index.js';

const NOW = new Date('2026-10-06T18:00:00.000Z');
const daysAgo = (d: number, hourUtc = 17) => { const t = new Date(NOW.getTime() - d * 86_400_000); t.setUTCHours(hourUtc, 0, 0, 0); return t.toISOString(); };
let n = 0;
const order = (branchId: string, productIds: string[], placedAt: string, extra: Partial<TasteOrder> = {}): TasteOrder => ({
  id: `o${++n}`, branchId, placedAt, status: 'accepted', lines: productIds.map((productId) => ({ productId })), ...extra,
});
const doc = (over: Partial<TasteDoc> = {}): TasteDoc => ({
  ...emptyTasteDoc(NOW.toISOString()),
  consent: { orders: true, learn: true, ai: false, version: 1, locale: 'he', at: daysAgo(10) },
  ...over,
});
const fb = (o: TasteOrder, items: DishFeedback['items'], over: Partial<DishFeedback> = {}): DishFeedback => ({
  orderId: o.id, branchId: o.branchId, placedAt: o.placedAt, items, forSomeoneElse: false, dismissed: false, updatedAt: o.placedAt, ...over,
});

describe('usual dishes', () => {
  it('needs 2 orders, ranks recent ones higher, keeps the top 3', () => {
    const orders = [
      order('b1', ['pizza'], daysAgo(200)), order('b1', ['pizza'], daysAgo(190)), order('b1', ['pizza'], daysAgo(180)),
      order('b1', ['fries'], daysAgo(3)), order('b1', ['fries'], daysAgo(2)),
      order('b2', ['salad'], daysAgo(5)), order('b2', ['salad'], daysAgo(4)),
      order('b2', ['soup'], daysAgo(6)), order('b2', ['soup'], daysAgo(7)),
      order('b3', ['once'], daysAgo(1)),
    ];
    const d = deriveTaste({ doc: doc(), orders, feedback: [], now: NOW });
    expect(d.usual.map((u) => u.productId)).toEqual(['fries', 'salad', 'soup']);
    expect(d.orderedBefore).toContain('b3/once');
    expect(d.items.filter((i) => i.source === 'orders' && i.key.startsWith('usual:')).map((i) => i.key)).toEqual(['usual:b1/fries', 'usual:b2/salad', 'usual:b2/soup']);
  });

  it('counts a dish once per order and ignores combo and removed lines', () => {
    const orders = [
      order('b1', [], daysAgo(2), { lines: [{ productId: 'p' }, { productId: 'p' }, { productId: 'c', comboId: 'combo1' }, { productId: 'r', removed: true }] }),
      order('b1', [], daysAgo(1), { lines: [{ productId: 'c', comboId: 'combo1' }, { productId: 'r', removed: true }] }),
    ];
    const d = deriveTaste({ doc: doc(), orders, feedback: [], now: NOW });
    expect(d.usual).toEqual([]);
    expect(d.orderedBefore).toEqual(['b1/p']);
  });

  it('ignores rejected and placed orders', () => {
    const orders = [order('b1', ['p'], daysAgo(2), { status: 'rejected' }), order('b1', ['p'], daysAgo(1), { status: 'placed' })];
    expect(deriveTaste({ doc: doc(), orders, feedback: [], now: NOW }).learnedOrders).toBe(0);
  });
});

describe('what stops learning', () => {
  const orders = () => [order('b1', ['p'], daysAgo(3)), order('b1', ['p'], daysAgo(2)), order('b1', ['p'], daysAgo(1))];

  it('orders consent off: nothing from orders or ratings', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc({ consent: { orders: false, learn: true, ai: false, version: 1, locale: 'he', at: daysAgo(1) } }), orders: os, feedback: [fb(os[0]!, { p: 'loved' })], now: NOW });
    expect(d.learnedOrders).toBe(0);
    expect(d.usual).toEqual([]);
    expect(d.loved).toEqual([]);
  });

  it('never-asked consent still learns from orders (tier 1 is on by default)', () => {
    expect(deriveTaste({ doc: null, orders: orders(), feedback: [], now: NOW }).usual).toHaveLength(1);
    expect(deriveTaste({ doc: emptyTasteDoc(NOW.toISOString()), orders: orders(), feedback: [], now: NOW }).usual).toHaveLength(1);
  });

  it('ignoreOrdersBefore drops older orders and their ratings', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc({ ignoreOrdersBefore: daysAgo(1, 0) }), orders: os, feedback: [fb(os[0]!, { p: 'not_again' })], now: NOW });
    expect(d.learnedOrders).toBe(1);
    expect(d.notAgain).toEqual([]);
  });

  it('forSomeoneElse feedback removes that order', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc(), orders: os, feedback: [fb(os[0]!, {}, { forSomeoneElse: true })], now: NOW });
    expect(d.learnedOrders).toBe(2);
  });

  it('suppressed keys hide items and their effect', () => {
    const os = orders();
    const d = deriveTaste({ doc: doc({ suppressed: ['usual:b1/p', 'daypart:evening'] }), orders: os, feedback: [], now: NOW });
    expect(d.usual).toEqual([]);
    expect(d.daypart).toBeNull();
    expect(d.items).toEqual([]);
  });
});

describe('ratings', () => {
  it('the newest verdict per dish wins, and not-again dishes are never usual', () => {
    const a = order('b1', ['p', 'q'], daysAgo(3));
    const b = order('b1', ['p', 'q'], daysAgo(1));
    const d = deriveTaste({ doc: doc(), orders: [a, b], feedback: [fb(a, { p: 'loved', q: 'loved' }), fb(b, { q: 'not_again' })], now: NOW });
    expect(d.loved).toEqual(['b1/p']);
    expect(d.notAgain).toEqual(['b1/q']);
    expect(d.usual.map((u) => u.productId)).toEqual(['p']);
    expect(d.items.map((i) => i.key)).toEqual(expect.arrayContaining(['loved:b1/p', 'notAgain:b1/q']));
  });
});

describe('usual daypart', () => {
  it('needs 3 orders and a 60% share', () => {
    // 17:00 UTC in October is 20:00 in Israel: evening.
    const two = [order('b', ['x'], daysAgo(2)), order('b', ['y'], daysAgo(1))];
    expect(deriveTaste({ doc: doc(), orders: two, feedback: [], now: NOW }).daypart).toBeNull();
    const mixed = [order('b', ['x'], daysAgo(3)), order('b', ['x'], daysAgo(2, 9)), order('b', ['x'], daysAgo(1, 6))];
    expect(deriveTaste({ doc: doc(), orders: mixed, feedback: [], now: NOW }).daypart).toBeNull();
    const evenings = [...two, order('b', ['z'], daysAgo(3)), order('b', ['z'], daysAgo(4, 9))];
    const d = deriveTaste({ doc: doc(), orders: evenings, feedback: [], now: NOW });
    expect(d.daypart).toBe('evening');
    expect(d.items).toContainEqual({ key: 'daypart:evening', source: 'orders', daypart: 'evening' });
  });
});

describe('quiz', () => {
  const quiz = { party: 'family' as const, pairs: [{ a: 'burger' as const, b: 'pizza' as const, answer: 'b' as const }, { a: 'pasta' as const, b: 'mains' as const, answer: 'both' as const }, { a: 'sushi' as const, b: 'hummus' as const, answer: 'neither' as const }], at: daysAgo(5) };

  it('scores picks, both and neither, and lists told items', () => {
    const d = deriveTaste({ doc: doc({ quiz }), orders: [], feedback: [], now: NOW });
    expect(d.affinity).toEqual({ pizza: 1, pasta: 0.5, mains: 0.5, sushi: -0.5, hummus: -0.5 });
    expect(d.party).toBe('family');
    expect(d.items.filter((i) => i.source === 'told').map((i) => i.key)).toEqual(['party', 'type:pizza', 'type:pasta', 'type:mains']);
  });

  it('is ignored when learn consent is off', () => {
    const d = deriveTaste({ doc: doc({ quiz, consent: { orders: true, learn: false, ai: false, version: 1, locale: 'he', at: daysAgo(1) } }), orders: [], feedback: [], now: NOW });
    expect(d.affinity).toEqual({});
    expect(d.party).toBeNull();
    expect(d.items).toEqual([]);
  });

  it('a suppressed type keeps its item hidden and its weight at 0', () => {
    const d = deriveTaste({ doc: doc({ quiz, suppressed: ['type:pizza', 'party'] }), orders: [], feedback: [], now: NOW });
    expect(d.affinity.pizza).toBeUndefined();
    expect(d.party).toBeNull();
    expect(d.items.map((i) => i.key)).toEqual(['type:pasta', 'type:mains']);
  });

  it('fades with orders and age', () => {
    expect(quizWeight(0, daysAgo(1), NOW)).toBe(1);
    expect(quizWeight(2, daysAgo(1), NOW)).toBe(1);
    expect(quizWeight(3, daysAgo(1), NOW)).toBe(0.5);
    expect(quizWeight(9, daysAgo(1), NOW)).toBe(0.5);
    expect(quizWeight(10, daysAgo(1), NOW)).toBe(0);
    expect(quizWeight(0, daysAgo(91), NOW)).toBe(0);
    expect(quizWeight(0, undefined, NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/shared -- taste-derive`
Expected: FAIL, `deriveTaste` is not exported.

- [ ] **Step 3: Write the implementation**

`packages/shared/src/taste/derive.ts`:
```ts
import { DISH_TYPES, type DishType } from '../dishIndex.js';
import type { OrderStatus } from '../types.js';
import { daypartOf } from './daypart.js';
import { dishKey, splitDishKey, type Daypart, type DerivedTaste, type DishFeedback, type DishVerdict, type KnowsItem, type TasteDoc } from './types.js';

/** The parts of an order the profile learns from; a full Order satisfies it. */
export interface TasteOrder {
  id: string;
  branchId: string;
  placedAt: string;
  status: OrderStatus;
  lines: Array<{ productId: string; comboId?: string; removed?: boolean }>;
}

const DAY = 86_400_000;
export const USUAL_HALF_LIFE_DAYS = 60;
export const QUIZ_MAX_AGE_DAYS = 90;

/** How much the quiz still counts: real orders take over as they arrive, and the quiz expires. */
export function quizWeight(learnedOrders: number, quizAt: string | undefined, now: Date): number {
  if (!quizAt) return 0;
  if (now.getTime() - Date.parse(quizAt) > QUIZ_MAX_AGE_DAYS * DAY) return 0;
  if (learnedOrders <= 2) return 1;
  if (learnedOrders <= 9) return 0.5;
  return 0;
}

/** Dishes a line set teaches: once per order, never combos or lines removed by a revision. */
function taughtProducts(lines: TasteOrder['lines']): string[] {
  return [...new Set(lines.filter((l) => !l.comboId && !l.removed).map((l) => l.productId))];
}

/**
 * Everything Qareeb believes about one customer, from the stored doc, their orders and their dish
 * feedback. Pure, so the browser (home band, knows-me page) and the server (wishes) always agree.
 */
export function deriveTaste(input: { doc: TasteDoc | null; orders: TasteOrder[]; feedback: DishFeedback[]; now: Date }): DerivedTaste {
  const { doc, now } = input;
  const suppressed = new Set(doc?.suppressed ?? []);
  // Tier 1 is on by default, so a profile that was never asked still learns from orders.
  const useOrders = doc?.consent?.orders ?? true;
  const quiz = doc?.consent?.learn === true ? doc.quiz : null;
  const cutoff = doc?.ignoreOrdersBefore ? Date.parse(doc.ignoreOrdersBefore) : -Infinity;
  const someoneElse = new Set(input.feedback.filter((f) => f.forSomeoneElse).map((f) => f.orderId));

  const orders = useOrders
    ? input.orders.filter((o) => o.status === 'accepted' && Date.parse(o.placedAt) >= cutoff && !someoneElse.has(o.id))
    : [];

  // Ratings: the newest verdict per dish wins.
  const verdicts = new Map<string, DishVerdict>();
  if (useOrders) {
    const rated = input.feedback.filter((f) => !f.forSomeoneElse && Date.parse(f.placedAt) >= cutoff).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const f of rated) for (const [productId, verdict] of Object.entries(f.items)) verdicts.set(dishKey(f.branchId, productId), verdict);
  }
  const loved: string[] = [];
  const notAgain: string[] = [];
  for (const [key, verdict] of verdicts) {
    if (verdict === 'loved' && !suppressed.has(`loved:${key}`)) loved.push(key);
    if (verdict === 'not_again' && !suppressed.has(`notAgain:${key}`)) notAgain.push(key);
  }
  const notAgainSet = new Set(notAgain);

  // Usual: recency-weighted order frequency.
  const stats = new Map<string, { orders: number; score: number }>();
  for (const o of orders) {
    const ageDays = Math.max(0, now.getTime() - Date.parse(o.placedAt)) / DAY;
    const weight = Math.pow(0.5, ageDays / USUAL_HALF_LIFE_DAYS);
    for (const productId of taughtProducts(o.lines)) {
      const key = dishKey(o.branchId, productId);
      const s = stats.get(key) ?? { orders: 0, score: 0 };
      s.orders += 1;
      s.score += weight;
      stats.set(key, s);
    }
  }
  const usual = [...stats.entries()]
    .filter(([key, s]) => s.orders >= 2 && !notAgainSet.has(key) && !suppressed.has(`usual:${key}`))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, s]) => {
      const [branchId, productId] = splitDishKey(key);
      return { branchId, productId, score: s.score };
    });

  // Usual time of day.
  let daypart: Daypart | null = null;
  if (orders.length >= 3) {
    const counts = new Map<Daypart, number>();
    for (const o of orders) {
      const d = daypartOf(new Date(o.placedAt));
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    for (const [d, count] of counts) if (count / orders.length >= 0.6 && !suppressed.has(`daypart:${d}`)) daypart = d;
  }

  // Quiz.
  const told: Partial<Record<DishType, number>> = {};
  const add = (t: DishType, v: number) => { told[t] = (told[t] ?? 0) + v; };
  for (const p of quiz?.pairs ?? []) {
    if (p.answer === 'a') add(p.a, 1);
    else if (p.answer === 'b') add(p.b, 1);
    else if (p.answer === 'both') { add(p.a, 0.5); add(p.b, 0.5); }
    else { add(p.a, -0.5); add(p.b, -0.5); }
  }
  const weight = quizWeight(orders.length, quiz?.at, now);
  const affinity: Partial<Record<DishType, number>> = {};
  for (const t of DISH_TYPES) {
    const raw = told[t];
    if (raw === undefined || raw === 0 || weight === 0 || suppressed.has(`type:${t}`)) continue;
    affinity[t] = raw * weight;
  }
  const party = quiz?.party && !suppressed.has('party') ? quiz.party : null;

  const items: KnowsItem[] = [];
  if (party) items.push({ key: 'party', source: 'told', party });
  // Told types keep their order of appearance in the quiz.
  for (const p of quiz?.pairs ?? []) {
    for (const t of [p.a, p.b]) {
      if ((told[t] ?? 0) > 0 && !suppressed.has(`type:${t}`) && !items.some((i) => i.key === `type:${t}`)) items.push({ key: `type:${t}`, source: 'told', dishType: t });
    }
  }
  for (const u of usual) items.push({ key: `usual:${dishKey(u.branchId, u.productId)}`, source: 'orders', branchId: u.branchId, productId: u.productId });
  if (daypart) items.push({ key: `daypart:${daypart}`, source: 'orders', daypart });
  for (const key of loved) { const [branchId, productId] = splitDishKey(key); items.push({ key: `loved:${key}`, source: 'rated', branchId, productId }); }
  for (const key of notAgain) { const [branchId, productId] = splitDishKey(key); items.push({ key: `notAgain:${key}`, source: 'rated', branchId, productId }); }

  return { items, affinity, usual, orderedBefore: [...stats.keys()], loved, notAgain, daypart, party, learnedOrders: orders.length };
}
```

Note: the told-items order in the test (`party`, `type:pizza`, `type:pasta`, `type:mains`) comes from walking the pairs in order; `sushi` and `hummus` are negative, so they are not listed.

Add to `packages/shared/src/taste/index.ts`:
```ts
export * from './derive.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w packages/shared -- taste-derive`
Expected: PASS. If the "usual daypart" mixed case fails, check that `daysAgo(2, 9)` (12:00 Israel, noon) and `daysAgo(1, 6)` (09:00 Israel, morning) really differ from evening; they do in October (UTC+3).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w packages/shared`. Expected: no errors.
```bash
git add packages/shared/src/taste/derive.ts packages/shared/src/taste/index.ts packages/shared/test/taste-derive.test.ts
git commit -m "taste: deriveTaste (usual dishes, daypart, ratings, quiz affinity)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Popularity ranking (pure)

**Files:**
- Create: `packages/shared/src/taste/popular.ts`
- Modify: `packages/shared/src/taste/index.ts` (add `export * from './popular.js';`)
- Test: `packages/shared/test/taste-popular.test.ts`

**Interfaces:**
- Consumes: `DAYPARTS`, `Daypart`, `PopularDayparts` (Task 1).
- Produces: `POPULAR_MIN_ORDERS = 3`, `POPULAR_TOP = 12`, `POPULAR_WINDOW_DAYS = 28`, `popularCountKey(daypart: Daypart, branchId: string, productId: string): string`, `sumCounts(docs: Array<Record<string, number> | undefined>): Record<string, number>`, `rankPopular(counts: Record<string, number>): PopularDayparts`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/taste-popular.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { popularCountKey, rankPopular, sumCounts } from '../src/taste/index.js';

describe('popularity', () => {
  it('builds stable count keys', () => {
    expect(popularCountKey('evening', 'br-1', 'p_1')).toBe('evening|br-1|p_1');
  });

  it('sums daily docs, skipping missing days', () => {
    expect(sumCounts([{ 'evening|b|p': 2 }, undefined, { 'evening|b|p': 1, 'noon|b|q': 4 }])).toEqual({ 'evening|b|p': 3, 'noon|b|q': 4 });
  });

  it('keeps dishes with 3+ orders, ranks by count then id, top 12 per daypart, ranks only', () => {
    const counts: Record<string, number> = { 'evening|b|low': 2, 'evening|b|mid': 5, 'evening|a|tie': 7, 'evening|b|tie': 7, 'noon|c|x': 3, 'bogus|b|p': 9, 'late|onlybranch': 9 };
    for (let i = 0; i < 15; i++) counts[`morning|m|p${String(i).padStart(2, '0')}`] = 3 + i;
    const r = rankPopular(counts);
    expect(r.evening).toEqual([{ branchId: 'a', productId: 'tie' }, { branchId: 'b', productId: 'tie' }, { branchId: 'b', productId: 'mid' }]);
    expect(r.noon).toEqual([{ branchId: 'c', productId: 'x' }]);
    expect(r.late).toEqual([]);
    expect(r.morning).toHaveLength(12);
    expect(r.morning[0]).toEqual({ branchId: 'm', productId: 'p14' });
    // Privacy: every published entry is a bare ref, never a count.
    const shapes = Object.values(r).flat().map((ref) => Object.keys(ref).sort().join(','));
    expect(new Set(shapes)).toEqual(new Set(['branchId,productId']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w packages/shared -- taste-popular`
Expected: FAIL, `rankPopular` is not exported.

- [ ] **Step 3: Write the implementation**

`packages/shared/src/taste/popular.ts`:
```ts
import { DAYPARTS, type Daypart, type PopularDayparts } from './types.js';

/** A dish must appear in this many orders over the window before it is shown as popular. */
export const POPULAR_MIN_ORDERS = 3;
export const POPULAR_TOP = 12;
export const POPULAR_WINDOW_DAYS = 28;

/** Key in popularityDaily.counts. Branch and product ids never contain "|". */
export function popularCountKey(daypart: Daypart, branchId: string, productId: string): string {
  return `${daypart}|${branchId}|${productId}`;
}

export function sumCounts(docs: Array<Record<string, number> | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of docs) for (const [k, v] of Object.entries(d ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Ranks only: the published document never carries a count. */
export function rankPopular(counts: Record<string, number>): PopularDayparts {
  const out: PopularDayparts = { morning: [], noon: [], evening: [], late: [] };
  const rows: Array<{ daypart: Daypart; branchId: string; productId: string; n: number }> = [];
  for (const [key, n] of Object.entries(counts)) {
    const [daypart, branchId, productId] = key.split('|');
    if (!daypart || !branchId || !productId || !(DAYPARTS as readonly string[]).includes(daypart) || n < POPULAR_MIN_ORDERS) continue;
    rows.push({ daypart: daypart as Daypart, branchId, productId, n });
  }
  rows.sort((a, b) => b.n - a.n || a.branchId.localeCompare(b.branchId) || a.productId.localeCompare(b.productId));
  for (const r of rows) {
    const list = out[r.daypart];
    if (list.length < POPULAR_TOP) list.push({ branchId: r.branchId, productId: r.productId });
  }
  return out;
}
```

Add to `packages/shared/src/taste/index.ts`:
```ts
export * from './popular.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w packages/shared -- taste-popular`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/taste/popular.ts packages/shared/src/taste/index.ts packages/shared/test/taste-popular.test.ts
git commit -m "taste: popularity ranking, ranks only with a 3-order floor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Firestore paths, rules and data-model docs

**Files:**
- Modify: `functions/src/lib/firebase.ts` (the `col` object), `firestore.rules`, `docs/DATA_MODEL.md`
- Test: `tests/rules/firestore.test.ts` (append a `describe`)

**Interfaces:**
- Produces on `col`: `taste(uid)` → `users/{uid}/taste/profile`, `dishFeedback(uid)` → `users/{uid}/dishFeedback`, `popularityDaily(id)` → `popularityDaily/{id}`, `popularityDays()` → `popularityDaily`, `publicPopular(cityId)` → `publicPopular/{cityId}`.

- [ ] **Step 1: Write the failing rules test**

Append to `tests/rules/firestore.test.ts`:
```ts
describe('taste profile', () => {
  beforeAll(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users/cust1/taste/profile'), { v: 1, consent: null });
      await setDoc(doc(db, 'users/cust1/dishFeedback/o1'), { orderId: 'o1', items: {} });
      await setDoc(doc(db, 'publicPopular/beit-jann'), { cityId: 'beit-jann', dayparts: {} });
      await setDoc(doc(db, 'popularityDaily/beit-jann_2026-10-06'), { counts: { 'evening|b|p': 4 } });
    });
  });

  it('the owner reads their own taste and feedback; nobody else does; nobody writes', async () => {
    await assertSucceeds(getDoc(doc(as('cust1'), 'users/cust1/taste/profile')));
    await assertSucceeds(getDoc(doc(as('cust1'), 'users/cust1/dishFeedback/o1')));
    await assertSucceeds(getDocs(collection(as('cust1'), 'users/cust1/dishFeedback')));
    await assertFails(getDoc(doc(as('cust2'), 'users/cust1/taste/profile')));
    await assertFails(getDoc(doc(as('cust2'), 'users/cust1/dishFeedback/o1')));
    await assertFails(getDoc(doc(anon(), 'users/cust1/taste/profile')));
    await assertFails(getDoc(doc(as('susp'), 'users/susp/taste/profile')));
    await assertFails(setDoc(doc(as('cust1'), 'users/cust1/taste/profile'), { v: 1, consent: null }));
    await assertFails(setDoc(doc(as('cust1'), 'users/cust1/dishFeedback/o2'), { orderId: 'o2' }));
    await assertFails(deleteDoc(doc(as('cust1'), 'users/cust1/dishFeedback/o1')));
  });

  it('popular ranks are public and server-written; raw counts are server-only', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'publicPopular/beit-jann')));
    await assertFails(setDoc(doc(as('admin', { admin: true }), 'publicPopular/beit-jann'), { dayparts: {} }));
    await assertFails(getDoc(doc(anon(), 'popularityDaily/beit-jann_2026-10-06')));
    await assertFails(getDoc(doc(as('admin', { admin: true }), 'popularityDaily/beit-jann_2026-10-06')));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (emulators running, see "How to run tests"): `env -u HTTPS_PROXY -u https_proxy npm run test -w tests/rules`
Expected: FAIL on the owner reads and the `publicPopular` read (both denied by the catch-all).

- [ ] **Step 3: Write the rules**

In `firestore.rules`, inside `match /users/{userId} { ... }`, after the `favorites` block, add:
```
      // Taste profile and dish feedback: written only by the taste callables.
      match /taste/{docId} {
        allow read: if activeUser() && uid() == userId;
        allow write: if false;
      }
      match /dishFeedback/{orderId} {
        allow read: if activeUser() && uid() == userId;
        allow write: if false;
      }
```
After the line `match /config/platform { allow read: if true; allow write: if false; }`, add:
```
    // Popular dishes per city and daypart: ranks only, published hourly. Raw counts
    // (popularityDaily) stay server-only through the catch-all deny.
    match /publicPopular/{cityId} { allow read: if true; allow write: if false; }
```

In `functions/src/lib/firebase.ts`, inside `col`, after the `favorites` entry, add:
```ts
  /** The customer's taste profile (one doc) and per-order dish feedback; see packages/shared/src/taste. */
  taste: (uid: string) => db.collection('users').doc(uid).collection('taste').doc('profile'),
  dishFeedback: (uid: string) => db.collection('users').doc(uid).collection('dishFeedback'),
```
and after the `metricsDaily` entry:
```ts
  /** `${cityId}_${YYYY-MM-DD}`: private per-day dish counts, kept 28 days. */
  popularityDaily: (id: string) => db.collection('popularityDaily').doc(id),
  popularityDays: () => db.collection('popularityDaily'),
  publicPopular: (cityId: string) => db.collection('publicPopular').doc(cityId),
```

In `docs/DATA_MODEL.md`, add rows to the collections table next to `metricsDaily` (same column order: path, writer, reader, contents):
```
| `users/{uid}/taste/profile` | server (taste callables) | owner | Taste profile: consent, quiz, removed items |
| `users/{uid}/dishFeedback/{orderId}` | server (`saveDishFeedback`) | owner | Loved / not-again per dish of one order |
| `popularityDaily/{cityId}_{yyyy-mm-dd}` | server (outbox `order_accepted`) | nobody | Orders per daypart and dish; deleted after 28 days |
| `publicPopular/{cityId}` | server (`popularityHourly`) | public | Top 12 dishes per daypart, ranks only |
```

- [ ] **Step 4: Run the rules tests to verify they pass**

Run: `env -u HTTPS_PROXY -u https_proxy npm run test -w tests/rules`
Expected: PASS, including every earlier test.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w functions`. Expected: no errors.
```bash
git add firestore.rules tests/rules/firestore.test.ts functions/src/lib/firebase.ts docs/DATA_MODEL.md
git commit -m "taste: Firestore paths and rules for taste, feedback and popular ranks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `saveTaste`, `mergeTaste`, `deleteTaste`

**Files:**
- Create: `functions/src/domain/taste.ts`
- Modify: `functions/src/index.ts` (export the callables)
- Test: `functions/test/taste.test.ts`

**Interfaces:**
- Consumes: `saveTasteSchema`, `mergeTasteSchema`, `emptyTasteDoc`, `TasteDoc`, `TasteQuiz` (Tasks 1–2); `col.taste`, `col.dishFeedback` (Task 5); `requireCaller`, `rateLimit`, `parse`, `handled`, `fail`, `commitInChunks`, `nowIso`.
- Produces callables. Each returns `{ taste: TasteDoc }`.
  - `saveTaste(SaveTasteInput)`
  - `mergeTaste(MergeTasteInput)`
  - `deleteTaste({})`

Behaviour:
- **`saveTaste`**:
  - Consent comes in without `at`; the server stamps it.
  - A quiz is accepted only when the resulting consent has `learn: true`, otherwise it fails with `invalid_argument` / `learn_consent_required`.
  - Whenever the resulting `learn` is not true, the quiz is deleted.
  - Whenever `ai` is not true, `lastAiSummary` is deleted.
  - `suppressed` replaces the list, de-duplicated.
- **`mergeTaste`**:
  - `link` on an empty doc (none, or consent and quiz both null) copies the local consent and the quiz (the quiz only if `learn`).
  - `link` always unions `suppressed`, keeping at most 100 keys.
  - `fresh` only makes sure a doc exists.
  - The quiz keeps its local `at` when that time is valid, not in the future and under 90 days old; otherwise it uses now.
- **`deleteTaste`**: deletes all dish feedback, then writes a fresh doc that keeps consent, with `ignoreOrdersBefore` set to now.
- All three: signed in (`requireCaller`), rate limited to 60 calls per hour per user.

- [ ] **Step 1: Write the failing test**

`functions/test/taste.test.ts`:
```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { admin, asGuest, asUid, expectCode, type Client } from './harness.js';

type Taste = { consent: null | { orders: boolean; learn: boolean; ai: boolean; at: string }; quiz: null | { party?: string; pairs: unknown[]; at: string }; suppressed: string[]; ignoreOrdersBefore: string | null; lastAiSummary: unknown };
const consent = (over: Partial<{ orders: boolean; learn: boolean; ai: boolean }> = {}) => ({ orders: true, learn: true, ai: true, version: 1, locale: 'he', ...over });
const quiz = { party: 'family', pairs: [{ a: 'burger', b: 'pizza', answer: 'b' }] };
const tasteDoc = async (uid: string) => (await admin.db.doc(`users/${uid}/taste/profile`).get()).data() as Taste | undefined;

// Fresh uids per run: these tests must not depend on seed customers' state.
const UID_A = `taste-a-${Date.now()}`;
const UID_B = `taste-b-${Date.now()}`;
let a: Client;
let b: Client;
beforeAll(async () => { [a, b] = await Promise.all([asUid(UID_A), asUid(UID_B)]); });
afterAll(async () => { await Promise.all([a.close(), b.close()]); });

describe('saveTaste', () => {
  it('needs sign-in', async () => {
    const guest = await asGuest();
    expect(await expectCode(guest.call('saveTaste', { consent: consent() }))).toBe('unauthenticated');
    await guest.close();
  });

  it('stamps consent with server time and stores the quiz', async () => {
    const before = Date.now();
    const { taste } = await a.call<{ taste: Taste }>('saveTaste', { consent: consent(), quiz });
    expect(Date.parse(taste.consent!.at)).toBeGreaterThanOrEqual(before - 5000);
    expect(taste.quiz).toMatchObject({ party: 'family', pairs: quiz.pairs });
    expect(await tasteDoc(UID_A)).toMatchObject({ v: 1, quiz: { party: 'family' } });
  });

  it('refuses a quiz without learn consent', async () => {
    expect(await expectCode(b.call('saveTaste', { consent: consent({ learn: false }), quiz }))).toBe('invalid_argument');
    expect((await tasteDoc(UID_B))?.quiz ?? null).toBeNull();
  });

  it('withdrawing learn deletes the quiz; withdrawing ai deletes the last AI summary', async () => {
    await admin.db.doc(`users/${UID_A}/taste/profile`).set({ lastAiSummary: { text: 'משפחה', at: new Date().toISOString() } }, { merge: true });
    const { taste } = await a.call<{ taste: Taste }>('saveTaste', { consent: consent({ learn: false, ai: false }) });
    expect(taste.quiz).toBeNull();
    expect(taste.lastAiSummary).toBeNull();
    expect((await tasteDoc(UID_A))!.quiz).toBeNull();
  });

  it('clearQuiz removes the quiz and suppressed keys are de-duplicated', async () => {
    await a.call('saveTaste', { consent: consent(), quiz });
    const { taste } = await a.call<{ taste: Taste }>('saveTaste', { clearQuiz: true, suppressed: ['party', 'party', 'type:pizza'] });
    expect(taste.quiz).toBeNull();
    expect(taste.suppressed).toEqual(['party', 'type:pizza']);
  });

  it('rejects allergies and unknown keys', async () => {
    expect(await expectCode(a.call('saveTaste', { allergies: ['nuts'] }))).toBe('invalid_argument');
    expect(await expectCode(a.call('saveTaste', { suppressed: ['phone:0501234567'] }))).toBe('invalid_argument');
  });
});

describe('mergeTaste', () => {
  it('link copies local consent and quiz into an empty profile, and a retry changes nothing', async () => {
    const uid = `taste-merge-${Date.now()}`;
    const c = await asUid(uid);
    const local = { consent: consent({ ai: false }), quiz: { ...quiz, at: new Date(Date.now() - 3 * 86_400_000).toISOString() }, suppressed: ['type:burger'] };
    const first = (await c.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local })).taste;
    expect(first.consent).toMatchObject({ orders: true, learn: true, ai: false });
    expect(first.quiz!.at).toBe(local.quiz.at);
    expect(first.suppressed).toEqual(['type:burger']);
    const retry = (await c.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local: { ...local, consent: consent({ learn: false }) } })).taste;
    expect(retry.consent).toEqual(first.consent);
    expect(retry.quiz).toEqual(first.quiz);
    expect(retry.suppressed).toEqual(['type:burger']);
    await c.close();
  });

  it('link into an existing profile only adds suppressed keys', async () => {
    const { taste } = await a.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local: { consent: consent({ orders: false }), suppressed: ['daypart:late'] } });
    expect(taste.consent!.orders).toBe(true);
    expect(taste.suppressed).toContain('daypart:late');
  });

  it('a quiz time in the future becomes now', async () => {
    const uid = `taste-future-${Date.now()}`;
    const c = await asUid(uid);
    const { taste } = await c.call<{ taste: Taste }>('mergeTaste', { choice: 'link', local: { consent: consent(), quiz: { ...quiz, at: '2099-01-01T00:00:00.000Z' } } });
    expect(Date.parse(taste.quiz!.at)).toBeLessThanOrEqual(Date.now() + 5000);
    await c.close();
  });

  it('fresh creates an empty profile and ignores the local one', async () => {
    const uid = `taste-fresh-${Date.now()}`;
    const c = await asUid(uid);
    const { taste } = await c.call<{ taste: Taste }>('mergeTaste', { choice: 'fresh', local: { consent: consent(), quiz } });
    expect(taste).toMatchObject({ consent: null, quiz: null, suppressed: [] });
    await c.close();
  });
});

describe('deleteTaste', () => {
  it('deletes feedback, clears the quiz and suppressed keys, keeps consent, and stops older orders teaching', async () => {
    await a.call('saveTaste', { consent: consent(), quiz, suppressed: ['party'] });
    await admin.db.doc(`users/${UID_A}/dishFeedback/fake-order`).set({ orderId: 'fake-order', items: { p: 'loved' } });
    const before = Date.now();
    const { taste } = await a.call<{ taste: Taste }>('deleteTaste', {});
    expect(taste.consent).toMatchObject({ learn: true });
    expect(taste.quiz).toBeNull();
    expect(taste.suppressed).toEqual([]);
    expect(Date.parse(taste.ignoreOrdersBefore!)).toBeGreaterThanOrEqual(before - 5000);
    expect((await admin.db.collection(`users/${UID_A}/dishFeedback`).get()).empty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- taste.test`
Expected: FAIL, with `not-found` / internal errors because `saveTaste` does not exist.

- [ ] **Step 3: Write the implementation**

`functions/src/domain/taste.ts`:
```ts
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { emptyTasteDoc, mergeTasteSchema, saveTasteSchema, type TasteDoc } from '@qareeb/shared';
import { REGION, col, commitInChunks, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';

const opts = { region: REGION } as const;
const QUIZ_MAX_AGE_MS = 90 * 86_400_000;

/** Learn and AI consent are what allow a quiz and an AI summary to be kept at all. */
function enforceConsent(doc: TasteDoc): void {
  if (doc.consent?.learn !== true) doc.quiz = null;
  if (doc.consent?.ai !== true) doc.lastAiSummary = null;
}

/** A device's quiz time is kept when believable; otherwise the quiz counts from now. */
function quizAt(at: string | undefined, now: string): string {
  const t = at ? Date.parse(at) : NaN;
  const n = Date.parse(now);
  return Number.isFinite(t) && t <= n && n - t < QUIZ_MAX_AGE_MS ? new Date(t).toISOString() : now;
}

/**
 * Consent, quiz and removed items for the signed-in customer. The client never writes the taste doc;
 * this callable checks that a quiz is only kept with learn consent.
 */
export const saveTaste = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(saveTasteSchema, req.data);
  await rateLimit(`taste:${c.uid}`, 60, 3600);
  const ref = col.taste(c.uid);
  const taste = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const doc: TasteDoc = snap.exists ? (snap.data() as TasteDoc) : emptyTasteDoc(now);
    if (input.consent) doc.consent = { ...input.consent, at: now };
    if (input.clearQuiz) doc.quiz = null;
    if (input.quiz) {
      if (doc.consent?.learn !== true) fail('invalid_argument', { issues: [{ path: 'quiz', message: 'learn_consent_required' }] });
      doc.quiz = { party: input.quiz.party ?? null, pairs: input.quiz.pairs, at: now };
    }
    if (input.suppressed) doc.suppressed = [...new Set(input.suppressed)].slice(0, 100);
    enforceConsent(doc);
    doc.updatedAt = now;
    tx.set(ref, doc);
    return doc;
  });
  return { taste };
}));

/** Right after sign-in: keep the picks made on this device ("link") or start from the account ("fresh"). */
export const mergeTaste = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(mergeTasteSchema, req.data);
  await rateLimit(`taste:${c.uid}`, 60, 3600);
  const ref = col.taste(c.uid);
  const taste = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const existing = snap.exists ? (snap.data() as TasteDoc) : null;
    const doc: TasteDoc = existing ?? emptyTasteDoc(now);
    if (input.choice === 'link') {
      const empty = !existing || (existing.consent === null && existing.quiz === null);
      if (empty && input.local.consent) {
        doc.consent = { ...input.local.consent, at: now };
        const q = input.local.quiz;
        if (q && doc.consent.learn) doc.quiz = { party: q.party ?? null, pairs: q.pairs, at: quizAt(q.at, now) };
      }
      doc.suppressed = [...new Set([...doc.suppressed, ...(input.local.suppressed ?? [])])].slice(0, 100);
    }
    enforceConsent(doc);
    doc.updatedAt = now;
    tx.set(ref, doc);
    return doc;
  });
  return { taste };
}));

/** "Delete everything Qareeb learned": feedback goes, the quiz goes, and older orders stop teaching. */
export const deleteTaste = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  parse(z.object({}).strict(), req.data ?? {});
  await rateLimit(`taste:${c.uid}`, 60, 3600);
  const feedback = await col.dishFeedback(c.uid).select().get();
  await commitInChunks(feedback.docs.map((d) => (batch) => batch.delete(d.ref)));
  const ref = col.taste(c.uid);
  const taste = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    const prev = snap.exists ? (snap.data() as TasteDoc) : null;
    const doc: TasteDoc = { ...emptyTasteDoc(now), consent: prev?.consent ?? null, ignoreOrdersBefore: now };
    tx.set(ref, doc);
    return doc;
  });
  return { taste };
}));
```

In `functions/src/index.ts`, after the `posts.js` export line, add:
```ts
export { saveTaste, mergeTaste, deleteTaste, saveDishFeedback } from './domain/taste.js';
```
(`saveDishFeedback` comes in Task 7. Until then, write the line without it and add it in Task 7.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- taste.test`
Expected: PASS for the `saveTaste`, `mergeTaste` and `deleteTaste` describes.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npm run typecheck -w functions && npx eslint functions/src/domain/taste.ts functions/test/taste.test.ts`. Expected: no errors.
```bash
git add functions/src/domain/taste.ts functions/src/index.ts functions/test/taste.test.ts
git commit -m "taste: saveTaste, mergeTaste and deleteTaste callables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `saveDishFeedback`

**Files:**
- Modify: `functions/src/domain/taste.ts` (add the callable), `functions/src/index.ts` (add it to the export line)
- Test: `functions/test/taste.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `saveDishFeedbackSchema`, `DishFeedback`, `Order`, `col.order`, `col.dishFeedback`.
- Produces: callable `saveDishFeedback(SaveDishFeedbackInput) → { feedback: DishFeedback }`.

Behaviour:
- The order must exist and belong to the caller. Otherwise it fails with `not_found`, the same code for both cases, so order ids do not leak.
- It must be `accepted`, otherwise `invalid_argument` / `order_not_accepted`.
- Every rated product must be on a non-combo, non-removed line, otherwise `invalid_argument` / `not_in_order`.
- Verdicts merge into the existing doc. `'none'` removes a verdict.
- The two flags keep their stored value when omitted.
- Rate limit: 120 per hour per user.

- [ ] **Step 1: Write the failing test**

Append to `functions/test/taste.test.ts`:
```ts
describe('saveDishFeedback', () => {
  const orderDoc = (id: string, uid: string, over: Record<string, unknown> = {}) => ({
    id, businessId: 'biz-abu-salim', branchId: 'br-abu-salim-main', businessType: 'restaurant', cityId: 'beit-jann',
    customer: { uid }, status: 'accepted', placedAt: '2026-10-05T17:00:00.000Z',
    lines: [{ lineId: 'l1', productId: 'p-shawarma' }, { lineId: 'l2', productId: 'p-fries' }, { lineId: 'l3', productId: 'p-combo', comboId: 'cb1' }, { lineId: 'l4', productId: 'p-gone', removed: true }],
    ...over,
  });
  beforeAll(async () => {
    await admin.db.doc('orders/fb-mine').set(orderDoc('fb-mine', UID_A));
    await admin.db.doc('orders/fb-theirs').set(orderDoc('fb-theirs', UID_B));
    await admin.db.doc('orders/fb-placed').set(orderDoc('fb-placed', UID_A, { status: 'placed' }));
  });

  it('saves verdicts with the order branch and time, merges later taps, and undoes with none', async () => {
    const first = (await a.call<{ feedback: { items: Record<string, string>; branchId: string; placedAt: string; forSomeoneElse: boolean } }>('saveDishFeedback', { orderId: 'fb-mine', items: { 'p-shawarma': 'loved' } })).feedback;
    expect(first).toMatchObject({ branchId: 'br-abu-salim-main', placedAt: '2026-10-05T17:00:00.000Z', items: { 'p-shawarma': 'loved' }, forSomeoneElse: false });
    await a.call('saveDishFeedback', { orderId: 'fb-mine', items: { 'p-fries': 'not_again' } });
    const undo = (await a.call<{ feedback: { items: Record<string, string> } }>('saveDishFeedback', { orderId: 'fb-mine', items: { 'p-fries': 'none' }, forSomeoneElse: true })).feedback;
    expect(undo.items).toEqual({ 'p-shawarma': 'loved' });
    const stored = (await admin.db.doc(`users/${UID_A}/dishFeedback/fb-mine`).get()).data()!;
    expect(stored.forSomeoneElse).toBe(true);
    const keep = (await a.call<{ feedback: { forSomeoneElse: boolean; dismissed: boolean } }>('saveDishFeedback', { orderId: 'fb-mine', items: {}, dismissed: true })).feedback;
    expect(keep).toMatchObject({ forSomeoneElse: true, dismissed: true });
  });

  it("someone else's order and a missing order look the same", async () => {
    expect(await expectCode(a.call('saveDishFeedback', { orderId: 'fb-theirs', items: { 'p-fries': 'loved' } }))).toBe('not_found');
    expect(await expectCode(a.call('saveDishFeedback', { orderId: 'fb-nope', items: { 'p-fries': 'loved' } }))).toBe('not_found');
    expect((await admin.db.doc(`users/${UID_A}/dishFeedback/fb-theirs`).get()).exists).toBe(false);
  });

  it('refuses orders not yet accepted, dishes not in the order, combo lines and removed lines', async () => {
    expect(await expectCode(a.call('saveDishFeedback', { orderId: 'fb-placed', items: { 'p-fries': 'loved' } }))).toBe('invalid_argument');
    expect(await expectCode(a.call('saveDishFeedback', { orderId: 'fb-mine', items: { 'p-pizza': 'loved' } }))).toBe('invalid_argument');
    expect(await expectCode(a.call('saveDishFeedback', { orderId: 'fb-mine', items: { 'p-combo': 'loved' } }))).toBe('invalid_argument');
    expect(await expectCode(a.call('saveDishFeedback', { orderId: 'fb-mine', items: { 'p-gone': 'not_again' } }))).toBe('invalid_argument');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- taste.test`
Expected: the new describe FAILS (`saveDishFeedback` does not exist); the others still pass.

- [ ] **Step 3: Write the implementation**

In `functions/src/domain/taste.ts`, change the shared import to:
```ts
import { emptyTasteDoc, mergeTasteSchema, saveDishFeedbackSchema, saveTasteSchema, type DishFeedback, type Order, type TasteDoc } from '@qareeb/shared';
```
and append:
```ts
/**
 * "Loved" / "not again" per dish, and "this was for someone else", for one of the caller's accepted
 * orders. Someone else's order answers not_found, exactly like a missing one.
 */
export const saveDishFeedback = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(saveDishFeedbackSchema, req.data);
  await rateLimit(`feedback:${c.uid}`, 120, 3600);
  const order = (await col.order(input.orderId).get()).data() as Order | undefined;
  if (!order || order.customer.uid !== c.uid) fail('not_found', { entity: 'order' });
  if (order.status !== 'accepted') fail('invalid_argument', { issues: [{ path: 'orderId', message: 'order_not_accepted' }] });
  const rateable = new Set(order.lines.filter((l) => !l.comboId && !l.removed).map((l) => l.productId));
  for (const productId of Object.keys(input.items)) {
    if (!rateable.has(productId)) fail('invalid_argument', { issues: [{ path: `items.${productId}`, message: 'not_in_order' }] });
  }
  const ref = col.dishFeedback(c.uid).doc(order.id);
  const feedback = await db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as DishFeedback | undefined;
    const items: DishFeedback['items'] = { ...(prev?.items ?? {}) };
    for (const [productId, verdict] of Object.entries(input.items)) {
      if (verdict === 'none') delete items[productId];
      else items[productId] = verdict;
    }
    const doc: DishFeedback = {
      orderId: order.id,
      branchId: order.branchId,
      placedAt: order.placedAt,
      items,
      forSomeoneElse: input.forSomeoneElse ?? prev?.forSomeoneElse ?? false,
      dismissed: input.dismissed ?? prev?.dismissed ?? false,
      updatedAt: nowIso(),
    };
    tx.set(ref, doc);
    return doc;
  });
  return { feedback };
}));
```

In `functions/src/index.ts`, make the taste export line:
```ts
export { saveTaste, mergeTaste, deleteTaste, saveDishFeedback } from './domain/taste.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- taste.test`
Expected: PASS (all four describes).

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npm run typecheck -w functions && npx eslint functions/src/domain/taste.ts functions/test/taste.test.ts`. Expected: no errors.
```bash
git add functions/src/domain/taste.ts functions/src/index.ts functions/test/taste.test.ts
git commit -m "taste: saveDishFeedback callable (own accepted orders only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Count accepted orders toward popularity

**Files:**
- Create: `functions/src/lib/popularity.ts`
- Modify: `functions/src/lib/outbox.ts` (`processOutboxEvent`)
- Test: `functions/test/popularity-source.test.ts` (source-imported, no harness), `functions/test/popularity.test.ts` (emulator flow)

**Interfaces:**
- Consumes: `daypartOf`, `popularCountKey`, `toLocal`, `Order` (shared); `col.outbox`, `col.order`, `col.popularityDaily`, `FieldValue`, `nowIso`.
- Produces: `countAcceptedOrder(outboxId: string): Promise<boolean>`. It returns true when it counted something. It is safe to call any number of times for the same event. The marker is the field `popularityCountedAt` on the outbox doc.

Daily doc shape: `popularityDaily/{cityId}_{YYYY-MM-DD}` = `{ cityId, date, counts: { [popularCountKey]: number } }`. Both the date and the daypart come from `order.placedAt` in Israeli time.

- [ ] **Step 1: Write the failing source test**

`functions/test/popularity-source.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
// Imported from source like posts-sweep.test.ts. This file must not import ./harness.js (the admin
// app there is the same default Firestore instance src/lib/firebase.ts configures).
import { db } from '../src/lib/firebase.js';
import { countAcceptedOrder } from '../src/lib/popularity.js';

const CITY = `pop-city-${Date.now()}`;
const baseOrder = { businessId: 'biz-pop', branchId: 'br-pop', businessType: 'restaurant', cityId: CITY, customer: { uid: 'u-pop' }, status: 'accepted' };

async function seed(id: string, order: Record<string, unknown>) {
  await db.doc(`orders/${id}`).set({ id, ...baseOrder, ...order });
  // The emulator's onOutboxCreated trigger may also count this event; the result must still be one.
  await db.doc(`outbox/${id}`).set({ id, kind: 'order_accepted', orderId: id, recipients: [], params: {}, link: '/', key: id, attempts: 0, status: 'pending', createdAt: new Date().toISOString() });
}

describe('countAcceptedOrder', () => {
  it('counts each dish once per order, skips combos and removed lines, and survives retries', async () => {
    const id = `pop-o1-${Date.now()}`;
    // 20:30 UTC on 15 Jan = 22:30 in Israel: late, same date.
    await seed(id, { placedAt: '2026-01-15T20:30:00.000Z', lines: [{ productId: 'p1' }, { productId: 'p1' }, { productId: 'p2', removed: true }, { productId: 'c1', comboId: 'combo1' }] });
    await countAcceptedOrder(id);
    await countAcceptedOrder(id);
    await new Promise((r) => setTimeout(r, 1500));
    await countAcceptedOrder(id);
    const day = (await db.doc(`popularityDaily/${CITY}_2026-01-15`).get()).data()!;
    expect(day).toMatchObject({ cityId: CITY, date: '2026-01-15' });
    expect(day.counts).toEqual({ 'late|br-pop|p1': 1 });
    expect((await db.doc(`outbox/${id}`).get()).data()!.popularityCountedAt).toBeTruthy();
  });

  it('files a 00:30 order under the Israeli date', async () => {
    const id = `pop-o2-${Date.now()}`;
    // 22:30 UTC on 15 Jan = 00:30 on 16 Jan in Israel.
    await seed(id, { placedAt: '2026-01-15T22:30:00.000Z', lines: [{ productId: 'p9' }] });
    await countAcceptedOrder(id);
    expect((await db.doc(`popularityDaily/${CITY}_2026-01-16`).get()).data()!.counts).toEqual({ 'late|br-pop|p9': 1 });
  });

  it('ignores supermarket orders and events that are not acceptances', async () => {
    const id = `pop-o3-${Date.now()}`;
    await seed(id, { businessType: 'supermarket', placedAt: '2026-01-20T10:00:00.000Z', lines: [{ productId: 'milk' }] });
    expect(await countAcceptedOrder(id)).toBe(false);
    expect((await db.doc(`popularityDaily/${CITY}_2026-01-20`).get()).exists).toBe(false);
    expect(await countAcceptedOrder('no-such-event')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- popularity-source`
Expected: FAIL, cannot resolve `../src/lib/popularity.js`.

- [ ] **Step 3: Write the implementation**

`functions/src/lib/popularity.ts`:
```ts
import { daypartOf, popularCountKey, toLocal, type Order } from '@qareeb/shared';
import { FieldValue, col, db, nowIso } from './firebase.js';

/**
 * Adds an accepted restaurant order to its city's daily dish counts: each distinct dish counts once
 * per order, by the Israeli date and daypart it was placed in. The outbox doc carries a marker, so a
 * retried event (or the trigger and the sweeper racing) never counts twice.
 */
export async function countAcceptedOrder(outboxId: string): Promise<boolean> {
  const outboxRef = col.outbox().doc(outboxId);
  return db.runTransaction(async (tx) => {
    const e = (await tx.get(outboxRef)).data() as { kind?: string; orderId?: string; popularityCountedAt?: string } | undefined;
    if (!e || e.kind !== 'order_accepted' || !e.orderId || e.popularityCountedAt) return false;
    const order = (await tx.get(col.order(e.orderId))).data() as Order | undefined;
    const productIds = order && order.businessType === 'restaurant' && order.status === 'accepted'
      ? [...new Set(order.lines.filter((l) => !l.comboId && !l.removed).map((l) => l.productId))]
      : [];
    if (order && productIds.length > 0) {
      const placed = new Date(order.placedAt);
      const date = toLocal(placed).date;
      const daypart = daypartOf(placed);
      const counts: Record<string, FirebaseFirestore.FieldValue> = {};
      for (const productId of productIds) counts[popularCountKey(daypart, order.branchId, productId)] = FieldValue.increment(1);
      tx.set(col.popularityDaily(`${order.cityId}_${date}`), { cityId: order.cityId, date, counts }, { merge: true });
    }
    tx.update(outboxRef, { popularityCountedAt: nowIso() });
    return productIds.length > 0;
  });
}
```

In `functions/src/lib/outbox.ts`:
- Add the import `import { countAcceptedOrder } from './popularity.js';`
- In `processOutboxEvent`, as the first statement inside `try {`, add:
```ts
    // Popularity first: if notifications fail, the retry finds the marker and does not count again.
    if (e.kind === 'order_accepted') await countAcceptedOrder(id);
```

- [ ] **Step 4: Run the source test to verify it passes**

Run: `npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- popularity-source`
Expected: PASS.

- [ ] **Step 5: Write the emulator flow test**

`functions/test/popularity.test.ts`:
```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { daypartOf, toLocal } from '@qareeb/shared';
import { admin, asEmail, asUid, deliveryBase, key, quoteBase, shawarmaLine, USERS, waitFor, type Client } from './harness.js';

let customer: Client;
let manager: Client;
beforeAll(async () => { [customer, manager] = await Promise.all([asUid(USERS.customer2), asEmail(USERS.manager)]); });
afterAll(async () => { await Promise.all([customer.close(), manager.close()]); });

describe('popularity from real orders', () => {
  it('an accepted order adds 1 to its dish in the city and daypart', async () => {
    // Dine-in, like the customer2 test in orders.test.ts: no saved address needed.
    const lines = [shawarmaLine()];
    const q = await customer.call<{ totals: { cashDueAgorot: number } }>('quoteOrder', { ...quoteBase, mode: 'dine_in', lines });
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', { ...deliveryBase, mode: 'dine_in', addressId: undefined, contactName: 'Maha', contactPhone: '0502222222', tableNumber: '7', lines, idempotencyKey: key(), expectedCashDueAgorot: q.totals.cashDueAgorot });
    const order = (await admin.db.doc(`orders/${orderId}`).get()).data()!;
    const placed = new Date(order.placedAt as string);
    const ref = admin.db.doc(`popularityDaily/beit-jann_${toLocal(placed).date}`);
    const field = `${daypartOf(placed)}|${order.branchId}|p-shawarma`;
    const before = ((await ref.get()).data()?.counts?.[field] as number | undefined) ?? 0;
    await manager.call('decideOrder', { orderId, decision: 'accepted', expectedVersion: 1, idempotencyKey: key() });
    const after = await waitFor(async () => {
      const n = (await ref.get()).data()?.counts?.[field] as number | undefined;
      return n !== undefined && n > before ? n : undefined;
    });
    expect(after).toBe(before + 1);
  });
});
```

- [ ] **Step 6: Run the flow test**

Run: `env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- popularity.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/lib/popularity.ts functions/src/lib/outbox.ts functions/test/popularity-source.test.ts functions/test/popularity.test.ts
git commit -m "taste: count accepted orders toward city popularity, once per event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Publish popular ranks hourly

**Files:**
- Modify: `functions/src/lib/popularity.ts` (add `publishPopularity`), `functions/src/triggers.ts` (add `popularityHourly`), `functions/src/index.ts` (export it)
- Test: `functions/test/popularity-source.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `rankPopular`, `sumCounts`, `POPULAR_WINDOW_DAYS`, `PublicPopular` (Task 4), `col.cities`, `col.popularityDaily`, `col.popularityDays`, `col.publicPopular`, `commitInChunks`.
- Produces:
  - `publishPopularity(now?: Date): Promise<{ cities: number; deleted: number }>`. For every city it writes `publicPopular/{cityId}` from the last 28 Israeli dates, then deletes up to 400 daily docs older than the window.
  - Scheduled export `popularityHourly`.

- [ ] **Step 1: Write the failing test**

In `functions/test/popularity-source.test.ts`, change the popularity import to `import { countAcceptedOrder, publishPopularity } from '../src/lib/popularity.js';` and append:
```ts
describe('publishPopularity', () => {
  it('publishes ranks over 28 days with the 3-order floor and deletes older days', async () => {
    const city = `pub-city-${Date.now()}`;
    await db.doc(`cities/${city}`).set({ id: city, name: { en: 'Test' }, aliases: [], active: false, sortOrder: 99 });
    await db.doc(`popularityDaily/${city}_2026-03-10`).set({ cityId: city, date: '2026-03-10', counts: { 'evening|brA|p1': 2, 'evening|brA|p2': 2, 'noon|brB|p9': 3 } });
    await db.doc(`popularityDaily/${city}_2026-02-12`).set({ cityId: city, date: '2026-02-12', counts: { 'evening|brA|p1': 2 } });
    await db.doc(`popularityDaily/${city}_2026-01-01`).set({ cityId: city, date: '2026-01-01', counts: { 'evening|brA|p3': 50 } });

    const r = await publishPopularity(new Date('2026-03-10T12:00:00.000Z'));

    expect(r.deleted).toBeGreaterThanOrEqual(1);
    const pub = (await db.doc(`publicPopular/${city}`).get()).data()!;
    expect(pub.cityId).toBe(city);
    expect(pub.dayparts).toEqual({ morning: [], noon: [{ branchId: 'brB', productId: 'p9' }], evening: [{ branchId: 'brA', productId: 'p1' }], late: [] });
    expect(JSON.stringify(pub)).not.toContain('counts');
    expect((await db.doc(`popularityDaily/${city}_2026-01-01`).get()).exists).toBe(false);
    expect((await db.doc(`popularityDaily/${city}_2026-02-12`).get()).exists).toBe(true);
    await db.doc(`cities/${city}`).delete();
  });
});
```
The window from 2026-03-10 reaches back to 2026-02-11, so 2026-02-12 is inside it and 2026-01-01 is not. `p1` sums to 4; `p2` stays at 2, under the floor; `p3` is outside the window.

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- popularity-source`
Expected: FAIL, `publishPopularity` is not exported.

- [ ] **Step 3: Write the implementation**

In `functions/src/lib/popularity.ts`, change the imports to:
```ts
import { POPULAR_WINDOW_DAYS, daypartOf, popularCountKey, rankPopular, sumCounts, toLocal, type Order, type PublicPopular } from '@qareeb/shared';
import { FieldValue, col, commitInChunks, db, nowIso } from './firebase.js';
```
and append:
```ts
/**
 * Rebuilds publicPopular/{cityId} for every city from the last 28 Israeli days of counts (ranks only,
 * 3-order floor), then deletes daily counts that fell out of the window.
 */
export async function publishPopularity(now = new Date()): Promise<{ cities: number; deleted: number }> {
  // Stepping back in 24-hour hops can land on the same date twice around a clock change; dedupe.
  const dates = [...new Set(Array.from({ length: POPULAR_WINDOW_DAYS }, (_, i) => toLocal(new Date(now.getTime() - i * 86_400_000)).date))];
  const cities = await col.cities().get();
  for (const city of cities.docs) {
    const snaps = await db.getAll(...dates.map((d) => col.popularityDaily(`${city.id}_${d}`)));
    const counts = sumCounts(snaps.map((s) => (s.data() as { counts?: Record<string, number> } | undefined)?.counts));
    const doc: PublicPopular = { cityId: city.id, dayparts: rankPopular(counts), updatedAt: nowIso() };
    await col.publicPopular(city.id).set(doc);
  }
  const oldest = dates[dates.length - 1]!;
  const stale = await col.popularityDays().where('date', '<', oldest).limit(400).get();
  await commitInChunks(stale.docs.map((d) => (batch) => batch.delete(d.ref)));
  return { cities: cities.size, deleted: stale.size };
}
```

In `functions/src/triggers.ts`:
- Add the import `import { publishPopularity } from './lib/popularity.js';`
- After `scheduledSweeps`, add:
```ts
/** Popular dishes per city and daypart (ranks only), rebuilt every hour from the last 28 days. */
export const popularityHourly = onSchedule({ region: REGION, schedule: 'every 60 minutes', timeZone: 'Asia/Jerusalem' }, async () => {
  const r = await publishPopularity();
  console.info('popularity', r);
});
```

In `functions/src/index.ts`, change the triggers export line to:
```ts
export { onOutboxCreated, scheduledSweeps, popularityHourly, onImageUploaded } from './triggers.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions -- popularity-source`
Expected: PASS (four tests).

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npm run typecheck -w functions && npx eslint functions/src functions/test/popularity-source.test.ts`. Expected: no errors.
```bash
git add functions/src/lib/popularity.ts functions/src/triggers.ts functions/src/index.ts functions/test/popularity-source.test.ts
git commit -m "taste: publish popular dish ranks hourly and expire old counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Spec sync and full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-taste-profile-design.md`

- [ ] **Step 1: Write the plan's decisions back into the spec**

In section 7.2 "Popularity", replace the two bullets with:
```markdown
- **Popularity:**
  - `countAcceptedOrder` runs first in `processOutboxEvent` for `order_accepted`. Inside one transaction it adds 1 per distinct dish of an accepted restaurant order (combo and removed lines excluded) to `popularityDaily/{cityId}_{date}` under its daypart key. The `popularityCountedAt` marker on the outbox doc makes retries no-ops.
  - A separate scheduled function, `popularityHourly`, sums the last 28 Israeli days, applies the threshold of 3 orders, writes `publicPopular/{cityId}` ranks, and deletes older daily docs.
```
In section 7.1, under `deriveTaste`'s "It ignores" list, add one line:
```markdown
  - A profile whose consent was never asked (`consent === null`) still learns from orders, since tier 1 is on by default. The quiz is used only when `consent.learn` is true.
```
In section 7.2, under `saveTaste`, add:
```markdown
  - Inputs never use `null` (`parse()` strips nulls): `clearQuiz: true` deletes the quiz, and the verdict `'none'` undoes a dish rating in `saveDishFeedback`.
```

- [ ] **Step 2: Run everything**

```bash
npm run typecheck
npm run lint
npm run test -w packages/shared
env -u HTTPS_PROXY -u https_proxy npm run test -w tests/rules
npm run build -w functions && env -u HTTPS_PROXY -u https_proxy npm run test -w functions
```
Expected: all pass. The functions suite runs every file. If an unrelated earlier test fails, run it alone on a clean emulator (restart `scripts/emulators.sh`) before suspecting this work, and report it as pre-existing if it also fails on the commit before Task 1.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-06-taste-profile-design.md
git commit -m "Spec: phase 1 decisions (order-count popularity, hourly function, no-null inputs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Deploying (functions, rules) is for the user to run. Nothing here is visible to customers until phase 2.
