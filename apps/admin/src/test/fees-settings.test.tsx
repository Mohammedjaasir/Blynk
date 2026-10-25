import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { OrderBill } from '../components/OrderBill';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { CheckoutSettings } from '../api/types';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Delivery fee "Base + per km", small-order fee, delivery radius and the
 * free-delivery wording (owner, 2026-10-25;
 * docs/superpowers/plans/2026-10-25-fees.md, Admin section). The rules are the
 * backend's; here, what the page shows and sends.
 */

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const CHECKOUT: CheckoutSettings = {
  coupons_enabled: false,
  new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
  show_offer_savings: false,
  basket_free_delivery: { enabled: true, min_subtotal_lkr: 3000 },
  order_for_someone_else: { enabled: true, send_code_to_receiver: true },
  small_order_fee: { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 },
  small_order_fee_ready: true,
  updated_at: null,
};

const FEE = {
  fee_lkr: 150,
  fee_mode: 'FLAT',
  tiers: [],
  max_fee_lkr: null,
  base_lkr: 120,
  base_km: 2,
  per_km_lkr: 40,
  updated_at: null,
};

/** Stateful fakes of the three settings endpoints; `extra` can answer first. */
function feesApi(extra: (call: Call) => Reply | undefined = () => undefined, opts: { fee?: Record<string, unknown>; checkout?: Partial<CheckoutSettings> } = {}) {
  let fee: Record<string, any> = { ...FEE, ...opts.fee };
  let checkout: CheckoutSettings = { ...CHECKOUT, ...opts.checkout };
  let radius = { radius_km: 4, store_name: 'Blynk Dharga Town' };
  return mockApi((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.path === '/admin/settings/delivery-fee') {
      if (c.method === 'PATCH') fee = { ...fee, ...c.body, updated_at: '2026-10-25T05:00:00.000Z' };
      return ok(fee);
    }
    if (c.path === '/admin/settings/checkout') {
      if (c.method === 'PATCH') checkout = { ...checkout, ...c.body };
      return ok(checkout);
    }
    if (c.path === '/admin/settings/delivery-radius') {
      if (c.method === 'PATCH') radius = { ...radius, ...c.body };
      return ok(radius);
    }
    return undefined;
  });
}

const previewRows = (panel: HTMLElement) =>
  within(within(panel).getByTestId('base-per-km-preview'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));

describe('Settings - delivery fee "Base + per km"', () => {
  it('offers the mode next to Flat and By distance, prefilled with 120 / 2 / 40 and a live preview table', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    await within(panel).findByLabelText(/Delivery fee \(LKR\)/);
    expect(within(panel).getByRole('button', { name: 'Same fee for every order' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'By distance (per km)' })).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Base + per km' }));
    expect(within(panel).queryByLabelText(/Delivery fee \(LKR\)/)).toBeNull();
    expect(within(panel).getByLabelText(/Base fee \(LKR\)/)).toHaveValue('120');
    expect(within(panel).getByLabelText(/Covers the first \(km\)/)).toHaveValue('2');
    expect(within(panel).getByLabelText(/Then for each extra started km \(LKR\)/)).toHaveValue('40');
    expect(within(panel).getByLabelText(/Maximum fee/)).toHaveValue('');
    expect(previewRows(panel)).toEqual([
      ['1.5 km', 'LKR 120'],
      ['2 km', 'LKR 120'],
      ['2.1 km', 'LKR 160'],
      ['3 km', 'LKR 160'],
      ['3.4 km', 'LKR 200'],
      ['4.8 km', 'LKR 240'],
      ['5.6 km', 'LKR 280'],
    ]);
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);
  });

  it('recomputes the preview as the numbers and the maximum fee change, and saves exactly what is shown', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    await user.click(await within(panel).findByRole('button', { name: 'Base + per km' }));

    const base = within(panel).getByLabelText(/Base fee \(LKR\)/);
    const km = within(panel).getByLabelText(/Covers the first \(km\)/);
    const per = within(panel).getByLabelText(/Then for each extra started km \(LKR\)/);
    await user.clear(base);
    await user.type(base, '150');
    await user.clear(km);
    await user.type(km, '3');
    await user.clear(per);
    await user.type(per, '50');
    expect(previewRows(panel)).toEqual([
      ['1.5 km', 'LKR 150'],
      ['2 km', 'LKR 150'],
      ['2.1 km', 'LKR 150'],
      ['3 km', 'LKR 150'],
      ['3.4 km', 'LKR 200'],
      ['4.8 km', 'LKR 250'],
      ['5.6 km', 'LKR 300'],
    ]);
    await user.type(within(panel).getByLabelText(/Maximum fee/), '220');
    expect(previewRows(panel).map((r) => r[1])).toEqual([
      'LKR 150',
      'LKR 150',
      'LKR 150',
      'LKR 150',
      'LKR 200',
      'LKR 220',
      'LKR 220',
    ]);

    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/delivery-fee')[0]?.body).toEqual({
        fee_mode: 'BASE_PER_KM',
        base_lkr: 150,
        base_km: 3,
        per_km_lkr: 50,
        max_fee_lkr: 220,
      })
    );
    expect(await screen.findByText(/Delivery fee is now LKR 150 up to 3 km, then LKR 50 for each extra km, at most LKR 220/)).toBeInTheDocument();
    expect(within(panel).getByText(/Currently LKR 150 up to 3 km/)).toBeInTheDocument();
  });

  it('loads a stored BASE_PER_KM fee with its own numbers', async () => {
    feesApi(() => undefined, { fee: { fee_mode: 'BASE_PER_KM', base_lkr: 99.5, base_km: 2.5, per_km_lkr: 37.25, max_fee_lkr: 400 } });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    expect(await within(panel).findByLabelText(/Base fee \(LKR\)/)).toHaveValue('99.5');
    expect(within(panel).getByRole('button', { name: 'Base + per km' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByLabelText(/Covers the first \(km\)/)).toHaveValue('2.5');
    expect(within(panel).getByLabelText(/Then for each extra started km/)).toHaveValue('37.25');
    expect(within(panel).getByLabelText(/Maximum fee/)).toHaveValue('400');
    expect(within(panel).getByText(/Currently LKR 99.50 up to 2.5 km, then LKR 37.25 for each extra km, at most LKR 400/)).toBeInTheDocument();
  });

  it('falls back to 120 / 2 / 40 when an older API sends no base numbers', async () => {
    const user = userEvent.setup();
    feesApi(() => undefined, { fee: { base_lkr: undefined, base_km: undefined, per_km_lkr: undefined } });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    await user.click(await within(panel).findByRole('button', { name: 'Base + per km' }));
    expect(within(panel).getByLabelText(/Base fee \(LKR\)/)).toHaveValue('120');
    expect(within(panel).getByLabelText(/Covers the first \(km\)/)).toHaveValue('2');
  });

  it('refuses bad numbers before saving and says which box', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    await user.click(await within(panel).findByRole('button', { name: 'Base + per km' }));
    const km = within(panel).getByLabelText(/Covers the first \(km\)/);
    await user.clear(km);
    await user.type(km, '0.2');
    await user.clear(within(panel).getByLabelText(/Then for each extra started km/));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The base distance must be between 0.5 and 20 km.')).toBeInTheDocument();
    expect(within(panel).getByText('Enter the fee for each extra km in LKR, like 40.')).toBeInTheDocument();
    expect(within(panel).getByText('Enter all three amounts to see examples.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);
  });

  it("shows the server's refusal", async () => {
    const user = userEvent.setup();
    feesApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/delivery-fee'
        ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'base_km', message: 'base_km must be at least 0.5' }])
        : undefined
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    await user.click(await within(panel).findByRole('button', { name: 'Base + per km' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('base_km must be at least 0.5')).toBeInTheDocument();
  });

  it('the Flat and By distance saves are unchanged', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery fee' });
    const input = await within(panel).findByLabelText(/Delivery fee \(LKR\)/);
    await user.clear(input);
    await user.type(input, '175');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-fee')[0]?.body).toEqual({ fee_mode: 'FLAT', fee_lkr: 175 }));
  });
});

describe('Settings - small-order fee card', () => {
  it('is off by default with LKR 1,000 / LKR 50 and explains itself', async () => {
    feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Small-order fee' });
    const toggle = await within(panel).findByRole('switch', { name: 'Charge a small-order fee' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(panel).getByLabelText(/Item total under \(LKR\)/)).toHaveValue('1000');
    expect(within(panel).getByLabelText(/^Fee \(LKR\)/)).toHaveValue('50');
    expect(panel).toHaveTextContent(
      'Customers whose items total less than this pay the fee on top of delivery. Free delivery does not remove it.'
    );
    expect(within(panel).queryByTestId('small-order-fee-migration')).toBeNull();
  });

  it('switches on, edits the two amounts and saves them together with PATCH /admin/settings/checkout', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Small-order fee' });
    await user.click(await within(panel).findByRole('switch', { name: 'Charge a small-order fee' }));
    const min = within(panel).getByLabelText(/Item total under \(LKR\)/);
    const fee = within(panel).getByLabelText(/^Fee \(LKR\)/);
    await user.clear(min);
    await user.type(min, '1500');
    await user.clear(fee);
    await user.type(fee, '75.50');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        small_order_fee: { enabled: true, min_subtotal_lkr: 1500, fee_lkr: 75.5 },
      })
    );
    expect(await screen.findByText(/Small-order fee is LKR 75.50 when the items come to less than LKR 1,500/)).toBeInTheDocument();
    expect(within(panel).getByRole('switch', { name: 'Charge a small-order fee' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows "Needs migration 063" next to the switch while small_order_fee_ready is false', async () => {
    feesApi(() => undefined, { checkout: { small_order_fee_ready: false } });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Small-order fee' });
    expect(await within(panel).findByTestId('small-order-fee-migration')).toHaveTextContent('Needs migration 063');
  });

  it('shows the 409 message inline when switching on without the migration, and puts the switch back off', async () => {
    const user = userEvent.setup();
    feesApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/checkout'
        ? fail(409, 'SMALL_ORDER_FEE_NOT_READY', 'Run migration 063 in Coolify before switching the small-order fee on.')
        : undefined
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Small-order fee' });
    await user.click(await within(panel).findByRole('switch', { name: 'Charge a small-order fee' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'Run migration 063 in Coolify before switching the small-order fee on.'
    );
    expect(within(panel).getByRole('switch', { name: 'Charge a small-order fee' })).toHaveAttribute('aria-checked', 'false');
    expect(within(panel).getByTestId('small-order-fee-migration')).toHaveTextContent('Needs migration 063');
  });

  it('refuses bad amounts before saving', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Small-order fee' });
    const min = await within(panel).findByLabelText(/Item total under \(LKR\)/);
    await user.clear(min);
    await user.type(min, '0');
    const fee = within(panel).getByLabelText(/^Fee \(LKR\)/);
    await user.clear(fee);
    await user.type(fee, '0');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The item total must be between LKR 1 and LKR 100,000.')).toBeInTheDocument();
    expect(within(panel).getByText('The fee must be between LKR 0.01 and LKR 1,000.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);
  });

  it('shows other save errors inline', async () => {
    const user = userEvent.setup();
    feesApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/checkout' ? fail(500, 'INTERNAL', 'Something went wrong.') : undefined
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Small-order fee' });
    await user.click(await within(panel).findByRole('button', { name: 'Save' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('does not change the Checkout card save (it never sends small_order_fee)', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const checkout = await screen.findByRole('region', { name: 'Checkout' });
    await user.click(await within(checkout).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).not.toHaveProperty('small_order_fee');
  });
});

describe('Settings - delivery radius card', () => {
  it('shows the store name and the current radius, and saves a new one', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery radius' });
    expect(await within(panel).findByTestId('delivery-radius-current')).toHaveTextContent('Blynk Dharga Town: currently 4 km.');
    const input = within(panel).getByLabelText(/Delivery radius \(km\)/);
    expect(input).toHaveValue('4');
    await user.clear(input);
    await user.type(input, '6');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-radius')[0]?.body).toEqual({ radius_km: 6 }));
    expect(await screen.findByText('Delivery radius is now 6 km.')).toBeInTheDocument();
    expect(within(panel).getByTestId('delivery-radius-current')).toHaveTextContent('currently 6 km');
  });

  it('refuses a radius outside 0.5 to 50 km before saving', async () => {
    const user = userEvent.setup();
    const api = feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery radius' });
    const input = await within(panel).findByLabelText(/Delivery radius \(km\)/);
    await user.clear(input);
    await user.type(input, '75');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The radius must be between 0.5 and 50 km.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-radius')).toHaveLength(0);
  });

  it("shows the server's refusal and a load failure", async () => {
    const user = userEvent.setup();
    feesApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/delivery-radius'
        ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'radius_km', message: 'radius_km must be at most 50' }])
        : undefined
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery radius' });
    await user.click(await within(panel).findByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('radius_km must be at most 50')).toBeInTheDocument();
  });

  it('says so when the radius cannot be loaded', async () => {
    mockApi((c) => (c.path === '/admin/settings/delivery-radius' ? fail(500, 'INTERNAL', 'Boom') : undefined));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery radius' });
    expect(await within(panel).findByText('Boom')).toBeInTheDocument();
  });
});

describe('Settings - free delivery above an amount wording', () => {
  it('says "Free delivery when the item total is at least LKR X" and that Blynk covers the rider share', async () => {
    const user = userEvent.setup();
    feesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Checkout' });
    const toggle = await within(panel).findByRole('checkbox', { name: 'Free delivery when the item total is at least LKR 3,000' });
    expect(toggle).toBeChecked();
    expect(panel).toHaveTextContent('The rider is still paid their normal share of the delivery fee; Blynk covers it.');

    const amount = within(panel).getByLabelText(/Free delivery from \(LKR\)/);
    await user.clear(amount);
    await user.type(amount, '2500');
    expect(within(panel).getByRole('checkbox', { name: 'Free delivery when the item total is at least LKR 2,500' })).toBeInTheDocument();
  });
});

describe('OrderBill - small-order fee row', () => {
  const order = { subtotal_amount: 800, delivery_fee: 150, total_amount: 1000 };

  it('shows the row only when the fee is more than 0, between delivery and the total', () => {
    const { rerender } = render(<OrderBill order={{ ...order, small_order_fee: 50 }} />);
    const bill = screen.getByLabelText('Bill');
    expect(screen.getByTestId('bill-small-order-fee')).toHaveTextContent('LKR 50');
    const labels = within(bill).getAllByRole('term').map((t) => t.textContent);
    expect(labels).toEqual(['Items', 'Delivery', 'Small-order fee', 'Total · cash to collect']);

    rerender(<OrderBill order={{ ...order, small_order_fee: 0 }} />);
    expect(screen.queryByText('Small-order fee')).not.toBeInTheDocument();
    rerender(<OrderBill order={order} />);
    expect(screen.queryByText('Small-order fee')).not.toBeInTheDocument();
  });
});
