import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker } from 'react-router';
import { useT } from '@/lib/i18n';
import { Alert, Button } from '@/design/components';
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

export function GettingStarted() {
  const t = useT();
  const { business, branch, can } = useDash();
  const key = `qareeb.ownerGuide.${business.id}.${branch.id}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === 'hidden'; } catch { return false; } });
  const toggle = () => { setHidden(!hidden); try { localStorage.setItem(key, hidden ? 'shown' : 'hidden'); } catch { /* Optional preference. */ } };
  if (!can('catalog')) return <p className="muted">{t('owner.guideOrders')}</p>;
  const base = `/business/${business.id}/${branch.id}`;
  if (hidden) return <div><Button variant="ghost" icon="info" onClick={toggle}>{t('owner.showGuide')}</Button></div>;
  return <section className="card owner-guide stack" aria-labelledby="owner-guide-title">
    <div className="row row--between"><h2 id="owner-guide-title">{t('owner.guideTitle')}</h2><Button variant="ghost" size="sm" onClick={toggle}>{t('owner.hideGuide')}</Button></div>
    <p>{t('owner.guideBody')}</p>
    <div className="owner-guide__steps">
      <Link className="btn btn--secondary" to={`${base}/branch`}>{t('owner.stepBranch')}</Link>
      <Link className="btn btn--secondary" to={`${base}/catalog`}>{t('owner.stepCatalog')}</Link>
      <Link className="btn btn--secondary" target="_blank" to={`/b/${business.id}/${branch.id}`}>{t('owner.stepPreview')}</Link>
    </div>
    <p className="muted">{t('owner.guideOrders')}</p>
  </section>;
}
