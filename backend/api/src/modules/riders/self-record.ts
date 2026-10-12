import type { Kysely } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * Owner decision 2026-10-12 (security audit 2026-10): an ADMIN or OPERATIONS
 * person who also delivers has their own riders row. They never record
 * their own cash hand-ins, add/change/delete their own pay adjustments,
 * change their own pay, delete their own hand-ins, or adjust their own
 * Blynk Points - another staff member does it. Admin and Ops show
 * `message` as it is.
 */
export const CANNOT_RECORD_FOR_SELF = 'CANNOT_RECORD_FOR_SELF';

export function cannotRecordForSelf(what = 'cash or pay'): AppError {
  return new AppError(
    `You can't record ${what} for your own account. Please ask another staff member to do it.`,
    403,
    CANNOT_RECORD_FOR_SELF
  );
}

/** Refuses when the riders row `riderId` belongs to `actorId`. An unknown rider is left to the caller's own 404. */
export async function assertNotOwnRider(riderId: string, actorId: string, executor: Kysely<Database> = db): Promise<void> {
  const row = await executor.selectFrom('riders').select('user_id').where('id', '=', riderId).executeTakeFirst();
  if (row && row.user_id === actorId) throw cannotRecordForSelf();
}
