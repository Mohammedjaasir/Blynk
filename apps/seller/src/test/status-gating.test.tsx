import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi } from './mockApi';
import { product, renderApp, seller, signInStoredSession, submission, worldHandler } from './fixtures';
import type { SellerStatus } from '../api/types';

beforeEach(() => signInStoredSession());

describe('status banner and gating by shop status', () => {
  it('PENDING: says it is waiting, and does not let the seller add products', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'PENDING' }) }));
    renderApp('/products');
    expect(await screen.findByText(/waiting for blynk to approve your shop/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add a product/i })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /add a product/i })).not.toBeInTheDocument();
    expect(screen.getByText(/once blynk has approved your shop/i)).toBeInTheDocument();
  });

  it('REJECTED: shows the reason and points to the shop details', async () => {
    mockApi(
      worldHandler({
        seller: seller({ status: 'REJECTED', rejection_reason: 'Please add your shop address.' }),
      })
    );
    renderApp('/products');
    expect(await screen.findByText(/could not approve your shop/i)).toBeInTheDocument();
    expect(screen.getByText(/reason: please add your shop address\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /shop details/i })).toHaveAttribute('href', '/shop');
    expect(screen.getByRole('button', { name: /add a product/i })).toBeDisabled();
  });

  it('SUSPENDED: says the shop is switched off', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'SUSPENDED' }) }));
    renderApp('/products');
    expect(await screen.findByText(/your shop is switched off by blynk/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add a product/i })).toBeDisabled();
  });

  it('APPROVED: no banner at all (the old "Your shop is approved." is gone), and the seller can add products', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'APPROVED' }) }));
    renderApp('/products');
    expect(await screen.findByRole('link', { name: /add a product/i })).toHaveAttribute('href', '/products/new');
    expect(screen.queryByText(/your shop is approved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/blynk checks each one and sets the customer price/i)).not.toBeInTheDocument();
    expect(document.querySelector('.banner')).toBeNull();
  });

  it('APPROVED: no banner on the other screens either', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'APPROVED' }) }));
    renderApp('/statement');
    await screen.findByRole('heading', { name: /statement/i });
    expect(document.querySelector('.banner')).toBeNull();
  });

  it('shows the banner on every screen, not only on products', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'PENDING' }) }));
    renderApp('/statement');
    expect(await screen.findByText(/waiting for blynk to approve your shop/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /my shop/i }));
    expect(await screen.findByRole('heading', { name: /my shop/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting for blynk to approve your shop/i)).toBeInTheDocument();
  });

  it.each<SellerStatus>(['PENDING', 'REJECTED', 'SUSPENDED'])(
    '%s: the add form and the edit form are blocked even when opened by address',
    async (status) => {
      mockApi(worldHandler({ seller: seller({ status }), products: [product()] }));
      renderApp('/products/new');
      expect(await screen.findByRole('heading', { name: /add a product/i })).toBeInTheDocument();
      expect(await screen.findByRole('link', { name: /back to my products/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/product name/i)).not.toBeInTheDocument();
    }
  );

  it('PENDING: existing products show but Edit is switched off', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'PENDING' }), products: [product()] }));
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Kithul Treacle' });
    expect(within(card).getByRole('button', { name: /^edit$/i })).toBeDisabled();
  });

  it('shows a retry when the shop cannot be loaded', async () => {
    let fail = true;
    mockApi((call) => {
      if (call.path === '/seller/me' && fail) {
        fail = false;
        return { status: 500, error: { code: 'INTERNAL', message: 'Server error' } };
      }
      return worldHandler({ products: [] })(call);
    });
    renderApp('/products');
    expect(await screen.findByRole('alert')).toHaveTextContent(/server error/i);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
  });

  it('keeps a pending NEW submission visible as a waiting product', async () => {
    mockApi(
      worldHandler({
        products: [
          product({
            id: 'submission:abc',
            name: 'Mango Jam',
            live: false,
            selling_price: null,
            stock_on_hand: null,
            units_sold: 0,
            is_active: false,
            pending: submission(),
          }),
        ],
      })
    );
    renderApp('/products');
    const card = await screen.findByRole('article', { name: 'Mango Jam' });
    expect(within(card).getByText('Waiting for approval')).toBeInTheDocument();
    // Not a real product yet: no Edit, but it can be withdrawn.
    expect(within(card).queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /withdraw this product/i })).toBeInTheDocument();
  });
});
