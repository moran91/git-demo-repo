import { isReceiptModel, type PrintJob } from '@qareeb/shared';
import { call } from '@/lib/api';
import { renderModel, encodeForProfile } from './renderer';
import { sendEncoded, PrintTransportError, type BleConnection } from './webBluetooth';
import { createStore } from '@/lib/store';

export interface StationState {
  stationId: string | null;
  printerId: string | null;
  connection: BleConnection | null;
  connectionName: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'printing' | 'error';
  lastError: string | null;
  currentJobId: string | null;
  progress: { sent: number; total: number } | null;
}

/** Per-tab in-memory station state (never persisted: a stored Bluetooth id grants nothing on another device). */
export const stationStore = createStore<StationState>('station', { stationId: null, printerId: null, connection: null, connectionName: null, status: 'idle', lastError: null, currentJobId: null, progress: null }, { persist: false });

let loopTimer: number | null = null;
let heartbeatTimer: number | null = null;
let inFlight = false;

export interface ClaimResult {
  job: PrintJob | null;
  fence?: number;
  attemptId?: string;
  printer?: { profileId: string; paperWidthMm: number; printableDots: number; cutSupported: boolean; feedLinesAfter: number };
}

/** Prints one claimed job over the active BLE connection and reports a truthful outcome. */
export async function executeJob(claim: ClaimResult, stationId: string): Promise<'sent' | 'failed' | 'partial'> {
  const job = claim.job!;
  const s = stationStore.get();
  const conn = s.connection;
  const report = (outcome: 'sent' | 'failed_before_send' | 'partial', extra: Record<string, unknown> = {}) =>
    call('reportPrintAttempt', { stationId, jobId: job.id, fence: claim.fence, attemptId: claim.attemptId, outcome, ...extra });
  if (!conn || !conn.device.gatt?.connected) {
    await report('failed_before_send', { error: 'printer_not_connected' });
    return 'failed';
  }
  if (!isReceiptModel(job.receipt)) {
    await report('failed_before_send', { error: 'invalid_receipt_model' });
    return 'failed';
  }
  stationStore.set({ status: 'printing', currentJobId: job.id, progress: null });
  // Tracks whether bytes actually reached the printer. Everything after this point has already put
  // paper through the machine, so it must never be reported as 'failed_before_send'.
  let bytesSent = false;
  try {
    const bmp = await renderModel(job.receipt);
    const enc = encodeForProfile(bmp, claim.printer!.profileId, claim.printer!.cutSupported, claim.printer!.feedLinesAfter);
    stationStore.set({ progress: { sent: 0, total: enc.stripsTotal } });
    await sendEncoded(conn, enc, (sent, total) => stationStore.set({ progress: { sent, total } }));
    bytesSent = true;
    await report('sent', { stripsSent: enc.stripsTotal, stripsTotal: enc.stripsTotal });
    stationStore.set({ status: 'connected', currentJobId: null, progress: null, lastError: null });
    return 'sent';
  } catch (e) {
    if (bytesSent) {
      // The receipt is on paper; only the report failed (network blip, stale fence). Reporting
      // 'failed_before_send' here would tell the server no bytes were sent and it would re-queue the
      // job — printing the same receipt twice. Leave it: the lease expires and the scheduled sweep
      // moves it to needs_review, which is exactly the "never auto-retransmit" rule.
      stationStore.set({ status: 'error', currentJobId: null, progress: null, lastError: 'report_failed' });
      return 'sent';
    }
    if (e instanceof PrintTransportError && e.kind === 'partial') {
      await report('partial', { error: e.kind, stripsSent: e.stripsSent, stripsTotal: e.stripsTotal });
      stationStore.set({ status: 'error', currentJobId: null, lastError: 'partial' });
      return 'partial';
    }
    const kind = e instanceof PrintTransportError ? e.kind : 'render_failed';
    await report('failed_before_send', { error: kind });
    stationStore.set({ status: 'error', currentJobId: null, lastError: kind });
    return 'failed';
  }
}

async function tick() {
  if (inFlight) return;
  const s = stationStore.get();
  if (!s.stationId || !s.connection) return;
  inFlight = true;
  try {
    const claim = await call<ClaimResult>('claimPrintJob', { stationId: s.stationId });
    if (claim.job) await executeJob(claim, s.stationId);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'forbidden' || code === 'not_found') stopStation(); // revoked or removed → stop processing
  } finally {
    inFlight = false;
  }
}

/** Registers this tab as the printer's station (takeOver optional) and starts the claim loop + heartbeat. */
export async function startStation(printerId: string, label: string, takeOver: boolean): Promise<void> {
  const r = await call<{ station: { id: string } }>('registerStation', { printerId, kind: 'web', label, takeOver, stationId: stationStore.get().stationId ?? undefined, appVersion: 'web' });
  stationStore.set({ stationId: r.station.id, printerId });
  if (loopTimer === null) loopTimer = window.setInterval(() => void tick(), 4000);
  if (heartbeatTimer === null) heartbeatTimer = window.setInterval(() => {
    const id = stationStore.get().stationId;
    if (id) call('stationHeartbeat', { stationId: id }).catch((e) => { if ((e as { code?: string }).code === 'forbidden') stopStation(); });
  }, 45000);
  void tick();
}

export function stopStation() {
  const id = stationStore.get().stationId;
  if (loopTimer !== null) { clearInterval(loopTimer); loopTimer = null; }
  if (heartbeatTimer !== null) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (id) call('releaseStation', { stationId: id }).catch(() => undefined);
  stationStore.get().connection?.disconnect();
  stationStore.set({ stationId: null, printerId: null, connection: null, connectionName: null, status: 'idle', currentJobId: null, progress: null });
}

/** Claims a specific (possibly stale) job on staff request. */
export async function printSpecificJob(jobId: string): Promise<'sent' | 'failed' | 'partial' | 'no_station'> {
  const s = stationStore.get();
  if (!s.stationId) return 'no_station';
  // Serialise with the 4s claim loop. Without this a staff-triggered print could run concurrently
  // with an automatic one and interleave two byte streams on the same BLE characteristic.
  for (let waited = 0; inFlight && waited < 30_000; waited += 250) await new Promise((r) => setTimeout(r, 250));
  if (inFlight) return 'failed';
  inFlight = true;
  try {
    const claim = await call<ClaimResult>('claimPrintJob', { stationId: s.stationId, jobId, includeStale: true });
    if (!claim.job) return 'failed';
    return await executeJob(claim, s.stationId);
  } finally {
    inFlight = false;
  }
}

window.addEventListener('beforeunload', () => {
  const id = stationStore.get().stationId;
  if (id) navigator.sendBeacon?.('/__noop', '');
});
