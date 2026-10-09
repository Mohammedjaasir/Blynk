import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Coupons } from '../pages/Coupons';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import { parseDropoffKm, tripOrdersLabel } from '../lib/riderTrips';
import { fail, mockApi, ok } from './mockApi';

/**
 * Owner, 2026-10-10: the "Rider trips" panel in Settings ("ops can control
 * the 2 orders for one delivery if it's in the same route") and the Coupons
 * page's notice when coupon codes are switched off at checkout. The rules
 * are tested against PostgreSQL in backend/api/tests/rider-trips-settings
 * and coupons.
 */

const renderPage = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

const checkout = (coupons_enabled: boolean) => ({
  coupons_enabled,
  new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
  show_offer_savings: false,
  updated_at: null,
});

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('rider trips (lib)', () => {
  it('parses the distance like the API', () => {
    expect(parseDropoffKm('1.5')).toEqual({ value: 1.5 });
    expect(parseDropoffKm('10')).toEqual({ value: 10 });
    expect(parseDropoffKm('0.4')).toHaveProperty('error');
    expect(parseDropoffKm('1.25')).toHaveProperty('error');
    expect(parseDropoffKm('')).toHaveProperty('error');
  });

  it('names 1 as no trips', () => {
    expect(tripOrdersLabel(1)).toBe('1 order (no trips)');
    expect(tripOrdersLabel(2)).toBe('2 orders');
  });
});

describe('Settings - rider trips (owner, 2026-10-10)', () => {
  it('shows the rules and saves new ones; refuses a bad distance', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/rider-trips') {
        return ok({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, updated_at: null });
      }
      if (c.method === 'PATCH' && c.path === '/admin/settings/rider-trips') return ok({ ...c.body, updated_at: '2026-10-10T05:00:00.000Z' });
      return undefined;
    });
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Rider trips' });
    const km = await within(panel).findByLabelText(/^Max distance between drop-offs/);
    expect(km).toHaveValue('1.5');
    expect(panel).toHaveTextContent('Now 2 orders, 1.5 km');
    expect(within(panel).getByRole('button', { name: '2 orders' })).toHaveAttribute('aria-pressed', 'true');
    expect(panel).toHaveTextContent('A second order is refused for that rider if its drop-off is farther than this, unless staff confirm.');

    await user.clear(km);
    await user.type(km, '11');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('Enter a distance from 0.5 to 10 km.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-trips')).toHaveLength(0);

    await user.click(within(panel).getByRole('button', { name: '1 order (no trips)' }));
    await user.clear(km);
    await user.type(km, '2');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/rider-trips')[0]?.body).toEqual({ max_active_deliveries: 1, max_dropoff_distance_km: 2 })
    );
    await waitFor(() => expect(panel).toHaveTextContent('Now 1 order (no trips), 2 km'));
  });

  it('shows a server validation message', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/rider-trips') {
        return ok({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, updated_at: null });
      }
      if (c.method === 'PATCH') return fail(400, 'VALIDATION_ERROR', 'Invalid', [{ message: 'The distance can be at most 10 km' }]);
      return undefined;
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Rider trips' });
    await within(panel).findByLabelText(/^Max distance/);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The distance can be at most 10 km')).toBeInTheDocument();
  });
});

describe('Coupons - coupon codes switched off at checkout (owner, 2026-10-10)', () => {
  it('says customers cannot enter codes, with a link to the checkout settings', async () => {
    mockApi((c) => {
      if (c.path === '/admin/coupons') return ok({ coupons: [] });
      if (c.path === '/admin/settings/checkout') return ok(checkout(false));
      return undefined;
    });
    renderPage(<Coupons />);
    expect(await screen.findByText("Customers can't enter codes until 'Coupon codes at checkout' is on.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open checkout settings' })).toHaveAttribute('href', '/settings#checkout');
  });

  it('says nothing when they are on, or when the switch cannot be read', async () => {
    mockApi((c) => {
      if (c.path === '/admin/coupons') return ok({ coupons: [] });
      if (c.path === '/admin/settings/checkout') return ok(checkout(true));
      return undefined;
    });
    renderPage(<Coupons />);
    await screen.findByText('No coupons yet');
    await waitFor(() => expect(screen.queryByText(/Customers can't enter codes/)).toBeNull());
    vi.unstubAllGlobals();

    mockApi((c) => (c.path === '/admin/coupons' ? ok({ coupons: [] }) : fail(500, 'INTERNAL')));
    renderPage(<Coupons />);
    await waitFor(() => expect(screen.getAllByText('No coupons yet')).toHaveLength(2));
    expect(screen.queryByText(/Customers can't enter codes/)).toBeNull();
  });

  it('the Checkout panel in Settings is the link target', async () => {
    mockApi((c) => (c.path === '/admin/settings/checkout' ? ok(checkout(false)) : undefined));
    renderPage(<Settings />);
    expect(await screen.findByRole('region', { name: 'Checkout' })).toHaveAttribute('id', 'checkout');
  });
});
