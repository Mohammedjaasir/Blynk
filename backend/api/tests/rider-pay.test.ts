import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings, DEFAULT_RIDER_COMMISSION_PERCENT } from '../src/modules/configuration/settings.service.js';
import { riderEarning } from '../src/modules/riders/rider.pay.js';
import { stockFixtures, tokens, auth, users, STORE } from './helpers/stock.js';

/**
 * Rider pay (migration 032; owner, 2026-10-09): COMPANY and COMMISSION
 * riders, the default share setting, a rider's own share, the per-delivery
 * snapshot (on the STANDARD fee even for a free delivery), the earnings
 * report, the rider's own earnings and the cash a commission rider keeps.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-PAY-');
const opsToken = generateAccessToken({ id: users.admin.id, phone: users.admin.phone, role: 'OPERATIONS' });
const today = DateTime.now().setZone('Asia/Colombo').toISODate()!;
const startedAt = new Date();

const pinnedCheckout = checkoutSettings.read;
let savedCommissionRow: { value: unknown; description: string | null } | null = null;
let productId = '';
let commission: { riderId: string; token: string };
let company: { riderId: string; token: string };
let pendingUserId = '';
let pendingRiderId = '';
const orders: string[] = [];

const setting = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/rider-commission').set(auth(token));
const setSetting = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/rider-commission').set(auth(token)).send(body);
const setPay = (riderId: string, body: object, token = tokens.admin) =>
  request(app).patch(`/api/v1/admin/riders/${riderId}/pay`).set(auth(token)).send(body);
const report = (qs = 'range=today', token = tokens.admin) =>
  request(app).get(`/api/v1/admin/reports/rider-earnings?${qs}`).set(auth(token));
const recon = () => request(app).get(`/api/v1/admin/cash/reconciliation?date=${today}`).set(auth(tokens.admin));
const deliveryRow = async (id: string) =>
  (
    await pool.query(
      `SELECT rider_pay_type, rider_commission_percent::float AS pct, rider_earning_lkr::float AS earning, cod_collected_amount::float AS cod
         FROM deliveries WHERE id = $1`,
      [id]
    )
  ).rows[0];
const orderFees = async (id: string) =>
  (await pool.query('SELECT delivery_fee::float AS fee, standard_delivery_fee::float AS standard FROM orders WHERE id = $1', [id])).rows[0];

/** Places, packs and delivers one order with `rider`; free delivery when `free`. */
async function deliveredOrder(rider: { riderId: string; token: string }, free: boolean, qty = 1) {
  checkoutSettings.read = async () => ({
    coupons_enabled: true,
    new_customer_free_deliveries: { enabled: free, count: 10, since: startedAt.toISOString() },
  });
  const order = await fx.placeOrder([{ product_id: productId, quantity: qty }]);
  orders.push(order.id);
  expect((await fx.pack(order.id)).status).toBe(200);
  const deliveryId = await fx.deliver(order.id, rider);
  return { orderId: order.id, deliveryId };
}

beforeAll(async () => {
  savedCommissionRow =
    (await pool.query("SELECT value, description FROM system_configurations WHERE key = 'rider_commission'")).rows[0] ?? null;
  await pool.query("DELETE FROM system_configurations WHERE key = 'rider_commission'");
  await fx.setup();
  productId = (await fx.product({ tracked: false })).productId;
  commission = await fx.tempRider('pay-commission');
  company = await fx.tempRider('pay-company');
}, 60_000);

afterAll(async () => {
  checkoutSettings.read = pinnedCheckout;
  await pool.query("DELETE FROM system_configurations WHERE key = 'rider_commission'");
  if (savedCommissionRow) {
    await pool.query("INSERT INTO system_configurations (key, value, description) VALUES ('rider_commission', $1, $2)", [
      JSON.stringify(savedCommissionRow.value),
      savedCommissionRow.description,
    ]);
  }
  const riderIds = [commission?.riderId, company?.riderId, pendingRiderId].filter(Boolean);
  await pool.query(
    `DELETE FROM audit_logs WHERE created_at >= $1 AND (action IN ('RIDER_COMMISSION_UPDATED') OR entity_id = ANY($2::uuid[]))`,
    [startedAt, riderIds]
  );
  if (pendingUserId) await pool.query('DELETE FROM notifications WHERE user_id = $1', [pendingUserId]);
  await fx.cleanup();
});

describe('riderEarning', () => {
  it('is a share of the standard fee for COMMISSION and 0 for COMPANY', () => {
    expect(riderEarning('COMMISSION', 80, 120)).toBe(96);
    expect(riderEarning('COMMISSION', 33.33, 100)).toBe(33.33);
    expect(riderEarning('COMPANY', 80, 120)).toBe(0);
  });
});

describe('Default commission setting', () => {
  it(`is ${DEFAULT_RIDER_COMMISSION_PERCENT}% until set; Operations sets it, audited`, async () => {
    const before = await setting(opsToken);
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ default_percent: DEFAULT_RIDER_COMMISSION_PERCENT, updated_at: null });

    const res = await setSetting({ default_percent: 75 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.default_percent).toBe(75);
    expect((await setting()).body.data.default_percent).toBe(75);

    const audit = (
      await pool.query(
        "SELECT old_values, new_values FROM audit_logs WHERE action = 'RIDER_COMMISSION_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1",
        [startedAt]
      )
    ).rows[0];
    expect(audit.old_values).toEqual({ key: 'rider_commission', default_percent: null });
    expect(audit.new_values).toEqual({ key: 'rider_commission', default_percent: 75 });
  });

  it('validates and is for ADMIN and OPERATIONS only', async () => {
    for (const body of [{}, { default_percent: 101 }, { default_percent: -1 }, { default_percent: 1.234 }, { default_percent: '80' }, { default_percent: 80, x: 1 }]) {
      expect((await setSetting(body)).status, JSON.stringify(body)).toBe(400);
    }
    for (const t of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await setting(t)).status).toBe(403);
      expect((await setSetting({ default_percent: 50 }, t)).status).toBe(403);
    }
  });
});

describe("A rider's pay", () => {
  it('existing and new riders are COMPANY until set', async () => {
    const res = await request(app).get(`/api/v1/admin/riders/${commission.riderId}/pay`).set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data.pay).toEqual({
      rider_id: commission.riderId,
      pay_type: 'COMPANY',
      commission_percent: null,
      effective_percent: null,
      default_percent: 75,
    });
  });

  it('COMMISSION uses the default until the rider has their own share; COMPANY drops the share; audited', async () => {
    let res = await setPay(commission.riderId, { pay_type: 'COMMISSION' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.pay).toMatchObject({ pay_type: 'COMMISSION', commission_percent: null, effective_percent: 75 });

    res = await setPay(company.riderId, { pay_type: 'COMPANY', commission_percent: 60 });
    expect(res.body.data.pay).toMatchObject({ pay_type: 'COMPANY', commission_percent: null, effective_percent: null });

    res = await setPay(commission.riderId, { pay_type: 'COMMISSION', commission_percent: 80 });
    expect(res.body.data.pay).toMatchObject({ pay_type: 'COMMISSION', commission_percent: 80, effective_percent: 80 });

    const list = await request(app).get('/api/v1/admin/riders').set(auth(opsToken));
    expect(list.body.data.riders.find((r: { id: string }) => r.id === commission.riderId)).toMatchObject({
      pay_type: 'COMMISSION',
      commission_percent: 80,
    });

    const audit = (
      await pool.query(
        "SELECT new_values FROM audit_logs WHERE action = 'RIDER_PAY_UPDATED' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1",
        [commission.riderId]
      )
    ).rows[0];
    expect(audit.new_values).toEqual({ pay_type: 'COMMISSION', commission_percent: 80 });
  });

  it('validates; unknown rider 404; staff roles only', async () => {
    for (const body of [{}, { pay_type: 'SALARY' }, { pay_type: 'COMMISSION', commission_percent: 120 }, { pay_type: 'COMMISSION', commission_percent: -5 }]) {
      expect((await setPay(commission.riderId, body)).status, JSON.stringify(body)).toBe(400);
    }
    const missing = await setPay('f0000001-0000-0000-0000-00000000dead', { pay_type: 'COMPANY' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RIDER_NOT_FOUND');
    for (const t of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await setPay(commission.riderId, { pay_type: 'COMPANY' }, t)).status).toBe(403);
    }
  });

  it('is chosen when a rider request is approved', async () => {
    const suffix = String(Date.now()).slice(-6);
    pendingUserId = (
      await pool.query(`INSERT INTO users (phone, full_name, role, is_active) VALUES ($1, 'Pay Test Applicant', 'CUSTOMER', true) RETURNING id`, [
        `+94770${suffix}`,
      ])
    ).rows[0].id;
    fx.created.users.push(pendingUserId);
    pendingRiderId = (
      await pool.query(
        `INSERT INTO riders (user_id, dark_store_id, vehicle_registration_number, is_available, is_active, approval_status, applied_at)
         VALUES ($1, $2, $3, false, false, 'PENDING', now()) RETURNING id`,
        [pendingUserId, STORE, `TEST-PAY-${suffix}`]
      )
    ).rows[0].id;

    const bad = await request(app)
      .post(`/api/v1/admin/rider-applications/${pendingRiderId}/approve`)
      .set(auth(opsToken))
      .send({ pay_type: 'COMMISSION', commission_percent: 150 });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .post(`/api/v1/admin/rider-applications/${pendingRiderId}/approve`)
      .set(auth(opsToken))
      .send({ pay_type: 'COMMISSION', commission_percent: 85 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.application).toMatchObject({ approval_status: 'APPROVED', pay_type: 'COMMISSION', commission_percent: 85 });
  });
});

describe('Earnings, the snapshot and cash', () => {
  let first: { orderId: string; deliveryId: string };
  let second: { orderId: string; deliveryId: string };
  let third: { orderId: string; deliveryId: string };
  let fee = 0;

  beforeAll(async () => {
    // A free delivery at 80%, then the rider's share drops to 50% and a
    // full-fee order follows; a company rider delivers one too.
    first = await deliveredOrder(commission, true);
    expect((await setPay(commission.riderId, { pay_type: 'COMMISSION', commission_percent: 50 })).status).toBe(200);
    second = await deliveredOrder(commission, false, 2);
    third = await deliveredOrder(company, true);
    fee = (await orderFees(second.orderId)).fee;
    expect(fee).toBeGreaterThan(0);
  }, 90_000);

  it('a free delivery still records the standard fee', async () => {
    expect(await orderFees(first.orderId)).toEqual({ fee: 0, standard: fee });
    expect(await orderFees(second.orderId)).toEqual({ fee, standard: fee });
  });

  it('snapshots pay type, share and earning when delivered; a later change does not rewrite it', async () => {
    expect(await deliveryRow(first.deliveryId)).toMatchObject({ rider_pay_type: 'COMMISSION', pct: 80, earning: riderEarning('COMMISSION', 80, fee) });
    expect(await deliveryRow(second.deliveryId)).toMatchObject({ rider_pay_type: 'COMMISSION', pct: 50, earning: riderEarning('COMMISSION', 50, fee) });
    expect(await deliveryRow(third.deliveryId)).toMatchObject({ rider_pay_type: 'COMPANY', pct: null, earning: 0 });
  });

  it('the cash reconciliation expects collected minus the kept share', async () => {
    const res = await recon();
    expect(res.status).toBe(200);
    const d1 = await deliveryRow(first.deliveryId);
    const d2 = await deliveryRow(second.deliveryId);
    const d3 = await deliveryRow(third.deliveryId);
    const kept = Number((Math.min(d1.earning, d1.cod) + Math.min(d2.earning, d2.cod)).toFixed(2));
    const collected = Number((d1.cod + d2.cod).toFixed(2));
    const mine = res.body.data.riders.find((r: { rider_id: string }) => r.rider_id === commission.riderId);
    expect(mine).toMatchObject({
      pay_type: 'COMMISSION',
      deliveries: 2,
      collected,
      kept_share: kept,
      expected_handin: Number((collected - kept).toFixed(2)),
      handed_in: 0,
      difference: -Number((collected - kept).toFixed(2)),
      status: 'SHORT',
    });
    const theirs = res.body.data.riders.find((r: { rider_id: string }) => r.rider_id === company.riderId);
    expect(theirs).toMatchObject({ pay_type: 'COMPANY', collected: d3.cod, kept_share: 0, expected_handin: d3.cod });

    expect(
      (await request(app).post('/api/v1/admin/cash/handins').set(auth(tokens.admin)).send({ rider_id: commission.riderId, amount: collected - kept })).status
    ).toBe(201);
    const after = (await recon()).body.data.riders.find((r: { rider_id: string }) => r.rider_id === commission.riderId);
    expect(after).toMatchObject({ difference: 0, status: 'BALANCED' });
    await pool.query('DELETE FROM cash_handins WHERE rider_id = $1', [commission.riderId]);
  });

  it('the earnings report: per rider charges, shares and product margin', async () => {
    const res = await report('range=today', opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.range).toEqual({ from: today, to: today, timezone: 'Asia/Colombo' });
    const margin = (
      await pool.query(
        `SELECT sum(subtotal)::float AS sales, sum(quantity * coalesce(actual_unit_cost, estimated_unit_cost))::float AS cost
           FROM order_items WHERE order_id = ANY($1)`,
        [[first.orderId, second.orderId]]
      )
    ).rows[0];
    const share = riderEarning('COMMISSION', 80, fee) + riderEarning('COMMISSION', 50, fee);
    const row = res.body.data.riders.find((r: { rider_id: string }) => r.rider_id === commission.riderId);
    expect(row).toMatchObject({
      pay_type: 'COMMISSION',
      commission_percent: 50,
      effective_percent: 50,
      deliveries: 2,
      delivery_charges: fee * 2,
      customer_delivery_fees: fee,
      rider_share: share,
      blynk_delivery_share: Number((fee * 2 - share).toFixed(2)),
      product_sales: margin.sales,
      product_cost: margin.cost,
      product_margin: Number((margin.sales - margin.cost).toFixed(2)),
    });
    expect(row.cash_to_hand_in).toBe(Number((row.cash_collected - row.cash_kept).toFixed(2)));
    const companyRow = res.body.data.riders.find((r: { rider_id: string }) => r.rider_id === company.riderId);
    expect(companyRow).toMatchObject({ pay_type: 'COMPANY', deliveries: 1, delivery_charges: fee, rider_share: 0, blynk_delivery_share: fee });
    expect(res.body.data.totals.deliveries).toBeGreaterThanOrEqual(3);

    const week = await report('range=this_week');
    expect(week.status).toBe(200);
    expect(week.body.data.riders.find((r: { rider_id: string }) => r.rider_id === commission.riderId).deliveries).toBe(2);
    const custom = await report(`range=custom&from=${today}&to=${today}`);
    expect(custom.body.data.riders.find((r: { rider_id: string }) => r.rider_id === commission.riderId).deliveries).toBe(2);
    const yesterday = DateTime.now().setZone('Asia/Colombo').minus({ days: 1 }).toISODate()!;
    const empty = await report(`range=custom&from=${yesterday}&to=${yesterday}`);
    expect(empty.body.data.riders.find((r: { rider_id: string }) => r.rider_id === commission.riderId)).toBeUndefined();
  });

  it('the report validates its range and is for ADMIN and OPERATIONS only', async () => {
    for (const qs of ['range=custom', `range=custom&from=${today}`, 'range=custom&from=2026-10-09&to=2026-10-01', 'range=month', 'range=custom&from=2024-01-01&to=2026-01-01']) {
      expect((await report(qs)).status, qs).toBe(400);
    }
    for (const t of [tokens.customer, tokens.rider, tokens.staff]) expect((await report('range=today', t)).status).toBe(403);
  });

  it("the rider's own earnings: today and this week, with cash to keep and hand in", async () => {
    const res = await request(app).get('/api/v1/riders/me/earnings').set(auth(commission.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d1 = await deliveryRow(first.deliveryId);
    const d2 = await deliveryRow(second.deliveryId);
    const kept = Number((Math.min(d1.earning, d1.cod) + Math.min(d2.earning, d2.cod)).toFixed(2));
    const collected = Number((d1.cod + d2.cod).toFixed(2));
    expect(res.body.data).toMatchObject({
      timezone: 'Asia/Colombo',
      pay_type: 'COMMISSION',
      commission_percent: 50,
      today: {
        date: today,
        deliveries: 2,
        delivery_charges: fee * 2,
        earnings: Number((d1.earning + d2.earning).toFixed(2)),
        cash_collected: collected,
        cash_to_keep: kept,
        cash_to_hand_in: Number((collected - kept).toFixed(2)),
      },
    });
    expect(res.body.data.week.deliveries).toBe(2);

    const theirs = await request(app).get('/api/v1/riders/me/earnings').set(auth(company.token));
    expect(theirs.body.data).toMatchObject({ pay_type: 'COMPANY', commission_percent: null, today: { deliveries: 1, earnings: 0, cash_to_keep: 0 } });
    expect((await request(app).get('/api/v1/riders/me/earnings').set(auth(tokens.customer))).status).toBe(403);
  });
});
