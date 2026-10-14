import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Combo } from '../api/types';
import { checkoutSignature, orderCombos } from '../orders/checkout';
import { milk, MemoryStorage } from '../test/fixtures';
import {
  CART_KEY, comboQuantityOf, itemCount, loadCart, MAX_COMBO_LINES, MAX_COMBO_QTY, reconcile, reconcileCombos, regularTotal, saveCart,
  setComboQuantity, setQuantity, subtotal, type CartState,
} from './cartStore';

const g = globalThis as { localStorage?: unknown };
let ls: MemoryStorage;
beforeEach(() => { ls = new MemoryStorage(); g.localStorage = ls; });
afterEach(() => { delete g.localStorage; });

const combo = (id: string, over: Partial<Combo> = {}): Combo => ({
  id, name: `Pack ${id}`, description: null, image_url: null, price: 900, items_total: 1100, saving: 200, ends_at: null,
  is_available: true,
  items: [
    { product_id: 'p-bread', name: 'Bread', slug: null, unit: null, pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, quantity: 1, selling_price: 300, unit_price: 300, is_available: true },
    { product_id: 'p-egg', name: 'Eggs', slug: null, unit: null, pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, quantity: 2, selling_price: 400, unit_price: 400, is_available: true },
  ],
  ...over,
});

test('combo packs count as items and add their price (and items total at regular prices)', () => {
  let s: CartState = setQuantity({ lines: [] }, milk, 1); // 513 offer / 540 regular
  s = setComboQuantity(s, combo('a'), 2);
  expect(comboQuantityOf(s, 'a')).toBe(2);
  expect(itemCount(s)).toBe(3);
  expect(subtotal(s)).toBe(513 + 1800);
  expect(regularTotal(s)).toBe(540 + 2200);
  // a sold-out pack is out of the totals, like an unavailable product
  s = setComboQuantity(s, combo('a', { is_available: false }), 2);
  expect(itemCount(s)).toBe(1);
  expect(subtotal(s)).toBe(513);
});

test('combo quantities clamp to 20 packs, 20 different combos, and 0 removes', () => {
  let s: CartState = { lines: [] };
  s = setComboQuantity(s, combo('a'), 99);
  expect(comboQuantityOf(s, 'a')).toBe(MAX_COMBO_QTY);
  for (let i = 0; i < MAX_COMBO_LINES + 3; i++) s = setComboQuantity(s, combo(`x${i}`), 1);
  expect(s.combos).toHaveLength(MAX_COMBO_LINES);
  s = setComboQuantity(s, combo('a'), 0);
  expect(comboQuantityOf(s, 'a')).toBe(0);
});

test('combo lines persist with the cart, and a cart saved before combos still loads', () => {
  saveCart(setComboQuantity(setQuantity({ lines: [] }, milk, 1), combo('a'), 3));
  const back = loadCart();
  expect(back.lines).toHaveLength(1);
  expect(comboQuantityOf(back, 'a')).toBe(3);
  ls.setItem(CART_KEY, JSON.stringify({ v: 1, lines: [{ product: milk, quantity: 1 }] }));
  expect(loadCart().combos ?? []).toEqual([]);
  ls.setItem(CART_KEY, JSON.stringify({ v: 1, lines: [], combos: [{ combo: { id: 'bad' }, quantity: 1 }, { combo: combo('b'), quantity: 2 }] }));
  expect(loadCart().combos?.map((l) => l.combo.id)).toEqual(['b']);
});

test('product reconcile keeps combos; fresh combos replace snapshots, a vanished one is kept', () => {
  let s: CartState = setComboQuantity(setQuantity({ lines: [] }, milk, 1), combo('a'), 1);
  s = setComboQuantity(s, combo('gone'), 1);
  expect(reconcile(s, [milk]).combos).toHaveLength(2);
  const fresh = reconcileCombos(s, [combo('a', { price: 850 })]);
  expect(fresh.combos?.find((l) => l.combo.id === 'a')?.combo.price).toBe(850);
  expect(fresh.combos?.find((l) => l.combo.id === 'gone')).toBeTruthy();
});

test('the order sends available combos as {combo_id, quantity}; they change the checkout signature', () => {
  const lines = [{ combo: combo('a'), quantity: 2 }, { combo: combo('b', { is_available: false }), quantity: 1 }];
  expect(orderCombos(lines)).toEqual([{ combo_id: 'a', quantity: 2 }]);
  expect(orderCombos(undefined)).toEqual([]);
  const items = [{ product_id: milk.id, quantity: 1 }];
  const base = checkoutSignature({ items, addressId: 'addr' });
  expect(checkoutSignature({ items, addressId: 'addr', combos: [] })).toBe(base);
  expect(checkoutSignature({ items, addressId: 'addr', combos: [{ combo_id: 'a', quantity: 2 }] })).not.toBe(base);
  expect(checkoutSignature({ items, addressId: 'addr', combos: [{ combo_id: 'a', quantity: 1 }] }))
    .not.toBe(checkoutSignature({ items, addressId: 'addr', combos: [{ combo_id: 'a', quantity: 2 }] }));
});
