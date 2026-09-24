import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  addressInputSchema,
  advanceOrderSchema,
  availableFulfillmentModes,
  offersDineIn,
  clampRedemption,
  computeTotals,
  decideOrderSchema,
  evaluateOpen,
  FIRST_ORDER_NUMBER,
  normalizeIsraeliPhone,
  placeOrderSchema,
  pointsEarned,
  priceComboLine,
  priceLine,
  quoteRequestSchema,
  recordCashSchema,
  recomputeLineTotal,
  reverseCashSchema,
  reviseOrderSchema,
  revisionAgreementReason,
  weightLineTotal,
  type RevisionChangeLike,
  type AddressSnapshot,
  type Branch,
  type Business,
  type CashRecord,
  type City,
  type Combo,
  type FulfillmentMode,
  type LoyaltyAccount,
  type LoyaltyLedgerEntry,
  type Order,
  type OrderEvent,
  type OrderLine,
  type OrderStage,
  type PrinterConfig,
  type Product,
  type SavedAddress,
} from '@qareeb/shared';
import { FieldValue, REGION, col, db, nowIso, type Tx } from '../lib/firebase.js';
import { handled, fail, QareebError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller, requireMembership, requireVerifiedPhone, type Caller } from '../lib/auth.js';
import { readIdempotent, writeIdempotent } from '../lib/idempotency.js';
import { enqueueEvent } from '../lib/outbox.js';
import { writeAudit } from '../lib/audit.js';
import { effectiveDeliveryCities, projectProductInTx } from '../lib/projections.js';
import { enqueueAutoPrintJobs } from '../lib/printjobs.js';
import { rateLimit } from '../lib/ratelimit.js';

const opts = { region: REGION } as const;
/**
 * Customer-facing hot path. Without a warm instance the first cart open after a quiet spell hit a
 * gen2 cold start (several seconds before the total and the checkout button appeared).
 */
const hot = { region: REGION, minInstances: 1 } as const;

/** ---------- Shared validation used by quote and place ---------- */

interface Eligibility {
  business: Business;
  branch: Branch;
  deliveryRule?: Branch['deliveryCities'][number];
}

async function loadEligibility(tx: Tx | null, businessId: string, branchId: string, mode: FulfillmentMode, cityId: string): Promise<Eligibility> {
  const bRef = col.business(businessId);
  const brRef = col.branch(businessId, branchId);
  const [b, br] = await Promise.all([tx ? tx.get(bRef) : bRef.get(), tx ? tx.get(brRef) : brRef.get()]);
  if (!b.exists || !br.exists) fail('not_found', { entity: 'branch' });
  const business = b.data() as Business;
  const branch = br.data() as Branch;
  if (business.approval !== 'approved') fail('business_not_approved');
  if (branch.approval !== 'approved') fail('branch_not_approved');
  if (branch.ordersPaused) fail('orders_paused');
  if (!evaluateOpen(new Date(), branch.hours, branch.hoursOverrides).open) fail('branch_closed');
  const deliveryCities = branch.deliveryEnabled ? effectiveDeliveryCities(branch) : [];
  const modes = availableFulfillmentModes(business.type, { cityId: branch.cityId, pickupEnabled: branch.pickupEnabled, dineInEnabled: branch.dineInEnabled, deliveryCities }, cityId);
  if (mode === 'pickup') {
    if (!modes.includes('pickup')) fail('pickup_not_available', branch.pickupEnabled ? { reason: 'city' } : undefined);
    return { business, branch };
  }
  if (mode === 'dine_in') {
    if (!modes.includes('dine_in')) fail('dine_in_not_available', offersDineIn(business.type, branch) ? { reason: 'city' } : undefined);
    return { business, branch };
  }
  const rule = deliveryCities.find((d) => d.cityId === cityId);
  if (!rule) fail('delivery_not_available', { cityId });
  return { business, branch, deliveryRule: rule };
}

interface PricedCart {
  lines: OrderLine[];
  products: Map<string, { ref: FirebaseFirestore.DocumentReference; product: Product }>;
}

async function priceCart(tx: Tx | null, businessId: string, branchId: string, cartLines: z.infer<typeof quoteRequestSchema>['lines']): Promise<PricedCart> {
  // Combos are resolved first so their member products are loaded alongside plain lines.
  const comboIds = Array.from(new Set(cartLines.filter((l) => l.comboId).map((l) => l.comboId!)));
  const comboSnaps = await Promise.all(comboIds.map((id) => { const r = col.combos(businessId, branchId).doc(id); return tx ? tx.get(r) : r.get(); }));
  const combos = new Map<string, Combo>();
  comboSnaps.forEach((s, i) => { if (s.exists) combos.set(comboIds[i]!, s.data() as Combo); });
  const memberIds = Array.from(combos.values()).flatMap((c) => c.items.map((i) => i.productId));
  const ids = Array.from(new Set([...cartLines.filter((l) => !l.comboId).map((l) => l.productId), ...memberIds]));
  const refs = ids.map((id) => col.products(businessId, branchId).doc(id));
  const snaps = await Promise.all(refs.map((r) => (tx ? tx.get(r) : r.get())));
  const products = new Map<string, { ref: FirebaseFirestore.DocumentReference; product: Product }>();
  snaps.forEach((s, i) => {
    if (s.exists) products.set(ids[i]!, { ref: refs[i]!, product: s.data() as Product });
  });
  const plain = new Map(Array.from(products.entries()).map(([id, e]) => [id, e.product]));
  const lines: OrderLine[] = [];
  const problems: Array<{ lineId: string; code: string; expected?: number; actual?: number; reason?: string }> = [];
  const seen = new Set<string>();
  for (const cl of cartLines) {
    if (seen.has(cl.lineId)) fail('invalid_argument', { issues: [{ path: 'lines', message: 'duplicate_line_id' }] });
    seen.add(cl.lineId);
    if (cl.comboId) {
      const combo = combos.get(cl.comboId);
      if (!combo || combo.branchId !== branchId) { problems.push({ lineId: cl.lineId, code: 'item_unavailable' }); continue; }
      const r = priceComboLine(combo, plain, cl);
      if (r.problem) problems.push(r.problem as (typeof problems)[number]);
      else if (r.line) lines.push(r.line);
      continue;
    }
    const entry = products.get(cl.productId);
    if (!entry || entry.product.branchId !== branchId) {
      problems.push({ lineId: cl.lineId, code: 'item_unavailable' });
      continue;
    }
    const r = priceLine(entry.product, cl);
    if (r.problem) problems.push(r.problem as (typeof problems)[number]);
    else if (r.line) lines.push(r.line);
  }
  if (problems.length > 0) {
    const first = problems.find((p) => p.code === 'price_changed') ?? problems[0]!;
    fail(first.code as never, { problems });
  }
  return { lines, products };
}

/** Stock semantics: unit products count units; weight products count grams. Variants track their own units. */
function stockAvailable(product: Product, variantId: string | undefined): number | undefined {
  if (!product.trackInventory) return undefined;
  if (variantId) return product.variants.find((v) => v.id === variantId)?.stockQty ?? 0;
  return product.stockQty ?? 0;
}

function applyStockDelta(product: Product, variantId: string | undefined, delta: number): Product {
  if (!product.trackInventory) return product;
  if (variantId) return { ...product, variants: product.variants.map((v) => (v.id === variantId ? { ...v, stockQty: Math.max(0, (v.stockQty ?? 0) + delta) } : v)), updatedAt: nowIso() };
  return { ...product, stockQty: Math.max(0, (product.stockQty ?? 0) + delta), updatedAt: nowIso() };
}

interface StockPlanEntry {
  snap: FirebaseFirestore.DocumentSnapshot;
  deltas: Array<{ variantId: string | undefined; delta: number }>;
}

/**
 * Reads every product touched by a `${productId}:${variantId}` delta map exactly once, grouping the
 * deltas that apply to it. Call before any write in the transaction.
 */
async function readStockDeltas(tx: Tx, businessId: string, branchId: string, deltas: Map<string, number>): Promise<StockPlanEntry[]> {
  const byProduct = new Map<string, StockPlanEntry['deltas']>();
  for (const [key, delta] of deltas) {
    const [productId, variantId] = key.split(':');
    const list = byProduct.get(productId!) ?? [];
    list.push({ variantId: variantId || undefined, delta });
    byProduct.set(productId!, list);
  }
  const ids = Array.from(byProduct.keys());
  const snaps = await Promise.all(ids.map((id) => tx.get(col.products(businessId, branchId).doc(id))));
  return snaps.map((snap, i) => ({ snap, deltas: byProduct.get(ids[i]!)! }));
}

/**
 * Folds every delta for one product into a single document write. Two variants of the same product
 * would otherwise each be written from the same original snapshot, and the last write would silently
 * discard the other variant's adjustment.
 */
function writeStockDeltas(tx: Tx, business: Business, branch: Branch, plan: StockPlanEntry[]): void {
  for (const { snap, deltas } of plan) {
    if (!snap.exists) continue;
    let product = snap.data() as Product;
    for (const { variantId, delta } of deltas) product = applyStockDelta(product, variantId, delta);
    tx.set(snap.ref, product);
    projectProductInTx(tx, business, branch, product);
  }
}

function lineStockUnits(line: OrderLine): number {
  return line.pricingMode === 'weight' ? line.actualGrams ?? line.requestedGrams ?? 0 : line.quantity;
}

/** Stock units a line consumes, expanding combo members (units = member qty × combo qty). */
function stockUnitsOf(line: OrderLine): Array<{ productId: string; variantId?: string; units: number }> {
  if (line.comboItems) return line.comboItems.filter((i) => i.trackInventory).map((i) => ({ productId: i.productId, variantId: i.variantId, units: i.quantity * line.quantity }));
  if (!line.trackInventory) return [];
  return [{ productId: line.productId, variantId: line.variantId, units: lineStockUnits(line) }];
}

/** ---------- Quote (read-only; guests allowed, loyalty only when signed in) ---------- */

export const quoteOrder = onCall(hot, handled(async (req: CallableRequest<unknown>) => {
  const input = parse(quoteRequestSchema, req.data);
  const elig = await loadEligibility(null, input.businessId, input.branchId, input.mode, input.cityId);
  const { lines } = await priceCart(null, input.businessId, input.branchId, input.lines);
  const subtotal = lines.reduce((s, l) => s + l.lineTotalAgorot, 0);
  if (elig.deliveryRule && subtotal < elig.deliveryRule.minSubtotalAgorot) fail('below_minimum', { minSubtotalAgorot: elig.deliveryRule.minSubtotalAgorot, subtotal });
  let redeem = { points: 0, discount: 0 };
  let loyalty: { available: number; debt: number } | undefined;
  if (req.auth && elig.business.loyalty.enabled) {
    const acc = (await col.loyaltyAccount(input.businessId, req.auth.uid).get()).data() as LoyaltyAccount | undefined;
    loyalty = { available: acc?.available ?? 0, debt: acc?.debt ?? 0 };
    if ((input.redeemPoints ?? 0) > 0 && loyalty.debt === 0) redeem = clampRedemption(input.redeemPoints ?? 0, loyalty.available, elig.business.loyalty, subtotal);
  }
  const totals = computeTotals(lines, redeem.discount, elig.deliveryRule?.feeAgorot ?? 0);
  return { lines, totals, redeemPoints: redeem.points, loyalty, rules: elig.business.loyalty.enabled ? elig.business.loyalty : undefined };
}));

/** ---------- Place order (transactional, idempotent) ---------- */

async function resolveAddress(tx: Tx, c: Caller, input: z.infer<typeof placeOrderSchema>, cityId: string): Promise<{ snapshot: AddressSnapshot; saveRef?: FirebaseFirestore.DocumentReference; saveDoc?: SavedAddress }> {
  const citySnap = await tx.get(col.city(cityId));
  if (!citySnap.exists) fail('invalid_argument', { issues: [{ path: 'cityId', message: 'unknown_city' }] });
  const city = citySnap.data() as City;
  if (input.addressId) {
    const snap = await tx.get(col.addresses(c.uid).doc(input.addressId));
    if (!snap.exists) fail('not_found', { entity: 'address' });
    const a = snap.data() as SavedAddress;
    if (a.cityId !== cityId) fail('delivery_not_available', { reason: 'address_city_mismatch' });
    const { id: _id, isDefault: _d, createdAt: _c, updatedAt: _u, ...rest } = a;
    return { snapshot: { ...rest, cityName: city.name } };
  }
  if (!input.address) fail('invalid_argument', { issues: [{ path: 'address', message: 'address_required' }] });
  const a = parse(addressInputSchema, input.address);
  if (a.cityId !== cityId) fail('delivery_not_available', { reason: 'address_city_mismatch' });
  const phone = normalizeIsraeliPhone(a.recipientPhone);
  if (!phone) fail('invalid_argument', { issues: [{ path: 'address.recipientPhone', message: 'invalid_phone' }] });
  const snapshot: AddressSnapshot = {
    label: a.label,
    houseDescription: a.houseDescription,
    cityId: a.cityId,
    cityName: city.name,
    recipientName: a.recipientName,
    recipientPhone: phone,
    neighborhood: a.neighborhood,
    street: a.street,
    buildingNumber: a.buildingNumber,
    apartment: a.apartment,
    floor: a.floor,
    entrance: a.entrance,
    deliveryInstructions: a.deliveryInstructions,
    lat: a.lat,
    lng: a.lng,
  };
  if (input.saveAddress) {
    const ref = col.addresses(c.uid).doc();
    const now = nowIso();
    const existing = await tx.get(col.addresses(c.uid).limit(1));
    const { cityName: _cn, ...forSave } = snapshot;
    return { snapshot, saveRef: ref, saveDoc: { ...forSave, label: a.label ?? '', id: ref.id, isDefault: existing.empty, createdAt: now, updatedAt: now } };
  }
  return { snapshot };
}

/** Next per-business order number. The counter sits beside the uniqueness markers in the server-only orderRefs
 *  collection; reading it inside the placement transaction serialises concurrent placements for one business, so two
 *  orders never get the same number. Taken numbers are skipped so a hand-edited counter can never reuse a reference. */
async function allocateReference(tx: Tx, businessId: string): Promise<{ reference: string; next: number }> {
  const counter = (await tx.get(col.orderRefs().doc(`${businessId}_seq`))).data() as { next?: number } | undefined;
  let n = counter?.next ?? FIRST_ORDER_NUMBER;
  for (let i = 0; i < 6; i++, n++) {
    const snap = await tx.get(col.orderRefs().doc(`${businessId}_${n}`));
    if (!snap.exists) return { reference: String(n), next: n + 1 };
  }
  fail('internal', undefined, 'could not allocate reference');
}

function ledgerEntry(tx: Tx, e: Omit<LoyaltyLedgerEntry, 'id' | 'at'>): void {
  const ref = col.loyaltyLedger().doc(e.key.replace(/[^A-Za-z0-9_:-]/g, '_'));
  tx.set(ref, { ...e, id: ref.id, at: nowIso() } satisfies LoyaltyLedgerEntry);
}

function bumpMetrics(tx: Tx, fields: Record<string, number>): void {
  const date = new Date().toISOString().slice(0, 10);
  const inc: Record<string, FirebaseFirestore.FieldValue | string> = { date };
  for (const [k, v] of Object.entries(fields)) inc[k] = FieldValue.increment(v);
  tx.set(col.metricsDaily(date), inc, { merge: true });
}

export const placeOrder = onCall(hot, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  requireVerifiedPhone(c);
  const input = parse(placeOrderSchema, req.data);
  const contactPhone = normalizeIsraeliPhone(input.contactPhone);
  if (!contactPhone) fail('invalid_argument', { issues: [{ path: 'contactPhone', message: 'invalid_phone' }] });
  await rateLimit(`order:${c.uid}`, 20, 3600);

  const result = await db.runTransaction(async (tx) => {
    const cached = await readIdempotent<{ orderId: string; reference: string }>(tx, c.uid, input.idempotencyKey);
    if (cached) return { ...cached, replay: true };

    // Re-check suspension inside the transaction (server SDK bypasses rules).
    const userSnap = await tx.get(col.user(c.uid));
    if (userSnap.data()?.suspended) fail('suspended');

    const elig = await loadEligibility(tx, input.businessId, input.branchId, input.mode, input.cityId);
    const { lines, products } = await priceCart(tx, input.businessId, input.branchId, input.lines);
    const subtotal = lines.reduce((s, l) => s + l.lineTotalAgorot, 0);
    if (elig.deliveryRule && subtotal < elig.deliveryRule.minSubtotalAgorot) fail('below_minimum', { minSubtotalAgorot: elig.deliveryRule.minSubtotalAgorot, subtotal });

    // Inventory check (atomic: reads happen in this transaction, writes below).
    const stockNeeded = new Map<string, number>();
    for (const l of lines) {
      for (const u of stockUnitsOf(l)) {
        const entry = products.get(u.productId);
        if (!entry) continue;
        const avail = stockAvailable(entry.product, u.variantId);
        if (avail === undefined) continue;
        const key = `${u.productId}:${u.variantId ?? ''}`;
        const need = (stockNeeded.get(key) ?? 0) + u.units;
        if (need > avail) fail('out_of_stock', { lineId: l.lineId, available: avail });
        stockNeeded.set(key, need);
      }
    }

    // Loyalty reservation.
    let redeem = { points: 0, discount: 0 };
    let account: LoyaltyAccount | undefined;
    const rules = elig.business.loyalty;
    if ((input.redeemPoints ?? 0) > 0) {
      if (!rules.enabled) fail('loyalty_insufficient');
      account = (await tx.get(col.loyaltyAccount(input.businessId, c.uid))).data() as LoyaltyAccount | undefined;
      if ((account?.debt ?? 0) > 0) fail('loyalty_debt');
      redeem = clampRedemption(input.redeemPoints!, account?.available ?? 0, rules, subtotal);
      if (redeem.points < input.redeemPoints!) fail('loyalty_insufficient', { maxPoints: redeem.points });
    }
    const totals = computeTotals(lines, redeem.discount, elig.deliveryRule?.feeAgorot ?? 0);
    if (totals.cashDueAgorot !== input.expectedCashDueAgorot) fail('price_changed', { totals });

    let addr: Awaited<ReturnType<typeof resolveAddress>> | undefined;
    if (input.mode === 'delivery') addr = await resolveAddress(tx, c, input, input.cityId);

    const { reference, next: nextOrderNumber } = await allocateReference(tx, input.businessId);
    const printersSnap = await tx.get(col.printers().where('branchId', '==', input.branchId).where('active', '==', true));
    const printers = printersSnap.docs.map((d) => d.data() as PrinterConfig);

    // ----- writes -----
    const orderRef = col.orders().doc();
    const now = nowIso();
    const order: Order = {
      id: orderRef.id,
      reference,
      businessId: input.businessId,
      branchId: input.branchId,
      businessName: elig.business.name,
      branchName: elig.branch.name,
      branchPhone: elig.branch.phone,
      businessType: elig.business.type,
      customer: { uid: c.uid, displayName: c.profile.displayName || input.contactName, phone: c.profile.phone! },
      mode: input.mode,
      cityId: input.cityId,
      address: addr?.snapshot,
      contactName: input.contactName,
      contactPhone,
      tableNumber: input.mode === 'dine_in' && input.tableNumber ? input.tableNumber : undefined,
      customerNote: input.customerNote,
      lines,
      originalLines: lines,
      originalTotals: totals,
      totals,
      loyalty: rules.enabled
        ? { rulesVersion: rules.version, pointsReserved: redeem.points, redeemValueAgorot: rules.redeemValueAgorot, earnPerAgorot: rules.earnPerAgorot, pointsPerStep: rules.pointsPerStep, maxDiscountPercent: rules.maxDiscountPercent }
        : undefined,
      status: 'placed',
      version: 1,
      revision: 0,
      placedAt: now,
      updatedAt: now,
      locked: false,
      customerLocale: input.locale,
    };
    tx.set(orderRef, order);
    tx.set(col.orderRefs().doc(`${input.businessId}_${reference}`), { orderId: orderRef.id, createdAt: now });
    tx.set(col.orderRefs().doc(`${input.businessId}_seq`), { next: nextOrderNumber, updatedAt: now });
    const ev: OrderEvent = { id: col.orderEvents(orderRef.id).doc().id, orderId: orderRef.id, type: 'placed', actorUid: c.uid, actorRole: 'customer', at: now, version: 1 };
    tx.set(col.orderEvents(orderRef.id).doc(ev.id), ev);

    for (const [key, need] of stockNeeded) {
      const [productId, variantId] = key.split(':');
      const entry = products.get(productId!)!;
      const next = applyStockDelta(entry.product, variantId || undefined, -need);
      entry.product = next;
      tx.set(entry.ref, next);
      projectProductInTx(tx, elig.business, elig.branch, next);
    }
    if (redeem.points > 0) {
      const accRef = col.loyaltyAccount(input.businessId, c.uid);
      tx.set(accRef, { id: accRef.id, businessId: input.businessId, uid: c.uid, available: (account?.available ?? 0) - redeem.points, reserved: (account?.reserved ?? 0) + redeem.points, debt: account?.debt ?? 0, updatedAt: now } satisfies LoyaltyAccount);
      ledgerEntry(tx, { businessId: input.businessId, uid: c.uid, orderId: orderRef.id, type: 'reserve', points: -redeem.points, reservedDelta: redeem.points, rulesVersion: rules.version, actorUid: c.uid, key: `${orderRef.id}:reserve` });
    }
    if (addr?.saveRef && addr.saveDoc) tx.set(addr.saveRef, addr.saveDoc);
    enqueueEvent(tx, { kind: 'order_placed', audience: { businessId: input.businessId, branchId: input.branchId }, params: { reference }, link: `/business/${input.businessId}/${input.branchId}/orders/${orderRef.id}`, orderId: orderRef.id, businessId: input.businessId, branchId: input.branchId, key: `order_placed:${orderRef.id}` });
    enqueueAutoPrintJobs(tx, order, 'auto_placed', printers);
    bumpMetrics(tx, { placedCount: 1, placedValueAgorot: totals.cashDueAgorot });
    const res = { orderId: orderRef.id, reference };
    writeIdempotent(tx, c.uid, input.idempotencyKey, res, 'placeOrder');
    return { ...res, replay: false };
  });
  return result;
}));

/** ---------- Accept / reject ---------- */

async function loadOrderForStaff(tx: Tx, c: Caller, orderId: string, roles: Array<'owner' | 'manager' | 'staff'>): Promise<{ order: Order; role: string }> {
  const snap = await tx.get(col.order(orderId));
  if (!snap.exists) fail('not_found', { entity: 'order' });
  const order = snap.data() as Order;
  const { role } = await requireMembership(c, order.businessId, roles, order.branchId, tx);
  return { order, role };
}

export const decideOrder = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(decideOrderSchema, req.data);
  if (input.decision === 'rejected' && !input.reason?.trim()) fail('invalid_argument', { issues: [{ path: 'reason', message: 'reason_required' }] });
  return db.runTransaction(async (tx) => {
    const cached = await readIdempotent<{ status: string; version: number }>(tx, c.uid, input.idempotencyKey);
    if (cached) return { ...cached, replay: true };
    const { order, role } = await loadOrderForStaff(tx, c, input.orderId, ['owner', 'manager', 'staff']);
    if (order.status !== 'placed') fail('invalid_status_transition', { status: order.status });
    if (order.version !== input.expectedVersion) fail('version_conflict', { version: order.version });
    const now = nowIso();
    const [bSnap, brSnap, printersSnap] = await Promise.all([
      tx.get(col.business(order.businessId)),
      tx.get(col.branch(order.businessId, order.branchId)),
      tx.get(col.printers().where('branchId', '==', order.branchId).where('active', '==', true)),
    ]);
    const business = bSnap.data() as Business;
    const branch = brSnap.data() as Branch;
    const next: Order = { ...order, status: input.decision, decisionReason: input.reason?.trim() || undefined, decidedAt: now, decidedBy: c.uid, version: order.version + 1, updatedAt: now };
    if (input.decision === 'accepted') { next.stage = 'preparing'; next.stageUpdatedAt = now; }

    if (input.decision === 'rejected') {
      // Release inventory exactly once and release reserved points.
      const restore = new Map<string, number>();
      for (const l of order.lines) if (!l.removed) for (const u of stockUnitsOf(l)) restore.set(`${u.productId}:${u.variantId ?? ''}`, (restore.get(`${u.productId}:${u.variantId ?? ''}`) ?? 0) + u.units);
      const stockPlan = await readStockDeltas(tx, order.businessId, order.branchId, restore);
      const reservedPts = order.loyalty?.pointsReserved ?? 0;
      const accRefR = col.loyaltyAccount(order.businessId, order.customer.uid);
      const accR = reservedPts > 0 ? ((await tx.get(accRefR)).data() as LoyaltyAccount | undefined) : undefined;
      writeStockDeltas(tx, business, branch, stockPlan);
      const reserved = reservedPts;
      if (reserved > 0) {
        const accRef = accRefR;
        const acc = accR;
        tx.set(accRef, { id: accRef.id, businessId: order.businessId, uid: order.customer.uid, available: (acc?.available ?? 0) + reserved, reserved: Math.max(0, (acc?.reserved ?? 0) - reserved), debt: acc?.debt ?? 0, updatedAt: now } satisfies LoyaltyAccount);
        ledgerEntry(tx, { businessId: order.businessId, uid: order.customer.uid, orderId: order.id, type: 'release', points: reserved, reservedDelta: -reserved, rulesVersion: order.loyalty!.rulesVersion, actorUid: c.uid, reason: 'rejected', key: `${order.id}:release` });
      }
      bumpMetrics(tx, { rejectedCount: 1 });
    } else {
      // Acceptance converts the reservation into a sale: stock already decremented; points stay reserved until cash is recorded.
      bumpMetrics(tx, { acceptedCount: 1, acceptedValueAgorot: order.totals.cashDueAgorot });
      enqueueAutoPrintJobs(tx, next, 'auto_accepted', printersSnap.docs.map((d) => d.data() as PrinterConfig));
    }
    tx.set(col.order(order.id), next);
    const ev: OrderEvent = { id: col.orderEvents(order.id).doc().id, orderId: order.id, type: input.decision, actorUid: c.uid, actorRole: role as OrderEvent['actorRole'], at: now, reason: next.decisionReason, version: next.version };
    tx.set(col.orderEvents(order.id).doc(ev.id), ev);
    enqueueEvent(tx, { kind: input.decision === 'accepted' ? 'order_accepted' : 'order_rejected', recipients: [order.customer.uid], params: { reference: order.reference }, link: `/orders/${order.id}`, orderId: order.id, businessId: order.businessId, branchId: order.branchId, key: `order_${input.decision}:${order.id}` });
    const res = { status: next.status, version: next.version };
    writeIdempotent(tx, c.uid, input.idempotencyKey, res, 'decideOrder');
    return { ...res, replay: false };
  });
}));

/** ---------- Fulfillment stages: preparing → ready → completed (ready → preparing is an undo) ---------- */

const STAGE_TRANSITIONS: Record<OrderStage, readonly OrderStage[]> = { preparing: ['ready'], ready: ['completed', 'preparing'], completed: [] };

export const advanceOrder = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(advanceOrderSchema, req.data);
  return db.runTransaction(async (tx) => {
    const cached = await readIdempotent<{ stage: string; version: number }>(tx, c.uid, input.idempotencyKey);
    if (cached) return { ...cached, replay: true };
    const { order, role } = await loadOrderForStaff(tx, c, input.orderId, ['owner', 'manager', 'staff']);
    // Orders accepted before stages existed have none: treat them as 'preparing' so they can still be moved.
    const from = order.status === 'accepted' ? order.stage ?? 'preparing' : undefined;
    if (!from || !STAGE_TRANSITIONS[from].includes(input.stage)) fail('invalid_status_transition', { status: order.status, stage: order.stage });
    if (order.version !== input.expectedVersion) fail('version_conflict', { version: order.version });
    const now = nowIso();
    const next: Order = { ...order, stage: input.stage, stageUpdatedAt: now, version: order.version + 1, updatedAt: now };
    if (input.stage === 'ready') next.readyAt = now;
    if (input.stage === 'completed') next.completedAt = now;
    tx.set(col.order(order.id), next);
    if (input.stage !== 'preparing') {
      const ev: OrderEvent = { id: col.orderEvents(order.id).doc().id, orderId: order.id, type: input.stage, actorUid: c.uid, actorRole: role as OrderEvent['actorRole'], at: now, before: { stage: from }, after: { stage: input.stage }, version: next.version };
      tx.set(col.orderEvents(order.id).doc(ev.id), ev);
      enqueueEvent(tx, { kind: input.stage === 'ready' ? 'order_ready' : 'order_completed', recipients: [order.customer.uid], params: { reference: order.reference }, link: `/orders/${order.id}`, orderId: order.id, businessId: order.businessId, branchId: order.branchId, key: `order_${input.stage}:${order.id}:${next.version}` });
    }
    const res = { stage: next.stage, version: next.version };
    writeIdempotent(tx, c.uid, input.idempotencyKey, res, 'advanceOrder');
    return { ...res, replay: false };
  });
}));

/** ---------- Revisions: substitutions, quantity changes, actual weights ---------- */

export const reviseOrder = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(reviseOrderSchema, req.data);
  return db.runTransaction(async (tx) => {
    const cached = await readIdempotent<{ version: number; revision: number }>(tx, c.uid, input.idempotencyKey);
    if (cached) return { ...cached, replay: true };
    const { order, role } = await loadOrderForStaff(tx, c, input.orderId, ['owner', 'manager', 'staff']);
    if (order.status === 'rejected') fail('invalid_status_transition', { status: order.status });
    if (order.locked) fail('already_settled');
    if (order.version !== input.expectedVersion) fail('version_conflict', { version: order.version });
    const [bSnap, brSnap] = await Promise.all([tx.get(col.business(order.businessId)), tx.get(col.branch(order.businessId, order.branchId))]);
    const business = bSnap.data() as Business;
    const branch = brSnap.data() as Branch;

    const lines: OrderLine[] = order.lines.map((l) => ({ ...l }));
    const stockDelta = new Map<string, number>(); // positive = return to stock
    const productCache = new Map<string, { ref: FirebaseFirestore.DocumentReference; product: Product }>();
    const getProduct = async (id: string) => {
      const hit = productCache.get(id);
      if (hit) return hit;
      const ref = col.products(order.businessId, order.branchId).doc(id);
      const s = await tx.get(ref);
      if (!s.exists) fail('item_unavailable', { productId: id });
      const entry = { ref, product: s.data() as Product };
      productCache.set(id, entry);
      return entry;
    };
    const addDelta = (l: Pick<OrderLine, 'productId' | 'variantId' | 'trackInventory'>, d: number) => {
      if (!l.trackInventory || d === 0) return;
      const k = `${l.productId}:${l.variantId ?? ''}`;
      stockDelta.set(k, (stockDelta.get(k) ?? 0) + d);
    };
    const needsAgreement = (why: string) => {
      if (!input.phoneAgreement) fail('invalid_argument', { issues: [{ path: 'phoneAgreement', message: why }] });
    };
    /**
     * Single source of truth, shared with the dashboard's revision dialog (see
     * revisionAgreementReason). Keeping the rule in one place is what stops the two sides drifting —
     * the dialog previously missed two of these cases and staff hit an opaque rejection.
     */
    const requireAgreementFor = (line: Pick<OrderLine, 'quantity' | 'requestedGrams'>, ch: RevisionChangeLike) => {
      const reason = revisionAgreementReason(line, ch);
      if (reason) needsAgreement(`phone_agreement_required_for_${reason}`);
    };

    for (const ch of input.changes) {
      const line = lines.find((l) => l.lineId === ch.lineId);
      if (!line || line.removed) fail('not_found', { entity: 'line', lineId: ch.lineId });
      switch (ch.action) {
        case 'remove': {
          requireAgreementFor(line, ch);
          for (const u of stockUnitsOf(line)) addDelta({ productId: u.productId, variantId: u.variantId, trackInventory: true }, u.units);
          line.removed = true;
          line.revised = true;
          line.lineTotalAgorot = 0;
          break;
        }
        case 'set_quantity': {
          if (line.comboId) fail('invalid_argument', { issues: [{ path: 'quantity', message: 'combo_lines_can_only_be_removed' }] });
          if (line.pricingMode !== 'unit' || ch.quantity === undefined) fail('invalid_argument', { issues: [{ path: 'quantity', message: 'quantity_required' }] });
          if (ch.quantity === 0) {
            requireAgreementFor(line, ch);
            addDelta(line, line.quantity);
            line.removed = true;
            line.revised = true;
            line.lineTotalAgorot = 0;
            break;
          }
          requireAgreementFor(line, ch);
          addDelta(line, line.quantity - ch.quantity);
          line.quantity = ch.quantity;
          line.revised = true;
          line.lineTotalAgorot = recomputeLineTotal(line);
          break;
        }
        case 'set_actual_weight': {
          if (line.pricingMode !== 'weight' || ch.actualGrams === undefined) fail('invalid_argument', { issues: [{ path: 'actualGrams', message: 'weight_required' }] });
          const requested = line.requestedGrams ?? 0;
          // Tolerance: staff may weigh slightly over; more than 25% over the request needs agreement.
          requireAgreementFor(line, ch);
          const previous = line.actualGrams ?? requested;
          addDelta(line, previous - ch.actualGrams);
          line.actualGrams = ch.actualGrams;
          line.revised = true;
          line.lineTotalAgorot = weightLineTotal(line.unitPriceAgorot, ch.actualGrams);
          break;
        }
        case 'substitute': {
          requireAgreementFor(line, ch);
          if (line.comboId) fail('invalid_argument', { issues: [{ path: 'lineId', message: 'combo_lines_can_only_be_removed' }] });
          if (!ch.replacementProductId) fail('invalid_argument', { issues: [{ path: 'replacementProductId', message: 'required' }] });
          const { product } = await getProduct(ch.replacementProductId);
          if (product.archived || !product.available) fail('item_unavailable', { productId: product.id });
          addDelta(line, lineStockUnits(line));
          line.removed = true;
          line.revised = true;
          line.lineTotalAgorot = 0;
          const priced = priceLine(product, {
            lineId: `${line.lineId}_sub${order.revision + 1}`,
            productId: product.id,
            variantId: ch.replacementVariantId,
            modifiers: [],
            quantity: ch.replacementQuantity ?? 1,
            requestedGrams: ch.replacementGrams,
            expectedUnitPriceAgorot: product.variants.length ? product.variants.find((v) => v.id === ch.replacementVariantId)?.priceAgorot ?? -1 : product.priceAgorot,
          });
          if (priced.problem || !priced.line) fail('invalid_argument', { issues: [{ path: 'replacement', message: priced.problem?.code ?? 'invalid' }] });
          const newLine: OrderLine = { ...priced.line, revised: true, substitutedFromLineId: line.lineId };
          lines.push(newLine);
          addDelta(newLine, -lineStockUnits(newLine));
          break;
        }
      }
    }

    // ----- all remaining reads before any write -----
    for (const k of stockDelta.keys()) await getProduct(k.split(':')[0]!);
    const accRefRev = col.loyaltyAccount(order.businessId, order.customer.uid);
    const accRev = order.loyalty && order.loyalty.pointsReserved > 0 ? ((await tx.get(accRefRev)).data() as LoyaltyAccount | undefined) : undefined;

    // Stock reconciliation with availability checks for increases.
    for (const [k, delta] of stockDelta) {
      const [productId, variantId] = k.split(':');
      const entry = productCache.get(productId!)!;
      const avail = stockAvailable(entry.product, variantId || undefined) ?? 0;
      if (delta < 0 && avail < -delta) fail('out_of_stock', { productId, available: avail });
      entry.product = applyStockDelta(entry.product, variantId || undefined, delta);
      tx.set(entry.ref, entry.product);
      projectProductInTx(tx, business, branch, entry.product);
    }

    // Loyalty reconciliation: discount cannot exceed the (new) cap; release surplus points.
    const subtotal = lines.reduce((s, l) => s + (l.removed ? 0 : l.lineTotalAgorot), 0);
    let discount = order.totals.loyaltyDiscountAgorot;
    let reserved = order.loyalty?.pointsReserved ?? 0;
    const now = nowIso();
    if (order.loyalty && reserved > 0) {
      const cap = Math.floor((subtotal * order.loyalty.maxDiscountPercent) / 100);
      const maxPoints = Math.floor(cap / order.loyalty.redeemValueAgorot);
      if (maxPoints < reserved) {
        const releasePts = reserved - maxPoints;
        const accRef = accRefRev;
        const acc = accRev;
        tx.set(accRef, { id: accRef.id, businessId: order.businessId, uid: order.customer.uid, available: (acc?.available ?? 0) + releasePts, reserved: Math.max(0, (acc?.reserved ?? 0) - releasePts), debt: acc?.debt ?? 0, updatedAt: now } satisfies LoyaltyAccount);
        ledgerEntry(tx, { businessId: order.businessId, uid: order.customer.uid, orderId: order.id, type: 'release', points: releasePts, reservedDelta: -releasePts, rulesVersion: order.loyalty.rulesVersion, actorUid: c.uid, reason: 'revision_cap', key: `${order.id}:release:rev${order.revision + 1}` });
        reserved = maxPoints;
        discount = maxPoints * order.loyalty.redeemValueAgorot;
      }
    }
    const totals = computeTotals(lines, discount, order.totals.deliveryFeeAgorot);
    if (totals.cashDueAgorot < 0 || (subtotal === 0 && lines.every((l) => l.removed))) fail('invalid_argument', { issues: [{ path: 'changes', message: 'invalid_totals' }] });
    const next: Order = { ...order, lines, totals, loyalty: order.loyalty ? { ...order.loyalty, pointsReserved: reserved } : undefined, revision: order.revision + 1, version: order.version + 1, updatedAt: now };
    tx.set(col.order(order.id), next);
    const ev: OrderEvent = { id: col.orderEvents(order.id).doc().id, orderId: order.id, type: 'revised', actorUid: c.uid, actorRole: role as OrderEvent['actorRole'], at: now, reason: input.reason, phoneAgreement: input.phoneAgreement, before: { lines: order.lines, totals: order.totals }, after: { lines, totals }, version: next.version };
    tx.set(col.orderEvents(order.id).doc(ev.id), ev);
    enqueueEvent(tx, { kind: 'order_revised', recipients: [order.customer.uid], params: { reference: order.reference }, link: `/orders/${order.id}`, orderId: order.id, businessId: order.businessId, branchId: order.branchId, key: `order_revised:${order.id}:${next.revision}` });
    const res = { version: next.version, revision: next.revision };
    writeIdempotent(tx, c.uid, input.idempotencyKey, res, 'reviseOrder');
    return { ...res, replay: false };
  });
}));

/** ---------- Cash recording (separate from status) ---------- */

export const recordCash = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(recordCashSchema, req.data);
  return db.runTransaction(async (tx) => {
    const cached = await readIdempotent<{ cashRecordId: string; pointsEarned: number }>(tx, c.uid, input.idempotencyKey);
    if (cached) return { ...cached, replay: true };
    const { order } = await loadOrderForStaff(tx, c, input.orderId, ['owner', 'manager', 'staff']);
    if (order.status !== 'accepted') fail('invalid_status_transition', { status: order.status });
    if (order.cashRecordId) fail('already_settled');
    if (order.version !== input.expectedVersion) fail('version_conflict', { version: order.version });
    if (order.totals.isEstimated) fail('invalid_argument', { issues: [{ path: 'order', message: 'weights_not_finalised' }] });
    if (input.amountAgorot !== order.totals.cashDueAgorot) fail('invalid_argument', { issues: [{ path: 'amountAgorot', message: 'must_match_cash_due', cashDueAgorot: order.totals.cashDueAgorot }] });
    const earnKeyRef = col.loyaltyLedger().doc(`${order.id}:earn`.replace(/[^A-Za-z0-9_:-]/g, '_'));
    const alreadyEarned = (await tx.get(earnKeyRef)).exists;
    const accRefC = col.loyaltyAccount(order.businessId, order.customer.uid);
    const accC = order.loyalty ? ((await tx.get(accRefC)).data() as LoyaltyAccount | undefined) : undefined;
    const now = nowIso();
    const cashRef = col.cashRecords().doc();
    const record: CashRecord = { id: cashRef.id, orderId: order.id, reference: order.reference, businessId: order.businessId, branchId: order.branchId, amountAgorot: input.amountAgorot, recordedBy: c.uid, recordedAt: now, reversed: false };
    tx.set(cashRef, record);
    const next: Order = { ...order, cashRecordId: cashRef.id, cashSettledAt: now, locked: true, version: order.version + 1, updatedAt: now };
    tx.set(col.order(order.id), next);

    let earned = 0;
    if (order.loyalty) {
      const accRef = accRefC;
      const acc = accC;
      const reserved = order.loyalty.pointsReserved;
      const paidMerch = order.totals.merchandiseSubtotalAgorot - order.totals.loyaltyDiscountAgorot;
      // Earning is based on the finalised merchandise actually paid; points being earned cannot fund this order.
      earned = alreadyEarned ? 0 : pointsEarned({ enabled: true, earnPerAgorot: order.loyalty.earnPerAgorot, pointsPerStep: order.loyalty.pointsPerStep }, paidMerch);
      // Earned points pay down any debt first, exactly as adminAdjustLoyalty does. Crediting them
      // straight to `available` left the debt standing forever, and placeOrder refuses redemption
      // while debt > 0 — so the customer would accumulate points they could never spend.
      let available = (acc?.available ?? 0) + earned;
      let debt = acc?.debt ?? 0;
      if (earned > 0 && debt > 0) {
        const cover = Math.min(debt, earned);
        debt -= cover;
        available -= cover;
      }
      tx.set(accRef, { id: accRef.id, businessId: order.businessId, uid: order.customer.uid, available, reserved: Math.max(0, (acc?.reserved ?? 0) - reserved), debt, updatedAt: now } satisfies LoyaltyAccount);
      if (reserved > 0) ledgerEntry(tx, { businessId: order.businessId, uid: order.customer.uid, orderId: order.id, type: 'consume', points: 0, reservedDelta: -reserved, rulesVersion: order.loyalty.rulesVersion, actorUid: c.uid, key: `${order.id}:consume` });
      if (earned > 0) ledgerEntry(tx, { businessId: order.businessId, uid: order.customer.uid, orderId: order.id, type: 'earn', points: earned, reservedDelta: 0, rulesVersion: order.loyalty.rulesVersion, actorUid: c.uid, key: `${order.id}:earn` });
    }
    const ev: OrderEvent = { id: col.orderEvents(order.id).doc().id, orderId: order.id, type: 'cash_recorded', actorUid: c.uid, actorRole: 'staff', at: now, after: { amountAgorot: input.amountAgorot, pointsEarned: earned }, version: next.version };
    tx.set(col.orderEvents(order.id).doc(ev.id), ev);
    enqueueEvent(tx, { kind: 'cash_recorded', recipients: [order.customer.uid], params: { reference: order.reference }, link: `/orders/${order.id}`, orderId: order.id, businessId: order.businessId, branchId: order.branchId, key: `cash_recorded:${order.id}` });
    bumpMetrics(tx, { cashRecordsCount: 1, cashRecordedAgorot: input.amountAgorot });
    const res = { cashRecordId: cashRef.id, pointsEarned: earned };
    writeIdempotent(tx, c.uid, input.idempotencyKey, res, 'recordCash');
    return { ...res, replay: false };
  });
}));

/** Owner/admin audited reversal of a recorded cash collection (e.g. accepted order that could not be supplied, cash returned). */
export async function reverseCashInternal(c: Caller, input: z.infer<typeof reverseCashSchema>, asAdmin: boolean) {
  return db.runTransaction(async (tx) => {
    const cached = await readIdempotent<{ ok: true }>(tx, c.uid, input.idempotencyKey);
    if (cached) return { ...cached, replay: true };
    const snap = await tx.get(col.order(input.orderId));
    if (!snap.exists) fail('not_found');
    const order = snap.data() as Order;
    if (asAdmin) {
      if (!c.isAdmin) fail('forbidden');
    } else await requireMembership(c, order.businessId, ['owner'], order.branchId, tx);
    if (!order.cashRecordId) fail('invalid_argument', { issues: [{ path: 'order', message: 'not_settled' }] });
    const cashRef = col.cashRecords().doc(order.cashRecordId);
    const cash = (await tx.get(cashRef)).data() as CashRecord | undefined;
    if (!cash || cash.reversed) fail('invalid_argument', { issues: [{ path: 'order', message: 'already_reversed' }] });
    const [bSnap, brSnap] = await Promise.all([tx.get(col.business(order.businessId)), tx.get(col.branch(order.businessId, order.branchId))]);
    const now = nowIso();
    // Inventory: return tracked stock for supplied lines.
    const restore = new Map<string, number>();
    for (const l of order.lines) if (!l.removed) for (const u of stockUnitsOf(l)) restore.set(`${u.productId}:${u.variantId ?? ''}`, (restore.get(`${u.productId}:${u.variantId ?? ''}`) ?? 0) + u.units);
    const stockPlan = await readStockDeltas(tx, order.businessId, order.branchId, restore);
    // Loyalty: reverse earned points (may create debt) and return consumed points.
    let ledgerWrites: Array<Omit<LoyaltyLedgerEntry, 'id' | 'at'>> = [];
    let accWrite: LoyaltyAccount | undefined;
    if (order.loyalty) {
      const earnedSnap = await tx.get(col.loyaltyLedger().doc(`${order.id}:earn`.replace(/[^A-Za-z0-9_:-]/g, '_')));
      const earned = earnedSnap.exists ? (earnedSnap.data() as LoyaltyLedgerEntry).points : 0;
      const consumed = order.loyalty.pointsReserved;
      const accRef = col.loyaltyAccount(order.businessId, order.customer.uid);
      const acc = (await tx.get(accRef)).data() as LoyaltyAccount | undefined;
      let available = (acc?.available ?? 0) + consumed - earned;
      let debt = acc?.debt ?? 0;
      if (available < 0) {
        debt += -available; // points already spent elsewhere → transparent debt blocks redemption
        available = 0;
      }
      accWrite = { id: accRef.id, businessId: order.businessId, uid: order.customer.uid, available, reserved: acc?.reserved ?? 0, debt, updatedAt: now };
      ledgerWrites = [
        ...(earned > 0 ? [{ businessId: order.businessId, uid: order.customer.uid, orderId: order.id, type: 'reverse_earn' as const, points: -earned, reservedDelta: 0, rulesVersion: order.loyalty.rulesVersion, actorUid: c.uid, reason: input.reason, key: `${order.id}:reverse_earn` }] : []),
        ...(consumed > 0 ? [{ businessId: order.businessId, uid: order.customer.uid, orderId: order.id, type: 'reverse_consume' as const, points: consumed, reservedDelta: 0, rulesVersion: order.loyalty.rulesVersion, actorUid: c.uid, reason: input.reason, key: `${order.id}:reverse_consume` }] : []),
      ];
      tx.set(accRef, accWrite);
      for (const e of ledgerWrites) ledgerEntry(tx, e);
    }
    writeStockDeltas(tx, bSnap.data() as Business, brSnap.data() as Branch, stockPlan);
    tx.update(cashRef, { reversed: true, reversedAt: now, reversedBy: c.uid, reversalReason: input.reason });
    // Record the reversal on the order: customers and staff cannot read cashRecords, so this is the
    // only place they can learn the payment no longer stands.
    const next: Order = { ...order, cashReversedAt: now, version: order.version + 1, updatedAt: now };
    tx.set(col.order(order.id), next);
    const ev: OrderEvent = { id: col.orderEvents(order.id).doc().id, orderId: order.id, type: 'cash_reversed', actorUid: c.uid, actorRole: asAdmin ? 'admin' : 'owner', at: now, reason: input.reason, after: { amountAgorot: cash.amountAgorot, loyalty: accWrite }, version: next.version };
    tx.set(col.orderEvents(order.id).doc(ev.id), ev);
    writeAudit(tx, { actorUid: c.uid, action: 'cash.reverse', targetType: 'order', targetId: order.id, reason: input.reason, before: cash, after: { reversed: true } });
    bumpMetrics(tx, { cashReversedAgorot: cash.amountAgorot });
    writeIdempotent(tx, c.uid, input.idempotencyKey, { ok: true }, 'reverseCash');
    return { ok: true as const, replay: false };
  });
}

export const reverseCash = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(reverseCashSchema, req.data);
  return reverseCashInternal(c, input, false);
}));

export { QareebError };
