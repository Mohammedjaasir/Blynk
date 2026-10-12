import { createHmac } from 'node:crypto';
import type { Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { env } from '../../config/env.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';

type DBConnection = Transaction<Database> | typeof db;

/**
 * A stable, non-reversible identity for a verified phone number (migration
 * 041; security audit 2026-10). DELETE /me frees the number with a "del:..."
 * placeholder, so without this every per-customer promotion limit (counted by
 * users.id) came back on re-registering the same number.
 *
 * users.phone_hash = hex(HMAC-SHA256(normalised phone, OTP_SECRET)).
 *
 * The key is env.OTP_SECRET: already required, at least 16 characters, and
 * rejected in production when it is a dev placeholder (config/env.ts), but
 * until now unused. Keyed, so the hash of a known number cannot be computed
 * (or reversed by trying all ~70 million Sri Lankan mobile numbers) without
 * the server secret. Rotating OTP_SECRET unlinks earlier deleted accounts.
 *
 * Returns null for anything that is not a real Sri Lankan mobile number (the
 * "nophone:" placeholder of Admin / Inventory accounts, a deleted account's
 * "del:" placeholder).
 */
export function phoneHash(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let normalised: string;
  try {
    normalised = normalizeSriLankanPhone(phone);
  } catch {
    return null;
  }
  return createHmac('sha256', env.OTP_SECRET).update(normalised).digest('hex');
}

/**
 * Every account id that is the same verified number as `customerId`: itself,
 * plus every account (normally deleted ones) whose phone_hash matches the
 * hash of its current phone. The live account's hash is computed from its
 * phone here rather than read, so a row created before migration 041 (or by
 * a path that does not set phone_hash) is still linked. Per-customer
 * promotion checks count usage across all of these ids.
 */
export async function phoneLineageIds(executor: DBConnection, customerId: string): Promise<string[]> {
  const me = await executor
    .selectFrom('users')
    .select(['phone', 'phone_hash'])
    .where('id', '=', customerId)
    .executeTakeFirst();
  const hash = me ? (phoneHash(me.phone) ?? me.phone_hash) : null;
  if (!hash) return [customerId];
  const rows = await executor
    .selectFrom('users')
    .select('id')
    .where((eb) => eb.or([eb('id', '=', customerId), eb('phone_hash', '=', hash)]))
    .execute();
  const ids = rows.map((r) => r.id);
  return ids.includes(customerId) ? ids : [customerId, ...ids];
}
