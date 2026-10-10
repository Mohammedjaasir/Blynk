import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { DEFAULT_BIRTHDAY_OFFER, type BirthdayOfferSetting } from '../src/modules/configuration/settings.service.js';
import {
  ageOn,
  birthdayDiscount,
  birthdayWindow,
  colomboDay,
  dateOfBirthProblem,
  isoDay,
  monthDayCodes,
  parseIsoDate,
} from '../src/modules/birthday/birthday.rules.js';
import { BIRTHDAY_SMS_DAYS_KEY, birthdayDaysToText, birthdaySmsKey, runBirthdaySms } from '../src/modules/birthday/birthday.sms.js';
import { DEFAULT_STORED_SCHEDULE, storeSchedule, type StoredSchedule } from '../src/modules/configuration/store-schedule.js';
import { uniformWeek } from '../src/utils/store-hours.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Customer profile and birthday offer (owner, 2026-10-09; migration 034).
 * The checkout clock is pinned to 2026-10-06 12:00 Colombo
 * (tests/setup/ordering-clock.ts), so a 6 October birthday is "this week".
 * The birthday_offer row is restored afterwards with the audit rows written.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-BDAY-');
const people = customerFixtures(app, { idPrefix: 'c0c00034', phoneBase: '+947093400', name: 'Birthday Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEY = 'birthday_offer';
const COUPON = 'TSTBDAY50';
const TODAY_DOB = '1990-10-06'; // birthday on the pinned checkout day

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row | undefined;
/** The birthday SMS job's day marker (owner, 2026-10-10), restored afterwards. */
let savedDays: Row | undefined;
let testStart: Date;
let productId = '';
let product2Id = '';
let categoryId = '';

const patchSetting = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/birthday-offer').set(auth(token)).send(body);
const patchMe = (token: string, body: object) => request(app).patch('/api/v1/me').set(auth(token)).send(body);
const deleteRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [KEY]);
const turnOn = async (percent = 10) => expect((await patchSetting({ enabled: true, percent })).status).toBe(200);

beforeAll(async () => {
  await people.purge();
  await pool.query('DELETE FROM coupons WHERE code = $1', [COUPON]);
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [KEY])).rows[0];
  savedDays = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [BIRTHDAY_SMS_DAYS_KEY])).rows[0];
  productId =(await fx.product({ tracked: false })).productId;
  product2Id = (await fx.product({ tracked: false })).productId;
  categoryId = (await pool.query('SELECT id FROM categories WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].id;
  const res = await request(app)
    .post('/api/v1/admin/coupons')
    .set(auth(tokens.admin))
    .send({ code: COUPON, discount_type: 'FIXED', discount_value: 50, per_customer_limit: 5 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = $1)', [COUPON]);
  await pool.query('DELETE FROM coupons WHERE code = $1', [COUPON]);
  // Coupon changes are audited (owner, 2026-10-10).
  await pool.query("DELETE FROM audit_logs WHERE entity_type = 'COUPON' AND coalesce(new_values->>'code', old_values->>'code') = $1", [COUPON]);
  await deleteRow();
  if (saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      [saved.key, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'BIRTHDAY_OFFER_UPDATED' AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM system_configurations WHERE key = $1', [BIRTHDAY_SMS_DAYS_KEY]);
  if (savedDays) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      [savedDays.key, JSON.stringify(savedDays.value), savedDays.description, savedDays.created_at, savedDays.updated_at]
    );
  }
});

// ----------------------------------------------------------------------------
describe('Birthday rules', () => {
  const day = (iso: string) => parseIsoDate(iso)!;

  it('the birthday week is the birthday +-3 days, across New Year too', () => {
    const w = birthdayWindow(day('1990-10-06'), day('2026-10-09'));
    expect([isoDay(w.start), isoDay(w.birthday), isoDay(w.end), w.in_window, w.offer_year]).toEqual([
      '2026-10-03',
      '2026-10-06',
      '2026-10-09',
      true,
      2026,
    ]);
    expect(birthdayWindow(day('1990-10-06'), day('2026-10-10')).in_window).toBe(false);
    expect(isoDay(birthdayWindow(day('1990-10-06'), day('2026-10-10')).birthday)).toBe('2027-10-06');
    // A 30 December birthday: 2 January is still that birthday's week.
    const nye = birthdayWindow(day('1995-12-30'), day('2027-01-02'));
    expect([nye.in_window, nye.offer_year, isoDay(nye.birthday)]).toEqual([true, 2026, '2026-12-30']);
    // 2 January birthday seen on 30 December: next year's birthday.
    expect(birthdayWindow(day('1995-01-02'), day('2026-12-30')).offer_year).toBe(2027);
  });

  it('a 29 February birthday falls on 28 February in other years', () => {
    expect(isoDay(birthdayWindow(day('2000-02-29'), day('2027-02-28')).birthday)).toBe('2027-02-28');
    expect(isoDay(birthdayWindow(day('2000-02-29'), day('2028-02-27')).birthday)).toBe('2028-02-29');
    expect(monthDayCodes([day('2027-02-28')]).sort()).toEqual([228, 229]);
    expect(monthDayCodes([day('2028-02-28')])).toEqual([228]);
  });

  it('accepts an age of 5 to 120, never a future or impossible date', () => {
    const now = new Date('2026-10-09T06:00:00Z');
    expect(dateOfBirthProblem('1990-10-06', now)).toBeNull();
    expect(dateOfBirthProblem('2021-10-09', now)).toBeNull(); // 5 today
    expect(dateOfBirthProblem('2021-10-10', now)).toMatch(/at least 5/);
    expect(dateOfBirthProblem('1905-10-10', now)).toBeNull(); // 120, until the 121st birthday
    expect(dateOfBirthProblem('1905-10-09', now)).toMatch(/age 120 at most/); // 121 today
    expect(dateOfBirthProblem('2027-01-01', now)).toMatch(/future/);
    expect(dateOfBirthProblem('1990-02-30', now)).toMatch(/real date/);
    expect(dateOfBirthProblem('06/10/1990', now)).toMatch(/real date/);
    expect(ageOn(day('1990-10-06'), colomboDay(now))).toBe(36);
  });

  it('the gift is a % of the item subtotal, to the cent', () => {
    expect(birthdayDiscount(1234.5, 10)).toBe(123.45);
    expect(birthdayDiscount(99.99, 12.5)).toBe(12.5);
    expect(birthdayDiscount(0, 10)).toBe(0);
  });
});

// ----------------------------------------------------------------------------
describe('Birthday offer settings', () => {
  beforeEach(deleteRow);

  it('defaults to off, 10%, with the SMS text and its preview', async () => {
    const res = await request(app).get('/api/v1/admin/settings/birthday-offer').set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      enabled: false,
      percent: 10,
      sms_enabled: true,
      sms_text: 'Happy birthday from Blynk! {percent}% off your order this week.',
      sms_preview: 'Happy birthday from Blynk! 10% off your order this week.',
      sms_parts: 1,
      window_days: 3,
      updated_at: null,
    });
  });

  it('Admin and Operations change it, audited; only the fields sent change', async () => {
    const a = await patchSetting({ enabled: true, percent: 15 });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data).toMatchObject({ enabled: true, percent: 15, sms_enabled: true, sms_preview: 'Happy birthday from Blynk! 15% off your order this week.' });
    const b = await patchSetting({ sms_text: '  Happy birthday {name}! {percent}% off this week.  ', sms_enabled: false }, opsToken);
    expect(b.status).toBe(200);
    expect(b.body.data).toMatchObject({ enabled: true, percent: 15, sms_enabled: false, sms_text: 'Happy birthday {name}! {percent}% off this week.' });
    const audit = (
      await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'BIRTHDAY_OFFER_UPDATED' AND created_at >= $1 ORDER BY created_at`, [testStart])
    ).rows;
    expect(audit.at(-1).new_values).toMatchObject({ key: KEY, enabled: true, percent: 15, sms_enabled: false });
  });

  it('validates the body and the role', async () => {
    expect((await patchSetting({})).status).toBe(400);
    expect((await patchSetting({ percent: 0 })).status).toBe(400);
    expect((await patchSetting({ percent: 51 })).status).toBe(400);
    expect((await patchSetting({ percent: 10.555 })).status).toBe(400);
    expect((await patchSetting({ sms_text: '   ' })).status).toBe(400);
    expect((await patchSetting({ sms_text: 'x'.repeat(301) })).status).toBe(400);
    expect((await patchSetting({ enabled: 'yes' })).status).toBe(400);
    expect((await patchSetting({ other: 1 })).status).toBe(400);
    expect((await patchSetting({ enabled: true }, tokens.staff)).status).toBe(403);
    expect((await patchSetting({ enabled: true }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/birthday-offer').set(auth(tokens.rider))).status).toBe(403);
  });
});

// ----------------------------------------------------------------------------
describe('Customer profile (GET/PATCH /me)', () => {
  it('everything is optional; date of birth, favourites and the note are saved and cleared', async () => {
    const me = await people.customer(1);
    const empty = await request(app).get('/api/v1/me').set(auth(me.token));
    expect(empty.status).toBe(200);
    expect(empty.body.data.profile).toMatchObject({
      date_of_birth: null,
      favourite_category_ids: [],
      favourite_categories: [],
      favourites_note: null,
      birthday_offer: { has_birthday: false, eligible: false },
    });

    const res = await patchMe(me.token, {
      date_of_birth: '1992-03-15',
      favourite_category_ids: [categoryId, categoryId],
      favourites_note: '  Chocolate biscuits ',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.profile).toMatchObject({
      full_name: me.fullName,
      date_of_birth: '1992-03-15',
      favourite_category_ids: [categoryId],
      favourites_note: 'Chocolate biscuits',
      birthday_offer: { has_birthday: true, in_window: false, birthday: '2027-03-15' },
    });
    expect(res.body.data.profile.favourite_categories[0]).toMatchObject({ id: categoryId });

    // The older fields still work, and leave the profile alone.
    const name = await patchMe(me.token, { full_name: 'New Name', sms_offers: false });
    expect(name.status).toBe(200);
    expect(name.body.data.profile).toMatchObject({ full_name: 'New Name', sms_offers: false, date_of_birth: '1992-03-15' });

    const cleared = await patchMe(me.token, { date_of_birth: null, favourite_category_ids: [], favourites_note: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.profile).toMatchObject({ date_of_birth: null, favourite_category_ids: [], favourites_note: null });
  });

  it('refuses impossible dates, unknown categories and long notes', async () => {
    const me = await people.customer(2);
    for (const date_of_birth of ['2099-01-01', '2024-01-01', '1890-01-01', '1990-13-01', 'yesterday', 19900101]) {
      const res = await patchMe(me.token, { date_of_birth });
      expect(res.status, String(date_of_birth)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const unknown = await patchMe(me.token, { favourite_category_ids: ['00000000-0000-4000-8000-000000000000'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_CATEGORY');
    expect((await patchMe(me.token, { favourite_category_ids: ['nope'] })).status).toBe(400);
    expect((await patchMe(me.token, { favourites_note: 'x'.repeat(201) })).status).toBe(400);
    expect((await pool.query('SELECT date_of_birth, favourites_note FROM users WHERE id = $1', [me.id])).rows[0]).toEqual({
      date_of_birth: null,
      favourites_note: null,
    });
  });

  it('deleting the account clears the profile', async () => {
    const me = await people.customer(3);
    expect((await patchMe(me.token, { date_of_birth: TODAY_DOB, favourite_category_ids: [categoryId], favourites_note: 'Tea' })).status).toBe(200);
    expect((await request(app).delete('/api/v1/me').set(auth(me.token))).status).toBe(200);
    const row = (await pool.query('SELECT date_of_birth, favourite_category_ids, favourites_note FROM users WHERE id = $1', [me.id])).rows[0];
    expect(row).toEqual({ date_of_birth: null, favourite_category_ids: [], favourites_note: null });
  });
});

// ----------------------------------------------------------------------------
describe('Birthday gift at checkout', () => {
  beforeEach(deleteRow);

  const checkoutInfo = async (token: string) => (await request(app).get('/api/v1/orders/checkout-info').set(auth(token))).body.data;

  it('switched off, nobody gets it; switched on, the birthday week gets X% off one order', async () => {
    const me = await people.customer(4);
    expect((await patchMe(me.token, { date_of_birth: TODAY_DOB })).status).toBe(200);
    expect((await checkoutInfo(me.token)).birthday_offer).toEqual({
      enabled: false,
      percent: 10,
      has_birthday: true,
      in_window: true,
      used: false,
      eligible: false,
      birthday: '2026-10-06',
      window_start: '2026-10-03',
      window_end: '2026-10-09',
    });
    const off = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(off).toMatchObject({ discount_amount: 0, birthday_discount_amount: 0 });

    await turnOn(10);
    expect((await checkoutInfo(me.token)).birthday_offer).toMatchObject({ enabled: true, eligible: true, used: false });
    const gift = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }]));
    const expected = Number((gift.subtotal_amount * 0.1).toFixed(2));
    expect(gift).toMatchObject({ discount_amount: expected, birthday_discount_amount: expected, coupon_code: null });
    expect(gift.total_amount).toBe(Number((gift.subtotal_amount + gift.delivery_fee - expected).toFixed(2)));
    const payment = (await pool.query('SELECT amount FROM payments WHERE order_id = $1', [gift.id])).rows[0];
    expect(Number(payment.amount)).toBe(gift.total_amount);

    // Once used, not again this birthday.
    expect((await checkoutInfo(me.token)).birthday_offer).toMatchObject({ used: true, eligible: false });
    const again = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(again.birthday_discount_amount).toBe(0);

    // Cancelling the gift order gives it back.
    expect((await request(app).post(`/api/v1/orders/${gift.id}/cancel`).set(auth(me.token)).send({})).status).toBe(200);
    expect((await checkoutInfo(me.token)).birthday_offer).toMatchObject({ used: false, eligible: true });
    const after = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(after.birthday_discount_amount).toBeGreaterThan(0);
    const live = (await pool.query('SELECT count(*)::int AS n FROM birthday_offer_redemptions WHERE customer_id = $1 AND released_at IS NULL', [me.id])).rows[0].n;
    expect(live).toBe(1);
  });

  it('no birthday this week, or none saved: no gift', async () => {
    await turnOn(10);
    const later = await people.customer(5);
    expect((await patchMe(later.token, { date_of_birth: '1990-10-20' })).status).toBe(200);
    expect((await checkoutInfo(later.token)).birthday_offer).toMatchObject({ in_window: false, eligible: false, birthday: '2026-10-20' });
    expect((await expectCreated(await later.placeOrder([{ product_id: productId, quantity: 1 }]))).birthday_discount_amount).toBe(0);
    const none = await people.customer(6);
    expect((await checkoutInfo(none.token)).birthday_offer).toMatchObject({ has_birthday: false, eligible: false });
  });

  it('never stacks with a coupon: the larger wins (a tie keeps the coupon)', async () => {
    await turnOn(10);
    const me = await people.customer(7);
    expect((await patchMe(me.token, { date_of_birth: TODAY_DOB })).status).toBe(200);

    // One item: 10% is less than LKR 50 - the coupon is used, the gift kept.
    const pre = await request(app)
      .post('/api/v1/orders/validate-coupon')
      .set(auth(me.token))
      .send({ code: COUPON, items: [{ product_id: productId, quantity: 1 }] });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body.data.coupon).toMatchObject({ discount_amount: 50, applied_discount: 'COUPON' });
    expect(pre.body.data.coupon.birthday_discount_amount).toBeGreaterThan(0);
    const small = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { coupon_code: COUPON }));
    expect(small).toMatchObject({ coupon_code: COUPON, discount_amount: 50, birthday_discount_amount: 0 });
    expect((await checkoutInfo(me.token)).birthday_offer.eligible).toBe(true);

    // Ten items: 10% beats LKR 50 - the gift is used and the coupon is not spent.
    const big = await request(app)
      .post('/api/v1/orders/validate-coupon')
      .set(auth(me.token))
      .send({ code: COUPON, items: [{ product_id: productId, quantity: 10 }] });
    expect(big.body.data.coupon.applied_discount).toBe('BIRTHDAY');
    expect(big.body.data.coupon.total).toBe(
      Number((big.body.data.coupon.subtotal + big.body.data.coupon.delivery_fee - big.body.data.coupon.birthday_discount_amount).toFixed(2))
    );
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 10 }], { coupon_code: COUPON }));
    expect(order.coupon_code).toBeNull();
    expect(order.birthday_discount_amount).toBe(Number((order.subtotal_amount * 0.1).toFixed(2)));
    expect(order.discount_amount).toBe(order.birthday_discount_amount);
    const uses = (await pool.query('SELECT count(*)::int AS n FROM coupon_redemptions WHERE order_id = $1', [order.id])).rows[0].n;
    expect(uses).toBe(0);
  });

  it('when the store removes an item, the gift follows the new subtotal', async () => {
    await turnOn(10);
    const me = await people.customer(8);
    expect((await patchMe(me.token, { date_of_birth: TODAY_DOB })).status).toBe(200);
    const order = await expectCreated(
      await me.placeOrder([
        { product_id: productId, quantity: 1 },
        { product_id: product2Id, quantity: 3 },
      ])
    );
    const item = order.items.find((i: { product_id: string }) => i.product_id === product2Id);
    const res = await request(app)
      .post(`/api/v1/admin/orders/${order.id}/resolve-item`)
      .set(auth(tokens.staff))
      .send({ item_id: item.id, item_status: 'UNAVAILABLE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await pool.query('SELECT subtotal_amount, discount_amount, birthday_discount_amount, delivery_fee, total_amount FROM orders WHERE id = $1', [order.id])).rows[0];
    const subtotal = Number(row.subtotal_amount);
    expect(Number(row.birthday_discount_amount)).toBe(Number((subtotal * 0.1).toFixed(2)));
    expect(Number(row.discount_amount)).toBe(Number(row.birthday_discount_amount));
    expect(Number(row.total_amount)).toBe(Number((subtotal + Number(row.delivery_fee) - Number(row.discount_amount)).toFixed(2)));
    const redemption = (await pool.query('SELECT discount_amount FROM birthday_offer_redemptions WHERE order_id = $1', [order.id])).rows[0];
    expect(Number(redemption.discount_amount)).toBe(Number(row.birthday_discount_amount));
  });
});

// ----------------------------------------------------------------------------
describe('Birthday SMS', () => {
  const ON: BirthdayOfferSetting = { ...DEFAULT_BIRTHDAY_OFFER, enabled: true, percent: 12 };
  const MORNING = new Date('2026-10-06T02:35:00Z'); // 08:05 Colombo, 6 October
  let ids: string[] = [];
  let optedIn = '';
  let optedOut = '';
  let otherDay = '';

  beforeAll(async () => {
    await deleteRow(); // the store switch stays off: these runs pass their own setting
    const a = await people.customer(10);
    const b = await people.customer(11);
    const c = await people.customer(12);
    for (const p of [a, b]) expect((await patchMe(p.token, { date_of_birth: TODAY_DOB })).status).toBe(200);
    expect((await patchMe(b.token, { sms_offers: false })).status).toBe(200);
    expect((await patchMe(c.token, { date_of_birth: '1990-10-07' })).status).toBe(200);
    [optedIn, optedOut, otherDay] = [a.id, b.id, c.id];
    ids = [a.id, b.id, c.id];
  });

  const smsRows = () =>
    pool.query(
      `SELECT user_id, idempotency_key, notification_type, channel, recipient, payload FROM notifications WHERE user_id = ANY($1) AND notification_type = 'BIRTHDAY_OFFER'`,
      [ids]
    );

  it('queues one SMS on the birthday from 8 AM, only to customers who take offers, never twice', async () => {
    expect(await runBirthdaySms({ now: new Date('2026-10-06T02:00:00Z'), setting: ON, userIds: ids })).toEqual([]); // 07:30
    expect(await runBirthdaySms({ now: new Date('2026-10-06T15:45:00Z'), setting: ON, userIds: ids })).toEqual([]); // 21:15
    expect(await runBirthdaySms({ now: MORNING, setting: { ...ON, enabled: false }, userIds: ids })).toEqual([]);
    expect(await runBirthdaySms({ now: MORNING, setting: { ...ON, sms_enabled: false }, userIds: ids })).toEqual([]);

    expect(await runBirthdaySms({ now: MORNING, setting: ON, userIds: ids })).toEqual([optedIn]);
    const rows = (await smsRows()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: optedIn,
      idempotency_key: birthdaySmsKey(2026, optedIn),
      channel: 'SMS',
      payload: { text: 'Happy birthday from Blynk! 12% off your order this week.', percent: 12 },
    });
    expect(rows[0].idempotency_key.length).toBeLessThanOrEqual(80);
    expect(rows[0].idempotency_key).toBe(`bday:2026:${optedIn}`);

    // Later ticks the same day (or later in the year) send nothing more.
    expect(await runBirthdaySms({ now: new Date('2026-10-06T10:00:00Z'), setting: ON, userIds: ids })).toEqual([]);
    expect((await smsRows()).rows).toHaveLength(1);
    expect(optedOut).not.toBe(otherDay);
  });

  it('the next day is the next customer\'s birthday', async () => {
    const queued = await runBirthdaySms({ now: new Date('2026-10-07T03:00:00Z'), setting: ON, userIds: ids });
    expect(queued).toEqual([otherDay]);
  });

  it('skips a customer who already used this birthday\'s gift', async () => {
    const d = await people.customer(13);
    expect((await patchMe(d.token, { date_of_birth: TODAY_DOB })).status).toBe(200);
    const order = await expectCreated(await d.placeOrder([{ product_id: productId, quantity: 1 }]));
    await pool.query(
      `INSERT INTO birthday_offer_redemptions (customer_id, order_id, offer_year, percent, discount_amount) VALUES ($1, $2, 2026, 12, 1)`,
      [d.id, order.id]
    );
    expect(await runBirthdaySms({ now: MORNING, setting: ON, userIds: [d.id] })).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
describe('Birthday SMS on closed days (owner, 2026-10-10)', () => {
  const ON: BirthdayOfferSetting = { ...DEFAULT_BIRTHDAY_OFFER, enabled: true, percent: 12 };
  const pinnedRead = storeSchedule.read;
  // Saturdays closed; holidays and "close now" set per step.
  const satClosed = { same_every_day: false, days: { ...uniformWeek('08:00', '21:00'), sat: { closed: true, open: '08:00', close: '21:00' } } };
  const schedule = (over: Partial<StoredSchedule>, smsOnClosedDays: boolean): StoredSchedule => ({
    ...DEFAULT_STORED_SCHEDULE,
    hours: satClosed,
    ...over,
    sms: { sms_on_closed_days: smsOnClosedDays },
  });
  const use = (s: StoredSchedule) => {
    storeSchedule.read = async () => s;
  };
  const clearMarker = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [BIRTHDAY_SMS_DAYS_KEY]);
  const keysOf = async (id: string) =>
    (await pool.query("SELECT idempotency_key FROM notifications WHERE user_id = $1 AND notification_type = 'BIRTHDAY_OFFER'", [id])).rows.map((r) => r.idempotency_key);

  afterAll(async () => {
    storeSchedule.read = pinnedRead;
    await clearMarker();
  });

  it('which birthdays a run covers: today, plus missed days back to the previous open day, at most the birthday week', () => {
    const today = colomboDay(new Date('2026-10-12T04:00:00Z'));
    const iso = (days: ReturnType<typeof birthdayDaysToText>) => days.map((d) => isoDay(d));
    expect(iso(birthdayDaysToText(today, '2026-10-09', false))).toEqual(['2026-10-12']); // switch on: never catches up
    expect(iso(birthdayDaysToText(today, null, true))).toEqual(['2026-10-12']);
    expect(iso(birthdayDaysToText(today, '2026-10-11', true))).toEqual(['2026-10-12']);
    expect(iso(birthdayDaysToText(today, '2026-10-09', true))).toEqual(['2026-10-12', '2026-10-11', '2026-10-10']);
    expect(iso(birthdayDaysToText(today, '2026-09-30', true))).toEqual(['2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09']);
  });

  it('switch on (default): a closed Saturday still gets its birthday SMS from 8 AM', async () => {
    await clearMarker();
    const p = await people.customer(30);
    expect((await patchMe(p.token, { date_of_birth: '1991-10-10' })).status).toBe(200);
    use(schedule({}, true));
    expect(await runBirthdaySms({ now: new Date('2026-10-10T03:00:00Z'), setting: ON, userIds: [p.id] })).toEqual([p.id]); // Sat 8:30 AM
    expect(await keysOf(p.id)).toEqual([birthdaySmsKey(2026, p.id)]);
  });

  it('switch off: nothing on a closed weekday, a holiday or while closed now; caught up the next open day, once', async () => {
    await clearMarker();
    const p = await people.customer(31);
    expect((await patchMe(p.token, { date_of_birth: '1991-10-10' })).status).toBe(200); // Saturday 10 October
    const holiday = [{ date: '2026-10-11', reason: 'Poya' }];
    const rain = { closed: true, reason: 'Rain', reopens_at: null, closed_at: null };
    const run = (iso: string) => runBirthdaySms({ now: new Date(iso), setting: ON, userIds: [p.id] });

    use(schedule({ holidays: holiday }, false));
    expect(await run('2026-10-09T03:00:00Z')).toEqual([]); // Fri, open: not their birthday yet (Friday recorded as open)
    expect(await run('2026-10-10T03:00:00Z')).toEqual([]); // Sat: closed weekday
    expect(await run('2026-10-11T03:00:00Z')).toEqual([]); // Sun: holiday
    use(schedule({ holidays: holiday, closure: rain }, false));
    expect(await run('2026-10-12T03:00:00Z')).toEqual([]); // Mon: closed now
    use(schedule({ holidays: holiday }, false));
    expect(await run('2026-10-12T02:00:00Z')).toEqual([]); // Mon 7:30 AM: before opening
    expect(await keysOf(p.id)).toEqual([]);

    expect(await run('2026-10-12T04:00:00Z')).toEqual([p.id]); // Mon 9:30 AM, reopened: still in their birthday week
    expect(await keysOf(p.id)).toEqual([birthdaySmsKey(2026, p.id)]);
    expect(await run('2026-10-12T08:00:00Z')).toEqual([]); // never twice
    expect(await run('2026-10-13T04:00:00Z')).toEqual([]);
    expect(await keysOf(p.id)).toHaveLength(1);
  });

  it('switch off: a birthday past its week is not caught up; a 31 December birthday caught up in January keeps its year', async () => {
    await clearMarker();
    const late = await people.customer(32);
    const nye = await people.customer(33);
    expect((await patchMe(late.token, { date_of_birth: '1991-12-27' })).status).toBe(200);
    expect((await patchMe(nye.token, { date_of_birth: '1991-12-31' })).status).toBe(200);
    const ids = [late.id, nye.id];
    const run = (iso: string) => runBirthdaySms({ now: new Date(iso), setting: ON, userIds: ids });
    // Holidays 27 December 2026 - 1 January 2027; Saturdays (26 Dec, 2 Jan) closed too.
    const holidays = ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'].map((date) => ({ date, reason: 'Season' }));
    use(schedule({ holidays }, false));
    expect(await run('2026-12-25T04:00:00Z')).toEqual([]); // Fri 25 Dec: the last open day
    expect(await run('2026-12-26T04:00:00Z')).toEqual([]); // Sat
    expect(await run('2026-12-31T04:00:00Z')).toEqual([]); // holiday
    expect(await run('2027-01-02T04:00:00Z')).toEqual([]); // Sat
    expect(await run('2027-01-03T04:00:00Z')).toEqual([nye.id]); // Sun 3 Jan: open again
    expect(await keysOf(nye.id)).toEqual([birthdaySmsKey(2026, nye.id)]); // the 2026 birthday's SMS
    expect(await keysOf(late.id)).toEqual([]); // 27 Dec + 3 days ended on 30 Dec
  });
});

// ----------------------------------------------------------------------------
describe('Birthdays this week and the Admin customer page', () => {
  it('lists birthdays from 3 days ago to `days` ahead with favourites, for Admin and Operations', async () => {
    const soon = await people.customer(20, 'Birthday Soon');
    const past = await people.customer(21, 'Birthday Past');
    const far = await people.customer(22, 'Birthday Far');
    expect((await patchMe(soon.token, { date_of_birth: '1990-10-08', favourite_category_ids: [categoryId], favourites_note: 'Mangoes' })).status).toBe(200);
    expect((await patchMe(past.token, { date_of_birth: '2000-10-04' })).status).toBe(200);
    expect((await patchMe(far.token, { date_of_birth: '1990-10-30' })).status).toBe(200);

    const res = await request(app).get('/api/v1/admin/birthdays?days=7').set(auth(opsToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.today).toBe('2026-10-06');
    const mine = res.body.data.customers.filter((c: { id: string }) => [soon.id, past.id, far.id].includes(c.id));
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ id: past.id, birthday: '2026-10-04', days_until: -2, turning: 26, offer_used: false });
    expect(mine[1]).toMatchObject({
      id: soon.id,
      full_name: 'Birthday Soon',
      date_of_birth: '1990-10-08',
      birthday: '2026-10-08',
      days_until: 2,
      turning: 36,
      favourites_note: 'Mangoes',
    });
    expect(mine[1].favourite_categories[0]).toMatchObject({ id: categoryId });

    const wide = await request(app).get('/api/v1/admin/birthdays?days=31').set(auth(tokens.admin));
    expect(wide.body.data.customers.some((c: { id: string }) => c.id === far.id)).toBe(true);
    expect((await request(app).get('/api/v1/admin/birthdays?days=32').set(auth(tokens.admin))).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/birthdays').set(auth(tokens.staff))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/birthdays').set(auth(tokens.customer))).status).toBe(403);

    const detail = await request(app).get(`/api/v1/admin/customers/${soon.id}`).set(auth(tokens.admin));
    expect(detail.status).toBe(200);
    expect(detail.body.data.customer).toMatchObject({ date_of_birth: '1990-10-08', favourites_note: 'Mangoes' });
    expect(detail.body.data.customer.favourite_categories[0]).toMatchObject({ id: categoryId });
    expect(detail.body.data.customer.favourite_category_ids).toBeUndefined();
    const list = await request(app).get('/api/v1/admin/customers?search=Birthday%20Soon').set(auth(tokens.admin));
    expect(list.body.data.customers[0]).toMatchObject({ id: soon.id, date_of_birth: '1990-10-08' });
  });
});
