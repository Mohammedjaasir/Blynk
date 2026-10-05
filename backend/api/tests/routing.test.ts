import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { fetchRoute, orderStopsByRoad } from '../src/modules/routing/index.js';

const A = { lat: 6.4055, lng: 80.0524 };
const B = { lat: 6.4382, lng: 80.0118 };

function osrmReply(status: number, body: unknown) {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('routing: fetchRoute (OSRM adapter)', () => {
  it('asks OSRM for the car route lng,lat;lng,lat and returns distance, time and the line', async () => {
    let asked = '';
    const fake = (async (url: string) => {
      asked = url;
      return new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [{ distance: 5234.6, duration: 612.4, geometry: { coordinates: [[80.0524, 6.4055], [80.0118, 6.4382]] } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const r = await fetchRoute(A, B, 'http://osrm:5000/', fake);
    expect(asked).toBe(
      'http://osrm:5000/route/v1/driving/80.0524,6.4055;80.0118,6.4382?overview=full&geometries=geojson',
    );
    expect(r).toEqual({
      distance_m: 5235,
      duration_s: 612,
      coordinates: [[80.0524, 6.4055], [80.0118, 6.4382]],
    });
  });

  it('is 503 ROUTING_UNAVAILABLE when no OSRM is configured', async () => {
    await expect(fetchRoute(A, B, '')).rejects.toMatchObject({ statusCode: 503, code: 'ROUTING_UNAVAILABLE' });
  });

  it('is 503 ROUTING_UNAVAILABLE when OSRM cannot be reached', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(fetchRoute(A, B, 'http://osrm:5000', down)).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
  });

  it('is 404 ROUTE_NOT_FOUND when OSRM finds no road route', async () => {
    await expect(fetchRoute(A, B, 'http://osrm:5000', osrmReply(400, { code: 'NoRoute' }))).rejects.toMatchObject({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });
});

describe('routing: GET /api/v1/routing/route', () => {
  const app = createApp();

  it('requires a signed-in user', async () => {
    const res = await request(app).get('/api/v1/routing/route?from=6.4055,80.0524&to=6.4382,80.0118');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /routing/stop-order: road order for a rider's trip stops.
// ---------------------------------------------------------------------------

const FROM = { lat: 6.4382, lng: 80.0274 };
// Straight line: S1 is nearest, then S2, then S3 (all due east).
const S1 = { id: 's1', lat: 6.4382, lng: 80.031 };
const S2 = { id: 's2', lat: 6.4382, lng: 80.04 };
const S3 = { id: 's3', lat: 6.4382, lng: 80.05 };

/**
 * A table reply for points [FROM, S1, S2, S3]. The roads make S1 a long way
 * round (a river), so the road-best order is S3 -> S2 -> S1 although S1 is
 * nearest in a straight line.
 */
const TABLE = {
  code: 'Ok',
  durations: [
    [0, 900, 300, 200],
    [900, 0, 250, 400],
    [300, 250, 0, 120],
    [200, 400, 120, 0],
  ],
  distances: [
    [0, 9000, 3000, 2000],
    [9000, 0, 2500, 4000],
    [3000, 2500, 0, 1200],
    [2000, 4000, 1200, 0],
  ],
};

function tokenFor(role: string) {
  return jwt.sign({ sub: `u-${role.toLowerCase()}`, phone: '+94770000000', role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '5m',
  });
}

describe('routing: orderStopsByRoad (OSRM table adapter)', () => {
  it('asks OSRM table for every pair and picks the least total driving time, with each leg from the previous point', async () => {
    let asked = '';
    const fake = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(TABLE), { status: 200 });
    }) as unknown as typeof fetch;

    const r = await orderStopsByRoad(FROM, [S1, S2, S3], 'http://osrm:5000/', fake);
    expect(asked).toBe(
      'http://osrm:5000/table/v1/driving/80.0274,6.4382;80.031,6.4382;80.04,6.4382;80.05,6.4382?annotations=duration,distance',
    );
    expect(r.fallback).toBe(false);
    // FROM->S3 200 + S3->S2 120 + S2->S1 250 = 570 s, the minimum of all 6 orders.
    expect(r.stops).toEqual([
      { ...S3, duration_s: 200, distance_m: 2000 },
      { ...S2, duration_s: 120, distance_m: 1200 },
      { ...S1, duration_s: 250, distance_m: 2500 },
    ]);
  });

  it('beats nearest-next greedy when greedy would be worse in total', async () => {
    // Greedy from FROM takes S1 (60 s) then S2 (600 s) = 660; S2 then S1 = 100 + 100 = 200.
    const table = {
      code: 'Ok',
      durations: [
        [0, 60, 100],
        [60, 0, 600],
        [100, 100, 0],
      ],
      distances: [
        [0, 500, 900],
        [500, 0, 5000],
        [900, 900, 0],
      ],
    };
    const r = await orderStopsByRoad(FROM, [S1, S2], 'http://osrm:5000', osrmReply(200, table));
    expect(r.stops.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('falls back to the straight-line order (fallback: true, no durations) when OSRM errors', async () => {
    const r = await orderStopsByRoad(FROM, [S3, S1, S2], 'http://osrm:5000', osrmReply(400, { code: 'InvalidQuery' }));
    expect(r.fallback).toBe(true);
    expect(r.stops.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(r.stops.every((s) => s.duration_s === null)).toBe(true);
    // Straight-line legs in metres: FROM->S1 is about 400 m.
    expect(r.stops[0].distance_m).toBeGreaterThan(350);
    expect(r.stops[0].distance_m).toBeLessThan(450);
  });

  it('falls back when a pair has no road (null cell), when OSRM is unreachable, and when OSRM is not configured', async () => {
    const withNull = { ...TABLE, durations: TABLE.durations.map((row, i) => (i === 1 ? [null, 0, 1, 1] : row)) };
    expect((await orderStopsByRoad(FROM, [S1, S2, S3], 'http://osrm:5000', osrmReply(200, withNull))).fallback).toBe(true);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect((await orderStopsByRoad(FROM, [S1], 'http://osrm:5000', down)).fallback).toBe(true);
    expect((await orderStopsByRoad(FROM, [S1], '')).fallback).toBe(true);
  });

  it('falls back when OSRM is slower than the timeout', async () => {
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const r = await orderStopsByRoad(FROM, [S2, S1], 'http://osrm:5000', slow, 50);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.fallback).toBe(true);
    expect(r.stops.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('routing: POST /api/v1/routing/stop-order', () => {
  const app = createApp();
  const savedUrl = env.OSRM_URL;

  afterEach(() => {
    env.OSRM_URL = savedUrl;
    vi.unstubAllGlobals();
  });

  const body = { from: FROM, stops: [S1, S2, S3] };

  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/v1/routing/stop-order').send(body);
    expect(res.status).toBe(401);
  });

  it('is for riders, admins and operations staff only', async () => {
    for (const role of ['CUSTOMER', 'PACKING_STAFF']) {
      const res = await request(app)
        .post('/api/v1/routing/stop-order')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send(body);
      expect(res.status).toBe(403);
    }
  });

  it('returns the road order in the usual envelope', async () => {
    env.OSRM_URL = 'http://osrm.test:5000';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(TABLE), { status: 200 })));
    for (const role of ['RIDER', 'ADMIN', 'OPERATIONS']) {
      const res = await request(app)
        .post('/api/v1/routing/stop-order')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fallback).toBe(false);
      expect(res.body.data.stops.map((s: { id: string }) => s.id)).toEqual(['s3', 's2', 's1']);
      expect(res.body.data.stops[0]).toEqual({ ...S3, duration_s: 200, distance_m: 2000 });
    }
  });

  it('answers 200 with the straight-line order and fallback: true when OSRM fails', async () => {
    env.OSRM_URL = 'http://osrm.test:5000';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await request(app)
      .post('/api/v1/routing/stop-order')
      .set('Authorization', `Bearer ${tokenFor('RIDER')}`)
      .send({ from: FROM, stops: [S3, S1, S2] });
    expect(res.status).toBe(200);
    expect(res.body.data.fallback).toBe(true);
    expect(res.body.data.stops.map((s: { id: string }) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(res.body.data.stops[0].duration_s).toBeNull();
  });

  it('rejects bad bodies with 400: more than 5 stops, no stops, bad coordinates, repeated ids', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, lat: 6.43, lng: 80.03 + i / 1000 }));
    const bad = [
      { from: FROM, stops: six },
      { from: FROM, stops: [] },
      { from: { lat: 91, lng: 80 }, stops: [S1] },
      { from: FROM, stops: [{ id: 's1', lat: '6.4', lng: 80 }] },
      { from: FROM, stops: [S1, { ...S2, id: 's1' }] },
      { stops: [S1] },
    ];
    for (const b of bad) {
      const res = await request(app)
        .post('/api/v1/routing/stop-order')
        .set('Authorization', `Bearer ${tokenFor('RIDER')}`)
        .send(b);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
