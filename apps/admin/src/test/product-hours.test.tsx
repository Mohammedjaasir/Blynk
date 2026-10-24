import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { productHoursProblem, productWindow, withProductWindow, type AvailabilityWindow } from '../lib/availability';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * A product's own Available hours on its edit form (owner's brother, 2026-10-24: "I can't find the
 * time setting thing ... for category or products"). Read from and saved to the one list
 * (GET|PUT /admin/settings/availability-windows, replace-the-whole-list), after the product itself.
 */
vi.setConfig({ testTimeout: 30_000 });

const CATEGORIES = [
  { id: 'rice', name: 'Rice', slug: 'rice', description: null, image_url: null, display_order: 0, is_active: true, product_count: 1, parent_id: null, markup_percent: 25, markup_product_count: 1 },
];
const UNTRACKED = {
  inventory_id: null, tracked: false, on_hand: 0, reserved: 0, in_open_orders: 0, sellable: null,
  low_stock_threshold: 5, is_low_stock: false, is_out_of_stock: false,
};
const JUICE = {
  id: 'p1', category_id: 'rice', category_name: 'Rice', name: 'Mango Juice', slug: 'mango-juice', sku: 'JUICE-1', barcode: null,
  unit: '300 ml', pack_size: null, description: null, image_url: null, purchase_cost: 100, pricing_mode: 'MARKUP',
  fixed_selling_price: null, custom_markup_percent: null, category_markup_percent: 25, parent_category_markup_percent: null,
  global_markup_percent: 20, effective_markup_percent: 25, pricing_source: 'CATEGORY_MARKUP', calculated_selling_price: 125,
  selling_price: 125, computed_selling_price: 125, mrp: null, mrp_capped: false, price_warning: null, offer_price: null,
  offer_ends_at: null, offer_active: false, is_available: true, is_active: true, delivery_lead_days: 0, has_variants: false,
  variant_count: 0, stock: { ...UNTRACKED }, variants: [] as unknown[],
};

const view = (w: AvailabilityWindow, name: string) => ({ ...w, name, parent_name: null, open_now: true });
const OTHER_PRODUCT = view({ kind: 'PRODUCT', id: 'p9', from: '08:00', until: '20:00' }, 'Bread');
const CATEGORY = view({ kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' }, 'Beverages');
const OWN = view({ kind: 'PRODUCT', id: 'p1', from: '06:00', until: '18:00' }, 'Mango Juice');

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function api(windows: unknown[], extra: (c: Call) => Reply | undefined = () => undefined) {
  tokenStore.save('access', 'refresh');
  const state = { list: windows };
  const calls = mockApi((c) => {
    const reply = extra(c);
    if (reply) return reply;
    if (c.method === 'GET' && c.path === '/admin/settings/availability-windows') return ok({ windows: state.list, updated_at: null });
    if (c.method === 'PUT' && c.path === '/admin/settings/availability-windows') {
      state.list = (c.body.windows as AvailabilityWindow[]).map((w) => view(w, w.id === 'p1' ? 'Mango Juice' : w.id));
      return ok({ windows: state.list, updated_at: '2026-10-24T10:00:00Z' });
    }
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    if (c.method === 'GET' && c.path === '/admin/settings/default-markup') return ok({ markup_percent: 20, updated_at: null, products_using: 0 });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product: JUICE });
    if (c.method === 'PATCH' && c.path === '/admin/products/p1') return ok({ product: { ...JUICE, ...c.body } });
    if (c.method === 'POST' && c.path === '/admin/products') return ok({ product: { ...JUICE, ...c.body, id: 'new1' } });
    if (c.method === 'GET' && c.path === '/admin/products') return ok({ products: [], pagination: { page: 1, limit: 50 } });
    return undefined;
  });
  return calls;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/products/new" element={<ProductForm />} />
          <Route path="/products/:id" element={<ProductForm />} />
          <Route path="/products" element={<p>Products list</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const section = () => screen.getByRole('region', { name: 'Available hours' });

describe('product hours: the list rules', () => {
  const list: AvailabilityWindow[] = [OTHER_PRODUCT, OWN, CATEGORY].map(({ kind, id, from, until }) => ({ kind, id, from, until }));

  it('changes only this product entry, in place, and keeps every other entry', () => {
    const next = withProductWindow(list, 'p1', '07:30', '17:00');
    expect(next).toEqual([list[0], { kind: 'PRODUCT', id: 'p1', from: '07:30', until: '17:00' }, list[2]]);
  });

  it('adds an entry when there is none, and removes it when both times are empty', () => {
    expect(withProductWindow([list[2]!], 'p1', '06:00', '18:00')).toEqual([list[2], { kind: 'PRODUCT', id: 'p1', from: '06:00', until: '18:00' }]);
    expect(withProductWindow(list, 'p1', '', '')).toEqual([list[0], list[2]]);
    // a category with the same id is never touched
    expect(withProductWindow([{ kind: 'CATEGORY', id: 'p1', from: '07:00', until: '19:00' }], 'p1', '', '')).toHaveLength(1);
    expect(productWindow(list, 'p1')).toEqual(list[1]);
    expect(productWindow([list[2]!], 'p1')).toBeNull();
  });

  it('needs both times or neither, and two different ones', () => {
    expect(productHoursProblem('', '')).toBeNull();
    expect(productHoursProblem('06:00', '18:00')).toBeNull();
    expect(productHoursProblem('22:00', '02:00')).toBeNull();
    expect(productHoursProblem('06:00', '')).toMatch(/both times/);
    expect(productHoursProblem('06:00', '06:00')).toMatch(/differ/);
  });
});

describe('product form: Available hours', () => {
  it('shows this product own hours, the note and a link to the Available hours page', async () => {
    api([OTHER_PRODUCT, OWN, CATEGORY]);
    renderAt('/products/p1');
    expect(await screen.findByLabelText('Available from')).toHaveValue('06:00');
    expect(screen.getByLabelText('Available until')).toHaveValue('18:00');
    expect(section()).toHaveTextContent('Customers can only order it between these times; outside them it shows greyed with the hours.');
    expect(section()).toHaveTextContent('A category can have hours too');
    expect(within(section()).getByRole('link', { name: 'Available hours page' })).toHaveAttribute('href', '/available-hours');
  });

  it('saves the product first, then the hours: the whole list goes back with only this entry changed', async () => {
    const user = userEvent.setup();
    const calls = api([OTHER_PRODUCT, OWN, CATEGORY]);
    renderAt('/products/p1');
    const from = await screen.findByLabelText('Available from');
    await user.clear(from);
    await user.type(from, '07:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PUT', '/admin/settings/availability-windows')).toHaveLength(1));
    expect(calls.find('PUT', '/admin/settings/availability-windows')[0]!.body).toEqual({
      windows: [
        { kind: 'PRODUCT', id: 'p9', from: '08:00', until: '20:00' },
        { kind: 'PRODUCT', id: 'p1', from: '07:00', until: '18:00' },
        { kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' },
      ],
    });
    const order = calls.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('PATCH /admin/products/p1')).toBeGreaterThan(-1);
    expect(order.indexOf('PATCH /admin/products/p1')).toBeLessThan(order.lastIndexOf('PUT /admin/settings/availability-windows'));
    expect(await screen.findByText('Products list')).toBeInTheDocument();
  });

  it('a product with no hours: setting both adds its entry to the list', async () => {
    const user = userEvent.setup();
    const calls = api([CATEGORY]);
    renderAt('/products/p1');
    await user.type(await screen.findByLabelText('Available from'), '06:00');
    await user.type(screen.getByLabelText('Available until'), '18:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PUT', '/admin/settings/availability-windows')).toHaveLength(1));
    expect(calls.find('PUT', '/admin/settings/availability-windows')[0]!.body.windows).toEqual([
      { kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' },
      { kind: 'PRODUCT', id: 'p1', from: '06:00', until: '18:00' },
    ]);
  });

  it('clearing the hours removes only this entry', async () => {
    const user = userEvent.setup();
    const calls = api([OTHER_PRODUCT, OWN, CATEGORY]);
    renderAt('/products/p1');
    await screen.findByLabelText('Available from');
    await user.click(screen.getByRole('button', { name: /Any time/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PUT', '/admin/settings/availability-windows')).toHaveLength(1));
    expect(calls.find('PUT', '/admin/settings/availability-windows')[0]!.body.windows).toEqual([
      { kind: 'PRODUCT', id: 'p9', from: '08:00', until: '20:00' },
      { kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' },
    ]);
  });

  it('leaves the hours alone (no PUT) when they did not change', async () => {
    const user = userEvent.setup();
    const calls = api([OWN]);
    renderAt('/products/p1');
    await screen.findByLabelText('Available from');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(await screen.findByText('Products list')).toBeInTheDocument();
    expect(calls.find('PUT', '/admin/settings/availability-windows')).toHaveLength(0);
  });

  it('one time only is refused before anything is saved', async () => {
    const user = userEvent.setup();
    const calls = api([]);
    renderAt('/products/p1');
    await user.type(await screen.findByLabelText('Available from'), '06:00');
    expect(within(section()).getByRole('alert')).toHaveTextContent('both times');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Available hours: Fill in both times/)).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(0);
    expect(calls.find('PUT', '/admin/settings/availability-windows')).toHaveLength(0);
  });

  it('if only the hours fail, the product is saved and the message says so', async () => {
    const user = userEvent.setup();
    const calls = api([OWN], (c) => (c.method === 'PUT' ? fail(500, 'INTERNAL', 'boom') : undefined));
    renderAt('/products/p1');
    const from = await screen.findByLabelText('Available from');
    await user.clear(from);
    await user.type(from, '07:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findAllByText(/The product is saved, but its available hours are not/)).not.toHaveLength(0);
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1);
    // stays on the form, with the typed hours still there to retry
    expect(screen.queryByText('Products list')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Available from')).toHaveValue('07:00');
  });

  it('a hours list that cannot be read says so and still lets the product save', async () => {
    const user = userEvent.setup();
    const calls = api([], (c) => (c.method === 'GET' && c.path === '/admin/settings/availability-windows' ? fail(403, 'FORBIDDEN', 'no') : undefined));
    renderAt('/products/p1');
    expect(await within(await screen.findByRole('region', { name: 'Available hours' })).findByRole('alert')).toHaveTextContent('Could not load the available hours');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(calls.find('PUT', '/admin/settings/availability-windows')).toHaveLength(0);
  });

  it('is not on the create form', async () => {
    const calls = api([]);
    renderAt('/products/new');
    await screen.findByLabelText('Product name');
    expect(screen.queryByRole('region', { name: 'Available hours' })).not.toBeInTheDocument();
    expect(calls.find('GET', '/admin/settings/availability-windows')).toHaveLength(0);
  });
});
