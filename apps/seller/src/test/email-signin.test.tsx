import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import { passwordStrength } from '../pages/SignIn';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';
import { renderApp, seller, worldHandler } from './fixtures';

const EMAIL_USER = { id: 'u2', phone: null, full_name: null, email: 'nimal@example.com', role: 'SELLER' };
const TOKENS = {
  access_token: 'email-access',
  refresh_token: 'email-refresh',
  token_type: 'Bearer',
  expires_in: 900,
  user: EMAIL_USER,
};

/** The fake API with the two email routes answered by `reply`, and /auth/me as the email seller. */
function emailWorld(reply: (call: Call) => Reply | undefined) {
  const world = worldHandler({ seller: seller({ shop_name: 'Nimal Farm' }) });
  return mockApi((call) => {
    if (call.path === '/auth/seller/login-email' || call.path === '/auth/seller/register-email') return reply(call);
    if (call.path === '/auth/me') return ok(EMAIL_USER);
    return world(call);
  });
}

async function openEmailTab() {
  await userEvent.click(await screen.findByRole('tab', { name: /email/i }));
}

async function openCreateAccount() {
  await openEmailTab();
  await userEvent.click(screen.getByRole('tab', { name: /create account/i }));
}

async function signInWithEmail(email = 'nimal@example.com', password = 'secret-pass-1') {
  await userEvent.type(screen.getByLabelText(/email address/i), email);
  await userEvent.type(screen.getByLabelText(/^password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

async function fillCreateAccount(email = 'new@example.com', password = 'Kithul-2026!', shop = 'Nimal Farm') {
  if (email) await userEvent.type(screen.getByLabelText(/email address/i), email);
  if (password) await userEvent.type(screen.getByLabelText(/^password/i), password);
  if (shop) await userEvent.type(screen.getByLabelText(/^shop name/i), shop);
  await userEvent.click(screen.getByRole('button', { name: /create my account/i }));
}

describe('sign-in tabs', () => {
  it('offers Phone and Email, starting on Phone, and keeps what was typed when switching back', async () => {
    mockApi(() => undefined);
    renderApp('/products');

    const phoneTab = await screen.findByRole('tab', { name: /phone/i });
    const emailTab = screen.getByRole('tab', { name: /email/i });
    expect(phoneTab).toHaveAttribute('aria-selected', 'true');
    expect(emailTab).toHaveAttribute('aria-selected', 'false');
    await userEvent.type(screen.getByLabelText(/your mobile number/i), '0771234567');

    await userEvent.click(emailTab);
    expect(emailTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/email address/i)).toBeVisible();
    expect(screen.getByLabelText(/your mobile number/i)).not.toBeVisible();

    await userEvent.click(phoneTab);
    expect(screen.getByLabelText(/your mobile number/i)).toBeVisible();
    expect(screen.getByLabelText(/your mobile number/i)).toHaveValue('0771234567');
  });

  it('moves between the tabs with the arrow keys', async () => {
    mockApi(() => undefined);
    renderApp('/products');
    const phoneTab = await screen.findByRole('tab', { name: /phone/i });
    phoneTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /email/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /email/i })).toHaveFocus();
  });
});

describe('email sign-in', () => {
  it('signs in with an email and password and stores the session like the phone sign-in', async () => {
    const api = emailWorld(() => ok(TOKENS));
    renderApp('/products');
    await openEmailTab();
    await signInWithEmail();

    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
    expect(api.find('POST', '/auth/seller/login-email')[0]!.body).toEqual({
      email: 'nimal@example.com',
      password: 'secret-pass-1',
    });
    expect(tokenStore.access).toBe('email-access');
    expect(tokenStore.refresh).toBe('email-refresh');
  });

  it('checks the email and password before asking the server', async () => {
    const api = emailWorld(() => ok(TOKENS));
    renderApp('/products');
    await openEmailTab();
    await userEvent.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/enter your email address, like name@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(api.find('POST', '/auth/seller/login-email')).toHaveLength(0);
  });

  it('says "Wrong email or password." for INVALID_CREDENTIALS and keeps the seller signed out', async () => {
    emailWorld(() => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password'));
    renderApp('/products');
    await openEmailTab();
    await signInWithEmail();
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(tokenStore.access).toBeNull();
  });

  it('says how long to wait when the account is locked after too many wrong passwords (LOGIN_LOCKED)', async () => {
    emailWorld(() => fail(429, 'LOGIN_LOCKED', 'Too many failed attempts', { retry_after_minutes: 15 }));
    renderApp('/products');
    await openEmailTab();
    await signInWithEmail();
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong tries - try again in 15 minutes.');
  });

  it('asks the seller to wait a little when too many requests come from one place (TOO_MANY_REQUESTS)', async () => {
    emailWorld(() => fail(429, 'TOO_MANY_REQUESTS', 'Too many requests'));
    renderApp('/products');
    await openEmailTab();
    await signInWithEmail();
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many tries - wait a few minutes/i);
  });

  it('says a switched-off account must contact Blynk (ACCOUNT_DEACTIVATED)', async () => {
    emailWorld(() => fail(403, 'ACCOUNT_DEACTIVATED', 'Account deactivated'));
    renderApp('/products');
    await openEmailTab();
    await signInWithEmail();
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is switched off - contact Blynk.');
  });

  it('refuses an email account that is not a seller', async () => {
    emailWorld(() => ok({ ...TOKENS, user: { ...EMAIL_USER, role: 'CUSTOMER' } }));
    renderApp('/products');
    await openEmailTab();
    await signInWithEmail();
    expect(await screen.findByRole('alert')).toHaveTextContent(/this email is not a blynk seller account/i);
    expect(tokenStore.access).toBeNull();
  });

  it('shows and hides the password', async () => {
    mockApi(() => undefined);
    renderApp('/products');
    await openEmailTab();
    const password = screen.getByLabelText(/^password/i);
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('explains what to do about a forgotten password, and can switch to the phone sign-in', async () => {
    mockApi(() => undefined);
    renderApp('/products');
    await openEmailTab();
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(
      screen.getByText('Sign in with your phone number instead, or ask Blynk to reset it.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /use my phone number/i }));
    expect(screen.getByRole('tab', { name: /phone/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/your mobile number/i)).toBeVisible();
  });
});

describe('email create account', () => {
  it('creates the account (201) with email, password and shop name, then shows the shop', async () => {
    const api = emailWorld((call) => (call.path === '/auth/seller/register-email' ? { status: 201, data: TOKENS } : undefined));
    renderApp('/products');
    await openCreateAccount();
    expect(screen.getByRole('heading', { name: /create your blynk sellers account/i })).toBeInTheDocument();
    await fillCreateAccount();

    expect(await screen.findByRole('heading', { name: /my products/i })).toBeInTheDocument();
    expect(api.find('POST', '/auth/seller/register-email')[0]!.body).toEqual({
      email: 'new@example.com',
      password: 'Kithul-2026!',
      shop_name: 'Nimal Farm',
    });
    expect(tokenStore.access).toBe('email-access');
  });

  it('needs a real email, 8 to 128 characters of password and a shop name', async () => {
    const api = emailWorld(() => ok(TOKENS));
    renderApp('/products');
    await openCreateAccount();
    await fillCreateAccount('nope', 'short', '');
    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/use 8 to 128 characters for your password/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your shop name \(2 to 80 letters\)/i)).toBeInTheDocument();
    expect(api.find('POST', '/auth/seller/register-email')).toHaveLength(0);
  });

  it('gives a strength hint while the new password is typed', async () => {
    mockApi(() => undefined);
    renderApp('/products');
    await openCreateAccount();
    const password = screen.getByLabelText(/^password/i);
    await userEvent.type(password, 'abc');
    expect(screen.getByText(/too short - use at least 8 characters/i)).toBeInTheDocument();
    await userEvent.type(password, 'Def-12345');
    expect(screen.getByText('Strong password.')).toBeInTheDocument();
  });

  it('says the email already has an account (EMAIL_IN_USE) and offers to sign in instead', async () => {
    emailWorld(() => fail(409, 'EMAIL_IN_USE', 'Email already registered'));
    renderApp('/products');
    await openCreateAccount();
    await fillCreateAccount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This email already has an account - sign in instead.');

    await userEvent.click(within(alert).getByRole('button', { name: /sign in instead/i }));
    expect(screen.getByRole('tab', { name: /^sign in$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('new@example.com');
    expect(screen.queryByLabelText(/^shop name/i)).not.toBeInTheDocument();
  });

  it('puts the server field messages next to their boxes (VALIDATION_ERROR)', async () => {
    emailWorld(() =>
      fail(400, 'VALIDATION_ERROR', 'Validation failed', [
        { field: 'password', message: 'Password is too common.' },
        { field: 'shop_name', message: 'Shop name has odd characters.' },
      ])
    );
    renderApp('/products');
    await openCreateAccount();
    await fillCreateAccount();
    expect(await screen.findByText('Password is too common.')).toBeInTheDocument();
    expect(screen.getByText('Shop name has odd characters.')).toBeInTheDocument();
    expect(screen.getByText(/please fix the highlighted boxes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('an email-only seller', () => {
  it('sees the email where the phone number would be', async () => {
    tokenStore.save('access-token', 'refresh-token');
    emailWorld(() => undefined);
    renderApp('/shop');
    expect(await screen.findByText(/signed in with nimal@example.com/i)).toBeInTheDocument();
  });
});

describe('passwordStrength', () => {
  it('rates passwords in plain words', () => {
    expect(passwordStrength('')).toBeNull();
    expect(passwordStrength('abc')!.level).toBe(0);
    expect(passwordStrength('abcdefgh')!.level).toBe(1);
    expect(passwordStrength('abcdefghij')!.level).toBe(2);
    expect(passwordStrength('Abcdefgh-123')!.level).toBe(3);
    expect(passwordStrength('x'.repeat(129))!.label).toMatch(/too long/i);
  });
});
