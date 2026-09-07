import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  buildTestReceipt,
  claimPrintJobSchema,
  enqueuePrintSchema,
  getProfile,
  idSchema,
  printerConfigInputSchema,
  reportPrintSchema,
  resolveLocalized,
  type Branch,
  type Business,
  type CashRecord,
  type Order,
  type PrintAttempt,
  type PrintJob,
  type PrintStation,
  type PrinterConfig,
} from '@qareeb/shared';
import { REGION, col, db, nowIso } from '../lib/firebase.js';
import { handled, fail } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireCaller, requireMembership } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { createOrderPrintJob } from '../lib/printjobs.js';
import { enqueueEvent } from '../lib/outbox.js';

const opts = { region: REGION } as const;
const LEASE_MS = 90_000;
const STALE_MS = 10 * 60_000;
const MAX_AUTO_ATTEMPTS = 3;

/** Owners and assigned managers configure branch printers. Auto-print requires a verified setup. */
export const savePrinter = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ businessId: idSchema, branchId: idSchema, printerId: idSchema.optional(), printer: printerConfigInputSchema }).strict(), req.data);
  await requireMembership(c, input.businessId, ['owner', 'manager'], input.branchId);
  const profile = getProfile(input.printer.profileId);
  if (!profile) fail('invalid_argument', { issues: [{ path: 'profileId', message: 'unknown_profile' }] });
  if (!profile.transports.includes(input.printer.transport)) fail('invalid_argument', { issues: [{ path: 'transport', message: 'transport_not_supported_by_profile' }] });
  if (!profile.paperWidths.includes(input.printer.paperWidthMm)) fail('invalid_argument', { issues: [{ path: 'paperWidthMm', message: 'paper_not_supported' }] });
  if (input.printer.cutSupported && !profile.cutSupported) fail('invalid_argument', { issues: [{ path: 'cutSupported', message: 'profile_has_no_cut' }] });
  const ref = input.printerId ? col.printer(input.printerId) : col.printers().doc();
  const printer = await db.runTransaction(async (tx) => {
    const existing = input.printerId ? ((await tx.get(ref)).data() as PrinterConfig | undefined) : undefined;
    if (input.printerId && (!existing || existing.branchId !== input.branchId)) fail('not_found');
    const hardwareChanged = !existing || existing.profileId !== input.printer.profileId || existing.transport !== input.printer.transport || existing.paperWidthMm !== input.printer.paperWidthMm || existing.printableDots !== input.printer.printableDots;
    const setupVerified = hardwareChanged ? false : existing.setupVerified;
    if (input.printer.autoPrint !== 'off' && !setupVerified) fail('printer_setup_required');
    // One automatic station per role: other printers of the same role cannot also auto-print.
    if (input.printer.autoPrint !== 'off') {
      const same = await tx.get(col.printers().where('branchId', '==', input.branchId).where('role', '==', input.printer.role).where('active', '==', true));
      for (const d of same.docs) {
        if (d.id !== ref.id && (d.data() as PrinterConfig).autoPrint !== 'off') fail('invalid_argument', { issues: [{ path: 'autoPrint', message: 'another_printer_auto_prints_this_role', printerId: d.id }] });
      }
    }
    const now = nowIso();
    const doc: PrinterConfig = {
      id: ref.id,
      businessId: input.businessId,
      branchId: input.branchId,
      ...input.printer,
      setupVerified,
      active: true,
      createdBy: existing?.createdBy ?? c.uid,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(ref, doc);
    writeAudit(tx, { actorUid: c.uid, action: 'printer.save', targetType: 'printer', targetId: ref.id, before: existing, after: doc });
    return doc;
  });
  return { printer };
}));

export const deactivatePrinter = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { printerId } = parse(z.object({ printerId: idSchema }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(col.printer(printerId));
    if (!snap.exists) fail('not_found');
    const p = snap.data() as PrinterConfig;
    await requireMembership(c, p.businessId, ['owner', 'manager'], p.branchId, tx);
    tx.update(snap.ref, { active: false, autoPrint: 'off', updatedAt: nowIso() });
    const stations = await tx.get(col.printStations().where('printerId', '==', printerId).where('revoked', '==', false));
    for (const s of stations.docs) tx.update(s.ref, { revoked: true, online: false });
    writeAudit(tx, { actorUid: c.uid, action: 'printer.deactivate', targetType: 'printer', targetId: printerId });
  });
  return { ok: true };
}));

/** Staff confirm on paper that the multilingual test receipt printed correctly. */
export const markPrinterVerified = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { printerId, verified } = parse(z.object({ printerId: idSchema, verified: z.boolean() }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(col.printer(printerId));
    if (!snap.exists) fail('not_found');
    const p = snap.data() as PrinterConfig;
    await requireMembership(c, p.businessId, ['owner', 'manager'], p.branchId, tx);
    const patch: Partial<PrinterConfig> = { setupVerified: verified, updatedAt: nowIso() };
    if (!verified) patch.autoPrint = 'off';
    tx.update(snap.ref, patch);
    writeAudit(tx, { actorUid: c.uid, action: 'printer.verify', targetType: 'printer', targetId: printerId, after: { verified } });
  });
  return { ok: true };
}));

/** ---------- Stations ---------- */

export const registerStation = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ printerId: idSchema, kind: z.enum(['web', 'android']), label: z.string().trim().min(1).max(60), appVersion: z.string().max(40).optional(), takeOver: z.boolean().optional(), stationId: idSchema.optional() }).strict(), req.data);
  return db.runTransaction(async (tx) => {
    const pSnap = await tx.get(col.printer(input.printerId));
    if (!pSnap.exists) fail('not_found');
    const printer = pSnap.data() as PrinterConfig;
    if (!printer.active) fail('not_found');
    await requireMembership(c, printer.businessId, ['owner', 'manager', 'staff'], printer.branchId, tx);
    const now = Date.now();
    const others = await tx.get(col.printStations().where('printerId', '==', input.printerId).where('revoked', '==', false));
    const active = others.docs.map((d) => d.data() as PrintStation).find((s) => s.online && s.lastHeartbeatAt && now - Date.parse(s.lastHeartbeatAt) < LEASE_MS * 2 && s.id !== input.stationId);
    if (active && !input.takeOver) fail('invalid_argument', { issues: [{ path: 'station', message: 'another_station_active', stationId: active.id, label: active.label }] });
    const ref = input.stationId ? col.printStation(input.stationId) : col.printStations().doc();
    const existing = input.stationId ? ((await tx.get(ref)).data() as PrintStation | undefined) : undefined;
    if (input.stationId && (!existing || existing.uid !== c.uid || existing.printerId !== input.printerId)) fail('not_found');
    for (const d of others.docs) if (d.id !== input.stationId) tx.update(d.ref, { online: false });
    const station: PrintStation = {
      id: ref.id,
      businessId: printer.businessId,
      branchId: printer.branchId,
      printerId: printer.id,
      uid: c.uid,
      kind: input.kind,
      label: input.label,
      revoked: false,
      lastHeartbeatAt: nowIso(),
      online: true,
      appVersion: input.appVersion,
      createdAt: existing?.createdAt ?? nowIso(),
    };
    tx.set(ref, station);
    return { station };
  });
}));

export const stationHeartbeat = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { stationId } = parse(z.object({ stationId: idSchema }).strict(), req.data);
  const snap = await col.printStation(stationId).get();
  if (!snap.exists) fail('not_found');
  const s = snap.data() as PrintStation;
  if (s.uid !== c.uid) fail('forbidden');
  if (s.revoked) fail('forbidden', { reason: 'revoked' });
  // Authorization is re-verified on every heartbeat so a revoked member stops processing promptly.
  await requireMembership(c, s.businessId, ['owner', 'manager', 'staff'], s.branchId);
  await snap.ref.update({ lastHeartbeatAt: nowIso(), online: true });
  return { ok: true, revoked: false };
}));

export const releaseStation = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const { stationId } = parse(z.object({ stationId: idSchema }).strict(), req.data);
  const snap = await col.printStation(stationId).get();
  if (!snap.exists) return { ok: true };
  const s = snap.data() as PrintStation;
  if (s.uid !== c.uid) {
    await requireMembership(c, s.businessId, ['owner', 'manager'], s.branchId);
  }
  await snap.ref.update({ online: false, revoked: s.uid !== c.uid ? true : s.revoked });
  return { ok: true };
}));

/** ---------- Jobs ---------- */

export const enqueuePrint = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(enqueuePrintSchema, req.data);
  return db.runTransaction(async (tx) => {
    const idem = await tx.get(col.idempotency(c.uid, input.idempotencyKey));
    if (idem.exists) return { ...(idem.data()?.result as { jobId: string }), replay: true };
    const pSnap = await tx.get(col.printer(input.printerId));
    if (!pSnap.exists) fail('not_found', { entity: 'printer' });
    const printer = pSnap.data() as PrinterConfig;
    if (!printer.active) fail('not_found', { entity: 'printer' });
    await requireMembership(c, printer.businessId, ['owner', 'manager', 'staff'], printer.branchId, tx);
    const simulation = !!process.env.FUNCTIONS_EMULATOR;
    let job: PrintJob;
    if (input.template === 'test') {
      const [bSnap, brSnap] = await Promise.all([tx.get(col.business(printer.businessId)), tx.get(col.branch(printer.businessId, printer.branchId))]);
      const business = bSnap.data() as Business;
      const branch = brSnap.data() as Branch;
      const receipt = buildTestReceipt({ locale: printer.receiptLocale, paperWidthMm: printer.paperWidthMm, printableDots: printer.printableDots, businessName: resolveLocalized(business.name, printer.receiptLocale, business.defaultLocale), branchPhone: branch.phone, simulation });
      const ref = col.printJobs().doc();
      const now = nowIso();
      job = { id: ref.id, key: `test:${printer.id}:${now}`, businessId: printer.businessId, branchId: printer.branchId, printerId: printer.id, printerRole: printer.role, template: 'test', trigger: 'test', copyIndex: 0, isReprint: false, state: 'queued', requestedBy: c.uid, requestedAt: now, receipt, leaseFence: 0, attempts: 0, updatedAt: now };
      tx.set(ref, job);
    } else {
      if (!input.orderId) fail('invalid_argument', { issues: [{ path: 'orderId', message: 'required' }] });
      const oSnap = await tx.get(col.order(input.orderId));
      if (!oSnap.exists) fail('not_found', { entity: 'order' });
      const order = oSnap.data() as Order;
      if (order.branchId !== printer.branchId) fail('forbidden', { reason: 'branch' });
      // Coordinate first copies: a matching copy already queued/sent requires an explicit reprint.
      const existing = await tx.get(col.printJobs().where('orderId', '==', order.id).where('printerRole', '==', printer.role).where('template', '==', input.template).limit(20));
      const matching = existing.docs.map((d) => d.data() as PrintJob).filter((j) => j.orderRevision === order.revision && !['failed_before_send', 'cancelled'].includes(j.state));
      if (matching.length > 0 && !input.reprint) fail('duplicate_copy', { jobId: matching[0]!.id, state: matching[0]!.state });
      let cashReceived: number | undefined;
      if (order.cashRecordId) {
        const cash = (await tx.get(col.cashRecords().doc(order.cashRecordId))).data() as CashRecord | undefined;
        if (cash && !cash.reversed) cashReceived = cash.amountAgorot;
      }
      job = createOrderPrintJob(tx, { order, printer, trigger: 'manual', template: input.template, requestedBy: c.uid, copyIndex: 0, isReprint: !!input.reprint, reprintReason: input.reprintReason, cashReceivedAgorot: cashReceived, simulation });
      const ev = { id: col.orderEvents(order.id).doc().id, orderId: order.id, type: 'printed' as const, actorUid: c.uid, actorRole: 'staff' as const, at: nowIso(), reason: input.reprint ? `reprint: ${input.reprintReason ?? ''}` : undefined, version: order.version, after: { jobId: job.id } };
      tx.set(col.orderEvents(order.id).doc(ev.id), ev);
    }
    tx.set(col.idempotency(c.uid, input.idempotencyKey), { uid: c.uid, key: input.idempotencyKey, kind: 'enqueuePrint', result: { jobId: job.id }, createdAt: nowIso() });
    return { jobId: job.id, replay: false };
  });
}));

/**
 * Station claims the next queued job (or a specific one) with a lease and a monotonically increasing
 * fence. Stale workers (older fence) are rejected when they report. Only recent jobs are auto-claimed;
 * a backlog older than STALE_MS is left for staff to select explicitly.
 */
export const claimPrintJob = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(claimPrintJobSchema, req.data);
  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(col.printStation(input.stationId));
    if (!sSnap.exists) fail('not_found', { entity: 'station' });
    const station = sSnap.data() as PrintStation;
    if (station.uid !== c.uid || station.revoked) fail('forbidden', { reason: 'station' });
    await requireMembership(c, station.businessId, ['owner', 'manager', 'staff'], station.branchId, tx);
    const pSnap = await tx.get(col.printer(station.printerId));
    const printer = pSnap.data() as PrinterConfig | undefined;
    if (!printer?.active) fail('not_found', { entity: 'printer' });
    let candidate: PrintJob | undefined;
    if (input.jobId) {
      const j = (await tx.get(col.printJob(input.jobId))).data() as PrintJob | undefined;
      if (!j || j.printerId !== printer.id) fail('not_found', { entity: 'job' });
      if (j.state !== 'queued') fail('invalid_argument', { issues: [{ path: 'jobId', message: 'not_queued', state: j.state }] });
      candidate = j;
    } else {
      const q = await tx.get(col.printJobs().where('printerId', '==', printer.id).where('state', '==', 'queued').orderBy('requestedAt').limit(10));
      const now = Date.now();
      for (const d of q.docs) {
        const j = d.data() as PrintJob;
        if (input.includeStale || now - Date.parse(j.requestedAt) <= STALE_MS) {
          candidate = j;
          break;
        }
      }
    }
    tx.update(sSnap.ref, { lastHeartbeatAt: nowIso(), online: true });
    if (!candidate) return { job: null };
    const fence = candidate.leaseFence + 1;
    const now = nowIso();
    const patch: Partial<PrintJob> = { state: 'sending', leaseStationId: station.id, leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString(), leaseFence: fence, attempts: candidate.attempts + 1, updatedAt: now };
    tx.update(col.printJob(candidate.id), patch);
    const attempt: PrintAttempt = { id: col.printAttempts(candidate.id).doc().id, jobId: candidate.id, stationId: station.id, fence, startedAt: now, outcome: 'failed_before_send' };
    // The attempt record is created in 'failed_before_send' and finalised by reportPrintAttempt; a crash
    // before the report therefore leaves a truthful record.
    tx.set(col.printAttempts(candidate.id).doc(attempt.id), { ...attempt, pending: true });
    return { job: { ...candidate, ...patch }, fence, attemptId: attempt.id, printer: { profileId: printer.profileId, paperWidthMm: printer.paperWidthMm, printableDots: printer.printableDots, cutSupported: printer.cutSupported, feedLinesAfter: printer.feedLinesAfter } };
  });
}));

export const reportPrintAttempt = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(reportPrintSchema.extend({ attemptId: idSchema.optional() }), req.data);
  return db.runTransaction(async (tx) => {
    const sSnap = await tx.get(col.printStation(input.stationId));
    const station = sSnap.data() as PrintStation | undefined;
    if (!station || station.uid !== c.uid) fail('forbidden', { reason: 'station' });
    const jRef = col.printJob(input.jobId);
    const job = (await tx.get(jRef)).data() as PrintJob | undefined;
    if (!job) fail('not_found');
    // Fence check: a stale worker (crashed and restarted, or superseded) cannot mutate the job.
    if (job.leaseStationId !== station.id || job.leaseFence !== input.fence) fail('version_conflict', { reason: 'stale_fence', fence: job.leaseFence });
    const now = nowIso();
    let state: PrintJob['state'];
    switch (input.outcome) {
      case 'sent':
        state = 'sent_unconfirmed';
        break;
      case 'confirmed_by_printer':
      case 'confirmed_by_staff':
        state = 'confirmed';
        break;
      case 'partial':
        state = 'needs_review';
        break;
      case 'failed_before_send':
      default:
        // Safe to retry: no bytes reached the printer. Cap automatic retries.
        state = job.attempts >= MAX_AUTO_ATTEMPTS ? 'needs_review' : 'queued';
    }
    const patch: Partial<PrintJob> = { state, updatedAt: now, lastError: input.error, progress: input.stripsTotal !== undefined ? { stripsTotal: input.stripsTotal, stripsSent: input.stripsSent ?? 0 } : job.progress };
    patch.leaseStationId = undefined;
    patch.leaseExpiresAt = undefined;
    tx.set(jRef, patch, { merge: true });
    const attemptRef = input.attemptId ? col.printAttempts(job.id).doc(input.attemptId) : col.printAttempts(job.id).doc();
    tx.set(attemptRef, { id: attemptRef.id, jobId: job.id, stationId: station.id, fence: input.fence, startedAt: now, finishedAt: now, outcome: input.outcome, error: input.error, stripsSent: input.stripsSent, stripsTotal: input.stripsTotal, pending: false } satisfies PrintAttempt & { pending: boolean }, { merge: true });
    if (state === 'needs_review') {
      enqueueEvent(tx, { kind: 'print_needs_review', audience: { businessId: job.businessId, branchId: job.branchId }, params: {}, link: `/business/${job.businessId}/${job.branchId}/printers`, businessId: job.businessId, branchId: job.branchId, key: `print_review:${job.id}:${job.attempts}` });
    }
    return { state };
  });
}));

/** Staff resolve ambiguous jobs: confirm on paper, cancel, or requeue for an intentional retry. */
export const resolvePrintJob = onCall(opts, handled(async (req: CallableRequest<unknown>) => {
  const c = await requireCaller(req);
  const input = parse(z.object({ jobId: idSchema, resolution: z.enum(['confirmed', 'cancelled', 'requeue']), note: z.string().max(200).optional() }).strict(), req.data);
  await db.runTransaction(async (tx) => {
    const ref = col.printJob(input.jobId);
    const job = (await tx.get(ref)).data() as PrintJob | undefined;
    if (!job) fail('not_found');
    await requireMembership(c, job.businessId, ['owner', 'manager', 'staff'], job.branchId, tx);
    if (job.state === 'sending' && input.resolution === 'requeue') fail('invalid_argument', { issues: [{ path: 'resolution', message: 'job_is_sending' }] });
    const now = nowIso();
    const state: PrintJob['state'] = input.resolution === 'requeue' ? 'queued' : input.resolution;
    tx.set(ref, { state, updatedAt: now, leaseStationId: undefined, leaseExpiresAt: undefined, lastError: input.note ?? job.lastError }, { merge: true });
    const aRef = col.printAttempts(job.id).doc();
    tx.set(aRef, { id: aRef.id, jobId: job.id, stationId: 'staff', fence: job.leaseFence, startedAt: now, finishedAt: now, outcome: input.resolution === 'confirmed' ? 'confirmed_by_staff' : 'failed_before_send', error: input.note ?? `staff:${input.resolution}`, pending: false });
  });
  return { ok: true };
}));

/** Scheduled sweep: expired leases → needs_review (never auto-retransmit ambiguous jobs); silent stations → offline. */
export async function sweepPrintLeases(): Promise<{ expired: number; offline: number }> {
  const now = Date.now();
  const nowIsoStr = new Date(now).toISOString();
  const sending = await col.printJobs().where('state', '==', 'sending').where('leaseExpiresAt', '<', nowIsoStr).limit(100).get();
  let expired = 0;
  for (const d of sending.docs) {
    await db.runTransaction(async (tx) => {
      const j = (await tx.get(d.ref)).data() as PrintJob;
      if (j.state !== 'sending' || !j.leaseExpiresAt || j.leaseExpiresAt >= nowIsoStr) return;
      tx.set(d.ref, { state: 'needs_review', lastError: 'lease_expired', updatedAt: nowIsoStr, leaseStationId: undefined, leaseExpiresAt: undefined }, { merge: true });
      enqueueEvent(tx, { kind: 'print_needs_review', audience: { businessId: j.businessId, branchId: j.branchId }, params: {}, link: `/business/${j.businessId}/${j.branchId}/printers`, businessId: j.businessId, branchId: j.branchId, key: `print_review:${j.id}:lease:${j.leaseFence}` });
      expired++;
    });
  }
  const stations = await col.printStations().where('online', '==', true).where('lastHeartbeatAt', '<', new Date(now - LEASE_MS * 2).toISOString()).limit(200).get();
  let offline = 0;
  for (const d of stations.docs) {
    await d.ref.update({ online: false });
    offline++;
  }
  return { expired, offline };
}
