import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings } from '../src/modules/configuration/settings.service.js';
import {
  basePay,
  boostAmount,
  deliveryBonuses,
  DEFAULT_BONUS_RULES,
  DEFAULT_RAIN_BOOST,
  effectivePayParams,
  inPeakWindow,
  payDistance,
  rainActive,
  type PayParams,
} from '../src/modules/riders/rider.pay-rules.js';
import { dayCash } from '../src/modules/riders/rider.pay-ledger.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Rider pay controls (migration 038; owner, 2026-10-10): pay models
 * (PERCENT / FIXED / DISTANCE + minimum), bonuses (peak and rain boost, daily
 * target, long distance), staff adjustments, and how they reach the earnings
 * report, the rider's own earnings and the cash reconciliation. OSRM is
 * mocked (payDistance.roadMetres); every settings row is restored.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-PCT-');
const opsToken = generateAccessToken({ id: users.admin.id, phone: users.admin.phone, role: 'OPERATIONS' });
const today = DateTime.now().setZone('Asia/Colombo').toISODate()!;
const yesterday = DateTime.now().setZone('Asia/Colombo').minus({ days: 1 }).toISODate()!;
const startedAt = new Date();

const KEYS = ['rider_commission', 'rider_pay_model', 'rider_bonus_rules', 'rider_rain_boost'];
let savedRows: { key: string; value: unknown; description: string | null }[] = [];
const pinnedCheckout = checkoutSettings.read;
const realRoad = payDistance.roadMetres;
let roadCalls = 0;
let productId = '';
let fixedRider: { riderId: string; token: string };
let distRider: { riderId: string; token: string };
let companyRider: { riderId: string; token: string };

const settings = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/rider-pay').set(auth(token));
const patch = (path: string, body: object, token = tokens.admin) =>
  request(app).patch(`/api/v1/admin/settings/rider-pay${path}`).set(auth(token)).send(body);
const setPay = (riderId: string, body: object, token = tokens.admin) =>
  request(app).patch(`/api/v1/admin/riders/${riderId}/pay`).set(auth(token)).send(body);
const addAdj = (riderId: string, body: object, token = tokens.admin) =>
  request(app).post(`/api/v1/admin/riders/${riderId}/adjustments`).set(auth(token)).send(body);
const report = (qs = 'range=today') => request(app).get(`/api/v1/admin/reports/rider-earnings?${qs}`).set(auth(tokens.admin));
const recon = (date = today) => request(app).get(`/api/v1/admin/cash/reconciliation?date=${date}`).set(auth(tokens.admin));
const row = (res: request.Response, riderId: string) => res.body.data.riders.find((r: { rider_id: string }) => r.rider_id === riderId);
const delivery = async (id: string) =>
  (
    await pool.query(
      `SELECT rider_pay_type, rider_pay_model, rider_pay_inputs, rider_distance_km::float AS km, rider_distance_estimated AS estimated,
              rider_base_earning_lkr::float AS base, rider_bonus_lkr::float AS bonus, rider_earning_lkr::float AS earning,
              rider_commission_percent::float AS pct, cod_collected_amount::float AS cod
         FROM deliveries WHERE id = $1`,
      [id]
    )
  ).rows[0];
const lines = async (riderId: string) =>
  (
    await pool.query(
      'SELECT kind, delivery_id, amount_lkr::float AS amount, detail FROM rider_earning_lines WHERE rider_id = $1 ORDER BY created_at, kind',
      [riderId]
    )
  ).rows;

async function deliveredOrder(rider: { riderId: string; token: string }) {
  const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
  expect((await fx.pack(order.id)).status).toBe(200);
  const deliveryId = await fx.deliver(order.id, rider);
  return { orderId: order.id, deliveryId };
}

const allDayPeak = { enabled: true, mode: 'FIXED', amount: 25, windows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '24:00' }] };
const peakOff = { ...allDayPeak, enabled: false };

beforeAll(async () => {
  savedRows = (await pool.query('SELECT key, value, description FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  checkoutSettings.read = async () => ({
    coupons_enabled: true,
    new_customer_free_deliveries: { enabled: false, count: 0, since: startedAt.toISOString() },
    show_offer_savings: false,
  });
  // OSRM mocked: 7.25 km of road unless a test makes it fail.
  payDistance.roadMetres = async () => {
    roadCalls += 1;
    return 7250;
  };
  await fx.setup();
  productId = (await fx.product({ tracked: false })).productId;
  fixedRider = await fx.tempRider('pct-fixed');
  distRider = await fx.tempRider('pct-distance');
  companyRider = await fx.tempRider('pct-company');
}, 60_000);

afterAll(async () => {
  checkoutSettings.read = pinnedCheckout;
  payDistance.roadMetres = realRoad;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of savedRows) {
    await pool.query('INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, $3)', [r.key, JSON.stringify(r.value), r.description]);
  }
  const riderIds = [fixedRider?.riderId, distRider?.riderId, companyRider?.riderId].filter(Boolean);
  await pool.query('DELETE FROM cash_handins WHERE rider_id = ANY($1::uuid[])', [riderIds]);
  await pool.query(
    `DELETE FROM audit_logs WHERE created_at >= $1 AND (
       action IN ('RIDER_PAY_MODEL_UPDATED', 'RIDER_BONUS_RULES_UPDATED', 'RAIN_BOOST_UPDATED', 'RIDER_COMMISSION_UPDATED')
       OR entity_type = 'RIDER_PAY_ADJUSTMENT' OR entity_id = ANY($2::uuid[]))`,
    [startedAt, riderIds]
  );
  await fx.cleanup(); // riders go, and with them their bonus lines and adjustments (ON DELETE CASCADE)
});

describe('The pure rules', () => {
  const p = (over: Partial<PayParams>): PayParams => ({
    model: 'PERCENT',
    percent: 80,
    fixed_lkr: 80,
    base_lkr: 50,
    per_km_lkr: 20,
    min_lkr: null,
    distance_mode: 'LINEAR',
    km_tiers: [],
    ...over,
  });

  it('base pay per model, with the floor', () => {
    expect(basePay(p({}), { standardFee: 120, distanceKm: null })).toBe(96);
    expect(basePay(p({ model: 'FIXED', fixed_lkr: 75 }), { standardFee: 120, distanceKm: null })).toBe(75);
    expect(basePay(p({ model: 'DISTANCE' }), { standardFee: 120, distanceKm: 3.4 })).toBe(118);
    expect(basePay(p({ model: 'DISTANCE' }), { standardFee: 120, distanceKm: null })).toBe(50);
    expect(basePay(p({ percent: 10, min_lkr: 60 }), { standardFee: 100, distanceKm: null })).toBe(60);
    expect(basePay(p({ model: 'FIXED', fixed_lkr: 90, min_lkr: 60 }), { standardFee: 0, distanceKm: null })).toBe(90);
  });

  it('boosts, peak windows (Colombo, end exclusive) and the rain auto-off', () => {
    expect(boostAmount('FIXED', 30, 80)).toBe(30);
    expect(boostAmount('PERCENT', 10, 85)).toBe(8.5);
    // 2026-10-12 is a Monday; 17:30 Colombo = 12:00 UTC.
    const mon1730 = new Date('2026-10-12T12:00:00Z');
    expect(inPeakWindow([{ days: [1], start: '17:00', end: '20:00' }], mon1730)).toBe(true);
    expect(inPeakWindow([{ days: [2], start: '17:00', end: '20:00' }], mon1730)).toBe(false);
    expect(inPeakWindow([{ days: [1], start: '12:00', end: '17:30' }], mon1730)).toBe(false);
    const on = { ...DEFAULT_RAIN_BOOST, on: true, auto_off_at: '2026-10-12T13:00:00Z' };
    expect(rainActive(on, mon1730)).toBe(true);
    expect(rainActive(on, new Date('2026-10-12T13:00:00Z'))).toBe(false);
    expect(rainActive({ ...on, auto_off_at: null }, mon1730)).toBe(true);
    expect(rainActive(DEFAULT_RAIN_BOOST, mon1730)).toBe(false);
  });

  it('per-delivery bonuses stack, and zero amounts are left out', () => {
    const rules = {
      ...DEFAULT_BONUS_RULES,
      peak: { enabled: true, mode: 'PERCENT' as const, amount: 10, windows: [{ days: [1], start: '17:00', end: '20:00' }] },
      long_distance: { enabled: true, over_km: 5, amount_lkr: 40 },
    };
    const rain = { ...DEFAULT_RAIN_BOOST, on: true, amount: 30 };
    const at = new Date('2026-10-12T12:00:00Z');
    expect(deliveryBonuses(rules, rain, { base: 80, distanceKm: 6, at }).map((l) => [l.kind, l.amount])).toEqual([
      ['PEAK_BOOST', 8],
      ['RAIN_BOOST', 30],
      ['LONG_DISTANCE', 40],
    ]);
    // A company rider's base is 0: a percentage boost gives nothing.
    expect(deliveryBonuses(rules, { ...rain, on: false }, { base: 0, distanceKm: 2, at })).toEqual([]);
  });

  it('the day cash rule: hand in what is left, owe the rider the rest', () => {
    expect(dayCash({ collected: 1000, kept: 80, day_bonuses: 200, adjustments: -50 })).toEqual({ expected_handin: 770, payable_to_rider: 0 });
    expect(dayCash({ collected: 0, kept: 0, day_bonuses: 0, adjustments: -300 })).toEqual({ expected_handin: 300, payable_to_rider: 0 });
    expect(dayCash({ collected: 100, kept: 80, day_bonuses: 200, adjustments: 0 })).toEqual({ expected_handin: 0, payable_to_rider: 180 });
  });
});

describe('Store-wide rider pay settings', () => {
  it('defaults until set', async () => {
    const res = await settings(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      // distance_mode / km_tiers: per-km tiers (migration 040; owner, 2026-10-10).
      default_model: { model: 'PERCENT', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null, distance_mode: 'LINEAR', km_tiers: [] },
      bonus_rules: DEFAULT_BONUS_RULES,
      rain_boost: { ...DEFAULT_RAIN_BOOST, active: false },
    });
  });

  it('Operations changes the default model (the % is the rider commission row); audited', async () => {
    const res = await patch('/model', { model: 'FIXED', fixed_lkr: 70, percent: 75, min_lkr: 40 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.default_model).toEqual({
      model: 'FIXED',
      percent: 75,
      fixed_lkr: 70,
      base_lkr: 50,
      per_km_lkr: 20,
      min_lkr: 40,
      distance_mode: 'LINEAR',
      km_tiers: [],
    });
    const commission = await request(app).get('/api/v1/admin/settings/rider-commission').set(auth(tokens.admin));
    expect(commission.body.data.default_percent).toBe(75);
    const audit = (
      await pool.query(
        "SELECT old_values, new_values FROM audit_logs WHERE action = 'RIDER_PAY_MODEL_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1",
        [startedAt]
      )
    ).rows[0];
    expect(audit.old_values).toMatchObject({ key: 'rider_pay_model', model: 'PERCENT', percent: 80 });
    expect(audit.new_values).toMatchObject({ key: 'rider_pay_model', model: 'FIXED', fixed_lkr: 70, min_lkr: 40 });
    // Omitted numbers are kept; min_lkr null removes the floor.
    const again = await patch('/model', { model: 'FIXED', min_lkr: null });
    expect(again.body.data.default_model).toMatchObject({ model: 'FIXED', fixed_lkr: 70, percent: 75, min_lkr: null });
  });

  it('bonus rules section by section; tiers sorted; audited', async () => {
    const res = await patch('/bonuses', {
      daily_target: { enabled: true, tiers: [{ deliveries: 3, amount_lkr: 150 }, { deliveries: 2, amount_lkr: 100 }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.bonus_rules.daily_target).toEqual({ enabled: true, tiers: [{ deliveries: 2, amount_lkr: 100 }, { deliveries: 3, amount_lkr: 150 }] });
    expect(res.body.data.bonus_rules.peak).toEqual(DEFAULT_BONUS_RULES.peak);
    const audit = (
      await pool.query("SELECT new_values FROM audit_logs WHERE action = 'RIDER_BONUS_RULES_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1", [startedAt])
    ).rows[0];
    expect(audit.new_values.daily_target.enabled).toBe(true);
  });

  it('the rain boost switch: on with auto-off, active, then off clears it; audited', async () => {
    const until = new Date(Date.now() + 2 * 3600_000).toISOString();
    const res = await patch('/rain-boost', { on: true, amount: 30, mode: 'FIXED', auto_off_at: until }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.rain_boost).toMatchObject({ on: true, amount: 30, auto_off_at: until, active: true });
    expect(res.body.data.rain_boost.turned_on_at).toBeTruthy();
    const off = await patch('/rain-boost', { on: false });
    expect(off.body.data.rain_boost).toMatchObject({ on: false, auto_off_at: null, turned_on_at: null, active: false });
    const n = (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'RAIN_BOOST_UPDATED' AND created_at >= $1", [startedAt])).rows[0].n;
    expect(n).toBe(2);
  });

  it('validates and is for ADMIN and OPERATIONS only', async () => {
    const bad: [string, object][] = [
      ['/model', {}],
      ['/model', { model: 'HOURLY' }],
      ['/model', { model: 'FIXED', fixed_lkr: -1 }],
      ['/model', { model: 'FIXED', fixed_lkr: 1.234 }],
      ['/model', { model: 'PERCENT', percent: 101 }],
      ['/model', { model: 'FIXED', extra: 1 }],
      ['/bonuses', {}],
      ['/bonuses', { peak: { enabled: true, mode: 'FIXED', amount: 30, windows: [] } }],
      ['/bonuses', { peak: { enabled: true, mode: 'FIXED', amount: 30, windows: [{ days: [1], start: '20:00', end: '17:00' }] } }],
      ['/bonuses', { peak: { enabled: true, mode: 'FIXED', amount: 30, windows: [{ days: [8], start: '17:00', end: '20:00' }] } }],
      ['/bonuses', { peak: { enabled: true, mode: 'PERCENT', amount: 150, windows: [{ days: [1], start: '17:00', end: '20:00' }] } }],
      ['/bonuses', { daily_target: { enabled: true, tiers: [] } }],
      ['/bonuses', { daily_target: { enabled: true, tiers: [{ deliveries: 2, amount_lkr: 1 }, { deliveries: 2, amount_lkr: 5 }] } }],
      ['/bonuses', { long_distance: { enabled: true, over_km: 0, amount_lkr: 50 } }],
      ['/rain-boost', {}],
      ['/rain-boost', { on: true, auto_off_at: new Date(Date.now() - 60_000).toISOString() }],
      ['/rain-boost', { on: true, auto_off_at: new Date(Date.now() + 8 * 86_400_000).toISOString() }],
      ['/rain-boost', { on: true, mode: 'PERCENT', amount: 150 }],
    ];
    for (const [path, body] of bad) expect((await patch(path, body)).status, `${path} ${JSON.stringify(body)}`).toBe(400);
    for (const t of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await settings(t)).status).toBe(403);
      expect((await patch('/rain-boost', { on: true }, t)).status).toBe(403);
    }
    expect((await settings()).body.data.rain_boost.on).toBe(false);
  });
});

describe("A rider's own pay model", () => {
  it('FIXED and DISTANCE with own numbers; store default; COMPANY clears; audited', async () => {
    let res = await setPay(fixedRider.riderId, { pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: 90 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.pay).toMatchObject({
      pay_type: 'COMMISSION',
      pay_model: 'FIXED',
      own: { fixed_lkr: 90, base_lkr: null, per_km_lkr: null, min_lkr: null },
      effective: { model: 'FIXED', fixed_lkr: 90, percent: 75 },
    });
    res = await setPay(distRider.riderId, { pay_type: 'COMMISSION', pay_model: 'DISTANCE', base_lkr: 40, per_km_lkr: 10, min_lkr: 100, fixed_lkr: 999 });
    expect(res.body.data.pay).toMatchObject({
      pay_model: 'DISTANCE',
      own: { fixed_lkr: null, base_lkr: 40, per_km_lkr: 10, min_lkr: 100 },
      effective: { model: 'DISTANCE', base_lkr: 40, per_km_lkr: 10, min_lkr: 100 },
    });
    const audit = (
      await pool.query("SELECT new_values FROM audit_logs WHERE action = 'RIDER_PAY_UPDATED' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1", [distRider.riderId])
    ).rows[0];
    expect(audit.new_values).toEqual({ pay_type: 'COMMISSION', commission_percent: null, pay_model: 'DISTANCE', fixed_lkr: null, base_lkr: 40, per_km_lkr: 10, min_lkr: 100 });

    // Store default: the default model (FIXED 70) with its numbers.
    res = await setPay(companyRider.riderId, { pay_type: 'COMMISSION', pay_model: null });
    expect(res.body.data.pay).toMatchObject({ pay_model: null, effective: { model: 'FIXED', fixed_lkr: 70 } });
    res = await setPay(companyRider.riderId, { pay_type: 'COMPANY', pay_model: 'FIXED', fixed_lkr: 50 });
    expect(res.body.data.pay).toMatchObject({ pay_type: 'COMPANY', pay_model: null, own: { fixed_lkr: null }, effective: null });

    const list = await request(app).get('/api/v1/admin/riders').set(auth(opsToken));
    expect(list.body.data.riders.find((r: { id: string }) => r.id === fixedRider.riderId)).toMatchObject({ pay_type: 'COMMISSION', pay_model: 'FIXED' });
  });

  it('validates the model fields', async () => {
    for (const body of [
      { pay_type: 'COMMISSION', pay_model: 'HOURLY' },
      { pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: -5 },
      { pay_type: 'COMMISSION', pay_model: 'DISTANCE', per_km_lkr: 5000 },
      { pay_type: 'COMMISSION', min_lkr: 'x' },
    ]) {
      expect((await setPay(fixedRider.riderId, body)).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('Settlement: snapshot, bonuses, daily target', () => {
  let fixed1: { orderId: string; deliveryId: string };
  let fixed2: { orderId: string; deliveryId: string };
  let fixed3: { orderId: string; deliveryId: string };
  let dist1: { orderId: string; deliveryId: string };
  let dist2: { orderId: string; deliveryId: string };
  let company1: { orderId: string; deliveryId: string };

  beforeAll(async () => {
    // fixed rider, delivery 1: plain FIXED 90.
    fixed1 = await deliveredOrder(fixedRider);
    // Then the peak boost (all day, +25) and the rain boost (+10%) go on, and long distance (> 5 km, +40).
    expect((await patch('/bonuses', { peak: allDayPeak, long_distance: { enabled: true, over_km: 5, amount_lkr: 40 } })).status).toBe(200);
    expect((await patch('/rain-boost', { on: true, mode: 'PERCENT', amount: 10 })).status).toBe(200);
    fixed2 = await deliveredOrder(fixedRider); // reaches the 2-delivery target
    // DISTANCE rider, OSRM answering 7.25 km.
    dist1 = await deliveredOrder(distRider);
    // OSRM down: straight line x 1.3, estimated (the test address is ~0.5 km away -> no long-distance bonus).
    payDistance.roadMetres = async () => {
      roadCalls += 1;
      throw new Error('OSRM down');
    };
    dist2 = await deliveredOrder(distRider);
    payDistance.roadMetres = async () => 7250;
    // A COMPANY rider (bonuses for company riders off): nothing.
    company1 = await deliveredOrder(companyRider);
    // Everything off again, then the third delivery reaches the 3-delivery tier.
    expect((await patch('/bonuses', { peak: peakOff, long_distance: { enabled: false, over_km: 5, amount_lkr: 40 } })).status).toBe(200);
    expect((await patch('/rain-boost', { on: false })).status).toBe(200);
    fixed3 = await deliveredOrder(fixedRider);
  }, 120_000);

  it('FIXED: base, no distance measured without a need for it', async () => {
    expect(await delivery(fixed1.deliveryId)).toMatchObject({
      rider_pay_type: 'COMMISSION',
      rider_pay_model: 'FIXED',
      rider_pay_inputs: { model: 'FIXED', fixed_lkr: 90, min_lkr: null },
      km: null,
      estimated: null,
      base: 90,
      bonus: 0,
      earning: 90,
      pct: null,
    });
  });

  it('peak + rain (+10% of base) + long distance stack into the delivery earning, each a line', async () => {
    const d = await delivery(fixed2.deliveryId);
    expect(d).toMatchObject({ rider_pay_model: 'FIXED', km: 7.25, estimated: false, base: 90, bonus: 25 + 9 + 40, earning: 90 + 74 });
    const mine = (await lines(fixedRider.riderId)).filter((l) => l.delivery_id === fixed2.deliveryId);
    expect(mine.map((l) => [l.kind, l.amount]).sort()).toEqual([
      ['LONG_DISTANCE', 40],
      ['PEAK_BOOST', 25],
      ['RAIN_BOOST', 9],
    ]);
  });

  it('DISTANCE: base + per km by road, the floor, and the straight-line estimate when OSRM is down', async () => {
    // 40 + 10 x 7.25 = 112.5 (floor 100 not needed) + peak 25 + rain 11.25 + long distance 40
    expect(await delivery(dist1.deliveryId)).toMatchObject({
      rider_pay_model: 'DISTANCE',
      rider_pay_inputs: { model: 'DISTANCE', base_lkr: 40, per_km_lkr: 10, min_lkr: 100 },
      km: 7.25,
      estimated: false,
      base: 112.5,
      bonus: 76.25,
      earning: 188.75,
    });
    const d2 = await delivery(dist2.deliveryId);
    expect(d2.estimated).toBe(true);
    expect(d2.km).toBeGreaterThan(0);
    expect(d2.km).toBeLessThan(5);
    // 40 + 10 x ~0.6 km is under the floor: 100; peak 25 + rain 10.
    expect(d2).toMatchObject({ base: 100, bonus: 35, earning: 135 });
  });

  it('a COMPANY rider earns nothing unless company riders get bonuses', async () => {
    expect(await delivery(company1.deliveryId)).toMatchObject({ rider_pay_type: 'COMPANY', rider_pay_model: null, base: 0, bonus: 0, earning: 0, km: null });
    expect(await lines(companyRider.riderId)).toEqual([]);
  });

  it('daily target: each tier once, when reached (2 -> +100, 3 -> +150)', async () => {
    const daily = (await lines(fixedRider.riderId)).filter((l) => l.kind === 'DAILY_TARGET');
    expect(daily.map((l) => [l.amount, l.detail.deliveries, l.delivery_id])).toEqual([
      [100, 2, null],
      [150, 3, null],
    ]);
    expect(await delivery(fixed3.deliveryId)).toMatchObject({ base: 90, bonus: 0, earning: 90 });
    // The distance rider has 2 deliveries too: tier 2 paid.
    expect((await lines(distRider.riderId)).filter((l) => l.kind === 'DAILY_TARGET').map((l) => l.amount)).toEqual([100]);
  });

  describe('Adjustments', () => {
    let adjId = '';

    it('staff add a deduction or extra pay with a reason, to any rider; audited', async () => {
      const res = await addAdj(fixedRider.riderId, { amount_lkr: -150, reason: 'CASH_SHORT', note: 'Short at hand-in' }, opsToken);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.adjustment).toMatchObject({
        rider_id: fixedRider.riderId,
        amount_lkr: -150,
        reason: 'CASH_SHORT',
        note: 'Short at hand-in',
        adjustment_date: today,
        created_by_user_id: users.admin.id,
      });
      adjId = res.body.data.adjustment.id;
      expect((await addAdj(fixedRider.riderId, { amount_lkr: 50, reason: 'BONUS' })).status).toBe(201);
      // A COMPANY rider, yesterday.
      const c = await addAdj(companyRider.riderId, { amount_lkr: -300, reason: 'DAMAGED_ITEM', adjustment_date: yesterday });
      expect(c.status).toBe(201);
      const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE action = 'RIDER_PAY_ADJUSTMENT_CREATED' AND entity_id = $1", [adjId])).rows[0];
      expect(audit.new_values).toEqual({ rider_id: fixedRider.riderId, amount_lkr: -150, reason: 'CASH_SHORT', note: 'Short at hand-in', adjustment_date: today });
    });

    it('lists, edits and deletes (audited); validates; staff only', async () => {
      const list = await request(app).get(`/api/v1/admin/rider-adjustments?rider_id=${fixedRider.riderId}`).set(auth(opsToken));
      expect(list.status).toBe(200);
      expect(list.body.data.adjustments.map((a: { amount_lkr: number }) => a.amount_lkr).sort()).toEqual([-150, 50]);
      const yest = await request(app).get(`/api/v1/admin/rider-adjustments?from=${yesterday}&to=${yesterday}`).set(auth(tokens.admin));
      expect(yest.body.data.adjustments.some((a: { rider_id: string }) => a.rider_id === companyRider.riderId)).toBe(true);

      const extra = await addAdj(fixedRider.riderId, { amount_lkr: -1, reason: 'LATE' });
      const id = extra.body.data.adjustment.id;
      const upd = await request(app).patch(`/api/v1/admin/rider-adjustments/${id}`).set(auth(tokens.admin)).send({ amount_lkr: -20, note: 'Late 40 min' });
      expect(upd.status, JSON.stringify(upd.body)).toBe(200);
      expect(upd.body.data.adjustment).toMatchObject({ amount_lkr: -20, reason: 'LATE', note: 'Late 40 min' });
      const del = await request(app).delete(`/api/v1/admin/rider-adjustments/${id}`).set(auth(opsToken));
      expect(del.body.data).toEqual({ deleted: true });
      expect((await request(app).delete(`/api/v1/admin/rider-adjustments/${id}`).set(auth(opsToken))).status).toBe(404);
      const actions = (await pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at', [id])).rows.map((r) => r.action);
      expect(actions).toEqual(['RIDER_PAY_ADJUSTMENT_CREATED', 'RIDER_PAY_ADJUSTMENT_UPDATED', 'RIDER_PAY_ADJUSTMENT_DELETED']);

      const tomorrow = DateTime.now().setZone('Asia/Colombo').plus({ days: 1 }).toISODate();
      for (const body of [
        {},
        { amount_lkr: 0, reason: 'LATE' },
        { amount_lkr: -10, reason: 'SPEEDING' },
        { amount_lkr: -10.123, reason: 'LATE' },
        { amount_lkr: -200000, reason: 'LATE' },
        { amount_lkr: -10, reason: 'LATE', adjustment_date: tomorrow },
        { amount_lkr: -10, reason: 'LATE', note: 'x'.repeat(301) },
      ]) {
        expect((await addAdj(fixedRider.riderId, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await addAdj('f0000001-0000-0000-0000-00000000dead', { amount_lkr: -10, reason: 'LATE' })).status).toBe(404);
      for (const t of [tokens.customer, tokens.rider, tokens.staff]) {
        expect((await addAdj(fixedRider.riderId, { amount_lkr: -10, reason: 'LATE' }, t)).status).toBe(403);
        expect((await request(app).get('/api/v1/admin/rider-adjustments').set(auth(t))).status).toBe(403);
      }
    });
  });

  describe('Where it shows', () => {
    it('the earnings report: base, bonuses by kind, adjustments, total, cash', async () => {
      const res = await report();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const d = await Promise.all([fixed1, fixed2, fixed3].map((x) => delivery(x.deliveryId)));
      const collected = Number(d.reduce((s, x) => s + x.cod, 0).toFixed(2));
      const kept = Number(d.reduce((s, x) => s + Math.min(x.earning, x.cod), 0).toFixed(2));
      const r = row(res, fixedRider.riderId);
      expect(r).toMatchObject({
        pay_type: 'COMMISSION',
        pay_model: 'FIXED',
        deliveries: 3,
        base_earnings: 270,
        delivery_bonuses: 74,
        rider_share: 344,
        day_bonuses: 250,
        additions: 50,
        deductions: 150,
        adjustments: -100,
        total_earnings: 344 + 250 - 100,
        bonus_breakdown: { PEAK_BOOST: 25, RAIN_BOOST: 9, LONG_DISTANCE: 40, DAILY_TARGET: 250 },
        cash_collected: collected,
        cash_kept: kept,
        cash_to_hand_in: Math.max(0, Number((collected - kept - 250 + 100).toFixed(2))),
      });
      expect(res.body.data.adjustments.some((a: { rider_id: string; reason: string }) => a.rider_id === fixedRider.riderId && a.reason === 'CASH_SHORT')).toBe(true);
      expect(res.body.data.totals.total_earnings).toBeGreaterThanOrEqual(r.total_earnings);
      // Yesterday: the company rider appears with only a deduction.
      const y = await report(`range=custom&from=${yesterday}&to=${yesterday}`);
      expect(row(y, companyRider.riderId)).toMatchObject({ deliveries: 0, deductions: 300, adjustments: -300, total_earnings: -300, cash_to_hand_in: 300 });
    });

    it('the cash reconciliation: day bonuses and adjustments move the expected hand-in; a deduction-only day appears', async () => {
      const res = await recon();
      const d = await Promise.all([fixed1, fixed2, fixed3].map((x) => delivery(x.deliveryId)));
      const collected = Number(d.reduce((s, x) => s + x.cod, 0).toFixed(2));
      const kept = Number(d.reduce((s, x) => s + Math.min(x.earning, x.cod), 0).toFixed(2));
      const expected = Math.max(0, Number((collected - kept - 250 + 100).toFixed(2)));
      expect(row(res, fixedRider.riderId)).toMatchObject({
        collected,
        kept_share: kept,
        day_bonuses: 250,
        adjustments: -100,
        expected_handin: expected,
        payable_to_rider: 0,
        difference: -expected,
      });
      const y = await recon(yesterday);
      expect(row(y, companyRider.riderId)).toMatchObject({ deliveries: 0, collected: 0, adjustments: -300, expected_handin: 300, status: 'SHORT' });
      expect(y.body.data.totals.adjustments).toBeLessThanOrEqual(-300);
    });

    it('extra pay the cash cannot cover is owed to the rider', async () => {
      const big = await addAdj(distRider.riderId, { amount_lkr: 100000, reason: 'OTHER', note: 'Fuel refund' });
      expect(big.status).toBe(201);
      const r = row(await recon(), distRider.riderId);
      expect(r.expected_handin).toBe(0);
      expect(r.payable_to_rider).toBe(Number((100000 + r.kept_share + r.day_bonuses - r.collected).toFixed(2)));
      expect(r.status).toBe('BALANCED');
      const rep = row(await report(), distRider.riderId);
      expect(rep.payable_to_rider).toBe(r.payable_to_rider);
      await request(app).delete(`/api/v1/admin/rider-adjustments/${big.body.data.adjustment.id}`).set(auth(tokens.admin));
    });

    it("the rider's own earnings: base + bonuses - deductions, with reasons, and the boosts now", async () => {
      expect((await patch('/rain-boost', { on: true, mode: 'FIXED', amount: 30 })).status).toBe(200);
      const res = await request(app).get('/api/v1/riders/me/earnings').set(auth(fixedRider.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        pay_type: 'COMMISSION',
        pay_model: { model: 'FIXED', fixed_lkr: 90 },
        boosts: { applies: true, rain: { active: true, mode: 'FIXED', amount: 30, until: null }, peak: { active_now: false } },
        today: {
          deliveries: 3,
          base_earnings: 270,
          delivery_bonuses: 74,
          day_bonuses: 250,
          bonuses: 324,
          additions: 50,
          deductions: 150,
          adjustments: -100,
          earnings: 494,
          payable_to_rider: 0,
        },
      });
      expect(res.body.data.today.bonus_lines).toEqual([
        { kind: 'PEAK_BOOST', amount_lkr: 25, count: 1 },
        { kind: 'RAIN_BOOST', amount_lkr: 9, count: 1 },
        { kind: 'LONG_DISTANCE', amount_lkr: 40, count: 1 },
        { kind: 'DAILY_TARGET', amount_lkr: 250, count: 2 },
      ]);
      expect(res.body.data.today.adjustment_lines.map((a: { amount_lkr: number; reason: string; note: string | null }) => [a.amount_lkr, a.reason, a.note]).sort()).toEqual([
        [-150, 'CASH_SHORT', 'Short at hand-in'],
        [50, 'BONUS', null],
      ]);
      const t = res.body.data.today;
      expect(t.cash_to_keep).toBe(Math.max(0, Number((t.cash_collected - t.cash_to_hand_in).toFixed(2))));

      const company = await request(app).get('/api/v1/riders/me/earnings').set(auth(companyRider.token));
      expect(company.body.data).toMatchObject({ pay_type: 'COMPANY', pay_model: null, boosts: { applies: false, rain: { active: true } } });
      expect((await patch('/rain-boost', { on: false })).status).toBe(200);
    });

    it('company riders get the bonuses when the switch is on', async () => {
      expect((await patch('/bonuses', { company_riders: true })).status).toBe(200);
      expect((await patch('/rain-boost', { on: true, mode: 'FIXED', amount: 30 })).status).toBe(200);
      const c2 = await deliveredOrder(companyRider);
      expect(await delivery(c2.deliveryId)).toMatchObject({ rider_pay_type: 'COMPANY', base: 0, bonus: 30, earning: 30 });
      const company = await request(app).get('/api/v1/riders/me/earnings').set(auth(companyRider.token));
      expect(company.body.data.boosts.applies).toBe(true);
      expect(company.body.data.today).toMatchObject({ deliveries: 2, bonuses: 30 + 100, earnings: 130 });
      expect((await patch('/rain-boost', { on: false })).status).toBe(200);
      expect((await patch('/bonuses', { company_riders: false })).status).toBe(200);
    });
  });
});

describe('Distance is only measured when needed', () => {
  beforeEach(() => {
    roadCalls = 0;
  });
  it('a FIXED rider with long distance off makes no OSRM call', async () => {
    await deliveredOrder(fixedRider);
    expect(roadCalls).toBe(0);
  });
});

// ============================================================================
// Per-km tiers for DISTANCE pay (migration 040; owner, 2026-10-10): "1st km
// LKR 100, then an additional amount for the 2nd km, another for the 3rd".
// ============================================================================
describe('Per-km tiers for DISTANCE pay', () => {
  const TIERS = [
    { km: 1, lkr: 100 },
    { km: 2, lkr: 60 },
    { km: 3, lkr: 50 },
  ];
  const tiered: PayParams = {
    model: 'DISTANCE',
    percent: 80,
    fixed_lkr: 80,
    base_lkr: 50,
    per_km_lkr: 20,
    min_lkr: null,
    distance_mode: 'TIERS',
    km_tiers: TIERS,
  };
  const noOwn = { pay_model: null, commission_percent: null, pay_fixed_lkr: null, pay_base_lkr: null, pay_per_km_lkr: null, pay_min_lkr: null };

  it('pure: every started km counts, the last row repeats, then the floor', () => {
    expect(basePay(tiered, { standardFee: 0, distanceKm: 2.3 })).toBe(210);
    expect(basePay(tiered, { standardFee: 0, distanceKm: 3 })).toBe(210);
    // 7.25 km -> 8 km: 100 + 60 + 50 x 6.
    expect(basePay(tiered, { standardFee: 0, distanceKm: 7.25 })).toBe(460);
    expect(basePay(tiered, { standardFee: 0, distanceKm: null })).toBe(100);
    expect(basePay({ ...tiered, min_lkr: 500 }, { standardFee: 0, distanceKm: 7.25 })).toBe(500);
    // LINEAR is unchanged: 50 + 20 x 2.3.
    expect(basePay({ ...tiered, distance_mode: 'LINEAR' }, { standardFee: 0, distanceKm: 2.3 })).toBe(96);

    // A rider's own table and mode over the default's; TIERS with no table pays LINEAR.
    const own = [{ km: 1, lkr: 70 }];
    expect(effectivePayParams({ ...noOwn, pay_model: 'DISTANCE', pay_distance_mode: null, pay_km_tiers: own }, tiered)).toMatchObject({
      distance_mode: 'TIERS',
      km_tiers: own,
    });
    expect(effectivePayParams({ ...noOwn, pay_distance_mode: 'LINEAR', pay_km_tiers: null }, tiered)).toMatchObject({
      distance_mode: 'LINEAR',
      km_tiers: TIERS,
    });
    expect(
      effectivePayParams({ ...noOwn, pay_distance_mode: 'TIERS', pay_km_tiers: null }, { ...tiered, distance_mode: 'LINEAR', km_tiers: [] })
    ).toMatchObject({ distance_mode: 'LINEAR' });
  });

  it('store default: TIERS needs a table; saved and audited; LINEAR keeps base + per km', async () => {
    expect((await patch('/model', { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: [] })).status).toBe(400);
    const stored = (await settings()).body.data.default_model;
    if (!stored.km_tiers.length) {
      expect((await patch('/model', { model: 'DISTANCE', distance_mode: 'TIERS' })).status).toBe(400);
    }
    for (const km_tiers of [[{ km: 2, lkr: 10 }], [{ km: 1, lkr: -1 }], [{ km: 1, lkr: 1.234 }], Array.from({ length: 11 }, (_, i) => ({ km: i + 1, lkr: 1 }))]) {
      expect((await patch('/model', { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers })).status, JSON.stringify(km_tiers)).toBe(400);
    }
    expect((await patch('/model', { model: 'DISTANCE', distance_mode: 'STEPS', km_tiers: TIERS })).status).toBe(400);

    const res = await patch('/model', { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS, min_lkr: null }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.default_model).toMatchObject({ model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS, min_lkr: null });
    const audit = (
      await pool.query(
        "SELECT new_values FROM audit_logs WHERE action = 'RIDER_PAY_MODEL_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1",
        [startedAt]
      )
    ).rows[0];
    expect(audit.new_values).toMatchObject({ key: 'rider_pay_model', model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS });

    // Back to base + per km keeps the table for next time.
    const linear = await patch('/model', { model: 'DISTANCE', distance_mode: 'LINEAR', base_lkr: 30, per_km_lkr: 15 });
    expect(linear.body.data.default_model).toMatchObject({ distance_mode: 'LINEAR', base_lkr: 30, per_km_lkr: 15, km_tiers: TIERS });
    expect((await patch('/model', { model: 'DISTANCE', distance_mode: 'TIERS' })).body.data.default_model).toMatchObject({ distance_mode: 'TIERS' });
  });

  it("a rider's own tiers, or the store default's; audited; validated", async () => {
    const own = [
      { km: 1, lkr: 120 },
      { km: 2, lkr: 40 },
    ];
    let res = await setPay(distRider.riderId, { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: own }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.pay).toMatchObject({
      pay_model: 'DISTANCE',
      own: { distance_mode: 'TIERS', km_tiers: own, base_lkr: null, per_km_lkr: null },
      effective: { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: own },
    });
    const audit = (
      await pool.query("SELECT new_values FROM audit_logs WHERE action = 'RIDER_PAY_UPDATED' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1", [distRider.riderId])
    ).rows[0];
    expect(audit.new_values).toMatchObject({ pay_model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: own });

    // Mode and table null: the store default's (TIERS with [100, 60, 50]).
    res = await setPay(distRider.riderId, { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: null, km_tiers: null });
    expect(res.body.data.pay).toMatchObject({
      own: { distance_mode: null, km_tiers: null },
      effective: { distance_mode: 'TIERS', km_tiers: TIERS },
    });
    // Another model drops the tier fields.
    res = await setPay(companyRider.riderId, { pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: 60, distance_mode: 'TIERS', km_tiers: own });
    expect(res.body.data.pay.own).toMatchObject({ distance_mode: null, km_tiers: null, fixed_lkr: 60 });
    const stored = (await pool.query('SELECT pay_distance_mode, pay_km_tiers FROM riders WHERE id = $1', [companyRider.riderId])).rows[0];
    expect(stored).toEqual({ pay_distance_mode: null, pay_km_tiers: null });

    for (const body of [
      { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'STEPS' },
      { pay_type: 'COMMISSION', pay_model: 'DISTANCE', km_tiers: [{ km: 1, lkr: 10 }, { km: 3, lkr: 10 }] },
      { pay_type: 'COMMISSION', pay_model: 'DISTANCE', km_tiers: [] },
    ]) {
      expect((await setPay(distRider.riderId, body)).status, JSON.stringify(body)).toBe(400);
    }
    // Put the company rider back on COMPANY pay.
    expect((await setPay(companyRider.riderId, { pay_type: 'COMPANY' })).status).toBe(200);
  });

  it('TIERS with no table anywhere is refused for a rider', async () => {
    expect((await patch('/model', { model: 'FIXED', distance_mode: 'LINEAR', km_tiers: TIERS })).status).toBe(200);
    // Clear the default table directly (the API never stores TIERS without one).
    await pool.query(`UPDATE system_configurations SET value = value - 'km_tiers' WHERE key = 'rider_pay_model'`);
    expect((await setPay(distRider.riderId, { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'TIERS' })).status).toBe(400);
    expect((await patch('/model', { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS })).status).toBe(200);
  });

  it('settlement pays by the tiers on the road km and snapshots the table and the km counted', async () => {
    expect((await setPay(distRider.riderId, { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS })).status).toBe(200);
    payDistance.roadMetres = async () => 7250;
    const d = await deliveredOrder(distRider);
    const snap = await delivery(d.deliveryId);
    expect(snap).toMatchObject({
      rider_pay_type: 'COMMISSION',
      rider_pay_model: 'DISTANCE',
      rider_pay_inputs: { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS, km_counted: 8, min_lkr: null },
      km: 7.25,
      estimated: false,
      base: 460,
    });
    expect(snap.rider_pay_inputs).not.toHaveProperty('base_lkr');
    expect(snap.rider_pay_inputs).not.toHaveProperty('per_km_lkr');
  });
});
