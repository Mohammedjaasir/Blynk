import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { ADMIN, CUSTOMER, RIDER, STAFF, fail, ok, renderAs } from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('rider sign-in and session', () => {
  it('a signed-in rider lands on their deliveries', async () => {
    renderAs(RIDER, '/');
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
  });

  it.each([
    ['customer', CUSTOMER],
    ['packing staff', STAFF],
    ['admin', ADMIN],
  ])('a %s session is signed out with an explanation', async (_label, user) => {
    const { api } = renderAs(user, '/');
    expect(
      await screen.findByText('This app is for Blynk riders. Sign in with a rider account.')
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(api.find('GET', '/riders/deliveries')).toHaveLength(0);
  });

  it.each(['RIDER_PROFILE_NOT_FOUND', 'RIDER_INACTIVE'])(
    '%s from the API signs the rider out with a clear message',
    async (code) => {
      renderAs(RIDER, '/', { 'GET /riders/deliveries': () => fail(403, code) });
      expect(
        await screen.findByText("Your rider profile isn't active. Contact the store.")
      ).toBeInTheDocument();
      expect(tokenStore.access).toBeNull();
    }
  );

  it('OTP sign-in refuses a non-rider account and keeps no token', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: CUSTOMER }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(
      await screen.findByText('This app is for Blynk riders. Sign in with a rider account.')
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('OTP sign-in lets a rider in', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: RIDER }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0779876543');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Dev code: 123456')).toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
    expect(tokenStore.access).toBe('a');
  });

  it('shows the dev Skip button only when a dev rider phone is configured', async () => {
    renderAs(null, '/login');
    await screen.findByLabelText('Mobile number');
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).not.toBeInTheDocument();
  });

  it('dev Skip runs the normal OTP flow for the configured rider', async () => {
    vi.stubEnv('VITE_DEV_RIDER_PHONE', '0779876543');
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '654321' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: RIDER }),
    });
    await user.click(await screen.findByRole('button', { name: 'Skip sign-in' }));
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
    await waitFor(() =>
      expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({ phone: '0779876543', otp: '654321' })
    );
  });
});
