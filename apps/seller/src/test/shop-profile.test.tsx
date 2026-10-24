import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, ok } from './mockApi';
import { renderApp, seller, signInStoredSession, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());

describe('shop profile', () => {
  it('saves the shop details (PUT /seller/profile)', async () => {
    const api = mockApi((call) =>
      call.method === 'PUT' && call.path === '/seller/profile'
        ? ok({ seller: seller({ shop_name: 'Nimal Organic Farm', address: 'Matara' }) })
        : worldHandler()(call)
    );
    renderApp('/shop');
    const name = await screen.findByLabelText(/shop name/i);
    expect(name).toHaveValue('Nimal Farm');
    await userEvent.clear(name);
    await userEvent.type(name, 'Nimal Organic Farm');
    const address = screen.getByLabelText(/^address/i);
    await userEvent.clear(address);
    await userEvent.type(address, 'Matara');
    await userEvent.click(screen.getByRole('button', { name: /save my shop details/i }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(api.find('PUT', '/seller/profile')[0]!.body).toEqual({
      shop_name: 'Nimal Organic Farm',
      contact_name: 'Nimal',
      address: 'Matara',
      note: '',
    });
  });

  it('needs a shop name of at least two letters', async () => {
    const api = mockApi(worldHandler());
    renderApp('/shop');
    const name = await screen.findByLabelText(/shop name/i);
    await userEvent.clear(name);
    await userEvent.type(name, 'N');
    await userEvent.click(screen.getByRole('button', { name: /save my shop details/i }));
    expect(await screen.findByText(/enter your shop name \(at least 2 letters\)/i)).toBeInTheDocument();
    expect(api.find('PUT', '/seller/profile')).toHaveLength(0);
  });

  it('lets a rejected seller fix their details', async () => {
    const api = mockApi((call) =>
      call.method === 'PUT'
        ? ok({ seller: seller({ status: 'PENDING' }) })
        : worldHandler({ seller: seller({ status: 'REJECTED', rejection_reason: 'No address.' }) })(call)
    );
    renderApp('/shop');
    const address = await screen.findByLabelText(/^address/i);
    expect(address).toBeEnabled();
    await userEvent.type(address, ' New road');
    await userEvent.click(screen.getByRole('button', { name: /save my shop details/i }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(api.find('PUT', '/seller/profile')).toHaveLength(1);
  });

  it('is read-only while suspended', async () => {
    mockApi(worldHandler({ seller: seller({ status: 'SUSPENDED' }) }));
    renderApp('/shop');
    expect(await screen.findByLabelText(/shop name/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /save my shop details/i })).toBeDisabled();
  });
});
