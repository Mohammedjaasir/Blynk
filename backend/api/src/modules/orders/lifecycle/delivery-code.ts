import { randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../../../database/connection.js';
import type { DeliveryConfirmation } from '../../../database/types.js';
import { AppError } from '../../../middleware/error.middleware.js';
import type { Actor, Trx } from './types.js';

/**
 * Proof of delivery with a customer code (migration 016, owner's choice
 * "Customer OTP"). The code is issued when the order goes OUT_FOR_DELIVERY,
 * shown only to the order's customer, and required to complete the delivery.
 * Five wrong codes lock the order's handover for fifteen minutes.
 */
export const MAX_WRONG_DELIVERY_CODES = 5;
export const DELIVERY_CODE_LOCK_MINUTES = 15;

/** A new random 4-digit code, leading zeros kept. */
export function newDeliveryCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

/**
 * Issues a fresh code for a dispatch, in the dispatch transaction (the order
 * is locked). A re-dispatch replaces the old code and clears the counters.
 */
export async function issueDeliveryCode(trx: Trx, orderId: string): Promise<string> {
  const code = newDeliveryCode();
  await trx
    .insertInto('order_delivery_codes')
    .values({ order_id: orderId, code })
    .onConflict((oc) =>
      oc.column('order_id').doUpdateSet({
        code,
        failed_attempts: 0,
        locked_until: null,
        confirmed_via: null,
        confirmed_at: null,
        confirmed_by_user_id: null,
        override_note: null,
        updated_at: new Date(),
      })
    )
    .execute();
  return code;
}

/**
 * Thrown inside the lifecycle transaction on a wrong code. The engine records
 * the attempt after the rollback (so the count survives it) and turns this
 * into the public 422 WRONG_DELIVERY_CODE.
 */
export class WrongDeliveryCodeError extends Error {
  constructor(public readonly orderId: string) {
    super('WRONG_DELIVERY_CODE');
    this.name = 'WrongDeliveryCodeError';
  }
}

function lockedError(lockedUntil: Date): AppError {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(retryAfter / 60);
  return new AppError(
    `Too many wrong delivery codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    429,
    'DELIVERY_CODE_LOCKED',
    { locked_until: lockedUntil.toISOString(), retry_after_seconds: retryAfter }
  );
}

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Checks the code the customer showed, under the order lock. Locked -> 429
 * DELIVERY_CODE_LOCKED (before comparing, so a lock cannot be probed); wrong
 * -> WrongDeliveryCodeError; right -> the handover is recorded as CODE.
 */
export async function confirmWithCode(trx: Trx, orderId: string, code: string, actor: Actor): Promise<void> {
  const row = await trx.selectFrom('order_delivery_codes').selectAll().where('order_id', '=', orderId).executeTakeFirst();
  if (!row) {
    throw new AppError(
      'This order has no delivery code. Ask the store to mark it delivered.',
      409,
      'DELIVERY_CODE_NOT_ISSUED'
    );
  }
  if (row.locked_until && row.locked_until.getTime() > Date.now()) throw lockedError(row.locked_until);
  if (!sameCode(row.code, code)) throw new WrongDeliveryCodeError(orderId);
  await recordConfirmation(trx, orderId, 'CODE', actor, null);
}

/** An admin handover without the code: the written note is the record. */
export async function confirmWithOverride(trx: Trx, orderId: string, actor: Actor, note: string): Promise<void> {
  await trx
    .insertInto('order_delivery_codes')
    .values({ order_id: orderId, code: newDeliveryCode() })
    .onConflict((oc) => oc.column('order_id').doNothing())
    .execute();
  await recordConfirmation(trx, orderId, 'OVERRIDE', actor, note);
}

async function recordConfirmation(
  trx: Trx,
  orderId: string,
  via: DeliveryConfirmation,
  actor: Actor,
  note: string | null
): Promise<void> {
  const now = new Date();
  await trx
    .updateTable('order_delivery_codes')
    .set({ confirmed_via: via, confirmed_at: now, confirmed_by_user_id: actor.id, override_note: note, updated_at: now })
    .where('order_id', '=', orderId)
    .execute();
}

/**
 * Counts one wrong code, outside the rolled-back transaction, atomically: an
 * expired lock starts a fresh count; the fifth wrong code in a row locks the
 * handover for fifteen minutes. Returns the public error for the response.
 */
export async function recordWrongDeliveryCode(orderId: string): Promise<AppError> {
  const expired = sql<boolean>`(locked_until IS NOT NULL AND locked_until <= now())`;
  const next = sql<number>`(CASE WHEN ${expired} THEN 1 ELSE failed_attempts + 1 END)`;
  const row = await db
    .updateTable('order_delivery_codes')
    .set({
      failed_attempts: next,
      locked_until: sql<Date | null>`CASE
        WHEN ${next} >= ${MAX_WRONG_DELIVERY_CODES} THEN now() + make_interval(mins => ${DELIVERY_CODE_LOCK_MINUTES})
        WHEN ${expired} THEN NULL
        ELSE locked_until END`,
      updated_at: new Date(),
    })
    .where('order_id', '=', orderId)
    .returning(['failed_attempts', 'locked_until'])
    .executeTakeFirst();

  const attempts = row?.failed_attempts ?? 1;
  const remaining = Math.max(0, MAX_WRONG_DELIVERY_CODES - attempts);
  return new AppError(
    remaining > 0
      ? `That delivery code is not right. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`
      : `That delivery code is not right. Handover is locked for ${DELIVERY_CODE_LOCK_MINUTES} minutes.`,
    422,
    'WRONG_DELIVERY_CODE',
    {
      attempts_remaining: remaining,
      ...(row?.locked_until ? { locked_until: new Date(row.locked_until).toISOString() } : {}),
    }
  );
}

/** The customer's code while the order is on the road, else null. */
export async function findDeliveryCodeForCustomer(orderId: string): Promise<string | null> {
  const row = await db
    .selectFrom('order_delivery_codes')
    .innerJoin('orders', 'orders.id', 'order_delivery_codes.order_id')
    .select('order_delivery_codes.code')
    .where('order_delivery_codes.order_id', '=', orderId)
    .where('orders.order_status', '=', 'OUT_FOR_DELIVERY')
    .executeTakeFirst();
  return row?.code ?? null;
}
