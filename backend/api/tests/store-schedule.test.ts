import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { storeSchedule } from '../src/modules/configuration/store-schedule.js';
import { orderingClock, isWithinOrderingHours, calculateScheduledDeliveryTime } from '../src/utils/time.js';
import {
  DEFAULT_SCHEDULE,
  buildSlots,
  rangeLabel,
  storeClosedMessage,
  storeStatusAt,
  uniformWeek,
  withinSmsWindow,
  type ScheduleState,
} from '../src/utils/store-hours.js';
import { runBirthdaySms } from '../src/modules/birthday/birthday.sms.js';
import { assertSmsSendingWindow } from '../src/modules/sms-offers/sms-offers.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Store timing decided by Ops and Admin (owner, 2026-10-10): opening hours
 * (per weekday), "close the store now" with a reason and reopen time, a
 * holiday list, and scheduled delivery slots - the pure rules, the staff
 * endpoints, GET /store, GET /orders/slots and order placement. The four
 * settings rows are restored afterwards, with the audit entries and orders
 * this file wrote.
 */

const at = (iso: string) => new Date(iso);
// Colombo is UTC+5:30. 2026-10-06 is a Tuesday; 2026-10-09 a Friday.
const TUE_NOON = '2026-10-06T06:30:00.000Z';

const state = (over: Partial<ScheduleState> = {}): ScheduleState => ({ ...DEFAULT_SCHEDULE, ...over });

describe('Store timing rules (pure)', () => {
  it('defaults to 8 AM - 9 PM every day, open', () => {
    expect(storeStatusAt(state(), at(TUE_NOON))).toEqual({
      is_open_now: true,
      closed_kind: 'OPEN',
      closed_reason: null,
      reopens_at: null,
      next_open_at: null,
      today_hours: { open: '08:00', close: '21:00' },
    });
    expect(isWithinOrderingHours(at('2026-10-06T15:29:00Z'))).toBe(true);
    expect(isWithinOrderingHours(at('2026-10-06T15:30:00Z'))).toBe(false);
    expect(calculateScheduledDeliveryTime(at('2026-10-06T18:00:00Z'))!.toISOString()).toBe('2026-10-07T02:30:00.000Z');
  });

  it('per-day hours: a shorter Friday and a closed Sunday', () => {
    const days = { ...uniformWeek('08:00', '21:00'), fri: { closed: false, open: '09:30', close: '12:15' }, sun: { closed: true, open: '08:00', close: '21:00' } };
    const s = state({ hours: { same_every_day: false, days } });
    // Friday 12:30 Colombo: after the short close.
    const fri = storeStatusAt(s, at('2026-10-09T07:00:00Z'));
    expect(fri).toMatchObject({ is_open_now: false, closed_kind: 'OUTSIDE_HOURS', today_hours: { open: '09:30', close: '12:15' } });
    expect(fri.next_open_at).toBe('2026-10-10T02:30:00.000Z'); // Saturday 8 AM
    // Friday 9:00 -> opens 9:30 today.
    expect(storeStatusAt(s, at('2026-10-09T03:30:00Z')).next_open_at).toBe('2026-10-09T04:00:00.000Z');
    // Sunday: closed day; next open Monday 8 AM.
    const sun = storeStatusAt(s, at('2026-10-11T06:30:00Z'));
    expect(sun).toMatchObject({ closed_kind: 'CLOSED_DAY', today_hours: null, next_open_at: '2026-10-12T02:30:00.000Z' });
    expect(storeClosedMessage(sun, at('2026-10-11T06:30:00Z'), false)).toBe('Blynk is closed today. We open again at 8 AM tomorrow.');
    expect(storeClosedMessage(fri, at('2026-10-09T07:00:00Z'), true)).toBe(
      'Blynk takes orders from 9:30 AM to 12:15 PM. Please order again from 8 AM tomorrow. You can pick a delivery slot instead.'
    );
  });

  it('holidays close the whole day, with their reason', () => {
    const s = state({ holidays: [{ date: '2026-10-06', reason: 'Poya' }, { date: '2026-10-07', reason: null }] });
    const st = storeStatusAt(s, at(TUE_NOON));
    expect(st).toMatchObject({ is_open_now: false, closed_kind: 'HOLIDAY', closed_reason: 'Poya', today_hours: null });
    expect(st.next_open_at).toBe('2026-10-08T02:30:00.000Z'); // Thursday 8 AM
    expect(storeClosedMessage(st, at(TUE_NOON), false)).toBe('Blynk is closed today (Poya). We open again at 8 AM on Thu 8 Oct.');
  });

  it('"close now" wins over the hours and re-opens by itself at reopens_at', () => {
    const closure = { closed: true, reason: 'Rain', reopens_at: '2026-10-06T08:30:00.000Z', closed_at: TUE_NOON };
    const s = state({ closure });
    const st = storeStatusAt(s, at(TUE_NOON));
    expect(st).toMatchObject({ is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain', reopens_at: closure.reopens_at, next_open_at: closure.reopens_at });
    expect(storeClosedMessage(st, at(TUE_NOON), false)).toBe('Blynk is closed now (Rain). We open again at 2 PM.');
    expect(storeStatusAt(s, at('2026-10-06T08:30:00.000Z')).is_open_now).toBe(true);
    // Reopening after closing time: next open is the next morning.
    const late = state({ closure: { ...closure, reopens_at: '2026-10-06T16:00:00.000Z' } });
    expect(storeStatusAt(late, at(TUE_NOON)).next_open_at).toBe('2026-10-07T02:30:00.000Z');
    // No reopen time: closed until staff reopen.
    const open = storeStatusAt(state({ closure: { ...closure, reopens_at: null } }), at(TUE_NOON));
    expect(open.next_open_at).toBeNull();
    expect(storeClosedMessage(open, at(TUE_NOON), false)).toBe('Blynk is closed now (Rain). Please check back later.');
  });

  it('SMS window follows the weekday hours; a closed weekday falls back to 8 AM - 9 PM', () => {
    const days = { ...uniformWeek('10:00', '18:00'), sun: { closed: true, open: '10:00', close: '18:00' } };
    const hours = { same_every_day: false, days };
    expect(withinSmsWindow(hours, at('2026-10-06T03:30:00Z'))).toBe(false); // Tue 9 AM
    expect(withinSmsWindow(hours, at('2026-10-06T05:00:00Z'))).toBe(true); // Tue 10:30
    expect(withinSmsWindow(hours, at('2026-10-11T03:30:00Z'))).toBe(true); // Sun 9 AM (closed day)
    expect(withinSmsWindow(hours, at('2026-10-11T16:00:00Z'))).toBe(false); // Sun 9:30 PM
  });

  it('labels slot ranges with an en dash', () => {
    expect(rangeLabel(at('2026-10-06T10:30:00Z'), at('2026-10-06T12:30:00Z'))).toBe('4–6 PM');
    expect(rangeLabel(at('2026-10-06T05:30:00Z'), at('2026-10-06T07:30:00Z'))).toBe('11 AM–1 PM');
    expect(rangeLabel(at('2026-10-06T03:00:00Z'), at('2026-10-06T04:00:00Z'))).toBe('8:30–9:30 AM');
  });

  it('builds slots: lead time, closing-time end, closed days, closure and capacity', () => {
    const slots = { enabled: true, slot_minutes: 120 as const, days_ahead: 1, max_orders_per_slot: 2, min_lead_minutes: 60 };
    const list = buildSlots(state({ slots }), at(TUE_NOON), new Map([['2026-10-06T08:30:00.000Z', 2]]));
    expect(list.map((s) => s.label)).toEqual([
      'Today 2–4 PM', 'Today 4–6 PM', 'Today 6–8 PM', 'Today 8–9 PM',
      'Tomorrow 8–10 AM', 'Tomorrow 10 AM–12 PM', 'Tomorrow 12–2 PM', 'Tomorrow 2–4 PM', 'Tomorrow 4–6 PM', 'Tomorrow 6–8 PM', 'Tomorrow 8–9 PM',
    ]);
    expect(list[0]).toMatchObject({ start: '2026-10-06T08:30:00.000Z', end: '2026-10-06T10:30:00.000Z', remaining: 0, available: false });
    expect(list[1]).toMatchObject({ remaining: 2, available: true });
    // Off -> none; tomorrow a holiday -> today only; closed until 6 PM -> from 6 PM.
    expect(buildSlots(state({ slots: { ...slots, enabled: false } }), at(TUE_NOON))).toEqual([]);
    expect(buildSlots(state({ slots, holidays: [{ date: '2026-10-07', reason: null }] }), at(TUE_NOON))).toHaveLength(4);
    const closed = buildSlots(state({ slots, closure: { closed: true, reason: 'Stock-taking', reopens_at: '2026-10-06T12:30:00.000Z', closed_at: null } }), at(TUE_NOON));
    expect(closed[0].label).toBe('Today 6–8 PM');
    // Night, store closed: tomorrow's slots are still offered (order tonight for the morning).
    expect(buildSlots(state({ slots }), at('2026-10-06T17:00:00Z'))[0].label).toBe('Tomorrow 8–10 AM');
  });
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const app = createApp();
const fx = stockFixtures(app, 'TST-SCH-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = ['store_hours', 'store_closure', 'store_holidays', 'delivery_slots'];
const ACTIONS = ['STORE_HOURS_UPDATED', 'STORE_CLOSED_NOW', 'STORE_REOPENED', 'STORE_HOLIDAYS_UPDATED', 'DELIVERY_SLOTS_UPDATED'];
type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let productId = '';
const pinnedRead = storeSchedule.read;

const deleteRows = async () => {
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  storeSchedule.invalidate();
};
const patch = (path: string, body: object, token = tokens.admin) =>
  request(app).patch(`/api/v1/admin/settings/${path}`).set(auth(token)).send(body);
const order = async (extra: object = {}) => {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(auth(tokens.customer))
    .send({ address_id: fx.addressId, items: [{ product_id: productId, quantity: 1 }], ...extra });
  if (res.body?.data?.order?.id) fx.created.orders.push(res.body.data.order.id);
  return res;
};

beforeAll(async () => {
  storeSchedule.read = storeSchedule.realRead;
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  productId = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  storeSchedule.read = pinnedRead;
  await fx.cleanup();
  await deleteRows();
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  storeSchedule.invalidate();
  await pool.query('DELETE FROM audit_logs WHERE action = ANY($1) AND created_at >= $2', [ACTIONS, testStart]);
});

describe('Store timing settings (Admin and Operations)', () => {
  beforeEach(deleteRows);

  it('defaults to 8 AM - 9 PM, open, no holidays, slots off; other roles are refused', async () => {
    const res = await request(app).get('/api/v1/admin/settings/store-schedule').set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data.hours).toEqual({ same_every_day: true, days: uniformWeek('08:00', '21:00'), updated_at: null });
    expect(res.body.data.closure).toMatchObject({ closed: false, reason: null, reopens_at: null });
    expect(res.body.data.holidays).toEqual([]);
    expect(res.body.data.delivery_slots).toMatchObject({ enabled: false, slot_minutes: 120, days_ahead: 1, max_orders_per_slot: 10, min_lead_minutes: 60 });
    expect(res.body.data.status).toMatchObject({ is_open_now: true, closed_kind: 'OPEN' });
    expect((await request(app).get('/api/v1/admin/settings/store-schedule').set(auth(tokens.staff))).status).toBe(403);
    expect((await patch('store-hours', { same_every_day: true, open: '09:00', close: '20:00' }, tokens.customer)).status).toBe(403);
  });

  it('validates hours: open before close, 15-minute steps, one open day', async () => {
    expect((await patch('store-hours', { same_every_day: true, open: '21:00', close: '08:00' })).status).toBe(400);
    expect((await patch('store-hours', { same_every_day: true, open: '08:10', close: '21:00' })).status).toBe(400);
    const allClosed = Object.fromEntries(Object.entries(uniformWeek('08:00', '21:00')).map(([k, d]) => [k, { ...d, closed: true }]));
    const r = await patch('store-hours', { same_every_day: false, days: allClosed });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('At least one day must be open');
    expect((await patch('store-hours', { same_every_day: false, days: { mon: { closed: false, open: '08:00', close: '21:00' } } })).status).toBe(400);
  });

  it('changes the hours (audited) and order placement, GET /store and SMS follow at once', async () => {
    const days = { ...uniformWeek('08:00', '21:00'), tue: { closed: false, open: '13:00', close: '18:30' } };
    const res = await patch('store-hours', { same_every_day: false, days }, opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data.hours).toMatchObject({ same_every_day: false, days });
    expect(res.body.data.status).toMatchObject({ is_open_now: false, closed_kind: 'OUTSIDE_HOURS', next_open_at: '2026-10-06T07:30:00.000Z' });

    const store = (await request(app).get('/api/v1/store')).body.data;
    expect(store).toMatchObject({ delivery_hours: { start: '13:00', end: '18:30', timezone: 'Asia/Colombo' }, is_open_now: false, closed_kind: 'OUTSIDE_HOURS', today_hours: { open: '13:00', close: '18:30' } });

    const refused = await order();
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('STORE_CLOSED');
    expect(refused.body.error.message).toBe('Blynk takes orders from 1 PM to 6:30 PM. Please order again from 1 PM.');
    expect(refused.body.error.details).toMatchObject({ opens_at: '13:00', closes_at: '18:30', closed_kind: 'OUTSIDE_HOURS', slots_enabled: false });

    // Offer SMS window = today's hours (noon is before 1 PM).
    await expect(assertSmsSendingWindow()).rejects.toMatchObject({ code: 'OUTSIDE_SENDING_HOURS', message: 'Offers can be sent from 1 PM to 6:30 PM only.' });
    await expect(assertSmsSendingWindow(at('2026-10-06T08:00:00Z'))).resolves.toBeUndefined(); // 1:30 PM
    expect(await runBirthdaySms({ now: at(TUE_NOON), userIds: [], setting: { enabled: true, percent: 10, sms_enabled: true, sms_text: 'x' } })).toEqual([]);

    const audit = (await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'STORE_HOURS_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1", [testStart])).rows[0];
    expect(audit.new_values).toMatchObject({ key: 'store_hours', same_every_day: false, days: { tue: { open: '13:00' } } });
    expect(audit.old_values).toMatchObject({ key: 'store_hours', same_every_day: true });

    // Same hours every day again: noon is open.
    expect((await patch('store-hours', { same_every_day: true, open: '08:00', close: '21:00' })).body.data.status.is_open_now).toBe(true);
    expect((await order()).status).toBe(201);
  });

  it('"close the store now" refuses orders with the reason and reopen time, then reopens (audited)', async () => {
    expect((await patch('store-closure', { closed: true, reason: '  ' })).status).toBe(400);
    expect((await patch('store-closure', { closed: true, reason: 'Rain', reopens_at: '2026-10-06T06:00:00.000Z' })).status).toBe(400); // past

    const closed = await patch('store-closure', { closed: true, reason: 'Rain', reopens_at: '2026-10-06T14:00:00+05:30' }, opsToken);
    expect(closed.status).toBe(200);
    expect(closed.body.data.closure).toMatchObject({ closed: true, reason: 'Rain', reopens_at: '2026-10-06T08:30:00.000Z', closed_at: TUE_NOON });
    expect(closed.body.data.status).toMatchObject({ is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain', next_open_at: '2026-10-06T08:30:00.000Z' });

    const store = (await request(app).get('/api/v1/store')).body.data;
    expect(store).toMatchObject({ is_open_now: false, closed_reason: 'Rain', reopens_at: '2026-10-06T08:30:00.000Z', next_open_at: '2026-10-06T08:30:00.000Z' });

    const refused = await order();
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('STORE_CLOSED');
    expect(refused.body.error.message).toBe('Blynk is closed now (Rain). We open again at 2 PM.');
    expect(refused.body.error.details).toMatchObject({ closed_kind: 'CLOSED_NOW', closed_reason: 'Rain', reopens_at: '2026-10-06T08:30:00.000Z' });

    // Auto-reopen at 2 PM, no staff action.
    const pinned = orderingClock.now;
    orderingClock.now = () => at('2026-10-06T08:30:00.000Z');
    try {
      expect((await request(app).get('/api/v1/store')).body.data.is_open_now).toBe(true);
      expect((await order()).status).toBe(201);
    } finally {
      orderingClock.now = pinned;
    }

    const reopened = await patch('store-closure', { closed: false });
    expect(reopened.body.data.closure).toMatchObject({ closed: false, reason: null });
    expect((await order()).status).toBe(201);
    const actions = (await pool.query('SELECT action FROM audit_logs WHERE action = ANY($1) AND created_at >= $2 ORDER BY created_at', [['STORE_CLOSED_NOW', 'STORE_REOPENED'], testStart])).rows.map((r) => r.action);
    expect(actions.slice(-2)).toEqual(['STORE_CLOSED_NOW', 'STORE_REOPENED']);
  });

  it('holiday list: today closes the store; past and duplicate dates are refused', async () => {
    expect((await patch('store-holidays', { holidays: [{ date: '2026-10-05' }] })).status).toBe(400);
    expect((await patch('store-holidays', { holidays: [{ date: '2026-10-08' }, { date: '2026-10-08' }] })).status).toBe(400);
    const res = await patch('store-holidays', { holidays: [{ date: '2026-10-08', reason: '' }, { date: '2026-10-06', reason: 'Poya' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.holidays).toEqual([{ date: '2026-10-06', reason: 'Poya' }, { date: '2026-10-08', reason: null }]);
    expect(res.body.data.status).toMatchObject({ closed_kind: 'HOLIDAY', closed_reason: 'Poya', next_open_at: '2026-10-07T02:30:00.000Z' });
    expect((await request(app).get('/api/v1/store')).body.data.upcoming_holidays).toHaveLength(2);
    const refused = await order();
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toBe('Blynk is closed today (Poya). We open again at 8 AM tomorrow.');
  });
});

describe('Scheduled delivery slots', () => {
  beforeEach(deleteRows);

  it('off by default: no slots, and a slot in an order is refused', async () => {
    const res = await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, asap_available: true, slots: [] });
    const r = await order({ delivery_slot_start: '2026-10-06T10:30:00.000Z' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await patch('delivery-slots', { slot_minutes: 45 })).status).toBe(400);
    expect((await patch('delivery-slots', { min_lead_minutes: 50 })).status).toBe(400);
    expect((await patch('delivery-slots', {})).status).toBe(400);
  });

  it('books a slot (stored with its end), never overbooks under racing checkouts, and frees cancelled places', async () => {
    const s = await patch('delivery-slots', { enabled: true, slot_minutes: 120, days_ahead: 1, max_orders_per_slot: 2, min_lead_minutes: 60 }, opsToken);
    expect(s.status).toBe(200);
    expect((await request(app).get('/api/v1/store')).body.data.delivery_slots_enabled).toBe(true);

    const list = (await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer))).body.data;
    expect(list).toMatchObject({ enabled: true, asap_available: true });
    expect(list.slots[0]).toMatchObject({ start: '2026-10-06T08:30:00.000Z', end: '2026-10-06T10:30:00.000Z', label: 'Today 2–4 PM', remaining: 2, available: true });

    // Too soon (inside the lead time) / not a slot boundary.
    expect((await order({ delivery_slot_start: '2026-10-06T06:30:00.000Z' })).body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await order({ delivery_slot_start: '2026-10-06T09:00:00.000Z' })).body.error.code).toBe('SLOT_UNAVAILABLE');

    const slot = '2026-10-06T10:30:00.000Z'; // Today 4-6 PM
    const results = await Promise.all([1, 2, 3, 4].map(() => order({ delivery_slot_start: slot })));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 201, 409, 409]);
    const full = results.find((r) => r.status === 409)!;
    expect(full.body.error).toMatchObject({ code: 'SLOT_FULL', message: 'The delivery slot Today 4–6 PM is full. Please pick another slot.' });
    const placed = results.filter((r) => r.status === 201).map((r) => r.body.data.order);
    expect(placed[0]).toMatchObject({ scheduled_for: slot, scheduled_until: '2026-10-06T12:30:00.000Z' });

    let again = (await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer))).body.data.slots.find((x: { start: string }) => x.start === slot);
    expect(again).toMatchObject({ remaining: 0, available: false });

    // Staff see it on the order (list + detail).
    const detail = await request(app).get(`/api/v1/admin/orders/${placed[0].id}`).set(auth(tokens.admin));
    expect(detail.body.data.order ?? detail.body.data).toMatchObject({ scheduled_for: slot, scheduled_until: '2026-10-06T12:30:00.000Z' });

    // Cancelling frees the place.
    expect((await request(app).post(`/api/v1/orders/${placed[0].id}/cancel`).set(auth(tokens.customer)).send({ reason: 'Changed my mind' })).status).toBe(200);
    again = (await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer))).body.data.slots.find((x: { start: string }) => x.start === slot);
    expect(again.remaining).toBe(1);

    // ASAP still works while open and stores no slot.
    const asap = await order();
    expect(asap.status).toBe(201);
    expect(asap.body.data.order).toMatchObject({ scheduled_for: null, scheduled_until: null });
  });

  it('at night the store is closed: ASAP is refused, a slot for tomorrow morning is accepted', async () => {
    await patch('delivery-slots', { enabled: true, slot_minutes: 60, max_orders_per_slot: 5, min_lead_minutes: 0 });
    const pinned = orderingClock.now;
    orderingClock.now = () => at('2026-10-06T17:00:00.000Z'); // 10:30 PM Tuesday
    try {
      const list = (await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer))).body.data;
      expect(list).toMatchObject({ enabled: true, asap_available: false, is_open_now: false, next_open_at: '2026-10-07T02:30:00.000Z' });
      expect(list.slots[0]).toMatchObject({ label: 'Tomorrow 8–9 AM', start: '2026-10-07T02:30:00.000Z' });
      const asap = await order();
      expect(asap.status).toBe(422);
      expect(asap.body.error.message).toBe('Blynk takes orders from 8 AM to 9 PM. Please order again from 8 AM tomorrow. You can pick a delivery slot instead.');
      expect(asap.body.error.details.slots_enabled).toBe(true);
      const ok = await order({ delivery_slot_start: list.slots[0].start });
      expect(ok.status).toBe(201);
      expect(ok.body.data.order).toMatchObject({ scheduled_for: '2026-10-07T02:30:00.000Z', scheduled_until: '2026-10-07T03:30:00.000Z' });
    } finally {
      orderingClock.now = pinned;
    }
  });

  it('closed now with no reopen time: no slots are offered', async () => {
    await patch('delivery-slots', { enabled: true });
    await patch('store-closure', { closed: true, reason: 'Stock-taking' });
    const list = (await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer))).body.data;
    expect(list).toMatchObject({ enabled: true, asap_available: false, closed_reason: 'Stock-taking', next_open_at: null, slots: [] });
  });
});
