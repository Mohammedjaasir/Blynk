import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { deliveryCodeForDelivery, wrongCode } from './helpers/delivery-code.js';
import { setRiderTripRules, withRiderTripRules } from './helpers/rider-trips.js';
import { distanceKm, getBatchingRules } from '../src/modules/riders/batching.js';
import { compareSuggestions } from '../src/modules/riders/rider.suggestions.service.js';

/**
 * Rider trips (batching), assignment suggestions and the rider's "My day".
 *
 * Only riders created here are asserted on; the seeded ones may appear in the
 * suggestion list too. Every user, rider, address, order, delivery, payment
 * and notification created here is removed in afterAll, and the stored trip
 * rules are put back exactly as they were.
 */
withRiderTripRules({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });

describe('Rider trips, suggestions and My day', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821'; // 6.4382, 80.0274
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // UNTRACKED: no stock moves

  const riders = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((n, i) => ({
    key: n,
    userId: `a0000009-0000-0000-0000-0000000000${n}`,
    riderId: `f0000009-0000-0000-0000-0000000000${n}`,
    phone: `+9477000993${i}`,
    name: `Trip Rider ${n.toUpperCase()}`,
  }));
  const [near, far, unknown, busy, tripper, racer] = riders;
  const riderToken = (r: (typeof riders)[number]) => generateAccessToken({ id: r.userId, phone: r.phone, role: 'RIDER' });
  const tokens = {
    customer: generateAccessToken(customer),
    admin: generateAccessToken(admin),
    staff: generateAccessToken(staff),
  };

  // Drop-off pins: A and A2 about 0.7 km apart, FAR about 3 km from both (inside the 4 km zone).
  const PIN_A = { lat: 6.4351, lng: 80.0243 };
  const PIN_A2 = { lat: 6.44, lng: 80.028 };
  const PIN_FAR = { lat: 6.4382, lng: 80.055 };
  const addresses: Record<string, string> = {};
  const createdOrders: string[] = [];

  beforeAll(async () => {
    for (const r of riders) {
      await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, $3, 'RIDER')`, [r.userId, r.phone, r.name]);
      await pool.query(
        `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
         VALUES ($1, $2, $3, $4, true, true)`,
        [r.riderId, r.userId, DARK_STORE, `TEST-TRIP-${r.key}`]
      );
    }
    for (const [name, pin] of Object.entries({ A: PIN_A, A2: PIN_A2, FAR: PIN_FAR })) {
      const { rows } = await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, $2, 'Trip Test', '+94771234567', 'No. 1, Trip Lane', 'Dharga Town', $3, $4, false) RETURNING id`,
        [customer.id, `Trip ${name}`, pin.lat, pin.lng]
      );
      addresses[name] = rows[0].id;
    }
  });

  afterAll(async () => {
    const riderIds = riders.map((r) => r.riderId);
    if (createdOrders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    await pool.query('DELETE FROM deliveries WHERE rider_id = ANY($1)', [riderIds]);
    await pool.query('DELETE FROM customer_addresses WHERE id = ANY($1)', [Object.values(addresses)]);
    await pool.query('DELETE FROM riders WHERE id = ANY($1)', [riderIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [riders.map((r) => r.userId)]);
  });

  async function packedOrder(address: 'A' | 'A2' | 'FAR' = 'A') {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ address_id: addresses[address], items: [{ product_id: MILK, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as { id: string; order_number: string; total_amount: number };
    createdOrders.push(order.id);
    const packed = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ status: 'PACKED' });
    expect(packed.status).toBe(200);
    return order;
  }
  const assign = (orderId: string, riderId: string, extra: object = {}) =>
    request(app)
      .post(`/api/v1/admin/orders/${orderId}/assign-rider`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ rider_id: riderId, ...extra });
  const step = (r: (typeof riders)[number], deliveryId: string, body: object) =>
    request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${riderToken(r)}`).send(body);
  const collect = (r: (typeof riders)[number], deliveryId: string, amount: number, code: string) =>
    request(app)
      .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
      .set('Authorization', `Bearer ${riderToken(r)}`)
      .send({ amount, delivery_code: code });
  const suggestions = (orderId: string, token = tokens.admin) =>
    request(app).get(`/api/v1/admin/riders/suggestions?order_id=${orderId}`).set('Authorization', `Bearer ${token}`);
  const myDay = (r: (typeof riders)[number]) =>
    request(app).get('/api/v1/riders/me/day').set('Authorization', `Bearer ${riderToken(r)}`);

  /** A closed (FAILED) attempt carrying a GPS point, so the rider has a "last known" location. */
  async function givePoint(r: (typeof riders)[number], orderId: string, pin: { lat: number; lng: number }, minutesAgo: number) {
    await pool.query(
      `INSERT INTO deliveries (order_id, rider_id, assignment_status, cod_collected_amount, assigned_at, failed_at,
         failure_reason, current_latitude, current_longitude, location_accuracy_m, location_captured_at, location_received_at)
       VALUES ($1, $2, 'FAILED', 0, now() - interval '1 day', now() - interval '1 day', 'test fixture', $3, $4, 10,
         now() - make_interval(mins => $5), now() - make_interval(mins => $5))`,
      [orderId, r.riderId, pin.lat, pin.lng, minutesAgo]
    );
  }

  describe('batching rules', () => {
    it('are read from system_configurations with safe fallbacks', async () => {
      expect(await getBatchingRules()).toEqual({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
      await pool.query(`UPDATE system_configurations SET value = '{"max_active_deliveries": "x"}'::jsonb WHERE key = 'rider_batching'`);
      try {
        expect(await getBatchingRules()).toEqual({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
      } finally {
        await setRiderTripRules({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
      }
    });

    it('straight-line distance is right to within a few metres', () => {
      expect(distanceKm(PIN_A, PIN_A2)).toBeGreaterThan(0.6);
      expect(distanceKm(PIN_A, PIN_A2)).toBeLessThan(0.75);
      expect(distanceKm(PIN_A, PIN_FAR)).toBeGreaterThan(3);
    });
  });

  describe('GET /admin/riders/suggestions', () => {
    it('is staff-only and validates the order id', async () => {
      const order = await packedOrder();
      expect((await suggestions(order.id, tokens.customer)).status).toBe(403);
      expect((await suggestions(order.id, riderToken(near))).status).toBe(403);
      expect((await suggestions(order.id, tokens.staff)).status).toBe(403);
      const bad = await request(app).get('/api/v1/admin/riders/suggestions?order_id=nope').set('Authorization', `Bearer ${tokens.admin}`);
      expect(bad.status).toBe(400);
      const missing = await suggestions('00000000-0000-4000-8000-000000000000');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('ranks free riders first, then nearest by a recent GPS point; old or missing points are "unknown"', async () => {
      const fixture = await packedOrder();
      // near: 0.3 km from the store, 2 min ago. far: about 4 km, 5 min ago.
      // unknown: a point 40 min old (stale). busy: free of location but holding one order.
      await givePoint(near, fixture.id, { lat: 6.4382, lng: 80.0301 }, 2);
      await givePoint(far, fixture.id, { lat: 6.47, lng: 80.04 }, 5);
      await givePoint(unknown, fixture.id, { lat: 6.4382, lng: 80.0275 }, 40);
      const held = await packedOrder('A2');
      expect((await assign(held.id, busy.riderId)).status).toBe(200);

      const order = await packedOrder('A');
      const res = await suggestions(order.id);
      expect(res.status).toBe(200);
      const list = res.body.data.riders as Array<Record<string, any>>;
      const mine = list.filter((r) => riders.some((t) => t.riderId === r.id));
      const byId = (id: string) => mine.find((r) => r.id === id)!;

      expect(byId(near.riderId)).toMatchObject({ open_deliveries: 0, location_known: true, at_capacity: false });
      expect(byId(near.riderId).distance_km).toBeCloseTo(0.3, 1);
      expect(byId(far.riderId).location_known).toBe(true);
      expect(byId(far.riderId).distance_km).toBeGreaterThan(3);
      expect(byId(unknown.riderId)).toMatchObject({ location_known: false, distance_km: null });
      expect(byId(unknown.riderId).last_seen_at).not.toBeNull();
      expect(byId(tripper.riderId)).toMatchObject({ location_known: false, distance_km: null, last_seen_at: null });

      const order_ = mine.map((r) => r.id);
      expect(order_.indexOf(near.riderId)).toBeLessThan(order_.indexOf(far.riderId));
      expect(order_.indexOf(far.riderId)).toBeLessThan(order_.indexOf(unknown.riderId));
      expect(order_.indexOf(unknown.riderId)).toBeLessThan(order_.indexOf(busy.riderId));

      // The busy rider's trip: the other drop-off and how far it is from this one.
      const busyRow = byId(busy.riderId);
      expect(busyRow.open_deliveries).toBe(1);
      expect(busyRow.trip).toHaveLength(1);
      expect(busyRow.trip[0]).toMatchObject({ order_id: held.id, order_number: held.order_number, assignment_status: 'ASSIGNED' });
      expect(busyRow.trip[0].dropoff_distance_km).toBeCloseTo(0.7, 1);
      expect(busyRow.trip_within_distance).toBe(true);

      // Exactly one suggestion, and it is the first row; nobody before `near` has a closer fresh point.
      expect(list.filter((r) => r.suggested)).toHaveLength(1);
      expect(list[0].suggested).toBe(true);
      expect(res.body.data.rules).toEqual({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, location_fresh_minutes: 15 });

      // Privacy: distances and a timestamp only - never a rider's coordinates.
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/latitude|longitude|current_/);
      expect(text).not.toContain('6.4382');
    });

    it('puts a rider at the cap last and never suggests them', () => {
      const base = {
        full_name: 'x', phone: '1', vehicle_type: 'MOTORBIKE', vehicle_registration_number: 'X', last_seen_at: null,
        location_known: false, distance_km: null, trip: [], trip_within_distance: true, suggested: false,
      };
      const full = { ...base, id: 'full', open_deliveries: 2, at_capacity: true, distance_km: 0.1, location_known: true };
      const one = { ...base, id: 'one', open_deliveries: 1, at_capacity: false };
      const free = { ...base, id: 'free', open_deliveries: 0, at_capacity: false };
      expect([full, one, free].sort(compareSuggestions).map((r) => r.id)).toEqual(['free', 'one', 'full']);
    });
  });

  describe('assigning a second order (a trip)', () => {
    it('adds a nearby order, refuses a third, and each order keeps its own delivery, code and cash', async () => {
      const first = await packedOrder('A');
      const second = await packedOrder('A2');
      const third = await packedOrder('A');
      const d1 = (await assign(first.id, tripper.riderId)).body.data.delivery.id as string;
      // The first is already picked up: the second joins the trip anyway.
      expect((await step(tripper, d1, { status: 'PICKED_UP' })).status).toBe(200);
      const a2 = await assign(second.id, tripper.riderId);
      expect(a2.status).toBe(200);
      const d2 = a2.body.data.delivery.id as string;
      expect(d2).not.toBe(d1);

      const refused = await assign(third.id, tripper.riderId);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('RIDER_AT_CAPACITY');
      expect(refused.body.error.details).toEqual({ open_deliveries: 2, max_active_deliveries: 2 });
      expect((await pool.query('SELECT count(*)::int AS n FROM deliveries WHERE order_id = $1', [third.id])).rows[0].n).toBe(0);

      // The rider sees both; each is worked on its own.
      const list = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${riderToken(tripper)}`);
      expect(list.body.data.deliveries.map((d: { delivery_id: string }) => d.delivery_id).sort()).toEqual([d1, d2].sort());

      expect((await step(tripper, d2, { status: 'PICKED_UP' })).status).toBe(200);
      const code1 = await deliveryCodeForDelivery(d1);
      const code2 = await deliveryCodeForDelivery(d2);
      expect((await step(tripper, d1, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      // The other stop's code does not open this one.
      if (code1 !== code2) {
        const crossed = await collect(tripper, d1, first.total_amount, code2);
        expect(crossed.status).toBe(422);
        expect(crossed.body.error.code).toBe('WRONG_DELIVERY_CODE');
      }
      expect((await collect(tripper, d1, first.total_amount, code1)).status).toBe(200);
      // Delivering one frees a place: the third order can now join.
      expect((await assign(third.id, tripper.riderId)).status).toBe(200);

      expect((await step(tripper, d2, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      expect((await collect(tripper, d2, second.total_amount, wrongCode(code2))).status).toBe(422);
      expect((await collect(tripper, d2, second.total_amount, code2)).status).toBe(200);

      const rows = (
        await pool.query(
          `SELECT d.id, d.assignment_status, d.cod_collected_amount::float AS cash, o.order_status, o.payment_status
             FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = ANY($1) ORDER BY d.assigned_at`,
          [[d1, d2]]
        )
      ).rows;
      expect(rows).toEqual([
        { id: d1, assignment_status: 'DELIVERED', cash: first.total_amount, order_status: 'DELIVERED', payment_status: 'PAID' },
        { id: d2, assignment_status: 'DELIVERED', cash: second.total_amount, order_status: 'DELIVERED', payment_status: 'PAID' },
      ]);
    });

    it('a far drop-off needs an explicit confirmation (409 BATCH_DROPOFFS_TOO_FAR)', async () => {
      const home = await packedOrder('A');
      const away = await packedOrder('FAR');
      expect((await assign(home.id, racer.riderId)).status).toBe(200);
      const res = await assign(away.id, racer.riderId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BATCH_DROPOFFS_TOO_FAR');
      expect(res.body.error.details.distance_km).toBeGreaterThan(3);
      expect(res.body.error.details).toMatchObject({ max_dropoff_distance_km: 1.5, other_order_number: home.order_number });

      // The suggestion says so too: not within distance, so not suggested.
      const s = (await suggestions(away.id)).body.data.riders.find((r: { id: string }) => r.id === racer.riderId);
      expect(s).toMatchObject({ trip_within_distance: false, suggested: false });

      const confirmed = await assign(away.id, racer.riderId, { confirm_far_batch: true });
      expect(confirmed.status).toBe(200);
      expect((await assign(away.id, racer.riderId, { confirm_far_batch: 'yes' })).status).toBe(400);
    });

    it("an ASSIGNED delivery on a cancelled order does not use up the rider's trip", async () => {
      // racer holds two open deliveries from the previous test; cancel one of them.
      const open = (
        await pool.query(
          `SELECT o.id FROM deliveries d JOIN orders o ON o.id = d.order_id
            WHERE d.rider_id = $1 AND d.assignment_status = 'ASSIGNED' ORDER BY d.assigned_at LIMIT 1`,
          [racer.riderId]
        )
      ).rows[0].id as string;
      const cancel = await request(app)
        .patch(`/api/v1/admin/orders/${open}/status`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ status: 'CANCELLED', notes: 'Test: customer changed their mind' });
      expect(cancel.status).toBe(200);
      const next = await packedOrder('FAR');
      expect((await assign(next.id, racer.riderId)).status).toBe(200);
      const roster = await request(app).get('/api/v1/admin/riders').set('Authorization', `Bearer ${tokens.admin}`);
      expect(roster.body.data.riders.find((r: { id: string }) => r.id === racer.riderId).open_deliveries).toBe(2);
    });

    it('two concurrent assignments to a rider with one order: exactly one joins the trip (rider row lock)', async () => {
      for (let rep = 0; rep < 3; rep++) {
        await setRiderTripRules({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
        const held = await packedOrder('A');
        const x = await packedOrder('A');
        const y = await packedOrder('A2');
        expect((await assign(held.id, unknown.riderId)).status).toBe(200);
        const [rx, ry] = await Promise.all([assign(x.id, unknown.riderId), assign(y.id, unknown.riderId)]);
        expect([rx.status, ry.status].sort()).toEqual([200, 409]);
        expect([rx, ry].find((r) => r.status === 409)!.body.error.code).toBe('RIDER_AT_CAPACITY');
        const n = (
          await pool.query(
            `SELECT count(*)::int AS n FROM deliveries d JOIN orders o ON o.id = d.order_id
              WHERE d.rider_id = $1 AND d.assignment_status = 'ASSIGNED' AND o.order_status = 'PACKED'`,
            [unknown.riderId]
          )
        ).rows[0].n;
        expect(n).toBe(2);
        // Close this round's trip so the next repetition starts empty.
        await pool.query(
          `UPDATE deliveries SET assignment_status = 'FAILED', failed_at = now(), failure_reason = 'test reset'
            WHERE rider_id = $1 AND assignment_status = 'ASSIGNED'`,
          [unknown.riderId]
        );
      }
    });

    it('a location sent for one stop also moves the other stop the rider is carrying', async () => {
      const o1 = await packedOrder('A');
      const o2 = await packedOrder('A2');
      const d1 = (await assign(o1.id, far.riderId)).body.data.delivery.id as string;
      const d2 = (await assign(o2.id, far.riderId)).body.data.delivery.id as string;
      expect((await step(far, d1, { status: 'PICKED_UP' })).status).toBe(200);
      expect((await step(far, d2, { status: 'PICKED_UP' })).status).toBe(200);
      const sent = await request(app)
        .post(`/api/v1/riders/deliveries/${d1}/location`)
        .set('Authorization', `Bearer ${riderToken(far)}`)
        .send({ latitude: 6.437, longitude: 80.026, accuracy: 8, captured_at: new Date().toISOString() });
      expect(sent.status).toBe(202);
      const rows = (
        await pool.query(
          `SELECT id, current_latitude::float AS lat, current_longitude::float AS lng FROM deliveries WHERE id = ANY($1)`,
          [[d1, d2]]
        )
      ).rows;
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r).toMatchObject({ lat: 6.437, lng: 80.026 });

      // Once a stop is reached it is no longer tracked; the other one still is.
      expect((await step(far, d2, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      await pool.query(`UPDATE deliveries SET location_received_at = now() - interval '1 minute' WHERE id = $1`, [d1]);
      await request(app)
        .post(`/api/v1/riders/deliveries/${d1}/location`)
        .set('Authorization', `Bearer ${riderToken(far)}`)
        .send({ latitude: 6.438, longitude: 80.027, accuracy: 8, captured_at: new Date().toISOString() })
        .expect(202);
      const after = (await pool.query(`SELECT id, current_latitude::float AS lat FROM deliveries WHERE id = ANY($1)`, [[d1, d2]])).rows;
      expect(after.find((r) => r.id === d1)!.lat).toBe(6.438);
      expect(after.find((r) => r.id === d2)!.lat).toBe(6.437);
    });
  });

  describe('GET /riders/me/day', () => {
    it('counts only the calling rider, today and this week (Monday-Sunday, Asia/Colombo)', async () => {
      // tripper delivered two orders above (plus one still open). Add a failed
      // attempt and a customer-unavailable one today, and one of each from
      // earlier: last week (excluded) and this Monday 00:01 (this week).
      const failedOrder = await packedOrder('A');
      const df = (await assign(failedOrder.id, tripper.riderId)).body.data.delivery.id as string;
      expect((await step(tripper, df, { status: 'PICKED_UP' })).status).toBe(200);
      expect((await step(tripper, df, { status: 'FAILED', failure_reason: 'Gate locked' })).status).toBe(200);

      const unavailableOrder = await packedOrder('A');
      const du = (await assign(unavailableOrder.id, tripper.riderId)).body.data.delivery.id as string;
      expect((await step(tripper, du, { status: 'PICKED_UP' })).status).toBe(200);
      const marked = await request(app)
        .patch(`/api/v1/admin/orders/${unavailableOrder.id}/status`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ status: 'CUSTOMER_UNAVAILABLE', notes: 'No answer on the phone' });
      expect(marked.status).toBe(200);

      const calendar = (
        await pool.query(
          `SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo') AS week_start,
                  (date_trunc('day', now() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo') AS day_start,
                  to_char(now() AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD') AS today,
                  to_char(date_trunc('week', now() AT TIME ZONE 'Asia/Colombo'), 'YYYY-MM-DD') AS monday`
        )
      ).rows[0] as { week_start: Date; day_start: Date; today: string; monday: string };
      // Earlier deliveries: move two finished ones back in time.
      const lastWeek = await packedOrder('A');
      const thisMonday = await packedOrder('A');
      for (const [o, at] of [
        [lastWeek, new Date(calendar.week_start.getTime() - 60_000)],
        [thisMonday, new Date(calendar.week_start.getTime() + 60_000)],
      ] as const) {
        await pool.query(
          `INSERT INTO deliveries (order_id, rider_id, assignment_status, cod_collected_amount, assigned_at, picked_up_at, delivered_at)
           VALUES ($1, $2, 'DELIVERED', 500, $3, $3, $3)`,
          [o.id, tripper.riderId, at]
        );
      }
      const mondayIsToday = calendar.today === calendar.monday;

      const res = await myDay(tripper);
      expect(res.status).toBe(200);
      const day = res.body.data;
      expect(day.timezone).toBe('Asia/Colombo');
      expect(day.today.date).toBe(calendar.today);
      expect(day.week.starts_on).toBe(calendar.monday);

      const deliveredCash = Number(((await pool.query(
        `SELECT coalesce(sum(cod_collected_amount), 0)::float AS s FROM deliveries
          WHERE rider_id = $1 AND assignment_status = 'DELIVERED' AND delivered_at >= $2`,
        [tripper.riderId, calendar.day_start]
      )).rows[0].s).toFixed(2));
      expect(day.today).toMatchObject({
        completed: 2 + (mondayIsToday ? 1 : 0),
        failed: 1,
        customer_unavailable: 1,
        cash_collected: deliveredCash,
      });
      expect(day.week).toMatchObject({ completed: 3, failed: 1, customer_unavailable: 1 });
      expect(day.week.cash_collected).toBeCloseTo(day.today.cash_collected + (mondayIsToday ? 0 : 500), 2);

      // Today's list: newest first, order number, time, cash - nothing about the customer.
      const today = day.deliveries_today as Array<Record<string, unknown>>;
      expect(today.map((d) => d.outcome)).toEqual(
        expect.arrayContaining(['DELIVERED', 'DELIVERED', 'FAILED', 'CUSTOMER_UNAVAILABLE'])
      );
      expect(today.find((d) => d.delivery_id === df)).toMatchObject({ outcome: 'FAILED', cash_collected: 0, order_number: failedOrder.order_number });
      expect(today.find((d) => d.delivery_id === du)).toMatchObject({ outcome: 'CUSTOMER_UNAVAILABLE' });
      const times = today.map((d) => Date.parse(d.at as string));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(JSON.stringify(day)).not.toMatch(/recipient|phone|address|latitude|fee|pay/i);

      // Another rider's day is their own.
      const other = await myDay(near);
      expect(other.status).toBe(200);
      expect(other.body.data.today).toMatchObject({ completed: 0, cash_collected: 0 });
      expect(other.body.data.deliveries_today).toEqual([]);
    });

    it('is refused to customers and to accounts without a rider profile', async () => {
      expect((await request(app).get('/api/v1/riders/me/day').set('Authorization', `Bearer ${tokens.customer}`)).status).toBe(403);
      const res = await request(app).get('/api/v1/riders/me/day').set('Authorization', `Bearer ${tokens.admin}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('RIDER_PROFILE_NOT_FOUND');
      expect((await request(app).get('/api/v1/riders/me/day')).status).toBe(401);
    });
  });
});
