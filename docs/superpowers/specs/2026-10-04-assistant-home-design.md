# Assistant home: a free, on-device food assistant that sells

Date: 2026-10-04 · Status: awaiting review

## 1. Why

The current home is a search box, a restaurant/supermarket toggle and about 75 identical rows. Most rows have no photo, and the dish chips and best sellers rarely show because almost no dishes are tagged. The owner finds it bland and too long, and says the "cravings" concept is wrong. They want the home to feel like **an AI chat that is smart and sells**. It must cost nothing to run, so there are **no LLM or paid APIs**. The intelligence is our own engine, running on the customer's phone.

**What the owner asked for:**
- Keep the search.
- Search opens a chat.
- The assistant does four jobs: help people decide fast, upsell the basket, push deals, and remember the customer.
- Owners can see and edit auto-filled tags.

**Success means:**
- A customer types a natural request in Hebrew, Arabic, English or Arabizi ("משהו חריף ל-4 עד 150") and gets something they can add in one tap.
- The golden set (§7) passes. It is the measure of "smart".
- Opening the home adds only the per-branch index and last-orders reads listed in §4.5 (no new functions are called).

**Out of scope:**
- Supermarkets in the assistant, since they have no dish index; they stay in the places list.
- Analytics (no analytics module exists).
- Any LLM fallback.

## 2. Screens

### Home (`/`, `DiscoveryPage`)
1. `StoriesBar` (unchanged).
2. **Ask box** "✦ מה בא לך?". Tapping it navigates to `/ask` with the input focused.
3. **Suggestion chips** (at most 4), chosen by `homeSuggestions(now, data, profile)`:
   - a time-of-day craving (breakfast / lunch / dinner / late night);
   - "מה במבצע?" when any deal exists;
   - "הרגיל שלי" when a profile exists;
   - one popular dish type.
   Tapping a chip opens `/ask` and sends the chip's text as the first message.
4. **Greeting and picks:** one short time-aware line, then up to 3 cards: your usual (signed in, has history), the best deal now, and one time-of-day pick. Each card has an add button.
5. **Places:** the restaurant/supermarket segmented control stays.
   - Open places are listed first.
   - Closed and paused places fold into one expandable row, "סגורים כעת (N)".
   - `CravingsHome` is removed.

### Chat (`/ask`, new route under the customer layout)
- **Thread:** user bubbles, and assistant turns made of one short line plus cards.
  - Card kinds: `DishCard`, `MealCard` (a one-place basket with an "הוסף הכל" add-all button and a line list), `DealCard` (combo or promotion), `UsualCard` (reorder).
  - "עוד" (more) reveals the next 3 cards of the same answer.
- **Refinement chips** under each assistant turn, e.g. יותר זול (cheaper), משהו אחר (something else), ל-N (for N), בלי בשר (no meat), ממקום אחר (from another place). Each one is just a message the engine understands.
- **Input at the bottom:**
  - While typing, up to 5 live matches show above the input. The chat page re-implements them (`liveMatches`) on top of the engine's matchers and does not reuse `searchDishes`. Tapping one opens that dish (quick add / ProductSheet).
  - Send runs the assistant.
- **Cart bar:** appears once the cart has lines. It shows the place, the total and a link to the cart.
- **Persistence:** the conversation lives in `sessionStorage` (`qareeb.assistant.v1`) and survives back/forward navigation. A "שיחה חדשה" (new chat) action clears it.
- **Persona:** no human name, the ✦ mark, replies in the language of the last user message (fallback: UI locale), and it never claims to be a person.
- **Copy rule (the owner rejects helper text that restates labels):** the line never repeats what the cards show.

### Product editor (owner)
- **Tags** become a chip multi-select with the auto-filled ones pre-selected. **Serves** is a small number field (1–12).
- Owner edits win forever (see §4.1).
- The editor sends only the auto fields (tags, serves, dishType) the owner touched. Untouched machine fields are omitted, so the server stays the single source of suggestions.
- Supermarket products get no auto fields.

## 3. Engine (`packages/shared/src/assistant/`)

All modules are pure TypeScript with no React or Firebase, and are unit-tested with vitest.

| Module | Responsibility |
|---|---|
| `vocab.ts` | Slot vocabularies in he/ar/en/Arabizi: number words (שניים/اثنين/two…), people words, budget words (עד/under/حتى/max, זול/الأرخص/cheap), mode words, time words, negation words (בלי/without/بدون/לא), shortcut phrases (הרגיל שלי, תפתיע אותי, מה במבצע). |
| `tags.ts` | `DISH_TAGS` and the per-tag lexicon groups. `autoTags(product)` returns `{tags, serves, dishType}` inferred from name, description and category name (all languages) using LEXICON and `vocab`. |
| `understand.ts` | `understand(text, prev?: Request): Request`. Extracts slots, removes slot tokens, and leaves the remaining words as `craving`. Handles refinements relative to `prev`. |
| `retrieve.ts` | `candidates(request, data, now)`: available dishes at open places that offer a usable mode, after hard filters (place, tags, exclusions, max item price). |
| `rank.ts` | `score(dish, request, ctx)`: craving `matchScore` (reused), tag fit, profile affinity (the signed-in customer's own order history), popularity (`mostOrdered`), time of day, a deal boost (dishes in a live promotion; a combo member alone is not on offer). Results are diversified by place with a round robin and a daily seed. |
| `mealBuilder.ts` | `buildMeals(request, data)`: for each open place, a basket where the sum of `serves × qty` ≥ people and the total ≤ budget. Mains first, then drinks (`ceil(people / serves)`: `autoTags` reads a drink's size at about 0.4 L a person, so a 1.5 L bottle serves 4) and sides while budget remains. A combo is used when it is cheaper than its items. Returns the best 2 baskets from different places. |
| `upsell.ts` | `upsellFor(addedLine, cart, data)`: the best pair from the nightly pairs, otherwise rules by dish type (main → drink/side/dessert). One card. Suppressed after 2 skips in a conversation. |
| `profile.ts` | `buildProfile(orders)`: usual per place (most repeated line set), favourite types and places, median spend, usual mode. Rebuilds a usual at current prices and flags missing or sold-out lines. |
| `replies.ts` | Reply templates, 3+ wordings each, in he/ar/en, chosen by a seeded pick so a reply never repeats back to back. |
| `respond.ts` | `respond(state, message, data, now): {state, turn}`. Picks the answer kind (§3.2) and builds the turn: line + cards + refinement chips. |

### 3.1 Request slots
```ts
interface Request {
  craving: string[];                 // leftover words, sent to matchScore
  tags: DishTag[];                   // wanted tags
  exclude: { tags: DishTag[]; words: string[] };
  people?: number;                   // 1..20
  budgetAgorot?: number;             // total budget
  cheap?: boolean;                   // "cheap"/"cheapest" with no number
  mode?: FulfillmentMode;
  placeBranchId?: string;            // matched by business/branch name (sound + typo)
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'late';
  shortcut?: 'usual' | 'surprise' | 'deals' | 'more' | 'other';
  lang: 'he' | 'ar' | 'en';
}
```
- Numbers: "ל-4", "ל4", "4 אנשים", "لـ٤" (Arabic-Indic digits too) and number words set `people`.
- A currency sign, a budget word next to a number, or a number ≥ 20 with no people word sets `budgetAgorot`.
- Refinements: "יותר זול" lowers the budget to 80% of the last shown total; "משהו אחר" excludes the shown dish IDs; "ממקום אחר" excludes the shown places; "ל-6 במקום" replaces `people`. Other slots carry over from `prev` only when the message is a refinement (it has no craving words of its own).

### 3.2 Answer kinds
| Condition | Answer |
|---|---|
| `shortcut: usual` | `UsualCard`s (up to 2 places). With no history: the sign-in or "order once" line and popular picks. |
| `shortcut: deals` or the craving is only a deal word | `DealCard`s matching the other slots |
| `people` or `budgetAgorot` set | `MealCard` ×2 (+ "עוד") |
| `shortcut: surprise` | 1 `DishCard`: profile-weighted, time-aware |
| `placeBranchId` only | That place's top 3 and its deals |
| Craving / tags | `DishCard` ×3 (+ "עוד") |
| Nothing usable | Reprompt ladder (§3.3) |

### 3.3 When it doesn't understand (reprompt ladder)
1. **First miss:** the closest dishes by loose search (`layoutAlternatives`, typo level), plus 3 suggestion chips.
2. **Second miss in a row:** constrained choices: [משהו לאכול עכשיו] [מה במבצע?] [הרגיל שלי] [לפי תקציב].
3. Never a dead end, and never the same reprompt twice.

**Empty result after filters:** the turn names the slot that blocked it ("אין עכשיו משהו טבעוני פתוח" — nothing vegan is open right now) and offers to drop it as a chip.

## 4. Data

### 4.1 Product fields
- `tags?: DishTag[]`, `serves?: number` (1–12) and `autoFields?: { tags?: DishTag[]; serves?: number; dishType?: DishType }`. `autoFields` holds machine values so an owner edit can be detected.
- **Rule:** if the stored value equals `autoFields.x`, it is machine-owned and may be re-derived. Once an owner saves a different value, `autoFields.x` is cleared and the value is never overwritten again. This mirrors `reconcileAuto` in translation.
- **On save:** `saveProduct` computes `autoTags` from the saved name, description and category name. A sent value equal to that suggestion stays machine-owned; a different one becomes owner-owned. An omitted value keeps the stored value and its mark. The editor pre-fills machine-owned fields live from `autoTags(draft)`.
- `saveProduct` accepts `tags` and `serves` (omitted keeps the previous value, same as `dishType`). `copyToBranch` copies them.
- Schema: `packages/shared/src/schemas.ts`. Type: `types.ts` `Product`.

### 4.2 Dish index (`publicBranches/{br}/index/dishes`)
- `DishIndexEntry` gains `tags?` and `serves?`. `toDishIndexEntry` fills them. (The category name feeds auto-tagging in saveProduct, the editor and the backfill, but is not stored in the index.)
- Still restaurants only, and still one document per branch.

### 4.3 Deals in the index
- A new document `publicBranches/{br}/index/deals`: `{ combos: Record<id, {name, description?, priceAgorot, items, imagePath?}>, promotions: Record<id, {title, body?, productIds, endsAt}>, updatedAt }`.
- It is written wherever combos and promotions are projected today (projections.ts) and in `reprojectCatalog`.
- The existing `match /index/{docId}` rule already allows a public read. A rules test asserts it.

### 4.4 Pairs (what goes together)
- `publicBranches/{br}/index/pairs`: `{ pairs: Record<productId, {productId}[] (top 5, best first)>, updatedAt }`. It holds ranked productIds only, with no counts, because public counts would expose sales volume. The thresholds below stay server-side in `computePairs`.
- Built by a new daily scheduled function `buildPairs` (03:00 Asia/Jerusalem) from the last 90 days of non-cancelled orders per branch.
- Branches with fewer than 10 orders get no document, and the rules fallback in `upsell.ts` is used instead.

### 4.5 Client data hook
`useAssistantData(cityId)` loads the existing `useDiscovery` restaurants, then `useDishIndexes` plus deals and pairs index documents per branch (three listeners per branch), plus the signed-in user's last 50 orders, which are already readable. The home uses this same hook, so it adds the deals, pairs and last-orders listeners per branch: this section wins over §1's "no new reads". The profile is computed in memory and never stored server-side.

### 4.6 Auto-tag backfill
- `scripts/src/auto-tag.ts` runs `autoTags` on every product of every restaurant.
- `--dry` writes a review HTML page (dish, photo, proposed tags, serves and type; sortable, filterable by tag) for the owner to check.
- `--apply` writes only fields that are still machine-owned, then reprojects the indexes.
- `scripts/src/deals-index-backfill.ts` writes `index/deals` for existing restaurant branches. The emulator seed (`scripts/src/reproject.ts`) writes the deals index too, through the shared `toDealsIndexDoc`.
- Run on qareeb-dev only after the owner approves the dry-run page.

## 5. Selling rules
- Deals get a ranking boost and are always labelled as deals: a dish in a live promotion is boosted and its card carries the deal badge. Only orderable deals are offered (a combo needs every member on the menu, a promotion at least one of its dishes). Ranking is otherwise neutral between places, with daily-seeded rotation, apart from the signed-in customer's own history (profile affinity).
- Customers never see "saves ₪X" on combos or meals, only the combo price. This is the owner rule: the original price is shown to the owner only. `savingsAgorot` stays engine-internal.
- Prices in chat use the app's money formatter, the same one used across the app.
- One upsell card after an add. It never appears for a different place than the cart's, and stops after 2 skips in a conversation.
- Meal baskets stay within one place (the cart is single-branch). "Add all" adds each line through the existing quick-add path, so the replace-cart confirm comes first and dishes that need a choice (`needsChoice`) open `ProductSheet` in order.
- A usual is rebuilt from `OrderLine`s into `CartLine`s at current prices. Lines whose product, variant or option is gone are dropped and named in the line text.
- Closed or paused places are never offered for adding; at most "opens at HH:MM".

## 6. Errors and edge cases
- **Indexes still loading:** the chat shows a typing indicator until the first snapshot arrives, with a 6 s timeout, then answers with whatever has loaded. If nothing has loaded after 6 s, a "menus still loading" status line shows instead of an answer.
- **No open restaurants:** the home picks say so and show the next opening time. Chat answers use "opens at".
- **Price changed since a card was shown:** quick add already uses `expectedUnitPriceAgorot` and checkout re-quotes, so there is no new handling.
- **Signed out:** no usual. "הרגיל שלי" prompts sign-in with a link to `/signin` and still shows popular picks.
- **RTL and mixed text:** prices and numbers use `<bdi dir="ltr">`. Arabic highlights use a tint, not bold (as in the existing search).

## 7. Testing
- **Golden set** `packages/shared/test/assistant/golden.test.ts` (318 tests): hundreds of cases in he/ar/en/Arabizi with typos, slang, wrong keyboard and refinement chains. Each case checks the expected `Request` slots and/or the answer kind, against a fixture dataset built from real Morano dishes plus a synthetic village of about 8 places. This is the regression bar; new phrases from users are added as cases.
- **Unit tests per module** (in `packages/shared/test/assistant/`): understand, tags/autoTags, rank, mealBuilder (budget and serves edge cases, combo substitution), upsell suppression, profile rebuild, replies (no back-to-back repeats).
- **Functions tests:** saveProduct tags/serves owner-wins, the deals index projection, `buildPairs` on emulator orders.
- **Rules test:** `index/deals` and `index/pairs` are publicly readable and not writable.
- **E2E** (`e2e/assistant.spec.ts`): home chip → `/ask` → meal card → add all → cart total; refinement "יותר זול"; replace-cart confirm across places.

## 8. File structure
- **Shared engine:** `packages/shared/src/assistant/` (text, tags, ownership, vocab, understand, data, retrieve, rank, mealBuilder, upsell, profile, pairs, replies, respond, home, cards, index). Tests in `packages/shared/test/assistant/`.
- **Shared types and schema:** `types.ts`, `schemas.ts`, `dishIndex.ts` (tags/serves on entries, deals and pairs documents, `toDealsIndexDoc`).
- **Functions:** `domain/catalog.ts` (saveProduct), `lib/projections.ts` (deals index), `domain/pairs.ts` and the `buildPairs` trigger.
- **Scripts:** `scripts/src/auto-tag.ts`, `scripts/src/deals-index-backfill.ts`, and the `scripts/src/reproject.ts` seed change.
- **Web:** `apps/web/src/customer/assistant/` (`useAssistantData`, `useQuickAdd`, `Cards`, `AskPage`, `AssistantHome`, `conversation`, `assistant.css`), `DiscoveryPage.tsx`, `App.tsx`, the product editor in `business/CatalogPages.tsx`, and i18n.
- **Removed:** `CravingsHome.tsx` and `e2e/cravings.spec.ts`. `cravings.css` is trimmed, not deleted, because the places list still uses part of it.

## 9. Rollout
1. Shared engine and golden set.
2. Product fields and index projection, plus the functions and rules tests.
3. The auto-tag dry run for the owner to review, then apply.
4. UI (home and `/ask`), then e2e.
5. Deploy indexes and rules, functions, then hosting to qareeb-dev.
6. `buildPairs` is scheduled; the first run happens at 03:00, and it can also be run once by hand.
