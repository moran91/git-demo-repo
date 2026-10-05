import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONVERSATION,
  afterAdd,
  applyQuickAdd,
  needsChoice,
  needsReplace,
  parseConversation,
  pickMode,
  prepareDishes,
  planCombo,
  planUsual,
  makeDishPreparer,
  respond,
  toAssistantPlaces,
  type CartOwner,
  type Combo,
  type Conversation,
  type DishIndexDoc,
  type Product,
  type ProfileLine,
  type QuickAddEffects,
  type WeeklyHours,
} from '../../src/index.js';
import { NOW, fixtureData } from './fixtures.js';

const product = (patch: Partial<Product>): Product => ({
  id: 'p', branchId: 'br', businessId: 'biz', categoryId: 'c', name: { he: 'מוצר' }, description: {}, dietaryText: {},
  pricingMode: 'unit', priceAgorot: 3000, unitLabel: {}, quantityStep: 1, minQuantity: 1, variants: [], modifierGroups: [],
  available: true, trackInventory: false, archived: false, sortOrder: 0, createdAt: '', updatedAt: '',
  ...patch,
});

const pizza = product({
  id: 'pizza', name: { he: 'פיצה' }, priceAgorot: 4000,
  variants: [
    { id: 'small', name: { he: 'קטנה' }, priceAgorot: 4000, available: true, sortOrder: 0 },
    { id: 'large', name: { he: 'גדולה' }, priceAgorot: 6000, available: true, sortOrder: 1 },
  ],
  modifierGroups: [
    { id: 'top', name: { he: 'תוספות' }, required: false, minSelect: 0, maxSelect: 3, sortOrder: 0, placement: true, options: [
      { id: 'olive', name: { he: 'זיתים' }, priceDeltaAgorot: 500, available: true, sortOrder: 0 },
      { id: 'onion', name: { he: 'בצל' }, priceDeltaAgorot: 400, available: true, sortOrder: 1 },
    ] },
  ],
});
const cola = product({ id: 'cola', name: { he: 'קולה' }, priceAgorot: 1000 });
const nuts = product({ id: 'nuts', name: { he: 'אגוזים' }, pricingMode: 'weight', priceAgorot: 8000, weightStepGrams: 100, minWeightGrams: 200 });

const combo: Combo = { id: 'meal', businessId: 'biz', branchId: 'br', name: { he: 'ארוחה' }, description: {}, items: [{ productId: 'cola', quantity: 2 }], priceAgorot: 1500, promoted: false, active: true, archived: false, sortOrder: 0, createdAt: '', updatedAt: '' };
const usualLine = (patch: Partial<ProfileLine>): ProfileLine => ({ productId: 'p', modifiers: [], quantity: 1, name: { he: 'שורה' }, ...patch });
const products = (...ps: Product[]) => new Map(ps.map((p) => [p.id, p]));
const noCombos = new Map<string, { combo: Combo; products: ReadonlyMap<string, Product> }>();

describe('planUsual (order again at current prices)', () => {
  it('puts a usual line with unchanged prices straight into the cart at its real unit price', () => {
    const plan = planUsual(
      [usualLine({ productId: 'pizza', variantId: 'large', modifiers: [{ groupId: 'top', optionId: 'olive', placement: 'left' }, { groupId: 'top', optionId: 'onion' }], quantity: 2, name: pizza.name })],
      { products: products(pizza), combos: noCombos },
    );
    expect(plan.sheets).toEqual([]);
    expect(plan.dropped).toEqual([]);
    expect(plan.ready).toHaveLength(1);
    const r = plan.ready[0]!;
    expect(r.line).toEqual({
      productId: 'pizza', variantId: 'large', quantity: 2, expectedUnitPriceAgorot: 6900,
      modifiers: [{ groupId: 'top', optionIds: ['olive', 'onion'], placements: { olive: 'left' } }],
    });
    expect(r.priced.lineTotalAgorot).toBe(13800);
    expect(r.priced.modifiers.map((m) => m.optionId)).toEqual(['olive', 'onion']);
  });

  it('takes the price the menu has now when it changed since the order', () => {
    const plan = planUsual([usualLine({ productId: 'cola', quantity: 3 })], { products: products({ ...cola, priceAgorot: 1200 }), combos: noCombos });
    expect(plan.ready.map((r) => r.line.expectedUnitPriceAgorot)).toEqual([1200]);
    expect(plan.sheets).toEqual([]);
  });

  it('prices a weighed line by the kilo with the grams ordered', () => {
    const plan = planUsual([usualLine({ productId: 'nuts', requestedGrams: 300 })], { products: products(nuts), combos: noCombos });
    expect(plan.ready.map((r) => r.line)).toEqual([{ productId: 'nuts', modifiers: [], quantity: 1, requestedGrams: 300, expectedUnitPriceAgorot: 8000 }]);
  });

  it('drops and names lines whose product, size or option is gone', () => {
    const noOlive = { ...pizza, modifierGroups: [{ ...pizza.modifierGroups[0]!, options: pizza.modifierGroups[0]!.options.filter((o) => o.id !== 'olive') }] };
    const soldOutLarge = { ...pizza, variants: pizza.variants.map((v) => (v.id === 'large' ? { ...v, available: false } : v)) };
    const cases: Array<[Product[], ProfileLine]> = [
      [[], usualLine({ productId: 'pizza', name: { he: 'נעלם' } })],
      [[{ ...cola, available: false }], usualLine({ productId: 'cola', name: { he: 'אזל' } })],
      [[pizza], usualLine({ productId: 'pizza', variantId: 'xl', name: { he: 'גודל שהוסר' } })],
      [[soldOutLarge], usualLine({ productId: 'pizza', variantId: 'large', name: { he: 'גודל שאזל' } })],
      [[cola], usualLine({ productId: 'cola', variantId: 'large', name: { he: 'בלי גדלים עכשיו' } })],
      [[noOlive], usualLine({ productId: 'pizza', variantId: 'small', modifiers: [{ groupId: 'top', optionId: 'olive' }], name: { he: 'תוספת שהוסרה' } })],
      [[pizza], usualLine({ productId: 'pizza', variantId: 'small', modifiers: [{ groupId: 'gone', optionId: 'olive' }], name: { he: 'קבוצה שהוסרה' } })],
    ];
    for (const [ps, line] of cases) {
      const plan = planUsual([line], { products: products(...ps), combos: noCombos });
      expect(plan, line.name.he).toEqual({ ready: [], sheets: [], dropped: [line.name] });
    }
  });

  it('opens the sheet only for a real choice the old line cannot answer', () => {
    const withRequired = { ...cola, modifierGroups: [{ id: 'ice', name: { he: 'קרח' }, required: true, minSelect: 1, maxSelect: 1, sortOrder: 0, options: [{ id: 'yes', name: { he: 'כן' }, priceDeltaAgorot: 0, available: true, sortOrder: 0 }] }] };
    const sizes = { ...cola, variants: [{ id: 'can', name: { he: 'פחית' }, priceAgorot: 1000, available: true, sortOrder: 0 }] };
    const plan = planUsual([usualLine({ productId: 'cola' })], { products: products(withRequired), combos: noCombos });
    expect(plan.sheets).toEqual([{ kind: 'product', product: withRequired }]);
    expect(plan.ready).toEqual([]);
    expect(planUsual([usualLine({ productId: 'cola' })], { products: products(sizes), combos: noCombos }).sheets).toEqual([{ kind: 'product', product: sizes }]);
  });

  it('puts an unchanged combo straight into the cart as one line with its quantity', () => {
    const line = usualLine({ productId: 'meal', comboId: 'meal', quantity: 2, name: combo.name });
    const plan = planUsual([line, usualLine({ productId: 'cola' })], { products: products(cola), combos: new Map([['meal', { combo, products: products(cola) }]]) });
    expect(plan.sheets).toEqual([]);
    expect(plan.dropped).toEqual([]);
    expect(plan.ready.map((r) => [r.kind, r.line])).toEqual([
      ['combo', { productId: 'meal', comboId: 'meal', modifiers: [], quantity: 2, expectedUnitPriceAgorot: 1500 }],
      ['product', { productId: 'cola', modifiers: [], quantity: 1, expectedUnitPriceAgorot: 1000 }],
    ]);
    expect(plan.ready[0]!.priced.lineTotalAgorot).toBe(3000);
  });

  it('takes a combo\'s price as the menu has it now', () => {
    const plan = planUsual([usualLine({ productId: 'meal', comboId: 'meal', name: combo.name })], { products: new Map(), combos: new Map([['meal', { combo: { ...combo, priceAgorot: 1700 }, products: products(cola) }]]) });
    expect(plan.ready.map((r) => r.line.expectedUnitPriceAgorot)).toEqual([1700]);
  });

  it('drops and names a combo that is gone, off, or missing a member', () => {
    const line = usualLine({ productId: 'meal', comboId: 'meal', quantity: 2, name: combo.name });
    const gone = (combos: Map<string, { combo: Combo; products: ReadonlyMap<string, Product> }>) => planUsual([line], { products: new Map(), combos });
    for (const plan of [
      gone(new Map()),
      gone(new Map([['meal', { combo, products: products({ ...cola, available: false }) }]])),
      gone(new Map([['meal', { combo, products: new Map() }]])),
      gone(new Map([['meal', { combo: { ...combo, active: false }, products: products(cola) }]])),
    ]) expect(plan).toEqual({ ready: [], sheets: [], dropped: [combo.name] });
  });

  it('opens one combo sheet (not one per unit) only when the line itself cannot be priced', () => {
    const plan = planUsual([usualLine({ productId: 'meal', comboId: 'meal', quantity: 150, name: combo.name })], { products: new Map(), combos: new Map([['meal', { combo, products: products(cola) }]]) });
    expect(plan).toEqual({ ready: [], sheets: [{ kind: 'combo', combo, products: products(cola) }], dropped: [] });
  });
});

describe('planCombo (a deal or a meal\'s combo from "add")', () => {
  it('is ready at the current price, gone when a member is gone, a sheet only for a bad quantity', () => {
    expect(planCombo(combo, products(cola), 1)).toMatchObject({ status: 'ready', line: { comboId: 'meal', productId: 'meal', quantity: 1, expectedUnitPriceAgorot: 1500 } });
    expect(planCombo(combo, new Map(), 1)).toEqual({ status: 'gone' });
    expect(planCombo(combo, products(cola), 0)).toEqual({ status: 'sheet' });
  });
});

describe('needsChoice (one rule for the index and quick add)', () => {
  it('is true for sizes, required options and weighed dishes only', () => {
    expect(needsChoice(cola)).toBe(false);
    expect(needsChoice(pizza)).toBe(true);
    expect(needsChoice(nuts)).toBe(true);
    expect(needsChoice({ ...cola, modifierGroups: [{ ...pizza.modifierGroups[0]!, minSelect: 1 }] })).toBe(true);
  });
});

/** A cart that only knows its place and its lines, plus the sheets a quick add opened, with every replace confirm counted. */
function fakeCart(owner: CartOwner | null, answer: 'yes' | 'no' = 'yes') {
  const s = { owner, lines: [] as string[], queue: [] as string[], confirms: 0, cleared: 0 };
  const fx: QuickAddEffects<string, string> = {
    owner: () => s.owner,
    confirm: async () => {
      s.confirms++;
      return answer === 'yes';
    },
    clear: () => {
      s.cleared++;
      s.owner = null;
      s.lines = [];
    },
    add: (line, target) => {
      s.owner = target;
      s.lines.push(line);
    },
    queue: (sheets) => {
      s.queue.push(...sheets);
    },
  };
  /** What a product/combo sheet does when it opens: it asks again only if the cart is another place's. */
  const openSheets = (target: CartOwner) => {
    for (const _ of s.queue) if (needsReplace(s.owner, target)) s.confirms++;
  };
  return { s, fx, openSheets };
}

describe('applyQuickAdd (one replace confirm per action)', () => {
  const here: CartOwner = { businessId: 'b1', branchId: 'br1' };
  const other: CartOwner = { businessId: 'b2', branchId: 'br2' };

  it('asks once, clears the other place, adds the ready lines and queues the sheets', async () => {
    const { s, fx, openSheets } = fakeCart(other);
    s.lines = ['old'];
    expect(await applyQuickAdd(here, ['a', 'b'], ['sheet'], fx)).toBe(true);
    expect(s.confirms).toBe(1);
    expect(s.cleared).toBe(1);
    expect(s.lines).toEqual(['a', 'b']);
    expect(s.owner).toEqual(here);
    expect(s.queue).toEqual(['sheet']);
    openSheets(here);
    expect(s.confirms).toBe(1);
  });

  it('when everything needs a sheet, the confirmed path still empties the other cart so the sheets never ask again', async () => {
    const { s, fx, openSheets } = fakeCart(other);
    s.lines = ['old'];
    expect(await applyQuickAdd(here, [], ['combo', 'pizza'], fx)).toBe(true);
    expect(s.confirms).toBe(1);
    expect(s.lines).toEqual([]);
    expect(s.owner).toBeNull();
    openSheets(here);
    expect(s.confirms).toBe(1);
  });

  it('adds without asking to an empty cart or this place\'s cart', async () => {
    for (const owner of [null, here]) {
      const { s, fx } = fakeCart(owner);
      expect(await applyQuickAdd(here, ['a'], ['sheet'], fx)).toBe(true);
      expect(s.confirms).toBe(0);
      expect(s.cleared).toBe(0);
      expect(s.lines).toEqual(['a']);
      expect(s.queue).toEqual(['sheet']);
    }
  });

  it('settles only once the confirm is answered, and changes nothing on cancel', async () => {
    const { s, fx } = fakeCart(other, 'no');
    s.lines = ['old'];
    let answer!: (yes: boolean) => void;
    fx.confirm = () => {
      s.confirms++;
      return new Promise<boolean>((r) => (answer = r));
    };
    let settled: boolean | undefined;
    const done = applyQuickAdd(here, ['a'], ['sheet'], fx).then((v) => (settled = v));
    await Promise.resolve();
    expect(s.confirms).toBe(1);
    expect(settled).toBeUndefined();
    answer(false);
    await done;
    expect(settled).toBe(false);
    expect(s.cleared).toBe(0);
    expect(s.lines).toEqual(['old']);
    expect(s.owner).toEqual(other);
    expect(s.queue).toEqual([]);
  });

  it('asks nothing and adds nothing when there is nothing to add', async () => {
    const { s, fx } = fakeCart(other);
    expect(await applyQuickAdd(here, [], [], fx)).toBe(false);
    expect(s.confirms).toBe(0);
    expect(s.owner).toEqual(other);
  });

  it('a different branch of the same business is another cart', () => {
    expect(needsReplace({ businessId: 'b1', branchId: 'br9' }, here)).toBe(true);
    expect(needsReplace(here, here)).toBe(false);
    expect(needsReplace(null, here)).toBe(false);
  });
});

describe('makeDishPreparer (fold dish texts once per index document)', () => {
  const entry = { name: { he: 'פיצה' }, priceAgorot: 4000, fromPrice: false, available: true, needsChoice: false, sortOrder: 0 };
  const idx = (branchId: string, ids: string[]): DishIndexDoc => ({ branchId, businessId: 'biz', updatedAt: '', dishes: Object.fromEntries(ids.map((id) => [id, { ...entry }])) });

  it('matches prepareDishes and reuses the folded dishes of documents that did not change', () => {
    const prepare = makeDishPreparer();
    const a = idx('a', ['p1', 'p2']);
    const b = idx('b', ['p3']);
    const places = [{ branchId: 'a', name: { he: 'א' } }, { branchId: 'b', name: { he: 'ב' } }];
    const first = prepare(places, new Map([['a', a]]));
    expect(first).toEqual(prepareDishes(places, new Map([['a', a]])));
    const b2 = idx('b', ['p3', 'p4']);
    const second = prepare(places, new Map([['a', a], ['b', b]]));
    expect(second.slice(0, 2)).toEqual(first);
    expect(second[0]).toBe(first[0]);
    const third = prepare(places, new Map([['a', a], ['b', b2]]));
    expect(third[0]).toBe(first[0]);
    expect(third.map((d) => d.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(third).toEqual(prepareDishes(places, new Map([['a', a], ['b', b2]])));
  });

  it('folds again when the place\'s name changed', () => {
    const prepare = makeDishPreparer();
    const a = idx('a', ['p1']);
    const before = prepare([{ branchId: 'a', name: { he: 'א' } }], new Map([['a', a]]));
    expect(prepare([{ branchId: 'a', name: { he: 'א' } }], new Map([['a', a]]))[0]).toBe(before[0]);
    const after = prepare([{ branchId: 'a', name: { he: 'חדש' } }], new Map([['a', a]]));
    expect(after[0]).not.toBe(before[0]);
    expect(after).toEqual(prepareDishes([{ branchId: 'a', name: { he: 'חדש' } }], new Map([['a', a]])));
  });
});

describe('pickMode', () => {
  it('takes the first preferred mode the place serves, else its first mode', () => {
    expect(pickMode(['delivery', 'pickup'], [undefined, 'pickup', 'delivery'])).toBe('pickup');
    expect(pickMode(['delivery', 'pickup'], ['dine_in'])).toBe('delivery');
    expect(pickMode([], ['dine_in'])).toBe('pickup');
  });
});

describe('toAssistantPlaces', () => {
  const sunday: WeeklyHours = { '0': [{ startMin: 600, endMin: 1380 }], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] };
  const branch = (patch: Record<string, unknown>) => ({
    id: 'br', businessId: 'biz', type: 'restaurant' as const, name: { he: 'סניף' }, businessName: { he: 'עסק' }, cityId: 'c1',
    hours: sunday, hoursOverrides: [], pickupEnabled: true, deliveryCities: [], ordersPaused: false, ...patch,
  });

  it('leaves supermarkets out (the assistant never targets a place with no dishes)', () => {
    const places = toAssistantPlaces([branch({ id: 'r' }), branch({ id: 's', type: 'supermarket' })], NOW, 'c1');
    expect(places.map((p) => p.branchId)).toEqual(['r']);
  });

  it('marks paused places as not open and keeps when a closed one opens', () => {
    const lateOpen: WeeklyHours = { ...sunday, '0': [{ startMin: 1320, endMin: 1430 }] };
    const [open, paused, later] = toAssistantPlaces([branch({ id: 'a' }), branch({ id: 'b', ordersPaused: true }), branch({ id: 'c', hours: lateOpen })], NOW, 'c1');
    expect(open).toEqual({ branchId: 'a', businessId: 'biz', name: { he: 'עסק' }, branchName: { he: 'סניף' }, open: true, modes: ['pickup', 'dine_in'] });
    expect(paused!.open).toBe(false);
    expect(later).toMatchObject({ open: false, opensInMin: 120 });
  });
});

describe('parseConversation', () => {
  const data = fixtureData();
  const opts = { signedIn: true, uiLang: 'he' as const };
  // Every card kind (dish, meal, usual, deal) and an upsell turn.
  const said = ['פיצה ושתייה קרה', 'ארוחה ל-4 עד 150', 'הרגיל שלי', 'מבצעים'].reduce<Conversation>((c, m) => respond(c, m, data, opts), EMPTY_CONVERSATION);
  const real = afterAdd(said, { branchId: 'morano', productId: 'm-margherita' }, ['m-margherita'], data, 'he');

  it('restores a stored conversation as it was', () => {
    expect(parseConversation(JSON.stringify(real))).toEqual(JSON.parse(JSON.stringify(real)));
    expect(real.turns.flatMap((t) => (t.role === 'assistant' ? t.cards.map((c) => c.kind) : []))).toEqual(expect.arrayContaining(['dish', 'meal', 'usual', 'deal']));
    expect(real.turns.at(-1)).toMatchObject({ kind: 'upsell' });
  });

  it('starts fresh when nothing is stored or it does not parse', () => {
    expect(parseConversation(null)).toBe(EMPTY_CONVERSATION);
    expect(parseConversation('')).toBe(EMPTY_CONVERSATION);
    expect(parseConversation('{"turns":[')).toBe(EMPTY_CONVERSATION);
    expect(parseConversation('null')).toBe(EMPTY_CONVERSATION);
    expect(parseConversation('[]')).toBe(EMPTY_CONVERSATION);
  });

  /** A stored copy with one field removed (`GONE`) or replaced, at a path like ['turns', 1, 'cards']. */
  const GONE = Symbol('gone');
  const edited = (conv: Conversation, path: Array<string | number>, value: unknown): string => {
    const c = JSON.parse(JSON.stringify(conv)) as unknown;
    const parent = path.slice(0, -1).reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], c) as Record<string | number, unknown>;
    const key = path.at(-1)!;
    if (value === GONE) delete parent[key];
    else parent[key] = value;
    return JSON.stringify(c);
  };

  it('starts fresh when a required field is missing anywhere', () => {
    const broken: Array<[Array<string | number>, unknown]> = [
      [['misses'], GONE],
      [['upsellSkips'], '0'],
      [['turns', 1, 'cards'], GONE],
      [['turns', 1, 'chips', 0, 'label'], GONE],
      [['turns', 0, 'role'], 'system'],
      [['last', 'shown'], GONE],
      [['last', 'request', 'exclude'], GONE],
      [['last', 'request', 'lang'], 'fr'],
      [['turns', 1, 'cards', 0], { kind: 'meal' }],
      [['turns', 1, 'cards', 0], { kind: 'dish', branchId: 'morano' }],
    ];
    for (const [path, value] of broken) expect(parseConversation(edited(real, path, value)), path.join('.')).toBe(EMPTY_CONVERSATION);
  });

  it('starts fresh when a stored group has no "said" (an older shape)', () => {
    const c = respond(EMPTY_CONVERSATION, 'פיצה ושתייה קרה', data, opts);
    expect(c.last!.request.groups!.length).toBeGreaterThan(1);
    expect(parseConversation(JSON.stringify(c))).not.toBe(EMPTY_CONVERSATION);
    expect(parseConversation(edited(c, ['last', 'request', 'groups', 0, 'said'], GONE))).toBe(EMPTY_CONVERSATION);
  });
});
