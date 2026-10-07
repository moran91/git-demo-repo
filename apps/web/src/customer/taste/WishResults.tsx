import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { evaluateOpen, priceLine, type DishIndexDoc, type DishIndexEntry, type MealItem, type NoFit, type ReasonCode, type Refine } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { ApiError, call } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { money } from '@/lib/format';
import { Button, ConfirmDialog, Dialog, Skeleton, Stepper, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import type { PublicBranch } from '../hooks';
import { StorageImage } from '../StorageImage';
import { defaultLine, fillCart, loadPlace, needsReplace } from './cartFill';
import { localTaste, useTaste } from './useTaste';
import { placeName } from './place';
import './taste.css';

interface ServerMeal { branchId: string; items: MealItem[]; title?: string; reason: ReasonCode; source: 'ai' | 'rules' }
interface Answer { meals: ServerMeal[]; noFit: NoFit; source: 'ai' | 'rules'; party: number; budgetAgorot?: number }
/** A meal resolved against the live dish indexes at render time. */
interface LiveMeal extends ServerMeal { place: string; branch: PublicBranch; dishes: Array<{ productId: string; qty: number; entry: DishIndexEntry }>; total: number; from: boolean }

const SPICY = /חריף|حار|spicy|hot/i;

/** The "ask Qareeb" row at the top of search results. */
export function AskRow({ query, onAsk }: { query: string; onAsk: () => void }) {
  const t = useT();
  return (
    <button type="button" className="task" onClick={onAsk}>
      <span className="task__mark" aria-hidden="true"><Icon name="star" size={20} /></span>
      <span className="task__text"><strong>{t('taste.wish.ask')}</strong><span>{t('taste.wish.askFor', { q: query })}</span></span>
      <Icon name="chevron" directional size={18} />
    </button>
  );
}

/**
 * The answer to a wish: two meals (names, prices and photos from the live menus, "open" re-checked
 * now), refine chips, and the meal sheet. Asking without AI consent first offers a one-line consent;
 * declining gets the code-built meals and sends nothing to the AI.
 */
export function WishResults({ wish, askId, restaurants, indexes, cityId, now, onShowDishes }: { wish: string; askId: number; restaurants: PublicBranch[]; indexes: Map<string, DishIndexDoc>; cityId: string; now: Date; onShowDishes: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const taste = useTaste();
  const [state, setState] = useState<{ status: 'consent' | 'loading' | 'done' | 'limited' | 'error'; answer?: Answer }>({ status: 'loading' });
  const [open, setOpen] = useState<LiveMeal | null>(null);
  const [declined, setDeclined] = useState(false);
  const branches = useMemo(() => new Map(restaurants.map((b) => [b.id, b])), [restaurants]);
  const aiConsent = taste.doc?.consent?.ai === true;

  const resolve = (meals: ServerMeal[]): LiveMeal[] => {
    const out: LiveMeal[] = [];
    for (const m of meals) {
      const branch = branches.get(m.branchId);
      const idx = indexes.get(m.branchId);
      if (!branch || !idx || branch.ordersPaused || !evaluateOpen(now, branch.hours, branch.hoursOverrides ?? []).open) continue;
      const dishes = m.items.map((i) => ({ ...i, entry: idx.dishes[i.productId]! })).filter((d) => d.entry && d.entry.available);
      if (dishes.length === 0) continue;
      out.push({ ...m, branch, place: placeName(branch, restaurants, L), dishes, total: dishes.reduce((s, d) => s + d.entry.priceAgorot * d.qty, 0), from: dishes.some((d) => d.entry.fromPrice || d.entry.needsChoice) });
    }
    return out;
  };

  // Only the latest request may set the answer: a slower earlier one (a quick refine tap) is dropped.
  const latest = useRef(0);
  const run = async (ai: boolean, refine?: Refine, prev?: Answer) => {
    const id = ++latest.current;
    setState({ status: 'loading' });
    const local = localTaste.get().doc;
    const live = prev ? resolve(prev.meals) : [];
    try {
      const answer = await call<Answer>('suggestMeals', {
        wish, locale, cityId,
        ...(taste.signedIn ? {} : { ai, ...(ai && local?.quiz ? { anon: { ...(local.quiz.party ? { party: local.quiz.party } : {}), pairs: local.quiz.pairs } } : {}) }),
        ...(refine ? { refine, prev: { branchIds: live.map((m) => m.branchId).slice(0, 4), ...(live.length ? { minTotalAgorot: Math.min(...live.map((m) => m.total)) } : {}) } } : {}),
      });
      if (id === latest.current) setState({ status: 'done', answer });
    } catch (e) {
      if (id === latest.current) setState({ status: e instanceof ApiError && e.code === 'rate_limited' ? 'limited' : 'error' });
    }
  };

  // A new ask (tap or enter) starts here. Without AI consent the customer is asked once per visit.
  useEffect(() => {
    if (taste.loading) return;
    if (!aiConsent && !declined) setState({ status: 'consent' });
    else void run(aiConsent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askId, taste.loading]);

  // Consent given elsewhere meanwhile (the sign-in merge, the knows-me page): answer with it.
  useEffect(() => {
    if (state.status === 'consent' && aiConsent) void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConsent, state.status]);

  if (state.status === 'consent') {
    return (
      <div className="twish">
        <div className="twish__consent">
          <p>{t('taste.wish.consent')}</p>
          <Button size="sm" onClick={async () => {
            try {
              // The consent effect above sends the wish once the new consent arrives.
              await taste.actions.setConsent({ orders: taste.doc?.consent?.orders ?? true, learn: taste.doc?.consent?.learn ?? false, ai: true });
            } catch (e) {
              toast(t(errorKey(e)), 'danger');
            }
          }}>{t('taste.wish.consentYes')}</Button>
          <Button size="sm" variant="secondary" onClick={() => { setDeclined(true); void run(false); }}>{t('taste.wish.consentNo')}</Button>
        </div>
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="twish" aria-busy="true">
        <p className="twish__note" role="status">{t('taste.wish.loading')}</p>
        <div className="twish__albums">
          {[0, 1].map((i) => <div key={i} className="talbum talbum--skeleton"><Skeleton height={140} radius={12} /><Skeleton height={18} width="60%" /><Skeleton height={14} width="40%" /></div>)}
        </div>
      </div>
    );
  }
  if (state.status === 'limited' || state.status === 'error') {
    return <div className="twish"><p className="twish__note" role="status">{state.status === 'limited' ? t('taste.wish.rateLimited') : t('common.errorGeneric')}</p></div>;
  }

  const answer = state.answer!;
  const meals = resolve(answer.meals);
  const note = answer.noFit === 'closed' || (meals.length === 0 && answer.meals.length > 0) ? t('taste.wish.closed')
    : answer.noFit === 'budget' && answer.budgetAgorot ? t('taste.wish.budget', { budget: money(answer.budgetAgorot, locale) })
    : meals.length === 0 ? t('taste.wish.none') : null;
  const ai = aiConsent;
  return (
    <section className="twish" aria-live="polite">
      <div className="twish__head">
        {note ? <p className="twish__note">{note}</p> : <span />}
        {answer.source === 'ai' && meals.some((m) => m.source === 'ai') ? <span className="badge badge--muted"><Icon name="star" size={12} />{t('taste.wish.ai')}</span> : null}
      </div>
      {meals.length ? (
        <div className="twish__albums">
          {meals.map((m) => <Album key={`${m.branchId}-${m.items.map((i) => i.productId).join('.')}`} meal={m} onOpen={() => setOpen(m)} />)}
        </div>
      ) : null}
      <div className="twish__chips">
        {meals.length ? <button type="button" className="twish__chip" onClick={() => void run(ai, 'cheaper', answer)}>{t('taste.wish.cheaper')}</button> : null}
        {meals.length ? <button type="button" className="twish__chip" onClick={() => void run(ai, 'other', answer)}>{t('taste.wish.otherPlace')}</button> : null}
        {!SPICY.test(wish) ? <button type="button" className="twish__chip" onClick={() => void run(ai, 'spicier', answer)}>{t('taste.wish.spicier')}</button> : null}
        <button type="button" className="twish__chip" onClick={onShowDishes}>{t('taste.wish.all')}</button>
      </div>
      {open ? <MealSheet meal={open} cityId={cityId} onClose={() => setOpen(null)} placeName={open.place} /> : null}
    </section>
  );
}

function reasonText(t: ReturnType<typeof useT>, m: LiveMeal): string {
  if (m.reason === 'you_picked') {
    const type = m.dishes.find((d) => d.entry.dishType)?.entry.dishType;
    return type ? t('taste.reason.you_picked', { type: t(`dishType.${type}`) }) : t('taste.reason.fits_wish');
  }
  return t(`taste.reason.${m.reason}`);
}

function Album({ meal, onOpen }: { meal: LiveMeal; onOpen: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const place = meal.place;
  const photos = meal.dishes.map((d) => d.entry.imagePath).filter((p): p is string => !!p);
  const shown = photos.slice(0, 3);
  const extra = meal.dishes.length - 3;
  const price = money(meal.total, locale);
  return (
    <button type="button" className="talbum" onClick={onOpen}>
      <span className={`talbum__tri talbum__tri--${Math.max(1, shown.length)}`} aria-hidden="true">
        {shown.length ? shown.map((p, i) => (
          <span key={p}>
            <StorageImage path={p} alt="" fallbackLabel="" />
            {i === 2 && extra > 0 ? <span className="talbum__more">+{extra}</span> : null}
          </span>
        )) : <span><StorageImage path={null} alt="" fallbackLabel="" fallbackMark={place} /></span>}
      </span>
      <span className="talbum__line">
        <span className="talbum__title">{meal.title ?? t('taste.wish.mealFrom', { place })}</span>
        <bdi className="talbum__price">{meal.from ? t('cravings.from', { price }) : price}</bdi>
      </span>
      <span className="talbum__why">{place} · {reasonText(t, meal)} · {meal.dishes.map((d) => `${d.qty} × ${L(d.entry.name, meal.branch.businessDefaultLocale)}`).join(t('taste.listSep'))}</span>
    </button>
  );
}

/**
 * One meal, editable: tap a photo to leave a dish out, change amounts, then add it all to the cart.
 * The sheet loads the dishes' menu entries, so the total is exactly what the cart will hold (the
 * cheapest size plus paid required options), not the index's starting price.
 */
function MealSheet({ meal, cityId, placeName, onClose }: { meal: LiveMeal; cityId: string; placeName: string; onClose: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const navigate = useNavigate();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(meal.dishes.map((d) => [d.productId, d.qty])));
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | (() => void)>(null);
  const [place, setPlace] = useState<Awaited<ReturnType<typeof loadPlace>> | null>(null);
  useEffect(() => {
    let live = true;
    loadPlace(meal.branch, meal.dishes.map((d) => d.productId)).then((p) => { if (live) setPlace(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [meal]);

  // The real line for a dish at its amount, or null when the menu no longer allows it.
  const lineFor = (productId: string) => {
    const p = place?.products.get(productId);
    if (!p) return place ? null : undefined;
    const filled = defaultLine(p, qty[productId] ?? 1);
    const priced = filled ? priceLine(p, filled.line) : null;
    return filled && priced?.line ? { filled, total: priced.line.lineTotalAgorot } : null;
  };
  const gone = new Set(meal.dishes.filter((d) => lineFor(d.productId) === null).map((d) => d.productId));
  const kept = meal.dishes.filter((d) => !off.has(d.productId) && !gone.has(d.productId));
  const exact = !!place;
  const total = kept.reduce((s, d) => s + (lineFor(d.productId)?.total ?? d.entry.priceAgorot * (qty[d.productId] ?? 1)), 0);
  const hero = meal.dishes.find((d) => d.entry.imagePath)?.entry.imagePath;
  const toggle = (id: string) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else if (kept.length > 1) next.add(id);
    else { toast(t('taste.meal.pickOne')); return; }
    setOff(next);
  };
  const add = async () => {
    if (!place) return;
    setBusy(true);
    try {
      const lines = kept.map((d) => lineFor(d.productId)?.filled ?? null);
      if (lines.some((l) => !l) || kept.length === 0) {
        toast(t('taste.band.reorderFailed'));
        navigate(`/b/${meal.branch.businessId}/${meal.branch.id}`);
        return;
      }
      const go = () => {
        fillCart(place.business, meal.branch, cityId, lines.filter((l) => !!l));
        void call('trackTaste', { event: 'meal_added' }).catch(() => undefined);
        toast(t('taste.meal.added'));
        onClose();
      };
      if (needsReplace(place.business, meal.branch)) setConfirm(() => go);
      else go();
    } catch (e) {
      toast(t(errorKey(e)), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const totalText = money(total, locale);
  return (
    <Dialog open onClose={onClose} title={meal.title ?? t('taste.wish.mealFrom', { place: placeName })} footer={<Button block loading={busy || !exact} disabled={kept.length === 0} onClick={() => void add()}>{t('taste.meal.add', { total: totalText })}</Button>}>
      <div className="tmeal">
        <div className="tmeal__hero">
          <StorageImage path={hero} alt="" fallbackLabel="" fallbackMark={placeName} />
          <span className="tmeal__place">{placeName}</span>
        </div>
        <ul className="tmeal__list">
          {meal.dishes.map((d) => {
            const name = L(d.entry.name, meal.branch.businessDefaultLocale);
            const unavailable = gone.has(d.productId);
            const isOff = off.has(d.productId) || unavailable;
            const line = lineFor(d.productId);
            const unit = line ? line.total / Math.max(1, line.filled.line.quantity) : d.entry.priceAgorot;
            return (
              <li key={d.productId} className={`tmeal__dish ${isOff ? 'is-off' : ''}`}>
                <button type="button" className="tmeal__thumb" onClick={() => toggle(d.productId)} disabled={unavailable} aria-pressed={!isOff} aria-label={isOff ? t('taste.meal.restore', { name }) : t('taste.meal.remove', { name })}>
                  <StorageImage path={d.entry.imagePath} alt="" fallbackLabel="" fallbackMark={name} />
                  <span className="tmeal__mark" aria-hidden="true"><Icon name={isOff ? 'plus' : 'check'} size={14} /></span>
                </button>
                <span className="tmeal__name">
                  {name}
                  <span className="tmeal__sub">
                    {unavailable ? t('common.unavailable') : <bdi className="price">{line ? money(unit, locale) : t('cravings.from', { price: money(d.entry.priceAgorot, locale) })}</bdi>}
                    {line && line.filled.meta.modifierNames.length ? ` · ${line.filled.meta.modifierNames.map((m) => L(m)).join(t('taste.listSep'))}` : ''}
                  </span>
                </span>
                {isOff ? <span /> : <Stepper size="sm" value={qty[d.productId] ?? 1} min={1} max={10} onChange={(v) => setQty({ ...qty, [d.productId]: v })} decLabel={t('product.decrease')} incLabel={t('product.increase')} />}
              </li>
            );
          })}
        </ul>
        <div className="tmeal__sum"><span>{t('common.total')}</span><strong><bdi className="money">{totalText}</bdi></strong></div>
      </div>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => { const go = confirm; setConfirm(null); go?.(); }} title={t('product.replaceCartTitle')} body={t('product.replaceCartBody', { business: placeName })} confirmLabel={t('product.replaceCartConfirm')} danger />
    </Dialog>
  );
}
