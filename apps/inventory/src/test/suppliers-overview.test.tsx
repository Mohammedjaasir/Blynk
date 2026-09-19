import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import { ADMIN, STAFF, fail, ok, pageOf, renderAs, stockRow, supplier } from './helpers';

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

const SUPPLIERS = [supplier(), supplier({ id: 'sup-2', name: 'Old Market Stall', code: 'SUP-OLD', is_active: false })];

describe('suppliers', () => {
  it('is read-only for packing staff', async () => {
    renderAs(STAFF, '/suppliers', { 'GET /admin/suppliers': () => ok({ suppliers: SUPPLIERS.slice(0, 1) }) });
    expect(await screen.findByText('Dharga Town Central Grocery')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add supplier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText(/added and changed by a Blynk admin/)).toBeInTheDocument();
  });

  it('shows all suppliers, inactive included, when asked', async () => {
    const { api } = renderAs(ADMIN, '/suppliers', {
      'GET /admin/suppliers': (call) =>
        ok({ suppliers: call.query.get('active_only') === 'false' ? SUPPLIERS : SUPPLIERS.slice(0, 1) }),
    });
    await screen.findByText('Dharga Town Central Grocery');
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Old Market Stall')).toBeInTheDocument();
    expect(within(screen.getByText('Old Market Stall').closest('tr')!).getByText('Inactive')).toBeInTheDocument();
    expect(api.find('GET', '/admin/suppliers').at(-1)!.query.get('active_only')).toBe('false');
  });

  it('lets an admin add a supplier, sending only the filled fields', async () => {
    const { api } = renderAs(ADMIN, '/suppliers', {
      'POST /admin/suppliers': (call) => ok({ supplier: supplier({ ...call.body, id: 'sup-new' }) }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Add supplier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add supplier' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Galle Road Vegetables');
    await userEvent.type(within(dialog).getByLabelText(/Code/), 'SUP-GALLE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add supplier' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/suppliers')[0]?.body).toEqual({ name: 'Galle Road Vegetables', code: 'SUP-GALLE' })
    );
  });

  it('shows a duplicate code next to the code field', async () => {
    renderAs(ADMIN, '/suppliers', {
      'POST /admin/suppliers': () => fail(409, 'SUPPLIER_CODE_TAKEN', 'Another supplier already uses this code.'),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Add supplier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add supplier' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Duplicate Grocery');
    await userEvent.type(within(dialog).getByLabelText(/Code/), 'SUP-DHARGA-MAIN');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add supplier' }));
    expect(await within(dialog).findByText('Another supplier already uses this code.')).toBeInTheDocument();
  });

  it('validates the name before calling the API', async () => {
    const { api } = renderAs(ADMIN, '/suppliers');
    await userEvent.click(await screen.findByRole('button', { name: 'Add supplier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add supplier' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'A');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add supplier' }));
    expect(await within(dialog).findByText('Name must be at least 2 characters.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/suppliers')).toHaveLength(0);
  });

  it('edits and deactivates (there is no delete)', async () => {
    const { api } = renderAs(ADMIN, '/suppliers', {
      'GET /admin/suppliers': () => ok({ suppliers: SUPPLIERS.slice(0, 1) }),
      'PATCH /admin/suppliers/:id': (call) => ok({ supplier: supplier(call.body) }),
    });
    const row = (await screen.findByText('Dharga Town Central Grocery')).closest('tr')!;
    expect(within(row).queryByRole('button', { name: /Delete/ })).toBeNull();

    await userEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate supplier' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/suppliers/sup-1')[0]?.body).toEqual({ is_active: false }));
  });
});

describe('overview', () => {
  it('puts orderable-but-out-of-stock first and explains what it means', async () => {
    renderAs(ADMIN, '/', {
      'GET /admin/inventory': () =>
        ok(
          pageOf('inventory', [
            stockRow({ product_id: 'p-butter', product_name: 'Pelwatte Salted Butter 200g', quantity_on_hand: 3, quantity_available: 3, is_low_stock: true }),
            stockRow({ product_id: 'p-crackers', product_name: 'Munchee Super Cream Cracker 490g', quantity_on_hand: 0, quantity_available: 0, is_low_stock: true }),
          ])
        ),
    });
    const list = await screen.findByRole('list', { name: '' }).catch(() => null);
    await screen.findByText('Munchee Super Cream Cracker 490g');
    const names = screen.getAllByRole('link').filter((a) => a.className.includes('attention-list__name')).map((a) => a.textContent);
    expect(names).toEqual(['Munchee Super Cream Cracker 490g', 'Pelwatte Salted Butter 200g']);
    expect(screen.getByText(/1 product is orderable but out of stock/)).toBeInTheDocument();
    expect(list).toBeDefined();
  });

  it('says what an empty overview means instead of showing blank space', async () => {
    renderAs(STAFF, '/');
    expect(await screen.findByText('No tracked product is low or out of stock.')).toBeInTheDocument();
    expect(await screen.findByText('Nothing waiting to be sourced.')).toBeInTheDocument();
    expect(await screen.findByText('No stock movements recorded yet.')).toBeInTheDocument();
  });
});
