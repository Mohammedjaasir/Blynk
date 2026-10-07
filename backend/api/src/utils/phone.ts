import { randomBytes } from 'node:crypto';

/**
 * Normalizes Sri Lankan mobile numbers to standard E.164 format (+94XXXXXXXXX).
 * Supported inputs:
 *  - "0771234567"   -> "+94771234567"
 *  - "94771234567"  -> "+94771234567"
 *  - "+94771234567" -> "+94771234567"
 *  - " 077 123 4567 " -> "+94771234567"
 *
 * Valid operator prefixes in Sri Lanka: 70, 71, 72, 74, 75, 76, 77, 78
 */
export function normalizeSriLankanPhone(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Phone number must be a non-empty string');
  }

  // Remove spaces, hyphens, and brackets
  const cleaned = input.replace(/[\s\-()]/g, '');

  let normalized = cleaned;

  if (cleaned.startsWith('0')) {
    normalized = '+94' + cleaned.slice(1);
  } else if (cleaned.startsWith('94')) {
    normalized = '+' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    normalized = '+94' + cleaned;
  }

  // Strictly match E.164 Sri Lankan mobile format (+94 followed by valid 2-digit mobile prefix and 7 digits)
  const sriLankanMobileRegex = /^\+94(70|71|72|74|75|76|77|78)[0-9]{7}$/;

  if (!sriLankanMobileRegex.test(normalized)) {
    throw new Error(
      `Invalid Sri Lankan mobile phone number format: "${input}". Must be a valid 9-digit mobile number with prefix 70, 71, 72, 74, 75, 76, 77, or 78.`
    );
  }

  return normalized;
}

/**
 * Admin (ADMIN) and Inventory (PACKING_STAFF) accounts sign in with email +
 * password only and have no phone number (owner, 2026-10-07). users.phone is
 * still NOT NULL UNIQUE VARCHAR(20) (migration 001), so such an account
 * stores a placeholder instead: "nophone:" + 12 lowercase hex = 20 chars.
 * It can never be a real number - normalizeSriLankanPhone() rejects it, so
 * no SMS code can be requested for it and no SMS is ever sent to it - and
 * APIs show it as null (publicPhone). Migration 028 uses the same format.
 */
export const PLACEHOLDER_PHONE_PREFIX = 'nophone:';

/** The roles that sign in with email + password only and keep no phone. */
export const EMAIL_ONLY_ROLES: readonly string[] = ['ADMIN', 'PACKING_STAFF'];

export const isEmailOnlyRole = (role: string | null | undefined): boolean =>
  !!role && EMAIL_ONLY_ROLES.includes(role);

/** A fresh, unique-enough placeholder for users.phone ("nophone:" + 12 hex). */
export function generatePlaceholderPhone(): string {
  return PLACEHOLDER_PHONE_PREFIX + randomBytes(6).toString('hex');
}

export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && phone.startsWith(PLACEHOLDER_PHONE_PREFIX);
}

/** The phone an API may show: null instead of a placeholder. */
export function publicPhone(phone: string | null | undefined): string | null {
  return phone && !isPlaceholderPhone(phone) ? phone : null;
}
