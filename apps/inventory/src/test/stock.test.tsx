import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { StockDetail } from '../api/types';
import { ADMIN, STAFF, fail, ok, pageOf, renderAs, stockRow } from './helpers';

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

const ROWS = [
  stockRow(), // tracked, 47 in stock
  stockRow({
    product_id: 'p-new',
    inventory_id: null, // created in Admin, never tracked: no inventory row
    product_name: 'Invapp New Yoghurt',
    product_sku: 'SKU-NEW-1',
    tracking_mode: 'UNTRACKED',
    quantity_on_hand: 0,
    quantity_available: 0,
    updated_at: null,
  }),
  stockRow({
    product_id: 'p-crackers',
    product_name: 'Munchee Super Cream Cracker 490g',
    quantity_on_hand: 0,
    quantity_available: 0,
    is_low_stock: true,
  }), // tracked, empty, still active + available → orderable but out
  stockRow({
    product_id: 'p-butter',
    product_name: 'Pelwatte Salted Butter 200g',
    quantity_on_hand: 3,
    quantity_available: 3,
    is_low_stock: true,
  }),
  stockRow({
    product_id: 'p-soap',
    product_name: 'Invapp Inactive Soap',
    is_active: false,
    is_available: false,
    tracking_mode: 'UNTRACKED',
    quantity_on_hand: 0,
    quantity_available: 0,
  }),
];

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

describe('stock levels', () => {
  it('shows each stock state as a word, with units where stock is counted', async () => {
    renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => ok(pageOf('inventory', ROWS)) });
    await screen.findByText('Kotmale Fresh Milk 1L');

    expect(within(rowOf('Kotmale Fresh Milk 1L')).getByText('In stock')).toBeInTheDocument();
    expect(within(rowOf('Kotmale Fresh Milk 1L')).getByText('47 units')).toBeInTheDocument();
    expect(within(rowOf('Pelwatte Salted Butter 200g')).getByText('Low stock')).toBeInTheDocument();
    expect(within(rowOf('Munchee Super Cream Cracker 490g')).getByText('Out of stock')).toBeInTheDocument();
    expect(within(rowOf('Munchee Super Cream Cracker 490g')).getByText('0 units')).toBeInTheDocument();
  });

  it('lists a product with no inventory row as untracked, never counted', async () => {
    renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => ok(pageOf('inventory', ROWS)) });
    const row = rowOf(await screen.findByText('Invapp New Yoghurt').then((el) => el.textContent!));
    expect(within(row).getByText('UNTRACKED')).toBeInTheDocument();
    expect(within(row).getByText('Sourced on order')).toBeInTheDocument();
    expect(within(row).getByText('Never counted')).toBeInTheDocument();
    expect(within(row).queryByText(/units/)).toBeNull();
  });

  it('shows Admin-owned customer state read-only and flags orderable-but-out-of-stock (D1)', async () => {
    renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => ok(pageOf('inventory', ROWS)) });
    await screen.findByText('Kotmale Fresh Milk 1L');
    const crackers = rowOf('Munchee Super Cream Cracker 490g');
    expect(within(crackers).getByText('Orderable but out of stock')).toBeInTheDocument();
    expect(within(rowOf('Kotmale Fresh Milk 1L')).queryByText('Orderable but out of stock')).toBeNull();

    const soap = rowOf('Invapp Inactive Soap');
    expect(within(soap).getByText('Inactive')).toBeInTheDocument();
    expect(within(soap).getByText('Unavailable')).toBeInTheDocument();
  });

  it('searches by name or SKU and can include inactive products', async () => {
    const { api } = renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => ok(pageOf('inventory', ROWS)) });
    await screen.findByText('Kotmale Fresh Milk 1L');

    await userEvent.type(screen.getByLabelText(/Search products/), 'SKU-DAI');
    await waitFor(() =>
      expect(api.find('GET', '/admin/inventory').some((c) => c.query.get('search') === 'SKU-DAI')).toBe(true)
    );

    await userEvent.click(screen.getByLabelText('Include inactive products'));
    await waitFor(() =>
      expect(api.find('GET', '/admin/inventory').at(-1)!.query.get('include_inactive')).toBe('true')
    );
  });

  it('filters by tracking mode and low stock through the API', async () => {
    const { api } = renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => ok(pageOf('inventory', ROWS)) });
    await screen.findByText('Kotmale Fresh Milk 1L');

    await userEvent.click(screen.getByRole('button', { name: 'Tracked' }));
    await waitFor(() => expect(api.find('GET', '/admin/inventory').at(-1)!.query.get('tracking_mode')).toBe('TRACKED'));

    await userEvent.click(screen.getByRole('button', { name: 'Low & out' }));
    await waitFor(() => expect(api.find('GET', '/admin/inventory').at(-1)!.query.get('low_stock_only')).toBe('true'));
  });

  it('explains an empty result', async () => {
    renderAs(ADMIN, '/stock?q=zzz', { 'GET /admin/inventory': () => ok(pageOf('inventory', [])) });
    expect(await screen.findByText('No products match “zzz”')).toBeInTheDocument();
  });

  it('reports a failed load with the API message and a retry', async () => {
    renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => fail(503, 'UNAVAILABLE', 'Database unavailable') });
    expect(await screen.findByText(/The Blynk API had a problem/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reports a 403 as no access', async () => {
    renderAs(ADMIN, '/stock', { 'GET /admin/inventory': () => fail(403, 'FORBIDDEN', 'Forbidden') });
    expect(await screen.findByText('No access.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ adjustments

const detail = (overrides: Partial<StockDetail> = {}): StockDetail => ({
  product_id: 'p-milk',
  product_name: 'Kotmale Fresh Milk 1L',
  tracking_mode: 'TRACKED',
  quantity_on_hand: 12,
  quantity_reserved: 0,
  quantity_available: 12,
  low_stock_threshold: 5,
  is_low_stock: false,
  adjustments: [],
  ...overrides,
});

function adjustHandlers(d: StockDetail, adjustReply?: () => unknown) {
  return {
    'GET /admin/inventory': () => ok(pageOf('inventory', [stockRow({ quantity_on_hand: d.quantity_on_hand })])),
    'GET /admin/inventory/:productId': () => ok(d),
    'POST /admin/inventory/:productId/adjust': (call: { body: { quantity_delta: number } }) =>
      adjustReply ? adjustReply() : ok({ inventory: { quantity_on_hand: d.quantity_on_hand + call.body.quantity_delta } }),
  };
}

async function openAdjust() {
  await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock' }));
  return screen.findByRole('dialog', { name: /Adjust stock/ });
}

describe('stock adjustments (D3, tracked products, ADMIN)', () => {
  it('records a restock as a positive delta with the reason', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail()));
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '24');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Carton from the distributor');
    expect(within(dialog).getByText(/On hand 12/)).toHaveTextContent('On hand 12 → 36 (+24)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));

    await waitFor(() => expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(1));
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')[0].body).toEqual({
      adjustment_type: 'PURCHASE_RESTOCK',
      quantity_delta: 24,
      notes: 'Carton from the distributor',
    });
  });

  it('records a damage write-off as a negative delta', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail()));
    const dialog = await openAdjust();
    await userEvent.click(within(dialog).getByLabelText(/Damage write-off/));
    await userEvent.type(within(dialog).getByLabelText('Units written off'), '2');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Torn packs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/inventory/p-milk/adjust')[0]?.body).toMatchObject({
        adjustment_type: 'DAMAGE_WRITE_OFF',
        quantity_delta: -2,
      })
    );
  });

  it.each([
    ['9', -3],
    ['15', 3],
  ])('turns an audit count of %s into a delta of %i', async (counted, expected) => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail()));
    const dialog = await openAdjust();
    await userEvent.click(within(dialog).getByLabelText(/Audit correction/));
    await userEvent.type(within(dialog).getByLabelText('Counted on hand'), counted);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Shelf count');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/inventory/p-milk/adjust')[0]?.body).toMatchObject({
        adjustment_type: 'INVENTORY_AUDIT_ADJUSTMENT',
        quantity_delta: expected,
      })
    );
  });

  it.each([
    ['2.5', 'Use a whole number of units'],
    ['-4', 'Use a whole number of units'],
    ['0', 'The quantity must be at least 1.'],
  ])('refuses a restock of %s without calling the API', async (value, message) => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail()));
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), value);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    expect(await within(dialog).findByText(new RegExp(message))).toBeInTheDocument();
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(0);
  });

  it('refuses a write-off below zero and a missing reason', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail()));
    const dialog = await openAdjust();
    await userEvent.click(within(dialog).getByLabelText(/Damage write-off/));
    await userEvent.type(within(dialog).getByLabelText('Units written off'), '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    expect(await within(dialog).findByText(/Only 12 on hand/)).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Units written off'));
    await userEvent.type(within(dialog).getByLabelText('Units written off'), '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(0);
  });

  it('shows the backend refusal when it disagrees (backend is authoritative)', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail(), () => fail(409, 'PRODUCT_NOT_TRACKED')));
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '5');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Delivery');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    expect(await within(dialog).findByText(/Only tracked products can be adjusted/)).toBeInTheDocument();
  });

  it('sends one request however fast the button is pressed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api } = renderAs(
      ADMIN,
      '/stock?product=p-milk',
      adjustHandlers(detail(), async () => {
        await gate;
        return ok({ inventory: { quantity_on_hand: 13 } });
      })
    );
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '1');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'x');
    const submit = within(dialog).getByRole('button', { name: 'Record adjustment' });
    await userEvent.click(submit);
    await userEvent.click(submit);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(1);
  });

  it('offers no adjustment on an untracked product', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail({ tracking_mode: 'UNTRACKED' })));
    expect(await screen.findByRole('button', { name: 'Start tracking' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).toBeNull();
    expect(screen.getByText(/Start tracking to record restocks/)).toBeInTheDocument();
  });

  it('gives packing staff the panel without adjust or tracking controls', async () => {
    renderAs(STAFF, '/stock?product=p-milk', adjustHandlers(detail()));
    expect(await screen.findByText('units on hand')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).toBeNull();
    expect(screen.queryByRole('button', { name: /tracking/ })).toBeNull();
    expect(screen.getByText(/made by a Blynk admin/)).toBeInTheDocument();
  });

  it('starts tracking after confirmation', async () => {
    const d = detail({ tracking_mode: 'UNTRACKED', quantity_on_hand: 0, quantity_available: 0 });
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', {
      ...adjustHandlers(d),
      'PATCH /admin/inventory/:productId/mode': () => ok({ tracking_mode: 'TRACKED' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Start tracking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start tracking stock' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start tracking' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/inventory/p-milk/mode')[0]?.body).toEqual({ tracking_mode: 'TRACKED' })
    );
  });

  it('says when tracked stock moves: sourcing takes it, cancelling the order puts it back', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail({ tracking_mode: 'UNTRACKED', quantity_on_hand: 0, quantity_available: 0 })));
    await userEvent.click(await screen.findByRole('button', { name: 'Start tracking' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start tracking stock' });
    expect(dialog).toHaveTextContent('Sourcing an order for a tracked product takes from this count, and cancelling that order puts it back.');
  });

  it('says units already taken still come back if tracking stops', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', adjustHandlers(detail()));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop tracking' }));
    const dialog = await screen.findByRole('dialog', { name: /Stop tracking/ });
    expect(dialog).toHaveTextContent('Units already taken for an order still come back to this count if that order is cancelled.');
  });
});
