import { buildOrderReceipt, type Order, type PrintJob, type PrintTrigger, type PrinterConfig, type ReceiptTemplate } from '@qareeb/shared';
import { col, nowIso, type Tx } from './firebase.js';

/**
 * Creates a print job with an immutable receipt snapshot. Automatic jobs use a deterministic key so
 * duplicate triggers (retries, concurrent decisions) collapse into a single job document.
 */
export function makeJobKey(orderId: string, revision: number, trigger: PrintTrigger, printerRole: string, template: ReceiptTemplate, copyIndex: number): string {
  return `${orderId}:${revision}:${trigger}:${printerRole}:${template}:${copyIndex}`;
}

export function jobDocId(key: string): string {
  return key.replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 500);
}

export function createOrderPrintJob(
  tx: Tx,
  params: {
    order: Order;
    printer: PrinterConfig;
    trigger: PrintTrigger;
    template: ReceiptTemplate;
    requestedBy: string;
    copyIndex: number;
    isReprint: boolean;
    reprintReason?: string;
    cashReceivedAgorot?: number;
    simulation?: boolean;
  },
): PrintJob {
  const { order, printer } = params;
  const key = params.isReprint
    ? `${order.id}:${order.revision}:manual:${printer.role}:${params.template}:reprint:${nowIso()}:${Math.random().toString(36).slice(2, 8)}`
    : makeJobKey(order.id, order.revision, params.trigger, printer.role, params.template, params.copyIndex);
  const receipt = buildOrderReceipt(order, {
    template: params.template,
    locale: printer.receiptLocale,
    paperWidthMm: printer.paperWidthMm,
    printableDots: printer.printableDots,
    isCopy: params.isReprint || params.copyIndex > 0,
    isRevised: order.revision > 0,
    cashReceivedAgorot: params.cashReceivedAgorot,
    simulation: params.simulation,
  });
  const ref = col.printJob(jobDocId(key));
  const now = nowIso();
  const job: PrintJob = {
    id: ref.id,
    key,
    businessId: order.businessId,
    branchId: order.branchId,
    printerId: printer.id,
    printerRole: printer.role,
    orderId: order.id,
    orderRevision: order.revision,
    template: params.template,
    trigger: params.trigger,
    copyIndex: params.copyIndex,
    isReprint: params.isReprint,
    reprintReason: params.reprintReason,
    state: 'queued',
    requestedBy: params.requestedBy,
    requestedAt: now,
    receipt,
    leaseFence: 0,
    attempts: 0,
    updatedAt: now,
  };
  tx.set(ref, job, { merge: false });
  return job;
}

/** Enqueues automatic first copies for every verified, active printer of the branch configured for this trigger. */
export function enqueueAutoPrintJobs(tx: Tx, order: Order, trigger: 'auto_placed' | 'auto_accepted', printers: PrinterConfig[]): number {
  const wanted = trigger === 'auto_placed' ? 'when_placed' : 'when_accepted';
  let n = 0;
  for (const p of printers) {
    if (!p.active || !p.setupVerified || p.autoPrint !== wanted) continue;
    for (let i = 0; i < Math.max(1, p.copies); i++) {
      createOrderPrintJob(tx, { order, printer: p, trigger, template: 'order_ticket', requestedBy: 'system', copyIndex: i, isReprint: false });
      n++;
    }
  }
  return n;
}
