import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { percentChange, resolveDashboardRange, salesDashboard } from '../src/modules/reports/dashboard.service.js';
import { CELL_DEG, orderMap } from '../src/modules/reports/order-map.service.js';
import { suggestedQuantity } from '../src/modules/inventory/purchase-list.js';
import { RIDER_A, auth, stockFixtures, tokens, users } from './helpers/stock.js';

/**
 * Sales dashboard, delivery heat map and purchase list (owner, 2026-10-10).
 *
 * Orders are written straight into the database in May 2020 / April 2020
 * (placed_at), so the figures for those ranges are exactly this file's,
 * whatever else the shared database holds; the services are asked with a
 * fixed "now" of Thursday 14 May 2020, 11:30 Colombo.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-INS-');
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });
const NOW = new Date('2020-05-14T06:00:00Z');
const SECRET_NAME = 'Zqxinsight Private Person';
const SECRET_PHONE = '+94770009999';

let apple = '';
let bread = '';
let store = { id: '', lat: 0, lng: 0, radius: 0 };
let seq = 0;

/** The centre of the grid cell the hub is in, plus a small offset that stays in that cell. */
const nearHub = (d = 0) => ({
  lat: (Math.floor(store.lat / CELL_DEG) + 0.5) * CELL_DEG + d,
  lng: (Math.floor(store.lng / CELL_DEG) + 0.5) * CELL_DEG + d,
});

async function insertOrder(o: {
  status: string;
  placedAt: string;
  total: number;
  at: { lat: number; lng: number };
  city?: string;
  items?: { product: string; qty: number; price: number }[];
}) {
  seq += 1;
  const id = (
    await pool.query(
      `INSERT INTO orders (order_number, idempotency_key, customer_id, dark_store_id, order_status, subtotal_amount, delivery_fee, total_amount,
                           delivery_recipient_name, delivery_recipient_phone, delivery_address_line1, delivery_city, delivery_latitude, delivery_longitude, placed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 100, $7, $8, $9, 'No. 9, Secret Lane', $10, $11, $12, $13) RETURNING id`,
      [
        `TST-INS-${seq}-${Date.now()}`,
        `tst-ins-${seq}-${Date.now()}`,
        users.customer.id,
        store.id,
        o.status,
        o.total - 100,
        o.total,
        SECRET_NAME,
        SECRET_PHONE,
        o.city ?? 'Dharga Town',
        o.at.lat.toFixed(6),
        o.at.lng.toFixed(6),
        o.placedAt,
      ]
    )
  ).rows[0].id as string;
  fx.created.orders.push(id);
  const itemIds: string[] = [];
  for (const it of o.items ?? []) {
    itemIds.push(
      (
        await pool.query(
          `INSERT INTO order_items (order_id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot, unit_selling_price, estimated_unit_cost, markup_percentage_applied, quantity, subtotal)
           VALUES ($1, $2, (SELECT name FROM products WHERE id = $2), (SELECT sku FROM products WHERE id = $2), '1 pc', $3, 80, 25, $4, $5) RETURNING id`,
          [id, it.product, it.price, it.qty, it.price * it.qty]
        )
      ).rows[0].id as string
    );
  }
  if (o.status === 'DELIVERED') {
    await pool.query(
      `INSERT INTO deliveries (order_id, rider_id, assignment_status, cod_collected_amount, delivered_at) VALUES ($1, $2, 'DELIVERED', $3, $4)`,
      [id, RIDER_A, o.total, o.placedAt]
    );
  }
  return { id, itemIds };
}

beforeAll(async () => {
  await fx.setup();
  const s = (await pool.query('SELECT id, latitude, longitude, radius_km FROM dark_stores WHERE is_active = true LIMIT 1')).rows[0];
  store = { id: s.id, lat: Number(s.latitude), lng: Number(s.longitude), radius: Number(s.radius_km) };
  apple = (await fx.product({ tracked: false })).productId;
  bread = (await fx.product({ tracked: false })).productId;

  const kmNorth = (km: number) => ({ lat: store.lat + km / 111.2, lng: store.lng });
  const kmEast = (km: number) => ({ lat: store.lat, lng: store.lng + km / (111.32 * Math.cos((store.lat * Math.PI) / 180)) });

  // Today, 14 May (Colombo).
  await insertOrder({ status: 'DELIVERED', placedAt: '2020-05-14T03:00:00Z', total: 600, at: nearHub(0.0001), items: [{ product: apple, qty: 3, price: 100 }, { product: bread, qty: 2, price: 100 }] }); // 08:30
  await insertOrder({ status: 'DELIVERED', placedAt: '2020-05-14T05:00:00Z', total: 300, at: nearHub(-0.0001), items: [{ product: bread, qty: 2, price: 100 }] }); // 10:30
  await insertOrder({ status: 'CANCELLED', placedAt: '2020-05-14T05:10:00Z', total: 200, at: kmEast(2), items: [{ product: apple, qty: 1, price: 100 }] }); // 10:40
  await insertOrder({ status: 'PLACED', placedAt: '2020-05-14T05:50:00Z', total: 150, at: kmEast(2) }); // 11:20
  // Yesterday, 13 May: near the edge of the radius.
  await insertOrder({ status: 'DELIVERED', placedAt: '2020-05-13T04:00:00Z', total: 400, at: kmNorth(store.radius - 0.2), items: [{ product: apple, qty: 3, price: 100 }] });
  // Monday 11 May: outside the radius.
  await insertOrder({ status: 'DELIVERED', placedAt: '2020-05-11T06:00:00Z', total: 1000, at: kmEast(store.radius + 1) });
  // Last week (Tuesday 5 May), in the hub cell.
  await insertOrder({ status: 'DELIVERED', placedAt: '2020-05-05T06:00:00Z', total: 500, at: nearHub() });
  // Last month (10 April).
  await insertOrder({ status: 'DELIVERED', placedAt: '2020-04-10T06:00:00Z', total: 800, at: nearHub() });
}, 60_000);

afterAll(async () => {
  await fx.cleanup();
});

describe('dashboard ranges (Asia/Colombo)', () => {
  it('compares each range with the same stretch just before it', () => {
    expect(resolveDashboardRange('today', NOW)).toEqual({ current: { from: '2020-05-14', to: '2020-05-14' }, previous: { from: '2020-05-13', to: '2020-05-13' } });
    expect(resolveDashboardRange('yesterday', NOW)).toEqual({ current: { from: '2020-05-13', to: '2020-05-13' }, previous: { from: '2020-05-12', to: '2020-05-12' } });
    expect(resolveDashboardRange('this_week', NOW)).toEqual({ current: { from: '2020-05-11', to: '2020-05-14' }, previous: { from: '2020-05-04', to: '2020-05-07' } });
    expect(resolveDashboardRange('this_month', NOW)).toEqual({ current: { from: '2020-05-01', to: '2020-05-14' }, previous: { from: '2020-04-01', to: '2020-04-14' } });
    // 31 March compares with all of February (clamped), and 20:00 UTC is already the next Colombo day.
    expect(resolveDashboardRange('this_month', new Date('2021-03-30T20:00:00Z')).previous).toEqual({ from: '2021-02-01', to: '2021-02-28' });
  });

  it('percent change is null with nothing to compare against', () => {
    expect(percentChange(900, 400)).toBe(125);
    expect(percentChange(300, 400)).toBe(-25);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe('sales dashboard', () => {
  it('today: orders by status, revenue, cash, basket, top products, peak hours, vs yesterday', async () => {
    const d = await salesDashboard('today', NOW);
    expect(d).toMatchObject({
      order_count: 4,
      delivered_count: 2,
      cancelled_count: 1,
      delivered_revenue: 900,
      cash_collected: 900,
      average_basket: 450,
      orders_by_status: { DELIVERED: 2, CANCELLED: 1, PLACED: 1 },
      previous: { order_count: 1, delivered_revenue: 400, cash_collected: 400, average_basket: 400 },
      change: { order_count: 300, delivered_revenue: 125, cash_collected: 125, average_basket: 12.5 },
    });
    expect(d.top_by_quantity.map((p) => [p.product_id, p.quantity, p.revenue])).toEqual([
      [bread, 4, 400],
      [apple, 3, 300],
    ]);
    expect(d.top_by_revenue[0].product_id).toBe(bread);
    const hours = Object.fromEntries(d.orders_by_hour.filter((h) => h.orders).map((h) => [h.hour, h.orders]));
    expect(hours).toEqual({ 8: 1, 10: 2, 11: 1 });
  });

  it('this week and this month, to date, against the same days before', async () => {
    const week = await salesDashboard('this_week', NOW);
    expect(week).toMatchObject({ order_count: 6, delivered_revenue: 2300, previous: { order_count: 1, delivered_revenue: 500 }, change: { delivered_revenue: 360 } });
    const month = await salesDashboard('this_month', NOW);
    expect(month).toMatchObject({ order_count: 7, delivered_revenue: 2800, previous: { delivered_revenue: 800 }, change: { delivered_revenue: 250 } });
    const yesterday = await salesDashboard('yesterday', NOW);
    expect(yesterday).toMatchObject({ order_count: 1, delivered_revenue: 400, previous: { order_count: 0 }, change: { delivered_revenue: null } });
  });

  it('GET /admin/reports/dashboard: ADMIN and OPERATIONS only, validated', async () => {
    for (const t of [tokens.admin, opsToken]) {
      const res = await request(app).get('/api/v1/admin/reports/dashboard?range=this_week').set(auth(t));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ range: 'this_week', timezone: 'Asia/Colombo' });
      expect(res.body.data.orders_by_hour).toHaveLength(24);
    }
    expect((await request(app).get('/api/v1/admin/reports/dashboard').set(auth(tokens.admin))).body.data.range).toBe('today');
    expect((await request(app).get('/api/v1/admin/reports/dashboard?range=forever').set(auth(tokens.admin))).status).toBe(400);
    for (const t of [tokens.staff, tokens.customer, tokens.rider]) {
      expect((await request(app).get('/api/v1/admin/reports/dashboard').set(auth(t))).status).toBe(403);
    }
  });
});

describe('delivery heat map', () => {
  it('delivered orders on a ~150 m grid, with the radius split and the busiest areas', async () => {
    const m = await orderMap('this_month', 'delivered', NOW);
    expect(m.store).toMatchObject({ lat: store.lat, lng: store.lng, radius_km: store.radius });
    expect(m.cell_meters).toBe(150);
    expect(m.totals).toMatchObject({ orders: 5, revenue: 2800, inside: 3, near_edge: 1, outside: 1, cells: 3 });
    expect(m.busiest[0]).toMatchObject({ orders: 3, delivered: 3, revenue: 1400, zone: 'inside', area: 'Dharga Town' });
    // A cell centre, not anybody's exact point.
    expect(m.busiest[0].lat).toBeCloseTo(nearHub().lat, 6);
    expect(m.busiest[0].lng).toBeCloseTo(nearHub().lng, 6);
    expect(m.cells.map((c) => c.zone).sort()).toEqual(['inside', 'near_edge', 'outside']);
  });

  it('status=all adds the orders that were not delivered (revenue stays delivered-only)', async () => {
    const m = await orderMap('this_month', 'all', NOW);
    expect(m.totals).toMatchObject({ orders: 7, revenue: 2800, cells: 4 });
    const twoKm = m.cells.find((c) => c.delivered === 0)!;
    expect(twoKm).toMatchObject({ orders: 2, revenue: 0, zone: 'inside' });
  });

  it('GET /admin/reports/order-map: no names, phones or addresses; ADMIN and OPERATIONS only', async () => {
    for (const t of [tokens.admin, opsToken]) {
      const res = await request(app).get('/api/v1/admin/reports/order-map?range=last_90_days&status=all').set(auth(t));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain(SECRET_PHONE);
      expect(text).not.toContain('Secret Lane');
      expect(res.body.data.store.radius_km).toBe(store.radius);
    }
    expect((await request(app).get('/api/v1/admin/reports/order-map').set(auth(tokens.admin))).body.data).toMatchObject({ range: 'last_30_days', status: 'delivered' });
    for (const q of ['range=forever', 'status=some']) {
      expect((await request(app).get(`/api/v1/admin/reports/order-map?${q}`).set(auth(tokens.admin))).status, q).toBe(400);
    }
    for (const t of [tokens.staff, tokens.customer, tokens.rider]) {
      expect((await request(app).get('/api/v1/admin/reports/order-map').set(auth(t))).status).toBe(403);
    }
  });
});

describe('purchase list', () => {
  let low = '';
  let out = '';
  let zero = '';
  let plenty = '';
  let supplierId = '';

  beforeAll(async () => {
    const threshold = (productId: string, n: number) =>
      request(app).patch(`/api/v1/admin/inventory/${productId}/threshold`).set(auth(tokens.admin)).send({ low_stock_threshold: n });
    low = (await fx.product({ onHand: 2 })).productId;
    out = (await fx.product({ onHand: 0 })).productId;
    zero = (await fx.product({ onHand: 0 })).productId;
    plenty = (await fx.product({ onHand: 10 })).productId;
    for (const [p, n] of [[low, 5], [out, 3], [zero, 0], [plenty, 5]] as const) expect((await threshold(p, n)).status).toBe(200);

    supplierId = (await pool.query(`INSERT INTO suppliers (name, contact_phone) VALUES ('Zqx Wholesale', '+94771110000') RETURNING id`)).rows[0].id;
    fx.created.suppliers.push(supplierId);
    // `low` was last bought from Zqx Wholesale (a sourcing record on an old order).
    const o = await insertOrder({ status: 'CANCELLED', placedAt: '2019-06-01T06:00:00Z', total: 300, at: nearHub(), items: [{ product: low, qty: 2, price: 100 }] });
    await pool.query(
      `INSERT INTO sourcing_records (order_id, order_item_id, product_id, supplier_id, quantity_sourced, estimated_unit_cost, actual_unit_cost) VALUES ($1, $2, $3, $4, 2, 90, 90)`,
      [o.id, o.itemIds[0], low, supplierId]
    );
  }, 60_000);

  it('suggests 2 × threshold − available, at least 1', () => {
    expect(suggestedQuantity(5, 2)).toBe(8);
    expect(suggestedQuantity(3, 0)).toBe(6);
    expect(suggestedQuantity(0, 0)).toBe(1);
    expect(suggestedQuantity(5, 12)).toBe(1);
  });

  it('GET /admin/inventory/purchase-list: low products, quantities, cost, by last supplier', async () => {
    const res = await request(app).get('/api/v1/admin/inventory/purchase-list').set(auth(tokens.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body.data;
    expect(d.rule).toMatch(/2 × low-stock level/);
    const mine = d.items.filter((i: { product_id: string }) => [low, out, zero, plenty].includes(i.product_id));
    const by = Object.fromEntries(mine.map((i: { product_id: string }) => [i.product_id, i]));
    expect(by[plenty]).toBeUndefined();
    expect(by[low]).toMatchObject({ quantity_available: 2, low_stock_threshold: 5, target_level: 10, suggested_quantity: 8, unit_cost: 100, estimated_cost: 800, stock_state: 'LOW', supplier_name: 'Zqx Wholesale', supplier_phone: '+94771110000' });
    expect(by[out]).toMatchObject({ suggested_quantity: 6, estimated_cost: 600, stock_state: 'OUT', supplier_id: null });
    expect(by[zero]).toMatchObject({ suggested_quantity: 1, estimated_cost: 100 });

    const group = d.suppliers.find((g: { supplier_id: string | null }) => g.supplier_id === supplierId);
    expect(group.items.map((i: { product_id: string }) => i.product_id)).toEqual([low]);
    expect(group.estimated_cost).toBe(800);
    expect(d.suppliers[d.suppliers.length - 1].supplier_id).toBeNull();
    expect(d.totals.products).toBe(d.items.length);
  });

  it('ADMIN, OPERATIONS and Inventory staff; not customers or riders', async () => {
    for (const t of [tokens.admin, opsToken, tokens.staff]) {
      expect((await request(app).get('/api/v1/admin/inventory/purchase-list').set(auth(t))).status).toBe(200);
    }
    for (const t of [tokens.customer, tokens.rider]) {
      expect((await request(app).get('/api/v1/admin/inventory/purchase-list').set(auth(t))).status).toBe(403);
    }
  });
});
