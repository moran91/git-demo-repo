/**
 * Emulator seed. All records are FICTIONAL and isolated from production: the script refuses to run
 * unless the Auth and Firestore emulator hosts are set.
 *
 * Seeds: 3 cities (Beit Jann first), one multi-branch restaurant owner (2 branches), an unrelated
 * supermarket with tracked stock + weight-priced produce, an unapproved (pending) business, a manager
 * limited to one branch, staff limited to the other branch, a platform admin, and two customers with
 * verified phones and village addresses without street fields. Content in he/ar/en.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Branch, Business, Category, City, Membership, PlatformConfig, Product, SavedAddress, UserProfile, WeeklyHours } from '@qareeb/shared';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to seed: FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST must point at the emulators.');
  process.exit(1);
}
process.env.GCLOUD_PROJECT ||= 'qareeb-dev';
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const auth = getAuth();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const now = new Date().toISOString();

export const SEED = {
  password: 'Qareeb-Test-1234',
  admin: { email: 'admin@qareeb.test', name: 'Platform Admin' },
  owner1: { email: 'owner.restaurant@qareeb.test', name: 'Salim Khatib' },
  owner2: { email: 'owner.market@qareeb.test', name: 'Rania Saad' },
  owner3: { email: 'owner.pending@qareeb.test', name: 'Yousef Hamed' },
  manager: { email: 'manager.a@qareeb.test', name: 'Layla Nasser' },
  staff: { email: 'staff.b@qareeb.test', name: 'Omar Abu Salim' },
  customer1: { phone: '+972501111111', name: 'סמיר ח׳טיב' },
  customer2: { phone: '+972502222222', name: 'Maha Jaber' },
  ids: {
    restaurant: 'biz-abu-salim',
    branchA: 'br-abu-salim-main',
    branchB: 'br-abu-salim-hurfeish',
    market: 'biz-beit-jann-market',
    marketBranch: 'br-market-main',
    pending: 'biz-pending-bakery',
    pendingBranch: 'br-pending-bakery',
  },
} as const;

const allDay: WeeklyHours = { '0': [{ startMin: 540, endMin: 1380 }], '1': [{ startMin: 540, endMin: 1380 }], '2': [{ startMin: 540, endMin: 1380 }], '3': [{ startMin: 540, endMin: 1380 }], '4': [{ startMin: 540, endMin: 1380 }], '5': [{ startMin: 540, endMin: 1380 }], '6': [{ startMin: 540, endMin: 1380 }] };
// Restaurant: open every day 11:00 → 01:00 (overnight)
const restaurantHours: WeeklyHours = { '0': [{ startMin: 660, endMin: 1500 }], '1': [{ startMin: 660, endMin: 1500 }], '2': [{ startMin: 660, endMin: 1500 }], '3': [{ startMin: 660, endMin: 1500 }], '4': [{ startMin: 660, endMin: 1500 }], '5': [{ startMin: 660, endMin: 1500 }], '6': [{ startMin: 660, endMin: 1500 }] };
const OPEN_24 = process.env.SEED_ALWAYS_OPEN === '1' ? ({ '0': [{ startMin: 0, endMin: 1440 }], '1': [{ startMin: 0, endMin: 1440 }], '2': [{ startMin: 0, endMin: 1440 }], '3': [{ startMin: 0, endMin: 1440 }], '4': [{ startMin: 0, endMin: 1440 }], '5': [{ startMin: 0, endMin: 1440 }], '6': [{ startMin: 0, endMin: 1440 }] } as WeeklyHours) : undefined;

async function ensureUser(opts: { uid?: string; email?: string; phone?: string; name: string; admin?: boolean }): Promise<string> {
  let uid: string;
  try {
    const u = opts.email ? await auth.getUserByEmail(opts.email) : await auth.getUserByPhoneNumber(opts.phone!);
    uid = u.uid;
  } catch {
    const u = await auth.createUser({ uid: opts.uid, email: opts.email, emailVerified: !!opts.email, password: opts.email ? SEED.password : undefined, phoneNumber: opts.phone, displayName: opts.name });
    uid = u.uid;
  }
  if (opts.admin) await auth.setCustomUserClaims(uid, { admin: true });
  const profile: UserProfile = { uid, displayName: opts.name, phone: opts.phone, phoneVerified: !!opts.phone, email: opts.email, locale: 'he', suspended: false, isAdmin: !!opts.admin, createdAt: now, updatedAt: now };
  await db.collection('users').doc(uid).set(profile, { merge: true });
  return uid;
}

async function membership(uid: string, businessId: string, role: Membership['role'], branchIds: string[] = []): Promise<void> {
  const m: Membership = { id: `${uid}_${businessId}`, uid, businessId, role, allBranches: branchIds.length === 0, branchIds, active: true, createdAt: now, updatedAt: now };
  await db.collection('memberships').doc(m.id).set(m);
}

async function main() {
  const cities: City[] = [
    { id: 'beit-jann', name: { he: 'בית ג׳ן', ar: 'بيت جن', en: 'Beit Jann' }, aliases: ['beit jann', 'beit jan', 'bet jann', 'בית גן', 'בית ג\'ן', 'بيت جن', 'بيت چن'], active: true, lat: 32.9628, lng: 35.3822, sortOrder: 0 },
    { id: 'hurfeish', name: { he: 'חורפיש', ar: 'حرفيش', en: 'Hurfeish' }, aliases: ['hurfeish', 'horfesh', 'חורפיש', 'حرفيش'], active: true, lat: 33.0167, lng: 35.35, sortOrder: 1 },
    { id: 'pekiin', name: { he: 'פקיעין', ar: 'البقيعة', en: "Peki'in" }, aliases: ['pekiin', 'peqiin', 'buqeia', 'פקיעין', 'البقيعة'], active: true, lat: 32.9789, lng: 35.3306, sortOrder: 2 },
  ];
  for (const c of cities) await db.collection('cities').doc(c.id).set(c);
  const config: PlatformConfig = { brand: { name: 'Qareeb', tagline: { he: 'דברים טובים. קרוב לבית.', ar: 'أشياء طيّبة. قريبة من البيت.', en: 'Good things. Close to home.' } }, monetization: { subscriptionEnabled: false, commissionPercent: 0, paidPromotionEnabled: false }, whatsappOtpEnabled: false, defaultCityId: 'beit-jann', updatedAt: now };
  await db.collection('config').doc('platform').set(config);

  const adminUid = await ensureUser({ uid: 'seed-admin', email: SEED.admin.email, name: SEED.admin.name, admin: true });
  const owner1 = await ensureUser({ uid: 'seed-owner1', email: SEED.owner1.email, name: SEED.owner1.name });
  const owner2 = await ensureUser({ uid: 'seed-owner2', email: SEED.owner2.email, name: SEED.owner2.name });
  const owner3 = await ensureUser({ uid: 'seed-owner3', email: SEED.owner3.email, name: SEED.owner3.name });
  const manager = await ensureUser({ uid: 'seed-manager', email: SEED.manager.email, name: SEED.manager.name });
  const staff = await ensureUser({ uid: 'seed-staff', email: SEED.staff.email, name: SEED.staff.name });
  const customer1 = await ensureUser({ uid: 'seed-customer1', phone: SEED.customer1.phone, name: SEED.customer1.name });
  const customer2 = await ensureUser({ uid: 'seed-customer2', phone: SEED.customer2.phone, name: SEED.customer2.name });
  void adminUid;

  // ---------- Restaurant: Abu Salim Shawarma (2 branches, approved) ----------
  const restaurant: Business = {
    id: SEED.ids.restaurant, type: 'restaurant',
    name: { he: 'שווארמה אבו סלים', ar: 'شاورما أبو سليم', en: 'Abu Salim Shawarma' },
    description: { he: 'שווארמה, פלאפל וסלטים טריים מאז 1998.', ar: 'شاورما وفلافل وسلطات طازجة منذ 1998.', en: 'Shawarma, falafel and fresh salads since 1998.' },
    defaultLocale: 'ar', ownerUid: owner1, publicPhone: '+972501234567', approval: 'approved', approvalReason: 'seed',
    loyalty: { enabled: true, version: 1, earnPerAgorot: 1000, pointsPerStep: 1, redeemValueAgorot: 100, maxDiscountPercent: 10 },
    createdAt: now, updatedAt: now,
  };
  const branchA: Branch = {
    id: SEED.ids.branchA, businessId: restaurant.id, name: { he: 'סניף ראשי – בית ג׳ן', ar: 'الفرع الرئيسي – بيت جن', en: 'Main branch – Beit Jann' },
    cityId: 'beit-jann', locationDescription: { he: 'בכיכר המרכזית ליד המועצה', ar: 'في الساحة المركزية قرب المجلس المحلي', en: 'On the main square next to the council' },
    lat: 32.9628, lng: 35.3822, phone: '+972501234567', hours: OPEN_24 ?? restaurantHours, hoursOverrides: [],
    pickupEnabled: true, deliveryEnabled: true,
    deliveryCities: [{ cityId: 'beit-jann', feeAgorot: 1000, minSubtotalAgorot: 5000 }, { cityId: 'hurfeish', feeAgorot: 2000, minSubtotalAgorot: 8000 }],
    ordersPaused: false, approval: 'approved', createdAt: now, updatedAt: now,
  };
  const branchB: Branch = {
    ...branchA, id: SEED.ids.branchB, name: { he: 'סניף חורפיש', ar: 'فرع حرفيش', en: 'Hurfeish branch' }, cityId: 'hurfeish',
    locationDescription: { ar: 'الشارع الرئيسي مقابل الصيدلية' }, phone: '+972507654321',
    deliveryCities: [{ cityId: 'hurfeish', feeAgorot: 800, minSubtotalAgorot: 4000 }, { cityId: 'beit-jann', feeAgorot: 1500, minSubtotalAgorot: 6000 }, { cityId: 'pekiin', feeAgorot: 2500, minSubtotalAgorot: 10000 }],
  };
  await db.collection('businesses').doc(restaurant.id).set(restaurant);
  await db.collection('businesses').doc(restaurant.id).collection('branches').doc(branchA.id).set(branchA);
  await db.collection('businesses').doc(restaurant.id).collection('branches').doc(branchB.id).set(branchB);
  await membership(owner1, restaurant.id, 'owner');
  await membership(manager, restaurant.id, 'manager', [branchA.id]);
  await membership(staff, restaurant.id, 'staff', [branchB.id]);

  const rCats = (branchId: string): Category[] => [
    { id: 'c-mains', branchId, name: { he: 'מנות עיקריות', ar: 'الأطباق الرئيسية', en: 'Mains' }, sortOrder: 0, archived: false },
    { id: 'c-sides', branchId, name: { he: 'תוספות', ar: 'إضافات', en: 'Sides' }, sortOrder: 1, archived: false },
    { id: 'c-drinks', branchId, name: { he: 'שתייה', ar: 'مشروبات', en: 'Drinks' }, sortOrder: 2, archived: false },
  ];
  const rProducts = (branchId: string): Product[] => [
    {
      id: 'p-shawarma', branchId, businessId: restaurant.id, categoryId: 'c-mains',
      name: { he: 'שווארמה', ar: 'شاورما', en: 'Shawarma' }, description: { he: 'שווארמת הודו עם סלטים וטחינה', ar: 'شاورما حبش مع سلطات وطحينة', en: 'Turkey shawarma with salads and tahini' }, dietaryText: { ar: 'يحتوي على سمسم وغلوتين', en: 'Contains sesame and gluten' },
      pricingMode: 'unit', priceAgorot: 3500, unitLabel: {}, quantityStep: 1, minQuantity: 1,
      variants: [], available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: now, updatedAt: now,
      modifierGroups: [
        { id: 'g-bread', name: { he: 'לחם', ar: 'الخبز', en: 'Bread' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [
          { id: 'o-pita', name: { he: 'פיתה', ar: 'خبز', en: 'Pita' }, priceDeltaAgorot: 0, available: true, sortOrder: 0 },
          { id: 'o-laffa', name: { he: 'לאפה', ar: 'لفة', en: 'Laffa' }, priceDeltaAgorot: 500, available: true, sortOrder: 1 },
          { id: 'o-plate', name: { he: 'צלחת', ar: 'صحن', en: 'Plate' }, priceDeltaAgorot: 1500, available: true, sortOrder: 2 },
        ] },
        { id: 'g-extras', name: { he: 'תוספות', ar: 'إضافات', en: 'Extras' }, required: false, minSelect: 0, maxSelect: 3, sortOrder: 1, options: [
          { id: 'o-fries', name: { he: 'צ׳יפס בפנים', ar: 'بطاطا داخل', en: 'Fries inside' }, priceDeltaAgorot: 300, available: true, sortOrder: 0 },
          { id: 'o-amba', name: { he: 'עמבה', ar: 'عمبة', en: 'Amba' }, priceDeltaAgorot: 0, available: true, sortOrder: 1 },
          { id: 'o-spicy', name: { he: 'חריף', ar: 'حار', en: 'Spicy' }, priceDeltaAgorot: 0, available: true, sortOrder: 2 },
          { id: 'o-cheese', name: { he: 'גבינה', ar: 'جبنة', en: 'Cheese' }, priceDeltaAgorot: 400, available: false, sortOrder: 3 },
        ] },
      ],
    },
    {
      id: 'p-falafel', branchId, businessId: restaurant.id, categoryId: 'c-mains',
      name: { he: 'מנת פלאפל', ar: 'صحن فلافل', en: 'Falafel plate' }, description: { ar: 'فلافل طازج مع حمص وسلطة' }, dietaryText: { ar: 'نباتي' },
      pricingMode: 'unit', priceAgorot: 2800, unitLabel: {}, quantityStep: 1, minQuantity: 1,
      variants: [
        { id: 'v-reg', name: { he: 'רגיל', ar: 'عادي', en: 'Regular' }, priceAgorot: 2800, available: true, sortOrder: 0 },
        { id: 'v-large', name: { he: 'גדול', ar: 'كبير', en: 'Large' }, priceAgorot: 3600, available: true, sortOrder: 1 },
      ],
      modifierGroups: [], available: true, trackInventory: false, archived: false, sortOrder: 1, createdAt: now, updatedAt: now,
    },
    {
      id: 'p-fries', branchId, businessId: restaurant.id, categoryId: 'c-sides',
      name: { he: 'צ׳יפס', ar: 'بطاطا مقلية', en: 'Fries' }, description: {}, dietaryText: {},
      pricingMode: 'unit', priceAgorot: 1200, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
      available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: now, updatedAt: now,
    },
    {
      id: 'p-cola', branchId, businessId: restaurant.id, categoryId: 'c-drinks',
      name: { he: 'קולה 330 מ״ל', ar: 'كولا 330 مل', en: 'Cola 330ml' }, description: {}, dietaryText: {},
      pricingMode: 'unit', priceAgorot: 800, unitLabel: { he: 'פחית', ar: 'علبة', en: 'can' }, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
      available: true, trackInventory: true, stockQty: 24, archived: false, sortOrder: 0, createdAt: now, updatedAt: now,
    },
    {
      id: 'p-knafeh', branchId, businessId: restaurant.id, categoryId: 'c-sides',
      name: { ar: 'كنافة نابلسية' }, description: { ar: 'قطعة كنافة ساخنة' }, dietaryText: { ar: 'يحتوي على حليب وقمح' },
      pricingMode: 'unit', priceAgorot: 1800, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
      available: branchId === SEED.ids.branchA, trackInventory: false, archived: false, sortOrder: 1, createdAt: now, updatedAt: now,
    },
  ];
  for (const branchId of [branchA.id, branchB.id]) {
    for (const c of rCats(branchId)) await db.collection('businesses').doc(restaurant.id).collection('branches').doc(branchId).collection('categories').doc(c.id).set(c);
    for (const p of rProducts(branchId)) await db.collection('businesses').doc(restaurant.id).collection('branches').doc(branchId).collection('products').doc(p.id).set(p);
  }

  // ---------- Supermarket: Beit Jann Market (tracked stock, weight produce) ----------
  const market: Business = {
    id: SEED.ids.market, type: 'supermarket',
    name: { he: 'מרכול בית ג׳ן', ar: 'سوبرماركت بيت جن', en: 'Beit Jann Market' },
    description: { he: 'מצרכים, ירקות טריים ומוצרי חלב', ar: 'مواد غذائية وخضار طازجة وألبان', en: 'Groceries, fresh produce and dairy' },
    defaultLocale: 'he', ownerUid: owner2, publicPhone: '+972549876543', approval: 'approved', approvalReason: 'seed',
    loyalty: { enabled: true, version: 1, earnPerAgorot: 1000, pointsPerStep: 1, redeemValueAgorot: 100, maxDiscountPercent: 10 },
    createdAt: now, updatedAt: now,
  };
  const marketBranch: Branch = {
    id: SEED.ids.marketBranch, businessId: market.id, name: { he: 'הסניף', ar: 'الفرع', en: 'Store' },
    cityId: 'beit-jann', locationDescription: { he: 'בכניסה הדרומית לכפר, ליד תחנת הדלק', ar: 'عند المدخل الجنوبي للقرية قرب محطة الوقود', en: 'At the southern entrance, next to the gas station' },
    lat: 32.958, lng: 35.385, phone: '+972549876543', hours: OPEN_24 ?? allDay, hoursOverrides: [],
    pickupEnabled: true, deliveryEnabled: true, deliveryCities: [{ cityId: 'beit-jann', feeAgorot: 0, minSubtotalAgorot: 7000 }],
    ordersPaused: false, approval: 'approved', createdAt: now, updatedAt: now,
  };
  await db.collection('businesses').doc(market.id).set(market);
  await db.collection('businesses').doc(market.id).collection('branches').doc(marketBranch.id).set(marketBranch);
  await membership(owner2, market.id, 'owner');
  const mCats: Category[] = [
    { id: 'c-produce', branchId: marketBranch.id, name: { he: 'ירקות ופירות', ar: 'خضار وفواكه', en: 'Produce' }, sortOrder: 0, archived: false },
    { id: 'c-dairy', branchId: marketBranch.id, name: { he: 'מוצרי חלב', ar: 'ألبان', en: 'Dairy' }, sortOrder: 1, archived: false },
    { id: 'c-pantry', branchId: marketBranch.id, name: { he: 'מזווה', ar: 'مواد أساسية', en: 'Pantry' }, sortOrder: 2, archived: false },
  ];
  const mProducts: Product[] = [
    { id: 'p-tomato', branchId: marketBranch.id, businessId: market.id, categoryId: 'c-produce', name: { he: 'עגבניות', ar: 'طماطم', en: 'Tomatoes' }, description: { he: 'עגבניות מקומיות' }, dietaryText: {}, pricingMode: 'weight', priceAgorot: 890, estimatedGramsPerUnit: 1000, weightStepGrams: 250, minWeightGrams: 250, unitLabel: { he: 'ק״ג', ar: 'كغ', en: 'kg' }, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: true, stockQty: 25000, archived: false, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: 'p-cucumber', branchId: marketBranch.id, businessId: market.id, categoryId: 'c-produce', name: { he: 'מלפפונים', ar: 'خيار', en: 'Cucumbers' }, description: {}, dietaryText: {}, pricingMode: 'weight', priceAgorot: 690, estimatedGramsPerUnit: 500, weightStepGrams: 100, minWeightGrams: 300, unitLabel: { he: 'ק״ג', ar: 'كغ', en: 'kg' }, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, archived: false, sortOrder: 1, createdAt: now, updatedAt: now },
    { id: 'p-labneh', branchId: marketBranch.id, businessId: market.id, categoryId: 'c-dairy', name: { he: 'לאבנה 500 גרם', ar: 'لبنة 500 غرام', en: 'Labneh 500g' }, description: {}, dietaryText: { he: 'מכיל חלב', ar: 'يحتوي على حليب', en: 'Contains milk' }, brand: 'Tnuva', sku: 'LAB-500', barcode: '7290000000001', packageSize: '500g', pricingMode: 'unit', priceAgorot: 1490, unitLabel: { he: 'יחידה', ar: 'علبة', en: 'tub' }, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: true, stockQty: 1, archived: false, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: 'p-milk', branchId: marketBranch.id, businessId: market.id, categoryId: 'c-dairy', name: { he: 'חלב 3%', ar: 'حليب 3%', en: 'Milk 3%' }, description: {}, dietaryText: {}, brand: 'Tara', packageSize: '1L', pricingMode: 'unit', priceAgorot: 690, unitLabel: { he: 'ליטר', ar: 'لتر', en: 'litre' }, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: true, stockQty: 40, archived: false, sortOrder: 1, createdAt: now, updatedAt: now },
    { id: 'p-rice', branchId: marketBranch.id, businessId: market.id, categoryId: 'c-pantry', name: { he: 'אורז בסמטי', ar: 'أرز بسمتي', en: 'Basmati rice' }, description: {}, dietaryText: {}, brand: 'Sugat', pricingMode: 'unit', priceAgorot: 1990, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [ { id: 'v-1kg', name: { he: '1 ק״ג', ar: '1 كغ', en: '1 kg' }, priceAgorot: 1990, available: true, sortOrder: 0, stockQty: 12 }, { id: 'v-5kg', name: { he: '5 ק״ג', ar: '5 كغ', en: '5 kg' }, priceAgorot: 7990, available: true, sortOrder: 1, stockQty: 3 } ], modifierGroups: [], available: true, trackInventory: true, archived: false, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: 'p-eggs', branchId: marketBranch.id, businessId: market.id, categoryId: 'c-pantry', name: { he: 'ביצים L (12)', ar: 'بيض L (12)', en: 'Eggs L (12)' }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 1590, unitLabel: { he: 'תבנית', ar: 'طبق', en: 'tray' }, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: true, stockQty: 0, archived: false, sortOrder: 1, createdAt: now, updatedAt: now },
  ];
  for (const c of mCats) await db.collection('businesses').doc(market.id).collection('branches').doc(marketBranch.id).collection('categories').doc(c.id).set(c);
  for (const p of mProducts) await db.collection('businesses').doc(market.id).collection('branches').doc(marketBranch.id).collection('products').doc(p.id).set(p);

  // ---------- Pending (unapproved) business: hidden from discovery ----------
  const pending: Business = { id: SEED.ids.pending, type: 'restaurant', name: { ar: 'مخبز الجبل', en: 'Mountain Bakery' }, description: { ar: 'معجنات ومناقيش' }, defaultLocale: 'ar', ownerUid: owner3, approval: 'pending', loyalty: { enabled: false, version: 1, earnPerAgorot: 1000, pointsPerStep: 1, redeemValueAgorot: 100, maxDiscountPercent: 10 }, createdAt: now, updatedAt: now };
  const pendingBranch: Branch = { id: SEED.ids.pendingBranch, businessId: pending.id, name: { ar: 'الفرع' }, cityId: 'beit-jann', locationDescription: {}, phone: '+972521231234', hours: allDay, hoursOverrides: [], pickupEnabled: true, deliveryEnabled: false, deliveryCities: [], ordersPaused: false, approval: 'pending', createdAt: now, updatedAt: now };
  await db.collection('businesses').doc(pending.id).set(pending);
  await db.collection('businesses').doc(pending.id).collection('branches').doc(pendingBranch.id).set(pendingBranch);
  await db.collection('businesses').doc(pending.id).collection('branches').doc(pendingBranch.id).collection('categories').doc('c-bakery').set({ id: 'c-bakery', branchId: pendingBranch.id, name: { ar: 'مخبوزات' }, sortOrder: 0, archived: false } satisfies Category);
  await db.collection('businesses').doc(pending.id).collection('branches').doc(pendingBranch.id).collection('products').doc('p-manaqish').set({ id: 'p-manaqish', branchId: pendingBranch.id, businessId: pending.id, categoryId: 'c-bakery', name: { ar: 'مناقيش زعتر' }, description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 900, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: now, updatedAt: now } satisfies Product);
  await membership(owner3, pending.id, 'owner');
  for (const b of [restaurant, market, pending]) await db.collection('businesses').doc(b.id).collection('approvalHistory').add({ targetType: 'business', state: b.approval, reason: 'seed', actorUid: 'seed', at: now });

  // ---------- Customer addresses (village-style, no street) ----------
  const addr1: SavedAddress = { id: 'addr-home', label: 'בית', houseDescription: 'ליד המתנ״ס, הבית עם השער הכחול בשכונה המערבית. לשאול על בית משפחת ח׳טיב.', cityId: 'beit-jann', recipientName: SEED.customer1.name, recipientPhone: SEED.customer1.phone, neighborhood: 'השכונה המערבית', deliveryInstructions: 'לצלצל פעמיים', isDefault: true, createdAt: now, updatedAt: now };
  await db.collection('users').doc(customer1).collection('addresses').doc(addr1.id).set(addr1);
  const addr2: SavedAddress = { id: 'addr-parents', label: 'الأهل', houseDescription: 'بيت عائلة جابر مقابل المدرسة الابتدائية، البوابة الخضراء، الطابق الأول', cityId: 'beit-jann', recipientName: SEED.customer2.name, recipientPhone: SEED.customer2.phone, isDefault: true, createdAt: now, updatedAt: now };
  await db.collection('users').doc(customer2).collection('addresses').doc(addr2.id).set(addr2);

  // ---------- Public projections ----------
  const { reprojectBusinessSeed } = await import('./reproject.ts');
  for (const b of [restaurant, market, pending]) await reprojectBusinessSeed(db, b.id);

  console.log('Seed complete.');
  console.log(JSON.stringify({ password: SEED.password, admin: SEED.admin.email, owner1: SEED.owner1.email, owner2: SEED.owner2.email, ownerPending: SEED.owner3.email, manager: SEED.manager.email, staff: SEED.staff.email, customer1: SEED.customer1.phone, customer2: SEED.customer2.phone, note: 'Use the Auth emulator: any 6-digit code is accepted for phone sign-in in the emulator UI; email accounts are pre-verified.' }, null, 2));
}

await main();
