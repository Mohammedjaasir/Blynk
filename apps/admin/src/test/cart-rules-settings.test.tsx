import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Settings -> Cart rules (owner, 2026-10-27;
 * docs/superpowers/plans/2026-10-27-one-seller-cart-and-seller-applications.md, section R): the "One seller per
 * order" switch, GET|PATCH /admin/settings/cart-rules (mocked here; the backend is built in parallel).
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

/** A stateful fake of the cart-rules endpoint; `extra` can answer first. */
function cartRulesApi(extra: (call: Call) => Reply | undefined = () => undefined, initial: Record<string, unknown> = { one_seller_per_order: { enabled: true }, updated_at: null }) {
  let rules = { ...initial };
  return mockApi((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.path === '/admin/settings/cart-rules') {
      if (c.method === 'PATCH') rules = { ...rules, ...c.body, updated_at: '2026-10-27T05:00:00.000Z' };
      return ok(rules);
    }
    return undefined;
  });
}

describe('Settings - cart rules card', () => {
  it('shows "One seller per order" ON with its explanation and the "coming later" line', async () => {
    cartRulesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    const toggle = await within(panel).findByRole('switch', { name: 'One seller per order' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(panel).toHaveTextContent('One seller per order (on)');
    expect(panel).toHaveTextContent(
      "A cart can hold items from only one seller, or only Blynk's own products. If a customer adds something from a different seller they are asked to start a new cart."
    );
    expect(within(panel).getByTestId('cart-rules-later')).toHaveTextContent('Mixed carts for nearby sellers: coming later.');
  });

  it('shows the switch ON when the API has no value yet', async () => {
    cartRulesApi(() => undefined, { updated_at: null });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    expect(await within(panel).findByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a saved OFF state', async () => {
    cartRulesApi(() => undefined, { one_seller_per_order: { enabled: false }, updated_at: '2026-10-27T01:00:00.000Z' });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    expect(await within(panel).findByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'false');
    expect(panel).toHaveTextContent('One seller per order (off)');
  });

  it('toggles OFF, saves with PATCH /admin/settings/cart-rules and shows the saved state', async () => {
    const user = userEvent.setup();
    const api = cartRulesApi();
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    await user.click(await within(panel).findByRole('switch', { name: 'One seller per order' }));
    // Nothing is sent until Save.
    expect(api.find('PATCH', '/admin/settings/cart-rules')).toHaveLength(0);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/cart-rules')[0]?.body).toEqual({ one_seller_per_order: { enabled: false } })
    );
    expect(await screen.findByText('One seller per order is off.')).toBeInTheDocument();
    expect(within(panel).getByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches back ON and saves', async () => {
    const user = userEvent.setup();
    const api = cartRulesApi(() => undefined, { one_seller_per_order: { enabled: false }, updated_at: null });
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    await user.click(await within(panel).findByRole('switch', { name: 'One seller per order' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/cart-rules')[0]?.body).toEqual({ one_seller_per_order: { enabled: true } })
    );
    expect(await screen.findByText('One seller per order is on.')).toBeInTheDocument();
  });

  it("shows the server's refusal inline and keeps the switch where it was set", async () => {
    const user = userEvent.setup();
    cartRulesApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/cart-rules'
        ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'one_seller_per_order', message: 'one_seller_per_order.enabled must be a boolean' }])
        : undefined
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    await user.click(await within(panel).findByRole('switch', { name: 'One seller per order' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('one_seller_per_order.enabled must be a boolean');
    expect(within(panel).getByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows other save errors inline', async () => {
    const user = userEvent.setup();
    cartRulesApi((c) => (c.method === 'PATCH' && c.path === '/admin/settings/cart-rules' ? fail(500, 'INTERNAL', 'Something went wrong.') : undefined));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    await user.click(await within(panel).findByRole('button', { name: 'Save' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('says so when the cart rules cannot be loaded, with no switch', async () => {
    mockApi((c) => (c.path === '/admin/settings/cart-rules' ? fail(500, 'INTERNAL', 'Boom') : undefined));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Cart rules' });
    expect(await within(panel).findByText('Boom')).toBeInTheDocument();
    expect(within(panel).queryByRole('switch')).toBeNull();
  });
});
