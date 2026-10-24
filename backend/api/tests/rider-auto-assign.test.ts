import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { withRiderTripRules } from './helpers/rider-trips.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import {
  AUTO_ASSIGN_LOCK_KEY,
  rankAutoAssignRiders,
  runAutoAssign,
  type AutoAssignRider,
} from '../src/modules/riders/rider.auto-assign.js';
import { RIDER_AUTO_ASSIGN_KEY, riderAutoAssignFrom } from '../src/modules/configuration/rider-auto-assign.js';

/**
 * Automatic rider assignment: the pure ranking/eligibility rules, the setting endpoint, and the
 * worker job against the real database (waits, skips staff-assigned orders, respects the trip cap,
 * the nobody-qualifies notice once, closed store, single instance). Everything is timed against a
 * pinned `now`, and every job run is limited to the orders created here.
 */
const NOW = new Date('2026-10-06T06:30:00.000Z'); // midday Colombo, store open
const NIGHT = new Date('2026-10-06T17:30:00.000Z'); // 23:00 Colombo, store closed
const HUB = { lat: 6.4382, lng: 80.0274 };
const at = (dLat: number, dLng: number) => ({ lat: Number((HUB.lat + dLat).toFixed(6)), lng: Number((HUB.lng + dLng).toFixed(6)) });
const minsAgo = (m: number, from: Date = NOW) => new Date(from.getTime() - m * 60_000);

describe('rankAutoAssignRiders (pure)', () => {
  const dropoff = at(0.01, 0); // about 1.1 km north of the hub
  const base = (over: Partial<AutoAssignRider> & { id: string }): AutoAssignRider => ({
    name: over.id,
    open_deliveries: 0,
    position: at(0.002, 0),
    seen_at: minsAgo(2),
    trip_dropoffs: [],
    ...over,
  });
  const rules = { max_active_deliveries: 2, max_dropoff_distance_km: 1.5 };
  const config = { max_distance_km: 5 };
  const rank = (riders: AutoAssignRider[], extra: object = {}) =>
    rankAutoAssignRiders({ store: HUB, dropoff, riders, rules, config, now: NOW, ...extra });

  it('puts a free rider before a rider on a trip, then the nearer one to the store first', () => {
    const r = rank([
      base({ id: 'busy', open_deliveries: 1, position: at(0.0005, 0), trip_dropoffs: [at(0.011, 0)] }),
      base({ id: 'far-free', position: at(0.02, 0) }),
      base({ id: 'near-free', position: at(0.001, 0) }),
    ]);
    expect(r.ranked.map((x) => x.id)).toEqual(['near-free', 'far-free', 'busy']);
    expect(r.ranked[0].distance_to_store_km).toBeLessThan(0.2);
  });

  it('names why a rider does not qualify', () => {
    const r = rank([
      base({ id: 'ok' }),
      base({ id: 'full', open_deliveries: 2 }),
      base({ id: 'never-seen', position: null, seen_at: null }),
      base({ id: 'stale', seen_at: minsAgo(16) }),
      base({ id: 'from-the-future', seen_at: new Date(NOW.getTime() + 10 * 60_000) }),
      base({ id: 'too-far', position: at(0.1, 0) }),
      base({ id: 'trip-far', open_deliveries: 1, trip_dropoffs: [at(0.1, 0)] }),
      base({ id: 'trip-unknown', open_deliveries: 1, trip_dropoffs: [null] }),
    ]);
    expect(r.ranked.map((x) => x.id)).toEqual(['ok']);
    const reason = Object.fromEntries(r.excluded.map((e) => [e.id, e.reason]));
    expect(reason).toEqual({
      full: 'AT_CAPACITY',
      'never-seen': 'NO_FRESH_POSITION',
      stale: 'NO_FRESH_POSITION',
      'from-the-future': 'NO_FRESH_POSITION',
      'too-far': 'TOO_FAR_FROM_DROPOFF',
      'trip-far': 'TRIP_TOO_FAR',
      'trip-unknown': 'TRIP_TOO_FAR',
    });
  });

  it('lets a rider on a trip take a drop-off close to what they carry', () => {
    const r = rank([base({ id: 'busy', open_deliveries: 1, trip_dropoffs: [at(0.011, 0.002)] })]);
    expect(r.ranked.map((x) => x.id)).toEqual(['busy']);
  });

  it('follows the distance limit and the freshness window it is given', () => {
    const riders = [base({ id: 'a', position: at(0.03, 0), seen_at: minsAgo(10) })];
    expect(rank(riders).ranked).toHaveLength(1);
    expect(rank(riders, { config: { max_distance_km: 1 } }).ranked).toHaveLength(0);
    expect(rank(riders, { freshMinutes: 5 }).ranked).toHaveLength(0);
  });

  it('qualifies nobody for an order without a drop-off pin', () => {
    const r = rank([base({ id: 'a' })], { dropoff: null });
    expect(r.ranked).toHaveLength(0);
    expect(r.excluded[0].reason).toBe('NO_DROPOFF_PIN');
  });

  it('breaks a tie by the distance to the drop-off, then by name', () => {
    const r = rank([base({ id: 'b', name: 'Bee', position: at(0.002, 0) }), base({ id: 'a', name: 'Ann', position: at(0.002, 0) })]);
    expect(r.ranked.map((x) => x.name)).toEqual(['Ann', 'Bee']);
  });
});

describe('rider_auto_assign setting', () => {
  it('reads anything missing or malformed as the defaults (off)', () => {
    expect(riderAutoAssignFrom(undefined)).toEqual({ enabled: false, wait_seconds: 90, max_distance_km: 5 });
    expect(riderAutoAssignFrom({ enabled: 'yes', wait_seconds: 5, max_distance_km: -1 })).toEqual({
      enabled: false,
      wait_seconds: 90,
      max_distance_km: 5,
    });
    expect(riderAutoAssignFrom({ enabled: true, wait_seconds: 120, max_distance_km: 3.5 })).toEqual({
      enabled: true,
      wait_seconds: 120,
      max_distance_km: 3.5,
    });
  });
});

const fakePush: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const DEVICES = [`auto-assign-rider-${Date.now()}`, `auto-assign-staff-${Date.now()}`];

describe('Automatic rider assignment', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const ops = { ...admin, role: 'OPERATIONS' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = {
    customer: generateAccessToken(customer),
    admin: generateAccessToken(admin),
    ops: generateAccessToken(ops),
    staff: generateAccessToken(staff),
  };
  const riders = ['e1', 'e2', 'e3', 'e4'].map((n, i) => ({
    key: n,
    userId: `a0000009-0000-0000-0000-0000000000${n}`,
    riderId: `f0000009-0000-0000-0000-0000000000${n}`,
    phone: `+9477000994${i}`,
    name: `Auto Rider ${n.toUpperCase()}`,
  }));
  const [nearR, midR, farR, staleR] = riders;
  let hub = HUB;
  const createdOrders: string[] = [];
  const addresses: Record<string, string> = {};
  let anchorOrder = '';
  const startedAt = new Date();
  let savedSetting: { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null = null;

  // Trip rules pinned for the file (cap 2, 1.5 km), restored afterwards.
  withRiderTripRules({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });

  const setting = (value: object | null) =>
    value === null
      ? pool.query('DELETE FROM system_configurations WHERE key = $1', [RIDER_AUTO_ASSIGN_KEY])
      : pool.query(
          `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'test')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [RIDER_AUTO_ASSIGN_KEY, JSON.stringify(value)]
        );

  beforeAll(async () => {
    hub = (await pool.query('SELECT latitude::float AS lat, longitude::float AS lng FROM dark_stores WHERE id = $1', [DARK_STORE])).rows[0];
    savedSetting = (await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [RIDER_AUTO_ASSIGN_KEY])).rows[0] ?? null;
    for (const r of riders) {
      await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, $3, 'RIDER')`, [r.userId, r.phone, r.name]);
      await pool.query(
        `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
         VALUES ($1, $2, $3, $4, true, true)`,
        [r.riderId, r.userId, DARK_STORE, `TEST-AUTO-${r.key}`]
      );
    }
    const pins = { NORTH: pt(0.012, 0), NEAR: pt(0.011, 0.002), FAR: pt(0.012, 0.03) };
    for (const [name, p] of Object.entries(pins)) {
      const { rows } = await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, $2, 'Auto Test', '+94771234567', 'No. 1, Auto Lane', 'Dharga Town', $3, $4, false) RETURNING id`,
        [customer.id, `Auto ${name}`, p.lat, p.lng]
      );
      addresses[name] = rows[0].id;
    }
    await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [nearR.userId, DEVICES[0]]);
    await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [admin.id, DEVICES[1]]);
    // One ordinary order holds every rider's "last known point" (closed deliveries with a point).
    anchorOrder = (await placeOrder('NORTH')).id;
  });

  // Each test starts with the test riders holding nothing (the anchor order's point rows are re-made by the tests).
  beforeEach(async () => {
    await pool.query('DELETE FROM deliveries WHERE rider_id = ANY($1)', [riders.map((r) => r.riderId)]);
  });

  afterEach(() => setPushSenderForTests(undefined));

  afterAll(async () => {
    const riderIds = riders.map((r) => r.riderId);
    await pool.query('DELETE FROM device_tokens WHERE token = ANY($1)', [DEVICES]);
    if (createdOrders.length) {
      await pool.query('DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id = ANY($2)', ['ORDER', createdOrders]);
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    await pool.query('DELETE FROM deliveries WHERE rider_id = ANY($1)', [riderIds]);
    await pool.query(`DELETE FROM audit_logs WHERE action = 'RIDER_AUTO_ASSIGN_UPDATED' AND created_at >= $1`, [startedAt]);
    await pool.query('DELETE FROM customer_addresses WHERE id = ANY($1)', [Object.values(addresses)]);
    await pool.query('DELETE FROM riders WHERE id = ANY($1)', [riderIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [riders.map((r) => r.userId)]);
    if (!savedSetting) await pool.query('DELETE FROM system_configurations WHERE key = $1', [RIDER_AUTO_ASSIGN_KEY]);
    else {
      await pool.query(
        `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
           created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
        [RIDER_AUTO_ASSIGN_KEY, JSON.stringify(savedSetting.value), savedSetting.description, savedSetting.created_at, savedSetting.updated_at]
      );
    }
  });

  function pt(dLat: number, dLng: number) {
    return { lat: Number((hub.lat + dLat).toFixed(6)), lng: Number((hub.lng + dLng).toFixed(6)) };
  }

  async function placeOrder(address: 'NORTH' | 'NEAR' | 'FAR') {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ address_id: addresses[address], items: [{ product_id: MILK, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as { id: string; order_number: string };
    createdOrders.push(order.id);
    return order;
  }

  /** A packed order that has waited `waited` seconds (relative to NOW). */
  async function packedOrder(address: 'NORTH' | 'NEAR' | 'FAR' = 'NORTH', waited = 200) {
    const order = await placeOrder(address);
    const packed = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ status: 'PACKED' });
    expect(packed.status).toBe(200);
    await pool.query(`UPDATE order_status_history SET created_at = $2 WHERE order_id = $1 AND new_status = 'PACKED'`, [
      order.id,
      new Date(NOW.getTime() - waited * 1000),
    ]);
    return order;
  }

  /** A closed delivery on the anchor order carrying the rider's last GPS point. */
  async function givePoint(r: (typeof riders)[number], p: { lat: number; lng: number }, minutes: number) {
    await pool.query('DELETE FROM deliveries WHERE order_id = $1 AND rider_id = $2', [anchorOrder, r.riderId]);
    const when = minsAgo(minutes);
    await pool.query(
      `INSERT INTO deliveries (order_id, rider_id, assignment_status, cod_collected_amount, assigned_at, failed_at, failure_reason,
         current_latitude, current_longitude, location_accuracy_m, location_captured_at, location_received_at)
       VALUES ($1, $2, 'FAILED', 0, $3, $3, 'test fixture', $4, $5, 10, $3, $3)`,
      [anchorOrder, r.riderId, when, p.lat, p.lng]
    );
  }

  const run = (orderIds: string[], now: Date = NOW) => runAutoAssign({ now, orderIds });
  const deliveriesOf = async (orderId: string) =>
    (await pool.query('SELECT rider_id, assignment_status FROM deliveries WHERE order_id = $1 ORDER BY assigned_at', [orderId])).rows;
  const auditOf = async (orderId: string, action: string) =>
    (await pool.query('SELECT actor_user_id, new_values FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 AND action = $3', ['ORDER', orderId, action])).rows;

  async function resetPoints() {
    await pool.query('DELETE FROM deliveries WHERE order_id = $1', [anchorOrder]);
    await givePoint(nearR, pt(0.004, 0), 2);
    await givePoint(midR, pt(-0.01, 0), 3);
    await givePoint(farR, pt(0.2, 0), 2);
    await givePoint(staleR, pt(0.011, 0), 40);
  }

  it('does nothing while it is switched off (the default)', async () => {
    await setting(null);
    await resetPoints();
    const order = await packedOrder();
    const res = await run([order.id]);
    expect(res.skipped).toBe('disabled');
    expect(await deliveriesOf(order.id)).toHaveLength(0);
  });

  it('assigns the best rider once an order has waited long enough, like a manual assignment', async () => {
    setPushSenderForTests(fakePush);
    await setting({ enabled: true, wait_seconds: 90, max_distance_km: 5 });
    await resetPoints();
    const young = await packedOrder('NORTH', 30);
    const res0 = await run([young.id]);
    expect(res0.assigned).toHaveLength(0);
    expect(await deliveriesOf(young.id)).toHaveLength(0);

    const order = await packedOrder('NORTH', 200);
    const res = await run([order.id]);
    expect(res.skipped).toBeNull();
    expect(res.assigned).toHaveLength(1);
    // near rider is the nearest to the store; far rider is beyond max distance, stale rider has an old point.
    const rows = await deliveriesOf(order.id);
    expect(rows).toEqual([{ rider_id: nearR.riderId, assignment_status: 'ASSIGNED' }]);
    // The order is still PACKED (assignment never changes the status), exactly as a manual assignment.
    const status = await pool.query('SELECT order_status FROM orders WHERE id = $1', [order.id]);
    expect(status.rows[0].order_status).toBe('PACKED');
    // Audit: AUTO_ASSIGNED by the system (no user).
    const audit = await auditOf(order.id, 'AUTO_ASSIGNED');
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBeNull();
    expect(audit[0].new_values).toMatchObject({ actor: 'system', rider_id: nearR.riderId, order_number: order.order_number });
    // The same side effect as a manual assignment: the rider's phone is told.
    const pushes = await pool.query(`SELECT recipient, payload FROM notifications WHERE notification_type = 'PUSH_RIDER_ASSIGNED' AND order_id = $1`, [order.id]);
    expect(pushes.rows).toHaveLength(1);
    expect(pushes.rows[0].recipient).toBe(nearR.userId);
    expect(pushes.rows[0].payload).toMatchObject({ title: 'New delivery assigned', data: { delivery_id: res.assigned[0].delivery_id } });
    // A second tick never reassigns it.
    const again = await run([order.id]);
    expect(again.considered).toBe(0);
    expect(await deliveriesOf(order.id)).toHaveLength(1);
  });

  it('leaves an order staff assigned by hand alone, even after that delivery failed', async () => {
    await setting({ enabled: true, wait_seconds: 90, max_distance_km: 5 });
    await resetPoints();
    const order = await packedOrder('NORTH', 400);
    const manual = await request(app)
      .post(`/api/v1/admin/orders/${order.id}/assign-rider`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ rider_id: midR.riderId });
    expect(manual.status).toBe(200);
    await pool.query(`UPDATE deliveries SET assignment_status = 'FAILED', failed_at = now(), failure_reason = 'test' WHERE order_id = $1`, [order.id]);
    const res = await run([order.id]);
    expect(res.considered).toBe(0);
    expect(res.assigned).toHaveLength(0);
    expect(await deliveriesOf(order.id)).toHaveLength(1);
  });

  it('respects the trip cap and the trip distance', async () => {
    await setting({ enabled: true, wait_seconds: 60, max_distance_km: 5 });
    await resetPoints();
    // near rider carries two orders already (the cap): the next nearest free rider gets the order.
    const a = await packedOrder('NORTH', 300);
    const b = await packedOrder('NEAR', 300);
    for (const o of [a, b]) {
      const r = await request(app)
        .post(`/api/v1/admin/orders/${o.id}/assign-rider`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ rider_id: nearR.riderId });
      expect(r.status).toBe(200);
    }
    const order = await packedOrder('NORTH', 120);
    const res = await run([order.id]);
    expect(res.assigned).toHaveLength(1);
    expect((await deliveriesOf(order.id))[0].rider_id).toBe(midR.riderId);

    // A rider one order into a trip whose drop-off is far from the new one is not used (automatic
    // assignment cannot ask for the staff confirmation a far trip needs): the next rider gets it.
    await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [[a.id, b.id, order.id]]);
    const far = await packedOrder('FAR', 300);
    const r1 = await request(app)
      .post(`/api/v1/admin/orders/${far.id}/assign-rider`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ rider_id: nearR.riderId });
    expect(r1.status).toBe(200);
    const next = await packedOrder('NORTH', 120);
    const res2 = await run([next.id]);
    expect(res2.assigned).toHaveLength(1);
    expect((await deliveriesOf(next.id))[0].rider_id).toBe(midR.riderId);
  });

  it('tells staff once when no rider qualifies, and assigns it later when one does', async () => {
    setPushSenderForTests(fakePush);
    await setting({ enabled: true, wait_seconds: 60, max_distance_km: 5 });
    await pool.query('DELETE FROM deliveries WHERE order_id = $1', [anchorOrder]);
    await givePoint(farR, pt(0.2, 0), 2); // only a rider far away
    await givePoint(staleR, pt(0.011, 0), 40); // and one not seen for 40 minutes
    const order = await packedOrder('NORTH', 300);
    const first = await run([order.id]);
    expect(first.assigned).toHaveLength(0);
    expect(first.no_rider).toEqual([{ order_id: order.id, order_number: order.order_number, first_time: true }]);
    const second = await run([order.id]);
    expect(second.no_rider[0].first_time).toBe(false);
    expect(await auditOf(order.id, 'AUTO_ASSIGN_NO_RIDER')).toHaveLength(1);
    // One staff push per staff device user, not one per tick.
    const staffPushes = await pool.query(`SELECT recipient FROM notifications WHERE notification_type = 'PUSH_AUTO_ASSIGN_NO_RIDER' AND order_id = $1`, [order.id]);
    expect(staffPushes.rows.map((r) => r.recipient)).toContain(admin.id);
    expect(new Set(staffPushes.rows.map((r) => r.recipient)).size).toBe(staffPushes.rowCount);
    expect(await deliveriesOf(order.id)).toHaveLength(0);
    // A rider shows up near the store: the next tick assigns the order.
    await givePoint(nearR, pt(0.003, 0), 1);
    const third = await run([order.id]);
    expect(third.assigned.map((a) => a.rider_id)).toEqual([nearR.riderId]);
  });

  it('never assigns while the store is closed', async () => {
    await setting({ enabled: true, wait_seconds: 60, max_distance_km: 5 });
    await resetPoints();
    const order = await packedOrder('NORTH', 300);
    const res = await run([order.id], NIGHT);
    expect(res.skipped).toBe('closed');
    expect(await deliveriesOf(order.id)).toHaveLength(0);
  });

  it('skips the tick when another worker holds the lock (single instance)', async () => {
    await setting({ enabled: true, wait_seconds: 60, max_distance_km: 5 });
    await resetPoints();
    const order = await packedOrder('NORTH', 300);
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock($1)', [AUTO_ASSIGN_LOCK_KEY]);
      const res = await run([order.id]);
      expect(res.skipped).toBe('locked');
      expect(await deliveriesOf(order.id)).toHaveLength(0);
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
    expect((await run([order.id])).assigned).toHaveLength(1);
  });

  describe('GET|PUT /admin/settings/rider-auto-assign', () => {
    const get = (token: string) => request(app).get('/api/v1/admin/settings/rider-auto-assign').set('Authorization', `Bearer ${token}`);
    const put = (token: string, body: object) =>
      request(app).put('/api/v1/admin/settings/rider-auto-assign').set('Authorization', `Bearer ${token}`).send(body);

    it('is OFF by default, editable by Admin and Operations, validated and audited', async () => {
      await setting(null);
      const initial = await get(tokens.admin);
      expect(initial.status).toBe(200);
      expect(initial.body.data).toMatchObject({ enabled: false, wait_seconds: 90, max_distance_km: 5 });

      const saved = await put(tokens.ops, { enabled: true, wait_seconds: 120 });
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ enabled: true, wait_seconds: 120, max_distance_km: 5 });
      const partial = await put(tokens.admin, { max_distance_km: 3.5 });
      expect(partial.body.data).toMatchObject({ enabled: true, wait_seconds: 120, max_distance_km: 3.5 });

      for (const bad of [{}, { wait_seconds: 5 }, { wait_seconds: 90.5 }, { max_distance_km: 99 }, { enabled: 'yes' }, { surprise: 1 }]) {
        const res = await put(tokens.admin, bad);
        expect(res.status, JSON.stringify(bad)).toBe(400);
      }
      const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'RIDER_AUTO_ASSIGN_UPDATED' AND created_at >= $1`, [startedAt]);
      expect(audit.rows[0].n).toBe(2);
    });

    it('is closed to customers, packing staff and signed-out callers', async () => {
      for (const t of [tokens.customer, tokens.staff]) {
        expect((await get(t)).status).toBe(403);
        expect((await put(t, { enabled: true })).status).toBe(403);
      }
      expect((await request(app).get('/api/v1/admin/settings/rider-auto-assign')).status).toBe(401);
    });
  });

  describe('GET /admin/riders/live', () => {
    const live = (token?: string) => {
      const r = request(app).get('/api/v1/admin/riders/live');
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    };

    it('answers staff with riders (position, age, load, drop points) and the orders waiting for a rider', async () => {
      await setting({ enabled: true, wait_seconds: 90, max_distance_km: 5 });
      await pool.query('DELETE FROM deliveries WHERE order_id = $1', [anchorOrder]);
      await givePoint(nearR, pt(0.004, 0), 1);
      await givePoint(midR, pt(-0.01, 0), 10);
      const waiting = await packedOrder('NORTH', 60);
      const carried = await packedOrder('NEAR', 60);
      const r = await request(app)
        .post(`/api/v1/admin/orders/${carried.id}/assign-rider`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ rider_id: midR.riderId });
      expect(r.status).toBe(200);

      for (const token of [tokens.admin, tokens.ops]) {
        const res = await live(token);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const d = res.body.data;
        expect(d.store).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number), radius_km: expect.any(Number) });
        expect(d.rules).toEqual({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
        expect(d.auto_assign).toEqual({ enabled: true, wait_seconds: 90, max_distance_km: 5 });
        const mine = (id: string) => d.riders.find((x: { id: string }) => x.id === id);
        const near = mine(nearR.riderId);
        expect(near).toMatchObject({ full_name: nearR.name, status: 'FREE', open_deliveries: 0, capacity_left: 2, deliveries: [] });
        expect(near.position).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number), accuracy_m: 10 });
        expect(near.position.age_seconds).toBeGreaterThanOrEqual(0);
        expect(typeof near.position.captured_at).toBe('string');
        const mid = mine(midR.riderId);
        expect(mid).toMatchObject({ status: 'ON_TRIP', open_deliveries: 1, capacity_left: 1 });
        expect(mid.deliveries).toEqual([
          { order_id: carried.id, order_number: carried.order_number, assignment_status: 'ASSIGNED', dropoff: { lat: expect.any(Number), lng: expect.any(Number) } },
        ]);
        // A rider who never reported a point has none.
        expect(mine(farR.riderId).position).not.toBeUndefined();
        const w = d.unassigned_orders.find((o: { order_id: string }) => o.order_id === waiting.id);
        expect(w).toMatchObject({ order_number: waiting.order_number, order_status: 'PACKED', dropoff: { lat: expect.any(Number), lng: expect.any(Number) } });
        expect(w.waiting_seconds).toBeGreaterThanOrEqual(0);
        // The assigned order is not "unassigned".
        expect(d.unassigned_orders.some((o: { order_id: string }) => o.order_id === carried.id)).toBe(false);
        // Never more than staff already see: no rider/customer secrets in the payload.
        expect(JSON.stringify(d)).not.toMatch(/delivery_code|password|refresh|total_amount|recipient/i);
      }
    });

    it('is closed to customers, riders, packing staff and signed-out callers', async () => {
      const riderToken = generateAccessToken({ id: nearR.userId, phone: nearR.phone, role: 'RIDER' });
      for (const t of [tokens.customer, tokens.staff, riderToken]) expect((await live(t)).status).toBe(403);
      expect((await live()).status).toBe(401);
    });
  });
});
