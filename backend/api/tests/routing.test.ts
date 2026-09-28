import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { fetchRoute } from '../src/modules/routing/index.js';

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
