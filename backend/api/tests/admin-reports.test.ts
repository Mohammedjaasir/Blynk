import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { rangeBounds, resolveSalesRange } from '../src/modules/reports/sales.service.js';
import { sameAddress } from '../src/modules/reports/customers.service.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * The Admin sales dashboard and customer list. Test orders are moved to
 * March 2020 (placed_at) so the figures for that range are exactly this
 * file's, whatever else the shared database holds.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RPT-');
const people = customerFixtures(app, { idPrefix: 'c0c00002', phoneBase: '+9470991', name: 'Zqxreport Shopper' });
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });
const PRICE = 120;
const FEE = 100;
const CODE = 'TSTRPT10';

let apple = '';
let bread = '';
let couponId = '';
type Shopper = Awaited<ReturnType<typeof people.customer>>;
let alice: Shopper;
let bob: Shopper;
let carol: Shopper;

const placedAt = (orderId: string, iso: string) => pool.query('UPDATE orders SET placed_at = $2 WHERE id = $1', [orderId, iso]);

beforeAll(async () => {
  await people.purge();
  await pool.query('DELETE FROM coupons WHERE code = $1', [CODE]);
  await fx.setup();
  apple = (await fx.product({ tracked: false })).productId;
  bread = (await fx.product({ tracked: false })).productId;
  couponId = (
    await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code: CODE, discount_type: 'FIXED', discount_value: 40, per_customer_limit: 5 })
  ).body.data.coupon.id;

  alice = await people.customer(1, 'Zqxreport Alice');
  bob = await people.customer(2, 'Zqxreport Bob');
  carol = await people.customer(3, 'Zqxreport Carol');

  const deliver = async (who: Shopper, items: { product_id: string; quantity: number }[], extra: object = {}) => {
    const o = await expectCreated(await who.placeOrder(items, extra));
    fx.created.orders.push(o.id);
    expect((await fx.pack(o.id)).status).toBe(200);
    await fx.deliver(o.id);
    return o.id as string;
  };

  // 2020-03-10 in Colombo (UTC+5:30).
  // Alice: delivered 09:30, 3 apples + 1 bread with the coupon (480 - 40 + 100 = 540).
  await placedAt(await deliver(alice, [{ product_id: apple, quantity: 3 }, { product_id: bread, quantity: 1 }], { coupon_code: CODE }), '2020-03-10T04:00:00Z');
  // Alice: delivered 00:15 (the 9th, 18:45 UTC), 1 bread (120 + 100 = 220).
  await placedAt(await deliver(alice, [{ product_id: bread, quantity: 1 }]), '2020-03-09T18:45:00Z');
  // Bob: delivered 23:30, 5 bread (600 + 100 = 700).
  await placedAt(await deliver(bob, [{ product_id: bread, quantity: 5 }]), '2020-03-10T18:00:00Z');
  // Bob: cancelled 09:50.
  const cancelled = await expectCreated(await bob.placeOrder([{ product_id: apple, quantity: 2 }]));
  expect((await request(app).post(`/api/v1/orders/${cancelled.id}/cancel`).set(auth(bob.token)).send({})).status).toBe(200);
  await placedAt(cancelled.id, '2020-03-10T04:20:00Z');
  // Carol: 23:45 on the 9th in Colombo - outside the day.
  await placedAt((await expectCreated(await carol.placeOrder([{ product_id: apple, quantity: 9 }]))).id, '2020-03-09T18:15:00Z');
}, 60_000);

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM coupons WHERE id = $1', [couponId]);
  // Coupon changes are audited (owner, 2026-10-10).
  await pool.query("DELETE FROM audit_logs WHERE entity_type = 'COUPON' AND coalesce(new_values->>'code', old_values->>'code') = $1", [CODE]);
});

describe('Sales ranges (Asia/Colombo)', () => {
  it('turns presets into Colombo dates', () => {
    // 20:00 UTC on 31 Jan is already 1 Feb in Colombo.
    const now = new Date('2026-01-31T20:00:00Z');
    expect(resolveSalesRange('today', now)).toEqual({ from: '2026-02-01', to: '2026-02-01' });
    expect(resolveSalesRange('yesterday', now)).toEqual({ from: '2026-01-31', to: '2026-01-31' });
    expect(resolveSalesRange('last_7_days', now)).toEqual({ from: '2026-01-26', to: '2026-02-01' });
    expect(resolveSalesRange('last_30_days', now)).toEqual({ from: '2026-01-03', to: '2026-02-01' });
  });

  it('bounds a day at Colombo midnight', () => {
    const { start, end } = rangeBounds({ from: '2020-03-10', to: '2020-03-10' });
    expect(start.toISOString()).toBe('2020-03-09T18:30:00.000Z');
    expect(end.toISOString()).toBe('2020-03-10T18:30:00.000Z');
  });
});

describe('GET /admin/reports/sales', () => {
  it('reports one Colombo day', async () => {
    const res = await request(app).get('/api/v1/admin/reports/sales?from=2020-03-10&to=2020-03-10').set(auth(tokens.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.data;
    expect(r).toMatchObject({
      order_count: 4,
      delivered_count: 3,
      cancelled_count: 1,
      delivered_revenue: 540 + 220 + 700,
      average_basket: Number(((540 + 220 + 700) / 3).toFixed(2)),
      discount_given: 40,
      delivery_fees: 3 * FEE,
    });
    expect(r.top_by_quantity.map((p: { product_id: string; quantity: number; revenue: number }) => [p.product_id, p.quantity, p.revenue])).toEqual([
      [bread, 7, 7 * PRICE],
      [apple, 3, 3 * PRICE],
    ]);
    expect(r.top_by_revenue[0].product_id).toBe(bread);
    expect(r.orders_by_hour).toHaveLength(24);
    const hours = Object.fromEntries(r.orders_by_hour.filter((h: { orders: number }) => h.orders).map((h: { hour: number; orders: number }) => [h.hour, h.orders]));
    expect(hours).toEqual({ 0: 1, 9: 2, 23: 1 });
  });

  it('a range spans days', async () => {
    const res = await request(app).get('/api/v1/admin/reports/sales?from=2020-03-09&to=2020-03-10').set(auth(tokens.admin));
    expect(res.body.data.order_count).toBe(5);
    // Carol's 9 apples (the 9th) were never delivered, so apples stay at 3.
    expect(res.body.data.top_by_quantity.map((p: { quantity: number }) => p.quantity)).toEqual([7, 3]);
  });

  it('accepts presets and validates input', async () => {
    const ok = await request(app).get('/api/v1/admin/reports/sales?range=last_7_days').set(auth(tokens.admin));
    expect(ok.status).toBe(200);
    expect(ok.body.data.range.timezone).toBe('Asia/Colombo');
    for (const q of ['range=forever', 'from=2020-03-10', 'from=2020-03-10&to=2020-03-01', 'from=2019-01-01&to=2020-03-01']) {
      expect((await request(app).get(`/api/v1/admin/reports/sales?${q}`).set(auth(tokens.admin))).status, q).toBe(400);
    }
  });

  it('is ADMIN only', async () => {
    for (const t of [opsToken, tokens.staff, tokens.customer]) {
      expect((await request(app).get('/api/v1/admin/reports/sales').set(auth(t))).status).toBe(403);
    }
  });
});

describe('GET /admin/customers', () => {
  it('searches by name, with orders, delivered spend and last order', async () => {
    const res = await request(app).get('/api/v1/admin/customers?search=zqxreport&sort=spend').set(auth(tokens.admin));
    expect(res.status).toBe(200);
    const rows = res.body.data.customers;
    expect(rows.map((c: { full_name: string }) => c.full_name)).toEqual(['Zqxreport Alice', 'Zqxreport Bob', 'Zqxreport Carol']);
    expect(rows[0]).toMatchObject({ phone: alice.phone, orders_count: 2, delivered_count: 2, delivered_spend: 760 });
    expect(rows[1]).toMatchObject({ orders_count: 2, delivered_spend: 700 });
    expect(rows[2]).toMatchObject({ orders_count: 1, delivered_spend: 0 });
    expect(new Date(rows[1].last_order_at).toISOString()).toBe('2020-03-10T18:00:00.000Z');
    expect(res.body.data.pagination).toMatchObject({ total: 3, page: 1 });
    // Each customer's address, recorded in Admin (owner, 2026-10-11).
    expect(rows[0]).toMatchObject({ addresses_count: 1, default_address: 'No. 1, Test Lane, Dharga Town' });
  });

  it('sorts by order count and pages', async () => {
    const page2 = await request(app).get('/api/v1/admin/customers?search=Zqxreport&sort=orders&limit=2&page=2').set(auth(tokens.admin));
    expect(page2.body.data.customers.map((c: { full_name: string }) => c.full_name)).toEqual(['Zqxreport Carol']);
    expect(page2.body.data.pagination).toMatchObject({ total: 3, total_pages: 2 });
  });

  it('searches by phone, local format too', async () => {
    const full = await request(app).get(`/api/v1/admin/customers?search=${encodeURIComponent(bob.phone)}`).set(auth(tokens.admin));
    expect(full.body.data.customers.map((c: { id: string }) => c.id)).toEqual([bob.id]);
    const local = await request(app).get(`/api/v1/admin/customers?search=0${bob.phone.slice(3)}`).set(auth(tokens.admin));
    expect(local.body.data.customers.map((c: { id: string }) => c.id)).toEqual([bob.id]);
    const wild = await request(app).get('/api/v1/admin/customers?search=%25%25').set(auth(tokens.admin));
    expect(wild.body.data.customers.some((c: { id: string }) => c.id === bob.id)).toBe(false);
  });

  it('shows one customer with their order history', async () => {
    const res = await request(app).get(`/api/v1/admin/customers/${alice.id}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.customer).toMatchObject({ id: alice.id, orders_count: 2, delivered_spend: 760 });
    const orders = res.body.data.orders;
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ order_status: 'DELIVERED', total_amount: 540, discount_amount: 40, coupon_code: CODE, item_count: 4 });
    expect(orders[1]).toMatchObject({ total_amount: 220, discount_amount: 0, item_count: 1 });
    const missing = await request(app).get('/api/v1/admin/customers/c0c00002-0000-0000-0000-000000000099').set(auth(tokens.admin));
    expect(missing.status).toBe(404);
  });

  it('is ADMIN only', async () => {
    for (const t of [opsToken, tokens.staff, tokens.customer]) {
      expect((await request(app).get('/api/v1/admin/customers').set(auth(t))).status).toBe(403);
      expect((await request(app).get(`/api/v1/admin/customers/${alice.id}`).set(auth(t))).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/customers/export').set(auth(t))).status).toBe(403);
    }
  });
});

describe('GET /admin/customers/export', () => {
  it('returns every customer with name, phone and order figures, by name', async () => {
    const res = await request(app).get('/api/v1/admin/customers/export').set(auth(tokens.admin));
    expect(res.status).toBe(200);
    const rows = res.body.data.customers as { full_name: string | null; phone: string }[];
    const ours = rows.filter((c) => c.full_name?.startsWith('Zqxreport'));
    expect(ours.map((c) => c.full_name)).toEqual(['Zqxreport Alice', 'Zqxreport Bob', 'Zqxreport Carol']);
    expect(ours[0]).toMatchObject({ phone: alice.phone, orders_count: 2, delivered_spend: 760 });
    // Customers only: no staff accounts in a promotions sheet.
    expect(rows.every((c) => typeof c.phone === 'string')).toBe(true);
    expect(rows).not.toContainEqual(expect.objectContaining({ phone: '+94775551122' }));
    expect(res.body.data.pagination).toBeUndefined();
  });
});

/**
 * Customer addresses (owner, 2026-10-11): "record the address of each
 * customer in admin" - Admin and Ops alike, staff only.
 */
describe('customer addresses', () => {
  const STAFF_ONLY = [tokens.staff, tokens.customer, tokens.rider];

  it('an order address belongs to a saved one at the same point, or on the same line in the same town', () => {
    const saved = { address_line1: 'No. 1, Test Lane', city: 'Dharga Town', latitude: 6.4351, longitude: 80.0243 };
    expect(sameAddress(saved, { ...saved, address_line1: 'Somewhere else' })).toBe(true);
    expect(sameAddress(saved, { ...saved, latitude: 6.5, address_line1: '  no. 1,   test lane ' })).toBe(true);
    expect(sameAddress(saved, { ...saved, latitude: 6.5 })).toBe(true);
    expect(sameAddress(saved, { ...saved, latitude: 6.5, city: 'Aluthgama' })).toBe(false);
    expect(sameAddress(saved, { address_line1: 'No. 2, Other Road', city: 'Dharga Town', latitude: 6.44, longitude: 80.03 })).toBe(false);
  });

  it('GET /admin/customers/:id/addresses: saved addresses with how many orders went to each', async () => {
    for (const t of [tokens.admin, opsToken]) {
      const res = await request(app).get(`/api/v1/admin/customers/${alice.id}/addresses`).set(auth(t));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.customer).toMatchObject({ id: alice.id, full_name: 'Zqxreport Alice', phone: alice.phone });
      expect(res.body.data.addresses).toHaveLength(1);
      expect(res.body.data.addresses[0]).toMatchObject({
        id: alice.addressId,
        recipient_name: 'Zqxreport Alice',
        recipient_phone: alice.phone,
        address_line1: 'No. 1, Test Lane',
        city: 'Dharga Town',
        latitude: 6.4351,
        longitude: 80.0243,
        is_default: true,
        orders: 2,
        delivered: 2,
      });
      expect(res.body.data.other_addresses).toEqual([]);
    }
    // Bob: one delivered, one cancelled - both went there.
    const bobs = (await request(app).get(`/api/v1/admin/customers/${bob.id}/addresses`).set(auth(tokens.admin))).body.data;
    expect(bobs.addresses[0]).toMatchObject({ orders: 2, delivered: 1 });
  });

  it('keeps the addresses orders went to after the customer moves or deletes one', async () => {
    // Carol moves her saved address somewhere else and adds a second one.
    await pool.query("UPDATE customer_addresses SET address_line1 = 'No. 5, New Road', latitude = 6.4362, longitude = 80.0255 WHERE id = $1", [carol.addressId]);
    await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Work', 'Carol at work', $2, 'No. 7, Office Street', 'Dharga Town', 6.4371, 80.0261, false)`,
      [carol.id, carol.phone]
    );
    const res = await request(app).get(`/api/v1/admin/customers/${carol.id}/addresses`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.addresses.map((a: { address_line1: string; orders: number }) => [a.address_line1, a.orders])).toEqual([
      ['No. 5, New Road', 0],
      ['No. 7, Office Street', 0],
    ]);
    expect(res.body.data.other_addresses).toHaveLength(1);
    expect(res.body.data.other_addresses[0]).toMatchObject({ address_line1: 'No. 1, Test Lane', city: 'Dharga Town', orders: 1, delivered: 0 });
  });

  it('GET /admin/customer-addresses: search by name or phone, default address, no spend figures', async () => {
    for (const t of [tokens.admin, opsToken]) {
      const res = await request(app).get('/api/v1/admin/customer-addresses?search=zqxreport').set(auth(t));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data.customers as Record<string, unknown>[];
      expect(rows.map((c) => c.full_name).sort()).toEqual(['Zqxreport Alice', 'Zqxreport Bob', 'Zqxreport Carol']);
      const a = rows.find((c) => c.id === alice.id)!;
      expect(a).toMatchObject({ phone: alice.phone, addresses_count: 1, default_address: 'No. 1, Test Lane, Dharga Town', orders_count: 2 });
      expect(rows.find((c) => c.id === carol.id)).toMatchObject({ addresses_count: 2, default_address: 'No. 5, New Road, Dharga Town' });
      expect(a).not.toHaveProperty('delivered_spend');
    }
    const byPhone = await request(app).get(`/api/v1/admin/customer-addresses?search=0${bob.phone.slice(3)}`).set(auth(opsToken));
    expect(byPhone.body.data.customers.map((c: { id: string }) => c.id)).toEqual([bob.id]);
  });

  it('staff only; a missing customer is 404 and a bad id 400', async () => {
    for (const t of STAFF_ONLY) {
      expect((await request(app).get(`/api/v1/admin/customers/${alice.id}/addresses`).set(auth(t))).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/customer-addresses').set(auth(t))).status).toBe(403);
    }
    expect((await request(app).get(`/api/v1/admin/customers/${alice.id}/addresses`)).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/customers/c0c00002-0000-0000-0000-000000000099/addresses').set(auth(tokens.admin))).status).toBe(404);
    expect((await request(app).get('/api/v1/admin/customers/not-a-uuid/addresses').set(auth(tokens.admin))).status).toBe(400);
  });

  it('the customer app only ever sees its own addresses', async () => {
    const res = await request(app).get('/api/v1/me/addresses').set(auth(alice.token));
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Zqxreport Bob');
    expect(text).not.toContain('Office Street');
  });
});
