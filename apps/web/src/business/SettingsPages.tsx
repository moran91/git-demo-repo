import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ref as sref, uploadBytes } from 'firebase/storage';
import { EMPTY_WEEK, LOYALTY_BOUNDS, hasAnyTranslation, hhmmToMinutes, makeId, minutesToHHMM, type Branch, type CashRecord, type DeliveryCityRule, type HoursOverride, type LoyaltyLedgerEntry, type OpeningInterval, type WeeklyHours } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { storage } from '@/lib/firebase';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { Button, TextInput, Select, Checkbox, Alert, IconButton, Badge, EmptyState, toast, ConfirmDialog, Segmented } from '@/design/components';
import { Icon } from '@/design/Icon';
import { money, formatLocalDateTime } from '@/lib/format';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useCities } from '@/customer/hooks';
import { StorageImage } from '@/customer/StorageImage';
import { PageTitle, useDash } from './shell';
import { LocalizedInput } from './CatalogPages';
import { useAuth } from '@/lib/auth';

type BranchDraft = { name: Branch['name']; cityId: string; locationDescription: Branch['locationDescription']; lat?: number; lng?: number; phone: string; hours: WeeklyHours; hoursOverrides: HoursOverride[]; pickupEnabled: boolean; deliveryEnabled: boolean; deliveryCities: DeliveryCityRule[] };

function draftFromBranch(b?: Branch, cityId = 'beit-jann'): BranchDraft {
  if (!b) return { name: {}, cityId, locationDescription: {}, phone: '', hours: { ...EMPTY_WEEK }, hoursOverrides: [], pickupEnabled: true, deliveryEnabled: true, deliveryCities: [] };
  return { name: b.name, cityId: b.cityId, locationDescription: b.locationDescription, lat: b.lat, lng: b.lng, phone: b.phone, hours: b.hours, hoursOverrides: b.hoursOverrides, pickupEnabled: b.pickupEnabled, deliveryEnabled: b.deliveryEnabled, deliveryCities: b.deliveryCities };
}

export function BranchForm({ initial, onSave, saving }: { initial: BranchDraft; onSave: (d: BranchDraft) => void; saving: boolean }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { cities } = useCities();
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<BranchDraft>) => setD((s) => ({ ...s, ...p }));
  const setInterval_ = (day: keyof WeeklyHours, i: number, patch: Partial<OpeningInterval>) => set({ hours: { ...d.hours, [day]: d.hours[day].map((iv, j) => (j === i ? { ...iv, ...patch } : iv)) } });
  const timeInput = (day: keyof WeeklyHours, i: number, key: 'startMin' | 'endMin') => (
    <input type="time" className="input" style={{ width: 120 }} aria-label={key === 'startMin' ? t('branch.from') : t('branch.to')} value={minutesToHHMM(d.hours[day][i]![key])} onChange={(e) => { const m = hhmmToMinutes(e.target.value); if (m === null) return; if (key === 'endMin') { const start = d.hours[day][i]!.startMin; setInterval_(day, i, { endMin: m <= start ? m + 1440 : m }); } else setInterval_(day, i, { startMin: m, endMin: d.hours[day][i]!.endMin <= m ? d.hours[day][i]!.endMin + 1440 : d.hours[day][i]!.endMin }); }} />
  );
  return (
    <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); setError(null); if (!hasAnyTranslation(d.name)) return setError(t('validation.atLeastOneLanguage')); if (!d.phone.trim()) return setError(t('validation.phone')); onSave(d); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <section className="card stack">
        <LocalizedInput label={t('branch.nameLabel')} value={d.name} required onChange={(name) => set({ name })} />
        <Select label={t('branch.city')} value={d.cityId} onChange={(e) => set({ cityId: e.target.value })}>{cities.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
        <LocalizedInput label={t('branch.location')} value={d.locationDescription} onChange={(locationDescription) => set({ locationDescription })} />
        <TextInput label={t('branch.coords')} optional ltr placeholder="32.9628, 35.3822" value={d.lat !== undefined ? `${d.lat}, ${d.lng}` : ''} onChange={(e) => { const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(e.target.value); set(m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: undefined, lng: undefined }); }} />
        <TextInput label={t('branch.phone')} required ltr inputMode="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
      </section>
      <section className="card stack">
        <h2>{t('dash.hours')}</h2>
        <p className="muted">{t('branch.overnightHint')}</p>
        <div className="hours-grid">
          {(['0', '1', '2', '3', '4', '5', '6'] as const).map((day) => (
            <div key={day} className="hours-row">
              <strong>{t(`branch.day.${day}`)}</strong>
              <div className="stack--sm stack">
                {d.hours[day].length === 0 ? <span className="muted">{t('common.closed')}</span> : null}
                {d.hours[day].map((_, i) => (
                  <div key={i} className="interval">{timeInput(day, i, 'startMin')}<span>–</span>{timeInput(day, i, 'endMin')}<IconButton icon="x" label={t('common.remove')} onClick={() => set({ hours: { ...d.hours, [day]: d.hours[day].filter((_, j) => j !== i) } })} /></div>
                ))}
                <Button size="sm" variant="ghost" icon="plus" disabled={d.hours[day].length >= 4} onClick={() => set({ hours: { ...d.hours, [day]: [...d.hours[day], { startMin: 540, endMin: 1320 }] } })}>{t('branch.addInterval')}</Button>
              </div>
            </div>
          ))}
        </div>
        <h3>{t('branch.overrides')}</h3>
        {d.hoursOverrides.map((o, i) => (
          <div key={i} className="row">
            <input type="date" className="input" style={{ width: 170 }} aria-label={t('common.date')} value={o.date} onChange={(e) => set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
            <Checkbox label={t('branch.closedAllDay')} checked={o.intervals.length === 0} onChange={(e) => set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, intervals: e.target.checked ? [] : [{ startMin: 540, endMin: 1320 }] } : x)) })} />
            {o.intervals[0] ? <><input type="time" className="input" style={{ width: 120 }} aria-label={t('branch.from')} value={minutesToHHMM(o.intervals[0].startMin)} onChange={(e) => { const m = hhmmToMinutes(e.target.value); if (m !== null) set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, intervals: [{ ...x.intervals[0]!, startMin: m }] } : x)) }); }} /><input type="time" className="input" style={{ width: 120 }} aria-label={t('branch.to')} value={minutesToHHMM(o.intervals[0].endMin)} onChange={(e) => { const m = hhmmToMinutes(e.target.value); if (m !== null) set({ hoursOverrides: d.hoursOverrides.map((x, j) => (j === i ? { ...x, intervals: [{ ...x.intervals[0]!, endMin: m <= x.intervals[0]!.startMin ? m + 1440 : m }] } : x)) }); }} /></> : null}
            <IconButton icon="trash" label={t('common.remove')} onClick={() => set({ hoursOverrides: d.hoursOverrides.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button size="sm" variant="ghost" icon="plus" onClick={() => set({ hoursOverrides: [...d.hoursOverrides, { date: new Date().toISOString().slice(0, 10), intervals: [] }] })}>{t('branch.addOverride')}</Button>
      </section>
      <section className="card stack">
        <h2>{t('dash.deliveryAreas')}</h2>
        <Checkbox label={t('branch.pickup')} checked={d.pickupEnabled} onChange={(e) => set({ pickupEnabled: e.target.checked })} />
        <Checkbox label={t('branch.delivery')} checked={d.deliveryEnabled} onChange={(e) => set({ deliveryEnabled: e.target.checked })} />
        {d.deliveryEnabled ? (
          <>
            <p className="muted">{t('branch.minHint')}</p>
            {d.deliveryCities.map((r, i) => (
              <div key={r.cityId} className="row">
                <Select label={t('address.city')} value={r.cityId} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, cityId: e.target.value } : x)) })}>{cities.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
                <TextInput label={t('branch.fee')} type="number" ltr step="0.5" value={(r.feeAgorot / 100).toString()} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, feeAgorot: Math.round(Number(e.target.value) * 100) } : x)) })} />
                <TextInput label={t('branch.minSubtotal')} type="number" ltr step="1" value={(r.minSubtotalAgorot / 100).toString()} onChange={(e) => set({ deliveryCities: d.deliveryCities.map((x, j) => (j === i ? { ...x, minSubtotalAgorot: Math.round(Number(e.target.value) * 100) } : x)) })} />
                <IconButton icon="trash" label={t('common.remove')} onClick={() => set({ deliveryCities: d.deliveryCities.filter((_, j) => j !== i) })} />
                <span className="muted">{money(r.feeAgorot, locale)} · {money(r.minSubtotalAgorot, locale)}</span>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon="plus" onClick={() => { const next = cities.find((c) => !d.deliveryCities.some((x) => x.cityId === c.id)); if (next) set({ deliveryCities: [...d.deliveryCities, { cityId: next.id, feeAgorot: 1000, minSubtotalAgorot: 5000 }] }); }}>{t('branch.addCity')}</Button>
          </>
        ) : null}
      </section>
      <Button type="submit" loading={saving}>{t('common.save')}</Button>
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
      <BranchForm key={branch.id + branch.updatedAt} initial={draftFromBranch(branch)} saving={saving} onSave={async (d) => { setSaving(true); try { await call('updateBranch', { businessId: business.id, branchId: branch.id, branch: d }); toast(t('catalog.savedOk')); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setSaving(false); } }} />
    </div>
  );
}

export function NewBranchPage() {
  const t = useT();
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  return (
    <main className="page stack" style={{ maxWidth: 900 }}>
      <h1>{t('branch.new')}</h1>
      <BranchForm initial={draftFromBranch()} saving={saving} onSave={async (d) => { setSaving(true); try { const r = await call<{ branch: Branch }>('createBranch', { businessId, branch: d }); toast(t('catalog.savedOk')); navigate(`/business/${businessId}/${r.branch.id}/branch`); } catch (e) { toast(t(errorKey(e)), 'danger'); } finally { setSaving(false); } }} />
    </main>
  );
}

export function BusinessProfilePage() {
  const t = useT();
  const { L } = useI18n();
  const { business, can, role } = useDash();
  const [d, setD] = useState({ type: business.type, name: business.name, description: business.description, defaultLocale: business.defaultLocale, publicPhone: business.publicPhone ?? '', publicEmail: business.publicEmail ?? '' });
  const [saving, setSaving] = useState(false);
  const history = useCollection<{ id: string; targetType: string; branchId?: string; state: string; reason: string; at: string }>(`businesses/${business.id}/approvalHistory`, [orderBy('at', 'desc'), limit(20)], [business.id]);
  const { locale } = useI18n();
  const upload = async (kind: 'logo' | 'cover', file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return toast(t('catalog.photoHint'), 'danger');
    try {
      const path = `businesses/${business.id}/${kind}-${makeId(8)}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`;
      await uploadBytes(sref(storage, path), file, { contentType: file.type });
      await call('setBusinessImage', { businessId: business.id, kind, path });
      toast(t('catalog.savedOk'));
    } catch {
      toast(t('catalog.photoFailed'), 'danger');
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
        <div className="photo-area">
          <div className="stack--sm stack"><span className="field__label">{t('bizProfile.logo')}</span><StorageImage path={business.logoPath} alt="" square fallbackLabel={t('discovery.imageFallback')} /><label className="btn btn--secondary btn--sm"><Icon name="image" size={16} /> {t('catalog.uploadPhoto')}<input type="file" className="visually-hidden" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && void upload('logo', e.target.files[0])} /></label></div>
          <div className="stack--sm stack" style={{ flex: 1, minWidth: 240 }}><span className="field__label">{t('bizProfile.cover')}</span><StorageImage path={business.coverPath} size="display" alt="" wide fallbackLabel={t('discovery.imageFallback')} /><label className="btn btn--secondary btn--sm"><Icon name="image" size={16} /> {t('catalog.uploadPhoto')}<input type="file" className="visually-hidden" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && void upload('cover', e.target.files[0])} /></label></div>
        </div>
      </section>
      {owner ? (
        <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (!hasAnyTranslation(d.name)) return toast(t('validation.atLeastOneLanguage'), 'danger'); setSaving(true); try { await call('updateBusiness', { businessId: business.id, business: { ...d, publicPhone: d.publicPhone || undefined, publicEmail: d.publicEmail || undefined } }); toast(t('catalog.savedOk')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
          <Segmented label={t('bizProfile.type')} value={d.type} onChange={(type) => setD({ ...d, type })} options={[{ value: 'restaurant', label: t('common.restaurant'), icon: 'utensils' }, { value: 'supermarket', label: t('common.supermarket'), icon: 'basket' }]} />
          <LocalizedInput label={t('common.name')} value={d.name} required onChange={(name) => setD({ ...d, name })} />
          <LocalizedInput label={t('business.about')} value={d.description} multiline onChange={(description) => setD({ ...d, description })} />
          <Select label={t('bizProfile.defaultLocale')} value={d.defaultLocale} onChange={(e) => setD({ ...d, defaultLocale: e.target.value as typeof d.defaultLocale })}><option value="he">עברית</option><option value="ar">العربية</option><option value="en">English</option></Select>
          <div className="row"><TextInput label={t('bizProfile.publicPhone')} optional ltr value={d.publicPhone} onChange={(e) => setD({ ...d, publicPhone: e.target.value })} /><TextInput label={t('bizProfile.publicEmail')} optional ltr type="email" value={d.publicEmail} onChange={(e) => setD({ ...d, publicEmail: e.target.value })} /></div>
          <Button type="submit" loading={saving}>{t('common.save')}</Button>
        </form>
      ) : null}
      <section className="card stack--sm stack">
        <h2>{t('bizProfile.history')}</h2>
        <ul className="list">{history.data.map((h) => <li key={h.id} className="list__item"><Badge tone={h.state === 'approved' ? 'success' : h.state === 'pending' ? 'accent' : 'danger'}>{t(`admin.state.${h.state as 'pending'}`)}</Badge><div className="list__grow">{h.targetType}{h.branchId ? ` · ${h.branchId}` : ''} · {h.reason}</div><span className="muted"><bdi>{formatLocalDateTime(h.at, locale)}</bdi></span></li>)}</ul>
      </section>
      <p className="muted">{L(business.name, business.defaultLocale)} · {t('admin.futureMonetization')}</p>
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
  useState(() => { void load(); });
  if (!can('staff')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="stack">
      <PageTitle title={t('staff.title')} />
      <p className="muted">{t('staff.roleHelp')}</p>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await call<{ mode: string; link?: string }>('inviteMember', { businessId: business.id, email, role, allBranches: all, branchIds: all ? [] : branchIds }); toast(t('staff.invited')); if (r.link) setLink(r.link); setEmail(''); await load(); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setBusy(false); } }}>
        <h2>{t('staff.invite')}</h2>
        <div className="row"><TextInput label={t('common.email')} type="email" required ltr value={email} onChange={(e) => setEmail(e.target.value)} /><Select label={t('staff.role')} value={role} onChange={(e) => setRole(e.target.value as 'manager' | 'staff')}><option value="staff">{t('staff.role.staff')}</option><option value="manager">{t('staff.role.manager')}</option></Select></div>
        <Checkbox label={t('staff.allBranches')} checked={all} onChange={(e) => setAll(e.target.checked)} />
        {!all ? <div className="row">{branches.map((b) => <Checkbox key={b.id} label={L(b.name, business.defaultLocale)} checked={branchIds.includes(b.id)} onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))} />)}</div> : null}
        <Button type="submit" loading={busy} disabled={!all && branchIds.length === 0}>{t('staff.invite')}</Button>
        {link ? <Alert tone="info"><span className="muted">{t('staff.inviteLinkNote')}</span><br /><a href={link} dir="ltr">{link}</a></Alert> : null}
      </form>
      <section className="card">
        <h2>{t('dash.staff')}</h2>
        {!data ? <div className="skeleton" style={{ height: 80 }} /> : data.members.length === 0 ? <p className="muted">{t('staff.empty')}</p> : (
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
  const ledger = useCollection<LoyaltyLedgerEntry>('loyaltyLedger', [where('businessId', '==', business.id), orderBy('at', 'desc'), limit(50)], [business.id]);
  if (!can('financials')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  return (
    <div className="stack">
      <PageTitle title={t('loyaltySettings.title')} />
      <Alert tone="info">{t('loyaltySettings.help')}</Alert>
      {role === 'owner' || role === 'admin' ? (
        <form className="card stack" onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { await call('setLoyaltyRules', { businessId: business.id, rules: r }); toast(t('catalog.savedOk')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
          <Checkbox label={t('loyaltySettings.enable')} checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
          <div className="row">
            <TextInput label={`${t('loyaltySettings.earnStep')} (₪)`} type="number" ltr min={LOYALTY_BOUNDS.earnPerAgorot.min / 100} max={LOYALTY_BOUNDS.earnPerAgorot.max / 100} value={(r.earnPerAgorot / 100).toString()} onChange={(e) => setR({ ...r, earnPerAgorot: Math.round(Number(e.target.value) * 100) })} />
            <TextInput label={t('loyaltySettings.pointsPerStep')} type="number" ltr min={1} max={100} value={r.pointsPerStep} onChange={(e) => setR({ ...r, pointsPerStep: Number(e.target.value) })} />
            <TextInput label={`${t('loyaltySettings.redeemValue')} (₪)`} type="number" ltr step="0.01" value={(r.redeemValueAgorot / 100).toString()} onChange={(e) => setR({ ...r, redeemValueAgorot: Math.round(Number(e.target.value) * 100) })} />
            <TextInput label={t('loyaltySettings.maxPercent')} type="number" ltr min={0} max={50} value={r.maxDiscountPercent} onChange={(e) => setR({ ...r, maxDiscountPercent: Number(e.target.value) })} />
          </div>
          <p className="muted">{t('loyaltySettings.earn', { points: r.pointsPerStep, amount: money(r.earnPerAgorot, locale) })} · {t('loyaltySettings.version', { version: business.loyalty.version })}</p>
          <Button type="submit" loading={saving}>{t('common.save')}</Button>
        </form>
      ) : null}
      <section className="card stack--sm stack">
        <h2>{t('loyaltySettings.history')}</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('loyaltySettings.customer')}</th><th>{t('admin.points')}</th><th>{t('common.reason')}</th></tr></thead><tbody>{ledger.data.map((e) => <tr key={e.id}><td><bdi>{formatLocalDateTime(e.at, locale)}</bdi></td><td dir="ltr">{e.uid.slice(0, 8)}…</td><td className="num">{e.points || `(${e.reservedDelta})`}</td><td>{e.type}{e.orderId ? ` · ${e.orderId.slice(0, 6)}` : ''}{e.reason ? ` · ${e.reason}` : ''}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

export function CashRecordsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { business, branch, can } = useDash();
  const records = useCollection<CashRecord>('cashRecords', [where('businessId', '==', business.id), where('branchId', '==', branch.id), orderBy('recordedAt', 'desc'), limit(100)], [branch.id]);
  if (!can('financials')) return <EmptyState icon="shield" title={t('error.forbidden')} />;
  const total = records.data.filter((r) => !r.reversed).reduce((s, r) => s + r.amountAgorot, 0);
  return (
    <div className="stack">
      <PageTitle title={t('dash.cash')} />
      <div className="metrics"><div className="metric"><span className="metric__value"><bdi>{money(total, locale)}</bdi></span><span className="metric__label">{t('admin.metrics.cashRecorded')}</span></div><div className="metric"><span className="metric__value">{records.data.filter((r) => !r.reversed).length}</span><span className="metric__label">{t('dash.cash')}</span></div></div>
      <p className="muted">{t('admin.metrics.note')}</p>
      <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('orders.order')}</th><th>{t('dash.cashAmount')}</th><th>{t('common.status')}</th></tr></thead><tbody>{records.data.map((r) => <tr key={r.id}><td><bdi>{formatLocalDateTime(r.recordedAt, locale)}</bdi></td><td><a href={`/business/${r.businessId}/${r.branchId}/orders/${r.orderId}`} dir="ltr">{r.orderId.slice(0, 8)}…</a></td><td><bdi className="price">{money(r.amountAgorot, locale)}</bdi></td><td>{r.reversed ? <Badge tone="danger">{t('dash.reverseCash')}</Badge> : <Badge tone="success">{t('receipt.cashReceived')}</Badge>}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function NewBusinessPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [d, setD] = useState({ type: 'restaurant' as 'restaurant' | 'supermarket', name: {} as Record<string, string>, description: {} as Record<string, string>, defaultLocale: 'he' as 'he' | 'ar' | 'en', publicPhone: '' });
  const [saving, setSaving] = useState(false);
  if (!loading && !user) { navigate('/business/signin'); return null; }
  return (
    <main className="page stack" style={{ maxWidth: 720 }}>
      <h1>{t('auth.ownerSignupTitle')}</h1>
      <p className="muted">{t('auth.ownerSignupBody')}</p>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (!hasAnyTranslation(d.name)) return toast(t('validation.atLeastOneLanguage'), 'danger'); setSaving(true); try { const r = await call<{ business: { id: string } }>('createBusiness', { ...d, publicPhone: d.publicPhone || undefined }); toast(t('bizProfile.created')); navigate(`/business/${r.business.id}/_/branches/new`); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSaving(false); } }}>
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
