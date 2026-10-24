import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Combo } from '@/blynk/api/types';
import { MemoryStorage, milk } from '../test/fixtures';
import { combosWith, detailRows, notifyMeAction, NOTIFY_ME, unitLine } from './product';
import { addRecentSearch, loadRecentSearches, normalizeSearch, saveRecentSearches, clearRecentSearches } from './recentSearches';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function load(signedIn: boolean) {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  if (signedIn) {
    session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  }
  const product = await import('./product');
  const client = await import('@/blynk/api/client');
  return { ...product, ...client };
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('product detail', () => {
  test('a guest reads the product without a token; notify-me is off', async () => {
    const { fetchProductDetail, API_BASE_URL } = await load(false);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { product: { ...milk, selling_price: '540.00' } } }));
    const d = await fetchProductDetail('p-milk');
    expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/catalog/products/p-milk`, expect.anything());
    expect((f.mock.calls[0][1] as RequestInit).headers).toBeUndefined();
    expect(d.product.selling_price).toBe(540);
    expect(d.notifyMe).toBe(false);
  });

  test('signed in, the bearer token brings back notify_me_subscribed', async () => {
    const { fetchProductDetail } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { product: { ...milk, is_available: false, notify_me_subscribed: true } } }));
    const d = await fetchProductDetail('p-milk');
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
    expect(d.notifyMe).toBe(true);
    expect('notify_me_subscribed' in d.product).toBe(false);
  });

  test('a 404 is "removed from the store"', async () => {
    const { fetchProductDetail, isProductGone } = await load(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(404, { success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } }));
    const e = await fetchProductDetail('x').catch((err) => err);
    expect(isProductGone(e)).toBe(true);
    expect(isProductGone(new Error('x'))).toBe(false);
  });
});

describe('notify me', () => {
  test('POST to ask, DELETE to cancel, as the signed-in shopper', async () => {
    const { setNotifyMe, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, { success: true, data: { notify_me_subscribed: true } }));
    expect(await setNotifyMe('p-milk', true)).toBe('on');
    expect(f).toHaveBeenLastCalledWith(`${API_BASE_URL}/catalog/products/p-milk/notify-me`, expect.objectContaining({ method: 'POST' }));
    expect(await setNotifyMe('p-milk', false)).toBe('off');
    expect(f).toHaveBeenLastCalledWith(`${API_BASE_URL}/catalog/products/p-milk/notify-me`, expect.objectContaining({ method: 'DELETE' }));
    expect((f.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  });

  test('409: the product is back already', async () => {
    const { setNotifyMe } = await load(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { success: false, error: { code: 'PRODUCT_AVAILABLE', message: 'Back in stock' } }));
    expect(await setNotifyMe('p-milk', true)).toBe('back-in-stock');
  });

  test('other failures are thrown for the page to say', async () => {
    const { setNotifyMe, ApiError } = await load(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Bad id' } }));
    await expect(setNotifyMe('x', true)).rejects.toBeInstanceOf(ApiError);
  });

  test('signed out: never sent, the customer signs in first', async () => {
    const { setNotifyMe } = await load(false);
    const f = vi.spyOn(globalThis, 'fetch');
    await expect(setNotifyMe('p-milk', true)).rejects.toMatchObject({ status: 401 });
    expect(f).not.toHaveBeenCalled();
  });

  test('the button: sign in, ask, or cancel', () => {
    expect(notifyMeAction(false, false)).toBe('sign-in');
    expect(notifyMeAction(false, true)).toBe('sign-in');
    expect(notifyMeAction(true, false)).toBe('subscribe');
    expect(notifyMeAction(true, true)).toBe('unsubscribe');
    expect(NOTIFY_ME.label).toBe("Notify me when it's back");
    expect(NOTIFY_ME.onLabel).toBe("We'll tell you when it's back");
  });
});

describe('product page helpers', () => {
  const combo = (id: string, ids: string[], available = true): Combo => ({
    id, name: id, description: null, image_url: null, price: 100, items_total: 120, saving: 20, ends_at: null, is_available: available,
    items: ids.map((pid) => ({ product_id: pid, name: pid, slug: null, unit: null, pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, quantity: 1, selling_price: 60, unit_price: 60, is_available: true })),
  });
  test('combo packs that hold this product, on sale first', () => {
    const list = combosWith('p-milk', [combo('a', ['p-sugar']), combo('b', ['p-milk'], false), combo('c', ['p-milk', 'p-sugar'])]);
    expect(list.map((c) => c.id)).toEqual(['c', 'b']);
  });
  test('unit line and detail rows only carry real content', () => {
    expect(unitLine({ unit: '1 L', pack_size: null })).toBe('1 L');
    expect(unitLine({ unit: '1 L', pack_size: ' 6 pack ' })).toBe('1 L · 6 pack');
    expect(detailRows({ unit: '1 L', pack_size: null, category_name: 'Dairy' })).toEqual([['Unit', '1 L'], ['Category', 'Dairy']]);
  });
});

describe('recent searches', () => {
  test('newest first, de-duplicated case-insensitively, capped at 8', () => {
    let list: string[] = [];
    for (const q of ['milk', 'Rice', ' MILK ', 'a', 'b', 'c', 'd', 'e', 'f', 'g']) list = addRecentSearch(list, q);
    expect(list).toEqual(['g', 'f', 'e', 'd', 'c', 'b', 'a', 'MILK']);
    expect(addRecentSearch(list, '   ')).toEqual(list);
  });
  test('kept on the device, unreadable storage means none', () => {
    saveRecentSearches(['milk', 'rice']);
    expect(loadRecentSearches()).toEqual(['milk', 'rice']);
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
    localStorage.setItem('blynk.app.recentSearches.v1', '{bad');
    expect(loadRecentSearches()).toEqual([]);
  });
  test('search text is normalised and capped at 100', () => {
    expect(normalizeSearch('  fresh   milk ')).toBe('fresh milk');
    expect(normalizeSearch('x'.repeat(150))).toHaveLength(100);
  });
});
