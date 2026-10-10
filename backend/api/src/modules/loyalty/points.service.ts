import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { PointsLedgerKind } from '../../database/types.js';
import type { DBConnection } from '../orders/order.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { logger } from '../../utils/logger.js';
import { programSettings } from './program-settings.js';
import {
  earnBase,
  expiryFor,
  pointsEarned,
  pointsProgramFrom,
  pointsValue,
  redeemablePoints,
  POINTS_PROGRAM_KEY,
  type PointsProgramSetting,
} from './points.rules.js';
import { referralModeForOrder } from '../referrals/referral.service.js';

/**
 * Blynk Points ledger (owner, 2026-10-10; migration 037). Rules in
 * points.rules.ts. Every write takes the customer's user row lock first, so
 * a checkout, a delivery and a staff adjustment for the same customer never
 * interleave. Positive rows are lots (`remaining`, `expires_at`); spending
 * and expiry take from the soonest-expiring lots first.
 */

export const pointsSettings = programSettings<PointsProgramSetting>({
  key: POINTS_PROGRAM_KEY,
  description: 'Blynk Points: on/off, earn rate, point value, redeem limits, expiry',
  auditAction: 'POINTS_PROGRAM_UPDATED',
  parse: pointsProgramFrom,
});

async function lockCustomer(executor: DBConnection, customerId: string): Promise<void> {
  await executor.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
}

/** Writes EXPIRE rows for lots past their date (call under the customer lock, or lazily on a read). */
export async function expireLots(executor: DBConnection, customerId: string, now: Date): Promise<number> {
  const lots = await executor
    .selectFrom('points_ledger')
    .select(['id', 'remaining'])
    .where('customer_id', '=', customerId)
    .where('remaining', '>', 0)
    .where('expires_at', '<=', now)
    .orderBy('expires_at')
    .execute();
  let expired = 0;
  for (const lot of lots) {
    const done = await executor
      .updateTable('points_ledger')
      .set({ remaining: 0 })
      .where('id', '=', lot.id)
      .where('remaining', '=', lot.remaining)
      .executeTakeFirst();
    if (Number(done.numUpdatedRows) !== 1) continue; // a concurrent pass took it
    await executor
      .insertInto('points_ledger')
      .values({ customer_id: customerId, kind: 'EXPIRE', points: -lot.remaining, reason: 'Points expired' })
      .execute();
    expired += lot.remaining;
  }
  return expired;
}

/** Points the customer holds right now (expired lots excluded even before their EXPIRE row is written). */
export async function pointsBalance(executor: DBConnection, customerId: string, now: Date = new Date()): Promise<number> {
  const row = await executor
    .selectFrom('points_ledger')
    .select(sql<number>`coalesce(sum(remaining), 0)::int`.as('n'))
    .where('customer_id', '=', customerId)
    .where('remaining', '>', 0)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .executeTakeFirstOrThrow();
  return row.n;
}

/** Takes `points` from the customer's lots, soonest-expiring (then oldest) first. */
async function consumeLots(executor: DBConnection, customerId: string, points: number, now: Date): Promise<void> {
  const lots = await executor
    .selectFrom('points_ledger')
    .select(['id', 'remaining'])
    .where('customer_id', '=', customerId)
    .where('remaining', '>', 0)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .orderBy(sql`expires_at NULLS LAST`)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  let left = points;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    await executor.updateTable('points_ledger').set({ remaining: lot.remaining - take }).where('id', '=', lot.id).execute();
    left -= take;
  }
  if (left > 0) throw new AppError('Not enough Blynk Points.', 409, 'POINTS_INSUFFICIENT', { short_by: left });
}

async function addLot(
  executor: DBConnection,
  row: { customerId: string; kind: PointsLedgerKind; points: number; expiresAt: Date | null; orderId?: string | null; reason?: string | null; actorId?: string | null }
) {
  return await executor
    .insertInto('points_ledger')
    .values({
      customer_id: row.customerId,
      kind: row.kind,
      points: row.points,
      remaining: row.points,
      expires_at: row.expiresAt,
      order_id: row.orderId ?? null,
      reason: row.reason ?? null,
      actor_user_id: row.actorId ?? null,
    })
    .returning(['id', 'created_at'])
    .executeTakeFirstOrThrow();
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface PointsUse {
  points: number;
  discount_amount: number;
}

/**
 * Points this order uses, decided under the customer's row lock inside the
 * order transaction, or null (off, not asked for, or below the minimum).
 * `due` is what the order costs after every other discount.
 */
export async function decidePointsUse(
  executor: DBConnection,
  params: { customerId: string; due: number; setting: PointsProgramSetting; now: Date }
): Promise<PointsUse | null> {
  if (!params.setting.enabled) return null;
  await lockCustomer(executor, params.customerId);
  await expireLots(executor, params.customerId, params.now);
  const balance = await pointsBalance(executor, params.customerId, params.now);
  const points = redeemablePoints(balance, params.due, params.setting);
  if (points <= 0) return null;
  return { points, discount_amount: pointsValue(points, params.setting.lkr_per_point) };
}

/** Inside the order transaction, after the order row exists. */
export async function recordPointsRedemption(executor: DBConnection, use: PointsUse, orderId: string, customerId: string, now: Date) {
  await consumeLots(executor, customerId, use.points, now);
  await executor
    .insertInto('points_ledger')
    .values({ customer_id: customerId, kind: 'REDEEM', points: -use.points, order_id: orderId, reason: null })
    .execute();
}

/**
 * Cancelling an order gives its points back, as a new lot (expiring
 * `expiry_months` from now under today's setting). What goes back is what
 * the order still holds (orders.points_redeemed - after any trim by
 * RESOLVE_ITEM, whose surplus was already returned).
 */
export async function refundPointsForOrder(
  executor: DBConnection,
  order: { id: string; customer_id: string; points_redeemed?: unknown },
  now: Date = new Date()
) {
  const points = Number(order.points_redeemed ?? 0);
  if (!(points > 0)) return 0;
  const refunded = await executor
    .selectFrom('points_ledger')
    .select('id')
    .where('order_id', '=', order.id)
    .where('kind', '=', 'REFUND')
    .executeTakeFirst();
  if (refunded) return 0;
  await lockCustomer(executor, order.customer_id);
  const setting = await pointsSettings.read();
  await addLot(executor, {
    customerId: order.customer_id,
    kind: 'REFUND',
    points,
    expiresAt: expiryFor(now, setting.expiry_months),
    orderId: order.id,
    reason: 'Order cancelled',
  });
  return points;
}

/**
 * The points on an order after the store removes an item (RESOLVE_ITEM): they
 * never pay more than the new amount due; any surplus goes back as a REFUND
 * lot. Returns the new points and their value.
 */
export async function trimPointsForOrder(
  executor: DBConnection,
  order: { id: string; customer_id: string; points_redeemed: number; points_discount_amount: number },
  due: number,
  now: Date = new Date()
): Promise<PointsUse> {
  const used = Number(order.points_redeemed);
  const value = Number(order.points_discount_amount);
  if (used <= 0 || value <= due) return { points: used, discount_amount: value };
  const perPoint = value / used;
  let keep = Math.floor(due / perPoint + 1e-9);
  while (keep > 0 && Math.round(keep * perPoint * 100) / 100 > due) keep--;
  const giveBack = used - keep;
  if (giveBack > 0) {
    await lockCustomer(executor, order.customer_id);
    const setting = await pointsSettings.read();
    await addLot(executor, {
      customerId: order.customer_id,
      kind: 'ADJUST',
      points: giveBack,
      expiresAt: expiryFor(now, setting.expiry_months),
      orderId: order.id,
      reason: 'Item unavailable: points returned',
    });
  }
  return { points: keep, discount_amount: Math.round(keep * perPoint * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Delivered
// ---------------------------------------------------------------------------

/** Inside the delivery settlement: points for a delivered order (once per order). */
export async function earnPointsForOrder(
  executor: DBConnection,
  order: {
    id: string;
    customer_id: string;
    subtotal_amount: unknown;
    discount_amount: unknown;
    points_discount_amount?: unknown;
    referral_discount_amount?: unknown;
    coupon_code: string | null;
  },
  now: Date = new Date()
): Promise<number> {
  const setting = await pointsSettings.read();
  if (!setting.enabled) return 0;
  const already = await executor.selectFrom('points_ledger').select('id').where('order_id', '=', order.id).where('kind', '=', 'EARN').executeTakeFirst();
  if (already) return 0;
  const base = earnBase({
    subtotal_amount: Number(order.subtotal_amount),
    discount_amount: Number(order.discount_amount ?? 0),
    points_discount_amount: Number(order.points_discount_amount ?? 0),
    discountWasDeliveryFee: await discountWasDeliveryFee(executor, order),
  });
  const points = pointsEarned(base, setting);
  if (points <= 0) return 0;
  await lockCustomer(executor, order.customer_id);
  await addLot(executor, {
    customerId: order.customer_id,
    kind: 'EARN',
    points,
    expiresAt: expiryFor(now, setting.expiry_months),
    orderId: order.id,
  });
  return points;
}

/** Whether the order's coupon / referral discount was a free delivery (off the fee, not the items). */
async function discountWasDeliveryFee(
  executor: DBConnection,
  order: { id: string; coupon_code: string | null; referral_discount_amount?: unknown }
): Promise<boolean> {
  if (Number(order.referral_discount_amount ?? 0) > 0) return (await referralModeForOrder(executor, order.id)) === 'FREE_DELIVERY';
  if (order.coupon_code) {
    const c = await executor.selectFrom('coupons').select('discount_type').where('code', '=', order.coupon_code).executeTakeFirst();
    return c?.discount_type === 'FREE_DELIVERY';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reads and staff adjustments
// ---------------------------------------------------------------------------

export async function pointsHistory(customerId: string, limit: number, offset = 0) {
  const rows = await db
    .selectFrom('points_ledger as l')
    .leftJoin('orders as o', 'o.id', 'l.order_id')
    .leftJoin('users as a', 'a.id', 'l.actor_user_id')
    .select(['l.id', 'l.kind', 'l.points', 'l.remaining', 'l.expires_at', 'l.reason', 'l.created_at', 'o.order_number', 'a.full_name as actor_name'])
    .where('l.customer_id', '=', customerId)
    .orderBy('l.created_at', 'desc')
    .orderBy('l.id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();
  return rows;
}

/** GET /me/points: balance, what it is worth, the program's numbers, and recent history. */
export async function customerPoints(customerId: string, limit = 50) {
  const setting = await pointsSettings.read();
  const now = new Date();
  await db.transaction().execute(async (trx) => {
    await lockCustomer(trx, customerId);
    await expireLots(trx, customerId, now);
  });
  const balance = await pointsBalance(db, customerId, now);
  const history = await pointsHistory(customerId, limit);
  return {
    enabled: setting.enabled,
    balance,
    value_lkr: pointsValue(balance, setting.lkr_per_point),
    program: {
      earn_points: setting.earn_points,
      earn_per_lkr: setting.earn_per_lkr,
      lkr_per_point: setting.lkr_per_point,
      min_redeem_points: setting.min_redeem_points,
      max_redeem_percent: setting.max_redeem_percent,
      expiry_months: setting.expiry_months,
    },
    // Staff reasons stay internal: the customer sees "Adjusted by Blynk".
    history: history.map((h) => ({
      id: h.id,
      kind: h.kind,
      points: h.points,
      order_number: h.order_number,
      expires_at: h.points > 0 ? h.expires_at : null,
      created_at: h.created_at,
    })),
  };
}

/** Admin/Operations: a customer's points with the full history (reasons and who). */
export async function adminCustomerPoints(customerId: string, limit = 100) {
  const user = await db.selectFrom('users').select(['id', 'role']).where('id', '=', customerId).executeTakeFirst();
  if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  const setting = await pointsSettings.read();
  const balance = await pointsBalance(db, customerId);
  const history = await pointsHistory(customerId, limit);
  return {
    customer_id: customerId,
    enabled: setting.enabled,
    balance,
    value_lkr: pointsValue(balance, setting.lkr_per_point),
    history,
  };
}

/** Manual +/- with a reason, audited (POINTS_ADJUSTED). Never below 0. */
export async function adjustPoints(customerId: string, points: number, reason: string, actor: AuditActor) {
  const now = new Date();
  await db.transaction().execute(async (trx) => {
    const user = await trx.selectFrom('users').select(['id']).where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
    if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
    await expireLots(trx, customerId, now);
    const before = await pointsBalance(trx, customerId, now);
    if (points < 0 && before + points < 0) {
      throw new AppError(`This customer has only ${before} points.`, 422, 'POINTS_INSUFFICIENT', { balance: before });
    }
    let entryId: string;
    if (points > 0) {
      const setting = await pointsSettings.read();
      entryId = (await addLot(trx, { customerId, kind: 'ADJUST', points, expiresAt: expiryFor(now, setting.expiry_months), reason, actorId: actor.actorId })).id;
    } else {
      await consumeLots(trx, customerId, -points, now);
      entryId = (
        await trx
          .insertInto('points_ledger')
          .values({ customer_id: customerId, kind: 'ADJUST', points, reason, actor_user_id: actor.actorId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    await writeAudit(trx, actor, {
      action: 'POINTS_ADJUSTED',
      entityType: 'USER',
      entityId: customerId,
      oldValues: { balance: before },
      newValues: { balance: before + points, points, reason, ledger_id: entryId },
    });
    logger.info({ customerId, points, actorId: actor.actorId }, 'Blynk Points adjusted');
  });
  return await adminCustomerPoints(customerId);
}
