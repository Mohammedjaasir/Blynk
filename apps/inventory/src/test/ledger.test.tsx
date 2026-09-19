import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { LedgerEntry } from '../api/types';
import { STAFF, ok, pageOf, renderAs, stockRow } from './helpers';

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e1',
  inventory_id: 'inv-1',
  product_id: 'p-milk',
  product_name: 'Kotmale Fresh Milk 1L',
  product_sku: 'SKU-DAI-001',
  product_unit: '1 L',
  adjustment_type: 'PURCHASE_RESTOCK',
  quantity_delta: 24,
  previous_quantity: 12,
  new_quantity: 36,
  reference_order_id: null,
  notes: 'Carton',
  created_by_user_id: 'a1',
  actor_name: 'Nawaz Mansoor',
  created_at: '2026-09-18T10:00:00.000Z',
  ...overrides,
});

// Deliberately not in date order: the screen must keep the backend's order.
const ENTRIES = [
  entry({ id: 'e3', adjustment_type: 'ORDER_FULFILLMENT', quantity_delta: -2, previous_quantity: 36, new_quantity: 34, actor_name: 'Kasun Perera', notes: 'Order BL-1 item sourcing fulfillment', created_at: '2026-09-18T12:00:00.000Z' }),
  entry({ id: 'e2', adjustment_type: 'DAMAGE_WRITE_OFF', quantity_delta: -1, previous_quantity: 37, new_quantity: 36, created_at: '2026-09-18T09:00:00.000Z' }),
  entry({ id: 'e1' }),
];

describe('ledger', () => {
  it('lists entries in the order the backend returns, with type, change, balance and who recorded them', async () => {
    renderAs(STAFF, '/ledger', {
      'GET /admin/inventory/adjustments': () => ok(pageOf('adjustments', ENTRIES)),
    });
    // Wait for table data (the type filter also lists "Order fulfilment").
    await screen.findByText('Order BL-1 item sourcing fulfillment');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('td:nth-child(3)')!.textContent)).toEqual([
      'Order fulfilment',
      'Damage write-off',
      'Restock',
    ]);
    expect(rows[0]).toHaveTextContent('−2');
    expect(rows[0]).toHaveTextContent('36 → 34');
    expect(rows[0]).toHaveTextContent('Kasun Perera');
    expect(rows[2]).toHaveTextContent('+24');
  });

  it('marks a customer who returned stock by cancelling, so they are not read as staff', async () => {
    renderAs(STAFF, '/ledger', {
      'GET /admin/inventory/adjustments': () =>
        ok(
          pageOf('adjustments', [
            entry({ id: 'r1', adjustment_type: 'ORDER_CANCELLATION_RESTORE', quantity_delta: 2, previous_quantity: 34, new_quantity: 36, actor_name: 'Ahmed Rizvi', actor_role: 'CUSTOMER', notes: 'Order BL-1 cancelled by the customer: 2 returned to stock' }),
            entry({ id: 'r0', adjustment_type: 'ORDER_FULFILLMENT', quantity_delta: -2, previous_quantity: 36, new_quantity: 34, actor_name: 'Kasun Perera', actor_role: 'PACKING_STAFF' }),
          ])
        ),
    });
    await screen.findByText('Order BL-1 cancelled by the customer: 2 returned to stock');
    const [restore, fulfilment] = screen.getAllByRole('row').slice(1);
    expect(restore.querySelector('td:nth-child(3)')!.textContent).toBe('Cancellation restore');
    expect(restore).toHaveTextContent('+2');
    expect(restore.querySelector('td:nth-child(6)')!.textContent).toBe('Ahmed Rizvi · customer');
    expect(fulfilment.querySelector('td:nth-child(6)')!.textContent).toBe('Kasun Perera');
  });

  it('sends product, type and date filters to the API', async () => {
    const { api } = renderAs(STAFF, '/ledger', {
      'GET /admin/inventory': () => ok(pageOf('inventory', [stockRow()])),
      'GET /admin/inventory/adjustments': () => ok(pageOf('adjustments', ENTRIES)),
    });
    await screen.findByText('Order BL-1 item sourcing fulfillment');
    await screen.findByRole('option', { name: 'Kotmale Fresh Milk 1L' });

    await userEvent.selectOptions(screen.getByLabelText('Filter by product'), 'p-milk');
    await userEvent.selectOptions(screen.getByLabelText('Filter by adjustment type'), 'DAMAGE_WRITE_OFF');
    const from = screen.getByLabelText('From') as HTMLInputElement;
    await userEvent.type(from, '2026-09-01');

    await waitFor(() => {
      const last = api.find('GET', '/admin/inventory/adjustments').at(-1)!.query;
      expect(last.get('product_id')).toBe('p-milk');
      expect(last.get('type')).toBe('DAMAGE_WRITE_OFF');
      expect(new Date(last.get('from')!).getDate()).toBe(1);
    });
  });

  it('pages through results', async () => {
    const { api } = renderAs(STAFF, '/ledger', {
      'GET /admin/inventory/adjustments': (call) =>
        ok({
          adjustments: ENTRIES,
          pagination: { page: Number(call.query.get('page') ?? 1), limit: 50, total: 120, total_pages: 3 },
        }),
    });
    await screen.findByText('120 entries · page 1 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.find('GET', '/admin/inventory/adjustments').at(-1)!.query.get('page')).toBe('2'));
    expect(await screen.findByText('120 entries · page 2 of 3')).toBeInTheDocument();
  });

  it('explains an empty filtered view', async () => {
    renderAs(STAFF, '/ledger?type=DAMAGE_WRITE_OFF', {
      'GET /admin/inventory/adjustments': () => ok(pageOf('adjustments', [])),
    });
    expect(await screen.findByText('No entries match these filters')).toBeInTheDocument();
  });
});
