import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import { COPY } from './forms';
import { ADDRESS_ERRORS } from './words';

/*
 * The signed-in customer's address book (backend modules/users/address.*). Every call goes
 * through authed(), which refreshes the access token once on a 401. Creating an address, or
 * moving its pin, outside the active store's radius is refused with 422 DELIVERY_OUTSIDE_RADIUS:
 * the server is the only authority on where Blynk delivers.
 */

/** A /me/addresses row, with latitude and longitude as numbers (Postgres NUMERIC arrives as a string). */
export type SavedAddress = {
  id: string;
  label: string;
  recipient_name: string;
  recipient_phone: string;
  alternate_phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  delivery_instructions: string | null;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CreateAddressBody = {
  label: string;
  recipient_name: string;
  recipient_phone: string;
  alternate_phone?: string | null;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  postal_code?: string | null;
  latitude: number;
  longitude: number;
  delivery_instructions?: string | null;
  is_default?: boolean;
};

export type UpdateAddressBody = Partial<CreateAddressBody>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));

/** Parse one row; null when it has no id or no usable coordinates. */
export function parseAddress(row: unknown): SavedAddress | null {
  const r = (row ?? {}) as Record<string, unknown>;
  const latitude = Number(r.latitude);
  const longitude = Number(r.longitude);
  if (typeof r.id !== 'string' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: r.id,
    label: str(r.label)?.trim() || 'Home',
    recipient_name: str(r.recipient_name) ?? '',
    recipient_phone: str(r.recipient_phone) ?? '',
    alternate_phone: str(r.alternate_phone),
    address_line1: str(r.address_line1) ?? '',
    address_line2: str(r.address_line2),
    city: str(r.city) ?? '',
    postal_code: str(r.postal_code),
    latitude,
    longitude,
    delivery_instructions: str(r.delivery_instructions),
    is_default: r.is_default === true,
    created_at: str(r.created_at) ?? undefined,
    updated_at: str(r.updated_at) ?? undefined,
  };
}

const parseOne = (row: unknown): SavedAddress => {
  const a = parseAddress(row);
  if (!a) throw new ApiError('The address came back incomplete. Please try again.', 500, 'BAD_ADDRESS');
  return a;
};

export async function listAddresses(): Promise<SavedAddress[]> {
  const data = await authed((t) => apiGet<{ addresses?: unknown[] }>('/me/addresses', t));
  return (data?.addresses ?? []).map(parseAddress).filter((a): a is SavedAddress => !!a);
}

export async function createAddress(body: CreateAddressBody): Promise<SavedAddress> {
  const data = await authed((t) => apiPost<{ address: unknown }>('/me/addresses', body, t));
  return parseOne(data?.address);
}

export async function updateAddress(id: string, body: UpdateAddressBody): Promise<SavedAddress> {
  const data = await authed((t) => apiPatch<{ address: unknown }>(`/me/addresses/${encodeURIComponent(id)}`, body, t));
  return parseOne(data?.address);
}

export async function deleteAddress(id: string): Promise<void> {
  await authed((t) => apiDelete<unknown>(`/me/addresses/${encodeURIComponent(id)}`, t));
}

export async function setDefaultAddress(id: string): Promise<SavedAddress> {
  const data = await authed((t) => apiPost<{ address: unknown }>(`/me/addresses/${encodeURIComponent(id)}/default`, {}, t));
  return parseOne(data?.address);
}

export const isOutsideRadius = (e: unknown) => e instanceof ApiError && e.code === 'DELIVERY_OUTSIDE_RADIUS';

/** What to tell the customer when an address call fails. */
export function addressErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return ADDRESS_ERRORS.generic;
  switch (e.code) {
    case 'DELIVERY_OUTSIDE_RADIUS': return COPY.outBody;
    case 'ALTERNATE_PHONE_SAME_AS_RECIPIENT': return COPY.otherSame;
    case 'ADDRESS_NOT_FOUND': return ADDRESS_ERRORS.notFound;
    case 'VALIDATION_ERROR': return ADDRESS_ERRORS.validation;
    case 'UNAUTHENTICATED': return ADDRESS_ERRORS.expired;
    case 'STORE_UNAVAILABLE': return ADDRESS_ERRORS.storeUnavailable;
    case 'BAD_ADDRESS': return ADDRESS_ERRORS.incomplete;
    default: return e.message || ADDRESS_ERRORS.generic;
  }
}

/** "12 Main Street, Dharga Town" for one-line summaries. */
export const addressSummary = (a: Pick<SavedAddress, 'address_line1' | 'city'>) =>
  [a.address_line1, a.city].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
