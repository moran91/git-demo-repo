/** The assistant's words: three wordings per reply so it never sounds canned, plus chip and slot labels. Hebrew speaks to the customer in plural. */
import type { FulfillmentMode } from '../types.js';
import type { Lang, Meal } from './understand.js';

/** One short sentence per wording. `closed`/`closedNoTime` name the place (no card does); blocked lines are per slot so each reads naturally. */
export type ReplyKey =
  | 'picks' | 'picksNow' | 'partial' | 'meal' | 'mealBudget' | 'deals' | 'dealsNone' | 'usual' | 'usualNone' | 'usualSignedOut' | 'surprise' | 'place'
  | 'blockedTags' | 'blockedExclude' | 'blockedOther' | 'blockedBudget' | 'blockedMode' | 'blockedPlace'
  | 'closed' | 'closedNoTime' | 'closedAll' | 'closedAllNoTime' | 'noMore' | 'reprompt1' | 'reprompt2' | 'upsell'
  | 'greetMorning' | 'greetNoon' | 'greetEvening' | 'greetNight';

const R: Record<ReplyKey, Record<Lang, readonly string[]>> = {
  picks: { he: ['הנה מה שמצאתי:', 'אלה נראים מתאימים:', 'מה דעתכם על אלה?'], ar: ['هاي اللي لقيته:', 'هدول ممكن يعجبوك:', 'شو رأيك بهدول؟'], en: ["Here's what I found:", 'These look right:', 'How about these?'] },
  picksNow: { he: ['כמה רעיונות לעכשיו:', 'מה שהולך עכשיו:', 'שווה לנסות:'], ar: ['شوية أفكار لهلا:', 'اقتراحات لهلا:', 'جرّب هدول:'], en: ['A few ideas for now:', 'Good picks right now:', 'Worth a try:'] },
  partial: { he: ['אין כרגע {missing}, אבל יש את אלה:', 'את {missing} לא מצאתי, הנה השאר:', 'אין {missing} עכשיו, אבל יש:'], ar: ['ما في هلا {missing}، بس في هدول:', 'ما لقيت {missing}، هاد الباقي:', 'ما في {missing} هلا، بس في:'], en: ["No {missing} right now, but here's the rest:", "Couldn't find {missing}, here's the rest:", 'No {missing} now, but here you go:'] },
  meal: { he: ['ארוחה ל־{people}:', 'ככה מסתדרים ל־{people}:', 'מוכן ל־{people}:'], ar: ['وجبة لـ{people}:', 'هيك بتزبط لـ{people}:', 'جاهزة لـ{people}:'], en: ['A meal for {people}:', "Here's how {people} can eat:", 'Ready for {people}:'] },
  mealBudget: { he: ['ארוחה עד {budget}:', 'מה שנכנס ב־{budget}:', 'מוכן עד {budget}:'], ar: ['وجبة لحد {budget}:', 'اللي بيزبط بـ{budget}:', 'جاهزة لحد {budget}:'], en: ['A meal under {budget}:', 'What fits in {budget}:', 'Ready under {budget}:'] },
  deals: { he: ['המבצעים עכשיו:', 'יש מבצעים:', 'שווה עכשיו:'], ar: ['العروض هلا:', 'في عروض:', 'هاي العروض:'], en: ['Deals right now:', 'On offer now:', 'Worth it now:'] },
  dealsNone: { he: ['אין כרגע מבצע מתאים.', 'כרגע אין מבצע כזה.', 'לא מצאתי מבצע מתאים עכשיו.'], ar: ['ما في عرض مناسب هلا.', 'هلا ما في عرض هيك.', 'ما لقيت عرض مناسب هلا.'], en: ['No matching deal right now.', 'No deal like that at the moment.', "I couldn't find a matching deal."] },
  usual: { he: ['כמו תמיד?', 'הרגיל שלכם:', 'שוב את זה?'], ar: ['زي العادة؟', 'طلبك المعتاد:', 'نفس الطلب؟'], en: ['The usual?', 'Your usual:', 'Same again?'] },
  usualNone: { he: ['אחרי ההזמנה הראשונה אזכור את הרגיל שלכם.', 'עוד אין לכם הזמנות קודמות.', 'עוד לא הזמנתם, אולי אחד מאלה?'], ar: ['بعد أول طلب بتذكّر طلبك المعتاد.', 'لسا ما في طلبات قبل.', 'لسا ما طلبت، يمكن واحد من هدول؟'], en: ["I'll remember your usual after your first order.", 'No past orders yet.', 'Nothing ordered yet, maybe one of these?'] },
  usualSignedOut: { he: ['התחברו ואזכור את הרגיל שלכם.', 'אחרי התחברות אזכור מה אתם אוהבים.', 'התחברו כדי שאזכור את הרגיל.'], ar: ['سجّل دخول وبتذكّر طلبك المعتاد.', 'بعد تسجيل الدخول بتذكّر شو بتحب.', 'سجّل دخول عشان أتذكّر العادة.'], en: ["Sign in and I'll remember your usual.", "Sign in and I'll remember what you like.", 'Sign in so I can keep your usual.'] },
  surprise: { he: ['תסמכו עליי:', 'בחרתי בשבילכם:', 'נסו את זה:'], ar: ['ثق فيّ:', 'اخترتلك:', 'جرّب هاد:'], en: ['Trust me on this one:', 'I picked this for you:', 'Try this:'] },
  place: { he: ['מה יש כאן:', 'מכאן אפשר להזמין:', 'מה יש עכשיו:'], ar: ['شو في هون:', 'من هون فيك تطلب:', 'شو في هلا:'], en: ["Here's what they have:", 'On the menu here:', 'On now:'] },
  blockedTags: { he: ['אין כרגע תוצאות עבור {slot}.', 'לא מצאתי עכשיו תוצאות עבור {slot}.', 'כרגע אין התאמה עבור {slot}.'], ar: ['ما في هلا نتائج لـ{slot}.', 'ما لقيت هلا نتائج لـ{slot}.', 'هلا ما في اشي مناسب لـ{slot}.'], en: ['Nothing matches “{slot}” right now.', 'No match for “{slot}” right now.', 'Nothing fits “{slot}” right now.'] },
  blockedExclude: { he: ['אין כרגע משהו בלי {slot}.', 'לא מצאתי עכשיו משהו בלי {slot}.', 'כרגע אין משהו בלי {slot}.'], ar: ['ما في هلا اشي بدون {slot}.', 'ما لقيت هلا اشي بدون {slot}.', 'هلا ما في اشي بدون {slot}.'], en: ['Nothing without {slot} right now.', "I couldn't find anything without {slot}.", 'Nothing without {slot} at the moment.'] },
  blockedOther: { he: ['לא מצאתי עוד משהו כזה.', 'אין עוד אפשרויות כאלה כרגע.', 'זה כל מה שיש כרגע.'], ar: ['ما لقيت اشي تاني هيك.', 'ما في خيارات تانية هيك هلا.', 'هاد كل اللي في هلا.'], en: ["I couldn't find anything else like that.", 'No other options like that right now.', "That's all there is right now."] },
  blockedBudget: { he: ['אין כרגע משהו עד {slot}.', 'לא מצאתי עכשיו משהו עד {slot}.', 'כרגע אין משהו עד {slot}.'], ar: ['ما في هلا اشي لحد {slot}.', 'ما لقيت هلا اشي لحد {slot}.', 'هلا ما في اشي لحد {slot}.'], en: ['Nothing under {slot} right now.', "I couldn't find anything under {slot}.", 'Nothing within {slot} at the moment.'] },
  blockedMode: { he: ['אין כרגע {slot} לזה.', 'לזה אין כרגע {slot}.', 'כרגע אין {slot} לזה.'], ar: ['ما في {slot} لهاد هلا.', 'هاد ما إلو {slot} هلا.', 'هلا ما في {slot} لهاد.'], en: ['No {slot} for that right now.', "That isn't available for {slot} right now.", 'No {slot} for this at the moment.'] },
  blockedPlace: { he: ['אין את זה כרגע ב{slot}.', 'ב{slot} אין את זה כרגע.', 'לא מצאתי את זה ב{slot}.'], ar: ['هاد مش موجود هلا بـ{slot}.', 'ما لقيت هاد بـ{slot}.', 'بـ{slot} ما في هاد هلا.'], en: ['Not at {slot} right now.', "I couldn't find that at {slot}.", "{slot} doesn't have that right now."] },
  closed: { he: ['{place} נפתח ב־{time}.', '{place} סגור עכשיו ונפתח ב־{time}.', '{place} ייפתח ב־{time}.'], ar: ['{place} بيفتح الساعة {time}.', '{place} مسكّر هلا وبيفتح {time}.', '{place} بيفتح {time}.'], en: ['{place} opens at {time}.', '{place} is closed now and opens at {time}.', '{place} is back at {time}.'] },
  closedNoTime: { he: ['{place} סגור עכשיו.', '{place} סגור כרגע.', '{place} לא פתוח עכשיו.'], ar: ['{place} مسكّر هلا.', '{place} مش فاتح هلا.', '{place} مسكّر هلا.'], en: ['{place} is closed now.', '{place} is closed right now.', "{place} isn't open now."] },
  closedAll: { he: ['הכול סגור, נפתח ב־{time}.', 'אין כרגע מקום פתוח, הראשון נפתח ב־{time}.', 'הכול סגור עכשיו, נפתח ב־{time}.'], ar: ['كل اشي مسكّر، أول محل بيفتح {time}.', 'ما في محل فاتح هلا، أول واحد بيفتح {time}.', 'كله مسكّر، بيفتح {time}.'], en: ['Everything is closed, the first place opens at {time}.', 'Nothing is open now, the first place opens at {time}.', 'All closed now, opening at {time}.'] },
  closedAllNoTime: { he: ['הכול סגור כרגע.', 'אין כרגע מקום פתוח.', 'הכול סגור עכשיו.'], ar: ['كل اشي مسكّر هلا.', 'ما في محل فاتح هلا.', 'كله مسكّر هلا.'], en: ['Everything is closed right now.', 'Nothing is open right now.', 'All closed for now.'] },
  noMore: { he: ['זה הכול.', 'אין עוד.', 'זה מה שיש.'], ar: ['هاد كل اشي.', 'ما في كمان.', 'هاد اللي في.'], en: ["That's all.", 'No more.', "That's everything."] },
  reprompt1: { he: ['לא בטוח שהבנתי, אולי אחד מאלה?', 'לא הבנתי, אפשר לנסות ככה:', 'אפשר לנסות ככה:'], ar: ['مش متأكد إني فهمت، يمكن واحد من هدول؟', 'ما فهمت، جرّب هيك:', 'جرّب هيك:'], en: ['Not sure I got that, maybe one of these?', "I didn't get that, try this:", 'Try one of these:'] },
  reprompt2: { he: ['במה אפשר לעזור?', 'בואו נתחיל מכאן:', 'אפשר לבחור:'], ar: ['كيف بقدر أساعد؟', 'خلينا نبلش من هون:', 'اختار:'], en: ['How can I help?', "Let's start here:", 'Pick one:'] },
  upsell: { he: ['להוסיף גם את זה?', 'הולך טוב עם זה:', 'משהו ליד?'], ar: ['بدك تضيف هاد كمان؟', 'بيزبط معه:', 'اشي جنبه؟'], en: ['Add this too?', 'Goes well with it:', 'Something on the side?'] },
  greetMorning: { he: ['בוקר טוב!', 'בוקר טוב, מה מתחשק?', 'בוקר!'], ar: ['صباح الخير!', 'صباح الخير، شو بدك؟', 'صباح النور!'], en: ['Good morning!', 'Morning, what do you feel like?', 'Morning!'] },
  greetNoon: { he: ['צהריים טובים!', 'מה לצהריים?', 'צהריים!'], ar: ['نهارك سعيد!', 'شو عالغدا؟', 'أهلا!'], en: ['Good afternoon!', "What's for lunch?", 'Hi there!'] },
  greetEvening: { he: ['ערב טוב!', 'מה לערב?', 'ערב טוב, מה מתחשק?'], ar: ['مسا الخير!', 'شو عالعشا؟', 'مسا الخير، شو بدك؟'], en: ['Good evening!', "What's for dinner?", 'Evening, hungry?'] },
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

