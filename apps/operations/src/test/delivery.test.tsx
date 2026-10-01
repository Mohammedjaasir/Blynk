import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DeliveryDetail, DeliverySummary } from '../api/types';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { ADMIN_NO_RIDER, ADMIN_WITH_RIDER, fail, ok, renderAs, type Call } from './helpers';

/**
 * Delivery Mode (task F4, plan §11/§21) against a fake Blynk API shaped
 * exactly like the backend's responses, plus a fake `navigator.geolocation`
 * (jsdom has no real Geolocation API - task-F4-brief.md's "write this
 * against injectable/mockable geolocation, not real browser APIs"). These
 * tests check: the queue/detail only offer steps the delivery's real state
 * allows; every mutation sends exactly the payload the endpoint expects,
 * never a client-supplied rider id (common.md rule 4); a wrong-rider/bad id
 * renders as not-found, never a permissions error (common.md rule 5); and
 * live-location tracking (`navigator.geolocation.watchPosition`) starts only
 * while the loaded delivery is genuinely in its trackable window - never
 * merely because this screen is open - and is torn down on every documented
 * stop trigger.
 */

function stubGeolocation() {
  const watchPosition = vi.fn((_success: PositionCallback, _error?: PositionErrorCallback | null) => 101);
  const clearWatch = vi.fn();
  const getCurrentPosition = vi.fn((success: PositionCallback) => {
    success({ coords: { latitude: 6.9, longitude: 79.8, accuracy: 8 }, timestamp: Date.now() } as GeolocationPosition);
  });
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, clearWatch, getCurrentPosition },
    configurable: true,
  });
  return { watchPosition, clearWatch, getCurrentPosition };
}

beforeEach(() => {
  __resetTrackerSessionForTests();
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
});

let seq = 0;
function summary(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  seq += 1;
  return {
    delivery_id: `d${seq}`,
    order_id: `o${seq}`,
    assignment_status: 'ASSIGNED',
    assigned_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    accepted_at: null,
    picked_up_at: null,
    order_number: `BL-20260922-00${10 + seq}`,
    order_status: 'PACKED',
    total_amount: 610,
    payment_method: 'COD',
    payment_status: 'PENDING',
    delivery_recipient_name: 'Priya Fernando',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '12 Galle Road',
    delivery_address_line2: null,
    delivery_city: 'Colombo 3',
    delivery_instructions: null,
    ...overrides,
  };
}

function detail(s: DeliverySummary, overrides: Partial<DeliveryDetail> = {}): DeliveryDetail {
  return {
    ...s,
    rider_id: 'r-1',
    cod_collected_amount: 0,
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'SOURCED' }],
    ...overrides,
  };
}

describe('Delivery queue', () => {
  it('ADMIN_ONLY shows the honest message and never fetches the delivery list beyond the login-time probe', async () => {
    const { api } = renderAs(ADMIN_NO_RIDER, '/delivery', { 'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND') });
    expect(await screen.findByText('No rider profile is linked to this account yet.')).toBeInTheDocument();
    expect(api.find('GET', '/riders/deliveries')).toHaveLength(1); // the probe only
  });

  it('with nothing assigned, says so and invents nothing', async () => {
    renderAs(ADMIN_WITH_RIDER, '/delivery', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
  });

  it('shows the furthest-along delivery as Now, the rest as Next, and links to their detail pages', async () => {
    const ready = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    const waiting = summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, '/delivery', { 'GET /riders/deliveries': () => ok({ deliveries: [waiting, ready] }) });

    const openLinks = await screen.findAllByRole('link', { name: /^Open delivery/ });
    expect(openLinks.map((l) => l.getAttribute('href'))).toContain(`/delivery/${ready.delivery_id}`);
    expect(await screen.findByText(`#${waiting.order_number.split('-').pop()}`)).toBeInTheDocument();
  });

  it('shows a Done today summary from delivered rows', async () => {
    const delivered = summary({ assignment_status: 'DELIVERED', order_status: 'DELIVERED', total_amount: 900 });
    renderAs(ADMIN_WITH_RIDER, '/delivery', { 'GET /riders/deliveries': () => ok({ deliveries: [delivered] }) });
    expect(await screen.findByText('1 delivered · LKR 900 collected')).toBeInTheDocument();
  });
});

describe('Delivery detail - happy path (pickup -> arrive -> collect cash)', () => {
  it('drives PICKED_UP, ARRIVED_AT_CUSTOMER and collect-cod with the exact payloads, in order, never sending a rider id', async () => {
    const user = userEvent.setup();
    stubGeolocation();
    const s = summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' });
    const state = { current: detail(s) };
    const api = renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: state.current }),
      'PATCH /riders/deliveries/:id/status': (call: Call) => {
        // The request body's field is `status` (rider.schema.ts); the
        // response's delivery row field is `assignment_status` - not the
        // same name, so this mock maps one to the other explicitly rather
        // than naively spreading the request body over the response shape.
        state.current = {
          ...state.current,
          assignment_status: call.body.status,
          failure_reason: call.body.failure_reason ?? state.current.failure_reason,
        };
        if (call.body.status === 'PICKED_UP') state.current.order_status = 'OUT_FOR_DELIVERY';
        return ok({ delivery: state.current });
      },
      'POST /riders/deliveries/:id/collect-cod': (call: Call) => {
        state.current = { ...state.current, order_status: 'DELIVERED', assignment_status: 'DELIVERED', cod_collected_amount: call.body.amount, delivered_at: '2026-09-22T10:00:00Z' };
        return ok({ settlement: { delivery_id: s.delivery_id, order_id: s.order_id, order_status: 'DELIVERED', payment_status: 'PAID', cod_collected_amount: call.body.amount, delivered_at: '2026-09-22T10:00:00Z' } });
      },
    }).api;

    await user.click(await screen.findByRole('button', { name: 'Picked up' }));
    await waitFor(() => expect(api.find('PATCH', `/riders/deliveries/${s.delivery_id}/status`)).toHaveLength(1));
    expect(api.find('PATCH', `/riders/deliveries/${s.delivery_id}/status`)[0].body).toEqual({ status: 'PICKED_UP' });

    await user.click(await screen.findByRole('button', { name: "I've arrived" }));
    await waitFor(() => expect(api.find('PATCH', `/riders/deliveries/${s.delivery_id}/status`)).toHaveLength(2));
    expect(api.find('PATCH', `/riders/deliveries/${s.delivery_id}/status`)[1].body).toEqual({ status: 'ARRIVED_AT_CUSTOMER' });

    await user.click(await screen.findByRole('button', { name: /^Collect LKR 610/ }));
    const dialog = await screen.findByRole('dialog', { name: /Collect LKR 610/ });
    await user.type(within(dialog).getByLabelText("Customer's delivery code"), '4821');
    await user.click(within(dialog).getByRole('button', { name: 'Cash collected — complete' }));
    await waitFor(() => expect(api.find('POST', `/riders/deliveries/${s.delivery_id}/collect-cod`)).toHaveLength(1));
    expect(api.find('POST', `/riders/deliveries/${s.delivery_id}/collect-cod`)[0].body).toEqual({ amount: 610, delivery_code: '4821' });

    expect(await screen.findByText('LKR 610 collected')).toBeInTheDocument();

    // Never once, across the whole flow, did the client send a rider id.
    for (const call of [...api.find('PATCH', `/riders/deliveries/${s.delivery_id}/status`), ...api.find('POST', `/riders/deliveries/${s.delivery_id}/collect-cod`)]) {
      expect(call.body).not.toHaveProperty('rider_id');
      expect(call.body).not.toHaveProperty('riderId');
    }
  });
});

describe('COD collection - the amount cannot be freely edited', () => {
  it('shows the amount as fixed text with a confirm step, never an editable field, and sends exactly the API-reported total', async () => {
    const user = userEvent.setup();
    stubGeolocation();
    const s = summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY', total_amount: 1690 });
    const api = renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }),
      'POST /riders/deliveries/:id/collect-cod': () =>
        ok({ settlement: { delivery_id: s.delivery_id, order_id: s.order_id, order_status: 'DELIVERED', payment_status: 'PAID', cod_collected_amount: 1690, delivered_at: '2026-09-22T10:00:00Z' } }),
    }).api;

    await user.click(await screen.findByRole('button', { name: /^Collect LKR 1,690/ }));
    const dialog = await screen.findByRole('dialog', { name: /Collect LKR 1,690/ });
    // No input of any kind for the amount - a static confirmation, not
    // something to fat-finger a different value into. The one textbox is the
    // customer's delivery code (proof of delivery).
    expect(within(dialog).getAllByRole('textbox')).toEqual([within(dialog).getByLabelText("Customer's delivery code")]);
    expect(within(dialog).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(dialog).toHaveTextContent('Collect LKR 1,690 in cash');

    await user.type(within(dialog).getByLabelText("Customer's delivery code"), '0421');
    await user.click(within(dialog).getByRole('button', { name: 'Cash collected — complete' }));
    await waitFor(() =>
      expect(api.find('POST', `/riders/deliveries/${s.delivery_id}/collect-cod`)[0]?.body).toEqual({ amount: 1690, delivery_code: '0421' })
    );
  });
});

describe('Proof of delivery - the customer\'s code', () => {
  it('needs all 4 digits before the cash can be confirmed, and accepts digits only', async () => {
    const user = userEvent.setup();
    stubGeolocation();
    const s = summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY', total_amount: 610 });
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, { 'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }) });
    await user.click(await screen.findByRole('button', { name: /^Collect LKR 610/ }));
    const dialog = await screen.findByRole('dialog', { name: /Collect LKR 610/ });
    const field = within(dialog).getByLabelText("Customer's delivery code");
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(dialog).toHaveTextContent('Ask the customer for the 4-digit code in their Blynk app.');
    const confirm = within(dialog).getByRole('button', { name: 'Cash collected — complete' });
    expect(confirm).toBeDisabled();
    await user.type(field, '12x3');
    expect(field).toHaveValue('123');
    expect(confirm).toBeDisabled();
    await user.type(field, '45');
    expect(field).toHaveValue('1234');
    expect(confirm).toBeEnabled();
  });

  it('a wrong code clears the field and says how many tries are left; a lock disables the step', async () => {
    const user = userEvent.setup();
    stubGeolocation();
    const s = summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY', total_amount: 610 });
    let reply = 0;
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }),
      'POST /riders/deliveries/:id/collect-cod': () =>
        reply++ === 0
          ? { status: 422, error: { code: 'WRONG_DELIVERY_CODE', message: 'x', details: { attempts_remaining: 1 } } }
          : { status: 429, error: { code: 'DELIVERY_CODE_LOCKED', message: 'x', details: { retry_after_seconds: 900 } } },
    });
    await user.click(await screen.findByRole('button', { name: /^Collect LKR 610/ }));
    const dialog = await screen.findByRole('dialog', { name: /Collect LKR 610/ });
    const field = within(dialog).getByLabelText("Customer's delivery code");
    await user.type(field, '1111');
    await user.click(within(dialog).getByRole('button', { name: 'Cash collected — complete' }));
    expect(await within(dialog).findByText("That code doesn't match. 1 try left.")).toBeInTheDocument();
    expect(field).toHaveValue('');
    await user.type(field, '2222');
    await user.click(within(dialog).getByRole('button', { name: 'Cash collected — complete' }));
    expect(await within(dialog).findByText('Too many wrong codes. Try again in 15 minutes.')).toBeInTheDocument();
    expect(field).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cash collected — complete' })).toBeDisabled();
  });
});

describe('Failing a delivery', () => {
  it('needs a reason, and sends it with the request', async () => {
    const user = userEvent.setup();
    stubGeolocation();
    const s = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    const api = renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }),
      'PATCH /riders/deliveries/:id/status': () => ok({ delivery: detail(s, { assignment_status: 'FAILED', order_status: 'FAILED', failure_reason: 'Gate locked, no answer' }) }),
    }).api;

    await user.click(await screen.findByRole('button', { name: "Can't deliver" }));
    const dialog = await screen.findByRole('dialog', { name: "Can't deliver this order" });
    const confirm = within(dialog).getByRole('button', { name: "Mark as couldn't deliver" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('What happened?'), 'Gate locked, no answer');
    await user.click(confirm);
    await waitFor(() => expect(api.find('PATCH', `/riders/deliveries/${s.delivery_id}/status`)[0]?.body).toEqual({ status: 'FAILED', failure_reason: 'Gate locked, no answer' }));
    expect(await screen.findByText('You reported: Gate locked, no answer')).toBeInTheDocument();
  });
});

describe('Wrong-rider / bad id - not-found, never a permissions error', () => {
  it('a 404 DELIVERY_NOT_FOUND on load renders a clean not-found state', async () => {
    renderAs(ADMIN_WITH_RIDER, '/delivery/not-mine', { 'GET /riders/deliveries/:id': () => fail(404, 'DELIVERY_NOT_FOUND') });
    expect(await screen.findByText('Delivery not found.')).toBeInTheDocument();
    expect(screen.queryByText(/not allowed|forbidden|permission/i)).not.toBeInTheDocument();
  });

  it('a malformed id (400 VALIDATION_ERROR from the backend\'s uuid() param check) renders the SAME not-found state, not a validation error', async () => {
    renderAs(ADMIN_WITH_RIDER, '/delivery/not-a-uuid', { 'GET /riders/deliveries/:id': () => fail(400, 'VALIDATION_ERROR') });
    expect(await screen.findByText('Delivery not found.')).toBeInTheDocument();
    expect(screen.queryByText(/not allowed|forbidden|permission/i)).not.toBeInTheDocument();
  });

  it('a mid-session RIDER_PROFILE_NOT_FOUND on load shows the honest message, not a crash', async () => {
    const s = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
      // refreshRiderCapability() re-probes this endpoint.
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
    });
    expect(await screen.findByText('No rider profile is linked to this account yet.')).toBeInTheDocument();
  });

  it('a stale rejection (409) reloads and shows what changed, never a silent failure', async () => {
    const user = userEvent.setup();
    stubGeolocation();
    const s = summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' });
    const api = renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }),
      'PATCH /riders/deliveries/:id/status': () => fail(409, 'INVALID_DELIVERY_TRANSITION'),
    }).api;

    await userEventClick(user, 'Picked up');
    expect(await screen.findByText('This delivery changed. Showing the latest.')).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', `/riders/deliveries/${s.delivery_id}`).length).toBeGreaterThanOrEqual(2));
  });
});

async function userEventClick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name }));
}

describe('Live location (foreground browser Geolocation only)', () => {
  it('never calls watchPosition merely because the screen is open - only once the delivery is genuinely trackable', async () => {
    const { watchPosition } = stubGeolocation();
    const s = summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' }); // not yet trackable
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, { 'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }) });
    await screen.findByRole('button', { name: 'Picked up' });
    await new Promise((r) => setTimeout(r, 20));
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('calls watchPosition once a delivery is PICKED_UP and OUT_FOR_DELIVERY, and shows the real (never-a-coordinate) status readout', async () => {
    const { watchPosition } = stubGeolocation();
    const s = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, { 'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }) });
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Sharing your location/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/-?\d+\.\d{3,}/); // no raw lat/lng ever rendered
  });

  it('stops tracking (clearWatch) once the rider arrives, even though the screen stays open', async () => {
    const user = userEvent.setup();
    const { watchPosition, clearWatch } = stubGeolocation();
    const s = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }),
      'PATCH /riders/deliveries/:id/status': () => ok({ delivery: detail(s, { assignment_status: 'ARRIVED_AT_CUSTOMER' }) }),
    });
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: "I've arrived" }));
    await waitFor(() => expect(clearWatch).toHaveBeenCalledTimes(1));
  });

  it('stops tracking on navigating away from the Delivery Detail screen (unmount) - the foreground-only limitation', async () => {
    const { watchPosition, clearWatch } = stubGeolocation();
    const s = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    const { unmount } = renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, { 'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }) });
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() => expect(clearWatch).toHaveBeenCalledTimes(1));
  });

  it('stops tracking on a 404 DELIVERY_NOT_FOUND from the location endpoint (server-authoritative stop)', async () => {
    const { watchPosition, clearWatch } = stubGeolocation();
    const s = summary({ assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });
    renderAs(ADMIN_WITH_RIDER, `/delivery/${s.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail(s) }),
      'POST /riders/deliveries/:id/location': () => fail(404, 'DELIVERY_NOT_FOUND'),
    });
    await waitFor(() => expect(watchPosition).toHaveBeenCalledTimes(1));
    const onPoint = watchPosition.mock.calls[0][0] as PositionCallback;
    onPoint({ coords: { latitude: 6.9, longitude: 79.8, accuracy: 8 }, timestamp: Date.now() } as GeolocationPosition);
    await waitFor(() => expect(clearWatch).toHaveBeenCalledTimes(1));
  });
});
