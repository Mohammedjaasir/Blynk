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

/** Types the number, asks for a code, types the code and verifies. */
async function signIn(user: ReturnType<typeof userEvent.setup>, phone = '0779876543', code = '123456') {
  await user.type(await screen.findByLabelText('Mobile number'), phone);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await user.type(await screen.findByLabelText('6-digit code'), code);
  await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
}

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

  it('sign-in is phone + SMS code only: no email or password form', async () => {
    renderAs(null, '/login');
    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByText(/password/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /SMS code instead/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Apply to deliver' })).toBeInTheDocument();
  });

  it('OTP sign-in lets a rider in, never asking to create an account', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
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
    expect(api.find('POST', '/auth/otp/request')[0].body).toEqual({ phone: '0779876543' });
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({
      phone: '0779876543',
      otp: '123456',
      create_account: false,
    });
    expect(api.find('POST', '/auth/staff/login')).toHaveLength(0);
  });

  it('OTP sign-in refuses a non-rider account and keeps no token', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: CUSTOMER }),
    });
    await signIn(user, '0771234567');
    expect(
      await screen.findByText('This app is for Blynk riders. Sign in with a rider account.')
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('checks the number is a Sri Lankan mobile before sending a code', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login');
    await user.type(await screen.findByLabelText('Mobile number'), '0112345678');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a Sri Lankan mobile number, like 077 123 4567.');
    expect(api.find('POST', '/auth/otp/request')).toHaveLength(0);
  });

  it('offers "Resend code" only after the countdown', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', { 'POST /auth/otp/request': () => ok({ dev_otp: '123456' }) });
    await user.type(await screen.findByLabelText('Mobile number'), '0779876543');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('button', { name: /Resend code in [01]:\d\d/ })).toBeDisabled();
  });

  it('a spent code lets the rider ask for a new one straight away', async () => {
    const user = userEvent.setup();
    let sent = 0;
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: String(111111 * ++sent) }),
      'POST /auth/otp/verify': () => fail(410, 'OTP_EXPIRED', 'OTP has expired.'),
    });
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('That code has expired. Ask for a new one.');
    await user.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(await screen.findByText('Dev code: 222222')).toBeInTheDocument();
    expect(screen.getByLabelText('6-digit code')).toHaveValue('');
  });

  it('a rate-limited code request says how long to wait', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () =>
        fail(429, 'TOO_MANY_REQUESTS', 'Too many requests.', { retry_after_seconds: 1500 }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0779876543');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many codes asked for. Try again in 25 minutes.');
  });

  it.each([
    ['INVALID_OTP', 401, { remaining_attempts: 2 }, "That code isn't right. 2 tries left."],
    ['OTP_EXPIRED', 410, undefined, 'That code has expired. Ask for a new one.'],
    ['OTP_MAX_ATTEMPTS_EXCEEDED', 429, undefined, 'Too many wrong codes. Ask for a new one.'],
  ])('%s gets a clear message and keeps the rider on the code step', async (code, status, details, message) => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => fail(status, code, code, details),
    });
    await signIn(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('ACCOUNT_NOT_FOUND offers "Apply to deliver" with the number filled in', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => fail(404, 'ACCOUNT_NOT_FOUND', 'No account.'),
    });
    await signIn(user, '0771112223');
    expect(await screen.findByRole('alert')).toHaveTextContent('No rider account uses this number.');
    await user.click(screen.getByRole('button', { name: 'Apply to deliver' }));
    expect(await screen.findByRole('heading', { name: 'Apply to deliver' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0771112223');
  });

  it.each([
    ['the code request', 'POST /auth/otp/request'],
    ['the code check', 'POST /auth/otp/verify'],
  ])('a pending application shows the waiting screen (refused at %s)', async (_when, route) => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: RIDER }),
      [route]: () => fail(403, 'RIDER_PENDING_APPROVAL', 'Your application is waiting for approval.'),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0779876543');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    if (route === 'POST /auth/otp/verify') {
      await user.type(await screen.findByLabelText('6-digit code'), '123456');
      await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    }
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(
      screen.getByText("Your application is waiting for approval. We'll send you an SMS when you're approved.")
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
  });

  it('a rejected application shows the reason and offers to apply again', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () =>
        fail(403, 'RIDER_APPLICATION_REJECTED', "Your application wasn't approved.", {
          reason: 'Registration number could not be verified.',
        }),
    });
    await signIn(user, '0773334445');
    expect(await screen.findByRole('heading', { name: "Your application wasn't approved." })).toBeInTheDocument();
    expect(screen.getByText('Reason: Registration number could not be verified.')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Apply again' }));
    expect(await screen.findByRole('heading', { name: 'Apply to deliver' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0773334445');
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
      expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({ phone: '0779876543', otp: '654321', create_account: false })
    );
  });
});
