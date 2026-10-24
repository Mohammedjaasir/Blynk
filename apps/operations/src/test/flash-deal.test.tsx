import { configure, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminProduct } from '../api/types';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/**
 * Flash deals (wave 2, 2026-10-25): "Start flash deal" in the Products list and the product form - a price
 * and a length (1 h / 2 h / 4 h / until closing / custom) through the ordinary product update - and
 * "End now". The server keeps the offer rules (below the selling price, end in the future).
 */
vi.setConfig({ testTimeout: 30_000 });
// the first screens load slowly on a busy machine
configure({ asyncUtilTimeout: 10_000 });

// 2026-10-25 10:00 in Colombo; only Date is faked so the UI's own timers keep working
const NOW = new Date('2026-10-25T04:30:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    pricing_mode: 'MARKUP',
    category_markup_percent: 25,
    pricing_source: 'CATEGORY_MARKUP',
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

const CATEGORY = { id: 'c1', name: 'Rice', slug: 'rice', description: null, image_url: null, display_order: 1, is_active: true, markup_percent: 25 };
const SCHEDULE = (today_hours: { open: string; close: string } | null) => ({
  hours: {},
  closure: {},
  holidays: [],
  delivery_slots: {},
  status: { is_open_now: true, closed_kind: 'OPEN', closed_reason: null, reopens_at: null, next_open_at: null, today_hours },
});

function openList(rows: AdminProduct[], hours: { open: string; close: string } | null = { open: '08:00', close: '21:00' }) {
  return renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
    'GET /admin/categories': () => ok({ categories: [CATEGORY] }),
    'GET /admin/products': () => ok({ products: rows, pagination: { page: 1, limit: 200 } }),
    'GET /admin/settings/store-schedule': () => ok(SCHEDULE(hours)),
    'PATCH /admin/products/:id': (call) => ok({ product: { ...rows[0], ...call.body } }),
  });
}

describe('Ops Products: Start flash deal', () => {
  it('sends the price and the end through the product update, with what customers will see', async () => {
    const user = userEvent.setup();
    const { api } = openList([product()]);
    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice' }));

    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '220');
    const preview = within(dialog).getByLabelText('What customers see');
    expect(preview).toHaveTextContent('LKR 220.00');
    expect(preview).toHaveTextContent('LKR 250.00');
    expect(preview).toHaveTextContent('12% off');
    expect(preview).toHaveTextContent('Ends in 2h');

    await user.click(within(dialog).getByRole('radio', { name: '1 hour' }));
    expect(preview).toHaveTextContent('Ends in 1h');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: 220, offer_ends_at: at(60) });
    expect(await screen.findByText(/Flash deal started on Samba Rice: LKR 220.00 until 11 AM/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Start flash deal' })).toBeNull();
  });

  it('custom minutes and until closing time set their own end', async () => {
    const user = userEvent.setup();
    const { api } = openList([product()]);
    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice' }));
    let dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '230');
    await user.click(within(dialog).getByRole('radio', { name: 'Custom' }));
    const minutes = within(dialog).getByLabelText('Custom length in minutes');
    await user.clear(minutes);
    await user.type(minutes, '30');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: 230, offer_ends_at: at(30) });

    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice' }));
    dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '225');
    await user.click(await within(dialog).findByRole('radio', { name: /Until closing \(9 PM\)/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/products/p1')[1].body).toEqual({ offer_price: 225, offer_ends_at: '2026-10-25T15:30:00.000Z' });
  });

  it('"Until closing time" is off when the store has no hours left today', async () => {
    const user = userEvent.setup();
    openList([product()], null);
    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Until closing time' })).toBeDisabled());
  });

  it('refuses a price that is not below the selling price, without calling the API', async () => {
    const user = userEvent.setup();
    const { api } = openList([product()]);
    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '260');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    expect(await within(dialog).findByText('The flash price must be lower than the selling price (LKR 250.00).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(0);
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/products', {
      'GET /admin/categories': () => ok({ categories: [CATEGORY] }),
      'GET /admin/products': () => ok({ products: [product()], pagination: { page: 1, limit: 200 } }),
      'GET /admin/settings/store-schedule': () => ok(SCHEDULE(null)),
      'PATCH /admin/products/:id': () => fail(400, 'OFFER_PRICE_NOT_LOWER', 'The offer price must be lower than the selling price (LKR 240.00).'),
    });
    await user.click(await screen.findByRole('button', { name: 'Flash deal for Samba Rice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '245');
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    expect(await within(dialog).findByText('The offer price must be lower than the selling price (LKR 240.00).')).toBeInTheDocument();
  });

  it('a product sold in sizes has no quick action', async () => {
    openList([product({ has_variants: true, variant_count: 3 })]);
    await screen.findByText('Samba Rice');
    expect(screen.queryByRole('button', { name: /Flash deal for/ })).toBeNull();
  });
});

describe('Ops Products: a running deal and End now', () => {
  it('tags the running deal and "End now" clears the offer price and its end', async () => {
    const user = userEvent.setup();
    const running = product({ offer_price: 220, offer_ends_at: at(95), offer_active: true });
    const { api } = openList([running]);
    expect(await screen.findByText('Flash deal · 1h 35m left (ends 11:35 AM)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Flash deal for Samba Rice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Running now: LKR 220.00, 1h 35m left');
    await user.click(within(dialog).getByRole('button', { name: 'End now' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: null, offer_ends_at: null });
    expect(await screen.findByText(/The offer on Samba Rice has ended/)).toBeInTheDocument();
  });

  it('an offer ending in days is not tagged as a flash deal', async () => {
    openList([product({ offer_price: 220, offer_ends_at: at(3 * 24 * 60), offer_active: true })]);
    await screen.findByText('Samba Rice');
    expect(screen.queryByText(/Flash deal ·/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Flash deal for Samba Rice' })).toHaveTextContent('Start flash deal');
  });
});

describe('Ops product form: Start flash deal', () => {
  it('starts one from the Offer section and shows the saved offer back', async () => {
    const user = userEvent.setup();
    let saved = product();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/p1', {
      'GET /admin/categories': () => ok({ categories: [CATEGORY] }),
      'GET /admin/products/:id': () => ok({ product: saved }),
      'GET /admin/settings/store-schedule': () => ok(SCHEDULE({ open: '08:00', close: '21:00' })),
      'PATCH /admin/products/:id': (call) => {
        saved = { ...saved, ...call.body, offer_active: true };
        return ok({ product: saved });
      },
      'GET /admin/products': () => ok({ products: [], pagination: { page: 1, limit: 200 } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Start flash deal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start flash deal' });
    await user.type(within(dialog).getByLabelText(/Flash price/), '210');
    await user.click(within(dialog).getByRole('radio', { name: '4 hours' }));
    await user.click(within(dialog).getByRole('button', { name: 'Start flash deal' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/products/p1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/products/p1')[0].body).toEqual({ offer_price: 210, offer_ends_at: at(240) });
    expect(await screen.findByDisplayValue('210')).toBeInTheDocument();
    expect(await screen.findByText('Flash deal · 4h left (ends 2 PM)')).toBeInTheDocument();
  });
});
