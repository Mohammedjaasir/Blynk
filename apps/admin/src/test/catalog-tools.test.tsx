import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../auth/AuthContext';
import { tokenStore } from '../api/client';
import { CategoryImport } from '../pages/CategoryImport';
import { Categories } from '../pages/Categories';
import { Promotions, describeDestination } from '../pages/Promotions';
import { Products } from '../pages/Products';
import { ProductForm } from '../pages/ProductForm';
import { DentalDoctors } from '../pages/DentalDoctors';
import { OWNER_CATEGORY_SETUP, categoryRowsFromMatrix } from '../lib/categoryImport';
import { categoryOptions } from '../lib/categoryTree';
import { validateRow, rowsFromMatrix } from '../lib/productImport';
import type { Category, Promotion } from '../api/types';
import { fail, mockApi, ok, type Call } from './mockApi';

/**
 * Catalog tools (owner, 2026-10-14; docs/api/catalog-tools.md): import
 * categories, sub-categories in the product form and import, promotion
 * targets at every level, doctor channelling on/off and "Remove all product
 * images". The API contract is tested in the backend suite.
 */

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  description: null,
  image_url: null,
  display_order: 0,
  is_active: true,
  parent_id: null,
  ...extra,
});

// Rice & Flour (order 10) with Rice and Flour; Spices (order 20); Snacks (order 5) with its own "Rice" (crackers).
const CATEGORIES: Category[] = [
  cat('c-spices', 'Spices', { display_order: 20 }),
  cat('c-flour', 'Flour', { parent_id: 'c-rf', display_order: 20 }),
  cat('c-rf', 'Rice & Flour', { display_order: 10 }),
  cat('c-rice', 'Rice', { parent_id: 'c-rf', display_order: 10 }),
  cat('c-snacks', 'Snacks', { display_order: 5 }),
  cat('c-rice-snack', 'Rice Crackers', { parent_id: 'c-snacks', display_order: 10, is_active: false }),
];

// --------------------------------------------------------- category import
describe('Import categories', () => {
  const node = (name: string, action: 'create' | 'update' | 'keep', extra: Record<string, unknown> = {}) => ({
    name,
    id: action === 'create' ? null : `id-${name}`,
    action,
    changes: [],
    active: true,
    warnings: [],
    source: 2,
    ...extra,
  });
  const previewResult = (dryRun: boolean) => ({
    dry_run: dryRun,
    summary: {
      mains: { create: 1, update: 0, keep: 0 },
      categories: { create: 1, update: 1, keep: 0 },
      sub_categories: { create: 2, update: 0, keep: 0 },
      others_reordered: 3,
    },
    tree: [
      {
        ...node('Grocery', 'create'),
        sort_order: 0,
        categories: [
          {
            ...node('Rice & Flour', 'update', { changes: ['moves to Grocery'], warnings: ['Name differs in case'] }),
            display_order: 10,
            sub_categories: [
              { ...node('Rice', 'create'), display_order: 10 },
              { ...node('Flour', 'create'), display_order: 20 },
            ],
          },
          { ...node('Books & Pens', 'create', { active: false }), display_order: 20, sub_categories: [] },
        ],
      },
    ],
    warnings: ['5 existing categories are not in this list.'],
    errors: [],
    ignored_lines: [{ line: 1, message: 'BLYNK – CATEGORY SETUP (Ops → Catalog)' }],
  });

  function renderImport(handler: (c: Call) => ReturnType<typeof ok> | undefined) {
    const api = mockApi(handler);
    render(
      <MemoryRouter initialEntries={['/categories/import']}>
        <ToastProvider>
          <Routes>
            <Route path="/categories/import" element={<CategoryImport />} />
            <Route path="/categories" element={<p>Categories page</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    );
    return api;
  }

  it('keeps the local owner list identical to the backend OWNER_CATEGORY_SETUP', () => {
    const file = path.resolve(__dirname, '../../../../backend/api/src/modules/catalog/catalog.category-import.ts');
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const match = source.match(/export const OWNER_CATEGORY_SETUP = `([\s\S]*?)`;/);
    expect(match).not.toBeNull();
    expect(OWNER_CATEGORY_SETUP).toBe(match![1]);
  });

  it('is linked from the Categories page', async () => {
    mockApi((c) => {
      if (c.path === '/admin/categories') return ok({ categories: [] });
      if (c.path === '/admin/category-groups') return ok({ groups: [], unassigned: [] });
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Categories />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'Import categories' })).toHaveAttribute('href', '/categories/import');
  });

  it('pre-fills the owner list, previews the tree and applies it once the preview is clean', async () => {
    const user = userEvent.setup();
    const api = renderImport((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories/import/template')
        return ok({ text: '1. GROCERY\n- Rice & Flour → Rice | Flour', columns: ['main', 'category', 'sub_category', 'active'] });
      if (c.method === 'POST' && c.path === '/admin/categories/import') return ok(previewResult(c.body.dry_run));
      return undefined;
    });

    const textarea = (await screen.findByRole('textbox', { name: /^Category list/ })) as HTMLTextAreaElement;
    expect(textarea.value).toBe('1. GROCERY\n- Rice & Flour → Rice | Flour');
    // Helper text explains the levels.
    expect(screen.getByText(/a home section \(category group\)/)).toBeInTheDocument();
    expect(screen.getByText(/the sidebar inside the category/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is deleted and\s+products are not touched/)).toBeInTheDocument();

    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories/import')).toHaveLength(1));
    expect(api.find('POST', '/admin/categories/import')[0]!.body).toEqual({
      text: '1. GROCERY\n- Rice & Flour → Rice | Flour',
      dry_run: true,
    });

    const tree = await screen.findByRole('list', { name: 'Category tree' });
    expect(within(tree).getByText('Grocery')).toBeInTheDocument();
    expect(within(tree).getAllByText('New')).toHaveLength(4);
    expect(within(tree).getByText('Update')).toBeInTheDocument();
    expect(within(tree).getByText('moves to Grocery')).toBeInTheDocument();
    expect(within(tree).getByText('Name differs in case')).toBeInTheDocument();
    expect(within(tree).getByText('Off (hidden)')).toBeInTheDocument();
    expect(screen.getByText(/Categories: 1 new, 1 updated, 0 unchanged/)).toBeInTheDocument();
    expect(screen.getByText('5 existing categories are not in this list.')).toBeInTheDocument();
    expect(screen.getByText('Line 1: BLYNK – CATEGORY SETUP (Ops → Catalog)')).toBeInTheDocument();

    // Editing after the preview disables Apply until a new preview.
    await user.type(textarea, '\n- Spices');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByText(/The list changed since the preview/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories/import')).toHaveLength(3));
    expect(api.find('POST', '/admin/categories/import')[2]!.body).toEqual({
      text: '1. GROCERY\n- Rice & Flour → Rice | Flour\n- Spices',
      dry_run: false,
    });
    expect(await screen.findByRole('heading', { name: 'Categories imported' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('link', { name: 'Back to categories' })[0]!);
    expect(await screen.findByText('Categories page')).toBeInTheDocument();
  });

  it('falls back to the local owner list and blocks Apply while the preview has errors', async () => {
    const user = userEvent.setup();
    renderImport((c) => {
      if (c.path === '/admin/categories/import/template') return fail(500, 'INTERNAL_SERVER_ERROR', 'Boom');
      if (c.method === 'POST' && c.path === '/admin/categories/import')
        return ok({
          ...previewResult(true),
          tree: [],
          errors: [{ line: 4, message: 'A category comes before any main category' }],
        });
      return undefined;
    });
    const textarea = (await screen.findByRole('textbox', { name: /^Category list/ })) as HTMLTextAreaElement;
    expect(textarea.value).toBe(OWNER_CATEGORY_SETUP);
    expect(screen.getByText(/saved copy of the owner list/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Line 4: A category comes before any main category')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('turns a sheet into rows with their sheet row numbers', () => {
    const parsed = categoryRowsFromMatrix([
      ['Main', 'Category', 'Sub category', 'Active'],
      ['Grocery', 'Rice & Flour', 'Rice', 'yes'],
      ['', '', '', ''],
      ['Household', 'Books & Pens', '', 'no'],
    ]);
    expect(parsed.fileError).toBeNull();
    expect(parsed.rows).toEqual([
      { row: 2, Main: 'Grocery', Category: 'Rice & Flour', 'Sub category': 'Rice', Active: 'yes' },
      { row: 4, Main: 'Household', Category: 'Books & Pens', 'Sub category': '', Active: 'no' },
    ]);
    expect(categoryRowsFromMatrix([['name', 'unit']]).fileError).toMatch(/main and category/);
  });
});

// ------------------------------------------------- product form / import
describe('Sub-categories in the product form and the product import', () => {
  it('lists each category followed by its sub-categories as "Category › Sub-category"', () => {
    expect(categoryOptions(CATEGORIES).map((o) => o.label)).toEqual([
      'Snacks',
      'Snacks › Rice Crackers',
      'Rice & Flour',
      'Rice & Flour › Rice',
      'Rice & Flour › Flour',
      'Spices',
    ]);
  });

  it('the product form offers the sub-categories under their parent', async () => {
    mockApi((c) => {
      if (c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.path === '/admin/settings/default-markup') return ok({ markup_percent: 20, updated_at: null, products_using: 0 });
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/products/new']}>
        <ToastProvider>
          <Routes>
            <Route path="/products/new" element={<ProductForm />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    );
    const select = await screen.findByRole('combobox', { name: 'Category' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(7));
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual([
      'Select a category',
      'Snacks',
      'Snacks › Rice Crackers (inactive)',
      'Rice & Flour',
      'Rice & Flour › Rice',
      'Rice & Flour › Flour',
      'Spices',
    ]);
    expect(within(select).getByRole('option', { name: 'Rice & Flour › Rice' })).toHaveValue('c-rice');
  });

  it('passes a sub_category column through to the API', () => {
    const parsed = rowsFromMatrix([
      ['name', 'category', 'Sub-category', 'unit', 'purchase_cost', 'sku'],
      ['Samba 5kg', 'Rice & Flour', 'Rice', '5 kg', 1000, 'SAMBA-5'],
      ['Atta 1kg', 'Rice & Flour > Flour', '', '1 kg', 300, 'ATTA-1'],
    ]);
    expect(parsed.fileError).toBeNull();
    expect(parsed.rows[0]!.data).toMatchObject({ category: 'Rice & Flour', sub_category: 'Rice', row: 2 });
    expect(parsed.rows[1]!.data.category).toBe('Rice & Flour > Flour');
    expect(parsed.rows[1]!.data).not.toHaveProperty('sub_category');
    expect(validateRow({ name: 'X1', category: 'A', sub_category: 'B', unit: 'u', purchase_cost: 1, sku: 's' }, 2).data.sub_category).toBe('B');
  });
});

// ------------------------------------------------------- promotion targets
describe('Promotion targets', () => {
  const GROUPS = [
    { id: 'g-grocery', name: 'Grocery', sort_order: 0, is_active: true, created_at: '', updated_at: '', categories: [] },
    { id: 'g-snacks', name: 'Snacks', sort_order: 1, is_active: false, created_at: '', updated_at: '', categories: [] },
  ];
  const base: Promotion = {
    id: 'p1',
    title: 'Rice week',
    subtitle: null,
    image_url: null,
    background_type: 'SOLID',
    background_color: '#FFD60A',
    background_color_end: null,
    background_image_url: null,
    cta_label: 'Shop',
    cta_destination_type: 'CATEGORY',
    cta_destination_value: 'rice',
    cta_target: {
      level: 'SUB_CATEGORY',
      id: 'c-rice',
      slug: 'rice',
      name: 'Rice',
      parent_id: 'c-rf',
      parent_slug: 'rice-flour',
      parent_name: 'Rice & Flour',
      is_active: true,
    },
    display_order: 1,
    is_active: true,
  };

  function renderPromotions(promotions: Promotion[], extra?: (c: Call) => ReturnType<typeof ok> | undefined) {
    const api = mockApi((c) => {
      const handled = extra?.(c);
      if (handled) return handled;
      if (c.method === 'GET' && c.path === '/admin/promotions') return ok({ promotions });
      if (c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.path === '/admin/category-groups') return ok({ groups: GROUPS, unassigned: [] });
      if (c.method === 'POST' && c.path === '/admin/promotions') return ok({ promotion: { ...base, id: 'p9' } });
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Promotions />
        </ToastProvider>
      </MemoryRouter>
    );
    return api;
  }

  it('describes the resolved target in the list', async () => {
    renderPromotions([
      base,
      {
        ...base,
        id: 'p2',
        title: 'Grocery days',
        cta_destination_type: 'CATALOG',
        cta_destination_value: 'g-grocery',
        cta_target: { ...base.cta_target!, level: 'MAIN', id: 'g-grocery', name: 'Grocery', slug: null, parent_name: null },
      },
      { ...base, id: 'p3', title: 'Gone', cta_target: null },
    ]);
    expect(await screen.findByText('Shop → Sub-category: Rice & Flour › Rice')).toBeInTheDocument();
    expect(screen.getByText('Shop → Main: Grocery')).toBeInTheDocument();
    expect(screen.getByText('Shop → Target missing')).toBeInTheDocument();
    expect(describeDestination({ ...base, cta_destination_type: 'CATALOG', cta_target: { ...base.cta_target!, level: 'CATALOG' } })).toBe(
      'Whole catalog'
    );
  });

  async function openNew(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion' });
    await user.type(within(dialog).getByRole('textbox', { name: /Headline/ }), 'Rice week');
    await user.type(within(dialog).getByRole('textbox', { name: /Button label/ }), 'Shop');
    // New promotions start as artwork; a solid background needs no upload.
    await user.click(within(dialog).getByRole('button', { name: /^Solid/ }));
    return dialog;
  }

  it('sends CATEGORY + the slug for a sub-category', async () => {
    const user = userEvent.setup();
    const api = renderPromotions([]);
    const dialog = await openNew(user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Button goes to' }), 'CATEGORY');
    const picker = within(dialog).getByRole('combobox', { name: /^Category or sub-category/ });
    expect(within(picker).getByRole('option', { name: 'Rice & Flour › Rice' })).toBeInTheDocument();
    await user.selectOptions(picker, 'rice');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/promotions')).toHaveLength(1));
    expect(api.find('POST', '/admin/promotions')[0]!.body).toMatchObject({
      cta_destination_type: 'CATEGORY',
      cta_destination_value: 'rice',
    });
  });

  it('sends CATALOG + the group id for a main section, and CATALOG + null for the whole catalog', async () => {
    const user = userEvent.setup();
    const api = renderPromotions([]);
    let dialog = await openNew(user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Button goes to' }), 'MAIN');
    const picker = within(dialog).getByRole('combobox', { name: /Main section/ });
    expect(within(picker).getByRole('option', { name: 'Snacks (hidden)' })).toBeInTheDocument();
    await user.selectOptions(picker, 'Grocery');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/promotions')).toHaveLength(1));
    expect(api.find('POST', '/admin/promotions')[0]!.body).toMatchObject({
      cta_destination_type: 'CATALOG',
      cta_destination_value: 'g-grocery',
    });

    dialog = await openNew(user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Button goes to' }), 'ALL');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/promotions')).toHaveLength(2));
    expect(api.find('POST', '/admin/promotions')[1]!.body).toMatchObject({
      cta_destination_type: 'CATALOG',
      cta_destination_value: null,
    });
  });

  it('picks a product by search and shows the server refusal for a missing target', async () => {
    const user = userEvent.setup();
    const api = renderPromotions([], (c) => {
      if (c.method === 'GET' && c.path === '/admin/products')
        return ok({ products: [{ id: 'prod-1', name: 'Samba Rice 5kg', category_name: 'Rice', is_active: true }] });
      if (c.method === 'POST' && c.path === '/admin/promotions')
        return fail(400, 'INVALID_PROMOTION_TARGET', "No product 'prod-1'. Choose a product from the list.");
      return undefined;
    });
    const dialog = await openNew(user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Button goes to' }), 'PRODUCT');
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search products' }), 'samba');
    await user.click(await within(dialog).findByRole('button', { name: /Samba Rice 5kg/ }));
    expect(within(dialog).getByText('Selected: Samba Rice 5kg')).toBeInTheDocument();
    expect(api.find('GET', '/admin/products').at(-1)!.query.get('search')).toBe('samba');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText("No product 'prod-1'. Choose a product from the list.")).toBeInTheDocument();
    expect(api.find('POST', '/admin/promotions')[0]!.body).toMatchObject({
      cta_destination_type: 'PRODUCT',
      cta_destination_value: 'prod-1',
    });
  });
});

// ------------------------------------------------------- doctors on / off
describe('Show doctor channelling to customers', () => {
  it('PATCHes show_to_customers and explains what off means', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/doctors-access') {
        if (c.method === 'GET') return ok({ require_sign_in: true, show_to_customers: true, updated_at: null });
        if (c.method === 'PATCH') return ok({ require_sign_in: true, show_to_customers: c.body.show_to_customers, updated_at: null });
      }
      if (c.path === '/admin/dental/doctors') return ok({ doctors: [] });
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <DentalDoctors />
        </ToastProvider>
      </MemoryRouter>
    );
    const toggle = await screen.findByRole('switch', { name: 'Show doctor channelling to customers' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/customers don't see doctors and can't book/)).toBeInTheDocument();
    expect(screen.getByText(/Existing bookings stay visible and cancellable/)).toBeInTheDocument();
    expect(screen.getByText(/Staff dental pages are not affected/)).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/doctors-access')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/doctors-access')[0]!.body).toEqual({ show_to_customers: false });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Show doctor channelling to customers' })).toHaveAttribute('aria-checked', 'false')
    );
    expect(await screen.findByText('Saved. Doctor channelling is hidden from customers.')).toBeInTheDocument();
    // The sign-in switch is untouched.
    expect(screen.getByRole('checkbox', { name: /Doctors need sign-in/ })).toBeChecked();
  });
});

// ------------------------------------------------- remove all product images
describe('Remove all product images', () => {
  function renderProducts(role: 'ADMIN' | 'OPERATIONS', handler?: (c: Call) => ReturnType<typeof ok> | undefined) {
    let products = [{ id: 'p1', name: 'Milk', category_id: 'c-rf', image_url: '/media/products/a.webp', is_active: true, sku: 'M1' }];
    const api = mockApi((c) => {
      const handled = handler?.(c);
      if (handled) return handled;
      if (c.path === '/auth/me') return ok({ id: 'u1', phone: null, full_name: 'Owner', email: 'o@blynk.lk', role });
      if (c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.method === 'GET' && c.path === '/admin/products') return ok({ products });
      if (c.method === 'GET' && c.path === '/admin/products/remove-images/preview')
        return ok({ products: 12, combos: 2, files: 10, files_on_disk: 9, external_links: 1 });
      if (c.method === 'POST' && c.path === '/admin/products/remove-images') {
        products = products.map((p) => ({ ...p, image_url: null as unknown as string }));
        return ok({ products_cleared: 12, combos_cleared: 2, files_deleted: 8, files_missing: 1, files_kept_in_use: 1 });
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <Products />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    return api;
  }

  it('is hidden for anyone but ADMIN', async () => {
    const api = renderProducts('OPERATIONS');
    await waitFor(() => expect(api.find('GET', '/auth/me')).toHaveLength(1));
    await screen.findByText('Milk');
    expect(screen.queryByRole('button', { name: 'Remove all product images' })).toBeNull();
  });

  it('needs REMOVE typed exactly, then clears the images and re-reads the list', async () => {
    const user = userEvent.setup();
    const api = renderProducts('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Remove all product images' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove all product images' });
    expect(
      await within(dialog).findByText(/12 products, 2 combo packs and 10 uploaded files \(9 on disk\) will be affected/)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Category, promotion and doctor images are not touched\. This cannot be undone\./)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Remove all images' });
    const input = within(dialog).getByRole('textbox', { name: 'Type REMOVE to confirm' });
    expect(confirm).toBeDisabled();
    await user.type(input, 'remove');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'REMOVE');
    expect(confirm).toBeEnabled();

    const listReads = api.find('GET', '/admin/products').length;
    await user.click(confirm);
    await waitFor(() => expect(api.find('POST', '/admin/products/remove-images')).toHaveLength(1));
    expect(api.find('POST', '/admin/products/remove-images')[0]!.body).toEqual({ confirm: 'REMOVE' });
    expect(await within(dialog).findByText(/Images removed from 12 products and 2 combo packs/)).toBeInTheDocument();
    expect(within(dialog).getByText('8 files deleted')).toBeInTheDocument();
    expect(within(dialog).getByText('1 file already missing')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 file kept/)).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/products').length).toBeGreaterThan(listReads));
  });
});
