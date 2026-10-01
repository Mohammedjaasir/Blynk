import request from 'supertest';
import type { Express } from 'express';
import { expect } from 'vitest';
import { pool } from '../../src/database/connection.js';
import { generateAccessToken } from '../../src/modules/auth/token.service.js';

/**
 * Fresh CUSTOMER accounts (no order history) with a delivery address inside
 * the service zone, owned by one test file. `idPrefix` is the first UUID
 * group (8 hex), `phoneBase` is `+94` + 7 digits (an index completes it).
 * cleanup() removes their orders (redemptions and delivery codes cascade),
 * notifications, addresses and the users; purge() clears an aborted run.
 */
export function customerFixtures(app: Express, { idPrefix, phoneBase, name }: { idPrefix: string; phoneBase: string; name: string }) {
  const ids = (n: number) => ({
    id: `${idPrefix}-0000-0000-0000-${String(n).padStart(12, '0')}`,
    phone: `${phoneBase}${String(n).padStart(2, '0')}`,
  });
  const made: number[] = [];

  async function removeUser(id: string) {
    const orders = (await pool.query('SELECT id FROM orders WHERE customer_id = $1', [id])).rows.map((r) => r.id as string);
    if (orders.length) {
      await pool.query('DELETE FROM inventory_adjustments WHERE reference_order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [orders]);
    }
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM customer_addresses WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async function purge(max = 20) {
    for (let n = 1; n <= max; n++) await removeUser(ids(n).id);
  }

  async function cleanup() {
    for (const n of made) await removeUser(ids(n).id);
  }

  /** Customer number `n` (1-99), with a token and an address id. */
  async function customer(n: number, fullName = `${name} ${n}`) {
    const { id, phone } = ids(n);
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, $3, 'CUSTOMER') ON CONFLICT (id) DO NOTHING`, [
      id,
      phone,
      fullName,
    ]);
    made.push(n);
    const addressId = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Test', $2, $3, 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, true) RETURNING id`,
        [id, fullName, phone]
      )
    ).rows[0].id as string;
    const token = generateAccessToken({ id, phone, role: 'CUSTOMER' });
    const placeOrder = (items: { product_id: string; quantity: number }[], extra: object = {}) =>
      request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ address_id: addressId, items, ...extra });
    return { id, phone, token, addressId, placeOrder, fullName };
  }

  return { customer, purge, cleanup };
}

export async function expectCreated(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.order as Record<string, any>;
}
