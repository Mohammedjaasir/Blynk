import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { setSellerApplicationsTableForTests } from '../src/modules/sellers/seller-applications.ready.js';
import { tokens, users, auth } from './helpers/stock.js';

/**
 * Seller applications (migration 064; owner's brother, 2026-10-27): the public form at blynk.lk/seller and
 * the staff list. Every application, audit row and notification made here is removed (every shop name
 * starts with "Zqxapp").
 */
const app = createApp();
const opsToken = generateAccessToken({ id: users.admin.id, phone: users.admin.phone, role: 'OPERATIONS' });
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const DEVICE = `seller-app-test-device-${Date.now()}`;
let testStart: Date;

const body = (n: number, extra: object = {}) => ({
  shop_name: `Zqxapp Stores ${n}`,
  owner_name: `Zqxapp Owner ${n}`,
  phone: `0709562${String(100 + n).padStart(3, '0')}`,
  town: 'Aluthgama',
  what_they_sell: 'Spices and dry fish',
  ...extra,
});
const apply = (b: object) => request(app).post('/api/v1/seller-applications').send(b);
const rows = async () => (await pool.query(`SELECT * FROM seller_applications WHERE shop_name ILIKE 'zqxapp%' ORDER BY created_at`)).rows;
const list = async (query: object = {}, token = tokens.admin) => {
  const res = await request(app).get('/api/v1/admin/seller-applications').query({ limit: 500, ...query }).set(auth(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { ...res.body.data, applications: (res.body.data.applications as any[]).filter((a) => a.shop_name.startsWith('Zqxapp')) };
};
const purge = async () => {
  await pool.query(`DELETE FROM seller_applications WHERE shop_name ILIKE 'zqxapp%'`);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'SELLER_APPLICATION_UPDATED' AND created_at >= $1`, [testStart]);
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_SELLER_APPLICATION' AND created_at >= $1`, [testStart]);
};

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  await pool.query(`DELETE FROM seller_applications WHERE shop_name ILIKE 'zqxapp%'`);
});
beforeEach(() => {
  setSellerApplicationsTableForTests(null);
  authRateLimiter.reset();
});
afterEach(() => setPushSenderForTests(undefined));
afterAll(async () => {
  setSellerApplicationsTableForTests(null);
  authRateLimiter.reset();
  await purge();
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
});

describe('the public form', () => {
  it('stores a valid application and answers { received: true } only', async () => {
    const res = await apply(body(1, { email: 'Shop@Example.com ', message: ' Please call after 4 ' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true, data: { received: true } });
    const [row] = await rows();
    expect(row).toMatchObject({
      shop_name: 'Zqxapp Stores 1',
      owner_name: 'Zqxapp Owner 1',
      phone: '+94709562101',
      email: 'Shop@Example.com',
      town: 'Aluthgama',
      what_they_sell: 'Spices and dry fish',
      message: 'Please call after 4',
      status: 'NEW',
      source: 'WEBSITE',
      handled_by: null,
      handled_at: null,
      staff_note: null,
    });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    // never the plain address
    expect(row.ip_hash).not.toContain('127.0.0.1');
  });

  it('empty optional fields are stored as null', async () => {
    expect((await apply(body(2, { email: '', message: '', website: '' }))).status).toBe(200);
    const row = (await rows()).find((r) => r.shop_name === 'Zqxapp Stores 2');
    expect(row).toMatchObject({ email: null, message: null });
  });

  it('refuses bad input with a message per field, and stores nothing', async () => {
    const before = (await rows()).length;
    const res = await apply({ shop_name: 'Z', owner_name: '', phone: '0112345678', town: '', what_they_sell: 'x', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const byField = Object.fromEntries((res.body.error.details as any[]).map((d) => [d.path[0], d.message]));
    expect(Object.keys(byField).sort()).toEqual(['email', 'owner_name', 'phone', 'shop_name', 'town', 'what_they_sell']);
    expect(byField.phone).toMatch(/Sri Lankan mobile/);
    const missing = await apply({});
    expect(missing.status).toBe(400);
    expect((missing.body.error.details as any[]).map((d) => d.path[0]).sort()).toEqual(['owner_name', 'phone', 'shop_name', 'town', 'what_they_sell']);
    // an unknown field, and values over the limits
    expect((await apply(body(3, { status: 'APPROVED' }))).status).toBe(400);
    expect((await apply(body(3, { shop_name: 'Zqxapp ' + 'x'.repeat(80) }))).status).toBe(400);
    expect((await apply(body(3, { what_they_sell: 'x'.repeat(501) }))).status).toBe(400);
    expect((await apply(body(3, { message: 'x'.repeat(1001) }))).status).toBe(400);
    expect((await apply(body(3, { phone: 12345 }))).status).toBe(400);
    expect((await rows()).length).toBe(before);
  });

  it('accepts the usual ways to write a mobile number', async () => {
    for (const [n, phone] of [[10, '+94 70 956 2210'], [11, '94709562211'], [12, '070-956-2212']] as const) {
      expect((await apply(body(n, { phone }))).status, phone).toBe(200);
    }
    const phones = (await rows()).filter((r) => [10, 11, 12].some((n) => r.shop_name === `Zqxapp Stores ${n}`)).map((r) => r.phone);
    expect(phones).toEqual(['+94709562210', '+94709562211', '+94709562212']);
  });

  it('the honeypot field: filled answers 200 and stores nothing', async () => {
    const before = (await rows()).length;
    const res = await apply(body(20, { website: 'https://spam.example' }));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ received: true });
    expect((await rows()).length).toBe(before);
  });

  it('the same number applying again while NEW or CONTACTED gets 200 and no second row; after a decision it can apply again', async () => {
    expect((await apply(body(30))).status).toBe(200);
    const again = await apply(body(30, { shop_name: 'Zqxapp Stores 30 again', owner_name: 'Zqxapp Someone Else' }));
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ received: true });
    expect((await rows()).filter((r) => r.phone === '+94709562130')).toHaveLength(1);

    const id = (await rows()).find((r) => r.phone === '+94709562130').id;
    await request(app).patch(`/api/v1/admin/seller-applications/${id}`).set(auth(tokens.admin)).send({ status: 'CONTACTED' });
    expect((await apply(body(30, { shop_name: 'Zqxapp Stores 30 again' }))).status).toBe(200);
    expect((await rows()).filter((r) => r.phone === '+94709562130')).toHaveLength(1);

    await request(app).patch(`/api/v1/admin/seller-applications/${id}`).set(auth(tokens.admin)).send({ status: 'DECLINED' });
    expect((await apply(body(30, { shop_name: 'Zqxapp Stores 30 again' }))).status).toBe(200);
    expect((await rows()).filter((r) => r.phone === '+94709562130')).toHaveLength(2);
  });

  it('two taps at once make one row', async () => {
    const results = await Promise.all([apply(body(31)), apply(body(31))]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await rows()).filter((r) => r.phone === '+94709562131')).toHaveLength(1);
  });

  it('allows 5 an hour per address, then 429 (a refused form is not counted)', async () => {
    for (let i = 0; i < 5; i += 1) expect((await apply(body(40 + i))).status).toBe(200);
    const sixth = await apply(body(45));
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(sixth.body.error.message).toMatch(/call or WhatsApp/);
    expect((await rows()).some((r) => r.shop_name === 'Zqxapp Stores 45')).toBe(false);
  });

  it('before migration 064 has run the form answers 503 SELLER_APPLICATIONS_NOT_READY with a message the website can show', async () => {
    setSellerApplicationsTableForTests(false);
    const res = await apply(body(50));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SELLER_APPLICATIONS_NOT_READY');
    expect(res.body.error.message).toMatch(/call or WhatsApp/);
    for (const r of [
      await request(app).get('/api/v1/admin/seller-applications').set(auth(tokens.admin)),
      await request(app).patch('/api/v1/admin/seller-applications/a0000001-0000-0000-0000-000000000001').set(auth(tokens.admin)).send({ status: 'CONTACTED' }),
    ]) {
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('SELLER_APPLICATIONS_NOT_READY');
    }
  });

  it('the website origin may call it (CORS preflight allows POST with a JSON body)', async () => {
    const res = await request(app)
      .options('/api/v1/seller-applications')
      .set('Origin', 'http://localhost:5000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5000');
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
    expect(res.headers['access-control-allow-headers']).toMatch(/Content-Type/i);
  });
});

describe('push to staff', () => {
  it('queues "New seller application" for an Admin with a device, and not for customers', async () => {
    setPushSenderForTests(fake);
    await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [users.admin.id, DEVICE]);
    expect((await apply(body(60, { town: 'Dharga Town' }))).status).toBe(200);
    const id = (await rows()).find((r) => r.shop_name === 'Zqxapp Stores 60').id;
    const pushes = (await pool.query(`SELECT recipient, payload FROM notifications WHERE notification_type = 'PUSH_SELLER_APPLICATION' AND idempotency_key LIKE $1`, [`seller-application:${id}:%`])).rows;
    const mine = pushes.find((p) => p.recipient === users.admin.id);
    expect(mine, JSON.stringify(pushes)).toBeTruthy();
    expect(mine.payload).toMatchObject({
      title: 'New seller application',
      body: 'Zqxapp Stores 60 (Dharga Town)',
      data: { type: 'staff_seller_application', application_id: id },
    });
    expect(pushes.some((p) => p.recipient === users.customer.id)).toBe(false);
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_SELLER_APPLICATION' AND created_at >= $1`, [testStart]);
  });

  it('a duplicate application queues nothing', async () => {
    setPushSenderForTests(fake);
    expect((await apply(body(61))).status).toBe(200);
    const before = (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE notification_type = 'PUSH_SELLER_APPLICATION' AND created_at >= $1`, [testStart])).rows[0].n;
    expect((await apply(body(61))).status).toBe(200);
    const after = (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE notification_type = 'PUSH_SELLER_APPLICATION' AND created_at >= $1`, [testStart])).rows[0].n;
    expect(after).toBe(before);
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_SELLER_APPLICATION' AND created_at >= $1`, [testStart]);
  });

  it('a push failure never fails the application', async () => {
    setPushSenderForTests(fake);
    await pool.query(
      `CREATE OR REPLACE FUNCTION zqx_sapp_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'push outbox down'; END; $$ LANGUAGE plpgsql`
    );
    await pool.query(`CREATE TRIGGER zqx_sapp_fail BEFORE INSERT ON notifications FOR EACH ROW WHEN (NEW.notification_type = 'PUSH_SELLER_APPLICATION') EXECUTE FUNCTION zqx_sapp_fail()`);
    try {
      const res = await apply(body(62));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await rows()).some((r) => r.shop_name === 'Zqxapp Stores 62')).toBe(true);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS zqx_sapp_fail ON notifications');
      await pool.query('DROP FUNCTION IF EXISTS zqx_sapp_fail()');
    }
  });

  it('with push not set up on the server nothing is queued and the application is stored', async () => {
    setPushSenderForTests(null);
    expect((await apply(body(63))).status).toBe(200);
    const id = (await rows()).find((r) => r.shop_name === 'Zqxapp Stores 63').id;
    const n = (await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE idempotency_key LIKE $1`, [`seller-application:${id}:%`])).rows[0].n;
    expect(n).toBe(0);
  });
});

describe('staff list and review', () => {
  let ids: Record<string, string>;
  beforeAll(async () => {
    await pool.query(`DELETE FROM seller_applications WHERE shop_name ILIKE 'zqxapp%'`);
    authRateLimiter.reset();
    // oldest first: A (NEW), B (CONTACTED), C (NEW), D (DECLINED)
    ids = {};
    for (const [i, key] of ['A', 'B', 'C', 'D'].entries()) {
      authRateLimiter.reset();
      const r = await apply(body(70 + i, { shop_name: `Zqxapp List ${key}` }));
      expect(r.status).toBe(200);
      ids[key] = (await rows()).find((x) => x.shop_name === `Zqxapp List ${key}`).id;
      await pool.query(`UPDATE seller_applications SET created_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [ids[key], String((4 - i) * 10)]);
    }
    await pool.query(`UPDATE seller_applications SET status = 'CONTACTED' WHERE id = $1`, [ids.B]);
    await pool.query(`UPDATE seller_applications SET status = 'DECLINED' WHERE id = $1`, [ids.D]);
  });

  it('lists newest first with NEW first, counts the NEW ones, and filters by status', async () => {
    const all = await list();
    expect(all.applications.map((a: any) => a.shop_name)).toEqual(['Zqxapp List C', 'Zqxapp List A', 'Zqxapp List D', 'Zqxapp List B']);
    expect(all.new_count).toBeGreaterThanOrEqual(2);
    const real = (await pool.query(`SELECT count(*)::int AS n FROM seller_applications WHERE status = 'NEW'`)).rows[0].n;
    expect(all.new_count).toBe(real);
    expect(all.applications[0]).toMatchObject({ owner_name: 'Zqxapp Owner 72', phone: '+94709562172', town: 'Aluthgama', what_they_sell: 'Spices and dry fish', status: 'NEW', staff_note: null, handled_by: null });
    expect(all.applications[0]).not.toHaveProperty('ip_hash');
    expect((await list({ status: 'new' })).applications.map((a: any) => a.shop_name)).toEqual(['Zqxapp List C', 'Zqxapp List A']);
    expect((await list({ status: 'CONTACTED' })).applications.map((a: any) => a.shop_name)).toEqual(['Zqxapp List B']);
    expect((await list({}, opsToken)).applications).toHaveLength(4);
    expect((await request(app).get('/api/v1/admin/seller-applications').query({ status: 'WAITING' }).set(auth(tokens.admin))).status).toBe(400);
  });

  it('only Admin and Operations; customers, riders, packing staff and signed-out callers are refused', async () => {
    const url = '/api/v1/admin/seller-applications';
    expect((await request(app).get(url)).status).toBe(401);
    for (const t of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await request(app).get(url).set(auth(t))).status).toBe(403);
      expect((await request(app).patch(`${url}/${ids.A}`).set(auth(t)).send({ status: 'CONTACTED' })).status).toBe(403);
    }
    expect((await request(app).patch(`${url}/${ids.A}`).send({ status: 'CONTACTED' })).status).toBe(401);
  });

  it('PATCH sets the status and the note, records who and when, writes an audit row and returns the new count', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/seller-applications/${ids.A}`)
      .set(auth(opsToken))
      .send({ status: 'CONTACTED', staff_note: ' Rang at 4 pm, will send photos ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.application).toMatchObject({
      id: ids.A,
      status: 'CONTACTED',
      staff_note: 'Rang at 4 pm, will send photos',
      handled_by: users.admin.id,
      handled_by_name: (await pool.query('SELECT full_name FROM users WHERE id = $1', [users.admin.id])).rows[0].full_name,
    });
    expect(res.body.data.application.handled_at).toBeTruthy();
    const real = (await pool.query(`SELECT count(*)::int AS n FROM seller_applications WHERE status = 'NEW'`)).rows[0].n;
    expect(res.body.data.new_count).toBe(real);
    const audit = (await pool.query(`SELECT * FROM audit_logs WHERE action = 'SELLER_APPLICATION_UPDATED' AND entity_id = $1`, [ids.A])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: users.admin.id,
      entity_type: 'seller_application',
      old_values: { status: 'NEW', staff_note: null },
      new_values: { status: 'CONTACTED', staff_note: 'Rang at 4 pm, will send photos' },
    });
  });

  it('a note alone keeps the status; an empty note clears it; the status alone keeps the note', async () => {
    const patch = (b: object) => request(app).patch(`/api/v1/admin/seller-applications/${ids.C}`).set(auth(tokens.admin)).send(b);
    expect((await patch({ staff_note: 'Call tomorrow' })).body.data.application).toMatchObject({ status: 'NEW', staff_note: 'Call tomorrow' });
    expect((await patch({ status: 'APPROVED' })).body.data.application).toMatchObject({ status: 'APPROVED', staff_note: 'Call tomorrow' });
    expect((await patch({ staff_note: '' })).body.data.application).toMatchObject({ status: 'APPROVED', staff_note: null });
    expect((await patch({ staff_note: null, status: 'DECLINED' })).body.data.application).toMatchObject({ status: 'DECLINED', staff_note: null });
  });

  it('refuses an empty body, an unknown status, a long note, unknown fields and a missing application', async () => {
    const patch = (id: string, b: object) => request(app).patch(`/api/v1/admin/seller-applications/${id}`).set(auth(tokens.admin)).send(b);
    expect((await patch(ids.B, {})).status).toBe(400);
    expect((await patch(ids.B, { status: 'MAYBE' })).status).toBe(400);
    expect((await patch(ids.B, { staff_note: 'x'.repeat(501) })).status).toBe(400);
    expect((await patch(ids.B, { status: 'CONTACTED', phone: '0771111111' })).status).toBe(400);
    const missing = await patch('a0000001-0000-0000-0000-0000000000ff', { status: 'CONTACTED' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SELLER_APPLICATION_NOT_FOUND');
    expect((await patch('not-a-uuid', { status: 'CONTACTED' })).status).toBe(404);
    expect((await pool.query(`SELECT status FROM seller_applications WHERE id = $1`, [ids.B])).rows[0].status).toBe('CONTACTED');
  });
});
