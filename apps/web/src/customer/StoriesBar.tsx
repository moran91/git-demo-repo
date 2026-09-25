import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { availableFulfillmentModes, type BranchPost } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { cartStore } from '@/lib/cart';
import { money } from '@/lib/format';
import { useDoc } from '@/lib/queries';
import { imageSources, noteVariantMissing } from '@/lib/images';
import { Icon } from '@/design/Icon';
import { useOpenState, type PublicBranch, type PublicBusiness } from './hooks';
import { ProductSheet } from './ProductSheet';
import { markSeen, orderGroups, seenStore, useStories, type StoryGroup, type StorySlide } from './stories';
import type { PublicProduct } from './BusinessPage';
import './stories.css';

/** How long one photo stays up before the next one plays. */
const STORY_MS = 6000;

/**
 * Stories on the home page: one circle per store that posted a photo in the last 24 hours (the
 * business panel's "סטוריז" page) or features menu items in its stories (the catalog's story toggle). A coloured ring marks a store with posts this
 * device has not seen yet; tapping a circle plays that store's photos full screen, then the next
 * store's. Renders nothing when the town has no live stories.
 */
export function StoriesBar({ cityId }: { cityId: string }) {
  const t = useT();
  const { L } = useI18n();
  const groups = useStories(cityId);
  const { seen } = seenStore.use();
  const ordered = useMemo(() => orderGroups(groups, seen), [groups, seen]);
  // The order is frozen while the viewer is open, so circles do not jump as posts become seen.
  const [viewing, setViewing] = useState<{ groups: StoryGroup[]; start: number } | null>(null);
  if (ordered.length === 0) return null;
  return (
    <>
      <nav className="stories" aria-label={t('stories.label')}>
        <ul className="stories__row">
          {ordered.map((g, index) => {
            const name = L(g.branch.businessName, g.branch.businessDefaultLocale);
            const fresh = g.slides.some((sl) => !seen[sl.seenKey]);
            const face = imageSources(g.branch.logoPath ?? slidePhoto(g.slides[0]!), 'thumb');
            return (
              <li key={g.branch.id}>
                <button type="button" className={`story-circle ${fresh ? 'story-circle--fresh' : ''}`} aria-label={t('stories.open', { name })} onClick={() => setViewing({ groups: ordered, start: index })}>
                  <span className="story-circle__ring" aria-hidden="true">
                    <span className="story-circle__face">
                      {face ? <img src={face.src} alt="" loading="lazy" decoding="async" onError={(e) => { if (face.fallback && !e.currentTarget.dataset.fallback) { e.currentTarget.dataset.fallback = '1'; e.currentTarget.src = face.fallback; } }} /> : <span>{name.slice(0, 1)}</span>}
                    </span>
                  </span>
                  <span className="story-circle__name" lang={g.branch.businessDefaultLocale}>{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {viewing ? <StoryViewer groups={viewing.groups} start={viewing.start} cityId={cityId} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

const slidePhoto = (slide: StorySlide): string => (slide.kind === 'post' ? slide.post.imagePath : slide.product.imagePath!);

function timeAgo(post: BranchPost, t: ReturnType<typeof useT>): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(post.createdAt).getTime()) / 60000));
  if (minutes < 1) return t('stories.justNow');
  if (minutes < 60) return t('stories.minutesAgo', { count: minutes });
  return t('stories.hoursAgo', { count: Math.floor(minutes / 60) });
}

function StoryViewer({ groups, start, cityId, onClose }: { groups: StoryGroup[]; start: number; cityId: string; onClose: () => void }) {
  const t = useT();
  const { L, locale, dir } = useI18n();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [at, setAt] = useState({ g: start, i: 0 });
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PublicProduct | null>(null);
  const group = groups[at.g]!;
  const slide = group.slides[at.i]!;
  const branch = group.branch;
  const storeName = L(branch.businessName, branch.businessDefaultLocale);
  const caption = slide.kind === 'post' ? L(slide.post.caption, branch.businessDefaultLocale) : '';
  const itemName = slide.kind === 'item' ? L(slide.product.name, branch.businessDefaultLocale) : '';
  const itemDesc = slide.kind === 'item' ? L(slide.product.description, branch.businessDefaultLocale) : '';

  // A modal <dialog> sits in the top layer (above the topbar, bottom nav and cart bar) and makes the
  // page behind it inert; the product sheet opened from a story stacks above it the same way.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  useEffect(() => { markSeen(slide.seenKey); }, [slide.seenKey]);
  // Position and clock change together, so the finished clock of one photo can never skip the next.
  const clock = useRef(0);
  const go = (g: number, i: number) => { setAt({ g, i }); clock.current = 0; setProgress(0); };

  const next = useCallback(() => {
    const { g, i } = at;
    if (i < groups[g]!.slides.length - 1) go(g, i + 1);
    else if (g < groups.length - 1) go(g + 1, 0);
    else onClose();
  }, [at, groups, onClose]);
  const previous = useCallback(() => {
    const { g, i } = at;
    if (i > 0) go(g, i - 1);
    else if (g > 0) go(g - 1, groups[g - 1]!.slides.length - 1);
    else { clock.current = 0; setProgress(0); }
  }, [at, groups]);

  // The frame loop reads the latest `next` through a ref instead of restarting on every step.
  const advance = useRef(next);
  useEffect(() => { advance.current = next; }, [next]);

  // The clock runs only while the photo is on screen and nothing holds it (a press, the pause
  // button, the product sheet).
  const running = !paused && !held && !sheet && loadedId === slide.key;
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      clock.current = Math.min(1, clock.current + (now - last) / STORY_MS);
      last = now;
      setProgress(clock.current);
      if (clock.current >= 1) { advance.current(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, slide.key]);

  // Warm the next photo so the story does not stall on it.
  useEffect(() => {
    const upcoming = at.i < group.slides.length - 1 ? group.slides[at.i + 1] : groups[at.g + 1]?.slides[0];
    const src = upcoming ? imageSources(slidePhoto(upcoming), 'display')?.src : null;
    if (src) new Image().src = src;
  }, [at, group, groups]);

  // Taps: the reading-start third goes back, the rest goes forward; a press holds the story; a
  // downward swipe closes it.
  const press = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => { press.current = { x: e.clientX, y: e.clientY, t: Date.now() }; setHeld(true); };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    setHeld(false);
    if (!p) return;
    if (e.clientY - p.y > 90) { onClose(); return; }
    if (Date.now() - p.t > 350 || Math.abs(e.clientX - p.x) > 30) return;
    const box = e.currentTarget.getBoundingClientRect();
    const fromStart = dir === 'rtl' ? box.right - e.clientX : e.clientX - box.left;
    if (fromStart < box.width / 3) previous(); else next();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    // Keys typed in the product sheet (a nested dialog) bubble here through React; leave them alone.
    if (sheet || (e.target as HTMLElement).closest('input, textarea, select')) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) { e.preventDefault(); next(); }
    else if (e.key === back) { e.preventDefault(); previous(); }
    else if (e.key === ' ' && e.target === e.currentTarget) { e.preventDefault(); setPaused((v) => !v); }
  };

  return (
    <dialog
      ref={dialog}
      className="story-viewer"
      aria-label={`${storeName} · ${t('stories.position', { index: at.i + 1, count: group.slides.length })}`}
      onCancel={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div className="story-frame">
        <div className="story-media" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { press.current = null; setHeld(false); }}>
          <StoryPhoto key={slide.key} path={slidePhoto(slide)} alt={caption || itemName || storeName} onReady={() => setLoadedId(slide.key)} />
        </div>

        <div className="story-top">
          <div className="story-bars" aria-hidden="true">
            {group.slides.map((sl, k) => (
              <span key={sl.key} className="story-bar"><i style={{ transform: `scaleX(${k < at.i ? 1 : k === at.i ? progress : 0})` }} /></span>
            ))}
          </div>
          <div className="story-head">
            <button type="button" className="story-store" onClick={() => { onClose(); navigate(`/b/${branch.businessId}/${branch.id}`); }}>
              <StoreFace branch={branch} />
              <span className="story-store__text">
                <span className="story-store__name" lang={branch.businessDefaultLocale}>{storeName}</span>
                <span className="story-store__time">{slide.kind === 'post' ? timeAgo(slide.post, t) : t('stories.fromMenu')}</span>
              </span>
            </button>
            <button type="button" className="story-icon" aria-label={paused ? t('stories.play') : t('stories.pause')} aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
              <Icon name={paused ? 'play' : 'pause'} size={20} directional={paused} />
            </button>
            <button type="button" className="story-icon" aria-label={t('stories.close')} onClick={onClose} autoFocus>
              <Icon name="x" size={22} />
            </button>
          </div>
        </div>

        <button type="button" className="story-step story-step--back" aria-label={t('stories.previous')} onClick={previous}><span className="story-step__flip"><Icon name="chevron" size={22} directional /></span></button>
        <button type="button" className="story-step story-step--next" aria-label={t('stories.next')} onClick={next}><Icon name="chevron" size={22} directional /></button>

        <div className="story-bottom">
          {itemName ? <p className="story-title" lang={branch.businessDefaultLocale}>{itemName}</p> : null}
          {itemDesc ? <p className="story-caption story-caption--sub" lang={branch.businessDefaultLocale}>{itemDesc}</p> : null}
          {caption ? <p className="story-caption" lang={branch.businessDefaultLocale}>{caption}</p> : null}
          <StoryAction key={slide.key} slide={slide} branch={branch} cityId={cityId} locale={locale} onOrder={setSheet} onMenu={() => { onClose(); navigate(`/b/${branch.businessId}/${branch.id}`); }} />
        </div>
      </div>
      {sheet ? <StoryProductSheet product={sheet} branch={branch} cityId={cityId} onClose={() => setSheet(null)} /> : null}
    </dialog>
  );
}

function StoreFace({ branch }: { branch: PublicBranch }) {
  const { L } = useI18n();
  const logo = imageSources(branch.logoPath, 'thumb');
  return (
    <span className="story-store__face" aria-hidden="true">
      {logo ? <img src={logo.src} alt="" onError={(e) => { if (logo.fallback && !e.currentTarget.dataset.fallback) { e.currentTarget.dataset.fallback = '1'; e.currentTarget.src = logo.fallback; } }} /> : L(branch.businessName, branch.businessDefaultLocale).slice(0, 1)}
    </span>
  );
}

/**
 * "Order" when the slide's dish (a featured menu item, or the dish a post links) can be sold right
 * now, otherwise the way to the store's menu.
 */
function StoryAction({ slide, branch, cityId, locale, onOrder, onMenu }: { slide: StorySlide; branch: PublicBranch; cityId: string; locale: 'he' | 'ar' | 'en'; onOrder: (p: PublicProduct) => void; onMenu: () => void }) {
  const t = useT();
  const { L } = useI18n();
  const linked = slide.kind === 'post' && slide.post.productId ? `publicBranches/${branch.id}/products/${slide.post.productId}` : null;
  const product = useDoc<PublicProduct>(linked);
  const open = useOpenState(branch);
  const p = slide.kind === 'item' ? slide.product : product.data;
  const orderable = !!p && !p.archived && p.available && p.inStock !== false && open.open && !branch.ordersPaused && availableFulfillmentModes(branch.type, branch, cityId).length > 0;
  if (p && orderable) {
    const price = p.variants.length ? `${money(Math.min(...p.variants.map((v) => v.priceAgorot)), locale)}+` : money(p.priceAgorot, locale);
    return (
      <button type="button" className="story-cta" onClick={() => onOrder(p)}>
        <span className="story-cta__dish">{slide.kind === 'post' ? <span lang={branch.businessDefaultLocale}>{L(p.name, branch.businessDefaultLocale)}</span> : null}<bdi>{price}</bdi></span>
        <span className="story-cta__go"><Icon name="plus" size={18} /> {slide.kind === 'item' ? t('product.addToCart') : t('stories.order')}</span>
      </button>
    );
  }
  return <button type="button" className="story-cta story-cta--menu" onClick={onMenu}><Icon name="utensils" size={18} /> {t('stories.menu')}</button>;
}

/** Posts are mostly phone photos (portrait): they fill the frame. Anything wider is shown whole over a blurred copy. */
function StoryPhoto({ path, alt, onReady }: { path: string; alt: string; onReady: () => void }) {
  const sources = useMemo(() => imageSources(path, 'display'), [path]);
  const [src, setSrc] = useState(sources?.src ?? null);
  const [fill, setFill] = useState(true);
  useEffect(() => { if (!sources) onReady(); }, [sources, onReady]);
  if (!sources || !src) return <div className="story-photo story-photo--empty"><Icon name="image" size={40} /></div>;
  return (
    <div className={`story-photo ${fill ? 'story-photo--fill' : ''}`}>
      <img className="story-photo__blur" src={src} alt="" aria-hidden="true" />
      <img
        className="story-photo__img"
        src={src}
        alt={alt}
        decoding="async"
        fetchPriority="high"
        draggable={false}
        onLoad={(e) => { const i = e.currentTarget; setFill(i.naturalHeight >= i.naturalWidth * 1.15); onReady(); }}
        onError={() => {
          if (src === sources.src && sources.fallback) { noteVariantMissing(sources.src); setSrc(sources.fallback); } else { setSrc(null); onReady(); }
        }}
      />
    </div>
  );
}

/** The product sheet needs the business document; it is read only when a story's dish is ordered. */
function StoryProductSheet({ product, branch, cityId, onClose }: { product: PublicProduct; branch: PublicBranch; cityId: string; onClose: () => void }) {
  const business = useDoc<PublicBusiness>(`publicBusinesses/${branch.businessId}`);
  const cart = cartStore.use();
  if (!business.data) return null;
  const modes = availableFulfillmentModes(business.data.type, branch, cityId);
  const mode = cart.cart && cart.cart.branchId === branch.id && modes.includes(cart.cart.mode) ? cart.cart.mode : (modes[0] ?? 'pickup');
  return <ProductSheet product={product} business={business.data} branch={branch} mode={mode} cityId={cityId} onClose={onClose} />;
}
