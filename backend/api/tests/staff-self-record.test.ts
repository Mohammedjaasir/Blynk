import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Owner decision 2026-10-12 (security audit 2026-10): an ADMIN or OPERATIONS
 * person who also delivers (their own riders row) cannot record their own
 * cash hand-ins, add/change/delete their own pay adjustments, change their
 * own pay, delete their own hand-ins, or adjust their own Blynk Points.
 * Someone else does it. Deleting a hand-in is audited.
 *
 * Own throwaway users on +9477093200x; every row made here is removed.
 */
const app = createApp();
const PREFIX = '+947709320';
const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

type Person = { id: string; riderId: string; token: string };
const people: Record<'ops' | 'admin' | 'rider', Person> = {} as never;

async function cleanup() {
  const users = `(SELECT id FROM users WHERE phone LIKE '${PREFIX}%')`;
  const riders = `(SELECT id FROM riders WHERE user_id IN ${users})`;
  await pool.query(
    `DELETE FROM audit_logs WHERE actor_user_id IN ${users} OR entity_id IN ${users} OR entity_id IN ${riders};
     DELETE FROM cash_handins WHERE rider_id IN ${riders};
     DELETE FROM rider_pay_adjustments WHERE rider_id IN ${riders};
     DELETE FROM points_ledger WHERE customer_id IN ${users};
     DELETE FROM riders WHERE user_id IN ${users};
     DELETE FROM users WHERE id IN ${users};`
  );
}

async function person(n: number, role: 'OPERATIONS' | 'ADMIN' | 'RIDER'): Promise<Person> {
  const phone = `${PREFIX}${n}`;
  const id = (
    await pool.query(`INSERT INTO users (phone, full_name, role) VALUES ($1, $2, $3) RETURNING id`, [phone, `Self Record ${n}`, role])
  ).rows[0].id as string;
  const riderId = (
    await pool.query(
      `INSERT INTO riders (user_id, dark_store_id, vehicle_registration_number, is_active, is_available, approval_status)
       VALUES ($1, $2, $3, true, false, 'APPROVED') RETURNING id`,
      [id, DARK_STORE, `SELF-${n}`]
    )
  ).rows[0].id as string;
  return { id, riderId, token: generateAccessToken({ id, phone, role }) };
}

function expectSelfRefusal(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(res.body.error.code).toBe('CANNOT_RECORD_FOR_SELF');
  expect(res.body.error.message).toMatch(/another staff member/i);
}

beforeAll(async () => {
  await cleanup();
  people.ops = await person(1, 'OPERATIONS');
  people.admin = await person(2, 'ADMIN');
  people.rider = await person(3, 'RIDER');
});

afterAll(cleanup);

describe('Staff cannot record for themselves', () => {
  it('cash hand-ins: refused for your own riders row, fine for another rider', async () => {
    for (const me of [people.ops, people.admin]) {
      expectSelfRefusal(
        await request(app).post('/api/v1/admin/cash/handins').set(auth(me.token)).send({ rider_id: me.riderId, amount: 100 })
      );
    }
    const other = await request(app)
      .post('/api/v1/admin/cash/handins')
      .set(auth(people.ops.token))
      .send({ rider_id: people.rider.riderId, amount: 100 });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    expect((await pool.query('SELECT count(*)::int AS n FROM cash_handins WHERE rider_id = ANY($1)', [[people.ops.riderId, people.admin.riderId]])).rows[0].n).toBe(0);
  });

  it('pay adjustments: no create, change or delete on your own', async () => {
    expectSelfRefusal(
      await request(app)
        .post(`/api/v1/admin/riders/${people.ops.riderId}/adjustments`)
        .set(auth(people.ops.token))
        .send({ amount_lkr: 500, reason: 'BONUS' })
    );
    // One someone else made for the Operations person.
    const made = await request(app)
      .post(`/api/v1/admin/riders/${people.ops.riderId}/adjustments`)
      .set(auth(people.admin.token))
      .send({ amount_lkr: -50, reason: 'LATE' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.data.adjustment.id as string;
    expectSelfRefusal(await request(app).patch(`/api/v1/admin/rider-adjustments/${id}`).set(auth(people.ops.token)).send({ amount_lkr: 0.5 }));
    expectSelfRefusal(await request(app).delete(`/api/v1/admin/rider-adjustments/${id}`).set(auth(people.ops.token)));
    expect((await pool.query('SELECT amount_lkr FROM rider_pay_adjustments WHERE id = $1', [id])).rows[0].amount_lkr).toBe('-50.00');
  });

  it('pay settings: no change to your own pay', async () => {
    expectSelfRefusal(
      await request(app).patch(`/api/v1/admin/riders/${people.ops.riderId}/pay`).set(auth(people.ops.token)).send({ pay_type: 'COMPANY' })
    );
    const other = await request(app)
      .patch(`/api/v1/admin/riders/${people.rider.riderId}/pay`)
      .set(auth(people.ops.token))
      .send({ pay_type: 'COMPANY' });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });

  it('hand-in deletion: not your own; another one is deleted and audited with what it was', async () => {
    const mine = (
      await pool.query(
        `INSERT INTO cash_handins (rider_id, amount, handin_date, note, recorded_by_user_id) VALUES ($1, 75, CURRENT_DATE, 'mine', $2) RETURNING id`,
        [people.admin.riderId, people.ops.id]
      )
    ).rows[0].id as string;
    expectSelfRefusal(await request(app).delete(`/api/v1/admin/cash/handins/${mine}`).set(auth(people.admin.token)));
    expect((await pool.query('SELECT 1 FROM cash_handins WHERE id = $1', [mine])).rowCount).toBe(1);

    const theirs = (
      await pool.query(
        `INSERT INTO cash_handins (rider_id, amount, handin_date, note, recorded_by_user_id) VALUES ($1, 120.5, '2026-10-01', 'typo', $2) RETURNING id`,
        [people.rider.riderId, people.ops.id]
      )
    ).rows[0].id as string;
    const del = await request(app).delete(`/api/v1/admin/cash/handins/${theirs}`).set(auth(people.admin.token));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const audit = (
      await pool.query("SELECT actor_user_id, entity_type, old_values FROM audit_logs WHERE entity_id = $1 AND action = 'CASH_HANDIN_DELETED'", [theirs])
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: people.admin.id, entity_type: 'CASH_HANDIN' });
    expect(audit[0].old_values).toEqual({
      rider_id: people.rider.riderId,
      amount: 120.5,
      handin_date: '2026-10-01',
      note: 'typo',
      recorded_by_user_id: people.ops.id,
    });
  });

  it('Blynk Points: no adjusting your own balance', async () => {
    expectSelfRefusal(
      await request(app)
        .post(`/api/v1/admin/customers/${people.ops.id}/points/adjust`)
        .set(auth(people.ops.token))
        .send({ points: 500, reason: 'Testing myself' })
    );
    expect((await pool.query('SELECT count(*)::int AS n FROM points_ledger WHERE customer_id = $1', [people.ops.id])).rows[0].n).toBe(0);
  });
});
