import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Combo, Locale, Localized, Product } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { Icon } from '@/design/Icon';
import { money } from '@/lib/format';
import { formatDay } from '@/lib/promotions';
import { StorageImage } from './StorageImage';
import { comboMemberImages } from './ComboMedia';

/**
 * Where each plate sits, per number of photos: [size, inline-end offset, top] as fractions of the
 * art area's height, so the same arrangement scales from the carousel slide to the sheet band.
 */
const PLATE_LAYOUTS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [],
  [[0.8, 0.1, 0.1]],
  [[0.68, 0.16, 0.07], [0.51, -0.07, 0.52]],
  [[0.65, 0.07, 0.06], [0.46, 0.52, 0.585], [0.46, -0.05, 0.61]],
  [[0.46, 0.02, 0.04], [0.46, 0.46, 0.1], [0.46, 0.06, 0.52], [0.46, 0.5, 0.56]],
  [[0.4, 0.08, 0.04], [0.4, 0.5, 0.02], [0.4, -0.04, 0.5], [0.4, 0.3, 0.56], [0.4, 0.62, 0.5]],
  [[0.38, -0.02, 0.04], [0.38, 0.3, 0.08], [0.38, 0.62, 0.02], [0.38, -0.02, 0.52], [0.38, 0.3, 0.58], [0.38, 0.62, 0.5]],
  [[0.32, 0.14, 0], [0.32, 0.48, 0.03], [0.32, -0.03, 0.32], [0.32, 0.31, 0.35], [0.32, 0.64, 0.3], [0.32, 0.14, 0.66], [0.32, 0.48, 0.68]],
  [[0.32, -0.03, 0], [0.32, 0.31, 0.03], [0.32, 0.64, -0.01], [0.32, 0.14, 0.34], [0.32, 0.48, 0.36], [0.32, -0.03, 0.66], [0.32, 0.31, 0.69], [0.32, 0.64, 0.66]],
  [[0.31, -0.03, 0.01], [0.31, 0.3, 0.04], [0.31, 0.63, 0], [0.31, -0.03, 0.34], [0.31, 0.3, 0.37], [0.31, 0.63, 0.33], [0.31, -0.03, 0.67], [0.31, 0.3, 0.7], [0.31, 0.63, 0.66]],
  [[0.28, 0.06, 0.01], [0.28, 0.37, 0.03], [0.28, 0.68, 0], [0.28, -0.04, 0.35], [0.28, 0.22, 0.37], [0.28, 0.48, 0.34], [0.28, 0.74, 0.36], [0.28, 0.06, 0.69], [0.28, 0.37, 0.71], [0.28, 0.68, 0.68]],
];

/** One round photo per item (up to a combo's 10), overlapped like dishes on a table. */
export function Plates({ paths }: { paths: string[] }) {
  const shown = paths.slice(0, PLATE_LAYOUTS.length - 1);
  if (shown.length === 0) return null;
  const layout = PLATE_LAYOUTS[shown.length]!;
  return (
    <div className={`plates plates--${shown.length} ${shown.length > 3 ? 'plates--many' : ''}`} aria-hidden="true">
      {shown.map((p, i) => {
        const [size, end, top] = layout[i]!;
        return <span key={p} className="plate" style={{ '--s': size, '--x': end, '--y': top } as CSSProperties}><StorageImage path={p} alt="" square fallbackLabel="" /></span>;
      })}
    </div>
  );
}

/** The picture side of a deal: the promotion's own banner when it has one, otherwise the items' photos. */
export function DealArt({ banner, paths }: { banner?: string; paths: string[] }) {
  if (banner) return <div className="deal-art__banner" aria-hidden="true"><StorageImage path={banner} size="display" alt="" wide fallbackLabel="" /></div>;
  return <Plates paths={paths} />;
}

export type DealTone = 'combo' | 'promo';

/** One carousel slide. A button when `onClick` is set, otherwise a static preview (owner pages). */
export function DealSlide({ tone, kind, name, lang, sub, pill, banner, paths, off, onClick, band }: {
  tone: DealTone; kind: ReactNode; name: string; lang?: string; sub?: string; pill?: ReactNode;
  banner?: string; paths: string[]; off?: boolean; onClick?: () => void;
  /** The larger header band at the top of a deal's sheet. */
  band?: boolean;
}) {
  const bare = !banner && paths.length === 0;
  const className = `dslide dslide--${tone} ${band ? 'dslide--band' : ''} ${off ? 'dslide--off' : ''} ${bare ? 'dslide--bare' : ''}`;
  const inner = (
    <>
      <DealArt banner={banner} paths={paths} />
      <span className="dslide__text">
        <span className="dslide__kind">{kind}</span>
        <span className="dslide__name wrap-anywhere" lang={lang}>{name}</span>
        {sub ? <span className="dslide__sub">{sub}</span> : null}
        {pill ? <span className="dslide__pill">{pill}</span> : null}
      </span>
    </>
  );
  return onClick
    ? <button type="button" className={className} onClick={onClick}>{inner}</button>
    : <div className={className}>{inner}</div>;
}

/** "2 × Pizza · Fries · Cola": the combo's contents in one line. */
export function comboSummary(items: Combo['items'], products: Product[], L: (v: Localized | undefined | null, fallback?: Locale) => string, defaultLocale: Locale): string {
  return items.map((it) => {
    const p = products.find((x) => x.id === it.productId);
    if (!p) return null;
    const name = L(p.name, defaultLocale);
    return it.quantity > 1 ? `${it.quantity} × ${name}` : name;
  }).filter(Boolean).join(' · ');
}

export function ComboSlide({ combo, products, defaultLocale, price, off, onClick }: {
  combo: Pick<Combo, 'name' | 'items'>; products: Product[]; defaultLocale: Locale; price: number | null; off?: boolean; onClick?: () => void;
}) {
  const t = useT();
  const { L, locale } = useI18n();
  const name = L(combo.name, defaultLocale) || t('deals.combo');
  return (
    <DealSlide
      tone="combo"
      kind={t('deals.combo')}
      name={name}
      lang={defaultLocale}
      sub={comboSummary(combo.items, products, L, defaultLocale)}
      pill={price !== null ? <bdi>{money(price, locale)}</bdi> : t('common.unavailable')}
      paths={comboMemberImages(combo, products)}
      off={off || price === null}
      onClick={onClick}
    />
  );
}

export function PromoSlide({ promotion, products, defaultLocale, off, onClick }: {
  promotion: { title: Localized; body: Localized; endsAt?: string; imagePath?: string };
  products: Array<Pick<Product, 'imagePath'>>; defaultLocale: Locale; off?: boolean; onClick?: () => void;
}) {
  const t = useT();
  const { L } = useI18n();
  const title = L(promotion.title, defaultLocale) || t('promotions.promoTitle');
  const paths = products.map((p) => p.imagePath).filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  return (
    <DealSlide
      tone="promo"
      kind={<><Icon name="clock" size={13} />{t('promotions.limited')}</>}
      name={title}
      lang={defaultLocale}
      sub={L(promotion.body, defaultLocale) || undefined}
      pill={promotion.endsAt ? <bdi>{t('promotions.until', { date: formatDay(promotion.endsAt) })}</bdi> : undefined}
      banner={promotion.imagePath}
      paths={paths}
      off={off}
      onClick={onClick}
    />
  );
}

/** Swipeable row of deal slides, one per view on phones with the next one peeking, and position dots. */
export function DealCarousel({ label, children }: { label: string; children: ReactNode }) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el || count < 2 || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Array.prototype.indexOf.call(el.children, e.target);
        if (i >= 0) setActive(i);
      }
    }, { root: el, threshold: 0.6 });
    for (const c of Array.from(el.children)) io.observe(c);
    return () => io.disconnect();
  }, [count]);
  if (count === 0) return null;
  return (
    <section className="deals-c" aria-label={label}>
      <div className="dcarousel" ref={track}>{slides}</div>
      {count > 1 ? <div className="dcarousel__dots" aria-hidden="true">{slides.map((_, i) => <i key={i} className={i === active ? 'on' : ''} />)}</div> : null}
    </section>
  );
}
