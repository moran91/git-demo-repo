import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { EMPTY_WEEK, LOYALTY_BOUNDS, branchInputSchema, normalizeIsraeliPhone, toLocal, hasAnyTranslation, hhmmToMinutes, makeId, minutesToHHMM, type Branch, type CashRecord, type DeliveryCityRule, type HoursOverride, type LoyaltyLedgerEntry, type OpeningInterval, type WeeklyHours } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { Button, TextInput, Select, Checkbox, Alert, IconButton, Badge, EmptyState, toast, ConfirmDialog, Segmented, Skeleton } from '@/design/components';
import { Icon } from '@/design/Icon';
import { LocationPicker } from '@/design/LocationPicker';
import { money, formatLocalDateTime } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey, uploadErrorKey } from '@/lib/errors';
import { UPLOAD_ACCEPT, prepareImageUpload, recordUpload } from '@/lib/images';
import { useCities } from '@/customer/hooks';
import { StorageImage } from '@/customer/StorageImage';
import { PageTitle, useDash } from './shell';
import { LocalizedInput } from './CatalogPages';
import { useAuth } from '@/lib/auth';
import { FormError, LoadError, SaveStatus, useDraftSafety } from './BusinessExperience';

type BranchDraft = { name: Branch['name']; cityId: string; locationDescription: Branch['locationDescription']; lat?: number; lng?: number; phone: string; hours: WeeklyHours; hoursOverrides: HoursOverride[]; pickupEnabled: boolean; deliveryEnabled: boolean; deliveryCities: DeliveryCityRule[] };

function draftFromBranch(b?: Branch, cityId = 'beit-jann'): BranchDraft {
  if (!b) return { name: {}, cityId, locationDescription: {}, phone: '', hours: { ...EMPTY_WEEK }, hoursOverrides: [], pickupEnabled: true, deliveryEnabled: false, deliveryCities: [] };
  return { name: b.name, cityId: b.cityId, locationDescription: b.locationDescription, lat: b.lat, lng: b.lng, phone: b.phone, hours: b.hours, hoursOverrides: b.hoursOverrides, pickupEnabled: b.pickupEnabled, deliveryEnabled: b.deliveryEnabled, deliveryCities: b.deliveryCities };
}

export function BranchForm({ initial, onSave, saving }: { initial: BranchDraft; onSave: (d: BranchDraft) => Promise<boolean | string>; saving: boolean }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { cities, error: cityError, loading: citiesLoading } = useCities();
  const navigate = useNavigate();
  const [d, setD] = useState(initial);
  const [copyDay, setCopyDay] = useState<keyof WeeklyHours | null>(null);
  const safety = useDraftSafety(d);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<BranchDraft>) => setD((s) => ({ ...s, ...p }));
  const setInterval_ = (day: keyof WeeklyHours, i: number, patch: Partial<OpeningInterval>) => set({ hours: { ...d.hours, [day]: d.hours[day].map((iv, j) => (j === i ? { ...iv, ...patch } : iv)) } });
  const timeInput = (day: keyof WeeklyHours, i: number, key: 'startMin' | 'endMin') => (
    <input type="time" className="input" aria-label={key === 'startMin' ? t('branch.from') : t('branch.to')} value={minutesToHHMM(d.hours[day][i]![key])} onChange={(e) => { const m = hhmmToMinutes(e.target.value); if (m === null) return; if (key === 'endMin') { const start = d.hours[day][i]!.startMin; setInterval_(day, i, { endMin: m <= start ? m + 1440 : m }); } else setInterval_(day, i, { startMin: m, endMin: d.hours[day][i]!.endMin % 1440 <= m ? d.hours[day][i]!.endMin % 1440 + 1440 : d.hours[day][i]!.endMin % 1440 }); }} />
  );
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      if (saving) return;
      setError(null);
      if (!hasAnyTranslation(d.name)) return setError(t('validation.atLeastOneLanguage'));
      if (!normalizeIsraeliPhone(d.phone)) return setError(t('validation.phone'));
      if (d.deliveryEnabled && d.deliveryCities.length === 0) return setError(t('owner.deliveryAreaRequired'));
      const overlapping = (intervals: OpeningInterval[]) => {
        const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin);
        return sorted.some((iv, i) => i > 0 && iv.startMin < sorted[i - 1]!.endMin);
      };
      if (Object.values(d.hours).some(overlapping) || d.hoursOverrides.some((o) => !o.date || overlapping(o.intervals)) || new Set(d.hoursOverrides.map((o) => o.date)).size !== d.hoursOverrides.length) return setError(t('owner.hoursError'));
      const next = d;
      if (!branchInputSchema.safeParse(next).success) return setError(t('owner.hoursError'));
      const result = await onSave(next);
      if (result) { safety.markSaved(d); if (typeof result === 'string') navigate(result); }
    }}>
      <FormError message={error} />
      {cityError ? <LoadError /> : null}
      <fieldset className="stack form-fields" disabled={saving}>
      <section className="card stack">
        <LocalizedInput label={t('branch.nameLabel')} value={d.name} required onChange={(name) => set({ name })} />
        <LocalizedInput label={t('branch.location')} value={d.locationDescription} onChange={(locationDescription) => set({ locationDescription })} />
        <div className="form-row">
          <Select label={t('branch.city')} value={d.cityId} onChange={(e) => set({ cityId: e.target.value })}>{cities.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
          <TextInput label={t('branch.phone')} required ltr inputMode="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
          <LocationPicker label={t('business.location')} value={d.lat !== undefined && d.lng !== undefined ? { lat: d.lat, lng: d.lng } : undefined} center={(() => { const city = cities.find((c) => c.id === d.cityId); return city?.lat !== undefined && city.lng !== undefined ? { lat: city.lat, lng: city.lng } : undefined; })()} onChange={(point) => set({ lat: point?.lat, lng: point?.lng })} />
        </div>
      </section>
      <section className="card stack">
        <h2>{t('dash.hours')}</h2>
        <p className="muted">{t('branch.overnightHint')}</p>
        <div className="hours-grid">
          {(['0', '1', '2', '3', '4', '5', '6'] as const).map((day) => (
            <div key={day} className="hours-row">
              <div className="hours-row__day"><strong>{t(`branch.day.${day}`)}</strong>{d.hours[day].length === 0 ? <span className="muted">{t('common.closed')}</span> : null}</div>
              <div className="stack--sm stack">
                {d.hours[day].map((iv, i) => (
                  <div key={i} className="stack stack--sm"><div className="interval">{timeInput(day, i, 'startMin')}<span>–</span>{timeInput(day, i, 'endMin')}<IconButton icon="x" label={t('common.remove')} onClick={() => set({ hours: { ...d.hours, [day]: d.hours[day].filter((_, j) => j !== i) } })} /></div>{iv.endMin >= 1440 ? <p className="field__hint">{t('owner.overnight')}</p> : null}</div>
                ))}
                <Button size="sm" variant="ghost" icon="plus" disabled={d.hours[day].length >= 4} onClick={() => set({ hours: { ...d.hours, [day]: [...d.hours[day], { startMin: 540, endMin: 1320 }] } })}>{t('branch.addInterval')}</Button>
                {d.hours[day].length ? <Button size="sm" variant="ghost" icon="copy" onClick={() => setCopyDay(day)}>{t('owner.copyHours')}</Button> : null}
              </div>
            </div>
          ))}
        </div>
        <h3>{t('branch.overrides')}</h3>
        {d.hoursOverrides.map((o, i) => (
          <div key={i} className="edit-row">
            <div className="edit-row__main">
              <input type="date" className="input" aria-label={t('common.date')} value={o.date} onChange={(e) => set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
              <Checkbox label={t('branch.closedAllDay')} checked={o.intervals.length === 0} onChange={(e) => set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, intervals: e.target.checked ? [] : [{ startMin: 540, endMin: 1320 }] } : x)) })} />
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
        <Button size="sm" variant="ghost" icon="plus" onClick={() => set({ hoursOverrides: [...d.hoursOverrides, { date: toLocal(new Date()).date, intervals: [] }] })}>{t('branch.addOverride')}</Button>
      </section>
      <section className="card stack">
        <h2>{t('dash.deliveryAreas')}</h2>
        <Checkbox label={t('branch.pickup')} checked={d.pickupEnabled} onChange={(e) => set({ pickupEnabled: e.target.checked })} />
        <Checkbox label={t('branch.delivery')} checked={d.deliveryEnabled} onChange={(e) => set({ deliveryEnabled: e.target.checked, deliveryCities: e.target.checked && d.deliveryCities.length === 0 ? [{ cityId: d.cityId, feeAgorot: 0, minSubtotalAgorot: 0 }] : d.deliveryCities })} />
        {d.deliveryEnabled ? (
          <>
            <p className="muted">{t('branch.minHint')}</p>
            {d.deliveryCities.map((r, i) => (
              <div key={r.cityId} className="edit-row">
                <div className="edit-row__main">
                  {/* One grid for all three: the city select on its own line above two short number
                      fields left the rule reading as a full-width control over a pair of stubs. */}
                  <div className="form-row">
                    <Select label={t('address.city')} value={r.cityId} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, cityId: e.target.value } : x)) })}>{cities.filter((c) => c.id === r.cityId || !d.deliveryCities.some((x) => x.cityId === c.id)).map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
                    <TextInput label={`${t('branch.fee')} (₪)`} type="number" ltr min={0} step="0.01" value={(r.feeAgorot / 100).toString()} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, feeAgorot: Math.round(Number(e.target.value) * 100) } : x)) })} />
                    <TextInput label={`${t('branch.minSubtotal')} (₪)`} type="number" ltr min={0} step="0.01" value={(r.minSubtotalAgorot / 100).toString()} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, minSubtotalAgorot: Math.round(Number(e.target.value) * 100) } : x)) })} />
                  </div>
                </div>
                <div className="edit-row__foot">
                  <span><bdi>{money(r.feeAgorot, locale)}</bdi> · <bdi>{money(r.minSubtotalAgorot, locale)}</bdi></span>
                  <IconButton icon="trash" label={t('common.remove')} onClick={() => set({ deliveryCities: d.deliveryCities.filter((_, j) => j !== i) })} />
                </div>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon="plus" disabled={!cities.some((c) => !d.deliveryCities.some((r) => r.cityId === c.id))} onClick={() => { const next = cities.find((c) => !d.deliveryCities.some((x) => x.cityId === c.id)); if (next) set({ deliveryCities: [...d.deliveryCities, { cityId: next.id, feeAgorot: 1000, minSubtotalAgorot: 5000 }] }); }}>{t('branch.addCity')}</Button>
          </>
        ) : null}
      </section>
      </fieldset>
      <div className="save-bar"><SaveStatus {...safety} /><Button type="submit" loading={saving} disabled={citiesLoading || !!cityError}>{t('common.save')}</Button></div>
      <ConfirmDialog open={copyDay !== null} onClose={() => setCopyDay(null)} title={t('owner.copyHours')} body={t('owner.copyHoursBody')} confirmLabel={t('common.confirm')} onConfirm={() => { if (copyDay !== null) set({ hours: Object.fromEntries(Object.keys(d.hours).map((day) => [day, d.hours[copyDay].map((iv) => ({ ...iv }))])) as WeeklyHours }); setCopyDay(null); }} />
    </form>
  );
}

export function BranchSettingsPage() {
  const t = useT();
  const { business, branch, can } = useDash();
  const [saving, setSaving] = useState(false);
  if (!can('settings')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="stack">
      <PageTitle title={t('dash.branchSettings')}><Badge tone={branch.approval === 'approved' ? 'success' : branch.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${branch.approval}`)}</Badge></PageTitle>
      {branch.approval === 'pending' ? <Alert tone="info">{t('branch.approvalPending')}</Alert> : branch.approval === 'rejected' ? <Alert tone="danger">{t('branch.approvalRejected', { reason: branch.approvalReason ?? '' })}</Alert> : branch.approval === 'suspended' ? <Alert tone="danger">{t('branch.approvalSuspended', { reason: branch.approvalReason ?? '' })}</Alert> : <Alert tone="success">{t('branch.approvalApproved')}</Alert>}
      <BranchForm key={branch.id} initial={draftFromBranch(branch)} saving={saving} onSave={async (d) => { setSaving(true); try { await call('updateBranch', { businessId: business.id, branchId: branch.id, branch: d }); toast(t('catalog.savedOk')); return true; } catch (e) { toast(t(errorKey(e)), 'danger'); return false; } finally { setSaving(false); } }} />
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

export function BusinessProfilePage() {
  const t = useT();
  const { L } = useI18n();
  const { business, can, role } = useDash();
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
    <div className="stack">
      <PageTitle title={t('dash.business')}><Badge tone={business.approval === 'approved' ? 'success' : business.approval === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${business.approval}`)}</Badge></PageTitle>
      {business.approval === 'pending' ? <Alert tone="info">{t('bizProfile.approvalPending')}</Alert> : business.approval === 'rejected' ? <Alert tone="danger">{t('bizProfile.approvalRejected', { reason: business.approvalReason ?? '' })}</Alert> : business.approval === 'suspended' ? <Alert tone="danger">{t('bizProfile.approvalSuspended', { reason: business.approvalReason ?? '' })}</Alert> : <Alert tone="success">{t('bizProfile.approvalApproved')}</Alert>}
      <section className="card stack">
        <h2>{t('catalog.photo')}</h2>
        <div className="photo-pair">
          {(['logo', 'cover'] as const).map((kind) => (
            <div key={kind} className={`photo-pair__item photo-pair__item--${kind}`}>
              <span className="field__label">{t(kind === 'logo' ? 'bizProfile.logo' : 'bizProfile.cover')}</span>
              <StorageImage path={kind === 'logo' ? business.logoPath : business.coverPath} size={kind === 'logo' ? 'thumb' : 'display'} alt="" square={kind === 'logo'} wide={kind === 'cover'} fallbackLabel={t('discovery.imageFallback')} />
              <label className={`btn btn--secondary btn--sm ${uploading ? 'is-busy' : ''}`} aria-busy={uploading === kind || undefined}><Icon name="image" size={16} /> {uploading === kind ? t('catalog.photoUploading') : t('catalog.uploadPhoto')}<input type="file" className="visually-hidden" accept={UPLOAD_ACCEPT} disabled={!!uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(kind, f); e.target.value = ''; }} /></label>
            </div>
          ))}
        </div>
      </section>
      {owner ? (
        <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (!hasAnyTranslation(d.name)) return toast(t('validation.atLeastOneLanguage'), 'danger'); setSaving(true); try { await call('updateBusiness', { businessId: business.id, business: { ...d } }); safety.markSaved(); toast(t('catalog.savedOk')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
          <Segmented label={t('bizProfile.type')} value={d.type} onChange={(type) => setD({ ...d, type })} options={[{ value: 'restaurant', label: t('common.restaurant'), icon: 'utensils' }, { value: 'supermarket', label: t('common.supermarket'), icon: 'basket' }]} />
          <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => setD({ ...d, name })} />
          <LocalizedInput label={t('business.about')} value={d.description} multiline onChange={(description) => setD({ ...d, description })} />
          <Select label={t('bizProfile.defaultLocale')} value={d.defaultLocale} onChange={(e) => setD({ ...d, defaultLocale: e.target.value as typeof d.defaultLocale })}><option value="he">עברית</option><option value="ar">العربية</option><option value="en">English</option></Select>
          <div className="form-row form-cols--wide"><TextInput label={t('bizProfile.publicPhone')} optional ltr value={d.publicPhone} onChange={(e) => setD({ ...d, publicPhone: e.target.value })} /><TextInput label={t('bizProfile.publicEmail')} optional ltr type="email" value={d.publicEmail} onChange={(e) => setD({ ...d, publicEmail: e.target.value })} /></div>
          <div className="save-bar"><SaveStatus {...safety} /><Button type="submit" loading={saving}>{t('common.save')}</Button></div>
        </form>
      ) : null}
      {/* Managers reach this page (they have `settings`) but firestore.rules keeps approvalHistory to
          owners and admins, so the section was always empty for them — and the query errored. */}
      {owner ? (
      <section className="card stack--sm stack">
        <h2>{t('bizProfile.history')}</h2>
        <ul className="list">{history.data.map((h) => <li key={h.id} className="list__item"><Badge tone={h.state === 'approved' ? 'success' : h.state === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${h.state as 'pending'}`)}</Badge><div className="list__grow">{h.targetType}{h.branchId ? ` · ${h.branchId}` : ''} · {h.reason}</div><span className="muted"><bdi>{formatLocalDateTime(h.at, locale)}</bdi></span></li>)}</ul>
      </section>
      ) : null}
      <p className="muted">{L(business.name, business.defaultLocale)}</p>
    </div>
  );
}

export function StaffPage() {
  const t = useT();
  const { L } = useI18n();
  const { business, branches, can } = useDash();
  const [data, setData] = useState<{ members: Array<{ uid: string; role: string; allBranches: boolean; branchIds: string[]; active: boolean; displayName: string; email: string }>; invitations: Array<{ id: string; email: string; role: string }> } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'manager' | 'staff'>('staff');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [all, setAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
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
  return (
    <div className="stack">
      <PageTitle title={t('staff.title')} />
      <p className="muted">{t('staff.roleHelp')}</p>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await call<{ mode: string; link?: string }>('inviteMember', { businessId: business.id, email: email.trim(), role, allBranches: all, branchIds: all ? [] : branchIds }); toast(t('staff.invited')); setLink(r.link ?? null); setEmail(''); await load(); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setBusy(false); } }}>
        <h2>{t('staff.invite')}</h2>
        <div className="form-row form-cols--wide"><TextInput label={t('common.email')} type="email" required ltr value={email} onChange={(e) => setEmail(e.target.value)} /><Select label={t('staff.role')} value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'staff')}><option value="staff">{t('staff.role.staff')}</option><option value="manager">{t('staff.role.manager')}</option></Select></div>
        <Checkbox label={t('staff.allBranches')} checked={all} onChange={(e) => setAll(e.target.checked)} />
        {!all ? <div className="form-row">{branches.map((b) => <Checkbox key={b.id} label={L(b.name, business.defaultLocale)} checked={branchIds.includes(b.id)} onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))} />)}</div> : null}
        <Button type="submit" loading={busy} disabled={!all && branchIds.length === 0}>{t('staff.invite')}</Button>
        {link ? <Alert tone="info"><span className="muted">{t('staff.inviteLinkNote')}</span><br /><a href={link} dir="ltr">{link}</a></Alert> : null}
      </form>
      <section className="card">
        <h2>{t('dash.staff')}</h2>
        {loadError ? <LoadError /> : !data ? <div className="skeleton" style={{ height: 80 }} /> : data.members.length === 0 ? <p className="muted">{t('staff.empty')}</p> : (
          <ul className="list">
            {data.members.map((m) => (
              <li key={m.uid} className="list__item">
                <div className="list__grow"><strong>{m.displayName || m.email}</strong> <span className="muted" dir="ltr">{m.email}</span><div className="muted">{t(`staff.role.${m.role as 'owner'}`)} · {m.allBranches ? t('staff.allBranches') : m.branchIds.map((id) => L(branches.find((b) => b.id === id)?.name ?? {}, business.defaultLocale)).join(', ')}{!m.active ? ` · ${t('common.disabled')}` : ''}</div></div>
                {m.role !== 'owner' && m.active ? <Button size="sm" variant="danger" onClick={() => setRemoving(m.uid)}>{t('staff.remove')}</Button> : null}
                {m.role !== 'owner' && !m.active ? <Button size="sm" variant="secondary" onClick={async () => { await call('updateMembership', { businessId: business.id, uid: m.uid, active: true }).catch((e) => toast(t(errorKey(e)), 'danger')); await load(); }}>{t('common.enable')}</Button> : null}
              </li>
            ))}
            {data.invitations.map((i) => <li key={i.id} className="list__item"><div className="list__grow"><span dir="ltr">{i.email}</span> · {t(`staff.role.${i.role as 'staff'}`)}</div><Badge tone="accent">{t('staff.pending')}</Badge></li>)}
          </ul>
        )}
      </section>
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger title={t('staff.remove')} body={t('staff.removeConfirm')} confirmLabel={t('staff.remove')} onConfirm={async () => { const uid = removing!; setRemoving(null); await call('updateMembership', { businessId: business.id, uid, active: false }).catch((e) => toast(t(errorKey(e)), 'danger')); await load(); }} />
    </div>
  );
}

export function LoyaltySettingsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, can, role } = useDash();
  const [r, setR] = useState({ enabled: business.loyalty.enabled, earnPerAgorot: business.loyalty.earnPerAgorot, pointsPerStep: business.loyalty.pointsPerStep, redeemValueAgorot: business.loyalty.redeemValueAgorot, maxDiscountPercent: business.loyalty.maxDiscountPercent });
  const [saving, setSaving] = useState(false);
  const safety = useDraftSafety(r);
  const ledger = useCollection<LoyaltyLedgerEntry>(can('financials') ? 'loyaltyLedger' : null, [where('businessId', '==', business.id), orderBy('at', 'desc'), limit(50)], [business.id]);
  if (!can('financials')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="stack">
      <PageTitle title={t('loyaltySettings.title')} />
      <Alert tone="info">{t('loyaltySettings.help')}</Alert>
      {role === 'owner' || role === 'admin' ? (
        <form className="card stack" onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { await call('setLoyaltyRules', { businessId: business.id, rules: r }); safety.markSaved(); toast(t('catalog.savedOk')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
          <Checkbox label={t('loyaltySettings.enable')} checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
          <div className="form-row form-cols--tight">
            <TextInput label={`${t('loyaltySettings.earnStep')} (₪)`} type="number" ltr min={LOYALTY_BOUNDS.earnPerAgorot.min / 100} max={LOYALTY_BOUNDS.earnPerAgorot.max / 100} value={(r.earnPerAgorot / 100).toString()} onChange={(e) => setR({ ...r, earnPerAgorot: Math.round(Number(e.target.value) * 100) })} />
            <TextInput label={t('loyaltySettings.pointsPerStep')} type="number" ltr min={1} max={100} value={r.pointsPerStep} onChange={(e) => setR({ ...r, pointsPerStep: Number(e.target.value) })} />
            <TextInput label={`${t('loyaltySettings.redeemValue')} (₪)`} type="number" ltr min={LOYALTY_BOUNDS.redeemValueAgorot.min / 100} max={LOYALTY_BOUNDS.redeemValueAgorot.max / 100} step="0.01" value={(r.redeemValueAgorot / 100).toString()} onChange={(e) => setR({ ...r, redeemValueAgorot: Math.round(Number(e.target.value) * 100) })} />
            <TextInput label={t('loyaltySettings.maxPercent')} type="number" ltr min={0} max={50} value={r.maxDiscountPercent} onChange={(e) => setR({ ...r, maxDiscountPercent: Number(e.target.value) })} />
          </div>
          <p className="muted">{t('loyaltySettings.earn', { points: r.pointsPerStep, amount: money(r.earnPerAgorot, locale) })} · {t('loyaltySettings.version', { version: business.loyalty.version })}</p>
          <div className="save-bar"><SaveStatus {...safety} /><Button type="submit" loading={saving}>{t('common.save')}</Button></div>
        </form>
      ) : null}
      <section className="card stack--sm stack">
        <h2>{t('loyaltySettings.history')}</h2>
        {ledger.error ? <LoadError /> : ledger.loading ? <Skeleton height={120} /> : !ledger.data.length ? <p className="muted">{t('common.emptyGeneric')}</p> : null}
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('loyaltySettings.customer')}</th><th>{t('admin.points')}</th><th>{t('common.reason')}</th></tr></thead><tbody>{ledger.data.map((e) => <tr key={e.id}><td><bdi>{formatLocalDateTime(e.at, locale)}</bdi></td><td dir="ltr">{e.uid.slice(0, 8)}…</td><td className="num">{e.points || `(${e.reservedDelta})`}</td><td>{t(`loyalty.entry.${e.type}`)}{e.orderId ? ` · ${e.orderId.slice(0, 6)}` : ''}{e.reason ? ` · ${e.reason}` : ''}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

export function CashRecordsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, branch, can } = useDash();
  const records = useCollection<CashRecord>(can('financials') ? 'cashRecords' : null, [where('businessId', '==', business.id), where('branchId', '==', branch.id), orderBy('recordedAt', 'desc'), limit(100)], [branch.id]);
  if (!can('financials')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  const total = records.data.filter((r) => !r.reversed).reduce((s, r) => s + r.amountAgorot, 0);
  return (
    <div className="stack">
      <PageTitle title={t('dash.cash')} />
      <div className="metrics"><div className="metric"><span className="metric__value"><bdi>{money(total, locale)}</bdi></span><span className="metric__label">{t('admin.metrics.cashRecorded')}</span></div><div className="metric"><span className="metric__value">{records.data.filter((r) => !r.reversed).length}</span><span className="metric__label">{t('dash.cash')}</span></div></div>
      <p className="muted">{t('admin.metrics.note')}</p>
      <p className="muted">{t('owner.cashScope', { count: records.data.length })}</p>
      {records.error ? <LoadError /> : records.loading ? <Skeleton height={160} /> : records.data.length === 0 ? <EmptyState title={t('common.emptyGeneric')} /> : null}
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('orders.order')}</th><th>{t('dash.cashAmount')}</th><th>{t('common.status')}</th></tr></thead><tbody>{records.data.map((r) => <tr key={r.id}><td><bdi>{formatLocalDateTime(r.recordedAt, locale)}</bdi></td><td><a href={`/business/${r.businessId}/${r.branchId}/orders/${r.orderId}`} dir="ltr">{r.orderId.slice(0, 8)}…</a></td><td><bdi className="price">{money(r.amountAgorot, locale)}</bdi></td><td>{r.reversed ? <Badge tone="danger">{t('owner.cashReversed')}</Badge> : <Badge tone="success">{t('receipt.cashReceived')}</Badge>}</td></tr>)}</tbody></table></div>
    </div>
  );
}

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
        <Button type="submit" loading={saving}>{t('dash.createBusiness')}</Button>
      </form>
    </main>
  );
}
