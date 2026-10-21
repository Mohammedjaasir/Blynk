import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category, ImportResult, ImportRow, LowStockItem, LowStockResult, StaffStock, StaffVariant } from '../api/types';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Variants, customer-hidden stock and delivery lead time in Ops (migration
 * 045; owner, 2026-10-14): the product form's Stock / Variants sections and
 * lead time, the Products list's price range, Running low variant rows and
 * the Excel import's variant rows.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await import('xlsx');
}, 60_000);

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const SPICES: Category = {
  id: 'spices',
  name: 'Spices',
  slug: 'spices',
  description: null,
  image_url: null,
  display_order: 1,
  is_active: true,
  parent_id: null,
  markup_percent: 25,
};

const UNTRACKED: StaffStock = {
  inventory_id: null,
  tracked: false,
  on_hand: 0,
  reserved: 0,
  in_open_orders: 0,
  sellable: null,
  low_stock_threshold: 5,
  is_low_stock: false,
  is_out_of_stock: false,
};

function stock(overrides: Partial<StaffStock> = {}): StaffStock {
  return { ...UNTRACKED, inventory_id: 'inv', tracked: true, on_hand: 20, sellable: 18, in_open_orders: 2, ...overrides };
}

function variant(overrides: Partial<StaffVariant> & { id: string; label: string }): StaffVariant {
  return {
    product_id: 'p1',
    sku: null,
    barcode: null,
    sort_order: 0,
    is_active: true,
    is_available: true,
    purchase_cost: 40,
    pricing_mode: 'MARKUP',
    fixed_selling_price: null,
    custom_markup_percent: null,
    product_markup_percent: null,
    category_markup_percent: 25,
    parent_category_markup_percent: null,
    global_markup_percent: 20,
    effective_markup_percent: 25,
    pricing_source: 'CATEGORY_MARKUP',
    selling_price: 50,
    price_warning: null,
    offer_price: null,
    offer_ends_at: null,
    offer_active: false,
    customer_price: 50,
    is_orderable: true,
    stock: { ...UNTRACKED },
    ...overrides,
  };
}

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: 'p1',
    category_id: 'spices',
    category_name: 'Spices',
    name: 'Chilli Powder',
    slug: 'chilli-powder',
    sku: 'CHILLI-PWD',
    barcode: null,
    unit: '1 pack',
    pack_size: null,
    description: null,
    image_url: null,
    purchase_cost: 40,
    pricing_mode: 'MARKUP',
    fixed_selling_price: null,
    custom_markup_percent: null,
    category_markup_percent: 25,
    parent_category_markup_percent: null,
    global_markup_percent: 20,
    effective_markup_percent: 25,
    pricing_source: 'CATEGORY_MARKUP',
    calculated_selling_price: 50,
    selling_price: 50,
    price_warning: null,
    is_available: true,
    is_active: true,
    delivery_lead_days: 0,
    has_variants: false,
    variant_count: 0,
    stock: { ...UNTRACKED },
    variants: [],
    ...overrides,
  };
}

const COMMON = {
  'GET /admin/categories': () => ok({ categories: [SPICES] }),
  'GET /admin/settings/default-markup': () => ok({ markup_percent: 20, updated_at: null, products_using: 0 }),
  'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
};

describe('Product form - lead time and stock', () => {
  it('a new product sends delivery_lead_days, then sets its stock right after it is created', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/products/new', {
      ...COMMON,
      'POST /admin/products': () => ok({ product: product({ id: 'new-1', name: 'Ribbon Cake' }) }),
      'PUT /admin/inventory/:productId/stock': () => ok({ product_id: 'new-1', variant_id: null, stock: stock({ on_hand: 12 }) }),
    });
    await screen.findByText('Add product');
    await user.type(screen.getByLabelText('Product name'), 'Ribbon Cake');
    await user.type(screen.getByLabelText('SKU'), 'CAKE-1');
    await user.type(screen.getByLabelText(/^Unit/), '1 kg');
    await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), '2500');
    await user.click(screen.getByRole('radio', { name: 'Markup' })); // new products and sizes start on Fixed price
    const lead = screen.getByLabelText(/^Delivery lead time \(days\)/);
    expect(screen.getByText('Customers can pick delivery from today + N days. 0 = same day.')).toBeInTheDocument();
    await user.clear(lead);
    await user.type(lead, '2');
    expect(screen.getByText(/Customers never see the count. They can order until it reaches 0/)).toBeInTheDocument();
    expect(screen.getByText('Save the product first to add variants (sizes or packs with their own price, e.g. 50 g, 100 g).')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/^Track stock/));
    await user.type(screen.getByLabelText(/^Stock count/), '12');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(api.find('PUT', '/admin/inventory/new-1/stock')).toHaveLength(1));
    expect(api.find('POST', '/admin/products')[0]!.body).toMatchObject({ delivery_lead_days: 2, sku: 'CAKE-1' });
    expect(api.find('PUT', '/admin/inventory/new-1/stock')[0]!.body).toEqual({ tracked: true, stock_count: 12 });
  });

  it('a new untracked product makes no stock call; a bad lead time is refused', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      ...COMMON,
      'POST /admin/products': () => ok({ product: product({ id: 'new-2' }) }),
    });
    await screen.findByText('Add product');
    await user.type(screen.getByLabelText('Product name'), 'Soap');
    await user.type(screen.getByLabelText('SKU'), 'SOAP-1');
    await user.type(screen.getByLabelText(/^Unit/), '100 g');
    await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), '80');
    await user.click(screen.getByRole('radio', { name: 'Markup' })); // new products and sizes start on Fixed price
    const lead = screen.getByLabelText(/^Delivery lead time/);
    await user.clear(lead);
    await user.type(lead, '45');
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Enter whole days from 0 to 30 (0 = same day).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/products')).toHaveLength(0);

    await user.clear(lead);
    await user.type(lead, '0');
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(api.find('POST', '/admin/products')).toHaveLength(1));
    expect(api.find('POST', '/admin/products')[0]!.body).toMatchObject({ delivery_lead_days: 0 });
    await waitFor(() => expect(screen.queryByLabelText('SKU')).not.toBeInTheDocument());
    expect(api.calls.some((c) => c.path.endsWith('/stock'))).toBe(false);
  });

  it('editing shows on hand / in open orders / sellable and a Low badge, and PUTs only what changed', async () => {
    const user = userEvent.setup();
    const saved = product({ stock: stock({ on_hand: 4, in_open_orders: 1, sellable: 3, is_low_stock: true }), delivery_lead_days: 1 });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      ...COMMON,
      'GET /admin/products/:id': () => ok({ product: saved }),
      'PATCH /admin/products/:id': () => ok({ product: saved }),
      'PUT /admin/inventory/:productId/stock': () => ok({ product_id: 'p1', variant_id: null, stock: stock({ on_hand: 24 }) }),
    });
    const figures = await screen.findByLabelText('Current stock');
    expect(within(figures).getByText('On hand').nextSibling).toHaveTextContent('4');
    expect(within(figures).getByText('In open orders').nextSibling).toHaveTextContent('1');
    expect(within(figures).getByText('Can sell').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Delivery lead time/)).toHaveValue('1');

    // Nothing in Stock touched: no stock call.
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0]!.body).toMatchObject({ delivery_lead_days: 1 });
    expect(api.find('PUT', '/admin/inventory/p1/stock')).toHaveLength(0);
  });

  it('a changed stock count goes with the reason (threshold left out when unchanged)', async () => {
    const user = userEvent.setup();
    const saved = product({ stock: stock({ on_hand: 20, low_stock_threshold: 5 }) });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      ...COMMON,
      'GET /admin/products/:id': () => ok({ product: saved }),
      'PATCH /admin/products/:id': () => ok({ product: saved }),
      'PUT /admin/inventory/:productId/stock': () => ok({ product_id: 'p1', variant_id: null, stock: stock({ on_hand: 24 }) }),
    });
    const count = await screen.findByLabelText(/^Stock count/);
    await user.clear(count);
    await user.type(count, '24');
    await user.type(screen.getByLabelText(/^Reason/), 'Shelf count');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PUT', '/admin/inventory/p1/stock')).toHaveLength(1));
    expect(api.find('PUT', '/admin/inventory/p1/stock')[0]!.body).toEqual({ tracked: true, stock_count: 24, reason: 'Shelf count' });
  });
});

describe('Product form - variants', () => {
  const V50 = variant({ id: 'v50', label: '50 g', sku: 'CHILLI-PWD-50G', sort_order: 0, pricing_mode: 'FIXED', fixed_selling_price: 50, pricing_source: 'FIXED', selling_price: 50, stock: stock({ on_hand: 20, sellable: 18 }) });
  const V100 = variant({ id: 'v100', label: '100 g', sort_order: 1, purchase_cost: 70, custom_markup_percent: 30, pricing_source: 'VARIANT_MARKUP', selling_price: 91 });
  const V250 = variant({ id: 'v250', label: '250 g', sort_order: 2, purchase_cost: 150, selling_price: 187.5, stock: stock({ on_hand: 0, sellable: 0, is_out_of_stock: true }) });

  function renderEdit(extra: Record<string, (call: any) => unknown> = {}) {
    const saved = product({ has_variants: true, variant_count: 3, variants: [V50, V100, V250] });
    return renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      ...COMMON,
      'GET /admin/products/:id': () => ok({ product: saved }),
      ...extra,
    });
  }

  it('lists variants with SKU, cost, price, source and stock; product stock is per variant', async () => {
    renderEdit();
    const list = await screen.findByRole('list', { name: 'Variants' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByText(/^\d+ g$/).textContent)).toEqual(['50 g', '100 g', '250 g']);
    expect(within(rows[0]!).getByText('CHILLI-PWD-50G · cost LKR 40.00')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('LKR 50.00')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Fixed')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('18 in stock')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Variant markup')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Stock not tracked')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText('This product has variants, so stock is set per variant below.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Stock count/)).not.toBeInTheDocument();
  });

  it('adds a variant with a live markup preview and its stock in the same request', async () => {
    const user = userEvent.setup();
    const created = variant({ id: 'v500', label: '500 g', sort_order: 3, purchase_cost: 280, selling_price: 350 });
    const { api } = renderEdit({ 'POST /admin/products/:id/variants': () => ({ status: 201, data: { variant: created } }) });
    await screen.findByRole('list', { name: 'Variants' });
    await user.click(screen.getByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    await user.type(within(dialog).getByLabelText(/^Variant name/), '500 g');
    await user.type(within(dialog).getByLabelText(/^Variant SKU/), 'CHILLI-PWD-500G');
    await user.type(within(dialog).getByLabelText(/^Variant cost price \(LKR\)/), '280');
    await user.click(within(dialog).getByRole('radio', { name: 'Markup' })); // new products and sizes start on Fixed price
    // No variant or product markup: the category's 25%.
    expect(within(dialog).getByText('Selling price LKR 350.00 (category markup 25%)')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Variant markup %/), '12.5');
    expect(within(dialog).getByText('Selling price LKR 315.00 (variant markup 12.5%)')).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText(/^Track stock for this variant/));
    await user.type(within(dialog).getByLabelText('Variant stock count'), '15');
    const low = within(dialog).getByLabelText('Variant low-stock level');
    await user.clear(low);
    await user.type(low, '4');
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));

    await waitFor(() => expect(api.find('POST', '/admin/products/p1/variants')).toHaveLength(1));
    expect(api.find('POST', '/admin/products/p1/variants')[0]!.body).toEqual({
      label: '500 g',
      sku: 'CHILLI-PWD-500G',
      barcode: null,
      purchase_cost: 280,
      pricing_mode: 'MARKUP',
      custom_markup_percent: 12.5,
      is_active: true,
      is_available: true,
      sort_order: 3,
      track_stock: true,
      stock_count: 15,
      low_stock_threshold: 4,
    });
    expect(await screen.findByText('500 g added.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Variants' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('edits a variant as a fixed price with an offer, and sets its stock through the stock endpoint with variant_id', async () => {
    const user = userEvent.setup();
    const { api } = renderEdit({
      'PATCH /admin/products/:id/variants/:variantId': () => ok({ variant: { ...V100, pricing_mode: 'FIXED', fixed_selling_price: 120, selling_price: 120 } }),
      'PUT /admin/inventory/:productId/stock': () => ok({ product_id: 'p1', variant_id: 'v100', stock: stock({ on_hand: 30, sellable: 30 }) }),
    });
    await screen.findByRole('list', { name: 'Variants' });
    await user.click(screen.getByRole('button', { name: 'Edit 100 g' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit 100 g' });
    await user.click(within(dialog).getByRole('radio', { name: 'Fixed price' }));
    await user.type(within(dialog).getByLabelText(/^Price \(LKR\)/), '120');
    expect(within(dialog).getByText('Selling price LKR 120.00 (fixed price)')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Variant offer price/), '99');
    await user.click(within(dialog).getByLabelText(/^Track stock for this variant/));
    await user.type(within(dialog).getByLabelText('Variant stock count'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save variant' }));

    await waitFor(() => expect(api.find('PUT', '/admin/inventory/p1/stock')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1/variants/v100')[0]!.body).toEqual({
      label: '100 g',
      sku: null,
      barcode: null,
      purchase_cost: 70,
      pricing_mode: 'FIXED',
      fixed_selling_price: 120,
      is_active: true,
      is_available: true,
      offer_price: 99,
    });
    expect(api.find('PUT', '/admin/inventory/p1/stock')[0]!.body).toEqual({ variant_id: 'v100', tracked: true, stock_count: 30 });
    expect(await screen.findByText('100 g saved.')).toBeInTheDocument();
  });

  it('reorders with every variant id, and reports HARD / SOFT deletes', async () => {
    const user = userEvent.setup();
    const { api } = renderEdit({
      'PUT /admin/products/:id/variants/order': (call) =>
        ok({ variants: (call.body.variant_ids as string[]).map((id, i) => ({ ...[V50, V100, V250].find((v) => v.id === id)!, sort_order: i })) }),
      'DELETE /admin/products/:id/variants/:variantId': (call) =>
        ok({ product_id: 'p1', variant_id: call.path.split('/').pop(), mode: call.path.endsWith('v50') ? 'SOFT' : 'HARD' }),
    });
    await screen.findByRole('list', { name: 'Variants' });
    expect(screen.getByRole('button', { name: 'Move 50 g up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move 250 g up' }));
    await waitFor(() => expect(api.find('PUT', '/admin/products/p1/variants/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/products/p1/variants/order')[0]!.body).toEqual({ variant_ids: ['v50', 'v250', 'v100'] });
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Variants' })).getAllByRole('listitem').map((r) => r.querySelector('.variant-row__title')!.textContent)).toEqual([
        '50 g',
        '250 g',
        '100 g',
      ])
    );

    await user.click(screen.getByRole('button', { name: 'Delete 100 g' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete variant' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('100 g was removed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete 50 g' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete variant' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('50 g was archived. It was ordered before, so past orders keep it.')).toBeInTheDocument();
    expect(api.find('DELETE', '/admin/products/p1/variants/v50')).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: 'Variants' })).getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('Products list', () => {
  it('shows a price range and variant count, stock badges and the lead time', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      ...COMMON,
      'GET /admin/products': () =>
        ok({
          products: [
            product({ has_variants: true, variant_count: 4, price_min: 50, price_max: 350 }),
            product({ id: 'p2', name: 'Fresh Milk', sku: 'MILK-1', calculated_selling_price: 360, stock: stock({ sellable: 2, is_low_stock: true }) }),
            product({ id: 'p3', name: 'Butter', sku: 'BUT-1', stock: stock({ sellable: 0, is_out_of_stock: true }) }),
            product({ id: 'p4', name: 'Ribbon Cake', sku: 'CAKE-1', delivery_lead_days: 2, stock: stock({ sellable: 24 }) }),
          ],
          pagination: { page: 1, limit: 200 },
        }),
    });
    const chilli = (await screen.findByText('Chilli Powder')).closest('li')!;
    expect(within(chilli).getByText('LKR 50 - 350')).toBeInTheDocument();
    expect(within(chilli).getByText('4 variants')).toBeInTheDocument();
    expect(within(screen.getByText('Fresh Milk').closest('li')!).getByText('Low · 2 left')).toBeInTheDocument();
    expect(within(screen.getByText('Butter').closest('li')!).getByText('Sold out')).toBeInTheDocument();
    const cake = screen.getByText('Ribbon Cake').closest('li')!;
    expect(within(cake).getByText('24 in stock')).toBeInTheDocument();
    expect(within(cake).getByText('Delivered after 2 days')).toBeInTheDocument();
  });
});

describe('Running low - variant rows', () => {
  function low(overrides: Partial<LowStockItem>): LowStockItem {
    return {
      product_id: 'p1',
      product_name: 'Chilli Powder',
      product_sku: 'CHILLI-PWD',
      product_unit: '1 pack',
      category_name: 'Spices',
      quantity_on_hand: 2,
      quantity_reserved: 0,
      quantity_available: 2,
      low_stock_threshold: 5,
      stock_state: 'LOW',
      variant_id: null,
      variant_label: null,
      variant_sku: null,
      display_name: 'Chilli Powder',
      quantity_in_open_orders: 0,
      quantity_sellable: 2,
      ...overrides,
    };
  }

  const LOW: LowStockResult = {
    items: [
      low({ variant_id: 'v50', variant_label: '50 g', variant_sku: 'CHILLI-PWD-50G', display_name: 'Chilli Powder - 50 g', quantity_on_hand: 0, quantity_available: 0, stock_state: 'OUT' }),
      low({ variant_id: 'v100', variant_label: '100 g', display_name: 'Chilli Powder - 100 g', quantity_in_open_orders: 1, quantity_sellable: 1 }),
      low({ product_id: 'p2', product_name: 'Butter', product_sku: 'BUT-1', display_name: 'Butter' }),
    ],
    counts: { low: 2, out: 1, total: 3 },
  };

  it('lists each variant by its display name and restocks it with variant_id', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error');
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/low-stock', {
      'GET /admin/inventory/low-stock': () => ok(LOW),
      'POST /admin/inventory/:productId/adjust': () => ok({ inventory: { quantity_on_hand: 12, quantity_available: 12 } }),
    });
    expect(await screen.findByText('Chilli Powder - 50 g')).toBeInTheDocument();
    expect(screen.getByText('Chilli Powder - 100 g')).toBeInTheDocument();
    expect(screen.getByText('1 in open orders · 1 left to sell')).toBeInTheDocument();
    // Two variants of one product: no duplicate React keys.
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
    // The plain product still links to its stock page.
    expect(screen.getAllByRole('link', { name: 'Restock' }).map((a) => a.getAttribute('href'))).toEqual(['/catalog/inventory/stock/p2']);

    await user.click(screen.getByRole('button', { name: 'Restock Chilli Powder - 100 g' }));
    const dialog = screen.getByRole('dialog', { name: 'Adjust stock for Chilli Powder - 100 g' });
    await user.type(within(dialog).getByLabelText('Units received'), '10');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Received from supplier');
    await user.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(api.find('POST', '/admin/inventory/p1/adjust')).toHaveLength(1));
    expect(api.find('POST', '/admin/inventory/p1/adjust')[0]!.body).toEqual({
      adjustment_type: 'PURCHASE_RESTOCK',
      quantity_delta: 10,
      notes: 'Received from supplier',
      variant_id: 'v100',
    });
    expect(await screen.findByText('Chilli Powder - 100 g: 12 on hand.')).toBeInTheDocument();
  });
});

describe('Product import - variant rows', () => {
  it('validates variant rows in the browser, sends parent_sku / variant / delivery_lead_days, and previews variants', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
    const csv = [
      'name,category,unit,pack_size,purchase_cost,selling_price,markup_percent,sku,barcode,description,tracked,opening_stock,image_url,parent_sku,variant,delivery_lead_days',
      'Chilli Powder,Spices,1 pack,,40,,,CHILLI-PWD,,,no,,,,,3',
      ',,,,70,,30,CHILLI-PWD-100G,,,yes,15,,CHILLI-PWD,100 g,',
      ',,,,,,,,,,,,,CHILLI-PWD,250 g,',
    ].join('\r\n');
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/import', {
      'POST /admin/products/import': (call) => {
        const rows = call.body.rows as ImportRow[];
        const result: ImportResult = {
          dry_run: call.body.dry_run,
          summary: { created: rows.length, updated: 0, skipped: 0, errors: 0 },
          results: rows.map((r) =>
            r.variant
              ? {
                  row: r.row!,
                  sku: r.sku || null,
                  status: 'created',
                  kind: 'variant',
                  parent_sku: r.parent_sku!,
                  variant: r.variant,
                  pricing: { pricing_mode: 'MARKUP', pricing_source: 'VARIANT_MARKUP', purchase_cost: 70, selling_price: 91, effective_markup_percent: 30 },
                }
              : { row: r.row!, sku: r.sku, status: 'created', kind: 'product' }
          ),
        };
        return ok(result);
      },
    });
    expect(await screen.findByLabelText('Variants and delivery lead time')).toHaveTextContent(/parent_sku/);
    await user.upload(screen.getByLabelText('2. Choose the filled .xlsx or .csv file'), new File([csv], 'p.csv', { type: 'text/csv' }));

    await waitFor(() => expect(api.find('POST', '/admin/products/import')).toHaveLength(1), { timeout: 10_000 });
    const rows = api.find('POST', '/admin/products/import')[0]!.body.rows as ImportRow[];
    // The variant row without a cost never leaves the phone.
    expect(rows.map((r) => r.row)).toEqual([2, 3]);
    expect(rows[0]).toMatchObject({ sku: 'CHILLI-PWD', delivery_lead_days: 3 });
    expect(rows[1]).toMatchObject({ parent_sku: 'CHILLI-PWD', variant: '100 g', sku: 'CHILLI-PWD-100G', purchase_cost: 70, markup_percent: 30 });

    const table = await screen.findByRole('table');
    const variantRow = within(table).getByText('100 g').closest('tr')!;
    expect(within(variantRow).getByText('Variant')).toBeInTheDocument();
    expect(within(variantRow).getByText(/of CHILLI-PWD/)).toBeInTheDocument();
    expect(within(variantRow).getByText('91.00')).toBeInTheDocument();
    expect(within(variantRow).getByText('New variant will be added')).toBeInTheDocument();
    const bad = within(table).getByText('250 g').closest('tr')!;
    expect(within(bad).getByText(/purchase_cost: purchase_cost is required/)).toBeInTheDocument();
    expect(within(table).getByText(/delivered after 3 days/)).toBeInTheDocument();
  });
});

describe('Order detail and packing slip - variant lines', () => {
  const ORDER = {
    id: 'o1',
    order_number: 'BL-20261014-0007',
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: 300,
    placed_at: '2026-10-14T04:30:00Z',
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Main Street',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_postal_code: null,
    delivery_instructions: null,
    customer_notes: null,
    cancellation_reason: null,
    items: [
      { id: 'i1', product_id: 'p1', variant_id: 'v50', variant_label_snapshot: '50 g', product_name_snapshot: 'Chilli Powder', unit_snapshot: '50 g', quantity: 2, item_status: 'PENDING' },
      { id: 'i2', product_id: 'p1', variant_id: 'v100', variant_label_snapshot: '100 g', product_name_snapshot: 'Chilli Powder', unit_snapshot: '100 g', quantity: 1, item_status: 'PENDING' },
      { id: 'i3', product_id: 'p2', product_name_snapshot: 'Fresh Milk', unit_snapshot: '1 L', quantity: 1, item_status: 'PENDING' },
    ],
    history: [],
    delivery: null,
  };

  it('the slip names each variant once (no repeated unit) and keeps two sizes apart', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', { 'GET /admin/orders/:id': () => ok({ order: ORDER }) });
    const slip = await screen.findByRole('article', { name: 'Packing slip' });
    const rows = within(slip).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['2Chilli Powder - 50 g', '1Chilli Powder - 100 g', '1Fresh Milk1 L']);
  });

  it('the order page lists each size as its own line', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: ORDER }) });
    expect(await screen.findByText('Chilli Powder - 50 g')).toBeInTheDocument();
    expect(screen.getByText('Chilli Powder - 100 g')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Chilli Powder - 100 g unavailable' })).toBeInTheDocument();
  });
});
