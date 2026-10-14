import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OrderPanel } from '../components/OrderPanel';
import { tokenStore } from '../api/client';
import type { BoardOrder } from '../api/types';
import { mockApi, ok } from './mockApi';

/** Order detail: payment label, Refund needed and the PayHere details (docs/api/payhere.md). */

const board = (over: Partial<BoardOrder> = {}): BoardOrder => ({
  id: 'o1',
  order_number: 'BL-20261014-0042',
  order_status: 'PLACED',
  total_amount: 1250,
  placed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  scheduled_for: null,
  delivery_recipient_name: 'Nimal Perera',
  delivery_address_line1: 'No. 1, Test Lane',
  delivery_city: 'Dharga Town',
  items_summary: { total: 1, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
  active_delivery: null,
  ...over,
});

function detail(o: BoardOrder, over: Record<string, unknown> = {}) {
  return {
    ...o,
    payment_method: 'ONLINE',
    payment_status: 'PAID',
    subtotal_amount: 1150,
    delivery_fee: 100,
    delivery_recipient_phone: '+94771234567',
    delivery_address_line2: null,
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Milk 1L', quantity: 1, item_status: 'PENDING', actual_unit_cost: null }],
    history: [],
    delivery: null,
    ...over,
  };
}

function renderPanel(o: BoardOrder, d: Record<string, unknown>) {
  mockApi((c) => (c.method === 'GET' && c.path === `/admin/orders/${o.id}` ? ok({ order: d }) : undefined));
  render(<OrderPanel order={o} role="ADMIN" version={0} busy={false} onAction={() => {}} onClose={() => {}} />);
}

describe('Order panel payment', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows Paid online with the PayHere payment id, method and message', async () => {
    const o = board();
    renderPanel(
      o,
      detail(o, {
        payment: { gateway: 'PAYHERE', gateway_payment_id: '320025071278', gateway_method: 'VISA', gateway_status_message: 'Successfully completed', refund_required: false },
      })
    );
    expect(await screen.findByTestId('payment-label')).toHaveTextContent('Paid online');
    const section = screen.getByRole('region', { name: 'Payment' });
    expect(within(section).getByText('320025071278')).toBeInTheDocument();
    expect(within(section).getByText('Visa')).toBeInTheDocument();
    expect(within(section).getByText('Successfully completed')).toBeInTheDocument();
    expect(within(section).queryByText('Refund needed')).not.toBeInTheDocument();
  });

  it('warns Refund needed and labels a chargeback', async () => {
    const o = board({ order_status: 'CANCELLED' });
    renderPanel(o, detail(o, { payment_status: 'REFUNDED', payment: { refund_required: true } }));
    expect(await screen.findByTestId('payment-label')).toHaveTextContent('Refunded / chargeback');
    expect(screen.getByText('Refund needed')).toBeInTheDocument();
  });

  it('explains an awaiting-payment order, offers no actions and shows when it expires', async () => {
    const o = board({ order_status: 'AWAITING_PAYMENT', payment_method: 'ONLINE', payment_status: 'PENDING' });
    renderPanel(o, detail(o, { payment_status: 'PENDING', payment_expires_at: '2026-10-14T10:20:00.000Z' }));
    expect(await screen.findByTestId('payment-label')).toHaveTextContent('Payment pending');
    expect(screen.getByTestId('payment-awaiting')).toHaveTextContent(/cancelled automatically at 15:50/);
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pack' })).not.toBeInTheDocument();
  });

  it('labels cash on delivery', async () => {
    const o = board();
    renderPanel(o, detail(o, { payment_method: 'COD', payment_status: 'PENDING' }));
    expect(await screen.findByTestId('payment-label')).toHaveTextContent('Cash on delivery');
  });
});
