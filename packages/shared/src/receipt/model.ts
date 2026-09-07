import { formatILSPlain, formatGrams } from '../money.js';
import { formatLocalDateTime } from '../hours.js';
import { resolveLocalized, dirOf } from '../localize.js';
import { makeTranslator } from '../i18n/index.js';
import { formatPhoneDisplay } from '../phone.js';
import type { Locale, Order, PaperWidth, ReceiptTemplate } from '../types.js';

/**
 * Receipt model: a renderer-independent, immutable description of a receipt. It is stored on the
 * print job so that the browser renderer, the Android station and the test simulator all consume the
 * same validated content. No raw printer bytes are ever accepted from clients.
 */
export type ReceiptTextSize = 'sm' | 'md' | 'lg' | 'xl';
export type ReceiptAlign = 'start' | 'center' | 'end';
export type ReceiptDir = 'rtl' | 'ltr' | 'auto';

export type ReceiptBlock =
  | { kind: 'text'; text: string; size?: ReceiptTextSize; bold?: boolean; align?: ReceiptAlign; dir?: ReceiptDir }
  | { kind: 'row'; start: string; end: string; size?: ReceiptTextSize; bold?: boolean; endDir?: ReceiptDir }
  | { kind: 'rule'; style?: 'solid' | 'dashed' }
  | { kind: 'spacer'; px?: number }
  | { kind: 'box'; title?: string; lines: string[]; size?: ReceiptTextSize; bold?: boolean };

export interface ReceiptModel {
  version: 1;
  template: ReceiptTemplate;
  locale: Locale;
  dir: 'rtl' | 'ltr';
  paperWidthMm: PaperWidth;
  printableDots: number;
  /** Copy/revision labels are part of the snapshot so reprints are labelled on paper. */
  labels: { copy?: boolean; revised?: boolean; simulation?: boolean };
  orderId?: string;
  orderRevision?: number;
  blocks: ReceiptBlock[];
  generatedAt: string;
}

export interface BuildReceiptOptions {
  template: ReceiptTemplate;
  locale: Locale;
  paperWidthMm: PaperWidth;
  printableDots: number;
  isCopy?: boolean;
  isRevised?: boolean;
  simulation?: boolean;
  /** Set when a cash record exists; only then is "Cash received" printed. */
  cashReceivedAgorot?: number;
  now?: Date;
}

const MAX_BLOCKS = 400;

function lineNames(order: Order, locale: Locale) {
  return (l: Order['lines'][number]) => resolveLocalized(l.name, locale, order.customerLocale);
}

export function buildOrderReceipt(order: Order, opts: BuildReceiptOptions): ReceiptModel {
  const t = makeTranslator(opts.locale);
  const L = opts.locale;
  const blocks: ReceiptBlock[] = [];
  const name = lineNames(order, L);
  const isTicket = opts.template === 'order_ticket';

  blocks.push({ kind: 'text', text: resolveLocalized(order.businessName, L), size: 'lg', bold: true, align: 'center' });
  const branchName = resolveLocalized(order.branchName, L);
  if (branchName) blocks.push({ kind: 'text', text: branchName, size: 'md', align: 'center' });
  blocks.push({ kind: 'text', text: `${t('receipt.branchPhone')}: ${formatPhoneDisplay(order.branchPhone)}`, size: 'sm', align: 'center', dir: 'auto' });
  blocks.push({ kind: 'rule' });
  blocks.push({ kind: 'text', text: isTicket ? t('receipt.orderTicket') : t('receipt.customerCopy'), size: 'md', bold: true, align: 'center' });
  if (opts.isCopy) blocks.push({ kind: 'text', text: `*** ${t('receipt.copy')} ***`, size: 'md', bold: true, align: 'center' });
  if (opts.isRevised || order.revision > 0) blocks.push({ kind: 'text', text: `*** ${t('receipt.revised')} ***`, size: 'md', bold: true, align: 'center' });
  blocks.push({ kind: 'text', text: order.reference, size: 'xl', bold: true, align: 'center', dir: 'ltr' });
  blocks.push({ kind: 'text', text: order.mode === 'delivery' ? t('receipt.delivery') : t('receipt.pickup'), size: 'xl', bold: true, align: 'center' });

  const statusText =
    order.status === 'placed' ? t('receipt.awaitingAcceptance') : order.status === 'accepted' ? t('receipt.accepted') : t('receipt.rejected');
  blocks.push({ kind: 'text', text: statusText, size: order.status === 'rejected' ? 'lg' : 'md', bold: true, align: 'center' });
  blocks.push({ kind: 'row', start: t('receipt.placedAt'), end: formatLocalDateTime(order.placedAt, L), size: 'sm', endDir: 'ltr' });
  blocks.push({ kind: 'rule' });

  // Customer & address
  blocks.push({ kind: 'row', start: t('receipt.customer'), end: order.contactName, bold: true });
  blocks.push({ kind: 'row', start: t('receipt.phone'), end: formatPhoneDisplay(order.contactPhone), endDir: 'ltr' });
  if (order.mode === 'delivery' && order.address) {
    const a = order.address;
    blocks.push({ kind: 'spacer', px: 6 });
    blocks.push({ kind: 'box', title: t('receipt.houseDescription'), lines: [a.houseDescription], size: 'lg', bold: true });
    const cityName = resolveLocalized(a.cityName, L);
    const parts: string[] = [];
    if (a.recipientName && a.recipientName !== order.contactName) parts.push(a.recipientName);
    if (a.recipientPhone && a.recipientPhone !== order.contactPhone) parts.push(formatPhoneDisplay(a.recipientPhone));
    const cityLine = [cityName, a.neighborhood].filter(Boolean).join(' · ');
    if (cityLine) parts.push(cityLine);
    const streetLine = [a.street, a.buildingNumber].filter(Boolean).join(' ');
    if (streetLine) parts.push(streetLine);
    const aptLine = [a.apartment && `${t('address.apartment')} ${a.apartment}`, a.floor && `${t('address.floor')} ${a.floor}`, a.entrance && `${t('address.entrance')} ${a.entrance}`]
      .filter(Boolean)
      .join(', ');
    if (aptLine) parts.push(aptLine);
    for (const p of parts) blocks.push({ kind: 'text', text: p, size: 'md' });
    if (a.deliveryInstructions) blocks.push({ kind: 'text', text: `${t('receipt.instructions')}: ${a.deliveryInstructions}`, size: 'md' });
  }
  blocks.push({ kind: 'rule' });

  // Items
  blocks.push({ kind: 'text', text: t('receipt.items'), size: 'md', bold: true });
  for (const line of order.lines) {
    const label = line.removed ? `[${t('receipt.removed')}] ` : line.substitutedFromLineId ? `[${t('receipt.replacement')}] ` : '';
    let qtyText: string;
    if (line.pricingMode === 'weight') {
      const req = line.requestedGrams ?? 0;
      qtyText = line.actualGrams !== undefined ? `${t('receipt.actualWeight')} ${formatGrams(line.actualGrams, L)}` : `${t('receipt.requestedWeight')} ${formatGrams(req, L)}`;
    } else {
      qtyText = `${line.quantity} ×`;
    }
    const variant = line.variantName ? ` (${resolveLocalized(line.variantName, L)})` : '';
    blocks.push({ kind: 'row', start: `${label}${qtyText} ${name(line)}${variant}`, end: line.removed ? '' : formatILSPlain(line.lineTotalAgorot), size: 'md', bold: !line.removed, endDir: 'ltr' });
    for (const m of line.modifiers) {
      blocks.push({ kind: 'row', start: `  + ${resolveLocalized(m.optionName, L)}`, end: m.priceDeltaAgorot ? formatILSPlain(m.priceDeltaAgorot) : '', size: 'sm', endDir: 'ltr' });
    }
    if (line.pricingMode === 'weight' && line.actualGrams !== undefined && line.requestedGrams !== undefined) {
      blocks.push({ kind: 'text', text: `  ${t('receipt.requestedWeight')}: ${formatGrams(line.requestedGrams, L)}`, size: 'sm' });
    }
    if (line.note) blocks.push({ kind: 'text', text: `  ${t('receipt.note')}: ${line.note}`, size: 'sm', bold: true });
  }
  if (order.customerNote) {
    blocks.push({ kind: 'spacer', px: 4 });
    blocks.push({ kind: 'box', title: t('receipt.note'), lines: [order.customerNote], size: 'md' });
  }
  blocks.push({ kind: 'rule' });

  // Totals
  const tot = order.totals;
  blocks.push({ kind: 'row', start: t('receipt.subtotal'), end: formatILSPlain(tot.merchandiseSubtotalAgorot), endDir: 'ltr' });
  if (tot.loyaltyDiscountAgorot > 0) blocks.push({ kind: 'row', start: t('receipt.discount'), end: `-${formatILSPlain(tot.loyaltyDiscountAgorot)}`, endDir: 'ltr' });
  if (order.mode === 'delivery') blocks.push({ kind: 'row', start: t('receipt.deliveryFee'), end: formatILSPlain(tot.deliveryFeeAgorot), endDir: 'ltr' });
  blocks.push({ kind: 'row', start: tot.isEstimated ? t('receipt.estimatedTotal') : t('receipt.total'), end: formatILSPlain(tot.cashDueAgorot), size: 'lg', bold: true, endDir: 'ltr' });
  if (order.revision > 0 && order.originalTotals.cashDueAgorot !== tot.cashDueAgorot) {
    blocks.push({ kind: 'row', start: `${t('orders.original')} ${t('receipt.total')}`, end: formatILSPlain(order.originalTotals.cashDueAgorot), size: 'sm', endDir: 'ltr' });
  }
  if (order.status !== 'rejected') {
    if (opts.cashReceivedAgorot !== undefined) {
      blocks.push({ kind: 'row', start: t('receipt.cashReceived'), end: formatILSPlain(opts.cashReceivedAgorot), bold: true, endDir: 'ltr' });
    } else {
      blocks.push({ kind: 'text', text: order.mode === 'delivery' ? t('receipt.cashOnDelivery') : t('receipt.cashOnPickup'), size: 'md', bold: true, align: 'center' });
    }
  }
  blocks.push({ kind: 'rule', style: 'dashed' });
  blocks.push({ kind: 'text', text: t('receipt.notInvoice'), size: 'sm', align: 'center' });
  blocks.push({ kind: 'text', text: `${t('receipt.printedAt')}: ${formatLocalDateTime(opts.now ?? new Date(), L)}`, size: 'sm', align: 'center', dir: 'auto' });
  if (opts.simulation) blocks.push({ kind: 'text', text: 'SIMULATION', size: 'sm', bold: true, align: 'center' });

  return {
    version: 1,
    template: opts.template,
    locale: L,
    dir: dirOf(L),
    paperWidthMm: opts.paperWidthMm,
    printableDots: opts.printableDots,
    labels: { copy: !!opts.isCopy, revised: !!opts.isRevised || order.revision > 0, simulation: !!opts.simulation },
    orderId: order.id,
    orderRevision: order.revision,
    blocks: blocks.slice(0, MAX_BLOCKS),
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** Multilingual test receipt: Hebrew, Arabic, English, mixed-direction numbers, ₪, a long village address. */
export function buildTestReceipt(opts: Omit<BuildReceiptOptions, 'template'> & { businessName: string; branchPhone: string }): ReceiptModel {
  const t = makeTranslator(opts.locale);
  const he = makeTranslator('he');
  const ar = makeTranslator('ar');
  const en = makeTranslator('en');
  const blocks: ReceiptBlock[] = [
    { kind: 'text', text: opts.businessName, size: 'lg', bold: true, align: 'center' },
    { kind: 'text', text: t('receipt.testReceipt'), size: 'xl', bold: true, align: 'center' },
    { kind: 'rule' },
    { kind: 'text', text: he('receipt.testLine1'), size: 'md', dir: 'rtl' },
    { kind: 'text', text: ar('receipt.testLine1'), size: 'md', dir: 'rtl' },
    { kind: 'text', text: en('receipt.testLine1'), size: 'md', dir: 'ltr' },
    { kind: 'rule', style: 'dashed' },
    { kind: 'row', start: 'טלפון / هاتف / Phone', end: formatPhoneDisplay(opts.branchPhone || '+972501234567'), endDir: 'ltr' },
    { kind: 'row', start: '2 × שווארמה בלאפה', end: formatILSPlain(7000), endDir: 'ltr' },
    { kind: 'row', start: '1.250 كغ طماطم', end: formatILSPlain(1125), endDir: 'ltr' },
    { kind: 'row', start: '3 × Falafel plate', end: formatILSPlain(4500), endDir: 'ltr' },
    { kind: 'row', start: 'הזמנה Q-7K3M2 · 14:35', end: '₪126.25', bold: true, size: 'lg', endDir: 'ltr' },
    { kind: 'rule' },
    { kind: 'box', title: he('receipt.houseDescription'), lines: [he('receipt.testAddress')], size: 'lg', bold: true },
    { kind: 'box', title: ar('receipt.houseDescription'), lines: [ar('receipt.testAddress')], size: 'md' },
    { kind: 'box', title: en('receipt.houseDescription'), lines: [en('receipt.testAddress')], size: 'md' },
    { kind: 'rule', style: 'dashed' },
    { kind: 'text', text: `${opts.paperWidthMm}mm · ${opts.printableDots} dots · ${opts.locale}`, size: 'sm', align: 'center', dir: 'ltr' },
    { kind: 'text', text: t('receipt.notInvoice'), size: 'sm', align: 'center' },
  ];
  if (opts.simulation) blocks.push({ kind: 'text', text: 'SIMULATION', size: 'sm', bold: true, align: 'center' });
  return {
    version: 1,
    template: 'test',
    locale: opts.locale,
    dir: dirOf(opts.locale),
    paperWidthMm: opts.paperWidthMm,
    printableDots: opts.printableDots,
    labels: { simulation: !!opts.simulation },
    blocks,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** Minimal runtime validation of a receipt model coming from Firestore before rendering. */
export function isReceiptModel(v: unknown): v is ReceiptModel {
  if (!v || typeof v !== 'object') return false;
  const m = v as Partial<ReceiptModel>;
  return m.version === 1 && Array.isArray(m.blocks) && typeof m.printableDots === 'number' && (m.dir === 'rtl' || m.dir === 'ltr');
}
