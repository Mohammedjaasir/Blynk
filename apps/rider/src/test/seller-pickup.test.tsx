// Seller orders (owner, 2026-10-30): the rider sees WHERE to collect the goods. The backend's
// `pickups` on the delivery detail is mocked here exactly as plan section B1 describes it.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - mapInstances exists only on the test stand-in (test/setup.ts).
import { mapInstances } from 'maplibre-gl';
import { tokenStore } from '../api/client';
import type { PickupPoint } from '../api/types';
import {
  beingPackedNote,
  isPickupReady,
  mapPickup,
  pickupListLine,
  WAIT_FOR_SELLER_NOTE,
  WAIT_FOR_STORE_NOTE,
} from '../lib/pickups';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, detail, ok, renderAs, summary } from './helpers';

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
  mapInstances.length = 0;
});
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const STORE: PickupPoint = {
  kind: 'STORE',
  shop_name: 'Blynk store',
  lat: 6.43,
  lng: 80.0,
  address: null,
  how_to_find: null,
  phone: null,
  ready: true,
};
const seller = (ready: boolean, over: Partial<PickupPoint> = {}): PickupPoint => ({
  kind: 'SELLER',
  seller_id: 's-1',
  shop_name: 'Blynk Western',
  lat: '6.4100',
  lng: '80.0300',
  address: '12 Beach Road, Dharga Town',
  how_to_find: 'Blue gate next to the pharmacy',
  phone: '+94771112233',
  ready,
  ...over,
});
const withCustomerPin = { delivery_latitude: 6.4382, delivery_longitude: 80.0118 };

describe('pickup helpers', () => {
  it('reads ready from the flag; the store and an older API (no flag) are always ready', () => {
    expect(isPickupReady(STORE)).toBe(true);
    expect(isPickupReady(seller(true))).toBe(true);
    expect(isPickupReady(seller(false))).toBe(false);
    expect(isPickupReady({ kind: 'SELLER', lat: 1, lng: 1 })).toBe(true);
  });

  it('a seller order that is not ready never blames the store', () => {
    expect(beingPackedNote([seller(false)])).toBe(WAIT_FOR_SELLER_NOTE);
    expect(beingPackedNote([STORE])).toBe(WAIT_FOR_STORE_NOTE);
    expect(beingPackedNote(undefined)).toBe(WAIT_FOR_STORE_NOTE);
    expect(beingPackedNote([STORE, seller(false)])).toBe(WAIT_FOR_STORE_NOTE); // the store still packs its part
  });

  it('the list line: "At <shop>" while preparing, "Ready at <shop>" once ready, nothing for the store', () => {
    expect(pickupListLine([seller(false)])).toEqual({ text: 'At Blynk Western', ready: false });
    expect(pickupListLine([seller(true)])).toEqual({ text: 'Ready at Blynk Western', ready: true });
    expect(pickupListLine([STORE])).toBeNull();
    expect(pickupListLine(undefined)).toBeNull();
  });

  it('the map leg starts at the first seller pickup that has a usable pin (string coordinates read)', () => {
    expect(mapPickup([STORE, seller(true)])?.at).toEqual({ lat: 6.41, lng: 80.03 });
    expect(mapPickup([STORE])).toBeNull();
    expect(mapPickup([seller(true, { lat: 0, lng: 0 })])).toBeNull();
  });
});

describe('delivery screen: where to pick up', () => {
  const open = (d: Parameters<typeof detail>[0], extra: Record<string, unknown> = {}) =>
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(d) }),
      'GET /routing/route': () => ok({ route: { distance_m: 3100, duration_s: 540, coordinates: [[80.03, 6.41], [80.0118, 6.4382]] } }),
      ...extra,
    });

  it('a store order: "1. Pick up" names the Blynk store, then "2. Deliver to the customer"', async () => {
    open({ pickups: [STORE], ...withCustomerPin });
    const pickup = await screen.findByRole('region', { name: 'Pick up' });
    expect(within(pickup).getByText('1. Pick up')).toBeInTheDocument();
    expect(within(pickup).getByText('Blynk store')).toBeInTheDocument();
    expect(within(pickup).queryByRole('link')).not.toBeInTheDocument(); // no call / navigate for the store
    expect(screen.getByText('2. Deliver to the customer')).toBeInTheDocument();
    expect(screen.queryByTestId('route-header')).not.toBeInTheDocument();
    // The existing customer navigation and the plain rider -> customer map are unchanged.
    expect(screen.getByRole('link', { name: /Navigate in Google Maps/ })).toHaveAttribute(
      'href',
      expect.stringContaining('destination=6.438200%2C80.011800'),
    );
    expect(screen.getByRole('region', { name: 'Route to the customer' })).toBeInTheDocument();
  });

  it('a seller order, not ready: shop details, amber status, wait note, no action, Shop -> Customer map', async () => {
    const { api } = open({ order_status: 'PLACED', pickups: [seller(false)], ...withCustomerPin });
    const card = await screen.findByTestId('pickup-seller');
    expect(within(card).getByText('Blynk Western')).toBeInTheDocument();
    expect(within(card).getByText('12 Beach Road, Dharga Town')).toBeInTheDocument();
    expect(within(card).getByText('Where to find it')).toBeInTheDocument();
    expect(within(card).getByText('Blue gate next to the pharmacy')).toBeInTheDocument();
    const status = within(card).getByTestId('pickup-status');
    expect(status).toHaveTextContent('The seller is still preparing this order');
    expect(status).toHaveClass('pickup__status--preparing');
    // The store is not blamed; the rider waits for the seller.
    expect(screen.getByText('Wait for the seller to mark it ready before leaving.')).toBeInTheDocument();
    expect(screen.queryByText(/The store hasn't packed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Delivery actions' })).not.toBeInTheDocument();

    expect(within(card).getByRole('link', { name: 'Call shop Blynk Western' })).toHaveAttribute('href', 'tel:+94771112233');
    expect(within(card).getByRole('link', { name: 'Navigate to shop' })).toHaveAttribute(
      'href',
      expect.stringContaining('destination=6.410000%2C80.030000'),
    );
    expect(screen.getByText('2. Deliver to the customer')).toBeInTheDocument();
    expect(screen.getByTestId('route-header')).toHaveTextContent('Shop → Customer');

    // The map draws the road route SHOP -> CUSTOMER and marks both.
    expect(screen.getByRole('region', { name: 'Route from the shop to the customer' })).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/routing/route')).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Shop to customer: 3.1 km · 9 min')).toBeInTheDocument());
  });

  it('a seller order, ready: green status, "Picked up" is offered, the shop leg route starts at the shop', async () => {
    const { api } = open({ order_status: 'PACKED', pickups: [seller(true)], ...withCustomerPin });
    const card = await screen.findByTestId('pickup-seller');
    const status = within(card).getByTestId('pickup-status');
    expect(status).toHaveTextContent('Ready for pick-up');
    expect(status).toHaveClass('pickup__status--ready');
    expect(screen.getByRole('button', { name: 'Picked up' })).toBeInTheDocument();
    expect(screen.queryByText(/still preparing/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/routing/route')).toHaveLength(1));
    // The route is asked from the shop's pin to the customer's - not from the rider.
    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]).find((u) => String(u).includes('/routing/route')));
    expect(url).toContain('from=6.410000,80.030000');
    expect(url).toContain('to=6.438200,80.011800');
    expect(mapInstances[0].fitted).not.toBeNull(); // shop and customer both in view
  });

  it('a seller without phone or how-to-find shows neither link nor note', async () => {
    open({ pickups: [seller(true, { phone: null, how_to_find: null, address: null })], order_status: 'PACKED', ...withCustomerPin });
    const card = await screen.findByTestId('pickup-seller');
    expect(within(card).queryByText(/Call shop/)).not.toBeInTheDocument();
    expect(within(card).queryByText('Where to find it')).not.toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Navigate to shop' })).toBeInTheDocument();
  });

  it('once picked up the shop cards go and the map is the plain route to the customer', async () => {
    open({
      assignment_status: 'PICKED_UP',
      order_status: 'OUT_FOR_DELIVERY',
      pickups: [seller(true)],
      ...withCustomerPin,
    });
    await screen.findByRole('button', { name: "I've arrived" });
    expect(screen.queryByRole('region', { name: 'Pick up' })).not.toBeInTheDocument();
    expect(screen.queryByText('2. Deliver to the customer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-header')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Route to the customer' })).toBeInTheDocument();
  });

  it('an older API without pickups looks exactly as before (no cards, no headings)', async () => {
    open({ order_status: 'PLACED', ...withCustomerPin });
    expect(await screen.findByText("The store hasn't packed this order yet. Wait for it before leaving.")).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pick up' })).not.toBeInTheDocument();
    expect(screen.queryByText('2. Deliver to the customer')).not.toBeInTheDocument();
  });

  it('a seller with no usable pin keeps the customer route and still shows the shop card', async () => {
    open({ order_status: 'PACKED', pickups: [seller(true, { lat: 0, lng: 0, address: null })], ...withCustomerPin });
    const card = await screen.findByTestId('pickup-seller');
    expect(within(card).queryByRole('link', { name: 'Navigate to shop' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('route-header')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Route to the customer' })).toBeInTheDocument();
  });
});

describe('deliveries list: pickup line', () => {
  it('shows "At <shop>" while preparing and green "Ready at <shop>" when ready (pickups on the list)', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({
          deliveries: [
            summary({ delivery_id: 'd-1', order_number: 'BLK-20260918-0001', order_status: 'PACKED', pickups: [seller(true)] }),
            summary({
              delivery_id: 'd-2',
              order_number: 'BLK-20260918-0002',
              order_status: 'PLACED',
              pickups: [seller(false, { shop_name: 'Cake House' })],
            }),
          ],
        }),
    });
    const now = await screen.findByText('Ready at Blynk Western');
    expect(now).toHaveClass('pickup-line--ready');
    const waiting = screen.getByText('At Cake House');
    expect(waiting).toHaveClass('pickup-line--preparing');
  });

  it('asks the delivery detail for the pickups when the list leaves them out, and says nothing for a store order', async () => {
    const { api } = renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({
          deliveries: [
            summary({ delivery_id: 'd-1', order_number: 'BLK-20260918-0001', order_status: 'PLACED' }),
            summary({ delivery_id: 'd-2', order_number: 'BLK-20260918-0002', order_status: 'PLACED' }),
          ],
        }),
      'GET /riders/deliveries/d-1': () =>
        ok({ delivery: detail({ delivery_id: 'd-1', order_status: 'PLACED', pickups: [seller(false)] }) }),
      'GET /riders/deliveries/d-2': () => ok({ delivery: detail({ delivery_id: 'd-2', order_status: 'PLACED', pickups: [STORE] }) }),
    });
    expect(await screen.findByText('At Blynk Western')).toBeInTheDocument();
    expect(screen.getAllByTestId('pickup-line')).toHaveLength(1);
    expect(api.find('GET', '/riders/deliveries/d-1')).toHaveLength(1);
  });
});
