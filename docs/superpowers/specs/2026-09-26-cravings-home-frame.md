# Cravings home (mockup 9) — problem frame

Date: 2026-09-26. Input: mockup 9 in `docs/mockups/home-2026-09-25/m09.html` (artifact https://claude.ai/artifact/AfCXNPQ66EGEYAXMt4jDY9#m09), benchmark https://claude.ai/artifact/17jqmPW52yjHhuNGMfdqfD.
Status: frame for review. Not a spec; the spec follows once the open decisions below are made.

## 1. Problem statement

People in בית ג'ן decide what to eat before they decide where to order from. Qareeb's home makes them pick a place first: 3 place cards, then a menu, then a dish. That is the same place-first order 1moment (the local rival, 47 places in the village zone, app-only, English by default) and Wolt use. With one place that is fine. With 20–50 places, place-first means opening menus one by one to find "a pizza that's open now".

**Problem:** a hungry villager cannot answer "what can I get right now, and from where?" from the home page, so time-to-order grows with every restaurant that joins.

**Evidence:** the benchmark (26 Sep 2026). 1moment lists 47 Beit Jann places and leads with dish-type chips (חומוס, בורגר, פיצה, סושי, שווארמה, סמבוסק…), so villagers already browse by dish type. Qareeb has no cross-store dish data, no dish types and no customer search.

**Consequence if unsolved:** as restaurants move from 1moment, Qareeb's home becomes a long card list, slower than the app it wants to replace.

## 2. Audience
- **Primary:** villagers ordering dinner on a phone, in Hebrew or Arabic, many on older Android devices, paying cash. They include older users (large text matters) and families (pickup and sit-in, not just delivery).
- **Secondary:** restaurant owners, whose dishes now appear next to competitors' dishes.

## 3. Stakeholders

| Stakeholder | Interest | Influence | Role in decisions |
| --- | --- | --- | --- |
| Moran (platform owner) | Launch a home that beats 1moment | High | Accountable for every decision below |
| Villagers | Find food fast, trust prices and times | High (adoption) | Consulted via a 5–6 person test |
| Restaurant owners (Morano first) | Fair exposure, little extra catalog work | Medium | Consulted on the dish-type list; must tag dishes |
| 1moment | Competitor; owners may list on both | None | Informed by the market only |

## 4. What exists today (facts from the code)
- Products (`packages/shared/src/types.ts:311`) have localized `name`, `priceAgorot`, variants and modifiers, and per-branch `categoryId`. There is **no dish-type, tag or cuisine field**. Categories are free text per branch.
- Public copies live at `publicBranches/{br}/products/{id}` (`functions/src/lib/projections.ts:124`). They carry `businessId` and `branchId` but **no city**. City data is only on the `publicBranches` doc.
- The home loads branches with two `publicBranches` queries (`cityId ==` and `deliveryCityIds array-contains`, `limit(60)`; `apps/web/src/customer/hooks.ts:70`). Stories fan out per branch (max 20 branches; `stories.ts:59`).
- Rules allow public reads under `publicBranches/**` only. **No collection-group access** on products, and a naive `/{path=**}/products` rule would also match private `businesses/**/products`.
- **No Firestore triggers.** Public copies are written only inside catalog callables (`functions/src/domain/catalog.ts`: saveProduct, setProductAvailable, adjustStock, setProductImage, archive, etc.).
- **The cart holds one branch** (`apps/web/src/lib/cart.ts:39`). `ProductSheet` and `ComboSheet` ask to replace the cart before adding from another branch. A results list that mixes places will trigger that dialog more often.
- No customer search anywhere, and no shared Hebrew/Arabic text normalization.

## 5. Scope
**In:**
- Home search field.
- Dish-type chips.
- Cross-place dish results with price, place and a quick add.
- A compact places list below.
- A dish-type field that owners set in the catalog editor.
- A server-maintained dish index.
- Hebrew/Arabic/English matching.

**Out (for now):**
- Ratings.
- Time estimates.
- Paid or promoted placement.
- Multi-place carts.
- Supermarket product search (supermarkets keep the places list).
- Machine translation or auto-classification of dishes (the user rejected machine translation on 2026-09-16).

## 6. Constraints
- **Reads:** one home load must stay within about 60 small document reads at 50 places. The current per-branch fan-out pattern (stories) would read thousands of product docs at that scale.
- **Writes:** keep to the existing projection path. Index updates happen in the same catalog callables, with no new trigger infrastructure unless we choose to add it.
- **Rules:** public read stays limited to server-written public paths, with no collection-group rule over private products.
- **Copy:** minimal, no hint text (user feedback). Dish-type names must be the words villagers already use, in he/ar/en, entered by hand.
- **Layout:** RTL-first, 44px targets, readable at 17–18px body text for older users.
- **Thin catalog:** today there are 3 places, and only Morano has photos. The page must look intentional with few results and dishes without photos.
- **Deploys:** hosting and functions deploys are sometimes blocked by the classifier and may need handing to the user. The emulator suite has no Morano photos.

## 7. Candidate data approaches (for the spec to decide)
1. **Per-branch dish summary doc (recommended).** One compact doc per branch (for example `publicBranches/{br}/index/dishes`) listing each live dish's id, localized name, price, dish type, thumbnail path and availability. It is rebuilt inside the existing projection functions. The home reads one doc per visible branch (≤60) and searches in memory. Village scale (50 × ~100 dishes, roughly 25 KB per doc) fits easily.
2. **City-level shards.** Fewer reads, but every product save fans out to every city the branch delivers to, and concurrent saves contend on the same docs.
3. **Collection-group query** with `cityIds` and `dishType` on public products. Filtering by chip is efficient, but it gives no text search, and the rules for a collection-group read over a name shared with private products are risky.
4. **External search service** (Algolia or Typesense). Overkill and a new vendor at this scale.

## 8. Success criteria
| Metric | Definition | Method | Target |
| --- | --- | --- | --- |
| Time to first order | Task "order a pizza for pickup", from opening the link to order placed | Moderated test, 5–6 villagers, vs 1moment | Median ≤ 45 s and faster than 1moment for most participants |
| Home-started orders | Share of orders whose first item was added from home chips or search | Event on add, with source tag | ≥ 40% in the first month |
| Zero-result searches | Searches that return nothing | Event on search | < 15% |
| Home load cost | Firestore reads and time until dishes show, 50 places, 4G | Emulator plus a throttled Playwright run | ≤ 60 reads; dishes shown < 1.5 s |
| Tagging coverage | Live products with a dish type | Admin query | ≥ 90% within 2 weeks of launch |

## 9. Principles (ranked; the higher one wins a conflict)
1. **Food before places.** The first thing people tap is a dish. *Counter-example:* chips that open a filtered list of restaurants.
2. **Only show what can be ordered now.** Dishes from closed or paused places sink below open ones and show when they open; unavailable dishes never appear. *Trade-off:* fewer results in the afternoon.
3. **Neutral ranking.** No place is promoted over another; the order is open first, then a rule every owner can see. *Trade-off:* no ad revenue at launch.
4. **The village's words, set by hand.** Dish types use local vocabulary, entered by owners in he/ar/en, never guessed by software. *Trade-off:* owners must tag dishes; untagged dishes are still findable by search.
5. **Degrade to places.** With little data, the home still works as a clear places list; chips with no dishes are hidden.

## 10. Sub-problems, prioritized
| # | Sub-problem | Value | Effort | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Dish-type taxonomy (fixed list, he/ar/en labels) and a `dishType` field in the catalog editor, plus a Morano backfill | High | Low | Decision A |
| 2 | Per-branch dish index written by the projection functions, with emulator tests | High | Medium | 1 |
| 3 | Home UI from mockup 9: search, chips, dish results, places list, no-photo rows | High | Medium | 2 |
| 4 | Quick add that respects the one-branch cart (put the current cart's place first; the replace-cart guard stays) | High | Low | 3, decision C |
| 5 | Hebrew/Arabic/English normalization (niqqud/harakat stripping, final letters, case) | Medium | Low | 3 |
| 6 | Ranking rule and source-tagged analytics events | Medium | Low | 3, decision B |

## 11. Open decisions (need Moran)
- **A. Dish-type list.** Proposed, aligned with 1moment's chips so villagers recognise them: פיצה, פסטה, בורגר, שווארמה, חומוס, סושי, סמבוסק ומאפים, סלטים, עיקריות, מטוגנים ונשנושים, קינוחים, שתייה. Add, cut or rename?
- **B. Ranking within a chip.** Neutral order (open first, then price or name), or leave room for promoted places later?
- **C. When the cart already has a place**, should that place's dishes be pinned to the top of results?
- **D. Supermarkets:** keep them out of dish search at launch?
