import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { checkoutSettings, type CheckoutSettings } from '../src/modules/configuration/settings.service.js';
import { feeDistance, feeDistanceCache } from '../src/modules/orders/delivery-fee.js';
import { payDistance } from '../src/modules/riders/rider.pay-rules.js';
import { setSellerLocationColumnsForTests } from '../src/modules/sellers/seller.location.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';

/**
 * Delivery fee from the pickup points (owner, 2026-10-24: "coordinates should
 * work by seller place and delivery charge should charge by from that
 * coordinates and admin can approve this"). Blynk's products are collected at
 * the Blynk store, a seller's products at the seller's APPROVED shop point;
 * the fee (checkout-info, coupon preview, the order) and the rider's distance
 * pay use the LONGEST road distance from any pickup point to the customer.
 *
 * Real local Postgres with migration 053: sellers get real approved / pending
 * points. OSRM is mocked: the road distance depends on where a leg starts.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-PKP-');
const TIERS = [
  { km: 1, lkr: 100 },
  { km: 2, lkr: 60 },
  { km: 3, lkr: 50 },
];
// 100 + 60 + 50 = 210 for 2.3 km (3 km counted); + 50 + 50 = 310 for 4.1 km (5 km counted).
const FEE_2_3 = 210;
const FEE_4_1 = 310;

const STORE_LAT = 6.4382;
const FAR = { lat: 6.46, lng: 80.05 }; // seller A, approved: 4.1 km of road
const NEAR = { lat: 6.44, lng: 80.028 }; // seller B, approved: 1.2 km of road
const PENDING = { lat: 6.47, lng: 80.06 }; // seller C, only a pending point (not approved)

/** Road metres by where the leg starts (the store: 2.3 km). */
function roadFrom(from: { lat: number }): number {
  const at = from.lat.toFixed(4);
  if (at === FAR.lat.toFixed(4)) return 4100;
  if (at === NEAR.lat.toFixed(4)) return 1200;
  if (at === PENDING.lat.toFixed(4)) return 9900; // must never be used
  if (at === STORE_LAT.toFixed(4)) return 2300;
  throw new Error(`unexpected leg from ${at}`);
}

const realFeeRoad = feeDistance.roadMetres;
const realPayRoad = payDistance.roadMetres;
const pinnedCheckout = checkoutSettings.read;
let feeRow: { value: unknown; description: string | null; created_at: Date; updated_at: Date } | undefined;
let startedAt: Date;
const PHONE_BASE = '+9470955';
const sellerUsers: string[] = [];
const sellers: Record<'far' | 'near' | 'pending', string> = { far: '', near: '', pending: '' };
let blynk = '';
let farProduct = '';
let nearProduct = '';
let pendingProduct = '';
let rider: { riderId: string; token: string };

const noFree: CheckoutSettings = {
  coupons_enabled: true,
  new_customer_free_deliveries: { enabled: false, count: 0, since: '2026-01-01T00:00:00.000Z' },
  show_offer_savings: false,
  basket_free_delivery: { enabled: false, min_subtotal_lkr: 3000 },
};

async function makeSeller(n: number, shop: string, point: { lat: number; lng: number }, approved: boolean) {
  const user = (
    await pool.query(`INSERT INTO users (phone, full_name, role) VALUES ($1, $2, 'SELLER') RETURNING id`, [
      `${PHONE_BASE}${String(n).padStart(2, '0')}`,
      `Pickup test ${shop}`,
    ])
  ).rows[0].id as string;
  sellerUsers.push(user);
  const id = approved
    ? (
        await pool.query(
          `INSERT INTO sellers (user_id, shop_name, status, latitude, longitude, location_status)
           VALUES ($1, $2, 'APPROVED', $3, $4, 'APPROVED') RETURNING id`,
          [user, shop, point.lat, point.lng]
        )
      ).rows[0].id
    : (
        await pool.query(
          `INSERT INTO sellers (user_id, shop_name, status, pending_latitude, pending_longitude, location_status)
           VALUES ($1, $2, 'APPROVED', $3, $4, 'PENDING') RETURNING id`,
          [user, shop, point.lat, point.lng]
        )
      ).rows[0].id;
  return id as string;
}

async function sellerOwned(sellerId: string) {
  const { productId } = await fx.product({ tracked: false });
  await pool.query('UPDATE products SET seller_id = $2 WHERE id = $1', [productId, sellerId]);
  return productId;
}

async function purgeSellers() {
  await pool.query(
    `UPDATE products SET seller_id = NULL WHERE seller_id IN (SELECT s.id FROM sellers s JOIN users u ON u.id = s.user_id WHERE u.phone LIKE $1)`,
    [`${PHONE_BASE}%`]
  );
  await pool.query('DELETE FROM sellers WHERE user_id IN (SELECT id FROM users WHERE phone LIKE $1)', [`${PHONE_BASE}%`]);
  await pool.query('DELETE FROM users WHERE phone LIKE $1', [`${PHONE_BASE}%`]);
}

const info = (ids: string[]) =>
  request(app)
    .get(`/api/v1/orders/checkout-info?address_id=${fx.addressId}${ids.length ? `&product_ids=${ids.join(',')}` : ''}`)
    .set(auth(tokens.customer));
const orderRow = async (id: string) =>
  (
    await pool.query(
      `SELECT delivery_fee::float AS fee, standard_delivery_fee::float AS standard, delivery_fee_mode AS mode,
              delivery_distance_km::float AS km, delivery_distance_estimated AS estimated
         FROM orders WHERE id = $1`,
      [id]
    )
  ).rows[0];
const adminDetail = async (id: string) => {
  const res = await request(app).get(`/api/v1/admin/orders/${id}`).set(auth(tokens.admin));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.order ?? res.body.data;
};

beforeAll(async () => {
  startedAt = new Date();
  setSellerLocationColumnsForTests(null);
  await purgeSellers();
  await fx.setup();
  feeRow = (await pool.query("SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = 'delivery_fee'")).rows[0];
  await pool.query(
    `INSERT INTO system_configurations (key, value, description) VALUES ('delivery_fee', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ fee_lkr: 100, fee_mode: 'DISTANCE_TIERS', tiers: TIERS })]
  );
  checkoutSettings.read = async () => noFree;
  feeDistance.roadMetres = async (from) => roadFrom(from);
  payDistance.roadMetres = async (from) => roadFrom(from);

  sellers.far = await makeSeller(1, 'Pickup Far Shop', FAR, true);
  sellers.near = await makeSeller(2, 'Pickup Near Shop', NEAR, true);
  sellers.pending = await makeSeller(3, 'Pickup Pending Shop', PENDING, false);
  blynk = (await fx.product({ tracked: false })).productId;
  farProduct = await sellerOwned(sellers.far);
  nearProduct = await sellerOwned(sellers.near);
  pendingProduct = await sellerOwned(sellers.pending);
  rider = await fx.tempRider('pickup-pay');
  // Rider pay on the same per-km table as the fee, no floor: base = the fee for the same km.
  const pay = await request(app)
    .patch(`/api/v1/admin/riders/${rider.riderId}/pay`)
    .set(auth(tokens.admin))
    .send({ pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS, min_lkr: 0 });
  expect(pay.status, JSON.stringify(pay.body)).toBe(200);
}, 60_000);

afterEach(() => {
  feeDistanceCache.clear();
  checkoutSettings.read = async () => noFree;
});

afterAll(async () => {
  checkoutSettings.read = pinnedCheckout;
  feeDistance.roadMetres = realFeeRoad;
  payDistance.roadMetres = realPayRoad;
  if (feeRow) {
    await pool.query(
      `UPDATE system_configurations SET value = $1, description = $2, created_at = $3, updated_at = $4 WHERE key = 'delivery_fee'`,
      [JSON.stringify(feeRow.value), feeRow.description, feeRow.created_at, feeRow.updated_at]
    );
  } else {
    await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee'");
  }
  if (rider) await pool.query('DELETE FROM audit_logs WHERE created_at >= $1 AND entity_id = $2', [startedAt, rider.riderId]);
  await fx.cleanup();
  await purgeSellers();
});

describe('The fee from the pickup points', () => {
  it('a Blynk-only cart is charged from the store, as before', async () => {
    const withIds = await info([blynk]);
    expect(withIds.status, JSON.stringify(withIds.body)).toBe(200);
    expect(withIds.body.data).toMatchObject({ delivery_fee_lkr: FEE_2_3, standard_delivery_fee_lkr: FEE_2_3, delivery_distance_km: 2.3 });
    // An older app that sends no product ids: from the store too.
    expect((await info([])).body.data).toMatchObject({ delivery_fee_lkr: FEE_2_3, delivery_distance_km: 2.3 });

    const order = await fx.placeOrder([{ product_id: blynk, quantity: 1 }]);
    expect(await orderRow(order.id)).toMatchObject({ fee: FEE_2_3, standard: FEE_2_3, mode: 'DISTANCE_TIERS', km: 2.3, estimated: false });
    const store = (await pool.query('SELECT latitude::float AS lat, longitude::float AS lng FROM dark_stores WHERE id = (SELECT dark_store_id FROM orders WHERE id = $1)', [order.id])).rows[0];
    expect((await adminDetail(order.id)).pickups).toEqual([
      { kind: 'STORE', shop_name: 'Blynk store', lat: store.lat, lng: store.lng, address: null, how_to_find: null, phone: null, ready: true },
    ]);
  });

  it("a seller's cart is charged from the seller's approved shop point", async () => {
    expect((await info([farProduct])).body.data).toMatchObject({ delivery_fee_lkr: FEE_4_1, delivery_distance_km: 4.1 });
    const order = await fx.placeOrder([{ product_id: farProduct, quantity: 1 }]);
    expect(await orderRow(order.id)).toMatchObject({ fee: FEE_4_1, standard: FEE_4_1, km: 4.1 });
    expect((await adminDetail(order.id)).pickups).toEqual([
      {
        kind: 'SELLER',
        seller_id: sellers.far,
        shop_name: 'Pickup Far Shop',
        lat: FAR.lat,
        lng: FAR.lng,
        address: null,
        how_to_find: null,
        phone: `${PHONE_BASE}01`,
        ready: false,
      },
    ]);
  });

  it('a mixed cart is charged by the farthest pickup point', async () => {
    // Store 2.3 km vs near seller 1.2 km: the store leg.
    expect((await info([blynk, nearProduct])).body.data).toMatchObject({ delivery_fee_lkr: FEE_2_3, delivery_distance_km: 2.3 });
    // Store 2.3 km vs far seller 4.1 km: the seller leg.
    expect((await info([blynk, nearProduct, farProduct])).body.data).toMatchObject({ delivery_fee_lkr: FEE_4_1, delivery_distance_km: 4.1 });

    const order = await fx.placeOrder([
      { product_id: blynk, quantity: 1 },
      { product_id: farProduct, quantity: 2 },
      { product_id: nearProduct, quantity: 1 },
    ]);
    expect(await orderRow(order.id)).toMatchObject({ fee: FEE_4_1, km: 4.1 });
    const pickups = (await adminDetail(order.id)).pickups;
    expect(pickups.map((p: { kind: string; shop_name?: string }) => [p.kind, p.shop_name ?? null])).toEqual([
      ['STORE', 'Blynk store'],
      ['SELLER', 'Pickup Far Shop'],
      ['SELLER', 'Pickup Near Shop'],
    ]);
  });

  it('a seller without an approved point (only a pending one) is charged from the store', async () => {
    expect((await info([pendingProduct])).body.data).toMatchObject({ delivery_fee_lkr: FEE_2_3, delivery_distance_km: 2.3 });
    const order = await fx.placeOrder([{ product_id: pendingProduct, quantity: 1 }]);
    expect(await orderRow(order.id)).toMatchObject({ fee: FEE_2_3, km: 2.3 });
    expect((await adminDetail(order.id)).pickups.map((p: { kind: string }) => p.kind)).toEqual(['STORE']);
  });

  it('before migration 053 (no location columns) everything is from the store', async () => {
    setSellerLocationColumnsForTests(false);
    try {
      expect((await info([farProduct])).body.data).toMatchObject({ delivery_fee_lkr: FEE_2_3, delivery_distance_km: 2.3 });
    } finally {
      setSellerLocationColumnsForTests(null);
    }
  });

  it('the coupon preview charges the same fee for the cart', async () => {
    const code = 'TSTPKP10';
    await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
    await pool.query(`INSERT INTO coupons (code, discount_type, discount_value, is_active) VALUES ($1, 'FIXED', 10, true)`, [code]);
    try {
      const preview = (items: { product_id: string; quantity: number }[]) =>
        request(app).post('/api/v1/orders/validate-coupon').set(auth(tokens.customer)).send({ code, address_id: fx.addressId, items });
      const seller = await preview([{ product_id: farProduct, quantity: 1 }]);
      expect(seller.status, JSON.stringify(seller.body)).toBe(200);
      expect(seller.body.data.coupon.delivery_fee).toBe(FEE_4_1);
      expect((await preview([{ product_id: blynk, quantity: 1 }])).body.data.coupon.delivery_fee).toBe(FEE_2_3);
    } finally {
      await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = $1)', [code]);
      await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
    }
  });

  it('free delivery still charges 0 and keeps the seller-distance fee as the standard fee', async () => {
    checkoutSettings.read = async () => ({ ...noFree, basket_free_delivery: { enabled: true, min_subtotal_lkr: 1 } });
    const res = await request(app)
      .get(`/api/v1/orders/checkout-info?address_id=${fx.addressId}&subtotal=500&product_ids=${farProduct}`)
      .set(auth(tokens.customer));
    expect(res.body.data).toMatchObject({ delivery_fee_lkr: 0, standard_delivery_fee_lkr: FEE_4_1, delivery_distance_km: 4.1 });
    const order = await fx.placeOrder([{ product_id: farProduct, quantity: 1 }]);
    expect(await orderRow(order.id)).toMatchObject({ fee: 0, standard: FEE_4_1, km: 4.1 });
  });
});

describe('Rider distance pay uses the same distance', () => {
  const deliveryPay = async (id: string) =>
    (
      await pool.query(
        `SELECT rider_distance_km::float AS km, rider_distance_estimated AS estimated, rider_base_earning_lkr::float AS base, rider_pay_inputs
           FROM deliveries WHERE id = $1`,
        [id]
      )
    ).rows[0];

  it('a seller order pays from the seller point; a Blynk order from the store; the rider sees the pickups', async () => {
    const sellerOrder = await fx.placeOrder([
      { product_id: blynk, quantity: 1 },
      { product_id: farProduct, quantity: 1 },
    ]);
    expect((await fx.pack(sellerOrder.id)).status).toBe(200);
    const assigned = await fx.assign(sellerOrder.id, rider.riderId);
    expect(assigned.status).toBe(200);
    const deliveryId = assigned.body.data.delivery.id as string;
    const detail = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(rider.token));
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.delivery.pickups.map((p: { kind: string; shop_name?: string }) => [p.kind, p.shop_name ?? null])).toEqual([
      ['STORE', 'Blynk store'],
      ['SELLER', 'Pickup Far Shop'],
    ]);
    expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' }, rider.token)).status).toBe(200);
    expect((await fx.riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, rider.token)).status).toBe(200);
    expect((await fx.collect(deliveryId, (await fx.orderRow(sellerOrder.id)).total, rider.token)).status).toBe(200);

    const fee = await orderRow(sellerOrder.id);
    const pay = await deliveryPay(deliveryId);
    expect(pay).toMatchObject({ km: fee.km, estimated: false, base: fee.standard });
    expect(pay).toMatchObject({ km: 4.1, base: FEE_4_1 });
    expect(pay.rider_pay_inputs).toMatchObject({ distance_from: { kind: 'SELLER', seller_id: sellers.far, shop_name: 'Pickup Far Shop' } });

    const blynkOrder = await fx.placeOrder([{ product_id: blynk, quantity: 1 }]);
    expect((await fx.pack(blynkOrder.id)).status).toBe(200);
    const blynkDelivery = await fx.deliver(blynkOrder.id, rider);
    const blynkPay = await deliveryPay(blynkDelivery);
    expect(blynkPay).toMatchObject({ km: 2.3, base: FEE_2_3 });
    expect(blynkPay.rider_pay_inputs.distance_from).toBeUndefined();
  }, 60_000);
});
