import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { DateTime } from 'luxon';
import { sql, type ExpressionBuilder, type Transaction } from 'kysely';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import type { Database, RiderApprovalStatus, RiderDocumentImage, RiderDocumentStatus, UserRole } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone, publicPhone } from '../../utils/phone.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { authService } from '../auth/auth.service.js';
import { authRateLimiter } from '../auth/auth.rate-limiter.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  riderDocumentStore,
  sniffDocument,
  stripLocation,
} from './rider.documents.files.js';
import {
  INSURANCE_KEY,
  documentsFor,
  riderDocumentSettings,
  type RiderDocumentSettings,
  type RiderDocumentType,
} from './rider.documents.settings.js';

/**
 * Rider documents (migration 039; owner, 2026-10-10).
 *
 * "Rider sign-up needs these documents, and Ops and Admin verify them before
 * approval": Vehicle book (CR), Revenue licence, Insurance certificate,
 * Driving licence (+ custom ones; which are required per vehicle type is the
 * rider_documents setting, rider.documents.settings.ts).
 *
 * The applicant (Rider app):
 *   1. proves the phone once with an SMS code: POST
 *      /riders/applications/session {phone, otp} -> an APPLICANT token (2 h,
 *      signed with a key derived from JWT_ACCESS_SECRET for this purpose
 *      only, so it is never accepted as a sign-in token and a sign-in token
 *      is never accepted here);
 *   2. uploads each page (PUT .../documents/:type/pages/:page), with
 *      retake (PUT again) / remove (DELETE) and an optional expiry date;
 *   3. sends the application (POST /riders/applications/submit) - refused
 *      (DOCUMENTS_REQUIRED) until every REQUIRED document is uploaded.
 *   Before the application is sent the documents are drafts keyed by the
 *   verified phone; sending moves them onto the riders row.
 *   Later (waiting / rejected / approved) the same session shows each
 *   document's status and a rejection's reason, and lets the applicant
 *   re-upload just that document - which puts it back to PENDING review.
 *
 * Ops / Admin (Rider requests): list a rider's documents, open the pages
 * (private, authenticated, no-store), verify (optionally setting the expiry
 * date) or reject with a preset reason. Approval needs every required
 * document VERIFIED and unexpired (rider.applications.ts); an ADMIN may
 * "approve anyway" with a reason, audited.
 */

// ----------------------------------------------------------------------------
// Types and presentation
// ----------------------------------------------------------------------------

export const REJECT_REASONS = ['BLURRY', 'EXPIRED', 'NAME_MISMATCH', 'WRONG_DOCUMENT', 'OTHER'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  BLURRY: 'The photo is blurry or hard to read',
  EXPIRED: 'The document has expired',
  NAME_MISMATCH: "The name doesn't match the application",
  WRONG_DOCUMENT: "This isn't the right document",
  OTHER: 'Other',
};

/** "Expiring soon" means within this many days (owner, 2026-10-10). */
export const EXPIRY_WARNING_DAYS = 30;
/** A page per side: front, back. */
export const MAX_PAGES = 2;

export type ExpiryState = 'EXPIRED' | 'EXPIRING' | 'OK';

interface DocumentRow {
  id: string;
  rider_id: string | null;
  draft_phone: string | null;
  doc_type: string;
  custom_name: string | null;
  images: RiderDocumentImage[];
  expiry_date: string | null;
  status: RiderDocumentStatus;
  reject_reason: string | null;
  reject_note: string | null;
  reviewed_at: Date | null;
  reviewed_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

type Trx = Transaction<Database>;
type Executor = Trx | typeof db;

/** Today in Sri Lanka, 'YYYY-MM-DD'. */
export const colomboToday = () => DateTime.now().setZone(STORE_TIMEZONE).toISODate()!;

export function expiryState(expiry: string | null, today = colomboToday()): ExpiryState | null {
  if (!expiry) return null;
  if (expiry < today) return 'EXPIRED';
  const soon = DateTime.fromISO(today, { zone: STORE_TIMEZONE }).plus({ days: EXPIRY_WARNING_DAYS }).toISODate()!;
  return expiry <= soon ? 'EXPIRING' : 'OK';
}

function documentsQuery(executor: Executor) {
  return executor
    .selectFrom('rider_documents as d')
    .leftJoin('users as rev', 'rev.id', 'd.reviewed_by')
    .select([
      'd.id',
      'd.rider_id',
      'd.draft_phone',
      'd.doc_type',
      'd.custom_name',
      'd.images',
      sql<string | null>`to_char(d.expiry_date, 'YYYY-MM-DD')`.as('expiry_date'),
      'd.status',
      'd.reject_reason',
      'd.reject_note',
      'd.reviewed_at',
      'rev.full_name as reviewed_by_name',
      'd.created_at',
      'd.updated_at',
    ]);
}

const labelOf = (row: { doc_type: string; custom_name: string | null }, settings: RiderDocumentSettings) =>
  settings.documents.find((d) => d.key === row.doc_type)?.label ?? row.custom_name ?? row.doc_type;

const pagesOf = (row: DocumentRow) =>
  (row.images ?? []).map((img, index) => ({ index, content_type: img.content_type, bytes: img.bytes, uploaded_at: img.uploaded_at }));

/** What both the applicant and staff see of one document (never a storage key). */
function present(row: DocumentRow, settings: RiderDocumentSettings) {
  const type = settings.documents.find((d) => d.key === row.doc_type);
  return {
    id: row.id,
    doc_type: row.doc_type,
    label: labelOf(row, settings),
    custom: !type?.builtin,
    pages: pagesOf(row),
    pages_needed: type?.needs_back ? 2 : 1,
    expiry_date: row.expiry_date,
    expiry_state: expiryState(row.expiry_date),
    status: row.status,
    reject_reason: row.reject_reason,
    reject_reason_label: row.reject_reason ? REJECT_REASON_LABEL[row.reject_reason as RejectReason] ?? row.reject_reason : null,
    reject_note: row.reject_note,
    reviewed_at: row.reviewed_at,
    updated_at: row.updated_at,
  };
}
export type PresentedDocument = ReturnType<typeof present>;

const staffPresent = (row: DocumentRow, settings: RiderDocumentSettings) => ({
  ...present(row, settings),
  rider_id: row.rider_id,
  reviewed_by_name: row.reviewed_by_name,
});

const pagesComplete = (row: DocumentRow | undefined, type: RiderDocumentType) =>
  !!row && (row.images?.length ?? 0) >= (type.needs_back ? 2 : 1);

/**
 * Required documents still missing before an application can be sent: not
 * uploaded, a page short (front+back), or rejected and not re-uploaded.
 */
export function missingForSubmission(settings: RiderDocumentSettings, vehicle: string, rows: DocumentRow[]) {
  return documentsFor(settings, vehicle)
    .filter((t) => t.required)
    .filter((t) => {
      const row = rows.find((r) => r.doc_type === t.key);
      return !pagesComplete(row, t) || row!.status === 'REJECTED';
    })
    .map((t) => {
      const row = rows.find((r) => r.doc_type === t.key);
      return {
        key: t.key,
        label: t.label,
        problem: !row || (row.images?.length ?? 0) === 0 ? 'MISSING' : row.status === 'REJECTED' ? 'REJECTED' : 'BACK_MISSING',
      };
    });
}

/**
 * The review summary for one rider: every document type shown to their
 * vehicle, with its document (if any). Approval needs each REQUIRED one
 * VERIFIED and not expired.
 */
export function reviewOf(settings: RiderDocumentSettings, vehicle: string, rows: DocumentRow[]) {
  const today = colomboToday();
  const requirements = documentsFor(settings, vehicle).map((t) => {
    const row = rows.find((r) => r.doc_type === t.key);
    const state = row ? expiryState(row.expiry_date, today) : null;
    return {
      key: t.key,
      label: t.label,
      required: t.required,
      needs_expiry: t.needs_expiry,
      needs_back: t.needs_back,
      document_id: row?.id ?? null,
      status: (row && (row.images?.length ?? 0) > 0 ? row.status : 'MISSING') as RiderDocumentStatus | 'MISSING',
      expiry_state: state,
    };
  });
  const blocking = requirements
    .filter((r) => r.required && (r.status !== 'VERIFIED' || r.expiry_state === 'EXPIRED'))
    .map((r) => ({ key: r.key, label: r.label, status: r.status, expiry_state: r.expiry_state }));
  return { requirements, blocking, all_required_verified: blocking.length === 0 };
}

// ----------------------------------------------------------------------------
// Applicant session (token)
// ----------------------------------------------------------------------------

const APPLICANT_AUDIENCE = 'blynk-rider-applicant';
export const APPLICANT_SESSION_SECONDS = 2 * 60 * 60;
/** A key of its own: never interchangeable with sign-in tokens. */
const applicantKey = () => crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update('rider-applicant-session:v1').digest();

export function signApplicantToken(phone: string): string {
  return jwt.sign({ typ: 'rider_applicant', phone }, applicantKey(), {
    algorithm: 'HS256',
    audience: APPLICANT_AUDIENCE,
    expiresIn: APPLICANT_SESSION_SECONDS,
  });
}

export function verifyApplicantToken(token: string): string {
  try {
    const decoded = jwt.verify(token, applicantKey(), { algorithms: ['HS256'], audience: APPLICANT_AUDIENCE }) as jwt.JwtPayload;
    if (decoded.typ !== 'rider_applicant' || typeof decoded.phone !== 'string') throw new Error('claims');
    return decoded.phone;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('Your session has ended. Check your number again with a new SMS code.', 401, 'APPLICANT_SESSION_EXPIRED');
    }
    throw new AppError('Check your number with an SMS code first.', 401, 'APPLICANT_SESSION_REQUIRED');
  }
}

/** Accepts only an applicant token: res.locals.applicantPhone. */
export function requireApplicant(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || !header.slice(7).trim()) {
    return next(new AppError('Check your number with an SMS code first.', 401, 'APPLICANT_SESSION_REQUIRED'));
  }
  try {
    res.locals.applicantPhone = verifyApplicantToken(header.slice(7).trim());
    next();
  } catch (err) {
    next(err);
  }
}

/** Accounts that may apply (and keep a rider's documents): CUSTOMER until approved, then RIDER. */
const APPLICANT_ROLES: UserRole[] = ['CUSTOMER', 'RIDER'];

export interface ApplicantOwner {
  phone: string;
  userId: string | null;
  riderId: string | null;
  application: null | {
    id: string;
    status: RiderApprovalStatus;
    vehicle_type: string;
    vehicle_registration_number: string | null;
    full_name: string | null;
    rejection_reason: string | null;
    applied_at: Date | null;
  };
}

/** Who a verified phone is now: an existing riders row, or a draft. */
export async function resolveApplicant(executor: Executor, phone: string): Promise<ApplicantOwner> {
  const user = await executor
    .selectFrom('users')
    .select(['id', 'role', 'is_active', 'full_name'])
    .where('phone', '=', phone)
    .executeTakeFirst();
  if (user && (!APPLICANT_ROLES.includes(user.role) || !user.is_active)) {
    throw new AppError(
      user.role === 'OPERATIONS'
        ? 'This number is an Operations account. Use "Deliver orders myself" in the Ops app instead.'
        : 'This number is already used by another Blynk account.',
      409,
      user.role === 'OPERATIONS' ? 'STAFF_CAN_DELIVER' : 'PHONE_IN_USE'
    );
  }
  const rider = user
    ? await executor
        .selectFrom('riders')
        .select(['id', 'approval_status', 'vehicle_type', 'vehicle_registration_number', 'rejection_reason', 'applied_at'])
        .where('user_id', '=', user.id)
        .executeTakeFirst()
    : undefined;
  return {
    phone,
    userId: user?.id ?? null,
    riderId: rider?.id ?? null,
    application: rider
      ? {
          id: rider.id,
          status: rider.approval_status,
          vehicle_type: rider.vehicle_type,
          vehicle_registration_number: rider.vehicle_registration_number,
          full_name: user?.full_name ?? null,
          rejection_reason: rider.rejection_reason,
          applied_at: rider.applied_at,
        }
      : null,
  };
}

/** The applicant's documents: on the riders row once it exists, else the phone's drafts. */
const ownedBy =
  (owner: ApplicantOwner) =>
  (eb: ExpressionBuilder<Database & { d: Database['rider_documents'] }, 'd'>) =>
    owner.riderId ? eb('d.rider_id', '=', owner.riderId) : eb('d.draft_phone', '=', owner.phone);

async function ownerDocuments(executor: Executor, owner: ApplicantOwner): Promise<DocumentRow[]> {
  return (await documentsQuery(executor).where(ownedBy(owner)).orderBy('d.created_at').execute()) as DocumentRow[];
}

export async function riderDocuments(executor: Executor, riderIds: string[]): Promise<DocumentRow[]> {
  if (riderIds.length === 0) return [];
  return (await documentsQuery(executor).where('d.rider_id', 'in', riderIds).orderBy('d.created_at').execute()) as DocumentRow[];
}

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

const slPhone = z
  .string({ required_error: 'Phone number is required.' })
  .trim()
  .min(1, 'Phone number is required.')
  .transform((raw, ctx) => {
    try {
      return normalizeSriLankanPhone(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567' });
      return z.NEVER;
    }
  });

export const applicantSessionSchema = z
  .object({
    phone: slPhone,
    otp: z
      .string({ required_error: 'OTP is required.' })
      .trim()
      .length(6, 'OTP must be exactly 6 digits.')
      .regex(/^[0-9]{6}$/, 'OTP must contain numeric digits only.'),
  })
  .strict();

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31.')
  .refine((v) => DateTime.fromISO(v).isValid, 'That date does not exist.')
  .refine((v) => v >= '2000-01-01' && v <= '2080-12-31', 'That expiry date is not believable.');

export const expiryBodySchema = z.object({ expiry_date: isoDate.nullable() }).strict();

export const docTypeParamsSchema = z.object({
  docType: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Unknown document type.'),
});
export const pageParamsSchema = docTypeParamsSchema.extend({
  page: z.coerce.number().int().min(0, 'Page is 0 (front) or 1 (back).').max(MAX_PAGES - 1, 'Page is 0 (front) or 1 (back).'),
});

export const staffDocParamsSchema = z.object({ id: z.string().uuid('Document id must be a valid UUID') });
export const staffPageParamsSchema = staffDocParamsSchema.extend({
  page: z.coerce.number().int().min(0).max(MAX_PAGES - 1),
});
export const riderIdParamsSchema = z.object({ id: z.string().uuid('Rider id must be a valid UUID') });

export const verifyDocumentSchema = z
  .object({ expiry_date: isoDate.nullable().optional() })
  .strict()
  .default({});
export const rejectDocumentSchema = z
  .object({
    reason: z.enum(REJECT_REASONS, { errorMap: () => ({ message: `Reason must be one of ${REJECT_REASONS.join(', ')}` }) }),
    note: z.string().trim().max(300, 'The note can be at most 300 characters.').optional().transform((v) => (v ? v : null)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.reason === 'OTHER' && !v.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Say what is wrong with the document.' });
    }
  });
export const alertsQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(365).default(EXPIRY_WARNING_DAYS),
});

// ----------------------------------------------------------------------------
// Upload parsing
// ----------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 4 },
});

/** multer with this module's own messages (8 MB, not the 2 MB image wording). */
export function documentUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Documents must be 8 MB or smaller.', 413, 'FILE_TOO_LARGE'));
    }
    return next(new AppError('Send one file in the "file" field.', 400, 'VALIDATION_ERROR'));
  });
}

/** Type by magic number, HEIC refused, location metadata removed. */
export function acceptDocumentFile(file: Express.Multer.File | undefined): { buffer: Buffer; contentType: string } {
  if (!file || file.size === 0) throw new AppError('Choose a photo or PDF of the document.', 400, 'NO_FILE');
  const sniffed = sniffDocument(file.buffer);
  if (sniffed && 'heic' in sniffed) {
    throw new AppError(
      'HEIC photos are not supported. Take the photo again in the app, or choose a JPEG or PDF.',
      415,
      'UNSUPPORTED_MEDIA_TYPE'
    );
  }
  if (!sniffed || !DOCUMENT_TYPES[sniffed.type]) {
    throw new AppError('Use a photo (JPEG, PNG or WebP) or a PDF.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  return { buffer: stripLocation(file.buffer, sniffed.type), contentType: sniffed.type };
}

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

const docNotFound = () => new AppError('Document not found.', 404, 'DOCUMENT_NOT_FOUND');
const pageNotFound = () => new AppError('That page of the document was not found.', 404, 'DOCUMENT_PAGE_NOT_FOUND');

const SWEEP_EVERY_MS = 60 * 60 * 1000;
/** Drafts of an application that was never sent are removed after this. */
export const DRAFT_TTL_DAYS = 14;

export class RiderDocumentService {
  private lastSweep = 0;

  // ---- applicant -----------------------------------------------------------

  /** POST /riders/applications/session: SMS code -> applicant token. */
  async startSession(phone: string, otp: string, meta: { ipAddress?: string | null }) {
    authRateLimiter.checkLimit(
      `rider_doc_session_phone:${phone}`,
      10,
      60 * 60 * 1000,
      'Too many tries for this phone number. Please try again in 1 hour.'
    );
    authRateLimiter.checkLimit(
      `rider_doc_session_ip:${meta.ipAddress ?? 'unknown'}`,
      30,
      15 * 60 * 1000,
      'Too many tries from this device. Please wait before retrying.'
    );
    // Email-only and staff numbers are refused before the code is spent.
    await resolveApplicant(db, phone);
    const otpId = await authService.checkOtp(phone, otp);
    await db.transaction().execute(async (trx) => {
      await resolveApplicant(trx, phone);
      await authService.consumeOtp(trx, phone, otpId);
    });
    this.sweepSoon();
    return {
      applicant_token: signApplicantToken(phone),
      expires_in: APPLICANT_SESSION_SECONDS,
      ...(await this.applicantState(phone)),
    };
  }

  /** GET /riders/applications/me: the application (if any), document types and the applicant's documents. */
  async applicantState(phone: string) {
    const owner = await resolveApplicant(db, phone);
    const settings = await riderDocumentSettings.read();
    const rows = await ownerDocuments(db, owner);
    return {
      phone: publicPhone(phone),
      application: owner.application,
      document_types: settings.documents
        .filter((d) => d.enabled)
        .map(({ key, label, builtin, required_for, needs_expiry, needs_back }) => ({ key, label, builtin, required_for, needs_expiry, needs_back })),
      documents: rows.map((r) => present(r, settings)),
    };
  }

  private async typeFor(docType: string): Promise<RiderDocumentType> {
    const settings = await riderDocumentSettings.read();
    const type = settings.documents.find((d) => d.key === docType && d.enabled);
    if (!type) throw new AppError('This document is not asked for.', 404, 'DOCUMENT_TYPE_NOT_FOUND');
    return type;
  }

  /** Locks (creating if needed) the applicant's document of this type. */
  private async lockOrCreate(trx: Trx, owner: ApplicantOwner, type: RiderDocumentType) {
    if (owner.riderId) {
      await sql`INSERT INTO rider_documents (rider_id, doc_type, custom_name)
                VALUES (${owner.riderId}, ${type.key}, ${type.builtin ? null : type.label})
                ON CONFLICT (rider_id, doc_type) WHERE rider_id IS NOT NULL DO NOTHING`.execute(trx);
    } else {
      await sql`INSERT INTO rider_documents (draft_phone, doc_type, custom_name)
                VALUES (${owner.phone}, ${type.key}, ${type.builtin ? null : type.label})
                ON CONFLICT (draft_phone, doc_type) WHERE draft_phone IS NOT NULL DO NOTHING`.execute(trx);
    }
    return this.lockOwned(trx, owner, type.key, true) as Promise<DocumentRow>;
  }

  private async lockOwned(trx: Trx, owner: ApplicantOwner, docType: string, mustExist = false) {
    const row = await trx
      .selectFrom('rider_documents as d')
      .select(['d.id', 'd.images', 'd.rider_id', 'd.draft_phone', 'd.doc_type', 'd.status'])
      .where(ownedBy(owner))
      .where('d.doc_type', '=', docType)
      .forUpdate()
      .executeTakeFirst();
    if (!row && mustExist) throw docNotFound();
    return row as (Pick<DocumentRow, 'id' | 'images' | 'rider_id' | 'draft_phone' | 'doc_type' | 'status'>) | undefined;
  }

  /** What any change by the applicant does: back to PENDING review. */
  private backToPending() {
    return {
      status: 'PENDING' as const,
      reject_reason: null,
      reject_note: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: sql<Date>`now()`,
    };
  }

  private async auditApplicant(trx: Trx, owner: ApplicantOwner, action: string, documentId: string, values: Record<string, unknown>) {
    // Drafts of a brand-new number have no account to name yet.
    if (!owner.userId) return;
    await writeAudit(trx, { actorId: owner.userId }, { action, entityType: 'RIDER_DOCUMENT', entityId: documentId, newValues: values });
  }

  /** PUT .../documents/:docType/pages/:page - upload or retake one page. */
  async putPage(phone: string, docType: string, page: number, file: { buffer: Buffer; contentType: string }, expiry?: string | null) {
    const type = await this.typeFor(docType);
    let savedKey: string | null = null;
    let replacedKey: string | null = null;
    try {
      await db.transaction().execute(async (trx) => {
        const owner = await resolveApplicant(trx, phone);
        const row = await this.lockOrCreate(trx, owner, type);
        const images = [...(row.images ?? [])];
        if (page > images.length) {
          throw new AppError('Add the front page first.', 400, 'DOCUMENT_PAGE_ORDER');
        }
        savedKey = await riderDocumentStore.save(row.id, file.buffer, file.contentType);
        const image: RiderDocumentImage = {
          key: savedKey,
          content_type: file.contentType,
          bytes: file.buffer.length,
          uploaded_at: new Date().toISOString(),
        };
        replacedKey = images[page]?.key ?? null;
        images[page] = image;
        await trx
          .updateTable('rider_documents')
          .set({
            images: JSON.stringify(images),
            ...(expiry !== undefined ? { expiry_date: expiry } : {}),
            ...(type.builtin ? {} : { custom_name: type.label }),
            ...this.backToPending(),
          })
          .where('id', '=', row.id)
          .execute();
        await this.auditApplicant(trx, owner, 'RIDER_DOCUMENT_UPLOADED', row.id, {
          doc_type: type.key,
          page,
          content_type: file.contentType,
          bytes: file.buffer.length,
          replaced: Boolean(replacedKey),
          rider_id: owner.riderId,
        });
      });
    } catch (err) {
      if (savedKey) await riderDocumentStore.remove(savedKey).catch(() => undefined);
      throw err;
    }
    if (replacedKey) await riderDocumentStore.remove(replacedKey).catch(() => undefined);
    return this.ownDocument(phone, docType);
  }

  /** DELETE .../documents/:docType/pages/:page - remove one page (the back moves up). */
  async removePage(phone: string, docType: string, page: number) {
    let removedKey: string | null = null;
    let removedDocument: string | null = null;
    await db.transaction().execute(async (trx) => {
      const owner = await resolveApplicant(trx, phone);
      const row = await this.lockOwned(trx, owner, docType, true);
      const images = [...(row!.images ?? [])];
      if (!images[page]) throw pageNotFound();
      removedKey = images[page].key;
      images.splice(page, 1);
      if (images.length === 0) {
        await trx.deleteFrom('rider_documents').where('id', '=', row!.id).execute();
        removedDocument = row!.id;
      } else {
        await trx
          .updateTable('rider_documents')
          .set({ images: JSON.stringify(images), ...this.backToPending() })
          .where('id', '=', row!.id)
          .execute();
      }
      await this.auditApplicant(trx, owner, 'RIDER_DOCUMENT_PAGE_REMOVED', row!.id, { doc_type: docType, page, rider_id: owner.riderId });
    });
    if (removedDocument) await riderDocumentStore.removeDocumentsQuietly([removedDocument]);
    else if (removedKey) await riderDocumentStore.remove(removedKey).catch(() => undefined);
    return removedDocument ? null : this.ownDocument(phone, docType);
  }

  /** PATCH .../documents/:docType - the applicant's expiry date. */
  async setOwnExpiry(phone: string, docType: string, expiry: string | null) {
    await this.typeFor(docType);
    await db.transaction().execute(async (trx) => {
      const owner = await resolveApplicant(trx, phone);
      const row = await this.lockOwned(trx, owner, docType, true);
      await trx
        .updateTable('rider_documents')
        .set({ expiry_date: expiry, ...this.backToPending() })
        .where('id', '=', row!.id)
        .execute();
      await this.auditApplicant(trx, owner, 'RIDER_DOCUMENT_EXPIRY_SET', row!.id, { doc_type: docType, expiry_date: expiry, rider_id: owner.riderId });
    });
    return this.ownDocument(phone, docType);
  }

  private async ownDocument(phone: string, docType: string) {
    const owner = await resolveApplicant(db, phone);
    const settings = await riderDocumentSettings.read();
    const row = (await ownerDocuments(db, owner)).find((r) => r.doc_type === docType);
    return row ? present(row, settings) : null;
  }

  async ownPage(phone: string, docType: string, page: number) {
    const owner = await resolveApplicant(db, phone);
    const row = (await ownerDocuments(db, owner)).find((r) => r.doc_type === docType);
    if (!row) throw docNotFound();
    return this.pageFile(row, page);
  }

  private async pageFile(row: DocumentRow, page: number) {
    const image = row.images?.[page];
    if (!image) throw pageNotFound();
    const buffer = await riderDocumentStore.read(image.key);
    if (!buffer) throw new AppError('The stored file is missing. Ask the rider to upload it again.', 404, 'DOCUMENT_FILE_MISSING');
    return { buffer, contentType: image.content_type, filename: `${row.doc_type.toLowerCase()}-${page + 1}.${DOCUMENT_TYPES[image.content_type] ?? 'bin'}` };
  }

  // ---- sending the application (called by rider.applications.ts) ------------

  /**
   * Inside the application transaction: moves the phone's drafts onto the
   * riders row (a re-upload replaces the rider's older document of the same
   * type) and refuses (DOCUMENTS_REQUIRED) unless every required document
   * for this vehicle is there. Returns the replaced documents' ids so the
   * caller removes their files after commit.
   */
  async attachDraftsAndCheck(trx: Trx, phone: string, riderId: string, vehicle: string): Promise<string[]> {
    const drafts = await trx
      .selectFrom('rider_documents')
      .select(['id', 'doc_type'])
      .where('draft_phone', '=', phone)
      .forUpdate()
      .execute();
    let replaced: string[] = [];
    if (drafts.length) {
      const types = drafts.map((d) => d.doc_type);
      replaced = (
        await trx
          .deleteFrom('rider_documents')
          .where('rider_id', '=', riderId)
          .where('doc_type', 'in', types)
          .returning('id')
          .execute()
      ).map((r) => r.id);
      await trx
        .updateTable('rider_documents')
        .set({ rider_id: riderId, draft_phone: null, updated_at: sql<Date>`now()` })
        .where('draft_phone', '=', phone)
        .execute();
    }
    const settings = await riderDocumentSettings.read();
    const rows = await riderDocuments(trx, [riderId]);
    const missing = missingForSubmission(settings, vehicle, rows);
    if (missing.length) {
      throw new AppError(
        `Upload these documents first: ${missing.map((m) => m.label).join(', ')}.`,
        400,
        'DOCUMENTS_REQUIRED',
        { missing }
      );
    }
    return replaced;
  }

  // ---- staff ---------------------------------------------------------------

  /** GET /admin/riders/:id/documents (riders.id = the application id). */
  async forRider(riderId: string) {
    const rider = await db
      .selectFrom('riders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.id', 'r.vehicle_type', 'r.approval_status', 'u.full_name'])
      .where('r.id', '=', riderId)
      .executeTakeFirst();
    if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
    const settings = await riderDocumentSettings.read();
    const rows = await riderDocuments(db, [riderId]);
    return {
      rider: { id: rider.id, full_name: rider.full_name, vehicle_type: rider.vehicle_type, approval_status: rider.approval_status },
      documents: rows.map((r) => staffPresent(r, settings)),
      ...reviewOf(settings, rider.vehicle_type, rows),
    };
  }

  /** For the Rider requests list: each rider's documents and review summary. */
  async summariesFor(riders: { id: string; vehicle_type: string }[]) {
    const settings = await riderDocumentSettings.read();
    const rows = await riderDocuments(db, riders.map((r) => r.id));
    const out = new Map<string, { documents: ReturnType<typeof staffPresent>[] } & ReturnType<typeof reviewOf>>();
    for (const r of riders) {
      const own = rows.filter((d) => d.rider_id === r.id);
      out.set(r.id, { documents: own.map((d) => staffPresent(d, settings)), ...reviewOf(settings, r.vehicle_type, own) });
    }
    return out;
  }

  /** Approval gate (rider.applications.ts), inside its transaction. */
  async blockingForApproval(trx: Trx, riderId: string, vehicle: string) {
    const settings = await riderDocumentSettings.read();
    const rows = await riderDocuments(trx, [riderId]);
    return reviewOf(settings, vehicle, rows).blocking;
  }

  async staffPage(id: string, page: number) {
    const row = (await documentsQuery(db).where('d.id', '=', id).where('d.rider_id', 'is not', null).executeTakeFirst()) as
      | DocumentRow
      | undefined;
    if (!row) throw docNotFound();
    return this.pageFile(row, page);
  }

  private async lockForReview(trx: Trx, id: string) {
    const row = await trx
      .selectFrom('rider_documents')
      .select(['id', 'rider_id', 'doc_type', 'images', 'status', sql<string | null>`to_char(expiry_date, 'YYYY-MM-DD')`.as('expiry_date')])
      .where('id', '=', id)
      .where('rider_id', 'is not', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row || !row.images?.length) throw docNotFound();
    return row;
  }

  async verify(id: string, input: { expiry_date?: string | null }, actor: AuditActor) {
    const settings = await riderDocumentSettings.read();
    await db.transaction().execute(async (trx) => {
      const row = await this.lockForReview(trx, id);
      const type = settings.documents.find((d) => d.key === row.doc_type);
      const expiry = input.expiry_date !== undefined ? input.expiry_date : row.expiry_date;
      if (type?.needs_back && row.images.length < 2) {
        throw new AppError('This document needs a photo of the back too. Reject it and ask for the back.', 409, 'DOCUMENT_INCOMPLETE');
      }
      if (type?.needs_expiry && !expiry) {
        throw new AppError('Enter the expiry date printed on the document to verify it.', 400, 'EXPIRY_REQUIRED');
      }
      if (expiryState(expiry) === 'EXPIRED') {
        throw new AppError('This document has expired. Reject it (Expired) so the rider uploads a current one.', 409, 'DOCUMENT_EXPIRED');
      }
      await trx
        .updateTable('rider_documents')
        .set({
          status: 'VERIFIED',
          expiry_date: expiry ?? null,
          reject_reason: null,
          reject_note: null,
          reviewed_by: actor.actorId,
          reviewed_at: sql<Date>`now()`,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, actor, {
        action: 'RIDER_DOCUMENT_VERIFIED',
        entityType: 'RIDER_DOCUMENT',
        entityId: id,
        oldValues: { status: row.status, expiry_date: row.expiry_date },
        newValues: { status: 'VERIFIED', rider_id: row.rider_id, doc_type: row.doc_type, expiry_date: expiry ?? null },
      });
    });
    logger.info({ documentId: id, by: actor.actorId }, 'Rider document verified');
    return this.staffDocument(id);
  }

  async reject(id: string, input: { reason: RejectReason; note: string | null }, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const row = await this.lockForReview(trx, id);
      await trx
        .updateTable('rider_documents')
        .set({
          status: 'REJECTED',
          reject_reason: input.reason,
          reject_note: input.note,
          reviewed_by: actor.actorId,
          reviewed_at: sql<Date>`now()`,
          updated_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, actor, {
        action: 'RIDER_DOCUMENT_REJECTED',
        entityType: 'RIDER_DOCUMENT',
        entityId: id,
        oldValues: { status: row.status },
        newValues: { status: 'REJECTED', rider_id: row.rider_id, doc_type: row.doc_type, reject_reason: input.reason, reject_note: input.note },
      });
    });
    logger.info({ documentId: id, by: actor.actorId }, 'Rider document rejected');
    return this.staffDocument(id);
  }

  private async staffDocument(id: string) {
    const settings = await riderDocumentSettings.read();
    const row = (await documentsQuery(db).where('d.id', '=', id).executeTakeFirstOrThrow()) as DocumentRow;
    return staffPresent(row, settings);
  }

  /**
   * GET /admin/rider-documents/alerts: approved riders' documents that have
   * expired or expire within `days` - the "Insurance expiring soon /
   * expired" badges on the Riders list.
   */
  async alerts(days: number) {
    const today = colomboToday();
    const until = DateTime.fromISO(today, { zone: STORE_TIMEZONE }).plus({ days }).toISODate()!;
    const settings = await riderDocumentSettings.read();
    const rows = await db
      .selectFrom('rider_documents as d')
      .innerJoin('riders as r', 'r.id', 'd.rider_id')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'd.id',
        'd.rider_id',
        'd.doc_type',
        'd.custom_name',
        'd.status',
        sql<string>`to_char(d.expiry_date, 'YYYY-MM-DD')`.as('expiry_date'),
        'u.full_name',
        'u.phone',
      ])
      .where('r.approval_status', '=', 'APPROVED')
      .where('d.expiry_date', 'is not', null)
      .where(sql<boolean>`d.expiry_date <= ${until}::date`)
      .orderBy('d.expiry_date')
      .execute();
    return {
      warning_days: days,
      alerts: rows.map((r) => ({
        document_id: r.id,
        rider_id: r.rider_id as string,
        full_name: r.full_name,
        phone: publicPhone(r.phone),
        doc_type: r.doc_type,
        label: labelOf(r, settings),
        is_insurance: r.doc_type === INSURANCE_KEY,
        status: r.status,
        expiry_date: r.expiry_date,
        expiry_state: expiryState(r.expiry_date, today) as ExpiryState,
      })),
    };
  }

  // ---- deletion ------------------------------------------------------------

  /** Inside a transaction deleting an account: its riders' documents and the phone's drafts. */
  async deleteForUser(trx: Trx, userId: string, phone: string | null): Promise<string[]> {
    const riderIds = (await trx.selectFrom('riders').select('id').where('user_id', '=', userId).execute()).map((r) => r.id);
    let q = trx.deleteFrom('rider_documents').returning('id');
    q = riderIds.length
      ? phone
        ? q.where((eb) => eb.or([eb('rider_id', 'in', riderIds), eb('draft_phone', '=', phone)]))
        : q.where('rider_id', 'in', riderIds)
      : phone
        ? q.where('draft_phone', '=', phone)
        : q.where(sql<boolean>`false`);
    return (await q.execute()).map((r) => r.id);
  }

  /** Before deleting a riders row (CASCADE removes the rows): the ids whose files to remove. */
  async idsForRider(trx: Trx, riderId: string): Promise<string[]> {
    return (await trx.selectFrom('rider_documents').select('id').where('rider_id', '=', riderId).execute()).map((r) => r.id);
  }

  /**
   * Housekeeping, at most hourly and never in the way of a request: drafts
   * of applications never sent (older than DRAFT_TTL_DAYS) are deleted, and
   * document directories with no row left (e.g. a riders row removed by
   * hand) are removed.
   */
  sweepSoon() {
    if (Date.now() - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = Date.now();
    void this.sweep().catch((err) => logger.warn({ err }, 'Rider documents sweep failed'));
  }

  async sweep(now = new Date()) {
    const stale = await db
      .deleteFrom('rider_documents')
      .where('draft_phone', 'is not', null)
      .where('updated_at', '<', new Date(now.getTime() - DRAFT_TTL_DAYS * 86_400_000))
      .returning('id')
      .execute();
    await riderDocumentStore.removeDocumentsQuietly(stale.map((r) => r.id));
    const onDisk = await riderDocumentStore.listDocumentIds();
    let orphans: string[] = [];
    if (onDisk.length) {
      const known = new Set(
        (await db.selectFrom('rider_documents').select('id').where('id', 'in', onDisk).execute()).map((r) => r.id)
      );
      // A directory younger than an hour may belong to an upload in flight.
      orphans = onDisk.filter((id) => !known.has(id));
      orphans = await riderDocumentStore.olderThan(orphans, now.getTime() - SWEEP_EVERY_MS);
      await riderDocumentStore.removeDocumentsQuietly(orphans);
    }
    return { drafts_removed: stale.length, orphans_removed: orphans.length };
  }
}

export const riderDocumentService = new RiderDocumentService();

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

const clientIp = (req: Request) => req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || null;
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Private bytes: never cached, never sniffed, never run. */
function sendPrivateFile(res: Response, file: { buffer: Buffer; contentType: string; filename: string }) {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.buffer.length),
    'Cache-Control': 'no-store, private, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${file.filename}"`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  });
  res.status(200).end(file.buffer);
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Applicant routes, mounted on the riders router (/riders/applications/...). */
export const riderApplicantDocumentsRouter = Router();
const phoneOf = (res: Response) => res.locals.applicantPhone as string;

riderApplicantDocumentsRouter.post(
  '/applications/session',
  validate({ body: applicantSessionSchema }),
  handle(async (req, res) => {
    const data = await riderDocumentService.startSession(req.body.phone, req.body.otp, { ipAddress: clientIp(req) });
    res.status(200).json({ success: true, data });
  })
);

riderApplicantDocumentsRouter.get(
  '/applications/me',
  requireApplicant,
  handle(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: await riderDocumentService.applicantState(phoneOf(res)) });
  })
);

riderApplicantDocumentsRouter.put(
  '/applications/documents/:docType/pages/:page',
  requireApplicant,
  validate({ params: pageParamsSchema }),
  documentUpload,
  handle(async (req, res) => {
    const file = acceptDocumentFile(req.file);
    const rawExpiry = typeof req.body?.expiry_date === 'string' ? req.body.expiry_date.trim() : undefined;
    let expiry: string | null | undefined;
    if (rawExpiry !== undefined) {
      const parsed = isoDate.safeParse(rawExpiry);
      if (rawExpiry && !parsed.success) {
        throw new AppError('Request validation failed', 400, 'VALIDATION_ERROR', [
          { field: 'expiry_date', message: parsed.error.issues[0]?.message ?? 'Invalid date', rule: 'custom' },
        ]);
      }
      expiry = rawExpiry ? rawExpiry : null;
    }
    const params = req.params as unknown as z.infer<typeof pageParamsSchema>;
    const document = await riderDocumentService.putPage(phoneOf(res), params.docType, params.page, file, expiry);
    res.status(200).json({ success: true, data: { document } });
  })
);

riderApplicantDocumentsRouter.delete(
  '/applications/documents/:docType/pages/:page',
  requireApplicant,
  validate({ params: pageParamsSchema }),
  handle(async (req, res) => {
    const params = req.params as unknown as z.infer<typeof pageParamsSchema>;
    const document = await riderDocumentService.removePage(phoneOf(res), params.docType, params.page);
    res.status(200).json({ success: true, data: { document } });
  })
);

riderApplicantDocumentsRouter.patch(
  '/applications/documents/:docType',
  requireApplicant,
  validate({ params: docTypeParamsSchema, body: expiryBodySchema }),
  handle(async (req, res) => {
    const document = await riderDocumentService.setOwnExpiry(phoneOf(res), String(req.params.docType), req.body.expiry_date);
    res.status(200).json({ success: true, data: { document } });
  })
);

riderApplicantDocumentsRouter.get(
  '/applications/documents/:docType/pages/:page',
  requireApplicant,
  validate({ params: pageParamsSchema }),
  handle(async (req, res) => {
    const params = req.params as unknown as z.infer<typeof pageParamsSchema>;
    sendPrivateFile(res, await riderDocumentService.ownPage(phoneOf(res), params.docType, params.page));
  })
);

/** Staff routes, mounted under /admin (ADMIN and OPERATIONS). */
export const adminRiderDocumentsRouter = Router();
const REVIEWERS = requireRoles(['ADMIN', 'OPERATIONS']);

adminRiderDocumentsRouter.get(
  '/rider-documents/alerts',
  requireAuth,
  REVIEWERS,
  validate({ query: alertsQuerySchema }),
  handle(async (req, res) => {
    const { days } = req.query as unknown as z.infer<typeof alertsQuerySchema>;
    res.status(200).json({ success: true, data: await riderDocumentService.alerts(days) });
  })
);

adminRiderDocumentsRouter.get(
  '/riders/:id/documents',
  requireAuth,
  REVIEWERS,
  validate({ params: riderIdParamsSchema }),
  handle(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: await riderDocumentService.forRider(String(req.params.id)) });
  })
);

adminRiderDocumentsRouter.get(
  '/rider-documents/:id/pages/:page',
  requireAuth,
  REVIEWERS,
  validate({ params: staffPageParamsSchema }),
  handle(async (req, res) => {
    const params = req.params as unknown as z.infer<typeof staffPageParamsSchema>;
    sendPrivateFile(res, await riderDocumentService.staffPage(params.id, params.page));
  })
);

adminRiderDocumentsRouter.post(
  '/rider-documents/:id/verify',
  requireAuth,
  REVIEWERS,
  validate({ params: staffDocParamsSchema, body: verifyDocumentSchema }),
  handle(async (req, res) => {
    const document = await riderDocumentService.verify(String(req.params.id), req.body, actorOf(req));
    res.status(200).json({ success: true, data: { document } });
  })
);

adminRiderDocumentsRouter.post(
  '/rider-documents/:id/reject',
  requireAuth,
  REVIEWERS,
  validate({ params: staffDocParamsSchema, body: rejectDocumentSchema }),
  handle(async (req, res) => {
    const document = await riderDocumentService.reject(String(req.params.id), req.body, actorOf(req));
    res.status(200).json({ success: true, data: { document } });
  })
);
