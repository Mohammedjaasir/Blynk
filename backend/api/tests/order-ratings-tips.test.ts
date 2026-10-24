import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { setRatingsReadyForTests } from '../src/modules/ratings/ratings.ready.js';
import { checkoutRiderTip } from '../src/modules/ratings/ratings.service.js';
import { lowRatingPushBody, ratingInputSchema, shouldAlertLowRating, summarize } from '../src/modules/ratings/ratings.rules.js';
import { dayCash } from '../src/modules/riders/rider.pay-ledger.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Rate the order + tip the rider (owner, 2026-10-24; migration 055). Real
 * local Postgres with 055 applied: the rating rules (own order, delivered,
 * 14 days, 24 h to change), tags, the checkout tip (inside the cash the rider
 * collects, not the items or the fee), the wallet tip after delivery, tips
 * 100% to the delivering rider in earnings and the cash reconciliation, the
 * staff list / summary, the low-rating staff push and the "not ready" guard.
 * Everything made here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RAT-');
const people = customerFixtures(app, { idPrefix: 'c0c00055', phoneBase: '+947095600', name: 'Ratings Tips Customer' });
const DEVICE = `ratings-staff-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const today = DateTime.now().setZone('Asia/Colombo').toISODate()!;

let testStart: Date;
let productId = '';
let product2Id = '';
let rider: { riderId: string; token: string };
let me: Awaited<ReturnType<typeof people.customer>>;
let other: Awaited<ReturnType<typeof people.customer>>;
// A: checkout tip 100 (cash). B: no tip at checkout, wallet tip later. C: rated 4 then 2.
const orders = { A: {} as Record<string, any>, B: {} as Record<string, any>, C: {} as Record<string, any> };

const rating = (orderId: string, token = me.token) => request(app).get(`/api/v1/orders/${orderId}/rating`).set(auth(token));
const rate = (orderId: string, body: object, token = me.token) =>
  request(app).post(`/api/v1/orders/${orderId}/rating`).set(auth(token)).send(body);
const tip = (orderId: string, amount_lkr: unknown, token = me.token) =>
  request(app).post(`/api/v1/orders/${orderId}/tip`).set(auth(token)).send({ amount_lkr });
const money = (v: unknown) => Number(Number(v).toFixed(2));
const lowPushes = (orderId: string) =>
  pool.query(`SELECT recipient, payload, status FROM notifications WHERE notification_type = 'PUSH_LOW_RATING' AND order_id = $1`, [orderId]);

async function deliverOrder(order: Record<string, any>) {
  expect((await fx.pack(order.id)).status).toBe(200);
  await fx.deliver(order.id, rider);
}

beforeAll(async () => {
  setRatingsReadyForTests(null);
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  productId = (await fx.product({ tracked: false })).productId;
  product2Id = (await fx.product({ tracked: false })).productId;
  rider = await fx.tempRider('tips');
  me = await people.customer(1);
  other = await people.customer(2);
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
    users.admin.id,
    DEVICE,
  ]);
}, 60_000);

afterEach(() => {
  setPushSenderForTests(undefined);
  setRatingsReadyForTests(null);
});

afterAll(async () => {
  await pool.query(`DELETE FROM notifications WHERE notification_type IN ('PUSH_LOW_RATING', 'PUSH_NEW_ORDER') AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await people.cleanup();
  await fx.cleanup();
});

describe('rules (pure)', () => {
  it('tags: known only, duplicates count once, opposites refused; stars 1-5 whole; comment <= 500', () => {
    expect(ratingInputSchema.parse({ stars: 2, tags: ['LATE', 'MISSING_ITEM', 'LATE'] }).tags).toEqual(['LATE', 'MISSING_ITEM']);
    expect(ratingInputSchema.parse({ stars: 5 })).toEqual({ stars: 5, tags: [], comment: null });
    expect(ratingInputSchema.parse({ stars: 4, comment: '  ' }).comment).toBeNull();
    expect(ratingInputSchema.safeParse({ stars: 3, tags: ['NOPE'] }).success).toBe(false);
    expect(ratingInputSchema.safeParse({ stars: 3, tags: ['ON_TIME', 'LATE'] }).success).toBe(false);
    expect(ratingInputSchema.safeParse({ stars: 3, tags: ['FRIENDLY_RIDER', 'RUDE_RIDER'] }).success).toBe(false);
    for (const stars of [0, 6, 2.5, '4']) expect(ratingInputSchema.safeParse({ stars }).success).toBe(false);
    expect(ratingInputSchema.safeParse({ stars: 3, comment: 'x'.repeat(501) }).success).toBe(false);
    expect(ratingInputSchema.safeParse({ stars: 3, extra: 1 }).success).toBe(false);
  });

  it('summary maths: average to 2 places, per-star counts, low count, tags by count then name', () => {
    const s = summarize([
      { stars: 5, tags: ['ON_TIME', 'FRESH'] },
      { stars: 1, tags: ['LATE', 'MISSING_ITEM'] },
      { stars: 2, tags: ['LATE'] },
    ]);
    expect(s.count).toBe(3);
    expect(s.average).toBe(2.67);
    expect(s.per_star).toEqual({ '1': 1, '2': 1, '3': 0, '4': 0, '5': 1 });
    expect(s.low_count).toBe(2);
    expect(s.top_tags.map((t) => [t.tag, t.count])).toEqual([
      ['LATE', 2],
      ['FRESH', 1],
      ['MISSING_ITEM', 1],
      ['ON_TIME', 1],
    ]);
    expect(summarize([]).average).toBeNull();
  });

  it('low-rating alert: a new 1-2 star rating, or a change down into it - once', () => {
    expect(shouldAlertLowRating(null, 2)).toBe(true);
    expect(shouldAlertLowRating(null, 3)).toBe(false);
    expect(shouldAlertLowRating(4, 2)).toBe(true);
    expect(shouldAlertLowRating(2, 1)).toBe(false);
    expect(lowRatingPushBody(2, 'BL-1', ['LATE', 'MISSING_ITEM'], null)).toBe('2-star rating on order BL-1: Late, Missing item');
    expect(lowRatingPushBody(1, 'BL-1', [], 'Cold')).toBe('1-star rating on order BL-1: "Cold"');
  });

  it('dayCash: tips are kept from the day cash (cash tips) or owed to the rider (wallet tips)', () => {
    expect(dayCash({ collected: 1000, kept: 0, day_bonuses: 0, adjustments: 0, tips: 100 })).toEqual({ expected_handin: 900, payable_to_rider: 0 });
    expect(dayCash({ collected: 0, kept: 0, day_bonuses: 0, adjustments: 0, tips: 100 })).toEqual({ expected_handin: 0, payable_to_rider: 100 });
    // without tips: unchanged
    expect(dayCash({ collected: 1000, kept: 80, day_bonuses: 200, adjustments: -50 })).toEqual({ expected_handin: 770, payable_to_rider: 0 });
  });
});

describe('tip at checkout', () => {
  it('rider_tip_lkr is 0-1000 whole rupees', async () => {
    for (const bad of [1001, 10.5, -1, '100']) {
      const res = await me.placeOrder([{ product_id: productId, quantity: 1 }], { rider_tip_lkr: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error?.code ?? res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('checkout-info offers 50 / 100 / 200 (custom up to 1000)', async () => {
    const res = await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tips_enabled: true, tip_options: [50, 100, 200], tip_max_lkr: 1000 });
  });

  it('is cash only: refused with online payment', async () => {
    await expect(checkoutRiderTip(me.id, 100, true)).rejects.toMatchObject({ statusCode: 422, code: 'TIP_CASH_ONLY' });
    expect(await checkoutRiderTip(me.id, 100, false)).toBe(100);
    expect(await checkoutRiderTip(me.id, 0, true)).toBe(0);
  });

  it('is part of what the rider collects, not of the items or the delivery fee', async () => {
    orders.A = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { rider_tip_lkr: 100 }));
    const A = orders.A;
    expect(A.rider_tip).toBe(100);
    expect(A.total_amount).toBe(money(A.subtotal_amount + A.delivery_fee - A.discount_amount - A.wallet_amount_used + 100));
    expect(A.payment.amount).toBe(A.total_amount);
    expect(A.items.reduce((n: number, it: any) => n + it.subtotal, 0)).toBe(A.subtotal_amount);
    // the customer's order view and the staff list carry it too
    const mine = await request(app).get(`/api/v1/orders/${A.id}`).set(auth(me.token));
    expect(mine.body.data.order).toMatchObject({ rider_tip: 100, rider_tip_wallet: 0, total_amount: A.total_amount });
    const staff = await request(app).get(`/api/v1/admin/orders/${A.id}`).set(auth(tokens.admin));
    expect(staff.body.data.order).toMatchObject({ rider_tip: 100, rating: null });

    await deliverOrder(A);
    const d = (await pool.query(`SELECT cod_collected_amount::float AS cod FROM deliveries WHERE order_id = $1 AND assignment_status = 'DELIVERED'`, [A.id])).rows[0];
    expect(d.cod).toBe(A.total_amount);
    // the tip went to the rider: a refund to the wallet can never include it
    const wallet = await request(app).get(`/api/v1/admin/orders/${A.id}/wallet`).set(auth(tokens.admin));
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.paid.cash).toBe(money(A.total_amount - 100));
  });

  it('an item removed while packing keeps the tip on top of the new total', async () => {
    const D = await expectCreated(
      await me.placeOrder([{ product_id: productId, quantity: 1 }, { product_id: product2Id, quantity: 1 }], { rider_tip_lkr: 50 })
    );
    const item = D.items.find((it: any) => it.product_id === product2Id);
    const res = await request(app).post(`/api/v1/admin/orders/${D.id}/resolve-item`).set(auth(tokens.staff)).send({ item_id: item.id, item_status: 'UNAVAILABLE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (
      await pool.query(
        `SELECT o.subtotal_amount::float AS sub, o.delivery_fee::float AS fee, o.discount_amount::float AS disc, o.total_amount::float AS total,
                o.rider_tip::float AS tip, p.amount::float AS pay
           FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
        [D.id]
      )
    ).rows[0];
    expect(row.tip).toBe(50);
    expect(row.sub).toBe(money(D.subtotal_amount - item.subtotal));
    expect(row.total).toBe(money(row.sub + row.fee - row.disc + 50));
    expect(row.pay).toBe(row.total);
  });
});

describe('rating', () => {
  it('only once the order is delivered; only by its own customer', async () => {
    orders.B = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    const before = await rating(orders.B.id);
    expect(before.status).toBe(200);
    expect(before.body.data).toMatchObject({ rating: null, can_rate: false, can_edit: false, tip: { can_tip: false, tipped: false } });
    const early = await rate(orders.B.id, { stars: 5 });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('ORDER_NOT_DELIVERED');
    await deliverOrder(orders.B);

    expect((await rating(orders.B.id, other.token)).status).toBe(404);
    const notMine = await rate(orders.B.id, { stars: 5 }, other.token);
    expect(notMine.status).toBe(404);
    expect(notMine.body.error.code).toBe('ORDER_NOT_FOUND');
    expect((await tip(orders.B.id, 50, other.token)).status).toBe(404);
  });

  it('a 2-star rating with tags queues the staff "low rating" push; changing it lower within 24 h does not repeat it', async () => {
    setPushSenderForTests(fake);
    const ready = await rating(orders.B.id);
    expect(ready.body.data).toMatchObject({ can_rate: true, rating: null });
    expect(ready.body.data.tags.map((t: any) => t.tag)).toContain('MISSING_ITEM');

    const bad = await rate(orders.B.id, { stars: 2, tags: ['NOT_A_TAG'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const res = await rate(orders.B.id, { stars: 2, tags: ['LATE', 'MISSING_ITEM', 'LATE'], comment: ' Bread missing ' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.rating).toMatchObject({ stars: 2, tags: ['LATE', 'MISSING_ITEM'], comment: 'Bread missing' });
    expect(res.body.data).toMatchObject({ can_rate: false, can_edit: true });
    const pushes = (await lowPushes(orders.B.id)).rows;
    const mine = pushes.find((p) => p.recipient === users.admin.id);
    expect(mine, JSON.stringify(pushes)).toBeTruthy();
    expect(mine.status).toBe('QUEUED');
    expect(mine.payload).toMatchObject({
      title: '2-star rating',
      body: `2-star rating on order ${orders.B.order_number}: Late, Missing item`,
      data: { type: 'staff_rating', order_id: orders.B.id },
    });
    expect(pushes.some((p) => p.recipient === me.id)).toBe(false);

    const edit = await rate(orders.B.id, { stars: 1, tags: ['MISSING_ITEM'] });
    expect(edit.status).toBe(200);
    expect(edit.body.data.rating).toMatchObject({ stars: 1, tags: ['MISSING_ITEM'], comment: null });
    expect((await lowPushes(orders.B.id)).rows.filter((p) => p.recipient === users.admin.id)).toHaveLength(1);
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_LOW_RATING' AND created_at >= $1`, [testStart]);
  });

  it('a good rating sends nothing; after 24 h it can no longer be changed', async () => {
    setPushSenderForTests(fake);
    const res = await rate(orders.A.id, { stars: 5, tags: ['ON_TIME', 'FRIENDLY_RIDER'] });
    expect(res.status).toBe(201);
    expect((await lowPushes(orders.A.id)).rows).toHaveLength(0);
    await pool.query(`UPDATE order_ratings SET created_at = now() - interval '25 hours' WHERE order_id = $1`, [orders.A.id]);
    const state = await rating(orders.A.id);
    expect(state.body.data).toMatchObject({ can_edit: false, rating: { stars: 5 } });
    const late = await rate(orders.A.id, { stars: 1 });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('RATING_LOCKED');
    expect((await rating(orders.A.id)).body.data.rating.stars).toBe(5);
    // back to today, so the staff list / summary below count it
    await pool.query(`UPDATE order_ratings SET created_at = now() WHERE order_id = $1`, [orders.A.id]);
  });

  it('within 14 days of delivery only (rating and wallet tip)', async () => {
    orders.C = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    await deliverOrder(orders.C);
    await pool.query(`UPDATE orders SET delivered_at = now() - interval '15 days' WHERE id = $1`, [orders.C.id]);
    expect((await rating(orders.C.id)).body.data).toMatchObject({ can_rate: false, tip: { can_tip: false } });
    const r = await rate(orders.C.id, { stars: 4 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('RATING_WINDOW_CLOSED');
    const t = await tip(orders.C.id, 50);
    expect(t.status).toBe(422);
    expect(t.body.error.code).toBe('TIP_WINDOW_CLOSED');
    await pool.query(`UPDATE orders SET delivered_at = now() WHERE id = $1`, [orders.C.id]);
  });

  it('a rating changed down to 2 stars alerts staff', async () => {
    setPushSenderForTests(fake);
    expect((await rate(orders.C.id, { stars: 4 })).status).toBe(201);
    expect((await lowPushes(orders.C.id)).rows).toHaveLength(0);
    expect((await rate(orders.C.id, { stars: 2, tags: ['DAMAGED'] })).status).toBe(200);
    const rows = (await lowPushes(orders.C.id)).rows.filter((p) => p.recipient === users.admin.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.body).toBe(`2-star rating on order ${orders.C.order_number}: Damaged`);
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_LOW_RATING' AND created_at >= $1`, [testStart]);
  });
});

describe('tip from the Blynk Wallet after delivery', () => {
  it('debits the wallet once, only when the balance covers it', async () => {
    await pool.query(`INSERT INTO wallet_entries (customer_id, kind, amount, reason) VALUES ($1, 'ADJUSTMENT', 150, 'Ratings test credit')`, [me.id]);
    const card = await rating(orders.B.id);
    expect(card.body.data.tip).toMatchObject({ can_tip: true, wallet_balance: 150, tip_options: [50, 100, 200], max_lkr: 1000, tipped: false });

    for (const bad of [0, 1001, 20.5]) expect((await tip(orders.B.id, bad)).status).toBe(400);

    const res = await tip(orders.B.id, 100);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.tip).toMatchObject({ rider_tip: 0, rider_tip_wallet: 100, tipped: true, source: 'WALLET', can_tip: false, wallet_balance: 50 });
    const entries = (await pool.query(`SELECT kind, amount::float AS amount FROM wallet_entries WHERE order_id = $1`, [orders.B.id])).rows;
    expect(entries).toEqual([{ kind: 'RIDER_TIP', amount: -100 }]);
    const row = (await pool.query(`SELECT rider_tip_wallet::float AS w, rider_tip_wallet_at, total_amount::float AS total FROM orders WHERE id = $1`, [orders.B.id])).rows[0];
    expect(row.w).toBe(100);
    expect(row.rider_tip_wallet_at).toBeTruthy();
    // not part of what was collected
    expect(row.total).toBe(orders.B.total_amount);

    const again = await tip(orders.B.id, 50);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TIP_ALREADY_GIVEN');
    // a checkout tip counts as the order's tip
    const cash = await tip(orders.A.id, 50);
    expect(cash.status).toBe(409);
    expect(cash.body.error.code).toBe('TIP_ALREADY_GIVEN');
    // 50 left: 200 is refused, nothing written
    const low = await tip(orders.C.id, 200);
    expect(low.status).toBe(409);
    expect(low.body.error.code).toBe('WALLET_LOW');
    expect(low.body.error.details).toMatchObject({ balance: 50, amount: 200 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM wallet_entries WHERE order_id = $1`, [orders.C.id])).rows[0].n).toBe(0);

    // the customer's wallet history says what it was
    const w = await request(app).get('/api/v1/me/wallet').set(auth(me.token));
    expect(w.body.data.balance).toBe(50);
    expect(w.body.data.entries.find((e: any) => e.kind === 'RIDER_TIP')).toMatchObject({
      amount: -100,
      reason: `Tip for your rider on order ${orders.B.order_number}`,
    });
  });

  it('only for delivered orders', async () => {
    const placed = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    const res = await tip(placed.id, 50);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORDER_NOT_DELIVERED');
  });
});

describe('rider earnings and cash', () => {
  it('tips go 100% to the delivering rider, apart from the delivery pay, and lower the cash to hand in', async () => {
    const delivered = (
      await pool.query(
        `SELECT coalesce(sum(cod_collected_amount), 0)::float AS cod, coalesce(sum(rider_earning_lkr), 0)::float AS earned
           FROM deliveries WHERE rider_id = $1 AND assignment_status = 'DELIVERED'`,
        [rider.riderId]
      )
    ).rows[0];
    const expectedCollected = money(orders.A.total_amount + orders.B.total_amount + orders.C.total_amount);
    expect(delivered.cod).toBe(expectedCollected);

    const report = await request(app).get('/api/v1/admin/reports/rider-earnings?range=today').set(auth(tokens.admin));
    expect(report.status).toBe(200);
    const row = report.body.data.riders.find((r: any) => r.rider_id === rider.riderId);
    expect(row, JSON.stringify(report.body.data.riders.map((r: any) => r.rider_id))).toBeTruthy();
    expect(row).toMatchObject({ deliveries: 3, cash_collected: expectedCollected, tips_cash: 100, tips_wallet: 100, tips: 200 });
    // the delivery pay is untouched by tips
    expect(row.rider_share).toBe(delivered.earned);
    expect(row.total_with_tips).toBe(money(row.total_earnings + 200));
    const raw = money(row.cash_collected - row.cash_kept - 200 - row.day_bonuses - row.adjustments);
    expect(row.cash_to_hand_in).toBe(Math.max(0, raw));
    expect(report.body.data.totals.tips).toBeGreaterThanOrEqual(200);

    const recon = await request(app).get(`/api/v1/admin/cash/reconciliation?date=${today}`).set(auth(tokens.admin));
    expect(recon.status).toBe(200);
    const r = recon.body.data.riders.find((x: any) => x.rider_id === rider.riderId);
    expect(r).toMatchObject({ collected: expectedCollected, tips_cash: 100, tips_wallet: 100, expected_handin: row.cash_to_hand_in });
    expect(recon.body.data.totals.tips_cash).toBeGreaterThanOrEqual(100);

    const own = await request(app).get('/api/v1/riders/me/earnings').set(auth(rider.token));
    expect(own.status).toBe(200);
    expect(own.body.data.today).toMatchObject({ tips: 200, tips_cash: 100, tips_wallet: 100, cash_to_hand_in: row.cash_to_hand_in });
    expect(own.body.data.today.earnings).toBe(row.total_earnings);
  });
});

describe('staff ratings', () => {
  it('list: newest first, filtered by stars and rider; staff only', async () => {
    const res = await request(app).get(`/api/v1/admin/ratings?rider_id=${rider.riderId}&stars_max=2`).set(auth(tokens.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = res.body.data.ratings;
    expect(list.map((r: any) => r.order_number)).toEqual([orders.C.order_number, orders.B.order_number]);
    expect(list[1]).toMatchObject({
      stars: 1,
      tags: ['MISSING_ITEM'],
      tag_labels: ['Missing item'],
      customer: { id: me.id, name: me.fullName, phone: me.phone },
      rider: { id: rider.riderId },
      rider_tip_wallet: 100,
    });
    expect(res.body.data.pagination.total).toBe(2);
    const all = await request(app).get(`/api/v1/admin/ratings?rider_id=${rider.riderId}&from=${today}&to=${today}`).set(auth(tokens.admin));
    expect(all.body.data.ratings).toHaveLength(3);
    expect((await request(app).get('/api/v1/admin/ratings').set(auth(me.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/ratings?stars_max=9').set(auth(tokens.admin))).status).toBe(400);
  });

  it('summary: per rider average and count, tips', async () => {
    const res = await request(app).get('/api/v1/admin/ratings/summary?days=1').set(auth(tokens.admin));
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.count).toBeGreaterThanOrEqual(3);
    expect(s.per_star['1'] + s.per_star['2'] + s.per_star['3'] + s.per_star['4'] + s.per_star['5']).toBe(s.count);
    expect(s.per_rider.find((r: any) => r.rider_id === rider.riderId)).toMatchObject({ count: 3, average: 2.67, low_count: 2 });
    expect(s.top_tags.find((t: any) => t.tag === 'DAMAGED')).toBeTruthy();
    expect(s.tips.wallet).toBeGreaterThanOrEqual(100);
    expect(s.tips.cash).toBeGreaterThanOrEqual(100);
    expect((await request(app).get('/api/v1/admin/ratings/summary?days=0').set(auth(tokens.admin))).status).toBe(400);
  });

  it('the staff order detail carries the rating and the tips', async () => {
    const res = await request(app).get(`/api/v1/admin/orders/${orders.B.id}`).set(auth(tokens.admin));
    expect(res.body.data.order).toMatchObject({ rider_tip: 0, rider_tip_wallet: 100, rating: { stars: 1, tags: ['MISSING_ITEM'], rider: { id: rider.riderId } } });
  });
});

describe('before migration 055', () => {
  it('ratings and tips answer 503 RATINGS_NOT_READY, /store says off, a checkout tip is ignored', async () => {
    setRatingsReadyForTests(false);
    for (const res of [
      await rating(orders.A.id),
      await rate(orders.A.id, { stars: 3 }),
      await tip(orders.C.id, 10),
      await request(app).get('/api/v1/admin/ratings').set(auth(tokens.admin)),
      await request(app).get('/api/v1/admin/ratings/summary').set(auth(tokens.admin)),
    ]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('RATINGS_NOT_READY');
    }
    const store = await request(app).get('/api/v1/store');
    expect(store.status).toBe(200);
    expect(store.body.data.ratings_enabled).toBe(false);
    const info = await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token));
    expect(info.body.data).toMatchObject({ tips_enabled: false, tip_options: [], tip_max_lkr: 0 });
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { rider_tip_lkr: 100 }));
    expect(order.rider_tip).toBe(0);
    expect(order.total_amount).toBe(money(order.subtotal_amount + order.delivery_fee - order.discount_amount - order.wallet_amount_used));
    // the staff detail still answers (rating: null), never a 500
    const staff = await request(app).get(`/api/v1/admin/orders/${orders.B.id}`).set(auth(tokens.admin));
    expect(staff.status).toBe(200);
    expect(staff.body.data.order.rating).toBeNull();
    const report = await request(app).get('/api/v1/admin/reports/rider-earnings?range=today').set(auth(tokens.admin));
    expect(report.status).toBe(200);
    expect(report.body.data.riders.find((r: any) => r.rider_id === rider.riderId)).toMatchObject({ tips: 0 });

    setRatingsReadyForTests(null);
    expect((await request(app).get('/api/v1/store')).body.data.ratings_enabled).toBe(true);
  });
});
