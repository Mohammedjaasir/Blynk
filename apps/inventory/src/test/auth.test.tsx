import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import { can, type Action } from '../auth/can';
import { OPERATIONS_STAFF_MESSAGE, SESSION_ENDED_MESSAGE, WRONG_ROLE_MESSAGE } from '../auth/AuthContext';
import { ADMIN, STAFF, fail, ok, renderAs } from './helpers';

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  tokenStore.clear();
});

async function signIn(phone: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
  await userEvent.type(await screen.findByLabelText(/Mobile number/), phone);
  await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
  await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
}

const otpHandlers = (user: unknown) => ({
  'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
  'POST /auth/otp/verify': () => ok({ access_token: 'acc', refresh_token: 'ref', user }),
});

describe('sign-in over the existing Blynk OTP flow', () => {
  it('signs in an ADMIN and opens the Overview', async () => {
    renderAs(null, '/login', otpHandlers(ADMIN));
    await signIn('0775551122');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(tokenStore.access).toBe('acc');
  });

  it('signs in PACKING_STAFF', async () => {
    renderAs(null, '/login', otpHandlers(STAFF));
    await signIn('0774443322');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it.each([
    ['CUSTOMER', { ...ADMIN, id: 'c1', role: 'CUSTOMER' }],
    ['RIDER', { ...ADMIN, id: 'r1', role: 'RIDER' }],
  ])('refuses a %s account, keeps no session and returns to the phone step', async (_role, user) => {
    renderAs(null, '/login', otpHandlers(user));
    await signIn('0771234567');
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument();
  });

  // Backend migration 014: Operations staff open only the Operations app.
  it('refuses an OPERATIONS account over SMS code and points it to the Operations app', async () => {
    renderAs(null, '/login', otpHandlers({ ...ADMIN, id: 'o1', role: 'OPERATIONS' }));
    await signIn('0771112233');
    expect(await screen.findByText(OPERATIONS_STAFF_MESSAGE)).toBeInTheDocument();
    expect(OPERATIONS_STAFF_MESSAGE).toMatch(/Operations app/);
    expect(tokenStore.access).toBeNull();
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument();
  });

  it('shows the API message for a wrong code instead of a technical error', async () => {
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => fail(401, 'INVALID_OTP', 'Invalid OTP code. 2 attempt(s) remaining.'),
    });
    await signIn('0775551122');
    expect(await screen.findByText('Invalid OTP code. 2 attempt(s) remaining.')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign-in', async () => {
    renderAs(null, '/stock');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('returns to sign-in with a notice when the session cannot be refreshed', async () => {
    renderAs(ADMIN, '/stock', {
      'GET /admin/inventory': () => fail(401, 'UNAUTHORIZED', 'Token expired'),
      'POST /auth/refresh': () => fail(401, 'REFRESH_TOKEN_REVOKED', 'revoked'),
    });
    expect(await screen.findByText(SESSION_ENDED_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('drops a stored OPERATIONS session with a pointer to the Operations app', async () => {
    renderAs({ ...ADMIN, role: 'OPERATIONS' }, '/');
    expect(await screen.findByText(OPERATIONS_STAFF_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('drops a stored session whose account is not an inventory role', async () => {
    renderAs({ ...ADMIN, role: 'CUSTOMER' }, '/');
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

describe('email + password sign-in (backend migration 012)', () => {
  const tokens = (user: unknown) => ok({ access_token: 'acc', refresh_token: 'ref', user });

  async function signInWithPassword(email: string, password: string) {
    await userEvent.type(await screen.findByLabelText('Email'), email);
    await userEvent.type(screen.getByLabelText('Password'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('is the default method and signs PACKING_STAFF in with exactly the email and password', async () => {
    const { api } = renderAs(null, '/login', { 'POST /auth/staff/login': () => tokens(STAFF) });
    expect(await screen.findByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    await signInWithPassword('packer@blynk.test', 'Packing-2026');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(tokenStore.access).toBe('acc');
    expect(api.find('POST', '/auth/staff/login')[0].body).toEqual({
      email: 'packer@blynk.test',
      password: 'Packing-2026',
    });
  });

  it('the show/hide toggle reveals and hides the password', async () => {
    renderAs(null, '/login');
    const password = await screen.findByLabelText('Password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('refuses a RIDER account and keeps no session', async () => {
    renderAs(null, '/login', { 'POST /auth/staff/login': () => tokens({ ...ADMIN, id: 'r1', role: 'RIDER' }) });
    await signInWithPassword('rider@blynk.test', 'Blynk@1960');
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('refuses an OPERATIONS account by password and points it to the Operations app', async () => {
    renderAs(null, '/login', { 'POST /auth/staff/login': () => tokens({ ...ADMIN, id: 'o1', role: 'OPERATIONS' }) });
    await signInWithPassword('ops@blynk.test', 'Correct-horse-1');
    expect(await screen.findByText(OPERATIONS_STAFF_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('a wrong password says so and clears the field', async () => {
    renderAs(null, '/login', {
      'POST /auth/staff/login': () => fail(401, 'INVALID_CREDENTIALS', 'Wrong email or password.'),
    });
    await signInWithPassword('owner@blynk.test', 'not-the-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('a locked account is told to wait', async () => {
    renderAs(null, '/login', { 'POST /auth/staff/login': () => fail(429, 'LOGIN_LOCKED', 'Too many wrong passwords.') });
    await signInWithPassword('owner@blynk.test', 'not-the-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 15 minutes.');
  });

  it('can switch to an SMS code and back', async () => {
    renderAs(null, '/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Use an SMS code instead' }));
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use email and password instead' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('no development shortcut', () => {
  // 2026-09-29, owner's request: the "Skip sign-in" dev button is gone.
  it('never offers "Skip sign-in"', async () => {
    renderAs(null, '/login');
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).toBeNull();
    expect(screen.queryByText('Dev')).toBeNull();
  });
});

describe('application scope', () => {
  it('navigation is exactly the Inventory application', async () => {
    renderAs(ADMIN, '/');
    const nav = await screen.findByRole('navigation', { name: 'Inventory' });
    const links = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Overview', 'Inventory', 'Running low', 'Ledger', 'Sourcing queue', 'Suppliers']);
    const shell = document.body.textContent ?? '';
    for (const word of ['Products', 'Categories', 'Promotions', 'Riders', 'Customers', 'Deliver']) {
      expect(within(nav).queryByText(new RegExp(word, 'i'))).toBeNull();
    }
    expect(shell).not.toMatch(/promotion/i);
  });
});

describe('role permissions mirror the backend guards', () => {
  const adminOnly: Action[] = ['changeTrackingMode', 'editThreshold', 'manageSuppliers'];
  // Owner decision: packing staff also receive stock and pack orders.
  const both: Action[] = [
    'viewStock',
    'viewLedger',
    'viewSourcing',
    'viewSuppliers',
    'source',
    'markUnavailable',
    'markPacked',
    'adjustStock',
  ];

  it('ADMIN can do everything', () => {
    for (const action of [...adminOnly, ...both]) expect(can('ADMIN', action)).toBe(true);
  });
  it('PACKING_STAFF can read, source, pack and adjust stock, but not change tracking, thresholds or suppliers', () => {
    for (const action of both) expect(can('PACKING_STAFF', action)).toBe(true);
    for (const action of adminOnly) expect(can('PACKING_STAFF', action)).toBe(false);
  });
  it('CUSTOMER, RIDER and OPERATIONS can do nothing', () => {
    for (const action of [...adminOnly, ...both]) {
      expect(can('CUSTOMER', action)).toBe(false);
      expect(can('RIDER', action)).toBe(false);
      expect(can('OPERATIONS', action)).toBe(false);
    }
  });
});

describe('SMS sign-in never creates an account, and refused sessions are revoked', () => {
  it('asks the API not to create an account for an unknown number', async () => {
    const { api } = renderAs(null, '/login', otpHandlers(ADMIN));
    await signIn('0775551122');
    await screen.findByRole('heading', { name: 'Overview' });
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({
      phone: '0775551122',
      otp: '123456',
      create_account: false,
    });
  });

  it('says so when no Blynk account uses the number (404 ACCOUNT_NOT_FOUND)', async () => {
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => fail(404, 'ACCOUNT_NOT_FOUND', 'Account not found.'),
    });
    await signIn('0770000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('No Blynk account uses this number.');
    expect(tokenStore.access).toBeNull();
  });

  it('revokes the just-issued session when an SMS sign-in is refused for its role', async () => {
    const { api } = renderAs(null, '/login', {
      ...otpHandlers({ ...ADMIN, id: 'r1', role: 'RIDER' }),
      'POST /auth/logout': () => ok({ message: 'Logged out successfully' }),
    });
    await signIn('0771234567');
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    const logout = api.find('POST', '/auth/logout');
    expect(logout).toHaveLength(1);
    expect(logout[0].body).toEqual({ refresh_token: 'ref' });
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it('revokes the session when a password sign-in is refused for its role', async () => {
    const { api } = renderAs(null, '/login', {
      'POST /auth/staff/login': () => ok({ access_token: 'acc', refresh_token: 'ref-ops', user: { ...ADMIN, role: 'OPERATIONS' } }),
      'POST /auth/logout': () => ok({ message: 'Logged out successfully' }),
    });
    await userEvent.type(await screen.findByLabelText('Email'), 'ops@blynk.test');
    await userEvent.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(OPERATIONS_STAFF_MESSAGE)).toBeInTheDocument();
    expect(api.find('POST', '/auth/logout')[0]?.body).toEqual({ refresh_token: 'ref-ops' });
  });

  it('still refuses the role when the revocation call fails', async () => {
    renderAs(null, '/login', {
      ...otpHandlers({ ...ADMIN, id: 'c1', role: 'CUSTOMER' }),
      'POST /auth/logout': () => fail(500, 'INTERNAL', 'boom'),
    });
    await signIn('0771234567');
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('revokes a stored session whose account is not an inventory role', async () => {
    const { api } = renderAs({ ...ADMIN, role: 'CUSTOMER' }, '/', {
      'POST /auth/logout': () => ok({ message: 'Logged out successfully' }),
    });
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(api.find('POST', '/auth/logout')[0]?.body).toEqual({ refresh_token: 'test-refresh' });
  });
});
