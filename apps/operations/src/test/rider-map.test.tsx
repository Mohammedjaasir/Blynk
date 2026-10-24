import { act, cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The maplibre-gl stand-in from test/setup.ts exposes what the map was asked.
// @ts-expect-error - mapInstances exists only on the test stand-in.
import { mapInstances } from 'maplibre-gl';
import { tokenStore } from '../api/client';
import type { LiveRider, LiveRiderMap } from '../api/types';
import { parseDistanceKm, parseWaitSeconds } from '../lib/riderAutoAssign';
import {
  STALE_AFTER_SECONDS,
  ageText,
  initials,
  ordersForRider,
  ridersForOrder,
  riderTone,
  summaryText,
  waitText,
} from '../lib/riderMap';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Owner, 2026-10-25: the Rider map (More -> Rider map, a button on the Delivery tab) and the
 * automatic assignment settings card. The map itself is the maplibre stand-in from setup.ts; the
 * markers are real DOM elements the test clicks.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mapInstances.length = 0;
});

const STORE = { lat: 6.4382, lng: 80.0274, radius_km: 4 };

function rider(over: Partial<LiveRider> & { id: string }): LiveRider {
  return {
    full_name: `Rider ${over.id}`,
    phone: '+94770000001',
    vehicle_type: 'MOTORCYCLE',
    status: 'FREE',
    open_deliveries: 0,
    capacity_left: 2,
    position: { lat: 6.44, lng: 80.03, accuracy_m: 12, captured_at: '2026-10-25T05:00:00Z', age_seconds: 20 },
    deliveries: [],
    ...over,
  };
}

function live(over: Partial<LiveRiderMap> = {}): LiveRiderMap {
  return {
    server_time: '2026-10-25T05:00:20Z',
    store: STORE,
    rules: { max_active_deliveries: 2, max_dropoff_distance_km: 1.5 },
    auto_assign: { enabled: false, wait_seconds: 90, max_distance_km: 5 },
    riders: [
      rider({ id: 'A', full_name: 'Farhan Mohamed' }),
      rider({
        id: 'B',
        full_name: 'Nimal Perera',
        status: 'ON_TRIP',
        open_deliveries: 1,
        capacity_left: 1,
        position: { lat: 6.43, lng: 80.02, accuracy_m: null, captured_at: '2026-10-25T04:50:00Z', age_seconds: 400 },
        deliveries: [{ order_id: 'o-carried', order_number: 'BL-20261025-0007', assignment_status: 'PICKED_UP', dropoff: { lat: 6.431, lng: 80.021 } }],
      }),
      rider({ id: 'C', full_name: 'Ruwan', position: null }),
    ],
    unassigned_orders: [
      {
        order_id: 'o-wait',
        order_number: 'BL-20261025-0042',
        order_status: 'PACKED',
        waiting_seconds: 130,
        address: 'No. 4, Temple Road, Dharga Town',
        dropoff: { lat: 6.442, lng: 80.031 },
      },
    ],
    ...over,
  };
}

const markerEls = () => (mapInstances[0]?.markers ?? []).map((m: { options: { element: HTMLElement } }) => m.options.element) as HTMLElement[];
const dotFor = (name: string) => markerEls().find((el) => el.getAttribute('aria-label')?.startsWith(name))!;

describe('rider map helpers', () => {
  it('colours a dot free, on a trip, or grey once the point is older than 3 minutes', () => {
    const pos = (age: number) => ({ lat: 1, lng: 1, accuracy_m: null, captured_at: '', age_seconds: age });
    expect(riderTone({ status: 'FREE', position: pos(5) })).toBe('free');
    expect(riderTone({ status: 'ON_TRIP', position: pos(5) })).toBe('trip');
    expect(riderTone({ status: 'ON_TRIP', position: pos(STALE_AFTER_SECONDS) })).toBe('trip');
    expect(riderTone({ status: 'ON_TRIP', position: pos(STALE_AFTER_SECONDS + 1) })).toBe('stale');
    expect(riderTone({ status: 'FREE', position: null })).toBe('stale');
  });

  it('takes initials, phrases ages and waits', () => {
    expect(initials('Farhan Mohamed')).toBe('FM');
    expect(initials('  ruwan ')).toBe('R');
    expect(initials('Anna Maria Silva')).toBe('AS');
    expect(initials(null)).toBe('?');
    expect(ageText(3)).toBe('just now');
    expect(ageText(40)).toBe('40 s ago');
    expect(ageText(190)).toBe('3 min ago');
    expect(ageText(3900)).toBe('1 h 5 min ago');
    expect(waitText(45)).toBe('45 s');
    expect(waitText(130)).toBe('2 min');
  });

  it('lists riders who can take an order first, nearest first; and orders nearest the rider first', () => {
    const d = live();
    const full = rider({ id: 'F', full_name: 'Full', capacity_left: 0, status: 'ON_TRIP', open_deliveries: 2 });
    const options = ridersForOrder(d.unassigned_orders[0], [full, ...d.riders]);
    expect(options.map((o) => o.rider.id)).toEqual(['A', 'B', 'C', 'F']);
    expect(options[0].km).not.toBeNull();
    expect(options[2].km).toBeNull(); // no position
    const far = { ...d.unassigned_orders[0], order_id: 'far', dropoff: { lat: 6.5, lng: 80.1 } };
    expect(ordersForRider(d.riders[0], [far, d.unassigned_orders[0]]).map((x) => x.order.order_id)).toEqual(['o-wait', 'far']);
  });

  it('summarises the day in a line', () => {
    expect(summaryText(live())).toBe('2 riders free, 1 on a trip, 1 order waiting');
  });

  it('validates the automatic assignment numbers like the API', () => {
    expect(parseWaitSeconds('90')).toEqual({ value: 90 });
    expect(parseWaitSeconds('45 s')).toEqual({ value: 45 });
    expect(parseWaitSeconds('29')).toHaveProperty('error');
    expect(parseWaitSeconds('901')).toHaveProperty('error');
    expect(parseWaitSeconds('1.5')).toHaveProperty('error');
    expect(parseDistanceKm('5')).toEqual({ value: 5 });
    expect(parseDistanceKm('0.5 km')).toEqual({ value: 0.5 });
    expect(parseDistanceKm('0.4')).toHaveProperty('error');
    expect(parseDistanceKm('26')).toHaveProperty('error');
    expect(parseDistanceKm('2.55')).toHaveProperty('error');
  });
});

describe('Rider map page', () => {
  it('opens on the store, draws the delivery circle, and shows riders and orders as markers', async () => {
    renderAs(OPERATIONS_STAFF, '/more/rider-map', { 'GET /admin/riders/live': () => ok(live()) });
    await screen.findByTestId('rider-map');
    const map = mapInstances[0];
    expect(map.options.center).toEqual([STORE.lng, STORE.lat]);
    expect(map.fitted).not.toBeNull();
    act(() => map.handlers.load());
    expect(map.sources['delivery-circle']).toBeDefined();

    // Rider dots carry initials; the rider with no position has none; every drop point is a pin.
    const labels = markerEls().map((el) => el.getAttribute('aria-label'));
    expect(labels).toContain('Farhan Mohamed, free');
    expect(labels).toContain('Nimal Perera, not seen lately');
    expect(labels.some((l) => l?.startsWith('Ruwan'))).toBe(false);
    expect(dotFor('Farhan').textContent).toBe('FM');
    expect(dotFor('Farhan').className).toContain('rmap-dot--free');
    expect(dotFor('Nimal').className).toContain('rmap-dot--stale');
    const waiting = markerEls().find((el) => el.getAttribute('aria-label') === 'Order BL-20261025-0042, waiting for a rider')!;
    expect(waiting.className).toContain('rmap-pin--waiting');
    expect(waiting.textContent).toBe('0042');
    expect(markerEls().some((el) => el.getAttribute('aria-label') === 'Order BL-20261025-0007, with Nimal Perera')).toBe(true);

    expect(screen.getByText(/2 riders free, 1 on a trip, 1 order waiting/)).toBeInTheDocument();
    expect(screen.getByText('Riders without a dot have not sent a position yet.')).toBeInTheDocument();
    expect(screen.getByText(/Automatic assignment is off/)).toBeInTheDocument();
  });

  it('opens a sheet for a rider and assigns a waiting order with "Assign here" through the manual API', async () => {
    let assigned = false;
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-map', {
      'GET /admin/riders/live': () => ok(assigned ? live({ unassigned_orders: [] }) : live()),
      'POST /admin/orders/:id/assign-rider': () => {
        assigned = true;
        return ok({ delivery: { id: 'd1' } });
      },
    });
    await screen.findByTestId('rider-map');
    fireEvent.click(dotFor('Farhan'));
    const sheet = await screen.findByRole('dialog', { name: 'Rider Farhan Mohamed' });
    expect(within(sheet).getByText(/2 more orders can be added/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign order 0042 to Farhan Mohamed' }));
    await waitFor(() => expect(api.find('POST', '/admin/orders/o-wait/assign-rider')).toHaveLength(1));
    expect(api.find('POST', '/admin/orders/o-wait/assign-rider')[0].body).toEqual({ rider_id: 'A' });
    expect(await screen.findByText('Order 0042 assigned to Farhan Mohamed.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The map refreshed: the waiting pin is gone.
    await waitFor(() => expect(markerEls().some((el) => el.className.includes('rmap-pin--waiting'))).toBe(false));
  });

  it('opens a sheet for a waiting order, lists riders nearest first and assigns one; a far trip asks to confirm', async () => {
    let calls = 0;
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-map', {
      'GET /admin/riders/live': () => ok(live()),
      'POST /admin/orders/:id/assign-rider': (call) => {
        calls += 1;
        if (!call.body.confirm_far_batch) return fail(409, 'BATCH_DROPOFFS_TOO_FAR', 'This drop-off is 2.2 km from order #7.');
        return ok({ delivery: { id: 'd2' } });
      },
    });
    await screen.findByTestId('rider-map');
    fireEvent.click(markerEls().find((el) => el.className.includes('rmap-pin--waiting'))!);
    const sheet = await screen.findByRole('dialog', { name: 'Order 0042' });
    expect(within(sheet).getByText(/Waiting 2 min for a rider/)).toBeInTheDocument();
    const buttons = within(sheet).getAllByRole('button', { name: /^Assign order 0042 to/ });
    expect(buttons[0]).toHaveAccessibleName('Assign order 0042 to Farhan Mohamed');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign order 0042 to Nimal Perera' }));
    expect(await within(sheet).findByText(/2.2 km from order #7/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add to the trip anyway' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(api.find('POST', '/admin/orders/o-wait/assign-rider')[1].body).toEqual({ rider_id: 'B', confirm_far_batch: true });
  });

  it('refreshes every 15 seconds and pauses while the app is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-map', { 'GET /admin/riders/live': () => ok(live()) });
    await screen.findByTestId('rider-map');
    const loads = () => api.find('GET', '/admin/riders/live').length;
    expect(loads()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(loads()).toBe(2);
    hidden = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(loads()).toBe(2);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(loads()).toBe(3);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('keeps what it has and says so when a refresh fails', async () => {
    let n = 0;
    renderAs(OPERATIONS_STAFF, '/more/rider-map', {
      'GET /admin/riders/live': () => (++n === 1 ? ok(live()) : fail(500, 'INTERNAL', 'boom')),
    });
    await screen.findByTestId('rider-map');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blynk API had a problem');
    expect(screen.getByTestId('rider-map')).toBeInTheDocument();
  });

  it('is reachable from More and from the Delivery tab', async () => {
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/rider-auto-assign': () => ok({ enabled: false, wait_seconds: 90, max_distance_km: 5, updated_at: null }),
    });
    const link = await screen.findByRole('link', { name: 'Rider map' });
    expect(link).toHaveAttribute('href', '/more/rider-map');
    cleanup();
    tokenStore.clear();
    renderAs(OPERATIONS_STAFF, '/delivery');
    expect((await screen.findByRole('link', { name: 'Rider map' })).getAttribute('href')).toBe('/more/rider-map');
  });
});

describe('Automatic rider assignment card (More)', () => {
  it('shows the setting, switches it on at once, and saves the two numbers', async () => {
    let state = { enabled: false, wait_seconds: 90, max_distance_km: 5, updated_at: null as string | null };
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/rider-auto-assign': () => ok(state),
      'PUT /admin/settings/rider-auto-assign': (call) => {
        state = { ...state, ...call.body, updated_at: '2026-10-25T05:00:00Z' };
        return ok(state);
      },
    });
    const card = (await screen.findByRole('heading', { name: 'Automatic rider assignment' })).closest('section')!;
    const toggle = await within(card).findByRole('switch', { name: 'Assign orders automatically' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(api.find('PUT', '/admin/settings/rider-auto-assign')[0].body).toEqual({ enabled: true });

    const wait = within(card).getByLabelText(/Wait before assigning/);
    const km = within(card).getByLabelText(/Rider must be within/);
    await userEvent.clear(wait);
    await userEvent.type(wait, '10');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Enter from 30 to 900 seconds.');
    await userEvent.clear(wait);
    await userEvent.type(wait, '120');
    await userEvent.clear(km);
    await userEvent.type(km, '3.5');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Saved: wait 2 min, within 3.5 km.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/rider-auto-assign').at(-1)!.body).toEqual({ wait_seconds: 120, max_distance_km: 3.5 });
  });
});
