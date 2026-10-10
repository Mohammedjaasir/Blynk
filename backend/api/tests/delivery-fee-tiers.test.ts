import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings } from '../src/modules/configuration/settings.service.js';
import { feeDistance, feeDistanceCache } from '../src/modules/orders/delivery-fee.js';
import { haversineM } from '../src/modules/routing/index.js';
import { kmCounted, kmTiersSchema, priceByKmTiers } from '../src/modules/pricing/km-tiers.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Per-km tier delivery fee (owner, 2026-10-10): "1st km LKR 100, then an
 * additional amount for the 2nd km, another for the 3rd and 4th". Every
 * started km counts, the last row repeats. Ops and Admin set it
 * (fee_mode FLAT | DISTANCE_TIERS); checkout-info, the coupon preview and
 * order placement all charge the same fee for the chosen address. OSRM is
 * mocked (feeDistance.roadMetres); the 'delivery_fee' row and the audit rows
 * this file wrote are restored afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-KMF-');
const people = customerFixtures(app, { idPrefix: 'c0c00040', phoneBase: '+947094000', name: 'Km Tier Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TIERS = [
  { km: 1, lkr: 100 },
  { km: 2, lkr: 60 },
  { km: 3, lkr: 50 },
];

type Row = { value: unknown; description: string | null; created_at: Date; updated_at: Date };
let feeRow: Row | undefined;
let testStart: Date;
let productId = '';
const realRoad = feeDistance.roadMetres;
const pinned = checkoutSettings.read;

const patchFee = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(token)).send(body);
const setRow = (value: object) =>
  pool.query(
    `INSERT INTO system_configurations (key, value, description) VALUES ('delivery_fee', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(value)]
  );
/** OSRM answers this many metres for every route. */
const roadIs = (metres: number) => {
  feeDistance.roadMetres = async () => metres;
};

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  feeRow = (await pool.query("SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = 'delivery_fee'")).rows[0];
  productId = (await fx.product({ tracked: false })).productId;
});

afterEach(() => {
  feeDistance.roadMetres = realRoad;
  feeDistanceCache.clear();
  checkoutSettings.read = pinned;
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  if (feeRow) {
    await pool.query(
      `UPDATE system_configurations SET value = $1, description = $2, created_at = $3, updated_at = $4 WHERE key = 'delivery_fee'`,
      [JSON.stringify(feeRow.value), feeRow.description, feeRow.created_at, feeRow.updated_at]
    );
  } else {
    await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee'");
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'DELIVERY_FEE_UPDATED' AND created_at >= $1`, [testStart]);
});

describe('The tier formula', () => {
  it('counts every started km, at least one', () => {
    expect(kmCounted(2.3)).toBe(3);
    expect(kmCounted(2)).toBe(2);
    expect(kmCounted(2.001)).toBe(2); // 2-decimal km: 2.00
    expect(kmCounted(2.01)).toBe(3);
    expect(kmCounted(0.4)).toBe(1);
    expect(kmCounted(0)).toBe(1);
  });

  it('adds each km amount, repeats the last row, and caps', () => {
    expect(priceByKmTiers(TIERS, 1)).toMatchObject({ km_counted: 1, parts: [100], total: 100 });
    expect(priceByKmTiers(TIERS, 2.3)).toMatchObject({ km_counted: 3, parts: [100, 60, 50], total: 210 });
    expect(priceByKmTiers(TIERS, 5)).toMatchObject({ parts: [100, 60, 50, 50, 50], total: 310 });
    expect(priceByKmTiers(TIERS, 5, 250)).toMatchObject({ sum: 310, total: 250, capped: true });
    expect(priceByKmTiers([{ km: 1, lkr: 99.5 }], 3)).toMatchObject({ total: 298.5 });
  });

  it('accepts only km 1, 2, 3 ... in order, 1 to 10 rows', () => {
    expect(kmTiersSchema.safeParse(TIERS).success).toBe(true);
    expect(kmTiersSchema.safeParse([]).success).toBe(false);
    expect(kmTiersSchema.safeParse([{ km: 2, lkr: 10 }]).success).toBe(false);
    expect(kmTiersSchema.safeParse([{ km: 1, lkr: 10 }, { km: 3, lkr: 10 }]).success).toBe(false);
    expect(kmTiersSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ km: i + 1, lkr: 1 }))).success).toBe(false);
    expect(kmTiersSchema.safeParse([{ km: 1, lkr: -1 }]).success).toBe(false);
    expect(kmTiersSchema.safeParse([{ km: 1, lkr: 10.555 }]).success).toBe(false);
    expect(kmTiersSchema.safeParse([{ km: 1, lkr: 1000.01 }]).success).toBe(false);
    expect(kmTiersSchema.safeParse([{ km: 1, lkr: 10, extra: 1 }]).success).toBe(false);
  });
});

describe('Delivery fee setting (Ops and Admin)', () => {
  it('switches to per-km tiers with a cap, audited; an old {fee_lkr} client keeps the mode', async () => {
    await setRow({ fee_lkr: 100 });
    const res = await patchFee({ fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 400 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 400 });

    const got = await request(app).get('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin));
    expect(got.body.data).toMatchObject({ fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 400 });
    expect(got.body.data.updated_at).not.toBeNull();

    const audit = (
      await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'DELIVERY_FEE_UPDATED' ORDER BY created_at DESC LIMIT 1")
    ).rows[0];
    expect(audit.old_values).toEqual({ key: 'delivery_fee', fee_lkr: 100, fee_mode: 'FLAT', tiers: [], max_fee_lkr: null });
    expect(audit.new_values).toEqual({ key: 'delivery_fee', fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 400 });

    // An older Ops APK sends only the flat amount: tiers and mode stay.
    const old = await patchFee({ fee_lkr: 120 });
    expect(old.body.data).toMatchObject({ fee_lkr: 120, fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 400 });
    // Back to flat keeps the table for next time; the cap can be removed.
    const flat = await patchFee({ fee_mode: 'FLAT', max_fee_lkr: null });
    expect(flat.body.data).toMatchObject({ fee_lkr: 120, fee_mode: 'FLAT', tiers: TIERS, max_fee_lkr: null });
  });

  it('validates the body and the role', async () => {
    await setRow({ fee_lkr: 100 });
    expect((await patchFee({ fee_mode: 'DISTANCE_TIERS' })).status).toBe(400); // no tiers stored
    expect((await patchFee({ fee_mode: 'BY_KM', tiers: TIERS })).status).toBe(400);
    expect((await patchFee({ tiers: [{ km: 1, lkr: 100 }, { km: 3, lkr: 50 }] })).status).toBe(400);
    expect((await patchFee({ tiers: [] })).status).toBe(400);
    expect((await patchFee({ max_fee_lkr: -1 })).status).toBe(400);
    expect((await patchFee({ max_fee_lkr: 10_000.01 })).status).toBe(400);
    expect((await patchFee({ fee_lkr: 100, tiers_typo: TIERS })).status).toBe(400);
    expect((await patchFee({})).status).toBe(400);
    expect((await patchFee({ fee_mode: 'DISTANCE_TIERS', tiers: TIERS }, tokens.staff)).status).toBe(403);
    expect((await patchFee({ fee_mode: 'DISTANCE_TIERS', tiers: TIERS }, tokens.customer)).status).toBe(403);
    // Nothing was saved by the refused calls.
    const row = (await pool.query("SELECT value FROM system_configurations WHERE key = 'delivery_fee'")).rows[0];
    expect(row.value).toEqual({ fee_lkr: 100 });
  });

  it('a malformed stored table charges the flat fee', async () => {
    await setRow({ fee_lkr: 90, fee_mode: 'DISTANCE_TIERS', tiers: [{ km: 2, lkr: 5 }] });
    const got = await request(app).get('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin));
    expect(got.body.data).toMatchObject({ fee_lkr: 90, fee_mode: 'FLAT', tiers: [] });
  });
});

describe('GET /store never shows the km prices', () => {
  it('in DISTANCE_TIERS mode says only that the fee depends on distance', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 400 });
    const res = await request(app).get('/api/v1/store');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ delivery_fee_lkr: null, delivery_fee_mode: 'DISTANCE_TIERS', delivery_fee_by_distance: true });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('tiers');
    expect(raw).not.toContain('max_fee');

    await setRow({ fee_lkr: 100 });
    const flat = (await request(app).get('/api/v1/store')).body.data;
    expect(flat).toMatchObject({ delivery_fee_lkr: 100, delivery_fee_mode: 'FLAT', delivery_fee_by_distance: false });
  });
});

describe('The fee for the chosen address', () => {
  it('checkout-info quotes each address by road km; someone else\'s address is 404', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS });
    const c = await people.customer(1);
    const other = await people.customer(2);
    const second = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Work', 'K', $2, 'No. 9', 'Dharga Town', 6.4400, 80.0300, false) RETURNING id`,
        [c.id, c.phone]
      )
    ).rows[0].id as string;
    const seen: Array<{ lat: number; lng: number }> = [];
    feeDistance.roadMetres = async (_from, to) => {
      seen.push(to);
      return to.lat === 6.44 ? 4100 : 2300;
    };
    const info = (q = '') => request(app).get(`/api/v1/orders/checkout-info${q}`).set('Authorization', `Bearer ${c.token}`);

    const home = await info(`?address_id=${c.addressId}`);
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    expect(home.body.data).toMatchObject({
      delivery_fee_lkr: 210,
      standard_delivery_fee_lkr: 210,
      delivery_fee_mode: 'DISTANCE_TIERS',
      delivery_distance_km: 2.3,
      delivery_distance_estimated: false,
      delivery_fee_address_id: c.addressId,
    });
    const work = await info(`?address_id=${second}`);
    // 4.1 km -> 5 km counted: 100 + 60 + 50 + 50 + 50.
    expect(work.body.data).toMatchObject({ delivery_fee_lkr: 310, delivery_distance_km: 4.1, delivery_fee_address_id: second });
    // Without address_id: the default address.
    expect((await info()).body.data).toMatchObject({ delivery_fee_lkr: 210, delivery_fee_address_id: c.addressId });
    // Asked once per address (the second home quote came from the cache).
    expect(seen).toHaveLength(2);

    expect((await info(`?address_id=${other.addressId}`)).status).toBe(404);
    expect((await info('?address_id=nope')).status).toBe(400);
  });

  it('OSRM down: straight line x 1.3, marked estimated', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS });
    const c = await people.customer(3);
    feeDistance.roadMetres = async () => {
      throw new Error('OSRM down');
    };
    const hub = (await pool.query('SELECT latitude, longitude FROM dark_stores WHERE is_active = true ORDER BY created_at LIMIT 1')).rows[0];
    const km = Math.round((haversineM({ lat: Number(hub.latitude), lng: Number(hub.longitude) }, { lat: 6.4351, lng: 80.0243 }) * 1.3) / 10) / 100;
    const expected = priceByKmTiers(TIERS, km).total;
    const res = await request(app).get(`/api/v1/orders/checkout-info?address_id=${c.addressId}`).set('Authorization', `Bearer ${c.token}`);
    expect(res.body.data).toMatchObject({ delivery_distance_km: km, delivery_distance_estimated: true, delivery_fee_lkr: expected });
  });

  it('a customer with no address gets the km-1 amount; FLAT mode quotes the flat fee without measuring', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS });
    const c = await people.customer(4);
    await pool.query('DELETE FROM customer_addresses WHERE user_id = $1', [c.id]);
    const res = await request(app).get('/api/v1/orders/checkout-info').set('Authorization', `Bearer ${c.token}`);
    expect(res.body.data).toMatchObject({ delivery_fee_lkr: 100, delivery_distance_km: null, delivery_fee_address_id: null });

    await setRow({ fee_lkr: 120 });
    feeDistance.roadMetres = async () => {
      throw new Error('FLAT must not measure');
    };
    const d = await people.customer(5);
    const flat = await request(app).get(`/api/v1/orders/checkout-info?address_id=${d.addressId}`).set('Authorization', `Bearer ${d.token}`);
    expect(flat.body.data).toMatchObject({
      delivery_fee_lkr: 120,
      standard_delivery_fee_lkr: 120,
      delivery_fee_mode: 'FLAT',
      delivery_distance_km: null,
      delivery_distance_estimated: null,
      delivery_fee_address_id: d.addressId,
    });
  });

  it('the order charges the same fee and snapshots the distance; the cap applies', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS, max_fee_lkr: 180 });
    roadIs(2300);
    const c = await people.customer(6);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }]));
    // 210 capped at 180.
    expect(Number(order.delivery_fee)).toBe(180);
    const row = (
      await pool.query(
        'SELECT delivery_fee, standard_delivery_fee, delivery_fee_mode, delivery_distance_km, delivery_distance_estimated, subtotal_amount, total_amount FROM orders WHERE id = $1',
        [order.id]
      )
    ).rows[0];
    expect(row).toMatchObject({ delivery_fee_mode: 'DISTANCE_TIERS', delivery_distance_estimated: false });
    expect(Number(row.delivery_fee)).toBe(180);
    expect(Number(row.standard_delivery_fee)).toBe(180);
    expect(Number(row.delivery_distance_km)).toBe(2.3);
    expect(Number(row.total_amount)).toBe(Number((Number(row.subtotal_amount) + 180).toFixed(2)));

    // FLAT orders record their mode and no distance.
    await setRow({ fee_lkr: 100 });
    const flat = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }]));
    const f = (await pool.query('SELECT delivery_fee, delivery_fee_mode, delivery_distance_km FROM orders WHERE id = $1', [flat.id])).rows[0];
    expect(f).toMatchObject({ delivery_fee_mode: 'FLAT', delivery_distance_km: null });
    expect(Number(f.delivery_fee)).toBe(100);
  });

  it('a free delivery charges 0 but keeps the tier fee as the standard fee (rider-pay basis)', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS });
    roadIs(2300);
    checkoutSettings.read = async () => ({
      coupons_enabled: true,
      new_customer_free_deliveries: { enabled: true, count: 1, since: '2026-01-01T00:00:00.000Z' },
      show_offer_savings: false,
    });
    const c = await people.customer(7);
    const info = await request(app).get(`/api/v1/orders/checkout-info?address_id=${c.addressId}`).set('Authorization', `Bearer ${c.token}`);
    expect(info.body.data).toMatchObject({ delivery_fee_lkr: 0, standard_delivery_fee_lkr: 210, delivery_distance_km: 2.3 });

    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }]));
    const row = (await pool.query('SELECT delivery_fee, standard_delivery_fee, delivery_distance_km FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(Number(row.delivery_fee)).toBe(0);
    expect(Number(row.standard_delivery_fee)).toBe(210);
    expect(Number(row.delivery_distance_km)).toBe(2.3);

    // The free one is used up: the next order pays the tier fee.
    const next = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(Number(next.delivery_fee)).toBe(210);
  });

  it('the coupon preview uses the fee for the chosen address', async () => {
    await setRow({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS });
    feeDistance.roadMetres = async (_from, to) => (to.lat === 6.44 ? 4100 : 1000);
    const c = await people.customer(8);
    const second = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Work', 'K', $2, 'No. 9', 'Dharga Town', 6.4400, 80.0300, false) RETURNING id`,
        [c.id, c.phone]
      )
    ).rows[0].id as string;
    const preview = (body: object) =>
      request(app)
        .post('/api/v1/orders/validate-coupon')
        .set('Authorization', `Bearer ${c.token}`)
        .send({ subtotal: 1000, ...body });
    const code = 'TSTKMF10';
    await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
    await pool.query(
      `INSERT INTO coupons (code, discount_type, discount_value, is_active) VALUES ($1, 'FIXED', 10, true)`,
      [code]
    );
    try {
      const home = await preview({ code, address_id: c.addressId });
      expect(home.status, JSON.stringify(home.body)).toBe(200);
      expect(home.body.data.coupon).toMatchObject({ delivery_fee: 100, total: 1090 });
      const work = await preview({ code, address_id: second });
      expect(work.body.data.coupon).toMatchObject({ delivery_fee: 310, total: 1300 });
      expect((await preview({ code, address_id: 'x' })).status).toBe(400);
    } finally {
      await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = $1)', [code]);
      await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'COUPON' AND coalesce(new_values->>'code', old_values->>'code') = $1", [code]);
    }
  });
});
