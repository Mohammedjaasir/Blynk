import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { customerCanCancel } from '../src/modules/orders/order.service.js';
import { CATALOGUE } from '../src/modules/orders/lifecycle/catalogue.js';

/**
 * What the customer app receives for its Orders screens (dispatch plan
 * Task 7): the list carries each order's items (the "0 items" bug), history
 * is status and time only (D11: staff notes never reach the customer), and
 * malformed ids are a 400. Cost fields never appear.
 */
describe('Customer orders contract', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const tokenCustomer = generateAccessToken(customer);
  const tokenAdmin = generateAccessToken(admin);
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const BUTTER = 'b0000001-0000-0000-0000-000000000002';
  const COST_FIELDS = ['estimated_unit_cost', 'actual_unit_cost', 'markup_percentage_applied'];
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Customer orders test', 'Orders Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });
  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  async function placeOrder(products: Array<[string, number]>) {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({ address_id: addressId, items: products.map(([product_id, quantity]) => ({ product_id, quantity })) });
    expect(res.status).toBe(201);
    created.push(res.body.data.order.id);
    return res.body.data.order as { id: string };
  }

  it('the order list carries each order\'s items, without cost fields', async () => {
    const order = await placeOrder([
      [MILK, 2],
      [BUTTER, 1],
    ]);
    const res = await request(app).get('/api/v1/orders?limit=50').set('Authorization', `Bearer ${tokenCustomer}`);
    expect(res.status).toBe(200);
    const listed = res.body.data.orders.find((o: { id: string }) => o.id === order.id);
    expect(listed.items).toHaveLength(2);
    expect(listed.items.reduce((n: number, i: { quantity: number }) => n + i.quantity, 0)).toBe(3);
    for (const item of listed.items) {
      expect(item).toMatchObject({ product_name_snapshot: expect.any(String), unit_selling_price: expect.any(Number) });
      for (const field of COST_FIELDS) expect(item).not.toHaveProperty(field);
    }
  });

  it('history shows status changes and times, never staff notes or who made them (D11)', async () => {
    const order = await placeOrder([[MILK, 1]]);
    const cancel = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'CANCELLED', notes: 'Supplier closed today' });
    expect(cancel.status).toBe(200);
    const res = await request(app).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${tokenCustomer}`);
    const history = res.body.data.order.history as Array<Record<string, unknown>>;
    expect(history.map((h) => h.new_status)).toEqual(['PLACED', 'CANCELLED']);
    for (const h of history) expect(Object.keys(h).sort()).toEqual(['created_at', 'id', 'new_status', 'old_status', 'order_id']);
    // The customer-facing reason is the cancellation reason, which the customer is meant to see.
    expect(res.body.data.order.cancellation_reason).toBe('Supplier closed today');
  });

  it('tells the customer app whether the order can be cancelled (can_cancel)', async () => {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    created.push(placed.body.data.order.id);
    const id = placed.body.data.order.id as string;
    expect(placed.body.data.order.can_cancel).toBe(true);

    const list = await request(app).get('/api/v1/orders?limit=50').set('Authorization', `Bearer ${tokenCustomer}`);
    expect(list.body.data.orders.find((o: { id: string }) => o.id === id).can_cancel).toBe(true);
    const detail = await request(app).get(`/api/v1/orders/${id}`).set('Authorization', `Bearer ${tokenCustomer}`);
    expect(detail.body.data.order.can_cancel).toBe(true);

    const cancelled = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${tokenCustomer}`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.can_cancel).toBe(false);

    const again = await request(app).post(`/api/v1/orders/${id}/cancel`).set('Authorization', `Bearer ${tokenCustomer}`).send({});
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ORDER_ALREADY_CANCELLED');
  });

  it('can_cancel is the lifecycle catalogue\'s rule for every status', () => {
    const ALL = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE'] as const;
    for (const s of ALL) expect(customerCanCancel(s)).toBe(CATALOGUE.CUSTOMER_CANCEL.from.includes(s));
    expect(ALL.filter(customerCanCancel)).toEqual(['PLACED', 'PACKED']);
  });

  it('a malformed order id is a 400 on detail and cancel', async () => {
    for (const res of [
      await request(app).get('/api/v1/orders/not-a-uuid').set('Authorization', `Bearer ${tokenCustomer}`),
      await request(app).post('/api/v1/orders/not-a-uuid/cancel').set('Authorization', `Bearer ${tokenCustomer}`).send({}),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
