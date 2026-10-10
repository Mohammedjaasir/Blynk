import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { LowStockItem, LowStockResult, StockDetail } from '../api/types';
import { ADMIN_NO_RIDER, ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/** Low-stock alerts, per-product threshold, and the Delivery fee setting (API contract §2-3). */

// These screens render behind the full auth + shell boot; under a loaded,
// fully parallel suite that cold start can outlast the 1s/5s defaults.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function item(overrides: Partial<LowStockItem>): LowStockItem {
  return {
    product_id: 'prod1',
    product_name: 'Fresh Milk',
    product_sku: 'SKU-1',
    product_unit: '1 L',
    category_name: 'Dairy',
    quantity_on_hand: 0,
    quantity_reserved: 0,
    quantity_available: 0,
    low_stock_threshold: 5,
    stock_state: 'OUT',
    ...overrides,
  };
}

const LOW: LowStockResult = {
  items: [
    item({}),
    item({ product_id: 'prod2', product_name: 'Butter', quantity_on_hand: 3, quantity_available: 3, stock_state: 'LOW' }),
    item({ product_id: 'prod3', product_name: 'Eggs', quantity_on_hand: 2, quantity_available: 2, stock_state: 'LOW' }),
  ],
  counts: { low: 2, out: 1, total: 3 },
};

function detail(overrides: Partial<StockDetail> = {}): StockDetail {
  return {
    product_id: 'prod1',
    product_name: 'Fresh Milk',
    product_sku: 'SKU-1',
    tracking_mode: 'TRACKED',
    quantity_on_hand: 2,
    quantity_reserved: 0,
    quantity_available: 2,
    low_stock_threshold: 5,
    is_low_stock: true,
    adjustments: [],
    ...overrides,
  };
}

describe('Low-stock alerts', () => {
  it('badges the Catalog tab with the total, fetched once per load', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_NO_RIDER, '/', { 'GET /admin/inventory/low-stock': () => ok(LOW) });
    const tab = await screen.findByRole('link', { name: /^Catalog/ });
    await waitFor(() => expect(within(tab).getByText('3')).toBeInTheDocument());
    expect(tab).toHaveTextContent('3 running low');

    // Moving between screens does not re-fetch.
    await user.click(screen.getByRole('link', { name: /^More/ }));
    await user.click(screen.getByRole('link', { name: /^Home/ }));
    expect(api.find('GET', '/admin/inventory/low-stock')).toHaveLength(1);
  });

  it('shows no badge when nothing is low', async () => {
    renderAs(ADMIN_NO_RIDER, '/');
    const tab = await screen.findByRole('link', { name: /^Catalog/ });
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    expect(tab).not.toHaveTextContent('running low');
  });

  it('adds low stock to Home "Needs a look", linking to the Running low list', async () => {
    renderAs(ADMIN_NO_RIDER, '/', { 'GET /admin/inventory/low-stock': () => ok(LOW) });
    expect(await screen.findByText('1 product is out of stock, 2 products are running low.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Restock' })).toHaveAttribute('href', '/catalog/inventory/low-stock');
  });

  it('the Running low list shows OUT and LOW products, each linking to its stock page', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/low-stock', { 'GET /admin/inventory/low-stock': () => ok(LOW) });
    expect(await screen.findByText('1 out of stock · 2 low')).toBeInTheDocument();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.getAllByText('Low stock')).toHaveLength(2);
    const restock = screen.getAllByRole('link', { name: 'Restock' });
    expect(restock.map((a) => a.getAttribute('href'))).toEqual([
      '/catalog/inventory/stock/prod1',
      '/catalog/inventory/stock/prod2',
      '/catalog/inventory/stock/prod3',
    ]);
  });

  it('the Inventory overview links to Running low with its count', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory', {
      'GET /admin/inventory/low-stock': () => ok(LOW),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } }),
      'GET /admin/inventory/adjustments': () => ok({ adjustments: [], pagination: { page: 1, limit: 8, total: 0, total_pages: 1 } }),
    });
    const card = (await screen.findByText('Running low')).closest('a')!;
    expect(card).toHaveAttribute('href', '/catalog/inventory/low-stock');
    await waitFor(() => expect(within(card).getByText('3')).toBeInTheDocument());
  });
});

describe('Low-stock threshold', () => {
  it('a tracked product saves a new threshold, then reloads detail and alerts', async () => {
    const user = userEvent.setup();
    let threshold = 5;
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock/prod1', {
      'GET /admin/inventory/:productId': () => ok(detail({ low_stock_threshold: threshold })),
      'PATCH /admin/inventory/:productId/threshold': (call) => {
        threshold = call.body.low_stock_threshold;
        return ok({ low_stock_threshold: threshold, is_low_stock: false });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const input = screen.getByLabelText('Low-stock level');
    await user.clear(input);
    await user.type(input, '1.5');
    await user.click(screen.getByRole('button', { name: 'Save level' }));
    expect(await screen.findByText('Enter a whole number from 0 to 100000.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/inventory/prod1/threshold')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '12');
    await user.click(screen.getByRole('button', { name: 'Save level' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/inventory/prod1/threshold')[0]?.body).toEqual({ low_stock_threshold: 12 }));
    expect(await screen.findByText('≤ 12')).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/inventory/low-stock')).toHaveLength(2));
  });

  it('409 PRODUCT_NOT_TRACKED is explained, not swallowed', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock/prod1', {
      'GET /admin/inventory/:productId': () => ok(detail()),
      'PATCH /admin/inventory/:productId/threshold': () => fail(409, 'PRODUCT_NOT_TRACKED'),
    });
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('button', { name: 'Save level' }));
    expect(
      await screen.findByText('This product is not tracked, so it has no low-stock level. Start tracking it first.')
    ).toBeInTheDocument();
  });

  it('an untracked product offers no threshold control', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock/prod1', {
      'GET /admin/inventory/:productId': () => ok(detail({ tracking_mode: 'UNTRACKED' })),
    });
    await screen.findByText('Start tracking');
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });
});

/** The API's reply since per-km tiers (owner, 2026-10-10). */
const FLAT_FEE = { fee_lkr: 250, fee_mode: 'FLAT', tiers: [], max_fee_lkr: null, updated_at: null };

describe('Delivery fee setting', () => {
  it('shows the current fee and saves a valid new one', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ ...FLAT_FEE }),
      'PATCH /admin/settings/delivery-fee': (call) => ok({ ...FLAT_FEE, ...call.body, updated_at: '2026-09-30T10:00:00Z' }),
    });
    expect(await screen.findByText('LKR 250.00')).toBeInTheDocument();
    expect(screen.getByText('Orders already placed keep the fee they were placed with.')).toBeInTheDocument();

    const input = screen.getByLabelText('New fee (LKR)');
    await user.clear(input);
    await user.type(input, '199.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/delivery-fee')[0]?.body).toEqual({ fee_mode: 'FLAT', fee_lkr: 199.5 })
    );
    expect(await screen.findByText('Delivery fee saved: LKR 199.50.')).toBeInTheDocument();
    expect(screen.getByText('LKR 199.50')).toBeInTheDocument();
  });

  it('validates 0-1000 and 2 decimals before sending anything', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
    });
    const input = await screen.findByLabelText('New fee (LKR)');
    await screen.findByText('LKR 250.00');
    await user.clear(input);
    await user.type(input, '1500');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The fee can be at most LKR 1000.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '10.555');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Use at most 2 decimals.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);
  });

  it('shows the server VALIDATION_ERROR detail', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
      'PATCH /admin/settings/delivery-fee': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ message: 'fee_lkr must be at most 1000' }] },
      }),
    });
    await screen.findByText('LKR 250.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('fee_lkr must be at most 1000')).toBeInTheDocument();
  });
});

describe('Delivery fee by distance - per-km tiers (owner, 2026-10-10)', () => {
  it('switches to by distance: km 1 starts at the flat fee, rows add and remove, live example with a cap, saves the tiers', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ ...FLAT_FEE }),
      'PATCH /admin/settings/delivery-fee': (call) => ok({ ...FLAT_FEE, ...call.body, updated_at: '2026-10-10T10:00:00Z' }),
    });
    await screen.findByText('LKR 250.00');
    const feeCard = (await screen.findByRole('heading', { name: 'Delivery fee' })).closest('section') as HTMLElement;
    const modes = within(feeCard).getByRole('group', { name: 'How the fee is worked out' });
    expect(within(modes).getByRole('button', { name: 'Same fee for every order' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(modes).getByRole('button', { name: 'By distance (per km)' }));
    expect(within(modes).getByRole('button', { name: 'By distance (per km)' })).toHaveAttribute('aria-pressed', 'true');

    // No tiers stored yet: km 1 starts at the current flat fee.
    const km1 = within(feeCard).getByLabelText('km 1 amount (LKR)');
    expect(km1).toHaveValue('250');
    expect(within(feeCard).getByRole('button', { name: /Remove km 1/ })).toBeDisabled();
    await user.clear(km1);
    await user.type(km1, '100');
    await user.click(within(feeCard).getByRole('button', { name: /Add km 2/ }));
    const km2 = within(feeCard).getByLabelText('km 2 amount (LKR)');
    expect(km2).toHaveValue('100'); // a new row starts at the last row's amount
    await user.clear(km2);
    await user.type(km2, '60');
    await user.click(within(feeCard).getByRole('button', { name: /Add km 3/ }));
    const km3 = within(feeCard).getByLabelText('km 3 amount (LKR)');
    await user.clear(km3);
    await user.type(km3, '50');
    await user.click(within(feeCard).getByRole('button', { name: /Add km 4/ }));
    expect(within(feeCard).getByLabelText('km 4 amount (LKR)')).toBeInTheDocument();
    await user.click(within(feeCard).getByRole('button', { name: 'Remove km 4' }));
    expect(within(feeCard).queryByLabelText('km 4 amount (LKR)')).not.toBeInTheDocument();

    expect(within(feeCard).getByText(/Every started km counts: 2.3 km = km 1 \+ km 2 \+ km 3/)).toBeInTheDocument();
    const example = within(feeCard).getByTestId('km-tier-example');
    expect(example).toHaveTextContent('1 km = LKR 100');
    expect(example).toHaveTextContent('3 km = LKR 100 + 60 + 50 = LKR 210');
    expect(example).toHaveTextContent('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310');

    await user.type(within(feeCard).getByLabelText('Maximum fee (LKR, optional)'), '250');
    expect(example).toHaveTextContent('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310, capped at LKR 250');

    await user.click(within(feeCard).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/delivery-fee')[0].body).toEqual({
      fee_mode: 'DISTANCE_TIERS',
      tiers: [
        { km: 1, lkr: 100 },
        { km: 2, lkr: 60 },
        { km: 3, lkr: 50 },
      ],
      max_fee_lkr: 250,
    });
    expect(
      await within(feeCard).findByText('Delivery fee saved: by distance, km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50 · max LKR 250.')
    ).toBeInTheDocument();
    expect(within(feeCard).getByText('By distance')).toBeInTheDocument();
    expect(within(feeCard).getByTestId('fee-tiers-now')).toHaveTextContent('km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50 · max LKR 250');
  });

  it('shows stored tiers, refuses bad amounts and a bad cap before sending, and can go back to one fee', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () =>
        ok({
          ...FLAT_FEE,
          fee_mode: 'DISTANCE_TIERS',
          tiers: [
            { km: 1, lkr: 100 },
            { km: 2, lkr: 60 },
          ],
        }),
      'PATCH /admin/settings/delivery-fee': (call) => ok({ ...FLAT_FEE, ...call.body }),
    });
    const feeCard = (await screen.findByRole('heading', { name: 'Delivery fee' })).closest('section') as HTMLElement;
    expect(await within(feeCard).findByTestId('fee-tiers-now')).toHaveTextContent('km 1 LKR 100, km 2+ LKR 60');
    const modes = within(feeCard).getByRole('group', { name: 'How the fee is worked out' });
    expect(within(modes).getByRole('button', { name: 'By distance (per km)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(feeCard).getByLabelText('km 1 amount (LKR)')).toHaveValue('100');
    expect(within(feeCard).getByTestId('km-tier-example')).toHaveTextContent('3 km = LKR 100 + 60 + 60 = LKR 220');

    const km2 = within(feeCard).getByLabelText('km 2 amount (LKR)');
    await user.clear(km2);
    await user.type(km2, '1500');
    await user.click(within(feeCard).getByRole('button', { name: 'Save' }));
    expect(await within(feeCard).findByText('km 2: Enter at most 1,000.')).toBeInTheDocument();
    expect(km2).toHaveAttribute('aria-invalid', 'true');
    expect(within(feeCard).getByTestId('km-tier-example')).toHaveTextContent('Fill in every km to see an example.');

    await user.clear(km2);
    await user.type(km2, '10.555');
    await user.click(within(feeCard).getByRole('button', { name: 'Save' }));
    expect(await within(feeCard).findByText('km 2: Use at most 2 decimals.')).toBeInTheDocument();

    await user.clear(km2);
    await user.type(km2, '62.5');
    expect(within(feeCard).getByTestId('km-tier-example')).toHaveTextContent('3 km = LKR 100 + 62.50 + 62.50 = LKR 225');
    await user.type(within(feeCard).getByLabelText('Maximum fee (LKR, optional)'), '20000');
    await user.click(within(feeCard).getByRole('button', { name: 'Save' }));
    expect(await within(feeCard).findByText('Maximum fee: Enter at most 10,000.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);

    await user.click(within(modes).getByRole('button', { name: 'Same fee for every order' }));
    expect(within(feeCard).getByLabelText('New fee (LKR)')).toHaveValue('250');
    await user.click(within(feeCard).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/delivery-fee')[0].body).toEqual({ fee_mode: 'FLAT', fee_lkr: 250 });
    expect(await within(feeCard).findByText('Delivery fee saved: LKR 250.00.')).toBeInTheDocument();
  });
});

describe('Checkout settings (owner, 2026-10-08)', () => {
  const CHECKOUT = {
    coupons_enabled: false,
    // 9 Oct 2026, midnight in Colombo - the backend's default start (owner, 2026-10-09).
    new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
    updated_at: null,
  };

  it('shows both switches and saves them', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
      'PATCH /admin/settings/checkout': (call) => {
        const body = call.body as { new_customer_free_deliveries: object };
        return ok({
          ...CHECKOUT,
          ...body,
          new_customer_free_deliveries: { since: CHECKOUT.new_customer_free_deliveries.since, ...body.new_customer_free_deliveries },
          updated_at: '2026-10-08T10:00:00Z',
        });
      },
    });
    const card = (await screen.findByRole('heading', { name: 'Checkout' })).closest('section') as HTMLElement;
    const coupons = await within(card).findByRole('checkbox', { name: /Coupon codes at checkout/ });
    const free = within(card).getByRole('checkbox', { name: /Free deliveries for every customer/ });
    const count = within(card).getByLabelText('Free deliveries per customer');
    expect(coupons).not.toBeChecked();
    expect(free).toBeChecked();
    expect(count).toHaveValue('2');
    expect(within(card).getByText(/Counting orders since/)).toHaveTextContent('Counting orders since 9 Oct 2026');

    await user.click(coupons);
    await user.clear(count);
    await user.type(count, '3');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        coupons_enabled: true,
        new_customer_free_deliveries: { enabled: true, count: 3 },
      })
    );
    expect(await within(card).findByText('Checkout settings saved.')).toBeInTheDocument();

    await user.click(free);
    expect(count).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[1]?.body).toEqual({
        coupons_enabled: true,
        new_customer_free_deliveries: { enabled: false, count: 3 },
      })
    );
  });

  it("switches \"Show 'Save LKR' on offers\" (owner, 2026-10-10), sending it only when flipped", async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
      'GET /admin/settings/checkout': () => ok({ ...CHECKOUT, show_offer_savings: false }),
      'PATCH /admin/settings/checkout': (call) => ok({ ...CHECKOUT, ...(call.body as object), updated_at: '2026-10-10T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Checkout' })).closest('section') as HTMLElement;
    const savings = await within(card).findByRole('checkbox', { name: /Show 'Save LKR' on offers/ });
    expect(savings).not.toBeChecked();
    await user.click(savings);
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        coupons_enabled: false,
        new_customer_free_deliveries: { enabled: true, count: 2 },
        show_offer_savings: true,
      })
    );
    expect(await within(card).findByText('Checkout settings saved.')).toBeInTheDocument();
    expect(savings).toBeChecked();

    // Saved again unchanged: the switch is not resent.
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/checkout')[1]!.body).not.toHaveProperty('show_offer_savings');
  });

  it('starts the count again from today after a confirm (owner, 2026-10-09)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
      'PATCH /admin/settings/checkout': (call) => ok({ ...CHECKOUT, ...(call.body as object), updated_at: '2026-10-20T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Checkout' })).closest('section') as HTMLElement;
    await user.click(await within(card).findByRole('button', { name: 'Start again from today' }));

    // Nothing is sent until the operator confirms; Cancel sends nothing.
    const dialog = screen.getByRole('dialog', { name: 'Start free deliveries again from today?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);

    const before = Date.now();
    await user.click(within(card).getByRole('button', { name: 'Start again from today' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/settings/checkout')[0]!.body as {
      new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
    };
    expect(Object.keys(body)).toEqual(['new_customer_free_deliveries']);
    expect(body.new_customer_free_deliveries).toMatchObject({ enabled: true, count: 2 });
    expect(new Date(body.new_customer_free_deliveries.since).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await within(card).findByText('Free deliveries now count from today.')).toBeInTheDocument();
  });

  it('refuses a count above 10 before sending anything', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
    });
    const card = (await screen.findByRole('heading', { name: 'Checkout' })).closest('section') as HTMLElement;
    const count = await within(card).findByLabelText('Free deliveries per customer');
    await user.clear(count);
    await user.type(count, '11');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Enter a whole number from 0 to 10.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);
  });
});
