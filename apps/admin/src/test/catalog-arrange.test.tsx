import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Categories } from '../pages/Categories';
import { ArrangeProducts, moved } from '../pages/ArrangeProducts';
import { tokenStore } from '../api/client';
import type { ArrangeProduct, Category } from '../api/types';
import { fail, mockApi, ok } from './mockApi';

/**
 * Arrange (owner, 2026-10-10): category order (PUT /admin/categories/order,
 * one sibling set at a time) and a category's product order
 * (GET/PUT /admin/categories/:id/product-order).
 */

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
  } as Category;
}

const CATEGORIES = [
  category('c1', 'Grocery', 10),
  category('c2', 'Dairy', 20),
  category('c4', 'Milk', 10, 'c2'),
  category('c5', 'Eggs', 20, 'c2'),
  category('c3', 'Snacks', 30),
];

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
  product('p2', 'Cheese', { is_available: false }),
  product('p3', 'Fresh milk', { category_id: 'c4', category_name: 'Milk', pack_size: '1 L' }),
];

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/categories" element={<Categories />} />
          <Route path="/categories/:id/arrange" element={<ArrangeProducts />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('moved()', () => {
  it('moves an item and leaves impossible moves alone', () => {
    expect(moved(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    const same = ['a'];
    expect(moved(same, 0, 1)).toBe(same);
  });
});

describe('Categories: Arrange mode', () => {
  it('moves a top-level category down and saves only the top-level order on "Save order"', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.method === 'PUT' && c.path === '/admin/categories/order') return ok({ categories: [] });
      return undefined;
    });
    renderAt('/categories');
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    expect(screen.getByRole('button', { name: 'Move Grocery up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Milk up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Eggs down' })).toBeDisabled();
    // Nothing moved yet: nothing to save.
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Grocery down' }));
    // The draft shows the new order at once; nothing is sent until Save order.
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(names[0]).toContain('Dairy');
    expect(names[3]).toContain('Grocery');
    expect(api.find('PUT', '/admin/categories/order')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/order')[0].body).toEqual({ ids: ['c2', 'c1', 'c3'] });
    expect(await screen.findByText('Category order saved.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Arrange' })).toBeInTheDocument();
  }, 20_000);

  it('several moves in two levels save one request per changed level; Cancel saves nothing', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.method === 'PUT' && c.path === '/admin/categories/order') return ok({ categories: [] });
      return undefined;
    });
    renderAt('/categories');
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Snacks to the top' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.find('PUT', '/admin/categories/order')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Snacks to the top' }));
    await user.click(screen.getByRole('button', { name: 'Move Eggs up' }));
    await user.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(2));
    expect(api.find('PUT', '/admin/categories/order').map((c) => c.body)).toEqual([{ ids: ['c3', 'c1', 'c2'] }, { ids: ['c5', 'c4'] }]);
  }, 20_000);

  it('a refused save shows as a toast and reloads the saved order', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
      if (c.method === 'PUT' && c.path === '/admin/categories/order')
        return fail(400, 'MIXED_CATEGORY_LEVELS', 'Arrange one level at a time.');
      return undefined;
    });
    renderAt('/categories');
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Eggs to the top' }));
    await user.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/order')[0].body).toEqual({ ids: ['c5', 'c4'] });
    expect(await screen.findByText(/Arrange one level at a time/)).toBeInTheDocument();
  }, 20_000);

  it('the table lines up: one cell per header in every row, name with its slug, no block-level cells', async () => {
    mockApi((c) =>
      c.method === 'GET' && c.path === '/admin/categories'
        ? ok({ categories: CATEGORIES.map((cat) => ({ ...cat, description: `${cat.name} things`, product_count: 3 })) })
        : undefined
    );
    renderAt('/categories');
    await screen.findByText('Grocery');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Description', 'Markup', 'Products', 'Status', 'Actions']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(CATEGORIES.length);
    for (const row of rows) {
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(headers.length);
      // The root cause of the broken live table: a <td> with a display:block class.
      for (const cell of cells) expect(cell.className).not.toMatch(/cell__(primary|secondary|note)/);
    }
    const dairy = within(rows[1]).getAllByRole('cell');
    expect(dairy[0]).toHaveTextContent('Dairy');
    expect(dairy[0]).toHaveTextContent('dairy');
    expect(dairy[1]).toHaveTextContent('Dairy things');
    expect(dairy[3]).toHaveTextContent('3');
    expect(dairy[4]).toHaveTextContent('Active');
    expect(within(dairy[5]).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    const milk = within(rows[2]).getAllByRole('cell');
    expect(milk[0]).toHaveTextContent('in Dairy');
  }, 20_000);

  it('the stylesheet keeps table cells as table cells', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');
    expect(css).toMatch(/td\.cell__primary,\s*td\.cell__secondary,[\s\S]*?display:\s*table-cell/);
  }, 20_000);

  it('every category links to its Arrange products screen', async () => {
    mockApi((c) => (c.method === 'GET' && c.path === '/admin/categories' ? ok({ categories: CATEGORIES }) : undefined));
    renderAt('/categories');
    expect(await screen.findByRole('link', { name: 'Arrange products in Dairy' })).toHaveAttribute(
      'href',
      '/categories/c2/arrange'
    );
  });
});

describe('Arrange products', () => {
  it('lists products in customer order and saves the new full order', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories/c2/product-order')
        return ok({ category: { id: 'c2', name: 'Dairy', parent_id: null }, products: PRODUCTS });
      if (c.method === 'PUT' && c.path === '/admin/categories/c2/product-order')
        return ok({
          category: { id: 'c2', name: 'Dairy', parent_id: null },
          products: (c.body.product_ids as string[]).map((id, i) => ({ ...PRODUCTS.find((p) => p.id === id)!, display_order: i + 1 })),
        });
      return undefined;
    });
    renderAt('/categories/c2/arrange');
    expect(await screen.findByRole('heading', { name: 'Arrange products: Dairy' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Products in order' });
    expect(within(table).getByText('1 L · In Milk')).toBeInTheDocument();
    expect(within(table).getByText('Sold out')).toBeInTheDocument();
    expect(within(table).getAllByText('LKR 120')).toHaveLength(3);
    const save = screen.getByRole('button', { name: 'Save order' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Fresh milk to the top' }));
    await user.click(screen.getByRole('button', { name: 'Move Cheese up' }));
    await user.click(save);
    await waitFor(() => expect(api.find('PUT', '/admin/categories/c2/product-order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/c2/product-order')[0].body).toEqual({ product_ids: ['p3', 'p2', 'p1'] });
    expect(await screen.findByText(/Order saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();
  });

  it('Sort A-Z and Discard changes work on screen only', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) =>
      c.method === 'GET' && c.path === '/admin/categories/c2/product-order'
        ? ok({
            category: { id: 'c2', name: 'Dairy', parent_id: null },
            products: [PRODUCTS[2], PRODUCTS[0], PRODUCTS[1]].map((p, i) => ({ ...p, display_order: i + 1 })),
          })
        : undefined
    );
    renderAt('/categories/c2/arrange');
    await screen.findByRole('heading', { name: 'Arrange products: Dairy' });
    const names = () =>
      within(screen.getByRole('table', { name: 'Products in order' }))
        .getAllByText(/^(Butter|Cheese|Fresh milk)$/)
        .map((el) => el.textContent);
    expect(names()).toEqual(['Fresh milk', 'Butter', 'Cheese']);
    await user.click(screen.getByRole('button', { name: 'Sort A-Z' }));
    expect(names()).toEqual(['Butter', 'Cheese', 'Fresh milk']);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(names()).toEqual(['Fresh milk', 'Butter', 'Cheese']);
    expect(api.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});
