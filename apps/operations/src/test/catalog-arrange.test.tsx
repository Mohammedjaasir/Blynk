import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { ArrangeProduct, Category } from '../api/types';
import { moved } from '../pages/Catalog/ArrangeProducts';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Arrange (owner, 2026-10-10): category order (PUT /admin/categories/order,
 * one sibling set at a time) and a category's product order
 * (GET/PUT /admin/categories/:id/product-order).
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function category(id: string, name: string, order: number, parentId: string | null = null): Category {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: null,
    image_url: null,
    display_order: order,
    is_active: true,
    product_count: 0,
    parent_id: parentId,
  };
}

const GROCERY = category('c1', 'Grocery', 10);
const DAIRY = category('c2', 'Dairy', 20);
const SNACKS = category('c3', 'Snacks', 30);
const MILK = category('c4', 'Milk', 10, 'c2');
const EGGS = category('c5', 'Eggs', 20, 'c2');
const CATEGORIES = [GROCERY, DAIRY, MILK, EGGS, SNACKS];

function product(id: string, name: string, overrides: Partial<ArrangeProduct> = {}): ArrangeProduct {
  return {
    id,
    name,
    category_id: 'c2',
    category_name: 'Dairy',
    unit: '1 pc',
    pack_size: null,
    image_url: null,
    image_focal_x: 50,
    image_focal_y: 50,
    selling_price: 120,
    is_active: true,
    is_available: true,
    display_order: null,
    ...overrides,
  };
}

const PRODUCTS = [
  product('p1', 'Butter'),
  product('p2', 'Cheese'),
  product('p3', 'Fresh milk', { category_id: 'c4', category_name: 'Milk', pack_size: '1 L' }),
];

describe('moved()', () => {
  it('moves an item to a new index and leaves impossible moves alone', () => {
    expect(moved(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    const same = ['a', 'b'];
    expect(moved(same, 0, -1)).toBe(same);
    expect(moved(same, 1, 2)).toBe(same);
  });
});

describe('Categories: Arrange mode', () => {
  it('moves a top-level category up and saves the top-level order only', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'PUT /admin/categories/order': () => ok({ categories: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    expect(screen.getByRole('button', { name: 'Move Grocery up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Snacks down' })).toBeDisabled();
    // Sub-categories move only within their parent.
    expect(screen.getByRole('button', { name: 'Move Milk up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Eggs down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Snacks up' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/order')[0].body).toEqual({ ids: ['c1', 'c3', 'c2'] });
    // The list reloads from the server afterwards.
    await waitFor(() => expect(api.find('GET', '/admin/categories').length).toBeGreaterThanOrEqual(2));
  });

  it('"Top" moves a sub-category to the top of its parent', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'PUT /admin/categories/order': () => ok({ categories: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Eggs to the top' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/order')[0].body).toEqual({ ids: ['c5', 'c4'] });
  });

  it('shows a refusal from the server', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'PUT /admin/categories/order': () => fail(400, 'MIXED_CATEGORY_LEVELS', 'Arrange one level at a time.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Dairy down' }));
    expect(await screen.findByText(/Arrange one level at a time/)).toBeInTheDocument();
  });

  it('every category links to its Arrange products screen', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
    });
    const link = await screen.findByRole('link', { name: 'Arrange products in Dairy' });
    expect(link).toHaveAttribute('href', '/catalog/categories/c2/arrange');
  });
});

describe('Arrange products', () => {
  it('lists the products in customer order with price and sub-category, and saves the new order', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories/c2/arrange', {
      'GET /admin/categories/:id/product-order': () =>
        ok({ category: { id: 'c2', name: 'Dairy', parent_id: null }, products: PRODUCTS }),
      'PUT /admin/categories/:id/product-order': (call) =>
        ok({
          category: { id: 'c2', name: 'Dairy', parent_id: null },
          products: (call.body.product_ids as string[]).map((id, i) => ({
            ...PRODUCTS.find((p) => p.id === id)!,
            display_order: i + 1,
          })),
        }),
    });
    expect(await screen.findByRole('heading', { name: 'Arrange products: Dairy' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Products in order' });
    expect(within(list).getAllByRole('listitem').map((li) => within(li).getByText(/Butter|Cheese|Fresh milk/).textContent)).toEqual([
      'Butter',
      'Cheese',
      'Fresh milk',
    ]);
    expect(screen.getByText('1 L · LKR 120')).toBeInTheDocument();
    expect(screen.getByText('In Milk')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save order' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Fresh milk to the top' }));
    await user.click(screen.getByRole('button', { name: 'Move Butter down' }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.find('PUT', '/admin/categories/c2/product-order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/c2/product-order')[0].body).toEqual({ product_ids: ['p3', 'p2', 'p1'] });
    expect(await screen.findByText(/Order saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();
  });

  it('Discard changes puts the saved order back; Sort A-Z sorts by name', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/categories/c2/arrange', {
      'GET /admin/categories/:id/product-order': () =>
        ok({
          category: { id: 'c2', name: 'Dairy', parent_id: null },
          products: [PRODUCTS[2], PRODUCTS[0], PRODUCTS[1]].map((p, i) => ({ ...p, display_order: i + 1 })),
        }),
    });
    await screen.findByRole('heading', { name: 'Arrange products: Dairy' });
    const names = () =>
      within(screen.getByRole('list', { name: 'Products in order' }))
        .getAllByRole('listitem')
        .map((li) => within(li).getByText(/Butter|Cheese|Fresh milk/).textContent);
    expect(names()).toEqual(['Fresh milk', 'Butter', 'Cheese']);
    await user.click(screen.getByRole('button', { name: 'Sort A-Z' }));
    expect(names()).toEqual(['Butter', 'Cheese', 'Fresh milk']);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(names()).toEqual(['Fresh milk', 'Butter', 'Cheese']);
  });

  it('shows a load failure', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/categories/zz/arrange', {
      'GET /admin/categories/:id/product-order': () => fail(404, 'CATEGORY_NOT_FOUND', 'Category not found.'),
    });
    expect(await screen.findByText(/Category not found/)).toBeInTheDocument();
  });
});
