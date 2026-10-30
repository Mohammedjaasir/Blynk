import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import {
  hasCommissionFreeColumn,
  setCommissionFreeColumnForTests,
  freeDaysLeft,
} from '../src/modules/sellers/seller.commission.js';
import { sellerStatement } from '../src/modules/sellers/seller.statement.js';
import { auth, stockFixtures, tokens, users, type PlacedOrder, type Tracked } from './helpers/stock.js';
import { sellerFixtures, type FixtureSeller } from './helpers/seller-fixtures.js';

/**
 * The commission-free month for sellers (migration 065; owner's brother, 2026-10-30: "1 month free for
 * a seller, after that Admin decides the rate"):
 *  - the migration and its guard (nothing breaks, nothing is free, until the column exists),
 *  - the `free_days` setting (GET | PUT /admin/settings/seller-commission),
 *  - approval starts the month (PATCH /admin/sellers/:id, POST /admin/sellers), Admin can change it,
 *  - sales delivered before sellers.commission_free_until carry no commission - in the statement, the
 *    sellers list and the payouts "due" - later ones use the normal rates,
 *  - GET /seller/me carries the countdown.
 * Real local Postgres; everything made here is removed again (the setting is put back as found).
 */
const app = createApp();
const fx = sellerFixtures('scf');
const orders = stockFixtures(app, 'SCF-');
const A = '/api/v1/admin';
const S = '/api/v1/seller';
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const DAY = 86_400_000;

let originalSetting: { value: unknown; description: string | null } | undefined;
const createdSellerIds: string[] = [];
const createdUserIds: string[] = [];

const patchSeller = (id: string, body: unknown, token = tokens.admin) => request(app).patch(`${A}/sellers/${id}`).set(auth(token)).send(body as object);
const getSeller = (id: string, token = tokens.admin) => request(app).get(`${A}/sellers/${id}`).set(auth(token));
const me = (s: FixtureSeller) => request(app).get(`${S}/me`).set(auth(s.token));
const statementOf = (s: FixtureSeller) => request(app).get(`${S}/statement`).set(auth(s.token));
const setFreeDays = (n: number | null) =>
  n === null
    ? pool.query(`UPDATE system_configurations SET value = value - 'free_days' WHERE key = 'seller_commission'`)
    : pool.query(
        `INSERT INTO system_configurations (key, value, description) VALUES ('seller_commission', jsonb_build_object('default_percent', 0, 'free_days', $1::int), 'test')
         ON CONFLICT (key) DO UPDATE SET value = system_configurations.value || jsonb_build_object('free_days', $1::int)`,
        [n]
      );
const freeUntilOf = async (id: string) =>
  ((await pool.query('SELECT commission_free_until AS t FROM sellers WHERE id = $1', [id])).rows[0].t as Date | null)?.getTime() ?? null;

beforeAll(async () => {
  await orders.setup();
  await fx.setup();
  originalSetting = (await pool.query(`SELECT value, description FROM system_configurations WHERE key = 'seller_commission'`)).rows[0];
});

afterAll(async () => {
  setCommissionFreeColumnForTests(null);
  if (originalSetting) {
    await pool.query(`UPDATE system_configurations SET value = $1::jsonb WHERE key = 'seller_commission'`, [JSON.stringify(originalSetting.value)]);
  } else {
    await pool.query(`DELETE FROM system_configurations WHERE key = 'seller_commission'`);
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'SELLER_COMMISSION_UPDATED' AND new_values ? 'free_days' AND created_at >= $1`, [fx.testStart]);
  await orders.cleanup();
  if (createdSellerIds.length) {
    await pool.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])`, [createdSellerIds]);
    await pool.query('DELETE FROM sellers WHERE id = ANY($1::uuid[])', [createdSellerIds]);
  }
  if (createdUserIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  await fx.cleanup();
});

describe('Migration 065 and its guard', () => {
  it('adds sellers.commission_free_until (nullable timestamptz) and the API sees it', async () => {
    const col = (
      await pool.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'sellers' AND column_name = 'commission_free_until'`)
    ).rows[0];
    expect(col).toEqual({ data_type: 'timestamp with time zone', is_nullable: 'YES' });
    setCommissionFreeColumnForTests(null);
    expect(await hasCommissionFreeColumn()).toBe(true);
  });

  it('before the migration nothing is free and nothing is a 500: statement, seller/me and the admin rows work, the date cannot be set', async () => {
    const s = await fx.seller({ commission: 10 });
    await pool.query(`UPDATE sellers SET commission_free_until = now() + interval '20 days' WHERE id = $1`, [s.id]);
    setCommissionFreeColumnForTests(false);
    try {
      const mine = await me(s);
      expect(mine.status).toBe(200);
      expect(mine.body.data).toMatchObject({ commission_free_until: null, commission_free_days_left: null, commission_free_days: expect.any(Number) });
      expect((await statementOf(s)).status).toBe(200);
      expect((await sellerStatement(s.id)).commission).toBe(0);

      const detail = await getSeller(s.id);
      expect(detail.status).toBe(200);
      expect(detail.body.data.seller).toMatchObject({ commission_free_until: null, commission_free_days_left: null });
      const list = await request(app).get(`${A}/sellers?search=${encodeURIComponent(s.shop)}`).set(auth(tokens.admin));
      expect(list.status).toBe(200);

      const patch = await patchSeller(s.id, { commission_free_until: new Date(Date.now() + DAY).toISOString() });
      expect(patch.status).toBe(503);
      expect(patch.body.error.code).toBe('FREE_PERIOD_NOT_READY');
      // approving still works; it just has no date to write
      const pending = await fx.seller({ status: 'PENDING' });
      expect((await patchSeller(pending.id, { status: 'APPROVED' })).status).toBe(200);
      expect(await freeUntilOf(pending.id)).toBeNull();
    } finally {
      setCommissionFreeColumnForTests(null);
    }
  });

  it('the migration backfills sellers who are already approved: approval (or sign-up) time + 30 days, only where empty', async () => {
    // Replay the migration's UPDATE on three sellers.
    const a = await fx.seller({ status: 'APPROVED' });
    const b = await fx.seller({ status: 'PENDING' });
    const c = await fx.seller({ status: 'APPROVED' });
    await pool.query(`UPDATE sellers SET reviewed_at = '2026-10-01T00:00:00Z', commission_free_until = NULL WHERE id = $1`, [a.id]);
    await pool.query(`UPDATE sellers SET commission_free_until = NULL WHERE id = $1`, [b.id]);
    await pool.query(`UPDATE sellers SET reviewed_at = '2026-10-01T00:00:00Z', commission_free_until = '2027-01-01T00:00:00Z' WHERE id = $1`, [c.id]);
    await pool.query(
      `UPDATE sellers SET commission_free_until = COALESCE(reviewed_at, created_at) + INTERVAL '30 days'
        WHERE status = 'APPROVED' AND commission_free_until IS NULL AND id = ANY($1::uuid[])`,
      [[a.id, b.id, c.id]]
    );
    expect(await freeUntilOf(a.id)).toBe(Date.parse('2026-10-31T00:00:00Z'));
    expect(await freeUntilOf(b.id)).toBeNull();
    expect(await freeUntilOf(c.id)).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });
});

describe('The free_days setting', () => {
  it('GET carries free_days (30 when never set); PUT sets it, keeps it when left out, and refuses bad values', async () => {
    await setFreeDays(null);
    const get = await request(app).get(`${A}/settings/seller-commission`).set(auth(tokens.admin));
    expect(get.status).toBe(200);
    expect(get.body.data).toMatchObject({ free_days: 30, ready: true, default_percent: expect.any(Number), categories: expect.any(Array) });
    const defaultPercent = get.body.data.default_percent as number;

    const put = (body: unknown, token = tokens.admin) => request(app).put(`${A}/settings/seller-commission`).set(auth(token)).send(body as object);
    const saved = await put({ default_percent: defaultPercent, free_days: 14 });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ free_days: 14, default_percent: defaultPercent });
    expect((await pool.query(`SELECT value FROM system_configurations WHERE key = 'seller_commission'`)).rows[0].value).toEqual({ default_percent: defaultPercent, free_days: 14 });

    // free_days left out = unchanged
    const kept = await put({ default_percent: defaultPercent });
    expect(kept.status).toBe(200);
    expect(kept.body.data.free_days).toBe(14);

    // 0 = no free month for new sellers; the maximum is a year
    expect((await put({ default_percent: defaultPercent, free_days: 0 })).body.data.free_days).toBe(0);
    expect((await put({ default_percent: defaultPercent, free_days: 365 })).body.data.free_days).toBe(365);
    for (const bad of [-1, 366, 1.5, '30', null]) {
      const res = await put({ default_percent: defaultPercent, free_days: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await put({ default_percent: defaultPercent, free_days: 30, surprise: true })).status).toBe(400);
    expect((await put({ default_percent: defaultPercent, free_days: 30 }, tokens.staff)).status).toBe(403);
    expect((await put({ default_percent: defaultPercent, free_days: 30 }, opsToken)).status).toBe(200);

    // the audit row names the change
    const audit = await pool.query(
      `SELECT old_values, new_values FROM audit_logs WHERE action = 'SELLER_COMMISSION_UPDATED' AND new_values ? 'free_days' AND created_at >= $1 ORDER BY created_at`,
      [fx.testStart]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(3);
    expect(audit.rows[0].new_values).toMatchObject({ free_days: 14 });
    expect(audit.rows[0].old_values).toMatchObject({ free_days: 30 });
  });
});

describe('Approval starts the free month', () => {
  it('PATCH status APPROVED sets commission_free_until = now + free_days; re-approving keeps the original date', async () => {
    await setFreeDays(30);
    const s = await fx.seller({ status: 'PENDING' });
    expect(await freeUntilOf(s.id)).toBeNull();
    const before = Date.now();
    const res = await patchSeller(s.id, { status: 'APPROVED' });
    expect(res.status).toBe(200);
    const until = Date.parse(res.body.data.seller.commission_free_until);
    expect(until).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);
    expect(res.body.data.seller.commission_free_days_left).toBe(30);
    expect(await freeUntilOf(s.id)).toBe(until);
    const audit = await fx.audits('SELLER_UPDATED', s.id);
    expect(audit[0].new_values).toMatchObject({ status: 'APPROVED', commission_free_until: res.body.data.seller.commission_free_until });

    // suspended and approved again: the month is not given twice
    expect((await patchSeller(s.id, { status: 'SUSPENDED' })).status).toBe(200);
    expect((await patchSeller(s.id, { status: 'APPROVED' })).status).toBe(200);
    expect(await freeUntilOf(s.id)).toBe(until);
  });

  it('uses the setting: another length, and 0 leaves the date empty', async () => {
    await setFreeDays(45);
    const a = await fx.seller({ status: 'PENDING' });
    const resA = await patchSeller(a.id, { status: 'APPROVED' });
    expect(resA.body.data.seller.commission_free_days_left).toBe(45);

    await setFreeDays(0);
    const b = await fx.seller({ status: 'PENDING' });
    const resB = await patchSeller(b.id, { status: 'APPROVED' });
    expect(resB.status).toBe(200);
    expect(resB.body.data.seller).toMatchObject({ commission_free_until: null, commission_free_days_left: null });
    expect(await freeUntilOf(b.id)).toBeNull();
    await setFreeDays(30);
  });

  it('approving with an explicit date uses that date; a seller who gets rejected or stays pending gets none', async () => {
    const s = await fx.seller({ status: 'PENDING' });
    const date = new Date(Date.now() + 10 * DAY).toISOString();
    const res = await patchSeller(s.id, { status: 'APPROVED', commission_free_until: date });
    expect(res.status).toBe(200);
    expect(res.body.data.seller.commission_free_until).toBe(date);
    const r = await fx.seller({ status: 'PENDING' });
    expect((await patchSeller(r.id, { status: 'REJECTED', rejection_reason: 'Not a fit' })).status).toBe(200);
    expect(await freeUntilOf(r.id)).toBeNull();
  });

  it('a seller added by staff as APPROVED (POST /admin/sellers) gets the month; one added as PENDING does not', async () => {
    await setFreeDays(30);
    const phone = `+9476${String(Date.now()).slice(-7)}`;
    const created = await request(app).post(`${A}/sellers`).set(auth(tokens.admin)).send({ shop_name: `SCF Added ${Date.now()}`, phone });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    createdSellerIds.push(created.body.data.seller.id);
    expect(created.body.data.seller.commission_free_days_left).toBe(30);
    expect(await freeUntilOf(created.body.data.seller.id)).not.toBeNull();

    const phone2 = `+9476${String(Date.now() + 1).slice(-7)}`;
    const pending = await request(app).post(`${A}/sellers`).set(auth(tokens.admin)).send({ shop_name: `SCF Added P ${Date.now()}`, phone: phone2, status: 'PENDING' });
    expect(pending.status).toBe(201);
    createdSellerIds.push(pending.body.data.seller.id);
    expect(pending.body.data.seller.commission_free_until).toBeNull();
    const ids = await pool.query('SELECT user_id FROM sellers WHERE id = ANY($1::uuid[])', [createdSellerIds]);
    createdUserIds.push(...ids.rows.map((r) => r.user_id as string));
  });
});

describe('Admin changes the date per seller', () => {
  it('PATCH commission_free_until sets, moves and clears it; the seller rows (list and detail) carry it', async () => {
    const s = await fx.seller({ status: 'APPROVED' });
    const date = new Date(Date.now() + 12.5 * DAY).toISOString();
    const set = await patchSeller(s.id, { commission_free_until: date });
    expect(set.status).toBe(200);
    expect(set.body.data.seller).toMatchObject({ commission_free_until: date, commission_free_days_left: 13 });
    const detail = await getSeller(s.id);
    expect(detail.body.data.seller).toMatchObject({ commission_free_until: date, commission_free_days_left: 13 });
    const list = await request(app).get(`${A}/sellers?search=${encodeURIComponent(s.shop)}`).set(auth(tokens.admin));
    expect(list.body.data.sellers[0]).toMatchObject({ id: s.id, commission_free_until: date, commission_free_days_left: 13 });

    // the same value again is not a change (no audit row)
    const before = (await fx.audits('SELLER_UPDATED', s.id)).length;
    expect((await patchSeller(s.id, { commission_free_until: date })).status).toBe(200);
    expect((await fx.audits('SELLER_UPDATED', s.id)).length).toBe(before);

    // ended: an old date reads as 0 days left
    const past = new Date(Date.now() - 3 * DAY).toISOString();
    expect((await patchSeller(s.id, { commission_free_until: past })).body.data.seller).toMatchObject({ commission_free_until: past, commission_free_days_left: 0 });

    const cleared = await patchSeller(s.id, { commission_free_until: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.seller).toMatchObject({ commission_free_until: null, commission_free_days_left: null });
    expect(await freeUntilOf(s.id)).toBeNull();

    const audits = await fx.audits('SELLER_UPDATED', s.id);
    expect(audits.map((a) => a.new_values.commission_free_until)).toEqual([date, past, null]);
    expect(audits[0].old_values.commission_free_until).toBeNull();
    expect(audits[1].old_values.commission_free_until).toBe(date);
  });

  it('Operations may too; others may not; bad values are 400; an unknown seller is 404', async () => {
    const s = await fx.seller({ status: 'APPROVED' });
    const date = new Date(Date.now() + 5 * DAY).toISOString();
    expect((await patchSeller(s.id, { commission_free_until: date }, opsToken)).status).toBe(200);
    for (const token of [tokens.customer, tokens.rider, tokens.staff, s.token]) {
      expect((await patchSeller(s.id, { commission_free_until: date }, token)).status).toBe(403);
    }
    for (const bad of ['tomorrow', '2026-12-01', 12345, '2026-13-45T00:00:00Z', new Date(Date.now() + 8 * 365 * DAY).toISOString()]) {
      const res = await patchSeller(s.id, { commission_free_until: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await patchSeller('00000000-0000-4000-8000-000000000999', { commission_free_until: date })).status).toBe(404);
    // an offset date is stored as the same moment
    const offset = '2026-11-30T23:59:59+05:30';
    expect((await patchSeller(s.id, { commission_free_until: offset })).status).toBe(200);
    expect(await freeUntilOf(s.id)).toBe(Date.parse(offset));
  });
});

describe('GET /seller/me carries the countdown', () => {
  it('commission_free_until, whole days left (rounded up, never negative) and the setting', async () => {
    await setFreeDays(30);
    const s = await fx.seller({ status: 'APPROVED' });
    const cases: [string | null, number | null][] = [
      [`now() + interval '30 days'`, 30],
      [`now() + interval '29 days 1 hour'`, 30],
      [`now() + interval '1 hour'`, 1],
      [`now() + interval '23 hours'`, 1],
      [`now() + interval '25 hours'`, 2],
      [`now() - interval '1 second'`, 0],
      [`now() - interval '40 days'`, 0],
      [null, null],
    ];
    for (const [expr, days] of cases) {
      await pool.query(`UPDATE sellers SET commission_free_until = ${expr ?? 'NULL'} WHERE id = $1`, [s.id]);
      const res = await me(s);
      expect(res.status).toBe(200);
      expect(res.body.data.commission_free_days_left, String(expr)).toBe(days);
      expect(res.body.data.commission_free_days).toBe(30);
      expect(res.body.data.commission_free_until === null).toBe(expr === null);
    }
    await setFreeDays(10);
    expect((await me(s)).body.data.commission_free_days).toBe(10);
    await setFreeDays(30);
  });

  it('freeDaysLeft() on its own', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    expect(freeDaysLeft(null, now)).toBeNull();
    expect(freeDaysLeft(undefined, now)).toBeNull();
    expect(freeDaysLeft('nope', now)).toBeNull();
    expect(freeDaysLeft(new Date('2026-10-30T10:00:00Z'), now)).toBe(0);
    expect(freeDaysLeft(new Date('2026-10-30T10:00:01Z'), now)).toBe(1);
    expect(freeDaysLeft('2026-11-29T10:00:00Z', now)).toBe(30);
    expect(freeDaysLeft('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('Sales delivered inside the free month carry no commission', () => {
  // free until 2026-03-15T00:00:00Z; own rate 10 %
  const T = '2026-03-15T00:00:00Z';
  let seller: FixtureSeller;
  let jam: Tracked;
  let tea: Tracked;
  let orderFree: PlacedOrder; // 3 jam  = 300, delivered an hour before the end
  let orderLater: PlacedOrder; // 2 jam = 200, delivered an hour after
  let orderExact: PlacedOrder; // 1 jam = 100, delivered exactly at the end: not free
  let orderTea: PlacedOrder; // 4 tea @50 = 200, free

  async function deliverAt(order: PlacedOrder, iso: string) {
    await orders.sourceAll(order);
    expect((await orders.pack(order.id)).status).toBe(200);
    await orders.deliver(order.id);
    await pool.query('UPDATE orders SET delivered_at = $2 WHERE id = $1', [order.id, iso]);
  }

  beforeAll(async () => {
    seller = await fx.seller({ status: 'APPROVED', commission: 10 });
    jam = await orders.product({ onHand: 50 });
    tea = await orders.product({ onHand: 50 });
    await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 100 WHERE id = $1', [jam.productId, seller.id]);
    await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 50 WHERE id = $1', [tea.productId, seller.id]);
    orderFree = await orders.placeOrder([{ product_id: jam.productId, quantity: 3 }]);
    orderLater = await orders.placeOrder([{ product_id: jam.productId, quantity: 2 }]);
    orderExact = await orders.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
    orderTea = await orders.placeOrder([{ product_id: tea.productId, quantity: 4 }]);
    await deliverAt(orderFree, '2026-03-14T23:00:00Z');
    await deliverAt(orderLater, '2026-03-15T01:00:00Z');
    await deliverAt(orderExact, T);
    await deliverAt(orderTea, '2026-03-10T08:00:00Z');
    await pool.query('UPDATE sellers SET commission_free_until = $2 WHERE id = $1', [seller.id, T]);
  });

  type Line = { product_id: string; units: number; gross: number; commission_percent: number; commission: number };
  const lines = (body: { lines: Line[] }, product: Tracked) => body.lines.filter((l) => l.product_id === product.productId).sort((a, b) => a.commission_percent - b.commission_percent);

  it('the statement splits a product into its free part (0 %) and its charged part (the normal rate)', async () => {
    const res = await statementOf(seller);
    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(lines(body, jam)).toEqual([
      { product_id: jam.productId, name: expect.any(String), units: 3, gross: 300, commission_percent: 0, commission: 0 },
      { product_id: jam.productId, name: expect.any(String), units: 3, gross: 300, commission_percent: 10, commission: 30 },
    ]);
    expect(lines(body, tea)).toEqual([{ product_id: tea.productId, name: expect.any(String), units: 4, gross: 200, commission_percent: 0, commission: 0 }]);
    // 300 + 300 + 200 = 800 gross; only the 300 after the end is charged
    expect(body).toMatchObject({ commission_percent: 10, gross: 800, commission: 30, earned: 770, paid: 0, due: 770 });
  });

  it('with no free period every sale is charged at the normal rate, in one line per product (as before 065)', async () => {
    await pool.query('UPDATE sellers SET commission_free_until = NULL WHERE id = $1', [seller.id]);
    const none = await sellerStatement(seller.id);
    expect(none).toMatchObject({ gross: 800, commission: 80, earned: 720 });
    expect(none.lines.map((l) => [l.units, l.commission_percent])).toEqual([[6, 10], [4, 10]]);
    // a date before every sale changes nothing; one after every sale makes everything free
    await pool.query(`UPDATE sellers SET commission_free_until = '2026-01-01T00:00:00Z' WHERE id = $1`, [seller.id]);
    expect((await sellerStatement(seller.id)).commission).toBe(80);
    await pool.query(`UPDATE sellers SET commission_free_until = '2026-04-01T00:00:00Z' WHERE id = $1`, [seller.id]);
    const all = await sellerStatement(seller.id);
    expect(all).toMatchObject({ gross: 800, commission: 0, earned: 800, due: 800 });
    expect(all.lines.every((l) => l.commission_percent === 0 && l.commission === 0)).toBe(true);
    // and before the migration the column is ignored: every sale is charged
    setCommissionFreeColumnForTests(false);
    try {
      expect((await sellerStatement(seller.id)).commission).toBe(80);
    } finally {
      setCommissionFreeColumnForTests(null);
    }
    await pool.query('UPDATE sellers SET commission_free_until = $2 WHERE id = $1', [seller.id, T]);
  });

  it('the date range still works on the split lines (delivery date read in Colombo time)', async () => {
    // orderLater: 2026-03-15 01:00Z = 06:30 Colombo on the 15th; orderFree: 14th 23:00Z = 15th 04:30 Colombo too
    const fifteenth = await sellerStatement(seller.id, { from: '2026-03-15', to: '2026-03-15' });
    expect(fifteenth).toMatchObject({ gross: 600, commission: 30 });
    const tenth = await sellerStatement(seller.id, { from: '2026-03-10', to: '2026-03-10' });
    expect(tenth).toMatchObject({ gross: 200, commission: 0, earned: 200 });
  });

  it('the admin sellers list and detail agree with the statement (earned, due)', async () => {
    await pool.query(`INSERT INTO seller_payouts (seller_id, amount, paid_on) VALUES ($1, 70, '2026-03-20')`, [seller.id]);
    const detail = await getSeller(seller.id);
    expect(detail.status).toBe(200);
    expect(detail.body.data.statement).toMatchObject({ gross: 800, commission: 30, earned: 770, paid: 70, due: 700 });
    expect(detail.body.data.seller.due).toBe(700);
    const list = await request(app).get(`${A}/sellers?search=${encodeURIComponent(seller.shop)}`).set(auth(tokens.admin));
    expect(list.body.data.sellers.find((r: { id: string }) => r.id === seller.id).due).toBe(700);
  });

  it('payouts: a seller can ask for what is due with the free month counted, not a cent more; staff see the same due', async () => {
    const ask = (amount: number) => request(app).post(`${S}/payout-requests`).set(auth(seller.token)).send({ amount, method: 'CASH' });
    const tooMuch = await ask(700.01);
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('AMOUNT_OVER_DUE');
    expect(tooMuch.body.error.details).toMatchObject({ due: 700 });
    const ok = await ask(700);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    const staff = await request(app).get(`${A}/seller-payout-requests?seller_id=${seller.id}`).set(auth(tokens.admin));
    expect(staff.status).toBe(200);
    expect(staff.body.data.payout_requests[0]).toMatchObject({ id: ok.body.data.payout_request.id, amount: 700, due: 700 });

    // paying it records the payout and leaves nothing due
    const paid = await request(app).post(`${A}/seller-payout-requests/${ok.body.data.payout_request.id}/pay`).set(auth(tokens.admin)).send({});
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.data.statement.due).toBe(0);
    expect(paid.body.data.statement.commission).toBe(30);
  });

  it('staff see the payout request due with category / default rates too (not only the own rate)', async () => {
    // a seller with no own rate: the (unset) default applies, so no commission and the due is everything delivered
    const other = await fx.seller({ status: 'APPROVED' });
    await pool.query('UPDATE sellers SET commission_percent = NULL WHERE id = $1', [other.id]);
    const p = await orders.product({ onHand: 10 });
    await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 100 WHERE id = $1', [p.productId, other.id]);
    const o = await orders.placeOrder([{ product_id: p.productId, quantity: 2 }]);
    await deliverAt(o, '2026-03-12T10:00:00Z');
    const rate = (await pool.query(`SELECT COALESCE((SELECT (value->>'default_percent')::numeric FROM system_configurations WHERE key = 'seller_commission'), 0) AS r`)).rows[0].r;
    const expectedDue = Math.round(200 * (1 - Number(rate) / 100) * 100) / 100;
    expect((await sellerStatement(other.id)).due).toBe(expectedDue);
    const created = await request(app)
      .post(`${S}/payout-requests`)
      .set(auth(other.token))
      .send({ amount: expectedDue, method: 'BANK', bank_details: 'Test bank 123' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const staff = await request(app).get(`${A}/seller-payout-requests?seller_id=${other.id}`).set(auth(tokens.admin));
    expect(staff.body.data.payout_requests[0].due).toBe(expectedDue);
  });
});
