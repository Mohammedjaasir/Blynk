import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import type { LiveRider, LiveRiderMap } from '../api/types';
import { parseDistanceKm, parseWaitSeconds } from '../lib/riderAutoAssign';
import { STALE_AFTER_SECONDS, ageText, initials, ordersForRider, ridersForOrder, riderTone, summaryText, waitText } from '../lib/riderMap';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Owner, 2026-10-25: the Rider map page (Admin sidebar -> Rider map) and the automatic assignment card in
 * Settings. Admin loads MapLibre from the CDN, so the loader is replaced by a stand-in that records what the
 * page asked of the map; the markers are real DOM elements the test clicks.
 */
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });

interface FakeMarker {
  element: HTMLElement;
  lngLat: [number, number] | null;
  removed: boolean;
}
const fake = vi.hoisted(() => ({ maps: [] as { options: Record<string, any>; markers: any[]; sources: Record<string, any>; handlers: Record<string, () => void>; fitted: unknown }[] }));

vi.mock('../lib/maplibre', async () => {
  const actual = await vi.importActual<typeof import('../lib/maplibre')>('../lib/maplibre');
  class Marker {
    element: HTMLElement;
    lngLat: [number, number] | null = null;
    removed = false;
    map: any = null;
    constructor(o?: { element?: HTMLElement }) {
      this.element = o?.element ?? document.createElement('div');
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    addTo(map: any) {
      this.map = map;
      map.markers.push(this);
      return this;
    }
    remove() {
      this.removed = true;
      if (this.map) this.map.markers = this.map.markers.filter((m: unknown) => m !== this);
      return this;
    }
  }
  class FakeMap {
    options: Record<string, any>;
    markers: any[] = [];
    sources: Record<string, any> = {};
    handlers: Record<string, () => void> = {};
    fitted: unknown = null;
    constructor(options: Record<string, any>) {
      this.options = options;
      fake.maps.push(this as never);
    }
    on(ev: string, fn: () => void) {
      this.handlers[ev] = fn;
    }
    once(ev: string, fn: () => void) {
      this.handlers[ev] = fn;
    }
    addSource(id: string, spec: { data: unknown }) {
      this.sources[id] = { data: spec.data, setData: (d: unknown) => (this.sources[id].data = d) };
    }
    addLayer() {}
    getSource(id: string) {
      return this.sources[id];
    }
    addControl() {}
    fitBounds(b: unknown) {
      this.fitted = b;
    }
    resize() {}
    remove() {}
  }
  const ml = { Map: FakeMap, Marker, AttributionControl: class {}, NavigationControl: class {} };
  return { ...actual, loadMapLibre: () => Promise.resolve(ml) };
});

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(path: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fake.maps.length = 0;
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

const markerEls = () => ((fake.maps[0]?.markers ?? []) as FakeMarker[]).map((m) => m.element);
const dotFor = (name: string) => markerEls().find((el) => el.getAttribute('aria-label')?.startsWith(name))!;

describe('rider map helpers', () => {
  it('colours a dot free, on a trip, or grey once the point is older than 3 minutes', () => {
    const pos = (age: number) => ({ lat: 1, lng: 1, accuracy_m: null, captured_at: '', age_seconds: age });
    expect(riderTone({ status: 'FREE', position: pos(5) })).toBe('free');
    expect(riderTone({ status: 'ON_TRIP', position: pos(5) })).toBe('trip');
    expect(riderTone({ status: 'ON_TRIP', position: pos(STALE_AFTER_SECONDS + 1) })).toBe('stale');
    expect(riderTone({ status: 'FREE', position: null })).toBe('stale');
  });

  it('takes initials, phrases ages and waits, ranks riders and orders', () => {
    expect(initials('Farhan Mohamed')).toBe('FM');
    expect(initials('  ruwan ')).toBe('R');
    expect(initials(null)).toBe('?');
    expect(ageText(3)).toBe('just now');
    expect(ageText(190)).toBe('3 min ago');
    expect(waitText(130)).toBe('2 min');
    const d = live();
    const full = rider({ id: 'F', full_name: 'Full', capacity_left: 0, status: 'ON_TRIP', open_deliveries: 2 });
    expect(ridersForOrder(d.unassigned_orders[0], [full, ...d.riders]).map((o) => o.rider.id)).toEqual(['A', 'B', 'C', 'F']);
    const far = { ...d.unassigned_orders[0], order_id: 'far', dropoff: { lat: 6.5, lng: 80.1 } };
    expect(ordersForRider(d.riders[0], [far, d.unassigned_orders[0]]).map((x) => x.order.order_id)).toEqual(['o-wait', 'far']);
    expect(summaryText(d)).toBe('2 riders free, 1 on a trip, 1 order waiting');
  });

  it('validates the automatic assignment numbers like the API', () => {
    expect(parseWaitSeconds('90')).toEqual({ value: 90 });
    expect(parseWaitSeconds('29')).toHaveProperty('error');
    expect(parseWaitSeconds('901')).toHaveProperty('error');
    expect(parseDistanceKm('5')).toEqual({ value: 5 });
    expect(parseDistanceKm('26')).toHaveProperty('error');
    expect(parseDistanceKm('2.55')).toHaveProperty('error');
  });
});

describe('Rider map page', () => {
  it('opens on the store, draws the circle, and shows riders and orders as markers', async () => {
    renderAt('/rider-map', (c) => (c.path === '/admin/riders/live' ? ok(live()) : undefined));
    await screen.findByTestId('rider-map');
    await waitFor(() => expect(markerEls().length).toBeGreaterThan(0));
    const map = fake.maps[0];
    expect(map.options.center).toEqual([STORE.lng, STORE.lat]);
    expect(map.fitted).not.toBeNull();
    act(() => map.handlers.load());
    expect(map.sources['delivery-circle']).toBeDefined();

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
    expect(screen.getByText(/2 riders free, 1 on a trip, 1 order waiting/)).toBeInTheDocument();
    expect(screen.getByText('Riders without a dot have not sent a position yet.')).toBeInTheDocument();
    expect(screen.getByText(/Automatic assignment is off/)).toBeInTheDocument();
  });

  it('says so when the map cannot load, and still lists everything', async () => {
    const ml = await import('../lib/maplibre');
    const spy = vi.spyOn(ml, 'loadMapLibre').mockRejectedValue(new Error('offline'));
    renderAt('/rider-map', (c) => (c.path === '/admin/riders/live' ? ok(live()) : undefined));
    expect(await screen.findByText(/The map could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Order 0042/ })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('opens a sheet for a rider and assigns a waiting order with "Assign here" through the manual API', async () => {
    let assigned = false;
    const api = renderAt('/rider-map', (c) => {
      if (c.path === '/admin/riders/live') return ok(assigned ? live({ unassigned_orders: [] }) : live());
      if (c.method === 'POST' && c.path === '/admin/orders/o-wait/assign-rider') {
        assigned = true;
        return ok({ delivery: { id: 'd1' } });
      }
      return undefined;
    });
    await screen.findByTestId('rider-map');
    await waitFor(() => expect(markerEls().length).toBeGreaterThan(0));
    fireEvent.click(dotFor('Farhan'));
    const sheet = await screen.findByRole('dialog', { name: 'Rider Farhan Mohamed' });
    expect(within(sheet).getByText(/2 more orders can be added/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign order 0042 to Farhan Mohamed' }));
    await waitFor(() => expect(api.find('POST', '/admin/orders/o-wait/assign-rider')).toHaveLength(1));
    expect(api.find('POST', '/admin/orders/o-wait/assign-rider')[0].body).toEqual({ rider_id: 'A' });
    expect(await screen.findByText('Order 0042 assigned to Farhan Mohamed.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(markerEls().some((el) => el.className.includes('rmap-pin--waiting'))).toBe(false));
  });

  it('opens a sheet for a waiting order; a far trip asks to confirm before it is sent', async () => {
    const bodies: unknown[] = [];
    renderAt('/rider-map', (c) => {
      if (c.path === '/admin/riders/live') return ok(live());
      if (c.method === 'POST' && c.path === '/admin/orders/o-wait/assign-rider') {
        bodies.push(c.body);
        return c.body.confirm_far_batch ? ok({ delivery: { id: 'd2' } }) : fail(409, 'BATCH_DROPOFFS_TOO_FAR', 'This drop-off is 2.2 km from order #7.');
      }
      return undefined;
    });
    await screen.findByTestId('rider-map');
    await waitFor(() => expect(markerEls().length).toBeGreaterThan(0));
    fireEvent.click(markerEls().find((el) => el.className.includes('rmap-pin--waiting'))!);
    const sheet = await screen.findByRole('dialog', { name: 'Order 0042' });
    expect(within(sheet).getByText(/Waiting 2 min for a rider/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign order 0042 to Nimal Perera' }));
    expect(await within(sheet).findByText(/2.2 km from order #7/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add to the trip anyway' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ rider_id: 'B', confirm_far_batch: true });
  });

  it('refreshes every 15 seconds and pauses while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    const api = renderAt('/rider-map', (c) => (c.path === '/admin/riders/live' ? ok(live()) : undefined));
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

  it('is in the sidebar', async () => {
    renderAt('/', () => undefined);
    const link = await screen.findByRole('link', { name: 'Rider map' });
    expect(link).toHaveAttribute('href', '/rider-map');
  });
});

describe('Automatic rider assignment card (Settings)', () => {
  it('shows the setting, switches it on at once, and saves the two numbers', async () => {
    let state = { enabled: false, wait_seconds: 90, max_distance_km: 5, updated_at: null as string | null };
    const api = renderAt('/settings', (c) => {
      if (c.path === '/admin/settings/rider-auto-assign') {
        if (c.method === 'PUT') {
          state = { ...state, ...c.body, updated_at: '2026-10-25T05:00:00Z' };
        }
        return ok(state);
      }
      return undefined;
    });
    const card = (await screen.findByRole('region', { name: 'Automatic rider assignment' })) as HTMLElement;
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
    expect(await within(card).findByText('Enter from 30 to 900 seconds.')).toBeInTheDocument();
    await userEvent.clear(wait);
    await userEvent.type(wait, '120');
    await userEvent.clear(km);
    await userEvent.type(km, '3.5');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/rider-auto-assign')).toHaveLength(2));
    expect(api.find('PUT', '/admin/settings/rider-auto-assign')[1].body).toEqual({ wait_seconds: 120, max_distance_km: 3.5 });
  });
});
