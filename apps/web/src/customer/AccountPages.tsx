import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { formatPhoneDisplay, type AppNotification, type Favorite, type LoyaltyAccount, type LoyaltyLedgerEntry, type SavedAddress } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { useCollection, orderBy, where, limit } from '@/lib/queries';
import { Button, EmptyState, Skeleton, Alert, Dialog, ConfirmDialog, TextInput, toast, Badge } from '@/design/components';
import { Icon } from '@/design/Icon';
import { LanguageSelect } from '@/app/Shell';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { getRegistration } from '@/lib/sw';
import { formatLocalDateTime } from '@/lib/format';
import { AddressForm, AddressSummary, emptyAddress, fromSaved, type AddressFormValue } from './AddressForm';
import { useFavorites, type PublicBusiness } from './hooks';
import { discoveryStore } from '@/lib/city';
import { StorageImage } from './StorageImage';

function GuestGate() {
  const t = useT();
  return <EmptyState icon="user" title={t('account.guest')} body={t('account.guestHint')} action={<Link className="btn btn--primary" to="/signin">{t('common.signIn')}</Link>} />;
}

export function AccountPage() {
  const t = useT();
  const { locale } = useI18n();
  const { user, profile, memberships, isAdmin, loading, signOut, refreshProfile } = useAuth();
  const [push, setPush] = useState<PushState | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const unread = useCollection<AppNotification>(user ? `users/${user.uid}/notifications` : null, [where('read', '==', false), limit(50)], [user?.uid]);
  useEffect(() => {
    void pushState().then(setPush);
  }, []);
  useEffect(() => setName(profile?.displayName ?? ''), [profile?.displayName]);
  if (loading) return <Skeleton height={200} radius={16} />;
  return (
    <div className="stack">
      <h1>{t('account.title')}</h1>
      <section className="card stack">
        <h2>{t('account.language')}</h2>
        <LanguageSelect />
      </section>
      {!user ? (
        <>
          <GuestGate />
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to="/business/signin" className="btn btn--ghost">{t('account.staffSignIn')}</Link>
            <Link to="/business/register" className="btn btn--ghost">{t('account.ownerSignup')}</Link>
          </div>
        </>
      ) : (
        <>
          <section className="card stack">
            <h2>{t('account.profile')}</h2>
            <form className="row" onSubmit={async (e) => { e.preventDefault(); setSavingName(true); try { await call('updateProfile', { displayName: name.trim() }); await refreshProfile(); toast(t('common.saved')); } catch (err) { toast(t(errorKey(err)), 'danger'); } finally { setSavingName(false); } }}>
              <div style={{ flex: 1, minWidth: 200 }}><TextInput label={t('account.displayName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
              <Button type="submit" variant="secondary" loading={savingName} style={{ alignSelf: 'flex-end' }}>{t('common.save')}</Button>
            </form>
            {profile?.phone ? <div className="muted">{t('common.phone')}: <bdi className="num">{formatPhoneDisplay(profile.phone)}</bdi></div> : null}
            {profile?.email ? <div className="muted">{t('common.email')}: <bdi>{profile.email}</bdi></div> : null}
          </section>
          <nav className="card list" aria-label={t('account.title')}>
            <Link to="/orders" className="list__item" style={{ textDecoration: 'none', color: 'inherit' }}><Icon name="bag" /> <span className="list__grow">{t('orders.title')}</span><Icon name="chevron" directional size={18} /></Link>
            <Link to="/account/addresses" className="list__item" style={{ textDecoration: 'none', color: 'inherit' }}><Icon name="house" /> <span className="list__grow">{t('address.title')}</span><Icon name="chevron" directional size={18} /></Link>
            <Link to="/account/loyalty" className="list__item" style={{ textDecoration: 'none', color: 'inherit' }}><Icon name="star" /> <span className="list__grow">{t('account.loyalty')}</span><Icon name="chevron" directional size={18} /></Link>
            <Link to="/account/notifications" className="list__item" style={{ textDecoration: 'none', color: 'inherit' }}><Icon name="bell" /> <span className="list__grow">{t('account.notifications')}</span>{unread.data.length ? <Badge tone="primary">{unread.data.length}</Badge> : null}<Icon name="chevron" directional size={18} /></Link>
            {memberships.length > 0 ? <Link to="/business" className="list__item" style={{ textDecoration: 'none', color: 'inherit' }}><Icon name="store" /> <span className="list__grow">{t('account.businessAccess')}</span><Icon name="chevron" directional size={18} /></Link> : null}
            {isAdmin ? <Link to="/admin" className="list__item" style={{ textDecoration: 'none', color: 'inherit' }}><Icon name="shield" /> <span className="list__grow">{t('nav.admin')}</span><Icon name="chevron" directional size={18} /></Link> : null}
          </nav>
          <section className="card stack">
            <h2>{t('account.notifications')}</h2>
            {push === 'granted' ? <Alert tone="success">{t('account.pushEnabled')}</Alert> : push === 'denied' ? <Alert tone="warn">{t('account.pushDenied')}</Alert> : push === 'unsupported' || push === 'not_configured' ? <Alert tone="info">{t('account.pushUnsupported')}</Alert> : <Button variant="secondary" icon="bell" onClick={async () => setPush(await enablePush(user.uid, locale, getRegistration()))}>{t('account.pushEnable')}</Button>}
            <p className="muted">{t('account.pushHint')}</p>
          </section>
          <Button variant="secondary" icon="logout" onClick={() => setConfirmOut(true)}>{t('common.signOut')}</Button>
          <p className="muted">{t('account.deleteAccountInfo')}</p>
          <ConfirmDialog open={confirmOut} onClose={() => setConfirmOut(false)} onConfirm={() => { setConfirmOut(false); void signOut(); }} title={t('common.signOut')} body={t('account.signOutConfirm')} confirmLabel={t('common.signOut')} />
        </>
      )}
    </div>
  );
}

export function AddressesPage() {
  const t = useT();
  const { user, loading } = useAuth();
  const addresses = useCollection<SavedAddress>(user ? `users/${user.uid}/addresses` : null, [limit(20)], [user?.uid]);
  const [editing, setEditing] = useState<{ id?: string; value: AddressFormValue } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prefs = discoveryStore.get();
  if (loading) return <Skeleton height={200} radius={16} />;
  if (!user) return <GuestGate />;
  const save = async (v: AddressFormValue) => {
    setBusy(true);
    try {
      await call('saveAddress', { id: editing?.id, address: v });
      toast(t('common.saved'));
      setEditing(null);
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="row row--between"><h1>{t('address.title')}</h1><Button icon="plus" variant="secondary" onClick={() => setEditing({ value: emptyAddress(prefs.cityId) })}>{t('address.add')}</Button></div>
      {addresses.data.length === 0 && !addresses.loading ? <EmptyState icon="house" title={t('address.none')} /> : null}
      <ul className="stack--sm stack">
        {addresses.data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((a) => (
          <li key={a.id} className="address-card" style={{ cursor: 'default' }}>
            <AddressSummary a={a} />
            <div className="stack--sm stack" style={{ marginInlineStart: 'auto' }}>
              {a.isDefault ? <Badge tone="primary">{t('address.default')}</Badge> : <Button size="sm" variant="ghost" onClick={() => call('setDefaultAddress', { id: a.id }).catch(() => toast(t('common.errorGeneric'), 'danger'))}>{t('address.setDefault')}</Button>}
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing({ id: a.id, value: fromSaved(a) })}>{t('common.edit')}</Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => setDeleting(a.id)}>{t('common.delete')}</Button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('address.edit') : t('address.add')}>
        {editing ? <AddressForm initial={editing.value} submitLabel={t('address.save')} onSubmit={save} submitting={busy} showDefault compact /> : null}
      </Dialog>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger title={t('common.delete')} body={t('address.deleteConfirm')} confirmLabel={t('common.delete')} onConfirm={async () => { const id = deleting; setDeleting(null); if (id) await call('deleteAddress', { id }).catch(() => toast(t('common.errorGeneric'), 'danger')); }} />
    </div>
  );
}

export function FavoritesPage() {
  const t = useT();
  const { L } = useI18n();
  const { user, loading } = useAuth();
  const { favorites, toggle } = useFavorites();
  const bizIds = favorites.filter((f) => f.kind === 'business').map((f) => f.businessId);
  const businesses = useCollection<PublicBusiness>(bizIds.length ? 'publicBusinesses' : null, [where('__name__', 'in', bizIds.slice(0, 10)), limit(10)], [bizIds.join(',')]);
  if (loading) return <Skeleton height={200} radius={16} />;
  if (!user) return <GuestGate />;
  const products = favorites.filter((f) => f.kind === 'product');
  return (
    <div className="stack">
      <h1>{t('nav.favorites')}</h1>
      {favorites.length === 0 ? <EmptyState icon="heart" title={t('account.favoritesEmpty')} body={t('account.favoritesHint')} action={<Link className="btn btn--primary" to="/">{t('cart.browse')}</Link>} /> : null}
      {bizIds.length > 0 ? (
        <section className="stack--sm stack">
          <h2>{t('account.favoriteBusinesses')}</h2>
          <ul className="list card">
            {bizIds.map((id) => {
              const b = businesses.data.find((x) => x.id === id);
              return (
                <li key={id} className="list__item">
                  <StorageImage path={b?.logoPath} alt="" square className="product__img" fallbackLabel={t('discovery.imageFallback')} />
                  <div className="list__grow">
                    {b ? <Link to={`/b/${id}`} style={{ fontWeight: 600 }}>{L(b.name, b.defaultLocale)}</Link> : <span className="muted">{t('checkout.notApproved')}</span>}
                    {b ? <div className="muted">{b.type === 'restaurant' ? t('common.restaurant') : t('common.supermarket')}</div> : null}
                  </div>
                  <Button size="sm" variant="ghost" icon="heart" onClick={() => toggle({ id, kind: 'business', businessId: id } as Favorite)}>{t('common.remove')}</Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {products.length > 0 ? (
        <section className="stack--sm stack">
          <h2>{t('account.favoriteProducts')}</h2>
          <ul className="list card">
            {products.map((f) => (
              <li key={f.id} className="list__item"><Link className="list__grow" to={`/b/${f.businessId}/${f.branchId}`}>{f.productId}</Link><Button size="sm" variant="ghost" onClick={() => toggle(f)}>{t('common.remove')}</Button></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function NotificationsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { user, loading } = useAuth();
  const items = useCollection<AppNotification>(user ? `users/${user.uid}/notifications` : null, [orderBy('createdAt', 'desc'), limit(50)], [user?.uid]);
  if (loading) return <Skeleton height={200} radius={16} />;
  if (!user) return <GuestGate />;
  const markAll = async () => {
    const batch = writeBatch(db);
    for (const n of items.data.filter((x) => !x.read)) batch.update(doc(db, `users/${user.uid}/notifications/${n.id}`), { read: true });
    await batch.commit().catch(() => toast(t('common.errorGeneric'), 'danger'));
  };
  return (
    <div className="stack">
      <div className="row row--between"><h1>{t('nav.notifications')}</h1><Button size="sm" variant="ghost" onClick={markAll} disabled={!items.data.some((n) => !n.read)}>{t('account.markAllRead')}</Button></div>
      {items.data.length === 0 && !items.loading ? <EmptyState icon="bell" title={t('account.noNotifications')} /> : null}
      <div className="card">
        {items.data.map((n) => (
          <Link key={n.id} to={n.link} className={`notif-item ${n.read ? 'notif-item--read' : 'notif-item--unread'}`} onClick={() => { if (!n.read) void updateDoc(doc(db, `users/${user.uid}/notifications/${n.id}`), { read: true }); }}>
            <span className="notif-item__dot" aria-hidden="true" />
            <div className="list__grow">
              <div>{n.title}</div>
              <div className="muted">{n.body}</div>
              <div className="muted"><bdi>{formatLocalDateTime(n.createdAt, locale)}</bdi></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function LoyaltyPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const { user, loading } = useAuth();
  const accounts = useCollection<LoyaltyAccount>(user ? 'loyaltyAccounts' : null, [where('uid', '==', user?.uid ?? '_'), limit(50)], [user?.uid]);
  const ledger = useCollection<LoyaltyLedgerEntry>(user ? 'loyaltyLedger' : null, [where('uid', '==', user?.uid ?? '_'), orderBy('at', 'desc'), limit(100)], [user?.uid]);
  const bizIds = accounts.data.map((a) => a.businessId);
  const businesses = useCollection<PublicBusiness>(bizIds.length ? 'publicBusinesses' : null, [where('__name__', 'in', bizIds.slice(0, 10)), limit(10)], [bizIds.join(',')]);
  if (loading) return <Skeleton height={200} radius={16} />;
  if (!user) return <GuestGate />;
  const bizName = (id: string) => { const b = businesses.data.find((x) => x.id === id); return b ? L(b.name, b.defaultLocale) : id; };
  return (
    <div className="stack">
      <h1>{t('account.loyalty')}</h1>
      {accounts.data.length === 0 && !accounts.loading ? <EmptyState icon="star" title={t('account.loyaltyEmpty')} /> : null}
      <div className="grid-cards">
        {accounts.data.map((a) => (
          <div key={a.id} className="card stack--sm stack">
            <strong>{bizName(a.businessId)}</strong>
            <div className="row"><span className="muted">{t('account.available')}</span><strong className="num">{a.available}</strong><span className="muted">{t('account.reserved')}</span><span className="num">{a.reserved}</span>{a.debt > 0 ? <><span className="muted">{t('account.debt')}</span><span className="num" style={{ color: 'var(--color-danger-text)' }}>{a.debt}</span></> : null}</div>
            {a.debt > 0 ? <Alert tone="warn">{t('checkout.loyaltyDebt')}</Alert> : null}
          </div>
        ))}
      </div>
      {ledger.data.length > 0 ? (
        <section className="stack--sm stack">
          <h2>{t('account.loyaltyHistory')}</h2>
          <div className="table-wrap"><table className="table"><thead><tr><th>{t('common.date')}</th><th>{t('common.name')}</th><th>{t('admin.points')}</th><th>{t('common.reason')}</th></tr></thead><tbody>
            {ledger.data.map((e) => <tr key={e.id}><td><bdi>{formatLocalDateTime(e.at, locale)}</bdi></td><td>{bizName(e.businessId)}</td><td className="num">{e.points !== 0 ? (e.points > 0 ? `+${e.points}` : e.points) : e.reservedDelta > 0 ? `(${e.reservedDelta})` : `(${e.reservedDelta})`}</td><td>{e.type}{e.reason ? ` · ${e.reason}` : ''}</td></tr>)}
          </tbody></table></div>
        </section>
      ) : null}
    </div>
  );
}
