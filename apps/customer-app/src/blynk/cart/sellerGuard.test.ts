import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Combo, Product } from '../api/types';
import { milk, MemoryStorage, sugar } from '../test/fixtures';
import { comboQuantityOf, keyOf, lineQuantityOf, setComboQuantity, setQuantity, MAX_QTY, type CartState } from './cartStore';
import { collectEntries, createSellerGuard } from './sellerGuard';
import type { AddEntry } from './sellerRule';
import type { NewCartPrompt } from './startNewCart';

const g = globalThis as { localStorage?: unknown };
beforeEach(() => { g.localStorage = new MemoryStorage(); });
afterEach(() => { delete g.localStorage; });

const fromA = (id: string): Product => ({ ...milk, id, seller_id: 'seller-a', sold_by: 'Amina Stores' });
const fromB = (id: string): Product => ({ ...milk, id, seller_id: 'seller-b', sold_by: 'Bake House' });
const blynk = (id: string): Product => ({ ...sugar, id });
const combo = { id: 'c1', name: 'Pack', price: 900, items_total: 1100, is_available: true, items: [] } as unknown as Combo;
const entry = (product: Product, quantity = 1): AddEntry => ({ kind: 'product', product, quantity });

/** The guard on a real CartState, with the dialog and the notices recorded. */
function setup(rule: boolean, start: CartState = { lines: [] }) {
  let cart: CartState = start;
  const prompts: NewCartPrompt[] = [];
  const notices: string[] = [];
  const guard = createSellerGuard({
    rule: () => rule,
    lines: () => cart.lines,
    combos: () => cart.combos ?? [],
    qtyOf: (e) => (e.kind === 'combo' ? comboQuantityOf(cart, e.combo.id) : lineQuantityOf(cart, keyOf({ product: e.product, variant: e.variant }))),
    apply: (e) => {
      cart = e.kind === 'combo'
        ? setComboQuantity(cart, e.combo, comboQuantityOf(cart, e.combo.id) + e.quantity)
        : setQuantity(cart, e.product, lineQuantityOf(cart, keyOf({ product: e.product, variant: e.variant })) + e.quantity, e.variant);
    },
    clear: () => { cart = { lines: [], combos: [] }; },
    replace: (lines, combos) => { cart = { lines, combos }; },
    prompt: (p) => prompts.push(p),
    notice: (t) => notices.push(t),
  });
  return { guard, prompts, notices, cart: () => cart, ids: () => cart.lines.map((l) => l.product.id) };
}

describe('add from another seller', () => {
  test('asks, changes nothing yet; "Keep current cart" leaves the cart alone', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 2 }] });
    expect(t.guard.attempt([entry(fromB('b1'))])).toBe('asked');
    expect(t.prompts).toHaveLength(1);
    expect(t.prompts[0].sellerName).toBe('Amina Stores');
    expect(t.ids()).toEqual(['a1']);
    t.prompts[0].keep();
    expect(t.ids()).toEqual(['a1']);
    expect(t.notices).toEqual([]);
  });
  test('"Clear cart and add" replaces the cart with the new item', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 2 }] });
    t.guard.attempt([entry(fromB('b1'))]);
    t.prompts[0].clearAndAdd();
    expect(t.ids()).toEqual(['b1']);
    expect(t.cart().lines[0].quantity).toBe(1);
    expect(t.notices).toEqual([]);
  });
  test('Blynk into a seller cart names the seller; a seller into a Blynk cart names Blynk', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    t.guard.attempt([entry(blynk('s1'))]);
    expect(t.prompts[0].sellerName).toBe('Amina Stores');
    const u = setup(true, { lines: [{ product: blynk('s1'), quantity: 1 }] });
    u.guard.attempt([entry(fromA('a1'))]);
    expect(u.prompts[0].sellerName).toBe('Blynk');
  });
  test('a combo pack into a seller cart asks; into an empty cart it goes in', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    expect(t.guard.attempt([{ kind: 'combo', combo, quantity: 1 }])).toBe('asked');
    const u = setup(true);
    expect(u.guard.attempt([{ kind: 'combo', combo, quantity: 1 }])).toBe('added');
    expect(comboQuantityOf(u.cart(), 'c1')).toBe(1);
  });
});

describe('no question', () => {
  test('Blynk-only cart + Blynk item, same seller + same seller, empty cart + anything', () => {
    const t = setup(true, { lines: [{ product: blynk('s1'), quantity: 1 }] });
    expect(t.guard.attempt([entry(blynk('s2'))])).toBe('added');
    expect(t.ids()).toEqual(['s1', 's2']);
    const u = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    expect(u.guard.attempt([entry(fromA('a2'), 2)])).toBe('added');
    expect(u.ids()).toEqual(['a1', 'a2']);
    const v = setup(true);
    expect(v.guard.attempt([entry(fromB('b1'))])).toBe('added');
    expect(v.prompts).toEqual([]);
  });
  test('rule off (or an older server without the flag): mixed carts as before', () => {
    const t = setup(false, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    expect(t.guard.attempt([entry(fromB('b1')), entry(blynk('s1'))])).toBe('added');
    expect(t.ids()).toEqual(['a1', 'b1', 's1']);
    expect(t.prompts).toEqual([]);
  });
});

describe('bulk add (Add all, order again)', () => {
  test('one question for the whole list; "Clear cart and add" puts the list in', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    const done: unknown[] = [];
    t.guard.attempt([entry(fromB('b1'), 2), entry(fromB('b2'))], (o) => done.push(o));
    expect(t.prompts).toHaveLength(1);
    expect(done).toEqual([]);
    expect(t.ids()).toEqual(['a1']);
    t.prompts[0].clearAndAdd();
    expect(t.ids()).toEqual(['b1', 'b2']);
    expect(done).toEqual([{ addedUnits: 3, leftOut: 0 }]);
  });
  test('a mixed list: the first foreign source goes in, the rest is announced as left out', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    t.guard.attempt([entry(fromB('b1'), 2), entry(blynk('s1'), 3), entry(fromB('b2'))]);
    t.prompts[0].clearAndAdd();
    expect(t.ids()).toEqual(['b1', 'b2']);
    expect(t.notices).toEqual(['3 items from other sellers were not added.']);
  });
  test('"Keep current cart" never calls onDone and adds nothing', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    const done: unknown[] = [];
    t.guard.attempt([entry(fromB('b1'))], (o) => done.push(o));
    t.prompts[0].keep();
    expect(done).toEqual([]);
    expect(t.ids()).toEqual(['a1']);
  });
  test('empty cart and a mixed list: no question, first source in, the count of the rest announced', () => {
    const t = setup(true);
    expect(t.guard.attempt([entry(fromA('a1')), entry(blynk('s1'), 2), entry(fromA('a2'))])).toBe('added');
    expect(t.prompts).toEqual([]);
    expect(t.ids()).toEqual(['a1', 'a2']);
    expect(t.notices).toEqual(['2 items from other sellers were not added.']);
  });
  test('onDone gets the units that really went in (the cart caps a line), and no notice is shown by the guard', () => {
    const t = setup(true, { lines: [{ product: blynk('s1'), quantity: MAX_QTY - 1 }] });
    const done: unknown[] = [];
    expect(t.guard.attempt([entry(blynk('s1'), 5)], (o) => done.push(o))).toBe('added');
    expect(done).toEqual([{ addedUnits: 1, leftOut: 0 }]);
    expect(t.notices).toEqual([]);
  });
});

describe('a cart saved before the rule (mixed) at checkout', () => {
  test('"Start a new cart" keeps the first source only and says how many went', () => {
    const t = setup(true, { lines: [
      { product: fromA('a1'), quantity: 2 }, { product: blynk('s1'), quantity: 1 }, { product: fromB('b1'), quantity: 3 },
    ] });
    expect(t.guard.keepFirstSource()).toBe(4);
    expect(t.ids()).toEqual(['a1']);
    expect(t.notices).toEqual(['4 items from other sellers were removed from your cart.']);
  });
  test('a Blynk-first cart keeps Blynk lines and combo packs, drops the sellers', () => {
    const t = setup(true, { lines: [{ product: blynk('s1'), quantity: 1 }, { product: fromA('a1'), quantity: 2 }], combos: [{ combo, quantity: 1 }] });
    expect(t.guard.keepFirstSource()).toBe(2);
    expect(t.ids()).toEqual(['s1']);
    expect(t.cart().combos).toHaveLength(1);
  });
  test('a seller-first cart drops the combo packs (they are Blynk)', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }], combos: [{ combo, quantity: 2 }] });
    expect(t.guard.keepFirstSource()).toBe(2);
    expect(t.cart().combos).toEqual([]);
  });
  test('a single-source cart is left alone', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }] });
    expect(t.guard.keepFirstSource()).toBe(0);
    expect(t.notices).toEqual([]);
  });
  test('the persisted mixed cart is kept; it can still grow from a source it has', () => {
    const t = setup(true, { lines: [{ product: fromA('a1'), quantity: 1 }, { product: blynk('s1'), quantity: 1 }] });
    t.guard.attempt([entry(fromA('a2'))]);
    expect(t.ids()).toEqual(['a1', 's1', 'a2']);
    expect(t.prompts).toEqual([]);
  });
});

describe('collectEntries keeps the cart limits of the bulk code', () => {
  test('returns how many would go in (per line and per combo caps) and counts pending packs', () => {
    const c = collectEntries((k) => (k === 'p1' ? MAX_QTY - 2 : 0), (id) => (id === 'c1' ? 19 : 0));
    expect(c.addProduct(blynk('p1'), 5)).toBe(2);
    expect(c.addProduct(blynk('p1'), 1)).toBe(0);
    expect(c.addProduct(blynk('p2'), 3)).toBe(3);
    expect(c.comboQty('c1')).toBe(19);
    c.addCombo(combo);
    c.addCombo(combo);
    expect(c.comboQty('c1')).toBe(20);
    expect(c.entries.map((e) => e.quantity)).toEqual([2, 3, 1]);
  });
});
