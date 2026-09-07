import { z } from 'zod';
import { LOYALTY_BOUNDS } from './pricing.js';
import { validateInterval } from './hours.js';

export const localeSchema = z.enum(['he', 'ar', 'en']);
export const localizedSchema = z
  .object({ he: z.string().max(2000).optional(), ar: z.string().max(2000).optional(), en: z.string().max(2000).optional() })
  .strict();
export const requiredLocalizedSchema = localizedSchema.refine((v) => [v.he, v.ar, v.en].some((s) => s && s.trim().length > 0), {
  message: 'at_least_one_language',
});

export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const agorotSchema = z.number().int().min(0).max(100_000_000);
export const gramsSchema = z.number().int().min(0).max(1_000_000);
export const e164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/);
export const shortText = (max = 200) => z.string().trim().max(max);
export const idempotencySchema = z.string().min(8).max(128);

/** ---------- Addresses ---------- */
export const addressInputSchema = z
  .object({
    label: shortText(40).optional(),
    houseDescription: z.string().trim().min(3).max(600),
    cityId: idSchema,
    recipientName: z.string().trim().min(1).max(100),
    recipientPhone: z.string().trim().min(6).max(30),
    neighborhood: shortText(120).optional(),
    street: shortText(120).optional(),
    buildingNumber: shortText(20).optional(),
    apartment: shortText(20).optional(),
    floor: shortText(20).optional(),
    entrance: shortText(20).optional(),
    deliveryInstructions: shortText(500).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type AddressInput = z.infer<typeof addressInputSchema>;

/** ---------- Cart / checkout ---------- */
export const cartModifierSchema = z.object({ groupId: idSchema, optionIds: z.array(idSchema).max(30) }).strict();
export const cartLineSchema = z
  .object({
    lineId: idSchema,
    productId: idSchema,
    variantId: idSchema.optional(),
    modifiers: z.array(cartModifierSchema).max(20),
    quantity: z.number().int().min(1).max(999),
    requestedGrams: gramsSchema.optional(),
    note: shortText(300).optional(),
    expectedUnitPriceAgorot: agorotSchema,
  })
  .strict();

export const quoteRequestSchema = z
  .object({
    businessId: idSchema,
    branchId: idSchema,
    mode: z.enum(['pickup', 'delivery']),
    cityId: idSchema,
    lines: z.array(cartLineSchema).min(1).max(60),
    redeemPoints: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const placeOrderSchema = quoteRequestSchema
  .extend({
    idempotencyKey: idempotencySchema,
    contactName: z.string().trim().min(1).max(100),
    contactPhone: z.string().trim().min(6).max(30),
    /** Delivery: either a saved address id, or an inline address (which is also saved when saveAddress=true). */
    addressId: idSchema.optional(),
    address: addressInputSchema.optional(),
    saveAddress: z.boolean().optional(),
    customerNote: shortText(500).optional(),
    /** Client must echo the quoted cash total so a changed price is surfaced for review. */
    expectedCashDueAgorot: agorotSchema,
    locale: localeSchema,
  })
  .strict();
export type PlaceOrderRequest = z.infer<typeof placeOrderSchema>;

export const decideOrderSchema = z
  .object({
    orderId: idSchema,
    decision: z.enum(['accepted', 'rejected']),
    reason: shortText(300).optional(),
    expectedVersion: z.number().int().min(1),
    idempotencyKey: idempotencySchema,
  })
  .strict();

export const reviseLineSchema = z
  .object({
    lineId: idSchema,
    action: z.enum(['remove', 'set_quantity', 'set_actual_weight', 'substitute']),
    quantity: z.number().int().min(0).max(999).optional(),
    actualGrams: gramsSchema.optional(),
    /** For substitute: product to add in place of the removed line. */
    replacementProductId: idSchema.optional(),
    replacementVariantId: idSchema.optional(),
    replacementQuantity: z.number().int().min(1).max(999).optional(),
    replacementGrams: gramsSchema.optional(),
  })
  .strict();

export const reviseOrderSchema = z
  .object({
    orderId: idSchema,
    expectedVersion: z.number().int().min(1),
    idempotencyKey: idempotencySchema,
    reason: z.string().trim().min(2).max(300),
    phoneAgreement: z.boolean(),
    changes: z.array(reviseLineSchema).min(1).max(60),
  })
  .strict();

export const recordCashSchema = z
  .object({
    orderId: idSchema,
    amountAgorot: agorotSchema,
    expectedVersion: z.number().int().min(1),
    idempotencyKey: idempotencySchema,
  })
  .strict();

export const reverseCashSchema = z
  .object({
    orderId: idSchema,
    reason: z.string().trim().min(3).max(300),
    idempotencyKey: idempotencySchema,
  })
  .strict();

/** ---------- Business management ---------- */
export const loyaltyRulesInputSchema = z
  .object({
    enabled: z.boolean(),
    earnPerAgorot: z.number().int().min(LOYALTY_BOUNDS.earnPerAgorot.min).max(LOYALTY_BOUNDS.earnPerAgorot.max),
    pointsPerStep: z.number().int().min(LOYALTY_BOUNDS.pointsPerStep.min).max(LOYALTY_BOUNDS.pointsPerStep.max),
    redeemValueAgorot: z.number().int().min(LOYALTY_BOUNDS.redeemValueAgorot.min).max(LOYALTY_BOUNDS.redeemValueAgorot.max),
    maxDiscountPercent: z.number().int().min(LOYALTY_BOUNDS.maxDiscountPercent.min).max(LOYALTY_BOUNDS.maxDiscountPercent.max),
  })
  .strict();

export const businessInputSchema = z
  .object({
    type: z.enum(['restaurant', 'supermarket']),
    name: requiredLocalizedSchema,
    description: localizedSchema,
    defaultLocale: localeSchema,
    publicPhone: shortText(30).optional(),
    publicEmail: z.string().email().max(120).optional(),
  })
  .strict();

export const intervalSchema = z
  .object({ startMin: z.number().int(), endMin: z.number().int() })
  .strict()
  .refine(validateInterval, { message: 'invalid_interval' });
export const weeklyHoursSchema = z.object({
  '0': z.array(intervalSchema).max(4),
  '1': z.array(intervalSchema).max(4),
  '2': z.array(intervalSchema).max(4),
  '3': z.array(intervalSchema).max(4),
  '4': z.array(intervalSchema).max(4),
  '5': z.array(intervalSchema).max(4),
  '6': z.array(intervalSchema).max(4),
});
export const hoursOverrideSchema = z
  .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), intervals: z.array(intervalSchema).max(4), note: shortText(120).optional() })
  .strict();
export const deliveryCitySchema = z.object({ cityId: idSchema, feeAgorot: agorotSchema, minSubtotalAgorot: agorotSchema }).strict();

export const branchInputSchema = z
  .object({
    name: requiredLocalizedSchema,
    cityId: idSchema,
    locationDescription: localizedSchema,
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    phone: z.string().trim().min(6).max(30),
    hours: weeklyHoursSchema,
    hoursOverrides: z.array(hoursOverrideSchema).max(60),
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryCities: z.array(deliveryCitySchema).max(50),
  })
  .strict();

export const categoryInputSchema = z.object({ name: requiredLocalizedSchema, sortOrder: z.number().int().min(0).max(10000).optional() }).strict();

export const modifierOptionInputSchema = z
  .object({ id: idSchema.optional(), name: requiredLocalizedSchema, priceDeltaAgorot: z.number().int().min(-100000).max(100000), available: z.boolean(), sortOrder: z.number().int().min(0).max(1000) })
  .strict();
export const modifierGroupInputSchema = z
  .object({
    id: idSchema.optional(),
    name: requiredLocalizedSchema,
    required: z.boolean(),
    minSelect: z.number().int().min(0).max(30),
    maxSelect: z.number().int().min(0).max(30),
    options: z.array(modifierOptionInputSchema).min(1).max(30),
    sortOrder: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine((g) => g.maxSelect === 0 || g.maxSelect >= g.minSelect, { message: 'max_below_min' });
export const variantInputSchema = z
  .object({ id: idSchema.optional(), name: requiredLocalizedSchema, priceAgorot: agorotSchema, available: z.boolean(), sortOrder: z.number().int().min(0).max(1000), stockQty: z.number().int().min(0).max(1_000_000).optional(), sku: shortText(60).optional() })
  .strict();

export const productInputSchema = z
  .object({
    categoryId: idSchema,
    name: requiredLocalizedSchema,
    description: localizedSchema,
    dietaryText: localizedSchema,
    pricingMode: z.enum(['unit', 'weight']),
    priceAgorot: agorotSchema,
    estimatedGramsPerUnit: gramsSchema.optional(),
    weightStepGrams: z.number().int().min(10).max(10000).optional(),
    minWeightGrams: z.number().int().min(10).max(100000).optional(),
    brand: shortText(80).optional(),
    sku: shortText(60).optional(),
    barcode: shortText(40).optional(),
    packageSize: shortText(40).optional(),
    unitLabel: localizedSchema,
    quantityStep: z.number().int().min(1).max(100),
    minQuantity: z.number().int().min(1).max(100),
    variants: z.array(variantInputSchema).max(30),
    modifierGroups: z.array(modifierGroupInputSchema).max(20),
    available: z.boolean(),
    trackInventory: z.boolean(),
    stockQty: z.number().int().min(0).max(1_000_000).optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();
export type ProductInput = z.infer<typeof productInputSchema>;

export const membershipInputSchema = z
  .object({
    businessId: idSchema,
    email: z.string().email().max(120),
    role: z.enum(['manager', 'staff']),
    allBranches: z.boolean(),
    branchIds: z.array(idSchema).max(50),
  })
  .strict();

/** ---------- Printing ---------- */
export const printerConfigInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    profileId: idSchema,
    transport: z.enum(['web_bluetooth_ble', 'android_rfcomm', 'os_print_dialog']),
    paperWidthMm: z.union([z.literal(58), z.literal(80)]),
    printableDots: z.number().int().min(200).max(832),
    receiptLocale: localeSchema,
    copies: z.number().int().min(1).max(3),
    role: z.string().trim().min(1).max(30).regex(/^[a-z0-9_-]+$/),
    autoPrint: z.enum(['off', 'when_placed', 'when_accepted']),
    deviceHint: shortText(120).optional(),
    cutSupported: z.boolean(),
    feedLinesAfter: z.number().int().min(0).max(10),
  })
  .strict();

export const enqueuePrintSchema = z
  .object({
    printerId: idSchema,
    orderId: idSchema.optional(),
    template: z.enum(['order_ticket', 'customer_copy', 'test']),
    /** Required to create another copy when a matching copy already exists. */
    reprint: z.boolean().optional(),
    reprintReason: shortText(200).optional(),
    idempotencyKey: idempotencySchema,
  })
  .strict();

export const claimPrintJobSchema = z.object({ stationId: idSchema, jobId: idSchema.optional(), includeStale: z.boolean().optional() }).strict();
export const reportPrintSchema = z
  .object({
    stationId: idSchema,
    jobId: idSchema,
    fence: z.number().int().min(1),
    outcome: z.enum(['sent', 'failed_before_send', 'partial', 'confirmed_by_staff', 'confirmed_by_printer']),
    error: shortText(300).optional(),
    stripsSent: z.number().int().min(0).optional(),
    stripsTotal: z.number().int().min(0).optional(),
  })
  .strict();

/** ---------- Admin ---------- */
export const approvalDecisionSchema = z
  .object({
    targetType: z.enum(['business', 'branch']),
    businessId: idSchema,
    branchId: idSchema.optional(),
    state: z.enum(['approved', 'rejected', 'suspended', 'pending']),
    reason: z.string().trim().min(2).max(300),
  })
  .strict();

export const cityInputSchema = z
  .object({ id: idSchema.optional(), name: requiredLocalizedSchema, aliases: z.array(z.string().trim().min(1).max(60)).max(30), active: z.boolean(), lat: z.number().optional(), lng: z.number().optional(), sortOrder: z.number().int().min(0).max(10000) })
  .strict();

/** ---------- WhatsApp OTP (optional provider) ---------- */
export const whatsappStartSchema = z.object({ phone: z.string().trim().min(6).max(30), locale: localeSchema, consent: z.literal(true) }).strict();
export const whatsappCheckSchema = z.object({ challengeId: idSchema, code: z.string().regex(/^\d{4,8}$/) }).strict();

export const paginationSchema = z.object({ limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(200).optional() });
