import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_ROLES, WRONG_ROLE_MESSAGE } from '../auth/AuthContext';
import {
  ADMIN_NO_RIDER,
  ADMIN_WITH_RIDER,
  CUSTOMER,
  NETWORK_DOWN,
  OPERATIONS_STAFF,
  RIDER,
  STAFF,
  fail,
  ok,
  renderAs,
} from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * F2 replaced Home's F1 placeholder (which rendered `riderCapability`
 * literally, e.g. "ADMIN_PLUS_RIDER") with the real dashboard - these
 * classification tests now read the Delivery tab's `aria-disabled` state
 * instead (the same observable `layout.test.tsx` already asserts on), since
 * it is driven by the exact same `riderCapability` value and, unlike Home's
 * own content, does not depend on mocking Home's unrelated endpoints
 * (orders/dental/riders) that these auth-flow tests have nothing to do
 * with.
 */
async function expectRiderCapable() {
  const deliveryTab = await screen.findByRole('link', { name: /^Delivery/ });
  expect(deliveryTab).not.toHaveAttribute('aria-disabled');
}
async function expectAdminOnly() {
  const deliveryTab = await screen.findByRole('link', { name: /^Delivery/ });
  expect(deliveryTab).toHaveAttribute('aria-disabled', 'true');
}

describe('Operations sign-in and session classification', () => {
  it('an ADMIN with a linked, active rider profile is classified ADMIN_PLUS_RIDER', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    await expectRiderCapable();
  });

  it.each(['RIDER_PROFILE_NOT_FOUND', 'RIDER_INACTIVE'])(
    'an ADMIN whose rider probe fails with %s is classified ADMIN_ONLY, and the session stays signed in',
    async (code) => {
      renderAs(ADMIN_NO_RIDER, '/', { 'GET /riders/deliveries': () => fail(403, code) });
      await expectAdminOnly();
      // A rider-profile refusal is not a session-ending event for Operations.
      expect(tokenStore.access).toBe('test-access');
    }
  );

  it('an unexpected probe failure (e.g. a dropped connection) is treated conservatively as ADMIN_ONLY, never crashes', async () => {
    renderAs(ADMIN_NO_RIDER, '/', { 'GET /riders/deliveries': () => NETWORK_DOWN });
    await expectAdminOnly();
    expect(tokenStore.access).toBe('test-access');
  });

  it.each([
    ['customer', CUSTOMER],
    ['rider', RIDER],
    ['packing staff', STAFF],
  ])('a %s session is signed out immediately with a clear message, and never probes the rider endpoint', async (_label, user) => {
    const { api } = renderAs(user, '/');
    expect(
      await screen.findByText(WRONG_ROLE_MESSAGE)
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(api.find('GET', '/riders/deliveries')).toHaveLength(0);
  });

  // Backend migration 014: an Operations staff account (created in Blynk
  // Admin -> Staff accounts) opens this app; packing staff do not.
  it('an OPERATIONS staff session is let in and classified like an admin one', async () => {
    renderAs(OPERATIONS_STAFF, '/', { 'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND') });
    await expectAdminOnly();
    expect(tokenStore.access).toBe('test-access');
    expect(OPERATIONS_ROLES).toEqual(['ADMIN', 'OPERATIONS']);
  });

  it('password sign-in lets an OPERATIONS staff account in', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/staff/login': () => ok({ access_token: 'a', refresh_token: 'r', user: OPERATIONS_STAFF }),
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
    });
    await user.type(await screen.findByLabelText('Email'), 'ops@blynk.test');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await expectAdminOnly();
    expect(tokenStore.access).toBe('a');
  });

  it('password sign-in refuses packing staff and points them to the Inventory site', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/staff/login': () => ok({ access_token: 'a', refresh_token: 'r', user: STAFF }),
    });
    await user.type(await screen.findByLabelText('Email'), 'packer@blynk.test');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(WRONG_ROLE_MESSAGE).toMatch(/Inventory site/);
    expect(tokenStore.access).toBeNull();
  });

  it('OTP sign-in refuses a non-admin account and keeps no token', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: CUSTOMER }),
    });
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(
      await screen.findByText(WRONG_ROLE_MESSAGE)
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('OTP sign-in lets an operator in and classifies the session (ADMIN_PLUS_RIDER)', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_WITH_RIDER }),
      'GET /riders/deliveries': () => ok({ deliveries: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    await user.type(await screen.findByLabelText('Mobile number'), '0775551122');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Dev code: 123456')).toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await expectRiderCapable();
    expect(tokenStore.access).toBe('a');
  });

  it('OTP sign-in for an email-only account (Admin/Inventory) says to use email and password', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
      'POST /auth/otp/request': () =>
        fail(403, 'EMAIL_SIGN_IN_REQUIRED', 'This account signs in with email and password.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    await user.type(await screen.findByLabelText('Mobile number'), '0775551133');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account signs in with email and password.');
    // Back on the email + password form.
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/verify')).toHaveLength(0);
    expect(tokenStore.access).toBeNull();
  });

  it('OTP sign-in never creates an account: sends create_account false and explains ACCOUNT_NOT_FOUND', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => fail(404, 'ACCOUNT_NOT_FOUND', 'No Blynk account uses this number.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    await user.type(await screen.findByLabelText('Mobile number'), '0770000000');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByText('No Blynk account uses this number.')).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({ phone: '0770000000', otp: '123456', create_account: false });
    // Back on the phone step so the number can be checked.
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('OTP sign-in for an operator with no linked rider profile classifies ADMIN_ONLY', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '654321' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_NO_RIDER }),
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
    });
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    await user.type(await screen.findByLabelText('Mobile number'), '0775551133');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await expectAdminOnly();
  });

  // Staff email + password sign-in (backend migration 012) - the default method.
  it('password sign-in lets an operator in, sending the tidied email and the password as typed', async () => {
    const user = userEvent.setup();
    const api = renderAs(null, '/login', {
      'POST /auth/staff/login': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_WITH_RIDER }),
      'GET /riders/deliveries': () => ok({ deliveries: [] }),
    });
    const email = await screen.findByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    await user.type(email, ' owner@blynk.test ');
    await user.type(screen.getByLabelText('Password'), ' Blynk@1960');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await expectRiderCapable();
    expect(tokenStore.access).toBe('a');
    expect(api.api.find('POST', '/auth/staff/login')[0].body).toEqual({
      email: 'owner@blynk.test',
      password: ' Blynk@1960',
    });
  });

  it('the show/hide toggle reveals and hides the password', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login');
    const password = await screen.findByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('password sign-in refuses a non-admin account and keeps no token', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/staff/login': () => ok({ access_token: 'a', refresh_token: 'r', user: CUSTOMER }),
    });
    await user.type(await screen.findByLabelText('Email'), 'someone@blynk.test');
    await user.type(screen.getByLabelText('Password'), 'Blynk@1960');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText(WRONG_ROLE_MESSAGE)
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('a wrong password says so and clears the field', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/staff/login': () => fail(401, 'INVALID_CREDENTIALS', 'Wrong email or password.'),
    });
    await user.type(await screen.findByLabelText('Email'), 'owner@blynk.test');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('a locked account is told to wait', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/staff/login': () => fail(429, 'LOGIN_LOCKED', 'Too many wrong passwords.'),
    });
    await user.type(await screen.findByLabelText('Email'), 'owner@blynk.test');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 15 minutes.');
  });

  it('can switch to an SMS code and back to email and password', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login');
    await user.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Use email and password instead' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mobile number')).toBeNull();
  });

  it('session restore via GET /auth/me works and re-runs the rider probe', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    await expectRiderCapable();
  });

  it('shows the dev Skip button only when a dev operator phone is configured', async () => {
    // 2026-09-24: stub it EMPTY rather than relying on it being unset. Vite
    // loads `.env.local` in tests too, so once a developer configures
    // VITE_DEV_OPERATOR_PHONE to use Skip locally, this case silently inverted
    // and failed. Stubbing makes the test hermetic — it now asserts the
    // absence for the reason it claims to, not because of ambient config.
    vi.stubEnv('VITE_DEV_OPERATOR_PHONE', '');
    renderAs(null, '/login');
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).not.toBeInTheDocument();
  });

  it('dev Skip runs the normal OTP flow for the configured operator', async () => {
    vi.stubEnv('VITE_DEV_OPERATOR_PHONE', '0775551122');
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '999999' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_WITH_RIDER }),
      'GET /riders/deliveries': () => ok({ deliveries: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Skip sign-in' }));
    await expectRiderCapable();
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({ phone: '0775551122', otp: '999999', create_account: false });
  });

  it('opening the app with no signal keeps the session (tokens kept) and says so', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /auth/me': () => NETWORK_DOWN });
    expect(await screen.findByText(/Couldn't reach Blynk to resume your session/)).toBeInTheDocument();
    expect(tokenStore.access).toBe('test-access');
    expect(tokenStore.refresh).toBe('test-refresh');
  });

  it('a refused session on open still drops the tokens', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', {
      'GET /auth/me': () => fail(401, 'TOKEN_EXPIRED'),
      'POST /auth/refresh': () => fail(401, 'INVALID_REFRESH_TOKEN'),
    });
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});
