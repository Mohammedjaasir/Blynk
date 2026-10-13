import { loadCart, saveCart, setQuantity, quantityOf, itemCount, subtotal, regularTotal, reconcile, CART_KEY, type CartState } from './cartStore';
import { milk, sugar } from '../test/fixtures';

test('adds, clamps to 1..100 and removes at 0', () => {
  let s: CartState = { lines: [] };
  s = setQuantity(s, milk, 1);
  s = setQuantity(s, milk, 2);
  expect(quantityOf(s, milk.id)).toBe(2);
  s = setQuantity(s, milk, 150);
  expect(quantityOf(s, milk.id)).toBe(100);
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
  localStorage.setItem(CART_KEY, '{not json');
  expect(loadCart().lines).toEqual([]);
  localStorage.setItem(CART_KEY, JSON.stringify({ v: 0, items: [1] }));
  expect(loadCart().lines).toEqual([]);
  localStorage.setItem(CART_KEY, JSON.stringify({ v: 1, lines: [{ product: milk, quantity: 999 }] }));
  expect(quantityOf(loadCart(), milk.id)).toBe(100);
});

test('reconcile refreshes prices and marks vanished or unavailable products', () => {
  let s = setQuantity(setQuantity({ lines: [] }, milk, 1), sugar, 1);
  const fresh = [{ ...milk, offer_price: 500 }];
  s = reconcile(s, fresh);
  expect(s.lines.find((l) => l.product.id === milk.id)!.product.offer_price).toBe(500);
  expect(s.lines.find((l) => l.product.id === sugar.id)!.product.is_available).toBe(false);
  expect(subtotal(s)).toBe(500);
});
