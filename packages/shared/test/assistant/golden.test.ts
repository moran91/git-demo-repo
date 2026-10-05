/**
 * The golden set: real customer requests in Hebrew, Arabic, English and Arabizi, run against the
 * fixture village. This is what "smart" means for the free assistant, and it stays green: when a real
 * customer phrase is misread, it is added here and the engine is fixed. Never weaken a case to pass.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_CONVERSATION, formatILS, reply, respond, tokenize, type AssistantData, type AssistantTurn, type Card, type Conversation, type DishTag, type DishType, type FulfillmentMode, type Lang, type Meal, type ReplyKey, type Shortcut, type TurnKind } from '../../src/index.js';
import { PLACES, fixtureData } from './fixtures.js';

interface Case {
  say: string | string[];
  kind?: TurnKind;
  /** Exact craving words (tokenized); `[]` asserts that no stray word was left as a craving. */
  craving?: string[];
  tags?: DishTag[];
  excludeTags?: DishTag[];
  /** Tags that must NOT be excluded ("בלי קולה" is not "no cold drinks"). */
  keepTags?: DishTag[];
  people?: number;
  /** Asserts that no people count was read. */
  noPeople?: boolean;
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
  includesAll?: string[];
  /** Each group has at least one id among the cards ("פיצה עם קולה" shows a cola). */
  includesAny?: string[][];
  first?: string;
  excludes?: string[];
  branch?: string;
  allTagged?: DishTag;
  firstTagIn?: DishTag[];
  /** Every dish card is one of these types. */
  cardTypes?: DishType[];
  /** Each of these types is among the dish cards (a request for two things shows both). */
  hasTypes?: DishType[];
  /** No dish card carries any of these tags. */
  noCardTags?: DishTag[];
  cards?: number;
  /** How many separate things the message asked for (0: one thing, not split). */
  groups?: number;
  /** Dish cards go from cheapest up. */
  sortedByPrice?: boolean;
  /** After the messages, tap this chip of the last turn; the assertions are about the turn it gives. */
  thenChip?: number;
  /** No card of the last turn was on the previous assistant turn (for meals: no main it was built around). */
  fresh?: boolean;
  textHas?: string[];
  textLacks?: string[];
  data?: () => AssistantData;
  /** What `data` changes, for the test title. */
  note?: string;
  /** In meal cards, at most this many of each listed product ("ל-4" is not four 1.5 L bottles). */
  maxQty?: Record<string, number>;
  signedIn?: boolean;
}

/** Morano and Burger Basil (the two places with deals) closed; everything else open. */
const dealPlacesClosed = () => fixtureData({ places: PLACES.map((p) => (p.branchId === 'morano' || p.branchId === 'burger' ? { ...p, open: false, opensInMin: 90 } : p)) });

const WARM_TYPES: DishType[] = ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'mains', 'pastries', 'snacks', 'drinks'];

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
  { say: 'burger', kind: 'dish', includes: 'b-classic', excludes: ['b-sprite', 'b-onion-rings'] },
  { say: 'برغر', kind: 'dish', includes: 'b-classic' },
  { say: 'burgr', kind: 'dish', includes: 'b-classic', excludes: ['b-sprite', 'b-onion-rings'], places: undefined },
  { say: 'חומוס', kind: 'dish', includes: 'a-hummus' },
  { say: 'hummus', kind: 'dish', includes: 'a-hummus' },
  { say: 'קפוצינו', kind: 'dish', includes: 'bl-cappuccino' },
  { say: 'קפה', kind: 'dish', includesAll: ['bl-cappuccino', 'm-espresso', 'bl-iced-coffee'], excludes: ['bl-shakshuka'] },
  { say: 'coffee', kind: 'dish', includesAll: ['bl-cappuccino', 'm-espresso', 'bl-iced-coffee'], excludes: ['bl-shakshuka'] },
  { say: 'قهوة', kind: 'dish', includesAll: ['bl-cappuccino', 'm-espresso', 'bl-iced-coffee'], excludes: ['bl-shakshuka'] },
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
  { say: 'bdi shawarma', kind: 'dish', craving: ['shawarma'], includes: 'a-shawarma-chicken' },
  { say: 'פיצות', kind: 'dish', includes: 'm-margherita', cardTypes: ['pizza'] },
  { say: 'pizzas', kind: 'dish', includes: 'm-margherita', cardTypes: ['pizza'] },
  { say: 'קרואסונים', kind: 'dish', includes: 'bl-croissant' },
  { say: 'burgers', kind: 'dish', includes: 'b-classic', cardTypes: ['burger'] },
  { say: 'פיצה משפחתית', kind: 'dish', includes: 'm-family', noPeople: true },

  // Two things in one message
  { say: 'פיצה עם קולה', kind: 'dish', hasTypes: ['pizza', 'drinks'], includesAny: [['m-coke', 'a-cola']] },
  { say: 'pizza and sushi', kind: 'dish', hasTypes: ['pizza', 'sushi'], includes: 'm-margherita' },
  { say: 'חומוס ופלאפל', kind: 'dish', includesAll: ['a-hummus', 'a-falafel'] },
  { say: 'קפה ועוגה', kind: 'dish', hasTypes: ['drinks', 'desserts'], includesAny: [['m-espresso', 'bl-cappuccino', 'bl-iced-coffee'], ['dl-chocolate-cake', 'dl-gf-cake']] },
  { say: 'coffee and cake', kind: 'dish', hasTypes: ['drinks', 'desserts'], includesAny: [['m-espresso', 'bl-cappuccino', 'bl-iced-coffee'], ['dl-chocolate-cake', 'dl-gf-cake']] },
  { say: 'شاورما وكولا', kind: 'dish', hasTypes: ['shawarma', 'drinks'] },
  { say: 'שווארמה בפיתה', kind: 'dish', includes: 'a-shawarma-chicken', cardTypes: ['shawarma'] },
  { say: 'פיצה וקולה ל-2', kind: 'meal', people: 2, branch: 'morano', excludes: ['a-cola'] },

  // A dish name of two words is not two dishes: no answer made of each word alone
  { say: 'hot dog', kind: 'blocked', cards: 0, textHas: ['hot dog'] },
  { say: 'ice cream', kind: 'blocked', cards: 0, textHas: ['ice cream'] },
  { say: 'עוגת גבינה', kind: 'blocked', cards: 0, textHas: ['עוגת גבינה'] },
  { say: 'chocolate milk', kind: 'blocked', cards: 0 },
  { say: 'מרק עוף', kind: 'blocked', cards: 0, textHas: ['מרק עוף'] },
  { say: 'חומוס ופלאפל ל-4 במשלוח ממורנו', kind: 'blocked', textHas: ['מורנו'], textLacks: ['חומוס'] },
  { say: 'עוגת וניל', groups: 0, craving: ['עוגת', 'וניל'] },

  // Joined things are split where they are joined, each kept whole; a missing one is named, never replaced
  { say: 'hot dog and fries', kind: 'dish', groups: 2, includes: 'm-fries', excludes: ['m-spicy-family', 'a-shawarma-spicy', 's-noodles'], textHas: ['hot dog'] },
  { say: 'hot dog with fries', kind: 'dish', groups: 2, includes: 'm-fries', excludes: ['m-spicy-family', 'a-shawarma-spicy', 's-noodles'], textHas: ['hot dog'] },
  { say: 'ice cream and coffee', kind: 'dish', groups: 2, cardTypes: ['drinks'], includesAny: [['m-espresso', 'bl-cappuccino']], textHas: ['ice cream'] },
  { say: 'ice cream or cake', kind: 'dish', groups: 2, cardTypes: ['desserts'], excludes: ['bl-iced-coffee'], textHas: ['ice cream'] },
  { say: 'עוגת גבינה וקפה', kind: 'dish', groups: 2, cardTypes: ['drinks'], excludes: ['dl-chocolate-cake', 'md-cheese'], textHas: ['עוגת גבינה'] },
  { say: 'מרק עוף עם לחם', kind: 'blocked', cards: 0, excludes: ['a-shawarma-chicken', 'b-chicken'] },
  { say: 'hot dog and fries ל-2', kind: 'meal', people: 2, excludes: ['m-spicy-family', 'a-shawarma-spicy'], textHas: ['hot dog', 'ל־2'] },
  { say: 'fries and hot dog', kind: 'dish', includes: 'm-fries', textHas: ['hot dog'], textLacks: ['and', 'fries'] },
  { say: 'פיצה ופטריות', kind: 'dish', cardTypes: ['pizza'], textHas: ['פטריות'], textLacks: ['ופטריות'] },
  { say: 'קפה וחלב', kind: 'dish', cardTypes: ['drinks'], textHas: ['חלב'], textLacks: ['וחלב'] },
  { say: 'حمص وفول', kind: 'dish', includes: 'a-hummus', textLacks: ['وفول'] },
  { say: 'chocolate milk and chocolate cake', kind: 'dish', includes: 'dl-chocolate-cake', textHas: ['chocolate milk'], textLacks: ['milk chocolate', 'cake'] },
  { say: 'hot dog and hot chocolate', kind: 'blocked', cards: 0, textHas: ['hot dog, hot chocolate'], textLacks: ['hot hot'] },
  { say: 'שווארמה וחריף', kind: 'dish', groups: 0, tags: ['spicy'], cardTypes: ['shawarma'], includes: 'a-shawarma-spicy' },
  { say: ['פיצה ושתייה קרה', 'משהו חם'], kind: 'dish', groups: 2, hasTypes: ['pizza', 'drinks'], noCardTags: ['cold_drink'] },

  // "With" a side is two things; "with" a topping is the same dish
  { say: 'شاورما مع بطاطا', kind: 'dish', includesAll: ['a-shawarma-chicken', 'm-fries'] },
  { say: 'שווארמה עם חומוס', kind: 'dish', includesAll: ['a-shawarma-chicken', 'a-hummus'] },
  { say: 'פיצה עם גבינה', kind: 'dish', groups: 0, cardTypes: ['pizza'], excludes: ['md-cheese'] },
  { say: 'pizza with cheese', kind: 'dish', groups: 0, cardTypes: ['pizza'], excludes: ['md-cheese'] },
  { say: 'pizza with extra cheese', kind: 'dish', groups: 0, cardTypes: ['pizza'], excludes: ['md-cheese'] },
  { say: 'بيتزا مع جبنة', kind: 'dish', groups: 0, cardTypes: ['pizza'], excludes: ['md-cheese'] },
  { say: 'פיצה עם גבינה ל-2', kind: 'meal', people: 2, branch: 'morano', excludes: ['md-cheese'] },

  // A wish belongs to the thing it was said with
  { say: 'פיצה ושתייה קרה', kind: 'dish', groups: 2, hasTypes: ['pizza', 'drinks'], includesAny: [['m-coke', 'a-cola', 'b-sprite', 'bl-iced-coffee']] },
  { say: 'pizza and a cold drink', kind: 'dish', groups: 2, hasTypes: ['pizza', 'drinks'], includesAny: [['m-coke', 'a-cola', 'b-sprite', 'bl-iced-coffee']] },
  { say: 'פיצה וקולה קרה', kind: 'dish', groups: 2, hasTypes: ['pizza', 'drinks'], includesAny: [['m-coke', 'a-cola']] },
  { say: 'פיזה', kind: 'dish', includes: 'm-margherita', excludes: ['s-platter'] },
  { say: 'שווארמה עם צ׳יפס', kind: 'dish', includesAll: ['a-shawarma-chicken', 'm-fries'] },
  { say: 'כנאפה ל-4', kind: 'meal', people: 4, includes: 'a-knafeh', excludes: ['a-falafel'] },

  // Known foods that no place sells: say so, do not claim not to understand
  { say: 'מיץ', kind: 'blocked', cards: 0, textHas: ['מיץ'] },
  { say: 'water', kind: 'blocked', cards: 0, textHas: ['water'] },
  { say: 'בירה', kind: 'blocked', cards: 0, textHas: ['בירה'] },
  { say: 'بوظة', kind: 'blocked', cards: 0, textHas: ['بوظة'] },

  { say: 'משהו לשתות', kind: 'dish', cardTypes: ['drinks'] },
  { say: 'something to drink', kind: 'dish', cardTypes: ['drinks'] },
  { say: 'بدي اشرب اشي', kind: 'dish', cardTypes: ['drinks'] },
  { say: 'משהו לנשנש', kind: 'dish', cardTypes: ['snacks'] },
  { say: 'a snack', kind: 'dish', cardTypes: ['snacks'] },
  { say: 'משהו חם', kind: 'dish', craving: [], noCardTags: ['cold_drink', 'sweet'], cardTypes: ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'mains', 'pastries', 'snacks', 'drinks'] },
  { say: 'something warm', kind: 'dish', craving: [], noCardTags: ['cold_drink', 'sweet'], cardTypes: WARM_TYPES },
  { say: 'סושי חם', kind: 'blocked', textHas: ['חם'], textLacks: ['סושי'] },
  { say: 'סושי חם', thenChip: 0, kind: 'dish', cardTypes: ['sushi'] },
  { say: 'סלט חם', kind: 'blocked', textHas: ['חם'], textLacks: ['סלט'] },
  { say: 'קינוח חם', kind: 'blocked', textHas: ['חם'], textLacks: ['מתוק'] },
  { say: 'קינוח חם', thenChip: 0, kind: 'dish', allTagged: 'sweet', cards: 3 },
  { say: ['משהו חם', 'משהו קר'], kind: 'dish', allTagged: 'cold_drink', cardTypes: ['drinks'] },
  { say: ['משהו קר', 'משהו חם'], kind: 'dish', noCardTags: ['cold_drink'], cardTypes: WARM_TYPES },
  { say: ['שתייה חמה', 'שתייה קרה'], kind: 'dish', tags: ['cold_drink'], allTagged: 'cold_drink' },
  { say: 'סלט קר', kind: 'dish', tags: [], includes: 'bl-greek-salad' },
  { say: 'פיצה קרה', kind: 'dish', tags: [], includes: 'm-margherita' },
  { say: 'cold pizza', kind: 'dish', tags: [], includes: 'm-margherita' },
  { say: 'something hot', kind: 'dish', noCardTags: ['cold_drink', 'sweet'], cardTypes: ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'mains', 'pastries', 'snacks', 'drinks'] },
  { say: 'اشي سخن', kind: 'dish', craving: [], noCardTags: ['cold_drink', 'sweet'], cardTypes: ['pizza', 'pasta', 'burger', 'shawarma', 'hummus', 'mains', 'pastries', 'snacks', 'drinks'] },

  // Arabizi
  { say: 'knafe', kind: 'dish', includes: 'a-knafeh' },
  { say: 'shawarma djaj', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'bdi 2ahwe', kind: 'dish', includesAll: ['bl-cappuccino', 'm-espresso', 'bl-iced-coffee'] },
  { say: 'falafel w hummus', kind: 'dish', craving: ['falafel', 'hummus'], includesAll: ['a-falafel', 'a-hummus'] },
  { say: 'bdi shi rkhis', kind: 'dish', cheap: true, craving: [] },
  { say: 'tawsil pizza', kind: 'dish', mode: 'delivery', craving: ['pizza'] },
  { say: 'faji2ni', kind: 'surprise', shortcut: 'surprise', cards: 1 },
  { say: 'shu fi 3roud', kind: 'deal', shortcut: 'deals', craving: [] },
  { say: 'pizza la 2', kind: 'meal', people: 2, branch: 'morano' },
  { say: 'shawarma la 4', kind: 'meal', people: 4, branch: 'abu' },
  { say: 'bdi burger bala la7me', kind: 'dish', craving: ['burger'], excludeTags: ['meat'], excludes: ['b-classic'] },
  { say: 'sushi la 2 la7ad 100', kind: 'meal', people: 2, budget: 10000, branch: 'sumo' },

  // Hungry, no dish named: ideas for now
  { say: 'אני רעב', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'רעבים', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'בא לי משהו טוב', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'מה יש לאכול?', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'מה פתוח עכשיו?', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: "i'm hungry", kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'what should i eat', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: "what's open", kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'جوعان', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'شو في اكل', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'ju3an', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'bdi akel', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'מה מומלץ?', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'מה הכי מוזמן', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'what do you recommend', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'الأكثر طلبا', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'شو بتنصح', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'شو في هلا', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'מה יש?', kind: 'dish', cards: 3, craving: [], tags: [] },
  { say: 'what do you have', kind: 'dish', cards: 3, craving: [], tags: [] },

  // Taste and diet wishes
  { say: 'משהו חריף', kind: 'dish', tags: ['spicy'], craving: [], allTagged: 'spicy' },
  { say: 'something spicy', kind: 'dish', tags: ['spicy'], craving: [], allTagged: 'spicy' },
  { say: 'اشي حار', kind: 'dish', tags: ['spicy'], craving: [], allTagged: 'spicy' },
  { say: 'shi 7ar', kind: 'dish', tags: ['spicy'], craving: [], lang: 'ar' },
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
  { say: 'bdi eshi 7elo', kind: 'dish', tags: ['sweet'], craving: [], allTagged: 'sweet' },
  { say: 'קינוח', kind: 'dish', tags: ['sweet'], allTagged: 'sweet' },
  { say: 'קינוח בלי שוקולד', kind: 'dish', tags: ['sweet'], keepTags: ['sweet'], allTagged: 'sweet', cards: 3, excludes: ['dl-chocolate-cake'] },
  { say: 'בריא', kind: 'dish', tags: ['healthy'], includes: 'bl-greek-salad' },
  { say: 'משהו קליל', kind: 'dish', tags: ['healthy'], craving: [], includes: 'bl-greek-salad' },
  { say: 'קפה קר', kind: 'dish', tags: ['cold_drink'], first: 'bl-iced-coffee' },
  { say: 'שתייה קרה', kind: 'dish', tags: ['cold_drink'], allTagged: 'cold_drink' },
  { say: 'משהו קר', kind: 'dish', tags: ['cold_drink'], craving: [], allTagged: 'cold_drink' },
  { say: 'something cold', kind: 'dish', tags: ['cold_drink'], craving: [], allTagged: 'cold_drink' },
  { say: 'اشي بارد', kind: 'dish', tags: ['cold_drink'], craving: [], allTagged: 'cold_drink' },
  { say: 'cold drink', kind: 'dish', tags: ['cold_drink'], allTagged: 'cold_drink' },
  { say: 'שתייה חמה', kind: 'dish', tags: ['hot_drink'], allTagged: 'hot_drink' },
  { say: 'ארוחת ילדים', kind: 'dish', tags: ['kids'], includes: 'b-kids-meal' },
  { say: 'kids meal', kind: 'dish', tags: ['kids'], includes: 'b-kids-meal' },
  { say: 'בורגר טבעוני', kind: 'dish', tags: ['vegan'], includes: 'b-vegan-burger' },
  { say: 'vegan burger', kind: 'dish', tags: ['vegan'], includes: 'b-vegan-burger' },

  // Exclusions
  { say: 'פיצה בלי בשר', kind: 'dish', craving: ['פיצה'], excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: 'pizza no meat', kind: 'dish', excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: 'pizza bla la7me', kind: 'dish', craving: ['pizza'], excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: 'pizza bidun la7me', kind: 'dish', craving: ['pizza'], excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: 'شاورما بدون لحم', kind: 'dish', excludeTags: ['meat'], includes: 'a-shawarma-chicken', excludes: ['a-shawarma-spicy', 'a-platter'] },
  { say: 'לא חריף', kind: 'dish', excludeTags: ['spicy'], noCardTags: ['spicy'] },
  { say: 'לא רוצה חריף', kind: 'dish', excludeTags: ['spicy'], tags: [], craving: [], noCardTags: ['spicy'] },
  { say: "i don't want spicy", kind: 'dish', excludeTags: ['spicy'], tags: [], craving: [], noCardTags: ['spicy'] },
  { say: 'ما بدي حار', kind: 'dish', excludeTags: ['spicy'], tags: [], craving: [], noCardTags: ['spicy'] },
  { say: 'ma bade 7ar', kind: 'dish', excludeTags: ['spicy'], tags: [], craving: [], noCardTags: ['spicy'] },
  { say: 'not spicy shawarma', kind: 'dish', excludeTags: ['spicy'], excludes: ['a-shawarma-spicy'] },
  { say: 'בלי גבינה', kind: 'dish', excludeTags: ['cheese'], noCardTags: ['cheese'] },
  { say: 'בלי בצל', kind: 'dish', excludes: ['b-onion-rings'] },
  { say: 'פיצה בלי פטריות', kind: 'dish', craving: ['פיצה'], includes: 'm-margherita' },
  { say: 'חריף אבל לא בשר', kind: 'dish', tags: ['spicy'], excludeTags: ['meat'], craving: [], excludes: ['a-shawarma-spicy'] },
  { say: 'בלי קולה', kind: 'dish', keepTags: ['cold_drink'], excludes: ['m-coke', 'a-cola'] },
  { say: 'עוגה בלי קולה', kind: 'dish', includes: 'dl-chocolate-cake' },
  { say: 'קינוח בלי קולה', kind: 'dish', includes: 'dl-chocolate-cake' },
  { say: 'cake without cola', kind: 'dish', includes: 'dl-chocolate-cake' },
  { say: 'no chili shawarma', kind: 'dish', excludeTags: ['spicy'], excludes: ['a-shawarma-spicy'], includes: 'a-shawarma-chicken' },
  { say: 'שווארמה בלי צ׳ילי', kind: 'dish', excludeTags: ['spicy'], excludes: ['a-shawarma-spicy'], includes: 'a-shawarma-chicken' },
  { say: 'ל-4 בלי קולה', kind: 'meal', people: 4, keepTags: ['cold_drink'], excludes: ['m-coke', 'a-cola'] },

  // People and budget
  { say: 'ל-4', kind: 'meal', people: 4, craving: [] },
  { say: 'ל4', kind: 'meal', people: 4, craving: [] },
  { say: 'לארבעה', kind: 'meal', people: 4, craving: [] },
  { say: 'for 4', kind: 'meal', people: 4, craving: [] },
  { say: 'for four people', kind: 'meal', people: 4, craving: [] },
  { say: 'لأربعة', kind: 'meal', people: 4, craving: [] },
  { say: 'لـ٤', kind: 'meal', people: 4, craving: [] },
  { say: '4 אנשים', kind: 'meal', people: 4, craving: [] },
  { say: 'לשניים', kind: 'meal', people: 2, craving: [] },
  { say: 'זוג', kind: 'meal', people: 2, craving: [] },
  { say: 'אני ואשתי', kind: 'meal', people: 2, craving: [] },
  { say: 'انا وصاحبي', kind: 'meal', people: 2, craving: [] },
  { say: 'למשפחה', kind: 'meal', people: 4, craving: [] },
  { say: 'for the family', kind: 'meal', people: 4, craving: [] },
  { say: 'ארוחה ל-4', kind: 'meal', people: 4, craving: [] },
  { say: 'وجبة لأربعة', kind: 'meal', people: 4, craving: [] },
  { say: 'ארוחה זוגית', kind: 'meal', people: 2, craving: [] },
  { say: 'ארוחה משפחתית', kind: 'meal', people: 4, craving: [] },
  { say: 'family meal', kind: 'meal', people: 4, craving: [] },
  { say: 'وجبة عائلية', kind: 'meal', people: 4, craving: [] },
  { say: 'עד 50', kind: 'meal', budget: 5000, craving: [], noPeople: true },
  { say: 'עד ₪50', kind: 'meal', budget: 5000, craving: [], noPeople: true },
  { say: 'מתחת ל-50', kind: 'meal', budget: 5000, craving: [], noPeople: true },
  { say: 'בתקציב של 100', kind: 'meal', budget: 10000, craving: [], noPeople: true },
  { say: '50 ש"ח', kind: 'meal', budget: 5000, craving: [] },
  { say: 'under 60', kind: 'meal', budget: 6000, craving: [] },
  { say: 'up to 80 shekels', kind: 'meal', budget: 8000, craving: [] },
  { say: 'حتى 70 شيكل', kind: 'meal', budget: 7000, craving: [] },
  { say: '150₪', kind: 'meal', budget: 15000, craving: [] },
  { say: 'ל-4 עד 150', kind: 'meal', people: 4, budget: 15000, craving: [] },
  { say: 'ארוחה ל-4 עד 150', kind: 'meal', people: 4, budget: 15000, craving: [], excludes: ['b-kids-meal'] },
  { say: 'משהו חריף ל-4 עד 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, craving: [], includes: 'm-spicy-family' },
  { say: 'something spicy for 4 under 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, craving: [], includes: 'm-spicy-family' },
  { say: 'اشي حار لأربعة بحدود 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, craving: [], includes: 'm-spicy-family' },
  { say: 'shi 7ar la 4 la7ad 150', kind: 'meal', tags: ['spicy'], people: 4, budget: 15000, craving: [], includes: 'm-spicy-family' },
  { say: 'פיצה ל-4', kind: 'meal', people: 4, branch: 'morano' },
  { say: 'pizza for 2', kind: 'meal', people: 2, branch: 'morano', includes: 'm-combo-pair' },
  { say: 'פיצה עד 50', kind: 'meal', budget: 5000, includes: 'm-margherita' },
  { say: 'שווארמה ל-3 במשלוח', kind: 'meal', people: 3, mode: 'delivery', branch: 'abu' },
  { say: 'ל-6 עד 30', kind: 'blocked', people: 6, budget: 3000, cards: 0, textHas: [formatILS(3000, 'he')] },

  // Cheap
  { say: 'זול', kind: 'dish', cheap: true, sortedByPrice: true, noCardTags: ['cold_drink', 'hot_drink'] },
  { say: 'הכי זול', kind: 'dish', cheap: true, sortedByPrice: true, noCardTags: ['cold_drink', 'hot_drink'] },
  { say: 'cheapest pizza', kind: 'dish', cheap: true, first: 'm-margherita' },
  { say: 'ارخص اشي', kind: 'dish', cheap: true, sortedByPrice: true },
  { say: 'משהו זול ומשביע', kind: 'dish', cheap: true, craving: [] },

  // Mode
  { say: 'משלוח פיצה', kind: 'dish', mode: 'delivery', craving: ['פיצה'] },
  { say: 'pizza delivery', kind: 'dish', mode: 'delivery' },
  { say: 'סושי באיסוף', kind: 'dish', mode: 'pickup', includes: 's-salmon-roll' },
  { say: 'توصيل شاورما', kind: 'dish', mode: 'delivery', includes: 'a-shawarma-chicken' },
  { say: 'וופל באיסוף', kind: 'blocked', mode: 'pickup' },
  { say: 'איסוף עצמי', kind: 'dish', mode: 'pickup', craving: [], places: undefined },
  { say: 'לשבת במסעדה', kind: 'dish', mode: 'dine_in', craving: [] },

  // Places
  { say: 'ממורנו', kind: 'place', places: ['morano'] },
  { say: 'מורנו', kind: 'place', places: ['morano'] },
  { say: 'something from morano', kind: 'place', places: ['morano'] },
  { say: 'من مورانو', kind: 'place', places: ['morano'] },
  { say: 'פיצה ממורנו', kind: 'dish', places: ['morano'], craving: ['פיצה'] },
  { say: 'אבו סלים', kind: 'place', places: ['abu'] },
  { say: 'sumo', kind: 'place', places: ['sumo'] },
  { say: 'what does morano have', kind: 'place', places: ['morano'] },
  { say: 'התפריט של מורנו', kind: 'place', places: ['morano'] },
  { say: 'ابو سليم شاورما', kind: 'dish', places: ['abu'], includes: 'a-shawarma-chicken' },
  { say: 'מבאגט פארס', kind: 'closed', textHas: ['באגט פארס', '22:00'] },

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
  { say: 'عرض على بيتزا', kind: 'deal', shortcut: 'deals', craving: ['بيتزا'], first: 'm-combo-pair' },
  { say: 'deal on pizza', kind: 'deal', shortcut: 'deals', craving: ['pizza'], first: 'm-combo-pair' },
  { say: 'מבצעים', kind: 'closed', data: dealPlacesClosed, textHas: ['מורנו', '21:30'], cards: 0 },
  { say: 'deals', kind: 'closed', data: dealPlacesClosed, textHas: ['Morano', '21:30'], cards: 0 },
  { say: 'شو في عروض', kind: 'closed', data: dealPlacesClosed, textHas: ['مورانو', '21:30'], cards: 0 },
  { say: 'מבצע על פיצה', kind: 'closed', data: dealPlacesClosed, textHas: ['מורנו', '21:30'], cards: 0 },

  // Time of day
  { say: 'ארוחת בוקר', kind: 'dish', meal: 'breakfast', firstTagIn: ['breakfast', 'hot_drink'] },
  { say: 'breakfast', kind: 'dish', meal: 'breakfast', firstTagIn: ['breakfast', 'hot_drink'] },
  { say: 'فطور', kind: 'dish', meal: 'breakfast', firstTagIn: ['breakfast', 'hot_drink'] },
  { say: 'משהו בלילה', kind: 'dish', meal: 'late' },
  { say: 'dinner', kind: 'dish', meal: 'dinner' },
  { say: 'ארוחת ערב ל-2', kind: 'meal', meal: 'dinner', people: 2 },

  // Refinements
  { say: ['משהו חריף', 'יותר זול'], kind: 'dish', tags: ['spicy'], maxPrice: true },
  { say: ['פיצה', 'משהו אחר'], kind: 'dish', craving: ['פיצה'], excludeDishes: true, fresh: true },
  { say: ['פיצה', 'עוד'], craving: ['פיצה'], page: 1, fresh: true },
  { say: ['ל-4', 'ל-6 במקום'], kind: 'meal', people: 6 },
  { say: ['שווארמה', 'ממקום אחר'], kind: 'blocked' },
  { say: ['פיצה', 'בלי בשר'], kind: 'dish', craving: ['פיצה'], excludeTags: ['meat'], excludes: ['m-pepperoni'] },
  { say: ['משהו חריף', 'לא חריף'], kind: 'dish', tags: [], excludeTags: ['spicy'] },
  { say: ['ל-4 עד 150', 'יותר זול'], kind: 'meal', people: 4, budgetBelow: 15000 },
  { say: ['סושי', 'במשלוח'], kind: 'blocked', mode: 'delivery' },
  { say: ['פיצה', 'ל-4'], kind: 'meal', craving: ['פיצה'], people: 4, branch: 'morano' },
  { say: ['הרגיל שלי', 'ל-4'], kind: 'meal', people: 4 },
  { say: ['pizza for 2', 'משהו אחר'], kind: 'meal', people: 2, fresh: true, excludes: ['m-combo-pair'] },
  { say: ['ל-2', 'משהו אחר'], kind: 'meal', people: 2, fresh: true, excludes: ['m-combo-pair'] },
  { say: ['ל-2', 'עוד'], kind: 'meal', people: 2, fresh: true },
  { say: ['משהו חריף ל-4', 'עוד', 'עוד', 'משהו אחר'], kind: 'meal', tags: ['spicy'], includes: 'm-arrabbiata', fresh: true },
  { say: ['לילדים ל-2', 'עוד', 'משהו אחר'], kind: 'blocked', tags: ['kids'], textLacks: ['לילדים'] },
  { say: ['auutrnv', 'יותר זול'], kind: 'dish', craving: ['שווארמה'] },

  // Misunderstandings and closed places
  { say: 'asdkjh', kind: 'reprompt' },
  { say: ['asdkjh', 'qwpoeiru'], kind: 'reprompt', cards: 0 },
  { say: 'hello', kind: 'reprompt' },
  { say: 'שלום', kind: 'reprompt' },
  { say: 'مرحبا', kind: 'reprompt' },
  { say: 'גכעבהט', kind: 'reprompt' },
  { say: 'auutrnv', kind: 'dish', includes: 'a-shawarma-chicken' },
  { say: 'באגט', kind: 'closed', textHas: ['באגט פארס'] },
  { say: 'baguette schnitzel', kind: 'closed', textHas: ['Baguette Pars'] },

  // Final review: diet filters on untagged meat, sold-out deal members, big bottles
  { say: ['שווארמה', 'בלי בשר'], kind: 'dish', excludeTags: ['meat'], includes: 'a-shawarma-chicken', excludes: ['a-shawarma-laffa', 'a-shawarma-spicy', 'a-platter'] },
  { say: ['המבורגר', 'בלי בשר'], kind: 'dish', excludeTags: ['meat'], excludes: ['b-cheeseburger', 'b-classic'], noCardTags: ['meat'] },
  { say: 'צ׳יזבורגר', kind: 'dish', first: 'b-cheeseburger' },
  { say: 'cheeseburger', kind: 'dish', first: 'b-cheeseburger' },
  { say: 'מה במבצע?', kind: 'deal', data: () => fixtureData({ soldOut: ['m-coke'] }), note: 'coke sold out', excludes: ['m-combo-pair'], includesAll: ['m-promo-pasta', 'b-combo-kids'], cards: 2 },
  { say: 'ארוחה ל-4 עד 150 מאבו סלים', kind: 'meal', people: 4, branch: 'abu', maxQty: { 'a-cola': 2 } },
];

const fixture = fixtureData();

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
    const title = [c.say].flat().join(' → ') + (c.thenChip !== undefined ? ` → chip ${c.thenChip}` : '') + (c.data ? ` (${c.note ?? 'deal places closed'})` : '');
    it(title, () => {
      const data = c.data?.() ?? fixture;
      const opts = { signedIn: c.signedIn ?? true, uiLang: 'he' as const };
      let conv: Conversation = EMPTY_CONVERSATION;
      for (const s of [c.say].flat()) conv = respond(conv, s, data, opts);
      if (c.thenChip !== undefined) conv = respond(conv, (conv.turns.at(-1) as AssistantTurn).chips[c.thenChip]!, data, opts);
      const assistant = conv.turns.filter((t): t is AssistantTurn => t.role === 'assistant');
      const turn = assistant.at(-1)!;
      const r = conv.last?.request;
      const ids = turn.cards.flatMap(cardIds);
      const at = `"${title}" → ${turn.kind} "${turn.text}" [${ids.join(', ')}]`;
      const dishCards = turn.cards.filter((x): x is Extract<Card, { kind: 'dish' }> => x.kind === 'dish');
      const entryOf = (x: { branchId: string; productId: string }) => data.dishById.get(`${x.branchId}/${x.productId}`)!.entry;
      if (c.kind) expect(turn.kind, `kind for ${at}`).toBe(c.kind);
      if (c.craving) expect(r?.craving, at).toEqual(c.craving.flatMap((w) => tokenize(w)));
      if (c.tags) expect(r?.tags, at).toEqual(c.tags);
      if (c.excludeTags) expect(r?.exclude.tags, at).toEqual(expect.arrayContaining(c.excludeTags));
      for (const t of c.keepTags ?? []) expect(r?.exclude.tags ?? [], at).not.toContain(t);
      if (c.groups !== undefined) expect(r?.groups?.length ?? 0, at).toBe(c.groups);
      if (c.people !== undefined) expect(r?.people, at).toBe(c.people);
      if (c.noPeople) expect(r?.people, at).toBeUndefined();
      if (c.budget !== undefined) expect(r?.budgetAgorot, at).toBe(c.budget);
      if (c.budgetBelow !== undefined) expect(r?.budgetAgorot, at).toBeLessThan(c.budgetBelow);
      if (c.maxPrice) expect(r?.maxPriceAgorot, at).toBeGreaterThan(0);
      if (c.mode) expect(r?.mode, at).toBe(c.mode);
      if ('places' in c && c.places === undefined) expect(r?.placeBranchIds ?? [], at).toEqual([]);
      if (c.places) expect(r?.placeBranchIds, at).toEqual(c.places);
      if (c.meal) expect(r?.meal, at).toBe(c.meal);
      if (c.shortcut) expect(r?.shortcut, at).toBe(c.shortcut);
      if (c.cheap) expect(r?.cheap, at).toBe(true);
      if (c.page !== undefined) expect(r?.page, at).toBe(c.page);
      if (c.excludeDishes) expect(r?.exclude.dishIds.length, at).toBeGreaterThan(0);
      if (c.lang) expect(r?.lang, at).toBe(c.lang);
      if (c.includes) expect(ids, at).toContain(c.includes);
      for (const x of c.includesAll ?? []) expect(ids, at).toContain(x);
      for (const group of c.includesAny ?? []) expect(ids.some((x) => group.includes(x)), `one of [${group.join(', ')}] in ${at}`).toBe(true);
      if (c.first) expect(ids[0], at).toBe(c.first);
      for (const x of c.excludes ?? []) expect(ids, at).not.toContain(x);
      if (c.branch) expect(turn.cards[0], at).toMatchObject({ kind: 'meal', basket: { branchId: c.branch } });
      if (c.cards !== undefined) expect(turn.cards, at).toHaveLength(c.cards);
      if (c.allTagged) for (const card of dishCards) expect(entryOf(card).tags, at).toContain(c.allTagged);
      if (c.cardTypes) {
        expect(dishCards.length, at).toBeGreaterThan(0);
        for (const card of dishCards) expect(c.cardTypes, at).toContain(entryOf(card).dishType);
      }
      if (c.sortedByPrice) {
        const prices = dishCards.map((x) => entryOf(x).priceAgorot);
        expect(prices.length, at).toBeGreaterThan(1);
        expect(prices, at).toEqual([...prices].sort((a, b) => a - b));
      }
      for (const t of c.hasTypes ?? []) expect(dishCards.map((x) => entryOf(x).dishType), at).toContain(t);
      if (c.noCardTags) {
        expect(dishCards.length, at).toBeGreaterThan(0);
        for (const card of dishCards) for (const t of c.noCardTags) expect(entryOf(card).tags ?? [], at).not.toContain(t);
      }
      if (c.firstTagIn) {
        const first = turn.cards[0]!;
        expect(first.kind, at).toBe('dish');
        const tags = entryOf(first as { branchId: string; productId: string }).tags ?? [];
        expect(tags.some((t) => c.firstTagIn!.includes(t)), at).toBe(true);
      }
      if (c.fresh) {
        const freshIds = (x: Card) => (x.kind === 'meal' ? [x.basket.anchorId] : cardIds(x));
        const before = assistant.at(-2)!.cards.flatMap(freshIds);
        const now = turn.cards.flatMap(freshIds);
        expect(now.length, at).toBeGreaterThan(0);
        for (const id of now) expect(before, at).not.toContain(id);
      }
      for (const [id, n] of Object.entries(c.maxQty ?? {})) {
        const lines = turn.cards.flatMap((x) => (x.kind === 'meal' ? x.basket.lines : [])).filter((l) => l.productId === id);
        expect(lines.length, at).toBeGreaterThan(0);
        for (const l of lines) expect(l.qty, at).toBeLessThanOrEqual(n);
      }
      for (const s of c.textHas ?? []) expect(turn.text, at).toContain(s);
      for (const s of c.textLacks ?? []) expect(turn.text, at).not.toContain(s);
    });
  }
});

describe('golden copy', () => {
  it('Arabic says "now" one way (هلا), never هلأ', () => {
    const keys: ReplyKey[] = ['picks', 'picksNow', 'partial', 'mealPartial', 'mealBudgetPartial', 'meal', 'mealBudget', 'deals', 'dealsNone', 'usual', 'usualNone', 'usualSignedOut', 'surprise', 'place', 'blockedTags', 'blockedExclude', 'blockedOther', 'blockedBudget', 'blockedMode', 'blockedPlace', 'closed', 'closedNoTime', 'closedAll', 'closedAllNoTime', 'noMore', 'reprompt1', 'reprompt2', 'upsell'];
    for (const k of keys) for (let s = 0; s < 3; s++) expect(reply(k, 'ar', { place: 'x', time: '10:00', slot: 'x', people: 2, budget: '₪50' }, s), k).not.toContain('هلأ');
  });
});
