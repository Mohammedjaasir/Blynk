import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct } from '../api/types';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/**
 * Product offer price (owner, 2026-10-09): a product on offer at a reduced
 * price with an optional end date, set from the product form and shown as a
 * badge in the Products list while the backend says it applies.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: 'p1',
    category_id: 'c1',
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
    custom_markup_percent: null,
    effective_markup_percent: 25,
    calculated_selling_price: 250,
    selling_price: 250,
    offer_price: null,
    offer_ends_at: null,
    offer_active: false,
    is_available: true,
    is_active: true,
    ...overrides,
  };
}

const CATEGORY = { id: 'c1', name: 'Rice', slug: 'rice', description: null, image_url: null, display_order: 1, is_active: true };

function openForm(existing: AdminProduct) {
  return renderAs(ADMIN_WITH_RIDER, `/catalog/products/${existing.id}`, {
    'GET /admin/categories': () => ok({ categories: [CATEGORY] }),
    'GET /admin/products/:id': () => ok({ product: existing }),
    'PATCH /admin/products/:id': (call) => ok({ product: { ...existing, ...call.body } }),
    'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
  });
}

describe('Product form - offer', () => {
  it('sets an offer with an end date, showing the % off live', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product());
    const offer = await screen.findByLabelText(/^Offer price \(LKR\)/);
    await user.type(offer, '220');
    expect(screen.getByText('12% off - customers pay LKR 220.00 instead of LKR 250.00.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Offer ends/), { target: { value: '2099-10-31' } });
    expect(screen.getByText('12% off - customers pay LKR 220.00 instead of LKR 250.00 until 31 Oct 2099.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = api.find('PATCH', '/admin/products/p1')[0];
      expect(call?.body).toMatchObject({ offer_price: 220, offer_ends_at: '2099-10-31T23:59:59+05:30' });
    });
  });

  it('sends no offer fields when the offer was not touched', async () => {
    const user = userEvent.setup();
    const { api } = openForm(
      product({ offer_price: 220, offer_ends_at: '2099-10-31T18:29:59.000Z', offer_active: true })
    );
    const offer = await screen.findByLabelText(/^Offer price \(LKR\)/);
    expect(offer).toHaveValue('220');
    // Stored end shown back as its Colombo day.
    expect(screen.getByLabelText(/^Offer ends/)).toHaveValue('2099-10-31');
    expect(screen.getByText('On offer now')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/products/p1')[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('offer_price');
    expect(body).not.toHaveProperty('offer_ends_at');
  });

  it('removes an offer by sending offer_price: null', async () => {
    const user = userEvent.setup();
    const { api } = openForm(
      product({ offer_price: 220, offer_ends_at: '2099-10-31T18:29:59.000Z', offer_active: true })
    );
    await screen.findByLabelText(/^Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'Remove offer' }));
    expect(screen.getByLabelText(/^Offer price \(LKR\)/)).toHaveValue('');
    expect(screen.getByText('The offer is removed when you save.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/products/p1')[0]!.body as Record<string, unknown>;
    expect(body.offer_price).toBeNull();
    expect(body).not.toHaveProperty('offer_ends_at');
  });

  it('refuses an offer that is not lower than the selling price, sending nothing', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product());
    const offer = await screen.findByLabelText(/^Offer price \(LKR\)/);
    await user.type(offer, '250');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The offer price must be lower than the selling price (LKR 250.00).')
    ).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('measures the offer against the selling price the form shows after a cost edit', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product());
    await user.type(await screen.findByLabelText(/^Offer price \(LKR\)/), '220');
    // 160 x 1.25 = 200, now below the offer.
    const cost = screen.getByLabelText('Purchase cost (LKR)');
    await user.clear(cost);
    await user.type(cost, '160');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The offer price must be lower than the selling price (LKR 200.00).')
    ).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('says when the stored offer has ended, and still saves an unrelated edit', async () => {
    const user = userEvent.setup();
    const { api } = openForm(
      product({ offer_price: 220, offer_ends_at: '2026-01-31T18:29:59.000Z', offer_active: false })
    );
    expect(await screen.findByText('Offer ended on 31 Jan 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0]!.body).not.toHaveProperty('offer_ends_at');
  });

  it('shows the server OFFER_PRICE_NOT_LOWER message', async () => {
    const user = userEvent.setup();
    const existing = product({ custom_markup_percent: null, effective_markup_percent: undefined });
    renderAs(ADMIN_WITH_RIDER, `/catalog/products/${existing.id}`, {
      'GET /admin/categories': () => ok({ categories: [CATEGORY] }),
      'GET /admin/products/:id': () => ok({ product: existing }),
      'PATCH /admin/products/:id': () => ({
        status: 400,
        error: { code: 'OFFER_PRICE_NOT_LOWER', message: 'The offer price must be lower than the selling price (LKR 240.00).' },
      }),
    });
    // No preview here, so the saved price (250) is the client-side yardstick.
    await user.type(await screen.findByLabelText(/^Offer price \(LKR\)/), '245');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The offer price must be lower than the selling price (LKR 240.00).')
    ).toBeInTheDocument();
  });
});

describe('Product form - offer as "LKR off" (owner, 2026-10-10)', () => {
  it('sends selling price - amount and says what customers pay', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product());
    await screen.findByLabelText(/^Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    expect(screen.getByRole('button', { name: 'LKR off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText(/^Offer price \(LKR\)/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Amount off \(LKR\)/), '50');
    expect(screen.getByText('Customers pay LKR 200.00 (was LKR 250.00).')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = api.find('PATCH', '/admin/products/p1')[0];
      expect(call?.body).toMatchObject({ offer_price: 200 });
    });
  });

  it('keeps 2 decimals: 250 - 49.5 = 200.50', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product());
    await screen.findByLabelText(/^Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    await user.type(screen.getByLabelText(/^Amount off \(LKR\)/), '49.5');
    expect(screen.getByText('Customers pay LKR 200.50 (was LKR 250.00).')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')[0]?.body).toMatchObject({ offer_price: 200.5 }));
  });

  it('refuses an amount that leaves no price, sending nothing', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product());
    await screen.findByLabelText(/^Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    await user.type(screen.getByLabelText(/^Amount off \(LKR\)/), '250');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The offer price must be more than LKR 0.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Amount off \(LKR\)/));
    await user.type(screen.getByLabelText(/^Amount off \(LKR\)/), '5.555');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use at most 2 decimals.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('a stored offer opens as its price; LKR off shows it as the amount off, unchanged', async () => {
    const user = userEvent.setup();
    const { api } = openForm(product({ offer_price: 220, offer_ends_at: null, offer_active: true }));
    expect(await screen.findByLabelText(/^Offer price \(LKR\)/)).toHaveValue('220');
    expect(screen.getByRole('button', { name: 'New price' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    expect(screen.getByLabelText(/^Amount off \(LKR\)/)).toHaveValue('30');
    expect(screen.getByText('Customers pay LKR 220.00 (was LKR 250.00).')).toBeInTheDocument();
    expect(screen.getByText('On offer now')).toBeInTheDocument();

    // Back to "New price" carries the same offer across.
    await user.click(screen.getByRole('button', { name: 'New price' }));
    expect(screen.getByLabelText(/^Offer price \(LKR\)/)).toHaveValue('220');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0]!.body).not.toHaveProperty('offer_price');
  });
});

describe('Products list - offer badge', () => {
  it('shows "Offer LKR x" only on products whose offer is active', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/products': () =>
        ok({
          products: [
            product({ id: 'p1', name: 'Samba Rice', offer_price: 220, offer_active: true }),
            product({ id: 'p2', name: 'Red Rice', sku: 'RICE-2', offer_price: 230, offer_active: false }),
          ],
          pagination: { page: 1, limit: 200 },
        }),
      'GET /admin/categories': () => ok({ categories: [CATEGORY] }),
    });
    const samba = (await screen.findByText('Samba Rice')).closest('li') as HTMLElement;
    expect(within(samba).getByText('Offer LKR 220.00')).toBeInTheDocument();
    const red = screen.getByText('Red Rice').closest('li') as HTMLElement;
    expect(within(red).queryByText(/^Offer LKR/)).not.toBeInTheDocument();
  });
});
