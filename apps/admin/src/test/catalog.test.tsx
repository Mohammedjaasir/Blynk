import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Products } from '../pages/Products';
import { Categories } from '../pages/Categories';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import { parseDeliveryFee, parseFreeDeliveryCount } from '../lib/deliveryFee';

/**
 * Delete product / delete category and the delivery fee setting against a
 * fake API shaped like the contract (DELETE /admin/products/:id,
 * DELETE /admin/categories/:id?move_to_category_id=, GET/PATCH
 * /admin/settings/delivery-fee). The API is the authority for the rules.
 */
type Call = { method: string; path: string; query: URLSearchParams; body: any };
type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };

function mockApi(handler: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const call = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^.*\/api\/v1/, ''),
        query: url.searchParams,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      const reply = handler(call) ?? { status: 404, error: { code: 'NOT_MOCKED', message: 'NOT_MOCKED' } };
      const status = reply.status ?? 200;
      const body = status < 400 ? { success: true, data: reply.data } : { success: false, error: reply.error };
      return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
    })
  );
  return { calls, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

const renderPage = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

const category = (id: string, name: string, product_count: number) => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  image_url: null,
  display_order: 0,
  is_active: true,
  product_count,
});

const MILK = {
  id: 'p1',
  category_id: 'c1',
  category_name: 'Dairy',
  name: 'Kotmale Fresh Milk 1L',
  slug: 'kotmale-fresh-milk-1l',
  sku: 'KOT-MILK-1L',
  barcode: null,
  unit: 'bottle',
  pack_size: '1L',
  description: null,
  image_url: null,
  purchase_cost: 430,
  custom_markup_percent: null,
  calculated_selling_price: 480,
  is_available: true,
  is_active: true,
};

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('delete product', () => {
  it('asks with the contract copy, sends DELETE and re-reads the list', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return { data: { categories: [category('c1', 'Dairy', 1)] } };
      if (c.method === 'GET' && c.path === '/admin/products') return { data: { products: deleted ? [] : [MILK] } };
      if (c.method === 'DELETE' && c.path === '/admin/products/p1') {
        deleted = true;
        return { data: { product_id: 'p1', mode: 'SOFT' } };
      }
    });
    renderPage(<Products />);

    await user.click(await screen.findByRole('button', { name: 'Delete Kotmale Fresh Milk 1L' }, { timeout: 4000 }));
    const dialog = screen.getByRole('dialog', { name: 'Delete product' });
    expect(dialog).toHaveTextContent('Delete Kotmale Fresh Milk 1L? Customers will no longer see it.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.find('DELETE', '/admin/products/p1')).toHaveLength(1));
    expect(await screen.findByText('No products match')).toBeInTheDocument();
    expect(await screen.findByText(/is deleted\. Its past orders keep their history/)).toBeInTheDocument();
  });

  it('cancel sends nothing', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/categories') return { data: { categories: [] } };
      if (c.path === '/admin/products') return { data: { products: [MILK] } };
    });
    renderPage(<Products />);
    await user.click(await screen.findByRole('button', { name: 'Delete Kotmale Fresh Milk 1L' }, { timeout: 4000 }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('links to the import page', async () => {
    mockApi((c) => {
      if (c.path === '/admin/categories') return { data: { categories: [] } };
      if (c.path === '/admin/products') return { data: { products: [] } };
    });
    renderPage(<Products />);
    expect(await screen.findByRole('button', { name: 'Import products' })).toBeInTheDocument();
  });
});

describe('delete category', () => {
  it('an empty category is a plain confirm', async () => {
    const user = userEvent.setup();
    let rows = [category('c1', 'Dairy', 3), category('c2', 'Snacks', 0)];
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return { data: { categories: rows } };
      if (c.method === 'DELETE' && c.path === '/admin/categories/c2') {
        rows = rows.filter((r) => r.id !== 'c2');
        return { data: { category_id: 'c2', moved_product_count: 0, mode: 'HARD' } };
      }
    });
    renderPage(<Categories />);

    await user.click(await screen.findByRole('button', { name: 'Delete Snacks' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete category' });
    expect(dialog).toHaveTextContent('Delete Snacks? Customers will no longer see it.');
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c2')).toHaveLength(1));
    expect(api.find('DELETE', '/admin/categories/c2')[0]!.query.get('move_to_category_id')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Snacks')).toBeNull());
  });

  it('a category with products needs a target before Delete is enabled; the target goes as a query param', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') {
        return { data: { categories: [category('c1', 'Dairy', 3), category('c2', 'Snacks', 0), category('c3', 'Bakery', 1)] } };
      }
      if (c.method === 'DELETE' && c.path === '/admin/categories/c1') {
        return { data: { category_id: 'c1', moved_product_count: 3, mode: 'HARD' } };
      }
    });
    renderPage(<Categories />);

    await user.click(await screen.findByRole('button', { name: 'Delete Dairy' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete category' });
    const select = within(dialog).getByLabelText('Move its 3 products to:');
    // Only the other categories are offered.
    expect(within(select).queryByRole('option', { name: 'Dairy' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();

    await user.selectOptions(select, 'c3');
    const del = within(dialog).getByRole('button', { name: 'Delete' });
    expect(del).toBeEnabled();
    await user.click(del);

    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c1')).toHaveLength(1));
    expect(api.find('DELETE', '/admin/categories/c1')[0]!.query.get('move_to_category_id')).toBe('c3');
    expect(await screen.findByText('Dairy is deleted. 3 products moved to Bakery.')).toBeInTheDocument();
  });

  it('409 CATEGORY_NOT_EMPTY (stale count) switches to the move select with the server count', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') {
        return { data: { categories: [category('c1', 'Dairy', 0), category('c2', 'Snacks', 0)] } };
      }
      if (c.method === 'DELETE' && c.path === '/admin/categories/c1') {
        return c.query.get('move_to_category_id')
          ? { data: { category_id: 'c1', moved_product_count: 2, mode: 'HARD' } }
          : { status: 409, error: { code: 'CATEGORY_NOT_EMPTY', message: 'Category has products', details: { product_count: 2 } } };
      }
    });
    renderPage(<Categories />);

    await user.click(await screen.findByRole('button', { name: 'Delete Dairy' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete category' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const select = await within(dialog).findByLabelText('Move its 2 products to:');
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.selectOptions(select, 'c2');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c1')).toHaveLength(2));
    expect(api.find('DELETE', '/admin/categories/c1')[1]!.query.get('move_to_category_id')).toBe('c2');
  });
});

describe('delivery fee setting', () => {
  it('validates 0-1000 with at most 2 decimals', () => {
    expect(parseDeliveryFee('150')).toEqual({ fee: 150 });
    expect(parseDeliveryFee(' 149.5 ')).toEqual({ fee: 149.5 });
    expect(parseDeliveryFee('0')).toEqual({ fee: 0 });
    expect(parseDeliveryFee('1000.00')).toEqual({ fee: 1000 });
    expect(parseDeliveryFee('')).toHaveProperty('error');
    expect(parseDeliveryFee('abc')).toHaveProperty('error');
    expect(parseDeliveryFee('-1')).toHaveProperty('error');
    expect(parseDeliveryFee('1000.01')).toHaveProperty('error');
    expect(parseDeliveryFee('12.345')).toEqual({ error: 'Use at most 2 decimal places.' });
  });

  it('shows the current fee and the note, and saves a new one', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/delivery-fee') return { data: { fee_lkr: 150, updated_at: null } };
      if (c.method === 'PATCH' && c.path === '/admin/settings/delivery-fee') {
        return { data: { fee_lkr: c.body.fee_lkr, updated_at: '2026-09-30T05:00:00.000Z' } };
      }
    });
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    const input = await within(panel).findByLabelText(/Delivery fee \(LKR\)/);
    expect(input).toHaveValue('150');
    expect(panel).toHaveTextContent('Currently LKR 150');
    expect(panel).toHaveTextContent('Orders already placed keep the fee they were placed with.');

    await user.clear(input);
    await user.type(input, '199.50');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-fee')[0]?.body).toEqual({ fee_lkr: 199.5 }));
    expect(await within(panel).findByText(/Currently LKR 199\.5/)).toBeInTheDocument();
  });

  it('rejects a bad value client side without calling the API, and shows server validation messages', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/delivery-fee') return { data: { fee_lkr: 150, updated_at: null } };
      if (c.method === 'PATCH') {
        return { status: 400, error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: [{ message: 'fee_lkr must be at most 1000' }] } };
      }
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    const input = await within(panel).findByLabelText(/Delivery fee \(LKR\)/);

    await user.clear(input);
    await user.type(input, '1500');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The fee must be between LKR 0 and LKR 1,000.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '200');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('fee_lkr must be at most 1000')).toBeInTheDocument();
  });
});

describe('delivery fee by distance - per-km tiers (owner, 2026-10-10)', () => {
  /** A stateful fake of GET/PATCH /admin/settings/delivery-fee with the new shape. */
  function feeApi(initial: Record<string, unknown> = {}) {
    let state: Record<string, any> = { fee_lkr: 150, fee_mode: 'FLAT', tiers: [], max_fee_lkr: null, updated_at: null, ...initial };
    return mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/delivery-fee') return { data: state };
      if (c.method === 'PATCH' && c.path === '/admin/settings/delivery-fee') {
        state = { ...state, ...c.body, updated_at: '2026-10-10T05:00:00.000Z' };
        return { data: state };
      }
    });
  }

  it('switches to "By distance (per km)", prefills km 1 with the flat fee, shows live examples and saves tiers with a cap', async () => {
    const user = userEvent.setup();
    const api = feeApi();
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    await within(panel).findByLabelText(/Delivery fee \(LKR\)/);
    expect(within(panel).getByRole('button', { name: 'Same fee for every order' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(panel).getByRole('button', { name: 'By distance (per km)' }));
    expect(within(panel).queryByLabelText(/Delivery fee \(LKR\)/)).toBeNull();
    const editor = within(panel).getByRole('group', { name: 'Fee for each km' });
    expect(within(editor).getByLabelText('km 1 (LKR)')).toHaveValue('150');
    expect(within(editor).getByRole('button', { name: 'Remove last km' })).toBeDisabled();
    expect(editor).toHaveTextContent('Every started km counts: 2.3 km = km 1 + km 2 + km 3');
    expect(within(editor).getByTestId('km-tier-examples')).toHaveTextContent('3 km = LKR 150 + 150 + 150 = LKR 450');

    const km1 = within(editor).getByLabelText('km 1 (LKR)');
    await user.clear(km1);
    await user.type(km1, '100');
    await user.click(within(editor).getByRole('button', { name: '+ Add km' }));
    // A new km starts at the last row's amount.
    expect(within(editor).getByLabelText('km 2 (LKR)')).toHaveValue('100');
    await user.clear(within(editor).getByLabelText('km 2 (LKR)'));
    await user.type(within(editor).getByLabelText('km 2 (LKR)'), '60');
    await user.click(within(editor).getByRole('button', { name: '+ Add km' }));
    await user.clear(within(editor).getByLabelText('km 3 (LKR)'));
    await user.type(within(editor).getByLabelText('km 3 (LKR)'), '50');

    const examples = within(editor).getByTestId('km-tier-examples');
    expect(examples).toHaveTextContent('1 km = LKR 100');
    expect(examples).toHaveTextContent('3 km = LKR 100 + 60 + 50 = LKR 210');
    expect(examples).toHaveTextContent('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310');

    const cap = within(panel).getByLabelText(/Maximum fee/);
    await user.type(cap, '250');
    expect(examples).toHaveTextContent('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310, capped at LKR 250');

    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/delivery-fee')[0]?.body).toEqual({
        fee_mode: 'DISTANCE_TIERS',
        tiers: [
          { km: 1, lkr: 100 },
          { km: 2, lkr: 60 },
          { km: 3, lkr: 50 },
        ],
        max_fee_lkr: 250,
      })
    );
    expect(
      await within(panel).findByText(/Currently by distance: km 1 LKR 100, km 2 LKR 60, km 3\+ LKR 50, at most LKR 250/)
    ).toBeInTheDocument();
  });

  it('loads stored tiers, checks amounts and the cap client side, and goes back to one fee for every order', async () => {
    const user = userEvent.setup();
    const api = feeApi({
      fee_mode: 'DISTANCE_TIERS',
      tiers: [
        { km: 1, lkr: 100 },
        { km: 2, lkr: 60 },
      ],
      max_fee_lkr: null,
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    const editor = await within(panel).findByRole('group', { name: 'Fee for each km' });
    expect(panel).toHaveTextContent('Currently by distance: km 1 LKR 100, km 2+ LKR 60');
    expect(within(panel).getByRole('button', { name: 'By distance (per km)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(editor).getByLabelText('km 2 (LKR)')).toHaveValue('60');
    expect(within(panel).getByLabelText(/Maximum fee/)).toHaveValue('');

    await user.clear(within(editor).getByLabelText('km 2 (LKR)'));
    await user.type(within(editor).getByLabelText('km 2 (LKR)'), '1500');
    await user.type(within(panel).getByLabelText(/Maximum fee/), '20000');
    expect(within(editor).getByTestId('km-tier-examples')).toHaveTextContent('Enter an amount for every km to see examples.');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(within(editor).getByText('km 2: At most LKR 1,000 per km.')).toBeInTheDocument();
    expect(within(panel).getByText('The maximum fee must be LKR 10,000 or less.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);

    // Remove the bad km; blank cap = no maximum.
    await user.click(within(editor).getByRole('button', { name: 'Remove last km' }));
    await user.clear(within(panel).getByLabelText(/Maximum fee/));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/delivery-fee')[0]?.body).toEqual({
        fee_mode: 'DISTANCE_TIERS',
        tiers: [{ km: 1, lkr: 100 }],
        max_fee_lkr: null,
      })
    );

    // Back to the flat fee: fee_mode FLAT with fee_lkr.
    await user.click(within(panel).getByRole('button', { name: 'Same fee for every order' }));
    const input = within(panel).getByLabelText(/Delivery fee \(LKR\)/);
    expect(input).toHaveValue('150');
    await user.clear(input);
    await user.type(input, '175');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-fee')[1]?.body).toEqual({ fee_mode: 'FLAT', fee_lkr: 175 }));
    expect(await within(panel).findByText(/Currently LKR 175 per order/)).toBeInTheDocument();
  });
});

// 9 Oct 2026 Colombo midnight, the backend default (owner, 2026-10-09).
const SINCE = '2026-10-08T18:30:00.000Z';

describe('checkout settings (owner, 2026-10-08)', () => {
  it("switches \"Show 'Save LKR' on offers\" (owner, 2026-10-10), sending it only when flipped", async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/delivery-fee') return { data: { fee_lkr: 150, updated_at: null } };
      if (c.method === 'GET' && c.path === '/admin/settings/checkout') {
        return {
          data: {
            coupons_enabled: false,
            new_customer_free_deliveries: { enabled: true, count: 2, since: SINCE },
            show_offer_savings: false,
            updated_at: null,
          },
        };
      }
      if (c.method === 'PATCH' && c.path === '/admin/settings/checkout') {
        const free = { since: SINCE, ...c.body.new_customer_free_deliveries };
        return { data: { show_offer_savings: false, ...c.body, new_customer_free_deliveries: free, updated_at: '2026-10-10T05:00:00.000Z' } };
      }
    });
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Checkout' });
    const savings = await within(panel).findByRole('checkbox', { name: "Show 'Save LKR' on offers" });
    expect(savings).not.toBeChecked();
    await user.click(savings);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        coupons_enabled: false,
        new_customer_free_deliveries: { enabled: true, count: 2 },
        show_offer_savings: true,
      })
    );
    await waitFor(() => expect(savings).toBeChecked());

    // Saved again unchanged: the switch is not resent.
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/checkout')[1]!.body).not.toHaveProperty('show_offer_savings');
  });

  it('validates the free delivery count', () => {
    expect(parseFreeDeliveryCount('2')).toEqual({ count: 2 });
    expect(parseFreeDeliveryCount(' 0 ')).toEqual({ count: 0 });
    expect(parseFreeDeliveryCount('10')).toEqual({ count: 10 });
    expect(parseFreeDeliveryCount('11')).toHaveProperty('error');
    expect(parseFreeDeliveryCount('1.5')).toHaveProperty('error');
    expect(parseFreeDeliveryCount('')).toHaveProperty('error');
  });

  it('shows both switches and saves them', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/delivery-fee') return { data: { fee_lkr: 150, updated_at: null } };
      if (c.method === 'GET' && c.path === '/admin/settings/checkout') {
        return { data: { coupons_enabled: false, new_customer_free_deliveries: { enabled: true, count: 2, since: SINCE }, updated_at: null } };
      }
      if (c.method === 'PATCH' && c.path === '/admin/settings/checkout') {
        const free = { since: SINCE, ...c.body.new_customer_free_deliveries };
        return { data: { ...c.body, new_customer_free_deliveries: free, updated_at: '2026-10-08T05:00:00.000Z' } };
      }
    });
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Checkout' });
    const coupons = await within(panel).findByRole('checkbox', { name: 'Coupon codes at checkout' });
    const free = within(panel).getByRole('checkbox', { name: 'Free deliveries for every customer' });
    const count = within(panel).getByLabelText(/Free deliveries per customer/);
    expect(coupons).not.toBeChecked();
    expect(free).toBeChecked();
    expect(count).toHaveValue('2');

    await user.click(coupons);
    await user.clear(count);
    await user.type(count, '3');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        coupons_enabled: true,
        new_customer_free_deliveries: { enabled: true, count: 3 },
      })
    );

    await user.click(free);
    expect(count).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[1]?.body).toEqual({
        coupons_enabled: true,
        new_customer_free_deliveries: { enabled: false, count: 3 },
      })
    );
  });

  it('refuses a bad count without calling the API', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/checkout') {
        return { data: { coupons_enabled: false, new_customer_free_deliveries: { enabled: true, count: 2, since: SINCE }, updated_at: null } };
      }
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Checkout' });
    const count = await within(panel).findByLabelText(/Free deliveries per customer/);
    await user.clear(count);
    await user.type(count, '12');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('Enter a whole number from 0 to 10.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);
  });

  it('shows the start date and "Start again from today" sends since = now after a confirm (owner, 2026-10-09)', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/checkout') {
        return { data: { coupons_enabled: true, new_customer_free_deliveries: { enabled: true, count: 2, since: SINCE }, updated_at: null } };
      }
      if (c.method === 'PATCH' && c.path === '/admin/settings/checkout') {
        return { data: { coupons_enabled: true, ...c.body, updated_at: '2026-10-20T05:00:00.000Z' } };
      }
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Checkout' });
    expect(await within(panel).findByText(/Counting orders since 9 Oct 2026/)).toBeInTheDocument();

    // Cancel sends nothing.
    await user.click(within(panel).getByRole('button', { name: 'Start again from today' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Start free deliveries again' })).getByRole('button', { name: 'Cancel' }));
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);

    const before = Date.now();
    await user.click(within(panel).getByRole('button', { name: 'Start again from today' }));
    const dialog = screen.getByRole('dialog', { name: 'Start free deliveries again' });
    expect(dialog).toHaveTextContent('Every customer gets 2 free deliveries again, counting orders from today.');
    await user.click(within(dialog).getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/settings/checkout')[0]!.body;
    expect(body).toEqual({ new_customer_free_deliveries: { enabled: true, count: 2, since: expect.any(String) } });
    const since = Date.parse(body.new_customer_free_deliveries.since);
    expect(since).toBeGreaterThanOrEqual(before);
    expect(since).toBeLessThanOrEqual(Date.now());
  });
});
