import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DeliverySummary, RiderDay, RiderProfile } from '../api/types';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * Staff riders (2026-10-01): the lead delivers from the Operations app. An
 * operator with no rider profile sets one up (Delivery tab or More ->
 * "Deliver orders myself"), and then has the Rider app's "My day" and trip
 * view, with Home showing the trip they are on.
 */

beforeEach(() => {
  __resetTrackerSessionForTests();
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const PROFILE: RiderProfile = {
  id: 'r-lead',
  vehicle_type: 'MOTORCYCLE',
  vehicle_registration_number: 'WP-LEAD-0001',
  emergency_contact_phone: null,
  is_active: true,
};

let seq = 0;
function summary(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  seq += 1;
  return {
    delivery_id: `sd${seq}`,
    order_id: `so${seq}`,
    assignment_status: 'ASSIGNED',
    assigned_at: new Date().toISOString(),
    accepted_at: null,
    picked_up_at: null,
    order_number: `BL-20261001-10${10 + seq}`,
    order_status: 'PACKED',
    total_amount: 610,
    payment_method: 'COD',
    payment_status: 'PENDING',
    delivery_recipient_name: 'Priya Fernando',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: `${seq} Main Street`,
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    ...overrides,
  };
}

/** A session with no rider profile until POST /riders/me/profile succeeds. */
function noProfileYet(extra: Record<string, (call: Call) => unknown> = {}) {
  const state: { profile: RiderProfile | null } = { profile: null };
  const handlers = {
    'GET /riders/deliveries': () => (state.profile ? ok({ deliveries: [] }) : fail(403, 'RIDER_PROFILE_NOT_FOUND')),
    'GET /riders/me/profile': () => ok({ profile: state.profile }),
    'POST /riders/me/profile': (call: Call) => {
      state.profile = { ...PROFILE, ...call.body, vehicle_registration_number: String(call.body.vehicle_registration_number).toUpperCase() };
      return ok({ profile: state.profile });
    },
    ...extra,
  };
  return { state, handlers };
}

describe('Setting up a rider profile from the Delivery tab', () => {
  it('offers the set-up form, sends exactly the vehicle, and then shows the deliveries', async () => {
    const user = userEvent.setup();
    const { handlers } = noProfileYet();
    const { api } = renderAs(OPERATIONS_STAFF, '/delivery', handlers);

    expect(await screen.findByText('No rider profile is linked to this account yet.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Vehicle'), 'SCOOTER');
    await user.type(screen.getByLabelText('Registration number'), 'wp abc-1234');
    await user.click(screen.getByRole('button', { name: 'Start delivering' }));

    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
    expect(api.find('POST', '/riders/me/profile').map((c) => c.body)).toEqual([
      { vehicle_type: 'SCOOTER', vehicle_registration_number: 'wp abc-1234', emergency_contact_phone: null },
    ]);
    // The tab no longer says "No profile".
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).queryByText('No profile')).not.toBeInTheDocument();
  });

  it('needs a registration number before sending anything', async () => {
    const user = userEvent.setup();
    const { handlers } = noProfileYet();
    const { api } = renderAs(OPERATIONS_STAFF, '/delivery', handlers);
    await user.click(await screen.findByRole('button', { name: 'Start delivering' }));
    expect(screen.getByText('Enter the number plate, e.g. WP BCX-8842.')).toBeInTheDocument();
    expect(api.find('POST', '/riders/me/profile')).toHaveLength(0);
  });

  it('a profile an admin switched off says so instead of offering the form', async () => {
    renderAs(OPERATIONS_STAFF, '/delivery', {
      'GET /riders/deliveries': () => fail(403, 'RIDER_INACTIVE'),
      'GET /riders/me/profile': () => ok({ profile: { ...PROFILE, is_active: false } }),
    });
    expect(await screen.findByText(/Delivering is switched off for your account/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start delivering' })).not.toBeInTheDocument();
  });

  it('explains a RIDER_PROFILE_DISABLED refusal', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/delivery', {
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
      'GET /riders/me/profile': () => ok({ profile: null }),
      'POST /riders/me/profile': () => fail(403, 'RIDER_PROFILE_DISABLED'),
    });
    await user.type(await screen.findByLabelText('Registration number'), 'WP-1');
    await user.click(screen.getByRole('button', { name: 'Start delivering' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask an admin to turn "Can deliver" back on');
  });
});

describe('More -> Deliver orders myself', () => {
  it('is linked from More and sets up the profile there too', async () => {
    const user = userEvent.setup();
    const { handlers } = noProfileYet();
    renderAs(OPERATIONS_STAFF, '/more', handlers);
    await user.click(await screen.findByRole('link', { name: 'Deliver orders myself' }));
    await user.type(await screen.findByLabelText('Registration number'), 'WP-LEAD-0001');
    await user.click(screen.getByRole('button', { name: 'Start delivering' }));
    expect(await screen.findByText('You can deliver now. Orders assigned to you appear in the Delivery tab.')).toBeInTheDocument();
    expect(screen.getByText('WP-LEAD-0001')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my deliveries' })).toHaveAttribute('href', '/delivery');
  });

  it('shows an existing profile and changes the vehicle', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/deliver', {
      'GET /riders/me/profile': () => ok({ profile: PROFILE }),
      'POST /riders/me/profile': (call: Call) => ok({ profile: { ...PROFILE, ...call.body } }),
    });
    expect(await screen.findByText('Motorcycle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change vehicle' }));
    await user.selectOptions(screen.getByLabelText('Vehicle'), 'BICYCLE');
    await user.click(screen.getByRole('button', { name: 'Save vehicle' }));
    expect(await screen.findByText('Vehicle saved.')).toBeInTheDocument();
    expect(api.find('POST', '/riders/me/profile')[0].body).toMatchObject({
      vehicle_type: 'BICYCLE',
      vehicle_registration_number: 'WP-LEAD-0001',
    });
    expect(screen.getByText('Bicycle')).toBeInTheDocument();
  });
});

describe('My day', () => {
  const DAY: RiderDay = {
    timezone: 'Asia/Colombo',
    today: { date: '2026-10-01', completed: 3, failed: 1, customer_unavailable: 0, cash_collected: 1830 },
    week: { starts_on: '2026-09-28', completed: 12, failed: 2, customer_unavailable: 1, cash_collected: 7320 },
    deliveries_today: [
      { delivery_id: 'x1', order_number: 'BL-20261001-0042', outcome: 'DELIVERED', at: '2026-10-01T05:10:00Z', cash_collected: 610 },
      { delivery_id: 'x2', order_number: 'BL-20261001-0043', outcome: 'FAILED', at: '2026-10-01T04:10:00Z', cash_collected: 0 },
    ],
  };

  it('shows today and this week from GET /riders/me/day, and today’s deliveries', async () => {
    renderAs(OPERATIONS_STAFF, '/delivery/day', { 'GET /riders/me/day': () => ok(DAY) });
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('3')).toBeInTheDocument();
    expect(within(today).getByText('LKR 1,830')).toBeInTheDocument();
    const week = screen.getByRole('region', { name: /This week/ });
    expect(within(week).getByText('12')).toBeInTheDocument();
    expect(screen.getByText('#0042')).toBeInTheDocument();
    expect(screen.getByText("Couldn't deliver", { selector: '.queue-tone' })).toBeInTheDocument();
  });

  it('without a rider profile, says so', async () => {
    renderAs(OPERATIONS_STAFF, '/delivery/day', {
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
      'GET /riders/me/day': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
    });
    expect(await screen.findByText('No rider profile is linked to this account yet.')).toBeInTheDocument();
  });
});

describe('Home', () => {
  it('shows the trip the operator is on, with a link to each stop', async () => {
    const a = summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' });
    const b = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    renderAs(OPERATIONS_STAFF, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [b, a] }) });
    expect(await screen.findByRole('heading', { name: 'Your trip · 2 stops' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /^Open stop/ });
    // At the door first, then on the road.
    expect(links.map((l) => l.getAttribute('href'))).toEqual([`/delivery/${a.delivery_id}`, `/delivery/${b.delivery_id}`]);
  });

  it('a single active delivery keeps the one card, with the cash to collect', async () => {
    const a = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY', total_amount: 950 });
    renderAs(OPERATIONS_STAFF, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [a] }) });
    expect(await screen.findByRole('link', { name: 'Open delivery' })).toHaveAttribute('href', `/delivery/${a.delivery_id}`);
    expect(screen.getByText('Cash to collect: LKR 950')).toBeInTheDocument();
    expect(screen.getByText('On the way')).toBeInTheDocument();
  });

  it('resumes location sharing when a delivery is on the road', async () => {
    const watchPosition = vi.fn(() => 7);
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        watchPosition,
        clearWatch: vi.fn(),
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 6.43, longitude: 80.02, accuracy: 9 }, timestamp: Date.now() } as GeolocationPosition),
      },
      configurable: true,
    });
    try {
      const a = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
      renderAs(OPERATIONS_STAFF, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [a] }) });
      await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    }
  });
});
