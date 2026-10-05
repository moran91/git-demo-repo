import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatGrams, resolveCard, type AssistantData, type AssistantPlace, type Card, type ResolvedCard } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { clockIn, money } from '@/lib/format';
import { Badge } from '@/design/components';
import { Icon } from '@/design/Icon';
import { StorageImage } from '../StorageImage';
import type { PublicBranch } from '../hooks';
import type { QuickAdd } from './useQuickAdd';

interface Props<K extends ResolvedCard['kind']> {
  r: Extract<ResolvedCard, { kind: K }>;
  branch: PublicBranch;
  showBranch: boolean;
  quick: QuickAdd;
  onDropped?: (names: string[]) => void;
}

/**
 * Money as the app's formatter writes it ("‏35 ‏₪", "₪35"), or as typed ("₪50", "150 ₪"), then any
 * other number or time ("4", "22:00").
 */
const RUN = /(\u200f?\d+(?:[.,]\d+)?[\s\u00a0]\u200f?₪|₪[\s\u00a0]?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?₪)|\d+(?:[.,:]\d+)*/g;

/**
 * Text with its numbers isolated. Money keeps the app's own look (a plain <bdi>, "₪ 35" as in the
 * product sheet and the cart); other numbers and times are kept left to right, so "ל-4" or "22:00"
 * never reorder around Hebrew or Arabic words.
 */
export function bidi(text: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(RUN)) {
    const i = m.index;
    if (i > at) out.push(text.slice(at, i));
    out.push(m[1] ? <bdi key={i}>{m[0]}</bdi> : <bdi key={i} dir="ltr">{m[0]}</bdi>);
    at = i + m[0].length;
  }
  if (!out.length) return text;
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * One assistant card: a dish, a ready meal, a deal or "your usual". A card whose dish, deal or place is
 * gone renders nothing. `onDropped` hears the names of usual lines that could not be reordered.
 */
export function AssistantCard({ card, data, branches, quick, onDropped }: { card: Card; data: AssistantData; branches: ReadonlyMap<string, PublicBranch>; quick: QuickAdd; onDropped?: (names: string[]) => void }) {
  const r = resolveCard(card, data);
  const branch = r ? branches.get(r.place.branchId) : undefined;
  if (!r || !branch) return null;
  // Another branch of the same business is listed too: name the branch, or two cards read the same.
  let showBranch = false;
  for (const b of branches.values()) if (b.businessId === branch.businessId && b.id !== branch.id) showBranch = true;
  switch (r.kind) {
    case 'dish': return <DishCard r={r} branch={branch} showBranch={showBranch} quick={quick} />;
    case 'meal': return <MealCard r={r} branch={branch} showBranch={showBranch} quick={quick} />;
    case 'deal': return <DealCard r={r} branch={branch} showBranch={showBranch} quick={quick} />;
    case 'usual': return <UsualCard r={r} branch={branch} showBranch={showBranch} quick={quick} {...(onDropped ? { onDropped } : {})} />;
  }
}

const placePath = (p: AssistantPlace) => `/b/${p.businessId}/${p.branchId}`;

export function PlaceLink({ place, branch, showBranch }: { place: AssistantPlace; branch: PublicBranch; showBranch: boolean }) {
  const { L } = useI18n();
  const name = L(place.name, branch.businessDefaultLocale);
  const branchName = L(branch.name, branch.businessDefaultLocale);
  return (
    <Link className="ac__place" to={placePath(place)}>
      {name}
      {showBranch && branchName && branchName !== name ? <span className="ac__branch">{branchName}</span> : null}
    </Link>
  );
}

/** The action of a card: add when the place takes orders, else when it opens. */
function Action({ place, busy, onAdd, text, label }: { place: AssistantPlace; busy: boolean; onAdd: () => void; text?: string; label?: string }) {
  const t = useT();
  if (!place.open) {
    return <Link className="ac__when" to={placePath(place)}>{place.opensInMin === undefined ? t('common.closed') : bidi(t('discovery.opensAt', { time: clockIn(place.opensInMin) }))}</Link>;
  }
  if (text) return <button type="button" className="btn btn--primary ac__cta" onClick={onAdd} disabled={busy} aria-busy={busy || undefined}>{text}</button>;
  return <button type="button" className="ac__add" onClick={onAdd} disabled={busy} aria-label={label} aria-busy={busy || undefined}><Icon name="plus" size={22} /></button>;
}

function Price({ agorot, from }: { agorot: number; from?: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const price = money(agorot, locale);
  return from ? <span className="ac__price price">{bidi(t('assistant.from', { price }))}</span> : <bdi className="ac__price price">{price}</bdi>;
}

function DishCard({ r, branch, showBranch, quick }: Props<'dish'>) {
  const t = useT();
  const { L } = useI18n();
  const { dish, place } = r;
  const name = L(dish.entry.name, branch.businessDefaultLocale);
  return (
    <article className={place.open ? 'ac ac--dish' : 'ac ac--dish ac--closed'}>
      <StorageImage path={dish.entry.imagePath} alt="" square fallbackLabel="" fallbackMark={name} className="ac__img" />
      <div className="ac__body">
        <h3 className="ac__name">{name}</h3>
        <PlaceLink place={place} branch={branch} showBranch={showBranch} />
        <Price agorot={dish.entry.priceAgorot} from={dish.entry.fromPrice} />
      </div>
      <Action place={place} busy={quick.busy === place.branchId} label={t('assistant.add', { name })} onAdd={() => void quick.addItems(branch, [{ productId: dish.id, qty: 1 }])} />
    </article>
  );
}

function MealCard({ r, branch, showBranch, quick }: Props<'meal'>) {
  const t = useT();
  const { L } = useI18n();
  const { basket, place, lines } = r;
  // A dish with a size or option to pick is priced at its cheapest, so the total is a starting price.
  // A combo has a fixed price (the engine still flags it as a choice; quick add no longer opens it).
  const from = basket.lines.some((l) => l.needsChoice && !l.comboId);
  return (
    <article className={place.open ? 'ac ac--meal' : 'ac ac--meal ac--closed'}>
      <header className="ac__head">
        <PlaceLink place={place} branch={branch} showBranch={showBranch} />
        <Price agorot={basket.totalAgorot} from={from} />
      </header>
      <ul className="ac__lines">
        {lines.map(({ line, name, imagePath }) => {
          const label = L(name, branch.businessDefaultLocale);
          return (
            <li key={line.comboId ?? line.productId}>
              <StorageImage path={imagePath} alt="" square fallbackLabel="" fallbackMark={label} className="ac__thumb" />
              <span className="ac__qty"><bdi dir="ltr">{line.qty}×</bdi></span>
              <span className="ac__line-name">{label}</span>
              {line.comboId ? <span className="ac__tag"><Badge tone="accent" icon="tag">{t('assistant.deal')}</Badge></span> : null}
            </li>
          );
        })}
      </ul>
      <Action place={place} busy={quick.busy === place.branchId} text={t('assistant.addAll')} onAdd={() => void quick.addItems(branch, basket.lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(l.comboId ? { comboId: l.comboId } : {}) })))} />
    </article>
  );
}

function DealCard({ r, branch, showBranch, quick }: Props<'deal'>) {
  const t = useT();
  const { L } = useI18n();
  const { deal, place, itemNames } = r;
  const title = L(deal.combo ? deal.combo.name : deal.promotion?.title, branch.businessDefaultLocale);
  return (
    <article className={place.open ? 'ac ac--deal' : 'ac ac--deal ac--closed'}>
      <StorageImage path={deal.combo?.imagePath ?? deal.promotion?.imagePath} alt="" square fallbackLabel="" fallbackMark={title} className="ac__img" />
      <div className="ac__body">
        <span className="ac__badge"><Badge tone="accent" icon="tag">{t('assistant.deal')}</Badge></span>
        <h3 className="ac__name">{title}</h3>
        <PlaceLink place={place} branch={branch} showBranch={showBranch} />
        {itemNames.length ? <p className="ac__items">{itemNames.map((n) => L(n, branch.businessDefaultLocale)).join(', ')}</p> : null}
        {deal.combo ? <Price agorot={deal.combo.priceAgorot} /> : null}
      </div>
      {deal.combo
        ? <Action place={place} busy={quick.busy === place.branchId} text={t('assistant.addDeal')} onAdd={() => void quick.addItems(branch, [{ productId: deal.id, comboId: deal.id, qty: 1 }])} />
        : <Link className="btn btn--secondary ac__cta" to={placePath(place)}>{t('assistant.seeDeal')}</Link>}
    </article>
  );
}

function UsualCard({ r, branch, showBranch, quick, onDropped }: Props<'usual'>) {
  const t = useT();
  const { L, locale } = useI18n();
  const { usual, place, missing } = r;
  const reorder = async () => {
    const { dropped } = await quick.addUsual(branch, usual);
    if (dropped.length) onDropped?.(dropped.map((n) => L(n, branch.businessDefaultLocale)));
  };
  return (
    <article className={place.open ? 'ac ac--usual' : 'ac ac--usual ac--closed'}>
      <header className="ac__head"><PlaceLink place={place} branch={branch} showBranch={showBranch} /></header>
      <ul className="ac__lines">
        {usual.lines.map((l, i) => (
          <li key={i}>
            <span className="ac__qty">{l.requestedGrams ? bidi(formatGrams(l.requestedGrams, locale)) : <bdi dir="ltr">{l.quantity}×</bdi>}</span>
            <span className="ac__line-name">{L(l.name, branch.businessDefaultLocale)}</span>
          </li>
        ))}
      </ul>
      {missing.length ? <p className="ac__missing">{t('assistant.missing', { names: missing.map((n) => L(n, branch.businessDefaultLocale)).join(', ') })}</p> : null}
      <Action place={place} busy={quick.busy === place.branchId} text={t('assistant.reorder')} onAdd={() => void reorder()} />
    </article>
  );
}
