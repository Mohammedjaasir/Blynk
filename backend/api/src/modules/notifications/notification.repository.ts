import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { DBConnection } from '../orders/order.repository.js';
import { NotificationChannel, NotificationStatus } from '../../database/types.js';
import { OUTBOX_PAUSE_LOCK_KEY } from './outbox-pause.js';

export interface EnqueueNotificationInput {
  user_id?: string | null;
  order_id?: string | null;
  idempotency_key?: string | null;
  channel: NotificationChannel;
  notification_type: string;
  recipient: string;
  payload: Record<string, unknown>;
  max_attempts?: number;
}

export interface ClaimedNotificationJob {
  id: string;
  user_id: string | null;
  order_id: string | null;
  idempotency_key: string | null;
  channel: NotificationChannel;
  notification_type: string;
  recipient: string;
  payload: unknown;
  status: NotificationStatus;
  attempts: number;
  max_attempts: number;
}

export class NotificationRepository {
  /**
   * Enqueues an outbox notification inside a transaction or on standard connection.
   * If an identical idempotency_key already exists, the insert is gracefully ignored.
   */
  async enqueueNotification(
    input: EnqueueNotificationInput,
    executor: DBConnection = db
  ) {
    const result = await executor
      .insertInto('notifications')
      .values({
        user_id: input.user_id || null,
        order_id: input.order_id || null,
        idempotency_key: input.idempotency_key || null,
        channel: input.channel,
        notification_type: input.notification_type,
        recipient: input.recipient,
        payload: input.payload,
        status: 'QUEUED',
        attempts: 0,
        max_attempts: input.max_attempts ?? 3,
        next_attempt_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('idempotency_key').doNothing()
      )
      .returningAll()
      .executeTakeFirst();

    return result || null;
  }

  /**
   * Concurrency-safe batch claim using SELECT ... FOR UPDATE SKIP LOCKED.
   * Claims ready QUEUED jobs as well as abandoned PROCESSING jobs exceeding lease timeout.
   * Releases DB row locks immediately upon transaction commit before dispatching external HTTP calls.
   */
  async claimPendingBatch(
    limit: number,
    workerId: string,
    leaseTimeoutMs: number,
    executor: DBConnection = db,
    options: { yieldToPause?: boolean } = {}
  ): Promise<ClaimedNotificationJob[]> {
    return await executor.transaction().execute(async (trx) => {
      // A polling worker yields while the outbox pause lock is held (see
      // outbox-pause.ts). Taken shared for the claim's transaction, so workers
      // never block each other and a pause waits for in-flight claims.
      if (options.yieldToPause) {
        const { rows } = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock_shared(${OUTBOX_PAUSE_LOCK_KEY}) AS ok`.execute(trx);
        if (!rows[0]?.ok) return [];
      }

      const staleThreshold = new Date(Date.now() - leaseTimeoutMs);
      const now = new Date();

      const candidateJobs = await trx
        .selectFrom('notifications')
        .select([
          'id',
          'user_id',
          'order_id',
          'idempotency_key',
          'channel',
          'notification_type',
          'recipient',
          'payload',
          'status',
          'attempts',
          'max_attempts',
        ])
        .where((eb) =>
          eb.or([
            eb.and([
              eb('status', '=', 'QUEUED'),
              eb('next_attempt_at', '<=', now),
            ]),
            eb.and([
              eb('status', '=', 'PROCESSING'),
              eb('locked_at', '<', staleThreshold),
            ]),
          ])
        )
        .orderBy('next_attempt_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();

      if (candidateJobs.length === 0) {
        return [];
      }

      const jobIds = candidateJobs.map((j) => j.id);

      await trx
        .updateTable('notifications')
        .set((eb) => ({
          status: 'PROCESSING',
          locked_at: now,
          locked_by: workerId,
          attempts: sql`${eb.ref('attempts')} + 1`,
          updated_at: now,
        }))
        .where('id', 'in', jobIds)
        .execute();

      return candidateJobs.map((j) => ({
        ...j,
        attempts: j.attempts + 1,
      }));
    });
  }

  /**
   * Marks a notification as successfully dispatched.
   */
  async markSent(
    notificationId: string,
    providerName: string,
    providerMessageId?: string,
    executor: DBConnection = db
  ) {
    const now = new Date();
    return await executor
      .updateTable('notifications')
      .set({
        status: 'SENT',
        provider_name: providerName,
        provider_message_id: providerMessageId || null,
        error_message: null,
        sent_at: now,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', notificationId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Schedules a retry with exponential backoff delay after transient failure.
   */
  async markRetry(
    notificationId: string,
    errorMessage: string,
    nextAttemptAt: Date,
    executor: DBConnection = db
  ) {
    const now = new Date();
    return await executor
      .updateTable('notifications')
      .set({
        status: 'QUEUED',
        error_message: errorMessage,
        next_attempt_at: nextAttemptAt,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', notificationId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Marks a notification permanently failed (exhausted retries or unrecoverable error).
   */
  async markPermanentFailure(
    notificationId: string,
    errorMessage: string,
    executor: DBConnection = db
  ) {
    const now = new Date();
    return await executor
      .updateTable('notifications')
      .set({
        status: 'FAILED',
        error_message: errorMessage,
        failed_at: now,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      })
      .where('id', '=', notificationId)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Retrieves operational metrics and recent failure log for admin inspection.
   */
  async getQueueMetrics(executor: DBConnection = db) {
    const [counts, recentFailures] = await Promise.all([
      executor
        .selectFrom('notifications')
        .select([
          sql<string>`COUNT(*) FILTER (WHERE status = 'QUEUED')`.as('queued'),
          sql<string>`COUNT(*) FILTER (WHERE status = 'PROCESSING')`.as('processing'),
          sql<string>`COUNT(*) FILTER (WHERE status = 'SENT')`.as('sent'),
          sql<string>`COUNT(*) FILTER (WHERE status = 'FAILED')`.as('failed'),
        ])
        .executeTakeFirst(),
      executor
        .selectFrom('notifications')
        .select([
          'id',
          'channel',
          'notification_type',
          'recipient',
          'attempts',
          'max_attempts',
          'error_message',
          'failed_at',
          'created_at',
        ])
        .where('status', '=', 'FAILED')
        .orderBy('failed_at', 'desc')
        .limit(20)
        .execute(),
    ]);

    return {
      queued: counts ? parseInt(counts.queued, 10) : 0,
      processing: counts ? parseInt(counts.processing, 10) : 0,
      sent: counts ? parseInt(counts.sent, 10) : 0,
      failed: counts ? parseInt(counts.failed, 10) : 0,
      recentFailures,
    };
  }

  /**
   * Finds notification by ID (for inspection/testing).
   */
  async findById(id: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('notifications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }
}

export const notificationRepository = new NotificationRepository();
