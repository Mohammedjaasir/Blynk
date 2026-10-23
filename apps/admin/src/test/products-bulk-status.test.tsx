import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../auth/AuthContext';
import { tokenStore } from '../api/client';
import { Products } from '../pages/Products';
import { mockApi, ok } from './mockApi';

/**
 * Products -> tick products, then Disable / Enable / Make unavailable / Make available in one go
 * (owner, 2026-10-23: "bulk select products and make them available or unavailable"), and the
 * "LKR 1 or less" filter that finds the placeholder-priced ones. The API contract is tested in
 * backend/api/tests/catalog-bulk-status.test.ts.
 */
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const P = (id: string, name: string, price: number) => ({
  id,
  name,
  sku: id.toUpperCase(),
  unit: '1 pc',
  category_id: 'c1',
  image_url: null,
  is_active: true,
  is_available: true,
  calculated_selling_price: price,
});

function renderProducts() {
  const api = mockApi((c) => {
    if (c.path === '/auth/me') return ok({ id: 'u1', phone: null, full_name: 'Owner', email: 'o@blynk.lk', role: 'ADMIN' });
    if (c.path === '/admin/categories') return ok({ categories: [] });
    if (c.method === 'GET' && c.path === '/admin/products') return ok({ products: [P('p1', 'Milk', 250), P('p2', 'Test juice', 1), P('p3', 'Test rice', 1)] });
    if (c.method === 'PATCH' && c.path === '/admin/products/bulk-status') return ok({ matched: c.body.ids.length, changed: c.body.ids.length, switched_on: 0 });
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

describe('Products bulk select', () => {
  it('filters the LKR 1 products, selects them all and makes them unavailable in one call', async () => {
    const user = userEvent.setup();
    const api = renderProducts();
    await screen.findByText('Milk');
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Filter by price'), 'placeholder');
    expect(screen.queryByText('Milk')).toBeNull();
    expect(screen.getByText('Test juice')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Select all shown products'));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Disable' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('2 selected products will be hidden from the customer app');
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/products/bulk-status')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/bulk-status')[0]!.body).toEqual({ ids: ['p2', 'p3'], is_active: false });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull());
  });

  it('ticks single products and sends the availability switch', async () => {
    const user = userEvent.setup();
    const api = renderProducts();
    await screen.findByText('Milk');
    await user.click(screen.getByLabelText('Select Milk'));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Make available' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make available' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/bulk-status')[0]?.body).toEqual({ ids: ['p1'], is_available: true }));
  });
});
