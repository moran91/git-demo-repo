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
  meat: ['בשר', 'בשרי', 'בקר', 'עגל', 'כבש', 'טלה', 'אנטריקוט', 'סטייק', 'קבב', 'קציצות', 'המבורגר', 'בורגר', 'צ׳יזבורגר', 'ציזבורגר', "צ'יזבורגר", 'מנסף', 'מעורב ירושלמי', 'מעורב בפיתה', 'מעורב בלאפה', 'מנת מעורב', 'שיפוד', 'שיפודים', 'שיפודי', 'שישליק', 'עראיס', 'פפרוני', 'סלמי', 'נקניק', 'נקניקיה', 'נקניקיות', 'פסטרמה', 'פסטרמות', 'קבנוס', 'מרגז', 'כבד', 'meat', 'beef', 'veal', 'lamb', 'steak', 'entrecote', 'kebab', 'kofta', 'burger', 'hamburger', 'cheeseburger', 'mansaf', 'meorav', 'skewer', 'skewers', 'shish', 'shishlik', 'arayes', 'pepperoni', 'salami', 'sausage', 'hot dog', 'pastrami', 'لحم', 'لحمة', 'عجل', 'غنم', 'خروف', 'ستيك', 'كباب', 'كفتة', 'برغر', 'همبرغر', 'برجر', 'تشيز برغر', 'تشيزبرغر', 'تشيز برجر', 'منسف', 'شيش', 'شقف', 'عرايس', 'بيبروني', 'سلامي', 'نقانق', 'سجق', 'كبدة', 'بسطرمة'],
  chicken: ['עוף', 'עופות', 'פרגית', 'פרגיות', 'שניצל', 'שניצלונים', 'חזה', 'כנפיים', 'כנפי', 'נאגטס', "צ'קן", 'צ׳קן', "צ'יקן", 'צ׳יקן', 'הודו', 'chicken', 'schnitzel', 'wings', 'nuggets', 'taouk', 'turkey', 'دجاج', 'جاج', 'فراخ', 'شنيتسل', 'طاووق', 'اجنحة', 'ناجتس', 'ديك رومي', 'حبش'],
  fish: ['דג', 'דגים', 'סלמון', 'טונה', 'שרימפס', 'לברק', 'דניס', 'fish', 'salmon', 'tuna', 'shrimp', 'shrimps', 'seafood', 'سمك', 'سلمون', 'تونة', 'قريدس', 'جمبري'],
  cheese: ['גבינה', 'גבינות', 'מוצרלה', 'צהובה', 'פטה', 'בולגרית', 'חלומי', 'רוקפור', 'פרמזן', 'צ׳דר', 'צדר', 'cheese', 'mozzarella', 'feta', 'halloumi', 'parmesan', 'cheddar', 'gouda', 'جبنة', 'جبن', 'موزاريلا', 'حلوم', 'فيتا', 'شيدر', 'بارميزان'],
  sharing: ['מגש', 'מגשים', 'פלטה', 'פלטת', 'משפחתי', 'משפחתית', 'זוגי', 'זוגית', 'מארז', 'platter', 'tray', 'family', 'sharing', 'bucket', 'صينية', 'عائلي', 'عائلية', 'بلاتر'],
};

/** Words that name a dish type; a dish's type is the one whose words it uses most (name ×3, category ×2, description ×1). */
export const TYPE_TERMS: Record<DishType, readonly string[]> = {
  pizza: ['פיצה', 'פיצות', 'מרגריטה', 'pizza', 'pizzas', 'margherita', 'بيتزا'],
  pasta: ['פסטה', 'ספגטי', 'פנה', 'רביולי', 'לזניה', 'פטוצ׳יני', 'פטוציני', 'ניוקי', 'מקרוני', 'pasta', 'spaghetti', 'penne', 'ravioli', 'lasagna', 'lasagne', 'fettuccine', 'gnocchi', 'macaroni', 'معكرونة', 'باستا', 'سباغيتي', 'لازانيا', 'رافيولي'],
  burger: ['המבורגר', 'בורגר', 'צ׳יזבורגר', 'ציזבורגר', "צ'יזבורגר", 'burger', 'hamburger', 'cheeseburger', 'برغر', 'همبرغر', 'برجر', 'تشيز برغر', 'تشيزبرغر', 'تشيز برجر'],
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
/** Meat words that also name chicken or fish dishes ("בורגר עוף", "שיפודי פרגית", "شيش طاووق", "סטייק סלמון", turkey pastrami): alone they do not make a chicken or fish dish meat. */
const GENERIC_MEAT = termMatcher(['המבורגר', 'בורגר', 'שיפוד', 'שיפודים', 'שיפודי', 'שישליק', 'סטייק', 'סטייקים', 'פסטרמה', 'פסטרמות', 'burger', 'hamburger', 'skewer', 'skewers', 'shish', 'shishlik', 'steak', 'steaks', 'pastrami', 'برغر', 'همبرغر', 'برجر', 'شيش', 'شقف', 'ستيك', 'بسطرمة']);
/** Words for a cut that can be cooked from a vegetable or cheese too ("שיפודי ירקות", "סטייק חלומי"). */
const SKEWER = termMatcher(['שיפוד', 'שיפודים', 'שיפודי', 'שישליק', 'סטייק', 'סטייקים', 'skewer', 'skewers', 'shish', 'shishlik', 'steak', 'steaks', 'شيش', 'شقف', 'ستيك']);
const SKEWER_ONLY = termMatcher(['שיפוד', 'שיפודים', 'שיפודי', 'שישליק', 'skewer', 'skewers', 'shish', 'shishlik', 'شيش', 'شقف']);
const VEGETABLE = termMatcher(['ירקות', 'ירק', 'vegetable', 'vegetables', 'veggies', 'خضار', 'خضروات']);
const HALLOUMI = termMatcher(['חלומי', 'halloumi', 'حلوم']);
/** Types that are meat unless the dish says chicken, fish, vegetarian or vegan ("שווארמה בלאפה", "Cheeseburger"). */
const MEAT_TYPES: readonly DishType[] = ['burger', 'shawarma'];
const NOT_MEAT_TAGS: readonly DishTag[] = ['chicken', 'fish', 'vegetarian', 'vegan'];
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
  const meatWords = countMatches(text, TAG_MATCHERS.meat);
  // Halloumi is vegetarian when the only meaty words are cuts a cheese can be cooked as ("סטייק חלומי", "שיפודי חלומי"); a halloumi burger or shawarma stays what its type says.
  if (!tags.has('chicken') && !tags.has('fish') && !(dishType && MEAT_TYPES.includes(dishType)) && countMatches(text, HALLOUMI) > 0 && meatWords <= countMatches(text, SKEWER)) tags.add('vegetarian');
  if (tags.has('vegetarian') || tags.has('vegan')) {
    // Vegetarian and vegan beat any meat word ("בלי בשר", "Vegan kebab").
    tags.delete('meat');
  } else if (tags.has('meat')) {
    // A burger, skewer or steak word alone is not "meat" when the dish is chicken or fish (turkey is chicken here).
    if ((tags.has('chicken') || tags.has('fish')) && meatWords <= countMatches(text, GENERIC_MEAT)) tags.delete('meat');
    // A skewer is vegetable or cheese when nothing else says meat.
    else if (meatWords <= countMatches(text, SKEWER_ONLY) && (tags.has('cheese') || countMatches(text, VEGETABLE) > 0)) tags.delete('meat');
  }
  // A burger or shawarma is beef or lamb unless it says otherwise ("Cheeseburger", "שווארמה בלאפה").
  if (dishType && MEAT_TYPES.includes(dishType) && !NOT_MEAT_TAGS.some((t) => tags.has(t))) tags.add('meat');
  // A dessert is never meat ("שיפוד וופל"); a sweet skewer or steak is a dessert even when its words also name a main.
  if (dishType === 'desserts' || (tags.has('sweet') && (!dishType || meatWords <= countMatches(text, SKEWER)))) tags.delete('meat');
  // Beef, chicken and fish dishes are not drinks, whatever else their words say.
  if (tags.has('meat') || tags.has('chicken') || tags.has('fish')) for (const t of DRINK_TAGS) tags.delete(t);
  if (tags.has('cold_drink')) tags.delete('hot_drink');
  // "סלט קר" is not a drink: drink tags belong to drinks (or to dishes with no known type).
  if (dishType && dishType !== 'drinks') for (const t of DRINK_TAGS) tags.delete(t);
  if (dishType === 'drinks' && !tags.has('hot_drink')) tags.add('cold_drink');
  if (dishType === 'desserts') tags.add('sweet');
  if (tags.has('vegan')) tags.add('vegetarian');
  if (dishType && VEGETARIAN_TYPES.includes(dishType) && !tags.has('meat') && !tags.has('chicken') && !tags.has('fish')) tags.add('vegetarian');
  const serves = pickServes(name, desc, dishType, dishType === 'drinks' || tags.has('cold_drink') ? `${allText(input.name)} ${allText(input.description)}` : undefined);
  // A big bottle is shared, but it is not a sharing platter, typed or not.
  if (serves >= 3 && dishType !== 'drinks' && !DRINK_TAGS.some((t) => tags.has(t))) tags.add('sharing');
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

/** `drinkText`: a drink's raw texts, read for its size. */
function pickServes(name: Prepared, desc: Prepared, dishType: DishType | undefined, drinkText?: string): number {
  const explicit = explicitPeople(name) ?? explicitPeople(desc);
  if (explicit) return explicit;
  for (const [n, m] of SERVES) if (countMatches(name, m) > 0) return n;
  const litres = drinkText === undefined ? undefined : drinkLitres(drinkText);
  if (litres !== undefined) return drinkServes(litres);
  if (dishType === 'pizza' && countMatches(name, SINGLE_PORTION) === 0) return 2;
  return 1;
}

/** A drink serves one person per 0.4 L (a glass and a half), at least 1 and at most 6: 1.5 L → 4, 2 L → 5, a can → 1. */
const LITRES_PER_PERSON = 0.4;
const MAX_DRINK_SERVES = 6;
export function drinkServes(litres: number): number {
  return Math.min(MAX_DRINK_SERVES, Math.max(1, Math.round(litres / LITRES_PER_PERSON)));
}

const DRINK_SIZES: Array<readonly [RegExp, (m: RegExpExecArray) => number]> = [
  // "330 מ״ל", "500ml", "250 مل"
  [/(\d+(?:[.,]\d+)?)\s*(?:מ["״׳']ל|מל|ml|مل)(?!\p{L})/u, (m) => num(m[1]!) / 1000],
  // "ליטר וחצי", "لتر ونص", "a litre and a half"
  [/(?:ליטר\s+וחצי|لتر\s+و\s*(?:نص|نصف)|(?:liter|litre)\s+and\s+a\s+half)/u, () => 1.5],
  // "חצי ליטר", "نص لتر", "half a litre"
  [/(?:חצי\s+ליטר|(?:نص|نصف)\s+لتر|half\s+(?:a\s+)?(?:liter|litre))/u, () => 0.5],
  // "1.5 ליטר", "1.5L", "2 لتر"
  [/(\d+(?:[.,]\d+)?)\s*(?:ליטר|ל["׳']|liters?|litres?|ltr|lt|l|لتر|ليتر)(?!\p{L})/u, (m) => num(m[1]!)],
  // "בקבוק גדול", "large bottle", "family size", "قنينة كبيرة": the usual 1.5 L
  [/(?:בקבוק\s+גדול|(?:large|big)\s+bottle|family\s+size|(?:قنينة|زجاجة|قنينه)\s+كبير[ةه]?)/u, () => 1.5],
  // A bare "ליטר" / "litre" / "لتر": one litre
  [/(?:^|\P{L})(?:ליטר|liter|litre|لتر|ليتر)(?!\p{L})/u, () => 1],
];
const num = (s: string) => Number(s.replace(',', '.'));

/** A drink's size in litres, read from its texts ("קולה 1.5 ליטר", "Coke 330ml", "ספרייט ליטר וחצי"). */
export function drinkLitres(text: string): number | undefined {
  const t = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).toLowerCase();
  for (const [re, size] of DRINK_SIZES) {
    const m = re.exec(t);
    if (m) {
      const litres = size(m);
      if (litres > 0 && Number.isFinite(litres)) return litres;
    }
  }
  return undefined;
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
