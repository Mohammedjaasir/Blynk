import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { LowStockItem, StockDetail } from '../api/types';
import { ADMIN, STAFF, fail, ok, pageOf, renderAs, stockRow } from './helpers';

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

const item = (overrides: Partial<LowStockItem> = {}): LowStockItem => ({
  product_id: 'p-butter',
  product_name: 'Pelwatte Salted Butter 200g',
  product_sku: 'SKU-DAI-004',
  product_unit: '200 g',
  category_name: 'Dairy & Eggs',
  quantity_on_hand: 3,
  quantity_reserved: 0,
  quantity_available: 3,
  low_stock_threshold: 5,
  stock_state: 'LOW',
  ...overrides,
});

const REPORT = {
  items: [
    item({
      product_id: 'p-crackers',
      product_name: 'Munchee Super Cream Cracker 490g',
      quantity_on_hand: 1,
      quantity_reserved: 1,
      quantity_available: 0,
      stock_state: 'OUT',
    }),
    item(),
  ],
  counts: { low: 1, out: 1, total: 2 },
};

const lowStockHandler = { 'GET /admin/inventory/low-stock': () => ok(REPORT) };

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

describe('running low: nav badge', () => {
  it('shows the count in the nav, with the out/low split spelled out', async () => {
    renderAs(STAFF, '/', lowStockHandler);
    const nav = await screen.findByRole('navigation', { name: 'Inventory' });
    const link = within(nav).getByRole('link', { name: /Running low/ });
    await waitFor(() => expect(link).toHaveTextContent('1 out of stock, 1 low'));
    expect(link.querySelector('.nav__badge')).toHaveTextContent('2');
    expect(link.querySelector('.nav__badge--out')).not.toBeNull();
  });

  it('shows no badge when nothing is running low', async () => {
    const { api } = renderAs(ADMIN, '/');
    const nav = await screen.findByRole('navigation', { name: 'Inventory' });
    await waitFor(() => expect(api.find('GET', '/admin/inventory/low-stock').length).toBeGreaterThan(0));
    expect(within(nav).getByRole('link', { name: 'Running low' }).querySelector('.nav__badge')).toBeNull();
  });

  it('a failed count hides the badge and keeps the app working', async () => {
    renderAs(ADMIN, '/', { 'GET /admin/inventory/low-stock': () => fail(503, 'UNAVAILABLE') });
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Inventory' });
    expect(within(nav).getByRole('link', { name: 'Running low' }).querySelector('.nav__badge')).toBeNull();
  });
});

describe('running low: overview', () => {
  it('shows out and low counts with a link to the list', async () => {
    renderAs(ADMIN, '/', lowStockHandler);
    await screen.findByRole('heading', { name: 'Overview' });
    const main = document.getElementById('main')!;
    expect(await within(main).findByText('1 out of stock')).toBeInTheDocument();
    expect(within(main).getByText('1 low')).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: /See the list/ })).toHaveAttribute('href', '/low-stock');
  });
});

describe('running low: list page', () => {
  it('separates out of stock from low, each linking to the product stock panel', async () => {
    renderAs(ADMIN, '/low-stock', lowStockHandler);
    const outSection = await screen.findByRole('region', { name: 'Out of stock' });
    const lowSection = screen.getByRole('region', { name: 'Low stock' });

    expect(within(outSection).queryByText('Pelwatte Salted Butter 200g')).toBeNull();
    expect(within(outSection).getByText('0 units')).toBeInTheDocument();
    expect(within(lowSection).queryByText('Munchee Super Cream Cracker 490g')).toBeNull();
    expect(within(lowSection).getByText('3 units')).toBeInTheDocument();

    expect(within(outSection).getByRole('link', { name: 'Munchee Super Cream Cracker 490g' })).toHaveAttribute(
      'href',
      '/stock?product=p-crackers'
    );
    expect(within(lowSection).getByRole('link', { name: 'Restock: Pelwatte Salted Butter 200g' })).toHaveAttribute(
      'href',
      '/stock?product=p-butter'
    );
  });

  it('opens the product stock panel from the list', async () => {
    renderAs(ADMIN, '/low-stock', {
      ...lowStockHandler,
      'GET /admin/inventory': () => ok(pageOf('inventory', [stockRow()])),
      'GET /admin/inventory/:productId': () =>
        ok(detail({ product_id: 'p-butter', product_name: 'Pelwatte Salted Butter 200g' })),
    });
    await userEvent.click(await screen.findByRole('link', { name: 'Restock: Pelwatte Salted Butter 200g' }));
    const panel = await screen.findByRole('complementary', { name: 'Product stock' });
    expect(await within(panel).findByRole('heading', { name: 'Pelwatte Salted Butter 200g' })).toBeInTheDocument();
  });

  it('packing staff can restock too (owner decision)', async () => {
    renderAs(STAFF, '/low-stock', lowStockHandler);
    expect(await screen.findByRole('link', { name: 'Restock: Pelwatte Salted Butter 200g' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^View stock/ })).toBeNull();
  });

  it('explains an empty list', async () => {
    renderAs(ADMIN, '/low-stock');
    expect(await screen.findByText('Nothing is running low')).toBeInTheDocument();
  });

  it('reports a failed load with a retry', async () => {
    renderAs(ADMIN, '/low-stock', { 'GET /admin/inventory/low-stock': () => fail(503, 'UNAVAILABLE') });
    expect(await screen.findByText(/The Blynk API had a problem/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ threshold

type ThresholdCall = { body: { low_stock_threshold: number } };

function panelHandlers(d: StockDetail, patch?: (call: ThresholdCall) => unknown) {
  let current = d;
  return {
    'GET /admin/inventory': () => ok(pageOf('inventory', [stockRow()])),
    'PATCH /admin/inventory/:productId/threshold': (call: ThresholdCall) => {
      if (patch) return patch(call);
      current = { ...current, low_stock_threshold: call.body.low_stock_threshold };
      return ok({ low_stock_threshold: call.body.low_stock_threshold, is_low_stock: false });
    },
    'GET /admin/inventory/:productId': () => ok(current),
  };
}

describe('low-stock threshold (tracked products, ADMIN)', () => {
  it('lets an admin change the threshold and refreshes the panel and the nav count', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', panelHandlers(detail()));
    const input = await screen.findByLabelText('Low-stock threshold');
    expect(input).toHaveValue(5);
    await waitFor(() => expect(api.find('GET', '/admin/inventory/low-stock').length).toBeGreaterThan(0));
    const countsBefore = api.find('GET', '/admin/inventory/low-stock').length;

    await userEvent.clear(input);
    await userEvent.type(input, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save threshold' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/inventory/p-milk/threshold')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/inventory/p-milk/threshold')[0].body).toEqual({ low_stock_threshold: 10 });
    expect(await screen.findByText(/now counts as low at 10/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Low-stock threshold')).toHaveValue(10);
    await waitFor(() => expect(api.find('GET', '/admin/inventory/low-stock').length).toBeGreaterThan(countsBefore));
  });

  it('validates a whole number from 0 to 100000 before calling the API', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', panelHandlers(detail()));
    const input = await screen.findByLabelText('Low-stock threshold');
    await userEvent.clear(input);
    await userEvent.type(input, '100001');
    await userEvent.click(screen.getByRole('button', { name: 'Save threshold' }));
    expect(await screen.findByText('Use a whole number from 0 to 100000.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/inventory/p-milk/threshold')).toHaveLength(0);
  });

  it('explains PRODUCT_NOT_TRACKED (tracking changed meanwhile)', async () => {
    renderAs(
      ADMIN,
      '/stock?product=p-milk',
      panelHandlers(detail(), () => fail(409, 'PRODUCT_NOT_TRACKED', 'Product is not tracked'))
    );
    const input = await screen.findByLabelText('Low-stock threshold');
    await userEvent.clear(input);
    await userEvent.type(input, '8');
    await userEvent.click(screen.getByRole('button', { name: 'Save threshold' }));
    expect(await screen.findByText(/no longer tracked, so it has no low-stock threshold/)).toBeInTheDocument();
  });

  it('packing staff see the threshold but cannot edit it', async () => {
    renderAs(STAFF, '/stock?product=p-milk', panelHandlers(detail()));
    expect(await screen.findByText('The low-stock threshold is set by a Blynk admin.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Low-stock threshold')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save threshold' })).toBeNull();
  });

  it('is not offered for untracked products', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', panelHandlers(detail({ tracking_mode: 'UNTRACKED' })));
    expect(await screen.findByText(/Not counted/)).toBeInTheDocument();
    expect(screen.queryByText('Low-stock alert')).toBeNull();
    expect(screen.queryByLabelText('Low-stock threshold')).toBeNull();
  });
});
