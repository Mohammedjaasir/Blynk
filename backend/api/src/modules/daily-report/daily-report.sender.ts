import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { orderingClock } from '../../utils/time.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { DAILY_REPORT_KEY, dailyReportFrom, type DailyReportSetting } from '../configuration/daily-report.js';
import { notificationService } from '../notifications/notification.service.js';
import { buildDailyReport, smsParts } from './daily-report.builder.js';
import { gatherDailyReportData } from './daily-report.data.js';

/**
 * Sending the daily report (owner, 2026-10-25). The text is plain and complete when queued, so the
 * outbox sends it exactly as written (notification type DAILY_REPORT, a passthrough in
 * notifications/notification.templates.ts) to every saved number.
 *
 * Automatic: a worker tick every minute. Once per Colombo date, as soon as send_at has passed. A
 * missed time (worker down, deploy) sends late the same evening, up to 23:30 (or 30 minutes after
 * a send_at later than that, never past 23:59) - never the next day, because the report is about
 * "today". Exactly-once is held twice: the settings row is locked and last_sent_date moved in the
 * same transaction as the outbox rows, and each row has the key `daily-report:<date>:<phone>`.
 *
 * Manual ("Send now"): the same text for today so far, to the same numbers, at most once every
 * 2 minutes (persisted, so it holds across API instances); it does not count as the day's
 * automatic report.
 */
export const DAILY_REPORT_SMS_TYPE = 'DAILY_REPORT';
export const DAILY_REPORT_INTERVAL_MS = 60_000;
export const SEND_NOW_COOLDOWN_MS = 2 * 60_000;
/** The latest minute of the day an automatic report still goes out (23:30), unless send_at is later. */
export const LATE_SEND_LIMIT_MIN = 23 * 60 + 30;

type Trx = Transaction<Database>;

export const colomboDate = (now: Date): string => DateTime.fromJSDate(now).setZone('Asia/Colombo').toISODate()!;

function colomboMinutes(now: Date): number {
  const t = DateTime.fromJSDate(now).setZone('Asia/Colombo');
  return t.hour * 60 + t.minute;
}

const sendAtMinutes = (sendAt: string): number => {
  const [h, m] = sendAt.split(':').map(Number);
  return (h ?? 21) * 60 + (m ?? 0);
};

/** Whether the automatic report is due at `now`: on, has numbers, not sent today, inside [send_at, late limit] (Colombo). */
export function isAutoSendDue(setting: DailyReportSetting, now: Date): boolean {
  if (!setting.enabled || setting.phones.length === 0) return false;
  if (setting.last_sent_date === colomboDate(now)) return false;
  const at = sendAtMinutes(setting.send_at);
  const latest = Math.max(LATE_SEND_LIMIT_MIN, Math.min(23 * 60 + 59, at + 30));
  const minutes = colomboMinutes(now);
  return minutes >= at && minutes <= latest;
}

export interface ReportPreview {
  date: string;
  text: string;
  chars: number;
  parts: number;
}

/** The text for today so far (Colombo), exactly as it would be sent. */
export async function previewDailyReport(now: Date = orderingClock.now()): Promise<ReportPreview> {
  const date = colomboDate(now);
  const text = buildDailyReport(await gatherDailyReportData(date));
  return { date, text, chars: text.length, parts: smsParts(text) };
}

async function lockedSetting(trx: Trx): Promise<DailyReportSetting> {
  const row = await trx.selectFrom('system_configurations').select('value').where('key', '=', DAILY_REPORT_KEY).forUpdate().executeTakeFirst();
  return dailyReportFrom(row?.value);
}

async function saveSetting(trx: Trx, next: DailyReportSetting): Promise<void> {
  await trx.updateTable('system_configurations').set({ value: JSON.stringify(next) }).where('key', '=', DAILY_REPORT_KEY).execute();
}

/** One outbox row per number. Returns how many were queued (an already-queued key counts as none). */
async function queueReport(trx: Trx, phones: string[], text: string, date: string, keyFor: (phone: string) => string): Promise<number> {
  let queued = 0;
  for (const phone of phones) {
    const row = await notificationService.enqueue(
      {
        channel: 'SMS',
        notification_type: DAILY_REPORT_SMS_TYPE,
        recipient: phone,
        idempotency_key: keyFor(phone),
        payload: { text, report_date: date },
      },
      trx
    );
    if (row) queued++;
  }
  return queued;
}

export interface AutoRunResult {
  sent: boolean;
  date: string;
  queued: number;
}

/** One tick: sends today's report when it is due. Safe to call as often as you like. */
export async function runDailyReport(opts: { now?: Date } = {}): Promise<AutoRunResult> {
  const now = opts.now ?? orderingClock.now();
  const date = colomboDate(now);
  const none: AutoRunResult = { sent: false, date, queued: 0 };

  // Cheap pre-check without a lock: most ticks end here.
  const row = await db.selectFrom('system_configurations').select('value').where('key', '=', DAILY_REPORT_KEY).executeTakeFirst();
  if (!isAutoSendDue(dailyReportFrom(row?.value), now)) return none;

  return await db.transaction().execute(async (trx) => {
    const setting = await lockedSetting(trx);
    if (!isAutoSendDue(setting, now)) return none; // another worker got there first
    const text = buildDailyReport(await gatherDailyReportData(date));
    const queued = await queueReport(trx, setting.phones, text, date, (phone) => `daily-report:${date}:${phone}`);
    await saveSetting(trx, { ...setting, last_sent_date: date, last_sent_at: now.toISOString(), last_sent_kind: 'auto' });
    logger.info({ date, recipients: setting.phones.length, queued, chars: text.length }, 'Daily report queued');
    return { sent: true, date, queued };
  });
}

export interface SendNowResult extends ReportPreview {
  recipients: number;
  sent_at: string;
}

/** POST /admin/daily-report/send-now. 400 without numbers, 429 inside the 2-minute cooldown. Audited. */
export async function sendDailyReportNow(actor: AuditActor, now: Date = orderingClock.now()): Promise<SendNowResult> {
  return await db.transaction().execute(async (trx) => {
    const setting = await lockedSetting(trx);
    if (setting.phones.length === 0) {
      throw new AppError('Add at least one number first.', 400, 'DAILY_REPORT_NO_RECIPIENTS');
    }
    if (setting.last_manual_at) {
      const wait = new Date(setting.last_manual_at).getTime() + SEND_NOW_COOLDOWN_MS - now.getTime();
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        throw new AppError(`The report was just sent. Try again in ${seconds} seconds.`, 429, 'DAILY_REPORT_COOLDOWN', { retry_after_seconds: seconds });
      }
    }
    const date = colomboDate(now);
    const text = buildDailyReport(await gatherDailyReportData(date));
    const stamp = now.toISOString();
    const press = randomUUID(); // every press is its own send
    const queued = await queueReport(trx, setting.phones, text, date, (phone) => `daily-report-now:${press}:${phone}`);
    await saveSetting(trx, { ...setting, last_sent_at: stamp, last_sent_kind: 'manual', last_manual_at: stamp });
    await writeAudit(trx, actor, {
      action: 'DAILY_REPORT_SENT_NOW',
      entityType: 'SYSTEM_CONFIGURATION',
      entityId: SETTINGS_ENTITY_ID,
      newValues: { key: DAILY_REPORT_KEY, report_date: date, recipients: setting.phones.length, chars: text.length },
    });
    logger.info({ actorId: actor.actorId, date, recipients: setting.phones.length, queued }, 'Daily report sent now');
    return { date, text, chars: text.length, parts: smsParts(text), recipients: setting.phones.length, sent_at: stamp };
  });
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = runDailyReport()
    .catch((err) => logger.error({ err }, 'Daily report run failed'))
    .finally(() => {
      running = null;
    });
  await running;
}

/** Worker tick (worker.ts), every minute - same pattern as the repeat basket job. */
export const dailyReportJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), DAILY_REPORT_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
