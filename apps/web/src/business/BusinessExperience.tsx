import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useBlocker } from 'react-router';
import { useT } from '@/lib/i18n';
import { Alert, Button } from '@/design/components';
import type { Order, Product } from '@qareeb/shared';
import { useCollection, where, limit } from '@/lib/queries';
import { Icon } from '@/design/Icon';
import { useDash } from './shell';
import './business.css';

const Drafts = createContext<Set<symbol> | null>(null);

export function BusinessExperience({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Set<symbol>());
  const t = useT();
  const blocker = useBlocker(() => drafts.size > 0 && !window.confirm(t('owner.discard')));
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset(); }, [blocker]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (drafts.size) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [drafts]);
  return <Drafts.Provider value={drafts}><div className="business-app">{children}</div></Drafts.Provider>;
}

export function useConfirmNavigation() {
  const drafts = useContext(Drafts);
  const t = useT();
  return () => !drafts?.size || window.confirm(t('owner.discard'));
}

/** Track the last successful save, not incoming realtime updates. */
export function useDraftSafety<T>(value: T) {
  const drafts = useContext(Drafts);
  const t = useT();
  const serialized = JSON.stringify(value);
  const [saved, setSaved] = useState(serialized);
  /** The draft as it was last saved (or first shown): what Discard restores. */
  const lastSaved = useMemo(() => JSON.parse(saved) as T, [saved]);
  const [savedOnce, setSavedOnce] = useState(false);
  const token = useRef(Symbol('draft'));
  const dirty = saved !== serialized;
  useEffect(() => {
    const id = token.current;
    if (dirty) drafts?.add(id);
    return () => { drafts?.delete(id); };
  }, [dirty, drafts]);
  const markSaved = useCallback((next: T = value) => {
    drafts?.delete(token.current);
    setSaved(JSON.stringify(next));
    setSavedOnce(true);
  }, [drafts, value]);
  const confirmDiscard = () => !dirty || window.confirm(t('owner.discard'));
  return { dirty, savedOnce, markSaved, confirmDiscard, lastSaved };
}

export function SaveStatus({ dirty, savedOnce }: { dirty: boolean; savedOnce: boolean }) {
  const t = useT();
  return dirty || savedOnce ? <p className={`save-status ${dirty ? '' : 'save-status--saved'}`} role="status">{t(dirty ? 'owner.unsaved' : 'owner.saved')}</p> : null;
}

/** Sticky bottom save bar (Design A): status line, then Discard + one big Save. Sits above the phone
 *  tab bar (`.sx-savebar` in settings.css). `onDiscard` restores the last saved draft. */
export function SaveBar({ dirty, savedOnce, saving, disabled, onDiscard, saveLabel }: { dirty: boolean; savedOnce: boolean; saving?: boolean; disabled?: boolean; onDiscard?: () => void; saveLabel?: string }) {
  const t = useT();
  return (
    <div className="sx-savebar">
      <div className="sx-savebar__status"><SaveStatus dirty={dirty} savedOnce={savedOnce} /></div>
      <div className="sx-savebar__actions">
        {onDiscard ? <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>{t('owner.discardChanges')}</Button> : null}
        <Button type="submit" loading={saving} disabled={disabled}>{saveLabel ?? t('common.save')}</Button>
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) { ref.current?.focus(); ref.current?.scrollIntoView({ block: 'center' }); }
  }, [message]);
  return message ? <div ref={ref} tabIndex={-1}><Alert tone="danger">{message}</Alert></div> : null;
}

export function LoadError({ retry }: { retry?: () => void }) {
  const t = useT();
  return <Alert tone="danger" action={<Button variant="secondary" onClick={retry ?? (() => window.location.reload())}>{t('common.retry')}</Button>}>{t('owner.loadError')}</Alert>;
}

/**
 * Go-live checklist on the Orders tab. Every step is derived from live data, so it ticks itself off;
 * the card shows while the branch has never had an order and is replaced once by a first-order banner.
 */
export function GoLiveCard() {
  const t = useT();
  const { business, branch, can } = useDash();
  const allowed = can('catalog');
  const base = `/business/${business.id}/${branch.id}`;
  const orders = useCollection<Order>(allowed ? 'orders' : null, [where('businessId', '==', business.id), where('branchId', '==', branch.id), limit(2)], [branch.id]);
  const products = useCollection<Product>(allowed ? `businesses/${business.id}/branches/${branch.id}/products` : null, [where('archived', '==', false), limit(1)], [branch.id]);
  const celebratedKey = `qareeb.firstOrder.${branch.id}`;
  // Read once per visit: the banner stays for the visit that first sees the order, then never again.
  const [celebratedBefore] = useState(() => { try { return localStorage.getItem(celebratedKey) === '1'; } catch { return false; } });
  const orderCount = orders.data.length;
  const celebrate = orderCount === 1 && !celebratedBefore;
  useEffect(() => {
    if (!orders.loading && orderCount === 1) { try { localStorage.setItem(celebratedKey, '1'); } catch { /* Shown every visit if storage is blocked. */ } }
  }, [orders.loading, orderCount, celebratedKey]);
  if (!allowed || orders.loading || orders.error) return null;
  if (orderCount > 0) {
    return celebrate ? <div className="golive-first" role="status">
      <span className="golive-first__burst" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <i key={i} style={{ '--a': `${i * 45 + 10}deg` } as CSSProperties} />)}</span>
      <strong>{t('golive.firstOrder')}</strong>
    </div> : null;
  }
  if (products.loading) return null;
  const approval = branch.approval !== 'approved' ? branch.approval : business.approval;
  const steps = [
    { key: 'setup', label: t('golive.stepSetup'), done: branch.lat !== undefined && branch.lng !== undefined && (branch.pickupEnabled || branch.deliveryEnabled || (business.type === 'restaurant' && branch.dineInEnabled !== false)), to: `${base}/branch`, action: 'golive.setSetup' as const },
    { key: 'hours', label: t('golive.stepHours'), done: Object.values(branch.hours).some((day) => day.length > 0), to: `${base}/branch#bs-hours`, action: 'golive.setHours' as const },
    { key: 'product', label: t('golive.stepProduct'), done: products.data.length > 0, to: `${base}/catalog`, action: 'golive.addProduct' as const },
  ];
  const ownerDone = steps.every((s) => s.done);
  const approved = approval === 'approved';
  const viewStore = <Link className="btn btn--secondary" target="_blank" to={`/b/${business.id}/${branch.id}`}><Icon name="eye" size={18} />{t('golive.viewStore')}</Link>;
  const approvalPill = <span className={`golive__pill golive__pill--${approval === 'pending' ? 'wait' : 'danger'}`}>{approval === 'pending' ? t(ownerDone ? 'golive.waiting' : 'golive.inReview') : t(`admin.state.${approval}`)}</span>;
  if (ownerDone && approved) {
    return <section className="golive golive--live" aria-labelledby="golive-title">
      <h2 id="golive-title">{t('golive.live')}</h2>
      <div className="golive__actions">
        <Link className="btn btn--primary" to={`${base}/qr`}><Icon name="qr" size={18} />{t('golive.qr')}</Link>
        {viewStore}
      </div>
    </section>;
  }
  if (ownerDone) {
    return <section className="golive golive--waiting" aria-label={t('golive.title')}>
      <div className="golive__row"><strong>{t('golive.ready')}</strong>{approvalPill}</div>
      {viewStore}
    </section>;
  }
  const next = steps.find((s) => !s.done)!;
  const doneCount = steps.filter((s) => s.done).length + (approved ? 1 : 0);
  return <section className="golive" aria-labelledby="golive-title">
    <div className="golive__head"><h2 id="golive-title">{t('golive.title')}</h2><span className="golive__count">{t('golive.progress', { done: doneCount, total: 4 })}</span></div>
    <div className="golive__meter" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} className={i < doneCount ? 'on' : undefined} />)}</div>
    <ol className="golive__steps">
      {steps.map((s) => s === next
        ? <li key={s.key} className="golive__step golive__step--next"><span className="golive__tick" /><span className="golive__label">{s.label}</span><Link className="btn btn--primary" to={s.to}>{t(s.action)}</Link></li>
        : <li key={s.key} className={`golive__step${s.done ? ' golive__step--done' : ''}`}><Link to={s.to} className="golive__link"><span className="golive__tick">{s.done ? <Icon name="check" size={14} /> : null}</span><span className="golive__label">{s.label}</span><Icon name="chevron" size={18} directional className="icon golive__chev" /></Link></li>)}
      <li className={`golive__step${approved ? ' golive__step--done' : ''}`}><span className="golive__tick">{approved ? <Icon name="check" size={14} /> : null}</span><span className="golive__label">{t('golive.stepApproval')}</span>{approved ? null : approvalPill}</li>
    </ol>
  </section>;
}
