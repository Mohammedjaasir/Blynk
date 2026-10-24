import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { DateTime } from 'luxon';
import { enqueuePush } from '../notifications/push/push.repository.js';
import { expiryReady } from './expiry.ready.js';
import { PUSH_WITHIN_DAYS, addDays, colomboToday, expiryPushText } from './expiry.rules.js';

/**
 * The daily "stock is expiring" push to Admin / Operations devices (owner,
 * 2026-10-25; migration 059). At 8 am Colombo (or the first tick after it, until
 * the store day ends) when any ACTIVE batch is expired or expires within
 * PUSH_WITHIN_DAYS days. ONE push per staff member per Colombo day: the outbox
 * row's idempotency key is `expiry-push:<date>:<user>`, so a second tick, a
 * second worker or a restart never sends it twice. Nothing happens before
 * migration 059. Same timer pattern as repeat-baskets/repeat.runner.ts.
 */
export const EXPIRY_PUSH_HOUR = 8;
/** After this hour a missed morning push is not sent late. */
export const EXPIRY_PUSH_LAST_HOUR = 20;
export const EXPIRY_PUSH_INTERVAL_MS = 10 * 60_000;
export const EXPIRY_PUSH_TYPE = 'PUSH_EXPIRY_ALERT';

export function expiryPushDue(now: Date): boolean {
  const hour = DateTime.fromJSDate(now).setZone(STORE_TIMEZONE).hour;
  return hour >= EXPIRY_PUSH_HOUR && hour < EXPIRY_PUSH_LAST_HOUR;
}

/** Counts for the push: already expired, and expiring within PUSH_WITHIN_DAYS (today included). */
async function pushCounts(today: string) {
  const soonEnd = addDays(today, PUSH_WITHIN_DAYS);
  const r = await sql<{ expired: number; soon: number }>`
    SELECT count(*) FILTER (WHERE b.expires_on < ${today}::date)::int AS expired,
           count(*) FILTER (WHERE b.expires_on >= ${today}::date AND b.expires_on <= ${soonEnd}::date)::int AS soon
      FROM stock_batches b
      JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
     WHERE b.status = 'ACTIVE'`.execute(db);
  const names = await sql<{ name: string }>`
    SELECT p.name FROM stock_batches b
      JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
     WHERE b.status = 'ACTIVE' AND b.expires_on <= ${soonEnd}::date
     GROUP BY p.id, p.name
     ORDER BY min(b.expires_on), p.name
     LIMIT 3`.execute(db);
  return { expired: r.rows[0]?.expired ?? 0, soon: r.rows[0]?.soon ?? 0, names: names.rows.map((n) => n.name) };
}

/**
 * Queues today's push (once per staff member per Colombo day). Returns how
 * many pushes were queued. `force` skips the time-of-day window (tests).
 */
export async function runExpiryPush(opts: { now?: Date; force?: boolean } = {}): Promise<{ queued: number }> {
  const now = opts.now ?? new Date();
  if (!opts.force && !expiryPushDue(now)) return { queued: 0 };
  if (!(await expiryReady())) return { queued: 0 };
  const today = colomboToday(now);
  const counts = await pushCounts(today);
  const text = expiryPushText(counts);
  if (!text) return { queued: 0 };

  const staff = await db
    .selectFrom('users as u')
    .select('u.id')
    .where('u.role', 'in', ['ADMIN', 'OPERATIONS'])
    .where('u.is_active', '=', true)
    .where((eb) => eb.exists(eb.selectFrom('device_tokens as d').select('d.id').whereRef('d.user_id', '=', 'u.id')))
    .execute();
  let queued = 0;
  for (const s of staff) {
    const ok = await enqueuePush(db, {
      userId: s.id,
      type: EXPIRY_PUSH_TYPE,
      idempotencyKey: `expiry-push:${today}:${s.id}`,
      payload: { ...text, data: { type: 'staff_expiry' } },
    });
    if (ok) queued++;
  }
  if (queued > 0) logger.info({ today, queued, expired: counts.expired, soon: counts.soon }, 'Expiry push queued');
  return { queued };
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = runExpiryPush()
    .catch((err) => {
      const code = (err as { code?: string }).code;
      if (code === '42P01' || code === '42703') return; // before migration 059
      logger.error({ err }, 'Expiry push failed');
    })
    .finally(() => {
      running = null;
    });
  await running;
}

/** Worker tick (worker.ts), every 10 minutes. */
export const expiryPushJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), EXPIRY_PUSH_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
