import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok } from './mockApi';
import { product, renderApp, seller, signInStoredSession, submission, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());

describe('pause and resume a product', () => {
  it('shows an "On sale" switch on a live product', async () => {
    mockApi(worldHandler({ products: [product()] }));
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    const toggle = within(card).getByRole('switch');
    expect(toggle).toBeChecked();
    expect(toggle).toHaveTextContent('On sale');
    expect(within(card).queryByText(/customers can't order it/i)).not.toBeInTheDocument();
  });

  it('pauses: calls the availability endpoint with { available: false } and mutes the card', async () => {
    const api = mockApi((call) =>
      call.method === 'PATCH' && call.path === '/seller/products/p1/availability'
        ? ok({ id: 'p1', is_available: false })
        : worldHandler({ products: [product()] })(call)
    );
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    await userEvent.click(within(card).getByRole('switch'));

    await waitFor(() => expect(api.find('PATCH', '/seller/products/p1/availability')).toHaveLength(1));
    expect(api.find('PATCH', '/seller/products/p1/availability')[0]!.body).toEqual({ available: false });
    expect(within(card).getByRole('switch')).not.toBeChecked();
    expect(within(card).getByRole('switch')).toHaveTextContent('Paused');
    expect(within(card).getByText(/Paused, customers can't order it/)).toBeInTheDocument();
    expect(card).toHaveClass('pcard--paused');
    expect(within(card).getByText('Paused', { selector: '.chip' })).toBeInTheDocument();
  });

  it('a paused product starts muted, and switching it back on sends { available: true }', async () => {
    const api = mockApi((call) =>
      call.method === 'PATCH' && call.path === '/seller/products/p1/availability'
        ? ok({ id: 'p1', is_available: true })
        : worldHandler({ products: [product({ is_available: false })] })(call)
    );
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).getByRole('switch')).not.toBeChecked();
    expect(within(card).getByText(/Paused, customers can't order it/)).toBeInTheDocument();
    expect(card).toHaveClass('pcard--paused');

    await userEvent.click(within(card).getByRole('switch'));
    await waitFor(() => expect(api.find('PATCH', '/seller/products/p1/availability')[0]!.body).toEqual({ available: true }));
    await waitFor(() => expect(within(card).getByRole('switch')).toBeChecked());
    expect(within(card).queryByText(/customers can't order it/i)).not.toBeInTheDocument();
    expect(card).not.toHaveClass('pcard--paused');
  });

  it('puts the switch back and says why when the API refuses', async () => {
    mockApi((call) =>
      call.method === 'PATCH' && call.path === '/seller/products/p1/availability'
        ? fail(403, 'SELLER_NOT_APPROVED', 'no')
        : worldHandler({ products: [product()] })(call)
    );
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    await userEvent.click(within(card).getByRole('switch'));
    expect(await within(card).findByRole('alert')).toHaveTextContent(/has not approved your shop/i);
    expect(within(card).getByRole('switch')).toBeChecked();
    expect(card).not.toHaveClass('pcard--paused');
  });

  it('shows a network failure under the switch', async () => {
    mockApi((call) => {
      if (call.method === 'PATCH') throw new TypeError('offline');
      return worldHandler({ products: [product()] })(call);
    });
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    await userEvent.click(within(card).getByRole('switch'));
    expect(await within(card).findByRole('alert')).toBeInTheDocument();
    expect(within(card).getByRole('switch')).toBeChecked();
  });

  it('has no switch on a waiting submission, a product Blynk switched off, or for a shop that is switched off', async () => {
    mockApi(
      worldHandler({
        products: [
          product({
            id: 'submission:abc',
            name: 'Mango Jam',
            live: false,
            selling_price: null,
            is_active: false,
            pending: submission(),
          }),
          product({ id: 'p2', name: 'Jaggery', is_active: false }),
        ],
      })
    );
    renderApp('/products');
    const jam = await screen.findByRole('article', { name: 'Mango Jam' });
    expect(within(jam).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Jaggery' })).queryByRole('switch')).not.toBeInTheDocument();
  });

  it('is switched off while the shop is suspended', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'SUSPENDED' }), products: [product()] }));
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).getByRole('switch')).toBeDisabled();
  });
});
