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
export const SURPRISE = phrases(['תפתיע אותי', 'תפתיעו אותי', 'תפתיע', 'תפתיעו', 'הפתעה', 'תבחר לי', 'תבחרו לי', 'תבחר אתה', 'לא יודע', 'לא יודעת', 'לא יודעים', 'מה שבא', 'surprise me', 'surprise', 'you choose', 'you pick', 'dont know', 'i dont know', 'idk', 'random', 'anything', 'whatever', 'فاجئني', 'فاجئنا', 'مفاجأة', 'اختار انت', 'اختارلي', 'مش عارف', 'مش عارفة', 'اي اشي', 'أي شي', 'ما بعرف', 'بعرفش', 'faji2ni', 'fajini', 'fajeni', 'fajje2ni', 'ma ba3ref', 'mish 3aref']);
export const DEALS = phrases(['מה במבצע', 'מבצע', 'מבצעים', 'דיל', 'דילים', 'הנחה', 'הנחות', 'קומבו', 'deal', 'deals', 'offer', 'offers', 'special', 'specials', 'promo', 'promotion', 'promotions', 'discount', 'combo', 'combos', 'عرض', 'عروض', 'خصم', 'خصومات', 'تخفيض', 'تنزيلات', 'كومبو', '3roud', '3orod', '3ard', '3ared', 'khasm']);
export const OTHER_PLACE = phrases(['מקום אחר', 'מסעדה אחרת', 'another place', 'other place', 'different place', 'another restaurant', 'somewhere else', 'محل تاني', 'مطعم تاني', 'مكان تاني', 'محل ثاني']);
export const CHEAPER = phrases(['יותר זול', 'זול יותר', 'פחות יקר', 'cheaper', 'less expensive', 'ارخص', 'أرخص', 'ارخص شوي']);
export const CHEAP = phrases(['הכי זול', 'זול', 'זולה', 'זולים', 'זולות', 'בזול', 'חסכוני', 'cheap', 'cheapest', 'affordable', 'budget', 'رخيص', 'رخيصة', 'الارخص', 'rkhis', 'r5is', 'rakhis', 'r5ees', 'rkhees', 'arkhas', 'ar5as']);
export const FAMILY = phrases(['ארוחה משפחתית', 'ארוחת משפחה', 'family meal', 'family dinner', 'وجبة عائلية', 'وجبة للعيلة', 'משפחה', 'family', 'عيلة', 'عائلة']);
export const COMPANION = phrases(['ואשתי', 'ובעלי', 'וחבר', 'וחברה', 'וחברתי', 'وصاحبي', 'وصاحبتي', 'ومرتي', 'وجوزي', 'وحبيبتي', 'with my wife', 'with my husband', 'with a friend', 'and my wife', 'and my husband', 'and a friend', 'ארוחה זוגית', 'ארוחה לזוג', 'couple meal', 'date night', 'وجبة زوجية', 'وجبة لشخصين']);
export const MODES: Array<readonly [FulfillmentMode, Phrase[]]> = [
  ['delivery', phrases(['משלוח', 'משלוחים', 'דליברי', 'delivery', 'deliver', 'delivered', 'توصيل', 'ديليفري', 'دليفري', 'tawsil', 'tawseel', 'tawsel', 'twsil'])],
  ['pickup', phrases(['איסוף עצמי', 'איסוף', 'לאסוף', 'טייק אווי', 'טייקאווי', 'pickup', 'pick up', 'takeaway', 'take away', 'to go', 'استلام', 'تيك اواي', 'istilam', 'estilam'])],
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
  ['healthy', phrases([...TAG_TERMS.healthy, 'קליל', 'קלילה', 'קלילים', 'קלילות', 'خفيف', 'خفيفة'])],
  ['sweet', phrases(['מתוק', 'מתוקה', 'מתוקים', 'קינוח', 'קינוחים', 'sweet', 'sweets', 'dessert', 'desserts', 'حلو', 'حلويات', 'تحلاية', 'ديزرت', '7elo', '7elwe', '7ilo', '7elou', '7lo'])],
  ['cold_drink', phrases(['שתייה קרה', 'שתיה קרה', 'משקה קר', 'משהו קר לשתות', 'cold drink', 'something cold to drink', 'מה קר', 'משהו קר', 'something cold', 'מה יש קר', 'مشروب بارد', 'اشي بارد', 'شي بارد', 'eshi bared', 'shi bared', 'קר', 'קרה', 'קרים', 'קרות', 'cold', 'iced', 'بارد', 'باردة', 'bared'])],
  ['hot_drink', phrases(['שתייה חמה', 'שתיה חמה', 'משקה חם', 'hot drink', 'something hot to drink', 'something warm to drink', 'مشروب ساخن', 'مشروب سخن'])],
  ['sharing', phrases(['לשתף', 'לחלוק', 'to share', 'sharing', 'للمشاركة'])],
];
export const MORE = set(['עוד', 'more', 'كمان', 'المزيد', 'اكثر']);
export const OTHER = set(['אחר', 'אחרת', 'אחרים', 'אחרות', 'else', 'other', 'different', 'another', 'تاني', 'ثاني', 'غيره', 'غيرها']);
export const NEGATION = set(['בלי', 'ללא', 'לא', 'בלא', 'without', 'no', 'not', 'non', 'بدون', 'بلا', 'مش', 'لا', 'بلاش', 'غير', 'bdun', 'bidun', 'bdoon', 'bidoon', 'bala', 'bla', 'mish', 'msh', 'ma', 'ما', 'dont', 'doesnt', 'didnt']);
export const CURRENCY = set(['₪', 'שקל', 'שקלים', 'שח', 'nis', 'ils', 'shekel', 'shekels', 'شيكل', 'شيقل', 'شيكلات', 'شواكل']);
export const BUDGET = set(['עד', 'מקסימום', 'מקס', 'מתחת', 'פחות', 'תקציב', 'בתקציב', 'under', 'below', 'max', 'maximum', 'upto', 'budget', 'less', 'within', 'حتى', 'لحد', 'اقل', 'أقل', 'ميزانية', 'بحدود', 'تحت', 'ماكس', 'la7ad', '7atta', '7ata']);
export const FOR = set(['ל', 'for', 'ل', 'la']);
/** Words that sit between a budget word and its number: "מתחת ל-50", "בתקציב של 100", "פחות מ-50", "less than 50". */
export const CONNECT = set(['ל', 'ل', 'של', 'מ', 'מן', 'من', 'than', 'of', 'to', '₪']);
export const FROM = set(['from', 'מ', 'מן', 'من']);
export const NUMBER_WORDS = new Map<string, number>(
  ([
    ['אחד', 1], ['אחת', 1], ['שניים', 2], ['שתיים', 2], ['שנינו', 2], ['זוג', 2], ['שלושה', 3], ['שלוש', 3], ['שלושתנו', 3], ['ארבעה', 4], ['ארבע', 4], ['חמישה', 5], ['חמש', 5], ['שישה', 6], ['שש', 6], ['שבעה', 7], ['שמונה', 8], ['תשעה', 9], ['עשרה', 10], ['שתי', 2], ['שני', 2], ['עשרים', 20], ['שלושים', 30], ['ארבעים', 40], ['חמישים', 50], ['שישים', 60], ['שבעים', 70], ['שמונים', 80], ['תשעים', 90], ['מאה', 100], ['מאתיים', 200],
    ['واحد', 1], ['وحدة', 1], ['اثنين', 2], ['اثنان', 2], ['ثنين', 2], ['اتنين', 2], ['ثلاثة', 3], ['ثلاث', 3], ['تلاتة', 3], ['اربعة', 4], ['أربعة', 4], ['اربع', 4], ['خمسة', 5], ['خمس', 5], ['ستة', 6], ['سبعة', 7], ['ثمانية', 8], ['تمانية', 8], ['تسعة', 9], ['عشرة', 10], ['شخصين', 2], ['تنين', 2], ['اثنتين', 2], ['عشرين', 20], ['ثلاثين', 30], ['تلاتين', 30], ['اربعين', 40], ['أربعين', 40], ['خمسين', 50], ['ستين', 60], ['سبعين', 70], ['ثمانين', 80], ['تمانين', 80], ['تسعين', 90], ['مية', 100], ['مئة', 100], ['ميتين', 200], ['مئتين', 200],
    ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['couple', 2], ['pair', 2], ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90], ['hundred', 100],
    // Arabizi
    ['wa7ad', 1], ['wahad', 1], ['tnen', 2], ['tnein', 2], ['itnen', 2], ['tlate', 3], ['tlata', 3], ['talata', 3], ['arba3a', 4], ['arba3', 4], ['5amse', 5], ['5amsa', 5], ['khamsa', 5], ['khamse', 5], ['sitte', 6], ['sitta', 6], ['sab3a', 7], ['tmane', 8], ['tmanye', 8], ['tes3a', 9], ['tis3a', 9], ['3ashra', 10], ['3ashara', 10], ['5amsin', 50], ['khamsin', 50], ['mye', 100], ['miye', 100], ['meye', 100],
  ] as const).map(([w, n]) => [normalizeSearch(w), n]),
);
/** Filler words: dropped before the rest becomes the craving. "Meal" words are here too: "ארוחה ל-4" asks for a meal, not for a dish called meal (the people and budget make it a meal request). */
export const STOP = set([
  'משהו', 'אני', 'אנחנו', 'רוצה', 'רוצים', 'בא', 'לי', 'לנו', 'מה', 'יש', 'תן', 'תני', 'תנו', 'תביא', 'תביאו', 'אפשר', 'עם', 'של', 'את', 'גם', 'הכי', 'טוב', 'טובה', 'טעים', 'טעימה', 'בבקשה', 'היום', 'עכשיו', 'קצת', 'איזה', 'ממש', 'רק', 'בשביל', 'עבור', 'להזמין', 'הזמנה', 'לאכול', 'אוכל', 'מנה', 'מנות', 'ארוחה', 'ארוחת', 'ארוחות', 'לארוחה', 'צריך', 'אבל', 'מסעדה', 'מסעדות', 'תפריט', 'עצמי', 'משביע', 'משביעה', 'משביעים', 'מחפש', 'מחפשת', 'תמליץ', 'תמליצו', 'המלצה', 'מומלץ', 'או', 'על', 'זה', 'כן', 'היי', 'שלום', 'אהלן', 'תראה', 'תראו', 'במקום', 'ל', 'ב', 'ו', 'ה', 'מ', 'ש',
  'something', 'some', 'i', 'im', 'we', 'want', 'wanna', 'would', 'like', 'me', 'us', 'give', 'get', 'please', 'pls', 'plz', 'good', 'tasty', 'nice', 'now', 'today', 'any', 'a', 'an', 'the', 'and', 'or', 'with', 'of', 'to', 'up', 'for', 'from', 'order', 'eat', 'food', 'dish', 'need', 'looking', 'recommend', 'hi', 'hello', 'hey', 'what', 'whats', 'is', 'are', 'there', 'do', 'you', 'have', 'can', 'could', 'in', 'at', 'my', 'our', 'show', 'instead', 'tonight', 'meal', 'meals', 'should', 'shall', 'on', 'about', 'ma', 'bade', 'filling', 'hearty', 'but', 'does', 'did', 'has', 'got', 'serve', 'serves', 'sell', 'sells', 'menu', 'restaurant', 'restaurants',
  'شي', 'اشي', 'شيء', 'بدي', 'بدنا', 'ابغى', 'ابي', 'عايز', 'اريد', 'في', 'فيه', 'من', 'مع', 'هلا', 'هسا', 'اليوم', 'لو', 'سمحت', 'طيب', 'زاكي', 'انا', 'احنا', 'ممكن', 'شو', 'ايش', 'عندكم', 'عندك', 'اكل', 'اطلب', 'نطلب', 'عشان', 'ل', 'و', 'او', 'يا', 'مرحبا', 'اهلا', 'هاي', 'بس', 'منيح', 'وريني', 'بدل', 'وجبة', 'وجبه', 'وجبات', 'مشبع', 'بشبع', 'لكن', 'على', 'عن', 'ما', 'مطعم', 'منيو', 'الاكثر',
  'bde', 'bidi', 'badde', 'shi', 'eshi', 'ishi', 'shu', 'sho', 'shou', 'w', 'wa', 'bdi', 'badi', 'badna', 'ana', 'fi', 'hala', 'halla', 'wajbe', 'wajba', 'wajbeh', 'wajbi',
]);

/**
 * "I'm hungry", "what's open", "בא לי משהו טוב": no dish named, but the customer wants ideas, not a
 * reprompt. A message made only of these and filler words gets picks for now (greetings alone do not).
 */
export const HUNGRY = set(['רעב', 'רעבה', 'רעבים', 'רעבות', 'מורעב', 'מורעבת', 'בא', 'מתחשק', 'רוצה', 'רוצים', 'לאכול', 'אוכל', 'נאכל', 'פתוח', 'פתוחים', 'מומלץ', 'מומלצים', 'מומלצת', 'תמליץ', 'תמליצו', 'תמליצי', 'להמליץ', 'המלצה', 'המלצות', 'מוזמן', 'מוזמנים', 'פופולרי', 'פופולריים', 'טוב', 'טובה', 'hungry', 'recommend', 'recommended', 'recommendation', 'popular', 'best', 'good', 'starving', 'starved', 'want', 'wanna', 'eat', 'food', 'open', 'جوعان', 'جوعانة', 'جوعانين', 'جعان', 'بدي', 'بدنا', 'اكل', 'ناكل', 'فاتح', 'مفتوح', 'انصح', 'بتنصح', 'تنصح', 'بتنصحني', 'افضل', 'احسن', 'طلبا', 'مطلوب', 'ju3an', 'jo3an', 'jou3an', 'ju3ane', 'akel', 'bde', 'bdi', 'bidi', 'badde', 'bade']);
/** Phrases that ask what there is: "מה יש?", "شو في", "what do you have". */
export const HUNGRY_PHRASES = phrases(['מה יש', 'מה יש לכם', 'what do you have', 'what have you got', 'what is there', 'whats there', 'whats good', 'شو في', 'شو عندكم', 'شو عندك', 'shu fi', 'sho fi', 'shou fi']);
/** Between a negation and what is not wanted: "לא רוצה חריף", "i don't want spicy", "ما بدي حار". */
export const NOT_WANT = set(['בא', 'לי', 'רוצה', 'רוצים', 'רוצות', 'מתחשק', 'want', 'wanna', 'like', 'need', 'to', 'eat', 'have', 'any', 'بدي', 'بدنا', 'ابغى', 'عايز', 'bde', 'bdi', 'bidi', 'badde', 'bade', 'badna']);

/** Stands between a negation and its taste word: "not too spicy", "לא חריף מדי", "مش حار كتير". */
export const INTENSIFIER = set(['too', 'very', 'so', 'really', 'מדי', 'מאוד', 'كتير', 'كثير', 'جدا']);
export const INTENSIFIER_PHRASES = phrases(['כל כך', 'מידי']);
/** "and" between two excluded items: "without onion and tomato". */
export const CONJ = set(['and', 'or', 'ו', 'و', 'או', '&', 'w', 'wa']);
/** "No more than 100" is a budget ceiling, not an exclusion of "more". */
export const NO_MORE = phrases(['no more than', 'not more than', 'לא יותר מ', 'לא מעל', 'لا اكثر من', 'مش اكثر من']);
/** Speaker plus a count: "אנחנו 15", "we are 15", "احنا 5". */
export const WE = set(['אנחנו', 'אנו', 'we', 'احنا', 'نحن', 'ehna']);
/**
 * "Something warm": a hot dish or a hot drink, never a cold drink, a salad, sushi or a dessert. Hebrew חם and
 * Arabic سخن are temperature words (spicy is חריף / حار); English "hot" stays with the search lexicon, where
 * it reads as spicy, which is a hot dish either way.
 */
export const WARM = phrases(['חם', 'חמה', 'חמים', 'חמימה', 'חמימים', 'משהו חם', 'warm', 'something warm', 'سخن', 'سخنة', 'ساخن', 'ساخنة', 'دافي', 'دافئ', 's5en', 'sokhn']);

/**
 * Wishes that name a whole kind of dish with a verb or a loose word ("משהו לשתות", "בא לי לנשנש",
 * "بدي اشرب"): they become that type's search word, in the customer's language.
 */
export const TYPE_WISHES: Array<readonly [Record<'he' | 'ar' | 'en', string>, Phrase[]]> = [
  [{ he: 'שתייה', ar: 'مشروبات', en: 'drinks' }, phrases(['לשתות', 'לשתיה', 'לשתייה', 'שתיה', 'משהו לשתות', 'something to drink', 'to drink', 'اشرب', 'نشرب', 'بشرب', 'للشرب', 'شرب', 'ashrab', 'nishrab', 'bishrab'])],
  [{ he: 'נשנושים', ar: 'مقبلات', en: 'snacks' }, phrases(['לנשנש', 'נשנוש', 'נישנוש', 'נשנושים', 'חטיף', 'חטיפים', 'snack', 'snacks', 'nibble', 'nibbles', 'munchies', 'تسالي', 'اتسلى', 'نتسلى', 'سناك', 'سناكات'])],
];

/**
 * A craving word that names a family of dishes whose names may not say it: espresso and cappuccino are
 * coffee. Matching the craving also tries each member in the family word's place; the family's own
 * spelled-out names are members too, so an Arabizi "2ahwe" finds the iced coffee.
 */
export const CRAVING_FAMILIES: Array<readonly [Set<string>, string[]]> = [
  [set(['קפה', 'قهوة', 'قهوه', 'coffee', 'coffees', 'ahwe', 'ahweh', '2ahwe', '2ahweh', 'kahwa', 'qahwa']), foldAll(['קפה', 'coffee', 'אספרסו', 'espresso', 'اسبريسو', 'קפוצינו', 'קפוצ׳ינו', 'cappuccino', 'كابتشينو', 'كابوتشينو', 'לאטה', 'latte', 'لاتيه', 'הפוך', 'אמריקנו', 'americano', 'מקיאטו', 'macchiato', 'نسكافيه', 'נסקפה'])],
];

/**
 * Words that exclude a whole tag ("בלי בשר" = no meat at all). Any other word is excluded as itself, so
 * "בלי קולה" drops the cola, not every cold drink, and "קינוח בלי שוקולד" still wants a dessert.
 */
export const EXCLUDE_TAG_WORDS: Array<readonly [DishTag, Set<string>]> = [
  ['meat', set(['בשר', 'בשרי', 'בשרים', 'meat', 'meats', 'لحم', 'لحمة', 'لحمه', 'لحوم', 'la7m', 'la7me', 'la7meh', 'la7ma', 'la7em'])],
  ['chicken', set(['עוף', 'עופות', 'chicken', 'دجاج', 'جاج', 'فراخ', 'djaj', 'jaj', 'djej', 'dajaj'])],
  ['fish', set(['דג', 'דגים', 'fish', 'seafood', 'سمك', 'اسماك', 'أسماك', 'samak', 'samake', 'sameke'])],
  ['cheese', set(['גבינה', 'גבינות', 'cheese', 'cheeses', 'جبنة', 'جبنه', 'جبن', 'اجبان', 'jebne', 'jebneh', 'jibne', 'jibneh', 'jebna'])],
  ['spicy', set(['חריף', 'חריפה', 'חריפים', 'חריפות', 'harif', 'spicy', 'حار', 'حارة', 'حاره', 'حراق', '7ar', '7ara', 'harr'])],
  ['sweet', set(['מתוק', 'מתוקה', 'מתוקים', 'sweet', 'sweets', 'حلو', 'حلوة', 'حلويات'])],
];
