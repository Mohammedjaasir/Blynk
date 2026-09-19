import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';

/**
 * The staff Orders board (dispatch plan Task 10) against a fake Blynk API
 * shaped exactly like the backend's responses. The API is the authority:
 * these tests check that the board only offers steps the catalogue allows,
 * sends exactly one request per step, and shows the API's refusals.
 */
type Reply = { status: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };
type Handler = (call: { method: string; path: string; query: URLSearchParams; body: any }) => Reply | unknown;
const ok = (data: unknown): Reply => ({ status: 200, data });
const fail = (status: number, code: string, details?: unknown): Reply => ({ status, error: { code, message: code, details } });

function mockApi(handlers: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; query: URLSearchParams; body: any }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const method = (init?.method ?? 'GET').toUpperCase();
      const call = { method, path, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      const key = Object.keys(handlers).find((k) => {
        const [m, pattern] = k.split(' ');
        return m === method && new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(path);
      });
      const raw = key ? await handlers[key](call) : fail(404, 'NOT_MOCKED');
      const reply = raw && typeof raw === 'object' && 'status' in (raw as object) ? (raw as Reply) : { status: 200, data: raw };
      const body = reply.status < 400 ? { success: true, data: reply.data } : { success: false, error: reply.error };
      return { ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(body) } as Response;
    })
  );
  return { calls, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };
const STAFF = { id: 's1', phone: '+94774443322', full_name: 'Kasun Perera', email: null, role: 'PACKING_STAFF' };

// Fixtures shaped like GET /admin/orders rows (test data only).
let seq = 0;
function boardOrder(overrides: Record<string, unknown> = {}) {
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
function orderDetail(o: ReturnType<typeof boardOrder>, overrides: Record<string, unknown> = {}) {
  return {
    ...o,
    payment_method: 'COD',
    payment_status: 'PENDING',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line2: 'Near the clock tower',
    delivery_instructions: 'Blue gate',
    cancellation_reason: null,
    items: [
      { id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'SOURCED', estimated_unit_cost: 450, actual_unit_cost: 455 },
      { id: 'i2', product_name_snapshot: 'Pelwatte Butter 200g', quantity: 1, item_status: 'SOURCED', estimated_unit_cost: 700, actual_unit_cost: 690 },
    ],
    history: [{ id: 'h1', old_status: null, new_status: 'PLACED', reason_or_notes: 'Order placed by customer', created_at: o.placed_at }],
    delivery: null,
    ...overrides,
  };
}

const RIDERS = [
  { id: 'r1', full_name: 'Farhan Mohamed', phone: '+94779876543', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-BCX-8842', open_deliveries: 1 },
];

function renderBoard(user: typeof ADMIN, orders: unknown[], handlers: Record<string, Handler> = {}) {
  tokenStore.save('access', 'refresh');
  const api = mockApi({
    'GET /auth/me': () => ok(user),
    'GET /admin/orders': (c) =>
      c.query.get('since')
        ? ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } })
        : ok({ orders, pagination: { page: 1, limit: 100, total: orders.length, total_pages: 1 } }),
    'GET /admin/riders': () => ok({ riders: RIDERS }),
    ...handlers,
  });
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}
const lane = (name: string) => screen.findByRole('region', { name: new RegExp(`^${name}`) });

describe('Orders board', () => {
  beforeEach(() => {
    tokenStore.clear();
    seq = 0;
  });
  afterEach(() => {
    tokenStore.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('with nothing live, says so and invents nothing', async () => {
    renderBoard(STAFF, []);
    expect(await screen.findByText('No live orders.')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('puts each order in the lane of its next step, oldest first, with its age and progress', async () => {
    const waiting = boardOrder({ items_summary: { total: 3, pending: 1, sourced: 2, packed: 0, unavailable: 0, substituted: 0 } });
    const ready = boardOrder({ order_status: 'PACKED' });
    const pickup = boardOrder({ order_status: 'PACKED', active_delivery: { id: 'd1', assignment_status: 'ASSIGNED', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const road = boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd2', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const failed = boardOrder({ order_status: 'FAILED' });
    renderBoard(ADMIN, [waiting, ready, pickup, road, failed]);

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

  it('packing: one request, even on a double click, then the board is read again', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    let status = 'PLACED';
    const api = renderBoard(STAFF, [o], {
      'PATCH /admin/orders/:id/status': async () => {
        await new Promise((r) => setTimeout(r, 30));
        status = 'PACKED';
        return ok({ order: { ...o, order_status: status } });
      },
    });
    const toPack = await lane('To pack');
    const packButton = within(toPack).getByRole('button', { name: `Pack #${o.order_number.split('-').pop()}` });
    await user.dblClick(packButton);
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)).toHaveLength(1));
    expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0].body).toEqual({ status: 'PACKED' });
    await waitFor(() => expect(api.find('GET', '/admin/orders').length).toBeGreaterThanOrEqual(2));
  });

  it('when the API refuses a stale step, it says what changed and re-reads', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    const api = renderBoard(STAFF, [o], {
      'PATCH /admin/orders/:id/status': () => fail(422, 'ORDER_NOT_PACKABLE', { pending: 1, unsourced_substitutions: 0, packable_items: 1 }),
    });
    await user.click(within(await lane('To pack')).getByRole('button', { name: /^Pack/ }));
    expect(await screen.findByText('Something changed: 1 item still to source.')).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/orders').length).toBeGreaterThanOrEqual(2));
  });

  it('assigning: only active riders from the API are offered, and the choice is sent', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const api = renderBoard(ADMIN, [o], { 'POST /admin/orders/:id/assign-rider': () => ok({ delivery: { id: 'd9' } }) });
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    expect(dialog).toHaveTextContent('WP-BCX-8842');
    expect(dialog).toHaveTextContent('1 open delivery');
    await user.click(within(dialog).getByRole('radio', { name: /Farhan Mohamed/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)[0]?.body).toEqual({ rider_id: 'r1' }));
  });

  it('a rider assigned by someone else meanwhile is reported, not retried', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED' });
    const api = renderBoard(ADMIN, [o], { 'POST /admin/orders/:id/assign-rider': () => fail(409, 'ORDER_ALREADY_ASSIGNED') });
    await user.click(within(await lane('Ready for a rider')).getByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await user.click(within(dialog).getByRole('radio', { name: /Farhan/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Another rider was just assigned to this order.')).toBeInTheDocument();
    expect(api.find('POST', `/admin/orders/${o.id}/assign-rider`)).toHaveLength(1);
  });

  it('packing staff never see admin-only steps', async () => {
    const user = userEvent.setup();
    const orders = [
      boardOrder({ order_status: 'PACKED' }),
      boardOrder({ order_status: 'OUT_FOR_DELIVERY', active_delivery: { id: 'd2', assignment_status: 'PICKED_UP', rider_id: 'r1', rider_name: 'Farhan Mohamed' } }),
      boardOrder({ order_status: 'FAILED' }),
    ];
    renderBoard(STAFF, orders, { 'GET /admin/orders/:id': (c) => ok({ order: orderDetail(orders.find((o) => c.path.endsWith(o.id))!) }) });
    await lane('Ready for a rider');
    for (const label of [/Assign rider/, /Cancel order/, /Mark delivered/, /Mark failed/, /Return to packed/]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: new RegExp(`Open order #${orders[1].order_number.split('-').pop()}`) }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    expect(within(panel).queryAllByRole('button', { name: /Mark|Cancel order|Return to packed/ })).toHaveLength(0);
  });

  it('cancelling needs a reason the customer will see, and a confirmation', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    const api = renderBoard(ADMIN, [o], {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }),
      'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'CANCELLED' } }),
    });
    await user.click(await screen.findByRole('button', { name: /^Open order/ }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    await user.click(within(panel).getByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog', { name: /Cancel order/ });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel order' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason — shown to the customer/), 'Supplier closed today');
    await user.click(confirm);
    await waitFor(() =>
      expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'CANCELLED', notes: 'Supplier closed today' })
    );
  });

  it('marking delivered restates the cash it records and needs a note', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'OUT_FOR_DELIVERY', total_amount: 1690, active_delivery: { id: 'd2', assignment_status: 'ARRIVED_AT_CUSTOMER', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const api = renderBoard(ADMIN, [o], {
      'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }),
      'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'DELIVERED' } }),
    });
    await user.click(await screen.findByRole('button', { name: /^Open order/ }));
    await user.click(within(await screen.findByRole('complementary', { name: /Order #/ })).getByRole('button', { name: 'Mark delivered' }));
    const dialog = await screen.findByRole('dialog', { name: /Mark delivered/ });
    expect(dialog).toHaveTextContent('Records Rs. 1,690 cash as collected');
    await user.type(within(dialog).getByLabelText(/Note/), 'Rider phone died; cash counted at the store');
    await user.click(within(dialog).getByRole('button', { name: 'Mark delivered' }));
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toMatchObject({ status: 'DELIVERED' }));
  });

  it('a failed delivery can be returned to packed for a new rider (admin, with a note)', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'FAILED' });
    const api = renderBoard(ADMIN, [o], { 'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'PACKED' } }) });
    await user.click(within(await lane('Needs attention')).getByRole('button', { name: /^Return to packed/ }));
    const dialog = await screen.findByRole('dialog', { name: /Return to packed/ });
    await user.type(within(dialog).getByLabelText(/Note/), 'Bag back at the store');
    await user.click(within(dialog).getByRole('button', { name: 'Return to packed' }));
    await waitFor(() =>
      expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'PACKED', notes: 'Bag back at the store' })
    );
  });

  it('staff hand a waiting order to its rider in one click', async () => {
    const user = userEvent.setup();
    const o = boardOrder({ order_status: 'PACKED', active_delivery: { id: 'd1', assignment_status: 'ASSIGNED', rider_id: 'r1', rider_name: 'Farhan Mohamed' } });
    const api = renderBoard(STAFF, [o], { 'PATCH /admin/orders/:id/status': () => ok({ order: { ...o, order_status: 'OUT_FOR_DELIVERY' } }) });
    await user.click(within(await lane('Waiting for pickup')).getByRole('button', { name: /^Handed to rider/ }));
    await waitFor(() => expect(api.find('PATCH', `/admin/orders/${o.id}/status`)[0]?.body).toEqual({ status: 'OUT_FOR_DELIVERY' }));
  });

  it('shows the documented "Scheduled" label for an after-hours order', async () => {
    renderBoard(STAFF, [boardOrder({ scheduled_for: '2026-09-20T02:30:00.000Z' })]);
    expect(await lane('To pack')).toHaveTextContent('Scheduled 08:00');
  });

  it('the order panel shows items, the customer and history - but no costs or suppliers', async () => {
    const user = userEvent.setup();
    const o = boardOrder();
    renderBoard(STAFF, [o], { 'GET /admin/orders/:id': () => ok({ order: orderDetail(o) }) });
    await user.click(await screen.findByRole('button', { name: /^Open order/ }));
    const panel = await screen.findByRole('complementary', { name: /Order #/ });
    expect(panel).toHaveTextContent('Kotmale Fresh Milk 1L');
    expect(panel).toHaveTextContent('2 ×');
    expect(within(panel).getByRole('link', { name: /Call Ahmed Rizvi/ })).toHaveAttribute('href', 'tel:+94771234567');
    expect(panel).toHaveTextContent('Order placed by customer');
    expect(panel.textContent).not.toMatch(/455|690|cost|supplier/i);
    expect(within(panel).getByRole('link', { name: /Inventory/ })).toBeInTheDocument();
  });

  it('keeps itself current: every 20 seconds while visible, and when the tab comes back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = renderBoard(STAFF, [boardOrder()]);
    await lane('To pack');
    const reads = () => api.find('GET', '/admin/orders').filter((c) => !c.query.get('since')).length;
    const before = reads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(reads()).toBe(before + 1);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(reads()).toBe(before + 1);
    hidden.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(reads()).toBe(before + 2);
  });
});
