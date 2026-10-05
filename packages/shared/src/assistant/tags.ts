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
  hummus: ['חומוס', 'מסבחה', 'hummus', 'humus', 'msabbaha', 'حمص', 'مسبحة', 'فول'],
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

export const allText = (l?: Localized) => [l?.he, l?.ar, l?.en].filter(Boolean).join(' ');

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
  // Beef, chicken and fish dishes are not drinks, whatever else their words say.
  if (tags.has('meat') || tags.has('chicken') || tags.has('fish')) for (const t of DRINK_TAGS) tags.delete(t);
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
