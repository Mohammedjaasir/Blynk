import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The maplibre-gl stand-in from test/setup.ts exposes what the map was asked.
// @ts-expect-error - mapInstances exists only on the test stand-in.
import { mapInstances } from 'maplibre-gl';
import { DeliveryMap } from '../components/DeliveryMap';
import { distanceM, formatRouteSummary, shouldReroute, toLatLng } from '../lib/route';
import { mockApi } from './helpers';

const CUSTOMER = { lat: 6.4382, lng: 80.0118 };
const RIDER_HERE = { lat: 6.4055, lng: 80.0524 };

describe('route helpers', () => {
  it('reads API coordinates, which can arrive as strings', () => {
    expect(toLatLng('6.4382', '80.0118')).toEqual(CUSTOMER);
    expect(toLatLng(6.4382, 80.0118)).toEqual(CUSTOMER);
  });

  it('refuses missing, junk, out-of-range and 0,0 placeholder coordinates', () => {
    for (const [a, b] of [
      [null, null],
      [undefined, 80],
      ['abc', '80'],
      [95, 80],
      [6, 190],
      [0, 0],
    ] as const) {
      expect(toLatLng(a, b)).toBeNull();
    }
  });

  it('re-routes on the first fix and after moving far enough, not on every small move', () => {
    expect(shouldReroute(null, RIDER_HERE)).toBe(true);
    expect(shouldReroute(RIDER_HERE, { lat: 6.4056, lng: 80.0524 })).toBe(false); // ~11 m
    expect(shouldReroute(RIDER_HERE, { lat: 6.4065, lng: 80.0524 })).toBe(true); // ~111 m
  });

  it('measures distance sensibly', () => {
    expect(distanceM(RIDER_HERE, CUSTOMER)).toBeGreaterThan(5000);
    expect(distanceM(RIDER_HERE, CUSTOMER)).toBeLessThan(6000);
  });

  it('summarises a route for a glance on the road', () => {
    expect(formatRouteSummary({ distance_m: 11339, duration_s: 1044 })).toBe('11.3 km · 17 min');
    expect(formatRouteSummary({ distance_m: 650, duration_s: 20 })).toBe('650 m · 1 min');
  });
});

describe('DeliveryMap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mapInstances.length = 0;
  });

  it("opens on the customer's pin, then draws the road route from the rider's GPS position", async () => {
    let watcher: ((p: GeolocationPosition) => void) | null = null;
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        watchPosition: (ok: (p: GeolocationPosition) => void) => {
          watcher = ok;
          return 1;
        },
        clearWatch: vi.fn(),
      },
    });
    const api = mockApi({
      'GET /routing/route': () => ({
        route: {
          distance_m: 11339,
          duration_s: 1044,
          coordinates: [
            [80.0524, 6.4055],
            [80.0118, 6.4382],
          ],
        },
      }),
    });

    render(<DeliveryMap destination={CUSTOMER} />);
    const map = mapInstances[0];
    expect(map.options.center).toEqual([CUSTOMER.lng, CUSTOMER.lat]);
    expect(screen.getByRole('status')).toHaveTextContent('Finding your location');
    act(() => map.handlers.load()); // the style has loaded: the route layer exists

    await act(async () => {
      watcher!({ coords: { latitude: RIDER_HERE.lat, longitude: RIDER_HERE.lng } } as GeolocationPosition);
    });

    expect(api.find('GET', '/routing/route')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('11.3 km · 17 min');
    expect(map.sources.route.data).toMatchObject({
      geometry: { type: 'LineString', coordinates: [[80.0524, 6.4055], [80.0118, 6.4382]] },
    });
    expect(map.fitted).not.toBeNull(); // both the rider and the customer in view
  });

  it('keeps the pin and says so when no route can be drawn', async () => {
    let watcher: ((p: GeolocationPosition) => void) | null = null;
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { watchPosition: (ok: (p: GeolocationPosition) => void) => ((watcher = ok), 1), clearWatch: vi.fn() },
    });
    mockApi({
      'GET /routing/route': () => ({ status: 503, error: { code: 'ROUTING_UNAVAILABLE', message: 'down' } }),
    });

    render(<DeliveryMap destination={CUSTOMER} />);
    act(() => mapInstances[0].handlers.load());
    await act(async () => {
      watcher!({ coords: { latitude: RIDER_HERE.lat, longitude: RIDER_HERE.lng } } as GeolocationPosition);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Route unavailable');
  });
});
