import { useState } from 'react';
import { buildOrderReceipt, type Order, type PrinterConfig, type ReceiptModel } from '@qareeb/shared';
import { useT } from '@/lib/i18n';
import { useCollection, where, limit } from '@/lib/queries';
import { Button, Dialog, Select, TextInput, Alert, toast } from '@/design/components';
import { call, newIdempotencyKey, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useDash } from './shell';
import { OsPrintTrigger } from '@/print/OsPrint';
import { ReceiptPreview } from './PrintersPage';

/** Print order / Reprint: enqueues an authorised job for a branch printer, or uses the OS print dialog. */
export function PrintOrderButton({ order }: { order: Order }) {
  const t = useT();
  const { business, branch } = useDash();
  const printers = useCollection<PrinterConfig>('printers', [where('businessId', '==', business.id), where('branchId', '==', branch.id), where('active', '==', true), limit(10)], [branch.id]);
  const [open, setOpen] = useState(false);
  const [printerId, setPrinterId] = useState('');
  const [template, setTemplate] = useState<'order_ticket' | 'customer_copy'>('order_ticket');
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [osModel, setOsModel] = useState<ReceiptModel | null>(null);
  const [preview, setPreview] = useState<ReceiptModel | null>(null);
  const selected = printers.data.find((p) => p.id === printerId) ?? printers.data[0];
  const enqueue = async (reprint: boolean) => {
    if (!selected) return;
    setBusy(true);
    try {
      await call('enqueuePrint', { printerId: selected.id, orderId: order.id, template, reprint, reprintReason: reprint ? reason.trim() || undefined : undefined, idempotencyKey: newIdempotencyKey() });
      toast(selected.transport === 'android_rfcomm' ? t('printers.sendToStation') : t('printers.state.queued'));
      setOpen(false);
      setDup(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_copy') setDup(String(e.details.state ?? ''));
      else toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const localModel = (): ReceiptModel => buildOrderReceipt(order, { template, locale: selected?.receiptLocale ?? business.defaultLocale, paperWidthMm: selected?.paperWidthMm ?? 80, printableDots: selected?.printableDots ?? 576, isRevised: order.revision > 0 });
  return (
    <>
      <Button size="sm" variant="secondary" icon="printer" onClick={() => setOpen(true)}>{t('dash.printOrder')}</Button>
      <Dialog open={open} onClose={() => { setOpen(false); setDup(null); }} title={t('dash.printOrder')} sheet={false}>
        <div className="stack">
          <Select label={t('printers.title')} value={selected?.id ?? ''} onChange={(e) => setPrinterId(e.target.value)}>
            {printers.data.map((p) => <option key={p.id} value={p.id}>{p.name} · {t(`printers.transport.${p.transport}`)}</option>)}
            {printers.data.length === 0 ? <option value="">{t('printers.noPrinters')}</option> : null}
          </Select>
          <Select label={t('printers.profile')} value={template} onChange={(e) => setTemplate(e.target.value as 'order_ticket')}><option value="order_ticket">{t('receipt.orderTicket')}</option><option value="customer_copy">{t('receipt.customerCopy')}</option></Select>
          {dup ? (
            <Alert tone="warn">{t('printers.duplicateWarning')} ({t(`printers.state.${dup as 'queued'}`)})
              <div className="stack--sm stack" style={{ marginTop: 8 }}><TextInput label={t('printers.reprintReason')} value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" loading={busy} onClick={() => enqueue(true)}>{t('dash.reprint')}</Button></div>
            </Alert>
          ) : null}
          <div className="row">
            <Button loading={busy} disabled={!selected || selected.transport === 'os_print_dialog'} onClick={() => enqueue(false)} icon="printer">{selected?.transport === 'android_rfcomm' ? t('printers.sendToStation') : t('dash.printOrder')}</Button>
            <Button variant="secondary" icon="eye" onClick={() => setPreview(localModel())}>{t('printers.preview')}</Button>
            <Button variant="secondary" icon="download" onClick={() => setOsModel(localModel())}>{t('printers.transport.os_print_dialog')}</Button>
          </div>
          <p className="muted">{t('printers.osHint')}</p>
          {order.status === 'placed' ? <p className="muted">{t('receipt.awaitingAcceptance')} — {t('printers.autoHint')}</p> : null}
        </div>
      </Dialog>
      {osModel ? <OsPrintTrigger model={osModel} onDone={() => setOsModel(null)} /> : null}
      {preview ? <Dialog open onClose={() => setPreview(null)} title={t('printers.preview')}><ReceiptPreview model={preview} /></Dialog> : null}
    </>
  );
}
