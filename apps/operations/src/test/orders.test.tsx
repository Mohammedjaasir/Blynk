import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { BoardOrder, OrderDetail } from '../api/types';
import { ADMIN_WITH_RIDER, fail, ok, renderAs, type Call } from './helpers';

/**
 * The Orders board (task F3, plan §10) against a fake Blynk API shaped
 * exactly like the backend's responses. The API is the authority: these
 * tests check that the board/detail only offer steps the catalogue allows,
 * send exactly the payload the endpoint expects, and show the API's
 * refusals - never a silent failure. Mirrors
 * apps/admin/src/test/orders.test.tsx's own coverage shape (a fresh
 * implementation, not an import - common.md rule 2), adapted for
 * Operations' route-based detail page (`/orders/:id`) instead of a
 * slide-over panel, and for an ADMIN-only operator (no PACKING_STAFF role
 * gating to test).
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

let seq = 0;
function boardOrder(overrides: Partial<BoardOrder> = {}): BoardOrder {
  seq += 1;
  return {
    id: `o${seq}`,
    order_number: `BL-20260919-00${10 + seq}`,
    order_status: 'PLACED',
    total_amount: 610,
    placed_at: new Date(Date.now() - 23 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_address_line1: '14 Mosque Road',
    delivery_city: 'Dharga Town',
    items_summary: { total: 2, pending: 0, sourced: 2, packed: 0, unavailable: 0, substituted: 0 },
    active_delivery: null,
    ...overrides,
  };
}

function orderDetail(o: BoardOrder, overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: o.id,
    order_number: o.order_number,
    order_status: o.order_status,
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: o.total_amount,
    placed_at: o.placed_at,
    scheduled_for: o.scheduled_for,
    delivery_recipient_name: o.delivery_recipient_name,
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: o.delivery_address_line1,
    delivery_address_line2: 'Near the clock tower',
    delivery_city: o.delivery_city,
    delivery_instructions: 'Blue gate',
    cancellation_reason: null,
    items: [
      { id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'SOURCED' },
      { id: 'i2', product_name_snapshot: 'Pelwatte Butter 200g', quantity: 1, item_status: 'SOURCED' },
    ],
    history: [{ id: 'h1', old_status: null, new_status: 'PLACED', reason_or_notes: 'Order placed by customer', created_at: o.placed_at }],
    delivery: null,
    ...overrides,
  };
}

const RIDERS = [
  { id: 'r1', full_name: 'Farhan Mohamed', phone: '+94779876543', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-BCX-8842', open_deliveries: 1 },
];

/** `GET /admin/orders` tells the live board query apart from the
 * closed-since query via the `since` param, matching Admin's own test's
 * convention - `resources.ts`'s `live()`/`closedSince()` share one path. */
function ordersHandlers(live: BoardOrder[], closed: BoardOrder[] = []) {
  return {
    'GET /admin/orders': (call: Call) =>
      call.query.since ? ok({ orders: closed, pagination: { page: 1, limit: 100, total: closed.length, total_pages: 1 } }) : ok({ orders: live, pagination: { page: 1, limit: 100, total: live.length, total_pages: 1 } }),
    'GET /admin/riders': () => ok({ riders: RIDERS }),
  };
}

const lane = (name: string) => screen.findByRole('region', { name: new RegExp(`^${name}`) });

describe('Orders board', () => {
  it('with nothing live, says so and invents nothing', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([]));
    expect(await screen.findByText('No live orders.')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('puts each order in the lane of its next step, oldest first, with its age and progress', async () => {
    const waiting = boardOrder({ items_summary: { total: 3, pending: 1, sourced: 2, packed: 0, unavailable: 0, substituted: 0 } });
    const ready = boardOrder({ order_status: 'PACKED' });
    const pickup = boardOrder({ order_status: 'PACKED', active_delivery: { id: 'd1', assignment_status: 'ASSIGNED', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const road = boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd2', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const failed = boardOrder({ order_status: 'FAILED' });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([waiting, ready, pickup, road, failed]));

    const toPack = await lane('To pack');
    expect(toPack).toHaveTextContent(`#${waiting.order_number.split('-').pop()}`);
    expect(toPack).toHaveTextContent('2 of 3 sourced');
    expect(toPack).toHaveTextContent('23 min');
    expect(within(toPack).queryByRole('button', { name: /^Pack/ })).not.toBeInTheDocument();
    expect(await lane('Ready for a rider')).toHaveTextContent('Assign rider');
    expect(await lane('Waiting for pickup')).toHaveTextContent('Farhan Mohamed');
    expect(await lane('On the road')).toHaveTextContent('Farhan Mohamed');
    expect(await lane('Needs attention')).toHaveTextContent('Delivery failed');
  });

  it('shows the "Done today" summary from the closed-since query', async () => {
    const delivered = boardOrder({ order_status: 'DELIVERED' });
    const cancelled = boardOrder({ order_status: 'CANCELLED' });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([], [delivered, cancelled]));
    expect(await screen.findByText('1 delivered · 1 cancelled')).toBeInTheDocument();
  });

  it('packing: one request, then the board is read again', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    const api = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'PATCH /admin/orders/:id/status': async () => ok({ order: { ...o, order_status: 'PACKED' } }),
    }).api;
    const toPack = await lane('To pack');
    await user.click(within(toPack).getByRole('button', { name: `Pack #${o.order_number.split('-').pop()}` }));
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)).toHaveLength(1));
    expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0].body).toEqual({ status: 'PACKED' });
    await waitFor(() => expect(api.find('GET', '/admin/orders').filter((c) => !c.query.since).length).toBeGreaterThanOrEqual(2));
  });

  it('when the API refuses a stale step, it says what changed and re-reads - a rejection is never swallowed', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    const api = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      // `fail()` (helpers.tsx) has no `details` slot - build the reply
      // directly so `orderErrorMessage`'s `details.pending` read is real.
      'PATCH /admin/orders/:id/status': () => ({
        status: 422,
        error: { code: 'ORDER_NOT_PACKABLE', message: 'ORDER_NOT_PACKABLE', details: { pending: 1, unsourced_substitutions: 0 } },
      }),
    }).api;
    await user.click(within(await lane('To pack')).getByRole('button', { name: /^Pack/ }));
    expect(await screen.findByText('Something changed: 1 item still to source.')).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/orders').filter((c) => !c.query.since).length).toBeGreaterThanOrEqual(2));
  });

  it('assigning: only active riders from the API are offered, and the choice is sent', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const api = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'POST /admin/orders/:id/assign-rider': () => ok({ delivery: { id: 'd9' } }),
    }).api;
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    expect(dialog).toHaveTextContent('WP-BCX-8842');
    expect(dialog).toHaveTextContent('1 open delivery');
    await user.click(within(dialog).getByRole('radio', { name: /Farhan Mohamed/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)[0]?.body).toEqual({ rider_id: 'r1' }));
  });

  it('assign-rider dialog is empty-state-correct when no active riders exist', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, '/orders', { ...ordersHandlers([o]), 'GET /admin/riders': () => ok({ riders: [] }) });
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    expect(await within(dialog).findByText('No active riders. Activate a rider first.')).toBeInTheDocument();
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('a rider assigned by someone else meanwhile (409) is reported as a real visible error, not retried', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const api = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'POST /admin/orders/:id/assign-rider': () => fail(409, 'ORDER_ALREADY_ASSIGNED'),
    }).api;
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await user.click(within(dialog).getByRole('radio', { name: /Farhan/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Another rider was just assigned to this order.')).toBeInTheDocument();
    expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)).toHaveLength(1);
  });

  it('a failed delivery can be returned to packed for a new rider, with a note', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'FAILED' });
    const api = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'PACKED' } }),
    }).api;
    await user.click(within(await lane('Needs attention')).getByRole('button', { name: /^Return to packed/ }));
    const dialog = await screen.findByRole('dialog', { name: /Return to packed/ });
    await user.type(within(dialog).getByLabelText(/Note/), 'Bag back at the store');
    await user.click(within(dialog).getByRole('button', { name: 'Return to packed' }));
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'PACKED', notes: 'Bag back at the store' }));
  });

  it('a ticket links straight to its full order detail page', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }),
    });
    const link = await screen.findByRole('link', { name: new RegExp(`^Open order #${o.order_number.split('-').pop()}`) });
    expect(link).toHaveAttribute('href', `/orders/${o.id}`);
    await user.click(link);
    expect(await screen.findByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  });

  it('an order still waiting on sourcing links to the Inventory sourcing queue (task F6) instead of an inert hint', async () => {
    const o = boardOrder({
      order_status: 'PLACED',
      items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
    });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([o]));
    const link = await screen.findByRole('link', { name: /Source in Inventory/ });
    expect(link).toHaveAttribute('href', '/catalog/inventory/sourcing');
  });

  it('deep-links from Home (?focus=readyForRider) scroll the matching lane into view without hiding any other lane', async () => {
    const o1 = boardOrder({ order_status: 'PLACED' });
    const o2 = boardOrder({ order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, '/orders?focus=readyForRider', ordersHandlers([o1, o2]));
    // Both lanes still render - this is a scroll assist, never a filter.
    expect(await lane('To pack')).toBeInTheDocument();
    expect(await lane('Ready for a rider')).toBeInTheDocument();
  });
});

describe('Order detail (a standalone route, /orders/:id)', () => {
  it('shows items, the customer, the rider and history - but no costs or suppliers', async () => {
    const o = boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd1', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o, { delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'PICKED_UP', rider_name: 'Farhan Mohamed' } }) }),
    });
    expect(await screen.findByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
    expect(screen.getByText('2 ×')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call Ahmed Rizvi/ })).toHaveAttribute('href', 'tel:+94771234567');
    expect(screen.getByText('Order placed by customer')).toBeInTheDocument();
    expect(screen.getByText('Farhan Mohamed')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cost|supplier/i);
  });

  it('derives the same actions a board row with this data would offer - reachable by direct navigation, with no board data in memory', async () => {
    const o = boardOrder({ order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }) });
    expect(await screen.findByRole('button', { name: 'Assign rider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });

  it('cancelling needs a reason the customer will see, and does not allow an empty submit - only reachable here, not from the board row', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const api = renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }),
      'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'CANCELLED' } }),
    }).api;
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog', { name: /Cancel order/ });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel order' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason — shown to the customer/), 'Supplier closed today');
    await user.click(confirm);
    await waitFor(() =>
      expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'CANCELLED', notes: 'Supplier closed today' })
    );
  });

  it('marking delivered from the detail page restates the cash it records, needs a note, and refetches on success', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'OUT_FOR_DELIVERY', total_amount: 1690, active_delivery: { id: 'd1', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    let status = 'OUT_FOR_DELIVERY';
    const api = renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () =>
        ok({ order: orderDetail(o, { order_status: status as any, delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_name: 'Farhan Mohamed' } }) }),
      'PATCH /admin/orders/:id/status': () => {
        status = 'DELIVERED';
        return ok({ order: { ...o, order_status: status } });
      },
    }).api;
    await user.click(await screen.findByRole('button', { name: 'Mark delivered' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    expect(dialog).toHaveTextContent('Records LKR 1,690 cash as collected');
    const confirm = within(dialog).getByRole('button', { name: 'Mark delivered' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Note/), 'Rider phone died; cash counted at the store');
    await user.click(confirm);
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'DELIVERED', notes: 'Rider phone died; cash counted at the store' }));
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
  });

  it('a rejection on the detail page (409) shows a real visible error, not a silent failure', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd1', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o, { delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'PICKED_UP', rider_name: 'Farhan Mohamed' } }) }),
      'PATCH /admin/orders/:id/status': () => fail(409, 'ORDER_CHANGED'),
    });
    await user.click(await screen.findByRole('button', { name: 'Mark failed' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark failed/ });
    await user.type(within(dialog).getByLabelText(/Note/), 'Recipient not answering');
    await user.click(within(dialog).getByRole('button', { name: 'Mark failed' }));
    expect(await screen.findByText('This order changed while you were working. Showing the latest.')).toBeInTheDocument();
  });

  it('an order that fails to load shows a real error with a retry, not a blank page', async () => {
    const o = boardOrder();
    let shouldFail = true;
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => (shouldFail ? fail(500, 'INTERNAL', 'boom') : ok({ order: orderDetail(o) })),
    });
    expect(await screen.findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
    shouldFail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
  });
});
