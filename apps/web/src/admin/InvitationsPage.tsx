import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { LOCALES, type Localized } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { formatLocalDateTime } from '@/lib/format';
import { Badge, Button, Checkbox, EmptyState, Select, Skeleton, TextInput, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { LoadError } from '@/business/BusinessExperience';
import { LocalizedInput } from '@/business/LocalizedInput';
import { useAdminNames, useUsers } from './lib';

type Invitation = { id: string; email: string; businessId?: string; role: 'owner' | 'manager' | 'staff'; status: 'pending' | 'accepted' | 'revoked' | 'expired'; invitedBy: string; createdAt: string; expiresAt: string; acceptedAt?: string; acceptedUid?: string };
type Sent = { email: string; link: string; business?: string };

const STATUS_TONE = { pending: 'accent', accepted: 'success', revoked: 'muted', expired: 'muted' } as const;

/** Nothing sends email, so a new link is shown with copy and WhatsApp for the admin to deliver. */
function LinkPanel({ sent }: { sent: Sent }) {
  const t = useT();
  const copy = async () => {
    try { await navigator.clipboard.writeText(sent.link); toast(t('qr.copied')); }
    catch { toast(t('error.internal'), 'danger'); }
  };
  const message = t('admin.inviteMessage', { business: sent.business || t('brand.name'), link: sent.link });
  return (
    <div className="card stack--sm stack admin-linkpanel" role="status">
      <p>{t('admin.inviteLinkReady', { email: sent.email })}</p>
      <code className="admin-linkpanel__url" dir="ltr">{sent.link}</code>
      <div className="actions">
        <Button variant="secondary" icon="copy" onClick={() => void copy()}>{t('common.copy')}</Button>
        <a className="btn btn--secondary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><Icon name="share" size={18} />{t('admin.shareWhatsapp')}</a>
      </div>
    </div>
  );
}

export function InvitationsPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const names = useAdminNames();
  const [email, setEmail] = useState('');
  const [createBiz, setCreateBiz] = useState(false);
  const [name, setName] = useState<Localized>({});
  const [type, setType] = useState<'restaurant' | 'supermarket'>('restaurant');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [list, setList] = useState<{ invitations: Invitation[]; nextCursor?: string } | null>(null);
  const [listError, setListError] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const users = useUsers((list?.invitations ?? []).flatMap((i) => [i.invitedBy, i.acceptedUid]));
  const load = async (cursor?: string) => {
    try {
      const r = await call<{ invitations: Invitation[]; nextCursor?: string }>('adminListInvitations', cursor ? { cursor } : {});
      setList((prev) => (cursor && prev ? { invitations: [...prev.invitations, ...r.invitations], nextCursor: r.nextCursor } : r));
      setListError(false);
    } catch {
      setListError(true);
    }
  };
  useEffect(() => {
    let live = true;
    call<{ invitations: Invitation[]; nextCursor?: string }>('adminListInvitations', {}).then((r) => { if (live) setList(r); }).catch(() => { if (live) setListError(true); });
    return () => { live = false; };
  }, []);
  const invite = async () => {
    setBusy(true);
    try {
      // The business's default language is the one its name was written in (the admin's own first).
      const defaultLocale = name[locale]?.trim() ? locale : LOCALES.find((l) => name[l]?.trim()) ?? locale;
      const r = await call<{ link: string }>('inviteOwner', { email: email.trim(), business: createBiz ? { type, name, description: {}, defaultLocale } : undefined });
      setSent({ email: email.trim(), link: r.link, business: createBiz ? L(name, defaultLocale) : undefined });
      setEmail('');
      setName({});
      setCreateBiz(false);
      void load();
    } catch (err) {
      toast(t(errorKey(err)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const act = async (inv: Invitation, action: 'renew' | 'revoke') => {
    setActing(`${inv.id}:${action}`);
    try {
      const r = await call<{ link?: string }>('adminInvitationAction', { id: inv.id, action });
      if (r.link) setSent({ email: inv.email, link: r.link, business: inv.businessId ? names.business(inv.businessId) : undefined });
      else toast(t('common.saved'));
      void load();
    } catch (err) {
      toast(t(errorKey(err)), 'danger');
    } finally {
      setActing(null);
    }
  };
  return (
    <div className="stack">
      <h1>{t('admin.invitations')}</h1>
      <div className="admin-cols">
        <form className="card stack" aria-labelledby="inv-new" onSubmit={(e) => { e.preventDefault(); void invite(); }}>
          <h2 id="inv-new">{t('admin.inviteOwner')}</h2>
          <p className="muted">{t('admin.inviteOwnerBody')}</p>
          <TextInput label={t('common.email')} type="email" required ltr value={email} onChange={(e) => setEmail(e.target.value)} />
          <Checkbox label={t('admin.createBusinessFor')} checked={createBiz} onChange={(e) => setCreateBiz(e.target.checked)} />
          {createBiz ? <><Select label={t('bizProfile.type')} value={type} onChange={(e) => setType(e.target.value as 'restaurant')}><option value="restaurant">{t('common.restaurant')}</option><option value="supermarket">{t('common.supermarket')}</option></Select><LocalizedInput label={t('common.name')} required value={name} onChange={setName} /></> : null}
          <Button type="submit" loading={busy} disabled={createBiz && !LOCALES.some((l) => name[l]?.trim())}>{t('admin.createInvite')}</Button>
        </form>
        {sent ? <LinkPanel sent={sent} /> : null}
      </div>
      <section className="card stack--sm stack">
        {listError ? <LoadError retry={() => void load()} /> : !list ? <Skeleton height={120} /> : list.invitations.length === 0 ? <EmptyState icon="share" title={t('admin.inv.empty')} /> : (
          <ul className="list">{list.invitations.map((inv) => (
            <li key={inv.id} className="list__item admin-item">
              <div className="list__grow">
                <div className="admin-audit__head"><bdi dir="ltr">{inv.email}</bdi><Badge tone={STATUS_TONE[inv.status]}>{t(`admin.inv.status.${inv.status}`)}</Badge></div>
                <div className="muted">{t(`staff.role.${inv.role}`)} · {inv.businessId ? <Link to={`/admin/businesses/${inv.businessId}`}>{names.business(inv.businessId)}</Link> : t('admin.inv.platform')}{inv.status === 'accepted' && inv.acceptedUid ? <> · <Link to={`/admin/users/${inv.acceptedUid}`}>{users.name(inv.acceptedUid)}</Link></> : null}</div>
                <div className="muted"><bdi>{formatLocalDateTime(inv.createdAt, locale)}</bdi> · {users.name(inv.invitedBy)}{inv.status === 'pending' ? <> · {t('admin.inv.expires', { date: formatLocalDateTime(inv.expiresAt, locale) })}</> : null}</div>
              </div>
              {inv.status !== 'accepted' ? <div className="admin-item__end">
                <Button size="sm" variant="secondary" loading={acting === `${inv.id}:renew`} disabled={!!acting} onClick={() => void act(inv, 'renew')}>{t('admin.inv.renew')}</Button>
                {inv.status === 'pending' ? <Button size="sm" variant="danger" loading={acting === `${inv.id}:revoke`} disabled={!!acting} onClick={() => void act(inv, 'revoke')}>{t('admin.inv.revoke')}</Button> : null}
              </div> : null}
            </li>
          ))}</ul>
        )}
        {list?.nextCursor ? <div className="pagination"><Button variant="secondary" onClick={() => void load(list.nextCursor)}>{t('dash.loadMore')}</Button></div> : null}
      </section>
    </div>
  );
}
