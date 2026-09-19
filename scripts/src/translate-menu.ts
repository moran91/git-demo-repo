/**
 * One-off: fill ar/en for every localized string in the Morano catalog.
 *
 * Patches ONLY localized sub-fields (name.ar/en, description.ar/en, variant names,
 * modifier group + option names) with a merge write. It never rewrites a whole
 * document, so no other field can be lost.
 *
 * It also patches the public projection that customers actually read
 * (publicBranches/{branchId}/products). That matters: product writes have NO
 * Firestore trigger in this project - the projection is only rebuilt by explicit
 * reprojectCatalog() calls inside the callable functions. Writing only to
 * products/ would leave the customer app showing the old Hebrew.
 *
 * It also restores the "תוספות" modifier group on מוקפץ נודלס ירקות, which was wiped.
 *
 * Dry run (prints every change, writes nothing):
 *   GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> GCLOUD_PROJECT=qareeb-dev \
 *     node --experimental-strip-types src/translate-menu.ts
 *
 * Apply:
 *   GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> GCLOUD_PROJECT=qareeb-dev \
 *     node --experimental-strip-types src/translate-menu.ts --apply
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BUSINESS = 'aubsDikSbKp5FjD2xjau';
const BRANCH = 'OVEAbTAO0SgWR9qQBSDA';
const APPLY = process.argv.includes('--apply');

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

type T = { ar: string; en: string };
const D = (ar: string, en: string): T => ({ ar, en });

/** Product names. */
const NAMES: Record<string, T> = {
  'פיצה נפוליטנית קלאסית': D('بيتزا نابوليتانية كلاسيكية', 'Classic Neapolitan Pizza'),
  'פיצה נפוליטנית אלפרדו': D('بيتزا نابوليتانية ألفريدو', 'Neapolitan Alfredo Pizza'),
  'פיצה נפוליטנית פסטו': D('بيتزا نابوليتانية بالبيستو', 'Neapolitan Pesto Pizza'),
  'מק אנד שניצלונים': D('ماك آند تشيز مع قطع شنيتزل', 'Mac & Cheese with Schnitzel Bites'),
  'מוקרם עוף בטטה וערמונים': D('دجاج بالكريمة مع بطاطا حلوة وكستناء', 'Creamy Chicken, Sweet Potato & Chestnuts'),
  "מק אנד צ'יז": D('ماك آند تشيز', 'Mac & Cheese'),
  'מוקפץ נודלס ירקות': D('نودلز مقلية بالخضار', 'Vegetable Stir-Fried Noodles'),
  'מנת שרמפס': D('طبق جمبري', 'Shrimp Dish'),
  'ניוקי ערמונים': D('نوكي بالكستناء', 'Chestnut Gnocchi'),
  'פסטה אלפרדו': D('باستا ألفريدو', 'Alfredo Pasta'),
  'פסטה רוזה': D('باستا روزيه', 'Rosé Pasta'),
  'פסטה פסטו': D('باستا بالبيستو', 'Pesto Pasta'),
  'פסטה עגבניות': D('باستا بالبندورة', 'Tomato Pasta'),
  'רביולי גבינה': D('رافيولي بالجبنة', 'Cheese Ravioli'),
  'רביולי בטטה': D('رافيولي بالبطاطا الحلوة', 'Sweet Potato Ravioli'),
  'רביולי מיקס': D('رافيولي مشكّل', 'Mixed Ravioli'),
  'רביולי פטריות כמהין': D('رافيولي فطر بالكمأة', 'Truffle Mushroom Ravioli'),
  'ציפס': D('بطاطا مقلية', 'Fries'),
  'חלומי פטריות': D('حلومي وفطر', 'Halloumi & Mushrooms'),
  'אצבעות מוצרלה': D('أصابع موتزاريلا', 'Mozzarella Sticks'),
  'שניצלונים': D('قطع شنيتزل', 'Schnitzel Bites'),
  'הום פרייז': D('هوم فرايز', 'Home Fries'),
  "מוח'יטו": D('موهيتو', 'Mojito'),
  'גרוס מוראנו': D('سلاش مورانو', 'Morano Slush'),
  'קוקה קולה - רגיל': D('كوكا كولا', 'Coca-Cola'),
  'קולה זירו': D('كولا زيرو', 'Coke Zero'),
  'קולה גדול - רגיל': D('كوكا كولا – كبير', 'Coca-Cola – Large'),
  'קולה גדול - זירו': D('كولا زيرو – كبير', 'Coke Zero – Large'),
  'XL TEN': D('XL TEN', 'XL TEN'),
  XL: D('XL', 'XL'),
  'ענבים': D('شراب العنب', 'Grape Soda'),
  'ספרייט': D('سبرايت', 'Sprite'),
  'סודה': D('صودا', 'Soda'),
  'מים': D('مياه', 'Water'),
};

/** Product descriptions, keyed by the existing Hebrew text. */
const DESCS: Record<string, T> = {
  'פיצה ברוטב עגבניות איטלקיות, דקה באמצע ואוורירית בקצוות עם 100% גבינת מוצרלה': D(
    'بيتزا بصلصة البندورة الإيطالية، رقيقة في الوسط وهشّة عند الأطراف مع 100% جبنة موتزاريلا',
    'Pizza with Italian tomato sauce, thin in the middle and airy at the edges, with 100% mozzarella',
  ),
  'פיצה לבנה ברוטב אלפרדו, דקה באמצע ואוורירית בקצוות עם 100% גבינת מוצרלה': D(
    'بيتزا بيضاء بصلصة الألفريدو، رقيقة في الوسط وهشّة عند الأطراف مع 100% جبنة موتزاريلا',
    'White pizza with Alfredo sauce, thin in the middle and airy at the edges, with 100% mozzarella',
  ),
  'פיצה ירוקה ברוטב פסטו, דקה באמצע ואוורירית בקצוות עם 100% גבינת מוצרלה': D(
    'بيتزا خضراء بصلصة البيستو، رقيقة في الوسط وهشّة عند الأطراف مع 100% جبنة موتزاريلا',
    'Green pizza with pesto sauce, thin in the middle and airy at the edges, with 100% mozzarella',
  ),
  "מק אנד צ'יז עם שניצלונים מוקפצים ברוטב סויט אנד סויר (חמוץ מתוק) מעל": D(
    'ماك آند تشيز مع قطع شنيتزل مقلية بصلصة حلوة وحامضة فوقها',
    'Mac & cheese topped with stir-fried schnitzel bites in sweet & sour sauce',
  ),
  'רצועות חזה עוף עם קוביות בטטה בתנור עם ערמונים ופטריות ברוטב מוקרם': D(
    'شرائح صدر دجاج مع مكعبات البطاطا الحلوة في الفرن، مع الكستناء والفطر بصلصة الكريمة',
    'Oven-baked chicken breast strips with sweet potato cubes, chestnuts and mushrooms in cream sauce',
  ),
  'פסטה ברוטב גבינות': D('باستا بصلصة الأجبان', 'Pasta in cheese sauce'),
  'מוקפץ נודלס וירקות, מכיל בצל, גמבה ופטריות': D(
    'نودلز مقلية مع الخضار، تحتوي على بصل وفلفل حلو وفطر',
    'Stir-fried noodles with vegetables; contains onion, bell pepper and mushrooms',
  ),
  'מנת שרמפס': D('طبق جمبري', 'Shrimp dish'),
  'ניוקי תפוחי אדמה ברוטב מוקרם בתוספת ערמונים': D(
    'نوكي البطاطا بصلصة الكريمة مع الكستناء',
    'Potato gnocchi in cream sauce with chestnuts',
  ),
  "פסטה פטוצ'יני ברוטב אלפרדו (מוקרם) בתוספת פטריות שמפניון טריות": D(
    'باستا فيتوتشيني بصلصة الألفريدو (كريمة) مع فطر شامبينيون طازج',
    'Fettuccine in Alfredo (cream) sauce with fresh champignon mushrooms',
  ),
  "פסטה פטוצ'יני ברוטב רוזה (מוקרם ועגבניות) בתוספת פטריות שמפניון טריות": D(
    'باستا فيتوتشيني بصلصة الروزيه (كريمة وبندورة) مع فطر شامبينيون طازج',
    'Fettuccine in rosé sauce (cream and tomato) with fresh champignon mushrooms',
  ),
  "פסטה פטוצ'יני ברוטב פסטו בתוספת עגבניות וגבינה בולגרית": D(
    'باستا فيتوتشيني بصلصة البيستو مع البندورة والجبنة البلغارية',
    'Fettuccine in pesto sauce with tomato and Bulgarian cheese',
  ),
  "פסטה פטוצ'יני ברוטב עגבניות איטלקיות בתוספת עגבניות וגבינה בולגרית": D(
    'باستا فيتوتشيني بصلصة البندورة الإيطالية مع البندورة والجبنة البلغارية',
    'Fettuccine in Italian tomato sauce with tomato and Bulgarian cheese',
  ),
  'רביולי עבודת יד במילוי גבינות': D('رافيولي محضّر يدويًا بحشوة الأجبان', 'Handmade ravioli with cheese filling'),
  'רביולי עבודת יד במילוי בטטה': D('رافيولي محضّر يدويًا بحشوة البطاطا الحلوة', 'Handmade ravioli with sweet potato filling'),
  'רביולי עבודת יד במילוי פטריות כמהין': D('رافيولي محضّر يدويًا بحشوة فطر الكمأة', 'Handmade ravioli with truffle mushroom filling'),
  'רביולי מיקס עבודת יד - ניתן לבחור שני סוגים או שלושה': D(
    'رافيولي مشكّل محضّر يدويًا - يمكن اختيار نوعين أو ثلاثة',
    'Handmade mixed ravioli - choose two or three fillings',
  ),
  'ציפס גדול': D('بطاطا مقلية كبيرة', 'Large fries'),
  'קוביות חלומי מוקפצות עם פטריות שמפניון ברוטב חמוץ מתוק': D(
    'مكعبات حلومي مقلية مع فطر شامبينيون بصلصة حلوة وحامضة',
    'Stir-fried halloumi cubes with champignon mushrooms in sweet & sour sauce',
  ),
  "אצבעות מוצרלה קרנצ'יות עם רוטב עגבניות איטלקי": D(
    'أصابع موتزاريلا مقرمشة مع صلصة البندورة الإيطالية',
    'Crunchy mozzarella sticks with Italian tomato sauce',
  ),
  'שניצלונים': D('قطع شنيتزل', 'Schnitzel bites'),
  'מוקפץ ברוטב חמוץ מתוק של מורנו': D('مقلي بصلصة مورانو الحلوة والحامضة', "Stir-fried in Morano's sweet & sour sauce"),
  'מוחיטו מוראנו': D('موهيتو مورانو', 'Morano Mojito'),
  'גרוס מוראנו': D('سلاش مورانو', 'Morano Slush'),
  'קוקה קולה': D('كوكا كولا', 'Coca-Cola'),
  'קולה זירו': D('كولا زيرو', 'Coke Zero'),
  'קולה גדול': D('كوكا كولا كبير', 'Large Coca-Cola'),
  'קולה גדול - זירו': D('كولا زيرو كبير', 'Large Coke Zero'),
  'XL TEN': D('XL TEN', 'XL TEN'),
  XL: D('XL', 'XL'),
  'ענבים': D('شراب العنب', 'Grape soda'),
  'ספרייט': D('سبرايت', 'Sprite'),
  'סודה': D('صودا', 'Soda'),
  'מים': D('مياه', 'Water'),
};

/** Variant names, modifier-group names and option names share one dictionary. */
const TERMS: Record<string, T> = {
  // sizes / quantities
  'אישית': D('شخصية', 'Personal'),
  'בינונית': D('متوسطة', 'Medium'),
  'משפחתית': D('عائلية', 'Family'),
  '8 חתיכות': D('8 قطع', '8 pieces'),
  '12 חתיכות': D('12 قطعة', '12 pieces'),
  '8 יחדות': D('8 قطع', '8 pieces'),
  '12 יחדות': D('12 قطعة', '12 pieces'),
  // group names
  'בסיס': D('الأساس', 'Base'),
  'טעם': D('النكهة', 'Flavour'),
  'מילוי': D('الحشوة', 'Filling'),
  'סוג הפסטה': D('نوع الباستا', 'Pasta type'),
  'רוטב': D('الصلصة', 'Sauce'),
  'רוטב אחד לבחירה': D('اختر صلصة واحدة', 'Choose one sauce'),
  'תוספות': D('إضافات', 'Add-ons'),
  'תוספות מעל': D('إضافات علوية', 'Toppings'),
  'תוספת מעל': D('إضافة علوية', 'Topping'),
  'תוספת לבחירה': D('إضافة للاختيار', 'Optional add-on'),
  'תוספת גבינות (מגש שלם)': D('إضافة أجبان (صينية كاملة)', 'Cheese add-ons (whole tray)'),
  // option names
  'מוצרלה': D('موتزاريلا', 'Mozzarella'),
  'שרימפס': D('جمبري', 'Shrimp'),
  'חזה עוף': D('صدر دجاج', 'Chicken breast'),
  'חזה עוף (מגש שלם)': D('صدر دجاج (صينية كاملة)', 'Chicken breast (whole tray)'),
  'בשר בקר': D('لحم بقر', 'Beef'),
  'חזה בקר': D('لحم بقر', 'Beef'),
  'שניצלונים': D('قطع شنيتزل', 'Schnitzel bites'),
  'עוף': D('دجاج', 'Chicken'),
  'ללא פטריות': D('بدون فطر', 'No mushrooms'),
  'ללא ערמונים': D('بدون كستناء', 'No chestnuts'),
  'ללא בצל': D('بدون بصل', 'No onion'),
  'פטריות': D('فطر', 'Mushrooms'),
  'פטריות חי': D('فطر طازج', 'Fresh mushrooms'),
  'פטריות כמהין': D('فطر الكمأة', 'Truffle mushrooms'),
  'בטטה': D('بطاطا حلوة', 'Sweet potato'),
  'גבינה': D('جبنة', 'Cheese'),
  'גבינה בולגרית (מגש שלם)': D('جبنة بلغارية (صينية كاملة)', 'Bulgarian cheese (whole tray)'),
  "גבינת פרמז'ן (מגש שלם)": D('جبنة بارميزان (صينية كاملة)', 'Parmesan (whole tray)'),
  'דאבל מוצרלה (מגש שלם)': D('موتزاريلا مضاعفة (صينية كاملة)', 'Double mozzarella (whole tray)'),
  'תירס': D('ذرة', 'Corn'),
  'זיתים ירוקים': D('زيتون أخضر', 'Green olives'),
  'זיתים שחורים': D('زيتون أسود', 'Black olives'),
  'עגבניות': D('بندورة', 'Tomato'),
  'בצל': D('بصل', 'Onion'),
  'גמבה': D('فلفل حلو', 'Bell pepper'),
  'פלפל חריף': D('فلفل حار', 'Hot pepper'),
  'פפרוני': D('بيبروني', 'Pepperoni'),
  'טונה': D('تونة', 'Tuna'),
  'פסטה': D('باستا', 'Pasta'),
  'פנה ( צינור)': D('بيني (أنبوبي)', 'Penne (tube)'),
  'פטוציני ( ארוך)': D('فيتوتشيني (طويل)', 'Fettuccine (long)'),
  'אלפרדו': D('ألفريدو', 'Alfredo'),
  'רוזה': D('روزيه', 'Rosé'),
  'פסטו': D('بيستو', 'Pesto'),
  'סודה': D('صودا', 'Soda'),
  'ספרייט': D('سبرايت', 'Sprite'),
  XL: D('XL', 'XL'),
  'אננס': D('أناناس', 'Pineapple'),
  'תות': D('فراولة', 'Strawberry'),
  'אבטיח': D('بطيخ', 'Watermelon'),
  'בלוברי': D('توت أزرق', 'Blueberry'),
  'פירות יער': D('فواكه الغابة', 'Forest berries'),
};

/** The modifier group that was wiped off מוקפץ נודלס ירקות, rebuilt exactly as it was. */
const RESTORE_GROUP = {
  id: 'm001j1ft',
  name: { he: 'תוספות', ...TERMS['תוספות'] },
  minSelect: 0,
  maxSelect: 5,
  required: false,
  sortOrder: 0,
  options: [
    { id: 'm00216jr', name: { he: 'ללא בצל', ...TERMS['ללא בצל'] }, priceDeltaAgorot: 0, sortOrder: 0, available: true },
    { id: 'm0031r4p', name: { he: 'עוף', ...TERMS['עוף'] }, priceDeltaAgorot: 1500, sortOrder: 1, available: true },
    { id: 'm00408bn', name: { he: 'שניצלונים', ...TERMS['שניצלונים'] }, priceDeltaAgorot: 1500, sortOrder: 2, available: true },
    { id: 'm005pql0', name: { he: 'שרימפס', ...TERMS['שרימפס'] }, priceDeltaAgorot: 2000, sortOrder: 3, available: true },
    { id: 'm006cy0x', name: { he: 'בשר בקר', ...TERMS['בשר בקר'] }, priceDeltaAgorot: 2500, sortOrder: 4, available: true },
  ],
};

let changes = 0;
const missing = new Set<string>();

/** Returns a patched localized object, or null if nothing to do. */
function loc(v: any, dict: Record<string, T>, what: string): any | null {
  if (!v || typeof v !== 'object' || !v.he) return null;
  if (v.ar && v.en) return null; // already done
  const t = dict[v.he];
  if (!t) {
    missing.add(`${what}: ${v.he}`);
    return null;
  }
  changes++;
  console.log(`  ${what}: ${v.he}  ->  ${t.ar} | ${t.en}`);
  return { ...v, ar: v.ar || t.ar, en: v.en || t.en };
}

function translateProduct(p: any): any | null {
  const out: any = {};

  const n = loc(p.name, NAMES, 'name');
  if (n) out.name = n;

  const d = loc(p.description, DESCS, 'desc');
  if (d) out.description = d;

  if (Array.isArray(p.variants) && p.variants.length) {
    let touched = false;
    const vs = p.variants.map((v: any) => {
      const t = loc(v.name, TERMS, 'variant');
      if (t) {
        touched = true;
        return { ...v, name: t };
      }
      return v;
    });
    if (touched) out.variants = vs;
  }

  const groups = p.modifierGroups;
  if (p.name?.he === 'מוקפץ נודלס ירקות' && (!groups || groups.length === 0)) {
    console.log('  RESTORE: re-adding the wiped "תוספות" group');
    out.modifierGroups = [RESTORE_GROUP];
    changes++;
  } else if (Array.isArray(groups) && groups.length) {
    let touched = false;
    const gs = groups.map((g: any) => {
      const gn = loc(g.name, TERMS, 'group');
      let opts = g.options;
      let optTouched = false;
      if (Array.isArray(opts)) {
        opts = opts.map((o: any) => {
          const on = loc(o.name, TERMS, 'option');
          if (on) {
            optTouched = true;
            return { ...o, name: on };
          }
          return o;
        });
      }
      if (gn || optTouched) {
        touched = true;
        return { ...g, ...(gn ? { name: gn } : {}), ...(optTouched ? { options: opts } : {}) };
      }
      return g;
    });
    if (touched) out.modifierGroups = gs;
  }

  return Object.keys(out).length ? out : null;
}

const prodCol = db.collection('businesses').doc(BUSINESS).collection('branches').doc(BRANCH).collection('products');
const pubCol = db.collection('publicBranches').doc(BRANCH).collection('products');

const snap = await prodCol.get();
console.log(`${snap.size} product documents\n`);

const writes: Array<{ id: string; patch: any }> = [];
for (const doc of snap.docs) {
  const p = doc.data();
  if (p.archived) continue;
  console.log(`--- ${p.name?.he} (${doc.id})`);
  const patch = translateProduct(p);
  if (patch) writes.push({ id: doc.id, patch });
  else console.log('  (nothing to change)');
}

console.log(`\n${changes} field(s) to update across ${writes.length} product(s).`);
if (missing.size) {
  console.log('\nNO TRANSLATION FOUND for these - add them to the dictionaries:');
  for (const m of missing) console.log('  !', m);
}

if (!APPLY) {
  console.log('\nDRY RUN - nothing was written. Re-run with --apply to write.');
  process.exit(0);
}

const batch = db.batch();
const now = new Date().toISOString();
for (const w of writes) {
  batch.set(prodCol.doc(w.id), { ...w.patch, updatedAt: now }, { merge: true });
  // Customers read the projection; product writes have no trigger, so patch it too.
  batch.set(pubCol.doc(w.id), { ...w.patch, updatedAt: now }, { merge: true });
}
await batch.commit();
console.log(`\nWrote ${writes.length} product(s) and their public projections.`);
