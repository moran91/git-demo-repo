# Smart cross-language search and menu auto-translation — design

Date: 2026-09-26. Status: approved in conversation (matching, translation, rollout); written for review.
Builds on: the cravings home (`docs/superpowers/specs/2026-09-26-cravings-home-frame.md`).

## Goal

A customer finds a dish whatever language or spelling they type:
- **Across languages.** "باستا" (Arabic) finds a dish named only "פסטה" (Hebrew); "دجاج" finds "עוף" and "chicken".
- **Across spellings and scripts.** A dish written "كبب" is found by "קובב", "קבב", "kobbab" and "kubbab", and the other way round. Arabic typed in Latin letters with digits ("Arabizi": 7ummus, 3arayes) works too.
- **Menus readable in every language.** Missing Hebrew, Arabic or English dish text is filled by machine translation and shown to customers. The owner can correct any of it, and an owner's own wording is never overwritten.

**Decided with the user (2026-09-26):**
- Meaning comes from a built-in food word list plus machine translation.
- Translations are shown to customers, and the owner can fix them. This reverses the 2026-09-16 "no machine translation" decision.
- The engine is Google Cloud Translation.

## Current state (verified in code and live data)

- Search is `matchesQuery` / `normalizeSearch` in `packages/shared/src/dishIndex.ts`. It does substring matching after folding niqqud, harakat, final letters and alef forms. The home (`apps/web/src/customer/CravingsHome.tsx`) matches on dish name (all locales), dish-type words and place name.
- The dish index (`publicBranches/{br}/index/dishes`) holds `name`, not the description.
- Live Morano on 2026-09-26: 34 dish names in Hebrew, only 9 in Arabic and 9 in English; descriptions 34 in Hebrew, 6 in Arabic and 6 in English.
- The Cloud Translation API is not enabled on qareeb-dev.

## Part 1: matching (shared, runs in the browser)

New module `packages/shared/src/search/`:

1. **`normalize`**: the existing folding, kept.
2. **`lexicon.ts`**: about 200 hand-checked food terms. Each is a group of equivalents in he, ar and en, plus common Arabizi and variant spellings (for example `עוף | دجاج | جاج | chicken | djaj`). A query word that matches a group is expanded to every member.
3. **`soundKey(word)`**: a consonant skeleton that is the same across Hebrew, Arabic and Latin script.
   - Vowels and vowel letters are dropped: א ו י ה (word-final), ا و ي ى ة ء, a e i o u y.
   - Look-alike consonants are merged into one class each: {ב פ ف ب b p f v w}, {ק כ ך ك ق k q c g-hard}, {ח ח׳ ح خ h kh x}, {ע ع 3 ' }, {ש ס س ش s sh c-soft}, {צ ץ ص ts tz}, {ט ת ط ت t th}, {ד ض د ذ d dh}, {ג ג׳ ج غ g j gh}, {ז ز ظ z}, {ל ل l}, {מ ם م m}, {נ ן ن n}, {ר ر r}.
   - Arabizi digits: 2→ء (dropped), 3→ع, 5→خ, 6→ط, 7→ح, 9→ق.
   - Doubled letters and adjacent repeats of the same class are collapsed.
   - Result: كبب, קבב, קובב, kobbab and kubbab all become `K B`; باستا, פסטה and pasta all become `B S T`.
4. **`matchScore(query, fields)`** returns a tier, or no match.
   - Tier 1: an exact normalized substring match on the dish name or a dish-type word, after lexicon expansion.
   - Tier 2: a sound-key match on the dish name. The query word must have at least 3 letters, and its key must be a prefix of some name word's key.
   - Tier 3: tier-1 or tier-2 matching on the description.
   - Tier 4: a match on the place name only.
   - Results are ordered by tier, then by the existing neutral `rankDishes` within each tier. Closed places still sort after open ones.
5. **Index**: `DishIndexEntry` gains `description: Localized`, and `toDishIndexEntry` copies it (every language).

## Part 2: machine translation (server)

**What is translated:** everything a customer reads about a dish:
- product `name` and `description`
- variant names
- modifier group and option names
- shared extras library groups, so materialized copies inherit their text
- category names

Combos and promotions stay manual.

**Source language:** the business `defaultLocale` if that field is filled, otherwise the first filled language (order he, ar, en). Every other language that is empty or machine-written is a target.

**Provenance.** Each translatable document carries `auto?: Record<string, Locale[]>`, keyed by field path (`name`, `description`, `variants.<id>.name`, `modifierGroups.<id>.name`, `modifierGroups.<id>.options.<id>.name`). It lists the languages that are machine-written.

**Rules on every owner save** (in `saveProduct`, `saveCategory` and `saveSharedModifierGroup`):
- A language whose text is unchanged from the stored text, and which was in `auto`, stays machine-written.
- A language whose text the owner typed or changed is removed from `auto` and is never overwritten.
- If the source text changed, every machine-written language of that field is marked for re-translation. The stored machine text stays until the new text arrives.
- An empty language is a target again.

**Job.** The save writes the owner's text at once and upserts `translationJobs/{docPath-hash}` with `{ path, requestedAt }`, so the latest save wins.
- An `onDocumentWritten` trigger with retries loads the document, collects the targets and calls Cloud Translation v3 (`translateText`, batched per target language, `mimeType: text/plain`).
- It then writes in a transaction, and only where the source text still equals what was translated and the target is still empty or machine-written.
- In the same transaction it updates the public projection and the dish index (via the existing `projectProductInTx` / category projection), then deletes the job.
- `scheduledSweeps` re-touches jobs older than 10 minutes.
- The translation client sits behind a small interface (`Translator`), so tests use a stub.

**Editor.** `LocalizedInput` shows a small tag, "תרגום אוטומטי" / "ترجمة آلية" / "Auto-translated", on a language whose text is machine-written. Typing replaces the text and drops the tag, and the server confirms it on save.

**Backfill.** `scripts/src/translate-catalog.ts`:
- A dry run prints every proposed translation for the user to review.
- `--apply` writes them through the same rules. Owner text is never touched, and the `auto` marks are set.
- The run covers the three live restaurants.

## Part 3: failures, tests, rollout

**Failures:**
- A translation error, or a disabled API, never blocks a save; the job retries.
- Customers see the default-language text for missing languages, as today.
- Search works without translations: the sound keys and the lexicon need no data.

**Tests:**
- Shared unit table covering:
  - باستا↔פסטה↔pasta
  - كبب↔קבב/קובב/kobbab/kubbab
  - دجاج↔עוף↔chicken
  - 7ummus↔חומוס
  - pizza/بيتزا/פיצה
  - a false-positive guard: a 2-letter query gets no sound matches, and "קולה" doesn't match "קלאסית"
- Functions tests on the emulator with a stub translator:
  - owner text is never overwritten
  - a source edit re-translates only machine text
  - a stale job (source changed after the job was queued) doesn't overwrite
  - the index and projection get the translations
  - category and shared-group translations
- An e2e test: the home search "باستا" finds Morano-style Hebrew-only pasta in the seed.

**Rollout:**
1. Search improvements: shared matcher, lexicon, description in the index. This needs no setup. Deploy it and rebuild the indexes.
2. The user enables the Cloud Translation API on qareeb-dev.
3. Deploy the translation functions and the editor tag.
4. Dry-run the backfill, the user reviews it, then apply.

## Out of scope

- Combos and promotions.
- Translating owner posts and stories captions.
- Spell correction beyond sound keys.
- Server-side search.
