import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { Category, CategoryImportResult, Promotion } from '../api/types';
import { categoryOptions, describePromotionTarget } from '../lib/catalog';
import { OWNER_CATEGORY_SETUP, parseCategorySheet } from '../lib/categoryImport';
import { parseSheet } from '../lib/productImport';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Catalog tools (2026-10-14, docs/api/catalog-tools.md): category import,
 * sub-categories in the product form and the product import, promotion
 * banner targets, and the "Show doctor channelling to customers" switch.
 * All as the OPERATIONS role (Ops may do every one of these).
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function category(overrides: Partial<Category> & Pick<Category, 'id' | 'name'>): Category {
  return {
    slug: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: null,
    image_url: null,
    display_order: 10,
    is_active: true,
    parent_id: null,
    ...overrides,
  };
}

const RICE_FLOUR = category({ id: 'c-rf', name: 'Rice & Flour', slug: 'rice-flour', display_order: 10 });
const RICE = category({ id: 'c-rice', name: 'Rice', slug: 'rice', parent_id: 'c-rf', display_order: 20 });
const FLOUR = category({ id: 'c-flour', name: 'Flour', slug: 'flour', parent_id: 'c-rf', display_order: 10 });
const SNACKS = category({ id: 'c-sn', name: 'Biscuits', slug: 'biscuits', display_order: 5 });
const CATEGORIES = [RICE, RICE_FLOUR, FLOUR, SNACKS];

// ------------------------------------------------------------ category import
function importResult(dryRun: boolean, overrides: Partial<CategoryImportResult> = {}): CategoryImportResult {
  return {
    dry_run: dryRun,
    summary: {
      mains: { create: 1, update: 0, keep: 0 },
      categories: { create: 0, update: 1, keep: 0 },
      sub_categories: { create: 1, update: 0, keep: 1 },
      others_reordered: 3,
    },
    tree: [
      {
        name: 'Grocery',
        id: null,
        action: 'create',
        changes: [],
        active: true,
        warnings: [],
        source: 2,
        sort_order: 0,
        categories: [
          {
            name: 'Rice & Flour',
            id: 'c-rf',
            action: 'update',
            changes: ['Moves to Grocery'],
            active: true,
            warnings: [],
            source: 3,
            display_order: 10,
            sub_categories: [
              { name: 'Rice', id: 'c-rice', action: 'keep', changes: [], active: true, warnings: [], source: 3, display_order: 10 },
              { name: 'Books & Pens', id: null, action: 'create', changes: [], active: false, warnings: ['Check the spelling'], source: 3, display_order: 20 },
            ],
          },
        ],
      },
    ],
    warnings: ['5 existing categories are not in this list.'],
    errors: [],
    ignored_lines: [{ line: 1, message: 'BLYNK – CATEGORY SETUP (Ops → Catalog)' }],
    ...overrides,
  };
}

describe('Import categories', () => {
  it('opens from Categories with the owner list pre-filled, previews the tree, then applies', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/category-groups': () => ok({ groups: [], unassigned: [] }),
      'GET /admin/settings/default-markup': () => ok({ markup_percent: 20 }),
      'GET /admin/categories/import/template': () =>
        ok({ text: '1. GROCERY\n- Rice & Flour → Rice', columns: ['main', 'category', 'sub_category', 'active'] }),
      'POST /admin/categories/import': (call) => ok(importResult(call.body.dry_run)),
    });

    await user.click(await screen.findByRole('link', { name: 'Import categories' }));
    const textarea = (await screen.findByRole('textbox', { name: 'Category list' })) as HTMLTextAreaElement;
    expect(textarea.value).toBe('1. GROCERY\n- Rice & Flour → Rice');
    expect(screen.getByText(/products are not touched/)).toBeInTheDocument();

    // Apply waits for a preview.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(api.find('POST', '/admin/categories/import')).toHaveLength(1));
    expect(api.find('POST', '/admin/categories/import')[0].body).toEqual({
      text: '1. GROCERY\n- Rice & Flour → Rice',
      dry_run: true,
    });
    const tree = await screen.findByRole('list', { name: 'Category tree' });
    expect(within(tree).getByText('Grocery')).toBeInTheDocument();
    expect(within(tree).getByText('Rice & Flour')).toBeInTheDocument();
    expect(within(tree).getByText('Moves to Grocery')).toBeInTheDocument();
    expect(within(tree).getAllByText('New')).toHaveLength(2);
    expect(within(tree).getByText('Update')).toBeInTheDocument();
    expect(within(tree).getByText('Keep')).toBeInTheDocument();
    expect(within(tree).getByText('Off (hidden)')).toBeInTheDocument();
    expect(within(tree).getByText('Warning: Check the spelling')).toBeInTheDocument();
    expect(screen.getByText('Main sections: 1 new · 0 update · 0 keep')).toBeInTheDocument();
    expect(screen.getByText('Warning: 5 existing categories are not in this list.')).toBeInTheDocument();
    expect(screen.getByText('Line 1: BLYNK – CATEGORY SETUP (Ops → Catalog)')).toBeInTheDocument();

    // Editing the text after the preview needs a new preview.
    fireEvent.change(textarea, { target: { value: '1. GROCERY\n- Rice & Flour → Rice | Flour' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories/import')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories/import')).toHaveLength(3));
    expect(api.find('POST', '/admin/categories/import')[2].body).toEqual({
      text: '1. GROCERY\n- Rice & Flour → Rice | Flour',
      dry_run: false,
    });
    expect(await screen.findByText('Categories imported.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Back to categories' }));
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeInTheDocument();
  });

  it('shows errors with line numbers and keeps Apply off', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories/import', {
      'GET /admin/categories/import/template': () => ok({ text: '- Rice', columns: [] }),
      'POST /admin/categories/import': () =>
        ok(importResult(true, { tree: [], errors: [{ line: 4, message: 'A category comes before any main category' }] })),
    });
    await screen.findByRole('textbox', { name: 'Category list' });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Line 4: A category comes before any main category')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(api.find('POST', '/admin/categories/import')).toHaveLength(1);
  });

  it('falls back to the saved owner list when the template cannot be loaded', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/categories/import', {
      'GET /admin/categories/import/template': () => fail(500, 'INTERNAL_SERVER_ERROR'),
    });
    const textarea = (await screen.findByRole('textbox', { name: 'Category list' })) as HTMLTextAreaElement;
    expect(textarea.value).toBe(OWNER_CATEGORY_SETUP);
    expect(textarea.value).toContain('- Rice & Flour → Rice | Flour | Dhal & Grams');
  });

  it('turns a sheet into rows carrying their sheet row number, skipping blank rows', () => {
    const parsed = parseCategorySheet([
      ['Main', 'Category', 'Sub-category', 'Active'],
      ['Grocery', 'Rice & Flour', 'Rice', 'yes'],
      [null, null, null, null],
      ['Grocery', 'Rice & Flour', 'Flour', false],
    ]);
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows).toEqual([
      { row: 2, Main: 'Grocery', Category: 'Rice & Flour', 'Sub-category': 'Rice', Active: 'yes' },
      { row: 4, Main: 'Grocery', Category: 'Rice & Flour', 'Sub-category': 'Flour', Active: 'no' },
    ]);
    expect(parseCategorySheet([]).fileErrors).toHaveLength(1);
  });
});

// ------------------------------------------------- product form sub-categories
describe('Product form category picker', () => {
  it('lists each category followed by its sub-categories as "Category › Sub-category", in arrange order', () => {
    expect(categoryOptions(CATEGORIES).map((o) => o.label)).toEqual([
      'Biscuits',
      'Rice & Flour',
      'Rice & Flour › Flour',
      'Rice & Flour › Rice',
    ]);
  });

  it('offers sub-categories in the select and saves the chosen one', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/settings/default-markup': () => ok({ markup_percent: 20 }),
    });
    await screen.findByText('Add product');
    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(5));
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Select a category',
      'Biscuits',
      'Rice & Flour',
      'Rice & Flour › Flour',
      'Rice & Flour › Rice',
    ]);
    await user.selectOptions(select, 'c-rice');
    expect(select.value).toBe('c-rice');
  });

  it('product import sends a sub_category column as sub_category', () => {
    const sheet = parseSheet([
      ['name', 'category', 'Sub Category', 'unit', 'purchase_cost', 'sku'],
      ['Samba 5kg', 'Rice & Flour', 'Rice', '5 kg', 1000, 'RICE-5'],
    ]);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.ignoredColumns).toEqual([]);
    expect(sheet.rows[0].data).toMatchObject({ category: 'Rice & Flour', sub_category: 'Rice' });
  });
});

// ------------------------------------------------------- promotion targets
function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 'pr1',
    title: 'Rice week',
    subtitle: null,
    image_url: null,
    background_type: 'SOLID',
    background_color: '#FFE141',
    background_color_end: null,
    background_image_url: null,
    cta_label: 'Shop',
    cta_destination_type: null,
    cta_destination_value: null,
    cta_target: null,
    display_order: 1,
    is_active: true,
    ...overrides,
  };
}

const GROUPS = {
  groups: [{ id: 'g-grocery', name: 'Grocery', sort_order: 0, is_active: true, categories: [] }],
  unassigned: [],
};

function promotionsApi(extra: Record<string, (call: any) => unknown> = {}) {
  return renderAs(OPERATIONS_STAFF, '/catalog/promotions', {
    'GET /admin/promotions': () => ok({ promotions: [] }),
    'GET /admin/categories': () => ok({ categories: CATEGORIES }),
    'GET /admin/category-groups': () => ok(GROUPS),
    'GET /promotions': () => ok({ promotions: [] }),
    'POST /admin/promotions': () => ok({ promotion: promotion() }),
    ...extra,
  });
}

async function openNewPromotion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
  // A solid card, so no artwork upload is needed to save.
  await user.click(dialog.getByRole('button', { name: 'Solid' }));
  await user.type(dialog.getByLabelText(/^Headline/), 'Rice week');
  await user.type(dialog.getByLabelText(/^Button label/), 'Shop');
  return dialog;
}

describe('Promotion targets', () => {
  it('a sub-category is sent as CATEGORY + its slug', async () => {
    const user = userEvent.setup();
    const { api } = promotionsApi();
    const dialog = await openNewPromotion(user);
    await user.selectOptions(dialog.getByLabelText(/^Button goes to/), 'CATEGORY');
    const picker = dialog.getByLabelText(/^Category or sub-category/) as HTMLSelectElement;
    expect(within(picker).getByRole('option', { name: 'Rice & Flour › Rice' })).toBeInTheDocument();
    await user.selectOptions(picker, 'rice');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/promotions')).toHaveLength(1));
    expect(api.find('POST', '/admin/promotions')[0].body).toMatchObject({
      cta_destination_type: 'CATEGORY',
      cta_destination_value: 'rice',
    });
  });

  it('a main section is sent as CATALOG + the group id', async () => {
    const user = userEvent.setup();
    const { api } = promotionsApi();
    const dialog = await openNewPromotion(user);
    await user.selectOptions(dialog.getByLabelText(/^Button goes to/), 'MAIN');
    await user.selectOptions(dialog.getByLabelText(/^Main section/), 'g-grocery');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/promotions')).toHaveLength(1));
    expect(api.find('POST', '/admin/promotions')[0].body).toMatchObject({
      cta_destination_type: 'CATALOG',
      cta_destination_value: 'g-grocery',
    });
  });

  it('a product is searched and sent as PRODUCT + its id', async () => {
    const user = userEvent.setup();
    const { api } = promotionsApi({
      'GET /admin/products': () =>
        ok({ products: [{ id: 'p-samba', name: 'Samba 5kg', unit: '5 kg', sku: 'RICE-5', is_active: true }], pagination: {} }),
    });
    const dialog = await openNewPromotion(user);
    await user.selectOptions(dialog.getByLabelText(/^Button goes to/), 'PRODUCT');
    await user.type(dialog.getByLabelText(/^Find the product/), 'samba');
    await user.click(await dialog.findByRole('button', { name: 'Choose Samba 5kg' }));
    expect(dialog.getByText('Samba 5kg')).toBeInTheDocument();
    expect(api.find('GET', '/admin/products').at(-1)?.query.search).toBe('samba');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/promotions')).toHaveLength(1));
    expect(api.find('POST', '/admin/promotions')[0].body).toMatchObject({
      cta_destination_type: 'PRODUCT',
      cta_destination_value: 'p-samba',
    });
  });

  it("shows the server's INVALID_PROMOTION_TARGET message", async () => {
    const user = userEvent.setup();
    promotionsApi({
      'POST /admin/promotions': () =>
        fail(400, 'INVALID_PROMOTION_TARGET', "No category 'rice'. Choose a category or sub-category from the list."),
    });
    const dialog = await openNewPromotion(user);
    await user.selectOptions(dialog.getByLabelText(/^Button goes to/), 'CATEGORY');
    await user.selectOptions(dialog.getByLabelText(/^Category or sub-category/), 'rice');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText("No category 'rice'. Choose a category or sub-category from the list.")
    ).toBeInTheDocument();
  });

  it('the list shows the resolved target', async () => {
    promotionsApi({
      'GET /admin/promotions': () =>
        ok({
          promotions: [
            promotion({
              id: 'a',
              title: 'Rice banner',
              cta_destination_type: 'CATEGORY',
              cta_destination_value: 'rice',
              cta_target: {
                level: 'SUB_CATEGORY', id: 'c-rice', slug: 'rice', name: 'Rice',
                parent_id: 'c-rf', parent_slug: 'rice-flour', parent_name: 'Rice & Flour', is_active: true,
              },
            }),
            promotion({ id: 'b', title: 'Gone banner', cta_destination_type: 'PRODUCT', cta_destination_value: 'x', cta_target: null }),
          ],
        }),
    });
    expect(await screen.findByText('Shop → Sub-category: Rice & Flour › Rice')).toBeInTheDocument();
    expect(screen.getByText('Shop → Target missing')).toBeInTheDocument();
  });

  it('describes every target level', () => {
    const base = { parent_id: null, parent_slug: null, parent_name: null, slug: null };
    expect(
      describePromotionTarget({
        cta_destination_type: 'CATALOG',
        cta_destination_value: 'g',
        cta_target: { ...base, level: 'MAIN', id: 'g', name: 'Grocery', is_active: true },
      })
    ).toBe('Main: Grocery');
    expect(
      describePromotionTarget({
        cta_destination_type: 'CATALOG',
        cta_destination_value: null,
        cta_target: { ...base, level: 'CATALOG', id: null, name: null, is_active: null },
      })
    ).toBe('all products');
    expect(
      describePromotionTarget({
        cta_destination_type: 'PRODUCT',
        cta_destination_value: 'p',
        cta_target: { ...base, level: 'PRODUCT', id: 'p', name: 'Samba', is_active: false },
      })
    ).toBe('Product: Samba (off)');
  });
});

// ------------------------------------------------------- doctors on/off
describe('Show doctor channelling to customers', () => {
  it('PATCHes show_to_customers only, with its explanation', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/dental', {
      'GET /admin/dental/clinics': () => ok({ clinics: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
      'GET /admin/settings/doctors-access': () => ok({ require_sign_in: true, show_to_customers: true, updated_at: null }),
      'PATCH /admin/settings/doctors-access': (call) =>
        ok({ require_sign_in: true, show_to_customers: call.body.show_to_customers, updated_at: '2026-10-14T08:00:00.000Z' }),
    });
    const toggle = await screen.findByRole('checkbox', { name: /Show doctor channelling to customers/ });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/existing|already made/i)).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/doctors-access')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/doctors-access')[0].body).toEqual({ show_to_customers: false });
    expect(await screen.findByText('Saved. Doctor channelling is hidden from customers.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Show doctor channelling to customers/ })).not.toBeChecked();
    // The sign-in switch is untouched.
    expect(screen.getByRole('checkbox', { name: /Doctors need sign-in/ })).toBeChecked();
  });
});
