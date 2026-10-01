import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import { subscribe, broadcastLocation, subscriberCount, closeAllStreams, type LocationEvent } from '../src/modules/realtime/location-stream.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { orderRepository } from '../src/modules/orders/order.repository.js';
import { streamOrderLocation } from '../src/modules/orders/order.location.controller.js';
import { metrics } from '../src/utils/metrics.js';
import { liftRiderTripCap } from './helpers/rider-trips.js';

// Many orders go to one seeded rider here; the trip cap has its own tests (rider-trips.test.ts).
liftRiderTripCap();

function fakeRes() {
  return { write: vi.fn(), end: vi.fn() } as unknown as import('express').Response;
}

const EVENT: LocationEvent = { latitude: 6.4, longitude: 80.0, accuracy: 10, captured_at: '2026-09-19T10:00:00.000Z', received_at: '2026-09-19T10:00:01.000Z' };

describe('location-stream broadcaster', () => {
  it('delivers a broadcast to every subscriber of that order, and no other order', () => {
    const a = fakeRes();
    const b = fakeRes();
    const unsubA = subscribe('order-1', a);
    subscribe('order-2', b);
    broadcastLocation('order-1', EVENT);
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('"latitude":6.4'));
    expect(b.write).not.toHaveBeenCalled();
    unsubA();
  });

  it('unsubscribing stops further broadcasts and cleans up empty order entries', () => {
    const a = fakeRes();
    const unsub = subscribe('order-3', a);
    expect(subscriberCount('order-3')).toBe(1);
    unsub();
    expect(subscriberCount('order-3')).toBe(0);
    broadcastLocation('order-3', EVENT);
    expect(a.write).not.toHaveBeenCalled();
  });

  it('broadcasting to an order with no subscribers is a harmless no-op', () => {
    expect(() => broadcastLocation('order-nobody', EVENT)).not.toThrow();
  });

  it('a second subscriber to the same order gets its own broadcasts, independent of the first', () => {
    const a = fakeRes();
    const b = fakeRes();
    subscribe('order-4', a);
    subscribe('order-4', b);
    broadcastLocation('order-4', EVENT);
    expect(a.write).toHaveBeenCalledTimes(1);
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('closeAllStreams ends every open connection and clears the registry', () => {
    const a = fakeRes();
    subscribe('order-5', a);
    closeAllStreams();
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('server_shutdown'));
    expect(a.end).toHaveBeenCalled();
    expect(subscriberCount('order-5')).toBe(0);
  });
});

describe('Customer location stream (HTTP)', () => {
  const app = createApp();
  let server: http.Server;
  let baseUrl: string;
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const customerB = { id: 'a0000005-0000-0000-0000-000000000005', phone: '+94771119999', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = { customer: generateAccessToken(customer), customerB: generateAccessToken(customerB), admin: generateAccessToken(admin), staff: generateAccessToken(staff), riderA: generateAccessToken(riderAUser) };
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const addr = server.address();
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const a = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Stream test','Stream Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
      [customer.id]
    );
    addressId = a.rows[0].id;
  });
  afterAll(async () => {
    server.close();
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  /** Places+sources+packs+assigns+picks up, returns the order id and delivery id, ready to send locations. */
  async function trackableOrder() {
    const request = (await import('supertest')).default;
    const placed = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`).send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${tokens.admin}`);
    for (const item of detail.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set('Authorization', `Bearer ${tokens.staff}`).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.staff}`).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: RIDER_A });
    const deliveryId = assign.body.data.delivery.id as string;
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    return { orderId, deliveryId };
  }

  /**
   * Opens the stream, reads text frames until `until` returns true or
   * `timeoutMs` elapses, then aborts. Default timeout is short (this route's
   * own checks - ownership, initial trackability - resolve immediately);
   * a test observing the 15s heartbeat re-check passes a longer timeoutMs.
   */
  function readStream(orderId: string, token: string, until: (raw: string) => boolean, timeoutMs = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      let raw = '';
      const req = http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (until(raw)) {
            req.destroy();
            resolve(raw);
          }
        });
        res.on('end', () => resolve(raw));
      });
      req.on('error', (err) => { if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err); else resolve(raw); });
      setTimeout(() => { req.destroy(); resolve(raw); }, timeoutMs);
    });
  }

  it('sends the current location immediately on connect, then a live broadcast', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${tokens.riderA}`).send({ latitude: 6.44, longitude: 80.03, accuracy: 8, captured_at: new Date().toISOString() });

    const raw = await readStream(orderId, tokens.customer, (raw) => raw.includes('event: location'));
    expect(raw).toContain('event: location');
    expect(raw).toContain('"latitude":6.44');
  });

  it('rejects an unauthenticated request (401)', async () => {
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/00000000-0000-0000-0000-000000000000/location/stream`, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(401);
  });

  it('rejects a non-CUSTOMER role (403)', async () => {
    const { orderId } = await trackableOrder();
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${tokens.staff}` } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(403);
  });

  it('a second customer cannot open the first customer\'s stream (404)', async () => {
    const { orderId } = await trackableOrder();
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${tokens.customerB}` } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(404);
  });

  it('closes the stream once the delivery arrives (no longer trackable)', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    const streamP = readStream(orderId, tokens.customer, (raw) => raw.includes('event: closed'), 17_000);
    await new Promise((r) => setTimeout(r, 200));
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
    const raw = await streamP;
    expect(raw).toContain('event: closed');
    expect(raw).toContain('delivery_closed');
  }, 20_000);

  it('an already-arrived order refuses a new stream connection outright', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
    const raw = await readStream(orderId, tokens.customer, (raw) => raw.includes('event: closed'));
    expect(raw).toContain('not_trackable');
  });
});

/**
 * Deterministic reproduction of the disconnect-vs-in-flight-heartbeat race
 * (review follow-up on Task B4): the client can disconnect while a
 * heartbeat's `findTrackableLocationForCustomer` re-check is still
 * in-flight. Without a second `closed` check after that `await`, the tick
 * would resume and write to (or end()) a response whose socket is already
 * gone. This exercises `streamOrderLocation` directly with fake timers and
 * a controllable, never-auto-resolving repository call instead of a real
 * HTTP server and a real 15s wait, so the race is triggered on demand
 * rather than by chance.
 */
describe('Customer location stream heartbeat race (unit)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not write to the response if the client disconnects while a heartbeat re-check is still in flight', async () => {
    vi.useFakeTimers();

    const orderId = 'c0000001-0000-0000-0000-000000000001';
    const customerId = 'c0000002-0000-0000-0000-000000000002';
    const trackableRow = {
      current_latitude: 6.4,
      current_longitude: 80.0,
      location_accuracy_m: 5,
      location_captured_at: new Date('2026-09-19T10:00:00.000Z'),
      location_received_at: new Date('2026-09-19T10:00:01.000Z'),
    };

    // Held open deliberately: this is the heartbeat's in-flight DB call.
    let resolveHeartbeatQuery!: (value: typeof trackableRow) => void;
    const heartbeatQuery = new Promise<typeof trackableRow>((resolve) => {
      resolveHeartbeatQuery = resolve;
    });

    let trackableCalls = 0;
    vi.spyOn(orderRepository, 'findOrderById').mockResolvedValue({ id: orderId, customer_id: customerId } as any);
    vi.spyOn(orderRepository, 'findTrackableLocationForCustomer').mockImplementation(async () => {
      trackableCalls += 1;
      // Call 1 is the on-connect check (resolves immediately). Call 2 is
      // the first heartbeat tick - held pending so the test can simulate a
      // disconnect while it is still awaiting the DB.
      return trackableCalls === 1 ? trackableRow : heartbeatQuery;
    });

    let closeHandler: (() => void) | undefined;
    const req = {
      params: { id: orderId },
      user: { id: customerId, phone: '+94770000000', role: 'CUSTOMER' as const },
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') closeHandler = cb;
      }),
    } as unknown as import('express').Request;
    const res = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as import('express').Response;
    const next = vi.fn();

    await streamOrderLocation(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledTimes(1);
    expect(typeof closeHandler).toBe('function');
    expect(res.write).toHaveBeenCalledTimes(1); // the initial on-connect snapshot only

    // Fire the first heartbeat tick. Its DB call is the held `heartbeatQuery`
    // promise, so the tick is now suspended mid-`await`, exactly like a
    // real in-flight query at the moment a client disconnects.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(trackableCalls).toBe(2);

    // The client disconnects while that query is still in flight.
    closeHandler!();

    // The DB call finally resolves - still trackable - after the disconnect
    // was already processed.
    resolveHeartbeatQuery(trackableRow);
    await Promise.resolve();
    await Promise.resolve();

    // Pre-fix, this resumed tick would fall through the (unguarded)
    // trackable branch straight into `res.write(': heartbeat\n\n')` on an
    // already-torn-down response. Post-fix, the re-check right after the
    // `await` returns before touching `res` at all, so the write count
    // must still be exactly the one from the initial on-connect snapshot.
    expect(res.write).toHaveBeenCalledTimes(1);
    expect((res.write as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('event: location');
    expect(res.end).not.toHaveBeenCalled();
  });
});

/**
 * Final-review finding m2: the SSE headers used to be written before the first
 * trackable query, so a database failure there reached errorMiddleware with
 * the stream already open (ERR_HTTP_HEADERS_SENT from res.json, a misleading
 * 500 log line, a client left on a half-open stream). The query now runs
 * first: a failure is an ordinary JSON 500 and nothing was opened or left
 * subscribed.
 */
describe('Customer location stream - database failure on connect (unit)', () => {
  const orderId = 'c0000001-0000-0000-0000-0000000000f1';
  const customerId = 'c0000002-0000-0000-0000-0000000000f2';
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeReqRes() {
    const req = {
      params: { id: orderId },
      user: { id: customerId, phone: '+94770000000', role: 'CUSTOMER' as const },
      on: vi.fn(),
    } as unknown as import('express').Request;
    const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), headersSent: false } as unknown as import('express').Response;
    return { req, res };
  }

  it('hands the failure to the error middleware once, writes nothing to the response, and leaks no subscriber or metric', async () => {
    const boom = new Error('connection terminated');
    vi.spyOn(orderRepository, 'findOrderById').mockResolvedValue({ id: orderId, customer_id: customerId } as any);
    vi.spyOn(orderRepository, 'findTrackableLocationForCustomer').mockRejectedValue(boom);
    const before = metrics.snapshot().locationStreams;
    const { req, res } = fakeReqRes();
    const next = vi.fn();

    await expect(streamOrderLocation(req, res, next)).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled(); // the error middleware ends it, exactly once
    expect(subscriberCount(orderId)).toBe(0);
    expect(metrics.snapshot().locationStreams).toEqual(before);
  });

  it('through the real error middleware: a clean JSON 500, no ERR_HTTP_HEADERS_SENT', async () => {
    vi.spyOn(orderRepository, 'findOrderById').mockResolvedValue({ id: orderId, customer_id: customerId } as any);
    vi.spyOn(orderRepository, 'findTrackableLocationForCustomer').mockRejectedValue(new Error('connection terminated'));
    const { default: express } = await import('express');
    const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
    const { logger } = await import('../src/utils/logger.js');
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);

    const app = express();
    app.get('/orders/:id/location/stream', (req, res, next) => {
      (req as any).user = { id: customerId, phone: '+94770000000', role: 'CUSTOMER' };
      return streamOrderLocation(req, res, next);
    });
    app.use(errorMiddleware);
    const request = (await import('supertest')).default;
    const res = await request(app).get(`/orders/${orderId}/location/stream`);
    await new Promise((r) => setTimeout(r, 50));
    process.off('uncaughtException', onUncaught);

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(uncaught).toEqual([]);
    // exactly the one, honest 500 log - not a second error about headers already sent
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('ERR_HTTP_HEADERS_SENT');
    expect(subscriberCount(orderId)).toBe(0);
  });

  it('a client that disconnects while the connect query is in flight is never subscribed', async () => {
    let release!: (v: undefined) => void;
    vi.spyOn(orderRepository, 'findOrderById').mockResolvedValue({ id: orderId, customer_id: customerId } as any);
    vi.spyOn(orderRepository, 'findTrackableLocationForCustomer').mockImplementation(
      () => new Promise((r) => { release = r as (v: undefined) => void; }) as any
    );
    let closeHandler: (() => void) | undefined;
    const { req, res } = fakeReqRes();
    (req.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, cb: () => void) => {
      if (event === 'close') closeHandler = cb;
    });
    const next = vi.fn();

    const done = streamOrderLocation(req, res, next);
    await new Promise((r) => setImmediate(r));
    closeHandler!(); // the client leaves mid-query
    release(undefined);
    await done;

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(subscriberCount(orderId)).toBe(0);
  });
});
