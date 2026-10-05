import { randomUUID } from 'node:crypto';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { DentalAppointmentStatus } from '../../database/types.js';
import { notificationService } from '../notifications/notification.service.js';
import { bestEffort } from '../notifications/push/push.repository.js';
import { logger } from '../../utils/logger.js';
import { remindIfDue } from './appointment-reminders.js';
import { availabilityService } from './availability.service.js';
import {
  appointmentRepository,
  UQ_IDEMPOTENCY_KEY,
  type AppointmentTrx,
} from './appointment.repository.js';
import {
  AppointmentListQueryInput,
  ConfirmAppointmentInput,
  CreateHoldInput,
} from './appointment.schema.js';

/** Plan §7.3: a hold reserves the slot for five minutes and no longer.
 * Expiry is enforced lazily, at the moment another request touches the row -
 * there is deliberately no background sweep (plan §7.5). */
export const HOLD_TTL_MINUTES = 5;

/** The two terminal cancelled states. */
const CANCELLED_STATUSES: DentalAppointmentStatus[] = ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_CLINIC'];

// DENTAL-07 (open decision): no cancellation cutoff enforced yet; add a start_at-relative check here once the business decides the window.
export function canCustomerCancel(appointment: { status: DentalAppointmentStatus; start_at: Date }): boolean {
  return appointment.status === 'CONFIRMED';
}

/** "Visited" (migration 023): confirmed, and the slot is over. There is no
 * COMPLETED status. Rated or not is checked separately. */
export function canRateVisit(appointment: { status: DentalAppointmentStatus; end_at: Date }, now: Date): boolean {
  return appointment.status === 'CONFIRMED' && appointment.end_at.getTime() <= now.getTime();
}

// ----------------------------------------------------------------------------
// DTOs
// ----------------------------------------------------------------------------

interface AppointmentRowWithContext {
  id: string;
  clinic_doctor_id: string;
  customer_id: string;
  start_at: Date;
  end_at: Date;
  status: DentalAppointmentStatus;
  held_by: string | null;
  held_until: Date | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_notes: string | null;
  consultation_fee_snapshot: number | string | null;
  cancellation_reason: string | null;
  created_at: Date;
  doctor_id: string;
  doctor_name: string;
  doctor_specialty: string;
  doctor_photo_url: string | null;
  clinic_id: string;
  clinic_name: string;
  clinic_city: string;
  clinic_address_line: string;
  rating_stars: number | null;
  rating_comment: string | null;
  rating_created_at: Date | null;
}

function money(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * The customer's view of an appointment. `patient_notes` is deliberately NOT
 * here - plan §16 keeps the free-text note out of list responses and returns
 * it only from the single-appointment detail view (`toDetailDto`).
 */
function toListDto(row: AppointmentRowWithContext, now: Date) {
  return {
    id: row.id,
    clinic_doctor_id: row.clinic_doctor_id,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status,
    held_until: row.held_until,
    consultation_fee_snapshot: money(row.consultation_fee_snapshot),
    patient_name: row.patient_name,
    patient_phone: row.patient_phone,
    cancellation_reason: row.cancellation_reason,
    // Plan §5.1: "completed" is derived at read time, never a stored status.
    is_completed: row.status === 'CONFIRMED' && row.start_at < now,
    // The cancellation rule itself, so the app never keeps its own copy of it
    // (order.service.ts's `can_cancel` precedent). Advisory: the cancel
    // endpoint re-checks it under the row lock.
    can_cancel: canCustomerCancel(row),
    // Migration 023: a visit can be rated once its slot has ended (same rule
    // the rating endpoint enforces - doctor-rating.service.ts).
    can_rate: row.rating_stars === null && canRateVisit(row, now),
    rating:
      row.rating_stars === null
        ? null
        : { stars: row.rating_stars, comment: row.rating_comment, created_at: row.rating_created_at },
    doctor: {
      id: row.doctor_id,
      full_name: row.doctor_name,
      specialty: row.doctor_specialty,
      photo_url: row.doctor_photo_url,
    },
    clinic: {
      id: row.clinic_id,
      name: row.clinic_name,
      city: row.clinic_city,
      address_line: row.clinic_address_line,
    },
    created_at: row.created_at,
  };
}

function toDetailDto(row: AppointmentRowWithContext, now: Date) {
  return { ...toListDto(row, now), patient_notes: row.patient_notes };
}

function toHoldDto(row: {
  id: string;
  clinic_doctor_id: string;
  start_at: Date;
  end_at: Date;
  status: DentalAppointmentStatus;
  held_until: Date | null;
  consultation_fee_snapshot: number | string | null;
}) {
  return {
    id: row.id,
    clinic_doctor_id: row.clinic_doctor_id,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status,
    held_until: row.held_until,
    consultation_fee_snapshot: money(row.consultation_fee_snapshot),
  };
}

// ----------------------------------------------------------------------------
// ERRORS
// ----------------------------------------------------------------------------

/** One response for "no such appointment" and "not yours" alike: a
 * 403-vs-404 split would confirm that an id exists (plan §15, IDOR). */
function appointmentNotFound(): AppError {
  return new AppError('Appointment not found.', 404, 'APPOINTMENT_NOT_FOUND');
}

function slotUnavailable(details?: unknown): AppError {
  return new AppError('This time slot is no longer available.', 409, 'SLOT_UNAVAILABLE', details ?? null);
}

/**
 * A `start_at` that has already elapsed (review finding I1). Deliberately
 * NOT folded into `SLOT_UNAVAILABLE`: 409 in this module means contention
 * ("someone else has it, try another time"), and retrying cannot help here.
 * 422 matches how the rest of the module answers a well-formed request
 * naming an invalid state (`APPOINTMENT_NOT_CONFIRMED`, `APPOINTMENT_EXPIRED`).
 * It is not a 400 either, because the field itself is a valid instant - the
 * check needs the clock, not the schema.
 */
function slotInPast(): AppError {
  return new AppError('That appointment time has already passed.', 422, 'SLOT_IN_PAST');
}

// ----------------------------------------------------------------------------
// SERVICE
// ----------------------------------------------------------------------------

export class AppointmentService {
  /**
   * POST /dental/appointments/holds - plan §7.3, the `assignRider()` shape
   * (in-transaction pre-check, then the partial unique index as the last
   * line of defence).
   */
  async createHold(customerId: string, input: CreateHoldInput, idempotencyKeyHeader?: string) {
    const idempotencyKey = input.idempotency_key || idempotencyKeyHeader || `apt_${randomUUID()}`;

    // Replay before doing anything (order.service.ts `createOrder`): a client
    // retry after a network timeout must return the same hold, not a second.
    const replay = await appointmentRepository.findReplayableByIdempotencyKey(customerId, idempotencyKey);
    if (replay) return { appointment: toHoldDto(replay), is_idempotent_replay: true };

    try {
      const created = await db.transaction().execute(async (trx) =>
        this.holdInTransaction(trx, customerId, input, idempotencyKey)
      );
      return { appointment: toHoldDto(created), is_idempotent_replay: false };
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code !== '23505') throw err;

      // A 23505 aborts the transaction, so nothing can be re-read inside it -
      // both recoveries below run on a fresh connection, after the rollback.
      if (e.constraint === UQ_IDEMPOTENCY_KEY) {
        const raced = await appointmentRepository.findReplayableByIdempotencyKey(customerId, idempotencyKey);
        if (raced) return { appointment: toHoldDto(raced), is_idempotent_replay: true };
        throw new AppError(
          'This idempotency key has already been used for a different booking.',
          409,
          'IDEMPOTENCY_KEY_CONFLICT'
        );
      }

      // uq_appointments_active_slot: two brand-new inserts for the same slot
      // both passed the FOR UPDATE above (there was no row to lock), and
      // Postgres settled it. The loser gets the same clean 409 as everyone
      // else - exactly assignRider()'s "last line of defence".
      throw slotUnavailable();
    }
  }

  private async holdInTransaction(
    trx: AppointmentTrx,
    customerId: string,
    input: CreateHoldInput,
    idempotencyKey: string
  ) {
    // One instant for this whole transaction: the past-check, the hold
    // expiry comparison and the new held_until are all judged against it.
    const now = new Date();
    const heldUntil = new Date(now.getTime() + HOLD_TTL_MINUTES * 60_000);

    // I1: the cheapest rejection there is, and deliberately BEFORE the slot
    // lock so it covers the reclaim branch too - `resolveOpenSlot` only runs
    // on the insert branch, so a past slot that happens to carry a stale
    // HELD row would otherwise slip through as a reclaim.
    if (input.start_at.getTime() <= now.getTime()) throw slotInPast();

    const pairing = await appointmentRepository.findBookableClinicDoctor(input.clinic_doctor_id, trx);
    if (!pairing) {
      throw new AppError(
        'This doctor is not currently bookable at this clinic.',
        404,
        'CLINIC_DOCTOR_NOT_FOUND'
      );
    }
    const fee = money(pairing.consultation_fee);

    const existing = await appointmentRepository.lockActiveSlotRow(
      trx,
      input.clinic_doctor_id,
      input.start_at
    );

    if (existing) {
      if (existing.status === 'CONFIRMED') throw slotUnavailable();

      const expired = existing.held_until === null || existing.held_until <= now;
      // Ownership is `customer_id` (NOT NULL, ON DELETE RESTRICT), never
      // `held_by` (ON DELETE SET NULL): a null `held_by` on a live HELD row
      // must never read as "unowned, grab it" - it stays occupied, which is
      // also exactly what the unique index would enforce anyway.
      const mine = existing.customer_id === customerId;
      if (!expired && !mine) {
        throw new AppError('Someone else is holding this slot right now.', 409, 'SLOT_HELD');
      }

      // Reclaim the SAME row rather than inserting a second one, so a slot
      // never has two rows even transiently (brief step 5). The fee snapshot
      // is re-read now, because this is effectively a fresh hold.
      return await appointmentRepository.reclaimHold(trx, existing.id, {
        customer_id: customerId,
        held_by: customerId,
        held_until: heldUntil,
        consultation_fee_snapshot: fee,
        idempotency_key: idempotencyKey,
      });
    }

    // Nothing holds this slot: the client's claim that this instant is on the
    // template is re-derived server-side before anything is written
    // (plan §7.6 - availability is never client-trusted).
    const resolved = await availabilityService.resolveOpenSlot(
      input.clinic_doctor_id,
      input.start_at,
      trx,
      now
    );
    if (!resolved.ok) {
      // Unreachable today (the guard above fires first), but kept so the two
      // layers can never disagree about what a past slot means.
      if (resolved.reason === 'IN_PAST') throw slotInPast();
      throw slotUnavailable({ reason: resolved.reason });
    }

    const created = await appointmentRepository.insertHold(trx, {
      clinic_doctor_id: input.clinic_doctor_id,
      customer_id: customerId,
      start_at: input.start_at,
      end_at: new Date(input.start_at.getTime() + resolved.durationMinutes * 60_000),
      held_by: customerId,
      held_until: heldUntil,
      consultation_fee_snapshot: fee,
      idempotency_key: idempotencyKey,
    });

    await appointmentRepository.insertStatusHistory(trx, {
      appointment_id: created.id,
      old_status: null,
      new_status: 'HELD',
      changed_by: customerId,
    });

    return created;
  }

  /** POST /dental/appointments/:id/confirm - plan §7.3's second block. */
  async confirmAppointment(customerId: string, appointmentId: string, input: ConfirmAppointmentInput) {
    await db.transaction().execute(async (trx) => {
      const appointment = await appointmentRepository.lockAppointmentById(trx, appointmentId);
      if (!appointment || appointment.customer_id !== customerId) throw appointmentNotFound();

      if (appointment.status !== 'HELD') {
        throw new AppError('This appointment is not on hold.', 409, 'APPOINTMENT_NOT_HELD', {
          status: appointment.status,
        });
      }
      // An expired hold is never confirmed, even when nobody else took the
      // row - otherwise the five-minute rule would mean nothing.
      if (appointment.held_until === null || appointment.held_until <= new Date()) {
        throw new AppError('Your hold on this slot has expired. Please pick the time again.', 410, 'HOLD_EXPIRED');
      }

      const confirmed = await appointmentRepository.confirmAppointment(trx, appointmentId, {
        patient_name: input.patient_name,
        patient_phone: input.patient_phone,
        patient_notes: input.patient_notes ?? null,
      });
      await appointmentRepository.insertStatusHistory(trx, {
        appointment_id: appointmentId,
        old_status: 'HELD',
        new_status: 'CONFIRMED',
        changed_by: customerId,
      });

      // B5: enqueued in this same transaction (notificationService.enqueue's
      // `executor` param), so a confirm that then fails/rolls back can never
      // leave a stray notification behind. Deterministic idempotency key: a
      // client retry of this same confirm call is rejected earlier (status is
      // no longer HELD, see the check above) and never reaches this line
      // twice, but the key still guards a raw outbox-level retry.
      const context = await appointmentRepository.findNotificationContext(trx, confirmed.clinic_doctor_id);
      await notificationService.enqueue(
        {
          user_id: customerId,
          idempotency_key: `dental_appointment_${appointmentId}_CONFIRMED`,
          channel: 'SMS',
          notification_type: 'DENTAL_APPOINTMENT_CONFIRMED',
          recipient: confirmed.patient_phone as string,
          payload: {
            appointment_id: appointmentId,
            clinic_name: context?.clinic_name ?? 'the clinic',
            doctor_name: context?.doctor_name ?? 'your doctor',
            start_at: confirmed.start_at.toISOString(),
            consultation_fee_snapshot: confirmed.consultation_fee_snapshot,
          },
        },
        trx
      );
      // A late booking (after 18:00 for tomorrow) gets its day-before
      // reminder now, if more than two hours away (appointment-reminders.ts).
      // Best effort: a failure never fails the confirm; the worker's next
      // pass retries it.
      await bestEffort(
        trx,
        () => remindIfDue(trx, appointmentId),
        (err) => logger.error({ err, appointmentId }, 'Could not send the late-booking reminder; the worker will retry')
      );
    });

    return await this.getOwnedAppointment(customerId, appointmentId);
  }

  /** POST /dental/appointments/:id/cancel - customer-facing. */
  async cancelOwnAppointment(customerId: string, appointmentId: string, reason: string | null) {
    await db.transaction().execute(async (trx) => {
      const appointment = await appointmentRepository.lockAppointmentById(trx, appointmentId);
      if (!appointment || appointment.customer_id !== customerId) throw appointmentNotFound();

      assertCancellable(appointment.status);
      if (appointment.status !== 'CONFIRMED') {
        throw new AppError('Only a confirmed appointment can be cancelled.', 422, 'APPOINTMENT_NOT_CONFIRMED', {
          status: appointment.status,
        });
      }
      // Branching on the guard today even though it always returns true, so
      // the cutoff (DENTAL-07) lands as a change to the guard alone.
      if (!canCustomerCancel(appointment)) {
        throw new AppError(
          'This appointment can no longer be cancelled.',
          409,
          'CANCELLATION_NOT_ALLOWED'
        );
      }

      const cancelled = await appointmentRepository.cancelAppointment(trx, appointmentId, {
        status: 'CANCELLED_BY_CUSTOMER',
        cancellation_reason: reason,
        cancelled_by: customerId,
      });
      await appointmentRepository.insertStatusHistory(trx, {
        appointment_id: appointmentId,
        old_status: appointment.status,
        new_status: 'CANCELLED_BY_CUSTOMER',
        changed_by: customerId,
      });

      // B5: only a CONFIRMED row reaches here (checked above), so
      // patient_phone is always set. Same idempotency-key shape as confirm.
      const context = await appointmentRepository.findNotificationContext(trx, cancelled.clinic_doctor_id);
      await notificationService.enqueue(
        {
          user_id: customerId,
          idempotency_key: `dental_appointment_${appointmentId}_CANCELLED`,
          channel: 'SMS',
          notification_type: 'DENTAL_APPOINTMENT_CANCELLED',
          recipient: cancelled.patient_phone as string,
          payload: {
            appointment_id: appointmentId,
            clinic_name: context?.clinic_name ?? 'the clinic',
            doctor_name: context?.doctor_name ?? 'your doctor',
            start_at: cancelled.start_at.toISOString(),
            cancelled_by: 'customer',
            reason: reason ?? null,
          },
        },
        trx
      );
    });

    return await this.getOwnedAppointment(customerId, appointmentId);
  }

  /**
   * POST /admin/dental/appointments/:id/cancel - plan §10's "clinic/admin
   * cancels: always allowed, any time, reason required". No ownership
   * restriction and no cutoff. `HELD` is allowed as well as `CONFIRMED`, so
   * an admin can force-release a slot stuck under someone's abandoned hold
   * without waiting out its five minutes (documented choice, brief (b)).
   */
  async cancelAppointmentAsAdmin(adminId: string, appointmentId: string, reason: string) {
    const row = await db.transaction().execute(async (trx) => {
      const appointment = await appointmentRepository.lockAppointmentById(trx, appointmentId);
      if (!appointment) throw appointmentNotFound();

      assertCancellable(appointment.status);

      const cancelled = await appointmentRepository.cancelAppointment(trx, appointmentId, {
        status: 'CANCELLED_BY_CLINIC',
        cancellation_reason: reason,
        cancelled_by: adminId,
      });
      await appointmentRepository.insertStatusHistory(trx, {
        appointment_id: appointmentId,
        old_status: appointment.status,
        new_status: 'CANCELLED_BY_CLINIC',
        changed_by: adminId,
      });

      // B5: unlike customer-cancel, admin cancel is also reachable from HELD
      // (brief (b): force-releasing an abandoned hold) - a HELD row never
      // collected patient_phone, so there is no confirmed booking and no
      // contact to notify. Only a row that was CONFIRMED (patient_phone set)
      // gets a notification; the customer_id it goes to is the appointment's
      // owner, not the admin who cancelled it (order.ts's enqueueCustomerSms
      // convention: `user_id: order.customer_id`, never the acting admin).
      if (cancelled.patient_phone) {
        const context = await appointmentRepository.findNotificationContext(trx, cancelled.clinic_doctor_id);
        await notificationService.enqueue(
          {
            user_id: cancelled.customer_id,
            idempotency_key: `dental_appointment_${appointmentId}_CANCELLED`,
            channel: 'SMS',
            notification_type: 'DENTAL_APPOINTMENT_CANCELLED',
            recipient: cancelled.patient_phone,
            payload: {
              appointment_id: appointmentId,
              clinic_name: context?.clinic_name ?? 'the clinic',
              doctor_name: context?.doctor_name ?? 'your doctor',
              start_at: cancelled.start_at.toISOString(),
              cancelled_by: 'clinic',
              reason,
            },
          },
          trx
        );
      }
      return appointment;
    });

    const detail = await appointmentRepository.findAppointmentById(row.id);
    if (!detail) throw appointmentNotFound();
    return toDetailDto(detail as AppointmentRowWithContext, new Date());
  }

  /** GET /dental/appointments - this customer's own appointments only. */
  async listOwnAppointments(customerId: string, query: AppointmentListQueryInput) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filters = { status: query.status, bucket: query.bucket, now: new Date() };

    const [rows, total] = await Promise.all([
      appointmentRepository.findCustomerAppointments({
        customerId,
        ...filters,
        limit,
        offset: (page - 1) * limit,
      }),
      appointmentRepository.countCustomerAppointments({ customerId, ...filters }),
    ]);

    return {
      appointments: rows.map((row) => toListDto(row as AppointmentRowWithContext, filters.now)),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 },
    };
  }

  /** GET /dental/appointments/:id - identical 404 for missing and not-mine. */
  async getOwnedAppointment(customerId: string, appointmentId: string) {
    const row = await appointmentRepository.findOwnedAppointment(appointmentId, customerId);
    if (!row) throw appointmentNotFound();
    return toDetailDto(row as AppointmentRowWithContext, new Date());
  }
}

/** The two rejections shared by the customer and admin cancel paths. A
 * terminal row is never re-cancelled, by anyone. */
function assertCancellable(status: DentalAppointmentStatus): void {
  if (CANCELLED_STATUSES.includes(status)) {
    throw new AppError('This appointment is already cancelled.', 409, 'APPOINTMENT_ALREADY_CANCELLED', {
      status,
    });
  }
  if (status === 'EXPIRED') {
    throw new AppError('This hold expired and was never confirmed.', 422, 'APPOINTMENT_EXPIRED', { status });
  }
}

export const appointmentService = new AppointmentService();
