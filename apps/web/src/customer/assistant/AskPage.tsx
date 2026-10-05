import { useDeferredValue, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { EMPTY_CONVERSATION, afterAdd, homeView, matchScore, parseQuery, reply, respond, weightLineTotal, type AssistantData, type AssistantDish, type AssistantTurn, type Cart, type Chip, type Conversation, type RespondOptions } from '@qareeb/shared';
import { discoveryStore } from '@/lib/city';
import { cartStore, type CartState } from '@/lib/cart';
import { useI18n, useT } from '@/lib/i18n';
import { money } from '@/lib/format';
import { Icon } from '@/design/Icon';
import type { PublicBranch } from '../hooks';
import { AssistantCard, bidi } from './Cards';
import { loadConversation, saveConversation } from './conversation';
import { useAssistantData } from './useAssistantData';
import { useQuickAdd, type QuickAdd } from './useQuickAdd';
import './assistant.css';

/** What the home hands the chat: a typed message or a tapped chip, answered as the first message. */
export interface AskState {
  text?: string;
  chip?: Chip;
}

/** The menus get this long to load; then the first answer uses whatever has arrived. */
const WAIT_MS = 6000;

/** The assistant: a conversation that answers with cards you can add, plus live dish matches while typing. */
export function AskPage() {
  const t = useT();
  const { locale, L } = useI18n();
  const prefs = discoveryStore.use();
  const { data, branches, loading, signedIn } = useAssistantData(prefs.cityId);
  const quick = useQuickAdd(prefs.cityId, data.profile?.usualMode);
  const cart = cartStore.use();
  const inCart = useMemo(() => cart.cart?.lines.map((l) => l.productId) ?? [], [cart.cart]);
  const opts = useMemo<RespondOptions>(() => ({ signedIn, uiLang: locale, inCart }), [signedIn, locale, inCart]);
  const [conv, setConv] = useState<Conversation>(loadConversation);
  const [text, setText] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  // Messages waiting for the menus: one handed over from the home, then anything sent while loading.
  const [pending, setPending] = useState<AskState[]>(() => askStateOf(location.state));
  const [focusOnOpen] = useState(() => pending.length === 0);
  const [waited, setWaited] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const liveId = useId();
  // Answer once the menus are in; after the wait, with whatever menus have loaded, but never from
  // none: places without dishes would answer "nothing matches" or "nothing is open", both false.
  const ready = !loading || (waited && data.dishes.length > 0);
  const stalled = waited && !ready;

  const empty = conv.turns.length === 0;
  const starter = useMemo(() => (empty && pending.length === 0 && ready ? homeView(data, opts) : null), [empty, pending.length, ready, data, opts]);
  /** The greeting stays in the thread once the customer acts on it (an add, a chip, a message). */
  const withStarter = (c: Conversation): Conversation =>
    c.turns.length === 0 && starter ? { ...c, turns: [{ id: 't0', role: 'assistant', kind: 'none', text: starter.greeting, cards: starter.cards, chips: starter.chips }] } : c;

  const send = (input: string | Chip) => {
    if (!ready) setPending((q) => [...q, typeof input === 'string' ? { text: input } : { chip: input }]);
    else setConv((c) => respond(withStarter(c), input, data, opts));
  };

  if (pending.length && ready) {
    setPending([]);
    setConv((c) => pending.reduce((x, p) => respond(x, p.chip ?? p.text ?? '', data, opts), c));
  }
  useEffect(() => {
    if (!loading) return;
    const id = setTimeout(() => setWaited(true), WAIT_MS);
    return () => clearTimeout(id);
  }, [loading]);
  // The handed-over message is in state now; drop it from history so back/forward never sends it again.
  useEffect(() => {
    if (location.state) void navigate('.', { replace: true, state: null });
  }, [location.state, navigate]);
  useEffect(() => saveConversation(conv), [conv]);

  // Something was just added (here, from a sheet, or a quantity bump): offer one thing that goes with it.
  const onAdded = useEffectEvent((c: Cart, productId: string) => {
    setConv((x) => afterAdd(withStarter(x), { branchId: c.branchId, productId }, c.lines.map((l) => l.productId), data, locale));
  });
  useEffect(() => {
    let before = quantities(cartStore.get());
    const off = cartStore.subscribe(() => {
      const s = cartStore.get();
      const now = quantities(s);
      const added = s.cart?.lines.filter((l) => (now.get(l.lineId) ?? 0) > (before.get(l.lineId) ?? 0)).at(-1);
      before = now;
      if (s.cart && added) onAdded(s.cart, added.productId);
    });
    return () => {
      off();
    };
  }, []);

  // A new answer scrolls in from its question, so the line is read before the cards.
  const anchor = scrollAnchor(conv);
  useEffect(() => {
    if (!anchor) return;
    const el = threadRef.current?.querySelector(`[data-turn="${anchor}"]`);
    el?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [anchor]);

  const typed = useDeferredValue(text);
  const matches = useMemo(() => liveMatches(typed, data), [typed, data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    send(v);
    setText('');
    inputRef.current?.focus();
  };
  const addMatch = (d: AssistantDish) => {
    const b = branches.get(d.branchId);
    if (b) void quick.addItems(b, [{ productId: d.id, qty: 1 }]);
    setText('');
  };
  /** Usual lines that could not be reordered, named in the conversation's language (as afterAdd speaks). */
  const onDropped = (names: string[]) =>
    setConv((c0) => {
      const c = withStarter(c0);
      const lang = c.last?.request.lang ?? locale;
      return { ...c, turns: [...c.turns, { id: `t${c.turns.length}`, role: 'assistant', kind: 'none', text: reply('dropped', lang, { missing: names.join(', ') }, data.seed + c.turns.length), cards: [], chips: [] }] };
    });
  /** Back where the customer came from inside the app, else home. */
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    void (idx > 0 ? navigate(-1) : navigate('/'));
  };

  const waiting = pending.length > 0 || empty;
  const thinking = !ready && !stalled && waiting;
  const lastAssistant = [...conv.turns].reverse().find((x) => x.role === 'assistant');
  // Screen readers hear only the newest assistant line, not the whole thread again.
  const announce = stalled && waiting ? t('assistant.loading') : (lastAssistant?.text ?? starter?.greeting ?? '');
  const total = cartTotal(cart.cart);

  return (
    <div className="ask">
      <header className="ask__head">
        <button type="button" className="ask__icon" onClick={back} aria-label={t('assistant.back')}><Icon name="arrowBack" directional size={22} /></button>
        <h1 className="ask__title"><span className="ask__mark" aria-hidden="true">✦</span> {t('assistant.title')}</h1>
        {!empty ? <button type="button" className="ask__new" onClick={() => setConv(EMPTY_CONVERSATION)}>{t('assistant.newChat')}</button> : null}
      </header>
      <p className="visually-hidden" aria-live="polite">{announce}</p>
      <div className="ask__thread" ref={threadRef}>
        {starter ? <Bubble turn={{ id: 'start', role: 'assistant', kind: 'none', text: starter.greeting, cards: starter.cards, chips: starter.chips }} last data={data} branches={branches} quick={quick} onChip={send} onDropped={onDropped} /> : null}
        {conv.turns.map((turn) => (turn.role === 'user'
          ? <p key={turn.id} data-turn={turn.id} className="ask__user" dir="auto">{bidi(turn.text)}</p>
          : <Bubble key={turn.id} turn={turn} last={turn.id === lastAssistant?.id} data={data} branches={branches} quick={quick} onChip={send} onDropped={onDropped} />))}
        {pending.map((p, i) => <p key={`pending${i}`} className="ask__user" dir="auto">{bidi(p.chip?.label ?? p.text ?? '')}</p>)}
        {thinking ? <p className="ask__typing" role="status" aria-label={t('assistant.thinking')}><span /><span /><span /></p> : null}
        {stalled && waiting ? <p className="ask__line ask__line--status"><span className="ask__mark" aria-hidden="true">✦</span><span>{t('assistant.loading')}</span></p> : null}
      </div>
      <form className="ask__foot" onSubmit={submit}>
        {cart.cart && cart.cart.lines.length > 0 ? (
          <Link to="/cart" className="ask__cart">
            <Icon name="cart" size={20} />
            <span className="ask__cart-place">{L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale)}</span>
            <bdi className="ask__cart-total price">{money(total, locale)}</bdi>
            <span className="ask__cart-go">{t('assistant.toCart')}<Icon name="chevron" directional size={18} /></span>
          </Link>
        ) : null}
        {matches.length && text.trim() ? (
          <ul className="ask__live" aria-label={t('assistant.liveMatches')}>
            {matches.map((d, i) => {
              const b = branches.get(d.branchId);
              const name = L(d.entry.name, b?.businessDefaultLocale);
              return (
                <li key={`${d.branchId}/${d.id}`}>
                  <button type="button" onClick={() => addMatch(d)} aria-label={t('assistant.add', { name })} aria-describedby={`${liveId}-${i}`}>
                    <span className="ask__live-text">
                      <span className="ask__live-name">{name}</span>
                      <span className="ask__live-place" id={`${liveId}-${i}`}>{L(b?.businessName, b?.businessDefaultLocale)} <span className="visually-hidden">{money(d.entry.priceAgorot, locale)}</span></span>
                    </span>
                    {d.entry.fromPrice ? <span className="price">{bidi(t('assistant.from', { price: money(d.entry.priceAgorot, locale) }))}</span> : <bdi className="price">{money(d.entry.priceAgorot, locale)}</bdi>}
                    <span className="ask__live-add"><Icon name="plus" size={18} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="ask__box">
          <label className="ask__input">
            <span className="visually-hidden">{t('assistant.askLabel')}</span>
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('assistant.ask')} enterKeyHint="send" autoComplete="off" dir="auto" autoFocus={focusOnOpen} />
          </label>
          <button type="submit" className="ask__send" aria-label={t('assistant.send')} disabled={!text.trim()} onPointerDown={(e) => e.preventDefault()}><Icon name="arrow" directional size={22} /></button>
        </div>
      </form>
      {quick.layer}
    </div>
  );
}

function Bubble({ turn, last, data, branches, quick, onChip, onDropped }: { turn: AssistantTurn; last: boolean; data: AssistantData; branches: ReadonlyMap<string, PublicBranch>; quick: QuickAdd; onChip: (c: Chip) => void; onDropped: (names: string[]) => void }) {
  const t = useT();
  // Only the latest answer offers chips; older ones would answer a question no longer asked.
  const chips = last ? [...(turn.more ? [turn.more] : []), ...turn.chips] : [];
  return (
    <section className="ask__turn" data-turn={turn.id}>
      <p className="ask__line" dir="auto">
        <span className="ask__mark" aria-hidden="true">✦</span>
        <span>{bidi(turn.text)}{turn.signIn ? <> <Link to="/signin">{t('assistant.signIn')}</Link></> : null}</span>
      </p>
      {turn.cards.length ? <div className="ask__cards">{turn.cards.map((c, i) => <AssistantCard key={i} card={c} data={data} branches={branches} quick={quick} onDropped={onDropped} />)}</div> : null}
      {chips.length ? <div className="ask__chips">{chips.map((c, i) => <button key={i} type="button" className="ask__chip" onClick={() => onChip(c)}>{bidi(c.label)}</button>)}</div> : null}
    </section>
  );
}

function askStateOf(state: unknown): AskState[] {
  if (!state || typeof state !== 'object') return [];
  const s = state as AskState;
  return s.chip || (typeof s.text === 'string' && s.text.trim()) ? [s] : [];
}

/** The turn a new answer is scrolled to: the question it answers, or the turn itself (an upsell, a note). */
function scrollAnchor(conv: Conversation): string | undefined {
  const last = conv.turns.at(-1);
  const before = conv.turns.at(-2);
  return last?.role === 'assistant' && before?.role === 'user' ? before.id : last?.id;
}

function quantities(s: CartState): Map<string, number> {
  return new Map(s.cart?.lines.map((l) => [l.lineId, l.requestedGrams ?? l.quantity]) ?? []);
}

/** The cart at the prices it was added at (checkout re-quotes); weighed lines are estimates. */
function cartTotal(cart: Cart | null): number {
  return cart?.lines.reduce((sum, l) => sum + (l.requestedGrams ? weightLineTotal(l.expectedUnitPriceAgorot, l.requestedGrams) : l.expectedUnitPriceAgorot * l.quantity), 0) ?? 0;
}

/** As-you-type: the closest dishes at open places (exact, start, lexicon or sound matches only). */
function liveMatches(text: string, data: AssistantData): AssistantDish[] {
  if (text.trim().length < 2) return [];
  const q = parseQuery(text);
  if (!q) return [];
  const out: Array<{ d: AssistantDish; score: number }> = [];
  for (const d of data.dishes) {
    if (!data.places.get(d.branchId)?.open) continue;
    const m = matchScore(q, d.search);
    if (m && m.level <= 4) out.push({ d, score: m.score });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 5).map((x) => x.d);
}
