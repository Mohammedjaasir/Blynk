import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, REQUEST_TIMEOUT_MS, apiRequest, tokenStore } from '../api/client';
import { TrackingStatus } from '../components/TrackingStatus';
import { deliveryCodeLockedUntil, errorMessage } from '../lib/errors';
import { stopTracking } from '../lib/tracker-session';
import { NETWORK_DOWN, RIDER, fail, ok, renderAs } from './helpers';

vi.mock('../lib/tracker-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tracker-session')>();
  return { ...actual, stopTracking: vi.fn(async () => undefined) };
});

afterEach(() => {
  tokenStore.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('opening the app without signal keeps the rider signed in', () => {
  it('a network failure on /auth/me shows an offline state, keeps the tokens, and retries', async () => {
    const user = userEvent.setup();
    let online = false;
    const { api } = renderAs(RIDER, '/', { 'GET /auth/me': () => (online ? ok(RIDER) : NETWORK_DOWN) });
    expect(await screen.findByText(/You're offline\. You're still signed in/)).toBeInTheDocument();
    expect(tokenStore.access).toBe('test-access');
    expect(tokenStore.refresh).toBe('test-refresh');
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();

    online = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
    expect(api.find('GET', '/auth/me')).toHaveLength(2);
  });

  it('a server error on /auth/me is not a sign-out either', async () => {
    renderAs(RIDER, '/', { 'GET /auth/me': () => fail(503, 'UNAVAILABLE', 'Down') });
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    expect(tokenStore.access).toBe('test-access');
  });

  it('a 401 whose refresh cannot reach the server keeps the session (offline), without ending it', async () => {
    renderAs(RIDER, '/', {
      'GET /auth/me': () => fail(401, 'UNAUTHORIZED', 'Expired'),
      'POST /auth/refresh': () => NETWORK_DOWN,
    });
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    expect(tokenStore.access).toBe('test-access');
    expect(tokenStore.refresh).toBe('test-refresh');
    expect(screen.queryByText('Your session has ended. Please sign in again.')).not.toBeInTheDocument();
  });

  it('a 401 whose refresh is refused ends the session', async () => {
    renderAs(RIDER, '/', {
      'GET /auth/me': () => fail(401, 'UNAUTHORIZED', 'Expired'),
      'POST /auth/refresh': () => fail(401, 'INVALID_REFRESH_TOKEN', 'Refused'),
    });
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it('a 401 with a successful refresh carries on with the new token', async () => {
    let calls = 0;
    renderAs(RIDER, '/', {
      'GET /auth/me': () => (++calls === 1 ? fail(401, 'UNAUTHORIZED', 'Expired') : ok(RIDER)),
      'POST /auth/refresh': () => ok({ access_token: 'new-access', refresh_token: 'new-refresh' }),
    });
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
    expect(tokenStore.access).toBe('new-access');
  });
});

describe('token refresh during use', () => {
  it('a refresh that fails on the network keeps the tokens and reports NETWORK', async () => {
    tokenStore.save('old-access', 'old-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
        return { ok: false, status: 401, text: async () => '{"error":{"code":"UNAUTHORIZED","message":"x"}}' } as Response;
      })
    );
    await expect(apiRequest('/riders/deliveries')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
    expect(tokenStore.access).toBe('old-access');
    expect(tokenStore.refresh).toBe('old-refresh');
  });

  it('a refresh answered with a 5xx keeps the tokens too', async () => {
    tokenStore.save('old-access', 'old-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) return { ok: false, status: 502, text: async () => '' } as Response;
        return { ok: false, status: 401, text: async () => '{}' } as Response;
      })
    );
    await expect(apiRequest('/riders/deliveries')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(tokenStore.refresh).toBe('old-refresh');
  });
});

describe('request timeout (CapacitorHttp ignores AbortSignal on Android)', () => {
  it('settles with TIMEOUT even when fetch never settles and ignores the abort', async () => {
    vi.useFakeTimers();
    // A transport that neither answers nor honours the signal - like native HTTP.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const pending = apiRequest('/riders/deliveries/d-1/status', { method: 'PATCH', body: { status: 'PICKED_UP' } });
    const settled = pending.then(
      () => 'resolved',
      (err: unknown) => err
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    const err = await settled;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('TIMEOUT');
    expect(errorMessage(err)).toBe("The server didn't answer. Check the delivery before trying again.");
  });
});

describe('staff SMS sign-in never creates an account', () => {
  it('sends create_account: false and explains ACCOUNT_NOT_FOUND', async () => {
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
    expect(await screen.findByRole('alert')).toHaveTextContent('No Blynk account uses this number.');
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({
      phone: '0770000000',
      otp: '123456',
      create_account: false,
    });
    // Back to the number: another code for the same number can't help.
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });
});

describe('delivery-code lock timing', () => {
  const NOW = Date.parse('2026-10-06T10:00:00Z');

  it('prefers retry_after_seconds', () => {
    const err = new ApiError('Locked', 429, 'DELIVERY_CODE_LOCKED', { retry_after_seconds: 600, locked_until: '2026-10-06T12:00:00Z' });
    expect(deliveryCodeLockedUntil(err, NOW)).toBe(NOW + 600_000);
  });

  it('without it, measures locked_until against the server Date header, not the phone clock', () => {
    // The phone is 5 minutes fast; the server says the lock lifts 10 minutes after its own now.
    const serverNow = NOW - 5 * 60_000;
    const err = new ApiError(
      'Locked',
      422,
      'WRONG_DELIVERY_CODE',
      { attempts_remaining: 0, locked_until: new Date(serverNow + 10 * 60_000).toISOString() },
      serverNow
    );
    expect(deliveryCodeLockedUntil(err, NOW)).toBe(NOW + 10 * 60_000);
  });

  it('with no Date header, keeps using locked_until as given', () => {
    const until = '2026-10-06T10:07:00Z';
    const err = new ApiError('Locked', 429, 'DELIVERY_CODE_LOCKED', { locked_until: until });
    expect(deliveryCodeLockedUntil(err, NOW)).toBe(Date.parse(until));
  });

  it('the client reads the Date header from the reply', async () => {
    const date = 'Tue, 06 Oct 2026 10:00:00 GMT';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 429,
            headers: new Headers({ Date: date }),
            text: async () => '{"error":{"code":"DELIVERY_CODE_LOCKED","message":"Locked"}}',
          }) as Response
      )
    );
    await expect(apiRequest('/riders/deliveries/d-1/collect-cod', { method: 'POST', body: {} })).rejects.toMatchObject({
      serverDate: Date.parse(date),
    });
  });
});

describe('TrackingStatus: a refusal says why sharing stopped', () => {
  it('shows the reason instead of "retrying"', () => {
    render(
      <TrackingStatus
        state={{
          permission: 'granted',
          active: false,
          lastSentAt: new Date(),
          lastError: 'refused',
          stopReason: "Your rider profile isn't active, so your location can't be shared. Contact the store.",
        }}
      />
    );
    const line = screen.getByText(/Stopped sharing your location\./);
    expect(line).toHaveTextContent("Your rider profile isn't active");
    expect(line).toHaveClass('tracking-status--error');
    expect(screen.queryByText(/retrying/)).not.toBeInTheDocument();
  });
});

describe('a session the server ends also stops location sharing', () => {
  it('stops the tracker when the API ends the session', async () => {
    const spy = vi.mocked(stopTracking);
    spy.mockClear();
    renderAs(RIDER, '/', { 'GET /riders/deliveries': () => fail(403, 'RIDER_INACTIVE') });
    expect(await screen.findByText("Your rider profile isn't active. Contact the store.")).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
