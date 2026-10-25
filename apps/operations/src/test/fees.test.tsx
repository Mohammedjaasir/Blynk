import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { CheckoutSettings, OrderDetail } from '../api/types';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * 2026-10-25 (docs/superpowers/plans/2026-10-25-fees.md), on More: the
 * Delivery fee card's "Base + per km" mode with its live preview, the
 * Small-order fee card, the Delivery radius card, the free-delivery wording,
 * and the "Small-order fee" row on the order bill.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const FEE = {
  fee_lkr: 250,
  fee_mode: 'FLAT',
  tiers: [],
  max_fee_lkr: null,
  base_lkr: 120,
  base_km: 2,
  per_km_lkr: 40,
  updated_at: null,
};

describe('Delivery fee card: Base + per km', () => {
  it('switches mode, shows the default values and the live preview, saves the four fields and the cap', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ ...FEE }),
      'PATCH /admin/settings/delivery-fee': (call) => ok({ ...FEE, ...(call.body as object), updated_at: '2026-10-25T10:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Delivery fee' })).closest('section') as HTMLElement;
    await within(card).findByText('LKR 250.00');
    const modes = within(card).getByRole('group', { name: 'How the fee is worked out' });
    await user.click(within(modes).getByRole('button', { name: 'Base + per km' }));
    expect(within(modes).getByRole('button', { name: 'Base + per km' })).toHaveAttribute('aria-pressed', 'true');

    const base = within(card).getByLabelText('Base fee (LKR)');
    const km = within(card).getByLabelText('Covers the first (km)');
    const per = within(card).getByLabelText('Then for each extra started km (LKR)');
    expect(base).toHaveValue('120');
    expect(km).toHaveValue('2');
    expect(per).toHaveValue('40');

    const preview = within(card).getByTestId('base-per-km-preview');
    expect(within(preview).getByTestId('base-per-km-row-1.5')).toHaveTextContent('1.5 km = LKR 120');
    expect(within(preview).getByTestId('base-per-km-row-2')).toHaveTextContent('2 km = LKR 120');
    expect(within(preview).getByTestId('base-per-km-row-2.1')).toHaveTextContent('2.1 km = LKR 160');
    expect(within(preview).getByTestId('base-per-km-row-3')).toHaveTextContent('3 km = LKR 160');
    expect(within(preview).getByTestId('base-per-km-row-3.4')).toHaveTextContent('3.4 km = LKR 200');
    expect(within(preview).getByTestId('base-per-km-row-4.8')).toHaveTextContent('4.8 km = LKR 240');
    expect(within(preview).getByTestId('base-per-km-row-5.6')).toHaveTextContent('5.6 km = LKR 280');

    // The preview follows the typed values and the cap.
    await user.clear(base);
    await user.type(base, '100');
    await user.clear(km);
    await user.type(km, '1');
    await user.clear(per);
    await user.type(per, '30');
    expect(within(preview).getByTestId('base-per-km-row-1.5')).toHaveTextContent('1.5 km = LKR 130');
    expect(within(preview).getByTestId('base-per-km-row-5.6')).toHaveTextContent('5.6 km = LKR 250');
    await user.type(within(card).getByLabelText('Maximum fee (LKR, optional)'), '200');
    expect(within(preview).getByTestId('base-per-km-row-5.6')).toHaveTextContent('5.6 km = LKR 200');

    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/delivery-fee')[0].body).toEqual({
      fee_mode: 'BASE_PER_KM',
      base_lkr: 100,
      base_km: 1,
      per_km_lkr: 30,
      max_fee_lkr: 200,
    });
    expect(
      await within(card).findByText('Delivery fee saved: LKR 100 up to 1 km, then LKR 30 for each extra km · max LKR 200.')
    ).toBeInTheDocument();
    expect(within(card).getByText('Base + per km', { selector: '.card__value' })).toBeInTheDocument();
    expect(within(card).getByTestId('fee-formula-now')).toHaveTextContent('LKR 100 up to 1 km, then LKR 30 for each extra km · max LKR 200');
  });

  it('opens on a stored Base + per km fee and refuses bad numbers before sending', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ ...FEE, fee_mode: 'BASE_PER_KM', base_lkr: 150, base_km: 2.5, per_km_lkr: 35 }),
    });
    const card = (await screen.findByRole('heading', { name: 'Delivery fee' })).closest('section') as HTMLElement;
    expect(await within(card).findByTestId('fee-formula-now')).toHaveTextContent('LKR 150 up to 2.5 km, then LKR 35 for each extra km');
    const base = within(card).getByLabelText('Base fee (LKR)');
    const km = within(card).getByLabelText('Covers the first (km)');
    expect(base).toHaveValue('150');
    expect(km).toHaveValue('2.5');

    await user.clear(km);
    await user.type(km, '25');
    expect(within(card).getByTestId('base-per-km-preview')).toHaveTextContent('Fill in the three amounts to see an example.');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Covers the first km: Enter at most 20.')).toBeInTheDocument();

    await user.clear(km);
    await user.type(km, '2.25');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Covers the first km: Use at most 1 decimal.')).toBeInTheDocument();

    await user.clear(km);
    await user.type(km, '2');
    await user.clear(base);
    await user.type(base, '1500');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Base fee: Enter at most 1,000.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-fee')).toHaveLength(0);
  });

  it('shows the server validation detail', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ ...FEE, fee_mode: 'BASE_PER_KM' }),
      'PATCH /admin/settings/delivery-fee': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ message: 'base_km must be at most 20' }] },
      }),
    });
    const card = (await screen.findByRole('heading', { name: 'Delivery fee' })).closest('section') as HTMLElement;
    await within(card).findByTestId('fee-formula-now');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('base_km must be at most 20')).toBeInTheDocument();
  });
});

const CHECKOUT: CheckoutSettings = {
  coupons_enabled: false,
  new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
  basket_free_delivery: { enabled: true, min_subtotal_lkr: 3000 },
  order_for_someone_else: { enabled: true, send_code_to_receiver: true },
  small_order_fee: { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 },
  small_order_fee_ready: true,
  updated_at: null,
};

describe('Small-order fee card', () => {
  it('shows the defaults off, explains itself, and saves the switch with both amounts', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
      'PATCH /admin/settings/checkout': (call) => ok({ ...CHECKOUT, ...(call.body as object), updated_at: '2026-10-25T10:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Small-order fee' })).closest('section') as HTMLElement;
    const toggle = await within(card).findByRole('checkbox', { name: /Charge a small-order fee/ });
    expect(toggle).not.toBeChecked();
    expect(card).toHaveTextContent(
      'Customers whose items total less than this pay the fee on top of delivery. Free delivery does not remove it.'
    );
    expect(within(card).queryByTestId('small-order-fee-not-ready')).not.toBeInTheDocument();
    const min = within(card).getByLabelText('Item total under (LKR)');
    const fee = within(card).getByLabelText('Fee (LKR)');
    expect(min).toHaveValue('1000');
    expect(fee).toHaveValue('50');

    await user.click(toggle);
    await user.clear(min);
    await user.type(min, '1500');
    await user.clear(fee);
    await user.type(fee, '75.50');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/checkout')[0].body).toEqual({
      small_order_fee: { enabled: true, min_subtotal_lkr: 1500, fee_lkr: 75.5 },
    });
    expect(
      await within(card).findByText(
        'Small-order fee is on. Customers whose items total under LKR 1,500 pay LKR 75.50 on top of delivery.'
      )
    ).toBeInTheDocument();
    expect(toggle).toBeChecked();
  });

  it('says "Needs migration 063" while the backend is not ready, and shows the 409 message inline', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/checkout': () => ok({ ...CHECKOUT, small_order_fee_ready: false }),
      'PATCH /admin/settings/checkout': () =>
        fail(409, 'SMALL_ORDER_FEE_NOT_READY', 'Run migration 063 in Coolify before switching the small-order fee on.'),
    });
    const card = (await screen.findByRole('heading', { name: 'Small-order fee' })).closest('section') as HTMLElement;
    expect(await within(card).findByTestId('small-order-fee-not-ready')).toHaveTextContent('Needs migration 063');
    await user.click(within(card).getByRole('checkbox', { name: /Charge a small-order fee/ }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Run migration 063 in Coolify before switching the small-order fee on.');
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(1);
    // The switch keeps what was typed so the operator can switch it back off.
    expect(within(card).getByRole('checkbox', { name: /Charge a small-order fee/ })).toBeChecked();
  });

  it('refuses a bad amount or fee before sending anything', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
    });
    const card = (await screen.findByRole('heading', { name: 'Small-order fee' })).closest('section') as HTMLElement;
    const min = await within(card).findByLabelText('Item total under (LKR)');
    await user.clear(min);
    await user.type(min, '0');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Item total under: Enter 1 or more.')).toBeInTheDocument();
    await user.clear(min);
    await user.type(min, '1000');
    const fee = within(card).getByLabelText('Fee (LKR)');
    await user.clear(fee);
    await user.type(fee, '0');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Fee: Enter more than 0.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);
  });
});

describe('Delivery radius card', () => {
  it('shows the store and radius and saves a new radius', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-radius': () => ok({ radius_km: 4, store_name: 'Blynk Dharga Town' }),
      'PATCH /admin/settings/delivery-radius': (call) =>
        ok({ radius_km: (call.body as { radius_km: number }).radius_km, store_name: 'Blynk Dharga Town' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Delivery radius' })).closest('section') as HTMLElement;
    expect(await within(card).findByTestId('radius-store')).toHaveTextContent('Blynk Dharga Town');
    const input = within(card).getByLabelText('Delivery radius (km)');
    expect(input).toHaveValue('4');
    await user.clear(input);
    await user.type(input, '6');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-radius')[0]?.body).toEqual({ radius_km: 6 }));
    expect(await within(card).findByText('Delivery radius saved: 6 km.')).toBeInTheDocument();
    expect(input).toHaveValue('6');
  });

  it('refuses an out-of-range radius before sending, and shows a server error', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-radius': () => ok({ radius_km: 4, store_name: 'Blynk Dharga Town' }),
      'PATCH /admin/settings/delivery-radius': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ message: 'radius_km must be at most 50' }] },
      }),
    });
    const card = (await screen.findByRole('heading', { name: 'Delivery radius' })).closest('section') as HTMLElement;
    const input = await within(card).findByLabelText('Delivery radius (km)');
    await user.clear(input);
    await user.type(input, '51');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Delivery radius: Enter at most 50.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/delivery-radius')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '12.5');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('radius_km must be at most 50')).toBeInTheDocument();
  });

  it('shows the load error and no form when the radius cannot be read', async () => {
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-radius': () => fail(500, 'INTERNAL'),
    });
    const card = (await screen.findByRole('heading', { name: 'Delivery radius' })).closest('section') as HTMLElement;
    expect(await within(card).findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('Checkout card: free delivery above an amount wording', () => {
  it('says the rule with the amount and that Blynk covers the rider share', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/settings/checkout': () => ok(CHECKOUT) });
    const card = (await screen.findByRole('heading', { name: 'Checkout' })).closest('section') as HTMLElement;
    const toggle = await within(card).findByRole('checkbox', { name: /Free delivery above a basket amount/ });
    expect(toggle.closest('label')).toHaveTextContent('Free delivery when the item total is at least LKR 3,000.');
    expect(toggle.closest('label')).toHaveTextContent('The rider is still paid their normal share of the delivery fee; Blynk covers it.');
    const amount = within(card).getByLabelText('Free delivery from (LKR)');
    await user.clear(amount);
    await user.type(amount, '3500');
    expect(toggle.closest('label')).toHaveTextContent('Free delivery when the item total is at least LKR 3,500.');
  });
});

describe('Order bill: Small-order fee row', () => {
  function order(over: Partial<OrderDetail> = {}): OrderDetail {
    return {
      id: 'o1',
      order_number: 'BL-20261025-0001',
      order_status: 'PACKED',
      payment_method: 'COD',
      payment_status: 'PENDING',
      subtotal_amount: 600,
      delivery_fee: 120,
      small_order_fee: 50,
      discount_amount: 0,
      total_amount: 770,
      placed_at: '2026-10-25T07:00:00.000Z',
      scheduled_for: null,
      delivery_recipient_name: 'Fathima Rizna',
      delivery_recipient_phone: '+94771234567',
      delivery_address_line1: 'No. 1, Main Street',
      delivery_address_line2: null,
      delivery_city: 'Beruwala',
      delivery_instructions: null,
      cancellation_reason: null,
      items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PACKED' }],
      history: [],
      delivery: null,
      ...over,
    } as OrderDetail;
  }

  it('shows the row between delivery and total when it is above 0', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: order() }) });
    const bill = await screen.findByLabelText('Bill');
    expect(within(bill).getByTestId('bill-small-order-fee')).toHaveTextContent('LKR 50');
    const labels = Array.from(bill.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(labels).toEqual(['Items', 'Delivery', 'Small-order fee', 'Total · cash to collect']);
  });

  it('has no row when the fee is 0 or absent', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order({ small_order_fee: 0, total_amount: 720 }) }),
    });
    await screen.findByTestId('bill-delivery');
    expect(screen.queryByTestId('bill-small-order-fee')).not.toBeInTheDocument();
    expect(screen.queryByText('Small-order fee')).not.toBeInTheDocument();
  });
});

describe('Packing slip: Small-order fee row', () => {
  const base = {
    id: 'o1',
    order_number: 'BL-20261025-0002',
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    subtotal_amount: 600,
    delivery_fee: 120,
    total_amount: 770,
    placed_at: '2026-10-25T04:30:00Z',
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Mosque Road',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'PENDING' }],
    history: [],
    delivery: null,
  };

  it('lists the fee when above 0 and leaves it out otherwise', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1/slip', {
      'GET /admin/orders/:id': () => ok({ order: { ...base, small_order_fee: 50 } as unknown as OrderDetail }),
    });
    const slip = await screen.findByRole('article', { name: 'Packing slip' });
    expect(within(slip).getByTestId('slip-small-order-fee')).toHaveTextContent('Small-order feeLKR 50');
    cleanup();
    renderAs(OPERATIONS_STAFF, '/orders/o1/slip', {
      'GET /admin/orders/:id': () => ok({ order: { ...base, total_amount: 720 } as unknown as OrderDetail }),
    });
    await screen.findByRole('article', { name: 'Packing slip' });
    expect(screen.queryByTestId('slip-small-order-fee')).not.toBeInTheDocument();
  });
});
