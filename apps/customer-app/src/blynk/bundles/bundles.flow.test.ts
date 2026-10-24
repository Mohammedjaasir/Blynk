import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Combo, Product } from '@/blynk/api/types';
import { itemsFromOrder } from '@/blynk/repeat/payload';
import { parseOrder } from '@/blynk/orders/api';
import { reorderInto } from '@/blynk/orders/reorder';
import type { Order, OrderItem } from '@/blynk/orders/types';
import { MemoryStorage, milk } from '../test/fixtures';

/* Bundle offers around the quote, the order and "order again" / "repeat this basket". */

vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const line = (id: string, quantity: number, over: Partial<OrderItem> = {}): OrderItem => ({
  id, product_id: milk.id, product_name_snapshot: 'Milk', unit_snapshot: null, unit_selling_price: 100, quantity, subtotal: 100 * quantity, item_status: 'PACKED', ...over,
});

test('order again and repeat basket skip the free units and gifts: the offer gives them back', async () => {
  const items = [
    line('a', 2),
    line('b', 1, { unit_selling_price: 0, subtotal: 0, is_bundle_free: true, bundle_kind: 'FREE_UNITS', bundle_value: 100 }),
    line('c', 1, { product_id: 'p-gift', product_name_snapshot: 'Biscuit pack', unit_selling_price: 0, subtotal: 0, is_bundle_free: true, bundle_kind: 'GIFT', bundle_value: 250 }),
  ];
  expect(itemsFromOrder(items)).toEqual([{ product_id: milk.id, variant_id: null, quantity: 2 }]);

  const cart = new Map<string, number>();
  const r = await reorderInto({ items } as Pick<Order, 'items' | 'combos'>, {
    fetchProduct: async (id: string) => ({ ...milk, id } as Product),
    fetchCombos: async () => [] as Combo[],
    comboQty: () => 0,
    addCombo: () => undefined,
    addProduct: (p: Product, n: number) => { cart.set(p.id, (cart.get(p.id) ?? 0) + n); return n; },
  });
  expect(cart.get(milk.id)).toBe(2);
  expect(cart.has('p-gift')).toBe(false);
  expect(r.addedUnits).toBe(2);
});

test('an order carries its bundle saving as a number and its free lines as they came', () => {
  const o = parseOrder({
    id: 'o1', order_number: 'BL-1', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING', subtotal_amount: '200.00', delivery_fee: 100,
    discount_amount: 0, birthday_discount_amount: 0, referral_discount_amount: 0, points_discount_amount: 0, bundle_savings: '100.00', coupon_code: null,
    total_amount: 300, can_cancel: true, created_at: '2026-10-25T10:00:00Z',
    items: [line('a', 2), line('b', 1, { unit_selling_price: 0, subtotal: 0, is_bundle_free: true, bundle_kind: 'FREE_UNITS', bundle_value: '100.00' as unknown as number })],
  } as unknown as Order);
  expect(o.bundle_savings).toBe(100);
  expect(o.items[1]).toMatchObject({ is_bundle_free: true, bundle_kind: 'FREE_UNITS', bundle_value: 100 });
  expect(parseOrder({ ...o, bundle_savings: undefined }).bundle_savings).toBeUndefined();
});

test('the bundle quote POSTs the cart lines with the bearer token and parses the answer', async () => {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  const { getBundleQuote } = await import('./api');
  const { API_BASE_URL } = await import('@/blynk/api/client');
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    success: true, data: { ready: true, subtotal_before_bundles: 360, bundle_savings: 120, subtotal: 240, bundle_applied: [], gift_items: [], bundle_progress: null, lines: [{ product_id: 'p1', variant_id: null, quantity: 3, paid_quantity: 2, free_quantity: 1, unit_price: 120 }] },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const q = await getBundleQuote([{ product_id: 'p1', quantity: 3 }]);
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/orders/bundle-quote`);
  expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ items: [{ product_id: 'p1', quantity: 3 }] }) });
  expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  expect(q?.subtotal).toBe(240);
  expect(q?.lines[0].free_quantity).toBe(1);
});
