import { useState, type ReactNode } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  applyQuickAdd,
  availableFulfillmentModes,
  comboOrderable,
  makeId,
  needsChoice,
  pickMode,
  placementSuffix,
  planUsual,
  priceLine,
  type CartLine,
  type CartOwner,
  type Combo,
  type FulfillmentMode,
  type Localized,
  type OrderLine,
  type Product,
  type QuickAddEffects,
  type Usual,
} from '@qareeb/shared';
import { db } from '@/lib/firebase';
import { addLine, cartStore, clearCart } from '@/lib/cart';
import { useI18n, useT } from '@/lib/i18n';
import { ConfirmDialog, Presence, toast } from '@/design/components';
import type { PublicBranch, PublicBusiness } from '../hooks';
import type { PublicProduct } from '../BusinessPage';
import { ProductSheet } from '../ProductSheet';
import { ComboSheet } from '../ComboSheet';

type Sheet =
  | { id: string; kind: 'product'; product: Product; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode }
  | { id: string; kind: 'combo'; combo: Combo; products: Product[]; business: PublicBusiness; branch: PublicBranch; mode: FulfillmentMode };
interface Ready { product: Product; line: CartLine; modifierNames: Localized[]; variantName?: Localized }
interface LoadedCombo { combo: Combo; products: Map<string, Product> }

export interface QuickItem { productId: string; comboId?: string; qty: number }
export interface QuickAdd {
  /** The branch whose add is loading, for the card's busy state. */
  busy: string | null;
  /** A dish, a deal or a whole meal from one place. Nothing is added if any of it is gone (the card is stale). */
  addItems: (branch: PublicBranch, items: QuickItem[]) => Promise<void>;
  /** "Order again" at today's prices. Resolves with the lines left out because their product, size or option is gone, for the caller to name. */
  addUsual: (branch: PublicBranch, usual: Usual) => Promise<{ dropped: Localized[] }>;
  /** The sheets and the replace-cart confirm; render once on the page. */
  layer: ReactNode;
}

/**
 * Adds what the assistant offers. Lines with nothing to choose go straight in; a size, a required
 * option or a combo opens its sheet, one after another (one queue). A cart from another place is
 * replaced only after ONE confirmation, before anything is added (applyQuickAdd).
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
  const [replace, setReplace] = useState<{ run: () => void } | null>(null);

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
  const modifierNames = (priced: OrderLine): Localized[] =>
    priced.modifiers.map((m) => {
      // Same naming as ProductSheet: "זיתים (חצי ימני)" for a partial topping.
      const suffix = placementSuffix(m.placement, t);
      return suffix ? Object.fromEntries(Object.entries(m.optionName).map(([k, v]) => [k, `${v}${suffix}`])) : m.optionName;
    });

  const effects = (business: PublicBusiness, branch: PublicBranch, mode: FulfillmentMode): QuickAddEffects<Ready, Sheet> => ({
    owner: () => cartStore.get().cart,
    confirm: (run) => setReplace({ run }),
    clear: clearCart,
    add: (r) => {
      const p = r.product;
      addLine({
        businessId: business.id, branchId: branch.id, mode, cityId,
        meta: { businessName: business.name, branchName: branch.name, businessDefaultLocale: business.defaultLocale },
        line: r.line,
        lineMeta: { name: p.name, ...(r.variantName ? { variantName: r.variantName } : {}), modifierNames: r.modifierNames, unitLabel: p.unitLabel, pricingMode: p.pricingMode, imagePath: p.imagePath, weightStepGrams: p.weightStepGrams, minWeightGrams: p.minWeightGrams, quantityStep: p.quantityStep, minQuantity: p.minQuantity },
      });
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
  const ownerOf = (business: PublicBusiness, branch: PublicBranch): CartOwner => ({ businessId: business.id, branchId: branch.id });

  const addItems = async (branch: PublicBranch, items: QuickItem[]) => {
    setBusy(branch.id);
    try {
      const business = await loadBusiness(branch.businessId);
      const mode = modeFor(business, branch);
      const loaded = await Promise.all(items.map(async (it) => (it.comboId ? { it, combo: await loadCombo(branch.id, it.comboId) } : { it, product: await loadProduct(branch.id, it.productId) })));
      const ready: Ready[] = [];
      const sheets: Sheet[] = [];
      for (const x of loaded) {
        const n = Math.max(1, x.it.qty);
        if ('combo' in x) {
          if (!x.combo || !comboOrderable(x.combo.combo, x.combo.products)) throw new Error('unavailable');
          for (let i = 0; i < n; i++) sheets.push(comboSheet(x.combo, business, branch, mode));
          continue;
        }
        const product = x.product;
        if (!product || product.archived || !product.available) throw new Error('unavailable');
        // Each one can be chosen differently (two pizzas, two toppings), so one sheet per unit.
        if (needsChoice(product)) {
          for (let i = 0; i < n; i++) sheets.push(productSheet(product, business, branch, mode));
          continue;
        }
        const line: CartLine = { lineId: makeId(12), productId: product.id, modifiers: [], quantity: Math.max(n, product.minQuantity || 1), expectedUnitPriceAgorot: product.priceAgorot };
        if (priceLine(product, line).problem) sheets.push(productSheet(product, business, branch, mode));
        else ready.push({ product, line, modifierNames: [] });
      }
      applyQuickAdd(ownerOf(business, branch), ready, sheets, effects(business, branch, mode));
    } catch {
      toast(t('common.errorGeneric'), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const addUsual = async (branch: PublicBranch, usual: Usual): Promise<{ dropped: Localized[] }> => {
    setBusy(branch.id);
    try {
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
      const ready: Ready[] = plan.ready.map((r) => ({ product: r.product, line: { ...r.line, lineId: makeId(12) }, modifierNames: modifierNames(r.priced), ...(r.priced.variantName ? { variantName: r.priced.variantName } : {}) }));
      const sheets: Sheet[] = [
        ...plan.sheets.map((p) => productSheet(p, business, branch, mode)),
        ...plan.combos.flatMap((c) => Array.from({ length: Math.max(1, c.quantity) }, () => comboSheet({ combo: c.combo, products: new Map(c.products) }, business, branch, mode))),
      ];
      applyQuickAdd(ownerOf(business, branch), ready, sheets, effects(business, branch, mode));
      return { dropped: plan.dropped };
    } catch {
      toast(t('common.errorGeneric'), 'danger');
      return { dropped: [] };
    } finally {
      setBusy(null);
    }
  };

  const sheet = queue[0] ?? null;
  const done = (id: string) => setQueue((q) => q.filter((s) => s.id !== id));
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
        onClose={() => setReplace(null)}
        onConfirm={() => {
          const run = replace?.run;
          setReplace(null);
          run?.();
        }}
        title={t('product.replaceCartTitle')}
        body={t('product.replaceCartBody', { business: L(cart.meta?.businessName ?? {}, cart.meta?.businessDefaultLocale) })}
        confirmLabel={t('product.replaceCartConfirm')}
        danger
      />
    </>
  );
  return { busy, addItems, addUsual, layer };
}
