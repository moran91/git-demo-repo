import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { collection, collectionGroup, documentId, getDocs, onSnapshot, orderBy as fbOrderBy, query, where as fbWhere, limit as fbLimit } from 'firebase/firestore';
import { formatPhoneDisplay, type Branch, type Business, type City, type Order, type UserProfile } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { db } from '@/lib/firebase';
import { useCollection, where, orderBy, limit } from '@/lib/queries';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { Badge, Button, Dialog, TextArea, toast } from '@/design/components';

export type ApprovalState = Business['approval'];

export const approvalTone = (s: string) => (s === 'approved' ? 'success' : s === 'pending' ? 'accent' : 'danger') as 'success' | 'accent' | 'danger';

export function ApprovalBadge({ state }: { state: string }) {
  const t = useT();
  return <Badge tone={approvalTone(state)}>{t(`admin.state.${state as ApprovalState}`)}</Badge>;
}

/** Business and city display names for admin tables, so rows show names rather than document ids. */
export function useAdminNames() {
  const { L } = useI18n();
  const businesses = useCollection<Business>('businesses', [limit(500)]);
  const cities = useCollection<City>('cities', [limit(200)]);
  return {
    businesses: businesses.data,
    business: (id: string) => { const b = businesses.data.find((x) => x.id === id); return b ? L(b.name, b.defaultLocale) : id; },
    city: (id: string) => { const c = cities.data.find((x) => x.id === id); return c ? L(c.name) : id; },
  };
}

// Profiles change rarely and the same people (owners, admins) appear on every page.
const userCache = new Map<string, UserProfile | null>();

/** Loads user profiles by uid (30 per query) so tables can show people instead of uids. */
export function useUsers(uids: Array<string | undefined>) {
  const t = useT();
  const key = [...new Set(uids.filter((u): u is string => !!u))].sort().join(',');
  const [, setVersion] = useState(0);
  useEffect(() => {
    const missing = key.split(',').filter((u) => u && !userCache.has(u));
    if (missing.length === 0) return;
    let live = true;
    void (async () => {
      for (let i = 0; i < missing.length; i += 30) {
        const chunk = missing.slice(i, i + 30);
        const snap = await getDocs(query(collection(db, 'users'), fbWhere(documentId(), 'in', chunk)));
        for (const u of chunk) userCache.set(u, null);
        for (const d of snap.docs) userCache.set(d.id, d.data() as UserProfile);
      }
      if (live) setVersion((v) => v + 1);
    })().catch(() => undefined);
    return () => { live = false; };
  }, [key]);
  const name = (uid: string | undefined) => {
    if (!uid) return '—';
    const u = userCache.get(uid);
    if (u) return u.displayName || u.email || (u.phone ? formatPhoneDisplay(u.phone) : uid);
    return uid === 'seed' || uid === 'system' ? t('owner.actor.system') : uid.slice(0, 8);
  };
  return { get: (uid: string | undefined) => (uid ? userCache.get(uid) ?? null : null), name };
}

export function UserLink({ uid, name, children, onClick }: { uid: string; name?: string; children?: ReactNode; onClick?: () => void }) {
  if (uid === 'seed' || uid === 'system') return <span>{children ?? name}</span>;
  return <Link to={`/admin/users/${uid}`} onClick={onClick}>{children ?? name ?? uid}</Link>;
}

/** Pending branches across all businesses (collection group, so not expressible with useCollection). */
export function usePendingBranches() {
  const t = useT();
  const [state, setState] = useState<{ data: Branch[]; error: string | null }>({ data: [], error: null });
  useEffect(() => onSnapshot(
    query(collectionGroup(db, 'branches'), fbWhere('approval', '==', 'pending'), fbOrderBy('createdAt', 'desc'), fbLimit(50)),
    (s) => setState({ data: s.docs.map((d) => d.data() as Branch), error: null }),
    (err) => setState({ data: [], error: t(errorKey(err)) }),
  ), [t]);
  return state;
}

/** Live counts for the nav: approvals waiting on the admin and orders waiting on a business. */
export function useAdminCounts() {
  const pendingBiz = useCollection<Business>('businesses', [where('approval', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)]);
  const pendingBranches = usePendingBranches();
  const placed = useCollection<Order>('orders', [where('status', '==', 'placed'), orderBy('placedAt', 'asc'), limit(99)]);
  return { approvals: pendingBiz.data.length + pendingBranches.data.length, waitingOrders: placed.data.length };
}

export function modeLabel(o: Pick<Order, 'mode' | 'tableNumber'>, t: ReturnType<typeof useT>): string {
  return o.mode === 'delivery' ? t('common.delivery') : o.mode === 'dine_in' ? (o.tableNumber ? t('orders.table', { n: o.tableNumber }) : t('common.dineIn')) : t('common.pickup');
}

export const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

export interface ApprovalTarget { type: 'business' | 'branch'; businessId: string; branchId?: string; name: string; state: ApprovalState; current: string }

export function ApprovalDialog({ target, onClose }: { target: ApprovalTarget; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = target.state === 'approved' ? (target.current === 'pending' ? t('admin.approve') : t('admin.reinstate')) : target.state === 'rejected' ? t('admin.rejectApproval') : t('admin.suspend');
  const submit = async () => {
    setBusy(true);
    try {
      await call('decideApproval', { targetType: target.type, businessId: target.businessId, branchId: target.branchId, state: target.state, reason: reason.trim() });
      toast(t('common.saved'));
      onClose();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`${label}: ${target.name}`} sheet={false} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant={target.state === 'approved' ? 'primary' : 'danger-solid'} loading={busy} disabled={reason.trim().length < 2} onClick={() => void submit()}>{label}</Button></>}>
      <div className="stack">
        <div className="row"><Badge tone="neutral">{t(`admin.entity.${target.type}`)}</Badge><ApprovalBadge state={target.current} /></div>
        <TextArea label={t('common.reason')} required hint={t('admin.reasonRequired')} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}
