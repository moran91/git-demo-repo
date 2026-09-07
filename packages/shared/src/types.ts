/**
 * Shared domain types for Qareeb.
 * These types are consumed by the web app, Cloud Functions, seed scripts and (as JSON contracts)
 * by the Android print-station companion. Keep them serialisable (no class instances, no Dates:
 * timestamps are ISO strings on the wire and Firestore Timestamps at rest).
 */

export type Locale = 'he' | 'ar' | 'en';
export const LOCALES: readonly Locale[] = ['he', 'ar', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'he';
export const RTL_LOCALES: readonly Locale[] = ['he', 'ar'] as const;

/** A translated string. At least one language must be present for required content. */
export type Localized = Partial<Record<Locale, string>>;

export type BusinessType = 'restaurant' | 'supermarket';
export type FulfillmentMode = 'pickup' | 'delivery';

/** Approval states for businesses and branches. Completely separate from order statuses. */
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'suspended';

/** The ONLY order statuses. placed → accepted | rejected. No other values exist anywhere. */
export type OrderStatus = 'placed' | 'accepted' | 'rejected';
export const ORDER_STATUSES: readonly OrderStatus[] = ['placed', 'accepted', 'rejected'] as const;

export type MembershipRole = 'owner' | 'manager' | 'staff';

/** Money is stored as integer agorot (1 ILS = 100 agorot). */
export type Agorot = number;
/** Weight is stored as integer grams. */
export type Grams = number;

export interface City {
  id: string;
  name: Localized;
  /** Search aliases across scripts, lower-cased. */
  aliases: string[];
  active: boolean;
  /** Approximate centre for future map use. */
  lat?: number;
  lng?: number;
  sortOrder: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  /** E.164 phone. Only written by the server after Firebase Auth phone verification. */
  phone?: string;
  phoneVerified: boolean;
  email?: string;
  locale: Locale;
  suspended: boolean;
  suspendedReason?: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  /** REQUIRED. "Describe where you live / how to find your house". Shown before everything else. */
  houseDescription: string;
  cityId: string;
  recipientName: string;
  recipientPhone: string;
  neighborhood?: string;
  street?: string;
  buildingNumber?: string;
  apartment?: string;
  floor?: string;
  entrance?: string;
  deliveryInstructions?: string;
  lat?: number;
  lng?: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Immutable copy of an address stored on the order. */
export type AddressSnapshot = Omit<SavedAddress, 'id' | 'isDefault' | 'createdAt' | 'updatedAt' | 'label'> & {
  label?: string;
  cityName: Localized;
};

export interface Membership {
  id: string; // `${uid}_${businessId}`
  uid: string;
  businessId: string;
  role: MembershipRole;
  /** Empty array with allBranches=true means every branch of the business. */
  allBranches: boolean;
  branchIds: string[];
  active: boolean;
  invitedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyRules {
  enabled: boolean;
  /** Version increments each time rules change; orders snapshot the version they used. */
  version: number;
  /** Points earned per full X agorot of merchandise actually paid (after discounts). Default 1000 = ₪10. */
  earnPerAgorot: Agorot;
  /** Points earned per earnPerAgorot step. Default 1. */
  pointsPerStep: number;
  /** Agorot each redeemed point is worth. Default 100 = ₪1. */
  redeemValueAgorot: Agorot;
  /** Maximum discount as a percentage of merchandise subtotal (0-100). Default 10. */
  maxDiscountPercent: number;
}

export interface Business {
  id: string;
  type: BusinessType;
  name: Localized;
  description: Localized;
  defaultLocale: Locale;
  ownerUid: string;
  logoPath?: string;
  coverPath?: string;
  publicPhone?: string;
  publicEmail?: string;
  approval: ApprovalState;
  approvalReason?: string;
  loyalty: LoyaltyRules;
  createdAt: string;
  updatedAt: string;
}

/** Minutes since local midnight; end may exceed 1440 for overnight intervals (e.g. 18:00 → 02:00 = 1080..1560). */
export interface OpeningInterval {
  startMin: number;
  endMin: number;
}
/** Index 0 = Sunday … 6 = Saturday (Asia/Jerusalem local time). */
export type WeeklyHours = Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', OpeningInterval[]>;

export interface HoursOverride {
  /** ISO date (YYYY-MM-DD) in Asia/Jerusalem. */
  date: string;
  /** Empty array = closed all day. */
  intervals: OpeningInterval[];
  note?: string;
}

export interface DeliveryCityRule {
  cityId: string;
  feeAgorot: Agorot;
  minSubtotalAgorot: Agorot;
}

export interface Branch {
  id: string;
  businessId: string;
  name: Localized;
  cityId: string;
  locationDescription: Localized;
  lat?: number;
  lng?: number;
  phone: string;
  hours: WeeklyHours;
  hoursOverrides: HoursOverride[];
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryCities: DeliveryCityRule[];
  /** Temporary pause of new orders; existing orders remain actionable. */
  ordersPaused: boolean;
  approval: ApprovalState;
  approvalReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  branchId: string;
  name: Localized;
  sortOrder: number;
  archived: boolean;
}

export interface ModifierOption {
  id: string;
  name: Localized;
  priceDeltaAgorot: Agorot;
  available: boolean;
  sortOrder: number;
}

export interface ModifierGroup {
  id: string;
  name: Localized;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
  sortOrder: number;
}

export interface Variant {
  id: string;
  name: Localized;
  priceAgorot: Agorot;
  available: boolean;
  sortOrder: number;
  /** Supermarket: track stock per variant if inventory tracking is on. */
  stockQty?: number;
  sku?: string;
}

export type PricingMode = 'unit' | 'weight';

export interface Product {
  id: string;
  branchId: string;
  businessId: string;
  categoryId: string;
  name: Localized;
  description: Localized;
  dietaryText: Localized;
  imagePath?: string;
  pricingMode: PricingMode;
  /** For unit pricing: price per unit. For weight pricing: price per kilogram. */
  priceAgorot: Agorot;
  /** Weight pricing: typical/estimated grams per "1 unit" chosen by the customer (e.g. 500g bunch). */
  estimatedGramsPerUnit?: Grams;
  /** Weight pricing: increment in grams the customer can select (default 100). */
  weightStepGrams?: Grams;
  minWeightGrams?: Grams;
  brand?: string;
  sku?: string;
  barcode?: string;
  packageSize?: string;
  unitLabel: Localized;
  quantityStep: number;
  minQuantity: number;
  variants: Variant[];
  modifierGroups: ModifierGroup[];
  available: boolean;
  trackInventory: boolean;
  stockQty?: number;
  archived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CartModifierSelection {
  groupId: string;
  optionIds: string[];
}

export interface CartLine {
  /** Client-generated stable id used for idempotent line references. */
  lineId: string;
  productId: string;
  variantId?: string;
  modifiers: CartModifierSelection[];
  /** For unit products: number of units. For weight products: requested grams. */
  quantity: number;
  requestedGrams?: Grams;
  note?: string;
  /** Client-known unit price at time of adding; server compares and requires review on change. */
  expectedUnitPriceAgorot: Agorot;
}

export interface Cart {
  businessId: string;
  branchId: string;
  mode: FulfillmentMode;
  cityId: string;
  lines: CartLine[];
  updatedAt: string;
}

export interface OrderLineModifierSnapshot {
  groupId: string;
  groupName: Localized;
  optionId: string;
  optionName: Localized;
  priceDeltaAgorot: Agorot;
}

export interface OrderLine {
  lineId: string;
  productId: string;
  name: Localized;
  variantId?: string;
  variantName?: Localized;
  pricingMode: PricingMode;
  unitLabel: Localized;
  /** Unit price (per unit) or price per kilogram for weight items. */
  unitPriceAgorot: Agorot;
  modifiers: OrderLineModifierSnapshot[];
  quantity: number;
  /** Weight items: grams requested by the customer. */
  requestedGrams?: Grams;
  /** Weight items: grams actually weighed by staff (set on revision). */
  actualGrams?: Grams;
  note?: string;
  /** Line total in agorot (estimated for weight items until actualGrams is set). */
  lineTotalAgorot: Agorot;
  /** True once the line has been changed by a revision. */
  revised?: boolean;
  removed?: boolean;
  substitutedFromLineId?: string;
  trackInventory: boolean;
}

export interface OrderTotals {
  merchandiseSubtotalAgorot: Agorot;
  loyaltyDiscountAgorot: Agorot;
  deliveryFeeAgorot: Agorot;
  /** merchandise - loyaltyDiscount + delivery */
  cashDueAgorot: Agorot;
  /** True when any line is weight-priced without actual weight. */
  isEstimated: boolean;
}

export interface OrderCustomerSnapshot {
  uid: string;
  displayName: string;
  phone: string;
}

export interface LoyaltySnapshot {
  rulesVersion: number;
  pointsReserved: number;
  redeemValueAgorot: Agorot;
  earnPerAgorot: Agorot;
  pointsPerStep: number;
  maxDiscountPercent: number;
}

export interface Order {
  id: string;
  /** Short human reference like Q-7K3M2 (unique per business). */
  reference: string;
  businessId: string;
  branchId: string;
  businessName: Localized;
  branchName: Localized;
  branchPhone: string;
  businessType: BusinessType;
  customer: OrderCustomerSnapshot;
  mode: FulfillmentMode;
  cityId: string;
  address?: AddressSnapshot;
  /** Pickup contact (name + phone) — also present for delivery. */
  contactName: string;
  contactPhone: string;
  customerNote?: string;
  lines: OrderLine[];
  /** Original (as-placed) lines and totals — never modified after placement. */
  originalLines: OrderLine[];
  originalTotals: OrderTotals;
  totals: OrderTotals;
  loyalty?: LoyaltySnapshot;
  status: OrderStatus;
  decisionReason?: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Optimistic concurrency version. Increments on every mutation. */
  version: number;
  /** Revision counter (0 = as placed). */
  revision: number;
  /** Denormalised for staff follow-up: hours since placed while still placed is computed client-side. */
  placedAt: string;
  updatedAt: string;
  /** Cash settlement pointer; the status stays 'accepted'. */
  cashRecordId?: string;
  cashSettledAt?: string;
  /** Locks ordinary edits after settlement. */
  locked: boolean;
  /** Language the customer used when placing (for notifications). */
  customerLocale: Locale;
}

export type OrderEventType =
  | 'placed'
  | 'accepted'
  | 'rejected'
  | 'revised'
  | 'cash_recorded'
  | 'cash_reversed'
  | 'adjustment'
  | 'printed';

export interface OrderEvent {
  id: string;
  orderId: string;
  type: OrderEventType;
  actorUid: string;
  actorRole: MembershipRole | 'customer' | 'admin' | 'system';
  at: string;
  reason?: string;
  /** Phone agreement recorded by staff for revisions. */
  phoneAgreement?: boolean;
  before?: unknown;
  after?: unknown;
  version: number;
}

export interface CashRecord {
  id: string;
  orderId: string;
  businessId: string;
  branchId: string;
  amountAgorot: Agorot;
  recordedBy: string;
  recordedAt: string;
  reversed: boolean;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
}

export type LoyaltyEntryType = 'reserve' | 'release' | 'consume' | 'earn' | 'reverse_earn' | 'reverse_consume' | 'admin_adjust';

export interface LoyaltyLedgerEntry {
  id: string;
  businessId: string;
  uid: string;
  orderId?: string;
  type: LoyaltyEntryType;
  points: number; // signed delta on available
  reservedDelta: number; // signed delta on reserved
  rulesVersion: number;
  reason?: string;
  actorUid: string;
  at: string;
  /** Idempotency key (e.g. `${orderId}:earn`). Unique. */
  key: string;
}

export interface LoyaltyAccount {
  id: string; // `${businessId}_${uid}`
  businessId: string;
  uid: string;
  available: number;
  reserved: number;
  /** Positive when reversals exceed available points; blocks redemption until covered. */
  debt: number;
  updatedAt: string;
}

export interface Favorite {
  id: string; // businessId or `${branchId}_${productId}`
  kind: 'business' | 'product';
  businessId: string;
  branchId?: string;
  productId?: string;
  createdAt: string;
}

export type NotificationKind =
  | 'order_placed'
  | 'order_accepted'
  | 'order_rejected'
  | 'order_revised'
  | 'cash_recorded'
  | 'membership_changed'
  | 'business_approval'
  | 'print_needs_review';

export interface AppNotification {
  id: string;
  uid: string;
  kind: NotificationKind;
  /** Localised title/body in the recipient's locale. Must not contain addresses/phones. */
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
  orderId?: string;
  businessId?: string;
  branchId?: string;
}

export interface DeviceToken {
  token: string;
  uid: string;
  platform: 'web' | 'android' | 'ios';
  locale: Locale;
  createdAt: string;
  lastSeenAt: string;
  invalid: boolean;
}

export interface AuditEvent {
  id: string;
  actorUid: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  at: string;
}

/** ---------- Printing ---------- */

export type PaperWidth = 58 | 80;
export type PrinterTransport = 'web_bluetooth_ble' | 'android_rfcomm' | 'os_print_dialog';
export type ReceiptTemplate = 'order_ticket' | 'customer_copy' | 'test';
export type AutoPrintTrigger = 'off' | 'when_placed' | 'when_accepted';

export interface PrinterProfileRef {
  /** Key into the shared printer profile registry (see receipt/profiles.ts). */
  profileId: string;
}

export interface PrinterConfig extends PrinterProfileRef {
  id: string;
  businessId: string;
  branchId: string;
  name: string;
  transport: PrinterTransport;
  paperWidthMm: PaperWidth;
  /** Actual printable dot width (e.g. 384 for 58mm, 576 for 80mm). */
  printableDots: number;
  receiptLocale: Locale;
  copies: number;
  /** Which role this printer fills ("kitchen", "counter"). One active auto-print station per role. */
  role: string;
  autoPrint: AutoPrintTrigger;
  /** Set true only after a test print was confirmed by staff. Auto print cannot be enabled before. */
  setupVerified: boolean;
  /** Local device association hint (BLE device name / BT MAC). Not an access grant. */
  deviceHint?: string;
  cutSupported: boolean;
  feedLinesAfter: number;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PrintStationKind = 'web' | 'android';

export interface PrintStation {
  id: string;
  businessId: string;
  branchId: string;
  printerId: string;
  uid: string;
  kind: PrintStationKind;
  label: string;
  /** Random secret-less registration; revoked stations must stop. */
  revoked: boolean;
  lastHeartbeatAt?: string;
  online: boolean;
  appVersion?: string;
  createdAt: string;
}

export type PrintJobState =
  | 'queued'
  | 'sending'
  | 'sent_unconfirmed'
  | 'confirmed'
  | 'failed_before_send'
  | 'needs_review'
  | 'cancelled';

export type PrintTrigger = 'manual' | 'auto_placed' | 'auto_accepted' | 'test';

export interface PrintJob {
  id: string;
  /** Deterministic for automatic prints: `${orderId}:${revision}:${trigger}:${printerRole}`; manual: random with copy index. */
  key: string;
  businessId: string;
  branchId: string;
  printerId: string;
  printerRole: string;
  orderId?: string;
  orderRevision?: number;
  template: ReceiptTemplate;
  trigger: PrintTrigger;
  copyIndex: number;
  isReprint: boolean;
  reprintReason?: string;
  state: PrintJobState;
  requestedBy: string;
  requestedAt: string;
  /** Immutable receipt snapshot (ReceiptModel JSON) rendered by the station. */
  receipt: unknown;
  leaseStationId?: string;
  leaseExpiresAt?: string;
  leaseFence: number;
  attempts: number;
  lastError?: string;
  /** Bytes/strips sent progress for partial transmission diagnostics. */
  progress?: { stripsTotal: number; stripsSent: number };
  updatedAt: string;
}

export interface PrintAttempt {
  id: string;
  jobId: string;
  stationId: string;
  fence: number;
  startedAt: string;
  finishedAt?: string;
  outcome: 'sent' | 'failed_before_send' | 'partial' | 'confirmed_by_staff' | 'confirmed_by_printer';
  error?: string;
  stripsSent?: number;
  stripsTotal?: number;
}

/** ---------- Platform config ---------- */

export interface PlatformConfig {
  brand: { name: string; tagline: Localized };
  /** Future-facing; all disabled/zero at launch. */
  monetization: {
    subscriptionEnabled: false;
    commissionPercent: 0;
    paidPromotionEnabled: false;
  };
  whatsappOtpEnabled: boolean;
  defaultCityId: string;
  updatedAt: string;
}

/** ---------- Structured error codes shared between server and clients ---------- */
export type QareebErrorCode =
  | 'unauthenticated'
  | 'phone_not_verified'
  | 'suspended'
  | 'forbidden'
  | 'not_found'
  | 'invalid_argument'
  | 'business_not_approved'
  | 'branch_not_approved'
  | 'branch_closed'
  | 'orders_paused'
  | 'delivery_not_available'
  | 'pickup_not_available'
  | 'below_minimum'
  | 'price_changed'
  | 'item_unavailable'
  | 'invalid_modifiers'
  | 'out_of_stock'
  | 'mixed_branch_cart'
  | 'invalid_status_transition'
  | 'version_conflict'
  | 'already_settled'
  | 'loyalty_insufficient'
  | 'loyalty_debt'
  | 'rate_limited'
  | 'not_configured'
  | 'printer_setup_required'
  | 'duplicate_copy'
  | 'internal';

export interface QareebErrorPayload {
  code: QareebErrorCode;
  /** Optional structured details safe for clients (never includes private data). */
  details?: Record<string, unknown>;
}
