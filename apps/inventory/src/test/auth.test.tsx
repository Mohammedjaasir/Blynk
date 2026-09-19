import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import { can, type Action } from '../auth/can';
import { SESSION_ENDED_MESSAGE, WRONG_ROLE_MESSAGE } from '../auth/AuthContext';
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

  it('drops a stored session whose account is not an inventory role', async () => {
    renderAs({ ...ADMIN, role: 'CUSTOMER' }, '/');
    expect(await screen.findByText(WRONG_ROLE_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

describe('development skip sign-in', () => {
  it('is not offered without VITE_DEV_INVENTORY_PHONE', async () => {
    vi.stubEnv('VITE_DEV_INVENTORY_PHONE', '');
    renderAs(null, '/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).toBeNull();
  });

  it('runs the normal OTP flow with the dev code', async () => {
    vi.stubEnv('VITE_DEV_INVENTORY_PHONE', '0774443322');
    const { api } = renderAs(null, '/login', otpHandlers(STAFF));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip sign-in' }));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({ phone: '0774443322', otp: '123456' });
  });

  it('refuses when the API gives no dev code (production API)', async () => {
    vi.stubEnv('VITE_DEV_INVENTORY_PHONE', '0774443322');
    renderAs(null, '/login', { 'POST /auth/otp/request': () => ok({}) });
    await userEvent.click(await screen.findByRole('button', { name: 'Skip sign-in' }));
    expect(await screen.findByText('Skip only works against a development API.')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

describe('application scope', () => {
  it('navigation is exactly the Inventory application', async () => {
    renderAs(ADMIN, '/');
    const nav = await screen.findByRole('navigation', { name: 'Inventory' });
    const links = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Overview', 'Inventory', 'Ledger', 'Sourcing queue', 'Suppliers']);
    const shell = document.body.textContent ?? '';
    for (const word of ['Products', 'Categories', 'Promotions', 'Riders', 'Customers', 'Deliver']) {
      expect(within(nav).queryByText(new RegExp(word, 'i'))).toBeNull();
    }
    expect(shell).not.toMatch(/promotion/i);
  });
});

describe('role permissions mirror the backend guards', () => {
  const adminOnly: Action[] = ['adjustStock', 'changeTrackingMode', 'manageSuppliers'];
  const both: Action[] = ['viewStock', 'viewLedger', 'viewSourcing', 'viewSuppliers', 'source', 'markUnavailable'];

  it('ADMIN can do everything', () => {
    for (const action of [...adminOnly, ...both]) expect(can('ADMIN', action)).toBe(true);
  });
  it('PACKING_STAFF can read and source but not adjust, change tracking or manage suppliers', () => {
    for (const action of both) expect(can('PACKING_STAFF', action)).toBe(true);
    for (const action of adminOnly) expect(can('PACKING_STAFF', action)).toBe(false);
  });
  it('CUSTOMER and RIDER can do nothing', () => {
    for (const action of [...adminOnly, ...both]) {
      expect(can('CUSTOMER', action)).toBe(false);
      expect(can('RIDER', action)).toBe(false);
    }
  });
});
