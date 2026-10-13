import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getSession, useSession } from '@/blynk/auth/session';
import { storage } from '@/blynk/lib/storage';
import { DEMO } from '@/demo/mode';
import * as api from './api';
import type { CreateAddressBody, SavedAddress, UpdateAddressBody } from './api';
import { DEFAULT_LABEL, DEFAULT_TOWN, metresBetween, normalizeText, validPin, type AddressDetails } from './forms';

export type { SavedAddress } from './api';

/*
 * Where the order goes. A tiny external store (like the session and the cart), persisted in
 * localStorage under LOCATION_KEY:
 *   - sheetDone: the home screen's first-launch location sheet was answered (a spot was chosen);
 *   - selected:  the saved address the signed-in customer chose (per user id);
 *   - guest:     a spot (and the form details) chosen before signing in. Once the customer
 *                signs in it is saved to their address book automatically (syncGuest).
 * The address book itself (GET /me/addresses) is kept in memory for the signed-in user only.
 */
export const LOCATION_KEY = 'blynk.app.location.v1';

export type GuestPin = { lat: number; lng: number; label?: string };

/** A guest's chosen spot; `details` once the address form was filled in. */
export type GuestLocation = GuestPin & { details?: AddressDetails; city?: string };

type Persisted = {
  sheetDone: boolean;
  selected: { userId: string; id: string } | null;
  guest: GuestLocation | null;
};

type SyncState = { state: 'idle' | 'saving' | 'failed'; message: string | null; outOfArea: boolean };

type State = Persisted & {
  book: { userId: string; list: SavedAddress[] } | null;
  loading: boolean;
  loadError: string | null;
  sync: SyncState;
};

const IDLE: SyncState = { state: 'idle', message: null, outOfArea: false };

function restore(): Persisted {
  const empty: Persisted = { sheetDone: false, selected: null, guest: null };
  try {
    const raw = storage.get(LOCATION_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const sel = p.selected;
    const g = p.guest;
    return {
      sheetDone: p.sheetDone === true,
      selected: sel && typeof sel.id === 'string' && typeof sel.userId === 'string' ? { userId: sel.userId, id: sel.id } : null,
      guest: g && validPin(g) ? {
        lat: g.lat,
        lng: g.lng,
        ...(typeof g.label === 'string' ? { label: g.label } : {}),
        ...(typeof g.city === 'string' ? { city: g.city } : {}),
        ...(g.details && typeof g.details.address_line1 === 'string' && typeof g.details.recipient_phone === 'string'
          ? { details: g.details } : {}),
      } : null,
    };
  } catch {
    return empty;
  }
}

let state: State = { ...restore(), book: null, loading: false, loadError: null, sync: IDLE };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ('sheetDone' in patch || 'selected' in patch || 'guest' in patch) {
    const keep: Persisted = { sheetDone: state.sheetDone, selected: state.selected, guest: state.guest };
    storage.set(LOCATION_KEY, JSON.stringify(keep));
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const getLocationState = () => state;

const uid = () => getSession()?.user.id ?? null;

/* ------------------------------------------------------------------ selection */

/** Choose a saved address for this order (local; the list screen also makes it the default). */
export function selectAddress(id: string) {
  set({ selected: { userId: uid() ?? '', id }, sheetDone: true });
}

export function clearSelection() {
  set({ selected: null });
}

/** The first-launch sheet was answered: keep it closed from now on. */
export function markSheetDone() {
  if (!state.sheetDone) set({ sheetDone: true });
}

/** Keep a guest's spot (and form details) on this device until they sign in. */
export function setGuestLocation(g: GuestLocation) {
  attempted.clear();
  set({ guest: g, sheetDone: true, sync: IDLE });
}

export function clearGuest() {
  set({ guest: null, sync: IDLE });
}

/* ------------------------------------------------------------------ address book */

let loadingFor: { userId: string; promise: Promise<SavedAddress[]> } | null = null;

/** GET /me/addresses for the signed-in user (one request at a time; `force` refetches). */
export function loadAddresses(force = false): Promise<SavedAddress[]> {
  const me = uid();
  if (!me) return Promise.resolve([]);
  if (!force && state.book?.userId === me) return Promise.resolve(state.book.list);
  if (loadingFor?.userId === me) return loadingFor.promise;
  set({ loading: true, loadError: null });
  const promise = api.listAddresses()
    .then((list) => {
      if (uid() === me) set({ book: { userId: me, list }, loading: false, loadError: null });
      return list;
    })
    .catch((e) => {
      if (uid() === me) set({ loading: false, loadError: api.addressErrorText(e) });
      throw e;
    })
    .finally(() => { if (loadingFor?.promise === promise) loadingFor = null; });
  loadingFor = { userId: me, promise };
  return promise;
}

/** Put a fresh row into the in-memory book (a new default clears the others' flag, as the server does). */
export function upsertAddress(a: SavedAddress) {
  const me = uid();
  if (!me) return;
  const list = state.book?.userId === me ? state.book.list : [];
  const base = list.map((x) => (a.is_default && x.id !== a.id ? { ...x, is_default: false } : x));
  const next = base.some((x) => x.id === a.id) ? base.map((x) => (x.id === a.id ? a : x)) : [a, ...base];
  set({ book: { userId: me, list: next } });
}

function dropAddress(id: string) {
  const me = uid();
  if (!me || state.book?.userId !== me) return;
  set({
    book: { userId: me, list: state.book.list.filter((x) => x.id !== id) },
    ...(state.selected?.id === id ? { selected: null } : {}),
  });
}

/** Save a new address (signed in) as the default, and choose it. Throws ApiError (422 DELIVERY_OUTSIDE_RADIUS …). */
export async function saveNewAddress(body: CreateAddressBody): Promise<SavedAddress> {
  const a = await api.createAddress({ ...body, is_default: body.is_default ?? true });
  upsertAddress(a);
  set({ selected: { userId: uid() ?? '', id: a.id }, sheetDone: true, guest: null, sync: IDLE });
  return a;
}

export async function saveAddressEdit(id: string, patch: UpdateAddressBody): Promise<SavedAddress> {
  const a = await api.updateAddress(id, patch);
  upsertAddress(a);
  return a;
}

/** Make it the default on the server, then choose it here. */
export async function chooseAddress(id: string): Promise<SavedAddress> {
  const a = await api.setDefaultAddress(id);
  upsertAddress(a);
  selectAddress(a.id);
  return a;
}

export async function removeAddress(id: string): Promise<void> {
  await api.deleteAddress(id);
  dropAddress(id);
}

/* ------------------------------------------------------------------ guest -> account */

const attempted = new Set<string>();
let syncing: Promise<SyncResult> | null = null;

export type SyncResult = 'saved' | 'matched' | 'out-of-area' | 'failed' | 'skipped';

/**
 * After a guest signs in: save their spot to the address book (or reuse a saved address at the
 * same place), choose it, and forget the guest copy. A refusal (422 outside the radius, …)
 * keeps the guest spot and leaves the reason in `syncError` for the cart to show.
 */
export function syncGuest(): Promise<SyncResult> {
  if (syncing) return syncing;
  const me = uid();
  const g = state.guest;
  if (!me || !g?.details) return Promise.resolve('skipped');
  attempted.add(syncKey(me, g) as string);
  set({ sync: { state: 'saving', message: null, outOfArea: false } });
  const d = g.details;
  syncing = (async (): Promise<SyncResult> => {
    try {
      const list = await loadAddresses();
      const line = normalizeText(d.address_line1).toLowerCase();
      const same = list.find((a) => normalizeText(a.address_line1).toLowerCase() === line
        && metresBetween({ lat: a.latitude, lng: a.longitude }, g) < 30);
      if (uid() !== me) return 'skipped';
      if (same) {
        set({ selected: { userId: me, id: same.id }, guest: null, sheetDone: true, sync: IDLE });
        return 'matched';
      }
      await saveNewAddress({
        label: DEFAULT_LABEL,
        ...d,
        city: g.city || DEFAULT_TOWN,
        latitude: g.lat,
        longitude: g.lng,
        is_default: true,
      });
      return 'saved';
    } catch (e) {
      const outOfArea = api.isOutsideRadius(e);
      if (uid() === me) set({ sync: { state: 'failed', message: api.addressErrorText(e), outOfArea } });
      return outOfArea ? 'out-of-area' : 'failed';
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

const syncKey = (me: string, g: GuestLocation | null) => (g?.details ? `${me}|${g.lat}|${g.lng}|${g.details.address_line1}` : null);

/* ------------------------------------------------------------------ reading */

export type DeliveryLocation = {
  /** The chosen saved address (signed in): the selection, else the default, else the newest. */
  address: SavedAddress | null;
  /** A spot chosen before signing in (still here while signed in until it is saved). */
  guestPin: GuestPin | null;
  /** The signed-in user's saved addresses; null until loaded or when signed out. */
  addresses: SavedAddress[] | null;
  loading: boolean;
  error: string | null;
  /** The guest spot is being saved to the account right now. */
  syncing: boolean;
  /** Saving the guest spot after sign-in failed; `outOfArea` = 422 DELIVERY_OUTSIDE_RADIUS. */
  syncError: { outOfArea: boolean; message: string } | null;
  /** The first-launch sheet was answered, or a spot or address exists. */
  chosen: boolean;
};

/** Pure view of the state for one user (exported for tests). */
export function viewFor(s: State, me: string | null): DeliveryLocation {
  const list = me && s.book?.userId === me ? s.book.list : null;
  const sel = me && s.selected?.userId === me ? s.selected.id : null;
  const address = list
    ? list.find((a) => a.id === sel) ?? list.find((a) => a.is_default) ?? list[0] ?? null
    : null;
  const guestPin = s.guest ? { lat: s.guest.lat, lng: s.guest.lng, ...(s.guest.label ? { label: s.guest.label } : {}) } : null;
  return {
    address,
    guestPin,
    addresses: list,
    loading: !!me && s.loading,
    error: me ? s.loadError : null,
    syncing: s.sync.state === 'saving',
    syncError: s.sync.state === 'failed' ? { outOfArea: s.sync.outOfArea, message: s.sync.message ?? '' } : null,
    chosen: s.sheetDone || !!address || !!guestPin,
  };
}

/**
 * The delivery location for the cart, header and checkout. Signed in, it loads the address
 * book and saves a pending guest spot to it. Design-mock mode never touches the network.
 */
export function useDeliveryLocation(): DeliveryLocation {
  const s = useSyncExternalStore(subscribe, getLocationState, getLocationState);
  const session = useSession();
  const me = session?.user.id ?? null;
  useEffect(() => {
    if (!DEMO && me) loadAddresses().catch(() => undefined);
  }, [me]);
  const pending = me ? syncKey(me, s.guest) : null;
  useEffect(() => {
    if (!DEMO && pending && !attempted.has(pending)) void syncGuest();
  }, [pending]);
  return useMemo(() => viewFor(s, me), [s, me]);
}

/** Test hook: forget everything in memory (not the stored copy). */
export function __resetForTests() {
  state = { ...restore(), book: null, loading: false, loadError: null, sync: IDLE };
  attempted.clear();
  syncing = null;
  loadingFor = null;
}
