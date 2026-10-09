import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { hashOtp } from '../src/modules/auth/otp.service.js';
import { NotificationTemplates } from '../src/modules/notifications/notification.templates.js';
import { RIDER_APPROVED_SMS, riderRejectedSms } from '../src/modules/riders/rider.applications.js';

/**
 * Rider applications and approval (migration 029, owner 2026-10-07): riders
 * apply in the Rider app (phone + SMS code), Operations or Admin approve or
 * reject under Rider requests, and riders sign in with phone + SMS code only.
 * Also: riders are no longer created from Staff accounts, and an ADMIN may
 * reset another ADMIN's password.
 *
 * Own throwaway users (phones +94770009400-9, emails @rider-apps.blynk.test);
 * every row made here is removed afterwards.
 */
const PREFIX = '+9477000940';
const local = (n: string) => `077000940${n}`;
const EMAIL_DOMAIN = '@rider-apps.blynk.test';
const PASSWORD = 'Rider-apps-2026';

describe('Rider applications and approval', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const seededRider = 'a0000001-0000-0000-0000-000000000002';
  const seededAdmin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const seededPacker = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // UNTRACKED: no stock moves

  const ids = { admin: '', ops: '', otherAdmin: '', customer: '' };
  const tokens = {
    admin: '',
    ops: '',
    packer: generateAccessToken(seededPacker),
    customer: generateAccessToken(customer),
    seededAdmin: generateAccessToken(seededAdmin),
  };
  const createdOrders: string[] = [];
  let addressId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const requestOtp = (n: string) => request(app).post('/api/v1/auth/otp/request').send({ phone: local(n) });
  /** Sign-in from the Rider app. */
  const verify = (n: string, otp: string) =>
    request(app).post('/api/v1/auth/otp/verify').send({ phone: local(n), otp, create_account: false, app: 'rider' });
  /** Sign-in from the customer app (one number, one account: it also shops). */
  const shopVerify = (n: string, otp: string) => request(app).post('/api/v1/auth/otp/verify').send({ phone: local(n), otp });
  const apply = (body: Record<string, unknown>) => request(app).post('/api/v1/riders/applications').send(body);
  const application = (n: string, otp: string, extra: Record<string, unknown> = {}) => ({
    phone: local(n),
    otp,
    full_name: `Applicant ${n}`,
    vehicle_type: 'SCOOTER',
    vehicle_registration_number: `wp-app-${n}`,
    emergency_contact_phone: '077 123 4567',
    ...extra,
  });
  const list = (token: string, query = '') => request(app).get(`/api/v1/admin/rider-applications${query}`).set(auth(token));
  const approve = (token: string, id: string) =>
    request(app).post(`/api/v1/admin/rider-applications/${id}/approve`).set(auth(token));
  const reject = (token: string, id: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/admin/rider-applications/${id}/reject`).set(auth(token)).send(body);
  const riderOf = async (n: string) =>
    (
      await pool.query(
        `SELECT r.*, u.role, u.email, u.staff_password_hash, u.full_name, u.id AS uid
           FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = $1`,
        [`${PREFIX}${n}`]
      )
    ).rows[0];
  /** A known, fresh code for a number (as if requested), without an SMS. */
  async function plantOtp(n: string, code = '246810') {
    await pool.query(`UPDATE otp_verifications SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL`, [
      `${PREFIX}${n}`,
    ]);
    await pool.query(
      `INSERT INTO otp_verifications (phone, otp_hash, purpose, attempts_count, max_attempts, expires_at)
       VALUES ($1, $2, 'LOGIN', 0, 5, now() + interval '5 minutes')`,
      [`${PREFIX}${n}`, await hashOtp(code)]
    );
    return code;
  }

  async function cleanup() {
    const users = `(SELECT id FROM users WHERE phone LIKE '${PREFIX}%' OR email LIKE '%${EMAIL_DOMAIN}')`;
    const riders = `(SELECT id FROM riders WHERE user_id IN ${users})`;
    if (createdOrders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query(`DELETE FROM customer_addresses WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '${PREFIX}%')`);
    await pool.query(
      `DELETE FROM notifications WHERE user_id IN ${users} OR recipient LIKE '${PREFIX}%';
       DELETE FROM audit_logs WHERE entity_id IN ${users} OR entity_id IN ${riders} OR actor_user_id IN ${users};
       DELETE FROM cash_handins WHERE rider_id IN ${riders};
       DELETE FROM deliveries WHERE rider_id IN ${riders};
       DELETE FROM riders WHERE user_id IN ${users};
       DELETE FROM refresh_tokens WHERE user_id IN ${users};
       DELETE FROM otp_verifications WHERE phone LIKE '${PREFIX}%';
       DELETE FROM users WHERE id IN ${users};`
    );
  }

  beforeAll(async () => {
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, email, full_name, role, staff_password_hash) VALUES
         ('${PREFIX}0', 'admin${EMAIL_DOMAIN}', 'RA Admin', 'ADMIN', crypt('${PASSWORD}', gen_salt('bf', 4))),
         ('${PREFIX}1', 'ops${EMAIL_DOMAIN}', 'RA Operator', 'OPERATIONS', NULL),
         ('${PREFIX}2', NULL, 'RA Customer', 'CUSTOMER', NULL),
         ('${PREFIX}3', 'other-admin${EMAIL_DOMAIN}', 'RA Other Admin', 'ADMIN', crypt('${PASSWORD}', gen_salt('bf', 4)))
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    Object.assign(ids, { admin: id('0'), ops: id('1'), customer: id('2'), otherAdmin: id('3') });
    tokens.admin = generateAccessToken({ id: ids.admin, phone: `${PREFIX}0`, role: 'ADMIN' });
    tokens.ops = generateAccessToken({ id: ids.ops, phone: `${PREFIX}1`, role: 'OPERATIONS' });
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Rider applications test', 'Rider Applications Test', '+94771234567', 'No. 9, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  beforeEach(() => authRateLimiter.reset());
  afterAll(cleanup);

  async function packedOrder() {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set(auth(tokens.customer))
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as { id: string };
    createdOrders.push(order.id);
    const pending = await pool.query(`SELECT id FROM order_items WHERE order_id = $1 AND item_status = 'PENDING'`, [order.id]);
    for (const { id } of pending.rows) {
      await request(app)
        .post(`/api/v1/admin/orders/${order.id}/items/${id}/source`)
        .set(auth(tokens.packer))
        .send({ actual_unit_cost: 450 });
    }
    const packed = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(auth(tokens.packer))
      .send({ status: 'PACKED' });
    expect(packed.status).toBe(200);
    return order;
  }

  // ==========================================================================
  describe('migration 029', () => {
    it('adds the approval columns; riders made before it are APPROVED', async () => {
      const cols = await pool.query(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_name = 'riders' AND column_name IN ('approval_status', 'applied_at', 'reviewed_at', 'reviewed_by', 'rejection_reason')`
      );
      expect(cols.rows.map((c) => c.column_name).sort()).toEqual(
        ['applied_at', 'approval_status', 'rejection_reason', 'reviewed_at', 'reviewed_by'].sort()
      );
      expect(cols.rows.find((c) => c.column_name === 'approval_status')).toMatchObject({ is_nullable: 'NO' });
      const seeded = await pool.query(`SELECT approval_status, applied_at FROM riders WHERE user_id = $1`, [seededRider]);
      expect(seeded.rows[0]).toEqual({ approval_status: 'APPROVED', applied_at: null });
      await expect(pool.query(`UPDATE riders SET approval_status = 'MAYBE' WHERE user_id = $1`, [seededRider])).rejects.toThrow();
    });
  });

  // ==========================================================================
  describe('applying', () => {
    let riderId = '';

    it('validates the body', async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [application('5', '123456', { full_name: 'A' }), 'full_name'],
        [application('5', '123456', { full_name: 'x'.repeat(129) }), 'full_name'],
        [application('5', '123456', { vehicle_type: 'TRUCK' }), 'vehicle_type'],
        [application('5', '123456', { vehicle_registration_number: '' }), 'vehicle_registration_number'],
        [application('5', '123456', { emergency_contact_phone: '12345' }), 'emergency_contact_phone'],
        [application('5', '12ab56'), 'otp'],
        [application('5', '123456', { phone: '12345' }), 'phone'],
      ];
      for (const [body, field] of cases) {
        const res = await apply(body);
        expect(res.status, field).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.map((d: { field: string }) => d.field), field).toContain(field);
      }
    });

    it('checks the code exactly like sign-in (INVALID_OTP, OTP_EXPIRED, OTP_MAX_ATTEMPTS_EXCEEDED)', async () => {
      const none = await apply(application('5', '123456'));
      expect(none.status).toBe(401);
      expect(none.body.error.code).toBe('INVALID_OTP');

      const otp = (await requestOtp('5')).body.data.dev_otp as string;
      const wrong = otp === '000000' ? '111111' : '000000';
      const bad = await apply(application('5', wrong));
      expect(bad.status).toBe(401);
      expect(bad.body.error).toMatchObject({ code: 'INVALID_OTP', details: { remaining_attempts: expect.any(Number) } });

      await pool.query(`UPDATE otp_verifications SET expires_at = now() - interval '1 minute' WHERE phone = $1 AND consumed_at IS NULL`, [
        `${PREFIX}5`,
      ]);
      const expired = await apply(application('5', otp));
      expect(expired.status).toBe(410);
      expect(expired.body.error.code).toBe('OTP_EXPIRED');

      await pool.query(`UPDATE otp_verifications SET expires_at = now() + interval '5 minutes', attempts_count = max_attempts WHERE phone = $1 AND consumed_at IS NULL`, [
        `${PREFIX}5`,
      ]);
      const locked = await apply(application('5', otp));
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('OTP_MAX_ATTEMPTS_EXCEEDED');
      expect((await pool.query(`SELECT 1 FROM users WHERE phone = $1`, [`${PREFIX}5`])).rowCount).toBe(0);
    });

    it('a new number: 201 PENDING, a CUSTOMER account (until approved) with no email or password, switched off, no tokens', async () => {
      const otp = (await requestOtp('5')).body.data.dev_otp as string;
      const res = await apply(application('5', otp));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        success: true,
        data: { application: { status: 'PENDING', full_name: 'Applicant 5', phone: `${PREFIX}5` } },
      });
      expect(JSON.stringify(res.body)).not.toContain('token');

      const r = await riderOf('5');
      riderId = r.id;
      expect(r).toMatchObject({
        role: 'CUSTOMER',
        email: null,
        staff_password_hash: null,
        full_name: 'Applicant 5',
        approval_status: 'PENDING',
        is_active: false,
        is_available: false,
        vehicle_type: 'SCOOTER',
        vehicle_registration_number: 'WP-APP-5',
        emergency_contact_phone: '+94771234567',
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
      });
      expect(r.applied_at).toBeInstanceOf(Date);
      const consumed = await pool.query(`SELECT 1 FROM otp_verifications WHERE phone = $1 AND consumed_at IS NULL`, [`${PREFIX}5`]);
      expect(consumed.rowCount).toBe(0);
      const audit = await pool.query(`SELECT action, actor_user_id, new_values FROM audit_logs WHERE entity_id = $1`, [riderId]);
      expect(audit.rows).toEqual([
        expect.objectContaining({ action: 'RIDER_APPLIED', actor_user_id: r.uid, new_values: expect.objectContaining({ reapplied: false }) }),
      ]);
      // The emergency contact is optional.
      const otp6 = (await requestOtp('6')).body.data.dev_otp as string;
      const six = await apply(application('6', otp6, { emergency_contact_phone: undefined }));
      expect(six.status).toBe(201);
      expect((await riderOf('6')).emergency_contact_phone).toBeNull();
    });

    it('while PENDING: applying again is 409, the Rider app refuses sign-in (403), the customer app lets them shop', async () => {
      const req = await requestOtp('5');
      expect(req.status).toBe(200);

      const again = await apply(application('5', await plantOtp('5')));
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: 'APPLICATION_PENDING',
        message: 'Your application is already waiting for approval.',
      });

      const signIn = await verify('5', '246810');
      expect(signIn.status).toBe(403);
      expect(signIn.body.error.code).toBe('RIDER_PENDING_APPROVAL');
      expect(signIn.body.data).toBeUndefined();
      expect((await pool.query(`SELECT 1 FROM refresh_tokens WHERE user_id = (SELECT id FROM users WHERE phone = $1)`, [`${PREFIX}5`])).rowCount).toBe(0);

      // The same number in the customer app: a normal CUSTOMER session.
      const shop = await shopVerify('5', await plantOtp('5'));
      expect(shop.status).toBe(200);
      expect(shop.body.data.user).toMatchObject({ role: 'CUSTOMER', phone: `${PREFIX}5` });
      const orders = await request(app).get('/api/v1/orders').set(auth(shop.body.data.access_token));
      expect(orders.status).toBe(200);
    });

    it('an existing customer applies with the number they shop with; an Operations number is told to use "Deliver orders myself"', async () => {
      const ops = await apply(application('1', (await requestOtp('1')).body.data.dev_otp));
      expect(ops.status).toBe(409);
      expect(ops.body.error.code).toBe('STAFF_CAN_DELIVER');

      // Customer 2 has never applied: the Rider app says so (Apply to deliver).
      const before = await verify('2', await plantOtp('2'));
      expect(before.status).toBe(404);
      expect(before.body.error.code).toBe('ACCOUNT_NOT_FOUND');

      const res = await apply(application('2', (await requestOtp('2')).body.data.dev_otp, { full_name: 'RA Customer' }));
      expect(res.status).toBe(201);
      const r = await riderOf('2');
      expect(r).toMatchObject({ uid: ids.customer, role: 'CUSTOMER', approval_status: 'PENDING', is_active: false });
      expect((await verify('2', await plantOtp('2'))).body.error.code).toBe('RIDER_PENDING_APPROVAL');

      // Turned down: told why in the Rider app, still shops in the customer app.
      expect((await reject(tokens.admin, r.id, { reason: 'Not now' })).status).toBe(200);
      const refused = await verify('2', await plantOtp('2'));
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatchObject({ code: 'RIDER_APPLICATION_REJECTED', details: { reason: 'Not now' } });
      const shop = await shopVerify('2', await plantOtp('2'));
      expect(shop.status).toBe(200);
      expect(shop.body.data.user).toMatchObject({ id: ids.customer, role: 'CUSTOMER' });
    });

    it('is rate-limited per phone', async () => {
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await apply(application('9', '123456'))).status;
      expect(last).toBe(429);
    });

    it('never shows a waiting rider as a rider: pickers, suggestions, assignment, cash, staff list', async () => {
      for (const q of ['', '?include_inactive=true']) {
        const riders = await request(app).get(`/api/v1/admin/riders${q}`).set(auth(tokens.admin));
        expect(riders.status).toBe(200);
        expect(riders.body.data.riders.map((r: { id: string }) => r.id), q).not.toContain(riderId);
      }
      const staff = await request(app).get('/api/v1/admin/staff').set(auth(tokens.admin));
      expect(staff.body.data.staff.map((s: { phone: string | null }) => s.phone)).not.toContain(`${PREFIX}5`);
      const staffEdit = await request(app)
        .patch(`/api/v1/admin/staff/${(await riderOf('5')).uid}`)
        .set(auth(tokens.admin))
        .send({ full_name: 'Nope' });
      expect(staffEdit.status).toBe(404);

      const cash = await request(app).post('/api/v1/admin/cash/handins').set(auth(tokens.admin)).send({ rider_id: riderId, amount: 100 });
      expect(cash.status).toBe(404);
      expect(cash.body.error.code).toBe('RIDER_NOT_FOUND');

      const order = await packedOrder();
      const suggestions = await request(app).get(`/api/v1/admin/riders/suggestions?order_id=${order.id}`).set(auth(tokens.admin));
      expect(suggestions.status).toBe(200);
      expect(suggestions.body.data.riders.map((r: { id: string }) => r.id)).not.toContain(riderId);
      const assign = await request(app)
        .post(`/api/v1/admin/orders/${order.id}/assign-rider`)
        .set(auth(tokens.seededAdmin))
        .send({ rider_id: riderId });
      expect(assign.status).toBe(409);
      expect(assign.body.error.code).toBe('RIDER_NOT_APPROVED');
    });
  });

  // ==========================================================================
  describe('reviewing', () => {
    it('lists PENDING requests oldest first (default), with a count, for ADMIN and OPERATIONS', async () => {
      for (const token of [tokens.admin, tokens.ops]) {
        const res = await list(token, '?limit=100');
        expect(res.status).toBe(200);
        const mine = (res.body.data.applications as Array<{ phone: string }>).filter((a) => a.phone?.startsWith(PREFIX));
        expect(mine.map((a) => a.phone)).toEqual([`${PREFIX}5`, `${PREFIX}6`]);
        expect(Object.keys(mine[0]).sort()).toEqual(
          [
            'id',
            'user_id',
            'full_name',
            'phone',
            'vehicle_type',
            'vehicle_registration_number',
            'emergency_contact_phone',
            'approval_status',
            'applied_at',
            'reviewed_at',
            'reviewed_by_name',
            'rejection_reason',
            // Migration 032 (owner, 2026-10-09): how the rider is paid once approved.
            'pay_type',
            'commission_percent',
          ].sort()
        );
        expect(mine[0]).toMatchObject({
          approval_status: 'PENDING',
          full_name: 'Applicant 5',
          vehicle_registration_number: 'WP-APP-5',
          pay_type: 'COMPANY',
          commission_percent: null,
        });
        expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100, total: expect.any(Number), total_pages: expect.any(Number) });

        const count = await request(app).get('/api/v1/admin/rider-applications/count').set(auth(token));
        expect(count.status).toBe(200);
        expect(count.body.data.pending).toBe(res.body.data.pagination.total);
        expect(count.body.data.pending).toBeGreaterThanOrEqual(2);
      }
      const paged = await list(tokens.admin, '?limit=1&page=1');
      expect(paged.body.data.applications).toHaveLength(1);
      expect((await list(tokens.admin, '?status=MAYBE')).status).toBe(400);
    });

    it('is closed to PACKING_STAFF, riders, customers and anonymous callers', async () => {
      const riderToken = generateAccessToken({ id: seededRider, phone: '+94779876543', role: 'RIDER' });
      for (const token of [tokens.packer, riderToken, tokens.customer]) {
        expect((await list(token)).status).toBe(403);
        expect((await request(app).get('/api/v1/admin/rider-applications/count').set(auth(token))).status).toBe(403);
      }
      expect((await request(app).get('/api/v1/admin/rider-applications')).status).toBe(401);
    });

    it('rejects with a reason: SMS queued, audited, and the rider is told why at sign-in', async () => {
      const r = await riderOf('6');
      const noReason = await reject(tokens.admin, r.id, {});
      expect(noReason.status).toBe(400);
      expect((await reject(tokens.admin, r.id, { reason: 'x'.repeat(501) })).status).toBe(400);

      const res = await reject(tokens.admin, r.id, { reason: 'Registration number could not be verified' });
      expect(res.status).toBe(200);
      expect(res.body.data.application).toMatchObject({
        id: r.id,
        approval_status: 'REJECTED',
        rejection_reason: 'Registration number could not be verified',
        reviewed_by_name: 'RA Admin',
      });
      expect(res.body.data.application.reviewed_at).toBeTruthy();

      const sms = await pool.query(`SELECT notification_type, channel, recipient, payload FROM notifications WHERE user_id = $1`, [r.uid]);
      expect(sms.rows).toEqual([
        {
          notification_type: 'RIDER_REJECTED',
          channel: 'SMS',
          recipient: `${PREFIX}6`,
          payload: expect.objectContaining({
            text: "Blynk: your rider application wasn't approved. Reason: Registration number could not be verified",
          }),
        },
      ]);
      const audit = await pool.query(`SELECT action, actor_user_id FROM audit_logs WHERE entity_id = $1 AND action = 'RIDER_REJECTED'`, [r.id]);
      expect(audit.rows).toEqual([{ action: 'RIDER_REJECTED', actor_user_id: ids.admin }]);

      const twice = await reject(tokens.admin, r.id, { reason: 'Again' });
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('APPLICATION_NOT_PENDING');
      expect((await approve(tokens.admin, r.id)).status).toBe(409);

      // A rejected rider still gets a code (to apply again), but cannot sign in with it.
      const req = await requestOtp('6');
      expect(req.status).toBe(200);
      const signIn = await verify('6', req.body.data.dev_otp);
      expect(signIn.status).toBe(403);
      expect(signIn.body.error).toMatchObject({
        code: 'RIDER_APPLICATION_REJECTED',
        message: "Your application wasn't approved.",
        details: { reason: 'Registration number could not be verified' },
      });
      expect(signIn.body.data).toBeUndefined();

      const tab = await list(tokens.ops, '?status=REJECTED&limit=100');
      expect(tab.body.data.applications.map((a: { id: string }) => a.id)).toContain(r.id);
    });

    it('a rejected rider can apply again: new details, PENDING, reason cleared', async () => {
      const otp = (await requestOtp('6')).body.data.dev_otp as string;
      const res = await apply(application('6', otp, { full_name: 'Applicant Six', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'wp-six-2' }));
      expect(res.status).toBe(201);
      expect(res.body.data.application).toEqual({ status: 'PENDING', full_name: 'Applicant Six', phone: `${PREFIX}6` });
      expect(await riderOf('6')).toMatchObject({
        approval_status: 'PENDING',
        full_name: 'Applicant Six',
        vehicle_type: 'MOTORCYCLE',
        vehicle_registration_number: 'WP-SIX-2',
        rejection_reason: null,
        reviewed_at: null,
        reviewed_by: null,
        is_active: false,
      });
      const audit = await pool.query(`SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'RIDER_APPLIED' ORDER BY created_at`, [
        (await riderOf('6')).id,
      ]);
      expect(audit.rows.map((a) => a.new_values.reapplied)).toEqual([false, true]);
    });

    it('approves (OPERATIONS): active, assignable, SMS queued, audited; signs in by SMS code only', async () => {
      const r = await riderOf('5');
      const res = await approve(tokens.ops, r.id);
      expect(res.status).toBe(200);
      expect(res.body.data.application).toMatchObject({
        id: r.id,
        approval_status: 'APPROVED',
        reviewed_by_name: 'RA Operator',
        rejection_reason: null,
        phone: `${PREFIX}5`,
      });
      expect(await riderOf('5')).toMatchObject({ is_active: true, is_available: true, reviewed_by: ids.ops });

      const sms = await pool.query(`SELECT notification_type, recipient, payload FROM notifications WHERE user_id = $1`, [r.uid]);
      expect(sms.rows).toEqual([
        { notification_type: 'RIDER_APPROVED', recipient: `${PREFIX}5`, payload: expect.objectContaining({ text: RIDER_APPROVED_SMS }) },
      ]);
      expect(RIDER_APPROVED_SMS).toBe("Blynk: you're approved as a rider. Sign in to the Blynk Rider app with this number.");
      const audit = await pool.query(`SELECT actor_user_id FROM audit_logs WHERE entity_id = $1 AND action = 'RIDER_APPROVED'`, [r.id]);
      expect(audit.rows).toEqual([{ actor_user_id: ids.ops }]);

      const twice = await approve(tokens.admin, r.id);
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('APPLICATION_NOT_PENDING');

      const riders = await request(app).get('/api/v1/admin/riders').set(auth(tokens.admin));
      expect(riders.body.data.riders.map((x: { id: string }) => x.id)).toContain(r.id);
      const approvedTab = await list(tokens.admin, '?status=APPROVED&limit=100');
      expect(approvedTab.body.data.applications.map((a: { id: string }) => a.id)).toContain(r.id);
      expect(approvedTab.body.data.applications.map((a: { user_id: string }) => a.user_id)).not.toContain(seededRider);

      // Sign-in: phone + SMS code; the session reaches the rider routes, /auth/me and refresh.
      const req = await requestOtp('5');
      expect(req.status).toBe(200);
      const signIn = await verify('5', req.body.data.dev_otp);
      expect(signIn.status).toBe(200);
      expect(signIn.body.data.user).toMatchObject({ role: 'RIDER', phone: `${PREFIX}5`, full_name: 'Applicant 5' });
      // Approval made the customer account a RIDER; it is the same account.
      expect((await riderOf('5')).role).toBe('RIDER');
      const token = signIn.body.data.access_token as string;
      expect((await request(app).get('/api/v1/riders/deliveries').set(auth(token))).status).toBe(200);
      expect((await request(app).get('/api/v1/auth/me').set(auth(token))).body.data).toMatchObject({ role: 'RIDER' });
      const refresh = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: signIn.body.data.refresh_token });
      expect(refresh.status).toBe(200);

      // Applying again with an approved number.
      const again = await apply(application('5', await plantOtp('5')));
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: 'ALREADY_APPROVED',
        message: 'This number is already an approved rider. Sign in instead.',
      });

      // Now listed on Staff accounts (managed there as before).
      const staff = await request(app).get('/api/v1/admin/staff').set(auth(tokens.ops));
      expect(staff.body.data.staff.map((s: { phone: string | null }) => s.phone)).toContain(`${PREFIX}5`);
    });

    it('404 for an unknown request', async () => {
      const res = await approve(tokens.admin, '00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RIDER_APPLICATION_NOT_FOUND');
    });
  });

  // ==========================================================================
  describe('one number, one account: riders and Operations also shop', () => {
    it('a rider and an Operations person place, track and cancel their own order; Admin and Inventory cannot order', async () => {
      const riderUid = (await riderOf('5')).uid;
      const shoppers = [
        generateAccessToken({ id: riderUid, phone: `${PREFIX}5`, role: 'RIDER' }),
        tokens.ops,
      ];
      for (const token of shoppers) {
        const addr = await request(app)
          .post('/api/v1/me/addresses')
          .set(auth(token))
          .send({ label: 'Home', recipient_name: 'Shopper', recipient_phone: '+94771234567', address_line1: 'No. 9, Test Lane', city: 'Dharga Town', latitude: 6.4351, longitude: 80.0243 });
        expect(addr.status).toBe(201);
        const placed = await request(app)
          .post('/api/v1/orders')
          .set(auth(token))
          .send({ address_id: addr.body.data.address.id, items: [{ product_id: MILK, quantity: 1 }] });
        expect(placed.status).toBe(201);
        const orderId = placed.body.data.order.id as string;
        createdOrders.push(orderId);
        const mine = await request(app).get('/api/v1/orders').set(auth(token));
        expect(mine.body.data.orders.map((o: { id: string }) => o.id)).toEqual([orderId]);
        // Someone else's order stays out of reach.
        const cancelOther = await request(app).post(`/api/v1/orders/${createdOrders[0]}/cancel`).set(auth(token)).send({});
        expect(cancelOther.status).toBe(404);
        const cancel = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set(auth(token)).send({ reason: 'Test' });
        expect(cancel.status).toBe(200);
        expect(cancel.body.data.order.order_status).toBe('CANCELLED');
      }
      for (const token of [tokens.admin, tokens.packer]) {
        const res = await request(app).post('/api/v1/orders').set(auth(token)).send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
        expect(res.status).toBe(403);
      }
    });
  });

  // ==========================================================================
  describe('riders sign in with phone only', () => {
    it('POST /auth/staff/login for a RIDER account is 403 PHONE_SIGN_IN_REQUIRED', async () => {
      const uid = (await riderOf('5')).uid;
      await pool.query(`UPDATE users SET email = $2, staff_password_hash = crypt($3, gen_salt('bf', 4)) WHERE id = $1`, [
        uid,
        `rider5${EMAIL_DOMAIN}`,
        PASSWORD,
      ]);
      const res = await request(app).post('/api/v1/auth/staff/login').send({ email: `rider5${EMAIL_DOMAIN}`, password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: 'PHONE_SIGN_IN_REQUIRED', message: 'Riders sign in with their phone number.' });
      expect(res.body.data).toBeUndefined();
    });
  });

  // ==========================================================================
  describe('Staff accounts', () => {
    it('POST /admin/staff with role RIDER is 400 RIDERS_JOIN_BY_APPLICATION (ADMIN and OPERATIONS)', async () => {
      for (const token of [tokens.admin, tokens.ops]) {
        const res = await request(app)
          .post('/api/v1/admin/staff')
          .set(auth(token))
          .send({ full_name: 'No Rider', email: `norider${EMAIL_DOMAIN}`, password: PASSWORD, role: 'RIDER', phone: local('8'), vehicle_registration_number: 'WP-1' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: 'RIDERS_JOIN_BY_APPLICATION',
          message: 'Riders apply in the Blynk Rider app and are approved under Rider requests.',
        });
      }
      expect((await pool.query(`SELECT 1 FROM users WHERE email = $1`, [`norider${EMAIL_DOMAIN}`])).rowCount).toBe(0);
    });

    it("an ADMIN resets another ADMIN's password - only the password, never their own, never by OPERATIONS", async () => {
      const patch = (token: string, id: string, body: Record<string, unknown>) =>
        request(app).patch(`/api/v1/admin/staff/${id}`).set(auth(token)).send(body);
      const login = (password: string) =>
        request(app).post('/api/v1/auth/staff/login').send({ email: `other-admin${EMAIL_DOMAIN}`, password });

      const session = await login(PASSWORD);
      expect(session.status).toBe(200);

      const mixed = await patch(tokens.admin, ids.otherAdmin, { password: 'New-admin-pass-1', full_name: 'Renamed' });
      expect(mixed.status).toBe(403);
      expect(mixed.body.error.code).toBe('CANNOT_EDIT_ADMIN');
      const name = await patch(tokens.admin, ids.otherAdmin, { full_name: 'Renamed' });
      expect(name.body.error.code).toBe('CANNOT_EDIT_ADMIN');
      const byOps = await patch(tokens.ops, ids.otherAdmin, { password: 'New-admin-pass-1' });
      expect(byOps.status).toBe(403);
      expect(byOps.body.error.code).toBe('CANNOT_EDIT_ADMIN');
      const self = await patch(tokens.admin, ids.admin, { password: 'New-admin-pass-1' });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('CANNOT_EDIT_SELF');

      await pool.query(`UPDATE users SET login_failed_attempts = 3 WHERE id = $1`, [ids.otherAdmin]);
      const ok = await patch(tokens.admin, ids.otherAdmin, { password: 'New-admin-pass-1' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.staff).toMatchObject({ id: ids.otherAdmin, role: 'ADMIN', read_only: true, full_name: 'RA Other Admin' });
      const row = await pool.query(`SELECT login_failed_attempts FROM users WHERE id = $1`, [ids.otherAdmin]);
      expect(row.rows[0].login_failed_attempts).toBe(0);
      expect((await login(PASSWORD)).status).toBe(401);
      expect((await login('New-admin-pass-1')).status).toBe(200);
      // The old session ended.
      const refresh = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: session.body.data.refresh_token });
      expect(refresh.status).toBe(401);

      const audit = await pool.query(`SELECT action, actor_user_id, new_values FROM audit_logs WHERE entity_id = $1`, [ids.otherAdmin]);
      expect(audit.rows).toEqual([
        { action: 'STAFF_UPDATED', actor_user_id: ids.admin, new_values: { password_reset: true, target_role: 'ADMIN', by_role: 'ADMIN' } },
      ]);
      expect(JSON.stringify(audit.rows)).not.toContain('New-admin-pass-1');
    });
  });

  // ==========================================================================
  describe('bicycles need no registration number', () => {
    it('applying: optional for BICYCLE (stored NULL), required for every other vehicle', async () => {
      const motor = await apply(application('7', '123456', { vehicle_type: 'MOTORCYCLE', vehicle_registration_number: undefined }));
      expect(motor.status).toBe(400);
      expect(motor.body.error.details.map((d: { field: string }) => d.field)).toContain('vehicle_registration_number');
      const empty = await apply(application('7', '123456', { vehicle_type: 'CAR', vehicle_registration_number: '' }));
      expect(empty.status).toBe(400);

      const otp = (await requestOtp('7')).body.data.dev_otp as string;
      const bike = await apply(application('7', otp, { vehicle_type: 'BICYCLE', vehicle_registration_number: undefined }));
      expect(bike.status).toBe(201);
      expect(await riderOf('7')).toMatchObject({ vehicle_type: 'BICYCLE', vehicle_registration_number: null, approval_status: 'PENDING' });
      const listed = await list(tokens.admin, '?limit=100');
      const row = listed.body.data.applications.find((a: { phone: string }) => a.phone === `${PREFIX}7`);
      expect(row).toMatchObject({ vehicle_type: 'BICYCLE', vehicle_registration_number: null });
    });

    it('staff vehicle edit: a bicycle may drop the number; any other vehicle needs one', async () => {
      const uid = (await riderOf('5')).uid; // approved earlier, SCOOTER
      const patch = (body: Record<string, unknown>) =>
        request(app).patch(`/api/v1/admin/staff/${uid}`).set(auth(tokens.ops)).send(body);
      const bike = await patch({ vehicle_type: 'BICYCLE', vehicle_registration_number: null });
      expect(bike.status).toBe(200);
      expect(bike.body.data.staff.rider).toMatchObject({ vehicle_type: 'BICYCLE', vehicle_registration_number: null });
      const motorNoReg = await patch({ vehicle_type: 'MOTORCYCLE' });
      expect(motorNoReg.status).toBe(400);
      expect(motorNoReg.body.error.details.map((d: { field: string }) => d.field)).toContain('vehicle_registration_number');
      const clearOnCar = await patch({ vehicle_type: 'CAR', vehicle_registration_number: '' });
      expect(clearOnCar.status).toBe(400);
      const motor = await patch({ vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'wp-bike-5' });
      expect(motor.status).toBe(200);
      expect(motor.body.data.staff.rider).toMatchObject({ vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-BIKE-5' });
    });
  });

  it('the notification templates send the queued text as written', () => {
    expect(NotificationTemplates.render('RIDER_APPROVED', { text: RIDER_APPROVED_SMS })).toBe(RIDER_APPROVED_SMS);
    const long = riderRejectedSms('y'.repeat(400));
    expect(long.length).toBeLessThan(200);
    expect(NotificationTemplates.render('RIDER_REJECTED', { text: long })).toBe(long);
  });
});
