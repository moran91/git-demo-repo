import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { EMPTY_WEEK, LOYALTY_BOUNDS, branchInputSchema, normalizeIsraeliPhone, toLocal, hasAnyTranslation, hhmmToMinutes, makeId, minutesToHHMM, type Branch, type BusinessType, type CashRecord, type DeliveryCityRule, type HoursOverride, type LoyaltyLedgerEntry, type OpeningInterval, type WeeklyHours } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, useDoc, orderBy, where, limit } from '@/lib/queries';
import { Button, TextInput, TextArea, Select, Checkbox, Alert, IconButton, Badge, EmptyState, toast, ConfirmDialog, Dialog, Segmented, Skeleton } from '@/design/components';
import { Icon, type IconName } from '@/design/Icon';
import { LocationPicker } from '@/design/LocationPicker';
import { money, formatLocalDateTime } from '@/lib/format';
import { call, newIdempotencyKey } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload } from '@/lib/images';
import { useCities } from '@/customer/hooks';
import { StorageImage } from '@/customer/StorageImage';
import { PageTitle, useDash } from './shell';
import { LocalizedInput } from './LocalizedInput';
import { useAuth } from '@/lib/auth';
import { FormError, LoadError, SaveBar, useDraftSafety } from './BusinessExperience';
import { refLabel } from './OrderCard';
import './settings.css';

/* ---------- shared Design-A building blocks (also used by Deals / Printers / QR) ---------- */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}><span className="switch__thumb" aria-hidden="true" /></button>;
}

export function SwitchRow({ icon, title, sub, checked, onChange, disabled }: { icon?: IconName; title: string; sub?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <li className="sx-row">
      {icon ? <span className="sx-row__icon"><Icon name={icon} size={22} /></span> : null}
      <div className="sx-row__text"><span className="sx-row__title">{title}</span>{sub ? <span className="sx-row__sub">{sub}</span> : null}</div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </li>
  );
}

/** Ledger row: label (and an optional sub line) at the inline start, value at the inline end in tabular numerals. */
/** Order number for a cash record; records written before the reference was stored read it from the order. */
function CashRef({ record }: { record: CashRecord }) {
  return record.reference ? <bdi>{refLabel(record.reference)}</bdi> : <OrderRef orderId={record.orderId} />;
}

function OrderRef({ orderId }: { orderId: string }) {
  const order = useDoc<{ reference: string }>(`orders/${orderId}`);
  return <bdi>{order.data ? refLabel(order.data.reference) : '…'}</bdi>;
}

export function KvRow({ label, sub, value, valueSub, tone, as, href, total }: { label: ReactNode; sub?: ReactNode; value: ReactNode; valueSub?: ReactNode; tone?: 'lg'; as?: 'li' | 'div'; href?: string; total?: boolean }) {
  const cls = `kv__row ${total ? 'kv__row--total' : ''}`;
  const body = <><div className="kv__label"><span>{label}</span>{sub ? <span className="kv__sub">{sub}</span> : null}</div><div className={`kv__value ${tone === 'lg' ? 'kv__value--lg' : ''}`}><span>{value}</span>{valueSub ? <span className="muted">{valueSub}</span> : null}</div></>;
  if (href) return <li><Link to={href} className={cls}>{body}</Link></li>;
  const Tag = as ?? 'li';
  return <Tag className={cls}>{body}</Tag>;
}

export function DetailsCard({ summary, count, open, onToggle, children, card }: { summary: string; count?: number; open?: boolean; onToggle?: (open: boolean) => void; children: ReactNode; card?: boolean }) {
  return (
    <details className={`sx-details ${card ? 'sx-details--card' : ''}`} open={open} onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}>
      <summary><span>{summary}{count ? ` · ${count}` : ''}</span><Icon name="chevronDown" size={22} /></summary>
      <div className="sx-details__body">{children}</div>
    </details>
  );
}

/* ---------- Branch settings ---------- */

type BranchDraft = { name: Branch['name']; cityId: string; locationDescription: Branch['locationDescription']; lat?: number; lng?: number; phone: string; hours: WeeklyHours; hoursOverrides: HoursOverride[]; pickupEnabled: boolean; dineInEnabled: boolean; deliveryEnabled: boolean; deliveryCities: DeliveryCityRule[] };

function draftFromBranch(b?: Branch, cityId = 'beit-jann'): BranchDraft {
  if (!b) return { name: {}, cityId, locationDescription: {}, phone: '', hours: { ...EMPTY_WEEK }, hoursOverrides: [], pickupEnabled: true, dineInEnabled: true, deliveryEnabled: false, deliveryCities: [] };
  return { name: b.name, cityId: b.cityId, locationDescription: b.locationDescription, lat: b.lat, lng: b.lng, phone: b.phone, hours: b.hours, hoursOverrides: b.hoursOverrides, pickupEnabled: b.pickupEnabled, dineInEnabled: b.dineInEnabled !== false, deliveryEnabled: b.deliveryEnabled, deliveryCities: b.deliveryCities };
}

const DAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;
const DEFAULT_INTERVAL: OpeningInterval = { startMin: 540, endMin: 1320 };

export function BranchForm({ initial, onSave, saving, businessType }: { initial: BranchDraft; onSave: (d: BranchDraft) => Promise<boolean | string>; saving: boolean; businessType?: BusinessType }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { cities, error: cityError, loading: citiesLoading } = useCities();
  const navigate = useNavigate();
  const [d, setD] = useState(initial);
  const [copyDay, setCopyDay] = useState<keyof WeeklyHours | null>(null);
  const [overridesOpen, setOverridesOpen] = useState(initial.hoursOverrides.length > 0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const safety = useDraftSafety(d);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<BranchDraft>) => setD((s) => ({ ...s, ...p }));
  const setInterval_ = (day: keyof WeeklyHours, i: number, patch: Partial<OpeningInterval>) => set({ hours: { ...d.hours, [day]: d.hours[day].map((iv, j) => (j === i ? { ...iv, ...patch } : iv)) } });
  const timeInput = (day: keyof WeeklyHours, i: number, key: 'startMin' | 'endMin') => (
    <input type="time" className="input" aria-label={key === 'startMin' ? t('branch.from') : t('branch.to')} value={minutesToHHMM(d.hours[day][i]![key])} onChange={(e) => { const m = hhmmToMinutes(e.target.value); if (m === null) return; if (key === 'endMin') { const start = d.hours[day][i]!.startMin; setInterval_(day, i, { endMin: m <= start ? m + 1440 : m }); } else setInterval_(day, i, { startMin: m, endMin: d.hours[day][i]!.endMin % 1440 <= m ? d.hours[day][i]!.endMin % 1440 + 1440 : d.hours[day][i]!.endMin % 1440 }); }} />
  );
  const cityName = (id: string) => { const c = cities.find((x) => x.id === id); return c ? L(c.name) : id; };
  return (
    <form className="sx-page" onSubmit={async (e) => {
      e.preventDefault();
      if (saving) return;
      setError(null);
      if (!hasAnyTranslation(d.name)) return setError(t('validation.atLeastOneLanguage'));
      if (!normalizeIsraeliPhone(d.phone)) return setError(t('validation.phone'));
      if (d.deliveryEnabled && d.deliveryCities.length === 0) { setAdvancedOpen(true); return setError(t('owner.deliveryAreaRequired')); }
      const overlapping = (intervals: OpeningInterval[]) => {
        const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin);
        return sorted.some((iv, i) => i > 0 && iv.startMin < sorted[i - 1]!.endMin);
      };
      const overridesBad = d.hoursOverrides.some((o) => !o.date || overlapping(o.intervals)) || new Set(d.hoursOverrides.map((o) => o.date)).size !== d.hoursOverrides.length;
      if (overridesBad) setOverridesOpen(true);
      if (Object.values(d.hours).some(overlapping) || overridesBad) return setError(t('owner.hoursError'));
      const next = d;
      if (!branchInputSchema.safeParse(next).success) return setError(t('owner.hoursError'));
      const result = await onSave(next);
      if (result) { safety.markSaved(d); if (typeof result === 'string') navigate(result); }
    }}>
      <FormError message={error} />
      {cityError ? <LoadError /> : null}
      <fieldset className="sx-page form-fields" disabled={saving}>
        <section className="sx-card" aria-labelledby="bs-identity">
          <h2 className="sx-card__title" id="bs-identity">{t('branch.identity')}</h2>
          <div className="sx-fields">
            <LocalizedInput label={t('branch.nameLabel')} value={d.name} required onChange={(name) => set({ name })} />
            <TextInput label={t('branch.phone')} required ltr inputMode="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
            <LocationPicker label={t('business.location')} value={d.lat !== undefined && d.lng !== undefined ? { lat: d.lat, lng: d.lng } : undefined} center={(() => { const city = cities.find((c) => c.id === d.cityId); return city?.lat !== undefined && city.lng !== undefined ? { lat: city.lat, lng: city.lng } : undefined; })()} onChange={(point) => set({ lat: point?.lat, lng: point?.lng })} />
          </div>
        </section>

        <section className="sx-card sx-card--tight" aria-labelledby="bs-fulfillment">
          <h2 className="sx-card__title" id="bs-fulfillment">{t('branch.fulfillment')}</h2>
          <ul className="sx-rows">
            <SwitchRow icon="truck" title={t('branch.delivery')} checked={d.deliveryEnabled} sub={d.deliveryEnabled ? (d.deliveryCities.length ? d.deliveryCities.map((r) => `${cityName(r.cityId)} · ${money(r.feeAgorot, locale)}`).join(' · ') : t('owner.deliveryAreaRequired')) : undefined} onChange={(on) => set({ deliveryEnabled: on, deliveryCities: on && d.deliveryCities.length === 0 ? [{ cityId: d.cityId, feeAgorot: 0, minSubtotalAgorot: 0 }] : d.deliveryCities })} />
            <SwitchRow icon="bag" title={t('branch.pickup')} checked={d.pickupEnabled} onChange={(on) => set({ pickupEnabled: on })} />
            {businessType === 'restaurant' ? <SwitchRow icon="chair" title={t('common.dineIn')} checked={d.dineInEnabled} onChange={(on) => set({ dineInEnabled: on })} /> : null}
          </ul>
        </section>

        <section className="sx-card sx-card--tight sx-hours" aria-labelledby="bs-hours">
          <div className="sx-card__head"><h2 className="sx-card__title" id="bs-hours">{t('dash.hours')}</h2></div>
          <p className="sx-card__sub" style={{ marginBottom: 8 }}>{t('branch.overnightHint')}</p>
          <div className="hours-list">
            {DAYS.map((day, dayIndex) => {
              const open = d.hours[day].length > 0;
              const dayName = t(`branch.day.${day}`);
              return (
                <div key={day} className={`hours-day ${open ? 'hours-day--open' : ''}`}>
                  <div className="hours-day__head">
                    <span className="hours-day__name">{dayName}</span>
                    <span className="hours-day__state">{open ? t('common.open') : t('common.closed')}</span>
                    <Switch checked={open} label={t('hours.dayOpen', { day: dayName })} onChange={(on) => set({ hours: { ...d.hours, [day]: on ? [{ ...DEFAULT_INTERVAL }] : [] } })} />
                  </div>
                  {open ? (
                    <div className="hours-day__body">
                      {d.hours[day].map((iv, i) => (
                        <div key={i} className="hours-day__interval"><div className="interval">{timeInput(day, i, 'startMin')}<span>–</span>{timeInput(day, i, 'endMin')}<IconButton icon="x" label={t('common.remove')} onClick={() => set({ hours: { ...d.hours, [day]: d.hours[day].filter((_, j) => j !== i) } })} /></div>{iv.endMin >= 1440 ? <p className="field__hint">{t('owner.overnight')}</p> : null}</div>
                      ))}
                      <div className="hours-day__actions">
                        <Button size="sm" variant="ghost" icon="plus" disabled={d.hours[day].length >= 4} onClick={() => set({ hours: { ...d.hours, [day]: [...d.hours[day], { ...DEFAULT_INTERVAL }] } })}>{t('branch.addInterval')}</Button>
                        {dayIndex === 0 ? <Button size="sm" variant="ghost" icon="copy" onClick={() => setCopyDay(day)}>{t('owner.copyHours')}</Button> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <DetailsCard summary={t('branch.specialDates')} count={d.hoursOverrides.length} open={overridesOpen} onToggle={setOverridesOpen}>
            {d.hoursOverrides.map((o, i) => (
              <div key={i} className="edit-row">
                <div className="edit-row__main">
                  <input type="date" className="input" aria-label={t('common.date')} value={o.date} onChange={(e) => set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                  <Checkbox label={t('branch.closedAllDay')} checked={o.intervals.length === 0} onChange={(e) => set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, intervals: e.target.checked ? [] : [{ ...DEFAULT_INTERVAL }] } : x)) })} />
                  {o.intervals.map((iv, intervalIndex) => <div key={intervalIndex} className="stack stack--sm"><div className="interval interval--pair">{(['startMin', 'endMin'] as const).map((part, partIndex) => <span key={part} style={{ display: 'contents' }}>{partIndex ? <span>–</span> : null}<input type="time" className="input" aria-label={t(part === 'startMin' ? 'branch.from' : 'branch.to')} value={minutesToHHMM(iv[part])} onChange={(e) => {
                    const m = hhmmToMinutes(e.target.value); if (m === null) return;
                    const start = part === 'startMin' ? m : iv.startMin;
                    const end = part === 'endMin' ? m : iv.endMin % 1440;
                    set({ hoursOverrides: d.hoursOverrides.map((x, j) => j === i ? { ...x, intervals: x.intervals.map((v, k) => k === intervalIndex ? { startMin: start, endMin: end <= start ? end + 1440 : end } : v) } : x) });
                  }} /></span>)}</div>{iv.endMin >= 1440 ? <p className="field__hint">{t('owner.overnight')}</p> : null}</div>)}
                </div>
                <div className="edit-row__foot"><IconButton icon="trash" label={t('common.remove')} onClick={() => set({ hoursOverrides: d.hoursOverrides.filter((_, j) => j !== i) })} /></div>
              </div>
            ))}
            <div><Button size="sm" variant="ghost" icon="plus" onClick={() => set({ hoursOverrides: [...d.hoursOverrides, { date: toLocal(new Date()).date, intervals: [] }] })}>{t('branch.addOverride')}</Button></div>
          </DetailsCard>
        </section>

        <section className="sx-card sx-card--tight" aria-label={t('settings.advanced')}>
          <DetailsCard card summary={`${t('settings.advanced')} · ${t('settings.advancedBranch')}`} open={advancedOpen} onToggle={setAdvancedOpen}>
            <div className="sx-fields">
              <Select label={t('branch.city')} value={d.cityId} onChange={(e) => set({ cityId: e.target.value })}>{cities.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
              <LocalizedInput label={t('branch.location')} value={d.locationDescription} onChange={(locationDescription) => set({ locationDescription })} />
            </div>
            <h3 className="sx-card__title">{t('dash.deliveryAreas')}</h3>
            {d.deliveryEnabled ? (
              <>
                <p className="sx-card__sub">{t('branch.minHint')}</p>
                {d.deliveryCities.map((r, i) => (
                  <div key={r.cityId} className="edit-row">
                    <div className="edit-row__main sx-fields">
                      <Select label={t('address.city')} value={r.cityId} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, cityId: e.target.value } : x)) })}>{cities.filter((c) => c.id === r.cityId || !d.deliveryCities.some((x) => x.cityId === c.id)).map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
                      <TextInput label={`${t('branch.fee')} (₪)`} type="number" ltr min={0} step="0.01" value={(r.feeAgorot / 100).toString()} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, feeAgorot: Math.round(Number(e.target.value) * 100) } : x)) })} />
                      <TextInput label={`${t('branch.minSubtotal')} (₪)`} type="number" ltr min={0} step="0.01" value={(r.minSubtotalAgorot / 100).toString()} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, minSubtotalAgorot: Math.round(Number(e.target.value) * 100) } : x)) })} />
                    </div>
                    <div className="edit-row__foot">
                      <span className="sx-num"><bdi>{money(r.feeAgorot, locale)}</bdi> · <bdi>{money(r.minSubtotalAgorot, locale)}</bdi></span>
                      <IconButton icon="trash" label={t('common.remove')} onClick={() => set({ deliveryCities: d.deliveryCities.filter((_, j) => j !== i) })} />
                    </div>
                  </div>
                ))}
                <div><Button size="sm" variant="ghost" icon="plus" disabled={!cities.some((c) => !d.deliveryCities.some((r) => r.cityId === c.id))} onClick={() => { const next = cities.find((c) => !d.deliveryCities.some((x) => x.cityId === c.id)); if (next) set({ deliveryCities: [...d.deliveryCities, { cityId: next.id, feeAgorot: 1000, minSubtotalAgorot: 5000 }] }); }}>{t('branch.addCity')}</Button></div>
              </>
            ) : null}
          </DetailsCard>
        </section>
      </fieldset>
      <SaveBar dirty={safety.dirty} savedOnce={safety.savedOnce} saving={saving} disabled={citiesLoading || !!cityError} onDiscard={() => { setD(safety.lastSaved); setError(null); }} />
      <ConfirmDialog open={copyDay !== null} onClose={() => setCopyDay(null)} title={t('owner.copyHours')} body={t('owner.copyHoursBody')} confirmLabel={t('common.confirm')} onConfirm={() => { if (copyDay !== null) set({ hours: Object.fromEntries(Object.keys(d.hours).map((day) => [day, d.hours[copyDay].map((iv) => ({ ...iv }))])) as WeeklyHours }); setCopyDay(null); }} />
    </form>
  );
}

function ApprovalBadge({ state }: { state: Branch['approval'] }) {
  const t = useT();
  return <Badge tone={state === 'approved' ? 'success' : state === 'pending' ? 'accent' : 'danger'} icon={state === 'approved' ? 'check' : undefined}>{t(`admin.state.${state}`)}</Badge>;
}

export function BranchSettingsPage() {
  const t = useT();
  const { business, branch, can } = useDash();
  const [saving, setSaving] = useState(false);
  if (!can('settings')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="sx-page">
      <PageTitle title={t('dash.branchSettings')}><ApprovalBadge state={branch.approval} /></PageTitle>
      {branch.approval === 'pending' ? <Alert tone="info">{t('branch.approvalPending')}</Alert> : branch.approval === 'rejected' ? <Alert tone="danger">{t('branch.approvalRejected', { reason: branch.approvalReason ?? '' })}</Alert> : branch.approval === 'suspended' ? <Alert tone="danger">{t('branch.approvalSuspended', { reason: branch.approvalReason ?? '' })}</Alert> : null}
      <BranchForm key={branch.id} initial={draftFromBranch(branch)} businessType={business.type} saving={saving} onSave={async (d) => { setSaving(true); try { await call('updateBranch', { businessId: business.id, branchId: branch.id, branch: d }); toast(t('catalog.savedOk')); return true; } catch (e) { toast(t(errorKey(e)), 'danger'); return false; } finally { setSaving(false); } }} />
    </div>
  );
}

export function NewBranchPage() {
  const t = useT();
  const { businessId } = useParams();
  const [saving, setSaving] = useState(false);
  const { user, loading, memberships, isAdmin } = useAuth();
  // Right after createBusiness the owner membership snapshot can lag the redirect here by a moment.
  const [grace, setGrace] = useState(true);
  useEffect(() => { const id = setTimeout(() => setGrace(false), 5000); return () => clearTimeout(id); }, []);
  const owner = isAdmin || memberships.some((m) => m.businessId === businessId && m.role === 'owner');
  if (loading || (!owner && grace)) return <Skeleton height={220} />;
  if (!user?.email) return <Navigate to="/business/signin" replace />;
  if (!user.emailVerified) return <Navigate to="/business/verify-email" replace />;
  if (!owner) return <main className="page"><EmptyState title={t('error.forbidden')} /></main>;
  return (
    <main className="page stack" style={{ maxWidth: 900 }}>
      <Link to={`/business/${businessId}`}>{t('common.back')}</Link><h1>{t('branch.new')}</h1>
      <BranchForm initial={draftFromBranch()} saving={saving} onSave={async (d) => { setSaving(true); try { const r = await call<{ branch: Branch }>('createBranch', { businessId, branch: d }); toast(t('catalog.savedOk')); return `/business/${businessId}/${r.branch.id}/branch`; } catch (e) { toast(t(errorKey(e)), 'danger'); return false; } finally { setSaving(false); } }} />
    </main>
  );
}

/* ---------- Business profile ---------- */

export function BusinessProfilePage() {
  const t = useT();
  const { L } = useI18n();
  const { business, branches, can, role } = useDash();
  const [d, setD] = useState({ type: business.type, name: business.name, description: business.description, defaultLocale: business.defaultLocale, publicPhone: business.publicPhone ?? '', publicEmail: business.publicEmail ?? '' });
  const [saving, setSaving] = useState(false);
  const safety = useDraftSafety(d);
  const history = useCollection<{ id: string; targetType: string; branchId?: string; state: string; reason: string; at: string }>((role === 'owner' || role === 'admin') ? `businesses/${business.id}/approvalHistory` : null, [orderBy('at', 'desc'), limit(20)], [business.id]);
  const { locale } = useI18n();
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const upload = async (kind: 'logo' | 'cover', file: File) => {
    setUploading(kind);
    try {
      const image = await prepareImageUpload(file);
      const path = `businesses/${business.id}/${kind}-${makeId(8)}.${image.ext}`;
      await uploadBytes(sref(storage, path), image.blob, { contentType: image.contentType });
      await recordUpload(path, () => call('setBusinessImage', { businessId: business.id, kind, path }));
      toast(t('catalog.savedOk'));
    } catch (e) {
      toast(t(uploadErrorKey(e)), 'danger');
    } finally {
      setUploading(null);
    }
  };
  if (!can('settings')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  const owner = role === 'owner' || role === 'admin';
  return (
    <div className="sx-page">
      <PageTitle title={t('dash.business')}><ApprovalBadge state={business.approval} /></PageTitle>
      {business.approval === 'pending' ? <Alert tone="info">{t('bizProfile.approvalPending')}</Alert> : business.approval === 'rejected' ? <Alert tone="danger">{t('bizProfile.approvalRejected', { reason: business.approvalReason ?? '' })}</Alert> : business.approval === 'suspended' ? <Alert tone="danger">{t('bizProfile.approvalSuspended', { reason: business.approvalReason ?? '' })}</Alert> : null}
      <section className="sx-card" aria-labelledby="bp-photos">
        <h2 className="sx-card__title" id="bp-photos">{t('catalog.photo')}</h2>
        <div className="sx-fields">
          {(['logo', 'cover'] as const).map((kind) => (
            <div key={kind} className={`sx-photo sx-photo--${kind}`}>
              <span className="field__label">{t(kind === 'logo' ? 'bizProfile.logo' : 'bizProfile.cover')}</span>
              <StorageImage path={kind === 'logo' ? business.logoPath : business.coverPath} size={kind === 'logo' ? 'thumb' : 'display'} alt="" square={kind === 'logo'} wide={kind === 'cover'} fallbackLabel={t('discovery.imageFallback')} />
              <label className={`btn btn--secondary ${uploading ? 'is-busy' : ''}`} aria-busy={uploading === kind || undefined}><Icon name="image" size={18} /> {uploading === kind ? t('catalog.photoUploading') : t('catalog.uploadPhoto')}<input type="file" className="visually-hidden" accept={UPLOAD_ACCEPT} disabled={!!uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(kind, f); e.target.value = ''; }} /></label>
            </div>
          ))}
        </div>
      </section>
      {owner ? (
        <form className="sx-page" onSubmit={async (e) => { e.preventDefault(); if (!hasAnyTranslation(d.name)) return toast(t('validation.atLeastOneLanguage'), 'danger'); setSaving(true); try { await call('updateBusiness', { businessId: business.id, business: { ...d } }); safety.markSaved(); toast(t('catalog.savedOk')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
          <section className="sx-card" aria-labelledby="bp-details">
            <h2 className="sx-card__title" id="bp-details">{t('bizProfile.details')}</h2>
            <div className="sx-fields">
              <Segmented label={t('bizProfile.type')} value={d.type} onChange={(type) => setD({ ...d, type })} options={[{ value: 'restaurant', label: t('common.restaurant'), icon: 'utensils' }, { value: 'supermarket', label: t('common.supermarket'), icon: 'basket' }]} />
              <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => setD({ ...d, name })} />
              <LocalizedInput label={t('business.about')} value={d.description} multiline onChange={(description) => setD({ ...d, description })} />
              <Select label={t('bizProfile.defaultLocale')} value={d.defaultLocale} onChange={(e) => setD({ ...d, defaultLocale: e.target.value as typeof d.defaultLocale })}><option value="he">עברית</option><option value="ar">العربية</option><option value="en">English</option></Select>
              <TextInput label={t('bizProfile.publicPhone')} optional ltr inputMode="tel" value={d.publicPhone} onChange={(e) => setD({ ...d, publicPhone: e.target.value })} />
              <TextInput label={t('bizProfile.publicEmail')} optional ltr type="email" value={d.publicEmail} onChange={(e) => setD({ ...d, publicEmail: e.target.value })} />
            </div>
          </section>
          <SaveBar dirty={safety.dirty} savedOnce={safety.savedOnce} saving={saving} onDiscard={() => setD(safety.lastSaved)} />
        </form>
      ) : null}
      {/* Managers reach this page (they have `settings`) but firestore.rules keeps approvalHistory to
          owners and admins, so the section was always empty for them — and the query errored. */}
      {owner ? (
        <section className="sx-card sx-card--tight" aria-labelledby="bp-history">
          <h2 className="sx-card__title" id="bp-history">{t('bizProfile.history')}</h2>
          {history.data.length === 0 ? <p className="sx-card__sub">{t('common.emptyGeneric')}</p> : (
            <ul className="kv">
              {history.data.map((h) => <KvRow key={h.id} label={<span className="row kv__history"><Badge tone={h.state === 'approved' ? 'success' : h.state === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${h.state as 'pending'}`)}</Badge><span className="kv__target">{h.targetType === 'branch' ? `${t('dash.branchSettings')} · ${L(branches.find((b) => b.id === h.branchId)?.name ?? {}, business.defaultLocale) || h.branchId?.slice(0, 8) || ''}` : L(business.name, business.defaultLocale) || t('dash.business')}</span></span>} sub={h.reason} value={<bdi>{formatLocalDateTime(h.at, locale)}</bdi>} />)}
            </ul>
          )}
        </section>
      ) : null}
      <p className="muted">{L(business.name, business.defaultLocale)}</p>
    </div>
  );
}

/* ---------- Staff ---------- */

type Member = { uid: string; role: string; allBranches: boolean; branchIds: string[]; active: boolean; displayName: string; email: string };

export function StaffPage() {
  const t = useT();
  const { L } = useI18n();
  const { business, branches, can } = useDash();
  const [data, setData] = useState<{ members: Member[]; invitations: Array<{ id: string; email: string; role: string }> } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'staff'>('staff');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [all, setAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Member | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const load = () => call<typeof data>('listMembers', { businessId: business.id }).then(setData).catch((e) => toast(t(errorKey(e)), 'danger'));
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!can('staff')) return;
    let alive = true;
    call<typeof data>('listMembers', { businessId: business.id }).then((result) => { if (alive) setData(result); }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [business.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('staff')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  const roleTone = (r: string) => (r === 'owner' ? 'primary' : r === 'manager' ? 'accent' : 'neutral');
  const scopeOf = (m: Member) => (m.allBranches ? t('staff.allBranches') : m.branchIds.map((id) => L(branches.find((b) => b.id === id)?.name ?? {}, business.defaultLocale)).join(', '));
  return (
    <div className="sx-page">
      <PageTitle title={t('staff.title')} />
      <p className="sx-card__sub">{t('staff.roleHelp')}</p>
      <section className="sx-card sx-card--tight" aria-labelledby="st-members">
        <h2 className="sx-card__title" id="st-members">{t('dash.staff')}</h2>
        {loadError ? <LoadError /> : !data ? <Skeleton height={80} /> : data.members.length === 0 && data.invitations.length === 0 ? <p className="sx-card__sub">{t('staff.empty')}</p> : (
          <ul className="sx-rows">
            {data.members.map((m) => (
              <li key={m.uid} className="sx-row">
                <div className="sx-row__text">
                  <span className="sx-row__title">{m.displayName || m.email}</span>
                  <span className="sx-row__sub"><span dir="ltr"><bdi>{m.email}</bdi></span> · {scopeOf(m)}</span>
                </div>
                <div className="sx-row__end">
                  <Badge tone={roleTone(m.role)}>{t(`staff.role.${m.role as 'owner'}`)}</Badge>
                  {!m.active ? <Badge tone="muted">{t('common.disabled')}</Badge> : null}
                  {m.role !== 'owner' ? <IconButton icon="more" label={`${t('common.more')}: ${m.displayName || m.email}`} onClick={() => setMenuFor(m)} /> : null}
                </div>
              </li>
            ))}
            {data.invitations.map((i) => (
              <li key={i.id} className="sx-row">
                <div className="sx-row__text"><span className="sx-row__title" dir="ltr"><bdi>{i.email}</bdi></span><span className="sx-row__sub">{t(`staff.role.${i.role as 'staff'}`)}</span></div>
                <div className="sx-row__end"><Badge tone="accent">{t('staff.pending')}</Badge></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form className="sx-card" aria-labelledby="st-invite" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await call<{ mode: string; link?: string }>('inviteMember', { businessId: business.id, email: email.trim(), role, allBranches: all, branchIds: all ? [] : branchIds }); toast(t('staff.invited')); setLink(r.link ?? null); setEmail(''); await load(); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setBusy(false); } }}>
        <h2 className="sx-card__title" id="st-invite">{t('staff.invite')}</h2>
        <div className="sx-fields">
          <TextInput label={t('common.email')} type="email" required ltr value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select label={t('staff.role')} value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'staff')}><option value="staff">{t('staff.role.staff')}</option><option value="manager">{t('staff.role.manager')}</option></Select>
        </div>
        <ul className="sx-rows">
          <SwitchRow icon="building" title={t('staff.allBranches')} checked={all} onChange={setAll} />
        </ul>
        {!all ? <div className="sx-fields">{branches.map((b) => <Checkbox key={b.id} label={L(b.name, business.defaultLocale)} checked={branchIds.includes(b.id)} onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))} />)}</div> : null}
        <Button type="submit" block loading={busy} disabled={!all && branchIds.length === 0}>{t('staff.invite')}</Button>
        {link ? <Alert tone="info"><a className="sx-invite-link" href={link} dir="ltr">{link}</a></Alert> : null}
      </form>
      <Dialog open={!!menuFor} onClose={() => setMenuFor(null)} title={t('staff.memberActions')}>
        {menuFor ? (
          <div className="stack">
            <ul className="kv kv--flush">
              <KvRow label={t('common.name')} value={menuFor.displayName || '—'} />
              <KvRow label={t('common.email')} value={<span dir="ltr"><bdi>{menuFor.email}</bdi></span>} />
              <KvRow label={t('staff.role')} value={t(`staff.role.${menuFor.role as 'owner'}`)} />
              <KvRow label={t('staff.branches')} value={scopeOf(menuFor)} />
            </ul>
            <div className="sx-actions">
              {menuFor.active ? <Button variant="danger" icon="trash" onClick={() => { setRemoving(menuFor.uid); setMenuFor(null); }}>{t('staff.remove')}</Button> : null}
              {!menuFor.active ? <Button variant="secondary" icon="check" onClick={async () => { const uid = menuFor.uid; setMenuFor(null); await call('updateMembership', { businessId: business.id, uid, active: true }).catch((e) => toast(t(errorKey(e)), 'danger')); await load(); }}>{t('common.enable')}</Button> : null}
            </div>
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger title={t('staff.remove')} body={t('staff.removeConfirm')} confirmLabel={t('staff.remove')} onConfirm={async () => { const uid = removing!; setRemoving(null); await call('updateMembership', { businessId: business.id, uid, active: false }).catch((e) => toast(t(errorKey(e)), 'danger')); await load(); }} />
    </div>
  );
}

/* ---------- Loyalty ---------- */

export function LoyaltySettingsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, can, role } = useDash();
  const [r, setR] = useState({ enabled: business.loyalty.enabled, earnPerAgorot: business.loyalty.earnPerAgorot, pointsPerStep: business.loyalty.pointsPerStep, redeemValueAgorot: business.loyalty.redeemValueAgorot, maxDiscountPercent: business.loyalty.maxDiscountPercent });
  const [saving, setSaving] = useState(false);
  const safety = useDraftSafety(r);
  const ledger = useCollection<LoyaltyLedgerEntry>(can('financials') ? 'loyaltyLedger' : null, [where('businessId', '==', business.id), orderBy('at', 'desc'), limit(50)], [business.id]);
  if (!can('financials')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div className="sx-page">
      <PageTitle title={t('loyaltySettings.title')} />
      <Alert tone="info">{t('loyaltySettings.help')}</Alert>
      {role === 'owner' || role === 'admin' ? (
        <form className="sx-page" onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { await call('setLoyaltyRules', { businessId: business.id, rules: r }); safety.markSaved(); toast(t('catalog.savedOk')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
          <section className="sx-card" aria-labelledby="ly-rules">
            <h2 className="sx-card__title" id="ly-rules">{t('loyaltySettings.title')}</h2>
            <ul className="sx-rows"><SwitchRow icon="star" title={t('loyaltySettings.enable')} checked={r.enabled} onChange={(enabled) => setR({ ...r, enabled })} /></ul>
            <div className="sx-fields">
              <TextInput label={`${t('loyaltySettings.earnStep')} (₪)`} type="number" ltr min={LOYALTY_BOUNDS.earnPerAgorot.min / 100} max={LOYALTY_BOUNDS.earnPerAgorot.max / 100} value={(r.earnPerAgorot / 100).toString()} onChange={(e) => setR({ ...r, earnPerAgorot: Math.round(Number(e.target.value) * 100) })} />
              <TextInput label={t('loyaltySettings.pointsPerStep')} type="number" ltr min={1} max={100} value={r.pointsPerStep} onChange={(e) => setR({ ...r, pointsPerStep: Number(e.target.value) })} />
              <TextInput label={`${t('loyaltySettings.redeemValue')} (₪)`} type="number" ltr min={LOYALTY_BOUNDS.redeemValueAgorot.min / 100} max={LOYALTY_BOUNDS.redeemValueAgorot.max / 100} step="0.01" value={(r.redeemValueAgorot / 100).toString()} onChange={(e) => setR({ ...r, redeemValueAgorot: Math.round(Number(e.target.value) * 100) })} />
              <TextInput label={t('loyaltySettings.maxPercent')} type="number" ltr min={0} max={50} value={r.maxDiscountPercent} onChange={(e) => setR({ ...r, maxDiscountPercent: Number(e.target.value) })} />
            </div>
            <p className="sx-card__sub">{t('loyaltySettings.earn', { points: r.pointsPerStep, amount: money(r.earnPerAgorot, locale) })} · {t('loyaltySettings.version', { version: business.loyalty.version })}</p>
          </section>
          <SaveBar dirty={safety.dirty} savedOnce={safety.savedOnce} saving={saving} onDiscard={() => setR(safety.lastSaved)} />
        </form>
      ) : null}
      <section className="sx-card sx-card--tight" aria-labelledby="ly-history">
        <h2 className="sx-card__title" id="ly-history">{t('loyaltySettings.history')}</h2>
        {ledger.error ? <LoadError /> : ledger.loading ? <Skeleton height={120} /> : !ledger.data.length ? <p className="sx-card__sub">{t('common.emptyGeneric')}</p> : (
          <ul className="kv">
            {ledger.data.map((e) => (
              <KvRow key={e.id} label={<>{t(`loyalty.entry.${e.type}`)}{e.orderId ? <span className="muted"> · <OrderRef orderId={e.orderId} /></span> : null}</>} sub={<><bdi>{formatLocalDateTime(e.at, locale)}</bdi> · <span dir="ltr">{e.uid.slice(0, 8)}…</span>{e.reason ? ` · ${e.reason}` : ''}</>} value={<span className="sx-num">{e.points ? signed(e.points) : `(${signed(e.reservedDelta ?? 0)})`}</span>} valueSub={t('admin.points')} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------- Cash records ---------- */

export function CashRecordsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, branch, can, role } = useDash();
  const records = useCollection<CashRecord>(can('financials') ? 'cashRecords' : null, [where('businessId', '==', business.id), where('branchId', '==', branch.id), orderBy('recordedAt', 'desc'), limit(100)], [branch.id]);
  const [reverse, setReverse] = useState<CashRecord | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!can('financials')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  const owner = (role === 'owner' || role === 'admin') && can('reverse_cash');
  const live = records.data.filter((r) => !r.reversed);
  const total = live.reduce((s, r) => s + r.amountAgorot, 0);
  return (
    <div className="sx-page">
      <PageTitle title={t('dash.cash')} />
      <div className="sx-metrics">
        <div className="sx-metric"><span className="sx-metric__value"><bdi>{money(total, locale)}</bdi></span><span className="sx-metric__label">{t('admin.metrics.cashRecorded')}</span></div>
        <div className="sx-metric"><span className="sx-metric__value">{live.length}</span><span className="sx-metric__label">{t('dash.cash')}</span></div>
      </div>
      <p className="sx-card__sub">{t('admin.metrics.note')} {t('owner.cashScope', { count: records.data.length })}</p>
      {records.error ? <LoadError /> : records.loading ? <Skeleton height={160} /> : records.data.length === 0 ? <EmptyState icon="wallet" title={t('common.emptyGeneric')} /> : (
        <section className="sx-card sx-card--tight" aria-label={t('dash.cash')}>
          <ul className="kv kv--flush">
            {records.data.map((r) => (
              <li key={r.id} className="kv__row sx-row--wrap">
                <div className="kv__label">
                  <Link to={`/business/${r.businessId}/${r.branchId}/orders/${r.orderId}`}>{t('orders.order')} <CashRef record={r} /></Link>
                  <span className="kv__sub"><bdi>{formatLocalDateTime(r.recordedAt, locale)}</bdi></span>
                </div>
                <div className="kv__value">
                  <bdi className={r.reversed ? 'muted' : ''} style={r.reversed ? { textDecoration: 'line-through' } : undefined}>{money(r.amountAgorot, locale)}</bdi>
                  {r.reversed ? <Badge tone="danger">{t('owner.cashReversed')}</Badge> : <Badge tone="success">{t('receipt.cashReceived')}</Badge>}
                </div>
                {owner && !r.reversed ? <div className="sx-row__foot"><Button size="sm" variant="ghost" icon="refresh" onClick={() => { setReason(''); setReverse(r); }}>{t('dash.reverseCash')}</Button></div> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog open={!!reverse} onClose={() => { if (!busy) setReverse(null); }} title={t('dash.reverseCash')} footer={<><Button variant="secondary" disabled={busy} onClick={() => setReverse(null)}>{t('common.cancel')}</Button><Button variant="danger-solid" loading={busy} disabled={reason.trim().length < 3} onClick={async () => { if (!reverse) return; setBusy(true); try { await call('reverseCash', { orderId: reverse.orderId, reason: reason.trim(), idempotencyKey: newIdempotencyKey() }); setReverse(null); toast(t('common.saved')); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setBusy(false); } }}>{t('dash.reverseCash')}</Button></>}>
        <div className="stack">
          <p>{t('dash.reverseCashBody')}</p>
          {reverse ? <ul className="kv kv--flush"><KvRow label={t('dash.cashAmount')} value={<bdi>{money(reverse.amountAgorot, locale)}</bdi>} total /></ul> : null}
          <TextArea label={t('common.reason')} required value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Dialog>
    </div>
  );
}

/* ---------- New business ---------- */

export function NewBusinessPage() {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [d, setD] = useState({ type: 'restaurant' as 'restaurant' | 'supermarket', name: {} as Record<string, string>, description: {} as Record<string, string>, defaultLocale: locale, publicPhone: '' });
  const [saving, setSaving] = useState(false);
  const safety = useDraftSafety(d);
  if (loading) return <Skeleton height={220} />;
  if (!user?.email) return <Navigate to="/business/signin" replace />;
  if (!user.emailVerified) return <Navigate to="/business/verify-email" replace />;
  return (
    <main className="page stack" style={{ maxWidth: 720 }}>
      <h1>{t('auth.ownerSignupTitle')}</h1>
      <p className="muted">{t('auth.ownerSignupBody')}</p>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (!hasAnyTranslation(d.name)) return toast(t('validation.atLeastOneLanguage'), 'danger'); setSaving(true); try { const r = await call<{ business: { id: string } }>('createBusiness', { ...d, publicPhone: d.publicPhone || undefined }); toast(t('bizProfile.created')); safety.markSaved(); navigate(`/business/${r.business.id}/_/branches/new`); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
        <Segmented label={t('bizProfile.type')} value={d.type} onChange={(type) => setD({ ...d, type })} options={[{ value: 'restaurant', label: t('common.restaurant'), icon: 'utensils' }, { value: 'supermarket', label: t('common.supermarket'), icon: 'basket' }]} />
        <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => setD({ ...d, name })} />
        <LocalizedInput label={t('business.about')} value={d.description} multiline onChange={(description) => setD({ ...d, description })} />
        <Select label={t('bizProfile.defaultLocale')} value={d.defaultLocale} onChange={(e) => setD({ ...d, defaultLocale: e.target.value as 'he' })}><option value="he">עברית</option><option value="ar">العربية</option><option value="en">English</option></Select>
        <TextInput label={t('bizProfile.publicPhone')} optional ltr value={d.publicPhone} onChange={(e) => setD({ ...d, publicPhone: e.target.value })} />
        <Button type="submit" block loading={saving}>{t('dash.createBusiness')}</Button>
      </form>
    </main>
  );
}
