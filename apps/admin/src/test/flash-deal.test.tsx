import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../auth/AuthContext';
import { tokenStore } from '../api/client';
import { Products } from '../pages/Products';
import { ProductForm } from '../pages/ProductForm';
import { fail, mockApi, ok } from './mockApi';

/**
 * Flash deals (wave 2, 2026-10-25): "Start flash deal" on the Products list and in the product form
 * (a price and a length, through the ordinary product update), "End now", and the "Flash deals running"
 * filter worked out from the loaded list.
 */
vi.setConfig({ testTimeout: 30_000 });
// the first screens load slowly on a busy machine
configure({ asyncUtilTimeout: 10_000 });

// 2026-10-25 10:00 in Colombo; only Date is faked so the UI's own timers keep working
const NOW = new Date('2026-10-25T04:30:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

beforeEach(() => {
  tokenStore.save('access', 'refresh');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const P = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  sku: id.toUpperCase(),
  unit: '1 kg',
  category_id: 'c1',
  category_name: 'Groceries',
  slug: id,
  image_url: null,
  purchase_cost: 200,
  is_active: true,
  is_available: true,
  calculated_selling_price: 250,
  offer_price: null as number | null,
  offer_ends_at: null as string | null,
  offer_active: false,
  ...over,
});

const SCHEDULE = (today_hours: { open: string; close: string } | null) => ({
  hours: {},
  closure: {},
  holidays: [],
  delivery_slots: {},
  status: { is_open_now: true, closed_kind: 'OPEN', closed_reason: null, reopens_at: null, next_open_at: null, today_hours },
});

function renderProducts(rows: ReturnType<typeof P>[], hours: { open: string; close: string } | null = { open: '08:00', close: '21:00' }) {
  const api = mockApi((c) => {
    if (c.path === '/auth/me') return ok({ id: 'u1', phone: null, full_name: 'Owner', email: 'o@blynk.lk', role: 'ADMIN' });
    if (c.path === '/admin/categories') return ok({ categories: [] });
    if (c.method === 'GET' && c.path === '/admin/products') return ok({ products: rows });
    if (c.method === 'GET' && c.path === '/admin/settings/store-schedule') return ok(SCHEDULE(hours));
    if (c.method === 'PATCH' && c.path.startsWith('/admin/products/')) return ok({ product: { id: c.path.split('/').pop(), ...c.body } });
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

describe('Products: start a flash deal', () => {
  it('sends the price and the end through the product update, with a preview of what customers see', async () => {
    const user = userEvent.setup();
    const api = renderProducts([P('p1', 'Samba Rice 1kg')]);
    await screen.findByText('Samba Rice 1kg');
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));

    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '220');
    // 2 hours is the default length
    const preview = within(dialog).getByLabelText('What customers see');
    expect(preview).toHaveTextContent('LKR 220.00');
    expect(preview).toHaveTextContent('LKR 250.00');
    expect(preview).toHaveTextContent('12% off');
    expect(preview).toHaveTextContent('Ends in 2h');
    expect(preview).toHaveTextContent('until today 12 PM');

    await user.click(within(dialog).getByRole('radio', { name: '4 hours' }));
    expect(preview).toHaveTextContent('Ends in 4h');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: 220, offer_ends_at: at(240) });
    expect(await screen.findByText(/Flash deal started on Samba Rice 1kg: LKR 220.00 until 2 PM/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Start flash deal' })).toBeNull();
  });

  it('1 hour, custom minutes and until closing time each set their own end', async () => {
    const user = userEvent.setup();
    const api = renderProducts([P('p1', 'Samba Rice 1kg')]);
    await screen.findByText('Samba Rice 1kg');

    // custom
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));
    let dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '230');
    await user.click(within(dialog).getByRole('radio', { name: 'Custom' }));
    const minutes = within(dialog).getByLabelText('Custom length in minutes');
    await user.clear(minutes);
    await user.type(minutes, '45');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: 230, offer_ends_at: at(45) });

    // closing time: 21:00 Colombo = 15:30 UTC
    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));
    dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '225');
    await user.click(await within(dialog).findByRole('radio', { name: /Until closing \(9 PM\)/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/products/p1')[1].body).toEqual({ offer_price: 225, offer_ends_at: '2026-10-25T15:30:00.000Z' });
  });

  it('"Until closing time" is switched off when the store has no hours left today', async () => {
    const user = userEvent.setup();
    renderProducts([P('p1', 'Samba Rice 1kg')], null);
    await screen.findByText('Samba Rice 1kg');
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Until closing time' })).toBeDisabled());
  });

  it('refuses a price that is not below the selling price, without calling the API', async () => {
    const user = userEvent.setup();
    const api = renderProducts([P('p1', 'Samba Rice 1kg')]);
    await screen.findByText('Samba Rice 1kg');
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '250');
    expect(within(dialog).queryByLabelText('What customers see')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    expect(await within(dialog).findByText('The flash price must be lower than the selling price (LKR 250.00).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it('shows the server\'s refusal and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/auth/me') return ok({ id: 'u1', phone: null, full_name: 'Owner', email: 'o@blynk.lk', role: 'ADMIN' });
      if (c.path === '/admin/categories') return ok({ categories: [] });
      if (c.method === 'GET' && c.path === '/admin/products') return ok({ products: [P('p1', 'Samba Rice 1kg')] });
      if (c.path === '/admin/settings/store-schedule') return ok(SCHEDULE(null));
      if (c.method === 'PATCH') return fail(400, 'OFFER_PRICE_NOT_LOWER', 'The offer price must be lower than the selling price (LKR 240.00).');
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
    await screen.findByText('Samba Rice 1kg');
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '245');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    expect(await within(dialog).findByText('The offer price must be lower than the selling price (LKR 240.00).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1);
  });

  it('a product sold in sizes has no quick action', async () => {
    renderProducts([P('p1', 'Spice', { has_variants: true, variant_count: 3, price_min: 50, price_max: 350 })]);
    await screen.findByText('Spice');
    expect(screen.queryByRole('button', { name: /Flash deal for Spice/ })).toBeNull();
  });
});

describe('Products: end now and the running list', () => {
  const running = P('p1', 'Samba Rice 1kg', { offer_price: 220, offer_ends_at: at(95), offer_active: true });
  const longOffer = P('p2', 'Dhal 1kg', { offer_price: 220, offer_ends_at: at(3 * 24 * 60), offer_active: true });
  const plain = P('p3', 'Sugar 1kg');

  it('End now clears the offer price and its end', async () => {
    const user = userEvent.setup();
    const api = renderProducts([running]);
    await screen.findByText('Samba Rice 1kg');
    expect(screen.getByText('Flash deal · 1h 35m left (ends 11:35 AM)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice 1kg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Running now: LKR 220.00, 1h 35m left');
    await user.click(within(dialog).getByRole('button', { name: 'End now' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: null, offer_ends_at: null });
    expect(await screen.findByText(/The offer on Samba Rice 1kg has ended/)).toBeInTheDocument();
  });

  it('the "Flash deals running" chip counts the running ones and filters the list to them', async () => {
    const user = userEvent.setup();
    renderProducts([plain, longOffer, running]);
    await screen.findByText('Sugar 1kg');
    const chip = screen.getByRole('button', { name: 'Flash deals running (1)' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Samba Rice 1kg')).toBeInTheDocument();
    expect(screen.queryByText('Sugar 1kg')).toBeNull();
    expect(screen.queryByText('Dhal 1kg')).toBeNull();
    await user.click(chip);
    expect(screen.getByText('Sugar 1kg')).toBeInTheDocument();
  });

  it('the chip is off while nothing is running', async () => {
    renderProducts([plain, longOffer]);
    await screen.findByText('Sugar 1kg');
    expect(screen.getByRole('button', { name: 'Flash deals running (0)' })).toBeDisabled();
  });
});

describe('Product form: start a flash deal', () => {
  it('starts one from the Offer section and shows the saved offer back', async () => {
    const user = userEvent.setup();
    let product = P('p1', 'Samba Rice 1kg', { effective_markup_percent: 25, pricing_mode: 'MARKUP' });
    const api = mockApi((c) => {
      if (c.path === '/auth/me') return ok({ id: 'u1', phone: null, full_name: 'Owner', email: 'o@blynk.lk', role: 'ADMIN' });
      if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: [{ id: 'c1', name: 'Groceries', slug: 'groceries', description: null, image_url: null, display_order: 0, is_active: true }] });
      if (c.method === 'GET' && c.path === '/admin/products/p1') return ok({ product });
      if (c.path === '/admin/settings/store-schedule') return ok(SCHEDULE({ open: '08:00', close: '21:00' }));
      if (c.method === 'PATCH' && c.path === '/admin/products/p1') {
        product = { ...product, ...c.body, offer_active: true };
        return ok({ product });
      }
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/products/p1']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/products/:id" element={<ProductForm />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole('button', { name: 'Start flash deal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '210');
    await user.click(within(dialog).getByRole('radio', { name: '1 hour' }));
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: 210, offer_ends_at: at(60) });
    // the form now holds the saved offer, and the row tag shows the running deal
    expect(await screen.findByDisplayValue('210')).toBeInTheDocument();
    expect(await screen.findByText('Flash deal · 1h left (ends 11 AM)')).toBeInTheDocument();
  });
});
