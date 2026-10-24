import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/** Reorder suggestions and Purchase orders (2026-10-25, migration 058) against a fake API. */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(path: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[path]}>
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

const line = (over: Record<string, unknown>) => ({
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
  rule: 'Suggested = what sells in the cover days.',
  totals: { products: 3, out: 1, units: 20, estimated_cost: 1500 },
  suppliers: [
    {
      supplier_id: 's1',
      supplier_name: 'Lanka Wholesale',
      supplier_phone: '0771234567',
      estimated_cost: 1100,
      items: [line({}), line({ product_id: 'p2', display_name: 'Tea (500 g)', sku: 'TEA-1', reasons: ['FAST'], suggested_quantity: 3, last_cost: 300, in_draft: 2 })],
    },
    {
      supplier_id: null,
      supplier_name: null,
      supplier_phone: null,
      estimated_cost: 400,
      items: [
        line({
          product_id: 'p3',
          display_name: 'Rice (5 kg)',
          sku: 'RIC-1',
          supplier_id: null,
          supplier_name: null,
          supplier_phone: null,
          reasons: ['OUT'],
          suggested_quantity: 4,
          last_cost: 100,
          days_of_stock_left: null,
          avg_daily_units: 0,
          buy_multiple: 4,
        }),
      ],
    },
  ],
};

const PO_LINES = [
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
  notes: 'Before noon',
  expected_on: '2026-10-27',
  created_by_name: 'Nawaz',
  sent_at: '2026-10-24T05:00:00.000Z',
  received_at: null,
  cancelled_at: null,
  cancel_reason: null,
  created_at: '2026-10-24T04:00:00.000Z',
  lines: PO_LINES,
  totals: { lines: 2, units_ordered: 16, units_received: 4, cost_ordered: 1075, cost_received: 400 },
  share: { text: 'Order for Lanka Wholesale:\n10 x Sugar (1 kg)\n6 x Tea (500 g)\nRef: BP-0007 (Blynk)', whatsapp_url: 'https://wa.me/94771234567?text=x' },
  ...over,
});

describe('Reorder suggestions page', () => {
  const handler =
    (extra?: (c: Call) => Reply | undefined) =>
    (c: Call): Reply | undefined =>
      extra?.(c) ??
      (c.method === 'GET' && c.path === '/admin/reorder-suggestions'
        ? ok(SUGGESTIONS)
        : c.method === 'GET' && c.path === '/admin/suppliers'
          ? ok({ suppliers: [{ id: 's9', name: 'Market Stall', contact_phone: null }] })
          : undefined);

  it('groups lines by supplier with chips, stock, sales and cost, and asks for 14 days by default', async () => {
    const api = renderAt('/reorder-suggestions', handler());
    const table = await screen.findByRole('table', { name: 'Suggestions for Lanka Wholesale' });
    expect(within(table).getByText(/Sugar \(1 kg\)/)).toBeInTheDocument();
    expect(within(table).getByText('Low')).toBeInTheDocument();
    expect(within(table).getByText("Won't last")).toBeInTheDocument();
    expect(within(table).getByText('Fast mover')).toBeInTheDocument();
    expect(within(table).getAllByText('3.5 days')).toHaveLength(2);
    expect(within(table).getAllByText('0.57/day')).toHaveLength(2);
    expect(within(table).getByText('2 already in a draft order')).toBeInTheDocument();
    const unknown = screen.getByRole('table', { name: 'Suggestions for No supplier yet' });
    expect(within(unknown).getByText('Out of stock')).toBeInTheDocument();
    expect(within(unknown).getByText('No sales')).toBeInTheDocument();
    expect(within(unknown).getByText('Bought in packs of 4')).toBeInTheDocument();
    expect(api.find('GET', '/admin/reorder-suggestions')[0]!.query.get('days')).toBe('14');
    expect(api.find('GET', '/admin/reorder-suggestions')[0]!.query.get('cover_days')).toBe('7');
  });

  it('refetches for 28 days', async () => {
    const user = userEvent.setup();
    const api = renderAt('/reorder-suggestions', handler());
    await screen.findByRole('table', { name: 'Suggestions for Lanka Wholesale' });
    await user.click(screen.getByRole('button', { name: 'Last 28 days' }));
    await waitFor(() => expect(api.find('GET', '/admin/reorder-suggestions').some((c) => c.query.get('days') === '28')).toBe(true));
  });

  it('filters by reason and by text', async () => {
    const user = userEvent.setup();
    renderAt('/reorder-suggestions', handler());
    await screen.findByRole('table', { name: 'Suggestions for Lanka Wholesale' });
    await user.click(screen.getByRole('button', { name: 'Out of stock' }));
    expect(screen.queryByRole('table', { name: 'Suggestions for Lanka Wholesale' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Suggestions for No supplier yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByLabelText('Filter products'), 'tea');
    const table = screen.getByRole('table', { name: 'Suggestions for Lanka Wholesale' });
    expect(within(table).queryByText(/Sugar/)).toBeNull();
    expect(within(table).getByText(/Tea \(500 g\)/)).toBeInTheDocument();
  });

  it('creates a draft order for a supplier from the ticked lines and quantities, then links to it', async () => {
    const user = userEvent.setup();
    const api = renderAt(
      '/reorder-suggestions',
      handler((c) => (c.method === 'POST' && c.path === '/admin/purchase-orders' ? ok({ purchase_order: po({ id: 'po9', po_number: 'BP-0009', status: 'DRAFT' }) }) : undefined))
    );
    const table = await screen.findByRole('table', { name: 'Suggestions for Lanka Wholesale' });
    const qty = within(table).getByLabelText('Sugar (1 kg) quantity');
    await user.clear(qty);
    await user.type(qty, '12');
    await user.click(within(table).getByLabelText('Tick Tea (500 g)'));
    await user.click(screen.getByRole('button', { name: 'Create purchase order for Lanka Wholesale' }));

    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders')).toHaveLength(1));
    expect(api.find('POST', '/admin/purchase-orders')[0]!.body).toEqual({
      supplier_id: 's1',
      lines: [{ product_id: 'p1', variant_id: null, ordered_qty: 12 }],
    });
    const link = await screen.findByRole('link', { name: 'Open it to send' });
    expect(link).toHaveAttribute('href', '/purchase-orders/po9');
    expect(screen.queryByRole('button', { name: 'Create purchase order for Lanka Wholesale' })).toBeNull();
  });

  it('"Create purchase orders" makes one per supplier group, the unknown group with the supplier chosen', async () => {
    const user = userEvent.setup();
    const api = renderAt(
      '/reorder-suggestions',
      handler((c) => (c.method === 'POST' && c.path === '/admin/purchase-orders' ? ok({ purchase_order: po({ id: `po-${c.body.lines.length}`, status: 'DRAFT' }) }) : undefined))
    );
    await screen.findByRole('table', { name: 'Suggestions for Lanka Wholesale' });
    await user.selectOptions(await screen.findByLabelText('Supplier for this order'), 's9');
    await user.click(screen.getByRole('button', { name: 'Create purchase orders (2)' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders')).toHaveLength(2));
    const bodies = api.find('POST', '/admin/purchase-orders').map((c) => c.body);
    expect(bodies[0]).toMatchObject({ supplier_id: 's1' });
    expect(bodies[0].lines).toHaveLength(2);
    expect(bodies[1]).toEqual({ supplier_id: 's9', lines: [{ product_id: 'p3', variant_id: null, ordered_qty: 4 }] });
  });

  it('shows what to do when migration 058 has not been run', async () => {
    renderAt('/reorder-suggestions', (c) => (c.path === '/admin/reorder-suggestions' ? fail(503, 'PURCHASING_NOT_READY') : ok({ suppliers: [] })));
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 058');
  });

  it('says so when nothing needs buying', async () => {
    renderAt('/reorder-suggestions', (c) => (c.path === '/admin/reorder-suggestions' ? ok({ ...SUGGESTIONS, suppliers: [] }) : ok({ suppliers: [] })));
    expect(await screen.findByText('Nothing to reorder')).toBeInTheDocument();
  });
});

describe('Purchase orders pages', () => {
  const summary = (over: Record<string, unknown>) => ({
    id: 'po1',
    po_number: 'BP-0007',
    supplier_id: 's1',
    supplier_name: 'Lanka Wholesale',
    status: 'SENT',
    notes: null,
    expected_on: '2026-10-27',
    created_by_name: 'Nawaz',
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

  it('lists orders with status chips and progress, open ones first, and filters by status', async () => {
    const user = userEvent.setup();
    const api = renderAt('/purchase-orders', (c) =>
      c.method === 'GET' && c.path === '/admin/purchase-orders'
        ? ok({
            purchase_orders: [
              summary({}),
              summary({ id: 'po2', po_number: 'BP-0008', status: 'DRAFT', supplier_name: null, supplier_id: null, units_received: 0 }),
            ],
            page: 1,
            limit: 50,
            total: 2,
          })
        : undefined
    );
    const table = await screen.findByRole('table', { name: 'Purchase orders' });
    expect(within(table).getByRole('link', { name: 'BP-0007' })).toHaveAttribute('href', '/purchase-orders/po1');
    expect(within(table).getByText('Sent')).toBeInTheDocument();
    expect(within(table).getByText('Draft')).toBeInTheDocument();
    expect(within(table).getByText('4 of 16 received')).toBeInTheDocument();
    expect(within(table).getByText('No supplier yet')).toBeInTheDocument();
    expect(api.find('GET', '/admin/purchase-orders')[0]!.query.get('status')).toBe('OPEN');

    await user.click(screen.getByRole('button', { name: 'Received' }));
    await waitFor(() => expect(api.find('GET', '/admin/purchase-orders').some((c) => c.query.get('status') === 'RECEIVED')).toBe(true));
  });

  it('a sent order: shows the text to share, and receives part of it with the cost kept', async () => {
    const user = userEvent.setup();
    const api = renderAt('/purchase-orders/po1', (c) => {
      if (c.method === 'GET' && c.path === '/admin/purchase-orders/po1') return ok({ purchase_order: po() });
      if (c.method === 'GET' && c.path === '/admin/suppliers') return ok({ suppliers: [] });
      if (c.method === 'POST' && c.path === '/admin/purchase-orders/po1/receive') {
        return ok({
          purchase_order: po({ status: 'PARTIAL' }),
          received: [
            { item_id: 'i1', name: 'Sugar (1 kg)', received_qty: 3, stock_added: true, stock_on_hand: 9, note: null },
            { item_id: 'i2', name: 'Tea (500 g)', received_qty: 2, stock_added: false, stock_on_hand: null, note: 'Stock is not counted for this product (untracked), so no stock was added.' },
          ],
          skipped: [{ item_id: 'i2', name: 'Tea (500 g)', received_qty: 2, note: 'Stock is not counted for this product (untracked), so no stock was added.' }],
        });
      }
      return undefined;
    });
    expect(await screen.findByRole('heading', { name: 'BP-0007' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('4 of 16 received')).toBeInTheDocument();
    expect(screen.getByLabelText('Text for the supplier')).toHaveTextContent('Order for Lanka Wholesale:');
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/94771234567?text=x');
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull();
    expect(screen.getByText(/Stock is not counted for this product, so receiving adds no stock/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Receive goods' }));
    // starts with what is still missing
    expect(screen.getByLabelText('Sugar (1 kg) arrived now')).toHaveValue('6');
    const sugar = screen.getByLabelText('Sugar (1 kg) arrived now');
    await user.clear(sugar);
    await user.type(sugar, '3');
    const cost = screen.getByLabelText('Sugar (1 kg) cost paid');
    await user.clear(cost);
    await user.type(cost, '90');
    await user.click(screen.getByLabelText('Update cost of Sugar (1 kg)'));
    const tea = screen.getByLabelText('Tea (500 g) arrived now');
    await user.clear(tea);
    await user.type(tea, '2');
    await user.click(screen.getByRole('button', { name: 'Receive' }));

    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po1/receive')).toHaveLength(1));
    expect(api.find('POST', '/admin/purchase-orders/po1/receive')[0]!.body).toEqual({
      lines: [
        { item_id: 'i1', received_qty: 3, unit_cost: 90, update_product_cost: true },
        { item_id: 'i2', received_qty: 2 },
      ],
    });
    expect(await screen.findByText(/Tea \(500 g\): Stock is not counted/)).toBeInTheDocument();
    expect(screen.getByText('Partly received')).toBeInTheDocument();
  });

  it('a draft can be marked as sent, and a cancel needs a reason', async () => {
    const user = userEvent.setup();
    const api = renderAt('/purchase-orders/po1', (c) => {
      if (c.method === 'GET' && c.path === '/admin/purchase-orders/po1') return ok({ purchase_order: po({ status: 'DRAFT', sent_at: null, lines: PO_LINES.map((l) => ({ ...l, received_qty: 0, remaining_qty: l.ordered_qty })) }) });
      if (c.method === 'GET' && c.path === '/admin/suppliers') return ok({ suppliers: [] });
      if (c.method === 'POST' && c.path === '/admin/purchase-orders/po1/send') {
        return ok({ purchase_order: po({ status: 'SENT' }), message: 'Order for Lanka Wholesale:', whatsapp_url: null });
      }
      if (c.method === 'POST' && c.path === '/admin/purchase-orders/po1/cancel') return ok({ purchase_order: po({ status: 'CANCELLED', cancel_reason: 'Supplier closed' }) });
      return undefined;
    });
    await screen.findByRole('heading', { name: 'BP-0007' });
    expect(screen.queryByRole('button', { name: 'Receive goods' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po1/send')).toHaveLength(1));
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const confirm = screen.getByRole('button', { name: 'Cancel this order' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Cancel reason'), 'Supplier closed');
    await user.click(confirm);
    await waitFor(() => expect(api.find('POST', '/admin/purchase-orders/po1/cancel')[0]?.body).toEqual({ reason: 'Supplier closed' }));
    expect(await screen.findByText('Cancelled: Supplier closed')).toBeInTheDocument();
    expect(screen.queryByLabelText('Text for the supplier')).toBeNull();
  });

  it('shows the server answer when receiving fails', async () => {
    const user = userEvent.setup();
    renderAt('/purchase-orders/po1', (c) => {
      if (c.method === 'GET' && c.path === '/admin/purchase-orders/po1') return ok({ purchase_order: po() });
      if (c.method === 'POST') return fail(409, 'PURCHASE_ORDER_NOT_OPEN', 'This purchase order is already closed.');
      return ok({ suppliers: [] });
    });
    await screen.findByRole('heading', { name: 'BP-0007' });
    await user.click(screen.getByRole('button', { name: 'Receive goods' }));
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This purchase order is already closed.');
  });
});
