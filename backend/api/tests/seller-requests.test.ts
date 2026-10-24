import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { setSellerRequestTablesForTests } from '../src/modules/sellers/seller-requests.guard.js';
import { payoutDeclinedSms, payoutPaidSms, stockReceivedSms } from '../src/modules/sellers/seller-requests.service.js';
import { auth, stockFixtures, tokens, users } from './helpers/stock.js';
import { sellerFixtures, type FixtureSeller } from './helpers/seller-fixtures.js';

/**
 * Seller stock notes, payout requests and the seller dashboard (migration 057; owner 2026-10-24:
 * "sellers send stock updates and payout requests themselves", "best sellers this week so sellers
 * know what to restock"), commission by category (seller.commission.ts) and invite-only sellers
 * (POST /admin/sellers). Real local Postgres; products are approved through the staff API, stock
 * moves through the stock ledger, orders go through the normal order flow and are delivered.
 * Everything made here is removed again (sellers, products, orders, notifications, audit rows,
 * test categories, the commission setting).
 */
const app = createApp();
const fx = sellerFixtures('req');
const orders = stockFixtures(app, 'SELREQ-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const A = '/api/v1/admin';
const S = '/api/v1/seller';
const stamp = String(Date.now()).slice(-5);
/** Numbers for sellers added through POST /admin/sellers (+9475 + stamp + nn). */
const invitePhone = (n: number) => `+9475${stamp}${String(n).padStart(2, '0')}`;
const extraCategories: string[] = [];
let savedCommission: unknown;

const seller = (s: FixtureSeller) => ({
  get: (path: string) => request(app).get(`${S}${path}`).set(auth(s.token)),
  post: (path: string, body: object) => request(app).post(`${S}${path}`).set(auth(s.token)).send(body),
  del: (path: string) => request(app).delete(`${S}${path}`).set(auth(s.token)),
});
const staffGet = (path: string, token = tokens.admin) => request(app).get(`${A}${path}`).set(auth(token));
const staffPost = (path: string, body: object = {}, token = tokens.admin) => request(app).post(`${A}${path}`).set(auth(token)).send(body);

/** A live product of the seller (approved through the staff API: TRACKED stock row at 0). */
async function liveProduct(s: FixtureSeller, opts: { price?: number; selling?: number; categoryId?: string; name?: string } = {}) {
  const sub = await fx.submission(s.id, { price: opts.price ?? 100, name: opts.name });
  const res = await staffPost(`/seller-submissions/${sub}/approve`, {
    selling_price: opts.selling ?? 150,
    ...(opts.categoryId ? { category_id: opts.categoryId } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.product.id as string;
}

const stockOf = async (productId: string) =>
  (await pool.query(`SELECT quantity_on_hand FROM inventory WHERE product_id = $1 AND variant_id IS NULL`, [productId])).rows[0]?.quantity_on_hand as
    | number
    | undefined;

/** Places one order of these lines and delivers it (stock must be there). */
async function deliveredOrder(lines: { product_id: string; quantity: number }[]) {
  const order = await orders.placeOrder(lines);
  await orders.sourceAll(order);
  expect((await orders.pack(order.id)).status).toBe(200);
  await orders.deliver(order.id);
  return order;
}

async function newCategory(name: string, parentId: string | null = null) {
  const id = (
    await pool.query(`INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id`, [
      `${name} ${stamp}`,
      `req-${name.toLowerCase().replace(/\W+/g, '-')}-${stamp}-${extraCategories.length}`,
      parentId,
    ])
  ).rows[0].id as string;
  extraCategories.push(id);
  return id;
}

beforeAll(async () => {
  await orders.setup();
  await fx.setup();
  savedCommission = (await pool.query(`SELECT value FROM system_configurations WHERE key = 'seller_commission'`)).rows[0]?.value;
});

afterEach(() => setSellerRequestTablesForTests(null));

afterAll(async () => {
  setSellerRequestTablesForTests(null);
  await orders.cleanup();
  // sellers added through POST /admin/sellers
  const invited = (await pool.query(`SELECT id FROM users WHERE phone LIKE $1`, [`+9475${stamp}%`])).rows.map((r) => r.id as string);
  if (invited.length) {
    const ids = (await pool.query('SELECT id FROM sellers WHERE user_id = ANY($1::uuid[])', [invited])).rows.map((r) => r.id as string);
    await pool.query(`DELETE FROM audit_logs WHERE action LIKE 'SELLER\\_%' AND entity_id = ANY($1::uuid[])`, [ids]);
    await pool.query('DELETE FROM sellers WHERE id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [invited]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [invited]);
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'SELLER_COMMISSION_UPDATED' AND created_at >= $1`, [fx.testStart]);
  if (savedCommission === undefined) await pool.query(`DELETE FROM system_configurations WHERE key = 'seller_commission'`);
  else await pool.query(`UPDATE system_configurations SET value = $1 WHERE key = 'seller_commission'`, [JSON.stringify(savedCommission)]);
  await fx.cleanup(); // products (stock notes cascade), sellers (requests cascade), notifications, users
  if (extraCategories.length) {
    await pool.query('UPDATE categories SET parent_id = NULL WHERE id = ANY($1::uuid[])', [extraCategories]);
    await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [extraCategories]);
  }
  const queued = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE created_at >= $1 AND notification_type LIKE 'SELLER\\_%' AND status = 'QUEUED'`, [
    fx.testStart,
  ]);
  expect(queued.rows[0].n).toBe(0);
});

// ----------------------------------------------------------------------------

describe('Before migration 057', () => {
  it('stock notes and payout requests answer 503 SELLER_REQUESTS_NOT_READY (never 500); the statement still works on the own rate', async () => {
    const s = await fx.seller({ commission: 5 });
    setSellerRequestTablesForTests(false);
    const product = '00000000-0000-4000-8000-000000000001';
    for (const res of [
      await seller(s).post('/stock-notes', { product_id: product, quantity: 2 }),
      await seller(s).get('/stock-notes'),
      await seller(s).del(`/stock-notes/${product}`),
      await seller(s).post('/payout-requests', { amount: 10, method: 'CASH' }),
      await seller(s).get('/payout-requests'),
      await seller(s).del(`/payout-requests/${product}`),
      await staffGet('/seller-stock-notes'),
      await staffPost(`/seller-stock-notes/${product}/receive`, { received_quantity: 1 }),
      await staffPost(`/seller-stock-notes/${product}/cancel`),
      await staffGet('/seller-payout-requests'),
      await staffPost(`/seller-payout-requests/${product}/pay`),
      await staffPost(`/seller-payout-requests/${product}/decline`, { reason: 'Not now' }),
      await request(app).put(`${A}/settings/seller-commission`).set(auth(tokens.admin)).send({ default_percent: 2 }),
      await request(app).patch(`${A}/sellers/${s.id}`).set(auth(tokens.admin)).send({ commission_percent: null }),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(503);
      expect(res.body.error.code).toBe('SELLER_REQUESTS_NOT_READY');
    }
    const detail = await staffGet(`/sellers/${s.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.statement.commission_percent).toBe(5);
    expect((await seller(s).get('/insights')).status).toBe(200);
    expect((await seller(s).get('/me')).body.data.commission_rule).toEqual({ override_percent: 5, default_percent: 0 });
  });
});

describe('Who may use what', () => {
  it('seller routes are for sellers, staff routes for Admin and Operations', async () => {
    const s = await fx.seller();
    for (const token of [tokens.customer, tokens.rider, tokens.admin]) {
      expect((await request(app).get(`${S}/stock-notes`).set(auth(token))).status).toBe(403);
      expect((await request(app).get(`${S}/insights`).set(auth(token))).status).toBe(403);
    }
    for (const token of [s.token, tokens.customer, tokens.rider, tokens.staff]) {
      expect((await staffGet('/seller-stock-notes', token)).status).toBe(403);
      expect((await staffGet('/seller-payout-requests', token)).status).toBe(403);
      expect((await staffGet('/settings/seller-commission', token)).status).toBe(403);
      expect((await staffPost('/sellers', { shop_name: 'Nope', phone: invitePhone(99) }, token)).status).toBe(403);
    }
    expect((await request(app).get(`${S}/payout-requests`)).status).toBe(401);
    expect((await request(app).get(`${A}/seller-payout-requests`)).status).toBe(401);
    expect((await staffGet('/seller-stock-notes', opsToken)).status).toBe(200);
    expect((await staffGet('/seller-payout-requests', opsToken)).status).toBe(200);
  });
});

describe('Stock notes', () => {
  it('a seller announces goods; staff receive what arrived onto the tracked stock through the ledger; SMS and audit', async () => {
    const s = await fx.seller();
    const other = await fx.seller();
    const pending = await fx.seller({ status: 'PENDING' });
    const productId = await liveProduct(s, { name: `Note jam ${fx.stamp}` });
    const othersProduct = await liveProduct(other);

    // rules
    expect((await seller(pending).post('/stock-notes', { product_id: productId, quantity: 5 })).body.error.code).toBe('SELLER_NOT_APPROVED');
    const foreign = await seller(s).post('/stock-notes', { product_id: othersProduct, quantity: 5 });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('PRODUCT_NOT_FOUND');
    for (const bad of [
      { product_id: productId, quantity: 0 },
      { product_id: productId, quantity: 10_001 },
      { product_id: productId, quantity: 1.5 },
      { product_id: productId, quantity: '5' },
      { product_id: 'nope', quantity: 5 },
      { product_id: productId, quantity: 5, expected_on: '2026-02-30' },
      { product_id: productId, quantity: 5, expected_on: '2020-01-01' },
      { product_id: productId, quantity: 5, expected_on: '2099-01-01' },
      { product_id: productId, quantity: 5, note: 'n'.repeat(301) },
      { product_id: productId, quantity: 5, surprise: true },
    ]) {
      expect((await seller(s).post('/stock-notes', bad)).status, JSON.stringify(bad)).toBe(400);
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    const created = await seller(s).post('/stock-notes', { product_id: productId, quantity: 20, expected_on: today, note: ' Tuesday morning ' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const note = created.body.data.stock_note;
    expect(note).toMatchObject({
      product_id: productId,
      product_name: `Note jam ${fx.stamp}`,
      quantity: 20,
      expected_on: today,
      note: 'Tuesday morning',
      status: 'SENT',
      received_quantity: null,
    });
    expect(note.seller).toBeUndefined();
    expect((await seller(s).get('/stock-notes')).body.data.stock_notes.map((n: { id: string }) => n.id)).toEqual([note.id]);
    expect((await seller(other).get('/stock-notes')).body.data.stock_notes).toEqual([]);

    // staff queue: all sellers, with the seller and the stock now
    const queue = await staffGet(`/seller-stock-notes?seller_id=${s.id}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.stock_notes).toEqual([
      expect.objectContaining({ id: note.id, status: 'SENT', stock_on_hand: 0, seller: { id: s.id, shop_name: s.shop, phone: s.phone, email: null } }),
    ]);
    expect((await staffGet('/seller-stock-notes')).body.data.stock_notes.some((n: { id: string }) => n.id === note.id)).toBe(true);

    // receive: 18 of the 20 arrived
    for (const bad of [{}, { received_quantity: 0 }, { received_quantity: 2.5 }, { received_quantity: 10_001 }]) {
      expect((await staffPost(`/seller-stock-notes/${note.id}/receive`, bad)).status).toBe(400);
    }
    const received = await staffPost(`/seller-stock-notes/${note.id}/receive`, { received_quantity: 18 }, opsToken);
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body.data.stock_on_hand).toBe(18);
    expect(received.body.data.stock_note).toMatchObject({ status: 'RECEIVED', quantity: 20, received_quantity: 18, received_at: expect.any(String) });
    expect(await stockOf(productId)).toBe(18);
    const ledger = (
      await pool.query(
        `SELECT a.adjustment_type, a.quantity_delta, a.previous_quantity, a.new_quantity, a.created_by_user_id, a.notes
           FROM inventory_adjustments a JOIN inventory i ON i.id = a.inventory_id WHERE i.product_id = $1`,
        [productId]
      )
    ).rows;
    expect(ledger).toEqual([
      expect.objectContaining({ adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 18, previous_quantity: 0, new_quantity: 18, created_by_user_id: users.admin.id }),
    ]);
    expect(ledger[0].notes).toContain(s.shop);
    const audit = await fx.audits('SELLER_STOCK_RECEIVED', note.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ seller_id: s.id, product_id: productId, quantity: 20, received_quantity: 18, stock_on_hand: 18 });
    expect(await fx.texts(s.userId, 'SELLER_STOCK_RECEIVED')).toEqual([
      { notification_type: 'SELLER_STOCK_RECEIVED', recipient: s.phone, payload: { text: stockReceivedSms(`Note jam ${fx.stamp}`, 18) } },
    ]);

    // once only; the seller can no longer cancel it
    expect((await staffPost(`/seller-stock-notes/${note.id}/receive`, { received_quantity: 1 })).body.error.code).toBe('STOCK_NOTE_NOT_OPEN');
    expect((await seller(s).del(`/stock-notes/${note.id}`)).body.error.code).toBe('STOCK_NOTE_NOT_OPEN');
    expect((await seller(other).del(`/stock-notes/${note.id}`)).status).toBe(404);
    expect((await staffPost(`/seller-stock-notes/00000000-0000-4000-8000-000000000999/receive`, { received_quantity: 1 })).status).toBe(404);
  });

  it('the seller cancels a note on its way; staff cancel one that never came; an untracked product is refused', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    const a = (await seller(s).post('/stock-notes', { product_id: productId, quantity: 3 })).body.data.stock_note;
    const b = (await seller(s).post('/stock-notes', { product_id: productId, quantity: 4 })).body.data.stock_note;
    expect(a.expected_on).toBeNull();

    const cancelled = await seller(s).del(`/stock-notes/${a.id}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.stock_note).toMatchObject({ id: a.id, status: 'CANCELLED', cancelled_at: expect.any(String) });
    expect((await seller(s).del(`/stock-notes/${a.id}`)).body.error.code).toBe('STOCK_NOTE_NOT_OPEN');

    // staff: untracked first (refused, nothing changes), then cancel
    await pool.query(`UPDATE inventory SET tracking_mode = 'UNTRACKED' WHERE product_id = $1`, [productId]);
    const untracked = await staffPost(`/seller-stock-notes/${b.id}/receive`, { received_quantity: 4 });
    expect(untracked.status).toBe(409);
    expect(untracked.body.error.code).toBe('PRODUCT_NOT_TRACKED');
    await pool.query(`UPDATE inventory SET tracking_mode = 'TRACKED' WHERE product_id = $1`, [productId]);
    const staffCancel = await staffPost(`/seller-stock-notes/${b.id}/cancel`, { reason: 'Never arrived' });
    expect(staffCancel.status).toBe(200);
    expect(staffCancel.body.data.stock_note.status).toBe('CANCELLED');
    expect((await fx.audits('SELLER_STOCK_NOTE_CANCELLED', b.id))[0].new_values).toMatchObject({ seller_id: s.id, reason: 'Never arrived' });
    expect(await stockOf(productId)).toBe(0);

    const statuses = (await seller(s).get('/stock-notes?status=CANCELLED')).body.data.stock_notes.map((n: { status: string }) => n.status);
    expect(statuses).toEqual(['CANCELLED', 'CANCELLED']);
    expect((await staffGet(`/seller-stock-notes?seller_id=${s.id}`)).body.data.stock_notes).toEqual([]);
    expect((await staffGet(`/seller-stock-notes?status=ALL&seller_id=${s.id}`)).body.data.stock_notes).toHaveLength(2);
    expect(await fx.texts(s.userId, 'SELLER_STOCK_RECEIVED')).toEqual([]); // a cancelled note texts nobody
  });
});

describe('Payout requests and insights after real deliveries', () => {
  let s: FixtureSeller;
  let jam = '';
  let tea = '';
  let orderId = '';

  beforeAll(async () => {
    s = await fx.seller({ commission: 0 });
    jam = await liveProduct(s, { price: 100, selling: 150, name: `Jam ${fx.stamp}` });
    tea = await liveProduct(s, { price: 50, selling: 80, name: `Tea ${fx.stamp}` });
    // stock arrives through stock notes
    for (const [productId, qty] of [
      [jam, 10],
      [tea, 4],
    ] as const) {
      const n = (await seller(s).post('/stock-notes', { product_id: productId, quantity: qty })).body.data.stock_note;
      expect((await staffPost(`/seller-stock-notes/${n.id}/receive`, { received_quantity: qty })).status).toBe(200);
    }
    // 2 jam (2 x 100) + 3 tea (3 x 50): gross 350, nothing kept (0%): due 350
    orderId = (
      await deliveredOrder([
        { product_id: jam, quantity: 2 },
        { product_id: tea, quantity: 3 },
      ])
    ).id;
  });

  it('insights: best sellers with stock, days of stock left and a restock hint', async () => {
    for (const bad of ['?days=0', '?days=91', '?days=abc', '?days=1.5']) {
      expect((await seller(s).get(`/insights${bad}`)).status, bad).toBe(400);
    }
    const res = await seller(s).get('/insights');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    expect(res.body.data.period.to).toBe(today);
    expect(Date.parse(res.body.data.period.to) - Date.parse(res.body.data.period.from)).toBe(6 * 86_400_000);
    expect(res.body.data.top).toEqual([
      // tea: 3 sold, 1 left: 1 / (3 / 7) = 2.3 days; 1 < 3 so restock
      { product_id: tea, name: `Tea ${fx.stamp}`, image_url: null, units: 3, units_prev_period: 0, gross: 150, stock_on_hand: 1, days_of_stock_left: 2.3, restock_suggested: true },
      // jam: 2 sold, 8 left: 8 / (2 / 7) = 28 days
      { product_id: jam, name: `Jam ${fx.stamp}`, image_url: null, units: 2, units_prev_period: 0, gross: 200, stock_on_hand: 8, days_of_stock_left: 28, restock_suggested: false },
    ]);
    expect(res.body.data.totals).toEqual({ units: 5, gross: 350, units_prev: 0 });

    // the same sales 8 days ago fall in the previous week
    await pool.query(`UPDATE orders SET delivered_at = now() - interval '8 days' WHERE id = $1`, [orderId]);
    try {
      const week = (await seller(s).get('/insights?days=7')).body.data;
      expect(week.totals).toEqual({ units: 0, gross: 0, units_prev: 5 });
      expect(week.top.find((l: { product_id: string }) => l.product_id === tea)).toMatchObject({
        units: 0,
        units_prev_period: 3,
        days_of_stock_left: null,
        restock_suggested: false,
      });
      const month = (await seller(s).get('/insights?days=30')).body.data;
      expect(month.totals).toEqual({ units: 5, gross: 350, units_prev: 0 });
      expect(month.top[0]).toMatchObject({ product_id: tea, days_of_stock_left: 10 });
    } finally {
      await pool.query(`UPDATE orders SET delivered_at = now() WHERE id = $1`, [orderId]);
    }
    // another seller sees nothing of it
    const other = await fx.seller();
    expect((await seller(other).get('/insights')).body.data).toMatchObject({ top: [], totals: { units: 0, gross: 0, units_prev: 0 } });
  });

  it('payout requests: at most what is due, one waiting at a time, withdraw, decline, pay (creates the payout, due goes down)', async () => {
    const pending = await fx.seller({ status: 'PENDING' });
    expect((await seller(pending).post('/payout-requests', { amount: 10, method: 'CASH' })).body.error.code).toBe('SELLER_NOT_APPROVED');
    for (const bad of [
      {},
      { amount: 0, method: 'CASH' },
      { amount: -1, method: 'CASH' },
      { amount: 10.005, method: 'CASH' },
      { amount: 10, method: 'CHEQUE' },
      { amount: 10, method: 'BANK', bank_details: 'b'.repeat(301) },
      { amount: 10, method: 'CASH', extra: 1 },
    ]) {
      expect((await seller(s).post('/payout-requests', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const over = await seller(s).post('/payout-requests', { amount: 350.01, method: 'CASH' });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('AMOUNT_OVER_DUE');
    expect(over.body.error.details).toMatchObject({ due: 350 });

    // ask, then a second one is refused while it waits; withdraw
    const first = await seller(s).post('/payout-requests', { amount: 150, method: 'BANK', bank_details: 'BOC 1234567, Colombo', note: 'Thanks' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.payout_request).toMatchObject({
      amount: 150,
      method: 'BANK',
      bank_details: 'BOC 1234567, Colombo',
      note: 'Thanks',
      status: 'REQUESTED',
      payout_id: null,
      paid_on: null,
    });
    const again = await seller(s).post('/payout-requests', { amount: 10, method: 'CASH' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PAYOUT_REQUEST_OPEN');
    const mine = await seller(s).get('/payout-requests');
    expect(mine.body.data).toMatchObject({ due: 350, payout_requests: [{ id: first.body.data.payout_request.id, status: 'REQUESTED' }] });
    const queue = await staffGet(`/seller-payout-requests?seller_id=${s.id}`);
    expect(queue.body.data.payout_requests).toEqual([
      expect.objectContaining({ id: first.body.data.payout_request.id, due: 350, seller: { id: s.id, shop_name: s.shop, phone: s.phone, email: null } }),
    ]);
    const withdrawn = await seller(s).del(`/payout-requests/${first.body.data.payout_request.id}`);
    expect(withdrawn.body.data.payout_request.status).toBe('WITHDRAWN');
    expect((await seller(s).del(`/payout-requests/${first.body.data.payout_request.id}`)).body.error.code).toBe('PAYOUT_REQUEST_NOT_OPEN');
    expect((await seller(s).get('/payout-requests')).body.data.payout_requests).toEqual([]);
    expect((await staffPost(`/seller-payout-requests/${first.body.data.payout_request.id}/pay`)).body.error.code).toBe('PAYOUT_REQUEST_NOT_OPEN');

    // decline (needs a reason)
    const second = (await seller(s).post('/payout-requests', { amount: 120, method: 'CASH' })).body.data.payout_request;
    expect((await staffPost(`/seller-payout-requests/${second.id}/decline`, { reason: 'no' })).status).toBe(400);
    const declined = await staffPost(`/seller-payout-requests/${second.id}/decline`, { reason: 'Come to the store on Friday' }, opsToken);
    expect(declined.status).toBe(200);
    expect(declined.body.data.payout_request).toMatchObject({ status: 'DECLINED', decline_reason: 'Come to the store on Friday' });
    expect((await fx.audits('SELLER_PAYOUT_REQUEST_DECLINED', second.id))[0].new_values).toMatchObject({ seller_id: s.id, amount: 120 });

    // a manual payment meanwhile makes the request bigger than what is due: refused
    const third = (await seller(s).post('/payout-requests', { amount: 300, method: 'CASH' })).body.data.payout_request;
    expect((await staffPost(`/sellers/${s.id}/payouts`, { amount: 100, note: 'Cash at the counter' })).status).toBe(201);
    const tooMuch = await staffPost(`/seller-payout-requests/${third.id}/pay`);
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('AMOUNT_OVER_DUE');
    expect((await staffPost(`/seller-payout-requests/${third.id}/decline`, { reason: 'Part was paid in cash' })).status).toBe(200);

    // pay: the payout entry is made and linked; due 250 -> 0
    const fourth = (await seller(s).post('/payout-requests', { amount: 250, method: 'BANK' })).body.data.payout_request;
    for (const bad of [{ paid_on: '2026-02-30' }, { note: 'n'.repeat(201) }, { amount: 5 }]) {
      expect((await staffPost(`/seller-payout-requests/${fourth.id}/pay`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const paid = await staffPost(`/seller-payout-requests/${fourth.id}/pay`, { paid_on: '2026-10-20', note: 'Transfer ref 991' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.data.payout).toEqual({ id: expect.any(String), amount: 250, note: 'Transfer ref 991', paid_on: '2026-10-20' });
    expect(paid.body.data.payout_request).toMatchObject({ status: 'PAID', payout_id: paid.body.data.payout.id, paid_on: '2026-10-20', due: 0 });
    expect(paid.body.data.statement).toMatchObject({ gross: 350, earned: 350, paid: 350, due: 0 });
    expect((await staffGet(`/sellers/${s.id}`)).body.data.seller.due).toBe(0);
    expect((await fx.audits('SELLER_PAYOUT_RECORDED', s.id)).map((a) => a.new_values.payout_request_id ?? null)).toEqual([null, fourth.id]);
    expect((await fx.audits('SELLER_PAYOUT_REQUEST_PAID', fourth.id))[0].new_values).toMatchObject({ payout_id: paid.body.data.payout.id, amount: 250 });
    expect((await staffPost(`/seller-payout-requests/${fourth.id}/pay`)).body.error.code).toBe('PAYOUT_REQUEST_NOT_OPEN');

    // nothing is due now
    const none = await seller(s).post('/payout-requests', { amount: 1, method: 'CASH' });
    expect(none.body.error.code).toBe('AMOUNT_OVER_DUE');
    expect(none.body.error.details).toMatchObject({ due: 0 });

    // SMS: paid and declined ones
    const texts = (await fx.texts(s.userId)).filter((t) => t.notification_type.startsWith('SELLER_PAYOUT'));
    expect(texts.map((t) => t.payload.text)).toEqual([
      payoutDeclinedSms(120, 'Come to the store on Friday'),
      payoutDeclinedSms(300, 'Part was paid in cash'),
      payoutPaidSms(250, 'BANK'),
    ]);
    // the full history for staff
    const all = (await staffGet(`/seller-payout-requests?status=ALL&seller_id=${s.id}`)).body.data.payout_requests.map((r: { status: string }) => r.status);
    expect(all.sort()).toEqual(['DECLINED', 'DECLINED', 'PAID', 'WITHDRAWN']);
  });
});

describe('Commission by category, per seller and by default', () => {
  it('own rate > category > main category > default, line by line; the list, the detail and the statement agree', async () => {
    const own = await newCategory('Req pickles');
    const main = await newCategory('Req sweets');
    const sub = await newCategory('Req toffee', main);
    const plain = await newCategory('Req plain');

    // settings: default 2%, pickles 4%, sweets 3% (toffee has none, so 3% from its main category)
    const bad = await request(app).put(`${A}/settings/seller-commission`).set(auth(tokens.admin)).send({ default_percent: 101 });
    expect(bad.status).toBe(400);
    const unknown = await request(app)
      .put(`${A}/settings/seller-commission`)
      .set(auth(tokens.admin))
      .send({ default_percent: 2, categories: [{ category_id: '00000000-0000-4000-8000-000000000999', percent: 1 }] });
    expect(unknown.body.error.code).toBe('CATEGORY_NOT_FOUND');
    const saved = await request(app)
      .put(`${A}/settings/seller-commission`)
      .set(auth(opsToken))
      .send({
        default_percent: 2,
        categories: [
          { category_id: own, percent: 4 },
          { category_id: main, percent: 3 },
          { category_id: sub, percent: null },
        ],
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.default_percent).toBe(2);
    const rates = new Map((saved.body.data.categories as { category_id: string; percent: number | null; parent_id: string | null }[]).map((c) => [c.category_id, c]));
    expect(rates.get(own)!.percent).toBe(4);
    expect(rates.get(sub)).toMatchObject({ percent: null, parent_id: main });
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'SELLER_COMMISSION_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`, [fx.testStart])).rows[0];
    expect(audit.new_values).toMatchObject({ default_percent: 2 });
    expect(audit.new_values.categories).toHaveLength(2);
    expect((await staffGet('/settings/seller-commission')).body.data).toMatchObject({ default_percent: 2, ready: true });

    // a seller without an own rate, one product per category; another with an own rate of 1%
    const s = await fx.seller();
    await pool.query('UPDATE sellers SET commission_percent = NULL WHERE id = $1', [s.id]);
    const fixed = await fx.seller({ commission: 1 });
    const pPickle = await liveProduct(s, { price: 100, categoryId: own, name: `Pickle ${fx.stamp}` });
    const pToffee = await liveProduct(s, { price: 100, categoryId: sub, name: `Toffee ${fx.stamp}` });
    const pPlain = await liveProduct(s, { price: 100, categoryId: plain, name: `Plain ${fx.stamp}` });
    const pFixed = await liveProduct(fixed, { price: 100, categoryId: own, name: `Fixed ${fx.stamp}` });
    for (const p of [pPickle, pToffee, pPlain, pFixed]) expect((await orders.adjust(p, 'PURCHASE_RESTOCK', 5)).status).toBe(200);
    await deliveredOrder([
      { product_id: pPickle, quantity: 2 },
      { product_id: pToffee, quantity: 1 },
      { product_id: pPlain, quantity: 3 },
      { product_id: pFixed, quantity: 1 },
    ]);

    const d = (await staffGet(`/sellers/${s.id}`)).body.data;
    const line = (id: string) => d.statement.lines.find((l: { product_id: string }) => l.product_id === id);
    expect(line(pPickle)).toMatchObject({ units: 2, gross: 200, commission_percent: 4, commission: 8 });
    expect(line(pToffee)).toMatchObject({ units: 1, gross: 100, commission_percent: 3, commission: 3 });
    expect(line(pPlain)).toMatchObject({ units: 3, gross: 300, commission_percent: 2, commission: 6 });
    expect(d.statement).toMatchObject({ commission_percent: null, gross: 600, commission: 17, earned: 583, due: 583 });
    expect(d.seller).toMatchObject({ commission_percent: null, due: 583 });
    const listed = (await staffGet(`/sellers?search=${encodeURIComponent(s.phone)}`)).body.data.sellers.find((x: { id: string }) => x.id === s.id);
    expect(listed.due).toBe(583);
    // the seller sees the same, and the rule
    expect((await seller(s).get('/statement')).body.data).toMatchObject({ commission: 17, due: 583 });
    expect((await seller(s).get('/me')).body.data.commission_rule).toEqual({ override_percent: null, default_percent: 2 });

    const f = (await staffGet(`/sellers/${fixed.id}`)).body.data.statement;
    expect(f).toMatchObject({ commission_percent: 1, gross: 100, commission: 1, earned: 99 });

    // an own rate for the first seller overrides every category; null goes back to the categories
    const set = await request(app).patch(`${A}/sellers/${s.id}`).set(auth(tokens.admin)).send({ commission_percent: 10 });
    expect(set.status).toBe(200);
    expect((await staffGet(`/sellers/${s.id}`)).body.data.statement).toMatchObject({ commission_percent: 10, commission: 60, earned: 540 });
    const cleared = await request(app).patch(`${A}/sellers/${s.id}`).set(auth(tokens.admin)).send({ commission_percent: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.seller.commission_percent).toBeNull();
    expect((await fx.audits('SELLER_UPDATED', s.id)).at(-1).new_values).toMatchObject({ commission_percent: null });
    expect((await staffGet(`/sellers/${s.id}`)).body.data.statement.commission).toBe(17);

    // before migration 057 only the own rate counts (none = 0)
    setSellerRequestTablesForTests(false);
    expect((await staffGet(`/sellers/${s.id}`)).body.data.statement).toMatchObject({ commission: 0, earned: 600 });
    setSellerRequestTablesForTests(null);
  });
});

describe('Adding sellers (invite-only)', () => {
  it('staff add a seller with a phone: approved by default, no own rate, audited; validation', async () => {
    for (const bad of [
      {},
      { shop_name: 'A', phone: invitePhone(1) },
      { shop_name: 'Good Shop', phone: '12345' },
      { shop_name: 'Good Shop', phone: invitePhone(1), status: 'REJECTED' },
      { shop_name: 'Good Shop', phone: invitePhone(1), commission_percent: 101 },
      { shop_name: 'Good Shop', phone: invitePhone(1), email: 'x@y.z' },
    ]) {
      expect((await staffPost('/sellers', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const res = await staffPost('/sellers', {
      shop_name: ' Kandy Crafts ',
      phone: `0${invitePhone(1).slice(3, 5)} ${invitePhone(1).slice(5, 8)} ${invitePhone(1).slice(8)}`,
      contact_name: 'Nimal',
      address: '5 Peradeniya Rd, Kandy',
    }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.seller).toMatchObject({
      shop_name: 'Kandy Crafts',
      phone: invitePhone(1),
      email: null,
      contact_name: 'Nimal',
      address: '5 Peradeniya Rd, Kandy',
      status: 'APPROVED',
      commission_percent: null,
      products_live: 0,
      due: 0,
    });
    const id = res.body.data.seller.id as string;
    const user = (await pool.query('SELECT u.role, u.email, u.staff_password_hash, u.phone_hash FROM users u JOIN sellers s ON s.user_id = u.id WHERE s.id = $1', [id])).rows[0];
    expect(user).toMatchObject({ role: 'SELLER', email: null, staff_password_hash: null });
    expect(user.phone_hash).not.toBeNull();
    const audit = await fx.audits('SELLER_CREATED', id);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ shop_name: 'Kandy Crafts', phone: invitePhone(1), status: 'APPROVED' });

    const waiting = await staffPost('/sellers', { shop_name: 'Later Shop', phone: invitePhone(2), status: 'PENDING', commission_percent: 4 });
    expect(waiting.status).toBe(201);
    expect(waiting.body.data.seller).toMatchObject({ status: 'PENDING', commission_percent: 4 });
  });

  it('a number that already has any account is 409 PHONE_IN_USE with its role', async () => {
    await pool.query(`INSERT INTO users (phone, role) VALUES ($1, 'CUSTOMER'), ($2, 'OPERATIONS')`, [invitePhone(10), invitePhone(11)]);
    expect((await staffPost('/sellers', { shop_name: 'Taken Shop', phone: invitePhone(12) })).status).toBe(201);
    for (const [n, role] of [
      [10, 'CUSTOMER'],
      [11, 'OPERATIONS'],
      [12, 'SELLER'],
    ] as const) {
      const res = await staffPost('/sellers', { shop_name: 'Second Shop', phone: invitePhone(n) });
      expect(res.status, role).toBe(409);
      expect(res.body.error.code).toBe('PHONE_IN_USE');
      expect(res.body.error.details).toMatchObject({ role });
    }
    // the seeded customer too
    const seeded = await staffPost('/sellers', { shop_name: 'Second Shop', phone: users.customer.phone });
    expect(seeded.body.error.details).toMatchObject({ role: 'CUSTOMER' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM sellers WHERE shop_name = 'Second Shop'`)).rows[0].n).toBe(0);
  });

  it('PATCH changes the sign-in phone (same 409 rule) and the contact details; the seller signs in with the new number', async () => {
    const created = (await staffPost('/sellers', { shop_name: 'Moving Shop', phone: invitePhone(20) })).body.data.seller;
    await pool.query(`INSERT INTO users (phone, role) VALUES ($1, 'RIDER')`, [invitePhone(21)]);
    const taken = await request(app).patch(`${A}/sellers/${created.id}`).set(auth(tokens.admin)).send({ phone: invitePhone(21) });
    expect(taken.status).toBe(409);
    expect(taken.body.error.details).toMatchObject({ role: 'RIDER' });

    const res = await request(app)
      .patch(`${A}/sellers/${created.id}`)
      .set(auth(tokens.admin))
      .send({ phone: invitePhone(22), contact_name: 'Sunil', address: '', shop_name: 'Moved Shop' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({ phone: invitePhone(22), contact_name: 'Sunil', address: null, shop_name: 'Moved Shop' });
    const audit = (await fx.audits('SELLER_UPDATED', created.id)).at(-1);
    expect(audit.old_values).toMatchObject({ phone: invitePhone(20) });
    expect(audit.new_values).toMatchObject({ phone: invitePhone(22), contact_name: 'Sunil' });

    // the SMS-code sign-in on the seller site works with the new number only
    const { authRateLimiter } = await import('../src/modules/auth/auth.rate-limiter.js');
    authRateLimiter.reset();
    const asked = await request(app).post('/api/v1/auth/otp/request').send({ phone: invitePhone(22) });
    const signedIn = await request(app).post('/api/v1/auth/otp/verify').send({ phone: invitePhone(22), otp: asked.body.data.dev_otp, app: 'seller' });
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    expect(signedIn.body.data.user).toMatchObject({ role: 'SELLER', phone: invitePhone(22) });
    authRateLimiter.reset();
    const oldAsk = await request(app).post('/api/v1/auth/otp/request').send({ phone: invitePhone(20) });
    const old = await request(app).post('/api/v1/auth/otp/verify').send({ phone: invitePhone(20), otp: oldAsk.body.data.dev_otp, app: 'seller' });
    expect(old.status).toBe(403);
    expect(old.body.error.code).toBe('SELLER_NOT_REGISTERED');
    await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE phone LIKE $1)', [`+9475${stamp}%`]);
    await pool.query('DELETE FROM otp_verifications WHERE phone LIKE $1', [`+9475${stamp}%`]);
  });
});
