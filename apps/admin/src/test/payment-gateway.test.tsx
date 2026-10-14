import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ui';
import { PaymentGatewayCard } from '../components/PaymentGatewayCard';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call } from './mockApi';

/** Settings -> Online payments (PayHere), docs/api/payhere.md section 5. */

const SETTING = {
  provider: 'PAYHERE',
  enabled: false,
  mode: 'sandbox',
  merchant_id: '1211149',
  merchant_secret_set: true,
  merchant_secret_masked: '••••••••',
  merchant_secret_updated_at: '2026-10-14T08:00:00.000Z',
  allowed_methods: 'Visa, Mastercard, eZ Cash',
  payment_window_minutes: 20,
  encryption_key_configured: true,
  ready: true,
  checkout_url: 'https://sandbox.payhere.lk/pay/checkout',
  notify_url: 'https://api.blynk.lk/api/v1/payments/payhere/notify',
  return_url: 'https://blynk.lk/app/payment/return',
  cancel_url: 'https://blynk.lk/app/payment/cancel',
  can_edit_credentials: true,
  updated_at: '2026-10-14T08:00:00.000Z',
};
const PATH = '/admin/settings/payment-gateway';
const SECRET = 'super-secret-value-123';

function setup(overrides: Record<string, unknown> = {}, extra: (c: Call) => ReturnType<typeof ok> | undefined = () => undefined) {
  let state = { ...SETTING, ...overrides };
  const api = mockApi((c) => {
    if (c.path === PATH && c.method === 'GET') return ok(state);
    if (c.path === PATH && c.method === 'PATCH') {
      const handled = extra(c);
      if (handled) return handled;
      const { merchant_secret, ...rest } = c.body ?? {};
      state = {
        ...state,
        ...rest,
        ...(merchant_secret ? { merchant_secret_set: true, merchant_secret_updated_at: '2026-10-14T09:30:00.000Z' } : {}),
      };
      return ok(state);
    }
    return extra(c);
  });
  render(
    <ToastProvider>
      <PaymentGatewayCard />
    </ToastProvider>
  );
  return api;
}

describe('Online payments (PayHere) card', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows status, mode, masked secret and the PayHere URLs; never a secret value', async () => {
    setup();
    const status = await screen.findByTestId('payment-gateway-status');
    expect(within(status).getByText('Ready')).toBeInTheDocument();
    expect(within(status).getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText(/•••••••• saved, last updated/)).toBeInTheDocument();
    const secret = screen.getByPlaceholderText('Enter new secret to replace') as HTMLInputElement;
    expect(secret.value).toBe('');
    expect(secret.type).toBe('password');
    expect((screen.getByLabelText('Notify URL') as HTMLInputElement).value).toBe(SETTING.notify_url);
    expect((screen.getByLabelText('Return URL') as HTMLInputElement).value).toBe(SETTING.return_url);
    expect((screen.getByLabelText('Cancel URL') as HTMLInputElement).value).toBe(SETTING.cancel_url);
    expect((screen.getByLabelText('Checkout URL') as HTMLInputElement).value).toBe(SETTING.checkout_url);
    expect(screen.getByRole('button', { name: 'Copy Notify URL' })).toBeInTheDocument();
    expect(screen.getByText(/use this Notify URL/)).toBeInTheDocument();
    expect(screen.queryByText(/PAYMENT_SECRET_KEY/)).not.toBeInTheDocument();
  });

  it('does not send merchant_secret when the field is empty', async () => {
    const user = userEvent.setup();
    const api = setup();
    await screen.findByTestId('payment-gateway-status');
    await user.selectOptions(screen.getByLabelText('Mode'), 'live');
    await user.click(screen.getByRole('button', { name: 'Save credentials' }));
    await waitFor(() => expect(api.find('PATCH', PATH)).toHaveLength(1));
    const body = api.find('PATCH', PATH)[0]!.body;
    expect(body).toEqual({ mode: 'live', merchant_id: '1211149' });
    expect('merchant_secret' in body).toBe(false);
    expect(await within(screen.getByTestId('payment-gateway-status')).findByText('Live')).toBeInTheDocument();
  });

  it('sends a typed secret once, then clears the field and never shows it', async () => {
    const user = userEvent.setup();
    const api = setup({ merchant_secret_set: false, merchant_secret_masked: null, merchant_secret_updated_at: null, ready: false });
    await screen.findByText('No secret saved yet.');
    const field = screen.getByPlaceholderText('Enter new secret to replace') as HTMLInputElement;
    await user.type(field, SECRET);
    await user.click(screen.getByRole('button', { name: 'Save credentials' }));
    await waitFor(() => expect(api.find('PATCH', PATH)).toHaveLength(1));
    expect(api.find('PATCH', PATH)[0]!.body).toEqual({ mode: 'sandbox', merchant_id: '1211149', merchant_secret: SECRET });
    await waitFor(() => expect((screen.getByPlaceholderText('Enter new secret to replace') as HTMLInputElement).value).toBe(''));
    expect(await screen.findByText(/saved, last updated/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('refuses a too-short secret locally without calling the API', async () => {
    const user = userEvent.setup();
    const api = setup();
    await screen.findByTestId('payment-gateway-status');
    await user.type(screen.getByPlaceholderText('Enter new secret to replace'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save credentials' }));
    expect(await screen.findByText(/8 to 128 characters/)).toBeInTheDocument();
    expect(api.find('PATCH', PATH)).toHaveLength(0);
  });

  it('warns when the server has no PAYMENT_SECRET_KEY and shows the refusal in words', async () => {
    const user = userEvent.setup();
    setup({ encryption_key_configured: false, ready: false, merchant_secret_set: false }, (c) =>
      c.method === 'PATCH' ? fail(422, 'PAYHERE_NOT_CONFIGURED', 'not configured') : undefined
    );
    expect(await screen.findByText('Server is missing PAYMENT_SECRET_KEY - the secret cannot be saved')).toBeInTheDocument();
    expect(within(screen.getByTestId('payment-gateway-status')).getByText('Not configured')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Offer online payment at checkout' }));
    expect(await screen.findByText(/PayHere is not configured yet/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Offer online payment at checkout' })).toHaveAttribute('aria-checked', 'false');
  });

  it('turns online payments on at once and saves the checkout options', async () => {
    const user = userEvent.setup();
    const api = setup();
    const toggle = await screen.findByRole('switch', { name: 'Offer online payment at checkout' });
    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', PATH)).toHaveLength(1));
    expect(api.find('PATCH', PATH)[0]!.body).toEqual({ enabled: true });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    const minutes = screen.getByLabelText(/Payment window/);
    await user.clear(minutes);
    await user.type(minutes, '200');
    await user.click(screen.getByRole('button', { name: 'Save options' }));
    expect(await screen.findByText(/from 5 to 180/)).toBeInTheDocument();
    await user.clear(minutes);
    await user.type(minutes, '30');
    await user.click(screen.getByRole('button', { name: 'Save options' }));
    await waitFor(() => expect(api.find('PATCH', PATH)).toHaveLength(2));
    expect(api.find('PATCH', PATH)[1]!.body).toEqual({ payment_window_minutes: 30, allowed_methods: 'Visa, Mastercard, eZ Cash' });
  });

  it('renders credentials read-only when the account cannot edit them', async () => {
    setup({ can_edit_credentials: false });
    await screen.findByTestId('payment-gateway-status');
    expect(screen.getByText('Only an Admin can change the PayHere credentials.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save credentials' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter new secret to replace')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mode')).toBeDisabled();
  });

  it('generates a sample hash and shows its fields', async () => {
    const user = userEvent.setup();
    const api = setup({}, (c) =>
      c.method === 'POST' && c.path === `${PATH}/test-hash`
        ? ok({ merchant_id: '1211149', order_id: 'TEST-0001', amount: '1000.00', currency: 'LKR', hash: 'ABCDEF0123456789', mode: 'sandbox' })
        : undefined
    );
    await screen.findByTestId('payment-gateway-status');
    expect(screen.getByText(/No call is made to PayHere/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generate sample hash' }));
    const result = await screen.findByTestId('sample-hash');
    expect(within(result).getByText('TEST-0001')).toBeInTheDocument();
    expect(within(result).getByText('1000.00')).toBeInTheDocument();
    expect(within(result).getByText('LKR')).toBeInTheDocument();
    expect(within(result).getByText('ABCDEF0123456789')).toBeInTheDocument();
    expect(api.find('POST', `${PATH}/test-hash`)).toHaveLength(1);
  });
});
