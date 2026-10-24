import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { sellerStatement } from '../src/modules/sellers/seller.statement.js';
import { stockFixtures, type PlacedOrder, type Tracked } from './helpers/stock.js';
import { bearer, sellerFixtures } from './helpers/seller.js';

/**
 * The seller statement (GET /seller/statement and sellerStatement()): over the
 * items of DELIVERED orders of the seller's products,
 *   gross = SUM(quantity x estimated_unit_cost), commission = gross x percent,
 *   earned = gross - commission, paid = payouts, due = earned - paid,
 * with an optional delivery-date range read in Asia/Colombo. Orders go through
 * the real flow (place, source, pack, deliver) so the cost snapshot and the
 * delivery time are the real ones.
 */
const app = createApp();
const fx = stockFixtures(app, 'SELLSTMT-');
const sf = sellerFixtures(app, '+947700122');

let seller: Awaited<ReturnType<typeof sf.makeSeller>>;
let other: Awaited<ReturnType<typeof sf.makeSeller>>;
let jam: Tracked;
let tea: Tracked;
let foreign: Tracked;
let orderA: PlacedOrder; // 3 jam @120 + 2 tea @80  -> 520, delivered 2026-03-10 20:00Z = 2026-03-11 01:30 Colombo
let orderB: PlacedOrder; // 1 jam @120              -> 120, delivered 2026-03-15 10:00Z
let orderOpen: PlacedOrder; // placed only, never delivered
let orderOwn: PlacedOrder; // the seller's jam + a Blynk product, delivered: only the jam counts

const statement = (token: string, qs = '') => request(app).get(`/api/v1/seller/statement${qs}`).set(bearer(token));

async function deliverAt(order: PlacedOrder, iso: string) {
  await fx.sourceAll(order);
  expect((await fx.pack(order.id)).status).toBe(200);
  await fx.deliver(order.id);
  await pool.query('UPDATE orders SET delivered_at = $2 WHERE id = $1', [order.id, iso]);
}

beforeAll(async () => {
  await sf.purge();
  await fx.setup();
  seller = await sf.makeSeller(1, 'APPROVED', 'Statement Shop');
  other = await sf.makeSeller(2, 'APPROVED', 'Other Statement Shop');
  jam = await fx.product({ onHand: 50 });
  tea = await fx.product({ onHand: 50 });
  foreign = await fx.product({ onHand: 50 });
  await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 120 WHERE id = $1', [jam.productId, seller.sellerId]);
  await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 80 WHERE id = $1', [tea.productId, seller.sellerId]);
  await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 50 WHERE id = $1', [foreign.productId, other.sellerId]);

  orderA = await fx.placeOrder([
    { product_id: jam.productId, quantity: 3 },
    { product_id: tea.productId, quantity: 2 },
  ]);
  orderB = await fx.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
  orderOpen = await fx.placeOrder([{ product_id: jam.productId, quantity: 5 }]);
  const blynkOwn = await fx.product({ onHand: 10 }); // seller_id NULL: Blynk's own
  orderOwn = await fx.placeOrder([
    { product_id: jam.productId, quantity: 2 },
    { product_id: blynkOwn.productId, quantity: 4 },
    { product_id: foreign.productId, quantity: 7 },
  ]);

  // The cost is raised after ordering: the order keeps the price the seller had then.
  await pool.query('UPDATE products SET purchase_cost = 999 WHERE id = $1', [jam.productId]);

  await deliverAt(orderA, '2026-03-10T20:00:00Z');
  await deliverAt(orderB, '2026-03-15T10:00:00Z');
  await deliverAt(orderOwn, '2026-03-20T10:00:00Z');
  await pool.query('UPDATE products SET purchase_cost = 120 WHERE id = $1', [jam.productId]);
  await pool.query('UPDATE sellers SET commission_percent = 10 WHERE id = $1', [seller.sellerId]);
  await pool.query(`INSERT INTO seller_payouts (seller_id, amount, note, paid_on) VALUES ($1, 100, 'First payout', '2026-03-12')`, [seller.sellerId]);
  await pool.query(`INSERT INTO seller_payouts (seller_id, amount, paid_on) VALUES ($1, 50.25, '2026-03-25')`, [seller.sellerId]);
});

afterAll(async () => {
  await fx.cleanup(); // orders, then the products
  await sf.cleanup();
});

describe('Seller statement', () => {
  it('counts only delivered items of the seller\'s own products, at the cost snapshot', async () => {
    // jam: (3 + 1 + 2) x 120 = 720, tea: 2 x 80 = 160; the open order, Blynk's product and the other seller's are out.
    const res = await statement(seller.token);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      commission_percent: 10,
      gross: 880,
      commission: 88,
      earned: 792,
      paid: 150.25,
      due: 641.75,
      lines: [
        { product_id: jam.productId, name: expect.any(String), units: 6, gross: 720 },
        { product_id: tea.productId, name: expect.any(String), units: 2, gross: 160 },
      ],
      payouts: [
        { id: expect.any(String), amount: 50.25, note: null, paid_on: '2026-03-25' },
        { id: expect.any(String), amount: 100, note: 'First payout', paid_on: '2026-03-12' },
      ],
    });
  });

  it('another seller sees only their own figures', async () => {
    const res = await statement(other.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ commission_percent: 0, gross: 350, commission: 0, earned: 350, paid: 0, due: 350, payouts: [] });
    expect(res.body.data.lines).toEqual([{ product_id: foreign.productId, name: expect.any(String), units: 7, gross: 350 }]);
  });

  it('limits sales and payouts to a delivery-date range read in Colombo time', async () => {
    // orderA was delivered 2026-03-10 20:00Z = 2026-03-11 01:30 in Colombo.
    const onTheEleventh = await statement(seller.token, '?from=2026-03-11&to=2026-03-11');
    expect(onTheEleventh.body.data).toMatchObject({ gross: 520, commission: 52, earned: 468, paid: 0, due: 468 });
    expect(onTheEleventh.body.data.lines.map((l: { units: number }) => l.units)).toEqual([3, 2]);

    const onTheTenth = await statement(seller.token, '?from=2026-03-10&to=2026-03-10');
    expect(onTheTenth.body.data).toMatchObject({ gross: 0, earned: 0, paid: 0, due: 0, lines: [] });

    const fromFifteenth = await statement(seller.token, '?from=2026-03-15');
    expect(fromFifteenth.body.data).toMatchObject({ gross: 360, commission: 36, earned: 324, paid: 50.25, due: 273.75 });
    expect(fromFifteenth.body.data.payouts.map((p: { paid_on: string }) => p.paid_on)).toEqual(['2026-03-25']);

    const upToFourteenth = await statement(seller.token, '?to=2026-03-14');
    expect(upToFourteenth.body.data).toMatchObject({ gross: 520, paid: 100, due: 368 });
  });

  it('is zero for a seller with nothing delivered', async () => {
    const fresh = await sf.makeSeller(3, 'PENDING');
    const res = await statement(fresh.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ commission_percent: 0, gross: 0, commission: 0, earned: 0, paid: 0, due: 0, lines: [], payouts: [] });
  });

  it('works while the seller is not approved or is suspended', async () => {
    await pool.query(`UPDATE sellers SET status = 'SUSPENDED' WHERE id = $1`, [seller.sellerId]);
    expect((await statement(seller.token)).status).toBe(200);
    await pool.query(`UPDATE sellers SET status = 'APPROVED' WHERE id = $1`, [seller.sellerId]);
  });

  it('refuses a bad range and other roles', async () => {
    for (const qs of ['?from=2026-3-1', '?from=nope', '?to=2026-02-30', '?from=2026-04-01&to=2026-03-01']) {
      const res = await statement(seller.token, qs);
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await request(app).get('/api/v1/seller/statement')).status).toBe(401);
  });

  it('sellerStatement() has the shape and rounding the admin side relies on', async () => {
    const s = await sellerStatement(seller.sellerId, { from: '2026-03-01', to: '2026-03-31' });
    expect(s.gross).toBe(880);
    await pool.query('UPDATE sellers SET commission_percent = 12.5 WHERE id = $1', [seller.sellerId]);
    const odd = await sellerStatement(seller.sellerId);
    expect(odd).toMatchObject({ commission_percent: 12.5, gross: 880, commission: 110, earned: 770, paid: 150.25, due: 619.75 });
    await expect(sellerStatement('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ statusCode: 404, code: 'SELLER_NOT_FOUND' });
  });

  it('GET /seller/products carries the delivered units and the live stock', async () => {
    const res = await request(app).get('/api/v1/seller/products').set(bearer(seller.token));
    const list = res.body.data.products as { id: string; units_sold: number; stock_on_hand: number }[];
    const j = list.find((p) => p.id === jam.productId)!;
    const t = list.find((p) => p.id === tea.productId)!;
    expect(j.units_sold).toBe(6);
    expect(t.units_sold).toBe(2);
    expect(j.stock_on_hand).toBe(await fx.onHand(jam));
    expect(t.stock_on_hand).toBe(await fx.onHand(tea));
  });

  it('an item packed as unavailable is not counted', async () => {
    const order = await fx.placeOrder([
      { product_id: jam.productId, quantity: 4 },
      { product_id: tea.productId, quantity: 1 },
    ]);
    // Staff resolve the jam line as unavailable; the order is then closed as delivered.
    const resolved = await fx.resolve(order.id, order.itemFor(jam.productId));
    expect(resolved.status).toBe(200);
    const before = (await statement(seller.token)).body.data;
    await pool.query(`UPDATE orders SET order_status = 'DELIVERED', delivered_at = '2026-03-22T10:00:00Z' WHERE id = $1`, [order.id]);
    const after = (await statement(seller.token)).body.data;
    // Only tea (1 x 80) is added; the 4 unavailable jars are not.
    expect(Math.round((after.gross - before.gross) * 100) / 100).toBe(80);
    expect(after.lines.find((l: { product_id: string }) => l.product_id === jam.productId).units).toBe(6);
  });
});
