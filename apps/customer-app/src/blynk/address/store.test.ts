import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { API_BASE_URL } from '@/blynk/api/client';

/* Fresh session + location modules over a fake localStorage, as a page load would have. */
let ls: Map<string, string>;
const KEY = 'blynk.app.location.v1';

async function load() {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  const store = await import('./store');
  const api = await import('./api');
  return { session, store, api };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const ok = (data: unknown, status = 200) => json(status, { success: true, data });

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'u1', label: 'Home', recipient_name: 'Nimal Perera', recipient_phone: '+94771234567', alternate_phone: null,
  address_line1: `${id} Main Street`, address_line2: null, city: 'Dharga Town', postal_code: null,
  latitude: '6.44130000', longitude: '80.01140000', delivery_instructions: null, is_default: false, is_deleted: false, ...extra,
});

const signIn = (session: Awaited<ReturnType<typeof load>>['session']) => session.signIn({
  access_token: 'a1', refresh_token: 'r1',
  user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal Perera', email: null },
});

const details = {
  recipient_name: 'Nimal Perera', recipient_phone: '+94771234567', alternate_phone: null,
  address_line1: '12 Clock Tower Road', delivery_instructions: null,
};

beforeEach(() => {
  ls = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k: string, v: string) => { ls.set(k, v); },
    removeItem: (k: string) => { ls.delete(k); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('parseAddress turns NUMERIC strings into numbers and drops rows without coordinates', async () => {
  const { api } = await load();
  expect(api.parseAddress(row('a'))).toMatchObject({ id: 'a', latitude: 6.4413, longitude: 80.0114, is_default: false });
  expect(api.parseAddress({ ...row('b'), latitude: 'x' })).toBeNull();
  expect(api.parseAddress(null)).toBeNull();
  expect(api.addressSummary({ address_line1: '12 Main St', city: 'Dharga Town' })).toBe('12 Main St, Dharga Town');
});

test('selection, the sheet flag and the guest spot persist across page loads', async () => {
  const a = await load();
  expect(a.store.viewFor(a.store.getLocationState(), null).chosen).toBe(false);
  a.store.setGuestLocation({ lat: 6.4413, lng: 80.0114, label: '12 Clock Tower Road', details, city: 'Dharga Town' });
  a.store.selectAddress('addr-1');
  const stored = JSON.parse(ls.get(KEY) as string);
  expect(stored).toMatchObject({ sheetDone: true, selected: { id: 'addr-1' }, guest: { lat: 6.4413, label: '12 Clock Tower Road' } });

  const b = await load();
  const v = b.store.viewFor(b.store.getLocationState(), null);
  expect(v).toMatchObject({ chosen: true, address: null, guestPin: { lat: 6.4413, lng: 80.0114, label: '12 Clock Tower Road' } });
  b.store.clearSelection();
  expect(b.store.getLocationState().selected).toBeNull();
});

test('a corrupt stored value restores as nothing chosen', async () => {
  ls.set(KEY, '{nope');
  const a = await load();
  expect(a.store.viewFor(a.store.getLocationState(), null)).toMatchObject({ chosen: false, guestPin: null });
});

test('the address is the selection, else the default, else the newest', async () => {
  const { session, store } = await load();
  signIn(session);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ addresses: [row('n'), row('d', { is_default: true })] }));
  await store.loadAddresses();
  const view = () => store.viewFor(store.getLocationState(), 'u1');
  expect(view().address?.id).toBe('d');
  store.selectAddress('n');
  expect(view().address?.id).toBe('n');
  // another user never sees u1's book or selection
  expect(store.viewFor(store.getLocationState(), 'u2')).toMatchObject({ address: null, addresses: null });
});

test('saveNewAddress posts is_default, chooses the new address and clears the guest spot', async () => {
  const { session, store } = await load();
  signIn(session);
  store.setGuestLocation({ lat: 6.4413, lng: 80.0114 });
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(ok({ addresses: [row('old', { is_default: true })] }))
    .mockResolvedValueOnce(ok({ address: row('new', { is_default: true }) }, 201));
  await store.loadAddresses();
  const a = await store.saveNewAddress({
    label: 'Home', ...details, city: 'Dharga Town', latitude: 6.4413, longitude: 80.0114,
  });
  expect(a.id).toBe('new');
  const [url, init] = f.mock.calls[1];
  expect(url).toBe(`${API_BASE_URL}/me/addresses`);
  expect(init?.method).toBe('POST');
  expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer a1');
  expect(JSON.parse(init?.body as string)).toMatchObject({ is_default: true, latitude: 6.4413, address_line1: '12 Clock Tower Road' });
  const v = store.viewFor(store.getLocationState(), 'u1');
  expect(v.address?.id).toBe('new');
  expect(v.guestPin).toBeNull();
  expect(v.addresses?.find((x) => x.id === 'old')?.is_default).toBe(false);
});

test('a guest spot is saved to the account after sign-in', async () => {
  const { session, store } = await load();
  store.setGuestLocation({ lat: 6.4413, lng: 80.0114, label: details.address_line1, details, city: 'Dharga Town' });
  expect(await store.syncGuest()).toBe('skipped'); // not signed in yet
  signIn(session);
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(ok({ addresses: [] }))
    .mockResolvedValueOnce(ok({ address: row('g', { is_default: true, address_line1: details.address_line1 }) }, 201));
  expect(await store.syncGuest()).toBe('saved');
  expect(JSON.parse(f.mock.calls[1][1]?.body as string)).toMatchObject({
    label: 'Home', city: 'Dharga Town', latitude: 6.4413, longitude: 80.0114, is_default: true, recipient_phone: '+94771234567',
  });
  const v = store.viewFor(store.getLocationState(), 'u1');
  expect(v).toMatchObject({ address: { id: 'g' }, guestPin: null, syncError: null, syncing: false });
});

test('a guest spot that is already saved is reused, not duplicated', async () => {
  const { session, store } = await load();
  store.setGuestLocation({ lat: 6.4413, lng: 80.0114, details });
  signIn(session);
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({ addresses: [row('x', { address_line1: '12 clock tower  road' })] }));
  expect(await store.syncGuest()).toBe('matched');
  expect(f).toHaveBeenCalledTimes(1);
  expect(store.viewFor(store.getLocationState(), 'u1').address?.id).toBe('x');
});

test('outside the radius: the guest spot stays and the cart gets the out-of-area reason', async () => {
  const { session, store } = await load();
  store.setGuestLocation({ lat: 6.9271, lng: 79.8612, details });
  signIn(session);
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(ok({ addresses: [] }))
    .mockResolvedValueOnce(json(422, {
      success: false,
      error: { code: 'DELIVERY_OUTSIDE_RADIUS', message: 'outside', details: { distance_km: 23.1, max_radius_km: 4 } },
    }));
  expect(await store.syncGuest()).toBe('out-of-area');
  const v = store.viewFor(store.getLocationState(), 'u1');
  expect(v.guestPin).toMatchObject({ lat: 6.9271 });
  expect(v.syncError).toEqual({ outOfArea: true, message: "We don't deliver to this address yet. Choose another address." });
  // choosing a new spot clears the failure
  store.setGuestLocation({ lat: 6.4413, lng: 80.0114, details });
  expect(store.viewFor(store.getLocationState(), 'u1').syncError).toBeNull();
});

test('choose, edit and delete call the right endpoints', async () => {
  const { session, store } = await load();
  signIn(session);
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(ok({ addresses: [row('a', { is_default: true }), row('b')] }))
    .mockResolvedValueOnce(ok({ address: row('b', { is_default: true }) }))
    .mockResolvedValueOnce(ok({ address: row('b', { is_default: true, address_line1: '99 New Road' }) }))
    .mockResolvedValueOnce(json(200, { success: true, message: 'Address deleted successfully' }));
  await store.loadAddresses();
  await store.chooseAddress('b');
  expect(f.mock.calls[1][0]).toBe(`${API_BASE_URL}/me/addresses/b/default`);
  expect(f.mock.calls[1][1]?.method).toBe('POST');
  let v = store.viewFor(store.getLocationState(), 'u1');
  expect(v.address?.id).toBe('b');
  expect(v.addresses?.find((x) => x.id === 'a')?.is_default).toBe(false);

  await store.saveAddressEdit('b', { address_line1: '99 New Road' });
  expect(f.mock.calls[2][1]?.method).toBe('PATCH');
  expect(store.viewFor(store.getLocationState(), 'u1').address?.address_line1).toBe('99 New Road');

  await store.removeAddress('b');
  expect(f.mock.calls[3][0]).toBe(`${API_BASE_URL}/me/addresses/b`);
  expect(f.mock.calls[3][1]?.method).toBe('DELETE');
  v = store.viewFor(store.getLocationState(), 'u1');
  expect(v.addresses?.map((x) => x.id)).toEqual(['a']);
  expect(store.getLocationState().selected).toBeNull();
  expect(v.address?.id).toBe('a');
});

test('error copy for address calls', async () => {
  const { api } = await load();
  const { ApiError } = await import('@/blynk/api/client');
  expect(api.addressErrorText(new ApiError('x', 422, 'DELIVERY_OUTSIDE_RADIUS'))).toBe("We don't deliver to this address yet. Choose another address.");
  expect(api.isOutsideRadius(new ApiError('x', 422, 'DELIVERY_OUTSIDE_RADIUS'))).toBe(true);
  expect(api.addressErrorText(new ApiError('x', 400, 'ALTERNATE_PHONE_SAME_AS_RECIPIENT'))).toBe('Use a different number from the recipient phone');
});
