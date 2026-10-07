import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { daypartOf, deriveTaste, dishKey, evaluateOpen, pickHomeBand, type BandDish, type DishIndexDoc, type DishVerdict, type Order } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { money } from '@/lib/format';
import { Button, ConfirmDialog, IconButton, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import type { PublicBranch } from '../hooks';
import { StorageImage } from '../StorageImage';
import { QuickAddUi, useQuickAdd } from '../CravingsHome';
import { fillCart, lineFromOrder, loadPlace, needsReplace } from './cartFill';
import { tasteSession, usePopular, useTaste, useTasteHistory } from './useTaste';
import { placeName } from './place';
import './taste.css';

/** Every available dish in the city's restaurants, with whether its place takes orders right now. */
export function useCityDishes(restaurants: PublicBranch[], indexes: Map<string, DishIndexDoc>, now: Date) {
  return useMemo(() => {
    const dishes: BandDish[] = [];
    const branches = new Map<string, PublicBranch>();
    for (const b of restaurants) {
      branches.set(b.id, b);
      const idx = indexes.get(b.id);
      if (!idx) continue;
      const open = evaluateOpen(now, b.hours, b.hoursOverrides ?? []).open && !b.ordersPaused;
      for (const [productId, entry] of Object.entries(idx.dishes)) dishes.push({ branchId: b.id, productId, entry, open });
    }
    return { dishes, branches };
  }, [restaurants, indexes, now]);
}

/** Opens the knows-me page at the entry that explains a suggestion. */
function useWhy() {
  const navigate = useNavigate();
  return (key?: string) => {
    tasteSession.set({ knowsFocus: key ?? null });
    navigate('/account/taste');
  };
}

/**
 * The personal band under the stories: "how was it?" after an order, else the usual with one new
 * dish to try, else what is popular in the village right now. Computed on the device from data the
 * home already loads; no AI and no extra calls.
 */
export function HomeBand({ restaurants, indexes, cityId, now }: { restaurants: PublicBranch[]; indexes: Map<string, DishIndexDoc>; cityId: string; now: Date }) {
  const t = useT();
  const { L, locale } = useI18n();
  const taste = useTaste();
  const history = useTasteHistory();
  const popular = usePopular(cityId);
  const { dishes, branches } = useCityDishes(restaurants, indexes, now);
  const quick = useQuickAdd(cityId);
  const why = useWhy();
  const [pinnedFeedback, setPinnedFeedback] = useState<string | null>(null);
  const [closedFeedback, setClosedFeedback] = useState<string[]>([]);

  const band = useMemo(() => {
    const derived = deriveTaste({ doc: taste.doc, orders: history.orders, feedback: history.feedback, now });
    return pickHomeBand({
      derived, orders: history.orders, ratedOrderIds: history.feedback.map((f) => f.orderId), ordersConsent: taste.doc?.consent?.orders ?? true,
      ignoreOrdersBefore: taste.doc?.ignoreOrdersBefore, dishes, popular: popular.data?.dayparts ?? null, now,
    });
  }, [taste.doc, history.orders, history.feedback, dishes, popular.data, now]);

  // Once shown, the feedback card stays until it is closed, even after the first answer saves.
  useEffect(() => {
    if (band.feedbackOrder && !pinnedFeedback && !closedFeedback.includes(band.feedbackOrder.id)) setPinnedFeedback(band.feedbackOrder.id);
  }, [band.feedbackOrder, pinnedFeedback, closedFeedback]);

  if (taste.loading || history.loading) return null;
  const feedbackOrder = pinnedFeedback ? (history.orders.find((o) => o.id === pinnedFeedback) ?? null) : null;
  if (feedbackOrder && branches.get(feedbackOrder.branchId)) {
    return (
      <div className="tband">
        <FeedbackCard order={feedbackOrder} branch={branches.get(feedbackOrder.branchId)!} index={indexes.get(feedbackOrder.branchId)} onDone={() => { setClosedFeedback((c) => [...c, feedbackOrder.id]); setPinnedFeedback(null); }} />
      </div>
    );
  }

  const openGame = () => tasteSession.set({ gameOpen: true });
  const showTell = !taste.doc?.quiz;
  const card = (d: BandDish, tag: 'popular' | 'new') => {
    const branch = branches.get(d.branchId)!;
    const name = L(d.entry.name, branch.businessDefaultLocale);
    const key = `${d.branchId}/${d.productId}`;
    return (
      <article key={key} className="tcard">
        <div className="tcard__photo">
          <StorageImage path={d.entry.imagePath} alt="" fallbackLabel="" fallbackMark={name} />
          {tag === 'new' ? <span className="tcard__tag tcard__tag--new">{t('taste.reason.new_for_you')}</span> : null}
        </div>
        <div className="tcard__body">
          <span className="tcard__name">{name}</span>
          <span className="tcard__place">{placeName(branch, branches.values(), L)}</span>
          <div className="tcard__row">
            <bdi className="tcard__price price">{d.entry.fromPrice ? t('cravings.from', { price: money(d.entry.priceAgorot, locale) }) : money(d.entry.priceAgorot, locale)}</bdi>
            <button type="button" className="tcard__add" onClick={() => void quick.start({ id: d.productId, branchId: d.branchId, branch })} disabled={quick.busy === key} aria-label={t('cravings.add', { name })}><Icon name="plus" size={20} /></button>
          </div>
        </div>
      </article>
    );
  };

  let content: React.ReactNode = null;
  if (band.usual && branches.get(band.usual.order.branchId)) {
    content = (
      <>
        <UsualCard order={band.usual.order as Order} branch={branches.get(band.usual.order.branchId)!} place={placeName(branches.get(band.usual.order.branchId)!, branches.values(), L)} index={indexes.get(band.usual.order.branchId)} cityId={cityId} onWhy={() => why(`usual:${dishKey(band.usual!.order.branchId, band.usual!.productId)}`)} />
        {band.tryPick ? (
          <div className="ttry">
            <span className="ttry__img"><StorageImage path={band.tryPick.entry.imagePath} alt="" fallbackLabel="" fallbackMark={L(band.tryPick.entry.name)} /></span>
            <span className="ttry__text">
              <span className="ttry__label">{t('taste.band.try')}</span>
              <span className="ttry__name">{L(band.tryPick.entry.name, branches.get(band.tryPick.branchId)?.businessDefaultLocale)} · {placeName(branches.get(band.tryPick.branchId)!, branches.values(), L)}</span>
            </span>
            <button type="button" className="tcard__add" onClick={() => { void call('trackTaste', { event: 'try_tap' }).catch(() => undefined); void quick.start({ id: band.tryPick!.productId, branchId: band.tryPick!.branchId, branch: branches.get(band.tryPick!.branchId)! }); }} aria-label={t('cravings.add', { name: L(band.tryPick.entry.name) })}><Icon name="plus" size={20} /></button>
          </div>
        ) : null}
      </>
    );
  } else if (band.popular.length) {
    content = (
      <>
        <div className="tband__head">
          <h2 className="tband__title">{t(`taste.band.popular.${daypartOf(now)}`)}</h2>
          {showTell ? <button type="button" className="tband__tell" onClick={openGame}><Icon name="heart" size={16} />{t('taste.band.tell')}</button> : null}
        </div>
        <div className="tband__duo">{band.popular.map((d) => card(d, band.tryPick && d.productId === band.tryPick.productId && d.branchId === band.tryPick.branchId && history.orders.length > 0 ? 'new' : 'popular'))}</div>
      </>
    );
  } else if (showTell) {
    content = <div className="tband__head"><span /><button type="button" className="tband__tell" onClick={openGame}><Icon name="heart" size={16} />{t('taste.band.tell')}</button></div>;
  }
  if (!content) return null;
  return (
    <div className="tband" aria-label={t('taste.knows.title')} role="region">
      {content}
      <QuickAddUi quick={quick} cityId={cityId} />
    </div>
  );
}

/** "Order again": the last order with the usual dish, rebuilt in the cart exactly as it was. */
function UsualCard({ order, branch, place, index, cityId, onWhy }: { order: Order; branch: PublicBranch; place: string; index?: DishIndexDoc; cityId: string; onWhy: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | (() => void)>(null);
  const lines = order.lines.filter((l) => !l.removed && !l.comboId);
  const photos = [...new Set(lines.map((l) => index?.dishes[l.productId]?.imagePath).filter((p): p is string => !!p))].slice(0, 3);

  const reorder = async () => {
    setBusy(true);
    try {
      const { business, products } = await loadPlace(branch, [...new Set(lines.map((l) => l.productId))]);
      const filled = lines.map((l) => { const p = products.get(l.productId); return p ? lineFromOrder(p, l) : null; });
      if (filled.some((f) => !f)) {
        toast(t('taste.band.reorderFailed'));
        navigate(`/b/${branch.businessId}/${branch.id}`);
        return;
      }
      const go = () => {
        fillCart(business, branch, cityId, filled.filter((f) => !!f));
        void call('trackTaste', { event: 'usual_reorder' }).catch(() => undefined);
        toast(t('taste.band.inCart'));
        navigate('/cart');
      };
      if (needsReplace(business, branch)) setConfirm(() => go);
      else go();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="tusual">
      <div className={`tusual__photos ${photos.length <= 1 ? 'tusual__photos--one' : ''}`}>
        {photos.length ? photos.map((p) => <StorageImage key={p} path={p} alt="" fallbackLabel="" />) : <StorageImage path={null} alt="" fallbackLabel="" fallbackMark={place} />}
      </div>
      <div className="tusual__body">
        <span className="tusual__label">{t('taste.reason.usual')}</span>
        <span className="tusual__place">{place}</span>
        <span className="tusual__lines">{lines.slice(0, 3).map((l) => `${l.quantity} × ${L(l.name)}`).join(t('taste.listSep'))}{lines.length > 3 ? ` ${t('taste.band.more', { n: lines.length - 3 })}` : ''}</span>
        <Button size="sm" className="tusual__go" icon="refresh" loading={busy} onClick={() => void reorder()}>{t('taste.band.again')}</Button>
      </div>
      <button type="button" className="tcard__why" onClick={onWhy} aria-label={t('taste.band.why')}>?</button>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => { const go = confirm; setConfirm(null); go?.(); }} title={t('product.replaceCartTitle')} body={t('product.replaceCartBody', { business: place })} confirmLabel={t('product.replaceCartConfirm')} danger />
    </article>
  );
}

/** "How was it?": loved / not again per dish, each tap saved at once; closing never asks again. */
function FeedbackCard({ order, branch, index, onDone }: { order: Order; branch: PublicBranch; index?: DishIndexDoc; onDone: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const [verdicts, setVerdicts] = useState<Record<string, DishVerdict>>({});
  const dishes = [...new Map(order.lines.filter((l) => !l.removed && !l.comboId).map((l) => [l.productId, l])).values()];
  const place = L(branch.businessName, branch.businessDefaultLocale);

  const save = async (data: { items?: Record<string, DishVerdict | 'none'>; forSomeoneElse?: boolean; dismissed?: boolean }) => {
    await call('saveDishFeedback', { orderId: order.id, items: data.items ?? {}, ...(data.forSomeoneElse ? { forSomeoneElse: true } : {}), ...(data.dismissed ? { dismissed: true } : {}) });
  };
  // The ref is the source of truth between taps, so an undo from a toast sees the latest answers.
  const current = useRef<Record<string, DishVerdict>>({});
  const apply = async (productId: string, value: DishVerdict | 'none') => {
    const before = current.current;
    const next = { ...before };
    if (value === 'none') delete next[productId];
    else next[productId] = value;
    current.current = next;
    setVerdicts(next);
    try {
      await save({ items: { [productId]: value } });
      if (value === 'not_again') toast(t('taste.fb.less'), 'default', { label: t('taste.fb.undo'), onClick: () => void apply(productId, 'none') });
      if (value !== 'none' && dishes.every((d) => next[d.productId])) {
        toast(t('taste.fb.thanks'));
        onDone();
      }
    } catch (e) {
      current.current = before;
      setVerdicts(before);
      toast(t(errorKey(e)), 'danger');
    }
  };
  const setVerdict = (productId: string, verdict: DishVerdict) => apply(productId, current.current[productId] === verdict ? 'none' : verdict);
  const close = async (forSomeoneElse = false) => {
    onDone();
    try {
      await save(forSomeoneElse ? { forSomeoneElse: true } : Object.keys(current.current).length ? {} : { dismissed: true });
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    }
  };

  return (
    <section className="tfb" aria-labelledby={`tfb-${order.id}`}>
      <div className="tfb__head">
        <h2 className="tfb__title" id={`tfb-${order.id}`}>{t('taste.fb.title', { place })}</h2>
        <IconButton icon="x" label={t('common.close')} onClick={() => void close()} />
      </div>
      <ul className="tfb__list">
        {dishes.map((l) => {
          const name = L(l.name ?? index?.dishes[l.productId]?.name ?? {}, branch.businessDefaultLocale);
          return (
            <li key={l.productId} className="tfb__dish">
              <span className="tfb__img"><StorageImage path={index?.dishes[l.productId]?.imagePath} alt="" fallbackLabel="" fallbackMark={name} /></span>
              <span className="tfb__name">{name}</span>
              <span className="tfb__verdicts" role="group" aria-label={name}>
                <button type="button" className="tfb__verdict" aria-pressed={verdicts[l.productId] === 'loved'} onClick={() => void setVerdict(l.productId, 'loved')}>{t('taste.fb.loved')}</button>
                <button type="button" className="tfb__verdict tfb__verdict--no" aria-pressed={verdicts[l.productId] === 'not_again'} onClick={() => void setVerdict(l.productId, 'not_again')}>{t('taste.fb.notAgain')}</button>
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="tfb__else" onClick={() => void close(true)}>{t('taste.fb.someoneElse')}</button>
    </section>
  );
}
