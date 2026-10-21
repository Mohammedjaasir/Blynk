import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { Products } from '../pages/Products';
import { ProductImport } from '../pages/ProductImport';
import { OrderItems } from '../components/OrderItems';
import { resolveVariantPrice, formatPriceRange } from '../lib/pricing';
import { TEMPLATE_COLUMNS, VARIANT_RULES, rowsFromMatrix, validateRow } from '../lib/productImport';
import { lineName } from '../lib/insights';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Variants, customer-hidden stock and delivery lead time (migration 045;
 * owner, 2026-10-14): the variant price twin, the product form's Delivery,
 * Stock and Variants sections, the list's price range and the import's
 * variant rows. The server is the authority; these check what is sent and shown.
 */

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- pricing
describe('resolveVariantPrice (twin of the backend rule)', () => {
  const chain = { productMarkupPercent: 25, categoryMarkupPercent: 15, parentCategoryMarkupPercent: 10, globalMarkupPercent: 20 };

  it('FIXED: the fixed price exactly, with the margin and a below-cost loss', () => {
    expect(resolveVariantPrice({ purchaseCost: 40, pricingMode: 'FIXED', fixedSellingPrice: 50, ...chain })).toEqual({
      pricingMode: 'FIXED',
      pricingSource: 'FIXED',
      purchaseCost: 40,
      sellingPrice: 50,
      effectiveMarkupPercent: 25,
      lossPerUnit: null,
    });
    const below = resolveVariantPrice({ purchaseCost: 60, pricingMode: 'FIXED', fixedSellingPrice: 50 });
    expect(below?.lossPerUnit).toBe(10);
    expect(resolveVariantPrice({ purchaseCost: 60, pricingMode: 'FIXED', fixedSellingPrice: null })).toBeNull();
    expect(resolveVariantPrice({ purchaseCost: 0, pricingMode: 'FIXED', fixedSellingPrice: 10 })?.effectiveMarkupPercent).toBeNull();
  });

  it("MARKUP: the variant's own markup first, then product, category, parent, global (20 when unknown)", () => {
    const r = (extra: Record<string, unknown>) => resolveVariantPrice({ purchaseCost: 70, pricingMode: 'MARKUP', ...extra });
    expect(r({ ...chain, variantMarkupPercent: 30 })).toMatchObject({ pricingSource: 'VARIANT_MARKUP', sellingPrice: 91, effectiveMarkupPercent: 30 });
    expect(r({ ...chain, variantMarkupPercent: null })).toMatchObject({ pricingSource: 'PRODUCT_MARKUP', sellingPrice: 87.5 });
    expect(r({ ...chain, productMarkupPercent: null })).toMatchObject({ pricingSource: 'CATEGORY_MARKUP', sellingPrice: 80.5 });
    expect(r({ ...chain, productMarkupPercent: null, categoryMarkupPercent: null })).toMatchObject({
      pricingSource: 'PARENT_CATEGORY_MARKUP',
      sellingPrice: 77,
    });
    expect(r({ globalMarkupPercent: 20 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 84 });
    expect(r({})).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', effectiveMarkupPercent: 20, sellingPrice: 84 });
    // A variant markup of 0 is its own (not "blank").
    expect(r({ ...chain, variantMarkupPercent: 0 })).toMatchObject({ pricingSource: 'VARIANT_MARKUP', sellingPrice: 70 });
    // Blank text is "none", like the server's present().
    expect(r({ ...chain, variantMarkupPercent: '  ' })).toMatchObject({ pricingSource: 'PRODUCT_MARKUP' });
  });

  it('rounds to the cent half away from zero on whole cents (no float drift)', () => {
    expect(resolveVariantPrice({ purchaseCost: 10.05, variantMarkupPercent: 15 })?.sellingPrice).toBe(11.56);
    expect(resolveVariantPrice({ purchaseCost: 33.33, variantMarkupPercent: 12.5 })?.sellingPrice).toBe(37.5);
    expect(resolveVariantPrice({ purchaseCost: 0.1, variantMarkupPercent: 5 })?.sellingPrice).toBe(0.11);
    expect(resolveVariantPrice({ purchaseCost: -1 })).toBeNull();
    expect(resolveVariantPrice({ purchaseCost: 10, variantMarkupPercent: -5 })).toBeNull();
  });

  it('formats a price range', () => {
    expect(formatPriceRange(50, 350)).toBe('LKR 50 - 350');
    expect(formatPriceRange(91, 91)).toBe('LKR 91');
  });
});

// ------------------------------------------------------------ product form
const CATEGORIES = [
  {
    id: 'spices',
    name: 'Spices',
    slug: 'spices',
    description: null,
    image_url: null,
    display_order: 0,
    is_active: true,
    product_count: 1,
    parent_id: null,
    markup_percent: 25,
    markup_product_count: 1,
  },
];

const UNTRACKED = {
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

function variant(id: string, label: string, sort_order: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    product_id: 'p1',
    label,
    sku: `CHILLI-${label.replace(/\s/g, '')}`,
    barcode: null,
    sort_order,
    is_active: true,
    is_available: true,
    purchase_cost: 40,
    pricing_mode: 'FIXED',
    fixed_selling_price: 50,
    custom_markup_percent: null,
    effective_markup_percent: 25,
    pricing_source: 'FIXED',
    selling_price: 50,
    offer_price: null,
    offer_ends_at: null,
    offer_active: false,
    stock: { ...UNTRACKED },
    ...extra,
  };
}

const PRODUCT = {
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
  offer_price: null,
  offer_ends_at: null,
  offer_active: false,
  is_available: true,
  is_active: true,
  delivery_lead_days: 0,
  has_variants: false,
  variant_count: 0,
  stock: { ...UNTRACKED },
  variants: [] as unknown[],
};

function api(product: Record<string, unknown>, extra: (c: Call) => Reply | undefined = () => undefined) {
  tokenStore.save('access', 'refresh');
  return mockApi((c) => {
    const reply = extra(c);
    if (reply) return reply;
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    if (c.method === 'GET' && c.path === '/admin/settings/default-markup') return ok({ markup_percent: 20, updated_at: null, products_using: 0 });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product });
    if (c.method === 'PATCH' && c.path === '/admin/products/p1') return ok({ product: { ...product, ...c.body } });
    if (c.method === 'POST' && c.path === '/admin/products') return ok({ product: { ...PRODUCT, ...c.body, id: 'new1' } });
    return undefined;
  });
}

function renderForm(path = '/products/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/products/new" element={<ProductForm />} />
          <Route path="/products/:id" element={<ProductForm />} />
          <Route path="/products" element={<p>Product list</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const variantsSection = () => screen.getByRole('region', { name: 'Variants' });
const stockSection = () => screen.getByRole('region', { name: 'Stock' });

describe('product form: delivery lead time', () => {
  it('sends delivery_lead_days on update and explains it', async () => {
    const user = userEvent.setup();
    const calls = api(PRODUCT);
    renderForm();
    const lead = await screen.findByLabelText(/^Delivery lead time/);
    expect(lead).toHaveValue('0');
    await user.clear(lead);
    await user.type(lead, '2');
    expect(screen.getByText(/Customers can pick delivery from today \+ 2 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Product list');
    expect(calls.find('PATCH', '/admin/products/p1')[0]!.body.delivery_lead_days).toBe(2);
    // Nothing changed in the Stock section: no stock call.
    expect(calls.find('PUT', '/admin/inventory/p1/stock')).toHaveLength(0);
  });

  it('refuses more than 30 days', async () => {
    const user = userEvent.setup();
    const calls = api(PRODUCT);
    renderForm();
    const lead = await screen.findByLabelText(/^Delivery lead time/);
    await user.clear(lead);
    await user.type(lead, '31');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Delivery lead time must be from 0 to 30/)).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });
});

describe('product form: stock section', () => {
  it('turns tracking on with a count, low-stock level and reason (PUT .../stock)', async () => {
    const user = userEvent.setup();
    const calls = api(PRODUCT, (c) =>
      c.method === 'PUT' && c.path === '/admin/inventory/p1/stock'
        ? ok({ product_id: 'p1', variant_id: null, stock: { ...UNTRACKED, tracked: true, on_hand: 24, sellable: 24 } })
        : undefined
    );
    renderForm();
    await screen.findByLabelText(/^Delivery lead time/);
    expect(within(stockSection()).getByText(/Customers never see the count/)).toBeInTheDocument();
    await user.click(within(stockSection()).getByRole('switch', { name: 'Track stock' }));
    await user.type(within(stockSection()).getByLabelText(/^Stock count/), '24');
    await user.type(within(stockSection()).getByLabelText(/^Reason/), 'Shelf count');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Product list');
    expect(calls.find('PUT', '/admin/inventory/p1/stock')[0]!.body).toEqual({ tracked: true, stock_count: 24, reason: 'Shelf count' });
  });

  it('shows the current stock and sends stock_count only when it changed', async () => {
    const user = userEvent.setup();
    const tracked = {
      ...PRODUCT,
      stock: { ...UNTRACKED, inventory_id: 'i1', tracked: true, on_hand: 20, in_open_orders: 3, sellable: 17, low_stock_threshold: 5 },
    };
    const calls = api(tracked, (c) =>
      c.method === 'PUT' && c.path === '/admin/inventory/p1/stock' ? ok({ product_id: 'p1', variant_id: null, stock: tracked.stock }) : undefined
    );
    renderForm();
    const current = await screen.findByLabelText('Current stock');
    expect(current).toHaveTextContent('On hand20');
    expect(current).toHaveTextContent('In open orders3');
    expect(current).toHaveTextContent('Sellable17');
    expect(within(stockSection()).getByLabelText(/^Stock count/)).toHaveValue('20');
    const level = within(stockSection()).getByLabelText(/^Low-stock level/);
    await user.clear(level);
    await user.type(level, '8');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Product list');
    expect(calls.find('PUT', '/admin/inventory/p1/stock')[0]!.body).toEqual({ tracked: true, low_stock_threshold: 8 });
  });

  it('a new product with tracking: creates it, then sets its stock', async () => {
    const user = userEvent.setup();
    const calls = api(PRODUCT, (c) =>
      c.method === 'PUT' && c.path === '/admin/inventory/new1/stock'
        ? ok({ product_id: 'new1', variant_id: null, stock: { ...UNTRACKED, tracked: true, on_hand: 12 } })
        : undefined
    );
    renderForm('/products/new');
    await user.type(await screen.findByLabelText('Product name'), 'Ribbon Cake');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Spices' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Category'), 'spices');
    await user.type(screen.getByLabelText(/^SKU/), 'CAKE-1');
    await user.type(screen.getByLabelText(/^Unit/), '1 kg');
    await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), '2500');
    await user.click(screen.getByRole('button', { name: 'Markup' })); // new products start on Fixed price
    const lead = screen.getByLabelText(/^Delivery lead time/);
    await user.clear(lead);
    await user.type(lead, '2');
    expect(within(variantsSection()).getByText(/Save the product first to add variants/)).toBeInTheDocument();
    await user.click(within(stockSection()).getByRole('switch', { name: 'Track stock' }));
    await user.type(within(stockSection()).getByLabelText(/^Stock count/), '12');
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await screen.findByText('Product list');
    expect(calls.find('POST', '/admin/products')[0]!.body.delivery_lead_days).toBe(2);
    expect(calls.find('PUT', '/admin/inventory/new1/stock')[0]!.body).toEqual({ tracked: true, stock_count: 12, low_stock_threshold: 5 });
    const order = calls.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('POST /admin/products')).toBeLessThan(order.indexOf('PUT /admin/inventory/new1/stock'));
  });

  it('with variants: says stock is set per variant', async () => {
    api({ ...PRODUCT, has_variants: true, variant_count: 1, variants: [variant('v1', '50 g', 0)] });
    renderForm();
    await screen.findByLabelText(/^Delivery lead time/);
    expect(within(stockSection()).getByText(/stock is set per variant/)).toBeInTheDocument();
    expect(within(stockSection()).queryByRole('switch', { name: 'Track stock' })).not.toBeInTheDocument();
  });
});

describe('product form: variants', () => {
  it('adds a variant: live price preview, then POST with price and stock', async () => {
    const user = userEvent.setup();
    const calls = api(PRODUCT, (c) =>
      c.method === 'POST' && c.path === '/admin/products/p1/variants'
        ? {
            status: 201,
            data: {
              variant: variant('v2', '100 g', 0, {
                purchase_cost: 70,
                pricing_mode: 'MARKUP',
                fixed_selling_price: null,
                custom_markup_percent: 30,
                pricing_source: 'VARIANT_MARKUP',
                selling_price: 91,
                stock: { ...UNTRACKED, tracked: true, on_hand: 15, sellable: 15 },
              }),
            },
          }
        : undefined
    );
    renderForm();
    await screen.findByLabelText(/^Delivery lead time/);
    expect(within(variantsSection()).getByText(/No variants/)).toBeInTheDocument();
    await user.click(within(variantsSection()).getByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    await user.type(within(dialog).getByLabelText(/^Variant name/), '100 g');
    await user.type(within(dialog).getByLabelText(/^SKU/), 'CHILLI-PWD-100G');
    await user.type(within(dialog).getByLabelText(/^Cost price \(LKR\)/), '70');
    await user.click(within(dialog).getByRole('button', { name: 'Markup' })); // a new size starts on Fixed price
    // No markup of its own yet: the category's 25%.
    expect(within(dialog).getByText('Selling price LKR 87.50 (category markup 25%)')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Variant markup %/), '30');
    expect(within(dialog).getByText('Selling price LKR 91.00 (variant markup 30%)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('switch', { name: 'Track stock' }));
    await user.type(within(dialog).getByLabelText(/^Stock count/), '15');
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));

    await waitFor(() => expect(calls.find('POST', '/admin/products/p1/variants')).toHaveLength(1));
    expect(calls.find('POST', '/admin/products/p1/variants')[0]!.body).toEqual({
      label: '100 g',
      sku: 'CHILLI-PWD-100G',
      barcode: null,
      purchase_cost: 70,
      pricing_mode: 'MARKUP',
      custom_markup_percent: 30,
      is_active: true,
      is_available: true,
      sort_order: 0,
      track_stock: true,
      stock_count: 15,
      low_stock_threshold: 5,
    });
    const row = await within(variantsSection()).findByRole('row', { name: 'Variant 100 g' });
    expect(row).toHaveTextContent('LKR 91.00');
    expect(row).toHaveTextContent('Variant markup');
    expect(row).toHaveTextContent('15 in stock');
    // The product now has variants: its own stock is per variant.
    expect(within(stockSection()).getByText(/stock is set per variant/)).toBeInTheDocument();
    // Saving variants never saves the product.
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('edits a variant: PATCH sends what changed, stock goes to PUT .../stock with variant_id', async () => {
    const user = userEvent.setup();
    const v1 = variant('v1', '50 g', 0, { stock: { ...UNTRACKED, inventory_id: 'i1', tracked: true, on_hand: 20, sellable: 20 } });
    const calls = api({ ...PRODUCT, has_variants: true, variant_count: 1, variants: [v1] }, (c) => {
      if (c.method === 'PATCH' && c.path === '/admin/products/p1/variants/v1') {
        return ok({ variant: { ...v1, fixed_selling_price: 55, selling_price: 55 } });
      }
      if (c.method === 'PUT' && c.path === '/admin/inventory/p1/stock') {
        return ok({ product_id: 'p1', variant_id: 'v1', stock: { ...v1.stock, on_hand: 3, sellable: 3, is_low_stock: true } });
      }
      return undefined;
    });
    renderForm();
    await user.click(await within(await screen.findByRole('region', { name: 'Variants' })).findByRole('button', { name: 'Edit 50 g' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit variant 50 g' });
    const price = within(dialog).getByLabelText(/^Selling price \(LKR\)/);
    expect(price).toHaveValue('50');
    await user.clear(price);
    await user.type(price, '55');
    const count = within(dialog).getByLabelText(/^Stock count/);
    expect(count).toHaveValue('20');
    await user.clear(count);
    await user.type(count, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save variant' }));

    await waitFor(() => expect(calls.find('PUT', '/admin/inventory/p1/stock')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/products/p1/variants/v1')[0]!.body).toEqual({ pricing_mode: 'FIXED', fixed_selling_price: 55 });
    expect(calls.find('PUT', '/admin/inventory/p1/stock')[0]!.body).toEqual({ variant_id: 'v1', tracked: true, stock_count: 3 });
    const row = await within(variantsSection()).findByRole('row', { name: 'Variant 50 g' });
    expect(row).toHaveTextContent('LKR 55.00');
    expect(row).toHaveTextContent('Low · 3');
  });

  it('shows the API error in the dialog (label already used)', async () => {
    const user = userEvent.setup();
    api({ ...PRODUCT, has_variants: true, variant_count: 1, variants: [variant('v1', '50 g', 0)] }, (c) =>
      c.method === 'POST' && c.path === '/admin/products/p1/variants'
        ? fail(409, 'VARIANT_LABEL_EXISTS', "This product already has a variant called '50 g'.")
        : undefined
    );
    renderForm();
    await user.click(await within(await screen.findByRole('region', { name: 'Variants' })).findByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    await user.type(within(dialog).getByLabelText(/^Variant name/), '50 g');
    await user.type(within(dialog).getByLabelText(/^Cost price \(LKR\)/), '40');
    await user.click(within(dialog).getByRole('button', { name: 'Markup' })); // a new size starts on Fixed price
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    expect(await within(dialog).findByText("This product already has a variant called '50 g'.")).toBeInTheDocument();
  });

  it('reorders with Up / Down and sends every id in the new order', async () => {
    const user = userEvent.setup();
    const list = [variant('v1', '50 g', 0), variant('v2', '100 g', 1), variant('v3', '250 g', 2)];
    const calls = api({ ...PRODUCT, has_variants: true, variant_count: 3, variants: list }, (c) => {
      if (c.method === 'PUT' && c.path === '/admin/products/p1/variants/order') {
        const ids: string[] = c.body.variant_ids;
        return ok({ variants: ids.map((id, i) => ({ ...list.find((v) => v.id === id)!, sort_order: i })) });
      }
      return undefined;
    });
    renderForm();
    const section = await screen.findByRole('region', { name: 'Variants' });
    expect(within(section).getByRole('button', { name: 'Move 50 g up' })).toBeDisabled();
    await user.click(within(section).getByRole('button', { name: 'Move 250 g up' }));
    await waitFor(() => expect(calls.find('PUT', '/admin/products/p1/variants/order')).toHaveLength(1));
    expect(calls.find('PUT', '/admin/products/p1/variants/order')[0]!.body).toEqual({ variant_ids: ['v1', 'v3', 'v2'] });
    await waitFor(() =>
      expect(within(section).getAllByRole('row').slice(1).map((r) => r.getAttribute('aria-label'))).toEqual([
        'Variant 50 g',
        'Variant 250 g',
        'Variant 100 g',
      ])
    );
  });

  it('deletes: removed when never ordered, archived (SOFT) when it was', async () => {
    const user = userEvent.setup();
    const list = [variant('v1', '50 g', 0), variant('v2', '100 g', 1)];
    const calls = api({ ...PRODUCT, has_variants: true, variant_count: 2, variants: list }, (c) => {
      if (c.method === 'DELETE' && c.path === '/admin/products/p1/variants/v1') return ok({ product_id: 'p1', variant_id: 'v1', mode: 'HARD' });
      if (c.method === 'DELETE' && c.path === '/admin/products/p1/variants/v2') return ok({ product_id: 'p1', variant_id: 'v2', mode: 'SOFT' });
      return undefined;
    });
    renderForm();
    const section = await screen.findByRole('region', { name: 'Variants' });
    await user.click(within(section).getByRole('button', { name: 'Delete 50 g' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete variant' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('50 g removed.')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Delete 100 g' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete variant' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/100 g archived: it has past orders/)).toBeInTheDocument();
    expect(calls.find('DELETE', '/admin/products/p1/variants/v1')).toHaveLength(1);
    expect(calls.find('DELETE', '/admin/products/p1/variants/v2')).toHaveLength(1);
    expect(within(section).getByText(/No variants/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- product list
describe('product list', () => {
  it('shows the price range and variant count, stock badges and the lead time', async () => {
    tokenStore.save('access', 'refresh');
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.method === 'GET' && c.path === '/admin/products') {
        return ok({
          products: [
            { ...PRODUCT, has_variants: true, variant_count: 4, price_min: 50, price_max: 350, variants: undefined },
            {
              ...PRODUCT,
              id: 'p2',
              name: 'Ribbon Cake',
              has_variants: false,
              delivery_lead_days: 2,
              stock: { ...UNTRACKED, tracked: true, on_hand: 2, sellable: 2, is_low_stock: true },
            },
            {
              ...PRODUCT,
              id: 'p3',
              name: 'Samba Rice',
              stock: { ...UNTRACKED, tracked: true, on_hand: 0, sellable: 0, is_low_stock: true, is_out_of_stock: true },
            },
          ],
        });
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Products />
        </ToastProvider>
      </MemoryRouter>
    );
    const chilli = (await screen.findByText('Chilli Powder')).closest('tr')!;
    expect(chilli).toHaveTextContent('LKR 50 - 350');
    expect(chilli).toHaveTextContent('4 variants');
    const cake = screen.getByText('Ribbon Cake').closest('tr')!;
    expect(cake).toHaveTextContent('Low · 2');
    expect(cake).toHaveTextContent('Delivery +2 days');
    expect(screen.getByText('Samba Rice').closest('tr')!).toHaveTextContent('Sold out');
  });
});

// ------------------------------------------------------------------- import
describe('import: variant rows', () => {
  const HEADER = [...TEMPLATE_COLUMNS];
  const cell = (values: Partial<Record<(typeof TEMPLATE_COLUMNS)[number], string | number>>) =>
    HEADER.map((h) => values[h] ?? '');

  it('accepts a variant row without name, category or unit, and passes parent_sku / variant through', () => {
    const { rows, fileError } = rowsFromMatrix([
      HEADER,
      cell({ name: 'Chilli Powder', category: 'Spices', unit: '1 pack', purchase_cost: 40, sku: 'CHILLI-PWD', delivery_lead_days: 2 }),
      cell({ purchase_cost: 70, markup_percent: 30, parent_sku: 'CHILLI-PWD', variant: '100 g', tracked: 'yes', opening_stock: 15 }),
    ]);
    expect(fileError).toBeNull();
    expect(rows.map((r) => r.errors)).toEqual([[], []]);
    expect(rows[0]!.data).toMatchObject({ delivery_lead_days: 2, parent_sku: null, variant: null });
    expect(rows[1]!.data).toMatchObject({
      name: '',
      sku: '',
      parent_sku: 'CHILLI-PWD',
      variant: '100 g',
      purchase_cost: 70,
      markup_percent: 30,
      tracked: 'yes',
      opening_stock: 15,
      delivery_lead_days: null,
    });
  });

  it('rejects a variant row without parent_sku, and bad lead days on a product row', () => {
    const fields = (record: Record<string, unknown>) => validateRow(record, 2).errors.map((e) => e.field);
    expect(fields({ variant: '100 g', purchase_cost: 70 })).toEqual(['parent_sku']);
    expect(fields({ parent_sku: 'CHILLI-PWD', purchase_cost: 70 })).toEqual(['variant']);
    expect(fields({ parent_sku: 'CHILLI-PWD', variant: '100 g' })).toEqual(['purchase_cost']);
    expect(fields({ parent_sku: 'CHILLI-PWD', variant: '100 g', purchase_cost: 70, sku: 'CHILLI-PWD' })).toEqual(['sku']);
    const product = { name: 'Cake', category: 'Bakery', unit: '1 kg', purchase_cost: 100, sku: 'CAKE-1' };
    expect(fields({ ...product, delivery_lead_days: 31 })).toEqual(['delivery_lead_days']);
    expect(fields({ ...product, delivery_lead_days: 1.5 })).toEqual(['delivery_lead_days']);
    expect(fields({ ...product, delivery_lead_days: 30 })).toEqual([]);
    // The same variant twice in one file.
    const dup = rowsFromMatrix([
      HEADER,
      cell({ purchase_cost: 70, parent_sku: 'CHILLI-PWD', variant: '100 g' }),
      cell({ purchase_cost: 75, parent_sku: 'chilli-pwd', variant: '100 G' }),
    ]);
    expect(dup.rows[1]!.errors).toEqual([{ field: 'variant', message: 'Same variant as row 2.' }]);
  });

  it('the dry-run preview shows a variant row clearly, and lists the variant rules', async () => {
    const XLSX = await import('xlsx');
    tokenStore.save('access', 'refresh');
    const calls = mockApi((c) => {
      if (c.method === 'POST' && c.path === '/admin/products/import') {
        return ok({
          dry_run: true,
          summary: { created: 2, updated: 0, skipped: 0, errors: 0 },
          results: [
            {
              row: 2,
              sku: 'CHILLI-PWD',
              status: 'created',
              kind: 'product',
              pricing: { pricing_mode: 'MARKUP', pricing_source: 'CATEGORY_MARKUP', purchase_cost: 40, selling_price: 50, effective_markup_percent: 25 },
            },
            {
              row: 3,
              sku: 'CHILLI-PWD-100G',
              status: 'created',
              kind: 'variant',
              parent_sku: 'CHILLI-PWD',
              variant: '100 g',
              pricing: { pricing_mode: 'MARKUP', pricing_source: 'VARIANT_MARKUP', purchase_cost: 70, selling_price: 91, effective_markup_percent: 30 },
            },
          ],
        });
      }
      return undefined;
    });
    const sheet = XLSX.utils.aoa_to_sheet([
      HEADER,
      cell({ name: 'Chilli Powder', category: 'Spices', unit: '1 pack', purchase_cost: 40, sku: 'CHILLI-PWD' }),
      cell({ purchase_cost: 70, markup_percent: 30, sku: 'CHILLI-PWD-100G', parent_sku: 'CHILLI-PWD', variant: '100 g' }),
    ]);
    const file = new File([XLSX.utils.sheet_to_csv(sheet)], 'products.csv', { type: 'text/csv' });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProductImport />
        </ToastProvider>
      </MemoryRouter>
    );
    const rules = screen.getByRole('list', { name: 'How variants work' });
    expect(within(rules).getAllByRole('listitem')).toHaveLength(VARIANT_RULES.length);
    await user.upload(screen.getByLabelText('Spreadsheet (.xlsx or .csv)'), file);
    const preview = await screen.findByRole('table', { name: 'Preview' });
    expect(await within(preview).findByText('Variant 100 g of CHILLI-PWD')).toBeInTheDocument();
    expect(await within(preview).findByText('Will be added as a variant')).toBeInTheDocument();
    expect(within(preview).getByText('Variant markup')).toBeInTheDocument();
    const sent = calls.find('POST', '/admin/products/import')[0]!.body.rows;
    expect(sent[1]).toMatchObject({ parent_sku: 'CHILLI-PWD', variant: '100 g', sku: 'CHILLI-PWD-100G' });
  });
});

// -------------------------------------------------------------- order lines
describe('order items and purchase lines', () => {
  it('shows the variant label next to the product name, once', () => {
    render(
      <OrderItems
        items={[
          { id: 'i1', product_name_snapshot: 'Chilli Powder', quantity: 2, item_status: 'PENDING', variant_id: 'v2', variant_label_snapshot: '100 g', unit_snapshot: '100 g' },
          { id: 'i2', product_name_snapshot: 'Sugar 1 kg', quantity: 1, item_status: 'PENDING', variant_id: 'v9', variant_label_snapshot: '1 kg', unit_snapshot: '1 kg' },
          { id: 'i3', product_name_snapshot: 'Milk', quantity: 1, item_status: 'PENDING' },
        ]}
      />
    );
    expect(screen.getByText('Chilli Powder · 100 g')).toBeInTheDocument();
    expect(screen.getByText('Sugar 1 kg')).toBeInTheDocument();
    expect(screen.getByText('Milk')).toBeInTheDocument();
  });

  it('a purchase list variant line uses its display name', () => {
    expect(
      lineName({ product_name: 'Chilli Powder', product_unit: '1 pack', pack_size: null, variant_label: '100 g', display_name: 'Chilli Powder - 100 g' })
    ).toBe('Chilli Powder - 100 g');
    expect(lineName({ product_name: 'Sugar', product_unit: '1 kg', pack_size: null })).toBe('Sugar (1 kg)');
  });
});
