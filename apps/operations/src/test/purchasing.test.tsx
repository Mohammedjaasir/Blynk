import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { itemKey, orderBodyFor, receiveBody, receiveDefaults, type PoLine, type ReorderGroup, type ReorderItem } from '../lib/purchasing';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * More -> Purchasing (owner, 2026-10-25; migration 058): reorder suggestions, create, send/copy and
 * receive on the phone, against a fake API shaped like backend/api/src/modules/purchasing.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const item = (over: Record<string, unknown>) => ({
  product_id: 'p1',
  variant_id: null,
  product_name: 'Sugar',
  variant_label: null,
  display_name: 'Sugar (1 kg)',
  sku: 'SUG-1',
  unit: '1 kg',
  pack_size: null,
  category_name: 'Grocery',
  quantity_on_hand: 2,
  quantity_reserved: 0,
  quantity_available: 2,
  low_stock_threshold: 5,
  units_sold: 8,
  avg_daily_units: 0.57,
  days_of_stock_left: 3.5,
  on_order: 0,
  in_draft: 0,
  buy_multiple: null,
  suggested_quantity: 8,
  last_cost: 100,
  estimated_cost: 800,
  reasons: ['LOW', 'WONT_LAST'],
  supplier_id: 's1',
  supplier_name: 'Lanka Wholesale',
  supplier_phone: '0771234567',
  ...over,
});

const SUGGESTIONS = {
  params: { days: 14, cover_days: 7, lead_days: 1, period: { from: '2026-10-11', to: '2026-10-24' } },
  rule: 'rule',
  totals: { products: 3, out: 1, units: 15, estimated_cost: 1500 },
  suppliers: [
    {
      supplier_id: 's1',
      supplier_name: 'Lanka Wholesale',
      supplier_phone: '0771234567',
      estimated_cost: 1100,
      items: [item({}), item({ product_id: 'p2', display_name: 'Tea (500 g)', sku: 'TEA-1', reasons: ['FAST'], suggested_quantity: 3, last_cost: 300, days_of_stock_left: 6 })],
    },
    {
      supplier_id: null,
      supplier_name: null,
      supplier_phone: null,
      estimated_cost: 400,
      items: [item({ product_id: 'p3', display_name: 'Rice (5 kg)', sku: 'RIC-1', supplier_id: null, supplier_name: null, supplier_phone: null, reasons: ['OUT'], suggested_quantity: 4, days_of_stock_left: null, avg_daily_units: 0 })],
    },
  ],
};

const LINES = [
  { id: 'i1', product_id: 'p1', variant_id: null, name: 'Sugar (1 kg)', unit: null, ordered_qty: 10, received_qty: 4, remaining_qty: 6, unit_cost: 100, line_total: 1000, note: null, stock_counted: true, stock_on_hand: 6 },
  { id: 'i2', product_id: 'p2', variant_id: null, name: 'Tea (500 g)', unit: null, ordered_qty: 6, received_qty: 0, remaining_qty: 6, unit_cost: 12.5, line_total: 75, note: null, stock_counted: false, stock_on_hand: null },
];

const po = (over: Record<string, unknown> = {}) => ({
  id: 'po1',
  po_number: 'BP-0007',
  supplier_id: 's1',
  supplier_name: 'Lanka Wholesale',
  supplier_phone: '0771234567',
  status: 'SENT',
  notes: null,
  expected_on: '2026-10-27',
  created_by_name: 'Ops',
  sent_at: '2026-10-24T05:00:00.000Z',
  received_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-10-24T04:00:00.000Z',
  lines: LINES,
  totals: { lines: 2, units_ordered: 16, units_received: 4, cost_ordered: 1075, cost_received: 400 },
  share: { text: 'Order for Lanka Wholesale:\n10 x Sugar (1 kg)\nRef: BP-0007 (Blynk)', whatsapp_url: 'https://wa.me/94771234567?text=x' },
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  id: 'po1',
  po_number: 'BP-0007',
  supplier_id: 's1',
  supplier_name: 'Lanka Wholesale',
  status: 'SENT',
  notes: null,
  expected_on: null,
  created_by_name: null,
  sent_at: null,
  received_at: null,
  cancelled_at: null,
  created_at: '2026-10-24T04:00:00.000Z',
  line_count: 2,
  units_ordered: 16,
  units_received: 4,
  cost_ordered: 1075,
  ...over,
});

describe('More -> Purchasing', () => {
  it('has a card on More and lists the orders with status and progress', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/purchase-orders': () => ok({ purchase_orders: [summary(), summary({ id: 'po2', po_number: 'BP-0008', status: 'DRAFT', supplier_name: null, units_received: 0 })], page: 1, limit: 50, total: 2 }),
    });
    await user.click(await screen.findByRole('link', { name: 'Purchasing' }));
    const list = await screen.findByRole('list', { name: 'Purchase orders' });
    expect(within(list).getByText(/BP-0007 · Lanka Wholesale/)).toBeInTheDocument();
    expect(within(list).getByText(/4 of 16 received/)).toBeInTheDocument();
    expect(within(list).getByText(/BP-0008 · No supplier yet/)).toBeInTheDocument();
    expect(within(list).getByText('Draft')).toBeInTheDocument();
    expect(api.find('GET', '/admin/purchase-orders')[0]!.query.status).toBe('OPEN');
    await user.click(screen.getByRole('button', { name: 'Sent' }));
    await waitFor(() => expect(api.find('GET', '/admin/purchase-orders').some((c) => c.query.status === 'SENT')).toBe(true));
  });

  it('suggestions: chips, tick, quantity and a draft order per supplier', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/purchasing/suggest', {
      'GET /admin/reorder-suggestions': () => ok(SUGGESTIONS),
      'GET /admin/suppliers': () => ok({ suppliers: [{ id: 's9', name: 'Market Stall', contact_phone: null }] }),
      'POST /admin/purchase-orders': () => ok({ purchase_order: po({ id: 'po9', po_number: 'BP-0009', status: 'DRAFT' }) }),
    });
    const section = await screen.findByRole('region', { name: 'Lanka Wholesale' });
    expect(within(section).getByText('Low')).toBeInTheDocument();
    expect(within(section).getByText("Won't last")).toBeInTheDocument();
    expect(within(section).getByText('Fast mover')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No supplier yet' })).getByText('Out of stock')).toBeInTheDocument();
    expect(api.find('GET', '/admin/reorder-suggestions')[0]!.query).toMatchObject({ days: '14', cover_days: '7' });

    const qty = within(section).getByLabelText('Sugar (1 kg) quantity');
    await user.clear(qty);
    await user.type(qty, '12');
    await user.click(within(section).getByLabelText('Tick Tea (500 g)'));
    await user.click(within(section).getByRole('button', { name: 'Create order for Lanka Wholesale' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders')).toHaveLength(1));
    expect(api.find('POST', '/admin/purchase-orders')[0]!.body).toEqual({ supplier_id: 's1', lines: [{ product_id: 'p1', variant_id: null, ordered_qty: 12 }] });
    expect(await within(section).findByRole('link', { name: 'Open it to send' })).toHaveAttribute('href', '/more/purchasing/po9');

    // the unknown group takes the supplier chosen
    await user.selectOptions(screen.getByLabelText('Supplier for No supplier yet'), 's9');
    await user.click(screen.getByRole('button', { name: 'Create order for No supplier yet' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders')).toHaveLength(2));
    expect(api.find('POST', '/admin/purchase-orders')[1]!.body).toEqual({ supplier_id: 's9', lines: [{ product_id: 'p3', variant_id: null, ordered_qty: 4 }] });
  });

  it('suggestions: 28 days and a reason filter', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/purchasing/suggest', {
      'GET /admin/reorder-suggestions': () => ok(SUGGESTIONS),
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
    });
    await screen.findByRole('region', { name: 'Lanka Wholesale' });
    await user.click(screen.getByRole('button', { name: 'Last 28 days' }));
    await waitFor(() => expect(api.find('GET', '/admin/reorder-suggestions').some((c) => c.query.days === '28')).toBe(true));
    await screen.findByRole('region', { name: 'Lanka Wholesale' });
    await user.click(screen.getByRole('button', { name: 'Out of stock' }));
    expect(screen.queryByRole('region', { name: 'Lanka Wholesale' })).toBeNull();
    expect(screen.getByRole('region', { name: 'No supplier yet' })).toBeInTheDocument();
  });

  it('says what to do when migration 058 has not been run', async () => {
    renderAs(OPERATIONS_STAFF, '/more/purchasing/suggest', {
      'GET /admin/reorder-suggestions': () => fail(503, 'PURCHASING_NOT_READY'),
      'GET /admin/suppliers': () => fail(503, 'PURCHASING_NOT_READY'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 058');
  });

  it('a sent order: share text, receive part of it (cost kept), the untracked note', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/purchasing/po1', {
      'GET /admin/purchase-orders/:id': () => ok({ purchase_order: po() }),
      'POST /admin/purchase-orders/:id/receive': () =>
        ok({
          purchase_order: po({ status: 'PARTIAL' }),
          received: [],
          skipped: [{ item_id: 'i2', name: 'Tea (500 g)', received_qty: 2, note: 'Stock is not counted for this product (untracked), so no stock was added.' }],
        }),
    });
    expect(await screen.findByRole('heading', { name: 'BP-0007' })).toBeInTheDocument();
    expect(screen.getByLabelText('Text for the supplier')).toHaveTextContent('Order for Lanka Wholesale:');
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/94771234567?text=x');
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Receive goods' }));
    expect(screen.getByLabelText('Sugar (1 kg) arrived now')).toHaveValue('6');
    const sugar = screen.getByLabelText('Sugar (1 kg) arrived now');
    await user.clear(sugar);
    await user.type(sugar, '3');
    await user.click(screen.getByLabelText('Update cost of Sugar (1 kg)'));
    const tea = screen.getByLabelText('Tea (500 g) arrived now');
    await user.clear(tea);
    await user.type(tea, '2');
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po1/receive')).toHaveLength(1));
    expect(api.find('POST', '/admin/purchase-orders/po1/receive')[0]!.body).toEqual({
      lines: [
        { item_id: 'i1', received_qty: 3, unit_cost: 100, update_product_cost: true },
        { item_id: 'i2', received_qty: 2 },
      ],
    });
    expect(await screen.findByText(/Tea \(500 g\): Stock is not counted/)).toBeInTheDocument();
    expect(screen.getByText('Partly received')).toBeInTheDocument();
  });

  it('a draft is marked as sent; cancelling asks why', async () => {
    const user = userEvent.setup();
    const draft = po({ status: 'DRAFT', sent_at: null });
    const { api } = renderAs(OPERATIONS_STAFF, '/more/purchasing/po1', {
      'GET /admin/purchase-orders/:id': () => ok({ purchase_order: draft }),
      'POST /admin/purchase-orders/:id/send': () => ok({ purchase_order: po({ status: 'SENT' }), message: 'Order for Lanka Wholesale:', whatsapp_url: null }),
      'POST /admin/purchase-orders/:id/cancel': () => ok({ purchase_order: po({ status: 'CANCELLED', cancel_reason: 'Closed' }) }),
    });
    await screen.findByRole('heading', { name: 'BP-0007' });
    await user.click(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po1/send')).toHaveLength(1));
    expect(await screen.findByText(/marked as sent/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByRole('button', { name: 'Cancel this order' })).toBeDisabled();
    await user.type(screen.getByLabelText('Cancel reason'), 'Closed');
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po1/cancel')[0]?.body).toEqual({ reason: 'Closed' }));
    expect(await screen.findByText('Cancelled: Closed')).toBeInTheDocument();
  });
});

describe('purchasing helpers (Ops copy)', () => {
  const it1 = item({}) as unknown as ReorderItem;
  const group = { supplier_id: 's1', supplier_name: 'Lanka Wholesale', supplier_phone: null, items: [it1], estimated_cost: 0 } as ReorderGroup;

  it('builds the order body from ticked lines', () => {
    expect(orderBodyFor(group, { [itemKey(it1)]: 5 }, { [itemKey(it1)]: true })).toEqual({ supplier_id: 's1', lines: [{ product_id: 'p1', variant_id: null, ordered_qty: 5 }] });
    expect(orderBodyFor(group, { [itemKey(it1)]: 5 }, { [itemKey(it1)]: false }).lines).toEqual([]);
  });

  it('the receive form leaves out lines that did not arrive', () => {
    const lines = LINES as unknown as PoLine[];
    const e = receiveDefaults({ lines });
    e.i2!.qty = '0';
    expect(receiveBody({ lines }, e, false)).toEqual({ ok: true, body: { lines: [{ item_id: 'i1', received_qty: 6 }] } });
  });
});
