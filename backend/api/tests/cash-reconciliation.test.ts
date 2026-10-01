import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { reconciliationStatus } from '../src/modules/cash/index.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';

/**
 * Rider cash hand-ins and the per-rider daily reconciliation (migration
 * 019). A rider of this file's own delivers two orders today; what they
 * collected is compared with what staff record they handed in.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-CSH-');
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });
const today = DateTime.now().setZone('Asia/Colombo').toISODate()!;
const yesterday = DateTime.now().setZone('Asia/Colombo').minus({ days: 1 }).toISODate()!;

let rider: { riderId: string; token: string };
let collected = 0;

const handin = (body: object, token = tokens.admin) => request(app).post('/api/v1/admin/cash/handins').set(auth(token)).send(body);
const recon = (date = today, token = tokens.admin) =>
  request(app).get(`/api/v1/admin/cash/reconciliation?date=${date}`).set(auth(token));
const mine = (res: request.Response) => res.body.data.riders.find((r: { rider_id: string }) => r.rider_id === rider.riderId);

beforeAll(async () => {
  await fx.setup();
  const product = (await fx.product({ tracked: false })).productId;
  rider = await fx.tempRider('cash');
  for (const qty of [1, 2]) {
    const order = await fx.placeOrder([{ product_id: product, quantity: qty }]);
    expect((await fx.pack(order.id)).status).toBe(200);
    await fx.deliver(order.id, rider);
    collected += (await fx.orderRow(order.id)).total;
  }
}, 60_000);

afterAll(async () => {
  if (rider) await pool.query('DELETE FROM cash_handins WHERE rider_id = $1', [rider.riderId]);
  await fx.cleanup();
});

describe('Cash reconciliation', () => {
  it('classifies a difference', () => {
    expect(reconciliationStatus(-0.01)).toBe('SHORT');
    expect(reconciliationStatus(0)).toBe('BALANCED');
    expect(reconciliationStatus(5)).toBe('OVER');
  });

  it('shows what the rider collected today before anything is handed in', async () => {
    const res = await recon();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ date: today, timezone: 'Asia/Colombo' });
    expect(mine(res)).toMatchObject({ deliveries: 2, collected, handed_in: 0, difference: -collected, status: 'SHORT' });
  });

  it('records hand-ins (Operations too) and reconciles short, balanced and over', async () => {
    const first = await handin({ rider_id: rider.riderId, amount: 100, note: 'Morning run' }, opsToken);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.handin).toMatchObject({ rider_id: rider.riderId, amount: 100, handin_date: today, note: 'Morning run' });
    expect(mine(await recon())).toMatchObject({ handed_in: 100, difference: Number((100 - collected).toFixed(2)), status: 'SHORT' });

    expect((await handin({ rider_id: rider.riderId, amount: Number((collected - 100).toFixed(2)) })).status).toBe(201);
    expect(mine(await recon())).toMatchObject({ handins: 2, handed_in: collected, difference: 0, status: 'BALANCED' });

    expect((await handin({ rider_id: rider.riderId, amount: 20 })).status).toBe(201);
    expect(mine(await recon())).toMatchObject({ difference: 20, status: 'OVER' });

    const list = await request(app).get(`/api/v1/admin/cash/handins?date=${today}&rider_id=${rider.riderId}`).set(auth(opsToken));
    expect(list.status).toBe(200);
    expect(list.body.data.handins).toHaveLength(3);
  });

  it('keeps each day apart', async () => {
    expect((await handin({ rider_id: rider.riderId, amount: 50, handin_date: yesterday })).status).toBe(201);
    expect(mine(await recon(yesterday))).toMatchObject({ collected: 0, handed_in: 50, difference: 50, status: 'OVER' });
  });

  it('an admin deletes a mistaken hand-in; Operations cannot', async () => {
    const h = (await handin({ rider_id: rider.riderId, amount: 1 })).body.data.handin;
    expect((await request(app).delete(`/api/v1/admin/cash/handins/${h.id}`).set(auth(opsToken))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/cash/handins/${h.id}`).set(auth(tokens.admin))).status).toBe(200);
    expect((await request(app).delete(`/api/v1/admin/cash/handins/${h.id}`).set(auth(tokens.admin))).status).toBe(404);
  });

  it('validates hand-ins', async () => {
    const future = DateTime.now().setZone('Asia/Colombo').plus({ days: 2 }).toISODate();
    for (const body of [
      { rider_id: rider.riderId, amount: 0 },
      { rider_id: rider.riderId, amount: -5 },
      { rider_id: rider.riderId, amount: 10, handin_date: future },
      { rider_id: rider.riderId, amount: 10, handin_date: '2026-02-30' },
      { rider_id: 'nope', amount: 10 },
    ]) {
      expect((await handin(body)).status, JSON.stringify(body)).toBe(400);
    }
    const unknown = await handin({ rider_id: 'f0000001-0000-0000-0000-00000000dead', amount: 10 });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('RIDER_NOT_FOUND');
  });

  it('is for ADMIN and OPERATIONS only', async () => {
    for (const t of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await recon(today, t)).status).toBe(403);
      expect((await handin({ rider_id: rider.riderId, amount: 1 }, t)).status).toBe(403);
    }
    expect((await recon(today, opsToken)).status).toBe(200);
  });
});
