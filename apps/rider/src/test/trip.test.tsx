import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { formatAway, formatByRoad, isTripStop, orderTrip, useRoadOrder } from '../lib/trip';
import { RIDER, fail, mockApi, ok, renderAs, summary } from './helpers';

// The real plugin needs a native bridge that jsdom lacks (as in queue.test.tsx).
vi.mock('../lib/tracking-plugin', () => ({
  capacitorTrackingPlugin: {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetTrackerSessionForTests();
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

// Two drop-offs east of the rider: NEAR about 0.4 km, FAR about 2 km.
const RIDER_AT = { lat: 6.4382, lng: 80.0274 };
const near = summary({
  delivery_id: 'd-near',
  order_number: 'BLK-1-0002',
  delivery_address_line1: '2 Near Road',
  delivery_latitude: 6.4382,
  delivery_longitude: 80.031,
  assigned_at: '2026-09-30T09:05:00.000Z',
});
const far = summary({
  delivery_id: 'd-far',
  order_number: 'BLK-1-0001',
  delivery_address_line1: '1 Far Road',
  delivery_latitude: '6.4382',
  delivery_longitude: '80.0455',
  assigned_at: '2026-09-30T09:00:00.000Z',
  total_amount: 805,
});
type S = typeof near;
const onRoad = (d: S): S => ({ ...d, assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
const atDoor = (d: S): S => ({ ...d, assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' });

describe('trip order (lib/trip)', () => {
  it('on the road: nearest first from the rider; without a position, the API order', () => {
    expect(orderTrip([onRoad(far), onRoad(near)], RIDER_AT).map((s) => s.delivery.delivery_id)).toEqual(['d-near', 'd-far']);
    expect(orderTrip([onRoad(far), onRoad(near)], null).map((s) => s.delivery.delivery_id)).toEqual(['d-far', 'd-near']);
  });

  it('whatever is at the door comes first, then the road, then the store', () => {
    const stops = orderTrip([summary({ delivery_id: 'd-store' }), onRoad(near), atDoor(far)], RIDER_AT);
    expect(stops.map((s) => s.delivery.delivery_id)).toEqual(['d-far', 'd-near', 'd-store']);
  });

  it('leaves out delivered, cancelled and still-packing orders, and says how far each stop is', () => {
    const list = [
      onRoad(near),
      summary({ delivery_id: 'd-done', assignment_status: 'DELIVERED', order_status: 'DELIVERED', payment_status: 'PAID' }),
      summary({ delivery_id: 'd-cancel', order_status: 'CANCELLED' }),
      summary({ delivery_id: 'd-pack', order_status: 'PLACED' }),
    ];
    expect(list.filter(isTripStop).map((d) => d.delivery_id)).toEqual(['d-near']);
    const [stop] = orderTrip(list, RIDER_AT);
    expect(stop.distanceM).toBeGreaterThan(350);
    expect(stop.distanceM).toBeLessThan(450);
    expect(formatAway(stop.distanceM!)).toBe('400 m away');
    expect(formatAway(2049)).toBe('2.0 km away');
  });
});

describe('Deliveries (home) with two orders: the trip view', () => {
  it('lists both stops in order, each with its own cash and its own delivery screen', async () => {
    renderAs(RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [far, near] }) });
    const trip = await screen.findByRole('region', { name: 'Your trip · 2 stops' });
    expect(screen.queryByRole('region', { name: 'Now' })).not.toBeInTheDocument();
    expect(within(trip).getByText('Pick up all 2 orders at the store before you leave.')).toBeInTheDocument();
    expect(within(trip).getByText('LKR 1,415 cash in all')).toBeInTheDocument();
    const stops = within(trip).getAllByRole('listitem');
    expect(stops).toHaveLength(2);
    // No GPS in the test browser: the API's order (oldest assignment first).
    expect(within(stops[0]).getByText('1 Far Road')).toBeInTheDocument();
    expect(within(stops[0]).getByText('LKR 805')).toBeInTheDocument();
    expect(within(stops[1]).getByText('2 Near Road')).toBeInTheDocument();
    expect(within(stops[1]).getByText('LKR 610')).toBeInTheDocument();
    expect(within(stops[0]).getByRole('link', { name: 'Open stop 1, delivery #0001' })).toHaveAttribute('href', '/deliveries/d-far');
    expect(within(stops[1]).getByRole('link', { name: 'Open stop 2, delivery #0002' })).toHaveAttribute('href', '/deliveries/d-near');
    // Nothing is listed twice.
    expect(screen.queryByRole('region', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('orders the stops nearest first when the phone knows where it is', async () => {
    const geolocation = {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: RIDER_AT.lat, longitude: RIDER_AT.lng } } as GeolocationPosition),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    try {
      renderAs(RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [onRoad(far), onRoad(near)] }) });
      const trip = await screen.findByRole('region', { name: 'Your trip · 2 stops' });
      expect(await within(trip).findByText('400 m away')).toBeInTheDocument();
      const stops = within(trip).getAllByRole('listitem');
      expect(within(stops[0]).getByText('2 Near Road')).toBeInTheDocument();
      expect(within(stops[1]).getByText('1 Far Road')).toBeInTheDocument();
    } finally {
      delete (navigator as { geolocation?: unknown }).geolocation;
    }
  });

  it('a single delivery keeps the ordinary "Now" slip', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () => ok({ deliveries: [near, summary({ delivery_id: 'd-pack', order_status: 'PLACED' })] }),
    });
    expect(await screen.findByRole('region', { name: 'Now' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Your trip/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Next' })).getByText('Being packed')).toBeInTheDocument();
  });
});

describe('road order for the stops on the road', () => {
  // The road says FAR first (NEAR is across a river), though NEAR is nearer in a straight line.
  const ROAD = {
    stops: [
      { id: 'd-far', lat: 6.4382, lng: 80.0455, duration_s: 250, distance_m: 2100 },
      { id: 'd-near', lat: 6.4382, lng: 80.031, duration_s: 61, distance_m: 1500 },
    ],
    fallback: false,
  };
  const withGps = () => {
    const geolocation = {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: RIDER_AT.lat, longitude: RIDER_AT.lng } } as GeolocationPosition),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
  };
  afterEach(() => {
    delete (navigator as { geolocation?: unknown }).geolocation;
  });

  it('orders only the on-road group by road, keeps door first and store last, and gives minutes by road', () => {
    const list = [summary({ delivery_id: 'd-store' }), onRoad(near), onRoad(far), atDoor({ ...near, delivery_id: 'd-door' })];
    const stops = orderTrip(list, RIDER_AT, ROAD);
    expect(stops.map((s) => s.delivery.delivery_id)).toEqual(['d-door', 'd-far', 'd-near', 'd-store']);
    expect(stops.map((s) => s.roadMin)).toEqual([null, 5, 2, null]);
    expect(formatByRoad(5)).toBe('about 5 min by road');
    // An answer for other stops (stale) is ignored: straight line, no road minutes.
    const stale = { stops: [ROAD.stops[0]] };
    const plain = orderTrip([onRoad(far), onRoad(near)], RIDER_AT, stale);
    expect(plain.map((s) => s.delivery.delivery_id)).toEqual(['d-near', 'd-far']);
    expect(plain.every((s) => s.roadMin === null)).toBe(true);
  });

  it('asks the API for the road order from the phone position and shows "about N min by road"', async () => {
    withGps();
    const { api } = renderAs(RIDER, '/', {
      'GET /riders/deliveries': () => ok({ deliveries: [onRoad(near), onRoad(far)] }),
      'POST /routing/stop-order': () => ok(ROAD),
    });
    const trip = await screen.findByRole('region', { name: 'Your trip · 2 stops' });
    expect(await within(trip).findByText('about 5 min by road')).toBeInTheDocument();
    const stops = within(trip).getAllByRole('listitem');
    expect(within(stops[0]).getByText('1 Far Road')).toBeInTheDocument();
    expect(within(stops[1]).getByText('2 Near Road')).toBeInTheDocument();
    expect(within(stops[1]).getByText('about 2 min by road')).toBeInTheDocument();
    const [call] = api.find('POST', '/routing/stop-order');
    expect(call.body).toEqual({
      from: RIDER_AT,
      stops: [
        { id: 'd-near', lat: 6.4382, lng: 80.031 },
        { id: 'd-far', lat: 6.4382, lng: 80.0455 },
      ],
    });
  });

  it.each([
    ['answers fallback: true', () => ok({ ...ROAD, stops: [...ROAD.stops].reverse(), fallback: true })],
    ['fails', () => fail(503, 'ROUTING_UNAVAILABLE')],
  ])('keeps the straight-line order and no road times when the API %s', async (_label, reply) => {
    withGps();
    const { api } = renderAs(RIDER, '/', {
      'GET /riders/deliveries': () => ok({ deliveries: [onRoad(far), onRoad(near)] }),
      'POST /routing/stop-order': reply,
    });
    const trip = await screen.findByRole('region', { name: 'Your trip · 2 stops' });
    expect(await within(trip).findByText('400 m away')).toBeInTheDocument();
    await waitFor(() => expect(api.find('POST', '/routing/stop-order')).toHaveLength(1));
    const stops = within(trip).getAllByRole('listitem');
    expect(within(stops[0]).getByText('2 Near Road')).toBeInTheDocument();
    expect(within(stops[1]).getByText('1 Far Road')).toBeInTheDocument();
    expect(within(trip).queryByText(/by road/)).not.toBeInTheDocument();
  });

  it('asks again only when the stops change or the rider moved more than 200 m', async () => {
    const api = mockApi({ 'POST /routing/stop-order': () => ok(ROAD) });
    tokenStore.save('test-access', 'test-refresh');
    const list = [onRoad(near), onRoad(far)];
    const { result, rerender } = renderHook(
      ({ l, at }: { l: typeof list; at: { lat: number; lng: number } }) => useRoadOrder(l, at, true),
      { initialProps: { l: list, at: RIDER_AT } }
    );
    await waitFor(() => expect(result.current?.stops.map((s) => s.id)).toEqual(['d-far', 'd-near']));
    expect(api.find('POST', '/routing/stop-order')).toHaveLength(1);

    // About 100 m on, and a new (equal) list from a reload: no new request.
    rerender({ l: [...list], at: { lat: RIDER_AT.lat, lng: RIDER_AT.lng + 0.0009 } });
    rerender({ l: [...list], at: { lat: RIDER_AT.lat, lng: RIDER_AT.lng + 0.0009 } });
    expect(api.find('POST', '/routing/stop-order')).toHaveLength(1);
    expect(result.current).not.toBeNull();

    // About 330 m from where it last asked: ask again.
    rerender({ l: list, at: { lat: RIDER_AT.lat, lng: RIDER_AT.lng + 0.003 } });
    await waitFor(() => expect(api.find('POST', '/routing/stop-order')).toHaveLength(2));

    // A third stop joins the road: the set changed, ask again.
    const three = [...list, onRoad({ ...far, delivery_id: 'd-3', delivery_longitude: '80.06' })];
    rerender({ l: three, at: { lat: RIDER_AT.lat, lng: RIDER_AT.lng + 0.003 } });
    await waitFor(() => expect(api.find('POST', '/routing/stop-order')).toHaveLength(3));
    expect(api.find('POST', '/routing/stop-order')[2].body.stops).toHaveLength(3);
    // This fake answers for two stops, not three: the trip does not use it.
    expect(orderTrip(three, RIDER_AT, result.current).every((s) => s.roadMin === null)).toBe(true);
  });
});

describe('My day', () => {
  const day = {
    timezone: 'Asia/Colombo',
    today: { date: '2026-09-30', completed: 2, failed: 1, customer_unavailable: 1, cash_collected: 1415 },
    week: { starts_on: '2026-09-28', completed: 9, failed: 2, customer_unavailable: 1, cash_collected: 6120.5 },
    deliveries_today: [
      { delivery_id: 'a', order_number: 'BLK-20260930-0044', outcome: 'DELIVERED', at: '2026-09-30T08:35:00.000Z', cash_collected: 805 },
      { delivery_id: 'b', order_number: 'BLK-20260930-0043', outcome: 'CUSTOMER_UNAVAILABLE', at: '2026-09-30T07:10:00.000Z', cash_collected: 0 },
      { delivery_id: 'c', order_number: 'BLK-20260930-0042', outcome: 'FAILED', at: '2026-09-30T06:00:00.000Z', cash_collected: 0 },
      { delivery_id: 'd', order_number: 'BLK-20260930-0041', outcome: 'DELIVERED', at: '2026-09-30T05:00:00.000Z', cash_collected: 610 },
    ],
  };
  const cell = (region: HTMLElement, label: string) => within(region).getByText(label).nextElementSibling;

  it("is one tap from home and shows today, this week and today's deliveries - counts and cash only", async () => {
    const user = userEvent.setup();
    const { api } = renderAs(RIDER, '/', { 'GET /riders/me/day': () => ok(day) });
    await user.click(await screen.findByRole('link', { name: 'My day' }));
    expect(await screen.findByRole('heading', { name: 'My day' })).toBeInTheDocument();

    const today = await screen.findByRole('region', { name: 'Today' });
    expect(api.find('GET', '/riders/me/day')).toHaveLength(1);
    expect(cell(today, 'Delivered')).toHaveTextContent('2');
    expect(cell(today, "Couldn't deliver")).toHaveTextContent('1');
    expect(cell(today, "Couldn't reach")).toHaveTextContent('1');
    expect(cell(today, 'Cash collected')).toHaveTextContent('LKR 1,415');
    const week = screen.getByRole('region', { name: /This week/ });
    expect(week).toHaveTextContent('Monday to Sunday');
    expect(cell(week, 'Delivered')).toHaveTextContent('9');
    expect(cell(week, 'Cash collected')).toHaveTextContent('LKR 6,120.50');

    const rows = within(screen.getByRole('region', { name: "Today's deliveries" })).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('#0044');
    expect(rows[0]).toHaveTextContent('14:05'); // Asia/Colombo
    expect(rows[0]).toHaveTextContent('LKR 805');
    expect(rows[1]).toHaveTextContent("Couldn't reach customer");
    expect(rows[2]).toHaveTextContent("Couldn't deliver");
    expect(document.body.textContent).not.toMatch(/earn|salary|commission|your pay/i);
  });

  it('an empty day says so, and a failed load offers a retry', async () => {
    let failing = true;
    renderAs(RIDER, '/day', {
      'GET /riders/me/day': () =>
        failing
          ? fail(500, 'INTERNAL')
          : ok({
              ...day,
              today: { ...day.today, completed: 0, failed: 0, customer_unavailable: 0, cash_collected: 0 },
              deliveries_today: [],
            }),
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    failing = false;
    await userEvent.setup().click(retry);
    expect(await screen.findByText('Nothing finished yet today.')).toBeInTheDocument();
  });
});
