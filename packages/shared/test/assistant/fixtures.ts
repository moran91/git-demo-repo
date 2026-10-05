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
  ['morano', { branchId: 'morano', updatedAt: '', pairs: { 'm-margherita': [{ productId: 'm-coke' }] } }],
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
