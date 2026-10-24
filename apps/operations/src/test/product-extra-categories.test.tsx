import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category } from '../api/types';
import { parseSheet } from '../lib/productImport';
import { extraCategoriesReady, extraCategoryChoices, sameSet, withoutPrimary } from '../lib/extraCategories';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/**
 * "Also show in" on the Ops product form (migration 060; owner, 2026-10-25): a product has one main
 * category and up to 5 extra ones that only decide where it is listed. The field is hidden until
 * GET /admin/categories reports extra_product_count as a number (the migration has run).
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category =>
  ({ id, name, slug: id, description: null, image_url: null, display_order: 0, is_active: true, parent_id: null, extra_product_count: 0, ...extra }) as Category;
const CATEGORIES: Category[] = [
  cat('rice', 'Rice & Flour', { display_order: 1 }),
  cat('basmati', 'Rice', { parent_id: 'rice' }),
  cat('ready', 'Ready to Eat', { display_order: 2 }),
  cat('drinks', 'Drinks', { display_order: 3 }),
  cat('off', 'Hidden', { is_active: false, display_order: 4 }),
];
const KOTTU = {
  id: 'p1', category_id: 'rice', category_name: 'Rice & Flour', name: 'Kottu', slug: 'kottu', sku: 'KOTTU-1', barcode: null,
  unit: '1 pc', pack_size: null, description: null, image_url: null, purchase_cost: 100, pricing_mode: 'MARKUP',
  fixed_selling_price: null, custom_markup_percent: null, category_markup_percent: 25, parent_category_markup_percent: null,
  global_markup_percent: 20, effective_markup_percent: 25, pricing_source: 'CATEGORY_MARKUP', calculated_selling_price: 125,
  selling_price: 125, computed_selling_price: 125, mrp: null, mrp_capped: false, price_warning: null, is_available: true, is_active: true,
  extra_categories_ready: true, extra_category_ids: ['ready'], extra_categories: [{ id: 'ready', name: 'Ready to Eat', path: 'Ready to Eat' }],
} as AdminProduct;

function renderForm(path: string, categories: Category[]) {
  return renderAs(ADMIN_WITH_RIDER, path, {
    'GET /admin/settings/availability-windows': () => ok({ windows: [], updated_at: null }),
    'GET /admin/categories': () => ok({ categories }),
    'GET /admin/products/:id': () => ok({ product: KOTTU }),
    'PATCH /admin/products/:id': (c) => ok({ product: { ...KOTTU, ...c.body } }),
    'POST /admin/products': (c) => ({ status: 201, data: { product: { ...KOTTU, ...c.body, id: 'new1' } } }),
    'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
  });
}

describe('Ops extra categories: the picker rules', () => {
  it('offers active categories with their paths, never the main one or one already chosen', () => {
    expect(extraCategoryChoices(CATEGORIES, 'rice', ['ready']).map((c) => c.label)).toEqual(['Rice & Flour › Rice', 'Drinks']);
    expect(extraCategoryChoices(CATEGORIES, 'drinks', []).map((c) => c.id)).toEqual(['rice', 'basmati', 'ready']);
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

describe('Ops product form: Also show in', () => {
  it('shows the saved extra categories on edit and sends nothing for them when unchanged', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', CATEGORIES);
    const list = await screen.findByRole('list', { name: 'Also shown in' });
    expect(within(list).getByText('Ready to Eat')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0]!.body).not.toHaveProperty('extra_category_ids');
  });

  it('adds and removes categories; a changed set is sent whole', async () => {
    const user = userEvent.setup();
    const { api } = renderForm('/catalog/products/p1', CATEGORIES);
    await screen.findByRole('list', { name: 'Also shown in' });
    await user.selectOptions(screen.getByLabelText('Add a category to also show in'), 'drinks');
    await user.click(screen.getByRole('button', { name: 'Remove Ready to Eat' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0]!.body.extra_category_ids).toEqual(['drinks']);
  });

  it('five is the most, and changing the main category to an extra one removes it from the extras', async () => {
    const user = userEvent.setup();
    const many = [...CATEGORIES, cat('c6', 'Six', { display_order: 6 }), cat('c7', 'Seven', { display_order: 7 })];
    const { api } = renderForm('/catalog/products/p1', many);
    await screen.findByRole('list', { name: 'Also shown in' });
    for (const id of ['basmati', 'drinks', 'c6', 'c7']) await user.selectOptions(screen.getByLabelText('Add a category to also show in'), id);
    expect(screen.getByLabelText('Add a category to also show in')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Category'), 'ready');
    // ready is no longer an extra; four are left, so there is room again
    expect(screen.queryByRole('button', { name: 'Remove Ready to Eat' })).toBeNull();
    expect(screen.getByLabelText('Add a category to also show in')).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/products/p1')[0]!.body;
    expect(body.category_id).toBe('ready');
    expect(body.extra_category_ids).toEqual(['basmati', 'drinks', 'c6', 'c7']);
  });

  it('is hidden before migration 060 (the API reports no counts)', async () => {
    renderForm('/catalog/products/p1', CATEGORIES.map((c) => ({ ...c, extra_product_count: null })));
    await screen.findByLabelText('Category');
    expect(screen.queryByText('Also show in')).toBeNull();
    expect(screen.queryByLabelText('Add a category to also show in')).toBeNull();
  });
});

describe('Ops product import: the optional "Extra categories" column', () => {
  const header = ['name', 'category', 'unit', 'purchase_cost', 'sku', 'Extra categories'];

  it('is read (not ignored), under its common spellings, and sent as the cell says', () => {
    const parsed = parseSheet([header, ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1', ' Ready to Eat ; Drinks ']]);
    expect(parsed.ignoredColumns).toEqual([]);
    expect(parsed.rows[0]!.errors).toEqual([]);
    expect(parsed.rows[0]!.data.extra_categories).toBe('Ready to Eat ; Drinks');
    const alias = parseSheet([[...header.slice(0, 5), 'extra_category'], ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1', 'Drinks']]);
    expect(alias.rows[0]!.data.extra_categories).toBe('Drinks');
  });

  it('a blank cell, or a file without the column, sends nothing for it', () => {
    const blank = parseSheet([header, ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1', '']]);
    expect(blank.rows[0]!.data).not.toHaveProperty('extra_categories');
    const without = parseSheet([header.slice(0, 5), ['Kottu', 'Rice', '1 pc', 100, 'KOTTU-1']]);
    expect(without.rows[0]!.data).not.toHaveProperty('extra_categories');
  });
});
