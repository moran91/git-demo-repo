import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { DISH_TYPES, LOCALES, availableFulfillmentModes, daySeed, dictionaries, evaluateOpen, highlightRanges, layoutAlternatives, makeId, matchScore, parseQuery, prepareFields, priceLine, rankDishes, type DishHit, type DishType, type Localized, type PreparedFields, type SearchQuery } from '@qareeb/shared';
import { useI18n, useT } from '@/lib/i18n';
import { db } from '@/lib/firebase';
import { addLine, cartBelongsTo, cartStore } from '@/lib/cart';
import { clockIn, money } from '@/lib/format';
import { ConfirmDialog, toast } from '@/design/components';
import { Icon } from '@/design/Icon';
import type { PublicBranch, PublicBusiness } from './hooks';
import type { PublicProduct } from './BusinessPage';
import { useDishIndexes } from './dishIndex';
import { ProductSheet } from './ProductSheet';
import { StorageImage } from './StorageImage';
import './cravings.css';

type Hit = DishHit & { branch: PublicBranch; opensInMin?: number; search: PreparedFields };

/**
 * The home's food-first half (mockup 9): a search field and dish-type chips over every restaurant in
 * the city, with dishes you can add straight to the cart. Places follow below in DiscoveryPage.
 */
export function CravingsHome({ restaurants, cityId, now }: { restaurants: PublicBranch[]; cityId: string; now: Date }) {
  const t = useT();
  const { L } = useI18n();
  const cart = cartStore.use();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<DishType | null>(null);
  const { indexes, loading } = useDishIndexes(restaurants.map((b) => b.id));
  const quick = useQuickAdd(cityId);

  const hits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    for (const branch of restaurants) {
      const idx = indexes.get(branch.id);
      if (!idx) continue;
      const state = evaluateOpen(now, branch.hours, branch.hoursOverrides ?? []);
      const open = state.open && !branch.ordersPaused;
      for (const [id, entry] of Object.entries(idx.dishes)) {
        if (!entry.available) continue;
        // Folded and sound-keyed once per menu update, so each keystroke only compares.
        const search = prepareFields({ name: words(entry.name), description: words(entry.description ?? {}), type: entry.dishType ? DISH_TYPE_WORDS[entry.dishType] : '', place: words(branch.businessName) });
        out.push({ id, branchId: branch.id, open, entry, branch, opensInMin: state.open ? undefined : state.opensInMin, search });
      }
    }
    return out;
  }, [restaurants, indexes, now]);

  // Chips: only types that have a dish, each pictured by its first photographed dish (open places first).
  const chips = useMemo(() => {
    return DISH_TYPES.map((dt) => {
      const ofType = hits.filter((h) => h.entry.dishType === dt);
      const photo = [...ofType].sort((a, b) => Number(b.open) - Number(a.open)).find((h) => h.entry.imagePath)?.entry.imagePath;
      return { type: dt, count: ofType.length, photo };
    }).filter((c) => c.count > 0);
  }, [hits]);

  const seed = daySeed(now);
  const pin = cart.cart?.branchId;
  // Results follow every keystroke; deferring keeps typing smooth while the list catches up.
  const typed = useDeferredValue(query);
  const q = typed.trim();
  const active = q !== '' || type !== null;
  const ofChip = active ? hits.filter((h) => !type || h.entry.dishType === type) : [];
  // Nothing found? The customer may have typed on the wrong keyboard ("phmv" is "פיצה"). The swapped
  // text must name a dish outright (level ≤ 4), or random letters would turn up typos and places.
  let search = parseQuery(typed);
  let results = search ? searchDishes(ofChip, search, seed, pin) : rankDishes(ofChip, { seed, pinBranchId: pin });
  let resultsFor: string | null = null;
  if (search && results.length === 0) {
    for (const alt of layoutAlternatives(typed)) {
      const altQuery = parseQuery(alt);
      const found = altQuery ? searchDishes(ofChip, altQuery, seed, pin) : [];
      if (altQuery && found.length && matchScore(altQuery, found[0]!.search)!.level <= 4) {
        search = altQuery;
        results = found;
        resultsFor = alt.trim();
        break;
      }
    }
  }
  const bestSellers = active ? [] : rankDishes(hits.filter((h) => h.entry.mostOrdered && h.open), { seed, pinBranchId: pin }).slice(0, 6);

  // A business with more than one branch listed names the branch too, or two rows would read the same.
  const multi = new Set(restaurants.filter((b, _i, all) => all.some((o) => o.businessId === b.businessId && o.id !== b.id)).map((b) => b.id));
  const openRows = results.filter((h) => h.open);
  const closedRows = results.filter((h) => !h.open);
  const row = (h: Hit) => <DishRow key={`${h.branchId}/${h.id}`} hit={h} query={search} showBranch={multi.has(h.branchId)} busy={quick.busy === `${h.branchId}/${h.id}`} onAdd={() => void quick.start(h)} />;

  return (
    <div className="crave">
      <div className="crave-search">
        <label className="crave-search__box">
          <Icon name="search" size={24} />
          <span className="visually-hidden">{t('cravings.searchLabel')}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('cravings.search')} autoComplete="off" enterKeyHint="search" />
          {query ? <button type="button" className="crave-search__clear" onClick={() => setQuery('')} aria-label={t('cravings.clear')}><Icon name="x" size={18} /></button> : null}
        </label>
      </div>

      {chips.length > 0 ? (
        <div className="crave-chips" role="group" aria-label={t('cravings.types')}>
          {chips.map((c) => (
            <button key={c.type} type="button" className="crave-chip" aria-pressed={type === c.type} onClick={() => setType(type === c.type ? null : c.type)}>
              <span className="crave-chip__disc">
                {c.photo ? <StorageImage path={c.photo} alt="" square fallbackLabel="" /> : <span className="crave-chip__mark" aria-hidden="true">{t(`dishType.${c.type}`).slice(0, 1)}</span>}
              </span>
              <span className="crave-chip__label">{t(`dishType.${c.type}`)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <section className="crave-results" aria-live="polite">
          {resultsFor ? <p className="crave-for">{t('cravings.resultsFor', { q: resultsFor })}</p> : null}
          {/* Menus still loading (or none in town): say nothing rather than "no dishes". */}
          {results.length === 0 && !loading && hits.length > 0 ? <p className="crave-empty">{t('cravings.noResults', { q: q || t(`dishType.${type!}`) })}</p> : null}
          {openRows.length ? <ul className="crave-list">{openRows.map(row)}</ul> : null}
          {closedRows.length ? (
            <>
              <h3 className="crave-sub">{t('cravings.closedNow')}</h3>
              <ul className="crave-list crave-list--closed">{closedRows.map(row)}</ul>
            </>
          ) : null}
        </section>
      ) : bestSellers.length ? (
        <section className="crave-results" aria-labelledby="crave-best">
          <h2 id="crave-best" className="crave-title">{t('cravings.bestSellers')}</h2>
          <ul className="crave-list">{bestSellers.map(row)}</ul>
        </section>
      ) : null}

      {quick.sheet ? <ProductSheet product={quick.sheet.product} business={quick.sheet.business} branch={quick.sheet.branch} mode={quick.sheet.mode} cityId={cityId} onClose={quick.close} /> : null}
      <ConfirmDialog
        open={!!quick.replace}
        onClose={quick.close}
        onConfirm={() => quick.replace?.commit()}
        title={t('product.replaceCartTitle')}
        body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })}
        confirmLabel={t('product.replaceCartConfirm')}
        danger
      />
    </div>
  );
}

function DishRow({ hit, query, showBranch, busy, onAdd }: { hit: Hit; query: SearchQuery | null; showBranch: boolean; busy: boolean; onAdd: () => void }) {
  const t = useT();
  const { L, locale } = useI18n();
  const { entry, branch } = hit;
  const name = L(entry.name, branch.businessDefaultLocale);
  const business = L(branch.businessName, branch.businessDefaultLocale);
  const branchName = L(branch.name, branch.businessDefaultLocale);
  const place = showBranch && branchName && branchName !== business ? `${business}, ${branchName}` : business;
  const price = money(entry.priceAgorot, locale);
  return (
    <li className="crave-dish">
      <span className="crave-dish__img">
        <StorageImage path={entry.imagePath} alt="" square fallbackLabel="" fallbackMark={name} />
      </span>
      <span className="crave-dish__text">
        <span className="crave-dish__name">{query ? highlight(name, query) : name}</span>
        <span className="crave-dish__place">
          {branch.logoPath ? <StorageImage path={branch.logoPath} alt="" square fallbackLabel="" className="crave-dish__logo" /> : null}
          {place}
        </span>
        <span className="crave-dish__price price"><bdi>{entry.fromPrice ? t('cravings.from', { price }) : price}</bdi></span>
      </span>
      {hit.open ? (
        <button type="button" className="crave-dish__add" onClick={onAdd} disabled={busy} aria-label={t('cravings.add', { name })} aria-busy={busy || undefined}>
          <Icon name="plus" size={22} />
        </button>
      ) : (
        <Link className="crave-dish__when" to={`/b/${branch.businessId}/${branch.id}`}>
          {branch.ordersPaused || hit.opensInMin === undefined ? t('common.closed') : t('discovery.opensAt', { time: clockIn(hit.opensInMin) })}
        </Link>
      )}
    </li>
  );
}

/**
 * "+" on a dish: a dish with nothing to choose goes straight into the cart; one with sizes or required
 * options opens the product sheet. Both read the full product first so the price always comes from
 * the menu, and both respect the one-place cart (confirm before replacing another place's cart).
 */
function useQuickAdd(cityId: string) {
  const t = useT();
  const cart = cartStore.use();
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ product: PublicProduct; business: PublicBusiness; branch: PublicBranch; mode: ReturnType<typeof availableFulfillmentModes>[number] } | null>(null);
  const [replace, setReplace] = useState<{ commit: () => void } | null>(null);
  const close = () => { setSheet(null); setReplace(null); };

  const start = async (h: Hit) => {
    const key = `${h.branchId}/${h.id}`;
    setBusy(key);
    try {
      const [pSnap, bSnap] = await Promise.all([getDoc(doc(db, `publicBranches/${h.branchId}/products/${h.id}`)), getDoc(doc(db, `publicBusinesses/${h.branch.businessId}`))]);
      if (!pSnap.exists() || !bSnap.exists()) throw new Error('missing');
      const product = { ...(pSnap.data() as PublicProduct), id: pSnap.id };
      const business = { ...(bSnap.data() as PublicBusiness), id: bSnap.id };
      const branch = h.branch;
      const modes = availableFulfillmentModes(business.type, branch, cityId);
      const mode = cart.cart && cart.cart.branchId === branch.id && modes.includes(cart.cart.mode) ? cart.cart.mode : (modes[0] ?? 'pickup');
      if (!product.available) {
        toast(t('common.errorGeneric'), 'danger');
        return;
      }
      const needsChoice = product.variants.length > 0 || product.pricingMode === 'weight' || product.modifierGroups.some((g) => g.required || g.minSelect > 0);
      const quantity = Math.max(1, product.minQuantity || 1);
      const line = { lineId: makeId(12), productId: product.id, modifiers: [], quantity, expectedUnitPriceAgorot: product.priceAgorot };
      if (needsChoice || priceLine(product, line).problem) {
        setSheet({ product, business, branch, mode });
        return;
      }
      const commit = () => {
        addLine({
          businessId: business.id, branchId: branch.id, mode, cityId,
          meta: { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale },
          line,
          lineMeta: { name: product.name, modifierNames: [] as Localized[], unitLabel: product.unitLabel, pricingMode: product.pricingMode, imagePath: product.imagePath, weightStepGrams: product.weightStepGrams, minWeightGrams: product.minWeightGrams, quantityStep: product.quantityStep, minQuantity: product.minQuantity },
        });
        try {
          sessionStorage.removeItem('qareeb.cart.quotedTotal');
          window.dispatchEvent(new Event('qareeb:cart-quote'));
        } catch {
          /* ignore */
        }
        toast(`${t('product.addToCart')} ✓`);
        setReplace(null);
      };
      if (cart.cart && !cartBelongsTo(cart, business.id, branch.id)) setReplace({ commit });
      else commit();
    } catch {
      toast(t('common.errorGeneric'), 'danger');
    } finally {
      setBusy(null);
    }
  };
  return { busy, sheet, replace, start, close };
}

/**
 * Smart matching across languages, spellings, typos and half-typed words (matchScore): the dish's own
 * name or type first, word starts before word insides, then translations, sound-alikes (باستا → פסטה)
 * and typos, then descriptions, then place names ("מורנו" lists Morano's menu), so "שווארמה" never
 * opens with a shawarma place's cola. Neutral ranking among equally good matches.
 */
function searchDishes(hits: Hit[], query: SearchQuery, seed: number, pin: string | undefined): Hit[] {
  const buckets = new Map<number, Hit[]>();
  for (const h of hits) {
    const m = matchScore(query, h.search);
    if (m) buckets.set(m.score, [...(buckets.get(m.score) ?? []), h]);
  }
  return [...buckets.keys()].sort((a, b) => a - b).flatMap((k) => rankDishes(buckets.get(k)!, { seed, pinBranchId: pin }));
}

/** The name with the directly matched letters marked. */
function highlight(name: string, query: SearchQuery): ReactNode {
  const ranges = highlightRanges(name, query);
  if (!ranges.length) return name;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) out.push(name.slice(at, s));
    out.push(<mark key={s}>{name.slice(s, e)}</mark>);
    at = e;
  }
  if (at < name.length) out.push(name.slice(at));
  return out;
}

/** Every locale's words for a name, so a search in any of the three languages finds it. */
function words(l: Localized): string {
  return [l.he, l.ar, l.en].filter(Boolean).join(' ');
}

/** Dish-type names in all three languages, so typing "פיצה" or "بيتزا" also finds pizzas whose name lacks the word. */
const DISH_TYPE_WORDS = Object.fromEntries(DISH_TYPES.map((dt) => [dt, LOCALES.map((l) => dictionaries[l][`dishType.${dt}`]).join(' ')])) as Record<DishType, string>;
