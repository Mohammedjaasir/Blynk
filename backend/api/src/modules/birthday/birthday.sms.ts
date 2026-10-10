import { sql } from 'kysely';
import type { DateTime } from 'luxon';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { smsAllowedAt } from '../../utils/store-hours.js';
import type { DBConnection } from '../auth/auth.repository.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import { OUTBOX_PAUSE_LOCK_KEY } from '../notifications/outbox-pause.js';
import { BIRTHDAY_WINDOW_DAYS, birthdayOfferSettings, birthdaySmsText, type BirthdayOfferSetting } from '../configuration/settings.service.js';
import { birthdayOfferStatus } from './birthday.offer.js';
import { colomboDay, monthDayCodes } from './birthday.rules.js';

/**
 * The birthday SMS (owner, 2026-10-09): "Happy birthday from Blynk! X% off
 * your order this week." on the customer's birthday, once a year.
 *
 * Runs from the appointment reminder job's tick (dental/appointment-
 * reminders.ts, every few minutes in the worker). The first tick from opening time
 * Colombo on the day queues it, never outside the opening hours (Ops/Admin set them, owner 2026-10-10). Only when the
 * birthday offer AND its SMS are switched on, and only to active customers
 * who have not turned "Offers by SMS" off and have not already used this
 * birthday's gift (the SMS would promise a discount they cannot get).
 *
 * Exactly once a year: each SMS is a notifications outbox row (the worker
 * sends it with the usual retries) whose idempotency key is
 * `bday:<year>:<user id>` (46 characters; SBS keys must stay <= 80) -
 * customers who already have that row are skipped and a duplicate insert is
 * ignored, so several workers or ticks never send twice. A 29 February
 * birthday gets its SMS on 28 February in other years.
 *
 * Closed days (owner, 2026-10-10): with "Send offer/birthday texts on closed
 * days" on (the default) the SMS goes out on the birthday itself - on a
 * weekday marked closed between 8 AM and 9 PM, and holidays / "close now" do
 * not stop it. Switched off, nothing is sent on a closed weekday, a holiday or
 * while the store is closed now; a birthday that fell on such a day gets its
 * SMS on the next open day, within that day's hours, while the customer is
 * still in their birthday week (birthday + BIRTHDAY_WINDOW_DAYS). Which days
 * were missed is not guessed from the schedule (past holidays and "close now"
 * are not kept): the `birthday_sms_days` row remembers the last day the
 * sending window was open, and every day after it up to today is caught up.
 * Still once a year: the key's year is the year of the birthday itself, so a
 * 31 December birthday caught up on 2 January is still that year's SMS.
 */

export const BIRTHDAY_SMS_TYPE = 'BIRTHDAY_OFFER';
const DEFAULT_BATCH = 500;

export const birthdaySmsKey = (year: number, userId: string) => `bday:${year}:${userId}`;

/** Job state, not a staff setting: the last two days the SMS window was open (owner, 2026-10-10). */
export const BIRTHDAY_SMS_DAYS_KEY = 'birthday_sms_days';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function smsDaysFrom(value: unknown): { last_open_day: string | null; previous_open_day: string | null } {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const day = (x: unknown) => (typeof x === 'string' && ISO_DAY.test(x) ? x : null);
  return { last_open_day: day(v.last_open_day), previous_open_day: day(v.previous_open_day) };
}

/**
 * Called while the sending window is open: records today as an open day and
 * returns the open day before it (null when none is known).
 */
async function previousOpenDay(executor: DBConnection, today: string): Promise<string | null> {
  const row = await executor.selectFrom('system_configurations').select('value').where('key', '=', BIRTHDAY_SMS_DAYS_KEY).executeTakeFirst();
  const state = smsDaysFrom(row?.value);
  if (state.last_open_day === today) return state.previous_open_day;
  const previous = state.last_open_day !== null && state.last_open_day < today ? state.last_open_day : null;
  const json = JSON.stringify({ last_open_day: today, previous_open_day: previous });
  await executor
    .insertInto('system_configurations')
    .values({
      key: BIRTHDAY_SMS_DAYS_KEY,
      value: json,
      description: 'Birthday SMS job: the last days its sending window was open (catch-up after closed days)',
    })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: new Date() }))
    .execute();
  return previous;
}

/**
 * The birthdays to text today: today's and - with texts on closed days off
 * (`catchUp`) - those on the days since the previous open day that are still
 * in their birthday week. Newest first.
 */
export function birthdayDaysToText(today: DateTime, previousOpen: string | null, catchUp: boolean): DateTime[] {
  const days = [today];
  if (!catchUp || previousOpen === null) return days;
  for (let i = 1; i <= BIRTHDAY_WINDOW_DAYS; i++) {
    const d = today.minus({ days: i });
    if (d.toISODate()! <= previousOpen) break;
    days.push(d);
  }
  return days;
}

function smsRecipient(phone: string): string | null {
  try {
    return normalizeSriLankanPhone(phone);
  } catch {
    return null; // a deleted account's placeholder or not a Sri Lankan mobile
  }
}

export interface BirthdaySmsOptions {
  now?: Date;
  batchSize?: number;
  /** Polling runs yield to the outbox pause lock (outbox-pause.ts). */
  yieldToPause?: boolean;
  /** Restrict to these customers (tests, manual runs). */
  userIds?: string[];
  /** The setting; read from system_configurations when omitted. */
  setting?: BirthdayOfferSetting;
}

/** One pass: queues today's birthday SMS (and missed ones, see above). Returns the customers queued. */
export async function runBirthdaySms(opts: BirthdaySmsOptions = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  // Sending window = the opening hours set by Ops and Admin, and their "texts
  // on closed days" switch (owner, 2026-10-10).
  const schedule = await storeSchedule.read();
  const onClosedDays = schedule.sms.sms_on_closed_days;
  if (!smsAllowedAt(schedule, now, onClosedDays)) return [];
  const today = colomboDay(now);
  // Recorded before the on/off checks, so days the SMS was switched off are not caught up later.
  const previousOpen = await previousOpenDay(db, today.toISODate()!);
  const setting = opts.setting ?? (await birthdayOfferSettings.read());
  if (!setting.enabled || !setting.sms_enabled) return [];

  const days = birthdayDaysToText(today, previousOpen, !onClosedDays);
  const text = birthdaySmsText(setting);
  const batch = opts.batchSize ?? DEFAULT_BATCH;

  /** Queues the SMS for the birthdays falling on `day` (the key's year is that day's year). */
  async function queueDay(trx: DBConnection, day: DateTime, limit: number): Promise<string[]> {
    const codes = monthDayCodes([day]);
    let q = trx
      .selectFrom('users as u')
      .select(['u.id', 'u.phone'])
      .where('u.role', '=', 'CUSTOMER')
      .where('u.is_active', '=', true)
      .where('u.sms_offers_opted_out_at', 'is', null)
      .where('u.date_of_birth', 'is not', null)
      .where(sql<boolean>`(EXTRACT(MONTH FROM u.date_of_birth) * 100 + EXTRACT(DAY FROM u.date_of_birth)) = ANY(${codes}::numeric[])`)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('notifications as n')
              .select('n.id')
              .where(sql<boolean>`n.idempotency_key = 'bday:' || ${day.year}::text || ':' || u.id::text`)
          )
        )
      );
    if (opts.userIds) q = q.where('u.id', 'in', opts.userIds.length ? opts.userIds : ['00000000-0000-0000-0000-000000000000']);
    const customers = await q.orderBy('u.id').limit(limit).execute();

    const out: string[] = [];
    for (const c of customers) {
      const phone = smsRecipient(c.phone);
      if (!phone) continue;
      const status = await birthdayOfferStatus(trx, c.id, setting, now);
      if (status.used) continue;
      const at = new Date();
      const inserted = await trx
        .insertInto('notifications')
        .values({
          user_id: c.id,
          order_id: null,
          idempotency_key: birthdaySmsKey(day.year, c.id),
          channel: 'SMS',
          notification_type: BIRTHDAY_SMS_TYPE,
          recipient: phone,
          payload: JSON.stringify({ text, percent: setting.percent }),
          status: 'QUEUED',
          attempts: 0,
          max_attempts: 3,
          next_attempt_at: at,
          created_at: at,
          updated_at: at,
        } as never)
        .onConflict((oc) => oc.column('idempotency_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) out.push(c.id);
    }
    return out;
  }

  const queued = await db.transaction().execute(async (trx) => {
    if (opts.yieldToPause) {
      const { rows } = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock_shared(${OUTBOX_PAUSE_LOCK_KEY}) AS ok`.execute(trx);
      if (!rows[0]?.ok) return [];
    }
    const out: string[] = [];
    for (const day of days) {
      if (out.length >= batch) break;
      out.push(...(await queueDay(trx, day, batch - out.length)));
    }
    return out;
  });
  if (queued.length) logger.info({ queued: queued.length }, 'Birthday SMS queued');
  return queued;
}
