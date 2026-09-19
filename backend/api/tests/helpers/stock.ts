import { expect } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { pool } from '../../src/database/connection.js';
import { generateAccessToken } from '../../src/modules/auth/token.service.js';

/**
 * Test-owned tracked stock (inventory plan §8). Products are created through
 * the Admin API with a per-file SKU prefix, stocked through the adjust API
 * (so even the opening balance is a ledger row), and everything - orders,
 * products, inventory rows (ledger cascades), suppliers, the address, extra
 * users - is removed by cleanup(). Seeded products are never touched.
 */
export const STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
export const users = {
  customer: { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const },
  rider: { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const },
  admin: { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const },
  staff: { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const },
};
export const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
export const tokens = {
  customer: generateAccessToken(users.customer),
  rider: generateAccessToken(users.rider),
  admin: generateAccessToken(users.admin),
  staff: generateAccessToken(users.staff),
};
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface Tracked {
  productId: string;
  inventoryId: string;
}
export interface PlacedOrder {
  id: string;
  order_number: string;
  itemIds: string[];
  itemFor(productId: string): string;
}
export interface LedgerRow {
  id: string;
  inventory_id: string;
  adjustment_type: string;
  quantity_delta: number;
  previous_quantity: number;
  new_quantity: number;
  reference_order_id: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Date;
}

export function stockFixtures(app: Express, skuPrefix: string) {
  const created = { products: [] as string[], orders: [] as string[], suppliers: [] as string[], users: [] as string[] };
  let addressId = '';
  let categoryId = '';
  let seq = 0;

  async function setup() {
    await purge();
    categoryId = (await pool.query('SELECT id FROM categories WHERE is_active = true ORDER BY display_order LIMIT 1')).rows[0].id;
    addressId = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Stock test', 'Stock Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
         RETURNING id`,
        [users.customer.id]
      )
    ).rows[0].id;
  }

  /** Leftovers of an aborted earlier run of the same file (by SKU prefix). */
  async function purge() {
    const stale = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${skuPrefix}%`])).rows.map((r) => r.id);
    if (!stale.length) return;
    const orders = (await pool.query('SELECT DISTINCT order_id FROM order_items WHERE product_id = ANY($1)', [stale])).rows.map(
      (r) => r.order_id
    );
    await deleteOrders(orders);
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [stale]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [stale]);
  }

  async function deleteOrders(ids: string[]) {
    if (!ids.length) return;
    await pool.query('DELETE FROM inventory_adjustments WHERE reference_order_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [ids]);
  }

  async function cleanup() {
    await deleteOrders(created.orders);
    if (created.products.length) {
      await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [created.products]);
      await pool.query('DELETE FROM products WHERE id = ANY($1)', [created.products]);
    }
    if (created.suppliers.length) await pool.query('DELETE FROM suppliers WHERE id = ANY($1)', [created.suppliers]);
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    for (const id of created.users) {
      await pool.query('DELETE FROM deliveries WHERE rider_id IN (SELECT id FROM riders WHERE user_id = $1)', [id]);
      await pool.query('DELETE FROM riders WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
  }

  /** A product in the catalog; TRACKED with `onHand` restocked through the API unless tracked is false. */
  async function product({ onHand = 0, tracked = true }: { onHand?: number; tracked?: boolean } = {}): Promise<Tracked> {
    seq += 1;
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set(auth(tokens.admin))
      .send({
        category_id: categoryId,
        name: `Stock test ${skuPrefix}${seq} ${Date.now()}`,
        sku: `${skuPrefix}${seq}-${Date.now()}`,
        unit: '1 pc',
        purchase_cost: 100,
        is_available: true,
        is_active: true,
      });
    expect(res.status).toBe(201);
    const productId = res.body.data.product.id as string;
    created.products.push(productId);
    const mode = await setMode(productId, tracked ? 'TRACKED' : 'UNTRACKED');
    if (onHand > 0) await adjust(productId, 'PURCHASE_RESTOCK', onHand);
    return { productId, inventoryId: mode.id as string };
  }

  async function setMode(productId: string, tracking_mode: 'TRACKED' | 'UNTRACKED') {
    const res = await request(app).patch(`/api/v1/admin/inventory/${productId}/mode`).set(auth(tokens.admin)).send({ tracking_mode });
    expect(res.status).toBe(200);
    return res.body.data;
  }

  const adjust = (productId: string, adjustment_type: string, quantity_delta: number, notes = 'Stock test adjustment') =>
    request(app)
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set(auth(tokens.admin))
      .send({ adjustment_type, quantity_delta, notes });

  async function placeOrder(lines: { product_id: string; quantity: number }[]): Promise<PlacedOrder> {
    const res = await request(app).post('/api/v1/orders').set(auth(tokens.customer)).send({ address_id: addressId, items: lines });
    expect(res.status).toBe(201);
    const order = res.body.data.order as { id: string; order_number: string };
    created.orders.push(order.id);
    const items = (await pool.query('SELECT id, product_id FROM order_items WHERE order_id = $1 ORDER BY id', [order.id])).rows;
    return {
      id: order.id,
      order_number: order.order_number,
      itemIds: items.map((r) => r.id as string),
      itemFor: (p: string) => items.find((r) => r.product_id === p)!.id as string,
    };
  }

  const source = (orderId: string, itemId: string, body: object = {}, token = tokens.staff) =>
    request(app)
      .post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)
      .set(auth(token))
      .send({ actual_unit_cost: 90, ...body });

  async function sourceAll(order: PlacedOrder) {
    for (const id of order.itemIds) expect((await source(order.id, id)).status).toBe(200);
  }

  const onHand = async (t: Tracked) =>
    (await pool.query('SELECT quantity_on_hand FROM inventory WHERE id = $1', [t.inventoryId])).rows[0].quantity_on_hand as number;

  const ledgerForOrder = async (orderId: string): Promise<LedgerRow[]> =>
    (await pool.query('SELECT * FROM inventory_adjustments WHERE reference_order_id = $1 ORDER BY created_at, id', [orderId])).rows;

  const ledgerFor = async (t: Tracked): Promise<LedgerRow[]> =>
    (await pool.query('SELECT * FROM inventory_adjustments WHERE inventory_id = $1 ORDER BY created_at, id', [t.inventoryId])).rows;

  /**
   * The ledger, read in its own order, explains the count: every row starts
   * where the previous one ended, adds its delta, and the last one ends at
   * the current on-hand figure. Test products start at 0 with no rows.
   */
  async function expectLedgerChain(t: Tracked) {
    const rows = await ledgerFor(t);
    let expected = 0;
    for (const r of rows) {
      expect({ id: r.id, previous: r.previous_quantity }).toEqual({ id: r.id, previous: expected });
      expect(r.new_quantity).toBe(r.previous_quantity + r.quantity_delta);
      expected = r.new_quantity;
    }
    expect(await onHand(t)).toBe(expected);
  }

  // ------------------------------------------------------------ lifecycle
  const customerCancel = (orderId: string) =>
    request(app).post(`/api/v1/orders/${orderId}/cancel`).set(auth(tokens.customer)).send({ reason: 'Changed my mind' });
  const setStatus = (orderId: string, status: string, token = tokens.admin, notes?: string) =>
    request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set(auth(token))
      .send(notes === undefined ? { status } : { status, notes });
  const adminCancel = (orderId: string) => setStatus(orderId, 'CANCELLED', tokens.admin, 'Customer asked by phone');
  const pack = (orderId: string) => setStatus(orderId, 'PACKED', tokens.staff);
  const resolve = (orderId: string, itemId: string) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/resolve-item`).set(auth(tokens.staff)).send({ item_id: itemId, item_status: 'UNAVAILABLE' });
  const assign = (orderId: string, riderId = RIDER_A) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set(auth(tokens.admin)).send({ rider_id: riderId });
  const riderStep = (deliveryId: string, body: object, token = tokens.rider) =>
    request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(token)).send(body);
  const collect = (deliveryId: string, amount: number, token = tokens.rider) =>
    request(app).post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`).set(auth(token)).send({ amount });

  const orderRow = async (orderId: string) =>
    (
      await pool.query(
        `SELECT o.order_status, o.subtotal_amount::float AS subtotal, o.total_amount::float AS total, p.amount::float AS pay_amount
           FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
        [orderId]
      )
    ).rows[0] as { order_status: string; subtotal: number; total: number; pay_amount: number };

  /** An extra active rider for replacement-rider flows; removed by cleanup(). */
  async function tempRider(tag: string) {
    seq += 1;
    const suffix = `${String(Date.now()).slice(-4)}${String(seq).padStart(2, '0')}`;
    const user = (
      await pool.query(
        `INSERT INTO users (phone, full_name, role) VALUES ($1, $2, 'RIDER') RETURNING id, phone`,
        [`+9477${suffix}9`.slice(0, 12), `Stock Test Rider ${tag}`]
      )
    ).rows[0];
    created.users.push(user.id);
    const rider = (
      await pool.query(
        `INSERT INTO riders (user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
         VALUES ($1, $2, $3, true, true) RETURNING id`,
        [user.id, STORE, `TEST-STK-${suffix}`]
      )
    ).rows[0];
    return { riderId: rider.id as string, token: generateAccessToken({ id: user.id, phone: user.phone, role: 'RIDER' }) };
  }

  /** PACKED → assigned → picked up → arrived → cash collected, with the given rider. */
  async function deliver(orderId: string, rider: { riderId: string; token: string } = { riderId: RIDER_A, token: tokens.rider }) {
    const a = await assign(orderId, rider.riderId);
    expect(a.status).toBe(200);
    const deliveryId = a.body.data.delivery.id;
    expect((await riderStep(deliveryId, { status: 'PICKED_UP' }, rider.token)).status).toBe(200);
    expect((await riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, rider.token)).status).toBe(200);
    expect((await collect(deliveryId, (await orderRow(orderId)).total, rider.token)).status).toBe(200);
    return deliveryId as string;
  }

  return {
    created,
    setup,
    customerCancel,
    setStatus,
    adminCancel,
    pack,
    resolve,
    assign,
    riderStep,
    collect,
    orderRow,
    tempRider,
    deliver,
    cleanup,
    product,
    setMode,
    adjust,
    placeOrder,
    source,
    sourceAll,
    onHand,
    ledgerFor,
    ledgerForOrder,
    expectLedgerChain,
    get addressId() {
      return addressId;
    },
  };
}

/** Runs `fn` n times; races repeat so an interleaving that only sometimes happens is still caught. */
export async function repeat(n: number, fn: (i: number) => Promise<void>) {
  for (let i = 0; i < n; i++) await fn(i);
}
