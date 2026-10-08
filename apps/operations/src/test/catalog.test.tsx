import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category, Promotion } from '../api/types';
import { PRODUCT_PAGE_CAP, catalog } from '../api/resources';
import { ADMIN_WITH_RIDER, fail, mockApi, ok, renderAs } from './helpers';

/**
 * Products/Categories/Promotions (task F5, plan §12) against a fake Blynk
 * API shaped exactly like the backend's responses. Mirrors
 * `apps/admin/src/test/*.test.tsx`'s own coverage shape for the identical
 * endpoints (a fresh implementation, not an import - common.md rule 2),
 * following F3's own precedent of proving every rejection is shown, never
 * swallowed, and every payload sent is exactly what the operator chose - no
 * client-computed price ever leaves this app (common.md rule 8).
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

let seq = 0;
function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  seq += 1;
  return {
    id: `p${seq}`,
    category_id: 'c1',
    category_name: 'Dairy',
    name: `Fresh Milk ${seq}`,
    slug: `fresh-milk-${seq}`,
    sku: `SKU-${100 + seq}`,
    barcode: null,
    unit: '1 L',
    pack_size: null,
    description: null,
    image_url: null,
    purchase_cost: 300,
    custom_markup_percent: null,
    effective_markup_percent: 20,
    calculated_selling_price: 360,
    selling_price: 360,
    is_available: true,
    is_active: true,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function category(overrides: Partial<Category> = {}): Category {
  seq += 1;
  return {
    id: `c${seq}`,
    name: `Category ${seq}`,
    slug: `category-${seq}`,
    description: null,
    image_url: null,
    display_order: seq,
    is_active: true,
    ...overrides,
  };
}

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  seq += 1;
  return {
    id: `pr${seq}`,
    title: `Promotion ${seq}`,
    subtitle: null,
    image_url: null,
    background_type: 'SOLID',
    background_color: '#FFE141',
    background_color_end: null,
    background_image_url: null,
    cta_label: null,
    cta_destination_type: null,
    cta_destination_value: null,
    display_order: seq,
    is_active: true,
    ...overrides,
  };
}

// ----------------------------------------------------------------- Catalog hub
describe('Catalog hub', () => {
  it('replaces F1s placeholder at /catalog with real, linked counts from the real endpoints', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog', {
      'GET /admin/categories': () => ok({ categories: [category(), category()] }),
      'GET /admin/promotions': () => ok({ promotions: [promotion()] }),
      'GET /admin/products': () => ok({ products: [product(), product(), product()], pagination: { page: 1, limit: 200 } }),
      'GET /admin/dental/clinics': () => ok({ clinics: [{ id: 'dc1' }, { id: 'dc2' }] }),
    });

    expect(
      // Task F6 (Inventory) added a fourth card; task F8 (Dental) added a
      // fifth, widening the hub's own description each time - updated here
      // rather than left stale (same "keep the test honest" discipline F3
      // applied to its own placeholder-text assertion in routing.test.tsx).
      await screen.findByText('Products, categories, Home promotions, inventory and dental clinics.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/built by later tasks/)).not.toBeInTheDocument();

    const productsCard = (await screen.findByText('Products')).closest('a')!;
    await waitFor(() => expect(within(productsCard).getByText('3')).toBeInTheDocument());
    const categoriesCard = screen.getByText('Categories').closest('a')!;
    expect(within(categoriesCard).getByText('2')).toBeInTheDocument();
    const promotionsCard = screen.getByText('Home promotions').closest('a')!;
    expect(within(promotionsCard).getByText('1')).toBeInTheDocument();
    const inventoryCard = screen.getByText('Inventory').closest('a')!;
    expect(inventoryCard).toHaveAttribute('href', '/catalog/inventory');
    const dentalCard = screen.getByText('Dental').closest('a')!;
    await waitFor(() => expect(within(dentalCard).getByText('2')).toBeInTheDocument());
    expect(dentalCard).toHaveAttribute('href', '/catalog/dental');

    expect(productsCard).toHaveAttribute('href', '/catalog/products');
    expect(categoriesCard).toHaveAttribute('href', '/catalog/categories');
    expect(promotionsCard).toHaveAttribute('href', '/catalog/promotions');
  });
});

// -------------------------------------------------------------- Products list
describe('Products', () => {
  it('lists real products with price and status - never a fabricated number', async () => {
    const p1 = product({ name: 'Fresh Milk', calculated_selling_price: 360, is_active: true });
    const p2 = product({ name: 'Old Stock Yoghurt', calculated_selling_price: 210, is_active: false });
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': () => ok({ products: [p1, p2], pagination: { page: 1, limit: 200 } }),
      'GET /admin/categories': () => ok({ categories: [] }),
    });

    expect(await screen.findByText('Fresh Milk')).toBeInTheDocument();
    expect(screen.getByText('LKR 360.00')).toBeInTheDocument();
    expect(screen.getByText('Old Stock Yoghurt')).toBeInTheDocument();
    expect(screen.getByText('LKR 210.00')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('pages through every product (200 a page) instead of stopping at the first 200', async () => {
    const all = Array.from({ length: 450 }, (_, i) => product({ name: `Item ${i}` }));
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': (call) => {
        const page = Number(call.query.page);
        return ok({ products: all.slice((page - 1) * 200, page * 200), pagination: { page, limit: 200 } });
      },
      'GET /admin/categories': () => ok({ categories: [] }),
    });
    expect(await screen.findByText('Item 449')).toBeInTheDocument();
    expect(api.find('GET', '/admin/products').map((c) => c.query.page)).toEqual(['1', '2', '3']);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it('listAll stops at the page cap and reports that the list is not complete', async () => {
    let n = 0;
    // One fixture, copied: `product()` bumps the shared `seq` other fixtures use.
    const base = product();
    const api = mockApi({
      // Never a short page: more products than the cap.
      'GET /admin/products': () =>
        ok({ products: Array.from({ length: 200 }, () => ({ ...base, id: `cap-${(n += 1)}`, name: `Row ${n}` })) }),
    });
    const result = await catalog.products.listAll();
    expect(result.capped).toBe(true);
    expect(result.products).toHaveLength(PRODUCT_PAGE_CAP * 200);
    expect(api.find('GET', '/admin/products')).toHaveLength(PRODUCT_PAGE_CAP);
  });

  it('says the list is not complete when the read was capped', async () => {
    const spy = vi.spyOn(catalog.products, 'listAll').mockResolvedValue({ products: [product({ name: 'Only One' })], capped: true });
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', { 'GET /admin/categories': () => ok({ categories: [] }) });
    expect(await screen.findByText('Showing the first 1 products. Search or filter by category to find the rest.')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('shows an honest empty state, not a blank gap', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
      'GET /admin/categories': () => ok({ categories: [] }),
    });
    expect(await screen.findByText('No products match')).toBeInTheDocument();
  });

  it('a load failure is a real visible error', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': () => fail(500, 'INTERNAL'),
      'GET /admin/categories': () => ok({ categories: [] }),
    });
    expect(await screen.findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
  });

  it('filtering by search sends the trimmed term to the API, debounced', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
      'GET /admin/categories': () => ok({ categories: [] }),
    });
    await screen.findByText('No products match');
    await user.type(screen.getByLabelText('Search products'), 'milk');
    await waitFor(() => {
      const calls = api.find('GET', '/admin/products');
      expect(calls.some((c) => c.query.search === 'milk')).toBe(true);
    });
  });

  it('toggling active sends is_active and reloads', async () => {
    const user = userEvent.setup();
    const p = product({ name: 'Fresh Milk', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': () => ok({ products: [p], pagination: { page: 1, limit: 200 } }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'PATCH /admin/products/:id': () => ok({ product: { ...p, is_active: false } }),
    });
    await screen.findByText('Fresh Milk');
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Disable product' }));
    await user.click(confirm.getByRole('button', { name: 'Disable' }));

    await waitFor(() => {
      const call = api.find('PATCH', `/admin/products/${p.id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });
});

// ------------------------------------------------------------- Product form
describe('Product form', () => {
  it('creates a product with exactly the entered fields - no invented price', async () => {
    const user = userEvent.setup();
    const c = category({ name: 'Dairy' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [c] }),
      'POST /admin/products': () => ok({ product: product() }),
      // Fired once the form navigates back to the Products list on success.
      'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
    });

    await screen.findByText('Add product');
    await user.type(screen.getByLabelText('Product name'), 'Coconut Water');
    await user.type(screen.getByLabelText('SKU'), 'CW-500');
    await user.type(screen.getByLabelText(/^Unit/), '500 ml');
    await user.type(screen.getByLabelText('Purchase cost (LKR)'), '150');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/products')[0];
      expect(call?.body).toMatchObject({
        category_id: c.id,
        name: 'Coconut Water',
        sku: 'CW-500',
        unit: '500 ml',
        purchase_cost: 150,
        custom_markup_percent: null,
      });
      expect(call?.body).not.toHaveProperty('calculated_selling_price');
    });
    // Navigates back to the Products list on success - which also has its
    // own "Add product" button, so the unique assertion is that the form's
    // own SKU field is gone, not that the phrase "Add product" disappeared.
    await waitFor(() => expect(screen.queryByLabelText('SKU')).not.toBeInTheDocument());
  });

  it('blocks submission client-side on an invalid SKU, sending nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
    });
    await screen.findByText('Add product');
    await user.type(screen.getByLabelText('Product name'), 'X');
    await user.type(screen.getByLabelText('SKU'), 'ab');
    await user.type(screen.getByLabelText(/^Unit/), 'ea');
    await user.type(screen.getByLabelText('Purchase cost (LKR)'), '10');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('SKU must be at least 3 characters')).toBeInTheDocument();
    expect(api.find('POST', '/admin/products')).toHaveLength(0);
  });

  it('a duplicate-SKU rejection from the backend is a real visible error, and nothing navigates away', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      'POST /admin/products': () => fail(409, 'PRODUCT_SKU_EXISTS', "Product with SKU 'CW-500' already exists."),
    });
    await screen.findByText('Add product');
    await user.type(screen.getByLabelText('Product name'), 'Coconut Water');
    await user.type(screen.getByLabelText('SKU'), 'CW-500');
    await user.type(screen.getByLabelText(/^Unit/), '500 ml');
    await user.type(screen.getByLabelText('Purchase cost (LKR)'), '150');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText("Product with SKU 'CW-500' already exists.")).toBeInTheDocument();
    expect(screen.getByText('Add product')).toBeInTheDocument();
  });

  it('editing loads the real admin detail (cost/markup) and PATCHes only on submit', async () => {
    const user = userEvent.setup();
    const existing = product({ name: 'Fresh Milk', purchase_cost: 300, custom_markup_percent: 15 });
    const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/products/${existing.id}`, {
      'GET /admin/categories': () => ok({ categories: [category({ id: existing.category_id })] }),
      'GET /admin/products/:id': () => ok({ product: existing }),
      'PATCH /admin/products/:id': () => ok({ product: existing }),
    });

    const nameInput = await screen.findByDisplayValue('Fresh Milk');
    expect(api.find('GET', `/admin/products/${existing.id}`)).toHaveLength(1);
    await user.clear(nameInput);
    await user.type(nameInput, 'Fresh Milk 1L');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = api.find('PATCH', `/admin/products/${existing.id}`)[0];
      expect(call?.body).toMatchObject({ name: 'Fresh Milk 1L', purchase_cost: 300, custom_markup_percent: 15 });
    });
  });

  it('uploads an image and stores the returned URL; Remove clears the field but deletes nothing', async () => {
    const user = userEvent.setup();
    const { api, container } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      'POST /admin/media': () => ok({ media: { key: 'products/coconut.webp', url: 'https://cdn.blynk.test/products/coconut.webp' } }),
      'DELETE /admin/media': () => ok({ deleted: true }),
    });
    await screen.findByText('Add product');

    const file = new File(['abc'], 'coconut.jpg', { type: 'image/jpeg' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // `user.upload` drives its synthetic click through the hidden input
    // (`hidden` on purpose - `ImageUploader` opens it via a visible button),
    // and user-event v14's visibility check refuses to click a hidden
    // element; firing the native `change` event directly is the standard
    // testing-library workaround and exercises the same `onChange` handler.
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const upload = api.find('POST', '/admin/media')[0];
      expect(upload).toBeTruthy();
    });
    expect(await screen.findByText('Replace image')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Upload image')).toBeInTheDocument();
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);
  });

  it('deletes the old image only after the product is saved without it', async () => {
    const user = userEvent.setup();
    const existing = product({ name: 'Fresh Milk', image_url: 'https://cdn.blynk.test/products/old.webp' });
    const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/products/${existing.id}`, {
      'GET /admin/categories': () => ok({ categories: [category({ id: existing.category_id })] }),
      'GET /admin/products/:id': () => ok({ product: existing }),
      'PATCH /admin/products/:id': () => ok({ product: existing }),
      'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
      'DELETE /admin/media': () => ok({ deleted: true }),
    });
    await screen.findByDisplayValue('Fresh Milk');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/media')).toHaveLength(1));
    expect(api.find('PATCH', `/admin/products/${existing.id}`)[0].body).toHaveProperty('image_url', null);
    expect(api.find('DELETE', '/admin/media')[0].body).toEqual({ url: 'https://cdn.blynk.test/products/old.webp' });
  });

  it('a failed save never deletes the old image', async () => {
    const user = userEvent.setup();
    const existing = product({ name: 'Fresh Milk', image_url: 'https://cdn.blynk.test/products/old.webp' });
    const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/products/${existing.id}`, {
      'GET /admin/categories': () => ok({ categories: [category({ id: existing.category_id })] }),
      'GET /admin/products/:id': () => ok({ product: existing }),
      'PATCH /admin/products/:id': () => fail(500, 'INTERNAL'),
      'DELETE /admin/media': () => ok({ deleted: true }),
    });
    await screen.findByDisplayValue('Fresh Milk');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', `/admin/products/${existing.id}`)).toHaveLength(1));
    await screen.findByText(/had a problem|went wrong|INTERNAL/i);
    expect(api.find('DELETE', '/admin/media')).toHaveLength(0);
  });

  it('refuses an image still over 2 MB before uploading it', async () => {
    const { api, container } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      'POST /admin/media': () => ok({ media: { key: 'k', url: 'u' } }),
    });
    await screen.findByText('Add product');
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [big] } });
    expect(await screen.findByText(/larger than 2 MB/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/media')).toHaveLength(0);
  });

  it('explains a 413 FILE_TOO_LARGE from the API', async () => {
    const { container } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      'POST /admin/media': () => fail(413, 'FILE_TOO_LARGE', 'File too large'),
    });
    await screen.findByText('Add product');
    const file = new File(['abc'], 'coconut.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    expect(await screen.findByText('That image is larger than 2 MB. Choose a smaller one.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ Categories
describe('Categories', () => {
  it('lists categories with their real slug/order/status', async () => {
    const c = category({ name: 'Bakery', slug: 'bakery', display_order: 3, is_active: false });
    renderAs(ADMIN_WITH_RIDER, '/catalog/categories', { 'GET /admin/categories': () => ok({ categories: [c] }) });
    expect(await screen.findByText('Bakery')).toBeInTheDocument();
    expect(screen.getByText('bakery')).toBeInTheDocument();
    expect(screen.getByText('Order 3')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('creates a category via the dialog with the entered fields', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [] }),
      'POST /admin/categories': () => ok({ category: category() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Frozen');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/categories')[0];
      expect(call?.body).toMatchObject({ name: 'Frozen', description: null, display_order: 0, is_active: true });
      // A category saved without a picture must send an explicit null, not
      // omit the field: on PATCH, omitting it would silently keep the old
      // image after an operator had cleared it.
      expect(call?.body).toHaveProperty('image_url', null);
    });
  });

  it('offers a category image, and sends the uploaded URL', async () => {
    const user = userEvent.setup();
    const existing = category({ name: 'Bakery', image_url: 'https://cdn.test/bakery.jpg' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [existing] }),
      ['PATCH /admin/categories/' + existing.id]: () => ok({ category: existing }),
    });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    // The uploader is present and already holding this category's image.
    expect(dialog.getByText('Category image')).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = api.find('PATCH', '/admin/categories/' + existing.id)[0];
      expect(call?.body).toMatchObject({ image_url: 'https://cdn.test/bakery.jpg' });
    });
  });

  it('shows the image on the row, and says so when there is none', async () => {
    const withImage = category({ name: 'Bakery', image_url: 'https://cdn.test/bakery.jpg' });
    const without = category({ name: 'Frozen', image_url: null });
    renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [withImage, without] }),
    });

    expect(await screen.findByText('Bakery')).toBeInTheDocument();
    const img = document.querySelector('img[src="https://cdn.test/bakery.jpg"]');
    expect(img).not.toBeNull();
    // The operator can see at a glance which categories still fall back to
    // the Blynk icon in the customer app.
    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('a duplicate-slug rejection keeps the dialog open with a real visible error', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [] }),
      'POST /admin/categories': () => fail(409, 'CATEGORY_SLUG_EXISTS', "Category with slug 'frozen' already exists."),
    });
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Frozen');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Category with slug 'frozen' already exists.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Category' })).toBeInTheDocument();
  });

  it('toggling active sends is_active on the exact category', async () => {
    const user = userEvent.setup();
    const c = category({ name: 'Bakery', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [c] }),
      'PATCH /admin/categories/:id': () => ok({ category: { ...c, is_active: false } }),
    });
    await screen.findByText('Bakery');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      const call = api.find('PATCH', `/admin/categories/${c.id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });
});

// ----------------------------------------------------------------- Promotions
describe('Promotions', () => {
  it('lists promotions in order, live/hidden status and destination summary', async () => {
    const p = promotion({ title: 'Diwali sale', cta_label: 'Shop now', cta_destination_type: 'CATALOG' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [p] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
    });
    expect(await screen.findByText('Diwali sale')).toBeInTheDocument();
    expect(screen.getByText('Shop now → all products')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows what customers see right now from the real public endpoint, separate from the draft preview', async () => {
    const live = promotion({ title: 'Live now on Home' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [live] }),
    });
    expect(await screen.findByText('What customers see now')).toBeInTheDocument();
    expect(screen.getByText('Live now on Home')).toBeInTheDocument();
  });

  it('moving a promotion down swaps display_order with its neighbour and sends both in one reorder call', async () => {
    const user = userEvent.setup();
    const first = promotion({ title: 'First', display_order: 1 });
    const second = promotion({ title: 'Second', display_order: 2 });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [first, second] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'PATCH /admin/promotions/reorder': () => ok({ promotions: [second, first] }),
    });
    await screen.findByText('First');
    await user.click(screen.getByRole('button', { name: 'Move First down' }));

    await waitFor(() => {
      const call = api.find('PATCH', '/admin/promotions/reorder')[0];
      expect(call?.body).toEqual({
        items: [
          { id: first.id, display_order: second.display_order },
          { id: second.id, display_order: first.display_order },
        ],
      });
    });
  });

  it('moving between two promotions with the SAME order renumbers the list so the move happens', async () => {
    const user = userEvent.setup();
    const first = promotion({ title: 'First', display_order: 0 });
    const second = promotion({ title: 'Second', display_order: 0 });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [first, second] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'PATCH /admin/promotions/reorder': () => ok({ promotions: [second, first] }),
    });
    await screen.findByText('First');
    await user.click(screen.getByRole('button', { name: 'Move First down' }));
    await waitFor(() => {
      expect(api.find('PATCH', '/admin/promotions/reorder')[0]?.body).toEqual({
        items: [
          { id: second.id, display_order: 10 },
          { id: first.id, display_order: 20 },
        ],
      });
    });
  });

  it.each(['1.5', '1001', '-3', 'abc'])(
    'refuses display order %s inline, sending nothing',
    async (value) => {
      const user = userEvent.setup();
      const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [] }),
        'POST /admin/promotions': () => ok({ promotion: promotion() }),
      });
      await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
      // New promotions start as a designed banner (2026-10-08); these cases are about the drawn card.
      await user.click(await screen.findByRole('button', { name: 'Solid' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
      await user.type(dialog.getByLabelText(/^Headline/), 'New Year Sale');
      const order = dialog.getByLabelText(/^Display order/);
      await user.clear(order);
      await user.type(order, value);
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      expect(await dialog.findByText('Order must be a whole number from 0 to 1000.')).toBeInTheDocument();
      expect(api.find('POST', '/admin/promotions')).toHaveLength(0);
    }
  );

  it('creates an informational promotion with null CTA fields when no destination is chosen', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'POST /admin/promotions': () => ok({ promotion: promotion() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
    // New promotions start as a designed banner (2026-10-08); these cases are about the drawn card.
    await user.click(await screen.findByRole('button', { name: 'Solid' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
    await user.type(dialog.getByLabelText(/^Headline/), 'New Year Sale');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/promotions')[0];
      expect(call?.body).toMatchObject({
        title: 'New Year Sale',
        cta_label: null,
        cta_destination_type: null,
        cta_destination_value: null,
        background_type: 'SOLID',
      });
    });
  });

  it('a validation rejection from the backend surfaces the specific field message, not the generic one', async () => {
    const user = userEvent.setup();
    const p = promotion({ title: 'Existing' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [p] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'PATCH /admin/promotions/:id': () => fail(400, 'VALIDATION_ERROR', 'Request validation failed'),
    });
    await screen.findByText('Existing');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Request validation failed')).toBeInTheDocument();
  });

  it('deleting requires confirmation, then sends the delete', async () => {
    const user = userEvent.setup();
    const p = promotion({ title: 'Old Banner' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [p] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'DELETE /admin/promotions/:id': () => ok({ deleted: true }),
    });
    await screen.findByText('Old Banner');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.find('DELETE', `/admin/promotions/${p.id}`)).toHaveLength(0);
    const confirm = within(screen.getByRole('dialog', { name: 'Delete promotion' }));
    await user.click(confirm.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.find('DELETE', `/admin/promotions/${p.id}`)).toHaveLength(1);
    });
  });

  it('toggling active/hidden sends is_active on the exact promotion', async () => {
    const user = userEvent.setup();
    const p = promotion({ title: 'Old Banner', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [p] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'PATCH /admin/promotions/:id': () => ok({ promotion: { ...p, is_active: false } }),
    });
    await screen.findByText('Old Banner');
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => {
      const call = api.find('PATCH', `/admin/promotions/${p.id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });

  // --------------------------------------------------------------------------
  // ARTWORK: a finished banner the operator uploads as-is. Full-bleed, with
  // no ink scrim and none of the app's own words over it.
  // --------------------------------------------------------------------------
  describe('Full-artwork background', () => {
    const BANNER = 'http://localhost:4000/uploads/promotions/avurudu.png';

    function artwork(overrides: Partial<Promotion> = {}): Promotion {
      return promotion({
        title: 'Avurudu Festival Sale',
        subtitle: 'Baked into the banner',
        background_type: 'ARTWORK',
        background_color: null,
        background_image_url: BANNER,
        ...overrides,
      });
    }

    /** The draft preview inside the open dialog, or the live strip's. */
    function previewStyle(root: HTMLElement | Document = document): string {
      const node = root.querySelector('.promo-preview:not(.promo-preview--compact)');
      return node?.getAttribute('style') ?? '';
    }

    it('offers the artwork option in the background chooser', async () => {
      const user = userEvent.setup();
      renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [] }),
      });
      await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
      // New promotions start as a designed banner (2026-10-08); these cases are about the drawn card.
      await user.click(await screen.findByRole('button', { name: 'Solid' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));

      // The pre-existing three are untouched.
      for (const label of ['Solid', 'Gradient', 'Image']) {
        expect(dialog.getByRole('button', { name: label })).toBeInTheDocument();
      }
      const option = dialog.getByRole('button', { name: 'Designed banner (full picture)' });
      await user.click(option);
      expect(option).toHaveAttribute('aria-pressed', 'true');

      // The same uploader as IMAGE, relabelled - not a second one. A designed
      // banner draws only its own picture, so the foreground uploader is
      // hidden (2026-10-08): this is the only one.
      expect(dialog.getByText('Banner artwork')).toBeInTheDocument();
      expect(dialog.getAllByRole('button', { name: 'Upload image' })).toHaveLength(1);
      expect(dialog.queryByText('Foreground visual')).toBeNull();
      // The hint spells out that the app draws nothing over the banner.
      // (The sentence is split by a <strong>, so match on the paragraph.)
      const hint = dialog.getByText(
        (_, el) =>
          el?.className === 'uploader__hint' &&
          /The headline and supporting text are\s*not\s*drawn over it/.test(el.textContent ?? '')
      );
      expect(hint).toBeInTheDocument();
      expect(hint.textContent).toMatch(/no darkening/);
      // And the form says the headline is still needed, and why.
      expect(
        dialog.getAllByText(/what a screen reader announces for this slide/).length
      ).toBeGreaterThan(0);
    });

    it('previews the banner full-bleed: no scrim, no headline, no subtitle', async () => {
      renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [artwork()] }),
      });
      await screen.findByText('What customers see now');

      const style = previewStyle();
      expect(style).toContain(BANNER);
      expect(style).not.toContain('linear-gradient');
      // The app's own words are not drawn over a finished banner.
      expect(screen.queryByText('Avurudu Festival Sale')).not.toBeInTheDocument();
      expect(screen.queryByText('Baked into the banner')).not.toBeInTheDocument();
    });

    it('still draws a labelled CTA over the artwork', async () => {
      renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () =>
          ok({ promotions: [artwork({ cta_label: 'Shop now', cta_destination_type: 'CATALOG' })] }),
      });
      await screen.findByText('What customers see now');
      expect(screen.getByText('Shop now')).toBeInTheDocument();
      // Still no headline: only the button the operator asked for.
      expect(screen.queryByText('Avurudu Festival Sale')).not.toBeInTheDocument();
    });

    it('an IMAGE background keeps its flat 0.66 ink scrim and its headline', async () => {
      // Regression guard: ARTWORK is a separate branch, it did not change IMAGE.
      renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () =>
          ok({ promotions: [artwork({ title: 'Weekend Market', background_type: 'IMAGE' })] }),
      });
      await screen.findByText('What customers see now');

      const style = previewStyle();
      expect(style).toContain('rgba(16,19,25,0.66)');
      expect(screen.getByText('Weekend Market')).toBeInTheDocument();
    });

    it('switching an image promotion to artwork keeps the uploaded file and clears the colours', async () => {
      const user = userEvent.setup();
      const p = promotion({
        title: 'Weekend Market',
        background_type: 'IMAGE',
        background_color: '#FFE141',
        background_image_url: BANNER,
      });
      const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [p] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [] }),
        'PATCH /admin/promotions/:id': () => ok({ promotion: artwork() }),
      });
      await screen.findByText('Weekend Market');
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
      await user.click(dialog.getByRole('button', { name: 'Designed banner (full picture)' }));
      await user.click(dialog.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        const call = api.find('PATCH', `/admin/promotions/${p.id}`)[0];
        expect(call?.body).toMatchObject({
          background_type: 'ARTWORK',
          background_image_url: BANNER,
          background_color: null,
          background_color_end: null,
        });
      });
    });

    it('refuses to save artwork with no file uploaded', async () => {
      const user = userEvent.setup();
      const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [] }),
      });
      await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
      // New promotions start as a designed banner (2026-10-08); these cases are about the drawn card.
      await user.click(await screen.findByRole('button', { name: 'Solid' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
      await user.type(dialog.getByLabelText(/^Headline/), 'Avurudu Festival Sale');
      await user.click(dialog.getByRole('button', { name: 'Designed banner (full picture)' }));
      await user.click(dialog.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Upload the banner artwork, or choose another background type.')).toBeInTheDocument();
      expect(api.find('POST', '/admin/promotions')).toHaveLength(0);
    });

    it('lets artwork carry a destination with no button label; every other type still needs one', async () => {
      const user = userEvent.setup();
      const p = promotion({ title: 'Weekend Market', background_type: 'IMAGE', background_image_url: BANNER });
      const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () => ok({ promotions: [p] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [] }),
        'PATCH /admin/promotions/:id': () => ok({ promotion: artwork() }),
      });
      await screen.findByText('Weekend Market');
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));

      // IMAGE with a destination and no label: still rejected, as before.
      // The form is still in IMAGE mode here, so the field is "Button goes to";
      // it only reads "Tapping the banner opens" after the switch to ARTWORK
      // below, where no button is drawn over the card.
      // Anchored regex, not the exact string: `Field` folds its hint into the
      // accessible name, and this field now carries one when no destination is
      // set. Same reason the headline lookups above use /^Headline/.
      await user.selectOptions(dialog.getByLabelText(/^Button goes to/), 'CATALOG');
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('A promotion with a destination needs a button label.')).toBeInTheDocument();
      expect(api.find('PATCH', `/admin/promotions/${p.id}`)).toHaveLength(0);

      // ARTWORK: the banner draws its own call to action, so the whole card
      // becomes the tap target and the label may stay empty.
      await user.click(dialog.getByRole('button', { name: 'Designed banner (full picture)' }));
      await user.click(dialog.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        const call = api.find('PATCH', `/admin/promotions/${p.id}`)[0];
        expect(call?.body).toMatchObject({
          background_type: 'ARTWORK',
          cta_label: null,
          cta_destination_type: 'CATALOG',
        });
      });
    });

    it('lists a label-less artwork promotion as a whole-card link, not as informational', async () => {
      renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
        'GET /admin/promotions': () =>
          ok({ promotions: [artwork({ cta_destination_type: 'CATALOG' })] }),
        'GET /admin/categories': () => ok({ categories: [] }),
        'GET /promotions': () => ok({ promotions: [] }),
      });
      expect(await screen.findByText('Whole card → all products')).toBeInTheDocument();
    });
  });
});

// ------------------------------------------------------------- Focal point
/**
 * Image focal point (backend migration 009).
 *
 * Product tiles and promotion cards CROP the uploaded image to fill a fixed
 * shape, and that crop used to be anchored at the centre - so a banner whose
 * "Super Market" headline runs along the top lost the headline. The operator
 * now places the anchor, and sees a live preview at the real target shape,
 * because a focal point without one is guesswork: what survives a square tile
 * is not what survives a wide card.
 *
 * Every assertion below is about the SAME uploader serving both forms: there
 * is no per-form fork.
 */
describe('Image focal point', () => {
  /**
   * jsdom gives every element a zero-sized rect, so a click carries no
   * position at all. Stubbing the surface's box is what makes "the operator
   * clicked 20% across, 10% down" mean anything here.
   */
  function sizeSurface(surface: HTMLElement, width = 200, height = 100) {
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width,
        height,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  async function uploadInto(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['abc'], 'banner.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByTestId('focal-surface');
  }

  const MEDIA = {
    'POST /admin/media': () =>
      ok({ media: { key: 'products/banner.webp', url: 'https://cdn.blynk.test/products/banner.webp' } }),
  };

  // ------------------------------------------------------------- products
  it('a product with no image offers no focal control - there is nothing to crop yet', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
    });
    await screen.findByText('Add product');
    expect(screen.queryByTestId('focal-surface')).not.toBeInTheDocument();
  });

  it('clicking a point on the product image stores it, and the preview crops to it', async () => {
    const user = userEvent.setup();
    const { api, container } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category({ id: 'c1' })] }),
      'POST /admin/products': () => ok({ product: product() }),
      ...MEDIA,
    });
    await screen.findByText('Add product');
    await uploadInto(container);

    const surface = screen.getByTestId('focal-surface');
    sizeSurface(surface);
    // 40px across a 200px box and 10px down a 100px box: 20% / 10%.
    fireEvent.click(surface, { clientX: 40, clientY: 10 });

    // The marker moved to exactly that point...
    expect(screen.getByTestId('focal-marker')).toHaveStyle({ left: '20%', top: '10%' });
    // ...and the live preview - a SQUARE, because that is the shape a product
    // tile really is - crops from it.
    expect(screen.getByTestId('focal-preview')).toHaveStyle({ backgroundPosition: '20% 10%' });
    expect(screen.getByTestId('focal-preview').className).toContain('focal__preview--square');
    expect(screen.getByText('Product tile')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Product name'), 'Coconut Oil 1L');
    await user.type(screen.getByLabelText('SKU'), 'SKU-CO-1');
    await user.type(screen.getByLabelText(/^Unit/), '1 L');
    await user.type(screen.getByLabelText(/^Purchase cost/), '500');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/products')[0];
      expect(call?.body).toMatchObject({ image_focal_x: 20, image_focal_y: 10 });
    });
  });

  it('is adjustable from the keyboard alone, with a labelled slider per axis', async () => {
    const { container } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      ...MEDIA,
    });
    await screen.findByText('Add product');
    await uploadInto(container);

    const across = screen.getByLabelText('Focus across') as HTMLInputElement;
    const down = screen.getByLabelText('Focus down') as HTMLInputElement;

    // Native range inputs: reachable by Tab, moved by the arrow keys, and
    // announced by every screen reader without a role="application" trap.
    for (const slider of [across, down]) {
      expect(slider).toHaveAttribute('type', 'range');
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '100');
      // A sensible step: 1% per arrow press.
      expect(slider).toHaveAttribute('step', '1');
      expect(slider.value).toBe('50');
      slider.focus();
      expect(slider).toHaveFocus();
    }

    fireEvent.change(across, { target: { value: '18' } });
    fireEvent.change(down, { target: { value: '7' } });

    expect(across).toHaveAttribute('aria-valuetext', '18% from the left');
    expect(down).toHaveAttribute('aria-valuetext', '7% from the top');
    expect(screen.getByTestId('focal-preview')).toHaveStyle({ backgroundPosition: '18% 7%' });
    // The current position is announced, not left to the marker alone.
    expect(screen.getByRole('status')).toHaveTextContent('Focus point: 18% across, 7% down');
  });

  it('resets to the centre, and says so in words', async () => {
    const user = userEvent.setup();
    const { container } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      ...MEDIA,
    });
    await screen.findByText('Add product');
    await uploadInto(container);

    // Nothing to reset while it is already centred.
    expect(screen.getByRole('button', { name: 'Reset to centre' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Centre of the image (50% across, 50% down)');

    fireEvent.change(screen.getByLabelText('Focus across'), { target: { value: '90' } });
    await user.click(screen.getByRole('button', { name: 'Reset to centre' }));
    expect(screen.getByTestId('focal-preview')).toHaveStyle({ backgroundPosition: '50% 50%' });
  });

  it('an untouched product sends the 50/50 default - the crop it already had', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/new', {
      'GET /admin/categories': () => ok({ categories: [category({ id: 'c1' })] }),
      'POST /admin/products': () => ok({ product: product() }),
    });
    await screen.findByText('Add product');
    await user.type(screen.getByLabelText('Product name'), 'Plain Item');
    await user.type(screen.getByLabelText('SKU'), 'SKU-PL-1');
    await user.type(screen.getByLabelText(/^Unit/), '1 pc');
    await user.type(screen.getByLabelText(/^Purchase cost/), '100');
    await user.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/products')[0];
      expect(call?.body).toMatchObject({ image_focal_x: 50, image_focal_y: 50 });
    });
  });

  it('loads a saved focal point back into the form, and survives an API response that has none', async () => {
    const withFocal = product({
      image_url: 'https://cdn.blynk.test/a.webp',
      image_focal_x: 30,
      image_focal_y: 80,
    });
    const { unmount } = renderAs(ADMIN_WITH_RIDER, `/catalog/products/${withFocal.id}`, {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      'GET /admin/products/:id': () => ok({ product: withFocal }),
    });
    await screen.findByTestId('focal-preview');
    expect(screen.getByTestId('focal-preview')).toHaveStyle({ backgroundPosition: '30% 80%' });
    unmount();

    // An older backend that has never heard of migration 009 must not break
    // the form: the missing field reads as the centre it always was.
    const legacy = product({ image_url: 'https://cdn.blynk.test/b.webp' });
    delete legacy.image_focal_x;
    delete legacy.image_focal_y;
    renderAs(ADMIN_WITH_RIDER, `/catalog/products/${legacy.id}`, {
      'GET /admin/categories': () => ok({ categories: [category()] }),
      'GET /admin/products/:id': () => ok({ product: legacy }),
    });
    await screen.findByTestId('focal-preview');
    expect(screen.getByTestId('focal-preview')).toHaveStyle({ backgroundPosition: '50% 50%' });
  });

  // ----------------------------------------------------------- promotions
  it('the promotion background uses the SAME uploader, previewed at the wide card shape', async () => {
    const user = userEvent.setup();
    const { api, container } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'POST /admin/promotions': () => ok({ promotion: promotion() }),
      'POST /admin/media': () =>
        ok({ media: { key: 'promotions/b.webp', url: 'https://cdn.blynk.test/promotions/b.webp' } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
    // New promotions start as a designed banner (2026-10-08); these cases are about the drawn card.
    await user.click(await screen.findByRole('button', { name: 'Solid' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
    await user.click(dialog.getByRole('button', { name: 'Designed banner (full picture)' }));

    // A designed banner shows only the banner uploader (the foreground visual
    // is hidden for it, 2026-10-08) - the same component the product form uses.
    const inputs = container.querySelectorAll('input[type="file"]:not([capture])');
    expect(inputs).toHaveLength(1);
    fireEvent.change(inputs[0]!, {
      target: { files: [new File(['x'], 'b.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByTestId('focal-surface');

    // The preview is the CARD shape here, not the square a product gets.
    expect(screen.getByTestId('focal-preview').className).toContain('focal__preview--wide');
    expect(screen.getByText('Home carousel card')).toBeInTheDocument();

    const surface = screen.getByTestId('focal-surface');
    sizeSurface(surface, 200, 100);
    // The case the feature exists for: keep the top of the banner.
    fireEvent.click(surface, { clientX: 100, clientY: 5 });

    // In ARTWORK mode the field is labelled "Banner name", not "Headline":
    // nothing is drawn over a full-artwork card, so calling it a headline made
    // a required field look pointless. It still carries the promotion's name
    // and its screen-reader label, which is why it is still required.
    await user.type(dialog.getByLabelText(/^Banner name/), 'Super Market');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/promotions')[0];
      expect(call?.body).toMatchObject({
        background_type: 'ARTWORK',
        background_focal_x: 50,
        background_focal_y: 5,
      });
    });
  });

  it('a solid-background promotion still sends the centre, so the field is always valid', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [] }),
      'POST /admin/promotions': () => ok({ promotion: promotion() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add promotion' }));
    // New promotions start as a designed banner (2026-10-08); these cases are about the drawn card.
    await user.click(await screen.findByRole('button', { name: 'Solid' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Promotion' }));
    await user.type(dialog.getByLabelText(/^Headline/), 'Plain Card');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/promotions')[0];
      expect(call?.body).toMatchObject({ background_focal_x: 50, background_focal_y: 50 });
    });
  });

  it('PromotionPreview anchors the card crop at the stored focal point', async () => {
    const banner = 'http://localhost:4000/uploads/promotions/supermarket.png';
    renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () =>
        ok({
          promotions: [
            promotion({
              title: 'Super Market',
              background_type: 'ARTWORK',
              background_image_url: banner,
              background_focal_x: 50,
              background_focal_y: 12,
            }),
          ],
        }),
    });
    await screen.findByText('What customers see now');

    const card = document.querySelector('.promo-preview:not(.promo-preview--compact)') as HTMLElement;
    expect(card).toHaveStyle({ backgroundPosition: '50% 12%' });
    expect(card.getAttribute('style')).toContain(banner);
  });

  it('a promotion with no focal point renders exactly as it does today: the centre', async () => {
    // The whole feature is additive. A row saved before migration 009 carries
    // no focal point, and 50% 50% IS `center` - the crop it already had.
    const legacy = promotion({
      title: 'Unchanged',
      background_type: 'IMAGE',
      background_image_url: 'http://localhost:4000/uploads/promotions/old.png',
    });
    delete legacy.background_focal_x;
    delete legacy.background_focal_y;

    renderAs(ADMIN_WITH_RIDER, '/catalog/promotions', {
      'GET /admin/promotions': () => ok({ promotions: [] }),
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /promotions': () => ok({ promotions: [legacy] }),
    });
    await screen.findByText('What customers see now');

    const card = document.querySelector('.promo-preview:not(.promo-preview--compact)') as HTMLElement;
    expect(card).toHaveStyle({ backgroundPosition: '50% 50%' });
    // And the IMAGE treatment is untouched: the same flat 0.66 ink scrim.
    expect(card.getAttribute('style')).toContain('rgba(16,19,25,0.66)');
  });
});
