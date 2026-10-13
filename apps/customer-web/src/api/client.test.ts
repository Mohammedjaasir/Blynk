import { apiRequest, ApiError, API_BASE_URL } from './client';

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
}

afterEach(() => vi.restoreAllMocks());

test('returns data from the success envelope', async () => {
  const f = mockFetch(200, { success: true, data: { products: [] } });
  await expect(apiRequest('/catalog/products')).resolves.toEqual({ products: [] });
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/catalog/products`, expect.objectContaining({ method: 'GET' }));
});

test('throws ApiError with the server code and message', async () => {
  mockFetch(422, { success: false, error: { code: 'DELIVERY_OUTSIDE_RADIUS', message: 'Too far', details: { distance_km: 5 } } });
  await expect(apiRequest('/x')).rejects.toMatchObject({ status: 422, code: 'DELIVERY_OUTSIDE_RADIUS', message: 'Too far' });
});

test('maps a network failure to NETWORK_ERROR', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  const err = await apiRequest('/x').catch((e: ApiError) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.code).toBe('NETWORK_ERROR');
});

test('a 5xx never leaks server text', async () => {
  mockFetch(500, { success: false, error: { code: 'INTERNAL', message: 'stack trace here' } });
  const err = await apiRequest('/x').catch((e: ApiError) => e);
  expect(err.message).toBe("Something went wrong on our side. Please try again.");
});

test('sends JSON bodies', async () => {
  const f = mockFetch(200, { success: true, data: {} });
  await apiRequest('/y', { method: 'POST', body: { a: 1 } });
  expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"a":1}' });
});
