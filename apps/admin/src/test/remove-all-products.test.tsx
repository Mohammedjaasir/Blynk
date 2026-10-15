import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../auth/AuthContext';
import { tokenStore } from '../api/client';
import { Products } from '../pages/Products';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Products -> "Remove all products" (owner, 2026-10-14; ADMIN only;
 * docs/api/catalog-tools.md §5). The API contract is tested in the backend
 * suite (tests/remove-all-products.test.ts).
 */

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const PREVIEW = {
  products: 120,
  variants: 14,
  products_with_images: 80,
  combos: 3,
  promotions: 2,
  banners_linked: 0,
  stock_alerts: 5,
  open_orders: 4,
  products_in_open_orders: 9,
  images: { products: 82, combos: 1, files: 70, files_on_disk: 68, external_links: 0 },
};
const RESULT = {
  products_removed: 120,
  variants_removed: 14,
  combos_switched_off: 3,
  promotions_switched_off: 2,
  stock_alerts_cleared: 5,
  open_orders_kept: 4,
  images: { products_cleared: 82, combos_cleared: 1, files_deleted: 66, files_missing: 2, files_kept_in_use: 2 },
};

function renderProducts(role: 'ADMIN' | 'OPERATIONS', onRemove?: (c: Call) => Reply) {
  let products = [{ id: 'p1', name: 'Milk', category_id: 'c1', image_url: null, is_active: true, sku: 'M1' }];
  const api = mockApi((c) => {
    if (c.path === '/auth/me') return ok({ id: 'u1', phone: null, full_name: 'Owner', email: 'o@blynk.lk', role });
    if (c.path === '/admin/categories') return ok({ categories: [] });
    if (c.method === 'GET' && c.path === '/admin/products') return ok({ products });
    if (c.method === 'GET' && c.path === '/admin/products/remove-all/preview') return ok(PREVIEW);
    if (c.method === 'POST' && c.path === '/admin/products/remove-all') {
      if (onRemove) return onRemove(c);
      products = [];
      return ok(c.body.also_remove_images ? RESULT : { ...RESULT, images: null });
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

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Remove all products' }));
  const dialog = screen.getByRole('dialog', { name: 'Remove all products' });
  await within(dialog).findByLabelText('What will change');
  return dialog;
}

const confirmBox = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Type DELETE ALL PRODUCTS to confirm' });
const redButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Remove all products' });

describe('Remove all products', () => {
  it('is hidden for anyone but ADMIN', async () => {
    const api = renderProducts('OPERATIONS');
    await waitFor(() => expect(api.find('GET', '/auth/me')).toHaveLength(1));
    await screen.findByText('Milk');
    expect(screen.queryByRole('button', { name: 'Remove all products' })).toBeNull();
    expect(api.find('GET', '/admin/products/remove-all/preview')).toHaveLength(0);
  });

  it('shows the counts and what happens, and needs DELETE ALL PRODUCTS typed exactly', async () => {
    const user = userEvent.setup();
    renderProducts('ADMIN');
    const dialog = await openDialog(user);
    const counts = within(dialog).getByLabelText('What will change');
    expect(within(counts).getByText('Products').nextSibling).toHaveTextContent('120');
    expect(within(counts).getByText('Sizes/packs').nextSibling).toHaveTextContent('14');
    expect(within(counts).getByText('Open orders').nextSibling).toHaveTextContent('4');
    expect(within(dialog).getByText(/hidden everywhere/)).toBeInTheDocument();
    expect(within(dialog).getByText(/the 4 open orders can still be packed and delivered/)).toBeInTheDocument();
    expect(within(dialog).getByText(/The same SKUs can be loaded again with Bulk upload/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Categories, settings, customers and riders stay as they are/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /Also delete product images/ })).toBeChecked();
    expect(within(dialog).getByText(/70 uploaded files \(68 on disk\)/)).toBeInTheDocument();

    expect(redButton(dialog)).toBeDisabled();
    for (const wrong of ['delete all products', 'REMOVE']) {
      await user.clear(confirmBox(dialog));
      await user.type(confirmBox(dialog), wrong);
      expect(redButton(dialog)).toBeDisabled();
    }
    await user.clear(confirmBox(dialog));
    await user.type(confirmBox(dialog), 'DELETE ALL PRODUCTS');
    expect(redButton(dialog)).toBeEnabled();
  }, 20_000);

  it('sends also_remove_images true by default, shows the result and re-reads the list', async () => {
    const user = userEvent.setup();
    const api = renderProducts('ADMIN');
    const dialog = await openDialog(user);
    await user.type(confirmBox(dialog), 'DELETE ALL PRODUCTS');
    const listReads = api.find('GET', '/admin/products').length;
    await user.click(redButton(dialog));
    await waitFor(() => expect(api.find('POST', '/admin/products/remove-all')).toHaveLength(1));
    expect(api.find('POST', '/admin/products/remove-all')[0]!.body).toEqual({ confirm: 'DELETE ALL PRODUCTS', also_remove_images: true });
    expect(await within(dialog).findByText(/120 products removed \(with 14 sizes\/packs\)/)).toBeInTheDocument();
    expect(within(dialog).getByText('3 combo packs switched off')).toBeInTheDocument();
    expect(within(dialog).getByText('2 home banners switched off')).toBeInTheDocument();
    expect(within(dialog).getByText('4 open orders kept as they are')).toBeInTheDocument();
    expect(within(dialog).getByText(/Images cleared from 82 products; 66 files deleted/)).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/products').length).toBeGreaterThan(listReads));
  });

  it('keeps the images when the box is unticked', async () => {
    const user = userEvent.setup();
    const api = renderProducts('ADMIN');
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('checkbox', { name: /Also delete product images/ }));
    await user.type(confirmBox(dialog), 'DELETE ALL PRODUCTS');
    await user.click(redButton(dialog));
    await waitFor(() => expect(api.find('POST', '/admin/products/remove-all')).toHaveLength(1));
    expect(api.find('POST', '/admin/products/remove-all')[0]!.body).toEqual({ confirm: 'DELETE ALL PRODUCTS', also_remove_images: false });
    expect(await within(dialog).findByText('Product images kept')).toBeInTheDocument();
  });

  it('shows the API error and lets the operator try again', async () => {
    const user = userEvent.setup();
    renderProducts('ADMIN', () => fail(403, 'FORBIDDEN', 'Only Admin can do this.'));
    const dialog = await openDialog(user);
    await user.type(confirmBox(dialog), 'DELETE ALL PRODUCTS');
    await user.click(redButton(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only Admin can do this.');
    expect(redButton(dialog)).toBeEnabled();
  });
});
