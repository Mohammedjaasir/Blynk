import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * 2026-10-27 (docs/superpowers/plans/2026-10-27-one-seller-cart-and-seller-applications.md, section R), on More:
 * the Cart rules card, GET|PATCH /admin/settings/cart-rules (mocked; the backend is built in parallel).
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const ON = { one_seller_per_order: { enabled: true }, updated_at: null };
const OFF = { one_seller_per_order: { enabled: false }, updated_at: '2026-10-27T01:00:00.000Z' };

const cardOf = async () => (await screen.findByRole('heading', { name: 'Cart rules' })).closest('section') as HTMLElement;

describe('Cart rules card', () => {
  it('shows "One seller per order" ON with its explanation and the "coming later" line', async () => {
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/settings/cart-rules': () => ok(ON) });
    const card = await cardOf();
    const toggle = await within(card).findByRole('switch', { name: 'One seller per order' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(card).toHaveTextContent(
      "A cart can hold items from only one seller, or only Blynk's own products. If a customer adds something from a different seller they are asked to start a new cart."
    );
    expect(within(card).getByTestId('cart-rules-later')).toHaveTextContent('Mixed carts for nearby sellers: coming later.');
  });

  it('shows the switch ON when the API has no value yet', async () => {
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/settings/cart-rules': () => ok({ updated_at: null }) });
    const card = await cardOf();
    expect(await within(card).findByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a saved OFF state', async () => {
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/settings/cart-rules': () => ok(OFF) });
    const card = await cardOf();
    expect(await within(card).findByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles OFF, saves with PATCH /admin/settings/cart-rules and shows the saved state', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/cart-rules': () => ok(ON),
      'PATCH /admin/settings/cart-rules': (call) => ok({ ...(call.body as object), updated_at: '2026-10-27T05:00:00.000Z' }),
    });
    const card = await cardOf();
    await user.click(await within(card).findByRole('switch', { name: 'One seller per order' }));
    expect(api.find('PATCH', '/admin/settings/cart-rules')).toHaveLength(0);
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/cart-rules')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/cart-rules')[0].body).toEqual({ one_seller_per_order: { enabled: false } });
    expect(await within(card).findByText('One seller per order is off.')).toBeInTheDocument();
    expect(within(card).getByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches back ON and saves', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/cart-rules': () => ok(OFF),
      'PATCH /admin/settings/cart-rules': (call) => ok({ ...(call.body as object), updated_at: null }),
    });
    const card = await cardOf();
    await user.click(await within(card).findByRole('switch', { name: 'One seller per order' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/cart-rules')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/cart-rules')[0].body).toEqual({ one_seller_per_order: { enabled: true } });
    expect(await within(card).findByText('One seller per order is on.')).toBeInTheDocument();
  });

  it('shows a save error inline and keeps the switch where it was set', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/cart-rules': () => ok(ON),
      'PATCH /admin/settings/cart-rules': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ message: 'one_seller_per_order.enabled must be a boolean' }] },
      }),
    });
    const card = await cardOf();
    await user.click(await within(card).findByRole('switch', { name: 'One seller per order' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('one_seller_per_order.enabled must be a boolean');
    expect(within(card).getByRole('switch', { name: 'One seller per order' })).toHaveAttribute('aria-checked', 'false');
  });

  it('shows the load error and no form when the cart rules cannot be read', async () => {
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/settings/cart-rules': () => fail(500, 'INTERNAL') });
    const card = await cardOf();
    expect(await within(card).findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
    expect(within(card).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
