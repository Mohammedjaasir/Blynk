import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * Seller detail for staff (2026-10-30, plan E2): the seller's Products and Add product, Set shop
 * location, the commission-free period, and the free-days setting. The B2 endpoints are mocked exactly
 * as the plan's contract shapes them.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const seller = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1',
  shop_name: 'Blynk Western',
  contact_name: 'Kumar',
  address: '12 Temple Rd, Dharga Town',
  note: 'Cakes and short eats',
  status: 'APPROVED',
  rejection_reason: null,
  commission_percent: null,
  created_at: '2026-10-20T04:00:00.000Z',
  phone: '+94771234567',
  email: null,
  full_name: 'Kumar',
  products_live: 1,
  submissions_pending: 0,
  due: 0,
  commission_free_until: null,
  ...over,
});
const statement = () => ({ commission_percent: null, gross: 0, commission: 0, earned: 0, paid: 0, due: 0, lines: [], payouts: [] });
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Apple Pie',
  image_url: 'https://cdn.blynk.test/products/pie.webp',
  category_name: 'Bakery',
  selling_price: 650,
  seller_price: 500,
  is_active: true,
  is_available: true,
  status: 'LIVE',
  stock_on_hand: 12,
  ...over,
});
const CATEGORIES = [
  { id: 'c1', name: 'Bakery', slug: 'bakery', description: null, image_url: null, display_order: 1, is_active: true, parent_id: null },
  { id: 'c2', name: 'Pantry', slug: 'pantry', description: null, image_url: null, display_order: 2, is_active: true, parent_id: null },
];

const detail = (over: Record<string, unknown> = {}, extra: Record<string, (c: Call) => unknown> = {}) => ({
  'GET /admin/sellers/:id': () => ok({ seller: seller(over), statement: statement() }),
  'GET /admin/seller-payout-requests': () => ok({ payout_requests: [] }),
  'GET /admin/sellers/:id/products': () => ok({ products: [product()] }),
  'GET /admin/categories': () => ok({ categories: CATEGORIES }),
  ...extra,
});

async function openSeller(over: Record<string, unknown> = {}, extra: Record<string, (c: Call) => unknown> = {}) {
  const out = renderAs(OPERATIONS_STAFF, '/more/sellers/s1', detail(over, extra));
  await screen.findByRole('heading', { name: 'Blynk Western' });
  return out;
}

describe('Seller detail: card order and Products', () => {
  it('shows Profile, Products, Commission, Shop location, Statement, Payout requests, Payouts in that order', async () => {
    await openSeller();
    await screen.findByRole('list', { name: 'Seller products' });
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(names.slice(0, 7)).toEqual(['Profile', 'Products', 'Commission', 'Shop location', 'Statement', 'Payout requests', 'Payouts']);
  });

  it("lists the seller's products with photo, category, both prices, status chip and stock", async () => {
    await openSeller(
      {},
      {
        'GET /admin/sellers/:id/products': () =>
          ok({
            products: [
              product(),
              product({ id: 'p2', name: 'Samosa', image_url: null, category_name: 'Short eats', selling_price: 60, seller_price: 45, is_available: false, status: 'PAUSED', stock_on_hand: 0 }),
              product({ id: 'p3', name: 'Old Roll', is_active: false, status: 'OFF', stock_on_hand: null }),
            ],
          }),
      }
    );
    const section = screen.getByRole('region', { name: 'Products' });
    expect(await within(section).findByText('1 live, 1 paused, 1 off')).toBeInTheDocument();
    const pie = within(section).getByRole('listitem', { name: 'Apple Pie' });
    expect(within(pie).getByText('Live')).toBeInTheDocument();
    expect(pie).toHaveTextContent('Bakery');
    expect(pie).toHaveTextContent('Seller LKR 500.00 · Customer LKR 650.00');
    expect(pie).toHaveTextContent('Stock 12');
    expect(pie.querySelector('img')).toHaveAttribute('src', 'https://cdn.blynk.test/products/pie.webp');
    const samosa = within(section).getByRole('listitem', { name: 'Samosa' });
    expect(within(samosa).getByText('Paused')).toBeInTheDocument();
    expect(samosa.querySelector('img')).toBeNull();
    const old = within(section).getByRole('listitem', { name: 'Old Roll' });
    expect(within(old).getByText('Off')).toBeInTheDocument();
    expect(old).toHaveTextContent('Stock not tracked');
  });

  it('only offers Add product for an APPROVED seller', async () => {
    await openSeller({ status: 'PENDING' }, { 'GET /admin/sellers/:id/products': () => ok({ products: [] }) });
    const section = screen.getByRole('region', { name: 'Products' });
    expect(await within(section).findByText('No products yet.')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Add product' })).toBeNull();
    expect(within(section).getByText('Approve this seller to add products for them.')).toBeInTheDocument();
  });

  it('says so when the products cannot be loaded, without breaking the page', async () => {
    await openSeller({}, { 'GET /admin/sellers/:id/products': () => fail(400, 'PRODUCTS_BROKEN', 'Boom') });
    const section = screen.getByRole('region', { name: 'Products' });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByRole('region', { name: 'Commission' })).toBeInTheDocument();
  });
});

describe('Add product for the seller', () => {
  const fill = async (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) => {
    await user.type(within(dialog).getByLabelText(/^Product name/), 'Chicken Roll');
    await user.selectOptions(within(dialog).getByLabelText(/^Category/), 'c1');
    await user.type(within(dialog).getByLabelText(/^Unit/), '1 pc');
    await user.type(within(dialog).getByLabelText(/^Pack size/), '2 pack');
    await user.type(within(dialog).getByLabelText(/^Description/), 'Fresh daily');
    await user.type(within(dialog).getByLabelText(/^Seller price/), '80');
    await user.type(within(dialog).getByLabelText(/^Customer price/), '110');
    await user.type(within(dialog).getByLabelText(/^Barcode/), '4791234567890');
    await user.type(within(dialog).getByLabelText(/^Opening stock/), '24');
  };
  const upload = (dialog: HTMLElement) => {
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['abc'], 'roll.jpg', { type: 'image/jpeg' })] } });
  };
  const media = { 'POST /admin/media': () => ok({ media: { key: 'products/roll.webp', url: 'https://cdn.blynk.test/products/roll.webp' } }) };

  it('needs a photo: the form is refused with a message and nothing is sent; then it posts the product and refreshes the list', async () => {
    const user = userEvent.setup();
    let created = false;
    const { api } = await openSeller(
      {},
      {
        ...media,
        'GET /admin/sellers/:id/products': () =>
          ok({ products: created ? [product(), product({ id: 'p9', name: 'Chicken Roll', selling_price: 110, seller_price: 80, stock_on_hand: 24 })] : [product()] }),
        'POST /admin/sellers/:id/products': () => {
          created = true;
          return ok({ product: product({ id: 'p9', name: 'Chicken Roll' }) });
        },
      }
    );
    await screen.findByRole('list', { name: 'Seller products' });
    await user.click(screen.getByRole('button', { name: 'Add product' }));
    const dialog = screen.getByRole('dialog', { name: 'Add product' });
    await within(dialog).findByRole('option', { name: 'Bakery' });
    await fill(dialog, user);
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    expect(await within(dialog).findByText('Add a photo of the product.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers/s1/products')).toHaveLength(0);

    upload(dialog);
    await waitFor(() => expect(api.find('POST', '/admin/media')).toHaveLength(1));
    expect(api.find('POST', '/admin/media')[0]!.body).toMatchObject({ folder: 'products' });
    expect(await within(dialog).findByText('Replace image')).toBeInTheDocument();
    expect(within(dialog).queryByText('Add a photo of the product.')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/products')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers/s1/products')[0]!.body).toEqual({
      name: 'Chicken Roll',
      category_id: 'c1',
      unit: '1 pc',
      pack_size: '2 pack',
      description: 'Fresh daily',
      image_url: 'https://cdn.blynk.test/products/roll.webp',
      seller_price: 80,
      selling_price: 110,
      barcode: '4791234567890',
      stock_quantity: 24,
    });
    expect(await screen.findByText('Chicken Roll is added for Blynk Western and is live.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add product' })).toBeNull();
    expect(await screen.findByRole('listitem', { name: 'Chicken Roll' })).toBeInTheDocument();
  });

  it('shows inline messages for missing fields and a below-seller-price note', async () => {
    const user = userEvent.setup();
    const { api } = await openSeller({}, media);
    await user.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = screen.getByRole('dialog', { name: 'Add product' });
    await user.type(within(dialog).getByLabelText(/^Seller price/), '100');
    await user.type(within(dialog).getByLabelText(/^Customer price/), '90');
    expect(within(dialog).getByRole('note')).toHaveTextContent('lower than the seller');
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    expect(within(dialog).getByText(/Enter the product name/)).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a category.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter the unit/)).toBeInTheDocument();
    expect(within(dialog).getByText('Add a photo of the product.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers/s1/products')).toHaveLength(0);
  });

  it("shows the API's IMAGE_REQUIRED under the photo and other errors in the sheet", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const { api } = await openSeller(
      {},
      {
        ...media,
        'POST /admin/sellers/:id/products': () => {
          attempt += 1;
          return attempt === 1 ? fail(400, 'IMAGE_REQUIRED', 'Add a photo of the product.') : fail(409, 'SELLER_NOT_APPROVED', 'Only an approved seller can get products.');
        },
      }
    );
    await user.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = screen.getByRole('dialog', { name: 'Add product' });
    await within(dialog).findByRole('option', { name: 'Bakery' });
    await fill(dialog, user);
    upload(dialog);
    expect(await within(dialog).findByText('Replace image')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    const photo = within(dialog).getByRole('group', { name: 'Product photo (required)' });
    expect(await within(photo).findByText('Add a photo of the product.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    expect(await within(dialog).findByText('Only an approved seller can get products.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers/s1/products')).toHaveLength(2);
    // The sheet stays open with what was typed.
    expect(within(dialog).getByLabelText(/^Product name/)).toHaveValue('Chicken Roll');
  });
});

describe('Set shop location', () => {
  it('shows the approved location, fills lat/lng from a pasted Google Maps text, and saves it', async () => {
    const user = userEvent.setup();
    const withPin = { latitude: 7.29, longitude: 80.63, location_note: 'Opposite the temple', distance_km_from_store: 3.2, location_status: 'APPROVED' };
    const { api } = await openSeller(withPin, {
      'PUT /admin/sellers/:id/location': (c) => ok({ seller: seller({ ...withPin, latitude: c.body.latitude, longitude: c.body.longitude, location_note: c.body.how_to_find }) }),
    });
    const approved = screen.getByRole('group', { name: 'Approved location' });
    expect(approved).toHaveTextContent('3.2 km from the Blynk store');

    await user.click(screen.getByRole('button', { name: 'Set shop location' }));
    const dialog = screen.getByRole('dialog', { name: 'Set shop location' });
    expect(within(dialog).getByLabelText(/^Latitude/)).toHaveValue('7.29');
    expect(within(dialog).getByLabelText(/^How to find it/)).toHaveValue('Opposite the temple');

    await user.type(within(dialog).getByLabelText('Pasted position'), 'nonsense');
    expect(within(dialog).getByText(/Paste the position as/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Pasted position'));
    fireEvent.change(within(dialog).getByLabelText('Pasted position'), { target: { value: '6.9271, 79.8612' } });
    expect(within(dialog).getByLabelText(/^Latitude/)).toHaveValue('6.9271');
    expect(within(dialog).getByLabelText(/^Longitude/)).toHaveValue('79.8612');
    expect(within(dialog).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=6.9271,79.8612');
    await user.clear(within(dialog).getByLabelText(/^How to find it/));
    await user.type(within(dialog).getByLabelText(/^How to find it/), 'Green gate, next to the bus stand');
    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(api.find('PUT', '/admin/sellers/s1/location')).toHaveLength(1));
    expect(api.find('PUT', '/admin/sellers/s1/location')[0]!.body).toEqual({ latitude: 6.9271, longitude: 79.8612, how_to_find: 'Green gate, next to the bus stand' });
    expect(await screen.findByText("Blynk Western's shop location is set and approved.")).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Set shop location' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Approved location' })).toHaveTextContent('6.927100, 79.861200');
  });

  it('checks the numbers, shows the API refusal, and reads the seller again when the API sends none back', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    let latitude: number | null = null;
    const { api } = await openSeller(
      {},
      {
        'GET /admin/sellers/:id': () => ok({ seller: seller(latitude === null ? {} : { latitude, longitude: 80.6, location_status: 'APPROVED' }), statement: statement() }),
        'PUT /admin/sellers/:id/location': (c) => {
          attempt += 1;
          if (attempt === 1) return fail(400, 'OUTSIDE_DELIVERY_AREA', 'That spot is too far from the store.');
          latitude = c.body.latitude;
          return ok({});
        },
      }
    );
    await user.click(screen.getByRole('button', { name: 'Set shop location' }));
    const dialog = screen.getByRole('dialog', { name: 'Set shop location' });
    expect(within(dialog).queryByRole('link', { name: 'Open in Google Maps' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));
    expect(within(dialog).getByText(/Enter the latitude/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter the longitude/)).toBeInTheDocument();
    expect(api.find('PUT', '/admin/sellers/s1/location')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Latitude/), '7.5');
    await user.type(within(dialog).getByLabelText(/^Longitude/), '80.6');
    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));
    expect(await within(dialog).findByText('That spot is too far from the store.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set shop location' })).toBeNull());
    expect(await screen.findByRole('group', { name: 'Approved location' })).toHaveTextContent('7.500000, 80.600000');
  });

  it('Edit details also covers the note', async () => {
    const user = userEvent.setup();
    const { api } = await openSeller({}, { 'PATCH /admin/sellers/:id': (c) => ok({ seller: seller({ note: c.body.note }) }) });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit seller details' });
    expect(within(dialog).getByLabelText('Shop name')).toHaveValue('Blynk Western');
    expect(within(dialog).getByLabelText('Contact name')).toHaveValue('Kumar');
    expect(within(dialog).getByLabelText('Address')).toHaveValue('12 Temple Rd, Dharga Town');
    await user.clear(within(dialog).getByLabelText('Note'));
    await user.type(within(dialog).getByLabelText('Note'), 'Open 7am to 7pm');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ note: 'Open 7am to 7pm' });
  });
});

describe('Commission-free period', () => {
  const patch = { 'PATCH /admin/sellers/:id': (c: Call) => ok({ seller: seller({ commission_free_until: c.body.commission_free_until }) }) };

  it('shows the end date with the days left and extends it by 30 days from its end', async () => {
    const user = userEvent.setup();
    const until = inDays(22.5);
    const { api } = await openSeller({ commission_free_until: until }, patch);
    const group = screen.getByRole('group', { name: 'Commission-free period' });
    expect(group).toHaveTextContent(/Commission-free until \d{1,2} \w{3} \d{4} \(23 days left\)/);
    await user.click(within(group).getByRole('button', { name: 'Extend by 30 days' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    const sent = api.find('PATCH', '/admin/sellers/s1')[0]!.body.commission_free_until as string;
    expect(Math.abs(new Date(sent).getTime() - (new Date(until).getTime() + 30 * DAY))).toBeLessThan(1000);
    expect(await screen.findByText('Commission-free period extended by 30 days.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Commission-free period' })).toHaveTextContent('(53 days left)');
  });

  it('says "1 day left" in the singular', async () => {
    await openSeller({ commission_free_until: inDays(0.5) });
    expect(screen.getByRole('group', { name: 'Commission-free period' })).toHaveTextContent('(1 day left)');
  });

  it('ends it now after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = await openSeller({ commission_free_until: inDays(10) }, patch);
    await user.click(screen.getByRole('button', { name: 'End now' }));
    const before = Date.now();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End now' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    const sent = new Date(api.find('PATCH', '/admin/sellers/s1')[0]!.body.commission_free_until as string).getTime();
    expect(sent).toBeGreaterThanOrEqual(before - 1000);
    expect(sent).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await screen.findByText('Commission-free period ended.')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Commission-free period' });
    expect(group).toHaveTextContent('The commission-free period ended on');
    expect(within(group).queryByRole('button', { name: 'End now' })).toBeNull();
  });

  it('edits the date (end of that Colombo day) when there is no period yet', async () => {
    const user = userEvent.setup();
    const { api } = await openSeller({ commission_free_until: null }, patch);
    const group = screen.getByRole('group', { name: 'Commission-free period' });
    expect(group).toHaveTextContent('No commission-free period.');
    expect(within(group).queryByRole('button', { name: 'End now' })).toBeNull();
    await user.click(within(group).getByRole('button', { name: 'Edit date' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit commission-free date' });
    await user.click(within(dialog).getByRole('button', { name: 'Save date' }));
    expect(within(dialog).getByText('Choose the last commission-free day.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('Last commission-free day'), { target: { value: '2026-12-15' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ commission_free_until: '2026-12-15T18:29:59.000Z' });
    expect(await screen.findByText('Commission-free until 15 Dec 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit commission-free date' })).toBeNull();
  });

  it('shows nothing about it on an API from before migration 065', async () => {
    const old = seller();
    delete old.commission_free_until;
    renderAs(OPERATIONS_STAFF, '/more/sellers/s1', {
      ...detail(),
      'GET /admin/sellers/:id': () => ok({ seller: old, statement: statement() }),
    });
    await screen.findByRole('heading', { name: 'Blynk Western' });
    expect(screen.getByRole('region', { name: 'Commission' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Commission-free period' })).toBeNull();
  });

  it('shows the API message when a change is refused', async () => {
    const user = userEvent.setup();
    await openSeller({ commission_free_until: inDays(5) }, { 'PATCH /admin/sellers/:id': () => fail(400, 'DATE_NOT_ALLOWED', 'That date is not allowed.') });
    await user.click(screen.getByRole('button', { name: 'Extend by 30 days' }));
    expect(await within(screen.getByRole('group', { name: 'Commission-free period' })).findByRole('alert')).toHaveTextContent('That date is not allowed.');
  });
});

describe('Sellers list and commission settings', () => {
  it('reads "N products live" on each card', async () => {
    renderAs(OPERATIONS_STAFF, '/more/sellers', {
      'GET /admin/sellers': () =>
        ok({ sellers: [seller({ products_live: 4, products_total: 6 }), seller({ id: 's2', shop_name: 'Galle Sweets', products_live: 1 }), seller({ id: 's3', shop_name: 'Empty Shop', products_live: 0 })] }),
      'GET /admin/seller-payout-requests': () => ok({ payout_requests: [] }),
    });
    expect(await screen.findByRole('listitem', { name: 'Seller Blynk Western' })).toHaveTextContent('4 of 6 products live');
    expect(screen.getByRole('listitem', { name: 'Seller Galle Sweets' })).toHaveTextContent('1 product live');
    expect(screen.getByRole('listitem', { name: 'Seller Empty Shop' })).toHaveTextContent('0 products live');
  });

  const settings = { default_percent: 2, ready: true, categories: [{ category_id: 'c1', name: 'Sweets', parent_id: null, percent: 3 }], free_days: 30 };

  it('edits "Free month for new sellers (days)" and sends free_days with the rest', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/seller-commission', {
      'GET /admin/settings/seller-commission': () => ok(settings),
      'PUT /admin/settings/seller-commission': (c) => ok({ ...settings, free_days: c.body.free_days }),
    });
    const form = await screen.findByRole('form', { name: 'Seller commission settings' });
    const field = within(form).getByLabelText('Free month for new sellers (days)');
    expect(field).toHaveValue('30');
    await user.clear(field);
    await user.type(field, '0');
    await user.click(within(form).getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/seller-commission')[0]!.body).toEqual({ default_percent: 2, categories: [{ category_id: 'c1', percent: 3 }], free_days: 0 });
    expect(await screen.findByText('Seller commission saved.')).toBeInTheDocument();
    expect(within(form).getByLabelText('Free month for new sellers (days)')).toHaveValue('0');
  });

  it('refuses a bad number of days', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/seller-commission', {
      'GET /admin/settings/seller-commission': () => ok(settings),
      'PUT /admin/settings/seller-commission': () => ok(settings),
    });
    const form = await screen.findByRole('form', { name: 'Seller commission settings' });
    const field = within(form).getByLabelText('Free month for new sellers (days)');
    await user.clear(field);
    await user.type(field, '400');
    await user.click(within(form).getByRole('button', { name: 'Save commission' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('from 0 to 365');
    expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(0);
  });

  it('hides the field on an API without free_days', async () => {
    const { free_days: _drop, ...older } = settings;
    renderAs(OPERATIONS_STAFF, '/more/seller-commission', { 'GET /admin/settings/seller-commission': () => ok(older) });
    await screen.findByRole('form', { name: 'Seller commission settings' });
    expect(screen.queryByLabelText('Free month for new sellers (days)')).toBeNull();
  });
});
