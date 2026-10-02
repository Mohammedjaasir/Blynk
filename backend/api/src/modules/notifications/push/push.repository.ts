import { sql, type Transaction } from 'kysely';
import { db } from '../../../database/connection.js';
import type { Database, DevicePlatform } from '../../../database/types.js';
import type { DBConnection } from '../../orders/order.repository.js';
import { isPushEnabled } from './push.sender.js';

/** Outbox notification_type of each kind of push. */
export const PUSH_TYPES = {
  ORDER_STATUS: 'PUSH_ORDER_STATUS',
  BACK_IN_STOCK: 'PUSH_BACK_IN_STOCK',
} as const;

/** What a PUSH outbox row carries; the worker sends exactly this. */
export interface PushPayload extends Record<string, unknown> {
  title: string;
  body: string;
  data: Record<string, string>;
}

export const deviceTokenRepository = {
  /** Registers a device, or moves an existing token to this user and refreshes it. */
  async upsert(userId: string, token: string, platform: DevicePlatform, executor: DBConnection = db) {
    const now = new Date();
    return await executor
      .insertInto('device_tokens')
      .values({ user_id: userId, token, platform, created_at: now, last_seen_at: now })
      .onConflict((oc) =>
        oc.column('token').doUpdateSet({ user_id: userId, platform, last_seen_at: now })
      )
      .returning(['platform', 'created_at', 'last_seen_at'])
      .executeTakeFirstOrThrow();
  },

  /** Removes the caller's own token (logout). Another user's token is left alone. */
  async removeForUser(userId: string, token: string, executor: DBConnection = db): Promise<boolean> {
    const res = await executor.deleteFrom('device_tokens').where('user_id', '=', userId).where('token', '=', token).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  },

  async tokensForUser(userId: string, executor: DBConnection = db): Promise<string[]> {
    const rows = await executor
      .selectFrom('device_tokens')
      .select('token')
      .where('user_id', '=', userId)
      .orderBy('last_seen_at', 'desc')
      .limit(500) // FCM multicast limit
      .execute();
    return rows.map((r) => r.token);
  },

  /** Deletes tokens FCM reported as unregistered or invalid. */
  async removeTokens(tokens: string[], executor: DBConnection = db): Promise<number> {
    if (tokens.length === 0) return 0;
    const res = await executor.deleteFrom('device_tokens').where('token', 'in', tokens).executeTakeFirst();
    return Number(res.numDeletedRows);
  },
};

/**
 * Queues one push to every device of `userId`, in the caller's transaction
 * (so it is sent only after that transaction commits, by the outbox worker).
 * Nothing is queued when push is disabled or the user has no device.
 * Returns whether a row was queued.
 */
export async function enqueuePush(
  executor: DBConnection,
  input: { userId: string; orderId?: string | null; type: string; payload: PushPayload; idempotencyKey?: string | null }
): Promise<boolean> {
  if (!isPushEnabled()) return false;
  const device = await executor.selectFrom('device_tokens').select('id').where('user_id', '=', input.userId).limit(1).executeTakeFirst();
  if (!device) return false;
  const row = await executor
    .insertInto('notifications')
    .values({
      user_id: input.userId,
      order_id: input.orderId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      channel: 'PUSH',
      notification_type: input.type,
      recipient: input.userId,
      payload: input.payload,
      status: 'QUEUED',
      max_attempts: 3,
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .returning('id')
    .executeTakeFirst();
  return !!row;
}

let savepointSeq = 0;

/**
 * Runs `fn` inside a savepoint of `trx`: if it throws, only its own writes
 * are undone and the error is reported to `onError`; the surrounding
 * transaction (an order transition, a stock movement) carries on.
 */
export async function bestEffort<T>(trx: Transaction<Database>, fn: () => Promise<T>, onError: (err: unknown) => void): Promise<T | undefined> {
  const name = `push_sp_${++savepointSeq}`;
  await sql.raw(`SAVEPOINT ${name}`).execute(trx);
  try {
    const result = await fn();
    await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(trx);
    return result;
  } catch (err) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(trx);
    onError(err);
    return undefined;
  }
}
