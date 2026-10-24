import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { Delivery, DeliverySummary } from '../api/types';
import { ADMIN, STAFF, fail, ok, renderAs } from './helpers';

/**
 * Deliveries (owner, 2026-10-25): packing staff receive supplier purchase orders. The list shows
 * receivable orders, the detail takes the quantity that arrived per line (default = outstanding),
 * and nothing about money is shown or sent.
 */
beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

const summary = (over: Partial<DeliverySummary> = {}): DeliverySummary => ({
  id: 'po-1',
  po_number: 'BP-0001',
  supplier_name: 'Lanka Wholesale',
  status: 'SENT',
  notes: null,
  expected_on: '2026-10-27',
  line_count: 2,
  units_ordered: 14,
  units_received: 0,
  ...over,
});

const order = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'po-1',
  po_number: 'BP-0001',
  supplier_name: 'Lanka Wholesale',
  status: 'SENT',
  notes: 'Dry goods',
  expected_on: '2026-10-27',
  received_at: null,
  lines: [
    { id: 'i-rice', product_id: 'p-rice', name: 'Basmati Rice 5kg', unit: null, ordered_qty: 10, received_qty: 4, remaining_qty: 6, note: null, stock_counted: true },
    { id: 'i-dhal', product_id: 'p-dhal', name: 'Red Dhal 1kg', unit: null, ordered_qty: 4, received_qty: 0, remaining_qty: 4, note: null, stock_counted: false },
  ],
  ...over,
});

const handlers = (receive?: (body: any) => unknown, po: Delivery = order()) => ({
  'GET /admin/purchase-orders': () => ok({ purchase_orders: [summary(), summary({ id: 'po-2', po_number: 'BP-0002', status: 'PARTIAL', supplier_name: null, units_received: 3 })], total: 2 }),
  'GET /admin/purchase-orders/:id': () => ok({ purchase_order: po }),
  'POST /admin/purchase-orders/:id/receive': (call: any) =>
    receive ? receive(call.body) : ok({ purchase_order: { ...po, status: 'PARTIAL' }, received: [], skipped: [] }),
});

describe('Deliveries list', () => {
  it('lists receivable orders for packing staff, asks the API only for receivable ones, and shows no prices', async () => {
    const { api } = renderAs(STAFF, '/deliveries', handlers());
    const table = await screen.findByRole('table', { name: 'Deliveries waiting' });
    expect(within(table).getByText('BP-0001')).toBeInTheDocument();
    expect(within(table).getByText('BP-0002')).toBeInTheDocument();
    expect(within(table).getByText('Lanka Wholesale')).toBeInTheDocument();
    expect(within(table).getByText('On order')).toBeInTheDocument();
    expect(within(table).getByText('Partly received')).toBeInTheDocument();
    expect(within(table).getByText('3 / 14')).toBeInTheDocument();
    expect(api.find('GET', '/admin/purchase-orders')[0].query.get('status')).toBe('RECEIVABLE');
    expect(document.body.textContent).not.toMatch(/LKR|Rs\.?\s?\d|cost|price/i);
    // the nav has the entry
    expect(screen.getByRole('link', { name: 'Deliveries' })).toHaveAttribute('href', '/deliveries');
  });

  it('says so when nothing is waiting', async () => {
    renderAs(STAFF, '/deliveries', { 'GET /admin/purchase-orders': () => ok({ purchase_orders: [], total: 0 }) });
    expect(await screen.findByText('No deliveries are waiting')).toBeInTheDocument();
  });

  it('is open to Admin too and reports a refusal', async () => {
    renderAs(ADMIN, '/deliveries', { 'GET /admin/purchase-orders': () => fail(403, 'FORBIDDEN') });
    expect(await screen.findByText(/No access/)).toBeInTheDocument();
  });

  it('opens an order from the list', async () => {
    renderAs(STAFF, '/deliveries', handlers());
    await userEvent.click(await screen.findByRole('link', { name: 'Receive BP-0001' }));
    expect(await screen.findByRole('table', { name: 'Products on this order' })).toBeInTheDocument();
  });
});

describe('Receiving a delivery', () => {
  it('starts each line at what is outstanding and sends the quantities (no costs) after a confirmation', async () => {
    const receive = vi.fn(() => ok({ purchase_order: order({ status: 'PARTIAL' }), received: [], skipped: [{ item_id: 'i-dhal', name: 'Red Dhal 1kg' }] }));
    const { api } = renderAs(STAFF, '/deliveries/po-1', handlers(receive));
    const rice = await screen.findByLabelText('Basmati Rice 5kg arrived now');
    expect(rice).toHaveValue('6');
    expect(screen.getByLabelText('Red Dhal 1kg arrived now')).toHaveValue('4');
    expect(screen.getByText('Dry goods')).toBeInTheDocument();
    expect(screen.getByText(/Stock is not counted for this product/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/LKR|cost|price/i);

    await userEvent.clear(rice);
    await userEvent.type(rice, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm delivery' });
    expect(within(dialog).getByText(/Add 9 units from BP-0001 to stock/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/purchase-orders/po-1/receive')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to stock' }));

    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po-1/receive')).toHaveLength(1));
    expect(api.find('POST', '/admin/purchase-orders/po-1/receive')[0].body).toEqual({
      lines: [
        { item_id: 'i-rice', received_qty: 5 },
        { item_id: 'i-dhal', received_qty: 4 },
      ],
    });
    const notice = await screen.findByText(/Delivery recorded for BP-0001: 9 units added/);
    expect(notice).toHaveTextContent('The rest is still to come.');
    expect(notice).toHaveTextContent('Stock is not counted for Red Dhal 1kg');
    // the order is read again after the receive
    await waitFor(() => expect(api.find('GET', '/admin/purchase-orders/po-1').length).toBeGreaterThanOrEqual(2));
  });

  it('close short is sent when ticked, and an all-zero entry needs it', async () => {
    const { api } = renderAs(STAFF, '/deliveries/po-1', handlers(() => ok({ purchase_order: order({ status: 'RECEIVED' }), received: [], skipped: [] })));
    await userEvent.clear(await screen.findByLabelText('Basmati Rice 5kg arrived now'));
    await userEvent.type(screen.getByLabelText('Basmati Rice 5kg arrived now'), '0');
    await userEvent.clear(screen.getByLabelText('Red Dhal 1kg arrived now'));
    await userEvent.type(screen.getByLabelText('Red Dhal 1kg arrived now'), '0');

    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter what arrived for at least one product');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Close short/));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/closed even if some products are short/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to stock' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po-1/receive')).toHaveLength(1));
    expect(api.find('POST', '/admin/purchase-orders/po-1/receive')[0].body.close_short).toBe(true);
    expect(await screen.findByText(/The order is closed\./)).toBeInTheDocument();
  });

  it('refuses a blank or non-numeric line before sending anything', async () => {
    const { api } = renderAs(STAFF, '/deliveries/po-1', handlers());
    await userEvent.clear(await screen.findByLabelText('Basmati Rice 5kg arrived now'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delivery' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number for Basmati Rice 5kg');
    expect(api.find('POST', '/admin/purchase-orders/po-1/receive')).toHaveLength(0);
  });

  it('shows a failed receive inside the confirmation and keeps the entries', async () => {
    renderAs(STAFF, '/deliveries/po-1', handlers(() => fail(400, 'ITEM_NOT_ON_ORDER', 'A line does not belong to this order.')));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm delivery' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to stock' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A line does not belong to this order.');
    expect(screen.getByLabelText('Basmati Rice 5kg arrived now')).toHaveValue('6');
  });

  it('when someone else closed it first, says so and shows the latest', async () => {
    let closed = false;
    const { api } = renderAs(STAFF, '/deliveries/po-1', {
      'GET /admin/purchase-orders/:id': () => ok({ purchase_order: closed ? order({ status: 'RECEIVED' }) : order() }),
      'POST /admin/purchase-orders/:id/receive': () => {
        closed = true;
        return fail(409, 'PURCHASE_ORDER_NOT_OPEN', 'This purchase order is already closed.');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm delivery' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add to stock' }));
    expect(await screen.findByText(/BP-0001: This purchase order is already closed\. Showing the latest\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm delivery' })).not.toBeInTheDocument());
    expect(api.find('GET', '/admin/purchase-orders/po-1').length).toBeGreaterThanOrEqual(2);
  });

  it('a closed or unsent order has no entry form', async () => {
    renderAs(STAFF, '/deliveries/po-1', handlers(undefined, order({ status: 'RECEIVED', received_at: '2026-10-26T08:00:00Z' })));
    expect(await screen.findByText(/This order is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm delivery' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/arrived now/)).not.toBeInTheDocument();
  });

  it('reports an order that cannot be loaded', async () => {
    renderAs(STAFF, '/deliveries/nope', { 'GET /admin/purchase-orders/:id': () => fail(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found.') });
    expect(await screen.findByText('Purchase order not found.')).toBeInTheDocument();
  });
});
