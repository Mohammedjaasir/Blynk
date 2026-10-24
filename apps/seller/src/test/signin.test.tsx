import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call } from './mockApi';
import { SELLER_USER, renderApp, seller, signInStoredSession, worldHandler } from './fixtures';

const TOKENS = { access_token: 'new-access', refresh_token: 'new-refresh', user: SELLER_USER };

async function typePhoneAndSend(phone = '0771234567') {
  await userEvent.type(screen.getByLabelText(/your mobile number/i), phone);
  await userEvent.click(screen.getByRole('button', { name: /send me a code/i }));
}

describe('seller sign-in', () => {
  it('signs in with a phone number and the SMS code, then shows the shop', async () => {
    const world = worldHandler({ seller: seller({ shop_name: 'Nimal Farm' }) });
    const api = mockApi((call) => {
      if (call.method === 'POST' && call.path === '/auth/otp/request') return ok({ expires_in_minutes: 5 });
      if (call.method === 'POST' && call.path === '/auth/otp/verify') return ok(TOKENS);
      return world(call);
    });
    renderApp('/products');

    // Not signed in: the sign-in screen, not the products.
    expect(await screen.findByRole('heading', { name: /blynk sellers/i })).toBeInTheDocument();

    await typePhoneAndSend();
    expect(api.find('POST', '/auth/otp/request')[0]!.body).toEqual({ phone: '0771234567' });

    await userEvent.type(await screen.findByLabelText(/6-number code/i), '123456');
    await userEvent.type(screen.getByLabelText(/your shop name/i), 'Nimal Farm');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/verify')[0]!.body).toEqual({
      phone: '0771234567',
      otp: '123456',
      app: 'seller',
      shop_name: 'Nimal Farm',
    });
    expect(tokenStore.access).toBe('new-access');
    expect(tokenStore.refresh).toBe('new-refresh');
  });

  it('leaves the shop name out of the request when it is empty (a returning seller)', async () => {
    const world = worldHandler();
    const api = mockApi((call) => {
      if (call.path === '/auth/otp/request') return ok({});
      if (call.path === '/auth/otp/verify') return ok(TOKENS);
      return world(call);
    });
    renderApp('/products');
    await typePhoneAndSend();
    await userEvent.type(await screen.findByLabelText(/6-number code/i), '654321');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await screen.findByRole('heading', { name: /my products/i });
    expect(api.find('POST', '/auth/otp/verify')[0]!.body).toEqual({ phone: '0771234567', otp: '654321', app: 'seller' });
  });

  it('asks for a real phone number before sending anything', async () => {
    const api = mockApi(() => undefined);
    renderApp('/products');
    await typePhoneAndSend('12');
    expect(await screen.findByText(/enter your mobile number, like 0771234567/i)).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/request')).toHaveLength(0);
  });

  it('asks for six numbers before checking the code', async () => {
    const api = mockApi((call) => (call.path === '/auth/otp/request' ? ok({}) : undefined));
    renderApp('/products');
    await typePhoneAndSend();
    await userEvent.type(await screen.findByLabelText(/6-number code/i), '12');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/enter the 6 numbers from the sms/i)).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/verify')).toHaveLength(0);
  });

  it('says plainly when the number is already a customer, rider or staff account (PHONE_IN_USE)', async () => {
    mockApi((call) => {
      if (call.path === '/auth/otp/request') return ok({});
      if (call.path === '/auth/otp/verify') return fail(403, 'PHONE_IN_USE', 'This number is already used for a Blynk account.');
      return undefined;
    });
    renderApp('/products');
    await typePhoneAndSend();
    await userEvent.type(await screen.findByLabelText(/6-number code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already used for a blynk account/i);
    expect(tokenStore.access).toBeNull();
  });

  it('explains a wrong code and how many tries are left', async () => {
    mockApi((call) => {
      if (call.path === '/auth/otp/request') return ok({});
      if (call.path === '/auth/otp/verify')
        return fail(401, 'INVALID_OTP', 'Invalid OTP code. 2 attempt(s) remaining.', { remaining_attempts: 2 });
      return undefined;
    });
    renderApp('/products');
    await typePhoneAndSend();
    await userEvent.type(await screen.findByLabelText(/6-number code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/that code is not right.*2 tries left/i);
  });

  it('tells the seller to wait when sending codes is rate limited', async () => {
    mockApi((call) =>
      call.path === '/auth/otp/request'
        ? fail(429, 'TOO_MANY_REQUESTS', 'Too many requests.', { retry_after_seconds: 45 })
        : undefined
    );
    renderApp('/products');
    await typePhoneAndSend();
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many tries\. please wait 45 seconds/i);
    // Still on the phone step.
    expect(screen.getByLabelText(/your mobile number/i)).toBeInTheDocument();
  });

  it('offers a new code only after the timer runs out', async () => {
    const api = mockApi((call) => (call.path === '/auth/otp/request' ? ok({}) : undefined));
    renderApp('/products');
    await typePhoneAndSend();
    const resend = await screen.findByRole('button', { name: /send a new code in \d+s/i });
    expect(resend).toBeDisabled();
    expect(api.find('POST', '/auth/otp/request')).toHaveLength(1);
  });

  it('shows the code the API hands back while testing', async () => {
    mockApi((call) => (call.path === '/auth/otp/request' ? ok({ dev_otp: '424242' }) : undefined));
    renderApp('/products');
    await typePhoneAndSend();
    expect(await screen.findByText('424242')).toBeInTheDocument();
  });

  it('signs out: the server is told, the tokens go, and the sign-in screen returns', async () => {
    signInStoredSession();
    const api = mockApi(worldHandler());
    renderApp('/products');
    await screen.findByRole('heading', { name: /my products/i });
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByLabelText(/your mobile number/i)).toBeInTheDocument();
    expect(api.find('POST', '/auth/logout')[0]!.body).toEqual({ refresh_token: 'refresh-token' });
    expect(tokenStore.access).toBeNull();
  });

  it('refuses a stored session that is not a seller', async () => {
    signInStoredSession();
    mockApi((call) =>
      call.path === '/auth/me' ? ok({ ...SELLER_USER, role: 'CUSTOMER' }) : fail(404, 'NOT_MOCKED')
    );
    renderApp('/products');
    expect(await screen.findByLabelText(/your mobile number/i)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

describe('seller session refresh', () => {
  it('renews an expired access token once and carries on', async () => {
    signInStoredSession();
    const world = worldHandler();
    let meCalls = 0;
    const api = mockApi((call: Call) => {
      if (call.path === '/auth/refresh') return ok({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' });
      if (call.path === '/auth/me') {
        meCalls += 1;
        if (meCalls === 1) return fail(401, 'UNAUTHORIZED');
      }
      return world(call);
    });
    renderApp('/products');
    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
    expect(api.find('POST', '/auth/refresh')[0]!.body).toEqual({ refresh_token: 'refresh-token' });
    expect(tokenStore.access).toBe('fresh-access');
    expect(tokenStore.refresh).toBe('fresh-refresh');
  });

  it('goes back to sign-in, saying why, when the refresh is refused', async () => {
    signInStoredSession();
    const world = worldHandler();
    let meCalls = 0;
    mockApi((call: Call) => {
      if (call.path === '/auth/refresh') return fail(401, 'INVALID_REFRESH_TOKEN');
      if (call.path === '/auth/me') {
        meCalls += 1;
        // The first check passes; the next request finds the session over.
        if (meCalls === 1) return ok(SELLER_USER);
      }
      if (call.path === '/seller/me') return fail(401, 'UNAUTHORIZED');
      return world(call);
    });
    renderApp('/products');
    expect(await screen.findByLabelText(/your mobile number/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/your session has ended/i)).toBeInTheDocument());
    expect(tokenStore.access).toBeNull();
  });
});
