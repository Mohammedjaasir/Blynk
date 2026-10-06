import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { OrderSourcing, SourcingItem } from '../api/types';
import { QUEUE_DETAIL_CONCURRENCY } from '../pages/SourcingQueue';
import { STAFF, fail, ok, pageOf, renderAs, stockRow, supplier } from './helpers';

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

/** What GET /admin/orders really returns - including customer PII. */
const ORDER = {
  id: 'o1',
  order_number: 'BL-20260918-1301',
  order_status: 'PLACED',
  placed_at: '2026-09-18T09:30:00.000Z',
  created_at: '2026-09-18T09:30:00.000Z',
  delivery_recipient_name: 'Ahmed Rizvi',
  delivery_recipient_phone: '+94771234567',
  delivery_address_line1: 'No. 18, Marikar Street',
};
const DONE_ORDER = { ...ORDER, id: 'o2', order_number: 'BL-20260918-1300' };

const item = (overrides: Partial<SourcingItem>): SourcingItem => ({
  id: 'i-milk',
  order_id: 'o1',
  product_id: 'p-milk',
  product_name_snapshot: 'Kotmale Fresh Milk 1L',
  sku_snapshot: 'SKU-DAI-001',
  unit_snapshot: '1 L',
  quantity: 2,
  subtotal: 1080,
  estimated_unit_cost: 450,
  actual_unit_cost: null,
  item_status: 'PENDING',
  sourcing_records: [],
  ...overrides,
});

const sourcingFor = (items: SourcingItem[], orderNumber = ORDER.order_number): OrderSourcing => ({
  order_id: items[0].order_id,
  order_number: orderNumber,
  order_status: 'PLACED',
  metrics: {
    total_items: items.length,
    sourced_items: items.filter((i) => i.item_status === 'SOURCED').length,
    unavailable_items: items.filter((i) => i.item_status === 'UNAVAILABLE').length,
    pending_items: items.filter((i) => i.item_status === 'PENDING').length,
    is_sourcing_complete: items.every((i) => i.item_status !== 'PENDING'),
  },
  items,
});

const DONE_ITEM = item({
  id: 'i-done',
  order_id: 'o2',
  product_id: 'p-dhal',
  product_name_snapshot: 'Red Dhal 1kg',
  sku_snapshot: 'SKU-GRO-010',
  unit_snapshot: '1 kg',
  quantity: 3,
  item_status: 'SOURCED',
  actual_unit_cost: 455,
});

function queueHandlers(extra: Record<string, any> = {}) {
  return {
    'GET /admin/orders': (call: any) =>
      ok(pageOf('orders', call.query.get('status') === 'PLACED' ? [ORDER, DONE_ORDER] : [])),
    'GET /admin/orders/:id/sourcing': (call: any) =>
      call.path.includes('/o1/')
        ? ok(sourcingFor([item({}), item({ id: 'i-butter', product_id: 'p-butter', product_name_snapshot: 'Pelwatte Salted Butter 200g', quantity: 1, subtotal: 805, estimated_unit_cost: 700 })]))
        : ok(sourcingFor([DONE_ITEM], DONE_ORDER.order_number)),
    'GET /admin/inventory': () =>
      ok(pageOf('inventory', [stockRow({ tracking_mode: 'UNTRACKED', quantity_on_hand: 0, quantity_available: 0 })])),
    'GET /admin/suppliers': () => ok({ suppliers: [supplier()] }),
    ...extra,
  };
}

async function openSource(name = 'Kotmale Fresh Milk 1L') {
  const row = (await screen.findByText(name)).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: 'Source' }));
  return screen.findByRole('dialog', { name: new RegExp(`Source · ${name}`) });
}

describe('sourcing queue', () => {
  it('shows orders with items to source and those ready to pack, and never the customer’s name, phone or address', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers());
    expect(await screen.findByText('BL-20260918-1301')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 to source')).toBeInTheDocument();
    // Fully sourced: still listed, now to be packed.
    const done = screen.getByRole('rowgroup', { name: 'Order BL-20260918-1300' });
    expect(within(done).getByText('Ready to pack')).toBeInTheDocument();
    expect(api.find('GET', '/admin/orders').map((c) => c.query.get('status')).sort()).toEqual(['ITEM_UNAVAILABLE', 'PLACED']);

    const text = document.body.textContent!;
    expect(text).not.toContain('Ahmed Rizvi');
    expect(text).not.toContain('+94771234567');
    expect(text).not.toContain('Marikar Street');
  });

  it('records sourcing of the full quantity with the actual cost and an active supplier - never a free-text supplier', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () => ok({ item: {} }),
    }));
    const dialog = await openSource();
    expect(within(dialog).getByText('LKR 450.00 / unit')).toBeInTheDocument();
    expect(within(dialog).getByText(/does not change the customer’s price, the markup or the catalog cost/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455.50');
    expect(within(dialog).getByText(/vs estimate/)).toHaveTextContent('+LKR 5.50');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Supplier/), 'sup-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));

    await waitFor(() => expect(api.find('POST', '/admin/orders/o1/items/i-milk/source')).toHaveLength(1));
    const body = api.find('POST', '/admin/orders/o1/items/i-milk/source')[0].body;
    expect(body).toEqual({ actual_unit_cost: 455.5, quantity: 2, supplier_id: 'sup-1' });
    expect(body).not.toHaveProperty('supplier_name');
    expect(api.find('GET', '/admin/suppliers')[0].query.get('active_only')).toBe('true');
  });

  it('handles 409 ITEM_ALREADY_SOURCED as "someone got there first", not an error', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () =>
        fail(409, 'ITEM_ALREADY_SOURCED', 'This item has already been sourced.'),
    }));
    const dialog = await openSource();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));

    expect(await screen.findByText(/was already sourced by someone else/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/had a problem|went wrong/)).toBeNull();
  });

  it('offers Mark unavailable when tracked stock is insufficient', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () => fail(409, 'INSUFFICIENT_TRACKED_INVENTORY', 'x'),
    }));
    const dialog = await openSource();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText(/Not enough counted stock/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));
    expect(await screen.findByRole('dialog', { name: 'Mark item unavailable' })).toBeInTheDocument();
  });

  it('validates the cost before calling the API', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers());
    const dialog = await openSource();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText('Enter the actual unit cost you paid.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '45.555');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText(/at most two decimals/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/orders/o1/items/i-milk/source')).toHaveLength(0);
  });

  it('has no quantity field: the whole ordered quantity is sourced, shown as text', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers());
    const dialog = await openSource();
    expect(within(dialog).queryByLabelText(/Quantity/)).toBeNull();
    expect(within(dialog).getByText(/Sourcing all/)).toHaveTextContent('Sourcing all 2 × 1 L');
  });

  it('explains 400 PARTIAL_SOURCING_NOT_SUPPORTED and offers Mark unavailable', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () =>
        fail(400, 'PARTIAL_SOURCING_NOT_SUPPORTED', 'Partial sourcing is not supported.'),
    }));
    const dialog = await openSource();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText('Source the full quantity, or mark the item unavailable.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Mark unavailable' })).toBeInTheDocument();
  });

  it('offers Mark unavailable on INSUFFICIENT_AVAILABLE_INVENTORY', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () => fail(409, 'INSUFFICIENT_AVAILABLE_INVENTORY', 'x'),
    }));
    const dialog = await openSource();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText(/reserved for other orders/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));
    expect(await screen.findByRole('dialog', { name: 'Mark item unavailable' })).toBeInTheDocument();
  });

  it('says an order no longer in sourcing was already packed, cancelled or delivered', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () => fail(409, 'ORDER_NOT_IN_SOURCING_STATE', 'x'),
    }));
    const dialog = await openSource();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText(/already packed, cancelled or delivered/)).toBeInTheDocument();
  });

  it('flags short tracked stock up front, offers Mark unavailable and never sends a partial quantity', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'GET /admin/inventory': () => ok(pageOf('inventory', [stockRow({ quantity_on_hand: 1, quantity_available: 1 })])),
    }));
    const dialog = await openSource();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Only 1 counted in stock - not enough for all 2.');
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Restock first, or mark the item unavailable/);
    expect(api.find('POST', '/admin/orders/o1/items/i-milk/source')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));
    expect(await screen.findByRole('dialog', { name: 'Mark item unavailable' })).toBeInTheDocument();
  });

  it('marks an item unavailable through the existing resolve-item flow after confirmation (D4)', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/resolve-item': () => ok({ order: {} }),
    }));
    const row = (await screen.findByText('Pelwatte Salted Butter 200g')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Mark unavailable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark item unavailable' });
    expect(within(dialog).getByText('The order total drops by LKR 805.00.')).toBeInTheDocument();
    expect(within(dialog).getByText('The customer is notified that the item is unavailable.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));

    await waitFor(() =>
      expect(api.find('POST', '/admin/orders/o1/resolve-item')[0]?.body).toEqual({
        item_id: 'i-butter',
        item_status: 'UNAVAILABLE',
      })
    );
  });

  it.each([
    ['ITEM_ALREADY_RESOLVED', 'This item has already been resolved.', /already resolved by someone else/],
    ['ITEM_ALREADY_SOURCED', 'This item has already been sourced.', /already sourced by someone else/],
  ])('handles a %s conflict on Mark unavailable: closes, explains, refreshes', async (code, message, banner) => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/resolve-item': () => fail(409, code, message),
    }));
    const row = (await screen.findByText('Pelwatte Salted Butter 200g')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Mark unavailable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark item unavailable' });
    const loadsBefore = api.find('GET', '/admin/orders/o1/sourcing').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));

    expect(await screen.findByText(banner)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.find('GET', '/admin/orders/o1/sourcing').length).toBeGreaterThan(loadsBefore));
    expect(screen.queryByText(/had a problem|went wrong/)).toBeNull();
  });

  it('explains an item that is no longer on the order', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/resolve-item': () => fail(404, 'ORDER_ITEM_NOT_FOUND', 'Order item not found on this order.'),
    }));
    const row = (await screen.findByText('Pelwatte Salted Butter 200g')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Mark unavailable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark item unavailable' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark unavailable' }));
    expect(await within(dialog).findByText(/no longer on this order/)).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    renderAs(STAFF, '/sourcing');
    expect(await screen.findByText('Nothing to source')).toBeInTheDocument();
  });
});

describe('sourcing queue: loading', () => {
  const manyOrders = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...ORDER,
      id: `o${100 + i}`,
      order_number: `BL-20260918-${2000 + i}`,
      placed_at: `2026-09-18T09:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }));

  it('reads order details at most five at a time', async () => {
    const orders = manyOrders(12);
    let inFlight = 0;
    let peak = 0;
    renderAs(STAFF, '/sourcing', queueHandlers({
      'GET /admin/orders': (call: any) => ok(pageOf('orders', call.query.get('status') === 'PLACED' ? orders : [])),
      'GET /admin/orders/:id/sourcing': async (call: any) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        const id = call.path.split('/')[3];
        return ok(sourcingFor([item({ id: `i-${id}`, order_id: id })], id));
      },
    }));
    expect(await screen.findByText('BL-20260918-2011')).toBeInTheDocument();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(QUEUE_DETAIL_CONCURRENCY);
    expect(QUEUE_DETAIL_CONCURRENCY).toBe(5);
  });

  it('says when the backend has more open orders than were loaded (pagination.total)', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'GET /admin/orders': (call: any) =>
        ok(
          call.query.get('status') === 'PLACED'
            ? { orders: [ORDER], pagination: { page: 1, limit: 100, total: 130, total_pages: 2 } }
            : { orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } }
        ),
    }));
    expect(await screen.findByText(/129 more orders were not loaded/)).toBeInTheDocument();
    expect(ordersLimitRequested()).toBe('100');
  });

  it('pages through every product for the stock column, not just the first 100', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'GET /admin/inventory': (call: any) =>
        call.query.get('page') === '2'
          ? ok(pageOf('inventory', [stockRow({ quantity_on_hand: 47 })], 2, 2))
          : ok(pageOf('inventory', [stockRow({ product_id: 'p-other', product_name: 'Other' })], 1, 2)),
    }));
    const row = (await screen.findByText('Kotmale Fresh Milk 1L')).closest('tr')!;
    await waitFor(() => expect(within(row).getByText('47')).toBeInTheDocument());
    const pages = api.find('GET', '/admin/inventory').map((c) => [c.query.get('page'), c.query.get('limit')]);
    expect(pages).toEqual([
      ['1', '100'],
      ['2', '100'],
    ]);
  });
});

/** The limit the queue asked GET /admin/orders for (the backend maximum). */
function ordersLimitRequested() {
  const calls = (globalThis.fetch as any).mock.calls as Array<[string]>;
  const orderCall = calls.map(([url]) => new URL(String(url))).find((u) => u.pathname.endsWith('/admin/orders'));
  return orderCall?.searchParams.get('limit');
}

describe('marking an order packed', () => {
  async function openPack() {
    const group = await screen.findByRole('rowgroup', { name: 'Order BL-20260918-1300' });
    await userEvent.click(within(group).getByRole('button', { name: 'Mark packed' }));
    return screen.findByRole('dialog', { name: 'Mark order packed' });
  }

  it('is offered only once nothing is left to source', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers());
    const pending = await screen.findByRole('rowgroup', { name: 'Order BL-20260918-1301' });
    expect(within(pending).queryByRole('button', { name: 'Mark packed' })).toBeNull();
    const done = screen.getByRole('rowgroup', { name: 'Order BL-20260918-1300' });
    expect(within(done).getByRole('button', { name: 'Mark packed' })).toBeInTheDocument();
  });

  it('is not offered for an order whose every item is unavailable', async () => {
    renderAs(STAFF, '/sourcing', queueHandlers({
      'GET /admin/orders/:id/sourcing': (call: any) =>
        call.path.includes('/o1/')
          ? ok(sourcingFor([item({})]))
          : ok(sourcingFor([{ ...DONE_ITEM, item_status: 'UNAVAILABLE', actual_unit_cost: null }], DONE_ORDER.order_number)),
    }));
    expect(await screen.findByText('BL-20260918-1301')).toBeInTheDocument();
    expect(screen.queryByText('BL-20260918-1300')).toBeNull();
  });

  it('confirms with a packing list (no prices, no customer), sends PACKED and drops the order from the queue', async () => {
    let packed = false;
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'GET /admin/orders': (call: any) =>
        ok(pageOf('orders', call.query.get('status') === 'PLACED' ? (packed ? [ORDER] : [ORDER, DONE_ORDER]) : [])),
      'PATCH /admin/orders/:id/status': () => {
        packed = true;
        return ok({ order: {} });
      },
    }));
    const dialog = await openPack();
    const list = within(dialog).getByRole('list', { name: 'Packing list' });
    expect(list).toHaveTextContent('3 × Red Dhal 1kg (1 kg)');
    expect(dialog.textContent).not.toMatch(/LKR/);
    expect(dialog.textContent).not.toContain('Ahmed Rizvi');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark packed' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/orders/o2/status')[0]?.body).toEqual({ status: 'PACKED' }));
    await waitFor(() => expect(screen.queryByText('BL-20260918-1300')).toBeNull());
    expect(screen.getByText('BL-20260918-1300 marked packed.')).toBeInTheDocument();
  });

  it.each([
    [422, 'INVALID_STATUS_TRANSITION'],
    [409, 'ORDER_NOT_IN_SOURCING_STATE'],
  ])('explains a %i %s refusal (already packed or cancelled) and refreshes', async (status, code) => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'PATCH /admin/orders/:id/status': () => fail(status, code, 'An order in PACKED cannot move to PACKED.'),
    }));
    const dialog = await openPack();
    const loadsBefore = api.find('GET', '/admin/orders/o2/sourcing').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark packed' }));
    expect(await screen.findByText(/already packed, cancelled or delivered/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.find('GET', '/admin/orders/o2/sourcing').length).toBeGreaterThan(loadsBefore));
  });
});
