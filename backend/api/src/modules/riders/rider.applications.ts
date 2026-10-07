import { Router, type Request } from 'express';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database, RiderApprovalStatus } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone, publicPhone } from '../../utils/phone.js';
import { authService } from '../auth/auth.service.js';
import { authRateLimiter } from '../auth/auth.rate-limiter.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { notificationService } from '../notifications/notification.service.js';
import { optionalRegistrationSchema, refineRegistration, storeId, vehicleTypeSchema } from './rider.profile.js';

/**
 * Rider applications (migration 029, owner 2026-10-07).
 *
 *   1. In the Rider app the applicant asks for an SMS code (POST
 *      /auth/otp/request - unknown numbers get one) and sends it with their
 *      details to POST /riders/applications (public). The code is checked and
 *      consumed exactly as sign-in does. A new number becomes a RIDER account
 *      (no email, no password) with a riders row that is PENDING and switched
 *      off. No tokens are issued.
 *   2. Operations or Admin review the request under "Rider requests"
 *      (/admin/rider-applications): approve (the rider becomes active and
 *      assignable, and is sent an SMS) or reject with a reason.
 *   3. From then on the rider signs in with phone + SMS code only; PENDING and
 *      REJECTED riders are refused at sign-in (auth.service.ts).
 *
 * A PENDING or REJECTED rider never appears in the rider pickers, suggestions,
 * assignment, cash hand-ins or Staff accounts.
 */

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

const slPhone = (message: string) =>
  z
    .string({ required_error: 'Phone number is required.' })
    .trim()
    .min(1, 'Phone number is required.')
    .transform((raw, ctx) => {
      try {
        return normalizeSriLankanPhone(raw);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
    });

export const riderApplicationSchema = z.object({
  phone: slPhone('Phone must be a Sri Lankan mobile number, e.g. 077 123 4567'),
  otp: z
    .string({ required_error: 'OTP is required.' })
    .trim()
    .length(6, 'OTP must be exactly 6 digits.')
    .regex(/^[0-9]{6}$/, 'OTP must contain numeric digits only.'),
  full_name: z
    .string({ required_error: 'Full name is required.' })
    .trim()
    .min(2, 'Full name must be at least 2 characters.')
    .max(128, 'Full name must be at most 128 characters.'),
  vehicle_type: vehicleTypeSchema,
  // Required unless the vehicle is a BICYCLE (then optional, stored NULL).
  vehicle_registration_number: optionalRegistrationSchema,
  // Optional; '' or null means none. Stored normalised (+94...).
  emergency_contact_phone: z
    .union([z.literal(''), z.null(), slPhone('Emergency contact must be a Sri Lankan mobile number, e.g. 077 123 4567')])
    .optional()
    .transform((v) => (v ? v : null)),
}).superRefine(refineRegistration);
export type RiderApplicationInput = z.infer<typeof riderApplicationSchema>;

export const applicationStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const listApplicationsQuerySchema = z.object({
  status: z.enum(applicationStatuses, { errorMap: () => ({ message: 'Status must be PENDING, APPROVED or REJECTED' }) }).default('PENDING'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const applicationIdParamsSchema = z.object({
  id: z.string().uuid('Application id must be a valid UUID'),
});

export const rejectApplicationSchema = z
  .object({
    reason: z
      .string({ required_error: 'Reason is required.' })
      .trim()
      .min(1, 'Reason is required.')
      .max(500, 'Reason must be at most 500 characters.'),
  })
  .strict();

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

export interface RiderApplication {
  /** riders.id */
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
  approval_status: RiderApprovalStatus;
  applied_at: Date | null;
  reviewed_at: Date | null;
  reviewed_by_name: string | null;
  rejection_reason: string | null;
}

type Trx = Transaction<Database>;
type Executor = Trx | typeof db;

function applicationQuery(executor: Executor) {
  return executor
    .selectFrom('riders as r')
    .innerJoin('users as u', 'u.id', 'r.user_id')
    .leftJoin('users as rev', 'rev.id', 'r.reviewed_by')
    .select([
      'r.id',
      'r.user_id',
      'u.full_name',
      'u.phone',
      'r.vehicle_type',
      'r.vehicle_registration_number',
      'r.emergency_contact_phone',
      'r.approval_status',
      'r.applied_at',
      'r.reviewed_at',
      'rev.full_name as reviewed_by_name',
      'r.rejection_reason',
    ])
    .where('u.role', '=', 'RIDER')
    // Applications only: riders made before migration 029 (and staff
    // riders) have no applied_at and are not requests.
    .where('r.applied_at', 'is not', null);
}

const present = <T extends { phone: string }>(row: T) => ({ ...row, phone: publicPhone(row.phone) });

const notFound = () => new AppError('Rider request not found.', 404, 'RIDER_APPLICATION_NOT_FOUND');
const notPending = (status: string) =>
  new AppError(
    status === 'APPROVED' ? 'This request has already been approved.' : 'This request has already been rejected.',
    409,
    'APPLICATION_NOT_PENDING',
    { approval_status: status }
  );

/** SMS text stays short: one or two parts. */
const SMS_REASON_MAX = 120;

export const RIDER_APPROVED_SMS = "Blynk: you're approved as a rider. Sign in to the Blynk Rider app with this number.";
export const riderRejectedSms = (reason: string) => {
  const r = reason.length > SMS_REASON_MAX ? `${reason.slice(0, SMS_REASON_MAX - 3).trimEnd()}...` : reason;
  return `Blynk: your rider application wasn't approved. Reason: ${r}`;
};

export class RiderApplicationService {
  /**
   * POST /riders/applications. The SMS code is checked first (identical
   * answers to sign-in); everything else happens in one transaction that
   * also consumes the code - a refusal (409) leaves the code unused.
   */
  async apply(input: RiderApplicationInput, meta: { ipAddress?: string | null; userAgent?: string | null }) {
    authRateLimiter.checkLimit(
      `rider_apply_phone:${input.phone}`,
      5,
      60 * 60 * 1000,
      'Too many applications for this phone number. Please try again in 1 hour.'
    );
    authRateLimiter.checkLimit(
      `rider_apply_ip:${meta.ipAddress ?? 'unknown'}`,
      15,
      15 * 60 * 1000,
      'Too many applications from this device. Please wait before retrying.'
    );

    const otpId = await authService.checkOtp(input.phone, input.otp);

    try {
      return await db.transaction().execute(async (trx) => {
        const user = await trx
          .selectFrom('users')
          .select(['id', 'role'])
          .where('phone', '=', input.phone)
          .forUpdate()
          .executeTakeFirst();

        let userId: string;
        let riderId: string;
        let reapplied = false;
        const riderValues = {
          vehicle_type: input.vehicle_type,
          vehicle_registration_number: input.vehicle_registration_number,
          emergency_contact_phone: input.emergency_contact_phone,
        };

        if (user) {
          const rider =
            user.role === 'RIDER'
              ? await trx
                  .selectFrom('riders')
                  .select(['id', 'approval_status'])
                  .where('user_id', '=', user.id)
                  .forUpdate()
                  .executeTakeFirst()
              : undefined;
          if (!rider) {
            throw new AppError('This number is already used by another Blynk account.', 409, 'PHONE_IN_USE');
          }
          if (rider.approval_status === 'PENDING') {
            throw new AppError('Your application is already waiting for approval.', 409, 'APPLICATION_PENDING');
          }
          if (rider.approval_status === 'APPROVED') {
            throw new AppError('This number is already an approved rider. Sign in instead.', 409, 'ALREADY_APPROVED');
          }
          // REJECTED: apply again with the new details.
          await authService.consumeOtp(trx, input.phone, otpId);
          await trx
            .updateTable('users')
            .set({ full_name: input.full_name, phone_verified_at: sql`COALESCE(phone_verified_at, now())`, updated_at: sql`now()` })
            .where('id', '=', user.id)
            .execute();
          await trx
            .updateTable('riders')
            .set({
              ...riderValues,
              approval_status: 'PENDING',
              applied_at: sql<Date>`now()`,
              reviewed_at: null,
              reviewed_by: null,
              rejection_reason: null,
              is_active: false,
              is_available: false,
              updated_at: sql`now()`,
            })
            .where('id', '=', rider.id)
            .execute();
          userId = user.id;
          riderId = rider.id;
          reapplied = true;
        } else {
          await authService.consumeOtp(trx, input.phone, otpId);
          const created = await trx
            .insertInto('users')
            .values({
              phone: input.phone,
              full_name: input.full_name,
              role: 'RIDER',
              // The account itself is fine; the riders row stays switched off
              // until approved, and sign-in is refused while PENDING.
              is_active: true,
              phone_verified_at: sql<Date>`now()`,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const rider = await trx
            .insertInto('riders')
            .values({
              user_id: created.id,
              dark_store_id: await storeId(trx),
              ...riderValues,
              is_active: false,
              is_available: false,
              approval_status: 'PENDING',
              applied_at: sql<Date>`now()`,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          userId = created.id;
          riderId = rider.id;
        }

        await writeAudit(
          trx,
          { actorId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
          {
            action: 'RIDER_APPLIED',
            entityType: 'RIDER',
            entityId: riderId,
            newValues: { full_name: input.full_name, ...riderValues, reapplied },
          }
        );
        logger.info({ riderId, reapplied }, 'Rider application received');
        return { application: { status: 'PENDING' as const, full_name: input.full_name, phone: input.phone } };
      });
    } catch (err) {
      // Two applications for one new number at once meet at users.phone.
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === '23505') {
        throw new AppError('Your application is already waiting for approval.', 409, 'APPLICATION_PENDING');
      }
      throw err;
    }
  }

  async list(params: z.infer<typeof listApplicationsQuerySchema>) {
    const { status, page, limit } = params;
    const base = applicationQuery(db).where('r.approval_status', '=', status);
    const [{ total }] = await db
      .selectFrom('riders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(sql<number>`count(*)::int`.as('total'))
      .where('u.role', '=', 'RIDER')
      .where('r.applied_at', 'is not', null)
      .where('r.approval_status', '=', status)
      .execute();
    // The queue oldest first; decided requests newest decision first.
    const ordered =
      status === 'PENDING'
        ? base.orderBy('r.applied_at', 'asc')
        : base.orderBy(sql`r.reviewed_at DESC NULLS LAST`).orderBy('r.applied_at', 'desc');
    const rows = await ordered
      .orderBy('r.id')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute();
    return {
      applications: rows.map(present),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
  }

  async countPending(): Promise<{ pending: number }> {
    const row = await db
      .selectFrom('riders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('u.role', '=', 'RIDER')
      .where('r.approval_status', '=', 'PENDING')
      .where('r.applied_at', 'is not', null)
      .executeTakeFirstOrThrow();
    return { pending: row.n };
  }

  private async lockPending(trx: Trx, id: string) {
    const row = await trx
      .selectFrom('riders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.id', 'r.user_id', 'r.approval_status', 'u.phone', 'u.role'])
      .where('r.id', '=', id)
      .where('r.applied_at', 'is not', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.role !== 'RIDER') throw notFound();
    if (row.approval_status !== 'PENDING') throw notPending(row.approval_status);
    return row;
  }

  /** Approve: the rider becomes active and assignable and is sent an SMS. */
  async approve(id: string, actor: AuditActor): Promise<RiderApplication> {
    return db.transaction().execute(async (trx) => {
      const row = await this.lockPending(trx, id);
      const { reviewed_at } = await trx
        .updateTable('riders')
        .set({
          approval_status: 'APPROVED',
          reviewed_at: sql<Date>`now()`,
          reviewed_by: actor.actorId,
          rejection_reason: null,
          is_active: true,
          is_available: true,
          updated_at: sql`now()`,
        })
        .where('id', '=', id)
        .returning('reviewed_at')
        .executeTakeFirstOrThrow();
      await trx.updateTable('users').set({ is_active: true, updated_at: sql`now()` }).where('id', '=', row.user_id).execute();
      await notificationService.enqueue(
        {
          user_id: row.user_id,
          channel: 'SMS',
          notification_type: 'RIDER_APPROVED',
          recipient: row.phone,
          idempotency_key: `rider-approved:${id}:${reviewed_at!.getTime()}`,
          payload: { text: RIDER_APPROVED_SMS },
        },
        trx
      );
      await writeAudit(trx, actor, {
        action: 'RIDER_APPROVED',
        entityType: 'RIDER',
        entityId: id,
        oldValues: { approval_status: 'PENDING' },
        newValues: { approval_status: 'APPROVED', user_id: row.user_id },
      });
      logger.info({ riderId: id, by: actor.actorId }, 'Rider application approved');
      return present(await applicationQuery(trx).where('r.id', '=', id).executeTakeFirstOrThrow());
    });
  }

  /** Reject with a reason (shown to the rider at sign-in, and sent by SMS). */
  async reject(id: string, reason: string, actor: AuditActor): Promise<RiderApplication> {
    return db.transaction().execute(async (trx) => {
      const row = await this.lockPending(trx, id);
      const { reviewed_at } = await trx
        .updateTable('riders')
        .set({
          approval_status: 'REJECTED',
          reviewed_at: sql<Date>`now()`,
          reviewed_by: actor.actorId,
          rejection_reason: reason,
          is_active: false,
          is_available: false,
          updated_at: sql`now()`,
        })
        .where('id', '=', id)
        .returning('reviewed_at')
        .executeTakeFirstOrThrow();
      await notificationService.enqueue(
        {
          user_id: row.user_id,
          channel: 'SMS',
          notification_type: 'RIDER_REJECTED',
          recipient: row.phone,
          idempotency_key: `rider-rejected:${id}:${reviewed_at!.getTime()}`,
          payload: { text: riderRejectedSms(reason) },
        },
        trx
      );
      await writeAudit(trx, actor, {
        action: 'RIDER_REJECTED',
        entityType: 'RIDER',
        entityId: id,
        oldValues: { approval_status: 'PENDING' },
        newValues: { approval_status: 'REJECTED', rejection_reason: reason, user_id: row.user_id },
      });
      logger.info({ riderId: id, by: actor.actorId }, 'Rider application rejected');
      return present(await applicationQuery(trx).where('r.id', '=', id).executeTakeFirstOrThrow());
    });
  }
}

export const riderApplicationService = new RiderApplicationService();

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

const clientIp = (req: Request) =>
  req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Public: mounted on the riders router (POST /riders/applications). */
export const riderApplicationsPublicRouter = Router();
riderApplicationsPublicRouter.post('/applications', validate({ body: riderApplicationSchema }), async (req, res, next) => {
  try {
    const result = await riderApplicationService.apply(req.body as RiderApplicationInput, {
      ipAddress: clientIp(req),
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** Review: mounted under /admin (ADMIN and OPERATIONS). */
export const adminRiderApplicationsRouter = Router();
const REVIEWERS = requireRoles(['ADMIN', 'OPERATIONS']);

adminRiderApplicationsRouter.get('/rider-applications/count', requireAuth, REVIEWERS, async (_req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await riderApplicationService.countPending() });
  } catch (err) {
    next(err);
  }
});

adminRiderApplicationsRouter.get(
  '/rider-applications',
  requireAuth,
  REVIEWERS,
  validate({ query: listApplicationsQuerySchema }),
  async (req, res, next) => {
    try {
      const data = await riderApplicationService.list(req.query as unknown as z.infer<typeof listApplicationsQuerySchema>);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

adminRiderApplicationsRouter.post(
  '/rider-applications/:id/approve',
  requireAuth,
  REVIEWERS,
  validate({ params: applicationIdParamsSchema }),
  async (req, res, next) => {
    try {
      const application = await riderApplicationService.approve(req.params.id as string, actorOf(req));
      res.status(200).json({ success: true, data: { application } });
    } catch (err) {
      next(err);
    }
  }
);

adminRiderApplicationsRouter.post(
  '/rider-applications/:id/reject',
  requireAuth,
  REVIEWERS,
  validate({ params: applicationIdParamsSchema, body: rejectApplicationSchema }),
  async (req, res, next) => {
    try {
      const application = await riderApplicationService.reject(req.params.id as string, req.body.reason, actorOf(req));
      res.status(200).json({ success: true, data: { application } });
    } catch (err) {
      next(err);
    }
  }
);
