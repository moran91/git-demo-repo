/** The assistant's words: three wordings per reply so it never sounds canned, plus chip and slot labels. Hebrew speaks to the customer in plural. */
import type { FulfillmentMode } from '../types.js';
import type { Lang, Meal } from './understand.js';

export type ReplyKey = 'picks' | 'picksNow' | 'meal' | 'deals' | 'dealsNone' | 'usual' | 'usualNone' | 'usualSignedOut' | 'surprise' | 'place' | 'blocked' | 'closed' | 'closedAll' | 'noMore' | 'reprompt1' | 'reprompt2' | 'upsell' | 'greetMorning' | 'greetNoon' | 'greetEvening' | 'greetNight';

const R: Record<ReplyKey, Record<Lang, readonly string[]>> = {
  picks: { he: ['הנה מה שמצאתי:', 'אלה נראים מתאימים:', 'מה דעתכם על אלה?'], ar: ['هاي اللي لقيته:', 'هدول ممكن يعجبوك:', 'شو رأيك بهدول؟'], en: ["Here's what I found:", 'These look right:', 'How about these?'] },
  picksNow: { he: ['כמה רעיונות לעכשיו:', 'מה שהולך עכשיו:', 'שווה לנסות:'], ar: ['شوية أفكار لهلا:', 'اقتراحات لهلا:', 'جرّب هدول:'], en: ['A few ideas for now:', 'Good picks right now:', 'Worth a try:'] },
  meal: { he: ['ארוחה ל־{people}:', 'ככה מסתדרים ל־{people}:', 'מוכן ל־{people}:'], ar: ['وجبة لـ{people}:', 'هيك بتزبط لـ{people}:', 'جاهزة لـ{people}:'], en: ['A meal for {people}:', "Here's how {people} can eat:", 'Ready for {people}:'] },
  deals: { he: ['המבצעים עכשיו:', 'יש מבצעים:', 'שווה עכשיו:'], ar: ['العروض هلا:', 'في عروض:', 'هاي العروض:'], en: ['Deals right now:', 'On offer now:', 'Worth it now:'] },
  dealsNone: { he: ['אין כרגע מבצע מתאים.', 'כרגע אין מבצע כזה.', 'לא מצאתי מבצע מתאים עכשיו.'], ar: ['ما في عرض مناسب هلا.', 'هلا ما في عرض هيك.', 'ما لقيت عرض مناسب هلا.'], en: ['No matching deal right now.', 'No deal like that at the moment.', "I couldn't find a matching deal."] },
  usual: { he: ['כמו תמיד?', 'הרגיל שלכם:', 'שוב את זה?'], ar: ['زي العادة؟', 'طلبك المعتاد:', 'نفس الطلب؟'], en: ['The usual?', 'Your usual:', 'Same again?'] },
  usualNone: { he: ['עוד אין הזמנות קודמות. מה שאהוב עכשיו:', 'אחרי ההזמנה הראשונה אזכור. בינתיים:', 'עוד לא הזמנתם. אולי אחד מאלה?'], ar: ['ما في طلبات قبل. هاي الأكثر طلبًا:', 'بعد أول طلب بتذكّر. هلا:', 'لسا ما طلبت. يمكن واحد من هدول؟'], en: ['No past orders yet. Popular right now:', "I'll remember after your first order. For now:", 'Nothing ordered yet. Maybe one of these?'] },
  usualSignedOut: { he: ['כדי שאזכור את הרגיל שלכם צריך להתחבר. בינתיים:', 'אחרי התחברות אזכור מה אתם אוהבים. בינתיים:', 'התחברו ואזכור את הרגיל. בינתיים:'], ar: ['سجّل دخول عشان أتذكّر طلبك. هلا:', 'بعد تسجيل الدخول بتذكّر شو بتحب. هلا:', 'سجّل دخول وبتذكّر العادة. هلا:'], en: ['Sign in so I can remember your usual. For now:', "Sign in and I'll remember what you like. For now:", "Sign in and I'll keep your usual. For now:"] },
  surprise: { he: ['תסמכו עליי:', 'בחרתי בשבילכם:', 'נסו את זה:'], ar: ['ثق فيّ:', 'اخترتلك:', 'جرّب هاد:'], en: ['Trust me on this one:', 'I picked this for you:', 'Try this:'] },
  place: { he: ['מה שווה כאן:', 'הכי מוזמנים כאן:', 'מה יש עכשיו:'], ar: ['أحسن اشي هون:', 'الأكثر طلبًا هون:', 'هاد اللي في هلا:'], en: ['Best here:', 'Most ordered here:', 'On now:'] },
  blocked: { he: ['לא מצאתי עכשיו משהו עם {slot}.', 'אין כרגע משהו עם {slot}.', 'כרגע אין התאמה עם {slot}.'], ar: ['ما لقيت هلا اشي مع {slot}.', 'هلا ما في اشي مع {slot}.', 'ما في اشي هلا مع {slot}.'], en: ["I couldn't find anything with {slot}.", 'Nothing right now with {slot}.', 'Nothing matches {slot} right now.'] },
  closed: { he: ['סגור עכשיו. נפתח ב־{time}.', 'נפתח ב־{time}.', 'סגור כרגע, נפתח ב־{time}.'], ar: ['مسكّر هلا، بيفتح الساعة {time}.', 'بيفتح الساعة {time}.', 'مسكّر هلا. بيفتح {time}.'], en: ['Closed now, opens at {time}.', 'Opens at {time}.', 'Closed right now, back at {time}.'] },
  closedAll: { he: ['הכול סגור כרגע. הראשון נפתח ב־{time}.', 'כרגע אין מקום פתוח. נפתח ב־{time}.', 'הכול סגור עכשיו, נפתח ב־{time}.'], ar: ['كل اشي مسكّر هلا. أول محل بيفتح {time}.', 'ما في محل فاتح هلا. بيفتح {time}.', 'كله مسكّر، بيفتح {time}.'], en: ['Everything is closed now. First opens at {time}.', 'Nothing is open right now. Opens at {time}.', 'All closed now, opening at {time}.'] },
  noMore: { he: ['זה הכול.', 'אין עוד.', 'זה מה שיש.'], ar: ['هاد كل اشي.', 'ما في كمان.', 'هاد اللي في.'], en: ["That's all.", 'No more.', "That's everything."] },
  reprompt1: { he: ['לא בטוח שהבנתי. אולי אחד מאלה?', 'הכי קרוב שמצאתי:', 'אפשר לנסות ככה:'], ar: ['مش متأكد إني فهمت. يمكن واحد من هدول؟', 'أقرب اشي لقيته:', 'جرّب هيك:'], en: ["Not sure I got that. Maybe one of these?", 'Closest I found:', 'Try one of these:'] },
  reprompt2: { he: ['במה אפשר לעזור?', 'בואו נתחיל מכאן:', 'אפשר לבחור:'], ar: ['كيف بقدر أساعد؟', 'خلينا نبلش من هون:', 'اختار:'], en: ['How can I help?', "Let's start here:", 'Pick one:'] },
  upsell: { he: ['להוסיף גם את זה?', 'הולך טוב עם זה:', 'משהו ליד?'], ar: ['بدك تضيف هاد كمان؟', 'بيزبط معه:', 'اشي جنبه؟'], en: ['Add this too?', 'Goes well with it:', 'Something on the side?'] },
  greetMorning: { he: ['בוקר טוב!', 'בוקר טוב, מה מתחשק?', 'בוקר!'], ar: ['صباح الخير!', 'صباح الخير، شو بدك؟', 'صباح النور!'], en: ['Good morning!', 'Morning! What do you feel like?', 'Morning!'] },
  greetNoon: { he: ['צהריים טובים!', 'מה לצהריים?', 'צהריים!'], ar: ['نهارك سعيد!', 'شو عالغدا؟', 'أهلا!'], en: ['Good afternoon!', "What's for lunch?", 'Hi there!'] },
  greetEvening: { he: ['ערב טוב!', 'מה לערב?', 'ערב טוב, מה מתחשק?'], ar: ['مسا الخير!', 'شو عالعشا؟', 'مسا الخير، شو بدك؟'], en: ['Good evening!', "What's for dinner?", 'Evening! Hungry?'] },
  greetNight: { he: ['עוד ערים?', 'משהו לפני השינה?', 'לילה טוב!'], ar: ['لسا صاحي؟', 'اشي قبل النوم؟', 'سهرة سعيدة!'], en: ['Still up?', 'Something before bed?', 'Late night!'] },
};

export function reply(key: ReplyKey, lang: Lang, vars: Record<string, string | number> = {}, seed = 0): string {
  const list = R[key][lang];
  const text = list[Math.abs(Math.trunc(seed)) % list.length]!;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Reprompts must differ from the one just shown. */
export function replyNot(key: ReplyKey, lang: Lang, avoid: string | undefined, seed = 0): string {
  const first = reply(key, lang, {}, seed);
  return first === avoid ? reply(key, lang, {}, seed + 1) : first;
}

export type ChipKey = 'cheaper' | 'other' | 'otherPlace' | 'deals' | 'usual' | 'noMeat' | 'drop' | 'more' | 'byBudget' | Meal;
const CHIPS: Record<ChipKey, Record<Lang, string>> = {
  cheaper: { he: 'יותר זול', ar: 'أرخص', en: 'Cheaper' },
  other: { he: 'משהו אחר', ar: 'اشي تاني', en: 'Something else' },
  otherPlace: { he: 'ממקום אחר', ar: 'من محل تاني', en: 'Another place' },
  deals: { he: 'מה במבצע?', ar: 'شو في عروض؟', en: 'Any deals?' },
  usual: { he: 'הרגיל שלי', ar: 'زي العادة', en: 'My usual' },
  noMeat: { he: 'בלי בשר', ar: 'بدون لحم', en: 'No meat' },
  drop: { he: 'לחפש בלי זה', ar: 'دوّر بدونها', en: 'Search without it' },
  more: { he: 'עוד', ar: 'كمان', en: 'More' },
  byBudget: { he: 'עד ₪50', ar: 'لحد 50 ₪', en: 'Under ₪50' },
  breakfast: { he: 'ארוחת בוקר', ar: 'فطور', en: 'Breakfast' },
  lunch: { he: 'ארוחת צהריים', ar: 'غدا', en: 'Lunch' },
  dinner: { he: 'ארוחת ערב', ar: 'عشا', en: 'Dinner' },
  late: { he: 'משהו בלילה', ar: 'اشي بالليل', en: 'Late-night bite' },
};

export function chipLabel(key: ChipKey, lang: Lang): string {
  return CHIPS[key][lang];
}

export function peopleLabel(n: number, lang: Lang): string {
  return lang === 'he' ? `ל-${n}` : lang === 'ar' ? `لـ${n}` : `For ${n}`;
}

export const MODE_LABELS: Record<FulfillmentMode, Record<Lang, string>> = {
  delivery: { he: 'משלוח', ar: 'توصيل', en: 'delivery' },
  pickup: { he: 'איסוף', ar: 'استلام', en: 'pickup' },
  dine_in: { he: 'ישיבה במקום', ar: 'جلوس بالمطعم', en: 'dine-in' },
};

export const NO_WORD: Record<Lang, string> = { he: 'בלי', ar: 'بدون', en: 'no' };
