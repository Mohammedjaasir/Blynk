import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { storeStatusAt } from '../../utils/store-hours.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import { riderAutoAssignService, type RiderAutoAssignSetting } from '../configuration/rider-auto-assign.js';
import { enqueueAutoAssignNoRiderStaffPush } from '../notifications/push/push.events.js';
import { orderService } from '../orders/order.service.js';
import {
  LOCATION_FRESH_MINUTES,
  distanceKm,
  findOpenDeliveriesForRiders,
  getBatchingRules,
  roundKm,
  toPoint,
  type BatchingRules,
  type Point,
} from './batching.js';
import { riderRepository } from './rider.repository.js';

/**
 * Automatic rider assignment (owner, 2026-10-25; setting configuration/rider-auto-assign.ts).
 *
 * Every 20 s the worker looks at orders that need a rider (PACKED, no delivery row of any kind: staff
 * never assigned them) and have waited `wait_seconds` since they were packed. For each one it ranks
 * the riders with the same rules the manual "suggested rider" uses (riders/rider.suggestions.service.ts:
 * below the trip cap, fewest open deliveries first, then nearest the store by their last GPS point),
 * adds the ones the owner asked for (a recent position, within `max_distance_km` of the drop-off, and
 * the drop-off within the usual trip distance of everything they already carry) and assigns the best
 * through orderService.assignRiderAdmin - the very function manual assignment uses - so the trip rules
 * (under the rider lock), the customer SMS, the rider's push and the delivery row are identical.
 *
 * It never reassigns (an order that ever had a delivery row is left alone), never assigns while the
 * store is closed, and tells staff once when no rider qualifies (audit AUTO_ASSIGN_NO_RIDER + a push).
 *
 * Single-instance safe: a transaction-scoped pg advisory lock (pg_try_advisory_xact_lock) is held for
 * the whole tick, so a second worker skips the tick; the assignment itself is also guarded by the
 * order row lock and uq_deliveries_active_assignment.
 *
 * What it can know about riders is only what the Rider app reports: a rider's position exists only
 * while a delivery is on the road (see docs/05-implementation/blynk-live-location-tracking-report.md),
 * so "recent" means the last point of their latest delivery, at most LOCATION_FRESH_MINUTES old.
 */
export const AUTO_ASSIGN_INTERVAL_MS = 20_000;
export const AUTO_ASSIGN_LOCK_KEY = 7_261_025;
/** An order scheduled further ahead than this is not given to a rider yet. */
export const SCHEDULED_HORIZON_MS = 30 * 60_000;
const BATCH = 25;

/** The actor of an automatic assignment: staff-level role for the lifecycle's role check, no user row. */
export const SYSTEM_ACTOR = { id: 'system', role: 'ADMIN' } as const;

export type ExcludedReason = 'NO_DROPOFF_PIN' | 'AT_CAPACITY' | 'NO_FRESH_POSITION' | 'TOO_FAR_FROM_DROPOFF' | 'TRIP_TOO_FAR';

export interface AutoAssignRider {
  id: string;
  name: string;
  open_deliveries: number;
  /** Last GPS point and when it was captured (null: never seen). */
  position: Point | null;
  seen_at: Date | null;
  /** Drop-off points of the orders the rider already carries (null: no pin on that order). */
  trip_dropoffs: (Point | null)[];
}

export interface RankedRider {
  id: string;
  name: string;
  open_deliveries: number;
  distance_to_store_km: number | null;
  distance_to_dropoff_km: number;
}

export interface Ranking {
  ranked: RankedRider[];
  excluded: { id: string; reason: ExcludedReason }[];
}

export interface RankInput {
  store: Point | null;
  dropoff: Point | null;
  riders: AutoAssignRider[];
  rules: Pick<BatchingRules, 'max_active_deliveries' | 'max_dropoff_distance_km'>;
  config: Pick<RiderAutoAssignSetting, 'max_distance_km'>;
  now: Date;
  freshMinutes?: number;
}

/**
 * Who may take this order automatically, best first (pure). A rider qualifies when they are below the
 * trip cap, have a position no older than `freshMinutes`, are within `max_distance_km` of the drop-off,
 * and every drop-off they already carry is within the trip distance of this one (an unknown distance
 * never qualifies: automatic assignment does not ask for the staff confirmation a far trip needs).
 * Order: fewest open deliveries, then nearest the store (the drop-off when the store has no pin), then
 * nearest the drop-off, then name.
 */
export function rankAutoAssignRiders(input: RankInput): Ranking {
  const { store, dropoff, riders, rules, config, now } = input;
  const freshAfter = now.getTime() - (input.freshMinutes ?? LOCATION_FRESH_MINUTES) * 60_000;
  const excluded: Ranking['excluded'] = [];
  const ranked: (RankedRider & { sort: number })[] = [];

  for (const r of riders) {
    if (!dropoff) {
      excluded.push({ id: r.id, reason: 'NO_DROPOFF_PIN' });
      continue;
    }
    if (r.open_deliveries >= rules.max_active_deliveries) {
      excluded.push({ id: r.id, reason: 'AT_CAPACITY' });
      continue;
    }
    // A point from the future (more than a minute ahead of `now`) is clock skew, not a position.
    if (!r.position || !r.seen_at || r.seen_at.getTime() < freshAfter || r.seen_at.getTime() > now.getTime() + 60_000) {
      excluded.push({ id: r.id, reason: 'NO_FRESH_POSITION' });
      continue;
    }
    const toDrop = distanceKm(r.position, dropoff);
    if (toDrop > config.max_distance_km) {
      excluded.push({ id: r.id, reason: 'TOO_FAR_FROM_DROPOFF' });
      continue;
    }
    const tripOk = r.trip_dropoffs.every((p) => p !== null && distanceKm(dropoff, p) <= rules.max_dropoff_distance_km);
    if (!tripOk) {
      excluded.push({ id: r.id, reason: 'TRIP_TOO_FAR' });
      continue;
    }
    const toStore = store ? distanceKm(r.position, store) : null;
    ranked.push({
      id: r.id,
      name: r.name,
      open_deliveries: r.open_deliveries,
      distance_to_store_km: toStore === null ? null : roundKm(toStore),
      distance_to_dropoff_km: roundKm(toDrop),
      sort: toStore ?? toDrop,
    });
  }

  ranked.sort(
    (a, b) =>
      a.open_deliveries - b.open_deliveries ||
      a.sort - b.sort ||
      a.distance_to_dropoff_km - b.distance_to_dropoff_km ||
      a.name.localeCompare(b.name)
  );
  return { ranked: ranked.map(({ sort: _sort, ...r }) => r), excluded };
}

export interface AutoAssignResult {
  /** Why nothing was looked at: switched off, store closed, or another worker holds the tick. */
  skipped: 'disabled' | 'closed' | 'locked' | null;
  considered: number;
  assigned: { order_id: string; order_number: string; rider_id: string; delivery_id: string }[];
  no_rider: { order_id: string; order_number: string; first_time: boolean }[];
}

interface Candidate {
  id: string;
  order_number: string;
  delivery_latitude: unknown;
  delivery_longitude: unknown;
  scheduled_for: Date | null;
  packed_at: Date;
}

/** Orders that need a rider and were never assigned: PACKED with no delivery row at all, longest waiting first. */
async function findCandidates(orderIds?: string[]): Promise<Candidate[]> {
  const { rows } = await sql<Candidate>`
    SELECT o.id, o.order_number, o.delivery_latitude, o.delivery_longitude, o.scheduled_for,
           COALESCE(
             (SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.new_status = 'PACKED'),
             o.updated_at
           ) AS packed_at
      FROM orders o
     WHERE o.order_status = 'PACKED'
       AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id)
       ${orderIds ? sql`AND o.id IN (${sql.join(orderIds.length ? orderIds.map((id) => sql`${id}::uuid`) : [sql`NULL::uuid`])})` : sql``}
     ORDER BY packed_at ASC, o.id ASC
     LIMIT ${BATCH}`.execute(db);
  return rows;
}

/** Riders as the ranking needs them, read fresh (an earlier assignment this tick changes their load). */
async function loadRiders(): Promise<AutoAssignRider[]> {
  const list = await riderRepository.listActiveRidersForAssignment();
  const ids = list.map((r) => r.id);
  const [points, open] = await Promise.all([riderRepository.findLastKnownPoints(ids), findOpenDeliveriesForRiders(ids)]);
  const pointOf = new Map(points.map((p) => [p.rider_id, p]));
  return list.map((r) => {
    const last = pointOf.get(r.id);
    return {
      id: r.id,
      name: r.full_name ?? r.phone ?? 'Rider',
      open_deliveries: Number(r.open_deliveries),
      position: last ? toPoint(last.current_latitude, last.current_longitude) : null,
      seen_at: last?.location_captured_at ?? null,
      trip_dropoffs: open.filter((d) => d.rider_id === r.id).map((d) => d.dropoff),
    };
  });
}

/** audit_logs row with no user (the system acted). */
async function writeSystemAudit(
  executor: Kysely<Database> | Transaction<Database>,
  action: string,
  orderId: string,
  newValues: Record<string, unknown>
) {
  await executor
    .insertInto('audit_logs')
    .values({
      actor_user_id: null,
      action,
      entity_type: 'ORDER',
      entity_id: orderId,
      old_values: null,
      new_values: JSON.stringify({ actor: 'system', ...newValues }),
      ip_address: null,
      user_agent: null,
    })
    .execute();
}

/** Riders the next candidate may be tried with when this one's attempt was refused by the trip rules. */
const TRY_NEXT_RIDER = new Set(['RIDER_AT_CAPACITY', 'BATCH_DROPOFFS_TOO_FAR', 'RIDER_INACTIVE', 'RIDER_NOT_APPROVED', 'RIDER_NOT_FOUND']);

async function tellStaffOnce(order: Candidate, waitedSeconds: number): Promise<boolean> {
  return await db.transaction().execute(async (trx) => {
    const seen = await trx
      .selectFrom('audit_logs')
      .select('id')
      .where('action', '=', 'AUTO_ASSIGN_NO_RIDER')
      .where('entity_type', '=', 'ORDER')
      .where('entity_id', '=', order.id)
      .limit(1)
      .executeTakeFirst();
    if (seen) return false;
    await writeSystemAudit(trx, 'AUTO_ASSIGN_NO_RIDER', order.id, { order_number: order.order_number, waited_seconds: waitedSeconds });
    await enqueueAutoAssignNoRiderStaffPush(trx, { id: order.id, order_number: order.order_number });
    return true;
  });
}

async function processOrder(order: Candidate, setting: RiderAutoAssignSetting, now: Date, result: AutoAssignResult) {
  const waited = Math.floor((now.getTime() - new Date(order.packed_at).getTime()) / 1000);
  if (waited < setting.wait_seconds) return;
  if (order.scheduled_for && new Date(order.scheduled_for).getTime() > now.getTime() + SCHEDULED_HORIZON_MS) return;

  const [rules, riders, store] = await Promise.all([
    getBatchingRules(),
    loadRiders(),
    riderRepository.findOrderDispatchPoints(order.id),
  ]);
  const ranking = rankAutoAssignRiders({
    store: store ? toPoint(store.store_latitude, store.store_longitude) : null,
    dropoff: toPoint(order.delivery_latitude, order.delivery_longitude),
    riders,
    rules,
    config: setting,
    now,
  });

  if (ranking.ranked.length === 0) {
    const first_time = await tellStaffOnce(order, waited);
    result.no_rider.push({ order_id: order.id, order_number: order.order_number, first_time });
    return;
  }

  for (const rider of ranking.ranked) {
    try {
      const delivery = await orderService.assignRiderAdmin(order.id, rider.id, SYSTEM_ACTOR, false);
      result.assigned.push({ order_id: order.id, order_number: order.order_number, rider_id: rider.id, delivery_id: delivery.id });
      try {
        await writeSystemAudit(db, 'AUTO_ASSIGNED', order.id, {
          order_number: order.order_number,
          rider_id: rider.id,
          delivery_id: delivery.id,
          waited_seconds: waited,
          distance_to_store_km: rider.distance_to_store_km,
          distance_to_dropoff_km: rider.distance_to_dropoff_km,
          open_deliveries_before: rider.open_deliveries,
        });
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Automatic assignment done but its audit row could not be written');
      }
      logger.info({ orderId: order.id, riderId: rider.id, waited }, 'Order assigned automatically');
      return;
    } catch (err) {
      if (err instanceof AppError && TRY_NEXT_RIDER.has(err.code)) continue;
      // Someone assigned it, changed it or cancelled it in the meantime: nothing more to do.
      if (err instanceof AppError && err.statusCode < 500) return;
      throw err;
    }
  }
  // Every ranked rider was refused under the lock (a race with a manual assignment): staff are told once.
  const first_time = await tellStaffOnce(order, waited);
  result.no_rider.push({ order_id: order.id, order_number: order.order_number, first_time });
}

/**
 * One tick. `now` drives every comparison (waiting time, how old a rider's point is, store hours), so
 * tests can pin it; `orderIds` limits the tick to those orders (tests, manual runs).
 */
export async function runAutoAssign(opts: { now?: Date; orderIds?: string[] } = {}): Promise<AutoAssignResult> {
  const result: AutoAssignResult = { skipped: null, considered: 0, assigned: [], no_rider: [] };
  const now = opts.now ?? new Date();
  const setting = await riderAutoAssignService.read();
  if (!setting.enabled) return { ...result, skipped: 'disabled' };
  if (!storeStatusAt(await storeSchedule.read(), now).is_open_now) return { ...result, skipped: 'closed' };

  // The advisory lock lives as long as this transaction; the assignments use their own connections.
  return await db.transaction().execute(async (lockTrx) => {
    const got = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock(${AUTO_ASSIGN_LOCK_KEY}) AS ok`.execute(lockTrx);
    if (!got.rows[0]?.ok) return { ...result, skipped: 'locked' as const };
    const candidates = await findCandidates(opts.orderIds);
    result.considered = candidates.length;
    for (const order of candidates) {
      try {
        await processOrder(order, setting, now, result);
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Automatic assignment failed for an order');
      }
    }
    return result;
  });
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = runAutoAssign()
    .catch((err) => logger.error({ err }, 'Automatic rider assignment tick failed'))
    .finally(() => {
      running = null;
    });
  await running;
}

/** Worker tick (worker.ts), every 20 seconds - same pattern as the other worker jobs. */
export const riderAutoAssignJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), AUTO_ASSIGN_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
