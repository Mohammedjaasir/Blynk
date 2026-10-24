import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category } from '../api/types';
import { productHoursProblem, productWindow, withProductWindow, type AvailabilityWindow } from '../lib/availability';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/**
 * A product's own Available hours on its edit form in the Ops app (owner's brother, 2026-10-24: "I
 * can't find the time setting thing in the Ops app for category or products"). Read from and saved
 * to the one list (GET|PUT /admin/settings/availability-windows, replace-the-whole-list), after the
 * product itself.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const RICE: Category = {
  id: 'rice', name: 'Rice', slug: 'rice', description: null, image_url: null, display_order: 1, is_active: true, parent_id: null, markup_percent: 25,
};
const JUICE = {
  id: 'p1', category_id: 'rice', category_name: 'Rice', name: 'Mango Juice', slug: 'mango-juice', sku: 'JUICE-1', barcode: null,
  unit: '300 ml', pack_size: null, description: null, image_url: null, purchase_cost: 100, pricing_mode: 'MARKUP',
  fixed_selling_price: null, custom_markup_percent: null, category_markup_percent: 25, parent_category_markup_percent: null,
  global_markup_percent: 20, effective_markup_percent: 25, pricing_source: 'CATEGORY_MARKUP', calculated_selling_price: 125,
  selling_price: 125, computed_selling_price: 125, mrp: null, mrp_capped: false, price_warning: null, is_available: true, is_active: true,
} as AdminProduct;

const view = (w: AvailabilityWindow, name: string) => ({ ...w, name, parent_name: null, open_now: true });
const OTHER_PRODUCT = view({ kind: 'PRODUCT', id: 'p9', from: '08:00', until: '20:00' }, 'Bread');
const CATEGORY = view({ kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' }, 'Beverages');
const OWN = view({ kind: 'PRODUCT', id: 'p1', from: '06:00', until: '18:00' }, 'Mango Juice');

const PUT = '/admin/settings/availability-windows';

/** The fake API: the list lives in `state`, a PUT replaces it. */
function renderForm(path: string, windows: unknown[], overrides: Record<string, (c: any) => unknown> = {}) {
  const state = { list: windows };
  return renderAs(ADMIN_WITH_RIDER, path, {
    [`GET ${PUT}`]: () => ok({ windows: state.list, updated_at: null }),
    [`PUT ${PUT}`]: (c) => {
      state.list = (c.body.windows as AvailabilityWindow[]).map((w) => view(w, w.id === 'p1' ? 'Mango Juice' : w.id));
      return ok({ windows: state.list, updated_at: '2026-10-24T10:00:00Z' });
    },
    'GET /admin/categories': () => ok({ categories: [RICE] }),
    'GET /admin/products/:id': () => ok({ product: JUICE }),
    'PATCH /admin/products/:id': (c) => ok({ product: { ...JUICE, ...c.body } }),
    'POST /admin/products': (c) => ({ status: 201, data: { product: { ...JUICE, ...c.body, id: 'new1' } } }),
    'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
    ...overrides,
  });
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

describe('Ops product form: Available hours', () => {
  it('shows this product own hours, the note and a link to the Available hours page', async () => {
    renderForm('/catalog/products/p1', [OTHER_PRODUCT, OWN, CATEGORY]);
    expect(await screen.findByLabelText('Available from')).toHaveValue('06:00');
    expect(screen.getByLabelText('Available until')).toHaveValue('18:00');
    expect(section()).toHaveTextContent('Customers can only order it between these times; outside them it shows greyed with the hours.');
    expect(section()).toHaveTextContent('A category can have hours too');
    expect(within(section()).getByRole('link', { name: 'Available hours page' })).toHaveAttribute('href', '/catalog/available-hours');
  });

  it('saves the product first, then the hours: the whole list goes back with only this entry changed', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', [OTHER_PRODUCT, OWN, CATEGORY]);
    const from = await screen.findByLabelText('Available from');
    await user.clear(from);
    await user.type(from, '07:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PUT', PUT)).toHaveLength(1));
    expect(api.find('PUT', PUT)[0]!.body).toEqual({
      windows: [
        { kind: 'PRODUCT', id: 'p9', from: '08:00', until: '20:00' },
        { kind: 'PRODUCT', id: 'p1', from: '07:00', until: '18:00' },
        { kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' },
      ],
    });
    const order = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('PATCH /admin/products/p1')).toBeGreaterThan(-1);
    expect(order.indexOf('PATCH /admin/products/p1')).toBeLessThan(order.lastIndexOf(`PUT ${PUT}`));
  });

  it('a product with no hours: setting both adds its entry to the list', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', [CATEGORY]);
    await user.type(await screen.findByLabelText('Available from'), '06:00');
    await user.type(screen.getByLabelText('Available until'), '18:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PUT', PUT)).toHaveLength(1));
    expect(api.find('PUT', PUT)[0]!.body.windows).toEqual([
      { kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' },
      { kind: 'PRODUCT', id: 'p1', from: '06:00', until: '18:00' },
    ]);
  });

  it('clearing the hours removes only this entry', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', [OTHER_PRODUCT, OWN, CATEGORY]);
    await screen.findByLabelText('Available from');
    await user.click(screen.getByRole('button', { name: /Any time/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PUT', PUT)).toHaveLength(1));
    expect(api.find('PUT', PUT)[0]!.body.windows).toEqual([
      { kind: 'PRODUCT', id: 'p9', from: '08:00', until: '20:00' },
      { kind: 'CATEGORY', id: 'c-bev', from: '07:00', until: '19:00' },
    ]);
  });

  it('leaves the hours alone (no PUT) when they did not change', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', [OWN]);
    await screen.findByLabelText('Available from');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PUT', PUT)).toHaveLength(0);
  });

  it('one time only is refused before anything is saved', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', []);
    await user.type(await screen.findByLabelText('Available from'), '06:00');
    expect(within(section()).getByRole('alert')).toHaveTextContent('both times');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Available hours: Fill in both times/)).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
    expect(api.find('PUT', PUT)).toHaveLength(0);
  });

  it('if only the hours fail, the product is saved and the message says so', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', [OWN], { [`PUT ${PUT}`]: () => fail(500, 'INTERNAL', 'boom') });
    const from = await screen.findByLabelText('Available from');
    await user.clear(from);
    await user.type(from, '07:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Mango Juice was saved, but its available hours were not/)).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1);
    // stays on the form, with the typed hours still there to retry
    expect(screen.getByLabelText('Available from')).toHaveValue('07:00');
  });

  it('a hours list that cannot be read says so and still lets the product save', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', [], { [`GET ${PUT}`]: () => fail(403, 'FORBIDDEN', 'no') });
    expect(await within(await screen.findByRole('region', { name: 'Available hours' })).findByRole('alert')).toHaveTextContent('Could not load the available hours');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PUT', PUT)).toHaveLength(0);
  });

  it('is not on the create form', async () => {
    const { api } = renderForm('/catalog/products/new', []);
    await screen.findByLabelText('Product name');
    expect(screen.queryByRole('region', { name: 'Available hours' })).not.toBeInTheDocument();
    expect(api.find('GET', PUT)).toHaveLength(0);
  });
});
