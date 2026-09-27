import { useState } from 'react';
import { Link } from 'react-router';
import { collection, orderBy as fbOrderBy, query, where as fbWhere } from 'firebase/firestore';
import { LOCALES, type AuditEvent, type City, type Localized, type PlatformConfig } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { db } from '@/lib/firebase';
import { useCollection, useDoc, usePaged, orderBy, limit } from '@/lib/queries';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { formatLocalDateTime } from '@/lib/format';
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, IconButton, Select, Skeleton, StackTable, TextInput, toast } from '@/design/components';
import { LoadError } from '@/business/BusinessExperience';
import { LocalizedInput } from '@/business/LocalizedInput';
import { useUsers } from './lib';

type CityDraft = { id?: string; name: Localized; aliases: string; active: boolean; sortOrder: number; lat?: number; lng?: number };

export function CitiesPage() {
  const t = useT();
  const { L } = useI18n();
  const cities = useCollection<City>('cities', [orderBy('sortOrder'), limit(200)]);
  const [edit, setEdit] = useState<CityDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await call('saveCity', { id: edit.id, name: edit.name, aliases: edit.aliases.split(',').map((s) => s.trim()).filter(Boolean), active: edit.active, sortOrder: edit.sortOrder, lat: edit.lat, lng: edit.lng });
      toast(t('common.saved'));
      setEdit(null);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="dash__title"><h1>{t('admin.cities')}</h1><div className="actions"><Button icon="plus" onClick={() => setEdit({ name: {}, aliases: '', active: true, sortOrder: cities.data.length })}>{t('admin.newCity')}</Button></div></div>
      {cities.error ? <LoadError /> : cities.loading ? <Skeleton height={160} radius={16} /> : (
        <StackTable><table className="table"><thead><tr><th>{t('common.name')}</th><th>{t('admin.aliasesShort')}</th><th>{t('common.status')}</th><th></th></tr></thead><tbody>{cities.data.map((c) => (
          <tr key={c.id}>
            <td><strong>{L(c.name)}</strong><div className="muted">{LOCALES.map((l) => c.name[l]).filter((n) => n && n !== L(c.name)).map((n, i) => <bdi key={i} className="admin-alt">{n}</bdi>)}</div></td>
            <td><div className="admin-aliases">{c.aliases.map((a) => <bdi key={a} className="admin-alias">{a}</bdi>)}</div></td>
            <td>{c.active ? <Badge tone="success">{t('admin.active')}</Badge> : <Badge tone="muted">{t('admin.inactive')}</Badge>}</td>
            <td><IconButton icon="edit" label={`${t('common.edit')}: ${L(c.name)}`} onClick={() => setEdit({ id: c.id, name: c.name, aliases: c.aliases.join(', '), active: c.active, sortOrder: c.sortOrder, lat: c.lat, lng: c.lng })} /></td>
          </tr>
        ))}</tbody></table></StackTable>
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `${t('common.edit')}: ${L(edit.name)}` : t('admin.newCity')} sheet={false} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button></>}>
        {edit ? <div className="stack">
          <LocalizedInput label={t('common.name')} required value={edit.name} onChange={(name) => setEdit({ ...edit, name })} />
          <TextInput label={t('admin.aliases')} hint={t('admin.aliasesHint')} value={edit.aliases} onChange={(e) => setEdit({ ...edit, aliases: e.target.value })} />
          <div className="row admin-row"><div className="admin-grow"><TextInput label={t('admin.sortOrder')} type="number" inputMode="numeric" ltr value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) || 0 })} /></div><Checkbox label={t('admin.active')} checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /></div>
        </div> : null}
      </Dialog>
    </div>
  );
}

const TARGETS = ['business', 'branch', 'user', 'order', 'invitation', 'loyaltyAccount', 'city', 'config'] as const;

/** Where an audit target lives in the admin panel, when it has a page of its own. */
function targetHref(a: AuditEvent): string | null {
  if (a.targetType === 'business') return `/admin/businesses/${a.targetId}`;
  if (a.targetType === 'user') return `/admin/users/${a.targetId}`;
  if (a.targetType === 'membership') return `/admin/users/${a.targetId.split('_')[0]}`;
  if (a.targetType === 'invitation') return '/admin/invitations';
  if (a.targetType === 'city') return '/admin/cities';
  if (a.targetType === 'config') return '/admin/config';
  return null;
}

export function AuditList({ rows, names }: { rows: AuditEvent[]; names: (uid: string) => string }) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <ul className="list">{rows.map((a) => {
      const href = targetHref(a);
      const detail = a.before !== undefined || a.after !== undefined;
      return (
        <li key={a.id} className="list__item admin-item admin-audit">
          <div className="list__grow">
            <div className="admin-audit__head"><code dir="ltr">{a.action}</code>{href ? <Link to={href} dir="ltr">{a.targetType}/{a.targetId}</Link> : <span className="muted" dir="ltr">{a.targetType}/{a.targetId}</span>}</div>
            {a.reason ? <div><bdi>{a.reason}</bdi></div> : null}
            <div className="muted"><Link to={`/admin/users/${a.actorUid}`}>{names(a.actorUid)}</Link> · <bdi>{formatLocalDateTime(a.at, locale)}</bdi></div>
            {detail ? <details className="admin-audit__detail"><summary>{t('admin.details')}</summary><div className="admin-audit__diff">{a.before !== undefined ? <div><div className="muted">{t('admin.before')}</div><pre dir="ltr">{JSON.stringify(a.before, null, 2)}</pre></div> : null}{a.after !== undefined ? <div><div className="muted">{t('admin.after')}</div><pre dir="ltr">{JSON.stringify(a.after, null, 2)}</pre></div> : null}</div></details> : null}
          </div>
        </li>
      );
    })}</ul>
  );
}

export function AuditPage() {
  const t = useT();
  const [target, setTarget] = useState<(typeof TARGETS)[number] | 'all'>('all');
  const paged = usePaged<AuditEvent>(() => (target === 'all' ? query(collection(db, 'audit'), fbOrderBy('at', 'desc')) : query(collection(db, 'audit'), fbWhere('targetType', '==', target), fbOrderBy('at', 'desc'))), 30, [target]);
  const users = useUsers(paged.items.map((a) => a.actorUid));
  return (
    <div className="stack">
      <h1>{t('admin.audit')}</h1>
      <div className="chips admin-chips" role="group" aria-label={t('admin.target')}>
        {(['all', ...TARGETS] as const).map((k) => <button key={k} type="button" className="chip" aria-pressed={target === k} onClick={() => setTarget(k)}>{k === 'all' ? t('common.all') : t(`admin.target.${k}`)}</button>)}
      </div>
      {paged.error ? <LoadError retry={paged.reload} /> : !paged.loading && paged.items.length === 0 ? <EmptyState icon="list" title={t('admin.noResults')} /> : <div className="card"><AuditList rows={paged.items} names={users.name} /></div>}
      {!paged.done && !paged.error ? <div className="pagination"><Button variant="secondary" loading={paged.loading} onClick={paged.loadMore}>{t('dash.loadMore')}</Button></div> : null}
    </div>
  );
}

export function ConfigPage() {
  const t = useT();
  const { L } = useI18n();
  const cfg = useDoc<PlatformConfig>('config/platform');
  const cities = useCollection<City>('cities', [orderBy('sortOrder'), limit(200)]);
  const [picked, setCityId] = useState('');
  const cityId = picked || cfg.data?.defaultCityId || '';
  const [busy, setBusy] = useState(false);
  if (cfg.error) return <LoadError />;
  const save = async () => {
    setBusy(true);
    try { await call('setPlatformConfig', { defaultCityId: cityId }); toast(t('common.saved')); }
    catch (e) { toast(t(errorKey(e)), 'danger'); }
    finally { setBusy(false); }
  };
  return (
    <div className="stack admin-narrow">
      <h1>{t('admin.config')}</h1>
      <section className="card stack">
        <Select label={t('admin.defaultCity')} value={cityId} onChange={(e) => setCityId(e.target.value)}>{cities.data.map((c) => <option key={c.id} value={c.id}>{L(c.name)}</option>)}</Select>
        <div className="row admin-row"><span>{t('admin.whatsapp')}</span>{cfg.loading ? null : <Badge tone={cfg.data?.whatsappOtpEnabled ? 'success' : 'muted'}>{cfg.data?.whatsappOtpEnabled ? t('admin.on') : t('admin.off')}</Badge>}</div>
        <div className="actions"><Button loading={busy} disabled={!cityId || cityId === cfg.data?.defaultCityId} onClick={() => void save()}>{t('common.save')}</Button></div>
      </section>
      <Alert tone="info">{t('admin.futureMonetization')}</Alert>
    </div>
  );
}
