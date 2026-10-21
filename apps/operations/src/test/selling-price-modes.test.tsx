import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category } from '../api/types';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Selling-price modes + category markup (migration 044; owner, 2026-10-13):
 * the product form's Markup | Fixed price switch with its live preview, the
 * pricing source in the Products list, the category Markup % and the global
 * default markup setting (More).
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function category(overrides: Partial<Category> & { id: string; name: string }): Category {
  return {
    slug: overrides.name.toLowerCase(),
    description: null,
    image_url: null,
    display_order: 1,
    is_active: true,
    parent_id: null,
    markup_percent: null,
    ...overrides,
  };
}

const GROCERY = category({ id: 'grocery', name: 'Grocery', markup_percent: 15, markup_product_count: 4 });
const RICE = category({ id: 'rice', name: 'Rice', parent_id: 'grocery', markup_percent: 25, markup_product_count: 12 });
const FLOUR = category({ id: 'flour', name: 'Flour', parent_id: 'grocery', markup_percent: null, markup_product_count: 3 });
const SOAP = category({ id: 'soap', name: 'Soap', markup_percent: null, markup_product_count: 7 });
const CATEGORIES = [GROCERY, RICE, FLOUR, SOAP];

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
    purchase_cost: 100,
    pricing_mode: 'MARKUP',
    fixed_selling_price: null,
    custom_markup_percent: null,
    category_markup_percent: 25,
    parent_category_markup_percent: 15,
    global_markup_percent: 18,
    effective_markup_percent: 25,
    pricing_source: 'CATEGORY_MARKUP',
    calculated_selling_price: 125,
    selling_price: 125,
    price_warning: null,
    is_available: true,
    is_active: true,
    ...overrides,
  };
}

const DEFAULT_MARKUP = { markup_percent: 18, updated_at: null, products_using: 42 };

async function fillNewProduct(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Add product');
  await user.type(screen.getByLabelText('Product name'), 'Samba Rice');
  await user.type(screen.getByLabelText('SKU'), 'RICE-1');
  await user.type(screen.getByLabelText(/^Unit/), '1 kg');
  await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), '100');
  await user.click(screen.getByRole('radio', { name: 'Markup' })); // new products and sizes start on Fixed price
}

describe('Product form - selling price mode', () => {
  it('Markup mode previews the price live from the category, parent, product and global markup', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/settings/default-markup': () => ok(DEFAULT_MARKUP),
      'POST /admin/products': () => ok({ product: product() }),
      'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
    });
    await fillNewProduct(user);
    await user.selectOptions(screen.getByLabelText('Category'), 'rice');

    const markupRadio = screen.getByRole('radio', { name: 'Markup' });
    expect(markupRadio).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Fixed price' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radiogroup', { name: 'Selling price' })).toBeInTheDocument();

    // Category markup.
    expect(await screen.findByText("Selling price LKR 125.00 (from category 'Rice' 25%)")).toBeInTheDocument();
    expect(screen.getByText('Leave blank to use the category markup (Rice 25%)')).toBeInTheDocument();

    // Product markup.
    const custom = screen.getByLabelText(/^Custom markup %/);
    await user.type(custom, '30');
    expect(screen.getByText('Selling price LKR 130.00 (product markup 30%)')).toBeInTheDocument();
    await user.clear(custom);

    // Parent category markup (Flour has none, Grocery has 15%).
    await user.selectOptions(screen.getByLabelText('Category'), 'flour');
    expect(screen.getByText("Selling price LKR 115.00 (from parent category 'Grocery' 15%)")).toBeInTheDocument();
    expect(screen.getByText('Leave blank to use the parent category markup (Grocery 15%), as Flour has none')).toBeInTheDocument();

    // Global default markup (from the setting).
    await user.selectOptions(screen.getByLabelText('Category'), 'soap');
    expect(screen.getByText('Selling price LKR 118.00 (global markup 18%)')).toBeInTheDocument();
    expect(screen.getByText('Leave blank to use the global markup (18%), as Soap has no markup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(api.find('POST', '/admin/products')).toHaveLength(1));
    const body = api.find('POST', '/admin/products')[0]!.body;
    expect(body).toMatchObject({ category_id: 'soap', purchase_cost: 100, pricing_mode: 'MARKUP', custom_markup_percent: null });
    expect(body).not.toHaveProperty('fixed_selling_price');
  }, 60_000);

  it('falls back to 20% when the global markup cannot be read', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [SOAP] }),
    });
    await fillNewProduct(user);
    expect(await screen.findByText('Selling price LKR 120.00 (global markup 20%)')).toBeInTheDocument();
  });

  it('Fixed price mode shows the % over cost, warns below cost but still saves, and sends only the fixed price', async () => {
    const user = userEvent.setup();
    const saved = product({
      pricing_mode: 'FIXED',
      fixed_selling_price: 90,
      pricing_source: 'FIXED',
      calculated_selling_price: 90,
      price_warning: { code: 'SELLING_BELOW_COST', message: 'The selling price LKR 90.00 is below the purchase cost LKR 100.00.' },
    });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/settings/default-markup': () => ok(DEFAULT_MARKUP),
      'POST /admin/products': () => ok({ product: saved }),
      'GET /admin/products': () => ok({ products: [saved], pagination: { page: 1, limit: 200 } }),
    });
    await fillNewProduct(user);
    await user.type(screen.getByLabelText(/^Custom markup %/), '40');

    await user.click(screen.getByRole('radio', { name: 'Fixed price' }));
    expect(screen.getByRole('radio', { name: 'Fixed price' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText(/^Custom markup %/)).not.toBeInTheDocument();
    const price = screen.getByLabelText(/^Selling price \(LKR\)/);
    await user.type(price, '150');
    expect(screen.getByText('50% over cost')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.clear(price);
    await user.type(price, '90');
    expect(screen.getByText('-10% over cost')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Below purchase cost — you lose LKR 10.00 per unit. You can still save it.');

    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(api.find('POST', '/admin/products')).toHaveLength(1));
    const body = api.find('POST', '/admin/products')[0]!.body;
    expect(body).toMatchObject({ pricing_mode: 'FIXED', fixed_selling_price: 90, purchase_cost: 100 });
    expect(body).not.toHaveProperty('custom_markup_percent');

    // Back on the list, the server's below-cost warning is shown.
    expect(
      await screen.findByText(/Samba Rice saved\. The selling price LKR 90\.00 is below the purchase cost LKR 100\.00\./)
    ).toBeInTheDocument();
  });

  it('Fixed price mode needs a price above 0 before saving', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
    });
    await fillNewProduct(user);
    await user.click(screen.getByRole('radio', { name: 'Fixed price' }));
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Enter the selling price.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/products')).toHaveLength(0);
  });

  it('opens a FIXED product in Fixed price mode and measures an offer against that price', async () => {
    const user = userEvent.setup();
    const existing = product({ pricing_mode: 'FIXED', fixed_selling_price: 140, custom_markup_percent: 30, pricing_source: 'FIXED', calculated_selling_price: 140 });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/products/:id': () => ok({ product: existing }),
      'PATCH /admin/products/:id': () => ok({ product: existing }),
    });
    expect(await screen.findByLabelText(/^Selling price \(LKR\)/)).toHaveValue('140');
    expect(screen.getByRole('radio', { name: 'Fixed price' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('40% over cost')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Offer price \(LKR\)/), '140');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The offer price must be lower than the selling price (LKR 140.00).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);

    // Back to Markup: the stored product markup (30%) comes back.
    await user.click(screen.getByRole('radio', { name: 'Markup' }));
    expect(screen.getByLabelText(/^Custom markup %/)).toHaveValue('30');
    expect(screen.getByText('Selling price LKR 130.00 (product markup 30%)')).toBeInTheDocument();
  });
});

describe('Products list - selling price source', () => {
  it('shows the selling price and where it comes from', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/products': () =>
        ok({
          products: [
            product({ id: 'a', name: 'Samba Rice' }),
            product({ id: 'b', name: 'Promo Soap', pricing_mode: 'FIXED', pricing_source: 'FIXED', calculated_selling_price: 90, effective_markup_percent: -10, price_warning: { code: 'SELLING_BELOW_COST', message: 'x' } }),
            product({ id: 'c', name: 'Atta', pricing_source: 'GLOBAL_MARKUP', effective_markup_percent: 18, calculated_selling_price: 118 }),
          ],
          pagination: { page: 1, limit: 200 },
        }),
    });
    const rice = (await screen.findByText('Samba Rice')).closest('li') as HTMLElement;
    expect(within(rice).getByText('LKR 125.00')).toBeInTheDocument();
    expect(within(rice).getByText('Category markup')).toBeInTheDocument();
    expect(within(rice).getByText('25% over cost LKR 100.00')).toBeInTheDocument();
    const soap = screen.getByText('Promo Soap').closest('li') as HTMLElement;
    expect(within(soap).getByText('LKR 90.00')).toBeInTheDocument();
    expect(within(soap).getByText('Fixed')).toBeInTheDocument();
    expect(within(soap).getByText('Below cost')).toBeInTheDocument();
    const atta = screen.getByText('Atta').closest('li') as HTMLElement;
    expect(within(atta).getByText('Global markup')).toBeInTheDocument();
  });
});

describe('Categories - markup %', () => {
  function openCategories(handlers = {}) {
    return renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/settings/default-markup': () => ok({ ...DEFAULT_MARKUP, markup_percent: 20 }),
      'PATCH /admin/categories/:id': (call) => ok({ category: { ...RICE, ...call.body } }),
      'POST /admin/categories': (call) => ok({ category: { ...SOAP, id: 'new', ...call.body } }),
      ...handlers,
    });
  }

  it('lists each category markup, where an inherited one comes from, and how many products follow it', async () => {
    openCategories();
    const row = async (name: string) => (await screen.findByText(name, { selector: '.cat-row__title' })).closest('li') as HTMLElement;
    const rice = await row('Rice');
    expect(within(rice).getByText('Markup 25%')).toBeInTheDocument();
    expect(within(rice).getByText('12 products use this markup')).toBeInTheDocument();
    const flour = await row('Flour');
    expect(within(flour).getByText('Markup: parent Grocery 15%')).toBeInTheDocument();
    expect(within(flour).getByText('3 products follow the parent/global markup')).toBeInTheDocument();
    const soap = await row('Soap');
    expect(await within(soap).findByText('Markup: global 20%')).toBeInTheDocument();
  });

  it('edits the markup (with the product-count note) and sends null when cleared', async () => {
    const user = userEvent.setup();
    const { api } = openCategories();
    const rice = (await screen.findByText('Rice', { selector: '.cat-row__title' })).closest('li') as HTMLElement;
    await user.click(within(rice).getByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    const field = dialog.getByLabelText(/^Markup %/);
    expect(field).toHaveValue('25');
    expect(dialog.getByText(/^12 products use this markup\./)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '30');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/rice')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/categories/rice')[0]!.body).toMatchObject({ markup_percent: 30 });

    const riceAgain = (await screen.findByText('Rice', { selector: '.cat-row__title' })).closest('li') as HTMLElement;
    await user.click(within(riceAgain).getByRole('button', { name: 'Edit' }));
    const dialog2 = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.clear(dialog2.getByLabelText(/^Markup %/));
    await user.click(dialog2.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/rice')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/categories/rice')[1]!.body).toHaveProperty('markup_percent', null);
  });

  it('refuses a markup over 999.99 without calling the API; a new category sends null by default', async () => {
    const user = userEvent.setup();
    const { api } = openCategories();
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Frozen');
    await user.type(dialog.getByLabelText(/^Markup %/), '1000');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('Markup can be at most 999.99%.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/categories')).toHaveLength(0);

    await user.clear(dialog.getByLabelText(/^Markup %/));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories')).toHaveLength(1));
    expect(api.find('POST', '/admin/categories')[0]!.body).toMatchObject({ name: 'Frozen', markup_percent: null });
  });
});

describe('More - Global default markup', () => {
  for (const [who, user] of [
    ['ADMIN', ADMIN_WITH_RIDER],
    ['OPERATIONS', OPERATIONS_STAFF],
  ] as const) {
    it(`shows and saves the global default markup (${who})`, async () => {
      const u = userEvent.setup();
      const { api } = renderAs(user, '/more', {
        'GET /admin/settings/default-markup': () => ok({ markup_percent: 20, updated_at: null, products_using: 42 }),
        'PATCH /admin/settings/default-markup': (call) =>
          ok({ markup_percent: call.body.markup_percent, updated_at: '2026-10-13T05:00:00.000Z', products_using: 42 }),
      });
      const card = within((await screen.findByRole('heading', { name: 'Global default markup' })).closest('section') as HTMLElement);
      const input = await card.findByLabelText('Global default markup %');
      expect(input).toHaveValue('20');
      expect(card.getByText(/Used by products with no markup of their own and none on their category\./)).toBeInTheDocument();
      expect(card.getByText(/42 products use it\./)).toBeInTheDocument();

      await u.clear(input);
      await u.type(input, '1000');
      await u.click(card.getByRole('button', { name: 'Save' }));
      expect(await card.findByText('Markup can be at most 999.99%.')).toBeInTheDocument();
      expect(api.find('PATCH', '/admin/settings/default-markup')).toHaveLength(0);

      await u.clear(input);
      await u.type(input, '22.5');
      await u.click(card.getByRole('button', { name: 'Save' }));
      expect(await card.findByText('Global default markup saved: 22.5%.')).toBeInTheDocument();
      expect(api.find('PATCH', '/admin/settings/default-markup')[0]!.body).toEqual({ markup_percent: 22.5 });
    });
  }
});
