import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import type { Product, ProductVariant } from '@/blynk/api/types';
import { milk, MemoryStorage } from '../test/fixtures';
import { productIdsQuery } from './api';
import { reorderInto } from './reorder';
import type { OrderItem } from './types';

/* Migration 045 on the order calls: product_ids for the lead time, variant lines on "Order again". */
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
async function load() {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  return { ...(await import('./api')), ...(await import('@/blynk/api/client')) };
}
vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('product_ids: unique, no design-mock ids, at most 100', () => {
  expect(productIdsQuery(['b', 'a', 'b', 'demo-x'])).toBe('product_ids=b,a');
  expect(productIdsQuery([])).toBe('');
  expect(productIdsQuery(undefined)).toBe('');
  expect(productIdsQuery(Array.from({ length: 150 }, (_, i) => `p${i}`)).split(',')).toHaveLength(100);
});

test('slots and checkout-info carry the cart product ids and read the lead time', async () => {
  const { getDeliverySlots, getCheckoutInfo, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json(200, { success: true, data: {
      enabled: true, asap_available: false, is_open_now: true, lead_days: 2, earliest_delivery_date: '2026-10-16', earliest_delivery_label: 'Fri 16 Oct', slots: [],
    } }))
    .mockResolvedValueOnce(json(200, { success: true, data: {
      delivery_fee_lkr: 150, standard_delivery_fee_lkr: 150, delivery_fee_mode: 'FLAT', delivery_distance_km: null, coupons_enabled: false,
      free_delivery: { applies: false }, delivery_lead: { lead_days: '2', earliest_delivery_date: '2026-10-16', earliest_delivery_label: 'Fri 16 Oct', asap_allowed: false },
    } }));
  const s = await getDeliverySlots(undefined, ['p-cake', 'p-milk']);
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/orders/slots?product_ids=p-cake,p-milk`);
  expect(s).toMatchObject({ lead_days: 2, asap_available: false, earliest_delivery_label: 'Fri 16 Oct' });
  const q = await getCheckoutInfo('a1', 900, undefined, ['p-cake']);
  expect(f.mock.calls[1][0]).toBe(`${API_BASE_URL}/orders/checkout-info?address_id=a1&subtotal=900&product_ids=p-cake`);
  expect(q.delivery_lead).toEqual({ lead_days: 2, earliest_delivery_date: '2026-10-16', earliest_delivery_label: 'Fri 16 Oct', asap_allowed: false });
});

const size = (id: string, label: string, available = true): ProductVariant => ({
  id, label, sku: null, barcode: null, sort_order: 0, selling_price: 100, offer_price: null, offer_ends_at: null, offer_kind: null, price: 100, is_available: available,
});
const item = (id: string, product_id: string, quantity: number, variant_id: string | null, label: string | null): OrderItem => ({
  id, product_id, product_name_snapshot: 'Chilli Powder', unit_snapshot: label, unit_selling_price: 100, quantity, subtotal: 100 * quantity,
  item_status: 'PACKED', order_combo_id: null, variant_id, variant_label_snapshot: label,
});

test('Order again puts each size back as that size; a gone or sold-out size is named', async () => {
  const chilli: Product = { ...milk, id: 'p-chilli', has_variants: true, variants: [size('v50', '50 g'), size('v100', '100 g', false)] };
  const added: string[] = [];
  const r = await reorderInto(
    { items: [item('a', 'p-chilli', 2, 'v50', '50 g'), item('b', 'p-chilli', 1, 'v100', '100 g'), item('c', 'p-chilli', 1, 'v-old', '1 kg'), item('d', 'p-chilli', 1, null, null)] },
    {
      fetchProduct: async (id) => { if (id === 'p-chilli') return chilli; throw new ApiError('Not found', 404); },
      fetchCombos: async () => [],
      comboQty: () => 0,
      addCombo: () => undefined,
      addProduct: (p, n, v) => { added.push(`${p.id}:${v?.id ?? '-'}x${n}`); return n; },
    },
  );
  expect(added).toEqual(['p-chilli:v50x2']);
  expect(r.addedUnits).toBe(2);
  // the plain line of a product now sold in sizes is named too (the customer picks a size)
  expect(r.unavailable).toEqual(['Chilli Powder 100 g', 'Chilli Powder 1 kg', 'Chilli Powder']);
});
