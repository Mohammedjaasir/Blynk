import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { Products } from '../pages/Products';
import { ProductImport } from '../pages/ProductImport';
import { capAtMrp, mrpCappedNote, parseMrpInput } from '../lib/pricing';
import { PRICING_RULES, TEMPLATE_COLUMNS, validateRow } from '../lib/productImport';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * MRP (migration 048; owner, 2026-10-14): the product form's MRP field with
 * the "Capped at MRP (markup would give LKR X)" note, the size dialog's MRP,
 * the list's MRP column and capped note, and the import's mrp column and
 * capped count. The server applies the cap; these check what the screens send
 * and show.
 */
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
/** Cost 200 + category 25% = 250, capped at the MRP 240. */
const SAMBA = {
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
  purchase_cost: 200,
  pricing_mode: 'MARKUP',
  fixed_selling_price: null,
  custom_markup_percent: null,
  category_markup_percent: 25,
  parent_category_markup_percent: null,
  global_markup_percent: 20,
  effective_markup_percent: 25,
  pricing_source: 'CATEGORY_MARKUP',
  calculated_selling_price: 240,
  selling_price: 240,
  computed_selling_price: 250,
  mrp: 240,
  mrp_capped: true,
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

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function api(product: Record<string, unknown>, extra: (c: Call) => Reply | undefined = () => undefined) {
  tokenStore.save('access', 'refresh');
  return mockApi((c) => {
    const reply = extra(c);
    if (reply) return reply;
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    if (c.method === 'GET' && c.path === '/admin/settings/default-markup') return ok({ markup_percent: 20, updated_at: null, products_using: 0 });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product });
    if (c.method === 'PATCH' && c.path === '/admin/products/p1') return ok({ product: { ...product, ...c.body } });
    if (c.method === 'POST' && c.path === '/admin/products') return ok({ product: { ...product, ...c.body, id: 'new1' } });
    return undefined;
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/products/new" element={<ProductForm />} />
          <Route path="/products/import" element={<ProductImport />} />
          <Route path="/products/:id" element={<ProductForm />} />
          <Route path="/products" element={<Products />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const pricing = () => screen.getByRole('region', { name: 'Pricing' });

describe('MRP helpers (the backend capAtMrp twin)', () => {
  it('parses the field, caps the price and words the note', () => {
    expect(parseMrpInput('')).toEqual({ value: null });
    expect(parseMrpInput(' 120.50 ')).toEqual({ value: 120.5 });
    expect(parseMrpInput('0')).toHaveProperty('error');
    expect(parseMrpInput('12.345')).toHaveProperty('error');
    expect(parseMrpInput('abc')).toHaveProperty('error');
    expect(capAtMrp(150, 120)).toEqual({ price: 120, capped: true });
    expect(capAtMrp(120, 120)).toEqual({ price: 120, capped: false });
    expect(capAtMrp(90, null)).toEqual({ price: 90, capped: false });
    expect(mrpCappedNote('MARKUP', 150)).toBe('Capped at MRP (markup would give LKR 150.00)');
    expect(mrpCappedNote('FIXED', 300)).toBe('Capped at MRP (fixed price LKR 300.00)');
  });
});

describe('product form: MRP', () => {
  it('a new product: typing an MRP under the markup price shows the cap, and the MRP is sent', async () => {
    const user = userEvent.setup();
    const calls = api(SAMBA);
    renderAt('/products/new');
    await user.type(await screen.findByLabelText('Product name'), 'Test rice');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Rice' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('SKU'), 'TEST-RICE');
    await user.type(screen.getByLabelText(/^Unit/), '1 kg');
    await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), '100');
    await user.click(screen.getByRole('button', { name: 'Markup' })); // new products start on Fixed price
    await user.type(screen.getByLabelText(/^Custom markup %/), '50');
    expect(within(pricing()).getByText('Selling price LKR 150.00 (product markup 50%)')).toBeInTheDocument();

    await user.type(within(pricing()).getByLabelText(/^MRP \(LKR\)/), '120');
    expect(within(pricing()).getByText('Selling price LKR 120.00 (the MRP)')).toBeInTheDocument();
    expect(within(pricing()).getByText('Capped at MRP (markup would give LKR 150.00)')).toBeInTheDocument();

    // An MRP above the price: no cap, the app strikes the MRP.
    await user.clear(within(pricing()).getByLabelText(/^MRP \(LKR\)/));
    await user.type(within(pricing()).getByLabelText(/^MRP \(LKR\)/), '180');
    expect(within(pricing()).queryByText(/Capped at MRP/)).not.toBeInTheDocument();
    expect(within(pricing()).getByText(/Below the MRP \(LKR 180.00\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(calls.find('POST', '/admin/products')).toHaveLength(1));
    expect(calls.find('POST', '/admin/products')[0]!.body).toMatchObject({ purchase_cost: 100, custom_markup_percent: 50, mrp: 180 });
  });

  it('refuses a bad MRP without calling the API', async () => {
    const user = userEvent.setup();
    const calls = api(SAMBA);
    renderAt('/products/p1');
    const field = await screen.findByLabelText(/^MRP \(LKR\)/);
    await user.clear(field);
    await user.type(field, '0');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Enter an MRP above 0/)).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('an existing capped product shows its note; the offer must be under the MRP; mrp is sent only when changed', async () => {
    const user = userEvent.setup();
    const calls = api(SAMBA);
    renderAt('/products/p1');
    const field = await screen.findByLabelText(/^MRP \(LKR\)/);
    expect(field).toHaveValue('240');
    expect(within(pricing()).getByText('Capped at MRP (markup would give LKR 250.00)')).toBeInTheDocument();

    // An offer at the MRP is refused before saving.
    await user.type(screen.getByLabelText(/^Offer price \(LKR\)/), '245');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/The offer price must be lower than the selling price \(LKR 240(\.00)?, capped at the MRP\)\./)).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(0);

    // A valid offer: the MRP did not change, so it is not sent.
    await user.clear(screen.getByLabelText(/^Offer price \(LKR\)/));
    await user.type(screen.getByLabelText(/^Offer price \(LKR\)/), '230');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    const body = calls.find('PATCH', '/admin/products/p1')[0]!.body;
    expect(body).toMatchObject({ offer_price: 230 });
    expect(body).not.toHaveProperty('mrp');
  });

  it('clearing the MRP sends mrp: null', async () => {
    const user = userEvent.setup();
    const calls = api(SAMBA);
    renderAt('/products/p1');
    await user.clear(await screen.findByLabelText(/^MRP \(LKR\)/));
    expect(within(pricing()).getByText('Selling price LKR 250.00 (from category \'Rice\' 25%)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/products/p1')[0]!.body).toMatchObject({ mrp: null });
  });

  it('a size: MRP field, capped preview, and mrp in the POST', async () => {
    const user = userEvent.setup();
    const calls = api({ ...SAMBA, mrp: null, mrp_capped: false, calculated_selling_price: 250, selling_price: 250 }, (c) =>
      c.method === 'POST' && c.path === '/admin/products/p1/variants'
        ? {
            status: 201,
            data: {
              variant: {
                id: 'v1', product_id: 'p1', label: '5 kg', sku: null, barcode: null, sort_order: 0, is_active: true, is_available: true,
                purchase_cost: 1000, pricing_mode: 'MARKUP', fixed_selling_price: null, custom_markup_percent: null,
                effective_markup_percent: 25, pricing_source: 'CATEGORY_MARKUP', selling_price: 1200, computed_selling_price: 1250,
                mrp: 1200, mrp_capped: true, offer_price: null, offer_ends_at: null, offer_active: false, stock: { ...UNTRACKED },
              },
            },
          }
        : undefined
    );
    renderAt('/products/p1');
    const variants = await screen.findByRole('region', { name: 'Variants' });
    await user.click(within(variants).getByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    await user.type(within(dialog).getByLabelText(/^Variant name/), '5 kg');
    await user.type(within(dialog).getByLabelText(/^Cost price \(LKR\)/), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Markup' })); // a new size starts on Fixed price
    await user.type(within(dialog).getByLabelText(/^MRP \(LKR\)/), '1200');
    expect(within(dialog).getByText('Selling price LKR 1,200.00 (the MRP)')).toBeInTheDocument();
    expect(within(dialog).getByText('Capped at MRP (markup would give LKR 1,250.00)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(calls.find('POST', '/admin/products/p1/variants')).toHaveLength(1));
    expect(calls.find('POST', '/admin/products/p1/variants')[0]!.body).toMatchObject({ label: '5 kg', purchase_cost: 1000, mrp: 1200 });
    const row = await within(variants).findByRole('row', { name: 'Variant 5 kg' });
    expect(row).toHaveTextContent('Capped at MRP (markup would give LKR 1,250.00)');
    expect(row).toHaveTextContent('LKR 1,200.00');
  });
});

describe('products list and import', () => {
  it('the list shows the MRP column and the capped note', async () => {
    api(SAMBA, (c) =>
      c.method === 'GET' && c.path === '/admin/products'
        ? ok({ products: [SAMBA, { ...SAMBA, id: 'p2', name: 'Kekulu Rice', sku: 'KEK', mrp: null, mrp_capped: false, computed_selling_price: 250 }], pagination: { page: 1, limit: 50 } })
        : undefined
    );
    renderAt('/products');
    expect(await screen.findByRole('columnheader', { name: 'MRP' })).toBeInTheDocument();
    const samba = screen.getByText('Samba Rice 1kg').closest('tr')!;
    expect(samba).toHaveTextContent('Capped at MRP (markup would give LKR 250.00)');
    expect(samba).toHaveTextContent('LKR 240.00');
    const kekulu = screen.getByText('Kekulu Rice').closest('tr')!;
    expect(kekulu).not.toHaveTextContent('Capped at MRP');
  });

  it('the template and rules have the mrp column; a bad mrp cell is a row error', () => {
    expect(TEMPLATE_COLUMNS).toContain('mrp');
    expect(PRICING_RULES.some((r) => r.startsWith('mrp (optional)'))).toBe(true);
    const base = { name: 'Rice', category: 'Rice', unit: '1 kg', purchase_cost: 100, sku: 'R-1' };
    expect(validateRow({ ...base, mrp: '120' }, 2).data.mrp).toBe(120);
    expect(validateRow({ ...base, mrp: '' }, 2).data).not.toHaveProperty('mrp');
    expect(validateRow({ ...base, mrp: '0' }, 2).errors).toEqual([{ field: 'mrp', message: 'MRP must be above 0.' }]);
  });
});
