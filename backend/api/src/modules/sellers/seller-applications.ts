import { createHmac } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import type { SellerApplicationStatus } from '../../database/types.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { AppError } from '../../middleware/error.middleware.js';
import { clientIp } from '../../utils/client-ip.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { authRateLimiter } from '../auth/auth.rate-limiter.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { bestEffort, enqueuePush, PUSH_TYPES } from '../notifications/push/push.repository.js';
import { isPushEnabled } from '../notifications/push/push.sender.js';
import { hasSellerApplicationsTable, sellerApplicationsNotReady } from './seller-applications.ready.js';

/**
 * Seller applications (migration 064; owner's brother, 2026-10-27: "one form inside blynk.lk saying
 * apply for seller registration; once they submit we receive the application, then we contact them
 * directly by phone").
 *
 * Public (no account), the form at blynk.lk/seller:
 *   POST /seller-applications  { shop_name, owner_name, phone, town, what_they_sell, email?, message?, website? }
 *        strict body; `website` is a honeypot (filled -> 200 and nothing stored); a Sri Lankan mobile
 *        number; 5 per address per hour (429 TOO_MANY_REQUESTS); the same number applying again while
 *        its application is NEW or CONTACTED -> 200 without a second row. -> 200 { received: true } only.
 *        503 SELLER_APPLICATIONS_NOT_READY until migration 064 has run.
 * Staff (ADMIN, OPERATIONS):
 *   GET   /admin/seller-applications?status=&limit=  newest first, NEW first -> { applications, new_count }
 *   PATCH /admin/seller-applications/:id  { status?, staff_note? }  audited, sets handled_by / handled_at
 *         -> { application, new_count }
 * Each new application queues a push "New seller application" ("<shop> (<town>)") to every Admin /
 * Operations device; a failure there never fails the request.
 */

export const SELLER_APPLICATION_STATUSES: readonly SellerApplicationStatus[] = ['NEW', 'CONTACTED', 'APPROVED', 'DECLINED'];
export const SELLER_APPLICATION_LIMITS = {
  perIpPerHour: 5,
  shopName: 80,
  ownerName: 80,
  town: 60,
  whatTheySell: 500,
  email: 120,
  message: 1000,
  staffNote: 500,
  listMax: 500,
  listDefault: 200,
} as const;
export const SELLER_APPLICATION_AUDIT = 'SELLER_APPLICATION_UPDATED';

const text = (label: string, min: number, max: number) =>
  z
    .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} is required.` : `${label} needs at least ${min} characters.`)
        .max(max, `${label} can be at most ${max} characters.`)
    );
const optionalText = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} must be text.` })
    .trim()
    .max(max, `${label} can be at most ${max} characters.`)
    .nullish()
    .transform((v) => v || null);

export const sellerApplicationSchema = z
  .object({
    shop_name: text('Shop name', 2, SELLER_APPLICATION_LIMITS.shopName),
    owner_name: text('Your name', 2, SELLER_APPLICATION_LIMITS.ownerName),
    phone: z
      .string({ required_error: 'Phone number is required.', invalid_type_error: 'Phone number must be text.' })
      .trim()
      .min(1, 'Phone number is required.')
      .transform((raw, ctx) => {
        try {
          return normalizeSriLankanPhone(raw);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567' });
          return z.NEVER;
        }
      }),
    town: text('Town', 2, SELLER_APPLICATION_LIMITS.town),
    what_they_sell: z
      .string({ required_error: 'Tell us what you sell.', invalid_type_error: 'What you sell must be text.' })
      .trim()
      .min(3, 'Tell us what you sell (at least 3 characters).')
      .max(SELLER_APPLICATION_LIMITS.whatTheySell, `What you sell can be at most ${SELLER_APPLICATION_LIMITS.whatTheySell} characters.`),
    email: z
      .string({ invalid_type_error: 'Email must be text.' })
      .trim()
      .max(SELLER_APPLICATION_LIMITS.email, `Email can be at most ${SELLER_APPLICATION_LIMITS.email} characters.`)
      .nullish()
      .transform((v) => v || null)
      .pipe(z.string().email('Enter a valid email address, or leave it empty.').nullable()),
    message: optionalText('Message', SELLER_APPLICATION_LIMITS.message),
    /** Honeypot: a person never sees this field. */
    website: z.union([z.string().max(2000), z.null()]).optional(),
  })
  .strict();

const statusSchema = z.enum(SELLER_APPLICATION_STATUSES as [SellerApplicationStatus, ...SellerApplicationStatus[]], {
  errorMap: () => ({ message: `The status must be one of ${SELLER_APPLICATION_STATUSES.join(', ')}` }),
});

const listQuerySchema = z.object({
  status: z.preprocess((v) => (v === '' ? undefined : typeof v === 'string' ? v.toUpperCase() : v), statusSchema.optional()),
  limit: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(SELLER_APPLICATION_LIMITS.listMax).default(SELLER_APPLICATION_LIMITS.listDefault)
  ),
});

const patchSchema = z
  .object({
    status: statusSchema.optional(),
    staff_note: z
      .string({ invalid_type_error: 'The note must be text' })
      .trim()
      .max(SELLER_APPLICATION_LIMITS.staffNote, `The note can be at most ${SELLER_APPLICATION_LIMITS.staffNote} characters`)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.staff_note !== undefined, { message: 'Send a status or a staff_note.' });

// ----------------------------------------------------------------------------
// Public side
// ----------------------------------------------------------------------------

/** A keyed hash of the sender's address: enough to trace a spammer, useless to recover the address. */
const hashIp = (ip: string | null): string | null =>
  ip ? createHmac('sha256', env.JWT_ACCESS_SECRET).update(`seller-application:${ip}`).digest('hex') : null;

export async function submitSellerApplication(raw: unknown, ip: string | null): Promise<{ received: true }> {
  const input = sellerApplicationSchema.parse(raw);

  authRateLimiter.checkLimits([
    {
      key: `seller_application_ip:${ip ?? 'unknown'}`,
      max: SELLER_APPLICATION_LIMITS.perIpPerHour,
      windowMs: 60 * 60 * 1000,
      message: 'Too many applications from this device. Please try again later, or call or WhatsApp us.',
    },
  ]);

  // a bot filled the hidden field: look like success, store nothing
  if (typeof input.website === 'string' && input.website.trim() !== '') return { received: true };

  await db.transaction().execute(async (trx) => {
    // one at a time per number, so two quick taps never make two rows
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`seller_application:${input.phone}`}))`.execute(trx);
    const open = await trx
      .selectFrom('seller_applications')
      .select('id')
      .where('phone', '=', input.phone)
      .where('status', 'in', ['NEW', 'CONTACTED'])
      .limit(1)
      .executeTakeFirst();
    if (open) return; // already waiting: answer as if received, no second row

    const row = await trx
      .insertInto('seller_applications')
      .values({
        shop_name: input.shop_name,
        owner_name: input.owner_name,
        phone: input.phone,
        email: input.email,
        town: input.town,
        what_they_sell: input.what_they_sell,
        message: input.message,
        source: 'WEBSITE',
        ip_hash: hashIp(ip),
      })
      .returning(['id', 'shop_name', 'town'])
      .executeTakeFirstOrThrow();

    if (!isPushEnabled()) return;
    await bestEffort(
      trx,
      async () => {
        const staff = await trx
          .selectFrom('users as u')
          .select('u.id')
          .where('u.role', 'in', ['ADMIN', 'OPERATIONS'])
          .where('u.is_active', '=', true)
          .where((eb) => eb.exists(eb.selectFrom('device_tokens as d').select('d.id').whereRef('d.user_id', '=', 'u.id')))
          .execute();
        for (const s of staff) {
          await enqueuePush(trx, {
            userId: s.id,
            type: PUSH_TYPES.SELLER_APPLICATION,
            idempotencyKey: `seller-application:${row.id}:${s.id}`,
            payload: {
              title: 'New seller application',
              body: `${row.shop_name} (${row.town})`,
              data: { type: 'staff_seller_application', application_id: row.id },
            },
          });
        }
      },
      (err) => logger.error({ err, applicationId: row.id }, 'Could not queue the seller-application staff push; the application stands')
    );
  });
  return { received: true };
}

// ----------------------------------------------------------------------------
// Staff side
// ----------------------------------------------------------------------------

interface ApplicationRow {
  id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  email: string | null;
  town: string;
  what_they_sell: string;
  message: string | null;
  status: SellerApplicationStatus;
  staff_note: string | null;
  handled_by: string | null;
  handled_by_name: string | null;
  handled_at: Date | null;
  source: string;
  created_at: Date;
  updated_at: Date;
}

const staffColumns = sql`a.id, a.shop_name, a.owner_name, a.phone, a.email, a.town, a.what_they_sell, a.message,
  a.status, a.staff_note, a.handled_by, u.full_name AS handled_by_name, a.handled_at, a.source, a.created_at, a.updated_at`;

async function newCount(): Promise<number> {
  const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM seller_applications WHERE status = 'NEW'`.execute(db);
  return r.rows[0]?.n ?? 0;
}

export async function listSellerApplications(query: unknown) {
  const q = listQuerySchema.parse(query ?? {});
  const r = await sql<ApplicationRow>`
    SELECT ${staffColumns}
    FROM seller_applications a
    LEFT JOIN users u ON u.id = a.handled_by
    WHERE ${q.status ? sql`a.status = ${q.status}` : sql`true`}
    ORDER BY (a.status = 'NEW') DESC, a.created_at DESC, a.id
    LIMIT ${q.limit}`.execute(db);
  return { applications: r.rows, new_count: await newCount() };
}

export async function updateSellerApplication(id: string, raw: unknown, actor: AuditActor) {
  const input = patchSchema.parse(raw);
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('That application was not found.', 404, 'SELLER_APPLICATION_NOT_FOUND');
  }
  await db.transaction().execute(async (trx) => {
    const before = await trx
      .selectFrom('seller_applications')
      .select(['id', 'status', 'staff_note'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!before) throw new AppError('That application was not found.', 404, 'SELLER_APPLICATION_NOT_FOUND');
    const now = new Date();
    await trx
      .updateTable('seller_applications')
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.staff_note !== undefined ? { staff_note: input.staff_note } : {}),
        handled_by: actor.actorId,
        handled_at: now,
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: SELLER_APPLICATION_AUDIT,
      entityType: 'seller_application',
      entityId: id,
      oldValues: { status: before.status, staff_note: before.staff_note },
      newValues: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.staff_note !== undefined ? { staff_note: input.staff_note } : {}),
      },
    });
  });
  const r = await sql<ApplicationRow>`
    SELECT ${staffColumns} FROM seller_applications a LEFT JOIN users u ON u.id = a.handled_by WHERE a.id = ${id}`.execute(db);
  return { application: r.rows[0], new_count: await newCount() };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

/** 503 SELLER_APPLICATIONS_NOT_READY until migration 064 has run. */
const ready = (_req: Request, _res: Response, next: NextFunction) => {
  hasSellerApplicationsTable()
    .then((ok) => next(ok ? undefined : sellerApplicationsNotReady()))
    .catch(() => next(sellerApplicationsNotReady()));
};

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Mounted at /seller-applications (public). */
export const sellerApplicationsRouter = Router();
sellerApplicationsRouter.post(
  '/',
  ready,
  wrap(async (req, res) => {
    res.json({ success: true, data: await submitSellerApplication(req.body, clientIp(req)) });
  })
);

/** Mounted at /admin. */
export const adminSellerApplicationsRouter = Router();
const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), ready];
adminSellerApplicationsRouter.get(
  '/seller-applications',
  ...STAFF,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listSellerApplications(req.query) });
  })
);
adminSellerApplicationsRouter.patch(
  '/seller-applications/:id',
  ...STAFF,
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateSellerApplication(String(req.params.id), req.body, actorOf(req)) });
  })
);
