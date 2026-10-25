import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings, settingsService } from '../src/modules/configuration/settings.service.js';
import { feeDistance, feeDistanceCache } from '../src/modules/orders/delivery-fee.js';
import { basePay } from '../src/modules/riders/rider.pay-rules.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * "Base + per km" delivery fee (owner's brother, 2026-10-25): LKR 120 covers the first 2 km, then LKR 40
 * for each started km - set in Admin / Ops (fee_mode BASE_PER_KM), never hard-coded. checkout-info and
 * order placement charge the same fee for the chosen address; customers and older apps are told the
 * mode is DISTANCE_TIERS. Even when delivery is free the rider is still paid 80% of the STANDARD fee.
 * OSRM is mocked (feeDistance.roadMetres); the rows and audit entries this file wrote are restored.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-BPK-');
const people = customerFixtures(app, { idPrefix: 'c0c00063', phoneBase: '+947096300', name: 'Base Per Km Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = ['coupons_enabled', 'new_customer_free_deliveries', 'show_offer_savings', 'basket_free_delivery', 'order_for_someone_else', 'small_order_fee'];

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let productId = '';
const realRoad = feeDistance.roadMetres;
const pinned = checkoutSettings.read;

const patchFee = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(token)).send(body);
const patchCheckout = (body: object) => request(app).patch('/api/v1/admin/settings/checkout').set(auth(tokens.admin)).send(body);
const roadIs = (km: number) => {
  feeDistance.roadMetres = async () => Math.round(km * 1000);
  feeDistanceCache.clear();
};

beforeAll(async () => {
  checkoutSettings.read = () => settingsService.getCheckoutSettings();
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (
    await pool.query("SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = 'delivery_fee' OR key = ANY($1)", [KEYS])
  ).rows;
  await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee' OR key = ANY($1)", [KEYS]);
  productId = (await fx.product({ tracked: false })).productId;
});

afterEach(() => {
  feeDistance.roadMetres = realRoad;
  feeDistanceCache.clear();
});

afterAll(async () => {
  checkoutSettings.read = pinned;
  await people.cleanup();
  await fx.cleanup();
  await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee' OR key = ANY($1)", [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  await pool.query("DELETE FROM audit_logs WHERE action IN ('DELIVERY_FEE_UPDATED', 'CHECKOUT_SETTINGS_UPDATED') AND created_at >= $1", [testStart]);
});

describe('Admin sets the base + per km fee', () => {
  it('defaults are 120 / 2 km / 40 before anything is saved, and the three numbers save and audit', async () => {
    const before = await request(app).get('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin));
    expect(before.body.data).toMatchObject({ fee_mode: 'FLAT', base_lkr: 120, base_km: 2, per_km_lkr: 40 });

    const res = await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null });

    const changed = await patchFee({ base_lkr: 130, per_km_lkr: 45.5 });
    expect(changed.body.data).toMatchObject({ fee_mode: 'BASE_PER_KM', base_lkr: 130, base_km: 2, per_km_lkr: 45.5 });
    const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE action = 'DELIVERY_FEE_UPDATED' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(audit.new_values).toMatchObject({ fee_mode: 'BASE_PER_KM', base_lkr: 130, base_km: 2, per_km_lkr: 45.5 });
    expect((await patchFee({ base_lkr: 120, per_km_lkr: 40 })).status).toBe(200);
  });

  it('validates the numbers and the role', async () => {
    expect((await patchFee({ base_lkr: -1 })).status).toBe(400);
    expect((await patchFee({ base_lkr: 1000.5 })).status).toBe(400);
    expect((await patchFee({ base_km: 0.2 })).status).toBe(400);
    expect((await patchFee({ base_km: 21 })).status).toBe(400);
    expect((await patchFee({ base_km: 2.25 })).status).toBe(400);
    expect((await patchFee({ per_km_lkr: -5 })).status).toBe(400);
    expect((await patchFee({ per_km_lkr: 10.123 })).status).toBe(400);
    expect((await patchFee({ fee_mode: 'BY_KM' })).status).toBe(400);
    expect((await patchFee({ base_lkr: 100 }, tokens.staff)).status).toBe(403);
    expect((await patchFee({ base_lkr: 100 }, tokens.customer)).status).toBe(403);
  });

  it('tells customers it is a charge by distance, with the formula and the lowest fee', async () => {
    expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: 400 })).status).toBe(200);
    const store = (await request(app).get('/api/v1/store')).body.data;
    expect(store).toMatchObject({
      delivery_fee_mode: 'DISTANCE_TIERS',
      delivery_fee_by_distance: true,
      delivery_fee_lkr: null,
      delivery_fee_from_lkr: 120,
      delivery_fee_formula: { base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: 400 },
    });
    expect((await patchFee({ fee_mode: 'FLAT', fee_lkr: 100 })).status).toBe(200);
    const flat = (await request(app).get('/api/v1/store')).body.data;
    expect(flat).toMatchObject({ delivery_fee_mode: 'FLAT', delivery_fee_lkr: 100, delivery_fee_formula: null });
  });
});

describe('The fee the cart shows is the fee the order charges', () => {
  const EXAMPLES: [number, number][] = [
    [1.5, 120],
    [2.0, 120],
    [2.1, 160],
    [3.0, 160],
    [3.4, 200],
    [4.8, 240],
    [5.6, 280],
  ];

  it.each(EXAMPLES)('%s km -> LKR %s in checkout-info and at placement', async (km, lkr) => {
    expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null })).status).toBe(200);
    roadIs(km);
    const me = await people.customer(1);
    const info = (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;
    expect(info).toMatchObject({ delivery_fee_lkr: lkr, standard_delivery_fee_lkr: lkr, delivery_fee_mode: 'DISTANCE_TIERS', delivery_distance_km: km });
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order.delivery_fee).toBe(lkr);
    expect(order.total_amount).toBe(order.subtotal_amount + lkr);
    const row = (await pool.query('SELECT delivery_fee_mode, delivery_distance_km, standard_delivery_fee FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(row.delivery_fee_mode).toBe('DISTANCE_TIERS');
    expect(Number(row.delivery_distance_km)).toBe(km);
    expect(Number(row.standard_delivery_fee)).toBe(lkr);
  });

  it('with no address yet the cart quotes the base fee', async () => {
    expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40 })).status).toBe(200);
    const me = await people.customer(2);
    await pool.query('UPDATE customer_addresses SET is_deleted = true WHERE user_id = $1', [me.id]);
    const info = (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;
    expect(info).toMatchObject({ delivery_fee_lkr: 120, delivery_distance_km: null, delivery_fee_address_id: null });
  });

  it('applies the optional maximum', async () => {
    expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: 200 })).status).toBe(200);
    roadIs(5.6);
    const me = await people.customer(3);
    const info = (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;
    expect(info.delivery_fee_lkr).toBe(200);
  });
});

describe('Free delivery: the rider still earns the normal 80% of the standard fee', () => {
  it('a free order keeps the standard fee, and 80% of it is the rider base pay', async () => {
    expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null })).status).toBe(200);
    expect((await patchCheckout({ new_customer_free_deliveries: { enabled: true, count: 2 } })).status).toBe(200);
    roadIs(3.0);
    const me = await people.customer(4);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order.delivery_fee).toBe(0);
    const row = (await pool.query('SELECT standard_delivery_fee FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(Number(row.standard_delivery_fee)).toBe(160);
    const percent = { model: 'PERCENT', percent: 80, fixed_lkr: 0, base_lkr: 0, per_km_lkr: 0, min_lkr: null, distance_mode: 'LINEAR', km_tiers: [] } as never;
    expect(basePay(percent, { standardFee: Number(row.standard_delivery_fee), distanceKm: null })).toBe(128);
  });
});
