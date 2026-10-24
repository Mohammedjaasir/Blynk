import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { AdjustDialog } from '../pages/Inventory/AdjustDialog';
import { OPERATIONS_STAFF, fail, mockApi, ok, renderAs } from './helpers';

/**
 * More -> Expiry (wave 2, 2026-10-25; migration 059): buckets, add a batch, sold out, discard, the "not
 * switched on yet" state, and the optional expiry date on a stock-received adjustment - all against a fake API.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const batch = (over: Record<string, unknown>) => ({
  id: 'b1',
  product_id: 'p1',
  product_name: 'Fresh Milk',
  product_sku: 'MILK-1',
  variant_id: null,
  variant_label: null,
  batch_code: null,
  quantity: 6,
  expires_on: '2026-10-20',
  days_left: -5,
  severity: 'expired',
  label: 'Expired 5 days ago',
  status: 'ACTIVE',
  note: null,
  received_at: '2026-10-10T05:00:00.000Z',
  ...over,
});
const EXPIRED = batch({});
const WEEK = batch({ id: 'b2', product_id: 'p2', product_name: 'Curd', batch_code: 'C-9', quantity: 12, expires_on: '2026-10-28', days_left: 3, severity: 'red', label: 'Expires in 3 days' });
const SUMMARY = {
  today: '2026-10-25',
  expired: { batches: 1, units: 6 },
  week: { batches: 1, units: 12 },
  month: { batches: 0, units: 0 },
  within_3_days: 1,
  total_active: 2,
};

const handlers = () => ({
  'GET /admin/stock-batches/summary': () => ok(SUMMARY),
  'GET /admin/stock-batches': (c: { query: Record<string, string> }) => {
    const rows = [EXPIRED, WEEK].filter((b) => c.query.bucket === 'all' || (c.query.bucket === 'expired' ? b.severity === 'expired' : c.query.bucket === 'week' ? b.severity === 'red' : false));
    return ok({ today: '2026-10-25', batches: rows, total: rows.length, page: 1, limit: 200 });
  },
});

describe('More -> Expiry', () => {
  it('is reachable from More, opens on the most urgent bucket and switches buckets', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', handlers());
    await user.click(await screen.findByRole('link', { name: 'Expiry' }));
    const card = await screen.findByRole('listitem', { name: 'Fresh Milk, Expired 5 days ago' });
    expect(within(card).getByText('6 units · MILK-1')).toBeInTheDocument();
    expect(api.find('GET', '/admin/stock-batches')[0]!.query.bucket).toBe('expired');
    expect(screen.getByRole('button', { name: 'This week 1' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'This week 1' }));
    const curd = await screen.findByRole('listitem', { name: 'Curd, Expires in 3 days' });
    expect(within(curd).getByText(/12 units · batch C-9/)).toBeInTheDocument();
    expect(within(curd).getByText('28 Oct 2026')).toBeInTheDocument();
  });

  it('adds a batch: the product must be chosen, the numbers and date are checked', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/expiry', {
      ...handlers(),
      'GET /admin/products': () => ok({ products: [{ id: 'p77', name: 'Oat Milk 1L', category_name: 'Dairy', is_active: true, is_available: true }] }),
      'GET /admin/products/p77/variants': () => ok({ variants: [] }),
      'POST /admin/stock-batches': (c: { body: Record<string, unknown> }) => ok({ batch: batch({ id: 'new', ...c.body, product_name: 'Oat Milk 1L' }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add batch' }));
    const dialog = screen.getByRole('dialog', { name: 'Add batch' });
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the product first.');

    await user.type(within(dialog).getByRole('searchbox'), 'oat');
    await user.click(await within(dialog).findByRole('button', { name: /Oat Milk 1L/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter how many units');
    await user.type(within(dialog).getByLabelText('How many'), '24');
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick the expiry date.');
    fireEvent.change(within(dialog).getByLabelText('Expiry date'), { target: { value: '2026-12-31' } });
    await user.click(within(dialog).getByRole('button', { name: 'Add batch' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches')).toHaveLength(1));
    expect(api.find('POST', '/admin/stock-batches')[0]!.body).toEqual({
      product_id: 'p77',
      variant_id: null,
      quantity: 24,
      expires_on: '2026-12-31',
      batch_code: null,
      note: null,
    });
    expect(await screen.findByText('Batch of Oat Milk 1L added.')).toBeInTheDocument();
  });

  it('marks sold out after a confirm and discards with the stock count message', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/expiry', {
      ...handlers(),
      'POST /admin/stock-batches/b1/sold-out': () => ok({ batch: { ...EXPIRED, status: 'SOLD_OUT' } }),
      'POST /admin/stock-batches/b1/discard': () => ok({ batch: { ...EXPIRED, status: 'DISCARDED' }, stock_removed: 6, stock: { on_hand: 4, reserved: 0 } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Mark Fresh Milk sold out' }));
    const confirm = screen.getByRole('dialog', { name: 'Mark as sold out?' });
    expect(api.find('POST', '/admin/stock-batches/b1/sold-out')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Mark sold out' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches/b1/sold-out')).toHaveLength(1));
    expect(await screen.findByText('Fresh Milk marked sold out.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Discard Fresh Milk' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard batch' });
    expect(within(dialog).getByRole('radio', { name: 'Expired' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('radio', { name: /Waste/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Discard batch' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches/b1/discard')).toHaveLength(1));
    expect(api.find('POST', '/admin/stock-batches/b1/discard')[0]!.body).toEqual({ reason: 'WASTE', reduce_stock: true });
    expect(await screen.findByText('Fresh Milk discarded. 6 units taken off the stock count.')).toBeInTheDocument();
  });

  it('only closes the batch when "Take it off the stock count" is unticked', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/expiry', {
      ...handlers(),
      'POST /admin/stock-batches/b1/discard': () => ok({ batch: { ...EXPIRED, status: 'DISCARDED' }, stock_removed: 0, stock: null }),
    });
    await user.click(await screen.findByRole('button', { name: 'Discard Fresh Milk' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard batch' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Take it off the stock count' }));
    await user.click(within(dialog).getByRole('button', { name: 'Discard batch' }));
    await waitFor(() => expect(api.find('POST', '/admin/stock-batches/b1/discard')[0]?.body).toEqual({ reason: 'EXPIRED', reduce_stock: false }));
    expect(await screen.findByText('Fresh Milk discarded. Stock count unchanged.')).toBeInTheDocument();
  });

  it('before migration 059 it says which migration to run and Add batch is off', async () => {
    renderAs(OPERATIONS_STAFF, '/more/expiry', {
      'GET /admin/stock-batches/summary': () => fail(503, 'EXPIRY_NOT_READY'),
      'GET /admin/stock-batches': () => fail(503, 'EXPIRY_NOT_READY'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 059 in Coolify');
    expect(screen.getByRole('button', { name: 'Add batch' })).toBeDisabled();
  });
});

describe('Adjust stock: optional expiry date on a restock', () => {
  const detail = { product_id: 'p1', product_name: 'Fresh Milk', quantity_on_hand: 5, quantity_reserved: 0 };

  it('sends expires_on only for stock received, and only when filled in', async () => {
    const user = userEvent.setup();
    tokenStore.save('a', 'r');
    const api = mockApi({
      'POST /admin/inventory/p1/adjust': () => ok({ inventory: { quantity_on_hand: 11, quantity_available: 11 } }),
    });
    const done = vi.fn();
    render(<AdjustDialog detail={detail} onClose={() => undefined} onDone={done} />);
    // restock is the default type: the field is there
    await user.type(screen.getByLabelText('Units received'), '6');
    await user.type(screen.getByLabelText(/^Reason/), 'From the market');
    fireEvent.change(screen.getByLabelText(/^Expiry date/), { target: { value: '2026-11-30' } });
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(api.find('POST', '/admin/inventory/p1/adjust')).toHaveLength(1));
    expect(api.find('POST', '/admin/inventory/p1/adjust')[0]!.body).toEqual({
      adjustment_type: 'PURCHASE_RESTOCK',
      quantity_delta: 6,
      notes: 'From the market',
      expires_on: '2026-11-30',
    });
    await waitFor(() => expect(done).toHaveBeenCalledWith(11));
  });

  it('leaves expires_on out when the date is empty, and hides the field for a write-off', async () => {
    const user = userEvent.setup();
    tokenStore.save('a', 'r');
    const api = mockApi({
      'POST /admin/inventory/p1/adjust': () => ok({ inventory: { quantity_on_hand: 7, quantity_available: 7 } }),
    });
    render(<AdjustDialog detail={detail} onClose={() => undefined} onDone={() => undefined} />);
    await user.type(screen.getByLabelText('Units received'), '2');
    await user.type(screen.getByLabelText(/^Reason/), 'Top up');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(api.find('POST', '/admin/inventory/p1/adjust')).toHaveLength(1));
    expect(api.find('POST', '/admin/inventory/p1/adjust')[0]!.body).not.toHaveProperty('expires_on');

    await user.click(screen.getByRole('radio', { name: /Damage write-off/i }));
    expect(screen.queryByLabelText(/^Expiry date/)).not.toBeInTheDocument();
  });

  it('refuses a malformed date before sending', async () => {
    const user = userEvent.setup();
    tokenStore.save('a', 'r');
    const api = mockApi({});
    render(<AdjustDialog detail={detail} onClose={() => undefined} onDone={() => undefined} />);
    await user.type(screen.getByLabelText('Units received'), '2');
    await user.type(screen.getByLabelText(/^Reason/), 'Top up');
    fireEvent.change(screen.getByLabelText(/^Expiry date/), { target: { value: '2010-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too far in the past');
    expect(api.calls).toHaveLength(0);
  });
});
