import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { BoardOrder, OrderDetail } from '../api/types';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * More -> Repeat baskets and the "Repeat" tag (plan 2026-10-24-buy-again-repeat.md §2 staff
 * API, §4) against a fake API shaped like the contract.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const BASKETS = [
  {
    id: 'rb1',
    name: 'Milk and bread',
    customer_name: 'Ahmed Rizvi',
    customer_phone: '+94771234567',
    items_count: 3,
    frequency: 'WEEKLY',
    weekday: 1,
    place_at: '08:00',
    status: 'ACTIVE',
    skip_next: false,
    next_run_at: '2026-10-26T02:30:00.000Z',
    last_run: { run_at: '2026-10-19T02:30:00.000Z', status: 'PLACED', order_id: 'o42', order_number: '1042', reason: null },
  },
  {
    id: 'rb2',
    name: 'Fruit box',
    customer_name: 'Nimali Perera',
    customer_phone: '+94770001111',
    items_count: 1,
    frequency: 'DAILY',
    weekday: null,
    place_at: '07:00',
    status: 'PAUSED',
    skip_next: false,
    next_run_at: null,
    last_run: null,
  },
];

function byStatus(call: Call) {
  return ok({ baskets: call.query.status ? BASKETS.filter((b) => b.status === call.query.status) : BASKETS });
}

describe('More -> Repeat baskets', () => {
  it('opens from More and lists active baskets with schedule, next run and last order', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/repeat-baskets': byStatus });
    await user.click(await screen.findByRole('link', { name: 'Repeat baskets' }));
    const card = await screen.findByRole('listitem', { name: 'Milk and bread for Ahmed Rizvi' });
    expect(card).toHaveTextContent('Every Monday at 8:00 am · 3 items');
    expect(within(card).getByTestId('repeat-next')).toHaveTextContent('Next: Mon 26 Oct, 8:00 am');
    expect(within(card).getByRole('link', { name: 'Placed - order #1042' })).toHaveAttribute('href', '/orders/o42');
    expect(screen.queryByText('Fruit box')).toBeNull();
    expect(api.find('GET', '/admin/repeat-baskets')[0].query).toEqual({ status: 'ACTIVE' });

    await user.click(screen.getByRole('button', { name: 'Paused' }));
    expect(await screen.findByRole('listitem', { name: 'Fruit box for Nimali Perera' })).toHaveTextContent('Every day at 7:00 am');
  });

  it('pauses after a confirm and sends only the new status', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/repeat-baskets', {
      'GET /admin/repeat-baskets': byStatus,
      'PATCH /admin/repeat-baskets/:id': (call) => ok({ basket: { ...BASKETS[0], status: call.body.status } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Pause Milk and bread' }));
    const dialog = screen.getByRole('dialog', { name: 'Pause this repeat basket?' });
    await user.click(within(dialog).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/repeat-baskets/rb1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/repeat-baskets/rb1')[0].body).toEqual({ status: 'PAUSED' });
    expect(await screen.findByText('"Milk and bread" paused.')).toBeInTheDocument();
  });

  it('cancelling the confirm changes nothing; cancel basket asks first', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/repeat-baskets', {
      'GET /admin/repeat-baskets': byStatus,
      'PATCH /admin/repeat-baskets/:id': (call) => ok({ basket: { ...BASKETS[0], status: call.body.status } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel Milk and bread' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this repeat basket?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('PATCH', '/admin/repeat-baskets/rb1')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel Milk and bread' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel basket' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/repeat-baskets/rb1')[0]?.body).toEqual({ status: 'CANCELLED' }));
  });

  it('says the migration is missing instead of failing', async () => {
    renderAs(OPERATIONS_STAFF, '/more/repeat-baskets', {
      'GET /admin/repeat-baskets': () => fail(503, 'REPEAT_NOT_READY', 'Not ready'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Repeat baskets need database update 054');
  });
});

describe('"Repeat" tag on orders', () => {
  const order: BoardOrder = {
    id: 'o42',
    order_number: 'BL-20261026-0042',
    order_status: 'PLACED',
    total_amount: 900,
    placed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_address_line1: '14 Mosque Road',
    delivery_city: 'Dharga Town',
    items_summary: { total: 3, pending: 3, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
    active_delivery: null,
    repeat_basket_id: 'rb1',
  };
  const detail: OrderDetail = {
    id: order.id,
    order_number: order.order_number,
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: 900,
    placed_at: order.placed_at,
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Mosque Road',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PENDING' }],
    history: [],
    delivery: null,
    repeat_basket_id: 'rb1',
  };

  it('shows on the board card and the order screen', async () => {
    renderAs(OPERATIONS_STAFF, '/orders', {
      'GET /admin/orders': (call) => ok({ orders: call.query.since ? [] : [order], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } }),
    });
    const ticket = (await screen.findByRole('link', { name: 'Open order #0042' })).closest('li')!;
    expect(within(ticket).getByText('Repeat')).toBeInTheDocument();
    cleanup();
    renderAs(OPERATIONS_STAFF, '/orders/o42', { 'GET /admin/orders/:id': () => ok({ order: detail }) });
    expect(await screen.findByTestId('order-repeat-tag')).toHaveTextContent('Repeat');
  });
});
