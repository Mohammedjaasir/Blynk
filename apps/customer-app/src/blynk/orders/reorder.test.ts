import { expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import type { Combo, Product } from '@/blynk/api/types';
import { milk, sugar } from '../test/fixtures';
import { canReorder, reorderInto, reorderMessage } from './reorder';
import type { Order, OrderItem } from './types';

const item = (id: string, product_id: string, name: string, quantity: number, order_combo_id: string | null = null): OrderItem => ({
  id, product_id, product_name_snapshot: name, unit_snapshot: null, unit_selling_price: 100, quantity, subtotal: 100 * quantity, item_status: 'PACKED', order_combo_id,
});
const pack = { id: 'pack-1', name: 'Tea pack', description: null, image_url: null, price: 700, items_total: 793, saving: 93, ends_at: null, is_available: true, items: [] } as Combo;

function harness(products: Record<string, Product | Error>, combos: Combo[] = []) {
  const cart = new Map<string, number>();
  const comboCart = new Map<string, number>();
  return {
    cart, comboCart,
    deps: {
      fetchProduct: async (id: string) => { const p = products[id]; if (!p || p instanceof Error) throw p ?? new ApiError('Not found', 404); return p; },
      fetchCombos: async () => combos,
      comboQty: (id: string) => comboCart.get(id) ?? 0,
      addCombo: (c: Combo) => comboCart.set(c.id, Math.min(20, (comboCart.get(c.id) ?? 0) + 1)),
      addProduct: (p: Product, n: number) => { const b = cart.get(p.id) ?? 0; const a = Math.min(100, b + n); cart.set(p.id, a); return a - b; },
    },
  };
}

test('only finished orders offer Order again', () => {
  expect(canReorder({ items: [item('i', milk.id, 'Milk', 1)], order_status: 'DELIVERED' })).toBe(true);
  expect(canReorder({ items: [item('i', milk.id, 'Milk', 1)], order_status: 'OUT_FOR_DELIVERY' })).toBe(false);
  expect(canReorder({ items: [], order_status: 'CANCELLED' })).toBe(false);
});

test('re-adds today’s products, names the gone and sold-out ones, and a live combo goes back as a pack', async () => {
  const h = harness({ [milk.id]: milk, [sugar.id]: { ...sugar, is_available: false }, 'p-gone': new ApiError('Not found', 404) }, [pack]);
  const order: Pick<Order, 'items' | 'combos'> = {
    items: [
      item('a', milk.id, 'Milk', 2), item('b', sugar.id, 'Sugar', 1), item('c', 'p-gone', 'Old biscuits', 1),
      item('d', 'p-tea', 'Tea', 1, 'oc-1'),
    ],
    combos: [{ id: 'oc-1', combo_id: 'pack-1', name: 'Tea pack', unit_price: 700, quantity: 1, subtotal: 700, items_regular_total: 793 }],
  };
  const r = await reorderInto(order, h.deps);
  expect(h.cart.get(milk.id)).toBe(2);
  expect(h.comboCart.get('pack-1')).toBe(1);
  expect(r.addedUnits).toBe(3);
  expect(r.unavailable).toEqual(['Sugar', 'Old biscuits']);
  expect(r.offline).toBe(false);
  expect(reorderMessage(r).text).toBe('Added 3 items. Not available now: Sugar, Old biscuits.');
});

test('an ended combo falls back to its products; all calls failing is offline', async () => {
  const h = harness({ 'p-tea': { ...milk, id: 'p-tea' } }, []);
  const r = await reorderInto({
    items: [item('d', 'p-tea', 'Tea', 2, 'oc-1')],
    combos: [{ id: 'oc-1', combo_id: 'pack-1', name: 'Tea pack', unit_price: 700, quantity: 1, subtotal: 700, items_regular_total: 793 }],
  }, h.deps);
  expect(h.cart.get('p-tea')).toBe(2);
  expect(r.addedUnits).toBe(2);
  const off = await reorderInto({ items: [item('a', milk.id, 'Milk', 1)] }, harness({ [milk.id]: new ApiError('offline', 0, 'NETWORK_ERROR') }).deps);
  expect(off.offline).toBe(true);
  expect(reorderMessage(off).ok).toBe(false);
});
