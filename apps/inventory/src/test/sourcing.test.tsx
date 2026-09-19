import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { OrderSourcing, SourcingItem } from '../api/types';
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

function queueHandlers(extra: Record<string, any> = {}) {
  return {
    'GET /admin/orders': (call: any) =>
      ok(pageOf('orders', call.query.get('status') === 'PLACED' ? [ORDER, DONE_ORDER] : [])),
    'GET /admin/orders/:id/sourcing': (call: any) =>
      call.path.includes('/o1/')
        ? ok(sourcingFor([item({}), item({ id: 'i-butter', product_id: 'p-butter', product_name_snapshot: 'Pelwatte Salted Butter 200g', quantity: 1, subtotal: 805, estimated_unit_cost: 700 })]))
        : ok(sourcingFor([item({ id: 'i-done', order_id: 'o2', item_status: 'SOURCED', actual_unit_cost: 455 })], DONE_ORDER.order_number)),
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
  it('shows only orders with items to source, and never the customer’s name, phone or address', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers());
    expect(await screen.findByText('BL-20260918-1301')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 to source')).toBeInTheDocument();
    expect(screen.queryByText('BL-20260918-1300')).toBeNull(); // fully sourced
    expect(api.find('GET', '/admin/orders').map((c) => c.query.get('status')).sort()).toEqual(['ITEM_UNAVAILABLE', 'PLACED']);

    const text = document.body.textContent!;
    expect(text).not.toContain('Ahmed Rizvi');
    expect(text).not.toContain('+94771234567');
    expect(text).not.toContain('Marikar Street');
  });

  it('records sourcing with the actual cost, quantity and an active supplier - never a free-text supplier', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/items/:itemId/source': () => ok({ item: {} }),
    }));
    const dialog = await openSource();
    expect(within(dialog).getByText('Rs. 450.00 / unit')).toBeInTheDocument();
    expect(within(dialog).getByText(/does not change the customer’s price, the markup or the catalog cost/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455.50');
    expect(within(dialog).getByText(/vs estimate/)).toHaveTextContent('+Rs. 5.50');
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

  it('validates cost and quantity before calling the API', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers());
    const dialog = await openSource();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText('Enter the actual unit cost you paid.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Actual unit cost/), '455');
    await userEvent.clear(within(dialog).getByLabelText('Quantity sourced'));
    await userEvent.type(within(dialog).getByLabelText('Quantity sourced'), '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record sourcing' }));
    expect(await within(dialog).findByText(/Quantity must be a whole number from 1 to 2/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/orders/o1/items/i-milk/source')).toHaveLength(0);
  });

  it('marks an item unavailable through the existing resolve-item flow after confirmation (D4)', async () => {
    const { api } = renderAs(STAFF, '/sourcing', queueHandlers({
      'POST /admin/orders/:id/resolve-item': () => ok({ order: {} }),
    }));
    const row = (await screen.findByText('Pelwatte Salted Butter 200g')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Mark unavailable' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark item unavailable' });
    expect(within(dialog).getByText('The order total drops by Rs. 805.00.')).toBeInTheDocument();
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
