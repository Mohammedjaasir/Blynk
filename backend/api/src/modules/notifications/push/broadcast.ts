import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../../database/connection.js';
import { requireAuth } from '../../../middleware/auth.middleware.js';
import { requireRoles } from '../../../middleware/role.middleware.js';
import { AppError } from '../../../middleware/error.middleware.js';
import { logger } from '../../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../../audit/audit.writer.js';
import { isPushEnabled } from './push.sender.js';

/**
 * A push notification to every customer who allowed notifications (owner, 2026-10-19: "I must be
 * able to send notifications to the people who installed like store is open now, start
 * ordering" - from Admin, the backup admin and the Ops app).
 *
 * One PUSH outbox row per active CUSTOMER with at least one registered device; the outbox worker
 * sends each to all of that customer's devices (push.provider.ts). Only customers who allowed
 * notifications while signed in have a device; guests are not reachable by push.
 *
 * Staff:  GET  /admin/push-broadcasts/audience  -> { push_enabled, customers, devices }
 *         POST /admin/push-broadcasts           -> { title, body, image_url? } queues the push (audited
 *                                                  PUSH_BROADCAST_SENT); refused for 2 minutes
 *                                                  after another one (a double tap).
 *         GET  /admin/push-broadcasts           -> the last 20 sent
 * ADMIN and OPERATIONS.
 *
 * A picture (owner, 2026-10-24: a big-picture notification like PickMe's): `image_url`, an https
 * address the phone can load (Admin / Ops upload one), is shown under the text - Android's big
 * picture, and the image of a web push.
 */
export const PUSH_BROADCAST_TYPE = 'PUSH_BROADCAST';
export const BROADCAST_LIMITS = { titleChars: 60, bodyChars: 180, imageChars: 500, cooldownMs: 2 * 60 * 1000 } as const;

const oneLine = /^[^\r\n\t]*$/;
export const broadcastSchema = z
  .object({
    title: z
      .string({ required_error: 'Write a title', invalid_type_error: 'The title must be text' })
      .trim()
      .min(2, 'The title needs at least 2 characters')
      .max(BROADCAST_LIMITS.titleChars, `The title can be at most ${BROADCAST_LIMITS.titleChars} characters`)
      .regex(oneLine, 'The title must be on one line'),
    body: z
      .string({ required_error: 'Write the message', invalid_type_error: 'The message must be text' })
      .trim()
      .min(2, 'The message needs at least 2 characters')
      .max(BROADCAST_LIMITS.bodyChars, `The message can be at most ${BROADCAST_LIMITS.bodyChars} characters`),
    image_url: z
      .string({ invalid_type_error: 'The picture must be a web address' })
      .trim()
      .max(BROADCAST_LIMITS.imageChars, 'The picture address is too long')
      .refine((v) => /^https:\/\/[^\s]+$/i.test(v), 'The picture must be an https:// address')
      .nullish()
      .transform((v) => v || null),
  })
  .strict();

const audienceQuery = () =>
  db
    .selectFrom('device_tokens as d')
    .innerJoin('users as u', 'u.id', 'd.user_id')
    .where('u.role', '=', 'CUSTOMER')
    .where('u.is_active', '=', true);

export async function broadcastAudience(): Promise<{ push_enabled: boolean; customers: number; devices: number }> {
  const row = await audienceQuery()
    .select([sql<number>`count(DISTINCT u.id)::int`.as('customers'), sql<number>`count(*)::int`.as('devices')])
    .executeTakeFirst();
  return { push_enabled: isPushEnabled(), customers: row?.customers ?? 0, devices: row?.devices ?? 0 };
}

export async function sendBroadcast(input: z.infer<typeof broadcastSchema>, actor: AuditActor): Promise<{ id: string; queued: number }> {
  if (!isPushEnabled()) {
    throw new AppError(
      'Push notifications are not set up on the server (FIREBASE_SERVICE_ACCOUNT_JSON), so nothing can be sent.',
      409,
      'PUSH_NOT_CONFIGURED'
    );
  }
  const id = randomUUID();
  return await db.transaction().execute(async (trx) => {
    // one broadcast at a time, and never twice within the cooldown (a double tap, two staff at once)
    await sql`SELECT pg_advisory_xact_lock(hashtext('push_broadcast'))`.execute(trx);
    const last = await trx
      .selectFrom('audit_logs')
      .select('created_at')
      .where('action', '=', 'PUSH_BROADCAST_SENT')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (last && Date.now() - new Date(last.created_at).getTime() < BROADCAST_LIMITS.cooldownMs) {
      throw new AppError('A notification was sent less than 2 minutes ago. Wait a moment before sending another.', 409, 'BROADCAST_TOO_SOON');
    }
    const payload = JSON.stringify({
      title: input.title,
      body: input.body,
      ...(input.image_url ? { image: input.image_url } : {}),
      data: { kind: 'broadcast', broadcast_id: id },
    });
    const res = await sql<{ n: number }>`
      WITH ins AS (
        INSERT INTO notifications (user_id, channel, notification_type, recipient, payload, status, max_attempts, idempotency_key)
        SELECT DISTINCT u.id, 'PUSH'::notification_channel_enum, ${PUSH_BROADCAST_TYPE}, u.id::text, ${payload}::jsonb,
               'QUEUED'::notification_status_enum, 3, ${`broadcast:${id}:`} || u.id::text
        FROM device_tokens d JOIN users u ON u.id = d.user_id
        WHERE u.role = 'CUSTOMER' AND u.is_active = true
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM ins`.execute(trx);
    const queued = res.rows[0]?.n ?? 0;
    await writeAudit(trx, actor, {
      action: 'PUSH_BROADCAST_SENT',
      entityType: 'PUSH_BROADCAST',
      entityId: SETTINGS_ENTITY_ID,
      newValues: { broadcast_id: id, title: input.title, body: input.body, image_url: input.image_url, queued },
    });
    logger.info({ actorId: actor.actorId, broadcastId: id, queued }, 'Push broadcast queued');
    return { id, queued };
  });
}

export async function recentBroadcasts() {
  const rows = await db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .select(['a.created_at', 'a.new_values', 'u.full_name', 'u.email'])
    .where('a.action', '=', 'PUSH_BROADCAST_SENT')
    .orderBy('a.created_at', 'desc')
    .limit(20)
    .execute();
  return rows.map((r) => {
    const v = (typeof r.new_values === 'string' ? JSON.parse(r.new_values) : r.new_values ?? {}) as Record<string, unknown>;
    return {
      id: String(v.broadcast_id ?? ''),
      title: String(v.title ?? ''),
      body: String(v.body ?? ''),
      image_url: typeof v.image_url === 'string' && v.image_url ? v.image_url : null,
      queued: Number(v.queued ?? 0),
      sent_at: r.created_at,
      sent_by: r.full_name ?? r.email ?? null,
    };
  });
}

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const adminPushBroadcastRouter = Router();
const staff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];

adminPushBroadcastRouter.get('/push-broadcasts/audience', ...staff, async (_req, res, next) => {
  try {
    res.json({ success: true, data: await broadcastAudience() });
  } catch (err) {
    next(err);
  }
});

adminPushBroadcastRouter.get('/push-broadcasts', ...staff, async (_req, res, next) => {
  try {
    res.json({ success: true, data: { broadcasts: await recentBroadcasts() } });
  } catch (err) {
    next(err);
  }
});

adminPushBroadcastRouter.post('/push-broadcasts', ...staff, async (req, res, next) => {
  try {
    const input = broadcastSchema.parse(req.body);
    res.status(201).json({ success: true, data: await sendBroadcast(input, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});
