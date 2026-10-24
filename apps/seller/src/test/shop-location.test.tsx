import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';
import { product, renderApp, seller, signInStoredSession, worldHandler } from './fixtures';
import type { Seller } from '../api/types';

/*
 * jsdom has no WebGL, so the MapLibre map is replaced by a stand-in that
 * shows where it opened and has a button that "drags" the map.
 */
const flown: Array<{ lat: number; lng: number }> = [];
vi.mock('../components/ShopMap', async () => {
  const React = await import('react');
  const ShopMap = React.forwardRef(function FakeMap(props: any, ref) {
    React.useImperativeHandle(ref, () => ({ flyTo: (p: { lat: number; lng: number }) => flown.push(p) }));
    React.useEffect(() => props.onStatus?.('ready'), []);
    return (
      <div data-testid="map" data-start={`${props.start.lat},${props.start.lng}`}>
        <button
          type="button"
          onClick={() => {
            props.onMoving?.(true);
            props.onMove({ lat: 6.4501234, lng: 80.0202345 });
            props.onMoving?.(false);
          }}
        >
          Drag the map (test)
        </button>
      </div>
    );
  });
  return { ShopMap };
});

const STORE = { lat: 6.441313, lng: 80.011437 };

/** A fake API that remembers the shop a successful PUT returned (GET /seller/me then answers with it). */
function world(s: Seller, put?: (call: Call) => Reply) {
  let current = s;
  return mockApi((call) => {
    if (call.method === 'GET' && call.path === '/store') return ok({ store_location: STORE, hub_name: 'Dharga Town' });
    if (call.method === 'PUT' && call.path === '/seller/profile' && put) {
      const reply = put(call);
      const next = (reply.data as { seller?: Seller } | undefined)?.seller;
      if (next) current = next;
      return reply;
    }
    return worldHandler({ seller: current })(call);
  });
}

beforeEach(() => {
  signInStoredSession();
  flown.length = 0;
});

describe('shop location on My shop', () => {
  it('explains why the location matters', async () => {
    world(seller());
    renderApp('/shop');
    expect(await screen.findByRole('heading', { name: 'Shop location' })).toBeInTheDocument();
    expect(
      screen.getByText(/delivery charges for your products are worked out from your approved shop location/i)
    ).toBeInTheDocument();
  });

  it('no pin yet: opens at the Blynk store and sends the pin, the landmark and the profile', async () => {
    const api = world(seller(), () =>
      ok({
        seller: seller({
          location_status: 'PENDING',
          pending_latitude: 6.450123,
          pending_longitude: 80.020235,
          pending_location_note: 'Opposite the post office',
          pending_distance_km_from_store: 1.4,
        }),
      })
    );
    renderApp('/shop');
    const map = await screen.findByTestId('map');
    expect(map).toHaveAttribute('data-start', `${STORE.lat},${STORE.lng}`);
    const send = screen.getByRole('button', { name: /send this location to blynk/i });
    // Still sitting on the store: the seller has to put the pin on the shop first.
    expect(send).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /drag the map \(test\)/i }));
    await userEvent.type(screen.getByLabelText(/landmark \/ how to find the shop/i), 'Opposite the post office');
    await userEvent.click(send);

    expect(await screen.findByText('Location sent to Blynk.')).toBeInTheDocument();
    // Only the required shop name and the point: the other details are left as they are.
    expect(api.find('PUT', '/seller/profile')[0]!.body).toEqual({
      shop_name: 'Nimal Farm',
      latitude: 6.450123,
      longitude: 80.020235,
      location_note: 'Opposite the post office',
    });
    expect(await screen.findByText('Waiting for Blynk to approve this location.')).toBeInTheDocument();
    expect(screen.getByText('1.4 km')).toBeInTheDocument();
  });

  it('PENDING: says it waits, opens on the waiting pin and keeps the approved one in use', async () => {
    world(
      seller({
        location_status: 'PENDING',
        latitude: 6.44,
        longitude: 80.01,
        pending_latitude: 6.46,
        pending_longitude: 80.03,
      })
    );
    renderApp('/shop');
    expect(await screen.findByText('Waiting for Blynk to approve this location.')).toBeInTheDocument();
    expect(screen.getByText(/until blynk approves it, delivery charges use your approved location/i)).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveAttribute('data-start', '6.46,80.03');
  });

  it('PENDING: "Cancel request" withdraws the waiting pin (null + null), the approved one stays', async () => {
    const approved = { latitude: 6.44, longitude: 80.01, distance_km_from_store: 0.3 };
    const api = world(
      seller({ location_status: 'PENDING', ...approved, pending_latitude: 6.46, pending_longitude: 80.03 }),
      () => ok({ seller: seller({ location_status: 'APPROVED', ...approved }) })
    );
    renderApp('/shop');
    await userEvent.click(await screen.findByRole('button', { name: /cancel request/i }));
    expect(await screen.findByText('Request cancelled.')).toBeInTheDocument();
    expect(screen.getByText(/your approved location stays in use/i)).toBeInTheDocument();
    expect(api.find('PUT', '/seller/profile')[0]!.body).toEqual({ shop_name: 'Nimal Farm', latitude: null, longitude: null });
    expect(await screen.findByText('Approved - delivery charges are worked out from here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel request/i })).not.toBeInTheDocument();
  });

  it('409 LOCATION_NOT_PENDING on cancel: says nothing is waiting any more', async () => {
    world(seller({ location_status: 'PENDING', pending_latitude: 6.46, pending_longitude: 80.03 }), () =>
      fail(409, 'LOCATION_NOT_PENDING', 'No location change is waiting.')
    );
    renderApp('/shop');
    await userEvent.click(await screen.findByRole('button', { name: /cancel request/i }));
    expect(await screen.findByText('Nothing is waiting for Blynk any more.')).toBeInTheDocument();
  });

  it('saving the shop details never sends the location fields', async () => {
    const api = world(
      seller({ location_status: 'PENDING', latitude: 6.44, longitude: 80.01, pending_latitude: 6.46, pending_longitude: 80.03, location_note: 'Blue gate' }),
      () => ok({ seller: seller({ location_status: 'PENDING', latitude: 6.44, longitude: 80.01, pending_latitude: 6.46, pending_longitude: 80.03 }) })
    );
    renderApp('/shop');
    const contact = await screen.findByLabelText(/contact person/i);
    await userEvent.clear(contact);
    await userEvent.type(contact, 'Nimal Perera');
    await userEvent.click(screen.getByRole('button', { name: /save my shop details/i }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const body = api.find('PUT', '/seller/profile')[0]!.body;
    expect(Object.keys(body).sort()).toEqual(['address', 'contact_name', 'note', 'shop_name']);
    for (const key of ['latitude', 'longitude', 'location_note']) expect(body).not.toHaveProperty(key);
  });

  it('APPROVED: says delivery charges are worked out from here, with the distance', async () => {
    world(seller({ location_status: 'APPROVED', latitude: 6.45, longitude: 80.02, distance_km_from_store: 2.43 }));
    renderApp('/shop');
    expect(await screen.findByText('Approved - delivery charges are worked out from here.')).toBeInTheDocument();
    expect(screen.getByText('2.4 km')).toBeInTheDocument();
    // Nothing moved: nothing to send.
    expect(screen.getByRole('button', { name: /send this location to blynk/i })).toBeDisabled();
  });

  it('REJECTED: shows the reason and lets the seller send a new pin', async () => {
    world(
      seller({
        location_status: 'REJECTED',
        pending_latitude: 6.46,
        pending_longitude: 80.03,
        location_reject_reason: 'That is the bus stand',
      }),
      () => ok({ seller: seller({ location_status: 'PENDING', pending_latitude: 6.450123, pending_longitude: 80.020235 }) })
    );
    renderApp('/shop');
    expect(
      await screen.findByText('Not approved: That is the bus stand - move the pin and send again.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /drag the map \(test\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /send this location to blynk/i }));
    expect(await screen.findByText('Waiting for Blynk to approve this location.')).toBeInTheDocument();
  });

  it('503 LOCATION_NOT_READY: says gently that it will be available shortly', async () => {
    world(seller(), () => fail(503, 'LOCATION_NOT_READY', 'Shop location will be available shortly'));
    renderApp('/shop');
    await userEvent.click(await screen.findByRole('button', { name: /drag the map \(test\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /send this location to blynk/i }));
    const result = await screen.findByTestId('location-result');
    expect(result).toHaveTextContent('Shop location will be available shortly');
    expect(result).toHaveTextContent(/not saved yet/i);
    expect(result.className).toMatch(/loc__notice--info/);
  });

  it('400 on latitude: shows the server message by the map', async () => {
    world(seller(), () =>
      fail(400, 'VALIDATION_ERROR', 'Invalid', [{ field: 'latitude', message: 'The shop must be in Sri Lanka.' }])
    );
    renderApp('/shop');
    await userEvent.click(await screen.findByRole('button', { name: /drag the map \(test\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /send this location to blynk/i }));
    expect(await screen.findByText('The shop must be in Sri Lanka.')).toBeInTheDocument();
  });

  it('"Use my current location": moves the map there, or explains when location is blocked', async () => {
    const geo = {
      getCurrentPosition: vi.fn((okFn: PositionCallback) =>
        okFn({ coords: { latitude: 6.43, longitude: 80.0 } } as GeolocationPosition)
      ),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    world(seller());
    renderApp('/shop');
    await userEvent.click(await screen.findByRole('button', { name: /use my current location/i }));
    expect(flown).toEqual([{ lat: 6.43, lng: 80.0 }]);
    expect(screen.getByRole('button', { name: /send this location to blynk/i })).toBeEnabled();

    geo.getCurrentPosition.mockImplementation(((_ok: PositionCallback, err: PositionErrorCallback) =>
      err({ code: 1 } as GeolocationPositionError)) as never);
    await userEvent.click(screen.getByRole('button', { name: /use my current location/i }));
    expect(await screen.findByText(/location is blocked for this site/i)).toBeInTheDocument();
  });
});

describe('the tracker on My products', () => {
  it('PENDING shop without a pin: "Pin your shop" is the seller\'s turn and opens My shop', async () => {
    world(seller({ status: 'PENDING' }));
    renderApp('/products');
    const tracker = await screen.findByTestId('tracker');
    const steps = within(tracker).getAllByRole('listitem');
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'current', 'waiting', 'next', 'next']);
    expect(within(tracker).getByRole('link', { name: /pin your shop/i })).toHaveAttribute('href', '/shop#location');
    expect(screen.getByRole('img', { name: '1 of 5 steps done' })).toBeInTheDocument();
  });

  it('a pin waiting for approval is shown as waiting; an approved one as done', async () => {
    world(seller({ status: 'PENDING', location_status: 'PENDING', pending_latitude: 6.45, pending_longitude: 80.02 }));
    const { unmount } = renderApp('/products');
    let tracker = await screen.findByTestId('tracker');
    expect(within(tracker).getAllByRole('listitem')[1]).toHaveAttribute('data-state', 'waiting');
    unmount();

    world(seller({ status: 'PENDING', location_status: 'APPROVED', latitude: 6.45, longitude: 80.02 }));
    renderApp('/products');
    tracker = await screen.findByTestId('tracker');
    expect(within(tracker).getAllByRole('listitem')[1]).toHaveAttribute('data-state', 'done');
  });

  it('approved and selling: the tracker gives way to the shop numbers', async () => {
    mockApi(
      worldHandler({
        seller: seller({ location_status: 'APPROVED', latitude: 6.45, longitude: 80.02 }),
        products: [product(), product({ id: 'p2', name: 'Jaggery', units_sold: 5 })],
      })
    );
    renderApp('/products');
    const numbers = await screen.findByLabelText(/your shop at a glance/i);
    expect(screen.queryByTestId('tracker')).not.toBeInTheDocument();
    expect(await within(numbers).findByText('LKR 3,000.00')).toBeInTheDocument();
    expect(within(numbers).getByText('35')).toBeInTheDocument();
    expect(within(numbers).getByText('2')).toBeInTheDocument();
  });
});
