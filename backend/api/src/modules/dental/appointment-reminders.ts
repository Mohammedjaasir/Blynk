import crypto from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { DateTime } from 'luxon';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { notificationService } from '../notifications/notification.service.js';
import { OUTBOX_PAUSE_LOCK_KEY } from '../notifications/outbox-pause.js';
import { enqueuePush, PUSH_TYPES } from '../notifications/push/push.repository.js';
import { isPushEnabled } from '../notifications/push/push.sender.js';
import { runBirthdaySms } from '../birthday/birthday.sms.js';

/**
 * Day-before appointment reminders and the post-visit "rate your visit" push
 * (migration 023).
 *
 * Reminder rule. From 18:00 clinic time (Asia/Colombo) on the day before, a
 * CONFIRMED appointment for the next clinic-local day that has not been
 * reminded gets one reminder, provided it starts more than two hours from
 * now. The worker runs this every few minutes, so an appointment confirmed
 * after 18:00 for tomorrow is picked up straight away (confirm also runs it
 * for that one appointment, in its own transaction); one less than two hours
 * away gets none.
 *
 * Exactly once. A guarded UPDATE ... WHERE reminded_at IS NULL claims each
 * row, in the same transaction that queues the message, so two workers (or a
 * worker and a confirm) can never both send it. The outbox row also carries a
 * per-appointment idempotency key. Only CONFIRMED rows are ever claimed, so a
 * cancelled appointment never gets a reminder.
 *
 * Channel. An app push when push is configured and the customer has a
 * registered device; otherwise an SMS to the booking phone, unless the
 * `appointment_reminder_sms_fallback` setting is off. With neither, the
 * reminder is marked handled and nothing is sent.
 */

export const CLINIC_ZONE = 'Asia/Colombo';
/** Reminders for tomorrow start going out at 18:00 clinic time. */
export const REMINDER_HOUR = 18;
/** Never remind about an appointment this close (or closer). */
export const REMINDER_MIN_LEAD_MS = 2 * 60 * 60 * 1000;
/** The rating prompt goes out this long after the slot ends. */
export const RATING_PROMPT_DELAY_MS = 2 * 60 * 60 * 1000;
/** ...and only for visits that ended at most this long before that, so a
 * deploy (or a worker that was down) never prompts about old visits. */
export const RATING_PROMPT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const SMS_FALLBACK_KEY = 'appointment_reminder_sms_fallback';
const DEFAULT_BATCH = 100;

type Executor = Kysely<Database>;

// ----------------------------------------------------------------------------
// PURE RULES
// ----------------------------------------------------------------------------

export interface ReminderWindow {
  /** Start of tomorrow, clinic time (inclusive). */
  from: Date;
  /** Start of the day after tomorrow, clinic time (exclusive). */
  to: Date;
  /** Appointments must start strictly after this (now + 2 hours). */
  after: Date;
}

/** The appointments due a reminder at `now`, or null before 18:00 clinic time. */
export function reminderWindow(now: Date): ReminderWindow | null {
  const local = DateTime.fromJSDate(now, { zone: CLINIC_ZONE });
  if (local.hour < REMINDER_HOUR) return null;
  const tomorrow = local.startOf('day').plus({ days: 1 });
  return {
    from: tomorrow.toJSDate(),
    to: tomorrow.plus({ days: 1 }).toJSDate(),
    after: new Date(now.getTime() + REMINDER_MIN_LEAD_MS),
  };
}

export function isReminderDue(startAt: Date, now: Date): boolean {
  const w = reminderWindow(now);
  if (!w) return false;
  const t = startAt.getTime();
  return t >= w.from.getTime() && t < w.to.getTime() && t > w.after.getTime();
}

export type ReminderChannel = 'PUSH' | 'SMS' | 'NONE';

export function chooseReminderChannel(input: {
  pushEnabled: boolean;
  hasDevice: boolean;
  smsFallback: boolean;
  hasPhone: boolean;
}): ReminderChannel {
  if (input.pushEnabled && input.hasDevice) return 'PUSH';
  if (input.smsFallback && input.hasPhone) return 'SMS';
  return 'NONE';
}

/** "Dr. Silva" and "Silva" both become "Dr Silva". */
export function doctorLabel(fullName: string): string {
  return `Dr ${fullName.trim().replace(/^dr\.?\s+/i, '')}`;
}

/** Clinic-local time of day, e.g. "10:30 AM". */
export function clinicTime(at: Date): string {
  return DateTime.fromJSDate(at, { zone: CLINIC_ZONE }).toFormat('h:mm a');
}

export function reminderMessage(ctx: { doctorName: string; clinicName: string; startAt: Date }) {
  return {
    title: 'Appointment tomorrow',
    body: `${doctorLabel(ctx.doctorName)}, ${ctx.clinicName} at ${clinicTime(ctx.startAt)}. Reply in the app to cancel if you can't make it.`,
  };
}

export function ratingPromptMessage(ctx: { doctorName: string; clinicName: string }) {
  return {
    title: `How was your visit with ${doctorLabel(ctx.doctorName)}?`,
    body: `Tap to rate your visit at ${ctx.clinicName}.`,
  };
}

/** The setting is {"enabled": bool} (or a bare bool); missing or malformed means on. */
export function smsFallbackFrom(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    const enabled = (value as { enabled?: unknown }).enabled;
    if (typeof enabled === 'boolean') return enabled;
  }
  return true;
}

export async function isSmsFallbackEnabled(executor: Executor = db): Promise<boolean> {
  const row = await executor
    .selectFrom('system_configurations')
    .select('value')
    .where('key', '=', SMS_FALLBACK_KEY)
    .executeTakeFirst();
  return smsFallbackFrom(row?.value);
}

// ----------------------------------------------------------------------------
// CLAIM + SEND
// ----------------------------------------------------------------------------

export interface RunOptions {
  /** The clock; injectable for tests. */
  now?: Date;
  batchSize?: number;
  /** Polling runs yield to the outbox pause lock (outbox-pause.ts). */
  yieldToPause?: boolean;
  /** Restrict to these clinic-doctor pairings (tests, manual runs). */
  clinicDoctorIds?: string[];
}

export interface ReminderOutcome {
  appointmentId: string;
  channel: ReminderChannel;
}

interface ClaimedRow {
  id: string;
  customer_id: string;
  patient_phone: string | null;
  start_at: Date;
  doctor_name: string;
  clinic_name: string;
}

async function pauseHeld(trx: Executor): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock_shared(${OUTBOX_PAUSE_LOCK_KEY}) AS ok`.execute(trx);
  return !rows[0]?.ok;
}

/** Claims due, un-reminded CONFIRMED appointments (marking them reminded) and returns them with names. */
async function claimReminders(
  trx: Executor,
  now: Date,
  window: ReminderWindow,
  opts: { limit: number; appointmentId?: string; clinicDoctorIds?: string[] }
): Promise<ClaimedRow[]> {
  const claimed = await sql<{ id: string }>`
    UPDATE appointments SET reminded_at = ${now}
     WHERE id IN (
       SELECT id FROM appointments
        WHERE status = 'CONFIRMED'
          AND reminded_at IS NULL
          AND start_at >= ${window.from}
          AND start_at < ${window.to}
          AND start_at > ${window.after}
          ${opts.appointmentId ? sql`AND id = ${opts.appointmentId}` : sql``}
          ${opts.clinicDoctorIds ? sql`AND clinic_doctor_id = ANY(${opts.clinicDoctorIds}::uuid[])` : sql``}
        ORDER BY start_at
        LIMIT ${opts.limit}
        FOR UPDATE SKIP LOCKED
     )
       AND status = 'CONFIRMED'
       AND reminded_at IS NULL
     RETURNING id`.execute(trx);
  return withNames(trx, claimed.rows.map((r) => r.id));
}

async function withNames(trx: Executor, ids: string[]): Promise<ClaimedRow[]> {
  if (ids.length === 0) return [];
  return await trx
    .selectFrom('appointments')
    .innerJoin('clinic_doctors', 'clinic_doctors.id', 'appointments.clinic_doctor_id')
    .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
    .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id')
    .select([
      'appointments.id',
      'appointments.customer_id',
      'appointments.patient_phone',
      'appointments.start_at',
      'doctors.full_name as doctor_name',
      'dental_clinics.name as clinic_name',
    ])
    .where('appointments.id', 'in', ids)
    .orderBy('appointments.start_at')
    .execute();
}

async function sendReminder(trx: Executor, row: ClaimedRow, smsFallback: boolean): Promise<ReminderChannel> {
  const pushEnabled = isPushEnabled();
  const hasDevice = pushEnabled
    ? !!(await trx.selectFrom('device_tokens').select('id').where('user_id', '=', row.customer_id).limit(1).executeTakeFirst())
    : false;
  const channel = chooseReminderChannel({ pushEnabled, hasDevice, smsFallback, hasPhone: !!row.patient_phone });
  const text = reminderMessage({ doctorName: row.doctor_name, clinicName: row.clinic_name, startAt: row.start_at });
  const idempotencyKey = `dental_appointment_${row.id}_REMINDER`;

  if (channel === 'PUSH') {
    await enqueuePush(trx, {
      userId: row.customer_id,
      type: PUSH_TYPES.APPOINTMENT_REMINDER,
      idempotencyKey,
      payload: { ...text, data: { type: 'appointment', appointment_id: row.id } },
    });
  } else if (channel === 'SMS') {
    await notificationService.enqueue(
      {
        user_id: row.customer_id,
        idempotency_key: idempotencyKey,
        channel: 'SMS',
        notification_type: 'DENTAL_APPOINTMENT_REMINDER',
        recipient: row.patient_phone!,
        payload: { appointment_id: row.id, ...text },
      },
      trx
    );
  } else {
    logger.info({ appointmentId: row.id }, 'Appointment reminder skipped: no app device and SMS fallback is off');
  }
  return channel;
}

async function remindInTransaction(
  trx: Executor,
  now: Date,
  opts: { limit: number; appointmentId?: string; clinicDoctorIds?: string[] }
): Promise<ReminderOutcome[]> {
  const window = reminderWindow(now);
  if (!window) return [];
  const rows = await claimReminders(trx, now, window, opts);
  if (rows.length === 0) return [];
  const smsFallback = await isSmsFallbackEnabled(trx);
  const out: ReminderOutcome[] = [];
  for (const row of rows) out.push({ appointmentId: row.id, channel: await sendReminder(trx, row, smsFallback) });
  return out;
}

/** One reminder pass: claims and queues every reminder due at `now`. */
export async function runAppointmentReminders(opts: RunOptions = {}): Promise<ReminderOutcome[]> {
  const now = opts.now ?? new Date();
  if (!reminderWindow(now)) return [];
  const out = await db.transaction().execute(async (trx) => {
    if (opts.yieldToPause && (await pauseHeld(trx))) return [];
    return remindInTransaction(trx, now, { limit: opts.batchSize ?? DEFAULT_BATCH, clinicDoctorIds: opts.clinicDoctorIds });
  });
  if (out.length) logger.info({ reminded: out.length }, 'Appointment reminders queued');
  return out;
}

/**
 * A late booking: called by confirm, inside its transaction, for the one
 * appointment just confirmed. Sends the reminder now if it is already due.
 */
export async function remindIfDue(trx: Executor, appointmentId: string, now: Date = new Date()): Promise<ReminderOutcome | null> {
  const [outcome] = await remindInTransaction(trx, now, { limit: 1, appointmentId });
  return outcome ?? null;
}

/**
 * The "How was your visit?" push, two hours after a confirmed slot ends,
 * once, push only (nothing is sent without push or a device, but the
 * appointment is still marked prompted). Skips visits already rated.
 */
export async function runRatingPrompts(opts: RunOptions = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  if (!isPushEnabled()) return [];
  const latestEnd = new Date(now.getTime() - RATING_PROMPT_DELAY_MS);
  const earliestEnd = new Date(latestEnd.getTime() - RATING_PROMPT_LOOKBACK_MS);
  const sent = await db.transaction().execute(async (trx) => {
    if (opts.yieldToPause && (await pauseHeld(trx))) return [];
    const claimed = await sql<{ id: string }>`
      UPDATE appointments SET rating_prompted_at = ${now}
       WHERE id IN (
         SELECT a.id FROM appointments a
          WHERE a.status = 'CONFIRMED'
            AND a.rating_prompted_at IS NULL
            AND a.end_at <= ${latestEnd}
            AND a.end_at > ${earliestEnd}
            AND NOT EXISTS (SELECT 1 FROM doctor_ratings r WHERE r.appointment_id = a.id)
            ${opts.clinicDoctorIds ? sql`AND a.clinic_doctor_id = ANY(${opts.clinicDoctorIds}::uuid[])` : sql``}
          ORDER BY a.end_at
          LIMIT ${opts.batchSize ?? DEFAULT_BATCH}
          FOR UPDATE SKIP LOCKED
       )
         AND status = 'CONFIRMED'
         AND rating_prompted_at IS NULL
       RETURNING id`.execute(trx);
    const rows = await withNames(trx, claimed.rows.map((r) => r.id));
    const queued: string[] = [];
    for (const row of rows) {
      const text = ratingPromptMessage({ doctorName: row.doctor_name, clinicName: row.clinic_name });
      const ok = await enqueuePush(trx, {
        userId: row.customer_id,
        type: PUSH_TYPES.RATING_PROMPT,
        idempotencyKey: `dental_appointment_${row.id}_RATING_PROMPT`,
        payload: { ...text, data: { type: 'appointment', appointment_id: row.id } },
      });
      if (ok) queued.push(row.id);
    }
    return queued;
  });
  if (sent.length) logger.info({ prompted: sent.length }, 'Rating prompts queued');
  return sent;
}

// ----------------------------------------------------------------------------
// SCHEDULER (runs in the worker process, beside the outbox worker)
// ----------------------------------------------------------------------------

export class AppointmentReminderJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  readonly id = `reminders_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;

  constructor(readonly intervalMs: number = env.APPOINTMENT_REMINDER_INTERVAL_MS) {}

  start(): void {
    if (this.timer) return;
    logger.info({ jobId: this.id, intervalMs: this.intervalMs }, 'Starting appointment reminder job');
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.running) await this.running;
  }

  /** One pass of each job (reminders, rating prompts, birthday SMS); overlapping ticks are skipped. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = (async () => {
      try {
        await runAppointmentReminders({ now, yieldToPause: true });
      } catch (err) {
        logger.error({ err }, 'Appointment reminder pass failed');
      }
      try {
        await runRatingPrompts({ now, yieldToPause: true });
      } catch (err) {
        logger.error({ err }, 'Rating prompt pass failed');
      }
      // Birthday SMS (owner, 2026-10-09): once per customer per year, on the
      // day, inside the opening hours set by Ops and Admin (birthday/birthday.sms.ts).
      try {
        await runBirthdaySms({ now, yieldToPause: true });
      } catch (err) {
        logger.error({ err }, 'Birthday SMS pass failed');
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
}

export const appointmentReminderJob = new AppointmentReminderJob();
