import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, tokenStore } from '../api/client';
import type { OrderDetail } from '../api/types';
import type { CustomerWallet, OrderWallet, WalletSetting } from '../api/wallet';
import { nextAction } from '../lib/delivery';
import {
  PAID_BY_WALLET,
  cashToCollectLine,
  cashToCollectText,
  expiryText,
  mayRefundToWallet,
  paidByWallet,
  readRefundForm,
  readWalletForm,
  refundCap,
  signedMoney,
  walletErrorMessage,
  walletPaidLine,
} from '../lib/wallet';
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/** Blynk Wallet in Operations (owner, 2026-10-15; docs/api/wallet.md). */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const ORDER_WALLET: OrderWallet = {
  order_id: 'o1',
  order_number: 'BL-20261015-1234',
  customer_id: 'c1',
  order_status: 'DELIVERED',
  payment_method: 'COD',
  wallet_amount_used: 300,
  delivery_fee: 150,
  paid: { wallet: 300, online: 0, cash: 850, total: 1150 },
  refunded_total: 120,
  refundable: 1030,
  delivery_fee_refundable: 150,
  points: { redeemed: 50, returnable: 50, earned: 11 },
  entries: [
    {
      id: 'w1',
      kind: 'REFUND_ITEM',
      amount: 120,
      order_id: 'o1',
      order_number: 'BL-20261015-1234',
      reason: 'Damaged: Milk 1L',
      created_by: 'u9',
      created_by_name: 'Ops Lead',
      expires_at: null,
      created_at: '2026-10-15T08:00:00.000Z',
    },
  ],
};

function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    order_number: 'BL-20261015-1234',
    order_status: 'DELIVERED',
    payment_method: 'COD',
    payment_status: 'PAID',
    subtotal_amount: 1000,
    delivery_fee: 150,
    discount_amount: 0,
    total_amount: 850,
    wallet_amount_used: 300,
    placed_at: '2026-10-15T07:00:00.000Z',
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

describe('wallet helpers', () => {
  it('says "LKR 0 to collect - paid by wallet" only when the wallet paid it all', () => {
    expect(paidByWallet({ total_amount: 0, wallet_amount_used: 1150 })).toBe(true);
    expect(paidByWallet({ total_amount: 0, wallet_amount_used: 0 })).toBe(false);
    expect(paidByWallet({ total_amount: 0 })).toBe(false);
    expect(paidByWallet({ total_amount: 400, wallet_amount_used: 750 })).toBe(false);
    expect(cashToCollectText({ total_amount: 0, wallet_amount_used: 1150 })).toBe(PAID_BY_WALLET);
    expect(cashToCollectText({ total_amount: 400, wallet_amount_used: 750 })).toBe('LKR 400');
    expect(cashToCollectLine({ total_amount: 400 })).toBe('Cash to collect: LKR 400');
    expect(cashToCollectLine({ total_amount: 0, wallet_amount_used: 5 })).toBe(PAID_BY_WALLET);
    expect(walletPaidLine({ wallet_amount_used: 300 })).toBe('Paid by wallet LKR 300');
    expect(walletPaidLine({})).toBeNull();
    expect(signedMoney(120)).toBe('+LKR 120');
    expect(signedMoney(-50)).toBe('−LKR 50');
  });

  it('offers the wallet panel only on orders that may have something to refund', () => {
    expect(mayRefundToWallet({ total_amount: 600, payment_status: 'PENDING', order_status: 'PLACED' })).toBe(false);
    expect(mayRefundToWallet({ total_amount: 0, wallet_amount_used: 600, payment_status: 'PENDING', order_status: 'PLACED' })).toBe(true);
    expect(mayRefundToWallet({ total_amount: 600, payment_status: 'PAID', order_status: 'PLACED' })).toBe(true);
    expect(mayRefundToWallet({ total_amount: 600, payment_status: 'PENDING', order_status: 'DELIVERED' })).toBe(true);
  });

  it('the rider step for a wallet-paid order is the code, with amount 0', () => {
    const d = {
      assignment_status: 'ARRIVED_AT_CUSTOMER',
      order_status: 'OUT_FOR_DELIVERY',
      payment_method: 'COD',
      payment_status: 'PENDING',
      total_amount: 0,
      wallet_amount_used: 900,
    } as const;
    expect(nextAction(d)).toEqual({ kind: 'collect', label: 'Confirm delivery code', amount: 0, paidOnline: false });
    expect(nextAction({ ...d, total_amount: 250 })).toMatchObject({ label: 'Collect LKR 250', amount: 250 });
  });

  it('caps a refund at what is refundable, and a fee refund at the fee left', () => {
    expect(refundCap('REFUND_ITEM', ORDER_WALLET)).toBe(1030);
    expect(refundCap('REFUND_DELIVERY_FEE', ORDER_WALLET)).toBe(150);
    expect(refundCap('REFUND_DELIVERY_FEE', { refundable: 100, delivery_fee_refundable: 150 })).toBe(100);
    const form = { kind: 'REFUND_ITEM' as const, amount: '120', reason: 'Damaged: Milk 1L', points: '' };
    expect(readRefundForm(form, ORDER_WALLET)).toEqual({ value: { amount: 120, kind: 'REFUND_ITEM', reason: 'Damaged: Milk 1L' } });
    expect(readRefundForm({ ...form, points: '20' }, ORDER_WALLET)).toEqual({
      value: { amount: 120, kind: 'REFUND_ITEM', reason: 'Damaged: Milk 1L', return_points: 20 },
    });
    expect(readRefundForm({ ...form, amount: '1030.01' }, ORDER_WALLET)).toMatchObject({ field: 'amount', error: expect.stringContaining('LKR 1,030') });
    expect(readRefundForm({ ...form, kind: 'REFUND_DELIVERY_FEE', amount: '151' }, ORDER_WALLET)).toMatchObject({
      field: 'amount',
      error: expect.stringContaining('delivery fee'),
    });
    expect(readRefundForm({ ...form, amount: '0' }, ORDER_WALLET)).toMatchObject({ field: 'amount' });
    expect(readRefundForm({ ...form, amount: '1.234' }, ORDER_WALLET)).toMatchObject({ field: 'amount' });
    expect(readRefundForm({ ...form, reason: 'ok' }, ORDER_WALLET)).toMatchObject({ field: 'reason' });
    expect(readRefundForm({ ...form, reason: 'x'.repeat(201) }, ORDER_WALLET)).toMatchObject({ field: 'reason' });
    expect(readRefundForm({ ...form, points: '51' }, ORDER_WALLET)).toMatchObject({ field: 'points' });
    expect(readRefundForm({ ...form, points: '2.5' }, ORDER_WALLET)).toMatchObject({ field: 'points' });
    // Points are ignored when none can be given back.
    expect(readRefundForm({ ...form, points: '20' }, { ...ORDER_WALLET, points: { redeemed: 0, returnable: 0, earned: 0 } })).toEqual({
      value: { amount: 120, kind: 'REFUND_ITEM', reason: 'Damaged: Milk 1L' },
    });
    expect(readRefundForm(form, { ...ORDER_WALLET, refundable: 0 })).toMatchObject({ error: 'Nothing left to refund.' });
  });

  it('reads the settings form with the API limits', () => {
    expect(readWalletForm({ enabled: true, expiry_months: '0', max_use_percent: '100' })).toEqual({
      value: { enabled: true, expiry_months: 0, max_use_percent: 100 },
    });
    expect(readWalletForm({ enabled: true, expiry_months: '121', max_use_percent: '100' })).toMatchObject({ field: 'expiry_months' });
    expect(readWalletForm({ enabled: true, expiry_months: '1.5', max_use_percent: '100' })).toMatchObject({ field: 'expiry_months' });
    expect(readWalletForm({ enabled: true, expiry_months: '6', max_use_percent: '0' })).toMatchObject({ field: 'max_use_percent' });
    expect(readWalletForm({ enabled: true, expiry_months: '6', max_use_percent: '50.5' })).toMatchObject({ field: 'max_use_percent' });
    expect(expiryText(0)).toBe('Credits never expire.');
    expect(expiryText(1)).toBe('Credits expire 1 month after they are added.');
  });

  it('words the refund refusals', () => {
    const err = (code: string, details?: unknown) => new ApiError(code, 422, code, details);
    expect(walletErrorMessage(err('REFUND_EXCEEDS_REFUNDABLE', { refundable: 500 }))).toContain('LKR 500');
    expect(walletErrorMessage(err('NOTHING_TO_REFUND'))).toContain('Nothing left to refund');
    expect(walletErrorMessage(err('REFUND_EXCEEDS_DELIVERY_FEE'))).toContain('delivery fee');
    expect(walletErrorMessage(err('POINTS_RETURN_EXCEEDS'))).toContain('Blynk Points');
    expect(walletErrorMessage(new ApiError('x', 403, 'CANNOT_RECORD_FOR_SELF'))).toContain('your own order');
    expect(walletErrorMessage(new ApiError('x', 404, 'ORDER_NOT_FOUND'))).toBe('This order no longer exists.');
  });
});

describe('order detail', () => {
  it('shows "Paid by wallet" on the bill and refunds an item to the wallet', async () => {
    const user = userEvent.setup();
    const after: OrderWallet = { ...ORDER_WALLET, refunded_total: 220, refundable: 930 };
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order() }),
      'GET /admin/orders/:id/wallet': () => ok(ORDER_WALLET),
      'POST /admin/orders/:id/wallet-refund': () => ({
        status: 201,
        data: { refund: { ...ORDER_WALLET.entries[0], id: 'w2', amount: 100 }, points_returned: 20, points_removed: 1, wallet: after },
      }),
    });
    expect(await screen.findByTestId('order-wallet-paid')).toHaveTextContent('Paid by wallet LKR 300');
    expect(screen.getByTestId('bill-wallet')).toHaveTextContent('−LKR 300');

    const panel = await screen.findByRole('region', { name: 'Blynk Wallet refund' });
    await within(panel).findByTestId('wallet-refundable');
    expect(within(panel).getByTestId('wallet-refundable')).toHaveTextContent('LKR 1,030');
    expect(within(panel).getByRole('list', { name: 'Wallet history for this order' })).toHaveTextContent('Damaged: Milk 1L');
    expect(within(panel).getByRole('list', { name: 'Wallet history for this order' })).toHaveTextContent('by Ops Lead');
    expect(within(panel).getByRole('link', { name: "Customer's wallet and history" })).toHaveAttribute('href', '/more/customers/c1');

    await user.click(within(panel).getByRole('button', { name: 'Refund to wallet' }));
    const dialog = screen.getByRole('dialog', { name: /Refund to wallet/ });
    expect(dialog).toHaveTextContent('The customer sees this reason.');
    // Too much is refused before anything is sent.
    await user.type(within(dialog).getByLabelText(/^Amount/), '2000');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Damaged: Milk 1L');
    await user.click(within(dialog).getByRole('button', { name: 'Refund to wallet' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at most LKR 1,030');
    expect(api.find('POST', '/admin/orders/o1/wallet-refund')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText(/^Amount/));
    await user.type(within(dialog).getByLabelText(/^Amount/), '100');
    await user.type(within(dialog).getByLabelText(/^Blynk Points to give back/), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Refund to wallet' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/orders/o1/wallet-refund')[0]?.body).toEqual({
        amount: 100,
        kind: 'REFUND_ITEM',
        reason: 'Damaged: Milk 1L',
        return_points: 20,
      })
    );
    expect(await within(panel).findByRole('status')).toHaveTextContent("LKR 100 added to the customer's Blynk Wallet. 20 Blynk Points given back.");
    expect(within(panel).getByTestId('wallet-refundable')).toHaveTextContent('LKR 930');
  });

  it('a fee refund sends REFUND_DELIVERY_FEE, and a refusal is worded', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order() }),
      'GET /admin/orders/:id/wallet': () => ok({ ...ORDER_WALLET, points: { redeemed: 0, returnable: 0, earned: 0 } }),
      'POST /admin/orders/:id/wallet-refund': () => ({
        status: 422,
        error: { code: 'REFUND_EXCEEDS_DELIVERY_FEE', message: 'Too much' },
      }),
    });
    const panel = await screen.findByRole('region', { name: 'Blynk Wallet refund' });
    await user.click(await within(panel).findByRole('button', { name: 'Refund to wallet' }));
    const dialog = screen.getByRole('dialog', { name: /Refund to wallet/ });
    expect(within(dialog).queryByLabelText(/^Blynk Points to give back/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /Delivery fee/ }));
    await user.type(within(dialog).getByLabelText(/^Amount/), '150');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Delivered very late');
    await user.click(within(dialog).getByRole('button', { name: 'Refund to wallet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("more than is left of this order's delivery fee");
    expect(api.find('POST', '/admin/orders/o1/wallet-refund')[0].body).toEqual({ amount: 150, kind: 'REFUND_DELIVERY_FEE', reason: 'Delivered very late' });
    // The figures are read again after a refusal like this.
    await waitFor(() => expect(api.find('GET', '/admin/orders/o1/wallet').length).toBeGreaterThan(1));
  });

  it('a kind with nothing left (the fee already refunded) cannot be picked', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order() }),
      'GET /admin/orders/:id/wallet': () => ok({ ...ORDER_WALLET, delivery_fee_refundable: 0 }),
    });
    const panel = await screen.findByRole('region', { name: 'Blynk Wallet refund' });
    await user.click(await within(panel).findByRole('button', { name: 'Refund to wallet' }));
    const dialog = screen.getByRole('dialog', { name: /Refund to wallet/ });
    expect(within(dialog).getByRole('radio', { name: /Delivery fee/ })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: /Missing/ })).toBeChecked();
  });

  it('a fully wallet-paid COD order shows LKR 0 to collect, and nothing left to refund is disabled', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () =>
        ok({ order: order({ order_status: 'PACKED', payment_status: 'PENDING', total_amount: 0, wallet_amount_used: 1150 }) }),
      'GET /admin/orders/:id/wallet': () =>
        ok({ ...ORDER_WALLET, refundable: 0, refunded_total: 1150, delivery_fee_refundable: 0, entries: [] }),
    });
    expect(await screen.findByTestId('order-amount-due')).toHaveTextContent(PAID_BY_WALLET);
    const panel = await screen.findByRole('region', { name: 'Blynk Wallet refund' });
    expect(await within(panel).findByRole('button', { name: 'Nothing left to refund' })).toBeDisabled();
  });

  it('an unpaid cash order being packed has no wallet panel and no wallet call', async () => {
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: order({ order_status: 'PLACED', payment_status: 'PENDING', wallet_amount_used: 0 }) }),
    });
    expect(await screen.findByTestId('order-amount-due')).toHaveTextContent('LKR 850');
    expect(screen.queryByTestId('order-wallet-paid')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Blynk Wallet refund' })).not.toBeInTheDocument();
    expect(api.find('GET', '/admin/orders/o1/wallet')).toHaveLength(0);
  });

  it('the board shows "LKR 0 to collect - paid by wallet" on the order card', async () => {
    renderAs(OPERATIONS_STAFF, '/orders', {
      'GET /admin/orders': (call) =>
        ok({
          orders: call.query.since
            ? []
            : [
                {
                  id: 'o1',
                  order_number: 'BL-20261015-1234',
                  order_status: 'PACKED',
                  total_amount: 0,
                  wallet_amount_used: 1150,
                  payment_method: 'COD',
                  payment_status: 'PENDING',
                  placed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  scheduled_for: null,
                  delivery_recipient_name: 'Fathima Rizna',
                  delivery_address_line1: 'No. 1, Main Street',
                  delivery_city: 'Beruwala',
                  items_summary: { total: 1, pending: 0, sourced: 0, packed: 1, unavailable: 0, substituted: 0 },
                  active_delivery: null,
                },
              ],
          pagination: { page: 1, limit: 100, total: 1, total_pages: 1 },
        }),
    });
    expect(await screen.findByText(PAID_BY_WALLET)).toBeInTheDocument();
  });
});

describe('customer wallet', () => {
  const CUSTOMER_WALLET: CustomerWallet = {
    customer_id: 'c1',
    enabled: true,
    balance: 450,
    entries: [
      { ...ORDER_WALLET.entries[0], id: 'e1', kind: 'REFUND_ORDER_CANCELLED', amount: 450, reason: 'Order BL-20261015-1234 cancelled', created_by_name: null },
      { ...ORDER_WALLET.entries[0], id: 'e2', kind: 'ORDER_PAYMENT', amount: -300, reason: 'Paid for order', created_by_name: null },
    ],
    pagination: { page: 1, limit: 50, total: 2, total_pages: 1 },
  };

  it('shows the balance and the history on the customer page', async () => {
    const { api } = renderAs(OPERATIONS_STAFF, '/more/customers/c1', {
      'GET /admin/customers/:id/addresses': () =>
        ok({ customer: { id: 'c1', full_name: 'Fathima Rizna', phone: '+94771234567' }, addresses: [], other_addresses: [] }),
      'GET /admin/customers/:id/wallet': () => ok(CUSTOMER_WALLET),
    });
    expect(await screen.findByTestId('wallet-balance')).toHaveTextContent('Balance LKR 450');
    const history = screen.getByRole('list', { name: 'Wallet history' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Order cancelled refund');
    expect(rows[0]).toHaveTextContent('+LKR 450');
    expect(rows[0]).toHaveTextContent('Order #1234');
    expect(rows[1]).toHaveTextContent('Paid for order');
    expect(rows[1]).toHaveTextContent('−LKR 300');
    expect(api.find('GET', '/admin/customers/c1/wallet')[0].query).toMatchObject({ page: '1', limit: '50' });
    // Manual adjustments are Admin only: nothing to adjust here.
    expect(screen.queryByRole('button', { name: /adjust/i })).not.toBeInTheDocument();
  });
});

describe('Blynk Wallet settings', () => {
  const SETTING: WalletSetting = { enabled: true, expiry_months: 0, max_use_percent: 100, updated_at: null };

  it('is linked from More, and saves only what changed', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    expect(await screen.findByRole('link', { name: 'Blynk Wallet' })).toHaveAttribute('href', '/more/wallet');
    cleanup();
    vi.unstubAllGlobals();

    const { api } = renderAs(OPERATIONS_STAFF, '/more/wallet', {
      'GET /admin/settings/wallet': () => ok(SETTING),
      'PATCH /admin/settings/wallet': (call) => ok({ ...SETTING, ...(call.body as object), updated_at: '2026-10-15T04:00:00Z' }),
    });
    const months = await screen.findByLabelText(/^Credits expire after/);
    expect(screen.getByTestId('wallet-expiry')).toHaveTextContent('Credits never expire.');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Nothing changed.');
    expect(api.find('PATCH', '/admin/settings/wallet')).toHaveLength(0);

    await user.clear(months);
    await user.type(months, '130');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 120');

    await user.clear(months);
    await user.type(months, '12');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/wallet')[0]?.body).toEqual({ enabled: false, expiry_months: 12 }));
    expect(await screen.findByText('Blynk Wallet saved.')).toBeInTheDocument();
  });
});
