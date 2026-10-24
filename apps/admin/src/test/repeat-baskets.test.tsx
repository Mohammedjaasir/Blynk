import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { clock12, scheduleText } from '../lib/engagement';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/** Repeat baskets (2026-10-24 buy-again plan, sections 2 and 4) and the "Repeat" tag on orders. */
// Many clicks and typing on a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(route: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[route]}>
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
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const BASKETS = [
  {
    id: 'rb1',
    name: 'Milk and bread',
    status: 'ACTIVE',
    frequency: 'DAILY',
    weekday: null,
    place_at: '07:30',
    skip_next: false,
    next_run_at: '2026-10-25T02:00:00.000Z',
    customer_name: 'Ahmed Rizvi',
    customer_phone: '+94771234567',
    items_count: 3,
    items: [
      { product_id: 'p1', quantity: 2, product_name: 'Kotmale Milk 1L' },
      { product_id: 'p2', quantity: 1, product_name: 'Bread' },
    ],
    last_run: { run_at: '2026-10-24T02:00:00.000Z', status: 'PLACED', order_id: 'o9', order_number: 'BL-20261024-0042', reason: null },
  },
  {
    id: 'rb2',
    name: 'Weekly shop',
    status: 'PAUSED',
    frequency: 'WEEKLY',
    weekday: 1,
    place_at: '18:00',
    next_run_at: null,
    customer: { full_name: 'Fathima Nuha', phone: '+94770000001' },
    items_count: 12,
    last_run: { run_at: '2026-10-20T12:30:00.000Z', status: 'SKIPPED', order_id: null, reason: 'Store closed' },
  },
];

describe('Repeat baskets (lib)', () => {
  it('words the schedule in 12-hour Sri Lanka time', () => {
    expect(clock12('07:30')).toBe('7:30 am');
    expect(clock12('12:00')).toBe('12:00 pm');
    expect(clock12('00:15')).toBe('12:15 am');
    expect(scheduleText({ frequency: 'DAILY', weekday: null, place_at: '07:30' })).toBe('Every day at 7:30 am');
    expect(scheduleText({ frequency: 'WEEKLY', weekday: 1, place_at: '18:00' })).toBe('Every Monday at 6:00 pm');
    expect(scheduleText({ frequency: 'BIWEEKLY', weekday: 0, place_at: '09:00' })).toBe('Every 2 weeks on Sunday at 9:00 am');
  });
});

describe('Repeat baskets page', () => {
  it('lists baskets with customer, items, schedule, next and last run, and filters by status', async () => {
    const user = userEvent.setup();
    const api = renderAt('/repeat-baskets', (c) => {
      if (c.method === 'GET' && c.path === '/admin/repeat-baskets') {
        const status = c.query.get('status');
        return ok({ baskets: status ? BASKETS.filter((b) => b.status === status) : BASKETS });
      }
      return undefined;
    });
    const table = await screen.findByRole('table', { name: 'Repeat baskets' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Milk and bread');
    expect(first).toHaveTextContent('Ahmed Rizvi');
    expect(first).toHaveTextContent('+94771234567');
    expect(first).toHaveTextContent('3 items');
    expect(first).toHaveTextContent('Kotmale Milk 1L x2, Bread x1');
    expect(first).toHaveTextContent('Every day at 7:30 am');
    expect(first).toHaveTextContent('Sun 25 Oct, 7:30 am');
    expect(first).toHaveTextContent('Ordered');
    expect(within(first!).getByRole('link', { name: 'Order #0042' })).toHaveAttribute('href', '/orders/o9');
    expect(second).toHaveTextContent('Fathima Nuha');
    expect(second).toHaveTextContent('Every Monday at 6:00 pm');
    expect(second).toHaveTextContent('Skipped');
    expect(second).toHaveTextContent('Store closed');
    expect(second).toHaveTextContent('Paused');

    await user.click(screen.getByRole('button', { name: 'Paused' }));
    await waitFor(() => expect(api.find('GET', '/admin/repeat-baskets').at(-1)!.query.get('status')).toBe('PAUSED'));
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Repeat baskets' })).getAllByRole('row')).toHaveLength(2));
  });

  it('pauses, resumes and cancels only after confirming', async () => {
    const user = userEvent.setup();
    const api = renderAt('/repeat-baskets', (c) => {
      if (c.method === 'GET' && c.path === '/admin/repeat-baskets') return ok({ baskets: BASKETS });
      if (c.method === 'PATCH' && c.path.startsWith('/admin/repeat-baskets/')) return ok({ basket: { ...BASKETS[0], status: c.body.status } });
      return undefined;
    });
    await screen.findByRole('table', { name: 'Repeat baskets' });

    await user.click(screen.getByRole('button', { name: 'Pause Milk and bread of Ahmed Rizvi' }));
    const pause = screen.getByRole('dialog', { name: 'Pause basket' });
    expect(pause).toHaveTextContent('No orders are placed until it is resumed');
    await user.click(within(pause).getByRole('button', { name: 'Cancel' }));
    expect(api.find('PATCH', '/admin/repeat-baskets/rb1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Pause Milk and bread of Ahmed Rizvi' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Pause basket' })).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/repeat-baskets/rb1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/repeat-baskets/rb1')[0]!.body).toEqual({ status: 'PAUSED' });
    expect(await screen.findByText('Basket paused.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume Weekly shop of Fathima Nuha' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Resume basket' })).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/repeat-baskets/rb2')[0]?.body).toEqual({ status: 'ACTIVE' }));

    await user.click(screen.getByRole('button', { name: 'Cancel Weekly shop of Fathima Nuha' }));
    const cancel = screen.getByRole('dialog', { name: 'Cancel basket' });
    expect(cancel).toHaveTextContent('It stops for good');
    await user.click(within(cancel).getByRole('button', { name: 'Cancel basket' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/repeat-baskets/rb2')[1]?.body).toEqual({ status: 'CANCELLED' }));
  });

  it('says to run migration 054 while the server is not ready', async () => {
    renderAt('/repeat-baskets', (c) => (c.path === '/admin/repeat-baskets' ? fail(503, 'REPEAT_NOT_READY') : undefined));
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 054 in Coolify');
  });
});

describe('Repeat tag on orders', () => {
  const order = {
    id: 'o9',
    order_number: 'BL-20261024-0042',
    order_status: 'PLACED',
    total_amount: 610,
    placed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_address_line1: '14 Main Street',
    delivery_city: 'Dharga Town',
    items_summary: { total: 2, pending: 0, sourced: 2, packed: 0, unavailable: 0, substituted: 0 },
    active_delivery: null,
    repeat_basket_id: 'rb1',
  };
  const detail = {
    ...order,
    payment_method: 'COD',
    payment_status: 'PENDING',
    subtotal_amount: 610,
    delivery_fee: 0,
    delivery_recipient_phone: '+94771234567',
    delivery_address_line2: null,
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Kotmale Milk 1L', quantity: 2, item_status: 'SOURCED' }],
    history: [],
    delivery: null,
  };

  it('shows "Repeat" on the board row and in the order panel', async () => {
    const user = userEvent.setup();
    renderAt('/orders', (c) => {
      if (c.path === '/admin/orders')
        return ok({
          orders: c.query.get('since') || c.query.get('status') === 'AWAITING_PAYMENT' ? [] : [order, { ...order, id: 'o10', order_number: 'BL-20261024-0043', repeat_basket_id: null }],
          pagination: { page: 1, limit: 100, total: 2, total_pages: 1 },
        });
      if (c.path === '/admin/orders/o9') return ok({ order: detail });
      if (c.path === '/admin/riders') return ok({ riders: [] });
      return undefined;
    });
    const row = (await screen.findByRole('button', { name: 'Open order #0042' })).closest('li')!;
    expect(within(row).getByText('Repeat')).toBeInTheDocument();
    const other = screen.getByRole('button', { name: 'Open order #0043' }).closest('li')!;
    expect(within(other).queryByText('Repeat')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open order #0042' }));
    const panel = await screen.findByRole('complementary', { name: 'Order #0042' });
    expect(within(panel).getByText('Repeat')).toBeInTheDocument();
  });
});
