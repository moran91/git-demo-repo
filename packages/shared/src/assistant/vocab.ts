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
export const SURPRISE = phrases(['תפתיע אותי', 'תפתיעו אותי', 'תפתיע', 'תפתיעו', 'הפתעה', 'תבחר לי', 'תבחרו לי', 'תבחר אתה', 'לא יודע', 'לא יודעת', 'לא יודעים', 'מה שבא', 'surprise me', 'surprise', 'you choose', 'you pick', 'dont know', 'i dont know', 'idk', 'random', 'anything', 'whatever', 'فاجئني', 'فاجئنا', 'مفاجأة', 'اختار انت', 'اختارلي', 'مش عارف', 'مش عارفة', 'اي اشي', 'أي شي', 'ما بعرف', 'بعرفش']);
export const DEALS = phrases(['מה במבצע', 'מבצע', 'מבצעים', 'דיל', 'דילים', 'הנחה', 'הנחות', 'קומבו', 'deal', 'deals', 'offer', 'offers', 'special', 'specials', 'promo', 'promotion', 'promotions', 'discount', 'combo', 'combos', 'عرض', 'عروض', 'خصم', 'خصومات', 'تخفيض', 'تنزيلات', 'كومبو']);
export const OTHER_PLACE = phrases(['מקום אחר', 'מסעדה אחרת', 'another place', 'other place', 'different place', 'another restaurant', 'somewhere else', 'محل تاني', 'مطعم تاني', 'مكان تاني', 'محل ثاني']);
export const CHEAPER = phrases(['יותר זול', 'זול יותר', 'פחות יקר', 'cheaper', 'less expensive', 'ارخص', 'أرخص', 'ارخص شوي']);
export const CHEAP = phrases(['הכי זול', 'זול', 'זולה', 'זולים', 'זולות', 'בזול', 'חסכוני', 'cheap', 'cheapest', 'affordable', 'budget', 'رخيص', 'رخيصة', 'الارخص']);
export const FAMILY = phrases(['משפחה', 'family', 'عيلة', 'عائلة']);
export const COMPANION = phrases(['ואשתי', 'ובעלי', 'וחבר', 'וחברה', 'וחברתי', 'وصاحبي', 'وصاحبتي', 'ومرتي', 'وجوزي', 'وحبيبتي', 'with my wife', 'with my husband', 'with a friend', 'and my wife', 'and my husband', 'and a friend']);
export const MODES: Array<readonly [FulfillmentMode, Phrase[]]> = [
  ['delivery', phrases(['משלוח', 'משלוחים', 'דליברי', 'delivery', 'deliver', 'delivered', 'توصيل', 'ديليفري', 'دليفري'])],
  ['pickup', phrases(['איסוף', 'לאסוף', 'טייק אווי', 'טייקאווי', 'pickup', 'pick up', 'takeaway', 'take away', 'to go', 'استلام', 'تيك اواي'])],
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
  ['healthy', phrases(TAG_TERMS.healthy)],
  ['sweet', phrases(['מתוק', 'מתוקה', 'מתוקים', 'קינוח', 'קינוחים', 'sweet', 'sweets', 'dessert', 'desserts', 'حلو', 'حلويات', 'تحلاية', 'ديزرت'])],
  ['cold_drink', phrases(['שתייה קרה', 'שתיה קרה', 'משקה קר', 'משהו קר לשתות', 'cold drink', 'something cold to drink', 'مشروب بارد', 'اشي بارد'])],
  ['hot_drink', phrases(['שתייה חמה', 'שתיה חמה', 'משקה חם', 'hot drink', 'something hot to drink', 'مشروب ساخن', 'اشي سخن'])],
  ['sharing', phrases(['לשתף', 'לחלוק', 'to share', 'sharing', 'للمشاركة'])],
];
export const MORE = set(['עוד', 'more', 'كمان', 'المزيد', 'اكثر']);
export const OTHER = set(['אחר', 'אחרת', 'אחרים', 'אחרות', 'else', 'other', 'different', 'another', 'تاني', 'ثاني', 'غيره', 'غيرها']);
export const NEGATION = set(['בלי', 'ללא', 'לא', 'בלא', 'without', 'no', 'not', 'non', 'بدون', 'بلا', 'مش', 'لا', 'بلاش', 'غير', 'bdun', 'bidun', 'bdoon', 'bidoon', 'bala', 'mish', 'msh']);
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
/** Filler words: dropped before the rest becomes the craving. */
export const STOP = set([
  'משהו', 'אני', 'אנחנו', 'רוצה', 'רוצים', 'בא', 'לי', 'לנו', 'מה', 'יש', 'תן', 'תני', 'תנו', 'תביא', 'תביאו', 'אפשר', 'עם', 'של', 'את', 'גם', 'הכי', 'טוב', 'טובה', 'טעים', 'טעימה', 'בבקשה', 'היום', 'עכשיו', 'קצת', 'איזה', 'ממש', 'רק', 'בשביל', 'עבור', 'להזמין', 'הזמנה', 'לאכול', 'אוכל', 'מנה', 'מנות', 'צריך', 'מחפש', 'מחפשת', 'תמליץ', 'תמליצו', 'המלצה', 'מומלץ', 'או', 'על', 'זה', 'כן', 'היי', 'שלום', 'אהלן', 'תראה', 'תראו', 'במקום', 'ל', 'ב', 'ו', 'ה', 'מ', 'ש',
  'something', 'some', 'i', 'im', 'we', 'want', 'wanna', 'would', 'like', 'me', 'us', 'give', 'get', 'please', 'pls', 'plz', 'good', 'tasty', 'nice', 'now', 'today', 'any', 'a', 'an', 'the', 'and', 'or', 'with', 'of', 'to', 'up', 'for', 'from', 'order', 'eat', 'food', 'dish', 'need', 'looking', 'recommend', 'hi', 'hello', 'hey', 'what', 'whats', 'is', 'are', 'there', 'do', 'you', 'have', 'can', 'could', 'in', 'at', 'my', 'our', 'show', 'instead', 'tonight',
  'شي', 'اشي', 'شيء', 'بدي', 'بدنا', 'ابغى', 'ابي', 'عايز', 'اريد', 'في', 'فيه', 'من', 'مع', 'هلا', 'هسا', 'اليوم', 'لو', 'سمحت', 'طيب', 'زاكي', 'انا', 'احنا', 'ممكن', 'شو', 'ايش', 'عندكم', 'عندك', 'اكل', 'اطلب', 'نطلب', 'عشان', 'ل', 'و', 'او', 'يا', 'مرحبا', 'اهلا', 'هاي', 'بس', 'منيح', 'وريني', 'بدل',
  'bde', 'bidi', 'badde', 'shi', 'eshi', 'ishi', 'bdi', 'badi', 'badna', 'ana', 'fi', 'hala', 'halla',
]);

/** Stands between a negation and its taste word: "not too spicy", "לא חריף מדי", "مش حار كتير". */
export const INTENSIFIER = set(['too', 'very', 'so', 'really', 'מדי', 'מאוד', 'كتير', 'كثير', 'جدا']);
export const INTENSIFIER_PHRASES = phrases(['כל כך', 'מידי']);
/** "and" between two excluded items: "without onion and tomato". */
export const CONJ = set(['and', 'or', 'ו', 'و', 'או', '&']);
/** "No more than 100" is a budget ceiling, not an exclusion of "more". */
export const NO_MORE = phrases(['no more than', 'not more than', 'לא יותר מ', 'לא מעל', 'لا اكثر من', 'مش اكثر من']);
/** Speaker plus a count: "אנחנו 15", "we are 15", "احنا 5". */
export const WE = set(['אנחנו', 'אנו', 'we', 'احنا', 'نحن', 'ehna']);
/** Arabizi food words that can be excluded ("bdun la7meh") but are not in the tag vocabulary. */
export const ARABIZI_TAG_WORDS: Array<readonly [DishTag, Set<string>]> = [
  ['meat', set(['la7m', 'la7me', 'la7meh', 'la7ma', 'la7em'])],
  ['chicken', set(['djaj', 'jaj', 'djej', 'dajaj'])],
  ['cheese', set(['jebne', 'jebneh', 'jibne', 'jibneh', 'jebna'])],
  ['fish', set(['samak', 'samake', 'sameke'])],
];
