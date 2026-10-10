import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  colomboMonthStart,
  generateReferralCode,
  normalizeReferralCode,
  referralBeatsOther,
  referralProgramFrom,
  referralRewardValue,
} from '../src/modules/referrals/referral.rules.js';
import {
  DEFAULT_POINTS_PROGRAM,
  earnBase,
  expiryFor,
  pointsEarned,
  pointsProgramFrom,
  redeemablePoints,
} from '../src/modules/loyalty/points.rules.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Refer a friend and Blynk Points (owner, 2026-10-10; migration 037).
 * Both settings rows are restored afterwards, with the audit rows written.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RWD-');
const people = customerFixtures(app, { idPrefix: 'c0c00037', phoneBase: '+947093700', name: 'Rewards Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = ['referral_program', 'points_program'];
const BIG = 'TSTRWD500';
const SMALL = 'TSTRWD50';

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let productId = '';
let product2Id = '';

const patchReferrals = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/referrals').set(auth(token)).send(body);
const patchPoints = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/points').set(auth(token)).send(body);
const referralOf = async (token: string) => (await request(app).get('/api/v1/me/referral').set(auth(token))).body.data;
const applyCode = (token: string, code: string) => request(app).post('/api/v1/me/referral/apply').set(auth(token)).send({ code });
const checkoutInfo = async (token: string) => (await request(app).get('/api/v1/orders/checkout-info').set(auth(token))).body.data;
const pointsOf = async (token: string) => (await request(app).get('/api/v1/me/points').set(auth(token))).body.data;
const adjust = (customerId: string, body: object, token = tokens.admin) =>
  request(app).post(`/api/v1/admin/customers/${customerId}/points/adjust`).set(auth(token)).send(body);
const cancel = (orderId: string, token: string) => request(app).post(`/api/v1/orders/${orderId}/cancel`).set(auth(token)).send({});
const referralRow = async (friendId: string) => (await pool.query('SELECT * FROM referrals WHERE friend_id = $1', [friendId])).rows[0];
const deliver = async (orderId: string) => {
  expect((await fx.pack(orderId)).status).toBe(200);
  await fx.deliver(orderId);
};
const checkTotals = async (orderId: string) => {
  const o = (await pool.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  const pay = (await pool.query('SELECT amount FROM payments WHERE order_id = $1', [orderId])).rows[0];
  expect(Number(o.total_amount)).toBe(Number((Number(o.subtotal_amount) + Number(o.delivery_fee) - Number(o.discount_amount)).toFixed(2)));
  expect(Number(pay.amount)).toBe(Number(o.total_amount));
  return o;
};

beforeAll(async () => {
  await people.purge(30);
  await pool.query('DELETE FROM coupons WHERE code = ANY($1)', [[BIG, SMALL]]);
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  productId = (await fx.product({ tracked: false })).productId;
  product2Id = (await fx.product({ tracked: false })).productId;
  for (const [code, value] of [
    [BIG, 5000],
    [SMALL, 50],
  ] as const) {
    const res = await request(app)
      .post('/api/v1/admin/coupons')
      .set(auth(tokens.admin))
      .send({ code, discount_type: 'FIXED', discount_value: value, per_customer_limit: 5 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = ANY($1))', [[BIG, SMALL]]);
  await pool.query('DELETE FROM coupons WHERE code = ANY($1)', [[BIG, SMALL]]);
  await pool.query("DELETE FROM audit_logs WHERE entity_type = 'COUPON' AND coalesce(new_values->>'code', old_values->>'code') = ANY($1)", [[BIG, SMALL]]);
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const s of saved) {
    await pool.query(`INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`, [
      s.key,
      JSON.stringify(s.value),
      s.description,
      s.created_at,
      s.updated_at,
    ]);
  }
  await pool.query(
    `DELETE FROM audit_logs WHERE action IN ('REFERRAL_PROGRAM_UPDATED', 'POINTS_PROGRAM_UPDATED', 'POINTS_ADJUSTED') AND created_at >= $1`,
    [testStart]
  );
});

// ----------------------------------------------------------------------------
describe('Rules', () => {
  it('referral rewards: LKR off capped at the items, free delivery = the fee charged, strictly larger wins', () => {
    expect(referralRewardValue('LKR_OFF', 150, 120, 100)).toBe(120);
    expect(referralRewardValue('LKR_OFF', 150, 400, 100)).toBe(150);
    expect(referralRewardValue('FREE_DELIVERY', 0, 400, 100)).toBe(100);
    expect(referralRewardValue('FREE_DELIVERY', 0, 400, 0)).toBe(0);
    expect(referralBeatsOther(150, null)).toBe(true);
    expect(referralBeatsOther(150, 150)).toBe(false);
    expect(referralBeatsOther(150, 149.99)).toBe(true);
    expect(referralBeatsOther(0, null)).toBe(false);
  });

  it('codes: 7 unambiguous characters; typed codes are normalised', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateReferralCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    }
    expect(normalizeReferralCode(' ab-c 12x ')).toBe('ABC12X');
    expect(colomboMonthStart(new Date('2026-10-31T20:00:00Z')).toISOString()).toBe('2026-10-31T18:30:00.000Z'); // 1 Nov Colombo
  });

  it('a stored setting that is missing or damaged reads as the switched-off default', () => {
    expect(referralProgramFrom(undefined)).toEqual({ enabled: false, mode: 'LKR_OFF', friend_amount_lkr: 200, inviter_amount_lkr: 200, monthly_cap: 10 });
    expect(referralProgramFrom({ enabled: 'yes', mode: 'X', monthly_cap: -1 }).enabled).toBe(false);
    expect(pointsProgramFrom(null)).toEqual(DEFAULT_POINTS_PROGRAM);
  });

  it('points: earn per full LKR X, redeem within the minimum and the % cap, never above what is due', () => {
    expect(pointsEarned(599.99, { earn_points: 1, earn_per_lkr: 100 })).toBe(5);
    expect(pointsEarned(600, { earn_points: 2, earn_per_lkr: 100 })).toBe(12);
    expect(pointsEarned(0, { earn_points: 1, earn_per_lkr: 100 })).toBe(0);
    const s = { ...DEFAULT_POINTS_PROGRAM, enabled: true, min_redeem_points: 100, max_redeem_percent: 20, lkr_per_point: 1 };
    expect(redeemablePoints(99, 1000, s)).toBe(0); // below the minimum
    expect(redeemablePoints(500, 1000, s)).toBe(200); // 20% of 1000
    expect(redeemablePoints(150, 1000, s)).toBe(150);
    expect(redeemablePoints(500, 1000, { ...s, enabled: false })).toBe(0);
    expect(redeemablePoints(500, 1000, { ...s, lkr_per_point: 0.5 })).toBe(400); // 400 x 0.5 = LKR 200
    expect(redeemablePoints(5000, 100, { ...s, max_redeem_percent: 100, lkr_per_point: 3 })).toBe(33); // 99 <= 100
    expect(earnBase({ subtotal_amount: 600, discount_amount: 150, points_discount_amount: 100, discountWasDeliveryFee: false })).toBe(450);
    expect(earnBase({ subtotal_amount: 600, discount_amount: 100, points_discount_amount: 0, discountWasDeliveryFee: true })).toBe(600);
    expect(expiryFor(new Date('2026-01-31T00:00:00Z'), 0)).toBeNull();
    expect(expiryFor(new Date('2026-01-15T00:00:00Z'), 12)!.toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

// ----------------------------------------------------------------------------
describe('Program settings', () => {
  it('both default to off; Admin and Operations change them, audited; only the fields sent change', async () => {
    await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
    const r = await request(app).get('/api/v1/admin/settings/referrals').set(auth(opsToken));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ enabled: false, mode: 'LKR_OFF', friend_amount_lkr: 200, inviter_amount_lkr: 200, monthly_cap: 10, updated_at: null });
    const p = await request(app).get('/api/v1/admin/settings/points').set(auth(opsToken));
    expect(p.body.data).toMatchObject({ ...DEFAULT_POINTS_PROGRAM, updated_at: null });

    const a = await patchReferrals({ mode: 'FREE_DELIVERY', monthly_cap: 3 }, opsToken);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data).toMatchObject({ enabled: false, mode: 'FREE_DELIVERY', monthly_cap: 3, friend_amount_lkr: 200 });
    const b = await patchPoints({ earn_per_lkr: 50, lkr_per_point: 0.5 });
    expect(b.body.data).toMatchObject({ enabled: false, earn_per_lkr: 50, lkr_per_point: 0.5, expiry_months: 12 });
    const audit = (
      await pool.query(`SELECT action, new_values FROM audit_logs WHERE action IN ('REFERRAL_PROGRAM_UPDATED', 'POINTS_PROGRAM_UPDATED') AND created_at >= $1 ORDER BY created_at`, [testStart])
    ).rows;
    expect(audit.map((x) => x.action)).toEqual(['REFERRAL_PROGRAM_UPDATED', 'POINTS_PROGRAM_UPDATED']);
    expect(audit[0].new_values).toMatchObject({ key: 'referral_program', mode: 'FREE_DELIVERY', monthly_cap: 3 });
  });

  it('validates the body and the role', async () => {
    expect((await patchReferrals({})).status).toBe(400);
    expect((await patchReferrals({ mode: 'CASH' })).status).toBe(400);
    expect((await patchReferrals({ friend_amount_lkr: -1 })).status).toBe(400);
    expect((await patchReferrals({ friend_amount_lkr: 10.555 })).status).toBe(400);
    expect((await patchReferrals({ monthly_cap: 0 })).status).toBe(400);
    expect((await patchReferrals({ other: 1 })).status).toBe(400);
    expect((await patchPoints({ earn_points: 1.5 })).status).toBe(400);
    expect((await patchPoints({ lkr_per_point: 0 })).status).toBe(400);
    expect((await patchPoints({ max_redeem_percent: 101 })).status).toBe(400);
    expect((await patchPoints({ expiry_months: -1 })).status).toBe(400);
    expect((await patchReferrals({ enabled: true }, tokens.staff)).status).toBe(403);
    expect((await patchPoints({ enabled: true }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/referrals').set(auth(tokens.rider))).status).toBe(403);
  });
});

// ----------------------------------------------------------------------------
describe('Refer a friend', () => {
  let inviter: Awaited<ReturnType<typeof people.customer>>;
  let code = '';

  beforeAll(async () => {
    expect((await patchReferrals({ enabled: false, mode: 'LKR_OFF', friend_amount_lkr: 150, inviter_amount_lkr: 100, monthly_cap: 10 })).status).toBe(200);
    inviter = await people.customer(1);
  });

  it('each customer gets one stable code; codes are refused while the program is off', async () => {
    const first = await referralOf(inviter.token);
    expect(first).toMatchObject({ enabled: false, invited_count: 0, rewarded_count: 0, credits: [], referred_by: null, can_apply_code: false });
    expect(first.code).toMatch(/^[A-Z0-9]{7}$/);
    expect((await referralOf(inviter.token)).code).toBe(first.code);
    code = first.code;
    const friend = await people.customer(2);
    const off = await applyCode(friend.token, code);
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('REFERRALS_DISABLED');
  });

  it("refuses your own code, unknown codes, a second code, and customers who already ordered", async () => {
    expect((await patchReferrals({ enabled: true })).status).toBe(200);
    expect((await applyCode(inviter.token, code)).body.error.code).toBe('REFERRAL_SELF');
    const unknown = await applyCode(inviter.token, 'ZZZZZZZ');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('REFERRAL_CODE_NOT_FOUND');
    expect((await applyCode(inviter.token, 'a!')).status).toBe(400);

    const ordered = await people.customer(3);
    await expectCreated(await ordered.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect((await referralOf(ordered.token)).can_apply_code).toBe(false);
    expect((await applyCode(ordered.token, code)).body.error.code).toBe('REFERRAL_NOT_NEW_CUSTOMER');
  });

  it("the friend's first order gets their reward; delivered, the inviter's next order gets theirs", async () => {
    const friend = await people.customer(2);
    expect((await referralOf(friend.token)).can_apply_code).toBe(true);
    const ok = await applyCode(friend.token, `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toEqual({ status: 'PENDING', inviter_first_name: 'Rewards' });
    expect((await applyCode(friend.token, code)).body.error.code).toBe('REFERRAL_ALREADY_APPLIED');
    expect((await referralOf(friend.token)).referred_by).toEqual({ first_name: 'Rewards', status: 'PENDING' });
    expect((await checkoutInfo(friend.token)).referral_reward).toEqual({ available: true, side: 'FRIEND', mode: 'LKR_OFF', amount_lkr: 150 });

    const order = await expectCreated(await friend.placeOrder([{ product_id: productId, quantity: 3 }]));
    expect(order).toMatchObject({ discount_amount: 150, referral_discount_amount: 150, coupon_code: null, birthday_discount_amount: 0 });
    await checkTotals(order.id);
    // Only the first order.
    expect((await checkoutInfo(friend.token)).referral_reward.available).toBe(false);
    expect((await referralOf(inviter.token)).credits).toEqual([]);

    await deliver(order.id);
    expect(await referralRow(friend.id)).toMatchObject({ status: 'REWARDED', qualifying_order_id: order.id });
    const mine = await referralOf(inviter.token);
    expect(mine).toMatchObject({ invited_count: 1, rewarded_count: 1, credits: [{ side: 'INVITER', mode: 'LKR_OFF', amount_lkr: 100 }] });
    expect((await checkoutInfo(inviter.token)).referral_reward).toEqual({ available: true, side: 'INVITER', mode: 'LKR_OFF', amount_lkr: 100 });

    const used = await expectCreated(await inviter.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(used).toMatchObject({ discount_amount: 100, referral_discount_amount: 100 });
    expect((await referralOf(inviter.token)).credits).toEqual([]);
    const next = await expectCreated(await inviter.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(next.referral_discount_amount).toBe(0);

    // Cancelling the order that used the credit gives it back.
    expect((await cancel(used.id, inviter.token)).status).toBe(200);
    expect((await referralOf(inviter.token)).credits).toHaveLength(1);
    const again = await expectCreated(await inviter.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(again.referral_discount_amount).toBe(100);
  });

  it("cancelling the friend's first order lets their next order take the reward", async () => {
    const friend = await people.customer(4);
    expect((await applyCode(friend.token, code)).status).toBe(201);
    const first = await expectCreated(await friend.placeOrder([{ product_id: productId, quantity: 3 }]));
    expect(first.referral_discount_amount).toBe(150);
    expect((await cancel(first.id, friend.token)).status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS n FROM referral_rewards WHERE customer_id = $1", [friend.id])).rows[0].n).toBe(0);
    const second = await expectCreated(await friend.placeOrder([{ product_id: productId, quantity: 3 }]));
    expect(second.referral_discount_amount).toBe(150);
  });

  it('never stacks with a coupon: the single larger discount wins', async () => {
    const friend = await people.customer(5);
    expect((await applyCode(friend.token, code)).status).toBe(201);
    const items = [{ product_id: productId, quantity: 3 }];
    const big = await request(app).post('/api/v1/orders/validate-coupon').set(auth(friend.token)).send({ code: BIG, items });
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(big.body.data.coupon).toMatchObject({ applied_discount: 'COUPON', referral_discount_amount: 150 });
    const small = await request(app).post('/api/v1/orders/validate-coupon').set(auth(friend.token)).send({ code: SMALL, items });
    expect(small.body.data.coupon).toMatchObject({ applied_discount: 'REFERRAL', discount_amount: 50, referral_discount_amount: 150 });
    expect(small.body.data.coupon.total).toBe(Number((small.body.data.coupon.subtotal + small.body.data.coupon.delivery_fee - 150).toFixed(2)));

    const order = await expectCreated(await friend.placeOrder(items, { coupon_code: SMALL }));
    expect(order).toMatchObject({ coupon_code: null, discount_amount: 150, referral_discount_amount: 150 });
    expect((await pool.query('SELECT count(*)::int AS n FROM coupon_redemptions WHERE order_id = $1', [order.id])).rows[0].n).toBe(0);
  });

  it('a larger coupon wins; the unused friend reward becomes a credit once the first order is delivered', async () => {
    const friend = await people.customer(6);
    expect((await applyCode(friend.token, code)).status).toBe(201);
    const order = await expectCreated(await friend.placeOrder([{ product_id: productId, quantity: 3 }], { coupon_code: BIG }));
    expect(order.coupon_code).toBe(BIG);
    expect(order.referral_discount_amount).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM referral_rewards WHERE customer_id = $1', [friend.id])).rows[0].n).toBe(0);
    await deliver(order.id);
    expect((await referralOf(friend.token)).credits).toEqual([{ side: 'FRIEND', mode: 'LKR_OFF', amount_lkr: 150 }]);
    const next = await expectCreated(await friend.placeOrder([{ product_id: productId, quantity: 3 }]));
    expect(next.referral_discount_amount).toBe(150);
    // Cancelled, a carried-over credit comes back (it is not removed).
    expect((await cancel(next.id, friend.token)).status).toBe(200);
    expect((await referralOf(friend.token)).credits).toHaveLength(1);
  });

  it('FREE_DELIVERY takes the delivery fee off', async () => {
    expect((await patchReferrals({ mode: 'FREE_DELIVERY' })).status).toBe(200);
    const friend = await people.customer(7);
    expect((await applyCode(friend.token, code)).status).toBe(201);
    const order = await expectCreated(await friend.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order.delivery_fee).toBeGreaterThan(0);
    expect(order).toMatchObject({ discount_amount: order.delivery_fee, referral_discount_amount: order.delivery_fee });
    await checkTotals(order.id);
    expect((await patchReferrals({ mode: 'LKR_OFF' })).status).toBe(200);
  });

  it('when the store removes an item, the reward follows the new subtotal', async () => {
    const friend = await people.customer(8);
    expect((await applyCode(friend.token, code)).status).toBe(201);
    const order = await expectCreated(
      await friend.placeOrder([
        { product_id: productId, quantity: 1 },
        { product_id: product2Id, quantity: 3 },
      ])
    );
    expect(order.referral_discount_amount).toBe(150);
    const item = order.items.find((i: { product_id: string }) => i.product_id === product2Id);
    const res = await fx.resolve(order.id, item.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await checkTotals(order.id);
    const subtotal = Number(row.subtotal_amount);
    expect(subtotal).toBeLessThan(150);
    expect(Number(row.referral_discount_amount)).toBe(subtotal);
    expect(Number(row.discount_amount)).toBe(subtotal);
  });

  it('over the monthly cap the referral is CAPPED; with the program off at delivery, NO_REWARD', async () => {
    expect((await patchReferrals({ monthly_cap: 1 })).status).toBe(200); // the inviter already has one this month
    const capped = await people.customer(9);
    expect((await applyCode(capped.token, code)).status).toBe(201);
    const o1 = await expectCreated(await capped.placeOrder([{ product_id: productId, quantity: 2 }]));
    await deliver(o1.id);
    expect((await referralRow(capped.id)).status).toBe('CAPPED');

    expect((await patchReferrals({ monthly_cap: 10 })).status).toBe(200);
    const off = await people.customer(10);
    expect((await applyCode(off.token, code)).status).toBe(201);
    const o2 = await expectCreated(await off.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect((await patchReferrals({ enabled: false })).status).toBe(200);
    await deliver(o2.id);
    expect((await referralRow(off.id)).status).toBe('NO_REWARD');
    // Only friend 6's delivery (before the cap) left the inviter a credit.
    expect((await referralOf(inviter.token)).credits).toHaveLength(1);
    expect((await referralOf(off.token)).credits).toEqual([]);
    expect((await patchReferrals({ enabled: true })).status).toBe(200);
  });

  it('Admin/Operations see who invited whom, the status and the rewards', async () => {
    const res = await request(app).get('/api/v1/admin/referrals?limit=100').set(auth(opsToken));
    expect(res.status).toBe(200);
    const mine = res.body.data.referrals.filter((r: { inviter: { id: string } }) => r.inviter.id === inviter.id);
    expect(mine.length).toBe(8);
    const first = mine.find((r: { friend: { id: string } }) => r.friend.id === 'c0c00037-0000-0000-0000-000000000002');
    expect(first).toMatchObject({ status: 'REWARDED', code });
    expect(first.friend_reward).toMatchObject({ mode: 'LKR_OFF', discount_amount: 150, used: true });
    expect(first.inviter_reward).toMatchObject({ mode: 'LKR_OFF', amount_lkr: 100, used: true });
    expect(res.body.data.summary.REWARDED).toBeGreaterThanOrEqual(1);
    const filtered = await request(app).get('/api/v1/admin/referrals?status=CAPPED').set(auth(tokens.admin));
    expect(filtered.body.data.referrals.every((r: { status: string }) => r.status === 'CAPPED')).toBe(true);
    expect((await request(app).get('/api/v1/admin/referrals?status=NOPE').set(auth(tokens.admin))).status).toBe(400);
  });
});

// ----------------------------------------------------------------------------
describe('Blynk Points', () => {
  beforeAll(async () => {
    expect((await patchReferrals({ enabled: false })).status).toBe(200);
    expect(
      (
        await patchPoints({
          enabled: false,
          earn_points: 1,
          earn_per_lkr: 100,
          lkr_per_point: 1,
          min_redeem_points: 10,
          max_redeem_percent: 50,
          expiry_months: 12,
        })
      ).status
    ).toBe(200);
  });

  it('switched off: no balance shown, nothing earned', async () => {
    const me = await people.customer(20);
    expect(await pointsOf(me.token)).toMatchObject({ enabled: false, balance: 0, value_lkr: 0, history: [] });
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 5 }]));
    await deliver(order.id);
    expect((await pointsOf(me.token)).balance).toBe(0);
    expect((await checkoutInfo(me.token)).points).toMatchObject({ enabled: false, balance: 0 });
  });

  it('earns on delivered orders, redeems at checkout, gives back on cancel', async () => {
    expect((await patchPoints({ enabled: true })).status).toBe(200);
    const me = await people.customer(21);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 5 }]));
    await deliver(order.id);
    const earned = Math.floor(order.subtotal_amount / 100);
    expect(earned).toBeGreaterThan(0);
    const after = await pointsOf(me.token);
    expect(after).toMatchObject({ enabled: true, balance: earned, value_lkr: earned });
    expect(after.history[0]).toMatchObject({ kind: 'EARN', points: earned, order_number: order.order_number });
    expect(after.history[0].expires_at).not.toBeNull();

    // A staff top-up so the minimum is met; audited with the reason.
    const top = await adjust(me.id, { points: 100, reason: 'Apology for a late delivery' }, opsToken);
    expect(top.status, JSON.stringify(top.body)).toBe(200);
    expect(top.body.data.balance).toBe(earned + 100);
    expect(top.body.data.history[0]).toMatchObject({ kind: 'ADJUST', points: 100, reason: 'Apology for a late delivery' });
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'POINTS_ADJUSTED' AND entity_id = $1`, [me.id])).rows;
    expect(audit[0].new_values).toMatchObject({ points: 100, balance: earned + 100 });
    expect((await pointsOf(me.token)).history[0]).not.toHaveProperty('reason');

    const info = await checkoutInfo(me.token);
    expect(info.points).toMatchObject({ enabled: true, balance: earned + 100, lkr_per_point: 1, min_redeem_points: 10, max_redeem_percent: 50, earn_per_lkr: 100 });

    const plain = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_points: false }));
    expect(plain.points_discount_amount).toBe(0);

    const paid = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_points: true }));
    const due = paid.subtotal_amount + paid.delivery_fee;
    const expectedPoints = Math.min(earned + 100, Math.floor(due * 0.5));
    expect(paid).toMatchObject({ points_redeemed: expectedPoints, points_discount_amount: expectedPoints, discount_amount: expectedPoints });
    await checkTotals(paid.id);
    expect((await pointsOf(me.token)).balance).toBe(earned + 100 - expectedPoints);

    expect((await cancel(paid.id, me.token)).status).toBe(200);
    const back = await pointsOf(me.token);
    expect(back.balance).toBe(earned + 100);
    expect(back.history[0]).toMatchObject({ kind: 'REFUND', points: expectedPoints });
  });

  it('combines with a coupon (applied after it) and the paid-with-points part earns nothing', async () => {
    const me = await people.customer(22);
    expect((await adjust(me.id, { points: 50, reason: 'Welcome points' })).status).toBe(200);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 5 }], { coupon_code: SMALL, use_points: true }));
    expect(order.coupon_code).toBe(SMALL);
    expect(order.points_redeemed).toBe(50);
    expect(order.discount_amount).toBe(100);
    await checkTotals(order.id);
    await deliver(order.id);
    const earned = Math.floor((order.subtotal_amount - 50 - 50) / 100);
    const pts = await pointsOf(me.token);
    expect(pts.balance).toBe(earned);
    expect(pts.history[0]).toMatchObject({ kind: 'EARN', points: earned });
  });

  it('below the minimum nothing is used; staff cannot take the balance below 0', async () => {
    const me = await people.customer(23);
    expect((await adjust(me.id, { points: 5, reason: 'Small gift' })).status).toBe(200);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_points: true }));
    expect(order.points_redeemed).toBe(0);
    const tooMuch = await adjust(me.id, { points: -6, reason: 'Correction' });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.code).toBe('POINTS_INSUFFICIENT');
    const ok = await adjust(me.id, { points: -5, reason: 'Correction' });
    expect(ok.body.data.balance).toBe(0);
    expect((await adjust(me.id, { points: 5 })).status).toBe(400);
    expect((await adjust(me.id, { points: 0, reason: 'Nothing' })).status).toBe(400);
    expect((await adjust(me.id, { points: 5, reason: 'x' }, tokens.staff)).status).toBe(403);
    expect((await adjust('00000000-0000-4000-8000-000000000000', { points: 5, reason: 'Nobody' })).status).toBe(404);
  });

  it('expired points leave the balance and are written off', async () => {
    const me = await people.customer(24);
    expect((await adjust(me.id, { points: 40, reason: 'Old gift' })).status).toBe(200);
    await pool.query(`UPDATE points_ledger SET expires_at = now() - interval '1 day' WHERE customer_id = $1`, [me.id]);
    const pts = await pointsOf(me.token);
    expect(pts.balance).toBe(0);
    expect(pts.history[0]).toMatchObject({ kind: 'EXPIRE', points: -40 });
  });

  it('when the store removes an item, points never pay more than is due; the surplus comes back', async () => {
    expect((await patchPoints({ max_redeem_percent: 100 })).status).toBe(200);
    const me = await people.customer(25);
    expect((await adjust(me.id, { points: 5000, reason: 'Big gift' })).status).toBe(200);
    const order = await expectCreated(
      await me.placeOrder(
        [
          { product_id: productId, quantity: 1 },
          { product_id: product2Id, quantity: 3 },
        ],
        { use_points: true }
      )
    );
    const due = order.subtotal_amount + order.delivery_fee;
    expect(order.points_redeemed).toBe(Math.floor(due));
    expect(order.total_amount).toBe(Number((due - Math.floor(due)).toFixed(2)));
    const item = order.items.find((i: { product_id: string }) => i.product_id === product2Id);
    expect((await fx.resolve(order.id, item.id)).status).toBe(200);
    const row = await checkTotals(order.id);
    const newDue = Number(row.subtotal_amount) + Number(row.delivery_fee);
    expect(row.points_redeemed).toBe(Math.floor(newDue));
    expect((await pointsOf(me.token)).balance).toBe(5000 - Math.floor(newDue));

    const admin = await request(app).get(`/api/v1/admin/customers/${me.id}/points`).set(auth(tokens.admin));
    expect(admin.status).toBe(200);
    expect(admin.body.data.balance).toBe(5000 - Math.floor(newDue));
    expect(admin.body.data.history.map((h: { kind: string }) => h.kind)).toEqual(['ADJUST', 'REDEEM', 'ADJUST']);
  });
});
