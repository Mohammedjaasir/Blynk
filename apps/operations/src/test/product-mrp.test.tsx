import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct, Category, StaffVariant } from '../api/types';
import { capAtMrp, mrpCappedNote, parseMrpInput } from '../lib/pricing';
import { parseImportRow } from '../lib/productImport';
import { TEMPLATE_COLUMNS } from '../lib/importTemplate';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/**
 * MRP in the Ops app (migration 048; owner, 2026-10-14): the product form's MRP
 * field with the "Capped at MRP (markup would give LKR X)" note, the size
 * dialog's MRP, the list's MRP and capped note, the import's mrp cell. Same
 * controls as the Admin site.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const RICE: Category = {
  id: 'rice',
  name: 'Rice',
  slug: 'rice',
  description: null,
  image_url: null,
  display_order: 1,
  is_active: true,
  parent_id: null,
  markup_percent: 25,
};

/** Cost 200 + category 25% = 250, capped at the MRP 240. */
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
    purchase_cost: 200,
    pricing_mode: 'MARKUP',
    fixed_selling_price: null,
    custom_markup_percent: null,
    category_markup_percent: 25,
    parent_category_markup_percent: null,
    global_markup_percent: 20,
    effective_markup_percent: 25,
    pricing_source: 'CATEGORY_MARKUP',
    calculated_selling_price: 240,
    selling_price: 240,
    computed_selling_price: 250,
    mrp: 240,
    mrp_capped: true,
    price_warning: null,
    is_available: true,
    is_active: true,
    ...overrides,
  };
}

describe('MRP helpers', () => {
  it('parse, cap and note', () => {
    expect(parseMrpInput('')).toEqual({ value: null });
    expect(parseMrpInput('120.5')).toEqual({ value: 120.5 });
    expect(parseMrpInput('0')).toHaveProperty('error');
    expect(capAtMrp(150, 120)).toEqual({ price: 120, capped: true });
    expect(capAtMrp(100, 120)).toEqual({ price: 100, capped: false });
    expect(mrpCappedNote('MARKUP', 1250)).toBe('Capped at MRP (markup would give LKR 1,250.00)');
    expect(mrpCappedNote('FIXED', 300)).toBe('Capped at MRP (fixed price LKR 300.00)');
  });

  it('import: the template has mrp; the cell is checked and sent only when filled', () => {
    expect(TEMPLATE_COLUMNS).toContain('mrp');
    const good = { name: 'Rice', category: 'Rice', unit: '1 kg', sku: 'R-1', purchase_cost: '100' };
    expect(parseImportRow({ ...good, mrp: '120' }, 2).data.mrp).toBe(120);
    expect(parseImportRow(good, 2).data).not.toHaveProperty('mrp');
    expect(parseImportRow({ ...good, mrp: '-1' }, 2).errors.map((e) => e.field)).toEqual(['mrp']);
  });
});

describe('Ops product form: MRP', () => {
  it('a capped product shows the note; an offer at the MRP is refused; mrp goes only when changed', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      'GET /admin/categories': () => ok({ categories: [RICE] }),
      'GET /admin/products/:id': () => ok({ product: product() }),
      'PATCH /admin/products/:id': () => ok({ product: product() }),
    });
    expect(await screen.findByLabelText(/^MRP \(LKR\)/)).toHaveValue('240');
    expect(screen.getByText('Selling price LKR 240.00 (the MRP)')).toBeInTheDocument();
    expect(screen.getByText('Capped at MRP (markup would give LKR 250.00)')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Offer price \(LKR\)/), '240');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The offer price must be lower than the selling price (LKR 240.00, capped at the MRP).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);

    await user.clear(screen.getByLabelText(/^Offer price \(LKR\)/));
    await user.type(screen.getByLabelText(/^Offer price \(LKR\)/), '230');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/products/p1')[0]!.body;
    expect(body).toMatchObject({ offer_price: 230 });
    expect(body).not.toHaveProperty('mrp');
  });

  it('raising the MRP above the price lifts the cap and sends the new MRP', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      'GET /admin/categories': () => ok({ categories: [RICE] }),
      'GET /admin/products/:id': () => ok({ product: product() }),
      'PATCH /admin/products/:id': () => ok({ product: product({ mrp: 300, mrp_capped: false }) }),
    });
    const field = await screen.findByLabelText(/^MRP \(LKR\)/);
    await user.clear(field);
    await user.type(field, '300');
    expect(screen.queryByText(/Capped at MRP/)).not.toBeInTheDocument();
    expect(screen.getByText(/Below the MRP \(LKR 300.00\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0]!.body).toMatchObject({ mrp: 300 });
  });

  it('a size: MRP field with the capped preview; mrp in the POST', async () => {
    const user = userEvent.setup();
    const created: StaffVariant = {
      id: 'v1', product_id: 'p1', label: '5 kg', sku: null, barcode: null, sort_order: 0, is_active: true, is_available: true,
      purchase_cost: 1000, pricing_mode: 'MARKUP', fixed_selling_price: null, custom_markup_percent: null,
      product_markup_percent: null, category_markup_percent: 25, parent_category_markup_percent: null, global_markup_percent: 20,
      effective_markup_percent: 25, pricing_source: 'CATEGORY_MARKUP', selling_price: 1200, computed_selling_price: 1250,
      mrp: 1200, mrp_capped: true, price_warning: null, offer_price: null, offer_ends_at: null, offer_active: false,
      stock: { inventory_id: null, tracked: false, on_hand: 0, reserved: 0, in_open_orders: 0, sellable: null, low_stock_threshold: 5, is_low_stock: false, is_out_of_stock: false },
    } as StaffVariant;
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      'GET /admin/categories': () => ok({ categories: [RICE] }),
      'GET /admin/products/:id': () => ok({ product: product({ mrp: null, mrp_capped: false, calculated_selling_price: 250, variants: [] }) }),
      'POST /admin/products/:id/variants': () => ({ status: 201, data: { variant: created } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add variant' }));
    const dialog = screen.getByRole('dialog', { name: 'Add variant' });
    await user.type(within(dialog).getByLabelText(/^Variant name/), '5 kg');
    await user.type(within(dialog).getByLabelText('Variant purchase cost (LKR)'), '1000');
    await user.type(within(dialog).getByLabelText(/^MRP \(LKR\)/), '1200');
    expect(within(dialog).getByText('Selling price LKR 1200.00 (the MRP)')).toBeInTheDocument();
    expect(within(dialog).getByText('Capped at MRP (markup would give LKR 1,250.00)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(api.find('POST', '/admin/products/p1/variants')).toHaveLength(1));
    expect(api.find('POST', '/admin/products/p1/variants')[0]!.body).toMatchObject({ label: '5 kg', mrp: 1200 });
    expect(await screen.findByText('Capped at MRP (markup would give LKR 1,250.00)')).toBeInTheDocument();
  });
});

describe('Ops products list: MRP', () => {
  it('shows the MRP on the price line and the capped note', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/categories': () => ok({ categories: [RICE] }),
      'GET /admin/products': () =>
        ok({
          products: [product(), product({ id: 'p2', name: 'Kekulu Rice', mrp: null, mrp_capped: false, calculated_selling_price: 250 })],
          pagination: { page: 1, limit: 200 },
        }),
    });
    const samba = (await screen.findByText('Samba Rice')).closest('li') as HTMLElement;
    expect(samba).toHaveTextContent('MRP LKR 240.00');
    expect(samba).toHaveTextContent('Capped at MRP (markup would give LKR 250.00)');
    const kekulu = screen.getByText('Kekulu Rice').closest('li') as HTMLElement;
    expect(kekulu).not.toHaveTextContent('MRP');
  });
});
