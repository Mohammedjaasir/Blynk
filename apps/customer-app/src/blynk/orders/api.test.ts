import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryStorage } from '../test/fixtures';

/* Fresh modules over a fake localStorage with a signed-in session, as after sign-in. */
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function load() {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  const api = await import('./api');
  const errors = await import('./errors');
  const client = await import('@/blynk/api/client');
  return { ...api, ...errors, ...client };
}

// the first test loads fresh modules, which is slow on a busy machine
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const order = {
  id: 'o1', order_number: 'BL-20261013-1234', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING',
  subtotal_amount: '1026.00', delivery_fee: 150, discount_amount: 0, birthday_discount_amount: 0, referral_discount_amount: 0,
  points_discount_amount: 0, coupon_code: null, total_amount: 1176, can_cancel: true, created_at: '2026-10-13T10:00:00Z',
  items: [{ id: 'i1', product_id: 'p1', product_name_snapshot: 'Milk', unit_snapshot: '1 L', unit_selling_price: '513.00', quantity: 2, subtotal: 1026, item_status: 'PENDING' }],
};

test('placeOrder POSTs /orders with the bearer token and the idempotency key, and parses amounts', async () => {
  const { placeOrder, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(201, { success: true, data: { order, is_idempotent_replay: false } }));
  const body = { address_id: 'a1', items: [{ product_id: 'p1', quantity: 2 }], idempotency_key: 'app_abc' };
  const placed = await placeOrder(body);
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/orders`, expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  expect(placed.subtotal_amount).toBe(1026);
  expect(placed.items[0].unit_selling_price).toBe(513);
});

test('checkout-info sends the address and the subtotal', async () => {
  const { getCheckoutInfo, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: {
    delivery_fee_lkr: '150', standard_delivery_fee_lkr: 150, delivery_fee_mode: 'FLAT', delivery_distance_km: '2.40',
    coupons_enabled: false, free_delivery: { applies: false },
  } }));
  const q = await getCheckoutInfo('a1', 1026.004);
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/orders/checkout-info?address_id=a1&subtotal=1026`);
  expect(q.delivery_fee_lkr).toBe(150);
  expect(q.delivery_distance_km).toBe(2.4);
});

test('an out-of-area refusal keeps its code and gets the customer copy', async () => {
  const { placeOrder, placeErrorCopy } = await load();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(422, { success: false, error: { code: 'DELIVERY_OUTSIDE_RADIUS', message: 'outside', details: { distance_km: 14, max_radius_km: 4 } } }));
  const e = await placeOrder({ address_id: 'a1', items: [{ product_id: 'p1', quantity: 1 }], idempotency_key: 'k' }).catch((x) => x);
  expect(placeErrorCopy(e)).toEqual({ title: "We don't deliver there yet", message: "We don't deliver to this address yet. Choose another address.", action: 'address' });
});

test('listOrders and getOrder read the customer endpoints', async () => {
  const { listOrders, getOrder, cancelOrder, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json(200, { success: true, data: { orders: [order], pagination: { page: 1, limit: 20, total: 1, total_pages: 1 } } }))
    .mockResolvedValueOnce(json(200, { success: true, data: { order: { ...order, history: [], delivery: null, delivery_code: null, rider_contact: null } } }))
    .mockResolvedValueOnce(json(200, { success: true, data: { order: { ...order, order_status: 'CANCELLED', can_cancel: false } } }));
  const list = await listOrders();
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/orders?page=1&limit=20`);
  expect(list.orders[0].subtotal_amount).toBe(1026);
  const one = await getOrder('o1');
  expect(f.mock.calls[1][0]).toBe(`${API_BASE_URL}/orders/o1`);
  expect(one.can_cancel).toBe(true);
  const cancelled = await cancelOrder('o1');
  expect(f.mock.calls[2][0]).toBe(`${API_BASE_URL}/orders/o1/cancel`);
  expect(cancelled.can_cancel).toBe(false);
});

test('placeOrder sends the full checkout body as given (slot, points, receiver, note, needs help, coupon)', async () => {
  const { placeOrder } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(201, { success: true, data: { order, is_idempotent_replay: false } }));
  const body = {
    address_id: 'a1', items: [{ product_id: 'p1', quantity: 2 }], idempotency_key: 'app_k', coupon_code: 'SAVE10',
    delivery_note: 'Gate 12', delivery_slot_start: '2026-10-14T02:30:00.000Z', use_points: true,
    for_someone_else: true, recipient: { name: 'Amma', phone: '+94771234567' }, needs_help: true,
  };
  await placeOrder(body);
  expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual(body);
});

test('getDeliverySlots reads GET /orders/slots and drops bad rows', async () => {
  const { getDeliverySlots, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: {
    enabled: true, asap_available: true, is_open_now: true, slots: [
      { start: '2026-10-14T02:30:00.000Z', end: '2026-10-14T04:30:00.000Z', day_label: 'Tomorrow', time_label: '8-10 AM', label: 'Tomorrow 8-10 AM', remaining: 2, available: true },
      { nope: true },
    ] } }));
  const s = await getDeliverySlots();
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/orders/slots`);
  expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  expect(s.slots).toHaveLength(1);
  expect(s.asap_available).toBe(true);
});

test('cancelOrder sends a reason only when it is long enough', async () => {
  const { cancelOrder } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, { success: true, data: { order: { ...order, order_status: 'CANCELLED', can_cancel: false } } }));
  await cancelOrder('o1', 'no');
  await cancelOrder('o1', ' Ordered by mistake ');
  expect((f.mock.calls[0][1] as RequestInit).body).toBe('{}');
  expect((f.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify({ reason: 'Ordered by mistake' }));
});
