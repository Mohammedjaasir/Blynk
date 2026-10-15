import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { CustomerWalletPanel } from '../components/CustomerWalletPanel';
import { OrderPanel } from '../components/OrderPanel';
import { OrderBill } from '../components/OrderBill';
import { tokenStore } from '../api/client';
import type { BoardOrder } from '../api/types';
import type { CustomerWallet, OrderWallet, WalletSetting } from '../api/wallet';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Blynk Wallet (owner, 2026-10-15; docs/api/wallet.md): the Settings card, a
 * customer's wallet panel, the bill's wallet lines and "Refund to wallet" on
 * an order. The rules are the backend's; here, what the pages send and show.
 */

const renderPage = (ui: React.ReactElement, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const SETTING: WalletSetting = { enabled: true, expiry_months: 0, max_use_percent: 100, updated_at: null };

function settingsApi(extra: (call: Call) => Reply | undefined = () => undefined) {
  return mockApi((call) => extra(call) ?? (call.method === 'GET' && call.path === '/admin/settings/wallet' ? ok(SETTING) : undefined));
}

describe('Settings -> Blynk Wallet', () => {
  it('shows the saved settings and the refunds note, and saves only what changed', async () => {
    const user = userEvent.setup();
    const api = settingsApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/wallet' ? ok({ ...SETTING, ...c.body, updated_at: '2026-10-15T04:00:00Z' }) : undefined
    );
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Blynk Wallet' });
    const on = await within(panel).findByRole('checkbox', { name: /^Blynk Wallet at checkout/ });
    expect(on).toBeChecked();
    expect(panel).toHaveTextContent("Refunds are always credited; switching off hides 'Use wallet balance' at checkout.");
    expect(within(panel).getByTestId('wallet-expiry')).toHaveTextContent('Credits never expire.');

    await user.click(on);
    const expiry = within(panel).getByLabelText(/^Wallet credits expire after/);
    await user.clear(expiry);
    await user.type(expiry, '6');
    expect(within(panel).getByTestId('wallet-expiry')).toHaveTextContent('expire 6 months after');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/wallet')[0]?.body).toEqual({ enabled: false, expiry_months: 6 }));
    expect(await screen.findByText('Blynk Wallet saved.')).toBeInTheDocument();
  });

  it('refuses a bad max use % before sending', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Blynk Wallet' });
    const max = await within(panel).findByLabelText(/^Most of an order the wallet can pay/);
    await user.clear(max);
    await user.type(max, '0');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The most of an order the wallet can pay must be at least 1.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/wallet')).toHaveLength(0);
  });
});

const WALLET: CustomerWallet = {
  customer_id: 'u1',
  enabled: true,
  balance: 450,
  entries: [
    {
      id: 'w2',
      kind: 'REFUND_ITEM',
      amount: 120,
      order_id: 'o1',
      order_number: 'BL-20261015-0042',
      reason: 'Damaged: Milk 1L',
      created_by: 's1',
      created_by_name: 'Ops Lead',
      expires_at: null,
      created_at: '2026-10-15T08:00:00Z',
    },
    {
      id: 'w1',
      kind: 'ORDER_PAYMENT',
      amount: -300,
      order_id: 'o0',
      order_number: 'BL-20261014-0007',
      reason: null,
      created_by: null,
      created_by_name: null,
      expires_at: null,
      created_at: '2026-10-14T08:00:00Z',
    },
  ],
  pagination: { page: 1, limit: 50, total: 2, total_pages: 1 },
};

describe('Customer wallet panel', () => {
  it('shows the balance and history, and adjusts with a reason', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/customers/u1/wallet') return ok(WALLET);
      if (c.method === 'POST' && c.path === '/admin/customers/u1/wallet/adjust') return ok({ ...WALLET, balance: 400 });
      return undefined;
    });
    renderPage(<CustomerWalletPanel customerId="u1" />);
    expect(await screen.findByTestId('wallet-balance')).toHaveTextContent('LKR 450');
    expect(api.calls[0]!.query.get('page')).toBe('1');
    const rows = within(screen.getByRole('table', { name: 'Wallet history' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Item refund');
    expect(rows[1]).toHaveTextContent('+LKR 120');
    expect(rows[1]).toHaveTextContent('#0042');
    expect(rows[1]).toHaveTextContent('Damaged: Milk 1L');
    expect(rows[1]).toHaveTextContent('Ops Lead');
    expect(rows[2]).toHaveTextContent('Paid for order');
    expect(rows[2]).toHaveTextContent('−LKR 300');

    await user.type(screen.getByLabelText(/^Adjust wallet/), '-50');
    await user.click(screen.getByRole('button', { name: 'Adjust wallet' }));
    expect(await screen.findByText('Write a reason (at least 3 characters).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/customers/u1/wallet/adjust')).toHaveLength(0);

    await user.type(screen.getByLabelText(/^Reason/), 'Goodwill reversal');
    await user.click(screen.getByRole('button', { name: 'Adjust wallet' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/customers/u1/wallet/adjust')[0]?.body).toEqual({ amount: -50, reason: 'Goodwill reversal' })
    );
    await waitFor(() => expect(screen.getByTestId('wallet-balance')).toHaveTextContent('LKR 400'));
  });

  it('explains WALLET_INSUFFICIENT', async () => {
    const user = userEvent.setup();
    mockApi((c) => (c.method === 'GET' ? ok(WALLET) : fail(422, 'WALLET_INSUFFICIENT', 'Not enough', { balance: 450 })));
    renderPage(<CustomerWalletPanel customerId="u1" />);
    await user.type(await screen.findByLabelText(/^Adjust wallet/), '-500');
    await user.type(screen.getByLabelText(/^Reason/), 'Mistake fix');
    await user.click(screen.getByRole('button', { name: 'Adjust wallet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That would take the wallet below LKR 0 - the balance is LKR 450.');
  });
});

describe('Order bill - wallet', () => {
  const ORDER = { subtotal_amount: 1150, delivery_fee: 150, total_amount: 0, wallet_amount_used: 1300, payment_method: 'COD' as const };

  it('shows the wallet payment and "LKR 0 to collect" when the wallet paid it all', () => {
    render(<OrderBill order={ORDER} />);
    const bill = screen.getByLabelText('Bill');
    expect(within(bill).getByText('Paid by wallet').nextSibling).toHaveTextContent('−LKR 1,300');
    expect(screen.getByTestId('bill-wallet-only')).toHaveTextContent('LKR 0 to collect - paid by wallet');
  });

  it('shows no wallet line without a wallet payment, and no "LKR 0" line on a part payment', () => {
    const { unmount } = render(<OrderBill order={{ ...ORDER, total_amount: 1300, wallet_amount_used: 0 }} />);
    expect(screen.queryByText('Paid by wallet')).not.toBeInTheDocument();
    unmount();
    render(<OrderBill order={{ ...ORDER, total_amount: 1000, wallet_amount_used: 300 }} />);
    expect(screen.getByText('Paid by wallet')).toBeInTheDocument();
    expect(screen.queryByTestId('bill-wallet-only')).not.toBeInTheDocument();
  });
});

const board: BoardOrder = {
  id: 'o1',
  order_number: 'BL-20261015-0042',
  order_status: 'DELIVERED',
  total_amount: 1000,
  wallet_amount_used: 150,
  placed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  scheduled_for: null,
  delivery_recipient_name: 'Nimal Perera',
  delivery_address_line1: 'No. 1, Test Lane',
  delivery_city: 'Dharga Town',
  items_summary: { total: 1, pending: 0, sourced: 0, packed: 1, unavailable: 0, substituted: 0 },
  active_delivery: null,
  payment_method: 'COD',
  payment_status: 'PAID',
};

const orderDetail = {
  ...board,
  subtotal_amount: 1000,
  delivery_fee: 150,
  delivery_recipient_phone: '+94771234567',
  delivery_address_line2: null,
  delivery_instructions: null,
  cancellation_reason: null,
  items: [{ id: 'i1', product_name_snapshot: 'Milk 1L', quantity: 1, item_status: 'PACKED', actual_unit_cost: null }],
  history: [],
  delivery: null,
};

const ORDER_WALLET: OrderWallet = {
  order_id: 'o1',
  order_number: 'BL-20261015-0042',
  customer_id: 'u1',
  order_status: 'DELIVERED',
  payment_method: 'COD',
  wallet_amount_used: 150,
  delivery_fee: 150,
  paid: { wallet: 150, online: 0, cash: 1000, total: 1150 },
  refunded_total: 120,
  refundable: 1030,
  delivery_fee_refundable: 150,
  points: { redeemed: 50, returnable: 40, earned: 11 },
  entries: [WALLET.entries[0]!],
};

function orderApi(extra: (call: Call) => Reply | undefined = () => undefined) {
  return mockApi((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.method === 'GET' && c.path === '/admin/orders/o1') return ok({ order: orderDetail });
    if (c.method === 'GET' && c.path === '/admin/orders/o1/wallet') return ok(ORDER_WALLET);
    return undefined;
  });
}

const renderOrder = (role: 'ADMIN' | 'OPERATIONS' | 'PACKING_STAFF' = 'ADMIN') =>
  render(<OrderPanel order={board} role={role} version={0} busy={false} onAction={() => {}} onClose={() => {}} />);

describe('Order panel - Refund to wallet', () => {
  it('shows the wallet share and loads the refund breakdown only when opened', async () => {
    const user = userEvent.setup();
    const api = orderApi();
    renderOrder('OPERATIONS');
    expect(await screen.findByTestId('payment-wallet')).toHaveTextContent('Wallet LKR 150');
    expect(screen.getByText('Paid by wallet')).toBeInTheDocument();
    expect(api.find('GET', '/admin/orders/o1/wallet')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Refund to wallet' }));
    const section = await screen.findByRole('region', { name: 'Refund to wallet' });
    expect(await within(section).findByTestId('wallet-refundable')).toHaveTextContent('LKR 1,030');
    expect(section).toHaveTextContent('Refunded so far');
    expect(within(section).getByRole('table', { name: 'Refunds on this order' })).toHaveTextContent('Damaged: Milk 1L');
    expect(within(section).getByText(/The customer sees this reason/)).toBeInTheDocument();
  });

  it('validates, then refunds an item with points given back', async () => {
    const user = userEvent.setup();
    const api = orderApi((c) =>
      c.method === 'POST' && c.path === '/admin/orders/o1/wallet-refund'
        ? ok({
            refund: { ...WALLET.entries[0]!, id: 'w9', amount: 200 },
            points_returned: 10,
            points_removed: 2,
            wallet: { ...ORDER_WALLET, refunded_total: 320, refundable: 830 },
          })
        : undefined
    );
    renderOrder();
    await user.click(await screen.findByRole('button', { name: 'Refund to wallet' }));
    const section = await screen.findByRole('region', { name: 'Refund to wallet' });
    await within(section).findByTestId('wallet-refundable');

    await user.type(within(section).getByLabelText(/^Amount/), '2000');
    await user.type(within(section).getByLabelText(/^Points to give back/), '41');
    await user.click(within(section).getByRole('button', { name: 'Refund to wallet' }));
    expect(await within(section).findByText('Only LKR 1,030 is left to refund on this order.')).toBeInTheDocument();
    expect(within(section).getByText('Write a reason (at least 3 characters).')).toBeInTheDocument();
    expect(within(section).getByText('At most 40 points can be given back on this order.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/orders/o1/wallet-refund')).toHaveLength(0);

    const amount = within(section).getByLabelText(/^Amount/);
    await user.clear(amount);
    await user.type(amount, '200');
    await user.type(within(section).getByLabelText(/^Reason/), 'Wrong item: Bread');
    const points = within(section).getByLabelText(/^Points to give back/);
    await user.clear(points);
    await user.type(points, '10');
    await user.click(within(section).getByRole('button', { name: 'Refund to wallet' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/orders/o1/wallet-refund')[0]?.body).toEqual({
        amount: 200,
        kind: 'REFUND_ITEM',
        reason: 'Wrong item: Bread',
        return_points: 10,
      })
    );
    expect(await within(section).findByTestId('wallet-refund-done')).toHaveTextContent("LKR 200 added to the customer's Blynk Wallet.");
    expect(within(section).getByTestId('wallet-refundable')).toHaveTextContent('LKR 830');
  });

  it('caps a delivery fee refund and maps the server refusals', async () => {
    const user = userEvent.setup();
    const api = orderApi((c) =>
      c.method === 'POST' ? fail(422, 'REFUND_EXCEEDS_REFUNDABLE', 'Too much', { refundable: 80 }) : undefined
    );
    renderOrder();
    await user.click(await screen.findByRole('button', { name: 'Refund to wallet' }));
    const section = await screen.findByRole('region', { name: 'Refund to wallet' });
    await within(section).findByTestId('wallet-refundable');
    await user.click(within(section).getByRole('radio', { name: /^Delivery fee/ }));
    await user.type(within(section).getByLabelText(/^Amount/), '151');
    await user.type(within(section).getByLabelText(/^Reason/), 'Order not delivered');
    await user.click(within(section).getByRole('button', { name: 'Refund to wallet' }));
    expect(await within(section).findByText('Only LKR 150 of the delivery fee is left to refund.')).toBeInTheDocument();

    const amount = within(section).getByLabelText(/^Amount/);
    await user.clear(amount);
    await user.type(amount, '150');
    await user.click(within(section).getByRole('button', { name: 'Refund to wallet' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('only LKR 80 can still be refunded');
    expect(api.find('POST', '/admin/orders/o1/wallet-refund')[0]?.body).toEqual({
      amount: 150,
      kind: 'REFUND_DELIVERY_FEE',
      reason: 'Order not delivered',
    });
  });

  it('says "Nothing left to refund" and disables the form when nothing is refundable', async () => {
    const user = userEvent.setup();
    orderApi((c) =>
      c.method === 'GET' && c.path === '/admin/orders/o1/wallet'
        ? ok({ ...ORDER_WALLET, refundable: 0, delivery_fee_refundable: 0, points: { redeemed: 0, returnable: 0, earned: 0 } })
        : undefined
    );
    renderOrder();
    await user.click(await screen.findByRole('button', { name: 'Refund to wallet' }));
    const section = await screen.findByRole('region', { name: 'Refund to wallet' });
    expect(await within(section).findByTestId('wallet-nothing-left')).toHaveTextContent('Nothing left to refund');
    expect(within(section).getByRole('button', { name: 'Refund to wallet' })).toBeDisabled();
    expect(within(section).getByLabelText(/^Amount/)).toBeDisabled();
    expect(within(section).queryByLabelText(/^Points to give back/)).not.toBeInTheDocument();
  });

  it('is not offered to packing staff', async () => {
    orderApi();
    renderOrder('PACKING_STAFF');
    expect(await screen.findByTestId('payment-wallet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund to wallet' })).not.toBeInTheDocument();
  });
});
