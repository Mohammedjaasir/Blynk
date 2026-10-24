import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { featureOn, resetFeatureGate } from '@/blynk/lib/featureGate';
import { MemoryStorage, store } from '../test/fixtures';
import {
  ASK_COPY, NAME_MAX, normalizeName, parseMyRequests, prefillName, requestErrorText, requestKey, statusChip, STATUS_CHIP,
  validateRequest,
} from './model';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('validation', () => {
  test('name 2-80 after trimming and collapsing spaces', () => {
    expect(validateRequest({ name: '  ' })).toEqual({ ok: false, field: 'name', error: 'Tell us the product name.' });
    expect(validateRequest({ name: 'a' }).ok).toBe(false);
    expect(validateRequest({ name: 'x'.repeat(81) })).toMatchObject({ ok: false, field: 'name' });
    expect(validateRequest({ name: '  Anchor   Butter  ' })).toEqual({ ok: true, body: { name: 'Anchor Butter' } });
  });

  test('note up to 300 (optional); category only when given', () => {
    expect(validateRequest({ name: 'Ghee', note: 'y'.repeat(301) })).toMatchObject({ ok: false, field: 'note' });
    expect(validateRequest({ name: 'Ghee', note: '  500 g jar ', categoryId: 'c1' })).toEqual({ ok: true, body: { name: 'Ghee', note: '500 g jar', category_id: 'c1' } });
    expect(validateRequest({ name: 'Ghee', note: '   ', categoryId: '' })).toEqual({ ok: true, body: { name: 'Ghee' } });
  });

  test('the grouping key and the search prefill', () => {
    expect(normalizeName(' a  b ')).toBe('a b');
    expect(requestKey('  Anchor   BUTTER ')).toBe('anchor butter');
    expect(prefillName('  kithul   treacle ')).toBe('kithul treacle');
    expect(prefillName('z'.repeat(120))).toHaveLength(NAME_MAX);
    expect(prefillName(null)).toBe('');
  });
});

describe('my requests', () => {
  test('status chips in the customer words; unknown reads as New', () => {
    expect(statusChip('NEW').label).toBe('New');
    expect(statusChip('PLANNED').label).toBe('Planned');
    expect(statusChip('ADDED').label).toBe('Added');
    expect(statusChip('DECLINED').label).toBe('Not stocking');
    expect(statusChip('WHATEVER')).toBe(STATUS_CHIP.NEW);
  });

  test('parsing: { requests } or a list; bad rows skipped; product only once ADDED; newest first', () => {
    const list = parseMyRequests({
      requests: [
        { id: 'r1', name: 'Ghee', status: 'PLANNED', product_id: 'p1', created_at: '2026-10-20T10:00:00Z' },
        { id: 'r2', name: 'Anchor Butter', note: ' 200 g ', status: 'ADDED', product_id: 'p9', category_name: 'Dairy', created_at: '2026-10-22T10:00:00Z' },
        { id: 'r3', status: 'NEW' },
        null,
        { id: 4, name: 'Oat milk', status: 'odd' },
      ],
    });
    expect(list.map((r) => r.id)).toEqual(['r2', 'r1', '4']);
    expect(list[0]).toMatchObject({ productId: 'p9', note: '200 g', categoryName: 'Dairy', status: 'ADDED' });
    expect(list[1].productId).toBeNull();
    expect(list[2].status).toBe('NEW');
    expect(parseMyRequests([{ id: 'a', name: 'Tea' }])).toHaveLength(1);
    expect(parseMyRequests(undefined)).toEqual([]);
  });
});

describe('errors', () => {
  test('rate limit, validation, network, server', () => {
    expect(requestErrorText(new ApiError('x', 429, 'RATE_LIMITED'))).toMatch(/tomorrow/);
    expect(requestErrorText(new ApiError('Name is too short', 400, 'VALIDATION_ERROR'))).toBe('Name is too short');
    expect(requestErrorText(new ApiError('Request failed.', 400))).toBe('Check the product name and try again.');
    expect(requestErrorText(new ApiError("We couldn't reach Blynk.", 0, 'NETWORK_ERROR'))).toBe("We couldn't reach Blynk.");
    expect(requestErrorText(new ApiError('x', 500))).toMatch(/our side/);
    expect(requestErrorText(new Error('boom'))).toMatch(/couldn't send/);
    expect(ASK_COPY.title).toBe("Can't find it? Ask us");
  });
});

describe('api', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
  afterEach(async () => {
    const { endSession } = await import('@/blynk/auth/session');
    endSession('logout');
    vi.unstubAllGlobals();
    resetFeatureGate();
  });

  test('a guest sends without a token; signed in with one; NOT_READY hides the feature', async () => {
    const { sendProductRequest, fetchMyRequests } = await import('./api');
    const seen: { url: string; auth: string | null; body: unknown }[] = [];
    let ready = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen.push({ url, auth: h.Authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (!ready) return json(503, { success: false, error: { code: 'PRODUCT_REQUESTS_NOT_READY', message: 'x' } });
      if (url.endsWith('/me/product-requests')) return json(200, { success: true, data: { requests: [{ id: 'r', name: 'Ghee', status: 'NEW' }] } });
      return json(201, { success: true, data: { request: { id: 'r' } } });
    }));
    await sendProductRequest({ name: 'Ghee' });
    expect(seen[0]).toMatchObject({ auth: null, body: { name: 'Ghee' } });
    expect(seen[0].url).toMatch(/\/product-requests$/);

    const { signIn } = await import('@/blynk/auth/session');
    signIn({ access_token: 'tok', refresh_token: 'r', user: { id: 'u1', phone: '+94770000000', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
    await sendProductRequest({ name: 'Tea', category_id: 'c1' });
    expect(seen[1].auth).toBe('Bearer tok');
    expect((await fetchMyRequests()).map((r) => r.name)).toEqual(['Ghee']);

    const on = { ...store, product_requests_enabled: true } as typeof store;
    expect(featureOn(on, 'requests')).toBe(true);
    ready = false;
    await expect(sendProductRequest({ name: 'Milk' })).rejects.toThrow();
    expect(featureOn(on, 'requests')).toBe(false);
  });
});
