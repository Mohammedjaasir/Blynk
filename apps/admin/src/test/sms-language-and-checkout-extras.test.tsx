import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { CheckoutSettings, CustomerSmsLanguageSetting } from '../api/types';
import { checkoutExtrasPatch } from '../lib/checkoutExtras';
import { parseBasketAmount } from '../lib/deliveryFee';
import { mockApi, ok } from './mockApi';

/**
 * Owner, 2026-10-12: the Customer SMS language panel, and the new checkout
 * switches - free delivery above a basket amount, "Allow ordering for someone
 * else" and "Send delivery code to receiver". The rules are the backend's;
 * here, what the page shows and sends.
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

describe('helpers', () => {
  it('parses the basket amount like the API', () => {
    expect(parseBasketAmount('3000')).toEqual({ amount: 3000 });
    expect(parseBasketAmount('3,000.50')).toEqual({ amount: 3000.5 });
    expect(parseBasketAmount('0')).toHaveProperty('error');
    expect(parseBasketAmount('100001')).toHaveProperty('error');
    expect(parseBasketAmount('10.123')).toHaveProperty('error');
    expect(parseBasketAmount('abc')).toHaveProperty('error');
  });

  it('sends the new switches only when they change (older backends keep working)', () => {
    const same = { basketOn: false, basketAmount: 3000, forOthersOn: true, codeToReceiver: true };
    expect(checkoutExtrasPatch(CHECKOUT, same)).toEqual({});
    expect(checkoutExtrasPatch(CHECKOUT, { ...same, basketOn: true, basketAmount: 2500 })).toEqual({
      basket_free_delivery: { enabled: true, min_subtotal_lkr: 2500 },
    });
    expect(checkoutExtrasPatch(CHECKOUT, { ...same, codeToReceiver: false })).toEqual({
      order_for_someone_else: { enabled: true, send_code_to_receiver: false },
    });
    // A backend from before the switches: nothing is sent unless turned on.
    const older = { ...CHECKOUT, basket_free_delivery: undefined, order_for_someone_else: undefined };
    expect(checkoutExtrasPatch(older, same)).toEqual({});
  });
});

describe('Settings - checkout switches (owner, 2026-10-12)', () => {
  it('shows the basket amount and the "for someone else" switches, and saves them', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/checkout') {
        if (c.method === 'GET') return ok(CHECKOUT);
        return ok({
          ...CHECKOUT,
          ...c.body,
          order_for_someone_else: { ...CHECKOUT.order_for_someone_else, ...c.body.order_for_someone_else },
        });
      }
      if (c.path === '/admin/settings/customer-sms-language') return ok(SMS);
      return undefined;
    });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Checkout' });
    const basket = await within(panel).findByRole('checkbox', { name: /Free delivery when the item total is at least LKR/ });
    const amount = within(panel).getByLabelText(/Free delivery from \(LKR\)/);
    const forOthers = within(panel).getByRole('checkbox', { name: 'Allow ordering for someone else' });
    const code = within(panel).getByRole('checkbox', { name: 'Send delivery code to receiver' });
    expect(basket).not.toBeChecked();
    expect(amount).toBeDisabled();
    expect(forOthers).toBeChecked();
    expect(code).toBeChecked();

    await user.click(basket);
    await user.clear(amount);
    await user.type(amount, '2500');
    await user.click(code);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/checkout')[0]?.body).toEqual({
        coupons_enabled: false,
        new_customer_free_deliveries: { enabled: true, count: 2 },
        basket_free_delivery: { enabled: true, min_subtotal_lkr: 2500 },
        order_for_someone_else: { enabled: true, send_code_to_receiver: false },
      })
    );
  });

  it('refuses a bad basket amount before saving', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => (c.path === '/admin/settings/checkout' ? ok(CHECKOUT) : undefined));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Checkout' });
    await user.click(await within(panel).findByRole('checkbox', { name: /Free delivery when the item total is at least LKR/ }));
    const amount = within(panel).getByLabelText(/Free delivery from \(LKR\)/);
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText(/more than LKR 0/)).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/checkout')).toHaveLength(0);
  });
});

describe('Settings - customer SMS language (owner, 2026-10-12)', () => {
  it('shows the mode and samples, and saves customer choice with a fallback', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path !== '/admin/settings/customer-sms-language') return undefined;
      if (c.method === 'GET') return ok(SMS);
      return ok({ ...SMS, ...c.body, updated_at: '2026-10-12T05:00:00.000Z' });
    });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Customer SMS language' });
    const english = await within(panel).findByRole('button', { name: 'English only' });
    expect(english).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByLabelText('Sinhala sample')).toHaveTextContent('ඇණවුම');
    expect(within(panel).getByLabelText('Tamil sample')).toHaveTextContent('ஆர்டர்');
    const fallback = within(panel).getByLabelText(/never picked a language/);
    expect(fallback).toBeDisabled();

    await user.click(within(panel).getByRole('button', { name: "Customer's choice" }));
    expect(fallback).toBeEnabled();
    await user.selectOptions(fallback, 'ta');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/customer-sms-language')[0]?.body).toEqual({ mode: 'CUSTOMER_CHOICE', fallback: 'ta' })
    );
    expect(await within(panel).findByText(/Changed /)).toBeInTheDocument();
  });
});
