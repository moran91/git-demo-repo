/**
 * Qareeb — live restaurant + supermarket creation AND authenticated endpoint sweep.
 *
 * Everything here runs through the REAL deployed callables as a real owner and a real customer.
 * Nothing is written to Firestore directly.
 *
 * WHY YOU HAVE TO RUN THIS AND NOT THE AGENT
 * ------------------------------------------
 * Minting an ID token for a test principal needs `auth.createCustomToken`, which signs with a
 * service-account key. The agent's local credentials are an `authorized_user` (gcloud ADC), and GCP
 * refused `iam.serviceAccounts.signBlob` for them, so it could not authenticate as anyone on the
 * live project. With a service-account key present, createCustomToken signs locally and needs no
 * IAM grant at all — which is what this script uses.
 *
 * SETUP (one minute)
 *   Firebase console -> Project settings -> Service accounts -> Generate new private key
 *   export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
 *
 * RUN (from the repo root)
 *   node live-sweep.mjs
 *
 * The script pauses once, after creating both businesses, so you can approve them in
 * /admin/approvals — approval is a platform-admin action and is deliberately left to you. It then
 * polls until they are approved and runs the full sweep.
 *
 * To rehearse against the emulator instead:  QAREEB_TARGET=emulator node live-sweep.mjs
 *
 * CLEANUP: everything it creates is tagged, and it prints the exact ids at the end.
 */
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { initializeApp as adminInit, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const PROJECT = 'qareeb-dev';
const REGION = 'me-west1';
const WEB_API_KEY = 'AIzaSyC-_lxW2WJ2XzYq5Z33IC8A8oaOElUouN8';
const LIVE = (process.env.QAREEB_TARGET ?? 'live') !== 'emulator';
const STAMP = process.env.QAREEB_STAMP ?? String(Date.now());

process.env.GCLOUD_PROJECT ||= PROJECT;
if (!LIVE) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
}
if (LIVE && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key (see the header).');
  process.exit(1);
}

if (getApps().length === 0) adminInit(LIVE ? { credential: applicationDefault(), projectId: PROJECT } : { projectId: PROJECT });
const A = { auth: adminAuth(), db: adminFirestore() };
A.db.settings({ ignoreUndefinedProperties: true });

const results = [];
let n = 0;
function client(label) {
  const app = initializeApp({ projectId: PROJECT, apiKey: LIVE ? WEB_API_KEY : 'fake-api-key', authDomain: `${PROJECT}.firebaseapp.com` }, `c-${++n}-${randomUUID()}`);
  const auth = getAuth(app);
  const fns = getFunctions(app, REGION);
  if (!LIVE) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  }
  return { label, auth, app, raw: (nm, d) => httpsCallable(fns, nm)(d ?? {}).then((r) => r.data), close: () => deleteApp(app) };
}

/** Calls a deployed callable and records the outcome against what we expected. */
async function call(c, name, data, expect = 'ok', note = '') {
  let outcome, value;
  try { value = await c.raw(name, data); outcome = 'ok'; }
  catch (e) { outcome = e?.details?.code ?? e?.message ?? 'unknown'; }
  const pass = outcome === expect;
  results.push({ name, as: c.label, expect, outcome, pass, note });
  console.log(`  ${pass ? '✓' : '✗'} ${name.padEnd(22)} as ${c.label.padEnd(9)} -> ${outcome}${pass ? '' : ` (expected ${expect})`} ${note}`);
  return value;
}

async function principal(label, opts) {
  const uid = `qa-sweep-${opts.kind}-${STAMP}`;
  await A.auth.createUser({ uid, ...opts.props }).catch(async (e) => {
    if (e.code === 'auth/uid-already-exists') return;
    throw e;
  });
  const c = client(label);
  await signInWithCustomToken(c.auth, await A.auth.createCustomToken(uid));
  await c.raw('ensureProfile', {});
  return Object.assign(c, { uid });
}

const allDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ startMin: 0, endMin: 1440 }]]));
const K = () => randomUUID();
const P = (over) => ({ description: {}, dietaryText: {}, pricingMode: 'unit', priceAgorot: 1000, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [], available: true, trackInventory: false, ...over });

console.log(`\nTarget: ${LIVE ? 'LIVE ' + PROJECT : 'emulator'}   run stamp: ${STAMP}\n`);

// ---------------------------------------------------------------- principals
const owner = await principal('owner', { kind: 'owner', props: { email: `qa.sweep.owner.${STAMP}@qareeb-test.invalid`, emailVerified: true, displayName: 'QA Sweep Owner' } });
const customer = await principal('customer', { kind: 'cust', props: { phoneNumber: `+9725${STAMP.slice(-8)}`, displayName: 'QA Sweep Customer' } });
const guest = client('guest');
console.log(`principals: owner=${owner.uid} customer=${customer.uid}\n`);

// ---------------------------------------------------------------- as OWNER: build a restaurant
console.log('=== owner: restaurant ===');
const cityId = (await A.db.collection('cities').where('active', '==', true).limit(1).get()).docs[0]?.id ?? 'beit-jann';
const rest = (await call(owner, 'createBusiness', { type: 'restaurant', name: { he: 'מסעדת הסוויפ', ar: 'مطعم الفحص', en: 'Sweep Restaurant' }, description: { he: 'נוצר על ידי בדיקת קצה־לקצה' }, defaultLocale: 'he', publicPhone: '04-9990001' }))?.business;
const restBranch = (await call(owner, 'createBranch', { businessId: rest.id, branch: { name: { he: 'הסניף', en: 'Branch' }, cityId, locationDescription: { he: 'בדיקה' }, phone: '0509990001', hours: allDay, hoursOverrides: [], pickupEnabled: true, deliveryEnabled: true, deliveryCities: [{ cityId, feeAgorot: 0, minSubtotalAgorot: 0 }] } }))?.branch;
await call(owner, 'setLoyaltyRules', { businessId: rest.id, rules: { enabled: true, earnPerAgorot: 1000, pointsPerStep: 1, redeemValueAgorot: 10, maxDiscountPercent: 20 } });
const rCat = (await call(owner, 'saveCategory', { businessId: rest.id, branchId: restBranch.id, category: { name: { he: 'מנות', en: 'Mains' } } }))?.category;
const shawarma = (await call(owner, 'saveProduct', { businessId: rest.id, branchId: restBranch.id, product: P({ categoryId: rCat.id, name: { he: 'שווארמה', en: 'Shawarma' }, priceAgorot: 4500, modifierGroups: [{ id: 'g-bread', name: { he: 'לחם' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [{ id: 'o-pita', name: { he: 'פיתה' }, priceDeltaAgorot: 0, available: true, sortOrder: 0 }, { id: 'o-laffa', name: { he: 'לאפה' }, priceDeltaAgorot: 300, available: true, sortOrder: 1 }] }] }) }))?.product;
await call(owner, 'reorderProducts', { businessId: rest.id, branchId: restBranch.id, orderedIds: [shawarma.id] });

// ---------------------------------------------------------------- as OWNER: build a supermarket
console.log('\n=== owner: supermarket ===');
const mkt = (await call(owner, 'createBusiness', { type: 'supermarket', name: { he: 'סופר הסוויפ', ar: 'سوبر الفحص', en: 'Sweep Supermarket' }, description: {}, defaultLocale: 'he', publicPhone: '04-9990002' }))?.business;
const mktBranch = (await call(owner, 'createBranch', { businessId: mkt.id, branch: { name: { he: 'הסניף', en: 'Branch' }, cityId, locationDescription: { he: 'בדיקה' }, phone: '0509990002', hours: allDay, hoursOverrides: [], pickupEnabled: true, deliveryEnabled: true, deliveryCities: [{ cityId, feeAgorot: 0, minSubtotalAgorot: 0 }] } }))?.branch;
const mCat = (await call(owner, 'saveCategory', { businessId: mkt.id, branchId: mktBranch.id, category: { name: { he: 'ירקות', en: 'Produce' } } }))?.category;
const tomato = (await call(owner, 'saveProduct', { businessId: mkt.id, branchId: mktBranch.id, product: P({ categoryId: mCat.id, name: { he: 'עגבניות', en: 'Tomatoes' }, pricingMode: 'weight', priceAgorot: 890, weightStepGrams: 250, minWeightGrams: 250, trackInventory: true, stockQty: 50000 }) }))?.product;
const rice = (await call(owner, 'saveProduct', { businessId: mkt.id, branchId: mktBranch.id, product: P({ categoryId: mCat.id, name: { he: 'אורז', en: 'Rice' }, priceAgorot: 1990, trackInventory: true, variants: [{ id: 'v-1kg', name: { he: '1 ק״ג' }, priceAgorot: 1990, available: true, sortOrder: 0, stockQty: 10 }, { id: 'v-5kg', name: { he: '5 ק״ג' }, priceAgorot: 7990, available: true, sortOrder: 1, stockQty: 5 }] }) }))?.product;
await call(owner, 'adjustStock', { businessId: mkt.id, branchId: mktBranch.id, productId: rice.id, variantId: 'v-1kg', newQty: 12, reason: 'sweep stocktake' });

// ---------------------------------------------------------------- approval (yours)
console.log('\n=== approval required ===');
console.log(`  Restaurant : ${rest.id}`);
console.log(`  Supermarket: ${mkt.id}`);
console.log('  Approve both at /admin/approvals, then press Enter here.');
if (process.stdin.isTTY) { const rl = createInterface({ input: process.stdin, output: process.stdout }); await rl.question(''); rl.close(); }
for (let i = 0; i < 120; i++) {
  const [b1, b2] = await Promise.all([A.db.collection('businesses').doc(rest.id).get(), A.db.collection('businesses').doc(mkt.id).get()]);
  if (b1.data()?.approval === 'approved' && b2.data()?.approval === 'approved') { console.log('  both approved.'); break; }
  await new Promise((r) => setTimeout(r, 5000));
}

// ---------------------------------------------------------------- as USER: order end to end
console.log('\n=== customer: quote, place; owner: accept, revise, settle ===');
const addr = await call(customer, 'saveAddress', { address: { houseDescription: 'בית הבדיקה ליד המסגד', cityId, recipientName: 'QA', recipientPhone: '0501112233' } });
await call(customer, 'updateProfile', { displayName: 'QA Sweep Customer', locale: 'he' });
const line = { lineId: 'l1', productId: shawarma.id, modifiers: [{ groupId: 'g-bread', optionIds: ['o-laffa'] }], quantity: 2, expectedUnitPriceAgorot: 4800 };
await call(guest, 'quoteOrder', { businessId: rest.id, branchId: restBranch.id, mode: 'pickup', cityId, lines: [line] }, 'ok', 'guests may quote');
await call(customer, 'quoteOrder', { businessId: rest.id, branchId: restBranch.id, mode: 'pickup', cityId, lines: [{ ...line, expectedUnitPriceAgorot: 1 }] }, 'price_changed');
const q = await call(customer, 'quoteOrder', { businessId: rest.id, branchId: restBranch.id, mode: 'delivery', cityId, lines: [line] });
const idem = K();
const placed = await call(customer, 'placeOrder', { businessId: rest.id, branchId: restBranch.id, mode: 'delivery', cityId, lines: [line], idempotencyKey: idem, contactName: 'QA', contactPhone: '0501112233', addressId: addr.address.id, expectedCashDueAgorot: q.totals.cashDueAgorot, locale: 'he' });
const replay = await call(customer, 'placeOrder', { businessId: rest.id, branchId: restBranch.id, mode: 'delivery', cityId, lines: [line], idempotencyKey: idem, contactName: 'QA', contactPhone: '0501112233', addressId: addr.address.id, expectedCashDueAgorot: q.totals.cashDueAgorot, locale: 'he' }, 'ok', 'idempotent replay');
if (replay?.orderId !== placed?.orderId) console.log('  ✗ replay returned a different order');
const ord = async () => (await A.db.collection('orders').doc(placed.orderId).get()).data();
let o = await ord();
await call(customer, 'decideOrder', { orderId: placed.orderId, decision: 'accepted', expectedVersion: o.version, idempotencyKey: K() }, 'forbidden', 'customer cannot accept');
await call(owner, 'decideOrder', { orderId: placed.orderId, decision: 'accepted', expectedVersion: o.version, idempotencyKey: K() });
o = await ord();
await call(owner, 'reviseOrder', { orderId: placed.orderId, expectedVersion: o.version, idempotencyKey: K(), reason: 'sweep revision', phoneAgreement: true, changes: [{ lineId: 'l1', action: 'set_quantity', quantity: 1 }] });
o = await ord();
await call(owner, 'recordCash', { orderId: placed.orderId, amountAgorot: o.totals.cashDueAgorot, expectedVersion: o.version, idempotencyKey: K() });
o = await ord();
console.log(`  settled: cashRecordId=${!!o.cashRecordId} cashReversedAt=${o.cashReversedAt ?? 'none'}`);
await call(owner, 'reverseCash', { orderId: placed.orderId, reason: 'sweep reversal', idempotencyKey: K() });
o = await ord();
console.log(`  reversed: cashReversedAt=${o.cashReversedAt ? 'set' : 'MISSING'}`);

// ---------------------------------------------------------------- supermarket weight + variants
console.log('\n=== customer: supermarket weight and variant order ===');
const wlines = [
  { lineId: 'w1', productId: tomato.id, modifiers: [], quantity: 1, requestedGrams: 500, expectedUnitPriceAgorot: 890 },
  { lineId: 'r1', productId: rice.id, variantId: 'v-1kg', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 1990 },
  { lineId: 'r5', productId: rice.id, variantId: 'v-5kg', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 7990 },
];
const mq = await call(customer, 'quoteOrder', { businessId: mkt.id, branchId: mktBranch.id, mode: 'pickup', cityId, lines: wlines });
const mOrder = await call(customer, 'placeOrder', { businessId: mkt.id, branchId: mktBranch.id, mode: 'pickup', cityId, lines: wlines, idempotencyKey: K(), contactName: 'QA', contactPhone: '0501112233', expectedCashDueAgorot: mq.totals.cashDueAgorot, locale: 'he' });
const before = (await A.db.doc(`businesses/${mkt.id}/branches/${mktBranch.id}/products/${rice.id}`).get()).data();
let mo = (await A.db.collection('orders').doc(mOrder.orderId).get()).data();
await call(owner, 'decideOrder', { orderId: mOrder.orderId, decision: 'rejected', reason: 'sweep rejection', expectedVersion: mo.version, idempotencyKey: K() });
const after = (await A.db.doc(`businesses/${mkt.id}/branches/${mktBranch.id}/products/${rice.id}`).get()).data();
const qty = (d, id) => d.variants.find((v) => v.id === id).stockQty;
console.log(`  rice after rejection: v-1kg=${qty(after, 'v-1kg')} v-5kg=${qty(after, 'v-5kg')} (both must be fully restored)`);

// ---------------------------------------------------------------- authorization boundaries
console.log('\n=== authorization ===');
await call(customer, 'saveProduct', { businessId: rest.id, branchId: restBranch.id, product: P({ categoryId: rCat.id, name: { he: 'x' } }) }, 'forbidden', 'customer cannot edit catalog');
await call(customer, 'getAdminMetrics', {}, 'forbidden');
await call(owner, 'getAdminMetrics', {}, 'forbidden', 'owner is not admin');
await call(guest, 'placeOrder', { businessId: rest.id, branchId: restBranch.id, mode: 'pickup', cityId, lines: [line], idempotencyKey: K(), contactName: 'x', contactPhone: '0501112233', expectedCashDueAgorot: 9600, locale: 'he' }, 'unauthenticated');
await call(guest, 'authOptions', {});

// ---------------------------------------------------------------- printing
console.log('\n=== owner: printing ===');
const pr = await call(owner, 'savePrinter', { businessId: rest.id, branchId: restBranch.id, printer: { name: 'Sweep', profileId: 'os_print_dialog', transport: 'os_print_dialog', paperWidthMm: 58, printableDots: 384, receiptLocale: 'he', copies: 1, role: `sweep-${STAMP}`, autoPrint: 'off', cutSupported: false, feedLinesAfter: 3 } });
if (pr?.printer) {
  await call(owner, 'markPrinterVerified', { printerId: pr.printer.id, verified: true });
  const st = await call(owner, 'registerStation', { printerId: pr.printer.id, kind: 'web', label: 'Sweep station' });
  await call(owner, 'stationHeartbeat', { stationId: st.station.id });
  const job = await call(owner, 'enqueuePrint', { printerId: pr.printer.id, template: 'test', idempotencyKey: K() });
  const claimed = await call(owner, 'claimPrintJob', { stationId: st.station.id });
  if (claimed?.job) {
    await call(owner, 'reportPrintAttempt', { stationId: st.station.id, jobId: claimed.job.id, fence: claimed.fence, outcome: 'sent', attemptId: claimed.attemptId });
    await call(owner, 'resolvePrintJob', { jobId: claimed.job.id, resolution: 'confirmed' });
  }
  await call(owner, 'releaseStation', { stationId: st.station.id });
  await call(owner, 'deactivatePrinter', { printerId: pr.printer.id });
}

// ---------------------------------------------------------------- report
const failed = results.filter((r) => !r.pass);
console.log('\n================ SWEEP SUMMARY ================');
console.log(`calls: ${results.length}   distinct endpoints: ${new Set(results.map((r) => r.name)).size}   unexpected: ${failed.length}`);
if (failed.length) for (const f of failed) console.log(` ✗ ${f.name} as ${f.as}: expected ${f.expect}, got ${f.outcome}`);
console.log('\nCreated on ' + (LIVE ? 'LIVE' : 'emulator') + ':');
console.log(`  restaurant  ${rest.id} (branch ${restBranch.id})`);
console.log(`  supermarket ${mkt.id} (branch ${mktBranch.id})`);
console.log(`  principals  ${owner.uid}, ${customer.uid}`);
console.log('\nTo remove: delete those two businesses in the admin console and the two Auth users.');
process.exit(failed.length ? 1 : 0);
