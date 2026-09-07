import type { Order } from '../src/types.js';

export const deliveryOrder: Order = {
  id: 'order1',
  reference: 'Q-7K3M2',
  businessId: 'biz1',
  branchId: 'br1',
  businessName: { he: 'שווארמה אבו סלים', ar: 'شاورما أبو سليم', en: 'Abu Salim Shawarma' },
  branchName: { he: 'סניף ראשי', ar: 'الفرع الرئيسي', en: 'Main branch' },
  branchPhone: '+972501234567',
  businessType: 'restaurant',
  customer: { uid: 'u1', displayName: 'סמיר ח׳טיב', phone: '+972521112233' },
  mode: 'delivery',
  cityId: 'beit-jann',
  address: {
    houseDescription: 'ליד המתנ״ס, הבית עם השער הכחול בשכונה המערבית. לשאול על בית משפחת ח׳טיב. קומה שנייה, כניסה מאחור.',
    cityId: 'beit-jann',
    cityName: { he: 'בית ג׳ן', ar: 'بيت جن', en: 'Beit Jann' },
    recipientName: 'סמיר ח׳טיב',
    recipientPhone: '+972521112233',
    neighborhood: 'השכונה המערבית',
    deliveryInstructions: 'לצלצל פעמיים',
  },
  contactName: 'סמיר ח׳טיב',
  contactPhone: '+972521112233',
  customerNote: 'בלי בצל בבקשה — no onions please',
  lines: [
    {
      lineId: 'l1', productId: 'p1', name: { he: 'שווארמה בלאפה', ar: 'شاورما باللفة', en: 'Shawarma in laffa' }, pricingMode: 'unit', unitLabel: {}, unitPriceAgorot: 3500,
      modifiers: [{ groupId: 'g', groupName: { en: 'Extras' }, optionId: 'x', optionName: { he: 'צ׳יפס', ar: 'بطاطا', en: 'Fries' }, priceDeltaAgorot: 800 }],
      quantity: 2, note: 'חריף', lineTotalAgorot: 8600, trackInventory: false,
    },
    {
      lineId: 'l2', productId: 'p2', name: { he: 'עגבניות', ar: 'طماطم', en: 'Tomatoes' }, pricingMode: 'weight', unitLabel: {}, unitPriceAgorot: 900,
      modifiers: [], quantity: 1, requestedGrams: 1250, lineTotalAgorot: 1125, trackInventory: true,
    },
  ],
  originalLines: [],
  originalTotals: { merchandiseSubtotalAgorot: 9725, loyaltyDiscountAgorot: 0, deliveryFeeAgorot: 1000, cashDueAgorot: 10725, isEstimated: true },
  totals: { merchandiseSubtotalAgorot: 9725, loyaltyDiscountAgorot: 500, deliveryFeeAgorot: 1000, cashDueAgorot: 10225, isEstimated: true },
  status: 'placed',
  version: 1,
  revision: 0,
  placedAt: '2026-09-07T11:35:00Z',
  updatedAt: '2026-09-07T11:35:00Z',
  locked: false,
  customerLocale: 'he',
};
deliveryOrder.originalLines = deliveryOrder.lines;
