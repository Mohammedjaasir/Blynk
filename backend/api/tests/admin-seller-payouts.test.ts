import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth, users, stockFixtures } from './helpers/stock.js';
import { sellerFixtures } from './helpers/seller-fixtures.js';

/**
 * Seller portal, staff side: the payouts ledger and what is due. A seller's product is approved
 * through the staff API, stocked, ordered and delivered through the normal order flow; the seller is
 * then owed price x quantity less their commission, and every payout Admin records brings `due` down.
 */
const app = createApp();
const fx = sellerFixtures('pay');
const orders = stockFixtures(app, 'SELPAY-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const A = '/api/v1/admin';

const postPayout = (sellerId: string, body: unknown, token = tokens.admin) =>
  request(app).post(`${A}/sellers/${sellerId}/payouts`).set(auth(token)).send(body as object);
const delPayout = (sellerId: string, payoutId: string, token = tokens.admin) =>
  request(app).delete(`${A}/sellers/${sellerId}/payouts/${payoutId}`).set(auth(token));
const detail = (sellerId: string) => request(app).get(`${A}/sellers/${sellerId}`).set(auth(tokens.admin));
const listedDue = async (s: { id: string; phone: string }) =>
  (await request(app).get(`${A}/sellers?search=${encodeURIComponent(s.phone)}`).set(auth(tokens.admin))).body.data.sellers.find(
    (x: { id: string }) => x.id === s.id
  ).due as number;

beforeAll(async () => {
  await orders.setup();
  await fx.setup();
});
afterAll(async () => {
  // orders first (they reference the seller's products), then the seller fixtures
  await orders.cleanup();
  await fx.cleanup();
});

describe('Payouts ledger', () => {
  it('records a payout: 201, the entry and the new statement, audited; rules for amount, note, date', async () => {
    const s = await fx.seller();
    for (const bad of [{}, { amount: 0 }, { amount: -5 }, { amount: 10.005 }, { amount: '10' }, { amount: 100_000_000 }]) {
      expect((await postPayout(s.id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await postPayout(s.id, { amount: 10, paid_on: '2026-02-30' })).status).toBe(400);
    expect((await postPayout(s.id, { amount: 10, paid_on: '24/10/2026' })).status).toBe(400);
    expect((await postPayout(s.id, { amount: 10, note: 'n'.repeat(201) })).status).toBe(400);
    expect((await postPayout(s.id, { amount: 10, surprise: 1 })).status).toBe(400);
    expect((await postPayout('00000000-0000-4000-8000-000000000999', { amount: 10 })).status).toBe(404);
    expect((await postPayout('nope', { amount: 10 })).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM seller_payouts WHERE seller_id = $1', [s.id])).rows[0].n).toBe(0);

    const res = await postPayout(s.id, { amount: 1500.5, note: ' Bank transfer ', paid_on: '2026-10-20' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.payout).toEqual({ id: expect.any(String), amount: 1500.5, note: 'Bank transfer', paid_on: '2026-10-20' });
    expect(res.body.data.statement).toMatchObject({ paid: 1500.5, due: -1500.5 });
    expect(res.body.data.statement.payouts).toEqual([res.body.data.payout]);
    expect((await fx.row('SELECT created_by FROM seller_payouts WHERE id = $1', [res.body.data.payout.id])).created_by).toBe(users.admin.id);

    const audit = await fx.audits('SELLER_PAYOUT_RECORDED', s.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(users.admin.id);
    expect(audit[0].new_values).toMatchObject({ payout_id: res.body.data.payout.id, amount: 1500.5, note: 'Bank transfer', paid_on: '2026-10-20' });

    // no date: today in Colombo; no note: null
    const today = await postPayout(s.id, { amount: 20 });
    expect(today.body.data.payout.paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today.body.data.payout.note).toBeNull();
    expect(today.body.data.statement.paid).toBe(1520.5);
  });

  it('works for a seller in any status', async () => {
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED'] as const) {
      const s = await fx.seller({ status });
      expect((await postPayout(s.id, { amount: 5 })).status).toBe(201);
    }
  });

  it('deleting a payout: removes it, returns the statement, audited; wrong seller / unknown id is 404', async () => {
    const s = await fx.seller();
    const other = await fx.seller();
    const keep = (await postPayout(s.id, { amount: 100, paid_on: '2026-10-01' })).body.data.payout;
    const mistake = (await postPayout(s.id, { amount: 250, note: 'typo', paid_on: '2026-10-02' })).body.data.payout;

    expect((await delPayout(other.id, mistake.id)).status).toBe(404);
    expect((await delPayout(s.id, '00000000-0000-4000-8000-000000000999')).status).toBe(404);
    expect((await delPayout(s.id, 'nope')).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM seller_payouts WHERE seller_id = $1', [s.id])).rows[0].n).toBe(2);

    const res = await delPayout(s.id, mistake.id, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.statement).toMatchObject({ paid: 100, due: -100 });
    expect(res.body.data.statement.payouts).toEqual([keep]);
    const audit = await fx.audits('SELLER_PAYOUT_DELETED', s.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].old_values).toMatchObject({ payout_id: mistake.id, amount: 250, note: 'typo', paid_on: '2026-10-02' });
    expect((await delPayout(s.id, mistake.id)).status).toBe(404);
  });

  it('only staff may record or delete', async () => {
    const s = await fx.seller();
    const p = (await postPayout(s.id, { amount: 10 })).body.data.payout;
    for (const token of [tokens.customer, s.token, tokens.rider]) {
      expect((await postPayout(s.id, { amount: 10 }, token)).status).toBe(403);
      expect((await delPayout(s.id, p.id, token)).status).toBe(403);
    }
    expect((await request(app).delete(`${A}/sellers/${s.id}/payouts/${p.id}`)).status).toBe(401);
    expect((await pool.query('SELECT count(*)::int AS n FROM seller_payouts WHERE seller_id = $1', [s.id])).rows[0].n).toBe(1);
  });
});

describe('What is due after deliveries', () => {
  it('delivered sales less commission less payouts; the list, the detail and each payout agree', async () => {
    const s = await fx.seller({ commission: 10 });
    const sub = await fx.submission(s.id, { price: 100, name: `Payout item ${fx.stamp}` });
    const approved = await request(app).post(`${A}/seller-submissions/${sub}/approve`).set(auth(tokens.admin)).send({ selling_price: 150 });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const productId = approved.body.data.product.id as string;

    // stock arrives (Inventory), a customer orders 2, it is delivered
    expect((await orders.adjust(productId, 'PURCHASE_RESTOCK', 5)).status).toBe(200);
    const order = await orders.placeOrder([{ product_id: productId, quantity: 2 }]);
    await orders.sourceAll(order);
    expect((await orders.pack(order.id)).status).toBe(200);

    // not delivered yet: nothing is owed
    expect(await listedDue(s)).toBe(0);
    await orders.deliver(order.id);

    // 2 x LKR 100 = 200; 10% commission = 20; earned 180
    const d = await detail(s.id);
    expect(d.body.data.statement).toMatchObject({
      commission_percent: 10,
      gross: 200,
      commission: 20,
      earned: 180,
      paid: 0,
      due: 180,
      lines: [{ product_id: productId, units: 2, gross: 200 }],
    });
    expect(d.body.data.seller.due).toBe(180);
    expect(await listedDue(s)).toBe(180);

    const first = await postPayout(s.id, { amount: 50 });
    expect(first.body.data.statement).toMatchObject({ earned: 180, paid: 50, due: 130 });
    expect(await listedDue(s)).toBe(130);
    const second = await postPayout(s.id, { amount: 130, note: 'settled' });
    expect(second.body.data.statement.due).toBe(0);
    expect((await detail(s.id)).body.data.seller.due).toBe(0);

    expect((await delPayout(s.id, first.body.data.payout.id)).body.data.statement).toMatchObject({ paid: 130, due: 50 });
    expect(await listedDue(s)).toBe(50);
    expect((await detail(s.id)).body.data.seller.products_live).toBe(1);
  });
});
