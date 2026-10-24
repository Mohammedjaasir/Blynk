import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Push to every customer who allowed notifications (owner, 2026-10-19: "store is open now, start
 * ordering", from Admin, the backup admin and Ops). Everything made here is removed afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const DEVICE = `broadcast-test-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
let testStart: Date;

const audience = (token = tokens.admin) => request(app).get('/api/v1/admin/push-broadcasts/audience').set(auth(token));
const send = (body: object, token = tokens.admin) => request(app).post('/api/v1/admin/push-broadcasts').set(auth(token)).send(body);
const cleanup = async () => {
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND created_at >= $1`, [testStart]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at >= $1`, [testStart]);
};

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  // older broadcasts would trip the 2-minute cooldown
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at > now() - interval '5 minutes'`);
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'web') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
    users.customer.id,
    DEVICE,
  ]);
});

afterEach(() => setPushSenderForTests(undefined));

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
});

describe('push broadcast', () => {
  it('push not set up on the server: the audience says so and sending is refused', async () => {
    setPushSenderForTests(null);
    const a = await audience();
    expect(a.status).toBe(200);
    expect(a.body.data.push_enabled).toBe(false);
    expect(a.body.data.customers).toBeGreaterThanOrEqual(1);
    const res = await send({ title: 'Store is open', body: 'Start ordering now' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PUSH_NOT_CONFIGURED');
  });

  it('Ops sends one: a push is queued for every customer with a device, audited, listed; a second within 2 minutes is refused', async () => {
    setPushSenderForTests(fake);
    expect((await audience(opsToken)).body.data.push_enabled).toBe(true);
    const res = await send({ title: '  Store is open now  ', body: 'Start ordering on Blynk' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.queued).toBeGreaterThanOrEqual(1);

    const row = (
      await pool.query(`SELECT recipient, payload, status FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND recipient = $1 AND created_at >= $2`, [
        users.customer.id,
        testStart,
      ])
    ).rows[0];
    expect(row.status).toBe('QUEUED');
    expect(row.payload).toMatchObject({ title: 'Store is open now', body: 'Start ordering on Blynk', data: { kind: 'broadcast', broadcast_id: res.body.data.id } });

    const list = await request(app).get('/api/v1/admin/push-broadcasts').set(auth(tokens.admin));
    expect(list.body.data.broadcasts[0]).toMatchObject({ id: res.body.data.id, title: 'Store is open now', queued: res.body.data.queued });

    const again = await send({ title: 'Store is open now', body: 'Start ordering on Blynk' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('BROADCAST_TOO_SOON');
    // out of the shared outbox at once, so other files' worker batches never meet them
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND created_at >= $1`, [testStart]);
  });

  it('a picture rides along (owner, 2026-10-24: a big-picture notification): queued, listed, and handed to the sender', async () => {
    const seen: Array<{ title: string; image?: string }> = [];
    setPushSenderForTests({ send: async (ts, m) => { seen.push({ title: m.title, image: m.image }); return ts.map((token) => ({ token, ok: true as const })); } });
    const url = 'https://blynk-api.valgrowlabs.com/uploads/promotions/juice.webp';
    await pool.query(`DELETE FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at > now() - interval '5 minutes'`);
    const res = await send({ title: 'Fresh juices', body: 'Cold and ready until 6 pm', image_url: url }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (await pool.query(`SELECT payload FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND recipient = $1 AND created_at >= $2`, [users.customer.id, testStart])).rows[0];
    expect(row.payload).toMatchObject({ title: 'Fresh juices', image: url });
    const list = await request(app).get('/api/v1/admin/push-broadcasts').set(auth(tokens.admin));
    expect(list.body.data.broadcasts[0]).toMatchObject({ id: res.body.data.id, image_url: url });

    // the provider hands the picture on to the sender
    const { PushProvider } = await import('../src/modules/notifications/push/push.provider.js');
    await new PushProvider().send({ notificationId: 'n1', recipient: users.customer.id, metadata: row.payload } as never);
    expect(seen).toEqual([{ title: 'Fresh juices', image: url }]);
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND created_at >= $1`, [testStart]);
    await pool.query(`DELETE FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at >= $1`, [testStart]);
  });

  it('refuses a picture that is not an https address', async () => {
    setPushSenderForTests(fake);
    expect((await send({ title: 'Hi there', body: 'Hello there', image_url: 'http://example.com/a.png' })).status).toBe(400);
    expect((await send({ title: 'Hi there', body: 'Hello there', image_url: 'not a url' })).status).toBe(400);
    expect((await send({ title: 'Hi there', body: 'Hello there', image_url: `https://x.lk/${'a'.repeat(500)}` })).status).toBe(400);
  });

  it('refuses bad input and other roles', async () => {
    setPushSenderForTests(fake);
    expect((await send({ title: '', body: 'x y' })).status).toBe(400);
    expect((await send({ title: 'x'.repeat(61), body: 'Hello there' })).status).toBe(400);
    expect((await send({ title: 'Hi', body: 'x'.repeat(181) })).status).toBe(400);
    expect((await send({ title: 'Hi', body: 'Hello', extra: 1 })).status).toBe(400);
    expect((await send({ title: 'Hi', body: 'Hello' }, tokens.customer)).status).toBe(403);
    expect((await audience(tokens.customer)).status).toBe(403);
  });
});
