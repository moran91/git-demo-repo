import { useRef, useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  applyQuickAdd,
  availableFulfillmentModes,
  dishKey,
  makeId,
  needsChoice,
  pickMode,
  placementSuffix,
  planCombo,
  planUsual,
  priceLine,
  type CartLine,
  type Combo,
  type FulfillmentMode,
  type Localized,
  type OrderLine,
  type Product,
  type QuickAddEffects,
  type Usual,
} from '@qareeb/shared';
import { db } from '@/lib/firebase';
import { addLine, cartStore, clearCart, type CartState } from '@/lib/cart';
import { useI18n, useT } from '@/lib/i18n';
import { ConfirmDialog, Presence, toast } from '@/design/components';
import type { PublicBranch, PublicBusiness } from '../hooks';
import type { PublicProduct } from '../BusinessPage';
import { ProductSheet } from '../ProductSheet';
import { ComboSheet } from '../ComboSheet';
import { comboMemberImages } from '../ComboMedia';

type Sheet =
  | { id: string; kind: 'product'; product: Product; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode }
  | { id: string; kind: 'combo'; combo: Combo; products: Product[]; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode };
interface Ready { line: CartLine; lineMeta: CartState['lineMeta'][string] }
interface LoadedCombo { combo: Combo; products: ReadonlyMap<string, Product> }

export interface QuickItem { productId: string; comboId?: string; qty: number }

/** Thrown when what a card offers is gone (sold out, archived) since the index was read. */
class Gone extends Error {
  constructor(readonly keys: string[]) {
    super('unavailable');
  }
}
export interface QuickAdd {
  /** The branch whose add is running (loading, or waiting on the replace confirm), for the card's busy state. */
  busy: string | null;
  /**
   * A dish, a deal or a whole meal from one place. Nothing is added if any of it is gone (the card is
   * stale). Resolves once settled: `added` is false on cancel, on an error, or while another add runs.
   */
  addItems: (branch: PublicBranch, items: QuickItem[]) => Promise<{ added: boolean }>;
  /**
   * "Order again" at today's prices. Resolves once settled with the lines left out because their
   * product, size, option or combo is gone, for the caller to name; `dropped` is empty when the
   * customer cancelled the replace confirm (nothing happened, so nothing to announce).
   */
  addUsual: (branch: PublicBranch, usual: Usual) => Promise<{ added: boolean; dropped: Localized[] }>;
  /** Products and combos (dishKey) an add found gone: their cards are no longer shown. */
  gone: ReadonlySet<string>;
  /** The sheets and the replace-cart confirm; render once on the page. */
  layer: ReactNode;
}

/**
 * Adds what the assistant offers. Lines with nothing to choose (plain dishes, combos, an unchanged
 * usual) go straight in; a size, a required option or a weight opens its sheet, one after another (one
 * queue). A cart from another place is replaced only after ONE confirmation, before anything is added
 * (applyQuickAdd). One add at a time: a double tap does not add twice.
 *
 * `usualMode` is the customer's usual way of ordering (Profile.usualMode); a new cart starts in it when
 * the place offers it.
 */
export function useQuickAdd(cityId: string, usualMode?: FulfillmentMode): QuickAdd {
  const t = useT();
  const { L } = useI18n();
  const cart = cartStore.use();
  const [busy, setBusy] = useState<string | null>(null);
  const [queue, setQueue] = useState<Sheet[]>([]);
  const [replace, setReplace] = useState<{ answer: (yes: boolean) => void } | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const running = useRef(false);

  const loadProduct = async (branchId: string, id: string): Promise<Product | null> => {
    const s = await getDoc(doc(db, `publicBranches/${branchId}/products/${id}`));
    // The projection already folds stock into `available`.
    return s.exists() ? { ...(s.data() as PublicProduct), id: s.id } : null;
  };
  const loadCombo = async (branchId: string, id: string): Promise<LoadedCombo | null> => {
    const s = await getDoc(doc(db, `publicBranches/${branchId}/combos/${id}`));
    if (!s.exists()) return null;
    const combo = { ...(s.data() as Combo), id: s.id };
    const members = await Promise.all(combo.items.map((x) => loadProduct(branchId, x.productId)));
    return { combo, products: new Map(members.filter((p): p is Product => !!p).map((p) => [p.id, p])) };
  };
  const loadBusiness = async (businessId: string): Promise<PublicBusiness> => {
    const s = await getDoc(doc(db, `publicBusinesses/${businessId}`));
    if (!s.exists()) throw new Error('missing business');
    return { ...(s.data() as PublicBusiness), id: s.id };
  };
  /** The cart's mode when adding to this place's cart, then the given usual's, then the customer's usual mode. */
  const modeFor = (business: PublicBusiness, branch: PublicBranch, usual?: FulfillmentMode): FulfillmentMode => {
    const current = cartStore.get().cart;
    return pickMode(availableFulfillmentModes(business.type, branch, cityId), [current?.branchId === branch.id ? current.mode : undefined, usual, usualMode]);
  };

  const productSheet = (product: Product, business: PublicBusiness, branch: PublicBranch, mode: FulfillmentMode): Sheet => ({ id: makeId(8), kind: 'product', product, business, branch, mode });
  const comboSheet = (c: LoadedCombo, business: PublicBusiness, branch: PublicBranch, mode: FulfillmentMode): Sheet => ({ id: makeId(8), kind: 'combo', combo: c.combo, products: [...c.products.values()], business, branch, mode });
  /** Cart display for a dish, named as ProductSheet names it ("זיתים (חצי ימני)" for a partial topping). */
  const productReady = (p: Product, line: Omit<CartLine, 'lineId'>, priced?: OrderLine): Ready => ({
    line: { ...line, lineId: makeId(12) },
    lineMeta: {
      name: p.name,
      ...(priced?.variantName ? { variantName: priced.variantName } : {}),
      modifierNames: (priced?.modifiers ?? []).map((m) => {
        const suffix = placementSuffix(m.placement, t);
        return suffix ? Object.fromEntries(Object.entries(m.optionName).map(([k, v]) => [k, `${v}${suffix}`])) : m.optionName;
      }),
      unitLabel: p.unitLabel, pricingMode: p.pricingMode, imagePath: p.imagePath, weightStepGrams: p.weightStepGrams, minWeightGrams: p.minWeightGrams, quantityStep: p.quantityStep, minQuantity: p.minQuantity,
    },
  });
  /** Cart display for a combo, as ComboSheet writes it: its members as "n × name" lines and a member's photo. */
  const comboReady = (c: LoadedCombo, line: Omit<CartLine, 'lineId'>, business: PublicBusiness): Ready => ({
    line: { ...line, lineId: makeId(12) },
    lineMeta: {
      name: c.combo.name,
      modifierNames: c.combo.items.map((it) => ({ en: `${it.quantity} × ${L(c.products.get(it.productId)?.name ?? {}, business.defaultLocale)}` })),
      unitLabel: {}, pricingMode: 'unit', imagePath: comboMemberImages(c.combo, [...c.products.values()])[0], isCombo: true,
    },
  });

  const effects = (business: PublicBusiness, branch: PublicBranch, mode: FulfillmentMode): QuickAddEffects<Ready, Sheet> => ({
    owner: () => cartStore.get().cart,
    confirm: () => new Promise<boolean>((resolve) => setReplace({ answer: resolve })),
    clear: clearCart,
    add: (r) => {
      addLine({ businessId: business.id, branchId: branch.id, mode, cityId, meta: { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale }, line: r.line, lineMeta: r.lineMeta });
      try {
        sessionStorage.removeItem('qareeb.cart.quotedTotal');
        window.dispatchEvent(new Event('qareeb:cart-quote'));
      } catch {
        /* ignore */
      }
    },
    // One queue: sheets left from another place would ask to replace the cart again, so they go.
    queue: (sheets) => setQueue((q) => [...q.filter((s) => s.branch.id === branch.id), ...sheets]),
  });

  /** One add at a time (a double tap is ignored); busy and the guard last until the confirm is answered. */
  const exclusive = async <R,>(branchId: string, none: R, work: () => Promise<R>): Promise<R> => {
    if (running.current) return none;
    running.current = true;
    setBusy(branchId);
    try {
      return await work();
    } catch (e) {
      if (e instanceof Gone) {
        // The card was stale: say so plainly and drop it, rather than a generic error.
        setGone((g) => new Set([...g, ...e.keys]));
        toast(t('assistant.goneNow'));
      } else toast(t('common.errorGeneric'), 'danger');
      return none;
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const addItems = (branch: PublicBranch, items: QuickItem[]) =>
    exclusive(branch.id, { added: false }, async () => {
      const business = await loadBusiness(branch.businessId);
      const mode = modeFor(business, branch);
      const loaded = await Promise.all(items.map(async (it) => (it.comboId ? { it, combo: await loadCombo(branch.id, it.comboId) } : { it, product: await loadProduct(branch.id, it.productId) })));
      const ready: Ready[] = [];
      const sheets: Sheet[] = [];
      const missing: string[] = [];
      for (const x of loaded) {
        const n = Math.max(1, x.it.qty);
        if ('combo' in x) {
          const c = x.combo;
          const r = c ? planCombo(c.combo, c.products, n) : null;
          if (!c || !r || r.status === 'gone') {
            missing.push(dishKey(branch.id, x.it.comboId!));
            continue;
          }
          if (r.status === 'ready') ready.push(comboReady(c, r.line, business));
          else sheets.push(comboSheet(c, business, branch, mode));
          continue;
        }
        const product = x.product;
        if (!product || product.archived || !product.available) {
          missing.push(dishKey(branch.id, x.it.productId));
          continue;
        }
        // Each one can be chosen differently (two pizzas, two toppings), so one sheet per unit.
        if (needsChoice(product)) {
          for (let i = 0; i < n; i++) sheets.push(productSheet(product, business, branch, mode));
          continue;
        }
        const line = { productId: product.id, modifiers: [], quantity: Math.max(n, product.minQuantity || 1), expectedUnitPriceAgorot: product.priceAgorot };
        if (priceLine(product, { ...line, lineId: '' }).problem) sheets.push(productSheet(product, business, branch, mode));
        else ready.push(productReady(product, line));
      }
      // Nothing is added when any of it is gone: a meal missing its main is not the meal offered.
      if (missing.length) throw new Gone(missing);
      return { added: await applyQuickAdd({ businessId: business.id, branchId: branch.id }, ready, sheets, effects(business, branch, mode)) };
    });

  const addUsual = (branch: PublicBranch, usual: Usual) =>
    exclusive(branch.id, { added: false, dropped: [] as Localized[] }, async () => {
      const business = await loadBusiness(branch.businessId);
      const mode = modeFor(business, branch, usual.mode);
      const productIds = [...new Set(usual.lines.filter((l) => !l.comboId).map((l) => l.productId))];
      const comboIds = [...new Set(usual.lines.flatMap((l) => (l.comboId ? [l.comboId] : [])))];
      const [products, combos] = await Promise.all([
        Promise.all(productIds.map((id) => loadProduct(branch.id, id))),
        Promise.all(comboIds.map(async (id) => [id, await loadCombo(branch.id, id)] as const)),
      ]);
      const plan = planUsual(usual.lines, {
        products: new Map(products.filter((p): p is Product => !!p).map((p) => [p.id, p])),
        combos: new Map(combos.flatMap(([id, c]) => (c ? [[id, c] as const] : []))),
      });
      const ready = plan.ready.map((r) => (r.kind === 'combo' ? comboReady(r, r.line, business) : productReady(r.product, r.line, r.priced)));
      const sheets = plan.sheets.map((s) => (s.kind === 'combo' ? comboSheet(s, business, branch, mode) : productSheet(s.product, business, branch, mode)));
      const added = await applyQuickAdd({ businessId: business.id, branchId: branch.id }, ready, sheets, effects(business, branch, mode));
      // Cancelled: nothing changed, so there is nothing to announce. With nothing left to add, the gone lines are the whole answer.
      const cancelled = !added && (ready.length > 0 || sheets.length > 0);
      return { added, dropped: cancelled ? [] : plan.dropped };
    });

  const sheet = queue[0] ?? null;
  const done = (id: string) => setQueue((q) => q.filter((s) => s.id !== id));
  const answer = (yes: boolean) => {
    replace?.answer(yes);
    setReplace(null);
  };
  const layer = (
    <>
      <Presence value={sheet}>
        {(s) =>
          s.kind === 'product'
            ? <ProductSheet key={s.id} product={s.product} business={s.business} branch={s.branch} mode={s.mode} cityId={cityId} onClose={() => done(s.id)} />
            : <ComboSheet key={s.id} combo={s.combo} products={s.products} business={s.business} branch={s.branch} mode={s.mode} cityId={cityId} onClose={() => done(s.id)} />}
      </Presence>
      <ConfirmDialog
        open={!!replace}
        onClose={() => answer(false)}
        onConfirm={() => answer(true)}
        title={t('product.replaceCartTitle')}
        body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })}
        confirmLabel={t('product.replaceCartConfirm')}
        danger
      />
    </>
  );
  return { busy, addItems, addUsual, gone, layer };
}
