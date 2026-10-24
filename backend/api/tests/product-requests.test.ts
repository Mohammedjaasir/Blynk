import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { setProductRequestsTableForTests } from '../src/modules/catalog/product-requests.ready.js';
import { tokens, auth, stockFixtures } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * "Can't find it? Ask us" (migration 056; owner, 2026-10-24). Customers and guests ask for products we
 * don't stock; Admin / Ops see them grouped by name, most requested first, and set the group's status;
 * ADDED with a product tells the requesters. Every request, notification, product and audit row made
 * here is removed (all request names start with "Zqxreq").
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c0f056', phoneBase: '+947095610', name: 'Zqxreq Shopper' });
const fx = stockFixtures(app, 'TST-PRQ-');
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const DEVICE = `prq-test-device-${Date.now()}`;
let testStart: Date;

type Shopper = Awaited<ReturnType<typeof people.customer>>;
let limited: Shopper;
let withDevice: Shopper;
let smsOnly: Shopper;
let landline: Shopper;
let late: Shopper;
let liveProduct: { id: string; name: string };
let hiddenProduct: string;

const ask = (body: object, token?: string) => {
  const r = request(app).post('/api/v1/product-requests');
  if (token) r.set(auth(token));
  return r.send(body);
};
const groups = async (query: object = {}, token = tokens.admin) => {
  const res = await request(app).get('/api/v1/admin/product-requests').query({ limit: 500, ...query }).set(auth(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.data.groups as any[]).filter((g) => g.key.startsWith('zqxreq'));
};
const patch = (key: string, body: object, token = opsToken) =>
  request(app).patch(`/api/v1/admin/product-requests/${encodeURIComponent(key)}`).set(auth(token)).send(body);
const told = async (userId: string) =>
  (
    await pool.query(
      `SELECT channel, notification_type, recipient, payload, status FROM notifications
       WHERE user_id = $1 AND notification_type IN ('PUSH_PRODUCT_REQUEST_ADDED', 'PRODUCT_REQUEST_ADDED')`,
      [userId]
    )
  ).rows;
const clearTold = (ids: string[]) =>
  pool.query(`DELETE FROM notifications WHERE user_id = ANY($1) AND notification_type IN ('PUSH_PRODUCT_REQUEST_ADDED', 'PRODUCT_REQUEST_ADDED')`, [ids]);

const purgeRequests = async () => {
  await pool.query(`DELETE FROM product_requests WHERE name ILIKE 'zqxreq%'`);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PRODUCT_REQUESTS_UPDATED' AND new_values->>'key' LIKE 'zqxreq%'`);
};

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  setProductRequestsTableForTests(null);
  authRateLimiter.reset();
  await people.purge();
  await purgeRequests();
  await fx.setup();
  limited = await people.customer(1);
  withDevice = await people.customer(2);
  smsOnly = await people.customer(3);
  landline = await people.customer(4);
  late = await people.customer(5);
  await pool.query("UPDATE users SET phone = '+94112956104' WHERE id = $1", [landline.id]);
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android')`, [withDevice.id, DEVICE]);
  const live = await fx.product({ tracked: false });
  liveProduct = { id: live.productId, name: (await pool.query('SELECT name FROM products WHERE id = $1', [live.productId])).rows[0].name };
  hiddenProduct = (await fx.product({ tracked: false })).productId;
  await pool.query('UPDATE products SET is_active = false WHERE id = $1', [hiddenProduct]);
});

afterAll(async () => {
  setPushSenderForTests(undefined);
  setProductRequestsTableForTests(null);
  authRateLimiter.reset();
  await pool.query('DROP TRIGGER IF EXISTS zqx_prq_fail ON notifications');
  await pool.query('DROP FUNCTION IF EXISTS zqx_prq_fail()');
  await clearTold([limited, withDevice, smsOnly, landline, late].filter(Boolean).map((p) => p.id));
  await purgeRequests();
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await people.cleanup();
  await fx.cleanup();
});

describe('before migration 056 has run', () => {
  it('every route answers 503 PRODUCT_REQUESTS_NOT_READY and GET /store says it is off', async () => {
    setProductRequestsTableForTests(false);
    try {
      const store = await request(app).get('/api/v1/store');
      expect(store.status).toBe(200);
      expect(store.body.data.product_requests_enabled).toBe(false);
      for (const res of [
        await ask({ name: 'Zqxreq anything' }, limited.token),
        await ask({ name: 'Zqxreq anything' }),
        await request(app).get('/api/v1/me/product-requests').set(auth(limited.token)),
        await request(app).get('/api/v1/admin/product-requests').set(auth(tokens.admin)),
        await patch('zqxreq anything', { status: 'PLANNED' }),
      ]) {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('PRODUCT_REQUESTS_NOT_READY');
      }
    } finally {
      setProductRequestsTableForTests(null);
    }
    const store = await request(app).get('/api/v1/store');
    expect(store.body.data.product_requests_enabled).toBe(true);
  });
});

describe('asking for a product', () => {
  it('a customer asks: 201, tidied name, then sees it in their requests', async () => {
    const category = (await pool.query('SELECT id, name FROM categories WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0];
    const res = await ask({ name: '  Zqxreq   Kithul  Treacle ', note: 'The 750 ml bottle', category_id: category.id }, withDevice.token);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.already_requested).toBe(false);
    expect(res.body.data.request).toMatchObject({ name: 'Zqxreq Kithul Treacle', note: 'The 750 ml bottle', status: 'NEW', product_id: null });
    const mine = await request(app).get('/api/v1/me/product-requests').set(auth(withDevice.token));
    expect(mine.status).toBe(200);
    expect(mine.body.data.requests).toHaveLength(1);
    expect(mine.body.data.requests[0]).toMatchObject({ id: res.body.data.request.id, status: 'NEW', category_name: category.name, product: null });
    expect(mine.body.data.requests[0]).not.toHaveProperty('staff_note');
  });

  it('asking again for an open request returns it (not counted twice)', async () => {
    const first = (await request(app).get('/api/v1/me/product-requests').set(auth(withDevice.token))).body.data.requests[0];
    const again = await ask({ name: 'zqxreq kithul treacle' }, withDevice.token);
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ already_requested: true, request: { id: first.id } });
    expect((await request(app).get('/api/v1/me/product-requests').set(auth(withDevice.token))).body.data.requests).toHaveLength(1);
  });

  it('refuses bad input, unknown categories and staff accounts', async () => {
    expect((await ask({ name: 'Z' }, limited.token)).status).toBe(400);
    expect((await ask({ name: `Zqxreq ${'x'.repeat(80)}` }, limited.token)).status).toBe(400);
    expect((await ask({}, limited.token)).status).toBe(400);
    expect((await ask({ name: 'Zqxreq ok', note: 'n'.repeat(301) }, limited.token)).status).toBe(400);
    expect((await ask({ name: 'Zqxreq ok', category_id: 'not-a-uuid' }, limited.token)).status).toBe(400);
    const unknown = await ask({ name: 'Zqxreq ok', category_id: '00000000-0000-4000-8000-000000000000' }, limited.token);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect((await ask({ name: 'Zqxreq ok' }, tokens.rider)).status).toBe(403);
    expect((await ask({ name: 'Zqxreq ok' }, 'not-a-token')).status).toBe(401);
    expect((await request(app).get('/api/v1/me/product-requests')).status).toBe(401);
  });

  it('5 a day per customer', async () => {
    for (let i = 1; i <= 5; i++) expect((await ask({ name: `Zqxreq limit item ${i}` }, limited.token)).status).toBe(201);
    const sixth = await ask({ name: 'Zqxreq limit item 6' }, limited.token);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('TOO_MANY_PRODUCT_REQUESTS');
    // an open repeat is still answered (it is not a new request)
    expect((await ask({ name: 'Zqxreq limit item 3' }, limited.token)).body.data.already_requested).toBe(true);
  });

  it('guests may ask, limited by IP', async () => {
    authRateLimiter.reset();
    const guest = await ask({ name: 'ZQXREQ KITHUL TREACLE' });
    expect(guest.status, JSON.stringify(guest.body)).toBe(201);
    const row = (await pool.query('SELECT user_id FROM product_requests WHERE id = $1', [guest.body.data.request.id])).rows[0];
    expect(row.user_id).toBeNull();
    for (let i = 2; i <= 5; i++) expect((await ask({ name: `Zqxreq guest item ${i}` })).status).toBe(201);
    const over = await ask({ name: 'Zqxreq guest item 6' });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('TOO_MANY_REQUESTS');
    authRateLimiter.reset();
  });
});

describe('the staff list', () => {
  it('groups by the tidied name, counts people, most requested first or newest first', async () => {
    expect((await ask({ name: 'zqxreq kithul   treacle' }, smsOnly.token)).status).toBe(201);
    expect((await ask({ name: 'Zqxreq Kithul treacle' }, landline.token)).status).toBe(201);
    expect((await ask({ name: 'Zqxreq Palmyra Jaggery' }, withDevice.token)).status).toBe(201);
    expect((await ask({ name: 'Zqxreq palmyra jaggery' }, smsOnly.token)).status).toBe(201);
    expect((await ask({ name: 'Zqxreq Dried Fish' }, smsOnly.token)).status).toBe(201);

    const popular = await groups({ sort: 'popular' });
    const kithul = popular.find((g) => g.key === 'zqxreq kithul treacle');
    // withDevice + smsOnly + landline + one guest
    expect(kithul).toMatchObject({ name: 'Zqxreq Kithul treacle', count: 4, requests_total: 4, status: 'NEW', product_id: null });
    expect(kithul.category_name).toBeTruthy();
    expect(kithul.requests).toHaveLength(4);
    expect(kithul.requests.filter((r: any) => r.guest)).toHaveLength(1);
    expect(kithul.requests.find((r: any) => r.customer?.id === smsOnly.id).customer).toMatchObject({ name: smsOnly.fullName, phone: smsOnly.phone });
    const order = popular.map((g) => g.key);
    expect(order.indexOf('zqxreq kithul treacle')).toBeLessThan(order.indexOf('zqxreq palmyra jaggery'));
    expect(order.indexOf('zqxreq palmyra jaggery')).toBeLessThan(order.indexOf('zqxreq dried fish'));

    const newest = (await groups({ sort: 'newest' })).map((g) => g.key);
    expect(newest[0]).toBe('zqxreq dried fish');
    expect(newest.indexOf('zqxreq palmyra jaggery')).toBeLessThan(newest.indexOf('zqxreq kithul treacle'));
  });

  it('is for Admin and Operations only, and checks its filters', async () => {
    expect((await request(app).get('/api/v1/admin/product-requests').set(auth(tokens.customer))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/product-requests').set(auth(tokens.staff))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/product-requests').query({ sort: 'loud' }).set(auth(tokens.admin))).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/product-requests').query({ status: 'MAYBE' }).set(auth(tokens.admin))).status).toBe(400);
    expect((await patch('zqxreq dried fish', { status: 'PLANNED' }, tokens.customer)).status).toBe(403);
  });
});

describe('changing a group', () => {
  it('PLANNED applies to the whole group; a new request joins it; the status filter finds it', async () => {
    const res = await patch('Zqxreq  KITHUL treacle', { status: 'PLANNED', staff_note: 'Asked the supplier' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 4, notified: 0, group: { key: 'zqxreq kithul treacle', status: 'PLANNED', staff_note: 'Asked the supplier' } });
    const statuses = (await pool.query(`SELECT DISTINCT status FROM product_requests WHERE name_key = 'zqxreq kithul treacle'`)).rows;
    expect(statuses).toEqual([{ status: 'PLANNED' }]);

    const joined = await ask({ name: 'Zqxreq kithul treacle' }, late.token);
    expect(joined.body.data.request.status).toBe('PLANNED');
    expect((await groups({ status: 'PLANNED' })).map((g) => g.key)).toEqual(['zqxreq kithul treacle']);
    expect((await groups({ status: 'new' })).map((g) => g.key)).not.toContain('zqxreq kithul treacle');
    const audit = (
      await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'PRODUCT_REQUESTS_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`, [testStart])
    ).rows[0];
    expect(audit.new_values).toMatchObject({ key: 'zqxreq kithul treacle', status: 'PLANNED', requests: 4 });
  });

  it('refuses a product unless ADDED, an unknown product and an unknown group', async () => {
    const a = await patch('zqxreq dried fish', { status: 'PLANNED', product_id: liveProduct.id });
    expect(a.status).toBe(400);
    expect(a.body.error.code).toBe('PRODUCT_ONLY_WHEN_ADDED');
    const b = await patch('zqxreq dried fish', { status: 'ADDED', product_id: '00000000-0000-4000-8000-000000000000' });
    expect(b.status).toBe(400);
    expect(b.body.error.code).toBe('PRODUCT_NOT_FOUND');
    const c = await patch('zqxreq never asked', { status: 'DECLINED' });
    expect(c.status).toBe(404);
    expect(c.body.error.code).toBe('PRODUCT_REQUEST_NOT_FOUND');
    expect((await patch('zqxreq dried fish', { status: 'GONE' })).status).toBe(400);
  });

  it('ADDED with a live product tells each requester once: a push with a device, else an SMS; guests and unreachable numbers nothing', async () => {
    setPushSenderForTests(fake);
    const res = await patch('zqxreq kithul treacle', { status: 'ADDED', product_id: liveProduct.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // withDevice (push), smsOnly (SMS), late (SMS); landline: no SMS can reach it; the guest: no contact
    expect(res.body.data).toMatchObject({ updated: 5, notified: 3, notify_skipped: null });
    expect(res.body.data.group).toMatchObject({ status: 'ADDED', product_id: liveProduct.id, product_name: liveProduct.name });

    const push = await told(withDevice.id);
    expect(push).toHaveLength(1);
    expect(push[0]).toMatchObject({ channel: 'PUSH', notification_type: 'PUSH_PRODUCT_REQUEST_ADDED', status: 'QUEUED' });
    const shortName = liveProduct.name.length > 60 ? `${liveProduct.name.slice(0, 57)}...` : liveProduct.name;
    expect(push[0].payload).toMatchObject({ title: `${shortName} is now available`, data: { type: 'product', product_id: liveProduct.id } });
    const sms = await told(smsOnly.id);
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ channel: 'SMS', notification_type: 'PRODUCT_REQUEST_ADDED', recipient: smsOnly.phone });
    expect(sms[0].payload.text).toBe(`Blynk: ${shortName} is now available. Order it in the Blynk app.`);
    expect(await told(landline.id)).toHaveLength(0);

    const { NotificationTemplates } = await import('../src/modules/notifications/notification.templates.js');
    expect(NotificationTemplates.render('PRODUCT_REQUEST_ADDED', sms[0].payload)).toBe(sms[0].payload.text);

    // once per product: setting it again tells nobody twice
    const again = await patch('zqxreq kithul treacle', { status: 'ADDED' });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ notified: 0, group: { product_id: liveProduct.id } });
    expect(await told(withDevice.id)).toHaveLength(1);
    await clearTold([withDevice.id, smsOnly.id, late.id]);

    // the customer sees it, with the product
    const mine = (await request(app).get('/api/v1/me/product-requests').set(auth(smsOnly.token))).body.data.requests as any[];
    expect(mine.find((r) => r.name === 'zqxreq kithul treacle')).toMatchObject({
      status: 'ADDED',
      product_id: liveProduct.id,
      product: { id: liveProduct.id, name: liveProduct.name },
    });
    // a new request (a guest's) joins ADDED, with the product
    authRateLimiter.reset();
    const joined = await ask({ name: 'Zqxreq Kithul Treacle' });
    expect(joined.status).toBe(201);
    expect(joined.body.data.request).toMatchObject({ status: 'ADDED', product_id: liveProduct.id });
    authRateLimiter.reset();
  });

  it('a notification that cannot be queued never fails the change', async () => {
    setPushSenderForTests(fake);
    await pool.query(`CREATE OR REPLACE FUNCTION zqx_prq_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${withDevice.id}'::uuid AND NEW.notification_type = 'PUSH_PRODUCT_REQUEST_ADDED' THEN
          RAISE EXCEPTION 'zqx test: outbox refused';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await pool.query('CREATE TRIGGER zqx_prq_fail BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION zqx_prq_fail()');
    try {
      const res = await patch('zqxreq palmyra jaggery', { status: 'ADDED', product_id: liveProduct.id });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // withDevice's push is refused by the outbox; smsOnly's SMS still goes in (this file cleared its
      // earlier row for the same product, else "once per product" would skip it)
      expect(res.body.data).toMatchObject({ updated: 2, notified: 1, group: { status: 'ADDED' } });
      expect(await told(withDevice.id)).toHaveLength(0);
      expect(await told(smsOnly.id)).toHaveLength(1);
      await clearTold([smsOnly.id]);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS zqx_prq_fail ON notifications');
      await pool.query('DROP FUNCTION IF EXISTS zqx_prq_fail()');
    }
    const statuses = (await pool.query(`SELECT DISTINCT status FROM product_requests WHERE name_key = 'zqxreq palmyra jaggery'`)).rows;
    expect(statuses).toEqual([{ status: 'ADDED' }]);
  });

  it('a product that is not live yet is linked but nobody is told', async () => {
    setPushSenderForTests(fake);
    const res = await patch('zqxreq dried fish', { status: 'ADDED', product_id: hiddenProduct, staff_note: 'Coming Monday' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ notified: 0, notify_skipped: 'PRODUCT_NOT_LIVE', group: { status: 'ADDED', product_id: hiddenProduct } });
    expect(await told(smsOnly.id)).toHaveLength(0);
    // DECLINED unlinks the product; the next request starts NEW again
    const declined = await patch('zqxreq dried fish', { status: 'DECLINED' });
    expect(declined.body.data.group).toMatchObject({ status: 'DECLINED', product_id: null, staff_note: 'Coming Monday' });
    const again = await ask({ name: 'Zqxreq dried fish' }, late.token);
    expect(again.body.data.request.status).toBe('NEW');
    expect((await groups()).find((g) => g.key === 'zqxreq dried fish').status).toBe('NEW');
  });
});
