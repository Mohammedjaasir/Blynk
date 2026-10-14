import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Product, ProductVariant } from '../api/types';
import { checkoutSignature, orderItems } from '../orders/checkout';
import { milk, MemoryStorage } from '../test/fixtures';
import {
  applyRefusal, itemCount, keyOf, lineAvailable, lineKey, lineQuantityOf, loadCart, needsVariant, quantityOf, reconcile, reconcileVariants,
  regularTotal, saveCart, setQuantity, subtotal, type CartState,
} from './cartStore';

const v = (id: string, label: string, selling: number, offer: number | null = null, available = true): ProductVariant => ({
  id, label, sku: null, barcode: null, sort_order: 0, selling_price: selling, offer_price: offer, offer_ends_at: null,
  offer_kind: offer == null ? null : 'PRODUCT', price: offer ?? selling, is_available: available,
});
const chilli: Product = { ...milk, id: 'p-chilli', name: 'Chilli Powder', selling_price: 60, offer_price: 50, has_variants: true, price_min: 50, price_max: 250 };
const g50 = v('v50', '50 g', 60, 50);
const g100 = v('v100', '100 g', 110);
const g250 = v('v250', '250 g', 250);

const g = globalThis as { localStorage?: unknown };
beforeEach(() => { g.localStorage = new MemoryStorage(); });
afterEach(() => { delete g.localStorage; });

describe('cart lines per variant', () => {
  test('two sizes of one product are two lines; the card count is both together', () => {
    let s: CartState = { lines: [] };
    s = setQuantity(s, chilli, 2, g50);
    s = setQuantity(s, chilli, 1, g100);
    s = setQuantity(s, milk, 1);
    expect(s.lines).toHaveLength(3);
    expect(lineQuantityOf(s, lineKey(chilli.id, g50.id))).toBe(2);
    expect(lineQuantityOf(s, lineKey(chilli.id, g100.id))).toBe(1);
    expect(quantityOf(s, chilli.id)).toBe(3);
    expect(lineKey(milk.id)).toBe(milk.id);
    expect(keyOf(s.lines[0])).toBe('p-chilli:v50');
    // removing one size leaves the other
    s = setQuantity(s, chilli, 0, g50);
    expect(s.lines.map(keyOf)).toEqual(['p-chilli:v100', milk.id]);
  });

  test('totals use each size its own (offer) price', () => {
    let s = setQuantity({ lines: [] }, chilli, 2, g50); // 2 x 50 (offer), regular 2 x 60
    s = setQuantity(s, chilli, 1, g250); // 250
    expect(subtotal(s)).toBe(350);
    expect(regularTotal(s)).toBe(370);
    expect(itemCount(s)).toBe(3);
  });

  test('the order sends variant_id per size line; the signature tells sizes apart', () => {
    let s = setQuantity({ lines: [] }, chilli, 2, g50);
    s = setQuantity(s, milk, 1);
    expect(orderItems(s.lines)).toEqual([
      { product_id: chilli.id, variant_id: g50.id, quantity: 2 },
      { product_id: milk.id, quantity: 1 },
    ]);
    const a = checkoutSignature({ items: orderItems(setQuantity({ lines: [] }, chilli, 1, g50).lines), addressId: 'x' });
    const b = checkoutSignature({ items: orderItems(setQuantity({ lines: [] }, chilli, 1, g100).lines), addressId: 'x' });
    expect(a).not.toBe(b);
  });

  test('size lines survive a reload; a broken size snapshot drops the line', () => {
    saveCart(setQuantity({ lines: [] }, chilli, 3, g100));
    const back = loadCart();
    expect(back.lines[0].variant).toEqual({ id: 'v100', label: '100 g', selling_price: 110, offer_price: null, offer_ends_at: null, is_available: true });
    expect(lineQuantityOf(back, 'p-chilli:v100')).toBe(3);
    (g.localStorage as MemoryStorage).setItem('blynk.app.cart.v1', JSON.stringify({ v: 1, lines: [{ product: chilli, quantity: 1, variant: { id: 'v1', label: 3 } }] }));
    expect(loadCart().lines).toEqual([]);
  });

  test('adding keeps combo packs in the cart', () => {
    const s = setQuantity({ lines: [], combos: [] }, chilli, 1, g50);
    expect(s.combos).toEqual([]);
  });
});

describe('fresh data', () => {
  test('a product page answer refreshes its size lines; a size no longer listed is sold out', () => {
    let s = setQuantity({ lines: [] }, chilli, 1, g50);
    s = setQuantity(s, chilli, 1, g100);
    s = reconcileVariants(s, { ...chilli, variants: [{ ...g50, offer_price: 45, price: 45 }] });
    expect(subtotal(s)).toBe(45);
    expect(lineAvailable(s.lines[1])).toBe(false);
    expect(s.lines[0].product.variants).toBeUndefined();
  });

  test('the catalogue list keeps the size snapshot; a product that lost its sizes makes them unavailable', () => {
    const s = setQuantity({ lines: [] }, chilli, 1, g50);
    expect(lineAvailable(reconcile(s, [chilli]).lines[0])).toBe(true);
    expect(lineAvailable(reconcile(s, [{ ...chilli, has_variants: false }]).lines[0])).toBe(false);
  });

  test('a plain line of a product that now has sizes asks for a size and is not ordered', () => {
    const s = reconcile(setQuantity({ lines: [] }, { ...chilli, has_variants: false }, 2), [chilli]);
    expect(needsVariant(s.lines[0])).toBe(true);
    expect(orderItems(s.lines)).toEqual([]);
    expect(itemCount(s)).toBe(0);
  });
});

describe('refusals at checkout', () => {
  test('INSUFFICIENT_STOCK lowers the line to what is left', () => {
    const s = setQuantity({ lines: [] }, chilli, 5, g100);
    const after = applyRefusal(s, { kind: 'only', product_id: chilli.id, variant_id: g100.id, available: 3 });
    expect(lineQuantityOf(after, 'p-chilli:v100')).toBe(3);
  });

  test('OUT_OF_STOCK marks only that size sold out', () => {
    let s = setQuantity({ lines: [] }, chilli, 1, g50);
    s = setQuantity(s, chilli, 1, g100);
    const after = applyRefusal(s, { kind: 'sold-out', product_id: chilli.id, variant_id: g100.id });
    expect(after.lines.map(lineAvailable)).toEqual([true, false]);
    expect(subtotal(after)).toBe(50);
  });

  test('OUT_OF_STOCK on a product without sizes marks the product', () => {
    const after = applyRefusal(setQuantity({ lines: [] }, milk, 2), { kind: 'sold-out', product_id: milk.id, variant_id: null });
    expect(after.lines[0].product.is_available).toBe(false);
    expect(itemCount(after)).toBe(0);
  });

  test('VARIANT_REQUIRED flags the plain line; an unknown line changes nothing', () => {
    const s = setQuantity({ lines: [] }, { ...chilli, has_variants: false }, 1);
    expect(needsVariant(applyRefusal(s, { kind: 'needs-size', product_id: chilli.id }).lines[0])).toBe(true);
    expect(applyRefusal(s, { kind: 'sold-out', product_id: 'other', variant_id: null })).toBe(s);
  });
});
