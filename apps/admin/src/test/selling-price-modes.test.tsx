import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { Products } from '../pages/Products';
import { Categories } from '../pages/Categories';
import { ProductImport } from '../pages/ProductImport';
import { DefaultMarkupPanel } from '../pages/Settings';
import { PRICING_RULES, TEMPLATE_COLUMNS } from '../lib/productImport';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Selling-price modes + category markup (migration 044; owner, 2026-10-13):
 * the product form's Markup | Fixed price switch with its live preview, the
 * list's price source badge, the category Markup %, the global default
 * markup setting and the import's pricing columns. The server is the
 * authority; these check what the screens send and show.
 */
const cat = (id: string, name: string, parent_id: string | null, markup_percent: number | null, markup_product_count = 0) => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  image_url: null,
  display_order: 0,
  is_active: true,
  product_count: markup_product_count,
  parent_id,
  markup_percent,
  markup_product_count,
});
const CATEGORIES = [
  cat('grocery', 'Grocery', null, 15, 4),
  cat('rice', 'Rice', 'grocery', 25, 3),
  cat('snacks', 'Snacks', 'grocery', null, 2),
  cat('household', 'Household', null, null, 1),
];
const DEFAULT_MARKUP = { markup_percent: 20, updated_at: null, products_using: 12 };

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
  pricing_mode: 'MARKUP' as 'MARKUP' | 'FIXED',
  fixed_selling_price: null as number | null,
  custom_markup_percent: null as number | null,
  category_markup_percent: 25,
  parent_category_markup_percent: 15,
  global_markup_percent: 20,
  effective_markup_percent: 25 as number | null,
  pricing_source: 'CATEGORY_MARKUP',
  calculated_selling_price: 250,
  selling_price: 250,
  price_warning: null as null | { code: string; message: string },
  offer_price: null,
  offer_ends_at: null,
  offer_active: false,
  is_available: true,
  is_active: true,
};

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function api(extra: (c: Call) => Reply | undefined = () => undefined, defaultMarkup: Reply = ok(DEFAULT_MARKUP)) {
  tokenStore.save('access', 'refresh');
  return mockApi((c) => {
    const reply = extra(c);
    if (reply) return reply;
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    if (c.method === 'GET' && c.path === '/admin/settings/default-markup') return defaultMarkup;
    return undefined;
  });
}

function renderForm(path = '/products/new') {
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

async function fillNewProduct(user: ReturnType<typeof userEvent.setup>, categoryId: string, cost: string) {
  await user.type(await screen.findByLabelText('Product name'), 'Test product');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Grocery › Rice' })).toBeInTheDocument());
  await user.selectOptions(screen.getByLabelText('Category'), categoryId);
  await user.type(screen.getByLabelText('SKU'), 'TEST-1');
  await user.type(screen.getByLabelText(/^Unit/), '1 kg');
  if (cost) await user.type(screen.getByLabelText(/^Cost price \(LKR\)/), cost);
  // New products start on Fixed price (owner, 2026-10-21); these flows test Markup.
  await user.click(screen.getByRole('button', { name: 'Markup' }));
}

const pricing = () => screen.getByRole('region', { name: 'Pricing' });

describe('product form: Markup | Fixed price', () => {
  it('previews the category, parent category and global markup live as the category changes', async () => {
    const user = userEvent.setup();
    api();
    renderForm();
    await fillNewProduct(user, 'rice', '100');
    expect(screen.getByRole('button', { name: 'Markup' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fixed price' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(pricing()).getByText("Selling price LKR 125.00 (from category 'Rice' 25%)")).toBeInTheDocument();
    expect(within(pricing()).getByText('0 to 999.99. Leave blank to use the category markup (Rice 25%)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Category'), 'snacks');
    expect(within(pricing()).getByText("Selling price LKR 115.00 (from parent category 'Grocery' 15%)")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Category'), 'household');
    expect(within(pricing()).getByText('Selling price LKR 120.00 (global markup 20%)')).toBeInTheDocument();
    expect(
      within(pricing()).getByText(
        '0 to 999.99. Leave blank to use the category markup, or the global markup (20%) as Household has none'
      )
    ).toBeInTheDocument();
  });

  it('uses the global default markup setting, and 20% when it cannot be read', async () => {
    const user = userEvent.setup();
    api(undefined, ok({ ...DEFAULT_MARKUP, markup_percent: 30 }));
    const view = renderForm();
    await fillNewProduct(user, 'household', '100');
    expect(await within(pricing()).findByText('Selling price LKR 130.00 (global markup 30%)')).toBeInTheDocument();
    view.unmount();
    vi.unstubAllGlobals();

    api(undefined, fail(500, 'INTERNAL_SERVER_ERROR'));
    renderForm();
    await fillNewProduct(user, 'household', '100');
    expect(within(pricing()).getByText('Selling price LKR 120.00 (global markup 20%)')).toBeInTheDocument();
  });

  it('a product markup wins; Markup mode sends pricing_mode MARKUP + custom_markup_percent, no fixed price', async () => {
    const user = userEvent.setup();
    const calls = api((c) => (c.method === 'POST' && c.path === '/admin/products' ? ok({ product: { ...SAMBA, ...c.body } }) : undefined));
    renderForm();
    await fillNewProduct(user, 'rice', '100');
    await user.type(screen.getByLabelText(/Custom markup %/), '30');
    expect(within(pricing()).getByText('Selling price LKR 130.00 (product markup 30%)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    const body = calls.find('POST', '/admin/products')[0]!.body;
    expect(body).toMatchObject({ category_id: 'rice', purchase_cost: 100, pricing_mode: 'MARKUP', custom_markup_percent: 30 });
    expect(body).not.toHaveProperty('fixed_selling_price');
  });

  it('a blank markup sends custom_markup_percent: null (inherit)', async () => {
    const user = userEvent.setup();
    const calls = api((c) => (c.method === 'POST' && c.path === '/admin/products' ? ok({ product: SAMBA }) : undefined));
    renderForm();
    await fillNewProduct(user, 'rice', '100');
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    await screen.findByText('Product list');
    expect(calls.find('POST', '/admin/products')[0]!.body).toMatchObject({ pricing_mode: 'MARKUP', custom_markup_percent: null });
  });

  it('Fixed price: starts from the current price, shows the margin, warns below cost but still saves (and shows the server warning)', async () => {
    const user = userEvent.setup();
    const warning = { code: 'SELLING_BELOW_COST', message: 'The selling price LKR 90.00 is below the purchase cost LKR 100.00.' };
    const calls = api((c) =>
      c.method === 'POST' && c.path === '/admin/products' ? ok({ product: { ...SAMBA, price_warning: warning } }) : undefined
    );
    renderForm();
    await fillNewProduct(user, 'rice', '100');
    await user.click(screen.getByRole('button', { name: 'Fixed price' }));
    expect(screen.getByRole('button', { name: 'Fixed price' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText(/Custom markup %/)).toBeNull();
    const price = screen.getByLabelText(/Selling price \(LKR\)/);
    expect(price).toHaveValue('125');
    expect(within(pricing()).getByText('Selling price LKR 125.00 (25% over cost)')).toBeInTheDocument();

    await user.clear(price);
    await user.type(price, '110');
    expect(within(pricing()).getByText('Selling price LKR 110.00 (10% over cost)')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(price);
    await user.type(price, '90');
    expect(within(pricing()).getByText('Selling price LKR 90.00 (10% below cost)')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Below purchase cost — you lose LKR 10.00 per unit');

    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    const body = calls.find('POST', '/admin/products')[0]!.body;
    expect(body).toMatchObject({ pricing_mode: 'FIXED', fixed_selling_price: 90 });
    expect(body).not.toHaveProperty('custom_markup_percent');
    expect(await screen.findByText(`Saved with a warning: ${warning.message}`)).toBeInTheDocument();
  });

  it('Fixed price needs a valid price before sending', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderForm();
    await fillNewProduct(user, 'rice', '');
    await user.click(screen.getByRole('button', { name: 'Fixed price' }));
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Enter the selling price for a fixed-price product')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Selling price \(LKR\)/), '12.345');
    await user.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByText('Enter a price above 0 with at most 2 decimals')).toBeInTheDocument();
    expect(calls.find('POST', '/admin/products')).toHaveLength(0);
  });

  it('a FIXED product opens in Fixed price mode with its server price; the offer check uses the previewed price', async () => {
    const user = userEvent.setup();
    const product = {
      ...SAMBA,
      pricing_mode: 'FIXED' as const,
      fixed_selling_price: 300,
      custom_markup_percent: 10,
      effective_markup_percent: 50,
      pricing_source: 'FIXED',
      calculated_selling_price: 300,
      selling_price: 300,
    };
    const calls = api((c) => {
      if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product });
      if (c.method === 'PATCH' && c.path === '/admin/products/p1') return ok({ product });
      return undefined;
    });
    renderForm('/products/p1');
    expect(await screen.findByLabelText(/Selling price \(LKR\)/)).toHaveValue('300');
    expect(screen.getByRole('button', { name: 'Fixed price' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(pricing()).getByText('Selling price LKR 300.00 (50% over cost)')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Selling price \(LKR\)/));
    await user.type(screen.getByLabelText(/Selling price \(LKR\)/), '150');
    await user.type(screen.getByLabelText(/Offer price \(LKR\)/), '160');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The offer price must be lower than the selling price (LKR 150).')).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/products/p1')).toHaveLength(0);

    // Back to Markup: the stored custom markup comes back (10% of 200).
    await user.click(screen.getByRole('button', { name: 'Markup' }));
    expect(screen.getByLabelText(/Custom markup %/)).toHaveValue('10');
    expect(within(pricing()).getByText('Selling price LKR 220.00 (product markup 10%)')).toBeInTheDocument();
  });

  it("FIXED_PRICE_REQUIRED from the server shows by the selling price field", async () => {
    const user = userEvent.setup();
    api((c) => {
      if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product: SAMBA });
      if (c.method === 'PATCH') return fail(400, 'FIXED_PRICE_REQUIRED', 'Enter the selling price for a fixed-price product.');
      return undefined;
    });
    renderForm('/products/p1');
    await screen.findByLabelText(/Custom markup %/);
    await user.click(screen.getByRole('button', { name: 'Fixed price' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter the selling price for a fixed-price product.')).toBeInTheDocument();
  });
});

describe('products list: selling price + pricing source', () => {
  it('shows the selling price with its source badge', async () => {
    api((c) =>
      c.path === '/admin/products'
        ? ok({
            products: [
              SAMBA,
              { ...SAMBA, id: 'p2', name: 'Red Rice 1kg', sku: 'RICE-RED', pricing_mode: 'FIXED', pricing_source: 'FIXED', calculated_selling_price: 180, price_warning: { code: 'SELLING_BELOW_COST', message: 'x' } },
              { ...SAMBA, id: 'p3', name: 'Chips', sku: 'CHIPS', pricing_source: 'GLOBAL_MARKUP', calculated_selling_price: 240 },
            ],
          })
        : undefined
    );
    render(
      <MemoryRouter>
        <ToastProvider>
          <Products />
        </ToastProvider>
      </MemoryRouter>
    );
    const samba = (await screen.findByText('Samba Rice 1kg', {}, { timeout: 4000 })).closest('tr')!;
    expect(within(samba).getByText(/LKR 250\.00/)).toBeInTheDocument();
    expect(within(samba).getByText('Category markup')).toBeInTheDocument();
    const red = screen.getByText('Red Rice 1kg').closest('tr')!;
    expect(within(red).getByText(/LKR 180\.00/)).toBeInTheDocument();
    expect(within(red).getByText('Fixed')).toBeInTheDocument();
    expect(within(red).getByText('Below cost')).toBeInTheDocument();
    expect(within(screen.getByText('Chips').closest('tr')!).getByText('Global markup')).toBeInTheDocument();
  });
});

describe('category Markup %', () => {
  function renderCategories(extra?: (c: Call) => Reply | undefined) {
    const calls = api((c) => {
      if (c.path === '/admin/category-groups') return ok({ groups: [], unassigned: [] });
      return extra?.(c);
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Categories />
        </ToastProvider>
      </MemoryRouter>
    );
    return calls;
  }

  it('lists each markup: own %, Parent %, Global %, with its product count', async () => {
    renderCategories();
    const rice = (await screen.findByText('Rice')).closest('tr')!;
    expect(within(rice).getByText('25%')).toBeInTheDocument();
    expect(within(rice).getByText('used by 3 products')).toBeInTheDocument();
    expect(within(screen.getByText('Snacks').closest('tr')!).getByText('Parent 15%')).toBeInTheDocument();
    const household = screen.getByText('Household').closest('tr')!;
    expect(await within(household).findByText('Global 20%')).toBeInTheDocument();
    expect(within(household).getByText('used by 1 product')).toBeInTheDocument();
  });

  it('edits the markup with the product-count note; blank sends markup_percent: null', async () => {
    const user = userEvent.setup();
    const calls = renderCategories((c) =>
      c.method === 'PATCH' && c.path === '/admin/categories/rice' ? ok({ category: { ...CATEGORIES[1], ...c.body } }) : undefined
    );
    const rice = (await screen.findByText('Rice')).closest('tr')!;
    await user.click(within(rice).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Category' });
    const markup = within(dialog).getByLabelText(/Markup %/);
    expect(markup).toHaveValue('25');
    expect(within(dialog).getByText(/3 products use this markup\./)).toBeInTheDocument();

    await user.clear(markup);
    expect(within(dialog).getByText(/3 products follow the parent\/global markup\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Leave blank to use Grocery's 15%/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/rice')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/categories/rice')[0]!.body).toMatchObject({ markup_percent: null });
  });

  it('sends a typed markup, and refuses a bad one without calling the API', async () => {
    const user = userEvent.setup();
    const calls = renderCategories((c) =>
      c.method === 'PATCH' && c.path === '/admin/categories/household' ? ok({ category: { ...CATEGORIES[3], ...c.body } }) : undefined
    );
    const household = (await screen.findByText('Household')).closest('tr')!;
    await user.click(within(household).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Category' });
    const markup = within(dialog).getByLabelText(/Markup %/);
    await user.type(markup, '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Markup must be between 0 and 999.99')).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/categories/household')).toHaveLength(0);

    await user.clear(markup);
    await user.type(markup, '12.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/household')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/categories/household')[0]!.body).toMatchObject({ markup_percent: 12.5 });
  });

  it('a new category sends markup_percent (null when blank)', async () => {
    const user = userEvent.setup();
    const calls = renderCategories((c) =>
      c.method === 'POST' && c.path === '/admin/categories' ? ok({ category: cat('new', 'Tea', null, null) }) : undefined
    );
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = screen.getByRole('dialog', { name: 'Category' });
    await user.type(within(dialog).getByLabelText('Name'), 'Tea');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('POST', '/admin/categories')).toHaveLength(1));
    expect(calls.find('POST', '/admin/categories')[0]!.body).toMatchObject({ name: 'Tea', markup_percent: null });
  });
});

describe('global default markup setting', () => {
  function renderPanel(patch: (body: any) => Reply = (body) => ok({ ...DEFAULT_MARKUP, ...body, updated_at: '2026-10-13T05:00:00.000Z' })) {
    const calls = api((c) => (c.method === 'PATCH' && c.path === '/admin/settings/default-markup' ? patch(c.body) : undefined));
    render(
      <MemoryRouter>
        <ToastProvider>
          <DefaultMarkupPanel />
        </ToastProvider>
      </MemoryRouter>
    );
    return calls;
  }

  it('shows the current markup and how many products use it, and saves a new one', async () => {
    const user = userEvent.setup();
    const calls = renderPanel();
    const input = await screen.findByLabelText(/Global default markup %/);
    expect(input).toHaveValue('20');
    expect(screen.getByText('Used by products with no markup of their own and none on their category.')).toBeInTheDocument();
    expect(screen.getByText(/12 products use it/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '22.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/settings/default-markup')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/settings/default-markup')[0]!.body).toEqual({ markup_percent: 22.5 });
    expect(await screen.findByText('The global default markup is now 22.5%.')).toBeInTheDocument();
  });

  it('refuses a bad value without calling the API, and shows server validation messages', async () => {
    const user = userEvent.setup();
    const calls = renderPanel(() => fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'markup_percent', message: 'Markup cannot exceed 999.99%' }]));
    const input = await screen.findByLabelText(/Global default markup %/);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a markup from 0 to 999.99.')).toBeInTheDocument();
    await user.type(input, '1000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Markup must be between 0 and 999.99')).toBeInTheDocument();
    expect(calls.find('PATCH', '/admin/settings/default-markup')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Markup cannot exceed 999.99%')).toBeInTheDocument();
  });
});

describe('import: pricing columns and dry-run preview', () => {
  it('explains the three price rules', () => {
    api();
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProductImport />
        </ToastProvider>
      </MemoryRouter>
    );
    const rules = screen.getByRole('list', { name: 'How prices work' });
    expect(within(rules).getAllByRole('listitem')).toHaveLength(PRICING_RULES.length);
    expect(rules).toHaveTextContent('selling_price filled: the product gets that FIXED selling price');
    expect(rules).toHaveTextContent('Fill selling_price or markup_percent, not both');
    expect(rules).toHaveTextContent('Older files that have only selling_price now set a FIXED price');
    expect(screen.getByText(/purchase_cost \(or cost_price\)/)).toBeInTheDocument();
  });

  it('shows each row’s selling price, source and warnings from the dry run; both columns is a row error', async () => {
    const user = userEvent.setup();
    const calls = api((c) => {
      if (c.path !== '/admin/products/import') return undefined;
      const results = c.body.rows.map((r: any) => {
        if (r.selling_price != null) {
          return {
            row: r.row,
            sku: r.sku,
            status: 'created',
            pricing: { pricing_mode: 'FIXED', pricing_source: 'FIXED', purchase_cost: r.purchase_cost, selling_price: r.selling_price, effective_markup_percent: -10 },
            warnings: [`The selling price LKR ${r.selling_price.toFixed(2)} is below the purchase cost LKR ${r.purchase_cost.toFixed(2)}.`],
          };
        }
        return r.markup_percent != null
          ? { row: r.row, sku: r.sku, status: 'updated', pricing: { pricing_mode: 'MARKUP', pricing_source: 'PRODUCT_MARKUP', purchase_cost: r.purchase_cost, selling_price: 130, effective_markup_percent: 30 } }
          : { row: r.row, sku: r.sku, status: 'skipped', pricing: { pricing_mode: 'MARKUP', pricing_source: 'CATEGORY_MARKUP', purchase_cost: r.purchase_cost, selling_price: 125, effective_markup_percent: 25 } };
      });
      return ok({ dry_run: c.body.dry_run, summary: { created: 1, updated: 1, skipped: 1, errors: 0 }, results });
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProductImport />
        </ToastProvider>
      </MemoryRouter>
    );
    // An older file: cost_price header, no markup_percent column.
    const csv = [
      'name,category,unit,cost_price,selling_price,markup_percent,sku',
      'Fixed Rice,Rice,bag,100,90,,FIX-1',
      'Own Rice,Rice,bag,100,,30,OWN-1',
      'Cat Rice,Rice,bag,100,,,CAT-1',
      'Both Rice,Rice,bag,100,120,30,BOTH-1',
    ].join('\n');
    await user.upload(screen.getByLabelText(/Spreadsheet/), new File([csv], 'products.csv', { type: 'text/csv' }));
    const preview = await screen.findByRole('table', { name: 'Preview' });
    await waitFor(() => expect(calls.find('POST', '/admin/products/import')).toHaveLength(1));
    const sent = calls.find('POST', '/admin/products/import')[0]!.body.rows;
    expect(sent.map((r: any) => [r.sku, r.purchase_cost, r.selling_price, r.markup_percent])).toEqual([
      ['FIX-1', 100, 90, null],
      ['OWN-1', 100, null, 30],
      ['CAT-1', 100, null, null],
    ]);
    expect(sent[0]).not.toHaveProperty('cost_price');

    const row = (sku: string) => within(preview).getByText(new RegExp(`^${sku} ·`)).closest('tr')!;
    await waitFor(() => expect(within(row('FIX-1')).getByText('Fixed')).toBeInTheDocument());
    expect(within(row('FIX-1')).getByText('LKR 90.00')).toBeInTheDocument();
    expect(within(row('FIX-1')).getByText('10% below cost')).toBeInTheDocument();
    expect(
      within(row('FIX-1')).getByText('Warning: The selling price LKR 90.00 is below the purchase cost LKR 100.00.')
    ).toBeInTheDocument();
    expect(within(row('OWN-1')).getByText('Product markup')).toBeInTheDocument();
    expect(within(row('OWN-1')).getByText('LKR 130.00')).toBeInTheDocument();
    expect(within(row('CAT-1')).getByText('Category markup')).toBeInTheDocument();
    expect(within(row('CAT-1')).getByText('LKR 125.00')).toBeInTheDocument();
    expect(
      within(row('BOTH-1')).getByText('selling_price: Give either selling_price or markup_percent, not both.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 3 products' })).toBeEnabled();
    expect(TEMPLATE_COLUMNS).toContain('markup_percent');
  });
});
