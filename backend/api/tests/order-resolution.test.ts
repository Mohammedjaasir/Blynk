import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Phase 1.5: integrity of the "mark item unavailable" order-resolution flow
 * (POST /admin/orders/:id/resolve-item and PATCH /admin/orders/:id/items/:itemId),
 * which the Inventory app's Mark unavailable action calls.
 *
 * D4 behaviour is unchanged: the item is removed, the order and payment
 * totals are recalculated, and the customer is notified. What these tests pin
 * down is that the backend - not the UI - refuses:
 *   - an item that is not on the order in the URL
 *   - an item that has already been sourced (or packed)
 *   - an item that has already been resolved
 *   - resolving on a cancelled or delivered order
 *   - two concurrent requests resolving the same item twice
 *
 * Every order, notification and address created here is removed in afterAll.
 * Only seeded, UNTRACKED products are ordered, so no stock is touched.
 */
describe('Order resolution integrity (mark unavailable)', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const tokenCustomer = generateAccessToken(customer);
  const tokenStaff = generateAccessToken(staff);
  const tokenAdmin = generateAccessToken(admin);

  const MILK = 'b0000001-0000-0000-0000-000000000001'; // Kotmale 1L, Rs. 540, UNTRACKED
  const BUTTER = 'b0000001-0000-0000-0000-000000000002'; // Pelwatte 200g, Rs. 805, UNTRACKED

  const createdOrders: string[] = [];
  let addressId = '';

  async function placeOrder(items: Array<{ product_id: string; quantity: number }>) {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({ address_id: addressId, items });
    expect(res.status).toBe(201);
    const orderId = res.body.data.order.id as string;
    createdOrders.push(orderId);
    const rows = await pool.query('SELECT id, product_id FROM order_items WHERE order_id = $1', [orderId]);
    const itemFor = (productId: string) => rows.rows.find((r) => r.product_id === productId)!.id as string;
    return { orderId, itemFor };
  }

  const resolve = (orderId: string, itemId: string, token = tokenStaff, body: object = {}) =>
    request(app)
      .post(`/api/v1/admin/orders/${orderId}/resolve-item`)
      .set('Authorization', `Bearer ${token}`)
      .send({ item_id: itemId, item_status: 'UNAVAILABLE', ...body });

  const source = (orderId: string, itemId: string) =>
    request(app)
      .post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ actual_unit_cost: 455 });

  const orderRow = async (orderId: string) =>
    (
      await pool.query(
        `SELECT o.order_status, o.subtotal_amount, o.total_amount, o.delivery_fee, p.amount AS payment_amount
           FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
        [orderId]
      )
    ).rows[0];
  const itemStatus = async (itemId: string) =>
    (await pool.query('SELECT item_status FROM order_items WHERE id = $1', [itemId])).rows[0].item_status;
  const notifications = async (orderId: string) =>
    Number(
      (
        await pool.query(
          `SELECT count(*) FROM notifications WHERE order_id = $1 AND notification_type = 'ITEM_UNAVAILABLE'`,
          [orderId]
        )
      ).rows[0].count
    );
  const sourcingRecords = async (itemId: string) =>
    Number((await pool.query('SELECT count(*) FROM sourcing_records WHERE order_item_id = $1', [itemId])).rows[0].count);

  beforeAll(async () => {
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Order resolution test', 'Test Recipient', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  afterAll(async () => {
    if (createdOrders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  // ------------------------------------------------------------------ D4 happy path

  it('marks an item unavailable: item removed, totals and payment recalculated, customer notified (D4)', async () => {
    const { orderId, itemFor } = await placeOrder([
      { product_id: MILK, quantity: 2 },
      { product_id: BUTTER, quantity: 1 },
    ]);

    const res = await resolve(orderId, itemFor(BUTTER));

    expect(res.status).toBe(200);
    expect(res.body.data.order.order_status).toBe('ITEM_UNAVAILABLE');
    expect(await itemStatus(itemFor(BUTTER))).toBe('UNAVAILABLE');
    const row = await orderRow(orderId);
    expect(Number(row.subtotal_amount)).toBe(1080); // 2 × 540
    expect(Number(row.total_amount)).toBe(1080 + Number(row.delivery_fee));
    expect(Number(row.payment_amount)).toBe(Number(row.total_amount));
    expect(await notifications(orderId)).toBe(1);

    // The customer sees the new total and nothing internal.
    const mine = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${tokenCustomer}`);
    expect(mine.status).toBe(200);
    expect(Number(mine.body.data.order.total_amount)).toBe(Number(row.total_amount));
    const body = JSON.stringify(mine.body);
    for (const key of ['supplier', 'supplier_id', 'actual_unit_cost', 'estimated_unit_cost', 'purchase_cost',
      'markup_percentage_applied', 'sourcing_records', 'quantity_on_hand', 'adjustments', 'internal_notes']) {
      expect(body).not.toContain(`"${key}"`);
    }
  });

  it('works the same through PATCH /admin/orders/:id/items/:itemId', async () => {
    const { orderId, itemFor } = await placeOrder([
      { product_id: MILK, quantity: 1 },
      { product_id: BUTTER, quantity: 1 },
    ]);
    const res = await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/items/${itemFor(MILK)}`)
      .set('Authorization', `Bearer ${tokenStaff}`)
      .send({ item_status: 'UNAVAILABLE' });
    expect(res.status).toBe(200);
    expect(Number((await orderRow(orderId)).subtotal_amount)).toBe(805);
  });

  // ------------------------------------------------------------------ ownership

  it('refuses an item that belongs to another order, and changes neither order', async () => {
    const a = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    const b = await placeOrder([{ product_id: BUTTER, quantity: 1 }]);
    const beforeA = await orderRow(a.orderId);
    const beforeB = await orderRow(b.orderId);

    const res = await resolve(a.orderId, b.itemFor(BUTTER));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_ITEM_NOT_FOUND');
    // Same answer as a non-existent item: nothing is revealed about order B.
    expect(JSON.stringify(res.body)).not.toContain(b.orderId);
    expect(await orderRow(a.orderId)).toEqual(beforeA);
    expect(await orderRow(b.orderId)).toEqual(beforeB);
    expect(await itemStatus(b.itemFor(BUTTER))).toBe('PENDING');
    expect(await notifications(a.orderId)).toBe(0);
    expect(await notifications(b.orderId)).toBe(0);
  });

  it('refuses a cross-order item through the PATCH route too', async () => {
    const a = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    const b = await placeOrder([{ product_id: BUTTER, quantity: 1 }]);
    const res = await request(app)
      .patch(`/api/v1/admin/orders/${a.orderId}/items/${b.itemFor(BUTTER)}`)
      .set('Authorization', `Bearer ${tokenStaff}`)
      .send({ item_status: 'UNAVAILABLE' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_ITEM_NOT_FOUND');
    expect(await itemStatus(b.itemFor(BUTTER))).toBe('PENDING');
  });

  it('answers a non-existent item with the same 404', async () => {
    const a = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    const res = await resolve(a.orderId, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_ITEM_NOT_FOUND');
    expect((await orderRow(a.orderId)).order_status).toBe('PLACED');
  });

  it('answers malformed ids and an unknown item status with 400, not 500', async () => {
    const a = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    const badOrder = await resolve('not-a-uuid', a.itemFor(MILK));
    expect(badOrder.status).toBe(400);
    expect(badOrder.body.error.code).toBe('VALIDATION_ERROR');

    const badItem = await request(app)
      .patch(`/api/v1/admin/orders/${a.orderId}/items/not-a-uuid`)
      .set('Authorization', `Bearer ${tokenStaff}`)
      .send({ item_status: 'UNAVAILABLE' });
    expect(badItem.status).toBe(400);
    expect(badItem.body.error.code).toBe('VALIDATION_ERROR');

    // FULFILLED is not an item state in the database enum; it used to reach
    // PostgreSQL and fail as a 500.
    const badStatus = await resolve(a.orderId, a.itemFor(MILK), tokenStaff, { item_status: 'FULFILLED' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('VALIDATION_ERROR');
    expect(await itemStatus(a.itemFor(MILK))).toBe('PENDING');
  });

  // ------------------------------------------------------------------ state conflicts

  it('refuses to mark a sourced item unavailable (409 ITEM_ALREADY_SOURCED) and keeps its cost and the total', async () => {
    const { orderId, itemFor } = await placeOrder([
      { product_id: MILK, quantity: 1 },
      { product_id: BUTTER, quantity: 1 },
    ]);
    expect((await source(orderId, itemFor(MILK))).status).toBe(200);
    const before = await orderRow(orderId);

    const res = await resolve(orderId, itemFor(MILK));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ITEM_ALREADY_SOURCED');
    expect(await itemStatus(itemFor(MILK))).toBe('SOURCED');
    expect(await orderRow(orderId)).toEqual(before);
    expect(await notifications(orderId)).toBe(0);
    const cost = await pool.query('SELECT actual_unit_cost FROM order_items WHERE id = $1', [itemFor(MILK)]);
    expect(Number(cost.rows[0].actual_unit_cost)).toBe(455);
  });

  it('refuses to resolve an item twice (409 ITEM_ALREADY_RESOLVED); the total drops once, one notification', async () => {
    const { orderId, itemFor } = await placeOrder([
      { product_id: MILK, quantity: 1 },
      { product_id: BUTTER, quantity: 1 },
    ]);
    expect((await resolve(orderId, itemFor(BUTTER))).status).toBe(200);
    const after = await orderRow(orderId);

    const again = await resolve(orderId, itemFor(BUTTER), tokenAdmin);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ITEM_ALREADY_RESOLVED');
    expect(await orderRow(orderId)).toEqual(after);
    expect(await notifications(orderId)).toBe(1);
  });

  it('refuses to resolve on a cancelled order and leaves it cancelled', async () => {
    const { orderId, itemFor } = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    const cancel = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({ reason: 'Order resolution test' });
    expect(cancel.status).toBe(200);

    const res = await resolve(orderId, itemFor(MILK));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORDER_NOT_IN_SOURCING_STATE');
    expect((await orderRow(orderId)).order_status).toBe('CANCELLED');
    expect(await notifications(orderId)).toBe(0);
  });

  // ------------------------------------------------------------------ concurrency

  it('two simultaneous requests for the same item: one succeeds, one 409, total reduced exactly once', async () => {
    const { orderId, itemFor } = await placeOrder([
      { product_id: MILK, quantity: 1 },
      { product_id: BUTTER, quantity: 1 },
    ]);

    const results = await Promise.all([
      resolve(orderId, itemFor(BUTTER), tokenStaff),
      resolve(orderId, itemFor(BUTTER), tokenAdmin),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('ITEM_ALREADY_RESOLVED');
    const row = await orderRow(orderId);
    expect(Number(row.subtotal_amount)).toBe(540);
    expect(Number(row.payment_amount)).toBe(Number(row.total_amount));
    expect(await notifications(orderId)).toBe(1);
  });

  it('mark unavailable racing sourcing on the same item: exactly one wins and the order stays consistent', async () => {
    const { orderId, itemFor } = await placeOrder([
      { product_id: MILK, quantity: 1 },
      { product_id: BUTTER, quantity: 1 },
    ]);
    const item = itemFor(BUTTER);

    const [resolved, sourced] = await Promise.all([resolve(orderId, item), source(orderId, item)]);

    expect([resolved.status, sourced.status].filter((s) => s === 200)).toHaveLength(1);
    const row = await orderRow(orderId);
    if (resolved.status === 200) {
      // Resolution won: sourcing was refused by its existing rule.
      expect(sourced.body.error.code).toBe('CANNOT_SOURCE_UNAVAILABLE_ITEM');
      expect(await itemStatus(item)).toBe('UNAVAILABLE');
      expect(await sourcingRecords(item)).toBe(0);
      expect(Number(row.subtotal_amount)).toBe(540);
      expect(await notifications(orderId)).toBe(1);
    } else {
      expect(resolved.body.error.code).toBe('ITEM_ALREADY_SOURCED');
      expect(await itemStatus(item)).toBe('SOURCED');
      expect(await sourcingRecords(item)).toBe(1);
      expect(Number(row.subtotal_amount)).toBe(540 + 805);
      expect(await notifications(orderId)).toBe(0);
    }
  });

  // ------------------------------------------------------------------ sourcing unchanged

  it('still refuses to source an item twice (Phase 0 guarantee unchanged)', async () => {
    const { orderId, itemFor } = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    expect((await source(orderId, itemFor(MILK))).status).toBe(200);
    const again = await source(orderId, itemFor(MILK));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ITEM_ALREADY_SOURCED');
    expect(await sourcingRecords(itemFor(MILK))).toBe(1);
  });

  it('is refused to a customer', async () => {
    const { orderId, itemFor } = await placeOrder([{ product_id: MILK, quantity: 1 }]);
    const res = await resolve(orderId, itemFor(MILK), tokenCustomer);
    expect(res.status).toBe(403);
    expect(await itemStatus(itemFor(MILK))).toBe('PENDING');
  });
});
