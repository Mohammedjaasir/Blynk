import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category, StaffStock, StaffVariant } from '../api/types';
import { costInput, parseCostInput } from '../lib/pricing';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/**
 * Owner, 2026-10-21: "make cost price optional ... we will put the selling
 * price only". New products and sizes start on Fixed price; an empty cost is
 * sent as 0 and a stored 0 shows empty; Markup with no cost is refused on the
 * cost field (cost x markup would be 0).
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const MESSAGE = 'Enter the cost price, or choose Fixed price and enter the selling price.';

const RICE: Category = {
  id: 'rice',
  name: 'Rice',
  slug: 'rice',
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

const SIZE: StaffVariant = {
  id: 'v1',
  label: '5 kg',
  product_id: 'p1',
  sku: 'RICE-5KG',
  barcode: null,
  sort_order: 0,
  is_active: true,
  is_available: true,
  purchase_cost: 0,
  pricing_mode: 'FIXED',
  fixed_selling_price: 1200,
  custom_markup_percent: null,
  product_markup_percent: null,
  category_markup_percent: 25,
  parent_category_markup_percent: null,
  global_markup_percent: 20,
  effective_markup_percent: null,
  pricing_source: 'FIXED',
  selling_price: 1200,
  price_warning: null,
  offer_price: null,
  offer_ends_at: null,
  offer_active: false,
  customer_price: 1200,
  is_orderable: true,
  stock: { ...UNTRACKED },
};

/** A FIXED product saved with no cost yet (cost 0), with one size also at cost 0. */
function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: 'p1',
    category_id: 'rice',
    category_name: 'Rice',
    name: 'Samba Rice',
    slug: 'samba-rice',
    sku: 'RICE-1',
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
    is_available: true,
    is_active: true,
    delivery_lead_days: 0,
    has_variants: true,
    variant_count: 1,
    stock: { ...UNTRACKED },
    variants: [SIZE],
    ...overrides,
  };
}

const COMMON = {
  'GET /admin/categories': () => ok({ categories: [RICE] }),
  'GET /admin/settings/default-markup': () => ok({ markup_percent: 20, updated_at: null, products_using: 0 }),
  'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
};

async function fillNewProduct(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Add product');
  await user.type(screen.getByLabelText('Product name'), 'Samba Rice');
  await user.type(screen.getByLabelText('SKU'), 'RICE-1');
  await user.type(screen.getByLabelText(/^Unit/), '1 kg');
}

describe('cost price helpers', () => {
  it('a stored 0 is an empty field; an empty field is 0', () => {
    expect(costInput(0)).toBe('');
    expect(costInput('0.00')).toBe('');
    expect(costInput(null)).toBe('');
    expect(costInput(125.5)).toBe('125.5');
    expect(parseCostInput('')).toBe(0);
    expect(parseCostInput(' 80 ')).toBe(80);
    expect(parseCostInput('abc')).toBeNull();
    expect(parseCostInput('-1')).toBeNull();
  });
});

describe('Ops product form: cost price optional', () => {
  it('a new product starts on Fixed price and saves with purchase_cost 0 when the cost is left empty', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      ...COMMON,
      'POST /admin/products': () => ok({ product: product({ variants: [], has_variants: false, variant_count: 0 }) }),
    });
    await fillNewProduct(user);
    expect(screen.getByRole('radio', { name: 'Fixed price' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/^Cost price \(LKR\)/)).toHaveValue('');
    expect(screen.getByText('Optional. Leave empty until the supplier confirms it.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Selling price \(LKR\)/), '250');
    // No cost: no "% over cost" and no loss warning.
    expect(screen.queryByText(/over cost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/you lose/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(api.find('POST', '/admin/products')).toHaveLength(1));
    expect(api.find('POST', '/admin/products')[0]!.body).toMatchObject({
      purchase_cost: 0,
      pricing_mode: 'FIXED',
      fixed_selling_price: 250,
    });
  });

  it('Markup with an empty cost shows the error on the cost field and sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', COMMON);
    await fillNewProduct(user);
    await user.click(screen.getByRole('radio', { name: 'Markup' }));
    expect(screen.getByText('Enter the cost price to see the selling price.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Cost price \(LKR\)/).closest('label')).toHaveTextContent(MESSAGE);
    expect(api.find('POST', '/admin/products')).toHaveLength(0);
  });

  it('a stored cost of 0 shows empty; the size list says cost not set; a new size starts on Fixed price', async () => {
    const user = userEvent.setup();
    const created: StaffVariant = { ...SIZE, id: 'v2', label: '10 kg', sort_order: 1, fixed_selling_price: 2300, selling_price: 2300 };
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      ...COMMON,
      'GET /admin/products/:id': () => ok({ product: product() }),
      'POST /admin/products/:id/variants': () => ({ status: 201, data: { variant: created } }),
    });
    expect(await screen.findByLabelText(/^Selling price \(LKR\)/)).toHaveValue('250');
    expect(screen.getByLabelText(/^Cost price \(LKR\)/)).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Fixed price' })).toHaveAttribute('aria-checked', 'true');

    const list = await screen.findByRole('list', { name: 'Variants' });
    const row = within(list).getAllByRole('listitem')[0]!;
    expect(within(row).getByText('cost not set')).toBeInTheDocument();
    expect(within(row).queryByText(/cost LKR 0\.00/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    expect(within(dialog).getByRole('radio', { name: 'Fixed price' })).toHaveAttribute('aria-checked', 'true');
    await user.type(within(dialog).getByLabelText(/^Variant name/), '10 kg');
    // Markup with no cost: refused on the cost field.
    await user.click(within(dialog).getByRole('radio', { name: 'Markup' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    expect(await within(dialog).findByText(MESSAGE)).toBeInTheDocument();
    expect(api.find('POST', '/admin/products/p1/variants')).toHaveLength(0);
    // Fixed price with no cost: saved with purchase_cost 0.
    await user.click(within(dialog).getByRole('radio', { name: 'Fixed price' }));
    await user.type(within(dialog).getByLabelText(/^Price \(LKR\)/), '2300');
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(api.find('POST', '/admin/products/p1/variants')).toHaveLength(1));
    expect(api.find('POST', '/admin/products/p1/variants')[0]!.body).toMatchObject({
      label: '10 kg',
      purchase_cost: 0,
      pricing_mode: 'FIXED',
      fixed_selling_price: 2300,
    });
  });
});
