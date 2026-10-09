import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { Coupon } from '../api/types';
import { parseDropoffKm } from '../lib/riderTrips';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Owner, 2026-10-10: "ops can control the 2 orders for one delivery if it's
 * in the same route" (the Rider trips card on More) and "make sure admin and
 * ops can create a coupon code for customers" (/more/coupons).
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const checkout = (coupons_enabled: boolean) => ({
  coupons_enabled,
  new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
  show_offer_savings: false,
  updated_at: null,
});

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c1',
    code: 'WELCOME50',
    description: 'First order treat',
    discount_type: 'FIXED',
    discount_value: 50,
    max_discount: null,
    min_subtotal: 500,
    first_order_only: true,
    starts_at: null,
    ends_at: null,
    usage_limit: 100,
    per_customer_limit: 1,
    is_active: true,
    usage_count: 3,
    created_at: '2026-10-01T04:00:00Z',
    ...overrides,
  };
}

describe('parseDropoffKm', () => {
  it('accepts 0.5-10 km with one decimal', () => {
    expect(parseDropoffKm('1.5')).toEqual({ value: 1.5 });
    expect(parseDropoffKm(' 2 km ')).toEqual({ value: 2 });
    expect(parseDropoffKm('0.5')).toEqual({ value: 0.5 });
    expect(parseDropoffKm('10')).toEqual({ value: 10 });
    expect(parseDropoffKm('')).toHaveProperty('error');
    expect(parseDropoffKm('0.4')).toHaveProperty('error');
    expect(parseDropoffKm('10.5')).toHaveProperty('error');
    expect(parseDropoffKm('1.25')).toHaveProperty('error');
    expect(parseDropoffKm('far')).toHaveProperty('error');
  });
});

describe('Rider trips card (More)', () => {
  it('shows the rules and saves new ones; refuses a bad distance', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/rider-trips': () => ok({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, updated_at: null }),
      'PATCH /admin/settings/rider-trips': (call) => ok({ ...call.body, updated_at: '2026-10-10T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Rider trips' })).closest('section') as HTMLElement;
    expect(await within(card).findByText('2 orders, 1.5 km')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '2 orders' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(card).getByText('A second order is refused for that rider if its drop-off is farther than this, unless staff confirm.')
    ).toBeInTheDocument();

    const km = within(card).getByLabelText(/^Max distance between drop-offs/);
    expect(km).toHaveValue('1.5');
    await user.clear(km);
    await user.type(km, '12');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Enter a distance from 0.5 to 10 km.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-trips')).toHaveLength(0);

    await user.click(within(card).getByRole('button', { name: '3 orders' }));
    await user.clear(km);
    await user.type(km, '2.5');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/rider-trips')[0]?.body).toEqual({ max_active_deliveries: 3, max_dropoff_distance_km: 2.5 })
    );
    expect(await within(card).findByText('Rider trips saved: 3 orders, 2.5 km.')).toBeInTheDocument();
  });

  it('1 = no trips', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/rider-trips': () => ok({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, updated_at: null }),
      'PATCH /admin/settings/rider-trips': (call) => ok({ ...call.body, updated_at: null }),
    });
    const card = (await screen.findByRole('heading', { name: 'Rider trips' })).closest('section') as HTMLElement;
    await user.click(await within(card).findByRole('button', { name: '1 order (no trips)' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-trips')[0]?.body.max_active_deliveries).toBe(1));
    expect(await within(card).findByText('1 order (no trips), 1.5 km')).toBeInTheDocument();
  });

  it('shows the server refusal', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/rider-trips': () => ok({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, updated_at: null }),
      'PATCH /admin/settings/rider-trips': () => fail(403, 'FORBIDDEN', 'Your account is not allowed to do this.'),
    });
    const card = (await screen.findByRole('heading', { name: 'Rider trips' })).closest('section') as HTMLElement;
    await user.click(await within(card).findByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Your account is not allowed to do this.');
  });
});

describe('Coupons (More -> Coupons)', () => {
  it('More links to the Coupons page', async () => {
    renderAs(OPERATIONS_STAFF, '/more');
    expect(await screen.findByRole('link', { name: 'Coupons' })).toHaveAttribute('href', '/more/coupons');
  });

  it('lists coupons as cards, and warns when coupon codes are off at checkout', async () => {
    renderAs(OPERATIONS_STAFF, '/more/coupons', {
      'GET /admin/coupons': () => ok({ coupons: [coupon(), coupon({ id: 'c2', code: 'TENOFF', discount_type: 'PERCENT', discount_value: 10, max_discount: 200, usage_count: 0, is_active: false, description: null, first_order_only: false, min_subtotal: null, usage_limit: null })] }),
      'GET /admin/settings/checkout': () => ok(checkout(false)),
    });
    const list = await screen.findByRole('list', { name: 'Coupons' });
    expect(within(list).getByText('WELCOME50')).toBeInTheDocument();
    expect(within(list).getByText('LKR 50 off')).toBeInTheDocument();
    expect(within(list).getByText(/First order only · Min\. LKR 500 · 1 per customer/)).toBeInTheDocument();
    expect(within(list).getByText('Used 3 / 100')).toBeInTheDocument();
    expect(within(list).getByText('10% off, up to LKR 200')).toBeInTheDocument();
    expect(within(list).getByText('Switched off')).toBeInTheDocument();
    // Only an unused coupon can be deleted.
    expect(within(list).queryByRole('button', { name: 'Delete WELCOME50' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Delete TENOFF' })).toBeInTheDocument();

    expect(await screen.findByText("Customers can't enter codes until 'Coupon codes at checkout' is on.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open checkout settings' })).toHaveAttribute('href', '/more#checkout-settings');
  });

  it('shows no warning when coupon codes are on', async () => {
    renderAs(OPERATIONS_STAFF, '/more/coupons', {
      'GET /admin/coupons': () => ok({ coupons: [coupon()] }),
      'GET /admin/settings/checkout': () => ok(checkout(true)),
    });
    await screen.findByRole('list', { name: 'Coupons' });
    await waitFor(() => expect(screen.queryByText(/Customers can't enter codes/)).toBeNull());
  });

  it('the warning link opens More at the Checkout card', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/coupons', {
      'GET /admin/coupons': () => ok({ coupons: [] }),
      'GET /admin/settings/checkout': () => ok(checkout(false)),
    });
    await user.click(await screen.findByRole('link', { name: 'Open checkout settings' }));
    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
    expect(document.getElementById('checkout-settings')).not.toBeNull();
  });

  it('creates a percentage coupon with a minimum basket and limits', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/coupons', {
      'GET /admin/coupons': () => ok({ coupons: [] }),
      'GET /admin/settings/checkout': () => ok(checkout(true)),
      'POST /admin/coupons': (call) =>
        ok({ coupon: coupon({ id: 'new', usage_count: 0, ...call.body }) }),
    });
    await screen.findByText('No coupons yet');
    await user.click(screen.getAllByRole('button', { name: 'New coupon' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New coupon' });

    // Nothing is sent until the form is right.
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(within(dialog).getByText('Use 4-20 letters or digits, no spaces.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/coupons')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Code/), 'diwali10');
    await user.click(within(dialog).getByRole('button', { name: '% off' }));
    expect(within(dialog).getByRole('button', { name: '% off' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(within(dialog).getByLabelText(/^Percentage off/), '10');
    await user.type(within(dialog).getByLabelText(/^Maximum discount/), '300');
    await user.type(within(dialog).getByLabelText(/^Minimum basket/), '1000');
    await user.type(within(dialog).getByLabelText(/^Total uses/), '200');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));

    await waitFor(() => expect(api.find('POST', '/admin/coupons')).toHaveLength(1));
    expect(api.find('POST', '/admin/coupons')[0].body).toEqual({
      code: 'DIWALI10',
      description: null,
      discount_type: 'PERCENT',
      discount_value: 10,
      max_discount: 300,
      min_subtotal: 1000,
      first_order_only: false,
      starts_at: null,
      ends_at: null,
      usage_limit: 200,
      per_customer_limit: 1,
      is_active: true,
    });
    expect(await screen.findByText('DIWALI10 created.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Coupons' })).getByText('DIWALI10')).toBeInTheDocument();
  });

  it('a taken code is shown next to the code', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/coupons', {
      'GET /admin/coupons': () => ok({ coupons: [] }),
      'GET /admin/settings/checkout': () => ok(checkout(true)),
      'POST /admin/coupons': () => fail(409, 'COUPON_CODE_TAKEN', 'A coupon with this code already exists.'),
    });
    await screen.findByText('No coupons yet');
    await user.click(screen.getAllByRole('button', { name: 'New coupon' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New coupon' });
    await user.type(within(dialog).getByLabelText(/^Code/), 'SAVE50');
    await user.type(within(dialog).getByLabelText('Amount off (LKR)'), '50');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(await within(dialog).findByText('Another coupon already uses this code.')).toBeInTheDocument();
  });

  it('switches a coupon off, edits one, and deletes an unused one', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/coupons', {
      'GET /admin/coupons': () => ok({ coupons: [coupon(), coupon({ id: 'c2', code: 'SPARE1', usage_count: 0 })] }),
      'GET /admin/settings/checkout': () => ok(checkout(true)),
      'PATCH /admin/coupons/:id': (call) =>
        ok({ coupon: coupon({ id: call.path.split('/').pop()!, ...call.body }) }),
      'DELETE /admin/coupons/:id': () => ok({ deleted: true }),
    });
    const list = await screen.findByRole('list', { name: 'Coupons' });

    await user.click(within(list).getByRole('button', { name: 'Switch off WELCOME50' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/coupons/c1')[0]?.body).toEqual({ is_active: false }));
    expect(await screen.findByText('WELCOME50 is switched off.')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Switch on WELCOME50' })).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: 'Edit WELCOME50' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit WELCOME50' });
    expect(within(dialog).getByLabelText(/^Code/)).toBeDisabled();
    const amount = within(dialog).getByLabelText('Amount off (LKR)');
    await user.clear(amount);
    await user.type(amount, '75');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/coupons/c1')).toHaveLength(2));
    const edit = api.find('PATCH', '/admin/coupons/c1')[1].body;
    expect(edit).toMatchObject({ discount_type: 'FIXED', discount_value: 75 });
    expect(edit).not.toHaveProperty('code');
    expect(await screen.findByText('WELCOME50 saved.')).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: 'Delete SPARE1' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete coupon' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/coupons/c2')).toHaveLength(1));
    expect(await screen.findByText('SPARE1 deleted.')).toBeInTheDocument();
    expect(within(list).queryByText('SPARE1')).toBeNull();
  });
});
