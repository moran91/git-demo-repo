# Assistant Home: Implementation Plan (OUTLINE, NOT FINISHED)

> Status: task breakdown and design decisions only. The full step-by-step version, with code and tests in every task, is still to be written (session ran out of usage). Spec: `docs/superpowers/specs/2026-10-04-assistant-home-design.md`.

## Decisions made while planning (they refine the spec)
- **Shared helpers already in the code:** use `toLocal(now).date` and `toLocal(now).minutes` (hours.ts) for the Jerusalem date and hour. Promotions are expired when `endsAt < toLocal(now).date`, the same rule as `lib/promotions.ts`.
- **Text helpers:** a new `assistant/text.ts` with `tokenize` (Arabic-Indic digits to Latin; splits a digit from a Hebrew or Arabic letter only, so Arabizi "7ar" stays whole; ₪ becomes its own token), `wordForms` (strips one Hebrew prefix ה/ו/ב/ל/ש/מ/כ, or an Arabic one ال/و/ب/ل/ف/لل/وال/بال), `termMatcher` and `countMatches`. Every vocabulary list is folded with `normalizeSearch` once, at load time (final letters and ة→ه are folded).
- **`tags.ts`:**
  - Exports `DISH_TAGS`, `TAG_TERMS`, `TYPE_TERMS`, `PEOPLE_TERMS`, `TAG_LABELS` (he/ar/en) and `autoTags({name, description?, categoryName?}) → {tags, serves, dishType?}`.
  - **Dish type:** scored by matches, name ×3 + category ×2 + description ×1. Ties go to whichever type comes first in `DISH_TYPES`.
  - **Rules:**
    - A burger word alone is not "meat" when the dish is chicken or fish.
    - A cold word removes `hot_drink` (iced coffee).
    - Drink tags apply only to drinks (or dishes with no type).
    - Desserts get `sweet`. Pizza, pasta, salads, hummus and pastries with no meat, chicken or fish get `vegetarian`.
  - **Serves:** an explicit "ל-4 / for 4 / 4 אנשים" wins. Otherwise tray or platter words mean 6, family words 4, pair words 2. A whole pizza is 2 (1 when the name says slice, personal or mini). Anything else is 1. `serves` ≥ 3 adds `sharing`.
- **Owner-wins (`assistant/ownership.ts`):**
  - `resolveAutoFields(input, existing, suggested)`: a sent value equal to the suggestion stays machine-owned; a different one becomes owner-owned. An omitted value keeps the stored value and its mark. A new product with nothing sent gets the suggestion.
  - `isMachineOwned(p, key)`: when `autoFields` exists, the key is machine-owned only if it is present there. When `autoFields` is missing (older products), it is machine-owned only if the value is unset.
- **Product changes:** `tags?`, `serves?` and `autoFields?` on `Product`, plus the schema fields `tags` (max 15) and `serves` (1–12).
  - `saveProduct` replaces the existing dishType spread with `...auto.values, autoFields: auto.autoFields`. `copyToBranch` already copies them through `...p`.
  - The existing `functions/test/dish-index.test.ts` dishType cases must keep passing.
- **Index documents:**
  - **Dish index:** `toDishIndexEntry` gains `tags` and `serves`. The category stays out of the index.
  - **Deals:** a new `index/deals` document, `DealsIndexDoc {combos, promotions}` built by `toDealsCombo` / `toDealsPromotion` in dishIndex.ts. It is written by `projectDealEntry` (same no-read `mergeFields` pattern as the dish index) from `projectComboInTx` and `projectPromotionInTx`, and wherever a public combo or promotion doc is deleted directly. It is rebuilt and removed in `reprojectCatalog`, for restaurants only.
  - **Pairs:** a new `index/pairs` document, from `computePairs` (shared) and `rebuildPairs` (functions/src/domain/pairs.ts). `buildPairs` is a daily `onSchedule` at 03:00 Asia/Jerusalem, exported in functions/src/index.ts. It uses the last 90 days of non-rejected orders, writes nothing below 10 orders, and keeps the top 5 pairs with count ≥ 2. Test it by importing src directly (like posts-sweep.test.ts).
- **`understand` step order:**
  1. Shortcut and refinement phrases: other-place, cheaper (cheap when there's no previous turn), usual, surprise, deals.
  2. Multi-word tag phrases ("ללא גלוטן" before negation).
  3. Negations: the next token becomes an excluded tag and/or an excluded word.
  4. Numbers. A budget cue (currency, עד/under/حتى, "up to") makes a budget; a people cue (ל/for/ل prefix, or a people word) makes people. Otherwise 1–12 is people and ≥ 20 is a budget.
  5. Family words mean 4 people; companion words ("ואשתי", "وصاحبي") mean 2.
  6. Cheap, mode and meal words.
  7. Single-word request tags. Only taste and diet words become tags; food words stay as cravings.
  8. Stopwords (he/ar/en/Arabizi, including במקום/instead).
  9. Place spans of 1–3 tokens, matched with `matchScore` level ≤ 4. A span made of food words only matches a place when it has a "from" prefix (ממורנו / from / من).
  10. The rest is the craving. More or other only when nothing else is left.
- **Refinements:** a message with slots but no craving, place or shortcut merges into the previous request. "יותר זול" sets the budget to 80% of the largest total shown. Negating a wanted tag removes it.
- **Engine modules:**
  - **`data.ts`:** `prepareDishes` is memoised on the indexes; `buildAssistantData` runs per minute.
  - **`retrieve.ts`:** takes a `Filters` object (open/place/tags/exclude/mode/budget) so the "blocked slot" check can relax one filter at a time.
  - **`rank.ts`:** scores by points, then `diversify` round-robins places within 100-point tiers.
  - **`mealBuilder.ts`:** per place, tries up to 4 mains as the anchor. Quantity is ⌈people/serves⌉. Then drinks (one per person) and sides (one per 2 people) while the budget allows. `applyCombos` swaps in a combo when that saves money.
  - **`upsell.ts`:** pairs first, then complement rules by dish type.
  - **`profile.ts`:** one usual per place, from the latest lines of the most repeated order signature.
  - **`replies.ts`:** 3 wordings per key in he/ar/en (plural "you" in Hebrew); chip labels.
  - **`respond.ts`:** a JSON-serialisable `Conversation`. Each turn has a `kind`: dish, meal, deal, usual, place, surprise, blocked, closed or reprompt. A wrong-keyboard retry runs before the reprompt.
  - **`home.ts`:** `homeView`.
  - **`cards.ts`:** `resolveCard` returns null for dishes that have disappeared.
- **Golden fixture:** 8 places: Morano, Abu Salim, Sumo, Bloom, Burger Basil, Baguette Pars (closed, opens in 120 min), Al Madina bakery, and Dolce (delivery only). Morano also has a "קומבו זוגי" combo (margherita + 2 cokes for ₪60) and a pasta promotion. About 155 cases are drafted in the session notes: cravings in 4 languages, tags, negation, people and budget, mode, place, shortcuts, meal time, refinement chains, misses, closed places and the wrong keyboard.

## Tasks (each one TDD, ending with a commit)
1. `assistant/text.ts` + `tags.ts` (autoTags) + tests.
2. `ownership.ts`, Product/schema fields, `toDishIndexEntry` tags/serves, deals/pairs types and the `toDeals*` helpers + tests.
3. Functions: saveProduct owner-wins + functions test (`assistant-fields.test.ts`).
4. Functions: deals index projection + rules test (`index/deals` and `index/pairs` readable, not writable) + functions test.
5. Pairs: `computePairs` (shared) + `rebuildPairs` + scheduled `buildPairs` + tests.
6. `understand.ts` + tests.
7. `data.ts` + `retrieve.ts` + `rank.ts` + test fixtures + tests.
8. `mealBuilder.ts` + `upsell.ts` + `profile.ts` + tests.
9. `replies.ts` + `respond.ts` + `home.ts` + `cards.ts` + tests (Review Focus: all-closed night, a budget below every basket, a stored conversation with missing dishes).
10. Golden set, `golden.test.ts` (~155 cases).
11. `scripts/src/auto-tag.ts`: `--dry` writes the review HTML, `--apply` writes machine-owned fields only and reprojects.
12. Web: generic `useBranchIndexDocs` (refactor `dishIndex.ts`), `useAssistantData`, `useQuickAdd` extracted from CravingsHome with `addMeal` and `addUsual` (queues ProductSheet/ComboSheet; one replace-cart confirm). `expectedUnitPriceAgorot` comes from `priceLine(...).line.unitPriceAgorot`.
13. Web: the `/ask` chat page, cards, CSS and i18n keys in he/ar/en (the Dictionary type requires all three).
14. Web: home (ask box, chips, picks, open-first places with closed folded); delete CravingsHome; replace `e2e/cravings.spec.ts` with `e2e/assistant.spec.ts`.
15. Product editor: tag chips + serves, machine values shown live from `autoTags(draft)`.
16. Deploy to qareeb-dev (indexes/rules → functions → hosting) only after the user approves; the auto-tag `--apply` only after the user reviews the dry-run page.
