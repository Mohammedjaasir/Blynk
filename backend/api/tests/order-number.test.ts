import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Order numbers are BL-YYYYMMDD-NNNN with four random digits and a UNIQUE
 * constraint. A number already taken today must not fail checkout with a 500
 * (it did: "duplicate key value violates unique constraint
 * orders_order_number_key"); the order is placed under a fresh number.
 */
describe('order number collisions', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const token = generateAccessToken(customer);
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Order number test', 'Number Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  const place = (key: string) =>
    request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ address_id: addressId, idempotency_key: key, items: [{ product_id: MILK, quantity: 1 }] });

  /** Math.random value that makes the generator produce suffix `n` (1000-9999). */
  const randomFor = (n: number) => (n - 1000 + 0.5) / 9000;

  it('places the order under a fresh number when the generated one is already taken', async () => {
    const first = await place(`number-test-a-${Date.now()}`);
    expect(first.status).toBe(201);
    created.push(first.body.data.order.id);
    const taken: string = first.body.data.order.order_number;
    const takenSuffix = Number(taken.split('-').pop());
    const otherSuffix = takenSuffix === 9999 ? 1000 : takenSuffix + 1;

    vi.spyOn(Math, 'random').mockReturnValueOnce(randomFor(takenSuffix)).mockReturnValueOnce(randomFor(otherSuffix));
    const second = await place(`number-test-b-${Date.now()}`);
    expect(second.status).toBe(201);
    created.push(second.body.data.order.id);
    expect(second.body.data.order.order_number).not.toBe(taken);
    expect(second.body.data.order.order_number.endsWith(`-${otherSuffix}`)).toBe(true);
  });

  it('a replayed idempotency key still returns the original order, not a new one', async () => {
    const key = `number-test-c-${Date.now()}`;
    const a = await place(key);
    created.push(a.body.data.order.id);
    const b = await place(key);
    expect(b.status).toBe(200);
    expect(b.body.data.order.id).toBe(a.body.data.order.id);
  });
});
