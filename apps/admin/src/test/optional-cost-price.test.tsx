import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Owner, 2026-10-21: "make cost price optional ... we will put the selling
 * price only". New products and sizes start on Fixed price; an empty cost is
 * sent as 0 and a stored 0 shows empty; Markup with no cost is refused on the
 * cost field (cost x markup would be 0).
 */
vi.setConfig({ testTimeout: 20_000 });

const MESSAGE = 'Enter the cost price, or choose Fixed price and enter the selling price.';

const CATEGORIES = [
  {
    id: 'rice',
    name: 'Rice',
    slug: 'rice',
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

/** A FIXED product saved with no cost yet (cost 0), with one size also at cost 0. */
const PRODUCT = {
  id: 'p1',
  category_id: 'rice',
  category_name: 'Rice',
  name: 'Samba Rice 1kg',
  slug: 'samba-rice-1kg',
  sku: 'RICE-SAMBA-1KG',
  barcode: null,
  unit: '1 kg',
  pack_size: null,
  description: null,
  image_url: null,
  purchase_cost: 0,
  pricing_mode: 'FIXED',
  fixed_selling_price: 250,
  custom_markup_percent: null,
  category_markup_percent: 25,
  parent_category_markup_percent: null,
  global_markup_percent: 20,
  effective_markup_percent: null,
  pricing_source: 'FIXED',
  calculated_selling_price: 250,
  selling_price: 250,
  price_warning: null,
  offer_price: null,
  offer_ends_at: null,
  offer_active: false,
  is_available: true,
  is_active: true,
  delivery_lead_days: 0,
  has_variants: true,
  variant_count: 1,
  stock: { ...UNTRACKED },
  variants: [
    {
      id: 'v1',
      product_id: 'p1',
      label: '5 kg',
      sku: 'RICE-SAMBA-5KG',
      barcode: null,
      sort_order: 0,
      is_active: true,
      is_available: true,
      purchase_cost: 0,
      pricing_mode: 'FIXED',
      fixed_selling_price: 1200,
      custom_markup_percent: null,
      effective_markup_percent: null,
      pricing_source: 'FIXED',
      selling_price: 1200,
      offer_price: null,
      offer_ends_at: null,
      offer_active: false,
      stock: { ...UNTRACKED },
    },
  ],
};

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function api(extra: (c: Call) => Reply | undefined = () => undefined) {
  tokenStore.save('access', 'refresh');
  return mockApi((c) => {
    const reply = extra(c);
    if (reply) return reply;
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    if (c.method === 'GET' && c.path === '/admin/settings/default-markup') return ok({ markup_percent: 20, updated_at: null, products_using: 0 });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product: PRODUCT });
    if (c.method === 'POST' && c.path === '/admin/products') return ok({ product: { ...PRODUCT, ...c.body, id: 'new1' } });
    return undefined;
  });
}

function renderForm(path: string) {
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

async function fillNewProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Product name'), 'Samba Rice 1kg');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Rice' })).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText('Category'), 'rice');
  await user.type(screen.getByLabelText(/^SKU/), 'RICE-SAMBA-1KG');
  await user.type(screen.getByLabelText(/^Unit/), '1 kg');
}

describe('product form: cost price optional', () => {
  it('a new product starts on Fixed price and saves with purchase_cost 0 when the cost is left empty', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderForm('/products/new');
    await fillNewProduct(user);
    expect(screen.getByRole('button', { name: 'Fixed price' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/^Cost price \(LKR\)/)).toHaveValue('');
    expect(screen.getByText('Optional. Leave empty until the supplier confirms it.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Selling price \(LKR\)/), '250');
    // No cost: the price shows without a margin or a loss.
    const pricing = screen.getByRole('region', { name: 'Pricing' });
    expect(within(pricing).getByText('Selling price LKR 250.00')).toBeInTheDocument();
    expect(within(pricing).queryByText(/you lose/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(calls.find('POST', '/admin/products')).toHaveLength(1));
    expect(calls.find('POST', '/admin/products')[0]!.body).toMatchObject({
      purchase_cost: 0,
      pricing_mode: 'FIXED',
      fixed_selling_price: 250,
    });
  });

  it('Markup with an empty cost shows the error on the cost field and sends nothing', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderForm('/products/new');
    await fillNewProduct(user);
    await user.click(screen.getByRole('button', { name: 'Markup' }));
    expect(screen.getByText('Enter the cost price to see the selling price.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Cost price \(LKR\)/).closest('label')).toHaveTextContent(MESSAGE);
    expect(calls.find('POST', '/admin/products')).toHaveLength(0);
  });

  it('a stored cost of 0 shows as an empty field; the size list says Not set; a new size starts on Fixed price', async () => {
    const user = userEvent.setup();
    const calls = api((c) =>
      c.method === 'POST' && c.path === '/admin/products/p1/variants'
        ? ok({ variant: { ...PRODUCT.variants[0], ...c.body, id: 'v2', label: '10 kg', selling_price: 2300 } })
        : undefined
    );
    renderForm('/products/p1');
    expect(await screen.findByLabelText(/^Selling price \(LKR\)/)).toHaveValue('250');
    expect(screen.getByLabelText(/^Cost price \(LKR\)/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Fixed price' })).toHaveAttribute('aria-pressed', 'true');

    const variants = await screen.findByRole('region', { name: 'Variants' });
    const row = await within(variants).findByRole('row', { name: 'Variant 5 kg' });
    expect(within(row).getByText('Not set')).toBeInTheDocument();
    expect(within(row).queryByText('LKR 0.00')).not.toBeInTheDocument();

    await user.click(within(variants).getByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    expect(within(dialog).getByRole('button', { name: 'Fixed price' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(within(dialog).getByLabelText(/^Variant name/), '10 kg');
    // Markup with no cost: refused on the cost field.
    await user.click(within(dialog).getByRole('button', { name: 'Markup' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    expect(await within(dialog).findByText(MESSAGE)).toBeInTheDocument();
    expect(calls.find('POST', '/admin/products/p1/variants')).toHaveLength(0);
    // Fixed price with no cost: saved with purchase_cost 0.
    await user.click(within(dialog).getByRole('button', { name: 'Fixed price' }));
    await user.type(within(dialog).getByLabelText(/^Selling price \(LKR\)/), '2300');
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(calls.find('POST', '/admin/products/p1/variants')).toHaveLength(1));
    expect(calls.find('POST', '/admin/products/p1/variants')[0]!.body).toMatchObject({
      label: '10 kg',
      purchase_cost: 0,
      pricing_mode: 'FIXED',
      fixed_selling_price: 2300,
    });
  });
});
