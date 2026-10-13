import { afterEach, expect, test, vi } from 'vitest';
import { apiRequest, ApiError, API_BASE_URL } from './client';

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
}

afterEach(() => vi.restoreAllMocks());

test('defaults to the local API', () => {
  expect(API_BASE_URL).toBe(process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000/api/v1');
});

test('returns data from the success envelope, with GET only', async () => {
  const f = mockFetch(200, { success: true, data: { products: [] } });
  await expect(apiRequest('/catalog/products')).resolves.toEqual({ products: [] });
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/catalog/products`, expect.objectContaining({ method: 'GET' }));
  expect(f.mock.calls[0][1]).not.toHaveProperty('body');
});

test('throws ApiError with the server code and message', async () => {
  mockFetch(422, { success: false, error: { code: 'DELIVERY_OUTSIDE_RADIUS', message: 'Too far', details: { distance_km: 5 } } });
  await expect(apiRequest('/x')).rejects.toMatchObject({ status: 422, code: 'DELIVERY_OUTSIDE_RADIUS', message: 'Too far' });
});

test('maps a network failure to NETWORK_ERROR', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  const err = (await apiRequest('/x').catch((e) => e)) as ApiError;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBe('NETWORK_ERROR');
});

test('a 5xx never leaks server text', async () => {
  mockFetch(500, { success: false, error: { code: 'INTERNAL', message: 'stack trace here' } });
  const err = (await apiRequest('/x').catch((e) => e)) as ApiError;
  expect(err.message).toBe('Something went wrong on our side. Please try again.');
});

test('POST sends a JSON body and the Bearer token', async () => {
  const f = mockFetch(200, { success: true, data: { ok: 1 } });
  const { apiPost } = await import('./client');
  await expect(apiPost('/auth/otp/request', { phone: '+94771234567' }, 'tok')).resolves.toEqual({ ok: 1 });
  const init = f.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('POST');
  expect(init.body).toBe(JSON.stringify({ phone: '+94771234567' }));
  expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
});

test('PATCH without a token sends no Authorization header', async () => {
  const f = mockFetch(200, { success: true, data: {} });
  const { apiPatch } = await import('./client');
  await apiPatch('/me', { full_name: 'Nimal' });
  const init = f.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('PATCH');
  expect(init.headers).not.toHaveProperty('Authorization');
});

test('a 5xx keeps its code (OTP_DELIVERY_FAILED) for the screen to explain', async () => {
  mockFetch(502, { success: false, error: { code: 'OTP_DELIVERY_FAILED', message: 'provider said no' } });
  const err = (await apiRequest('/x').catch((e) => e)) as ApiError;
  expect(err.code).toBe('OTP_DELIVERY_FAILED');
  expect(err.message).not.toContain('provider');
});
