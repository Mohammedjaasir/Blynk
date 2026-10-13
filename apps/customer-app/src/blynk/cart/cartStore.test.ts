import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadCart, saveCart, setQuantity, quantityOf, itemCount, subtotal, regularTotal, reconcile, validLine, CART_KEY, MAX_QTY, type CartState } from './cartStore';
import { milk, sugar, MemoryStorage } from '../test/fixtures';

const g = globalThis as { localStorage?: unknown };
let ls: MemoryStorage;
beforeEach(() => { ls = new MemoryStorage(); g.localStorage = ls; });
afterEach(() => { delete g.localStorage; });

test('adds, clamps to 1..MAX_QTY and removes at 0', () => {
  let s: CartState = { lines: [] };
  s = setQuantity(s, milk, 1);
  s = setQuantity(s, milk, 2);
  expect(quantityOf(s, milk.id)).toBe(2);
  s = setQuantity(s, milk, 150);
  expect(quantityOf(s, milk.id)).toBe(MAX_QTY);
  expect(MAX_QTY).toBe(100);
  s = setQuantity(s, milk, 0);
  expect(s.lines).toHaveLength(0);
});

test('totals use the offer price, regular total the selling price', () => {
  let s = setQuantity({ lines: [] }, milk, 2);
  s = setQuantity(s, sugar, 1);
  expect(itemCount(s)).toBe(3);
  expect(subtotal(s)).toBe(1279);
  expect(regularTotal(s)).toBe(1333);
});

test('persists and reloads; corrupt or old storage gives an empty cart', () => {
  saveCart(setQuantity({ lines: [] }, milk, 3));
  expect(quantityOf(loadCart(), milk.id)).toBe(3);
  ls.setItem(CART_KEY, '{not json');
  expect(loadCart().lines).toEqual([]);
  ls.setItem(CART_KEY, JSON.stringify({ v: 0, items: [1] }));
  expect(loadCart().lines).toEqual([]);
  ls.setItem(CART_KEY, JSON.stringify({ v: 1, lines: [{ product: milk, quantity: 999 }] }));
  expect(quantityOf(loadCart(), milk.id)).toBe(100);
});

test('without localStorage (native) the cart still persists in memory', () => {
  delete g.localStorage;
  saveCart(setQuantity({ lines: [] }, sugar, 4));
  expect(quantityOf(loadCart(), sugar.id)).toBe(4);
});

test('a storage that throws never breaks the cart', () => {
  g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  expect(() => saveCart(setQuantity({ lines: [] }, milk, 1))).not.toThrow();
  expect(() => loadCart()).not.toThrow();
});

test('reconcile refreshes prices and marks vanished or unavailable products', () => {
  let s = setQuantity(setQuantity({ lines: [] }, milk, 1), sugar, 1);
  const fresh = [{ ...milk, offer_price: 500 }];
  s = reconcile(s, fresh);
  expect(s.lines.find((l) => l.product.id === milk.id)!.product.offer_price).toBe(500);
  expect(s.lines.find((l) => l.product.id === sugar.id)!.product.is_available).toBe(false);
  expect(subtotal(s)).toBe(500);
});

test('NaN quantity never creates a line', () => {
  const s = setQuantity({ lines: [] }, milk, NaN);
  expect(s.lines).toEqual([]);
  expect(setQuantity(setQuantity({ lines: [] }, milk, 2), milk, NaN).lines).toEqual([]);
});

test('loadCart drops lines with a bad price or availability', () => {
  const bad = [
    { product: { ...milk, selling_price: undefined }, quantity: 1 },
    { product: { ...milk, id: 'b2', selling_price: '540' }, quantity: 1 },
    { product: { ...milk, id: 'b3', offer_price: 'x' }, quantity: 1 },
    { product: { ...milk, id: 'b4', is_available: 'yes' }, quantity: 1 },
    { product: sugar, quantity: 2 },
  ];
  ls.setItem(CART_KEY, JSON.stringify({ v: 1, lines: bad }));
  const s = loadCart();
  expect(s.lines.map((l) => l.product.id)).toEqual([sugar.id]);
  expect(subtotal(s)).toBe(506);
  expect(validLine({ product: sugar, quantity: 1 })).toBe(true);
});

test('itemCount ignores unavailable lines so it agrees with the subtotal', () => {
  const s = setQuantity(setQuantity({ lines: [] }, sugar, 2), milk, 1);
  expect(itemCount(reconcile(s, [sugar]))).toBe(2);
});
