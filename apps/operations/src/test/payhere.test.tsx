import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, tokenStore } from '../api/client';
import type { BoardOrder, DeliveryDetail, OrderDetail, PaymentGatewaySetting } from '../api/types';
import { PaymentGatewayCard } from '../components/PaymentGatewayCard';
import { nextAction, splitQueue } from '../lib/delivery';
import { STATUS_LABEL, isPackable, laneOf, primaryAction } from '../lib/orders';
import { isPaidOnline, parseWindowMinutes, paymentGatewayErrorMessage, paymentLabel, refundNeeded } from '../lib/payments';
import { ADMIN_WITH_RIDER, fail, mockApi, ok, renderAs, type Call } from './helpers';

/**
 * PayHere online payments (docs/api/payhere.md): the settings card, the
 * payment labels on orders, awaiting-payment orders kept out of the packing
 * lanes, and the paid-online delivery handover.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------ label helper
describe('paymentLabel', () => {
  it('names every method + status pair in the staff words', () => {
    expect(paymentLabel({ payment_method: 'COD', payment_status: 'PENDING' })?.text).toBe('Cash on delivery');
    expect(paymentLabel({ payment_method: 'COD', payment_status: 'PAID' })?.text).toBe('Cash collected');
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'PAID' })?.text).toBe('Paid online');
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'PENDING' })?.text).toBe('Payment pending');
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'FAILED' })?.text).toBe('Payment failed');
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'REFUNDED' })?.text).toBe('Refunded / chargeback');
    expect(paymentLabel({ payment_method: 'COD', payment_status: 'REFUNDED' })?.text).toBe('Refunded / chargeback');
  });

  it('gives tones and nothing for a row without payment fields', () => {
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'PAID' })?.tone).toBe('ok');
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'FAILED' })?.tone).toBe('bad');
    expect(paymentLabel({ payment_method: 'ONLINE', payment_status: 'PENDING' })?.tone).toBe('warn');
    expect(paymentLabel({})).toBeNull();
  });

  it('paid online and refund needed', () => {
    expect(isPaidOnline({ payment_method: 'ONLINE', payment_status: 'PAID' })).toBe(true);
    expect(isPaidOnline({ payment_method: 'ONLINE', payment_status: 'PENDING' })).toBe(false);
    expect(isPaidOnline({ payment_method: 'COD', payment_status: 'PAID' })).toBe(false);
    expect(refundNeeded({ payment: { refund_required: true } })).toBe(true);
    expect(refundNeeded({ payment: null })).toBe(false);
    expect(refundNeeded({})).toBe(false);
  });

  it('payment window is 5-180 whole minutes', () => {
    expect(parseWindowMinutes('20')).toEqual({ value: 20 });
    expect(parseWindowMinutes('4')).toHaveProperty('error');
    expect(parseWindowMinutes('181')).toHaveProperty('error');
    expect(parseWindowMinutes('1.5')).toHaveProperty('error');
  });

  it('explains the gateway error codes', () => {
    expect(paymentGatewayErrorMessage(new ApiError('x', 422, 'PAYMENT_SECRET_KEY_MISSING'))).toMatch(/PAYMENT_SECRET_KEY/);
    expect(paymentGatewayErrorMessage(new ApiError('x', 422, 'PAYHERE_NOT_CONFIGURED'))).toMatch(/not set up/);
    expect(paymentGatewayErrorMessage(new ApiError('x', 403, 'CREDENTIALS_ADMIN_ONLY'))).toBe('Only an Admin can change PayHere credentials.');
  });
});

// ---------------------------------------------------- AWAITING_PAYMENT rules
const summaryOf = { total: 1, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 0 };

describe('AWAITING_PAYMENT', () => {
  it('is labelled, never packable, and sits outside the work lanes', () => {
    const o = { order_status: 'AWAITING_PAYMENT' as const, items_summary: summaryOf, active_delivery: null };
    expect(STATUS_LABEL.AWAITING_PAYMENT).toBe('Awaiting payment');
    expect(isPackable(o)).toBe(false);
    expect(primaryAction(o)).toBeNull();
    expect(laneOf(o)).toBe('awaitingPayment');
    expect(isPackable({ ...o, order_status: 'PLACED' })).toBe(true);
  });
});

// ---------------------------------------------------------- settings card
const SETTING: PaymentGatewaySetting = {
  provider: 'PAYHERE',
  enabled: false,
  mode: 'sandbox',
  merchant_id: '1211149',
  merchant_secret_set: true,
  merchant_secret_masked: '••••••••',
  merchant_secret_updated_at: '2026-10-14T08:00:00.000Z',
  allowed_methods: 'Visa, Mastercard, eZ Cash',
  payment_window_minutes: 20,
  encryption_key_configured: true,
  ready: true,
  checkout_url: 'https://sandbox.payhere.lk/pay/checkout',
  notify_url: 'https://api.blynk.lk/api/v1/payments/payhere/notify',
  return_url: 'https://blynk.lk/app/payment/return',
  cancel_url: 'https://blynk.lk/app/payment/cancel',
  can_edit_credentials: true,
  updated_at: '2026-10-14T08:00:00.000Z',
};

function mountCard(setting: PaymentGatewaySetting, extra: Parameters<typeof mockApi>[0] = {}) {
  tokenStore.save('test-access', 'test-refresh');
  const api = mockApi({
    'GET /admin/settings/payment-gateway': () => ok(setting),
    'PATCH /admin/settings/payment-gateway': (call) => {
      const { merchant_secret, ...rest } = call.body as Record<string, unknown>;
      return ok({
        ...setting,
        ...rest,
        ...(merchant_secret ? { merchant_secret_set: true, merchant_secret_updated_at: '2026-10-14T09:30:00.000Z' } : {}),
      });
    },
    ...extra,
  });
  render(<PaymentGatewayCard />);
  return api;
}

describe('Online payments (PayHere) card', () => {
  it('shows status, mode, masked secret and the addresses - never a secret value', async () => {
    mountCard(SETTING);
    const status = await screen.findByTestId('payment-gateway-status');
    expect(status).toHaveTextContent('Ready');
    expect(status).toHaveTextContent('Sandbox');
    expect(screen.getByTestId('merchant-secret-status')).toHaveTextContent(/Merchant secret: •+ saved, last updated/);
    expect(screen.getByLabelText('New merchant secret')).toHaveValue('');
    expect(screen.getByLabelText('Notify URL')).toHaveValue(SETTING.notify_url);
    expect(screen.getByLabelText('Return URL')).toHaveValue(SETTING.return_url);
    expect(screen.getByLabelText('Cancel URL')).toHaveValue(SETTING.cancel_url);
    expect(screen.getByLabelText('Checkout URL')).toHaveValue(SETTING.checkout_url);
    expect(screen.queryByTestId('payment-key-missing')).not.toBeInTheDocument();
  });

  it('says Not configured and warns when the server has no encryption key', async () => {
    mountCard({ ...SETTING, ready: false, encryption_key_configured: false, merchant_secret_set: false, merchant_secret_masked: null });
    expect(await screen.findByTestId('payment-gateway-status')).toHaveTextContent('Not configured');
    expect(screen.getByTestId('payment-key-missing')).toHaveTextContent('PAYMENT_SECRET_KEY');
    expect(screen.getByTestId('merchant-secret-status')).toHaveTextContent('Merchant secret: not saved');
  });

  it('Operations: credentials are read-only and never sent', async () => {
    const user = userEvent.setup();
    const api = mountCard({ ...SETTING, can_edit_credentials: false });
    expect(await screen.findByTestId('credentials-admin-only')).toHaveTextContent('Only an Admin can change PayHere credentials');
    expect(screen.queryByLabelText('New merchant secret')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Merchant ID')).not.toBeInTheDocument();
    expect(screen.getByText('1211149')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Online payments' }));
    const minutes = screen.getByLabelText('Payment window (minutes)');
    await user.clear(minutes);
    await user.type(minutes, '30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/payment-gateway')[0]?.body).toEqual({
        enabled: true,
        payment_window_minutes: 30,
        allowed_methods: 'Visa, Mastercard, eZ Cash',
      })
    );
    expect(await screen.findByText('Online payment settings saved.')).toBeInTheDocument();
  });

  it('Admin: the secret is sent only when typed, and cleared after the save', async () => {
    const user = userEvent.setup();
    const api = mountCard(SETTING);
    await screen.findByLabelText('New merchant secret');

    // Save without typing a secret: no secret, no unchanged credentials.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/payment-gateway')).toHaveLength(1));
    const first = api.find('PATCH', '/admin/settings/payment-gateway')[0].body as Record<string, unknown>;
    expect(first).not.toHaveProperty('merchant_secret');
    expect(first).not.toHaveProperty('merchant_id');
    expect(first).not.toHaveProperty('mode');

    await user.type(screen.getByLabelText('New merchant secret'), 'S3cretValue99');
    await user.selectOptions(screen.getByLabelText('Mode'), 'live');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/payment-gateway')).toHaveLength(2));
    const second = api.find('PATCH', '/admin/settings/payment-gateway')[1].body as Record<string, unknown>;
    expect(second).toMatchObject({ merchant_secret: 'S3cretValue99', mode: 'live' });
    await waitFor(() => expect(screen.getByLabelText('New merchant secret')).toHaveValue(''));
    expect(document.body.textContent).not.toContain('S3cretValue99');
  });

  it('shows the server refusal when the secret cannot be saved', async () => {
    const user = userEvent.setup();
    mountCard(SETTING, {
      'PATCH /admin/settings/payment-gateway': () => fail(422, 'PAYMENT_SECRET_KEY_MISSING'),
    });
    await user.type(await screen.findByLabelText('New merchant secret'), 'S3cretValue99');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no PAYMENT_SECRET_KEY/);
  });

  it('generates a sample hash without calling PayHere', async () => {
    const user = userEvent.setup();
    const api = mountCard(SETTING, {
      'POST /admin/settings/payment-gateway/test-hash': () =>
        ok({ merchant_id: '1211149', order_id: 'TEST-0001', amount: '1000.00', currency: 'LKR', hash: 'ABCDEF0123456789', mode: 'sandbox' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Generate sample hash' }));
    const hash = await screen.findByTestId('sample-hash');
    expect(hash).toHaveTextContent('TEST-0001');
    expect(hash).toHaveTextContent('1000.00');
    expect(hash).toHaveTextContent('LKR');
    expect(hash).toHaveTextContent('ABCDEF0123456789');
    expect(screen.getByText(/No call is made to PayHere/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/settings/payment-gateway/test-hash')).toHaveLength(1);
  });

  it('a sample hash before PayHere is set up explains why', async () => {
    const user = userEvent.setup();
    mountCard(SETTING, { 'POST /admin/settings/payment-gateway/test-hash': () => fail(422, 'PAYHERE_NOT_CONFIGURED') });
    await user.click(await screen.findByRole('button', { name: 'Generate sample hash' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not set up/);
  });

  it('copies an address', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    mountCard(SETTING);
    await screen.findByLabelText('Notify URL');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy Notify URL' }));
    expect(writeText).toHaveBeenCalledWith(SETTING.notify_url);
    expect(await screen.findByText('Notify URL copied.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------ orders board/detail
function boardOrder(overrides: Partial<BoardOrder> = {}): BoardOrder {
  return {
    id: 'o1',
    order_number: 'BL-20261014-0042',
    order_status: 'PLACED',
    total_amount: 1250,
    placed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    scheduled_for: null,
    delivery_recipient_name: 'Nimal Perera',
    delivery_address_line1: 'No. 1, Test Lane',
    delivery_city: 'Dharga Town',
    items_summary: summaryOf,
    active_delivery: null,
    payment_method: 'COD',
    payment_status: 'PENDING',
    ...overrides,
  };
}

describe('Orders board - payments', () => {
  it('labels payment on tickets and keeps awaiting-payment orders in their own muted group with no action', async () => {
    const placed = boardOrder({ id: 'o1', order_number: 'BL-20261014-0041', payment_method: 'ONLINE', payment_status: 'PAID' });
    const awaiting = boardOrder({
      id: 'o2',
      order_number: 'BL-20261014-0042',
      order_status: 'AWAITING_PAYMENT',
      payment_method: 'ONLINE',
      payment_status: 'PENDING',
    });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/orders', {
      'GET /admin/orders': (call: Call) => {
        const page = (orders: BoardOrder[]) => ok({ orders, pagination: { page: 1, limit: 100, total: orders.length, total_pages: 1 } });
        if (call.query.since) return page([]);
        if (call.query.status === 'AWAITING_PAYMENT') return page([awaiting]);
        return page([placed]);
      },
      'GET /admin/riders': () => ok({ riders: [] }),
    });
    const toPack = await screen.findByRole('region', { name: /^To pack/ });
    expect(within(toPack).getByText('Paid online')).toBeInTheDocument();
    expect(within(toPack).getByRole('button', { name: 'Pack #0041' })).toBeEnabled();
    expect(within(toPack).queryByText('#0042')).not.toBeInTheDocument();

    const group = await screen.findByRole('region', { name: /^Awaiting payment/ });
    expect(within(group).getByText('#0042')).toBeInTheDocument();
    expect(within(group).getByText('Payment pending')).toBeInTheDocument();
    expect(within(group).queryByRole('button')).not.toBeInTheDocument();
    expect(api.find('GET', '/admin/orders').some((c) => c.query.status === 'AWAITING_PAYMENT')).toBe(true);
  });

  it('a backend that refuses the awaiting-payment filter still shows the board', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders', {
      'GET /admin/orders': (call: Call) =>
        call.query.status === 'AWAITING_PAYMENT'
          ? fail(400, 'VALIDATION_ERROR')
          : ok({ orders: call.query.since ? [] : [boardOrder()], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } }),
      'GET /admin/riders': () => ok({ riders: [] }),
    });
    const toPack = await screen.findByRole('region', { name: /^To pack/ });
    expect(within(toPack).getByText('Cash on delivery')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Awaiting payment/ })).not.toBeInTheDocument();
  });

  it('order detail shows the payment label and Refund needed', async () => {
    const o = boardOrder({ order_status: 'CANCELLED' });
    const detail: OrderDetail = {
      id: o.id,
      order_number: o.order_number,
      order_status: 'CANCELLED',
      payment_method: 'ONLINE',
      payment_status: 'PAID',
      payment: { refund_required: true, gateway: 'PAYHERE', gateway_method: 'VISA' },
      total_amount: 1250,
      placed_at: o.placed_at,
      scheduled_for: null,
      delivery_recipient_name: o.delivery_recipient_name,
      delivery_recipient_phone: '+94771234567',
      delivery_address_line1: o.delivery_address_line1,
      delivery_address_line2: null,
      delivery_city: o.delivery_city,
      delivery_instructions: null,
      cancellation_reason: 'Payment window expired',
      items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 1, item_status: 'PENDING' }],
      history: [],
      delivery: null,
    };
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: detail }) });
    expect(await screen.findByTestId('payment-status')).toHaveTextContent('Paid online');
    expect(screen.getByTestId('refund-needed')).toHaveTextContent('Refund needed');
    expect(screen.getByTestId('refund-needed-note')).toBeInTheDocument();
    expect(screen.getByText('VISA')).toBeInTheDocument();
  });

  it('an awaiting-payment order detail offers no packing step', async () => {
    const o = boardOrder({ order_status: 'AWAITING_PAYMENT' });
    const detail = {
      id: o.id,
      order_number: o.order_number,
      order_status: 'AWAITING_PAYMENT',
      payment_method: 'ONLINE',
      payment_status: 'PENDING',
      payment_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      total_amount: 1250,
      placed_at: o.placed_at,
      scheduled_for: null,
      delivery_recipient_name: o.delivery_recipient_name,
      delivery_recipient_phone: '+94771234567',
      delivery_address_line1: o.delivery_address_line1,
      delivery_address_line2: null,
      delivery_city: o.delivery_city,
      delivery_instructions: null,
      cancellation_reason: null,
      items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 1, item_status: 'PENDING' }],
      history: [],
      delivery: null,
    } satisfies OrderDetail;
    renderAs(ADMIN_WITH_RIDER, `/orders/${o.id}`, { 'GET /admin/orders/:id': () => ok({ order: detail }) });
    expect(await screen.findByTestId('awaiting-payment')).toHaveTextContent(/Don't pack it yet/);
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pack/ })).not.toBeInTheDocument();
    // Staff may still cancel an unpaid order (backend ADMIN_CANCEL from AWAITING_PAYMENT).
    expect(screen.getByRole('button', { name: /Cancel order/ })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------- delivery
function delivery(overrides: Partial<DeliveryDetail> = {}): DeliveryDetail {
  return {
    delivery_id: 'd1',
    order_id: 'o1',
    assignment_status: 'ARRIVED_AT_CUSTOMER',
    assigned_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    accepted_at: null,
    picked_up_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    order_number: 'BL-20261014-0042',
    order_status: 'OUT_FOR_DELIVERY',
    total_amount: 1250,
    payment_method: 'ONLINE',
    payment_status: 'PAID',
    delivery_recipient_name: 'Nimal Perera',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: 'No. 1, Test Lane',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    rider_id: 'r-1',
    cod_collected_amount: 0,
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    items: [],
    ...overrides,
  };
}

describe('Delivery - paid online', () => {
  it('the handover only confirms the delivery code; cash is not counted', () => {
    const d = delivery();
    const action = nextAction(d);
    expect(action).toMatchObject({ kind: 'collect', label: 'Confirm delivery code', paidOnline: true });
    expect(nextAction(delivery({ payment_status: 'PENDING' }))).toEqual({ kind: 'none', reason: 'not-cod' });
    expect(nextAction(delivery({ payment_method: 'COD', payment_status: 'PENDING' }))).toMatchObject({ kind: 'collect', paidOnline: false });
    const done = delivery({ assignment_status: 'DELIVERED', order_status: 'DELIVERED' });
    const cod = delivery({ delivery_id: 'd2', assignment_status: 'DELIVERED', order_status: 'DELIVERED', payment_method: 'COD', payment_status: 'PAID', total_amount: 600 });
    expect(splitQueue([done, cod]).collectedToday).toBe(600);
  });

  it('says do not collect cash and completes through collect-cod with the code', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'geolocation', {
      value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
      configurable: true,
    });
    const d = delivery();
    const { api } = renderAs(ADMIN_WITH_RIDER, `/delivery/${d.delivery_id}`, {
      'GET /riders/deliveries/:id': () => ok({ delivery: d }),
      'POST /riders/deliveries/:id/collect-cod': () =>
        ok({ settlement: { delivery_id: d.delivery_id, order_id: d.order_id, order_status: 'DELIVERED', payment_status: 'PAID', cod_collected_amount: 0, delivered_at: '2026-10-14T10:00:00Z' } }),
    });
    expect(await screen.findByTestId('paid-online')).toHaveTextContent('Paid online - do not collect cash');
    expect(screen.queryByRole('region', { name: 'Cash to collect' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm delivery code' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm the delivery code' });
    expect(dialog).toHaveTextContent('Paid online - do not collect cash');
    expect(dialog).not.toHaveTextContent(/in cash/);
    await user.type(within(dialog).getByLabelText("Customer's delivery code"), '4821');
    await user.click(within(dialog).getByRole('button', { name: 'Code checked — complete' }));
    await waitFor(() => expect(api.find('POST', `/riders/deliveries/${d.delivery_id}/collect-cod`)).toHaveLength(1));
    expect(api.find('POST', `/riders/deliveries/${d.delivery_id}/collect-cod`)[0].body).toMatchObject({ delivery_code: '4821' });
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  });
});
