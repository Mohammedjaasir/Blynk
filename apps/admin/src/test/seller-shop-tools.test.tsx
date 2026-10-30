import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { mockApi, ok, fail, type Call, type Reply } from './mockApi';

/**
 * Admin seller tools (2026-10-30): a seller's products with status chips, Add product for the seller (photo
 * required), Set shop location, the commission-free period and the free-days setting. The API is the fake in
 * mockApi; the contract is docs/superpowers/plans/2026-10-30-seller-orders-commission-admin.md (B2).
 */
vi.setConfig({ testTimeout: 30_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };
const IN_23_DAYS = new Date(Date.now() + 23 * 86_400_000 - 3_600_000).toISOString();

const seller = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1',
  shop_name: 'Blynk Western',
  contact_name: 'Kumar',
  address: '12 Temple Rd',
  note: 'Bakes daily',
  status: 'APPROVED',
  rejection_reason: null,
  commission_percent: null,
  created_at: '2026-10-20T04:00:00.000Z',
  phone: '+94771234567',
  email: null,
  full_name: 'Kumar',
  products_live: 1,
  products_total: 3,
  submissions_pending: 0,
  due: 0,
  commission_free_until: IN_23_DAYS,
  latitude: null,
  longitude: null,
  location_status: 'NONE',
  ...over,
});
const statement = {
  commission_percent: null,
  gross: 0,
  commission: 0,
  earned: 0,
  paid: 0,
  due: 0,
  lines: [],
  payouts: [],
};
const PRODUCTS = [
  { id: 'p1', name: 'Apple Pie', image_url: 'https://media.blynk.lk/products/pie.webp', category_name: 'Bakery', selling_price: 450, seller_price: 380, is_active: true, is_available: true, status: 'LIVE', stock_on_hand: 12 },
  { id: 'p2', name: 'Samosa', image_url: null, category_name: 'Snacks', selling_price: 60, seller_price: 45, is_active: true, is_available: false, status: 'PAUSED', stock_on_hand: null },
  { id: 'p3', name: 'Old Cake', image_url: null, category_name: 'Bakery', selling_price: 900, seller_price: 700, is_active: false, is_available: true, status: 'OFF', stock_on_hand: 0 },
];
const CATEGORIES = [
  { id: 'c1', name: 'Bakery', slug: 'bakery', display_order: 1, is_active: true, parent_id: null },
  { id: 'c2', name: 'Snacks', slug: 'snacks', display_order: 2, is_active: true, parent_id: null },
];

function renderAt(route: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.path === '/auth/me') return ok(ADMIN);
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    return handler(c);
  });
  render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom has no object URLs; the uploader previews the picked file with one.
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
});

function detail(over: Record<string, unknown> = {}, extra?: (c: Call) => Reply | undefined) {
  let current = seller(over);
  return renderAt('/sellers/s1', (c) => {
    const more = extra?.(c);
    if (more) return more;
    if (c.method === 'GET' && c.path === '/admin/sellers/s1') return ok({ seller: current, statement });
    if (c.method === 'GET' && c.path === '/admin/sellers/s1/products') return ok({ products: PRODUCTS });
    if (c.method === 'GET' && c.path === '/admin/seller-payout-requests') return ok({ payout_requests: [] });
    if (c.method === 'PATCH' && c.path === '/admin/sellers/s1') {
      current = { ...current, ...c.body };
      return ok({ seller: current });
    }
    return undefined;
  });
}

describe('Seller detail: products', () => {
  it('lists the seller products with photo, category, both prices, a status chip and stock', async () => {
    detail();
    const table = await screen.findByRole('table', { name: "Seller's products" });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByRole('img', { name: 'Apple Pie' })).toHaveAttribute('src', 'https://media.blynk.lk/products/pie.webp');
    expect(within(rows[1]!).getByText('Bakery')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('LKR 380.00')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('LKR 450.00')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Live')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('12')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Paused')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('No photo')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Products (1 live of 3)' })).toBeInTheDocument();
  });

  it('shows cards in order: profile, products, shop location, statement, payout requests, payouts', async () => {
    detail();
    await screen.findByRole('table', { name: "Seller's products" });
    await screen.findByText('No payout request waiting.');
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual(['Profile', 'Products', 'Shop location', 'Statement', 'Payout requests', 'Payouts']);
  });

  it('offers Add product only for an approved seller', async () => {
    detail({ status: 'SUSPENDED' });
    await screen.findByRole('table', { name: "Seller's products" });
    expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument();
    expect(screen.getByText(/once they are approved/)).toBeInTheDocument();
  });

  it('says so when the products cannot be loaded', async () => {
    detail({}, (c) => (c.path === '/admin/sellers/s1/products' ? fail(500, 'INTERNAL_SERVER_ERROR', 'Boom') : undefined));
    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });

  it('adds a product: validates inline, needs the photo, posts the body and refreshes the list', async () => {
    const user = userEvent.setup();
    let created = false;
    const api = detail({}, (c) => {
      if (c.method === 'POST' && c.path === '/admin/media') return ok({ media: { key: 'products/new.webp', url: 'https://media.blynk.lk/products/new.webp' } });
      if (c.method === 'POST' && c.path === '/admin/sellers/s1/products') {
        created = true;
        return ok({ product: { ...PRODUCTS[0], id: 'p9', name: 'Cheese Roll' } });
      }
      if (created && c.method === 'GET' && c.path === '/admin/sellers/s1/products') {
        return ok({ products: [...PRODUCTS, { ...PRODUCTS[0], id: 'p9', name: 'Cheese Roll', status: 'LIVE' }] });
      }
      return undefined;
    });
    await screen.findByRole('table', { name: "Seller's products" });
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add product for seller' });

    // Nothing typed: every required field is named, the photo included, and nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    expect(within(dialog).getByText(/Enter the product name/)).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a category.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter the unit/)).toBeInTheDocument();
    expect(within(dialog).getByText('Add a photo of the product.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter the seller's price/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter the customer price/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers/s1/products')).toHaveLength(0);
    expect(within(dialog).getByText('Product photo (required)')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Product name/), 'Cheese Roll');
    await user.selectOptions(within(dialog).getByLabelText(/^Category/), 'c1');
    await user.type(within(dialog).getByLabelText(/^Unit/), 'piece');
    await user.type(within(dialog).getByLabelText(/^Pack size/), 'Large');
    await user.type(within(dialog).getByLabelText(/^Barcode/), '123456');
    await user.type(within(dialog).getByLabelText(/^Description/), 'Hot and fresh');
    await user.type(within(dialog).getByLabelText(/^Seller's price/), '120');
    await user.type(within(dialog).getByLabelText(/^Customer price/), '150.50');
    await user.type(within(dialog).getByLabelText(/^Opening stock/), '20');
    const file = new File(['x'], 'roll.png', { type: 'image/png' });
    await user.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() => expect(api.find('POST', '/admin/media')).toHaveLength(1));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Replace image' })).toBeInTheDocument());
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));

    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/products')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers/s1/products')[0]!.body).toEqual({
      name: 'Cheese Roll',
      category_id: 'c1',
      unit: 'piece',
      pack_size: 'Large',
      description: 'Hot and fresh',
      image_url: 'https://media.blynk.lk/products/new.webp',
      seller_price: 120,
      selling_price: 150.5,
      barcode: '123456',
      stock_quantity: 20,
    });
    expect(await screen.findByText('Cheese Roll is added for Blynk Western and is live.')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: "Seller's products" });
    expect(await within(table).findByText('Cheese Roll')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add product for seller' })).not.toBeInTheDocument();
  });

  it("shows the API's IMAGE_REQUIRED under the photo", async () => {
    const user = userEvent.setup();
    detail({}, (c) =>
      c.method === 'POST' && c.path === '/admin/sellers/s1/products'
        ? fail(400, 'IMAGE_REQUIRED', 'Add a photo of the product.')
        : c.method === 'POST' && c.path === '/admin/media'
          ? ok({ media: { key: 'k', url: 'https://media.blynk.lk/products/x.webp' } })
          : undefined
    );
    await screen.findByRole('table', { name: "Seller's products" });
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add product for seller' });
    await user.type(within(dialog).getByLabelText(/^Product name/), 'Roll');
    await user.selectOptions(within(dialog).getByLabelText(/^Category/), 'c2');
    await user.type(within(dialog).getByLabelText(/^Unit/), 'pc');
    await user.type(within(dialog).getByLabelText(/^Seller's price/), '10');
    await user.type(within(dialog).getByLabelText(/^Customer price/), '12');
    await user.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Replace image' })).toBeInTheDocument());
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    expect(await within(dialog).findByText('Add a photo of the product.')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });
});

describe('Seller detail: edit details and shop location', () => {
  it('Edit details covers shop name, phone, contact, address and the note', async () => {
    const user = userEvent.setup();
    const api = detail();
    await screen.findByRole('table', { name: "Seller's products" });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit seller details' });
    for (const label of ['Shop name', /^Phone/, 'Contact name', 'Address', 'Note']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    await user.clear(within(dialog).getByLabelText('Note'));
    await user.type(within(dialog).getByLabelText('Note'), 'Closed Sundays');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ note: 'Closed Sundays' });
  });

  it('Set shop location: a pasted "lat, lng" fills both boxes, a Maps link checks it, and PUT sends the point', async () => {
    const user = userEvent.setup();
    const api = detail({}, (c) =>
      c.method === 'PUT' && c.path === '/admin/sellers/s1/location'
        ? ok({
            seller: seller({
              latitude: c.body.latitude,
              longitude: c.body.longitude,
              location_note: c.body.how_to_find,
              location_status: 'APPROVED',
              distance_km_from_store: 3.2,
            }),
          })
        : undefined
    );
    await screen.findByRole('table', { name: "Seller's products" });
    await user.click(screen.getByRole('button', { name: 'Set shop location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set shop location' });

    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));
    expect(within(dialog).getByText(/Latitude is a number/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Longitude is a number/)).toBeInTheDocument();
    expect(api.find('PUT', '/admin/sellers/s1/location')).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Paste coordinates'), { target: { value: '7.290572, 80.633728' } });
    expect(within(dialog).getByLabelText('Latitude')).toHaveValue('7.290572');
    expect(within(dialog).getByLabelText('Longitude')).toHaveValue('80.633728');
    expect(within(dialog).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=7.290572,80.633728');
    await user.type(within(dialog).getByLabelText(/^How to find it/), 'Opposite the clock tower');
    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));

    await waitFor(() => expect(api.find('PUT', '/admin/sellers/s1/location')).toHaveLength(1));
    expect(api.find('PUT', '/admin/sellers/s1/location')[0]!.body).toEqual({
      latitude: 7.290572,
      longitude: 80.633728,
      how_to_find: 'Opposite the clock tower',
    });
    expect(await screen.findByText("Blynk Western's shop location is set and approved.")).toBeInTheDocument();
    const approved = await screen.findByRole('group', { name: 'Approved location' });
    expect(within(approved).getByText('7.290572, 80.633728')).toBeInTheDocument();
    expect(within(approved).getByText('Opposite the clock tower')).toBeInTheDocument();
    expect(within(approved).getByText('3.2 km from the Blynk store')).toBeInTheDocument();
  });

  it('a lat,lng pair pasted into the Latitude box fills both; an API refusal shows in the dialog', async () => {
    const user = userEvent.setup();
    detail({}, (c) => (c.method === 'PUT' && c.path === '/admin/sellers/s1/location' ? fail(400, 'OUTSIDE_DELIVERY_AREA', 'That is too far from the store.') : undefined));
    await screen.findByRole('table', { name: "Seller's products" });
    await user.click(screen.getByRole('button', { name: 'Set shop location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set shop location' });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '6.9, 79.8' } });
    expect(within(dialog).getByLabelText('Latitude')).toHaveValue('6.9');
    expect(within(dialog).getByLabelText('Longitude')).toHaveValue('79.8');
    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));
    expect(await within(dialog).findByText('That is too far from the store.')).toBeInTheDocument();
  });
});

describe('Seller detail: commission-free period', () => {
  it('shows the date and days left', async () => {
    detail();
    const group = await screen.findByRole('group', { name: 'Commission-free period' });
    expect(within(group).getByText(/^Commission-free until .+ \(23 days left\)$/)).toBeInTheDocument();
  });

  it('Extend by 30 days adds 30 days to the current end', async () => {
    const user = userEvent.setup();
    const api = detail();
    const group = await screen.findByRole('group', { name: 'Commission-free period' });
    await user.click(within(group).getByRole('button', { name: 'Extend by 30 days' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    const sent = new Date(api.find('PATCH', '/admin/sellers/s1')[0]!.body.commission_free_until).getTime();
    expect(Math.round((sent - new Date(IN_23_DAYS).getTime()) / 86_400_000)).toBe(30);
    expect(await screen.findByText('Commission-free period extended by 30 days.')).toBeInTheDocument();
    expect(await within(group).findByText(/\(53 days left\)/)).toBeInTheDocument();
  });

  it('End now sets the date to now and then says the period ended', async () => {
    const user = userEvent.setup();
    const api = detail();
    const group = await screen.findByRole('group', { name: 'Commission-free period' });
    await user.click(within(group).getByRole('button', { name: 'End now' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    const sent = new Date(api.find('PATCH', '/admin/sellers/s1')[0]!.body.commission_free_until).getTime();
    expect(Math.abs(sent - Date.now())).toBeLessThan(60_000);
    expect(await within(group).findByText(/Commission-free period ended on/)).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'End now' })).toBeDisabled();
  });

  it('Edit date picks a day and sends the end of that day in Colombo', async () => {
    const user = userEvent.setup();
    const api = detail({ commission_free_until: '2027-03-20T10:00:00.000Z' });
    const group = await screen.findByRole('group', { name: 'Commission-free period' });
    await user.click(within(group).getByRole('button', { name: 'Edit date' }));
    await user.click(within(group).getByRole('button', { name: /^Commission-free until:/ }));
    await user.click(await screen.findByRole('button', { name: '25 March 2027' }));
    await user.click(within(group).getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ commission_free_until: '2027-03-25T23:59:59+05:30' });
  });

  it('a seller without a free period reads "No commission-free period." and can be given one', async () => {
    const user = userEvent.setup();
    const api = detail({ commission_free_until: null });
    const group = await screen.findByRole('group', { name: 'Commission-free period' });
    expect(within(group).getByText('No commission-free period.')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Extend by 30 days' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    const sent = new Date(api.find('PATCH', '/admin/sellers/s1')[0]!.body.commission_free_until).getTime();
    expect(Math.round((sent - Date.now()) / 86_400_000)).toBe(30);
  });
});

describe('Sellers list and commission settings', () => {
  const rows = [
    seller(),
    seller({ id: 's2', shop_name: 'Galle Sweets', products_live: 4, products_total: 4, commission_free_until: '2026-01-01T00:00:00.000Z', commission_percent: 7.5 }),
  ];

  it('shows live products (with the total when some are not live) and a free-period chip', async () => {
    renderAt('/sellers', (c) =>
      c.method === 'GET' && c.path === '/admin/sellers' ? ok({ sellers: rows }) : c.path === '/admin/seller-payout-requests' ? ok({ payout_requests: [] }) : undefined
    );
    const table = await screen.findByRole('table', { name: 'Sellers' });
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(within(first!).getByText('3 in all')).toBeInTheDocument();
    expect(within(first!).getByText('Free, 23d left')).toBeInTheDocument();
    expect(within(second!).queryByText(/in all/)).not.toBeInTheDocument();
    expect(within(second!).queryByText(/Free,/)).not.toBeInTheDocument();
  });

  it('the commission panel has "Free month for new sellers (days)" and saves free_days', async () => {
    const user = userEvent.setup();
    const settings = { default_percent: 5, categories: [], ready: true, free_days: 30 };
    const api = renderAt('/sellers', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers') return ok({ sellers: [] });
      if (c.path === '/admin/seller-payout-requests') return ok({ payout_requests: [] });
      if (c.method === 'GET' && c.path === '/admin/settings/seller-commission') return ok(settings);
      if (c.method === 'PUT' && c.path === '/admin/settings/seller-commission') return ok({ ...settings, free_days: c.body.free_days });
      return undefined;
    });
    await screen.findByText('No sellers yet');
    await user.click(screen.getByRole('button', { name: 'Seller commission' }));
    const panel = await screen.findByRole('region', { name: 'Seller commission' });
    const field = await within(panel).findByLabelText('Free days for new sellers');
    expect(field).toHaveValue('30');
    expect(within(panel).getByText('Free month for new sellers (days)')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'abc');
    await user.click(within(panel).getByRole('button', { name: 'Save commission' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent(/whole number/);
    expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(0);

    await user.clear(field);
    await user.type(field, '0');
    await user.click(within(panel).getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/seller-commission')[0]!.body).toEqual({ default_percent: 5, categories: [], free_days: 0 });
  });

  it('an API that does not report free_days gets no field and no free_days in the PUT', async () => {
    const user = userEvent.setup();
    const settings = { default_percent: 5, categories: [], ready: true };
    const api = renderAt('/sellers', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers') return ok({ sellers: [] });
      if (c.path === '/admin/seller-payout-requests') return ok({ payout_requests: [] });
      if (c.method === 'GET' && c.path === '/admin/settings/seller-commission') return ok(settings);
      if (c.method === 'PUT' && c.path === '/admin/settings/seller-commission') return ok(settings);
      return undefined;
    });
    await screen.findByText('No sellers yet');
    await user.click(screen.getByRole('button', { name: 'Seller commission' }));
    const panel = await screen.findByRole('region', { name: 'Seller commission' });
    await within(panel).findByLabelText('Default commission percent');
    expect(within(panel).queryByLabelText('Free days for new sellers')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/seller-commission')[0]!.body).toEqual({ default_percent: 5, categories: [] });
  });
});
