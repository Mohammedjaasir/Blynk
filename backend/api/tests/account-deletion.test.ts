import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';
import { dentalFixtures } from './helpers/dental.js';

/**
 * DELETE /me - a customer deletes their own account. Open orders block it;
 * otherwise the row is anonymised and deactivated, addresses, devices and
 * sessions go, and the orders stay for accounting.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00028', phoneBase: '+947709280', name: 'Delete Me Customer' });
const MILK = 'b0000001-0000-0000-0000-000000000001';
const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
const adminToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' });
const dental = dentalFixtures({ idPrefix: 'dd0e1e7e', namePrefix: 'AcctDel Dental', phoneBase: '+9474928' });

describe('DELETE /me (customer account deletion)', () => {
  const ids: string[] = [];

  beforeAll(async () => {
    await pool.query("DELETE FROM riders WHERE user_id::text LIKE 'c0c00028-%'");
    await dental.purge();
    await people.purge(6);
  });

  afterAll(async () => {
    await dental.cleanup();
    await pool.query('DELETE FROM riders WHERE user_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM device_tokens WHERE user_id = ANY($1)', [ids]);
    await pool.query("DELETE FROM otp_verifications WHERE phone LIKE '+947709280%'");
    await people.cleanup();
  });

  it('staff cannot use it (403)', async () => {
    const admin = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' });
    const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(403);
  });

  it('refuses with 409 ACTIVE_ORDERS_EXIST while an order is open', async () => {
    const c = await people.customer(1);
    ids.push(c.id);
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));

    const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVE_ORDERS_EXIST');
    expect(res.body.error.message).toBe('Finish or cancel your open orders first.');
    const user = (await pool.query('SELECT is_active, phone FROM users WHERE id = $1', [c.id])).rows[0];
    expect(user).toEqual({ is_active: true, phone: c.phone });

    // Once the order is finished, deletion goes through.
    await pool.query("UPDATE orders SET order_status = 'CANCELLED' WHERE id = $1", [order.id]);
    const ok = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, data: { deleted: true } });
    // The order is kept for accounting.
    expect((await pool.query('SELECT customer_id FROM orders WHERE id = $1', [order.id])).rows[0].customer_id).toBe(c.id);
  });

  it('anonymises and deactivates; addresses, devices and sessions are removed; audit written', async () => {
    const c = await people.customer(2);
    ids.push(c.id);
    await pool.query("UPDATE users SET email = 'delete-me-28@example.com' WHERE id = $1", [c.id]);
    await pool.query("INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, 'del-test-token-28', 'android')", [c.id]);
    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, md5(random()::text), now() + interval '1 day')",
      [c.id]
    );

    const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const user = (
      await pool.query('SELECT is_active, full_name, email, phone, sms_offers_opted_out_at FROM users WHERE id = $1', [c.id])
    ).rows[0];
    expect(user.is_active).toBe(false);
    expect(user.full_name).toBeNull();
    expect(user.email).toBeNull();
    expect(user.phone).not.toBe(c.phone);
    expect(user.phone).not.toMatch(/^\+94/);
    expect(user.phone.length).toBeLessThanOrEqual(20);
    expect(user.sms_offers_opted_out_at).not.toBeNull();
    expect((await pool.query('SELECT 1 FROM customer_addresses WHERE user_id = $1', [c.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE user_id = $1', [c.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [c.id])).rowCount).toBe(0);
    const audit = (await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'CUSTOMER_ACCOUNT_DELETED'", [c.id])).rows;
    expect(audit).toHaveLength(1);

    // A second delete finds no active account.
    const again = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(again.status).toBe(404);
  });

  it('the old number signs in as a brand-new customer, never the deleted account', async () => {
    authRateLimiter.reset();
    const c = await people.customer(3);
    ids.push(c.id);
    expect((await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`)).status).toBe(200);

    const otp = (await request(app).post('/api/v1/auth/otp/request').send({ phone: c.phone })).body.data.dev_otp;
    const refused = await request(app).post('/api/v1/auth/otp/verify').send({ phone: c.phone, otp, create_account: false });
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect((await pool.query('SELECT 1 FROM users WHERE phone = $1', [c.phone])).rowCount).toBe(0);
  });

  // Security audit 2026-10: a pending rider application goes with the
  // account, so approving it later cannot bring the account back.
  it('removes a waiting rider application with the account', async () => {
    const c = await people.customer(4);
    ids.push(c.id);
    const rider = (
      await pool.query(
        `INSERT INTO riders (user_id, dark_store_id, vehicle_registration_number, is_active, is_available, approval_status, applied_at)
         VALUES ($1, $2, 'DEL-APP-01', false, false, 'PENDING', now()) RETURNING id`,
        [c.id, DARK_STORE]
      )
    ).rows[0].id as string;

    expect((await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM riders WHERE id = $1', [rider])).rowCount).toBe(0);
    const approve = await request(app)
      .post(`/api/v1/admin/rider-applications/${rider}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(404);
    expect((await pool.query('SELECT is_active, role FROM users WHERE id = $1', [c.id])).rows[0]).toEqual({
      is_active: false,
      role: 'CUSTOMER',
    });
  });

  it('approving (or rejecting) an application of a switched-off account is refused: 409 ACCOUNT_DISABLED', async () => {
    const c = await people.customer(5);
    ids.push(c.id);
    const rider = (
      await pool.query(
        `INSERT INTO riders (user_id, dark_store_id, vehicle_registration_number, is_active, is_available, approval_status, applied_at)
         VALUES ($1, $2, 'DEL-APP-02', false, false, 'PENDING', now()) RETURNING id`,
        [c.id, DARK_STORE]
      )
    ).rows[0].id as string;
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [c.id]);

    const approve = await request(app)
      .post(`/api/v1/admin/rider-applications/${rider}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(409);
    expect(approve.body.error.code).toBe('ACCOUNT_DISABLED');
    const reject = await request(app)
      .post(`/api/v1/admin/rider-applications/${rider}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Not now' });
    expect(reject.status).toBe(409);
    expect(reject.body.error.code).toBe('ACCOUNT_DISABLED');
    expect((await pool.query('SELECT is_active, role FROM users WHERE id = $1', [c.id])).rows[0]).toEqual({
      is_active: false,
      role: 'CUSTOMER',
    });
    expect((await pool.query('SELECT approval_status FROM riders WHERE id = $1', [rider])).rows[0].approval_status).toBe('PENDING');
  });

  // Owner, 2026-10-12: deleting the account cancels upcoming dental bookings
  // (no SMS) and removes the patient's name, phone and notes from every one.
  it('cancels upcoming dental bookings without an SMS and removes patient details from all of them', async () => {
    const c = await people.customer(6);
    ids.push(c.id);
    const s = await dental.slot();
    const future = new Date(Date.now() + 3 * 86_400_000);
    const insert = async (start: Date, status: string, n: number) =>
      (
        await pool.query(
          `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, held_by, held_until,
                                     patient_name, patient_phone, patient_notes, idempotency_key)
           VALUES ($1, $2, $3, $3::timestamptz + interval '30 minutes', $4, $2, $5, $6, $7, $8, $9) RETURNING id`,
          [
            s.clinicDoctorId,
            c.id,
            start,
            status,
            status === 'HELD' ? new Date(Date.now() + 5 * 60_000) : null,
            status === 'HELD' ? null : 'Nimal Perera',
            status === 'HELD' ? null : '+94771230099',
            status === 'HELD' ? null : 'Upper molar',
            `acctdel_${Date.now()}_${n}`,
          ]
        )
      ).rows[0].id as string;
    const confirmed = await insert(future, 'CONFIRMED', 1);
    const held = await insert(new Date(future.getTime() + 3_600_000), 'HELD', 2);
    const visited = await insert(new Date(Date.now() - 7 * 86_400_000), 'CONFIRMED', 3);
    const cancelled = await insert(new Date(future.getTime() + 7_200_000), 'CANCELLED_BY_CLINIC', 4);

    expect((await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`)).status).toBe(200);

    const rows = (
      await pool.query(
        'SELECT id, status, held_until, patient_name, patient_phone, patient_notes, cancelled_by FROM appointments WHERE customer_id = $1',
        [c.id]
      )
    ).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[confirmed]).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', held_until: null, cancelled_by: c.id });
    expect(byId[held]).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', held_until: null });
    expect(byId[visited].status).toBe('CONFIRMED'); // a past visit stays as it was
    expect(byId[cancelled].status).toBe('CANCELLED_BY_CLINIC');
    for (const r of rows) {
      expect(r).toMatchObject({ patient_name: null, patient_phone: null, patient_notes: null });
    }
    const history = (
      await pool.query(
        'SELECT appointment_id, old_status, new_status FROM appointment_status_history WHERE appointment_id = ANY($1)',
        [[confirmed, held]]
      )
    ).rows;
    expect(history).toHaveLength(2);
    expect(history).toEqual(
      expect.arrayContaining([
        { appointment_id: confirmed, old_status: 'CONFIRMED', new_status: 'CANCELLED_BY_CUSTOMER' },
        { appointment_id: held, old_status: 'HELD', new_status: 'CANCELLED_BY_CUSTOMER' },
      ])
    );
    // No SMS (or any notification) to the patient.
    const sent = await pool.query('SELECT 1 FROM notifications WHERE idempotency_key LIKE ANY($1)', [
      [`dental_appointment_${confirmed}_%`, `dental_appointment_${held}_%`],
    ]);
    expect(sent.rowCount).toBe(0);
    const audit = (
      await pool.query("SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'CUSTOMER_ACCOUNT_DELETED'", [c.id])
    ).rows[0];
    expect(audit.new_values.appointments_cancelled).toBe(2);
  });
});
