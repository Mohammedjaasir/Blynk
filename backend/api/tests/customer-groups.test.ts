import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { parseAudienceQuery } from '../src/modules/notifications/customer-groups.js';
import { tokens, auth, STORE } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * Customer groups for push broadcasts and SMS offers (owner, 2026-10-24: "push / SMS only to people
 * who haven't ordered in 14 days, new customers, big spenders"). The shared database holds other
 * customers too, so membership is checked on this file's customers' outbox rows; every row, order,
 * device and audit row made here is removed.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c0e056', phoneBase: '+947095600', name: 'Zqxgroup Shopper' });
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const DEVICE = `groups-test-device-${Date.now()}`;
const offerIds: string[] = [];
let testStart: Date;
let seq = 0;

type Who = 'lapsed' | 'recent10' | 'newbie' | 'bigSpender' | 'oldBigSpender' | 'cancelledOnly' | 'inactive' | 'optedOut' | 'brandNew';
const ids = {} as Record<Who, string>;

async function order(customerId: string, status: string, daysAgo: number, total: number, wallet = 0) {
  seq += 1;
  await pool.query(
    `INSERT INTO orders (order_number, idempotency_key, customer_id, dark_store_id, order_status, subtotal_amount, delivery_fee, total_amount,
                         wallet_amount_used, delivery_recipient_name, delivery_recipient_phone, delivery_address_line1, delivery_city,
                         delivery_latitude, delivery_longitude, placed_at, created_at)
     VALUES ($1, $1, $2, $3, $4, $5::numeric + $6::numeric, 0, $5, $6, 'Group Test', '+94709560099', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243,
             now() - make_interval(days => $7::int), now() - make_interval(days => $7::int))`,
    [`TST-GRP-${seq}-${Date.now()}`, customerId, STORE, status, total, wallet, daysAgo]
  );
}

const joinedDaysAgo = (id: string, days: number) =>
  pool.query(`UPDATE users SET created_at = now() - make_interval(days => $2::int) WHERE id = $1`, [id, days]);

const clearCooldown = () => pool.query(`DELETE FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at > now() - interval '5 minutes'`);

/** Sends a broadcast to `audience` and returns which of this file's customers got it (then removes the rows). */
async function pushTo(audience?: object): Promise<Set<Who>> {
  await clearCooldown();
  const res = await request(app)
    .post('/api/v1/admin/push-broadcasts')
    .set(auth(opsToken))
    .send({ title: 'Groups test', body: 'Hello from the groups test', ...(audience ? { audience } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const rows = (
    await pool.query(`SELECT user_id FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND payload->'data'->>'broadcast_id' = $1`, [
      res.body.data.id,
    ])
  ).rows.map((r) => r.user_id as string);
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND payload->'data'->>'broadcast_id' = $1`, [res.body.data.id]);
  return new Set((Object.keys(ids) as Who[]).filter((w) => rows.includes(ids[w])));
}

/** Sends an SMS offer to `audience` and returns which of this file's customers got it (rows removed in afterAll). */
async function smsTo(audience?: unknown): Promise<{ who: Set<Who>; offerId: string; body: any }> {
  const res = await request(app)
    .post('/api/v1/admin/sms-offers')
    .set(auth(tokens.admin))
    .send({ ...(audience !== undefined ? { audience } : {}), fallback_language: 'en', messages: { en: 'Groups test offer' } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const offerId = res.body.data.offer.id as string;
  offerIds.push(offerId);
  const rows = (await pool.query(`SELECT user_id FROM notifications WHERE payload->>'offer_id' = $1`, [offerId])).rows.map((r) => r.user_id as string);
  // out of the shared outbox at once
  await pool.query(`DELETE FROM notifications WHERE payload->>'offer_id' = $1`, [offerId]);
  return { who: new Set((Object.keys(ids) as Who[]).filter((w) => rows.includes(ids[w]))), offerId, body: res.body.data.offer };
}

const set = (...w: Who[]) => new Set<Who>(w);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  await people.purge();
  const names: Who[] = ['lapsed', 'recent10', 'newbie', 'bigSpender', 'oldBigSpender', 'cancelledOnly', 'inactive', 'optedOut', 'brandNew'];
  for (const [i, w] of names.entries()) ids[w] = (await people.customer(i + 1)).id;

  // lapsed: one delivered order 30 days ago
  await joinedDaysAgo(ids.lapsed, 60);
  await order(ids.lapsed, 'DELIVERED', 30, 1200);
  // recent10: delivered 10 days ago - lapsed for 7 days, not for 14
  await joinedDaysAgo(ids.recent10, 60);
  await order(ids.recent10, 'DELIVERED', 10, 900);
  // newbie: joined 5 days ago, never ordered
  await joinedDaysAgo(ids.newbie, 5);
  // bigSpender: LKR 4000 + 2000 from the wallet, delivered 20 days ago; a cancelled one never counts
  await joinedDaysAgo(ids.bigSpender, 200);
  await order(ids.bigSpender, 'DELIVERED', 20, 4000, 2000);
  await order(ids.bigSpender, 'CANCELLED', 25, 9000);
  // oldBigSpender: LKR 8000 delivered 120 days ago, nothing since
  await joinedDaysAgo(ids.oldBigSpender, 300);
  await order(ids.oldBigSpender, 'DELIVERED', 120, 8000);
  // cancelledOnly: placed once, cancelled - neither lapsed nor never-ordered
  await joinedDaysAgo(ids.cancelledOnly, 100);
  await order(ids.cancelledOnly, 'CANCELLED', 40, 700);
  // inactive: a deactivated account is in no group
  await joinedDaysAgo(ids.inactive, 3);
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [ids.inactive]);
  // optedOut: never ordered, turned offers by SMS off (push still reaches them)
  await joinedDaysAgo(ids.optedOut, 100);
  await pool.query('UPDATE users SET sms_offers_opted_out_at = now() WHERE id = $1', [ids.optedOut]);
  // brandNew: joined just now (no change)

  for (const [i, w] of names.entries()) {
    await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'web')`, [ids[w], `${DEVICE}-${i}`]);
  }
  setPushSenderForTests(fake);
});

afterEach(() => setPushSenderForTests(fake));

afterAll(async () => {
  setPushSenderForTests(undefined);
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BROADCAST' AND created_at >= $1 AND payload->>'title' = 'Groups test'`, [testStart]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at >= $1`, [testStart]);
  for (const id of offerIds) {
    await pool.query(`DELETE FROM notifications WHERE payload->>'offer_id' = $1`, [id]);
    await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'sms_offer' AND entity_id = $1`, [id]);
    await pool.query('DELETE FROM sms_offers WHERE id = $1', [id]);
  }
  await pool.query('DELETE FROM device_tokens WHERE token LIKE $1', [`${DEVICE}-%`]);
  await people.cleanup();
});

describe('audience parameters', () => {
  it('defaults the numbers, accepts query strings, and refuses out-of-range values', () => {
    expect(parseAudienceQuery({})).toEqual({ group: 'ALL' });
    expect(parseAudienceQuery({ group: 'lapsed' })).toEqual({ group: 'LAPSED', days: 14 });
    expect(parseAudienceQuery({ group: 'NEW', days: '' })).toEqual({ group: 'NEW', days: 14 });
    expect(parseAudienceQuery({ group: 'BIG_SPENDERS' })).toEqual({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 });
    expect(parseAudienceQuery({ group: 'BIG_SPENDERS', days: '30', min_spend_lkr: '2500.5' })).toEqual({ group: 'BIG_SPENDERS', days: 30, min_spend_lkr: 2500.5 });
    expect(parseAudienceQuery({ group: 'NEVER_ORDERED', days: '5' })).toEqual({ group: 'NEVER_ORDERED' });
    for (const bad of [
      { group: 'FOO' },
      { group: 'LAPSED', days: '6' },
      { group: 'LAPSED', days: '91' },
      { group: 'NEW', days: '0' },
      { group: 'NEW', days: '61' },
      { group: 'BIG_SPENDERS', days: '29' },
      { group: 'BIG_SPENDERS', days: '366' },
      { group: 'BIG_SPENDERS', min_spend_lkr: '0' },
      { group: 'LAPSED', days: '7.5' },
    ]) {
      expect(() => parseAudienceQuery(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('the previews answer 400 for a bad group and 403 for other roles', async () => {
    for (const path of ['/api/v1/admin/push-broadcasts/audience', '/api/v1/admin/sms-offers/audience']) {
      expect((await request(app).get(path).query({ group: 'NOPE' }).set(auth(tokens.admin))).status).toBe(400);
      expect((await request(app).get(path).query({ group: 'LAPSED', days: 100 }).set(auth(tokens.admin))).status).toBe(400);
      expect((await request(app).get(path).set(auth(tokens.customer))).status).toBe(403);
    }
    const bad = await request(app)
      .post('/api/v1/admin/push-broadcasts')
      .set(auth(opsToken))
      .send({ title: 'Groups test', body: 'Hello there', audience: { group: 'NEW', days: 90 } });
    expect(bad.status).toBe(400);
    const badSms = await request(app)
      .post('/api/v1/admin/sms-offers/estimate')
      .set(auth(tokens.admin))
      .send({ audience: { group: 'SOMEONE' }, fallback_language: 'en', messages: { en: 'x' } });
    expect(badSms.status).toBe(400);
  });
});

describe('push broadcast groups', () => {
  it('no audience = every active customer with a device, as before (audited as ALL)', async () => {
    const plain = (await request(app).get('/api/v1/admin/push-broadcasts/audience').set(auth(tokens.admin))).body.data;
    const all = (await request(app).get('/api/v1/admin/push-broadcasts/audience').query({ group: 'ALL' }).set(auth(tokens.admin))).body.data;
    const raw = (
      await pool.query(
        `SELECT count(DISTINCT u.id)::int AS customers, count(*)::int AS devices FROM device_tokens d JOIN users u ON u.id = d.user_id
         WHERE u.role = 'CUSTOMER' AND u.is_active = true`
      )
    ).rows[0];
    expect(plain).toMatchObject({ customers: raw.customers, devices: raw.devices, audience: { group: 'ALL' } });
    expect(all).toMatchObject({ customers: raw.customers, devices: raw.devices });

    expect(await pushTo()).toEqual(set('lapsed', 'recent10', 'newbie', 'bigSpender', 'oldBigSpender', 'cancelledOnly', 'optedOut', 'brandNew'));
    const audit = (
      await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`, [testStart])
    ).rows[0];
    expect(audit.new_values.audience).toEqual({ group: 'ALL' });
  });

  it('LAPSED: a delivered order, none placed in the last N days', async () => {
    expect(await pushTo({ group: 'LAPSED' })).toEqual(set('lapsed', 'bigSpender', 'oldBigSpender'));
    expect(await pushTo({ group: 'LAPSED', days: 7 })).toEqual(set('lapsed', 'recent10', 'bigSpender', 'oldBigSpender'));
    const audit = (
      await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'PUSH_BROADCAST_SENT' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`, [testStart])
    ).rows[0];
    expect(audit.new_values.audience).toEqual({ group: 'LAPSED', days: 7 });
    const list = await request(app).get('/api/v1/admin/push-broadcasts').set(auth(tokens.admin));
    expect(list.body.data.broadcasts[0].audience).toEqual({ group: 'LAPSED', days: 7 });
  });

  it('NEW: joined in the last N days', async () => {
    expect(await pushTo({ group: 'NEW' })).toEqual(set('newbie', 'brandNew'));
    expect(await pushTo({ group: 'NEW', days: 1 })).toEqual(set('brandNew'));
  });

  it('BIG_SPENDERS: delivered spend (wallet included) in the last N days at or over the minimum', async () => {
    expect(await pushTo({ group: 'BIG_SPENDERS' })).toEqual(set('bigSpender'));
    expect(await pushTo({ group: 'BIG_SPENDERS', days: 150, min_spend_lkr: 5000 })).toEqual(set('bigSpender', 'oldBigSpender'));
    expect(await pushTo({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 6000 })).toEqual(set('bigSpender'));
    expect(await pushTo({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 6001 })).toEqual(set());
  });

  it('NEVER_ORDERED: signed up, never placed an order', async () => {
    expect(await pushTo({ group: 'NEVER_ORDERED' })).toEqual(set('newbie', 'optedOut', 'brandNew'));
  });

  it('the preview counts the group: devices and customers move with it', async () => {
    const q = { group: 'BIG_SPENDERS', days: 150, min_spend_lkr: 5000 };
    const before = (await request(app).get('/api/v1/admin/push-broadcasts/audience').query(q).set(auth(opsToken))).body.data;
    expect(before.customers).toBeGreaterThanOrEqual(2);
    expect(before.devices).toBeGreaterThanOrEqual(2);
    expect(before.audience).toEqual(q);
    await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android')`, [ids.oldBigSpender, `${DEVICE}-extra`]);
    const more = (await request(app).get('/api/v1/admin/push-broadcasts/audience').query(q).set(auth(opsToken))).body.data;
    expect(more.devices - before.devices).toBe(1);
    expect(more.customers).toBe(before.customers);
    await pool.query(`UPDATE orders SET order_status = 'CANCELLED' WHERE customer_id = $1`, [ids.oldBigSpender]);
    const fewer = (await request(app).get('/api/v1/admin/push-broadcasts/audience').query(q).set(auth(opsToken))).body.data;
    expect(before.customers - fewer.customers).toBe(1);
    expect(more.devices - fewer.devices).toBe(2);
    await pool.query(`UPDATE orders SET order_status = 'DELIVERED' WHERE customer_id = $1`, [ids.oldBigSpender]);
    await pool.query('DELETE FROM device_tokens WHERE token = $1', [`${DEVICE}-extra`]);
  });
});

describe('SMS offer groups', () => {
  it('the original audiences still work, and a missing audience is ALL', async () => {
    const legacy = await request(app)
      .post('/api/v1/admin/sms-offers/estimate')
      .set(auth(tokens.admin))
      .send({ audience: 'NEVER_ORDERED', fallback_language: 'en', messages: { en: 'Hi' } });
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.estimate.audience).toBe('NEVER_ORDERED');

    const none = await smsTo(undefined);
    expect(none.who).toEqual(set('lapsed', 'recent10', 'newbie', 'bigSpender', 'oldBigSpender', 'cancelledOnly', 'brandNew'));
    const row = (await pool.query('SELECT audience FROM sms_offers WHERE id = $1', [none.offerId])).rows[0];
    expect(row.audience).toBe('ALL');

    const ordered = await smsTo('ORDERED_90D');
    expect(ordered.who).toEqual(set('lapsed', 'recent10', 'bigSpender', 'cancelledOnly'));
  });

  it('each group reaches its members only (opted-out and inactive customers never)', async () => {
    expect((await smsTo({ group: 'ALL' })).who).toEqual(set('lapsed', 'recent10', 'newbie', 'bigSpender', 'oldBigSpender', 'cancelledOnly', 'brandNew'));
    expect((await smsTo({ group: 'LAPSED' })).who).toEqual(set('lapsed', 'bigSpender', 'oldBigSpender'));
    expect((await smsTo({ group: 'LAPSED', days: 7 })).who).toEqual(set('lapsed', 'recent10', 'bigSpender', 'oldBigSpender'));
    expect((await smsTo({ group: 'NEW', days: 14 })).who).toEqual(set('newbie', 'brandNew'));
    expect((await smsTo({ group: 'NEW', days: 1 })).who).toEqual(set('brandNew'));
    expect((await smsTo({ group: 'BIG_SPENDERS' })).who).toEqual(set('bigSpender'));
    expect((await smsTo({ group: 'BIG_SPENDERS', days: 150, min_spend_lkr: 5000 })).who).toEqual(set('bigSpender', 'oldBigSpender'));
    expect((await smsTo({ group: 'NEVER_ORDERED' })).who).toEqual(set('newbie', 'brandNew'));
  });

  it('a group offer is stored as ALL (or NEVER_ORDERED), audited and listed with its group', async () => {
    const sent = await smsTo({ group: 'LAPSED', days: 21 });
    expect(sent.body.audience).toEqual({ group: 'LAPSED', days: 21 });
    expect((await pool.query('SELECT audience FROM sms_offers WHERE id = $1', [sent.offerId])).rows[0].audience).toBe('ALL');
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE entity_type = 'sms_offer' AND entity_id = $1`, [sent.offerId])).rows[0];
    expect(audit.new_values.audience).toEqual({ group: 'LAPSED', days: 21 });

    const never = await smsTo({ group: 'NEVER_ORDERED' });
    expect((await pool.query('SELECT audience FROM sms_offers WHERE id = $1', [never.offerId])).rows[0].audience).toBe('NEVER_ORDERED');

    const list = (await request(app).get('/api/v1/admin/sms-offers').set(auth(tokens.admin))).body.data.offers as any[];
    expect(list.find((o) => o.id === sent.offerId)).toMatchObject({ audience: 'ALL', audience_group: { group: 'LAPSED', days: 21 } });
    expect(list.find((o) => o.id === never.offerId)).toMatchObject({ audience: 'NEVER_ORDERED', audience_group: { group: 'NEVER_ORDERED' } });
  });

  it('the estimate takes a group too', async () => {
    const res = await request(app)
      .post('/api/v1/admin/sms-offers/estimate')
      .set(auth(tokens.admin))
      .send({ audience: { group: 'NEVER_ORDERED' }, fallback_language: 'en', messages: { en: 'Hi' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const e = res.body.data.estimate;
    expect(e.audience).toEqual({ group: 'NEVER_ORDERED' });
    expect(e.recipients).toBeGreaterThanOrEqual(2);
    expect(e.opted_out).toBeGreaterThanOrEqual(1);
  });

  it('the SMS preview counts customers, reachable phones and opted-out ones', async () => {
    const q = { group: 'NEVER_ORDERED' };
    const before = (await request(app).get('/api/v1/admin/sms-offers/audience').query(q).set(auth(opsToken))).body.data;
    expect(before.audience).toEqual(q);
    expect(before.customers).toBeGreaterThanOrEqual(2);
    expect(before.phones).toBeGreaterThanOrEqual(2);
    expect(before.opted_out).toBeGreaterThanOrEqual(1);
    // a number no SMS can reach still counts as a customer, not as a phone
    await pool.query("UPDATE users SET phone = '+94112956099' WHERE id = $1", [ids.brandNew]);
    const after = (await request(app).get('/api/v1/admin/sms-offers/audience').query(q).set(auth(opsToken))).body.data;
    expect(after.customers).toBe(before.customers);
    expect(before.phones - after.phones).toBe(1);
    await pool.query("UPDATE users SET phone = '+94709560009' WHERE id = $1", [ids.brandNew]);
    const all = (await request(app).get('/api/v1/admin/sms-offers/audience').set(auth(opsToken))).body.data;
    expect(all.audience).toEqual({ group: 'ALL' });
    expect(all.customers).toBeGreaterThanOrEqual(before.customers);
  });
});
