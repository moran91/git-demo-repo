import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { EMPTY_CONVERSATION, afterAdd, homeView, matchScore, parseQuery, respond, weightLineTotal, type AssistantData, type AssistantDish, type AssistantTurn, type Cart, type Chip, type Conversation, type RespondOptions } from '@qareeb/shared';
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
  const [pending, setPending] = useState<AskState | null>(() => askStateOf(location.state));
  const [focusOnOpen] = useState(() => pending === null);
  const [waited, setWaited] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const ready = !loading || waited;

  const send = (input: string | Chip) => setConv((c) => respond(c, input, data, opts));

  // A message or chip from the home is answered once the menus are in (or the wait ran out).
  if (pending && ready) {
    setPending(null);
    const input = pending.chip ?? pending.text;
    if (input) send(input);
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
    setConv((x) => afterAdd(x, { branchId: c.branchId, productId }, c.lines.map((l) => l.productId), data, locale));
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
  };
  const addMatch = (d: AssistantDish) => {
    const b = branches.get(d.branchId);
    if (b) void quick.addItems(b, [{ productId: d.id, qty: 1 }]);
    setText('');
  };
  const onDropped = (names: string[]) =>
    setConv((c) => ({ ...c, turns: [...c.turns, { id: `t${c.turns.length}`, role: 'assistant', kind: 'none', text: t('assistant.missing', { names: names.join(', ') }), cards: [], chips: [] }] }));

  const empty = conv.turns.length === 0;
  const starter = empty && !pending && ready ? homeView(data, opts) : null;
  const thinking = !ready && (!!pending || empty);
  const lastAssistant = [...conv.turns].reverse().find((x) => x.role === 'assistant')?.id;
  const total = cartTotal(cart.cart);

  return (
    <div className="ask">
      <header className="ask__head">
        <Link to="/" className="ask__icon" aria-label={t('assistant.back')}><Icon name="arrowBack" directional size={22} /></Link>
        <h1 className="ask__title"><span className="ask__mark" aria-hidden="true">✦</span> {t('assistant.title')}</h1>
        {!empty ? <button type="button" className="ask__new" onClick={() => setConv(EMPTY_CONVERSATION)}>{t('assistant.newChat')}</button> : null}
      </header>
      <div className="ask__thread" ref={threadRef} aria-live="polite">
        {starter ? <Bubble turn={{ id: 'start', role: 'assistant', kind: 'none', text: starter.greeting, cards: starter.cards, chips: starter.chips }} last data={data} branches={branches} quick={quick} onChip={send} onDropped={onDropped} /> : null}
        {conv.turns.map((turn) => (turn.role === 'user'
          ? <p key={turn.id} data-turn={turn.id} className="ask__user" dir="auto">{bidi(turn.text)}</p>
          : <Bubble key={turn.id} turn={turn} last={turn.id === lastAssistant} data={data} branches={branches} quick={quick} onChip={send} onDropped={onDropped} />))}
        {thinking ? <p className="ask__typing" role="status" aria-label={t('assistant.thinking')}><span /><span /><span /></p> : null}
      </div>
      <form className="ask__foot" onSubmit={submit}>
        {cart.cart && cart.cart.lines.length > 0 ? (
          <Link to="/cart" className="ask__cart">
            <Icon name="cart" size={20} />
            <span className="ask__cart-place">{L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale)}</span>
            <span className="ask__cart-total price"><bdi dir="ltr">{money(total, locale)}</bdi></span>
            <span className="ask__cart-go">{t('assistant.toCart')}<Icon name="chevron" directional size={18} /></span>
          </Link>
        ) : null}
        {matches.length && text.trim() ? (
          <ul className="ask__live" aria-label={t('assistant.liveMatches')}>
            {matches.map((d) => {
              const b = branches.get(d.branchId);
              const name = L(d.entry.name, b?.businessDefaultLocale);
              return (
                <li key={`${d.branchId}/${d.id}`}>
                  <button type="button" onClick={() => addMatch(d)} aria-label={t('assistant.add', { name })}>
                    <span className="ask__live-text">
                      <span className="ask__live-name">{name}</span>
                      <span className="ask__live-place">{L(b?.businessName, b?.businessDefaultLocale)}</span>
                    </span>
                    <span className="price">{d.entry.fromPrice ? bidi(t('assistant.from', { price: money(d.entry.priceAgorot, locale) })) : <bdi dir="ltr">{money(d.entry.priceAgorot, locale)}</bdi>}</span>
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
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('assistant.ask')} enterKeyHint="send" autoComplete="off" dir="auto" autoFocus={focusOnOpen} />
          </label>
          <button type="submit" className="ask__send" aria-label={t('assistant.send')} disabled={!text.trim()}><Icon name="arrow" directional size={22} /></button>
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
      {chips.length ? <div className="ask__chips" role="group">{chips.map((c, i) => <button key={i} type="button" className="ask__chip" onClick={() => onChip(c)}>{bidi(c.label)}</button>)}</div> : null}
    </section>
  );
}

function askStateOf(state: unknown): AskState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as AskState;
  return s.chip || (typeof s.text === 'string' && s.text.trim()) ? s : null;
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
