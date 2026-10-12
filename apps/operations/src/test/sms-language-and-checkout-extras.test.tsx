import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { CheckoutSettings, CustomerSmsLanguageSetting, OrderDetail } from '../api/types';
import { checkoutExtrasPatch, parseBasketAmount } from '../lib/checkoutExtras';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Owner, 2026-10-12, on More: the Customer SMS language card, and the new
 * checkout switches - free delivery above a basket amount, "Allow ordering
 * for someone else", "Send delivery code to receiver" - plus the order detail
 * showing an order for someone else and "needs help". Same settings as Admin.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const CHECKOUT: CheckoutSettings = {
  coupons_enabled: false,
  new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
  show_offer_savings: false,
  basket_free_delivery: { enabled: false, min_subtotal_lkr: 3000 },
  order_for_someone_else: { enabled: true, send_code_to_receiver: true },
  updated_at: null,
};

const SMS: CustomerSmsLanguageSetting = {
  mode: 'ENGLISH_ONLY',
  fallback: 'en',
  updated_at: null,
  samples: [
    { lang: 'en', text: 'Blynk: Order #BL-1 is on the way.', parts: 1 },
    { lang: 'si', text: 'Blynk: ඇණවුම #BL-1 එනවා.', parts: 1 },
    { lang: 'ta', text: 'Blynk: ஆர்டர் #BL-1 வருகிறது.', parts: 1 },
  ],
};

describe('checkout extras helpers', () => {
  it('parses the basket amount and sends only what changed', () => {
    expect(parseBasketAmount('3000')).toEqual({ amount: 3000 });
    expect(parseBasketAmount('0')).toHaveProperty('error');
    expect(parseBasketAmount('1.234')).toHaveProperty('error');
    const same = { basketOn: false, basketAmount: 3000, forOthersOn: true, codeToReceiver: true };
    expect(checkoutExtrasPatch(CHECKOUT, same)).toEqual({});
    expect(checkoutExtrasPatch(CHECKOUT, { ...same, forOthersOn: false })).toEqual({
      order_for_someone_else: { enabled: false, send_code_to_receiver: true },
    });
  });
});

describe('Checkout card (More)', () => {
  it('saves the basket amount and the "for someone else" switches', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
      'PATCH /admin/settings/checkout': (call) => ok({ ...CHECKOUT, ...call.body }),
      'GET /admin/settings/customer-sms-language': () => ok(SMS),
    });
    const card = (await screen.findByRole('heading', { name: 'Checkout' })).closest('section') as HTMLElement;
    const basket = await within(card).findByRole('checkbox', { name: /Free delivery above a basket amount/ });
    const amount = within(card).getByLabelText('Free delivery from (LKR)');
    expect(amount).toBeDisabled();
    expect(within(card).getByRole('checkbox', { name: /Allow ordering for someone else/ })).toBeChecked();
    await user.click(basket);
    await user.clear(amount);
    await user.type(amount, '3500');
    await user.click(within(card).getByRole('checkbox', { name: /Allow ordering for someone else/ }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        coupons_enabled: false,
        new_customer_free_deliveries: { enabled: true, count: 2 },
        basket_free_delivery: { enabled: true, min_subtotal_lkr: 3500 },
        order_for_someone_else: { enabled: false, send_code_to_receiver: true },
      })
    );
  });
});

describe('Customer SMS language card (More)', () => {
  it('shows the samples and saves a forced language', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/checkout': () => ok(CHECKOUT),
      'GET /admin/settings/customer-sms-language': () => ok(SMS),
      'PATCH /admin/settings/customer-sms-language': (call) => ok({ ...SMS, ...call.body, updated_at: '2026-10-12T05:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Customer SMS language' })).closest('section') as HTMLElement;
    expect(await within(card).findByRole('button', { name: 'English only' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByLabelText('Tamil sample')).toHaveTextContent('ஆர்டர்');
    await user.click(within(card).getByRole('button', { name: 'Always Sinhala' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/customer-sms-language')[0]?.body).toEqual({ mode: 'ALWAYS_SINHALA', fallback: 'en' })
    );
    expect(await within(card).findByText('Customer SMS language saved.')).toBeInTheDocument();
  });
});

describe('Order detail: for someone else / needs help', () => {
  it('shows both notes when the order has them', async () => {
    const order = {
      id: 'o1',
      order_number: 'BL-20261012-0001',
      order_status: 'PLACED',
      payment_method: 'COD',
      payment_status: 'PENDING',
      total_amount: 610,
      placed_at: new Date().toISOString(),
      scheduled_for: null,
      delivery_recipient_name: 'Amma Fathima',
      delivery_recipient_phone: '+94709450001',
      delivery_address_line1: '14 Mosque Road',
      delivery_address_line2: null,
      delivery_city: 'Dharga Town',
      delivery_instructions: 'Blue gate',
      ordered_for_someone_else: true,
      delivery_needs_help: true,
      cancellation_reason: null,
      items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'SOURCED' }],
      history: [],
      delivery: null,
    } as unknown as OrderDetail;
    renderAs(ADMIN_WITH_RIDER, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order }) });
    expect(await screen.findByTestId('order-for-someone-else')).toHaveTextContent('Ordered for someone else');
    expect(screen.getByTestId('order-needs-help')).toHaveTextContent('knock and wait, carry items inside');
  });
});
