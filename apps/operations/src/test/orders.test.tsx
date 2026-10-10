import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { BoardOrder, OrderDetail } from '../api/types';
import { addDays, colomboDate, colomboInstant } from '../lib/slots';
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
  it('reads every page of live orders in turn, so none is hidden', async () => {
    const all = Array.from({ length: 140 }, () => boardOrder());
    const { api } = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([]),
      'GET /admin/orders': (call: Call) => {
        if (call.query.since) return ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } });
        const n = Number(call.query.page ?? '1');
        return ok({ orders: all.slice((n - 1) * 100, n * 100), pagination: { page: n, limit: 100, total: 140, total_pages: 2 } });
      },
    });
    const toPack = await lane('To pack');
    await waitFor(() => expect(within(toPack).getAllByRole('listitem')).toHaveLength(140), { timeout: 5_000 });
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
    const live = api.find('GET', '/admin/orders').filter((c) => !c.query.since);
    expect(live.map((c) => [c.query.page, c.query.limit])).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
  });

  it('stops at the page bound and says so', async () => {
    const { api } = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([]),
      'GET /admin/orders': (call: Call) => {
        if (call.query.since) return ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } });
        const n = Number(call.query.page ?? '1');
        const orders = Array.from({ length: 100 }, (_, i) => boardOrder({ id: `o-${n}-${i}` }));
        return ok({ orders, pagination: { page: n, limit: 100, total: 2500, total_pages: 25 } });
      },
    });
    expect(
      await screen.findByText(/Showing 2000 of 2500 live orders \(the oldest first\) — the board loads at most 2,000/, undefined, {
        timeout: 20_000,
      })
    ).toBeInTheDocument();
    expect(api.find('GET', '/admin/orders').filter((c) => !c.query.since)).toHaveLength(20);
  }, 30_000);

  it('a substitution with its cost packs; one without shows "Substitution needs a cost"', async () => {
    const costed = boardOrder({
      items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 1, uncosted_substitutions: 0 },
    });
    const uncosted = boardOrder({
      items_summary: { total: 2, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 1, uncosted_substitutions: 1 },
    });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([costed, uncosted]));
    const toPack = await lane('To pack');
    const rows = within(toPack).getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: /^Pack #/ })).toBeEnabled();
    expect(within(rows[0]).queryByText('Substitution needs a cost')).not.toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: /^Pack #/ })).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Substitution needs a cost')).toBeInTheDocument();
  });

  it('shows no cap notice when everything fits on one page', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([boardOrder()]));
    await lane('To pack');
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
  });

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
    expect(toPack).toHaveTextContent('3 items to pack');
    expect(toPack).not.toHaveTextContent(/sourc/i);
    expect(toPack).toHaveTextContent('23 min');
    // No sourcing step: an order with items still pending packs straight away.
    expect(within(toPack).getByRole('button', { name: /^Pack/ })).toBeInTheDocument();
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
      // directly so `orderErrorMessage`'s `details` read is real.
      'PATCH /admin/orders/:id/status': () => ({
        status: 422,
        error: { code: 'ORDER_NOT_PACKABLE', message: 'ORDER_NOT_PACKABLE', details: { unsourced_substitutions: 1, packable_items: 1 } },
      }),
    }).api;
    await user.click(within(await lane('To pack')).getByRole('button', { name: /^Pack/ }));
    expect(await screen.findByText('Something changed: 1 substitution still to source.')).toBeInTheDocument();
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

  it('a just-placed order offers Pack - no sourcing hint or link', async () => {
    const o = boardOrder({
      order_status: 'PLACED',
      items_summary: { total: 2, pending: 2, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
    });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([o]));
    expect(await screen.findByRole('button', { name: `Pack #${o.order_number.split('-').pop()}` })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /Source/ })).not.toBeInTheDocument();
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
    // No additional number on this order.
    expect(screen.queryByText(/Additional phone/)).not.toBeInTheDocument();
    expect(screen.getByText('Order placed by customer')).toBeInTheDocument();
    expect(screen.getByText('Farhan Mohamed')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cost|supplier/i);
  });

  it('shows the additional phone with its own call link when the order has one', async () => {
    const o = boardOrder({ order_status: 'PLACED' });
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o, { delivery_alternate_phone: '+94712345678' }) }),
    });
    const alt = await screen.findByRole('link', { name: 'Call additional phone for Ahmed Rizvi' });
    expect(alt).toHaveAttribute('href', 'tel:+94712345678');
    expect(screen.getByText(/Additional phone/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Call Ahmed Rizvi/ })).toHaveAttribute('href', 'tel:+94771234567');
  });

  it('derives the same actions a board row with this data would offer - reachable by direct navigation, with no board data in memory', async () => {
    const o = boardOrder({ order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }) });
    expect(await screen.findByRole('button', { name: 'Assign rider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });

  it('the detail holds Pack back only while a substitution lacks its cost', async () => {
    const o = boardOrder();
    const items = (cost: string | null) => [
      { id: 'i1', product_name_snapshot: 'Milk', quantity: 1, item_status: 'PENDING' as const },
      { id: 'i2', product_name_snapshot: 'Butter (substitute)', quantity: 1, item_status: 'SUBSTITUTED' as const, actual_unit_cost: cost },
    ];
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: orderDetail(o, { items: items(null) }) }) });
    expect(await screen.findByRole('button', { name: 'Pack' })).toBeDisabled();
    expect(screen.getByText('Substitution needs a cost')).toBeInTheDocument();
    cleanup();
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: orderDetail(o, { items: items('120.00') }) }) });
    expect(await screen.findByRole('button', { name: 'Pack' })).toBeEnabled();
    expect(screen.queryByText('Substitution needs a cost')).not.toBeInTheDocument();
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

  it('marking delivered without the customer code needs a written override note, and refetches on success', async () => {
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
    await user.click(within(dialog).getByRole('button', { name: "The customer can't show the code" }));
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Override note/), 'Rider phone died; cash counted at the store');
    await user.click(confirm);
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'DELIVERED', notes: 'Rider phone died; cash counted at the store' }));
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
  });

  it("marking delivered with the customer's code sends only the code, digits only", async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd1', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const api = renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () =>
        ok({ order: orderDetail(o, { delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_name: 'Farhan Mohamed' } }) }),
      'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'DELIVERED' } }),
    }).api;
    await user.click(await screen.findByRole('button', { name: 'Mark delivered' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    const field = within(dialog).getByLabelText("Customer's delivery code");
    expect(field).toHaveAttribute('inputmode', 'numeric');
    const confirm = within(dialog).getByRole('button', { name: 'Mark delivered' });
    await user.type(field, '48a2');
    expect(field).toHaveValue('482');
    expect(confirm).toBeDisabled();
    await user.type(field, '1');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'DELIVERED', delivery_code: '4821' }));
  });

  it('a wrong delivery code keeps the dialog open with the tries left; a lock says how long', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd1', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    let reply = 0;
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () =>
        ok({ order: orderDetail(o, { delivery: { id: 'd1', rider_id: 'r1', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_name: 'Farhan Mohamed' } }) }),
      'PATCH /admin/orders/:id/status': () =>
        reply++ === 0
          ? { status: 422, error: { code: 'WRONG_DELIVERY_CODE', message: 'x', details: { attempts_remaining: 3 } } }
          : { status: 429, error: { code: 'DELIVERY_CODE_LOCKED', message: 'x', details: { retry_after_seconds: 840 } } },
    });
    await user.click(await screen.findByRole('button', { name: 'Mark delivered' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    const field = within(dialog).getByLabelText("Customer's delivery code");
    await user.type(field, '1111');
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }));
    expect(await within(dialog).findByText("That code doesn't match. 3 tries left.")).toBeInTheDocument();
    expect(field).toHaveValue('');
    await user.type(field, '2222');
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }));
    expect(await within(dialog).findByText('Too many wrong codes. Try again in 14 minutes.')).toBeInTheDocument();
    expect(field).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Mark delivered' })).toBeDisabled();
  });

  it('packs straight from Placed while items are still to pack - no sourcing hint or link', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PLACED' });
    const pending = orderDetail(o, {
      items: [
        { id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PENDING' },
        { id: 'i2', product_name_snapshot: 'Pelwatte Butter 200g', quantity: 1, item_status: 'PENDING' },
      ],
    });
    const api = renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => ok({ order: pending }),
      'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'PACKED' } }),
    }).api;
    const pack = await screen.findByRole('button', { name: 'Pack' });
    expect(pack).toBeEnabled();
    expect(screen.getAllByText('To pack')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/sourc/i);
    await user.click(pack);
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'PACKED' }));
  });

  it('a product short on stock is named when packing is refused', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PLACED' });
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }),
      'PATCH /admin/orders/:id/status': () => ({
        status: 409,
        error: {
          code: 'INSUFFICIENT_TRACKED_INVENTORY',
          message: 'x',
          details: { product_id: 'p1', product_name: 'Kotmale Fresh Milk 1L', on_hand: 1, requested: 2 },
        },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Pack' }));
    expect(
      await screen.findByText('Not enough Kotmale Fresh Milk 1L in stock to pack this order (1 on hand, 2 needed). Restock it or mark it unavailable.')
    ).toBeInTheDocument();
  });

  it('an item not on the shelf can be marked unavailable from the order', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PLACED' });
    const api = renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, {
      'GET /admin/orders/:id': () =>
        ok({ order: orderDetail(o, { items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PENDING' }] }) }),
      'POST /admin/orders/:id/resolve-item': () => ok({ order: {} }),
    }).api;
    await user.click(await screen.findByRole('button', { name: 'Mark Kotmale Fresh Milk 1L unavailable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark item unavailable' });
    expect(api.find('POST', `/admin/orders/${o.id}/resolve-item`)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));
    await waitFor(() =>
      expect(api.find('POST', `/admin/orders/${o.id}/resolve-item`)[0]?.body).toEqual({ item_id: 'i1', item_status: 'UNAVAILABLE' })
    );
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

describe('Assign dialog: suggested rider and trips (GET /admin/riders/suggestions)', () => {
  const rules = { max_active_deliveries: 2, max_dropoff_distance_km: 1.5, location_fresh_minutes: 15 };
  const base = {
    phone: '+94770000000',
    vehicle_type: 'MOTORCYCLE',
    at_capacity: false,
    last_seen_at: null,
    location_known: false,
    distance_km: null,
    trip: [],
    trip_within_distance: true,
    suggested: false,
  };
  const SUGGESTIONS = [
    { ...base, id: 'r2', full_name: 'Nimal Perera', vehicle_registration_number: 'WP-AAA-1111', open_deliveries: 0, location_known: true, distance_km: 0.8, last_seen_at: new Date().toISOString(), suggested: true },
    { ...base, id: 'r3', full_name: 'Kasun Silva', vehicle_registration_number: 'WP-BBB-2222', open_deliveries: 0 },
    {
      ...base, id: 'r1', full_name: 'Farhan Mohamed', vehicle_registration_number: 'WP-BCX-8842', open_deliveries: 1,
      trip: [{ order_id: 'x1', order_number: 'BL-20260919-0001', assignment_status: 'ASSIGNED', dropoff_distance_km: 0.7 }],
    },
    {
      ...base, id: 'r4', full_name: 'Ruwan Jay', vehicle_registration_number: 'WP-CCC-3333', open_deliveries: 1,
      trip: [{ order_id: 'x2', order_number: 'BL-20260919-0002', assignment_status: 'PICKED_UP', dropoff_distance_km: 3.4 }],
      trip_within_distance: false,
    },
    { ...base, id: 'r5', full_name: 'Full Trip', vehicle_registration_number: 'WP-DDD-4444', open_deliveries: 2, at_capacity: true },
  ];

  async function openDialog(extra: Record<string, (call: Call) => unknown> = {}) {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const api = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'GET /admin/riders/suggestions': () => ok({ order_id: o.id, rules, riders: SUGGESTIONS }),
      'POST /admin/orders/:id/assign-rider': () => ok({ delivery: { id: 'd9' } }),
      ...extra,
    }).api;
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await within(dialog).findByRole('radio', { name: /Nimal Perera/ });
    return { user, o, api, dialog };
  }

  it('lists riders best first, marks exactly one Suggested, and says how far each is', async () => {
    const { o, api, dialog } = await openDialog();
    expect(api.find('GET', '/admin/riders/suggestions')[0]?.query).toEqual({ order_id: o.id });
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['r2', 'r3', 'r1', 'r4', 'r5']);
    expect(within(dialog).getAllByText('Suggested')).toHaveLength(1);
    expect(within(dialog).getByRole('radio', { name: /Nimal Perera/ })).toHaveAccessibleName(/Suggested/);
    expect(dialog).toHaveTextContent('about 0.8 km away');
    expect(within(dialog).getByRole('radio', { name: /Kasun Silva/ }).closest('label')).toHaveTextContent('location unknown');
    // Nothing is chosen for the operator.
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it("a rider with one order: \"Add to Farhan's trip (0.7 km from their other drop-off)\" and a plain assign", async () => {
    const { user, o, api, dialog } = await openDialog();
    expect(dialog).toHaveTextContent("Add to Farhan's trip (0.7 km from their other drop-off)");
    await user.click(within(dialog).getByRole('radio', { name: /Farhan Mohamed/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add to trip' }));
    await waitFor(() => expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)[0]?.body).toEqual({ rider_id: 'r1' }));
  });

  it('a far trip is flagged and needs "Add to trip anyway", which confirms it to the API', async () => {
    const { user, o, api, dialog } = await openDialog();
    expect(dialog).toHaveTextContent("Add to Ruwan's trip (3.4 km from their other drop-off, more than 1.5 km)");
    await user.click(within(dialog).getByRole('radio', { name: /Ruwan Jay/ }));
    expect(within(dialog).getByText(/These drop-offs are far apart/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add to trip anyway' }));
    await waitFor(() =>
      expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)[0]?.body).toEqual({ rider_id: 'r4', confirm_far_batch: true })
    );
  });

  it('a full trip cannot be picked', async () => {
    const { dialog } = await openDialog();
    const full = within(dialog).getByRole('radio', { name: /Full Trip/ });
    expect(full).toBeDisabled();
    expect(full.closest('label')).toHaveTextContent('Trip full (2 orders)');
  });

  it('a trip that filled up meanwhile (409 RIDER_AT_CAPACITY) is reported plainly', async () => {
    const { user, dialog } = await openDialog({
      'POST /admin/orders/:id/assign-rider': () => ({
        status: 409,
        error: { code: 'RIDER_AT_CAPACITY', message: 'x', details: { open_deliveries: 2, max_active_deliveries: 2 } },
      }),
    });
    await user.click(within(dialog).getByRole('radio', { name: /Farhan Mohamed/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add to trip' }));
    expect(await screen.findByText("That rider's trip is full (2 orders). Choose another rider.")).toBeInTheDocument();
  });

  it('falls back to the plain roster when suggestions cannot be loaded (no distances invented)', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'GET /admin/riders/suggestions': () => fail(500, 'INTERNAL', 'boom'),
    });
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    expect(await within(dialog).findByRole('radio', { name: /Farhan Mohamed/ })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/km|location unknown|Suggested/);
  });

  it('roster fallback: a 409 BATCH_DROPOFFS_TOO_FAR keeps the dialog open and offers "Add to trip anyway"', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/orders', {
      ...ordersHandlers([o]),
      'GET /admin/riders/suggestions': () => fail(500, 'INTERNAL', 'boom'),
      'POST /admin/orders/:id/assign-rider': (call: Call) =>
        call.body.confirm_far_batch
          ? ok({ delivery: { id: 'd9' } })
          : {
              status: 409,
              error: { code: 'BATCH_DROPOFFS_TOO_FAR', message: 'too far', details: { distance_km: 3.4 } },
            },
    });
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await user.click(await within(dialog).findByRole('radio', { name: /Farhan Mohamed/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));

    expect(await within(dialog).findByText(/This drop-off is 3.4 km from that rider's other one/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Assign a rider/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add to trip anyway' }));

    await waitFor(() => expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)).toHaveLength(2));
    expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)[1].body).toEqual({ rider_id: 'r1', confirm_far_batch: true });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Assign a rider/ })).not.toBeInTheDocument());
  });
});

describe('Scheduled delivery slots on the board and detail (owner, 2026-10-10)', () => {
  const tomorrow = () => addDays(colomboDate(new Date()), 1);
  const slot = (day: string, from: string, to: string) => ({
    scheduled_for: colomboInstant(day, from).toISOString(),
    scheduled_until: colomboInstant(day, to).toISOString(),
  });

  it('a ticket says "Scheduled: Tomorrow 8–10 AM"; an older order without a slot end shows just the start', async () => {
    const a = boardOrder(slot(tomorrow(), '08:00', '10:00'));
    const b = boardOrder({ scheduled_for: colomboInstant(tomorrow(), '16:00').toISOString(), scheduled_until: null });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([a, b]));
    const toPack = await lane('To pack');
    expect(toPack).toHaveTextContent('Scheduled: Tomorrow 8–10 AM');
    expect(toPack).toHaveTextContent('Scheduled: Tomorrow 4 PM');
  });

  it('ASAP orders keep their order at the top of a lane; scheduled ones follow, earliest slot first', async () => {
    const late = boardOrder({ ...slot(tomorrow(), '16:00', '18:00'), delivery_recipient_name: 'Late Slot' });
    const asap1 = boardOrder({ delivery_recipient_name: 'Asap One' });
    const early = boardOrder({ ...slot(tomorrow(), '08:00', '10:00'), delivery_recipient_name: 'Early Slot' });
    const asap2 = boardOrder({ delivery_recipient_name: 'Asap Two' });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([late, asap1, early, asap2]));
    const toPack = await lane('To pack');
    const names = within(toPack)
      .getAllByRole('listitem')
      .map((li) => ['Asap One', 'Asap Two', 'Early Slot', 'Late Slot'].find((n) => li.textContent?.includes(n)));
    expect(names).toEqual(['Asap One', 'Asap Two', 'Early Slot', 'Late Slot']);
  });

  it('the Scheduled filter shows only scheduled orders, grouped by slot, earliest first', async () => {
    const user = userEvent.setup();
    const late = boardOrder({ ...slot(tomorrow(), '16:00', '18:00'), delivery_recipient_name: 'Late Slot' });
    const asap = boardOrder({ delivery_recipient_name: 'Asap One' });
    const early1 = boardOrder({ ...slot(tomorrow(), '08:00', '10:00'), delivery_recipient_name: 'Early One' });
    const early2 = boardOrder({ ...slot(tomorrow(), '08:00', '10:00'), delivery_recipient_name: 'Early Two', order_status: 'PACKED' });
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([late, asap, early1, early2]));
    const filter = await screen.findByRole('group', { name: 'Show orders' });
    expect(within(filter).getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(filter).getByRole('button', { name: 'Scheduled 3' }));

    expect(screen.queryByRole('region', { name: /^To pack/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Asap One')).not.toBeInTheDocument();
    const slots = screen.getAllByRole('region', { name: /^Tomorrow/ });
    expect(slots.map((r) => within(r).getByRole('heading').textContent)).toEqual([
      'Tomorrow 8–10 AM 2',
      'Tomorrow 4–6 PM 1',
    ]);
    expect(slots[0]).toHaveTextContent('Early One');
    expect(slots[0]).toHaveTextContent('Early Two');
    expect(slots[1]).toHaveTextContent('Late Slot');

    await user.click(within(filter).getByRole('button', { name: 'All 4' }));
    expect(await lane('To pack')).toHaveTextContent('Asap One');
  });

  it('with no scheduled orders the Scheduled filter says so', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/orders', ordersHandlers([boardOrder()]));
    await user.click(await screen.findByRole('button', { name: 'Scheduled 0' }));
    expect(screen.getByText(/No scheduled orders/)).toBeInTheDocument();
  });

  it('the order detail shows the slot clearly; an ASAP order shows none', async () => {
    const o = boardOrder(slot(tomorrow(), '11:00', '13:00'));
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: orderDetail(o, { scheduled_until: o.scheduled_until }) }) });
    expect(await screen.findByTestId('order-slot')).toHaveTextContent('Scheduled: Tomorrow 11 AM–1 PM');
    cleanup();
    const asap = boardOrder();
    renderAs(ADMIN_WITH_RIDER, `/orders/${asap.id}`, { 'GET /admin/orders/:id': () => ok({ order: orderDetail(asap) }) });
    expect(await screen.findByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
    expect(screen.queryByTestId('order-slot')).not.toBeInTheDocument();
  });
});
