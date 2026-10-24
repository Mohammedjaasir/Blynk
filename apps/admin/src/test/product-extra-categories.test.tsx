import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { rowsFromMatrix } from '../lib/productImport';
import { extraCategoriesReady, extraCategoryChoices, sameSet, withoutPrimary } from '../lib/extraCategories';
import type { Category } from '../api/types';
import { mockApi, ok } from './mockApi';

/**
 * "Also show in" on the product form (migration 060; owner, 2026-10-25): a product has one main
 * category and up to 5 extra ones that only decide where it is listed. The field is hidden until
 * GET /admin/categories reports extra_product_count as a number (the migration has run).
 */
vi.setConfig({ testTimeout: 30_000 });

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category =>
  ({ id, name, slug: id, description: null, image_url: null, display_order: 0, is_active: true, product_count: 0, parent_id: null, extra_product_count: 0, ...extra }) as Category;
const CATEGORIES: Category[] = [
  cat('rice', 'Rice & Flour'),
  cat('basmati', 'Rice', { parent_id: 'rice' }),
  cat('ready', 'Ready to Eat'),
  cat('drinks', 'Drinks'),
  cat('off', 'Hidden', { is_active: false }),
];
const UNTRACKED = {
  inventory_id: null, tracked: false, on_hand: 0, reserved: 0, in_open_orders: 0, sellable: null,
  low_stock_threshold: 5, is_low_stock: false, is_out_of_stock: false,
};
const KOTTU = {
  id: 'p1', category_id: 'rice', category_name: 'Rice & Flour', name: 'Kottu', slug: 'kottu', sku: 'KOTTU-1', barcode: null,
  unit: '1 pc', pack_size: null, description: null, image_url: null, purchase_cost: 100, pricing_mode: 'MARKUP',
  fixed_selling_price: null, custom_markup_percent: null, category_markup_percent: 25, parent_category_markup_percent: null,
  global_markup_percent: 20, effective_markup_percent: 25, pricing_source: 'CATEGORY_MARKUP', calculated_selling_price: 125,
  selling_price: 125, computed_selling_price: 125, mrp: null, mrp_capped: false, price_warning: null, offer_price: null,
  offer_ends_at: null, offer_active: false, is_available: true, is_active: true, delivery_lead_days: 0, has_variants: false,
  variant_count: 0, stock: { ...UNTRACKED }, variants: [] as unknown[],
  extra_categories_ready: true, extra_category_ids: ['ready'], extra_categories: [{ id: 'ready', name: 'Ready to Eat', path: 'Ready to Eat' }],
};

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function api(categories: Category[]) {
  tokenStore.save('access', 'refresh');
  return mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/settings/availability-windows') return ok({ windows: [], updated_at: null });
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories });
    if (c.method === 'GET' && c.path === '/admin/settings/default-markup') return ok({ markup_percent: 20, updated_at: null, products_using: 0 });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product: KOTTU });
    if (c.method === 'PATCH' && c.path === '/admin/products/p1') return ok({ product: { ...KOTTU, ...c.body } });
    if (c.method === 'POST' && c.path === '/admin/products') return ok({ product: { ...KOTTU, ...c.body, id: 'new1' } });
    return undefined;
  });
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

describe('extra categories: the picker rules', () => {
  it('offers active categories with their paths, never the main one or one already chosen', () => {
    const labels = extraCategoryChoices(CATEGORIES, 'rice', ['ready']).map((c) => c.label);
    expect(labels).toEqual(['Drinks', 'Rice & Flour › Rice']);
    expect(extraCategoryChoices(CATEGORIES, 'drinks', []).map((c) => c.id)).toEqual(['ready', 'rice', 'basmati']);
  });

  it('is ready only when the API reports a count on every category', () => {
    expect(extraCategoriesReady(CATEGORIES)).toBe(true);
    expect(extraCategoriesReady(CATEGORIES.map((c) => ({ ...c, extra_product_count: null })))).toBe(false);
    expect(extraCategoriesReady(CATEGORIES.map(({ extra_product_count: _n, ...c }) => c as Category))).toBe(false);
    expect(extraCategoriesReady([])).toBe(false);
  });

  it('drops the new main category from the set and compares sets without order', () => {
    expect(withoutPrimary(['ready', 'drinks'], 'drinks')).toEqual(['ready']);
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('product form: Also show in', () => {
  it('shows the saved extra categories on edit and sends nothing for them when unchanged', async () => {
    const user = userEvent.setup();
    const calls = api(CATEGORIES);
    renderAt('/products/p1');
    const list = await screen.findByRole('list', { name: 'Also shown in' });
    expect(within(list).getByText('Ready to Eat')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/products/p1')[0]!.body).not.toHaveProperty('extra_category_ids');
  });

  it('adds and removes categories; a changed set is sent whole', async () => {
    const user = userEvent.setup();
    const calls = api(CATEGORIES);
    renderAt('/products/p1');
    await screen.findByRole('list', { name: 'Also shown in' });
    await user.selectOptions(screen.getByLabelText('Add a category to also show in'), 'drinks');
    await user.click(screen.getByRole('button', { name: 'Remove Ready to Eat' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/products/p1')[0]!.body.extra_category_ids).toEqual(['drinks']);
  });

  it('a new product sends the chosen set; the main category is not offered; five is the most', async () => {
    const user = userEvent.setup();
    const many = [...CATEGORIES, cat('c6', 'Six'), cat('c7', 'Seven'), cat('c8', 'Eight')];
    const calls = api(many);
    renderAt('/products/new');
    const add = await screen.findByLabelText('Add a category to also show in');
    // the default main category is the first one (Drinks, A-Z), so it is not in the list
    expect(within(add).queryByRole('option', { name: 'Drinks' })).toBeNull();
    for (const id of ['basmati', 'ready', 'rice', 'c6', 'c7']) await user.selectOptions(screen.getByLabelText('Add a category to also show in'), id);
    expect(screen.getByLabelText('Add a category to also show in')).toBeDisabled();
    await user.type(screen.getByLabelText('Product name'), 'Kottu Roti');
    await user.type(screen.getByLabelText('SKU'), 'KOTTU-NEW');
    await user.type(screen.getByLabelText(/^Unit/), '1 pc');
    await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), '100');
    await user.click(screen.getByRole('button', { name: 'Markup' })); // new products start on Fixed price
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(calls.find('POST', '/admin/products')).toHaveLength(1));
    expect(calls.find('POST', '/admin/products')[0]!.body.extra_category_ids).toEqual(['basmati', 'ready', 'rice', 'c6', 'c7']);
  });

  it('changing the main category to an extra one removes it from the extras', async () => {
    const user = userEvent.setup();
    const calls = api(CATEGORIES);
    renderAt('/products/p1');
    await screen.findByRole('list', { name: 'Also shown in' });
    await user.selectOptions(screen.getByLabelText('Category'), 'ready');
    expect(screen.queryByRole('list', { name: 'Also shown in' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    const body = calls.find('PATCH', '/admin/products/p1')[0]!.body;
    expect(body.category_id).toBe('ready');
    expect(body.extra_category_ids).toEqual([]);
  });

  it('is hidden before migration 060 (the API reports no counts)', async () => {
    api(CATEGORIES.map((c) => ({ ...c, extra_product_count: null })));
    renderAt('/products/p1');
    await screen.findByLabelText('Category');
    expect(screen.queryByText('Also show in')).toBeNull();
    expect(screen.queryByLabelText('Add a category to also show in')).toBeNull();
  });
});

describe('product import: the optional "Extra categories" column', () => {
  const header = ['name', 'category', 'unit', 'purchase_cost', 'sku', 'Extra categories'];

  it('is read from the file even though it is not in the template, and sent as the cell says', () => {
    const parsed = rowsFromMatrix([header, ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1', ' Ready to Eat ; Drinks ']]);
    expect(parsed.fileError).toBeNull();
    expect(parsed.rows[0]!.errors).toEqual([]);
    expect(parsed.rows[0]!.data.extra_categories).toBe('Ready to Eat ; Drinks');
  });

  it('a blank cell, or a file without the column, sends nothing for it (the server leaves them as they are)', () => {
    const blank = rowsFromMatrix([header, ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1', '']]);
    expect(blank.rows[0]!.data).not.toHaveProperty('extra_categories');
    const without = rowsFromMatrix([header.slice(0, 5), ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1']]);
    expect(without.rows[0]!.data).not.toHaveProperty('extra_categories');
  });
});
