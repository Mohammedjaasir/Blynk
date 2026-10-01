import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category } from '../api/types';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/** Delete product / delete category (API contract §1). */

// These screens render behind the full auth + shell boot; under a loaded,
// fully parallel suite that cold start can outlast the 1s/5s defaults.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: 'p1',
    category_id: 'c1',
    category_name: 'Dairy',
    name: 'Kotmale Fresh Milk 1L',
    slug: 'kotmale-fresh-milk-1l',
    sku: 'KOT-1L',
    barcode: null,
    unit: '1 L',
    pack_size: null,
    description: null,
    image_url: null,
    purchase_cost: 300,
    custom_markup_percent: null,
    calculated_selling_price: 360,
    is_available: true,
    is_active: true,
    ...overrides,
  } as AdminProduct;
}

function category(id: string, name: string, product_count: number): Category {
  return { id, name, slug: name.toLowerCase(), description: null, image_url: null, display_order: 1, is_active: true, product_count };
}

describe('Delete product', () => {
  it('confirms with the contract copy, sends DELETE and refreshes the list', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /admin/products': () => ok({ products: deleted ? [] : [product()], pagination: {} }),
      'DELETE /admin/products/:id': () => {
        deleted = true;
        return ok({ product_id: 'p1', mode: 'SOFT' });
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Delete Kotmale Fresh Milk 1L' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete product' }));
    expect(dialog.getByText('Delete Kotmale Fresh Milk 1L? Customers will no longer see it.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.find('DELETE', '/admin/products/p1')).toHaveLength(1));
    expect(await screen.findByText(/was deleted\. Its past orders keep their history\./)).toBeInTheDocument();
    expect(await screen.findByText('No products match')).toBeInTheDocument();
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /admin/products': () => ok({ products: [product()], pagination: {} }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Kotmale Fresh Milk 1L' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete product' })).getByRole('button', { name: 'Cancel' }));
    expect(api.find('DELETE', '/admin/products/p1')).toHaveLength(0);
  });

  it('links to the Import screen', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /admin/products': () => ok({ products: [], pagination: {} }),
    });
    expect(await screen.findByRole('link', { name: 'Import' })).toHaveAttribute('href', '/catalog/products/import');
  });
});

describe('Delete category', () => {
  it('an empty category is a plain confirm', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [category('c1', 'Dairy', 0), category('c2', 'Bakery', 3)] }),
      'DELETE /admin/categories/:id': () => ok({ category_id: 'c1', moved_product_count: 0, mode: 'HARD' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Dairy' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete category' }));
    expect(dialog.getByText('Delete Dairy? Customers will no longer see it.')).toBeInTheDocument();
    expect(dialog.queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c1')).toHaveLength(1));
    expect(api.find('DELETE', '/admin/categories/c1')[0].query).toEqual({});
    expect(await screen.findByText('Dairy was deleted.')).toBeInTheDocument();
    // The list is reloaded after the delete.
    expect(api.find('GET', '/admin/categories').length).toBeGreaterThanOrEqual(2);
  });

  it('a category with products needs a move target (query param) before Delete is enabled', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () =>
        ok({ categories: [category('c1', 'Dairy', 4), category('c2', 'Bakery', 3), category('c3', 'Fruit', 0)] }),
      'DELETE /admin/categories/:id': () => ok({ category_id: 'c1', moved_product_count: 4, mode: 'HARD' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Dairy' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete category' }));
    const select = dialog.getByLabelText('Move its 4 products to:');
    const del = dialog.getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
    // Only the other categories are offered.
    expect(within(select).queryByRole('option', { name: 'Dairy' })).not.toBeInTheDocument();

    await user.selectOptions(select, 'c3');
    expect(del).toBeEnabled();
    await user.click(del);

    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c1')).toHaveLength(1));
    expect(api.find('DELETE', '/admin/categories/c1')[0].query).toEqual({ move_to_category_id: 'c3' });
    expect(await screen.findByText('Dairy was deleted. 4 products moved to Fruit.')).toBeInTheDocument();
  });

  it('409 CATEGORY_NOT_EMPTY reveals the move select with the server count', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      // An older list without product_count.
      'GET /admin/categories': () =>
        ok({ categories: [{ ...category('c1', 'Dairy', 0), product_count: undefined }, category('c2', 'Bakery', 1)] }),
      'DELETE /admin/categories/:id': () => {
        calls += 1;
        return calls === 1
          ? { status: 409, error: { code: 'CATEGORY_NOT_EMPTY', message: 'Category has products', details: { product_count: 2 } } }
          : ok({ category_id: 'c1', moved_product_count: 2, mode: 'HARD' });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Dairy' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete category' }));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    const select = await dialog.findByLabelText('Move its 2 products to:');
    expect(dialog.getByText('This category still has products. Choose where to move them first.')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.selectOptions(select, 'c2');
    await user.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/categories/c1')).toHaveLength(2));
    expect(api.find('DELETE', '/admin/categories/c1')[1].query).toEqual({ move_to_category_id: 'c2' });
  });
});
