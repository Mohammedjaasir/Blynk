import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { tokenStore } from '../api/client';
import type { OrderDetail } from '../api/types';
import { codToCollect } from '../pages/PackingSlip';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/**
 * The printable packing slip (/orders/:id/slip), opened from the order's
 * "Print packing slip" button. window.print() with a print stylesheet on the
 * web; inside the Android app (Capacitor WebView, where window.print() does
 * nothing) the slip is shown with a note instead of a Print button.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.restoreAllMocks();
});

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    order_number: 'BL-20260930-0042',
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    total_amount: 1690,
    placed_at: '2026-09-30T04:30:00Z',
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Mosque Road',
    delivery_address_line2: 'Near the clock tower',
    delivery_city: 'Dharga Town',
    delivery_postal_code: '80250',
    delivery_instructions: 'Blue gate',
    customer_notes: 'Please call on arrival',
    cancellation_reason: null,
    items: [
      { id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', unit_snapshot: '1 L', quantity: 2, item_status: 'PENDING' },
      { id: 'i2', product_name_snapshot: 'Pelwatte Butter 200g', unit_snapshot: '200 g', quantity: 1, item_status: 'SOURCED' },
      { id: 'i3', product_name_snapshot: 'Brown Eggs', unit_snapshot: '10 pack', quantity: 1, item_status: 'UNAVAILABLE' },
    ],
    history: [],
    delivery: null,
    ...overrides,
  };
}

describe('Packing slip', () => {
  it('the order page opens the slip', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: order() }) });
    const open = await screen.findByRole('link', { name: 'Print packing slip' }, { timeout: 5000 });
    expect(open).toHaveAttribute('href', '/orders/o1/slip');
    await user.click(open);
    expect(await screen.findByRole('article', { name: 'Packing slip' }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows the order, customer, notes, items, total and cash to collect, and prints with window.print()', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', { 'GET /admin/orders/:id': () => ok({ order: order() }) });

    const slip = await screen.findByRole('article', { name: 'Packing slip' });
    expect(slip).toHaveTextContent('Blynk');
    expect(slip).toHaveTextContent('BL-20260930-0042');
    expect(slip).toHaveTextContent(/30 Sept? 2026/);
    expect(slip).toHaveTextContent('Ahmed Rizvi');
    expect(slip).toHaveTextContent('14 Mosque Road, Near the clock tower, Dharga Town, 80250');
    expect(within(slip).getByRole('region', { name: 'Delivery notes' })).toHaveTextContent('Blue gate');
    expect(within(slip).getByRole('region', { name: 'Delivery notes' })).toHaveTextContent('Please call on arrival');

    const rows = within(slip).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['2Kotmale Fresh Milk 1L1 L', '1Pelwatte Butter 200g200 g']);
    expect(slip).not.toHaveTextContent('Brown Eggs');

    expect(slip).toHaveTextContent('TotalLKR 1,690');
    expect(slip).toHaveTextContent('Cash to collect (COD)LKR 1,690');
    // Costs never reach the slip.
    expect(slip.textContent).not.toMatch(/cost|supplier/i);

    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('lists the additional phone under the recipient only when there is one', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', {
      'GET /admin/orders/:id': () => ok({ order: order({ delivery_alternate_phone: '+94712345678' }) }),
    });
    const slip = await screen.findByRole('article', { name: 'Packing slip' });
    const to = within(slip).getByRole('region', { name: 'Deliver to' });
    expect(to).toHaveTextContent('077 123 4567');
    expect(to).toHaveTextContent('Additional phone: 071 234 5678');
    cleanup();

    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', { 'GET /admin/orders/:id': () => ok({ order: order() }) });
    const plain = await screen.findByRole('article', { name: 'Packing slip' });
    expect(plain).not.toHaveTextContent('Additional phone');
  });

  it('a paid order has nothing to collect', () => {
    expect(codToCollect({ payment_method: 'COD', payment_status: 'PAID', total_amount: 900 })).toBe(0);
    expect(codToCollect({ payment_method: 'ONLINE', payment_status: 'PENDING', total_amount: 900 })).toBe(0);
    expect(codToCollect({ payment_method: 'COD', payment_status: 'PENDING', total_amount: 900 })).toBe(900);
  });

  it('inside the Android app, where the WebView cannot print, it says so instead of offering a dead Print button', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', { 'GET /admin/orders/:id': () => ok({ order: order() }) });
    expect(await screen.findByRole('article', { name: 'Packing slip' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
    expect(screen.getByText(/Printing isn't available inside the Android app/)).toBeInTheDocument();
  });
});
