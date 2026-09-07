import { useEffect, useState } from 'react';
import { PRINTER_PROFILES, buildTestReceipt, getProfile, isReceiptModel, type PrintJob, type PrintStation, type PrinterConfig, type ReceiptModel } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useCollection, where, orderBy, limit } from '@/lib/queries';
import { Button, Dialog, Select, TextInput, Checkbox, Alert, Badge, EmptyState, IconButton, toast, ConfirmDialog } from '@/design/components';
import { Icon } from '@/design/Icon';
import { call, newIdempotencyKey } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { formatLocalDateTime } from '@/lib/format';
import { PageTitle, useDash } from './shell';
import { bleSupport, connectBle, PrintTransportError } from '@/print/webBluetooth';
import { startStation, stopStation, stationStore, printSpecificJob } from '@/print/station';
import { renderModel, bitmapToDataUrl } from '@/print/renderer';
import { OsPrintTrigger } from '@/print/OsPrint';
import { useNow } from '@/customer/hooks';

export function ReceiptPreview({ model }: { model: ReceiptModel }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    renderModel(model).then((bmp) => alive && setUrl(bitmapToDataUrl(bmp))).catch(() => setUrl(null));
    return () => { alive = false; };
  }, [model]);
  return (
    <div className="stack--sm stack">
      <div className="print-preview">{url ? <img src={url} alt={t('printers.preview')} style={{ width: model.printableDots / 2 }} /> : <div className="skeleton" style={{ width: model.printableDots / 2, height: 400 }} />}</div>
      {model.labels.simulation ? <Badge tone="accent">{t('printers.simulation')}</Badge> : null}
      <p className="muted">{model.paperWidthMm}mm · {model.printableDots} dots · {model.locale}</p>
    </div>
  );
}

type Draft = Omit<PrinterConfig, 'id' | 'businessId' | 'branchId' | 'setupVerified' | 'active' | 'createdBy' | 'createdAt' | 'updatedAt'>;
const defaultDraft = (): Draft => ({ name: '', profileId: 'generic_escpos_ble_ff00', transport: 'web_bluetooth_ble', paperWidthMm: 58, printableDots: 384, receiptLocale: 'he', copies: 1, role: 'kitchen', autoPrint: 'off', cutSupported: false, feedLinesAfter: 3, deviceHint: undefined });

export function PrintersPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, branch, can } = useDash();
  const printers = useCollection<PrinterConfig>('printers', [where('businessId', '==', business.id), where('branchId', '==', branch.id), where('active', '==', true), limit(10)], [branch.id]);
  const stations = useCollection<PrintStation>('printStations', [where('businessId', '==', business.id), where('branchId', '==', branch.id), where('revoked', '==', false), limit(20)], [branch.id]);
  const jobs = useCollection<PrintJob>('printJobs', [where('businessId', '==', business.id), where('branchId', '==', branch.id), orderBy('requestedAt', 'desc'), limit(40)], [branch.id]);
  const station = stationStore.use();
  const [edit, setEdit] = useState<{ id?: string; d: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ReceiptModel | null>(null);
  const [osModel, setOsModel] = useState<ReceiptModel | null>(null);
  const [verifyFor, setVerifyFor] = useState<PrinterConfig | null>(null);
  const [selectedStale, setSelectedStale] = useState<string[]>([]);
  const [deactivate, setDeactivate] = useState<string | null>(null);
  const support = bleSupport();
  const now = useNow().getTime();
  const stale = jobs.data.filter((j) => j.state === 'queued' && now - Date.parse(j.requestedAt) > 10 * 60000);

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await call('savePrinter', { businessId: business.id, branchId: branch.id, printerId: edit.id, printer: { ...edit.d, deviceHint: edit.d.deviceHint || undefined } });
      toast(t('catalog.savedOk'));
      setEdit(null);
    } catch (e) {
      const issue = (e as { details?: { issues?: Array<{ message: string }> } }).details?.issues?.[0]?.message;
      toast(issue === 'another_printer_auto_prints_this_role' ? t('printers.roleHint') : t(errorKey(e)), 'danger');
    } finally {
      setSaving(false);
    }
  };
  const connect = async (p: PrinterConfig) => {
    stationStore.set({ status: 'connecting', lastError: null });
    try {
      const conn = await connectBle(p.profileId);
      conn.onDisconnect(() => stationStore.set({ status: 'error', lastError: 'connection_lost', connection: null, connectionName: null }));
      stationStore.set({ connection: conn, connectionName: conn.name, status: 'connected' });
      await startStation(p.id, `${navigator.platform || 'web'} · ${conn.name}`, false);
    } catch (e) {
      const kind = e instanceof PrintTransportError ? e.kind : (e as { details?: { issues?: Array<{ message: string; label?: string }> } }).details?.issues?.[0]?.message === 'another_station_active' ? 'another_station' : 'error';
      stationStore.set({ status: 'error', lastError: kind });
      if (kind === 'another_station') {
        const label = (e as { details?: { issues?: Array<{ label?: string }> } }).details?.issues?.[0]?.label ?? '';
        if (confirm(`${t('printers.stationOther', { label })}\n${t('printers.stationThis')}?`)) {
          await startStation(p.id, `${navigator.platform || 'web'}`, true).catch((err) => toast(t(errorKey(err)), 'danger'));
        }
      }
    }
  };
  const testPrint = async (p: PrinterConfig) => {
    try {
      await call('enqueuePrint', { printerId: p.id, template: 'test', idempotencyKey: newIdempotencyKey() });
      toast(t('printers.state.queued'));
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    }
  };
  const testModel = (p: PrinterConfig) => buildTestReceipt({ locale: p.receiptLocale, paperWidthMm: p.paperWidthMm, printableDots: p.printableDots, businessName: Object.values(business.name)[0] ?? 'Qareeb', branchPhone: branch.phone, simulation: true });
  const errText = (k: string | null) => k === 'permission_denied' ? t('printers.permissionDenied') : k === 'bluetooth_off' ? t('printers.bluetoothOff') : k === 'connection_lost' ? t('printers.connectionLost') : k === 'partial' ? t('printers.state.needs_review') : k === 'unsupported_profile' ? t('printers.unsupported') : k ? t('common.errorGeneric') : '';

  return (
    <div className="stack">
      <PageTitle title={t('printers.title')}>{can('printers_config') ? <Button size="sm" icon="plus" onClick={() => setEdit({ d: defaultDraft() })}>{t('printers.add')}</Button> : null}</PageTitle>
      <p className="muted">{t('printers.staffOnlyNote')} {t('printers.compat')}</p>
      {support !== 'ok' ? <Alert tone="info">{support === 'insecure' ? t('printers.insecure') : t('printers.unsupported')}</Alert> : null}
      {printers.data.length === 0 && !printers.loading ? <EmptyState icon="printer" title={t('printers.noPrinters')} /> : null}
      <div className="grid-cards">
        {printers.data.map((p) => {
          const profile = getProfile(p.profileId);
          const online = stations.data.filter((s) => s.printerId === p.id && s.online);
          const isMine = station.printerId === p.id && station.stationId;
          return (
            <section key={p.id} className="card stack" aria-labelledby={`pr-${p.id}`}>
              <div className="row row--between"><h2 id={`pr-${p.id}`}>{p.name}</h2>{p.setupVerified ? <Badge tone="success" icon="check">{t('printers.verified')}</Badge> : <Badge tone="accent">{t('printers.notVerified')}</Badge>}</div>
              <div className="muted">{t(`printers.transport.${p.transport}`)} · {p.paperWidthMm}mm · {p.printableDots} dots · {p.receiptLocale} · {t('printers.role')}: {p.role} · {t('printers.autoPrint')}: {t(`printers.auto.${p.autoPrint}`)}</div>
              <div className="muted">{profile?.label} {profile && !profile.verified ? <Badge tone="muted">{t('printers.profileCandidate')}</Badge> : null}</div>
              <div className="station-indicator" role="status">
                <span className={`status-dot ${isMine && station.connection ? 'status-dot--on' : online.length ? 'status-dot--on' : 'status-dot--off'}`} />
                {isMine ? (station.status === 'connecting' ? t('printers.connecting') : station.connection ? t('printers.connected', { name: station.connectionName ?? '' }) : t('printers.disconnected')) : online.length ? t('printers.stationOther', { label: online[0]!.label }) : t('printers.stationOffline')}
                {isMine && station.status === 'printing' && station.progress ? <span>· {t('printers.printing')} {station.progress.sent}/{station.progress.total}</span> : null}
              </div>
              {isMine && station.lastError ? <Alert tone="danger">{errText(station.lastError)}</Alert> : null}
              <div className="row">
                {p.transport === 'web_bluetooth_ble' ? (isMine && station.connection ? <Button size="sm" variant="secondary" icon="bluetooth" onClick={() => stopStation()}>{t('printers.disconnect')}</Button> : <Button size="sm" icon="bluetooth" disabled={support !== 'ok'} onClick={() => connect(p)}>{t('printers.connect')}</Button>) : null}
                {p.transport !== 'os_print_dialog' ? <Button size="sm" variant="secondary" icon="printer" onClick={() => testPrint(p)}>{t('printers.testPrint')}</Button> : null}
                <Button size="sm" variant="secondary" icon="eye" onClick={() => setPreview(testModel(p))}>{t('printers.preview')}</Button>
                {p.transport === 'os_print_dialog' ? <Button size="sm" variant="secondary" icon="download" onClick={() => setOsModel(testModel(p))}>{t('printers.testPrint')}</Button> : null}
                {can('printers_config') ? <Button size="sm" variant={p.setupVerified ? 'ghost' : 'primary'} icon="check" onClick={() => setVerifyFor(p)}>{t('printers.verifySetup')}</Button> : null}
                {can('printers_config') ? <IconButton icon="edit" label={t('printers.edit')} onClick={() => { const { id: _i, businessId: _b, branchId: _br, setupVerified: _s, active: _a, createdBy: _c, createdAt: _ca, updatedAt: _u, ...d } = p; setEdit({ id: p.id, d }); }} /> : null}
                {can('printers_config') ? <IconButton icon="trash" label={t('common.delete')} onClick={() => setDeactivate(p.id)} /> : null}
              </div>
              {p.transport === 'os_print_dialog' ? <p className="muted">{t('printers.osHint')}</p> : null}
              {p.transport === 'android_rfcomm' ? <p className="muted">{t('printers.transport.android_rfcomm')} — {t('printers.sendToStation')}</p> : null}
            </section>
          );
        })}
      </div>

      {stale.length > 0 ? (
        <section className="card stack">
          <h2>{t('printers.staleJobs')}</h2>
          <p className="muted">{t('printers.staleHint')}</p>
          {stale.map((j) => <Checkbox key={j.id} label={`${j.template} · ${j.orderId ?? 'test'} · ${formatLocalDateTime(j.requestedAt, locale)}`} checked={selectedStale.includes(j.id)} onChange={(e) => setSelectedStale(e.target.checked ? [...selectedStale, j.id] : selectedStale.filter((x) => x !== j.id))} />)}
          <div className="row">
            <Button size="sm" disabled={selectedStale.length === 0 || !station.connection} onClick={async () => { for (const id of selectedStale) await printSpecificJob(id); setSelectedStale([]); }}>{t('printers.printSelected')}</Button>
            <Button size="sm" variant="secondary" disabled={selectedStale.length === 0} onClick={async () => { for (const id of selectedStale) await call('resolvePrintJob', { jobId: id, resolution: 'cancelled', note: 'skipped stale' }).catch(() => undefined); setSelectedStale([]); }}>{t('printers.skipSelected')}</Button>
          </div>
        </section>
      ) : null}

      <section className="card stack">
        <h2>{t('printers.queue')}</h2>
        {jobs.data.length === 0 ? <p className="muted">{t('common.emptyGeneric')}</p> : null}
        {jobs.data.map((j) => (
          <div key={j.id} className="job-row">
            <Badge tone={j.state === 'confirmed' ? 'success' : j.state === 'needs_review' || j.state === 'failed_before_send' ? 'danger' : j.state === 'sending' ? 'accent' : 'neutral'}>{t(`printers.state.${j.state}`)}</Badge>
            <div className="list__grow">
              <div><strong>{j.template === 'test' ? t('receipt.testReceipt') : j.template === 'order_ticket' ? t('receipt.orderTicket') : t('receipt.customerCopy')}</strong>{j.orderId ? <span className="muted" dir="ltr"> · {j.orderId.slice(0, 8)}</span> : null}{j.isReprint ? <Badge tone="accent">{t('printers.copyLabel')}</Badge> : null}{isReceiptModel(j.receipt) && j.receipt.labels.revised ? <Badge tone="accent">{t('printers.revisedLabel')}</Badge> : null}</div>
              <div className="muted"><bdi>{formatLocalDateTime(j.requestedAt, locale)}</bdi> · {j.trigger} · {j.printerRole}{j.lastError ? ` · ${errText(j.lastError) || j.lastError}` : ''}{j.progress ? ` · ${j.progress.stripsSent}/${j.progress.stripsTotal}` : ''}</div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {isReceiptModel(j.receipt) ? <IconButton icon="eye" label={t('printers.preview')} onClick={() => setPreview(j.receipt as ReceiptModel)} /> : null}
              {j.state === 'sent_unconfirmed' || j.state === 'needs_review' ? <><Button size="sm" variant="secondary" onClick={() => call('resolvePrintJob', { jobId: j.id, resolution: 'confirmed' }).catch((e) => toast(t(errorKey(e)), 'danger'))}>{t('printers.confirmPrinted')}</Button><Button size="sm" variant="danger" onClick={() => call('resolvePrintJob', { jobId: j.id, resolution: 'cancelled', note: 'staff: did not print' }).catch((e) => toast(t(errorKey(e)), 'danger'))}>{t('printers.markFailed')}</Button></> : null}
              {j.state === 'needs_review' || j.state === 'failed_before_send' ? <Button size="sm" variant="secondary" icon="refresh" onClick={() => call('resolvePrintJob', { jobId: j.id, resolution: 'requeue' }).catch((e) => toast(t(errorKey(e)), 'danger'))}>{t('printers.retry')}</Button> : null}
              {j.state === 'queued' ? <Button size="sm" variant="ghost" onClick={() => call('resolvePrintJob', { jobId: j.id, resolution: 'cancelled' }).catch((e) => toast(t(errorKey(e)), 'danger'))}>{t('printers.cancelJob')}</Button> : null}
            </div>
          </div>
        ))}
      </section>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('printers.edit') : t('printers.add')} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button loading={saving} onClick={save}>{t('common.save')}</Button></>}>
        {edit ? (
          <div className="stack">
            <TextInput label={t('printers.name')} required value={edit.d.name} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, name: e.target.value } })} />
            <Select label={t('printers.transport')} value={edit.d.transport} onChange={(e) => { const transport = e.target.value as Draft['transport']; const prof = PRINTER_PROFILES.find((p) => p.transports.includes(transport))!; setEdit({ ...edit, d: { ...edit.d, transport, profileId: prof.id, printableDots: prof.defaultDots[edit.d.paperWidthMm] } }); }}>
              <option value="web_bluetooth_ble">{t('printers.transport.web_bluetooth_ble')}</option><option value="android_rfcomm">{t('printers.transport.android_rfcomm')}</option><option value="os_print_dialog">{t('printers.transport.os_print_dialog')}</option>
            </Select>
            <Select label={t('printers.profile')} value={edit.d.profileId} onChange={(e) => { const prof = getProfile(e.target.value)!; setEdit({ ...edit, d: { ...edit.d, profileId: prof.id, printableDots: prof.defaultDots[edit.d.paperWidthMm], cutSupported: edit.d.cutSupported && prof.cutSupported } }); }}>
              {PRINTER_PROFILES.filter((p) => p.transports.includes(edit.d.transport)).map((p) => <option key={p.id} value={p.id}>{p.label}{!p.verified ? ` (${t('printers.profileCandidate')})` : ''}</option>)}
            </Select>
            <p className="muted">{getProfile(edit.d.profileId)?.notes}</p>
            <div className="row">
              <Select label={t('printers.paper')} value={String(edit.d.paperWidthMm)} onChange={(e) => { const w = Number(e.target.value) as 58 | 80; setEdit({ ...edit, d: { ...edit.d, paperWidthMm: w, printableDots: getProfile(edit.d.profileId)?.defaultDots[w] ?? (w === 58 ? 384 : 576) } }); }}><option value="58">58mm</option><option value="80">80mm</option></Select>
              <TextInput label={t('printers.dots')} type="number" ltr min={200} max={832} value={edit.d.printableDots} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, printableDots: Number(e.target.value) } })} />
              <Select label={t('printers.language')} value={edit.d.receiptLocale} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, receiptLocale: e.target.value as 'he' } })}><option value="he">עברית</option><option value="ar">العربية</option><option value="en">English</option></Select>
              <TextInput label={t('printers.copies')} type="number" ltr min={1} max={3} value={edit.d.copies} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, copies: Number(e.target.value) } })} />
            </div>
            <TextInput label={t('printers.role')} required hint={t('printers.roleHint')} ltr value={edit.d.role} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, role: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') } })} />
            <Select label={t('printers.autoPrint')} hint={t('printers.autoHint')} value={edit.d.autoPrint} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, autoPrint: e.target.value as Draft['autoPrint'] } })}><option value="off">{t('printers.auto.off')}</option><option value="when_placed">{t('printers.auto.when_placed')}</option><option value="when_accepted">{t('printers.auto.when_accepted')}</option></Select>
            <div className="row"><Checkbox label={t('printers.cut')} checked={edit.d.cutSupported} disabled={!getProfile(edit.d.profileId)?.cutSupported} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, cutSupported: e.target.checked } })} /><TextInput label={t('printers.feed')} type="number" ltr min={0} max={10} value={edit.d.feedLinesAfter} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, feedLinesAfter: Number(e.target.value) } })} /></div>
            <TextInput label={t('printers.deviceHint')} optional ltr value={edit.d.deviceHint ?? ''} onChange={(e) => setEdit({ ...edit, d: { ...edit.d, deviceHint: e.target.value } })} />
          </div>
        ) : null}
      </Dialog>
      {preview ? <Dialog open onClose={() => setPreview(null)} title={t('printers.preview')}><ReceiptPreview model={preview} /></Dialog> : null}
      {osModel ? <OsPrintTrigger model={osModel} onDone={() => setOsModel(null)} /> : null}
      <ConfirmDialog open={!!verifyFor} onClose={() => setVerifyFor(null)} title={t('printers.verifySetup')} body={<div className="stack--sm stack"><p>{t('printers.verifyBody')}</p><Icon name="printer" size={32} /></div>} confirmLabel={t('printers.verified')} onConfirm={async () => { const p = verifyFor!; setVerifyFor(null); await call('markPrinterVerified', { printerId: p.id, verified: true }).catch((e) => toast(t(errorKey(e)), 'danger')); }} />
      <ConfirmDialog open={!!deactivate} onClose={() => setDeactivate(null)} danger title={t('common.delete')} confirmLabel={t('common.delete')} onConfirm={async () => { const id = deactivate!; setDeactivate(null); await call('deactivatePrinter', { printerId: id }).catch((e) => toast(t(errorKey(e)), 'danger')); }} />
    </div>
  );
}
