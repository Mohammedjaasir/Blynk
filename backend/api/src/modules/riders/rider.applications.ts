import { Router, type Request } from 'express';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database, RiderApprovalStatus, RiderPayModel, RiderPayType, UserRole } from '../../database/types.js';
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
import { approvePaySchema, payValues, type ApprovePayInput } from './rider.pay.js';
import { optionalRegistrationSchema, refineRegistration, storeId, vehicleTypeSchema } from './rider.profile.js';
import { requireApplicant, riderDocumentService } from './rider.documents.js';
import { riderDocumentStore } from './rider.documents.files.js';

/**
 * Rider applications (migration 029, owner 2026-10-07).
 *
 *   1. In the Rider app the applicant asks for an SMS code (POST
 *      /auth/otp/request - unknown numbers get one) and sends it with their
 *      details to POST /riders/applications (public). The code is checked and
 *      consumed exactly as sign-in does. One number is one account (owner,
 *      2026-10-07): a new number becomes a CUSTOMER account, and an existing
 *      customer applies with the number they shop with. Either way a riders
 *      row is added, PENDING and switched off; the person keeps shopping.
 *      An Operations number is told to use "Deliver orders myself" instead.
 *      No tokens are issued.
 *   2. Operations or Admin review the request under "Rider requests"
 *      (/admin/rider-applications): approve (the rider becomes active and
 *      assignable, the account becomes RIDER - which still shops - and an
 *      SMS is sent) or reject with a reason.
 *   3. From then on the rider signs in with phone + SMS code only; PENDING and
 *      REJECTED applicants are refused by the Rider app's sign-in
 *      (auth.service.ts, app: 'rider') but still sign in to shop.
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

/**
 * Rider documents (migration 039; owner, 2026-10-10): the Rider app proves
 * the phone once (POST /riders/applications/session -> applicant token),
 * uploads the documents, then sends the details to POST
 * /riders/applications/submit with that token instead of phone + SMS code.
 */
export const riderApplicationSessionSchema = z
  .object({
    full_name: z
      .string({ required_error: 'Full name is required.' })
      .trim()
      .min(2, 'Full name must be at least 2 characters.')
      .max(128, 'Full name must be at most 128 characters.'),
    vehicle_type: vehicleTypeSchema,
    vehicle_registration_number: optionalRegistrationSchema,
    emergency_contact_phone: z
      .union([z.literal(''), z.null(), slPhone('Emergency contact must be a Sri Lankan mobile number, e.g. 077 123 4567')])
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .superRefine(refineRegistration);
export type RiderApplicationDetails = z.infer<typeof riderApplicationSessionSchema>;

/**
 * Approve body: the rider pay fields (rider.pay.ts) plus, for an ADMIN only,
 * "Approve anyway" when a required document is not verified (owner,
 * 2026-10-10) - with a reason, audited. OPERATIONS cannot override.
 */
export const approveApplicationSchema = approvePaySchema
  .removeDefault()
  .extend({
    override_documents: z.boolean({ invalid_type_error: 'override_documents must be true or false' }).optional(),
    override_reason: z.string().trim().max(500, 'Reason must be at most 500 characters.').optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.override_documents && (!v.override_reason || v.override_reason.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['override_reason'],
        message: 'Say why the rider is approved without verified documents.',
      });
    }
  })
  .default({});
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;

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
  /** Migration 032 (owner, 2026-10-09): how the rider is paid once approved. */
  pay_type: RiderPayType;
  /** The rider's own share of the delivery charge; null = the store default. */
  commission_percent: number | null;
  /** Migration 038 (owner, 2026-10-10): the rider's own pay model; null = the store default. */
  pay_model: RiderPayModel | null;
}

type Trx = Transaction<Database>;

/** A rider applicant's account: CUSTOMER until approved, then RIDER. */
const APPLICANT_ROLES: UserRole[] = ['CUSTOMER', 'RIDER'];
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
      'r.pay_type',
      'r.commission_percent',
      'r.pay_model',
    ])
    .where('u.role', 'in', APPLICANT_ROLES)
    // Applications only: riders made before migration 029 (and staff
    // riders) have no applied_at and are not requests.
    .where('r.applied_at', 'is not', null);
}

const present = <T extends { phone: string; commission_percent: unknown }>(row: T) => ({
  ...row,
  phone: publicPhone(row.phone),
  commission_percent: row.commission_percent === null ? null : Number(row.commission_percent),
});

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
  async apply(
    input: RiderApplicationDetails & { phone: string; otp?: string },
    meta: { ipAddress?: string | null; userAgent?: string | null },
    /** 'session': the phone was proved by an applicant token (rider.documents.ts), no code here. */
    proof: 'otp' | 'session' = 'otp'
  ) {
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

    const otpId = proof === 'otp' ? await authService.checkOtp(input.phone, input.otp ?? '') : null;
    const consume = (trx: Trx) => (otpId ? authService.consumeOtp(trx, input.phone, otpId) : Promise.resolve());
    let replacedDocuments: string[] = [];

    try {
      const result = await db.transaction().execute(async (trx) => {
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

        if (user && user.role === 'OPERATIONS') {
          throw new AppError(
            'This number is an Operations account. Use "Deliver orders myself" in the Ops app instead.',
            409,
            'STAFF_CAN_DELIVER'
          );
        }
        if (user && !APPLICANT_ROLES.includes(user.role)) {
          throw new AppError('This number is already used by another Blynk account.', 409, 'PHONE_IN_USE');
        }
        const rider = user
          ? await trx
              .selectFrom('riders')
              .select(['id', 'approval_status'])
              .where('user_id', '=', user.id)
              .forUpdate()
              .executeTakeFirst()
          : undefined;

        if (user && !rider) {
          // A customer applies with the number they already shop with: the
          // account stays CUSTOMER (and keeps shopping) until approved.
          await consume(trx);
          await trx
            .updateTable('users')
            .set({ full_name: input.full_name, phone_verified_at: sql`COALESCE(phone_verified_at, now())`, updated_at: sql`now()` })
            .where('id', '=', user.id)
            .execute();
          const created = await trx
            .insertInto('riders')
            .values({
              user_id: user.id,
              dark_store_id: await storeId(trx),
              ...riderValues,
              is_active: false,
              is_available: false,
              approval_status: 'PENDING',
              applied_at: sql<Date>`now()`,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          userId = user.id;
          riderId = created.id;
        } else if (user && rider) {
          if (rider.approval_status === 'PENDING') {
            throw new AppError('Your application is already waiting for approval.', 409, 'APPLICATION_PENDING');
          }
          if (rider.approval_status === 'APPROVED') {
            throw new AppError('This number is already an approved rider. Sign in instead.', 409, 'ALREADY_APPROVED');
          }
          // REJECTED: apply again with the new details.
          await consume(trx);
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
          await consume(trx);
          const created = await trx
            .insertInto('users')
            .values({
              phone: input.phone,
              full_name: input.full_name,
              // A customer account that can shop at once; approval makes it
              // RIDER. The riders row stays switched off until then.
              role: 'CUSTOMER',
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

        // Rider documents (migration 039; owner, 2026-10-10): the drafts move
        // onto this application, and it is refused (DOCUMENTS_REQUIRED, the
        // whole transaction - and the SMS code - rolled back) unless every
        // required document for this vehicle is there.
        replacedDocuments = await riderDocumentService.attachDraftsAndCheck(trx, input.phone, riderId, input.vehicle_type);

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
      await riderDocumentStore.removeDocumentsQuietly(replacedDocuments);
      return result;
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
      .where('u.role', 'in', APPLICANT_ROLES)
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
    // Rider documents (migration 039; owner, 2026-10-10): each request's
    // documents and whether every required one is verified (Approve button).
    const docs = await riderDocumentService.summariesFor(rows.map((r) => ({ id: r.id, vehicle_type: r.vehicle_type })));
    return {
      applications: rows.map((r) => {
        const d = docs.get(r.id)!;
        return {
          ...present(r),
          documents: d.documents,
          document_requirements: d.requirements,
          documents_blocking: d.blocking,
          documents_verified: d.all_required_verified,
        };
      }),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    };
  }

  async countPending(): Promise<{ pending: number }> {
    const row = await db
      .selectFrom('riders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('u.role', 'in', APPLICANT_ROLES)
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
    if (!row || !APPLICANT_ROLES.includes(row.role)) throw notFound();
    if (row.approval_status !== 'PENDING') throw notPending(row.approval_status);
    return row;
  }

  /**
   * Approve: the rider becomes active and assignable and is sent an SMS.
   * Rider pay (owner, 2026-10-09): the approver picks COMPANY or COMMISSION
   * (and optionally the rider's own share); without a pay_type the rider is
   * COMPANY, the column default.
   */
  async approve(
    id: string,
    actor: AuditActor,
    body: ApproveApplicationInput = {},
    actorRole: UserRole = 'ADMIN'
  ): Promise<RiderApplication> {
    const { override_documents, override_reason, ...pay } = body as ApproveApplicationInput & ApprovePayInput;
    return db.transaction().execute(async (trx) => {
      const row = await this.lockPending(trx, id);
      // Rider documents (owner, 2026-10-10): every required document must be
      // verified and not expired. Only an ADMIN may "approve anyway", with a
      // reason - recorded on the approval's audit entry and an entry of its own.
      const { vehicle_type } = await trx.selectFrom('riders').select('vehicle_type').where('id', '=', id).executeTakeFirstOrThrow();
      const blocking = await riderDocumentService.blockingForApproval(trx, id, vehicle_type);
      let documentsOverride: { reason: string; blocking: typeof blocking } | null = null;
      if (blocking.length) {
        if (!override_documents) {
          throw new AppError(
            `Verify these documents first: ${blocking.map((b) => b.label).join(', ')}.`,
            409,
            'DOCUMENTS_NOT_VERIFIED',
            { blocking }
          );
        }
        if (actorRole !== 'ADMIN') {
          throw new AppError('Only an Admin can approve a rider whose documents are not all verified.', 403, 'OVERRIDE_ADMIN_ONLY');
        }
        documentsOverride = { reason: override_reason as string, blocking };
        await writeAudit(trx, actor, {
          action: 'RIDER_APPROVAL_DOCUMENTS_OVERRIDDEN',
          entityType: 'RIDER',
          entityId: id,
          newValues: { reason: override_reason, blocking },
        });
      }
      // Pay controls (migration 038; owner, 2026-10-10): the approver may pick the rider's own model too.
      const payFields = pay.pay_type ? payValues({ ...pay, pay_type: pay.pay_type }) : {};
      const { reviewed_at } = await trx
        .updateTable('riders')
        .set({
          approval_status: 'APPROVED',
          reviewed_at: sql<Date>`now()`,
          reviewed_by: actor.actorId,
          rejection_reason: null,
          is_active: true,
          is_available: true,
          ...payFields,
          updated_at: sql`now()`,
        })
        .where('id', '=', id)
        .returning('reviewed_at')
        .executeTakeFirstOrThrow();
      // A customer who applied becomes a RIDER account - which still shops
      // (SHOPPER_ROLES) - so the Rider app lets them in.
      await trx
        .updateTable('users')
        .set({ is_active: true, role: 'RIDER', updated_at: sql`now()` })
        .where('id', '=', row.user_id)
        .execute();
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
        newValues: {
          approval_status: 'APPROVED',
          user_id: row.user_id,
          ...payFields,
          ...(documentsOverride ? { documents_override: documentsOverride } : {}),
        },
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

/**
 * DELETE /admin/rider-applications/:id (owner, 2026-10-10: deleting an
 * application deletes its documents). A waiting or rejected request is
 * removed - its riders row, its documents and their private files. The
 * account itself stays (it still shops). An approved rider is not deleted
 * here.
 */
export async function deleteRiderApplication(id: string, actor: AuditActor) {
  const documentIds = await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('riders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.id', 'r.user_id', 'r.approval_status', 'r.vehicle_type', 'u.role'])
      .where('r.id', '=', id)
      .where('r.applied_at', 'is not', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row || !APPLICANT_ROLES.includes(row.role)) throw notFound();
    if (row.approval_status === 'APPROVED') {
      throw new AppError('An approved rider is not deleted here.', 409, 'APPLICATION_APPROVED');
    }
    const ids = await riderDocumentService.idsForRider(trx, id);
    try {
      await trx.deleteFrom('riders').where('id', '=', id).execute();
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        throw new AppError('This rider has deliveries or cash records and cannot be deleted.', 409, 'RIDER_IN_USE');
      }
      throw err;
    }
    await writeAudit(trx, actor, {
      action: 'RIDER_APPLICATION_DELETED',
      entityType: 'RIDER',
      entityId: id,
      oldValues: { approval_status: row.approval_status, user_id: row.user_id, vehicle_type: row.vehicle_type },
      newValues: { documents_removed: ids.length },
    });
    return ids;
  });
  await riderDocumentStore.removeDocumentsQuietly(documentIds);
  logger.info({ riderId: id, by: actor.actorId, documents: documentIds.length }, 'Rider application deleted');
  return { deleted: true as const, documents_removed: documentIds.length };
}

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

/** With an applicant token (rider.documents.ts): POST /riders/applications/submit. */
riderApplicationsPublicRouter.post(
  '/applications/submit',
  requireApplicant,
  validate({ body: riderApplicationSessionSchema }),
  async (req, res, next) => {
    try {
      const result = await riderApplicationService.apply(
        { ...(req.body as RiderApplicationDetails), phone: res.locals.applicantPhone as string },
        { ipAddress: clientIp(req), userAgent: req.get('user-agent') ?? null },
        'session'
      );
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

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
  // Body optional: { pay_type?, commission_percent? } (migration 032),
  // { override_documents?, override_reason? } (ADMIN only, migration 039).
  validate({ params: applicationIdParamsSchema, body: approveApplicationSchema }),
  async (req, res, next) => {
    try {
      const application = await riderApplicationService.approve(
        req.params.id as string,
        actorOf(req),
        req.body as ApproveApplicationInput,
        req.user!.role
      );
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

adminRiderApplicationsRouter.delete(
  '/rider-applications/:id',
  requireAuth,
  REVIEWERS,
  validate({ params: applicationIdParamsSchema }),
  async (req, res, next) => {
    try {
      res.status(200).json({ success: true, data: await deleteRiderApplication(req.params.id as string, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);
