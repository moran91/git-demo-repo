import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { deriveTaste, splitDishKey, type KnowsItem } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { errorKey } from '@/lib/errors';
import { formatLocalDateTime } from '@/lib/format';
import { Button, ConfirmDialog, Skeleton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import { useDishIndexes } from '../dishIndex';
import { tasteSession, useTaste, useTasteHistory } from './useTaste';
import './taste.css';

/**
 * Everything Qareeb learned, in three groups (told, from orders, from ratings), each item removable;
 * the orders pause switch, the two opt-in consents, what goes to the AI, and "delete everything".
 * Works signed out too, for the picks kept on this device.
 */
export function KnowsPage() {
  const t = useT();
  const { L, locale } = useI18n();
  const navigate = useNavigate();
  const taste = useTaste();
  const history = useTasteHistory();
  const session = tasteSession.use();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = useMemo(() => new Date(), []);
  const derived = useMemo(() => deriveTaste({ doc: taste.doc, orders: history.orders, feedback: history.feedback, now }), [taste.doc, history.orders, history.feedback, now]);
  const branchIds = [...new Set(derived.items.flatMap((i) => ('branchId' in i ? [i.branchId] : [])))];
  const { indexes } = useDishIndexes(branchIds);

  useEffect(() => {
    if (!session.knowsFocus) return;
    const el = document.getElementById(`know-${session.knowsFocus}`);
    el?.scrollIntoView({ block: 'center' });
    const id = window.setTimeout(() => tasteSession.set({ knowsFocus: null }), 4000);
    return () => window.clearTimeout(id);
  }, [session.knowsFocus, derived.items.length]);

  if (taste.loading) return <div className="stack" aria-busy="true"><Skeleton height={32} width="50%" /><Skeleton height={120} radius={16} /></div>;
  const consent = taste.doc?.consent;
  const suppressed = taste.doc?.suppressed ?? [];

  const dishName = (branchId: string, productId: string) => {
    const e = indexes.get(branchId)?.dishes[productId];
    return e ? L(e.name) : t('taste.item.gone');
  };
  const label = (i: KnowsItem): string => {
    switch (i.source) {
      case 'told':
        if (i.key === 'party') return t(`taste.party.${(i as Extract<KnowsItem, { key: 'party' }>).party}`);
        { const it = i as Extract<KnowsItem, { dishType: unknown }>; return t(it.liked ? 'taste.item.likes' : 'taste.item.less', { type: t(`dishType.${it.dishType}`) }); }
      case 'orders':
        if (i.key.startsWith('daypart:')) return t(`taste.summary.daypart.${(i as Extract<KnowsItem, { daypart: unknown }>).daypart}`);
        { const [b, p] = splitDishKey(i.key.slice('usual:'.length)); return t('taste.item.usual', { dish: dishName(b, p) }); }
      case 'rated': {
        const loved = i.key.startsWith('loved:');
        const [b, p] = splitDishKey(i.key.slice(loved ? 'loved:'.length : 'notAgain:'.length));
        return t(loved ? 'taste.item.loved' : 'taste.item.notAgain', { dish: dishName(b, p) });
      }
    }
  };
  const remove = async (key: string) => {
    try {
      await taste.actions.setSuppressed([...suppressed, key]);
      toast(t('taste.knows.removed'));
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    }
  };
  const setConsent = async (patch: Partial<{ orders: boolean; learn: boolean; ai: boolean }>) => {
    try {
      await taste.actions.setConsent({ orders: consent?.orders ?? true, learn: consent?.learn ?? false, ai: consent?.ai ?? false, ...patch });
      toast(t('common.saved'));
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    }
  };

  const group = (source: KnowsItem['source'], title: string) => {
    const items = derived.items.filter((i) => i.source === source);
    return (
      <section className="card tknows__group" aria-labelledby={`kg-${source}`}>
        <h2 id={`kg-${source}`}>{title}</h2>
        {items.length ? (
          <ul className="tknows__items">
            {items.map((i) => {
              const text = label(i);
              const less = (i.source === 'told' && 'liked' in i && !i.liked) || i.key.startsWith('notAgain:');
              return (
                <li key={i.key} id={`know-${i.key}`} className={`tknows__item ${less ? 'tknows__item--less' : ''} ${session.knowsFocus === i.key ? 'is-focus' : ''}`}>
                  <span>{text}</span>
                  <button type="button" className="tknows__remove" onClick={() => void remove(i.key)} aria-label={t('taste.knows.remove', { item: text })}><Icon name="x" size={16} /></button>
                </li>
              );
            })}
          </ul>
        ) : <p className="tknows__empty">{t('taste.knows.empty')}</p>}
        {source === 'told' && consent?.learn && !taste.doc?.quiz ? (
          <Button variant="secondary" size="sm" icon="heart" onClick={() => { tasteSession.set({ gameOpen: true }); navigate('/'); }} style={{ marginTop: 'var(--space-3)' }}>{t('taste.knows.play')}</Button>
        ) : null}
      </section>
    );
  };

  const ordersOn = consent?.orders ?? true;
  return (
    <div className="stack tknows">
      <h1>{t('taste.knows.title')}</h1>
      {!taste.signedIn ? <p className="muted" style={{ margin: 0 }}>{t('taste.knows.device')}</p> : null}
      <section className="card">
        <label className="tknows__switch">
          <span>{t('taste.knows.pause')}</span>
          <input type="checkbox" role="switch" checked={ordersOn} onChange={(e) => void setConsent({ orders: e.target.checked })} />
        </label>
        {!ordersOn ? <p className="muted" style={{ margin: 0 }}>{t('taste.knows.paused')}</p> : null}
      </section>
      {group('told', t('taste.knows.told'))}
      {group('orders', t('taste.knows.orders'))}
      {group('rated', t('taste.knows.rated'))}
      <section className="card stack--sm stack" aria-labelledby="k-ai">
        <h2 id="k-ai" style={{ margin: 0 }}>{t('taste.knows.aiTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>{consent?.ai ? t('taste.knows.aiBody') : t('taste.knows.aiOff')}</p>
        {consent?.ai ? (
          taste.doc?.lastAiSummary ? (
            <>
              <p className="tknows__summary">{taste.doc.lastAiSummary.text}</p>
              <span className="muted">{t('taste.knows.aiLast', { time: formatLocalDateTime(taste.doc.lastAiSummary.at, locale) })}</span>
            </>
          ) : <p className="tknows__empty">{t('taste.knows.aiNever')}</p>
        ) : null}
      </section>
      <section className="card" aria-labelledby="k-consent">
        <h2 id="k-consent" style={{ margin: '0 0 var(--space-2)' }}>{t('taste.knows.consent')}</h2>
        <label className="tknows__switch">
          <span>{t('taste.knows.learn')}</span>
          <input type="checkbox" role="switch" checked={consent?.learn ?? false} onChange={(e) => void setConsent({ learn: e.target.checked })} />
        </label>
        <label className="tknows__switch">
          <span>{t('taste.knows.ai')}</span>
          <input type="checkbox" role="switch" checked={consent?.ai ?? false} onChange={(e) => void setConsent({ ai: e.target.checked })} />
        </label>
      </section>
      <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>{t('taste.knows.deleteAll')}</Button>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await taste.actions.deleteAll();
            toast(t('taste.knows.deleted'));
            setConfirmDelete(false);
          } catch (e) {
            toast(t(errorKey(e)), 'danger');
          } finally {
            setBusy(false);
          }
        }}
        title={t('taste.knows.deleteAll')}
        body={t('taste.knows.deleteBody')}
        confirmLabel={t('common.delete')}
        danger
      />
    </div>
  );
}
