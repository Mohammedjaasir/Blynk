import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, onSessionEnded, refreshSession, tokenStore } from '../api/client';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

describe('tokenStore', () => {
  it('round-trips access and refresh tokens', () => {
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
    tokenStore.save('a1', 'r1');
    expect(tokenStore.access).toBe('a1');
    expect(tokenStore.refresh).toBe('r1');
    tokenStore.clear();
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it('keeps the existing refresh token when a save omits one', () => {
    tokenStore.save('a1', 'r1');
    tokenStore.save('a2');
    expect(tokenStore.access).toBe('a2');
    expect(tokenStore.refresh).toBe('r1');
  });
});

describe('apiRequest', () => {
  it('attaches the bearer token only when auth is not opted out', async () => {
    tokenStore.save('a1', 'r1');
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { success: true, data: { ok: true } })
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/me');
    const authedInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect((authedInit.headers as Record<string, string>).Authorization).toBe('Bearer a1');

    await apiRequest('/auth/otp/request', { method: 'POST', body: { phone: 'x' }, auth: false });
    const anonInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((anonInit.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('builds a query string, dropping undefined/null/empty values', async () => {
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { success: true, data: {} })
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/admin/orders', {
      query: { status: 'PLACED,PACKED', limit: 100, since: undefined, note: '' },
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe('http://localhost:4000/api/v1/admin/orders?status=PLACED%2CPACKED&limit=100');
  });

  it('unwraps the data envelope on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { success: true, data: { id: '1' } }))
    );
    await expect(apiRequest('/auth/me')).resolves.toEqual({ id: '1' });
  });

  it('throws an ApiError carrying the message/status/code/details shape on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(422, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Bad input', details: { field: 'x' } },
        })
      )
    );
    await expect(apiRequest('/admin/orders')).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Bad input',
      details: { field: 'x' },
    });
  });

  it('wraps a dropped connection as a NETWORK ApiError, never a raw exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('refreshes once, sharing the refresh across concurrent 401s, and retries each original request', async () => {
    tokenStore.save('stale', 'r1');
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(200, { success: true, data: { access_token: 'fresh', refresh_token: 'r2' } });
      }
      if (authHeader === 'Bearer stale') {
        return jsonResponse(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
      }
      return jsonResponse(200, { success: true, data: { auth: authHeader } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([apiRequest('/admin/orders'), apiRequest('/admin/riders')]);

    expect(refreshCalls).toBe(1);
    expect(a).toEqual({ auth: 'Bearer fresh' });
    expect(b).toEqual({ auth: 'Bearer fresh' });
    expect(tokenStore.access).toBe('fresh');
  });

  it('ends the session and notifies listeners when the refresh token is refused', async () => {
    tokenStore.save('stale', 'r1');
    const heard: string[] = [];
    const unsubscribe = onSessionEnded((reason) => heard.push(reason));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) {
          return jsonResponse(401, { success: false, error: { code: 'REFRESH_INVALID', message: 'no' } });
        }
        return jsonResponse(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
      })
    );

    await expect(apiRequest('/admin/orders')).rejects.toMatchObject({ status: 401 });
    expect(heard).toEqual(['expired']);
    expect(tokenStore.access).toBeNull();
    unsubscribe();
  });

  it('does NOT end the session on a rider-profile refusal - only Delivery capability is affected, not the whole ADMIN session', async () => {
    tokenStore.save('a1', 'r1');
    const heard: string[] = [];
    const unsubscribe = onSessionEnded((reason) => heard.push(reason));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(403, { success: false, error: { code: 'RIDER_PROFILE_NOT_FOUND', message: 'no rider profile' } })
      )
    );

    await expect(apiRequest('/riders/deliveries')).rejects.toMatchObject({
      status: 403,
      code: 'RIDER_PROFILE_NOT_FOUND',
    });
    expect(heard).toEqual([]);
    expect(tokenStore.access).toBe('a1');
    unsubscribe();
  });
});

describe('refresh failures (a weak connection is not a sign-out)', () => {
  function stubWithRefresh(refresh: () => Response | Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/auth/refresh')) return refresh();
        return jsonResponse(401, { success: false, error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
      })
    );
  }

  it('keeps the tokens and throws a retryable NETWORK error when the refresh cannot reach the server', async () => {
    tokenStore.save('stale', 'r1');
    const heard: string[] = [];
    const unsubscribe = onSessionEnded((reason) => heard.push(reason));
    stubWithRefresh(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(apiRequest('/admin/orders')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
    expect(heard).toEqual([]);
    expect(tokenStore.access).toBe('stale');
    expect(tokenStore.refresh).toBe('r1');
    unsubscribe();
  });

  it.each([500, 502, 503, 429])('keeps the tokens when the refresh answers %i', async (status) => {
    tokenStore.save('stale', 'r1');
    const heard: string[] = [];
    const unsubscribe = onSessionEnded((reason) => heard.push(reason));
    stubWithRefresh(() => jsonResponse(status, { success: false, error: { code: 'X', message: 'x' } }));
    await expect(apiRequest('/admin/orders')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
    expect(heard).toEqual([]);
    expect(tokenStore.refresh).toBe('r1');
    unsubscribe();
  });

  it.each([
    [400, 'INVALID_REFRESH_TOKEN'],
    [401, 'INVALID_REFRESH_TOKEN'],
  ])('signs out when the server refuses the refresh token (%i %s)', async (status, code) => {
    tokenStore.save('stale', 'r1');
    const heard: string[] = [];
    const unsubscribe = onSessionEnded((reason) => heard.push(reason));
    stubWithRefresh(() => jsonResponse(status, { success: false, error: { code, message: 'no' } }));
    await expect(apiRequest('/admin/orders')).rejects.toMatchObject({ status: 401 });
    expect(heard).toEqual(['expired']);
    expect(tokenStore.refresh).toBeNull();
    unsubscribe();
  });

  it('refreshSession reports the outcome', async () => {
    tokenStore.save('stale', 'r1');
    const failing = async () => {
      throw new ApiError('The Blynk API did not answer in time.', 0, 'TIMEOUT');
    };
    await expect(refreshSession(failing)).resolves.toBe('timeout');
    expect(tokenStore.refresh).toBe('r1');
    await expect(refreshSession(async () => ({ status: 401, text: '{}' }))).resolves.toBe('refused');
    expect(tokenStore.refresh).toBeNull();
  });
});
