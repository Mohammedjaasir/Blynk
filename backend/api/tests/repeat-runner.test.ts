import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { DEFAULT_STORED_SCHEDULE, storeSchedule } from '../src/modules/configuration/store-schedule.js';
import { runDueRepeatBaskets, repeatMessages, REPEAT_SMS_TYPE } from '../src/modules/repeat-baskets/repeat.runner.js';
import { firstRunAt, nextRunAfter, placeAtInsideHours, type ScheduleSpec } from '../src/modules/repeat-baskets/repeat.schedule.js';
import { DEFAULT_WEEKLY_HOURS, uniformWeek } from '../src/utils/store-hours.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * The repeat basket worker (migration 054; contract 2026-10-24-buy-again-repeat.md
 * section 2) against real Postgres, and the next_run_at maths (Asia/Colombo).
 * The ordering clock is pinned to Tue 2026-10-06 12:00 Colombo (06:30 UTC);
 * store hours 08:00 - 21:00 every day, no free deliveries (tests/setup).
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RPR-');
const people = customerFixtures(app, { idPrefix: 'c0c00154', phoneBase: '+947095410', name: 'Repeat Runner Customer' });
const DUE = '2026-10-06T06:00:00.000Z'; // half an hour before the pinned clock
let p1 = '';
let p2 = '';
let soldOut = '';
let switchedOff = '';

async function makeBasket(token: string, body: object) {
  const res = await request(app).post('/api/v1/me/repeat-baskets').set(auth(token)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.basket.id as string;
  await pool.query('UPDATE repeat_baskets SET next_run_at = $2 WHERE id = $1', [id, DUE]);
  return res.body.data.basket as Record<string, any>;
}
const basketRow = async (id: string) => (await pool.query('SELECT * FROM repeat_baskets WHERE id = $1', [id])).rows[0];
const runsOf = async (id: string) =>
  (await pool.query('SELECT status, reason, order_id, run_at FROM repeat_basket_runs WHERE basket_id = $1 ORDER BY created_at', [id])).rows;
const smsFor = async (userId: string) =>
  (
    await pool.query(`SELECT payload, recipient, status FROM notifications WHERE user_id = $1 AND notification_type = $2 ORDER BY created_at`, [
      userId,
      REPEAT_SMS_TYPE,
    ])
  ).rows.map((r) => ({ ...r, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload }));

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  p1 = (await fx.product({ tracked: false })).productId;
  p2 = (await fx.product({ tracked: false })).productId;
  soldOut = (await fx.product({ tracked: true, onHand: 0 })).productId;
  switchedOff = (await fx.product({ tracked: false })).productId;
  await pool.query('UPDATE products SET is_active = false WHERE id = $1', [switchedOff]);
});

afterEach(() => {
  storeSchedule.read = async () => DEFAULT_STORED_SCHEDULE;
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  const left = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE status = 'QUEUED' AND notification_type = $1`, [REPEAT_SMS_TYPE]);
  expect(left.rows[0].n).toBe(0);
});

describe('repeat basket runner', () => {
  it('places the order as the customer: orderable lines, the right fee, repeat_basket_id, next run, SMS', async () => {
    const me = await people.customer(1);
    const basket = await makeBasket(me.token, {
      name: 'Daily milk',
      items: [
        { product_id: p1, quantity: 2 },
        { product_id: soldOut, quantity: 1 },
        { product_id: p2, quantity: 1 },
        { product_id: switchedOff, quantity: 1 },
      ],
      frequency: 'DAILY',
      place_at: '11:30',
      address_id: me.addressId,
      notes: 'Ring twice',
    });
    expect(basket.estimate).toMatchObject({ available_lines: 2, unavailable_lines: 2 });
    const info = await request(app)
      .get(`/api/v1/orders/checkout-info?address_id=${me.addressId}&product_ids=${p1},${p2}`)
      .set(auth(me.token));
    expect(info.status).toBe(200);

    expect(await runDueRepeatBaskets({ basketIds: [basket.id] })).toEqual({ placed: 1, skipped: 0, failed: 0 });

    const runs = await runsOf(basket.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('PLACED');
    expect(runs[0].run_at.toISOString()).toBe(DUE);
    expect(runs[0].reason).toMatch(/^Left out: /);
    expect(runs[0].reason).toContain('sold out');
    expect(runs[0].reason).toContain('not available now');

    const orderId = runs[0].order_id as string;
    const order = (await pool.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
    expect(order).toMatchObject({
      customer_id: me.id,
      repeat_basket_id: basket.id,
      payment_method: 'COD',
      order_status: 'PLACED',
      customer_notes: 'Ring twice',
      scheduled_for: null,
    });
    expect(Number(order.delivery_fee)).toBe(info.body.data.delivery_fee_lkr);
    expect(Number(order.subtotal_amount)).toBe(basket.estimate.items_total);
    const items = (await pool.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY quantity DESC', [orderId])).rows;
    expect(items).toEqual([
      { product_id: p1, quantity: 2 },
      { product_id: p2, quantity: 1 },
    ]);

    const after = await basketRow(basket.id);
    expect(after.next_run_at.toISOString()).toBe('2026-10-07T06:00:00.000Z'); // tomorrow 11:30 Colombo
    expect(after.last_order_id).toBe(orderId);
    expect(after.skip_next).toBe(false);

    const sms = await smsFor(me.id);
    expect(sms).toHaveLength(1);
    expect(sms[0].recipient).toBe(me.phone);
    expect(sms[0].payload.text).toBe(
      `Blynk: your repeat basket 'Daily milk' is ordered - order ${order.order_number}, LKR ${Number(order.total_amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}. Change or skip it in the app.`
    );

    // The customer and staff see where the order came from; the basket shows its last run.
    expect((await request(app).get(`/api/v1/orders/${orderId}`).set(auth(me.token))).body.data.order.repeat_basket_id).toBe(basket.id);
    expect((await request(app).get(`/api/v1/admin/orders/${orderId}`).set(auth(tokens.admin))).body.data.order.repeat_basket_id).toBe(basket.id);
    const listed = (await request(app).get('/api/v1/me/repeat-baskets').set(auth(me.token))).body.data.baskets[0];
    expect(listed.last_run).toMatchObject({ status: 'PLACED', order_id: orderId });

    // Nothing more is due.
    expect(await runDueRepeatBaskets({ basketIds: [basket.id] })).toEqual({ placed: 0, skipped: 0, failed: 0 });

    // The same due time again (a crash before the run was saved, a second worker): no second order.
    await pool.query('UPDATE repeat_baskets SET next_run_at = $2 WHERE id = $1', [basket.id, DUE]);
    await runDueRepeatBaskets({ basketIds: [basket.id] });
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE repeat_basket_id = $1', [basket.id])).rows[0].n).toBe(1);
    expect(await runsOf(basket.id)).toHaveLength(1);
    expect(await smsFor(me.id)).toHaveLength(1);
  });

  it('skip_next: SKIPPED "Skipped by you", cleared, no order, no message; the next run moves on a week', async () => {
    const me = await people.customer(2);
    const basket = await makeBasket(me.token, {
      items: [{ product_id: p1, quantity: 1 }],
      frequency: 'WEEKLY',
      weekday: 2,
      place_at: '11:00',
      address_id: me.addressId,
    });
    expect((await request(app).post(`/api/v1/me/repeat-baskets/${basket.id}/skip-next`).set(auth(me.token))).body.data.basket.skip_next).toBe(true);
    expect(await runDueRepeatBaskets({ basketIds: [basket.id] })).toEqual({ placed: 0, skipped: 1, failed: 0 });
    const runs = await runsOf(basket.id);
    expect(runs).toMatchObject([{ status: 'SKIPPED', reason: 'Skipped by you', order_id: null }]);
    const after = await basketRow(basket.id);
    expect(after.skip_next).toBe(false);
    expect(after.next_run_at.toISOString()).toBe('2026-10-13T05:30:00.000Z');
    expect(await smsFor(me.id)).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [me.id])).rows[0].n).toBe(0);
  });

  it('store closed at that moment: SKIPPED "Store closed" and the customer is told', async () => {
    const me = await people.customer(3);
    const basket = await makeBasket(me.token, {
      name: 'Bread',
      items: [{ product_id: p1, quantity: 1 }],
      frequency: 'BIWEEKLY',
      weekday: 2,
      place_at: '11:00',
      address_id: me.addressId,
    });
    storeSchedule.read = async () => ({
      ...DEFAULT_STORED_SCHEDULE,
      closure: { closed: true, reason: 'Stock count', reopens_at: null, closed_at: '2026-10-06T05:00:00.000Z' },
    });
    expect(await runDueRepeatBaskets({ basketIds: [basket.id] })).toEqual({ placed: 0, skipped: 1, failed: 0 });
    expect(await runsOf(basket.id)).toMatchObject([{ status: 'SKIPPED', reason: 'Store closed', order_id: null }]);
    expect((await basketRow(basket.id)).next_run_at.toISOString()).toBe('2026-10-20T05:30:00.000Z');
    const sms = await smsFor(me.id);
    expect(sms).toHaveLength(1);
    expect(sms[0].payload.text).toBe("Blynk: your repeat basket 'Bread' was skipped - Store closed. Change or skip it in the app.");
  });

  it('nothing orderable: SKIPPED with the reasons', async () => {
    const me = await people.customer(4);
    const basket = await makeBasket(me.token, {
      items: [
        { product_id: soldOut, quantity: 2 },
        { product_id: switchedOff, quantity: 1 },
      ],
      frequency: 'DAILY',
      place_at: '09:00',
      address_id: me.addressId,
    });
    expect(await runDueRepeatBaskets({ basketIds: [basket.id] })).toEqual({ placed: 0, skipped: 1, failed: 0 });
    const runs = await runsOf(basket.id);
    expect(runs[0].status).toBe('SKIPPED');
    expect(runs[0].reason).toMatch(/^Nothing could be ordered: .*sold out.*not available now/);
    expect((await basketRow(basket.id)).next_run_at.toISOString()).toBe('2026-10-07T03:30:00.000Z');
    expect(await smsFor(me.id)).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [me.id])).rows[0].n).toBe(0);
  });

  it('paused baskets and baskets not yet due are left alone', async () => {
    const me = await people.customer(5);
    const paused = await makeBasket(me.token, { items: [{ product_id: p1, quantity: 1 }], frequency: 'DAILY', place_at: '09:00', address_id: me.addressId });
    await pool.query(`UPDATE repeat_baskets SET status = 'PAUSED' WHERE id = $1`, [paused.id]);
    const future = await makeBasket(me.token, { items: [{ product_id: p1, quantity: 1 }], frequency: 'DAILY', place_at: '09:00', address_id: me.addressId });
    await pool.query(`UPDATE repeat_baskets SET next_run_at = '2026-10-06T07:00:00Z' WHERE id = $1`, [future.id]);
    expect(await runDueRepeatBaskets({ basketIds: [paused.id, future.id] })).toEqual({ placed: 0, skipped: 0, failed: 0 });
  });

  it('messages for skipped / failed runs', () => {
    expect(repeatMessages('Milk', { status: 'FAILED', reason: 'The delivery address was removed' }).sms).toBe(
      "Blynk: we could not order your repeat basket 'Milk' - The delivery address was removed. Please check it in the app."
    );
    expect(repeatMessages('Milk', { status: 'SKIPPED', reason: 'Store closed' }).title).toBe('Repeat basket skipped');
  });
});

describe('next_run_at maths (Asia/Colombo)', () => {
  const spec = (s: Partial<ScheduleSpec>): ScheduleSpec => ({ frequency: 'DAILY', weekday: null, place_at: '09:00', start_date: null, ...s });
  const iso = (d: Date) => d.toISOString();

  it('DAILY across midnight', () => {
    // Tue 23:29 Colombo -> 23:30 the same evening; exactly at 23:30 -> the next day.
    expect(iso(firstRunAt(spec({ place_at: '23:30' }), new Date('2026-10-06T17:59:00Z')))).toBe('2026-10-06T18:00:00.000Z');
    expect(iso(firstRunAt(spec({ place_at: '23:30' }), new Date('2026-10-06T18:00:00Z')))).toBe('2026-10-07T18:00:00.000Z');
    // 00:15 Colombo on Wed is still Tue in UTC.
    expect(iso(firstRunAt(spec({ place_at: '00:15' }), new Date('2026-10-06T18:00:00Z')))).toBe('2026-10-06T18:45:00.000Z');
    expect(iso(nextRunAfter(spec({ place_at: '00:15' }), new Date('2026-10-06T18:45:00Z'), new Date('2026-10-06T18:46:00Z')))).toBe(
      '2026-10-07T18:45:00.000Z'
    );
  });

  it('WEEKLY / BIWEEKLY across the week boundary (0 = Sunday)', () => {
    // Sat 23:30 Colombo -> Sun 09:00.
    const sunday = spec({ frequency: 'WEEKLY', weekday: 0 });
    expect(iso(firstRunAt(sunday, new Date('2026-10-10T18:00:00Z')))).toBe('2026-10-11T03:30:00.000Z');
    expect(iso(firstRunAt(sunday, new Date('2026-10-11T03:30:00Z')))).toBe('2026-10-18T03:30:00.000Z');
    // Monday from Sunday evening (Colombo) = the next day.
    expect(iso(firstRunAt(spec({ frequency: 'WEEKLY', weekday: 1, place_at: '08:00' }), new Date('2026-10-11T15:00:00Z')))).toBe(
      '2026-10-12T02:30:00.000Z'
    );
    const run = new Date('2026-10-11T03:30:00Z');
    const justAfter = new Date('2026-10-11T03:30:30Z');
    expect(iso(nextRunAfter(spec({ place_at: '09:00' }), run, justAfter))).toBe('2026-10-12T03:30:00.000Z');
    expect(iso(nextRunAfter(sunday, run, justAfter))).toBe('2026-10-18T03:30:00.000Z');
    expect(iso(nextRunAfter(spec({ frequency: 'BIWEEKLY', weekday: 0 }), run, justAfter))).toBe('2026-10-25T03:30:00.000Z');
    // Saturday 22:00 Colombo + 7 is still Saturday (16:30 UTC).
    expect(iso(nextRunAfter(spec({ frequency: 'WEEKLY', weekday: 6, place_at: '22:00' }), new Date('2026-10-10T16:30:00Z'), new Date('2026-10-10T16:31:00Z')))).toBe(
      '2026-10-17T16:30:00.000Z'
    );
  });

  it('start_date, and missed runs are skipped (not placed late), keeping the 2-week rhythm', () => {
    expect(iso(firstRunAt(spec({ start_date: '2026-10-20', place_at: '08:30' }), new Date('2026-10-06T06:30:00Z')))).toBe('2026-10-20T03:00:00.000Z');
    const now = new Date('2026-10-06T06:30:00Z');
    expect(iso(nextRunAfter(spec({}), new Date('2026-10-01T03:30:00Z'), now))).toBe('2026-10-07T03:30:00.000Z');
    expect(iso(nextRunAfter(spec({ frequency: 'BIWEEKLY', weekday: 0 }), new Date('2026-09-20T03:30:00Z'), now))).toBe('2026-10-18T03:30:00.000Z');
  });

  it('place_at inside the opening hours', () => {
    const hours = { same_every_day: false, days: { ...uniformWeek('08:00', '21:00'), sat: { closed: false, open: '10:00', close: '14:00' }, sun: { closed: true, open: '08:00', close: '21:00' } } };
    expect(placeAtInsideHours({ frequency: 'DAILY', weekday: null, place_at: '08:00' }, DEFAULT_WEEKLY_HOURS)).toBe(true);
    expect(placeAtInsideHours({ frequency: 'DAILY', weekday: null, place_at: '21:00' }, DEFAULT_WEEKLY_HOURS)).toBe(false);
    expect(placeAtInsideHours({ frequency: 'DAILY', weekday: null, place_at: '08:00' }, hours)).toBe(false); // Saturday opens at 10
    expect(placeAtInsideHours({ frequency: 'DAILY', weekday: null, place_at: '12:00' }, hours)).toBe(true); // Sunday closed: skipped
    expect(placeAtInsideHours({ frequency: 'WEEKLY', weekday: 6, place_at: '11:00' }, hours)).toBe(true);
    expect(placeAtInsideHours({ frequency: 'WEEKLY', weekday: 0, place_at: '11:00' }, hours)).toBe(false);
    expect(placeAtInsideHours({ frequency: 'WEEKLY', weekday: null, place_at: '11:00' }, hours)).toBe(false);
  });
});
