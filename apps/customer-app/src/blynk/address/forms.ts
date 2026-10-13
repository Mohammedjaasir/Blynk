import { toE164 } from '@/blynk/auth/phone';

/*
 * Delivery address rules and copy, copied from the Flutter shop's address form
 * (lib/Services/Validation/app_validators.dart) so both apps accept the same addresses.
 * The backend (address.schema.ts) is looser; these are the customer-facing limits.
 */

/** Where the map opens when nothing better is known: Dharga Town's clock tower (dev seed). A VIEW only, never a radius check. */
export const STORE_AREA = { lat: 6.441313, lng: 80.011437 } as const;
export const DEFAULT_TOWN = 'Dharga Town';
export const DEFAULT_LABEL = 'Home';

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const LINE_MIN = 3;
export const LINE_MAX = 150;
export const NOTES_MAX = 300;

// \p{M} as well as the Flutter rule's \p{L}: Sinhala and Tamil letters carry combining vowel signs
const NAME_CHARS = /^[\p{L}\p{M} '\-.]+$/u;
const LINE_CHARS = /^[\p{L}\p{M}\p{N} '\-.,/#()]+$/u;
const NOTES_CHARS = /^[\p{L}\p{M}\p{N} '\-.,/#()!?:;&+]+$/u;

export const COPY = {
  name: 'Name',
  nameHint: 'Who will receive the order',
  nameBad: 'Enter a valid recipient name',
  phone: 'Phone number',
  phoneHint: '07X XXX XXXX',
  phoneBad: 'Enter a valid Sri Lankan mobile number',
  other: 'Another phone number (optional)',
  otherHint: 'Family or neighbour',
  otherSame: 'Use a different number from the recipient phone',
  line: 'Address',
  lineHint: 'House number, street, near which place',
  lineBad: 'Enter your street address',
  notes: 'Delivery instructions (optional)',
  notesHint: 'e.g. Blue gate, call when you reach',
  notesBad: 'Enter valid delivery instructions',
  pinMissing: 'Please share your location',
  outTitle: "We don't deliver there yet",
  outBody: "We don't deliver to this address yet. Choose another address.",
};

/** Trim the ends and collapse runs of whitespace (the Flutter normalizeText). */
export const normalizeText = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');

export function recipientNameError(v: string): string | null {
  const t = normalizeText(v);
  return t.length < NAME_MIN || t.length > NAME_MAX || !NAME_CHARS.test(t) ? COPY.nameBad : null;
}

export function phoneError(v: string): string | null {
  return toE164(v) ? null : COPY.phoneBad;
}

/** Optional: empty is fine; anything typed must be a valid number that is not the recipient's own. */
export function otherPhoneError(v: string, recipient: string): string | null {
  if (!normalizeText(v)) return null;
  const n = toE164(v);
  if (!n) return COPY.phoneBad;
  return n === toE164(recipient) ? COPY.otherSame : null;
}

export function lineError(v: string): string | null {
  const t = normalizeText(v);
  return t.length < LINE_MIN || t.length > LINE_MAX || !LINE_CHARS.test(t) ? COPY.lineBad : null;
}

export function notesError(v: string): string | null {
  const t = normalizeText(v);
  if (!t) return null;
  return t.length > NOTES_MAX || !NOTES_CHARS.test(t) ? COPY.notesBad : null;
}

export type AddressFields = { name: string; phone: string; other: string; line: string; notes: string };
export type FieldErrors = Partial<Record<keyof AddressFields | 'pin', string>>;

/** The cleaned values the API takes (phones in +94 form, empty optionals as null). */
export type AddressDetails = {
  recipient_name: string;
  recipient_phone: string;
  alternate_phone: string | null;
  address_line1: string;
  delivery_instructions: string | null;
};

export type Pin = { lat: number; lng: number };

export const validPin = (p: Pin | null | undefined): p is Pin =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Check every field; `details` is set only when all of them pass. */
export function validateAddress(f: AddressFields, pin: Pin | null): { errors: FieldErrors; details: AddressDetails | null } {
  const errors: FieldErrors = {};
  const put = (k: keyof FieldErrors, e: string | null) => { if (e) errors[k] = e; };
  put('name', recipientNameError(f.name));
  put('phone', phoneError(f.phone));
  put('other', otherPhoneError(f.other, f.phone));
  put('line', lineError(f.line));
  put('notes', notesError(f.notes));
  if (!validPin(pin)) errors.pin = COPY.pinMissing;
  if (Object.keys(errors).length) return { errors, details: null };
  return {
    errors,
    details: {
      recipient_name: normalizeText(f.name),
      recipient_phone: toE164(f.phone) as string,
      alternate_phone: normalizeText(f.other) ? toE164(f.other) : null,
      address_line1: normalizeText(f.line),
      delivery_instructions: normalizeText(f.notes) || null,
    },
  };
}

/**
 * The town for `city`, from GET /store's hub_name ("Dharga Town Central Dark Store" -> "Dharga Town").
 * The Flutter app used its hub name the same way.
 */
export function townFromHub(hub: string | null | undefined): string {
  const t = normalizeText(hub)
    .replace(/\b(central\s+)?(dark\s+store|store|hub|warehouse)\b.*$/i, '')
    .replace(/[\s,·-]+$/, '')
    .trim();
  return t.length >= 2 && t.length <= 64 ? t : DEFAULT_TOWN;
}

/** Only an in-app path ("/cart", "/addresses?x=1") is a valid `return`; anything else is ignored. */
export function safeReturn(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || !s.startsWith('/') || s.startsWith('//') || s.includes('\\') || s.length > 200) return null;
  return s;
}

/** Distance in metres (haversine), for "is this the same spot" checks only. */
export function metresBetween(a: Pin, b: Pin): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A number from a route param ("6.44"), or null. */
export function numParam(v: unknown): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || !s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
