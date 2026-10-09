import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { ProductForm } from '../pages/ProductForm';
import { Products } from '../pages/Products';
import { fail, mockApi, ok } from './mockApi';

/**
 * Product offer price (owner, 2026-10-09): a reduced price with an optional
 * end day. The backend is the authority; the form previews and pre-checks.
 */
const CATEGORY = { id: 'c1', name: 'Groceries', slug: 'groceries', description: null, image_url: null, display_order: 0, is_active: true };
const RICE = {
  id: 'p1',
  category_id: 'c1',
  category_name: 'Groceries',
  name: 'Samba Rice 1kg',
  slug: 'samba-rice-1kg',
  sku: 'RICE-SAMBA-1KG',
  barcode: null,
  unit: '1 kg',
  pack_size: null,
  description: null,
  image_url: null,
  purchase_cost: 200,
  custom_markup_percent: null,
  effective_markup_percent: 25,
  calculated_selling_price: 250,
  offer_price: null as number | null,
  offer_ends_at: null as string | null,
  offer_active: false,
  is_available: true,
  is_active: true,
};

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function renderForm(product: typeof RICE, onPatch: (body: any) => ReturnType<typeof ok> = (body) => ok({ product: { ...product, ...body } })) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: [CATEGORY] });
    if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product });
    if (c.method === 'PATCH' && c.path === '/admin/products/p1') return onPatch(c.body);
    return undefined;
  });
  render(
    <MemoryRouter initialEntries={['/products/p1']}>
      <ToastProvider>
        <Routes>
          <Route path="/products/:id" element={<ProductForm />} />
          <Route path="/products" element={<p>Product list</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

describe('product form offer section', () => {
  it('sets an offer with an end day (end of that day in Colombo) and shows the % off live', async () => {
    const user = userEvent.setup();
    const api = renderForm(RICE);
    const offer = await screen.findByLabelText(/Offer price \(LKR\)/);
    await user.type(offer, '220');
    expect(screen.getByText(/12% off - customers pay LKR 220 instead of LKR 250/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Offer ends/), { target: { value: '2099-12-31' } });
    expect(screen.getByText(/until 31 Dec 2099/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')[0]?.body).toMatchObject({
      offer_price: 220,
      offer_ends_at: '2099-12-31T23:59:59+05:30',
    });
  });

  it('refuses an offer that is not below the selling price, without calling the API', async () => {
    const user = userEvent.setup();
    const api = renderForm(RICE);
    await user.type(await screen.findByLabelText(/Offer price \(LKR\)/), '250');
    expect(screen.queryByText(/% off/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The offer price must be lower than the selling price (LKR 250).')
    ).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('refuses more than 2 decimals', async () => {
    const user = userEvent.setup();
    const api = renderForm(RICE);
    await user.type(await screen.findByLabelText(/Offer price \(LKR\)/), '199.999');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a price above 0 with at most 2 decimals')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('shows the stored offer and Remove offer sends offer_price: null', async () => {
    const user = userEvent.setup();
    const api = renderForm({ ...RICE, offer_price: 220, offer_ends_at: '2099-12-31T18:29:59.000Z', offer_active: true });
    const offer = await screen.findByLabelText(/Offer price \(LKR\)/);
    await waitFor(() => expect(offer).toHaveValue('220'));
    expect(screen.getByLabelText(/Offer ends/)).toHaveValue('2099-12-31');
    expect(screen.getByText(/12% off/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove offer' }));
    expect(offer).toHaveValue('');
    expect(screen.getByText('The offer is removed when you save.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Product list');
    const body = api.find('PATCH', '/admin/products/p1')[0]?.body;
    expect(body.offer_price).toBeNull();
    expect(body).not.toHaveProperty('offer_ends_at');
  });

  it('an unchanged offer is not resent', async () => {
    const user = userEvent.setup();
    const api = renderForm({ ...RICE, offer_price: 220, offer_ends_at: '2099-12-31T18:29:59.000Z', offer_active: true });
    await waitFor(() => expect(screen.getByLabelText(/Offer price \(LKR\)/)).toHaveValue('220'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Product list');
    const body = api.find('PATCH', '/admin/products/p1')[0]?.body;
    expect(body).not.toHaveProperty('offer_price');
    expect(body).not.toHaveProperty('offer_ends_at');
  });

  it('says when the stored offer has ended', async () => {
    renderForm({ ...RICE, offer_price: 220, offer_ends_at: '2020-01-31T18:29:59.000Z', offer_active: false });
    expect(await screen.findByText(/Offer ended on 31 Jan 2020/)).toBeInTheDocument();
    expect(screen.queryByText(/% off/)).toBeNull();
  });

  it("shows the API's OFFER_PRICE_NOT_LOWER by the offer field", async () => {
    const user = userEvent.setup();
    renderForm(RICE, () => fail(400, 'OFFER_PRICE_NOT_LOWER', 'The offer price must be lower than the selling price (LKR 240).'));
    await user.type(await screen.findByLabelText(/Offer price \(LKR\)/), '245');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The offer price must be lower than the selling price (LKR 240).')
    ).toBeInTheDocument();
  });
});

describe('product form offer as "LKR off" (owner, 2026-10-10)', () => {
  it('sends selling price - amount and says what customers pay', async () => {
    const user = userEvent.setup();
    const api = renderForm(RICE);
    await screen.findByLabelText(/Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    expect(screen.getByRole('button', { name: 'LKR off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText(/Offer price \(LKR\)/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Amount off \(LKR\)/), '50');
    expect(screen.getByText(/Customers pay LKR 200 \(was LKR 250\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')[0]?.body).toMatchObject({ offer_price: 200, offer_ends_at: null });
  });

  it('keeps 2 decimals: 250 - 49.5 = 200.5', async () => {
    const user = userEvent.setup();
    const api = renderForm(RICE);
    await screen.findByLabelText(/Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    await user.type(screen.getByLabelText(/Amount off \(LKR\)/), '49.5');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')[0]?.body).toMatchObject({ offer_price: 200.5 });
  });

  it('refuses an amount that leaves no price, or with 3 decimals, sending nothing', async () => {
    const user = userEvent.setup();
    const api = renderForm(RICE);
    await screen.findByLabelText(/Offer price \(LKR\)/);
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    const amount = screen.getByLabelText(/Amount off \(LKR\)/);
    await user.type(amount, '250');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a price above 0 with at most 2 decimals')).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '5.555');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter an amount above 0 with at most 2 decimals')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('a stored offer opens as its price; LKR off shows it as the amount off, unchanged', async () => {
    const user = userEvent.setup();
    const api = renderForm({ ...RICE, offer_price: 220, offer_active: true });
    expect(await screen.findByLabelText(/Offer price \(LKR\)/)).toHaveValue('220');
    expect(screen.getByRole('button', { name: 'New price' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'LKR off' }));
    expect(screen.getByLabelText(/Amount off \(LKR\)/)).toHaveValue('30');
    expect(screen.getByText(/Customers pay LKR 220 \(was LKR 250\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New price' }));
    expect(screen.getByLabelText(/Offer price \(LKR\)/)).toHaveValue('220');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Product list')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')[0]?.body).not.toHaveProperty('offer_price');
  });
});

describe('products list offer badge', () => {
  it('shows "Offer LKR 220" only while the offer is active', async () => {
    tokenStore.save('access', 'refresh');
    mockApi((c) => {
      if (c.path === '/admin/categories') return ok({ categories: [CATEGORY] });
      if (c.path === '/admin/products') {
        return ok({
          products: [
            { ...RICE, offer_price: 220, offer_ends_at: null, offer_active: true },
            { ...RICE, id: 'p2', name: 'Red Rice 1kg', sku: 'RICE-RED-1KG', offer_price: 200, offer_ends_at: '2020-01-31T18:29:59.000Z', offer_active: false },
          ],
        });
      }
      return undefined;
    });
    render(
      <MemoryRouter>
        <ToastProvider>
          <Products />
        </ToastProvider>
      </MemoryRouter>
    );
    const samba = (await screen.findByText('Samba Rice 1kg', {}, { timeout: 4000 })).closest('tr')!;
    expect(within(samba).getByText('Offer LKR 220')).toBeInTheDocument();
    const red = screen.getByText('Red Rice 1kg').closest('tr')!;
    expect(within(red).queryByText(/Offer/)).toBeNull();
  });
});
