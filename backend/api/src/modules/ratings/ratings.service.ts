import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { DBConnection } from '../orders/order.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { publicPhone } from '../../utils/phone.js';
import { rangeBounds } from '../reports/sales.service.js';
import { enqueueLowRatingStaffPush } from '../notifications/push/push.events.js';
import { expireWallet, walletBalance, walletSettings } from '../wallet/wallet.service.js';
import { assertRatingsReady, ratingsReady } from './ratings.ready.js';
import {
  editUntil,
  insideEditWindow,
  insideRateWindow,
  lowRatingPushBody,
  MAX_TIP_LKR,
  RATING_TAGS,
  rateUntil,
  shouldAlertLowRating,
  summarize,
  tagLabel,
  TIP_OPTIONS_LKR,
  type RatingInput,
  type StaffRatingsQuery,
} from './ratings.rules.js';

/*
 * Order ratings + rider tips (owner, 2026-10-24; migration 055). Rules in
 * ratings.rules.ts.
 *
 *   checkout     checkoutRiderTip (order.service) -> orders.rider_tip, inside
 *                total_amount: the rider collects it in cash with the order
 *   after        tipFromWallet -> a RIDER_TIP wallet debit + orders.rider_tip_wallet
 *   rider pay    riders/rider.pay-ledger.ts: both kinds, 100% to the rider who
 *                delivered, as "tips" apart from the delivery pay
 */

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * The tip a new order carries (order create). 0 without one. Before migration
 * 055 a tip is ignored (0, logged) rather than refused: no money is taken that
 * could not be recorded, and the order still goes through; the app hides the
 * tip choice while GET /store says ratings_enabled: false. A tip with ONLINE
 * payment is refused (422 TIP_CASH_ONLY): it is collected in cash.
 */
export async function checkoutRiderTip(customerId: string, tipLkr: number | undefined, online: boolean): Promise<number> {
  if (!tipLkr || !(tipLkr > 0)) return 0;
  if (!(await ratingsReady())) {
    logger.info({ customerId, tipLkr }, 'Rider tip ignored: migration 055 is not run yet');
    return 0;
  }
  if (online) {
    throw new AppError(
      'A tip at checkout is paid in cash to your rider. Choose cash on delivery, or tip from your Blynk Wallet after delivery.',
      422,
      'TIP_CASH_ONLY'
    );
  }
  return money(tipLkr);
}

/** GET /orders/checkout-info: the tip choice (none until migration 055). */
export async function checkoutTipInfo() {
  const ready = await ratingsReady();
  return {
    tips_enabled: ready,
    tip_options: ready ? [...TIP_OPTIONS_LKR] : [],
    tip_max_lkr: ready ? MAX_TIP_LKR : 0,
  };
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

interface CustomerOrder {
  id: string;
  order_number: string;
  customer_id: string;
  order_status: string;
  delivered_at: Date | null;
  rider_tip: unknown;
  rider_tip_wallet: unknown;
  rider_tip_wallet_at: Date | null;
}

async function customerOrder(executor: DBConnection, orderId: string, customerId: string, lock = false): Promise<CustomerOrder> {
  let q = executor
    .selectFrom('orders')
    .select(['id', 'order_number', 'customer_id', 'order_status', 'delivered_at', 'rider_tip', 'rider_tip_wallet', 'rider_tip_wallet_at'])
    .where('id', '=', orderId)
    .where('customer_id', '=', customerId);
  if (lock) q = q.forUpdate();
  const order = await q.executeTakeFirst();
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  // delivered_at is written by the settlement; an older row falls back to its delivery's.
  if (order.order_status === 'DELIVERED' && !order.delivered_at) {
    const d = await deliveredRider(executor, orderId);
    return { ...order, delivered_at: d?.delivered_at ?? null };
  }
  return order;
}

/** The rider who delivered the order (the DELIVERED delivery), or null. */
async function deliveredRider(executor: DBConnection, orderId: string) {
  return (
    (await executor
      .selectFrom('deliveries as d')
      .innerJoin('riders as r', 'r.id', 'd.rider_id')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['d.rider_id', 'd.delivered_at', 'u.full_name'])
      .where('d.order_id', '=', orderId)
      .where('d.assignment_status', '=', 'DELIVERED')
      .orderBy('d.delivered_at', 'desc')
      .limit(1)
      .executeTakeFirst()) ?? null
  );
}

function presentRating(r: { order_id: string; stars: number; tags: string[] | null; comment: string | null; created_at: Date; updated_at: Date }) {
  return {
    order_id: r.order_id,
    stars: Number(r.stars),
    tags: r.tags ?? [],
    comment: r.comment,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * What the rating card needs for one order: the rating (or null), whether it
 * can be given / changed and until when, the tags to pick from, and the tip -
 * the checkout tip (cash), a wallet tip, and whether a wallet tip can still be
 * given (the app hides each tip amount above wallet_balance).
 */
async function ratingState(executor: DBConnection, order: CustomerOrder, now = new Date()) {
  const [rating, rider, setting, balance] = await Promise.all([
    executor.selectFrom('order_ratings').selectAll().where('order_id', '=', order.id).executeTakeFirst(),
    deliveredRider(executor, order.id),
    walletSettings.read(),
    walletBalance(executor, order.customer_id, now),
  ]);
  const delivered = order.order_status === 'DELIVERED';
  const inWindow = delivered && insideRateWindow(order.delivered_at, now);
  const cashTip = money(order.rider_tip);
  const walletTip = money(order.rider_tip_wallet);
  const tipped = cashTip > 0 || walletTip > 0;
  return {
    order_id: order.id,
    order_number: order.order_number,
    order_status: order.order_status,
    delivered_at: order.delivered_at,
    rating: rating ? presentRating(rating) : null,
    can_rate: inWindow && !rating,
    can_edit: !!rating && insideEditWindow(rating.created_at, now),
    rate_until: delivered ? rateUntil(order.delivered_at) : null,
    edit_until: rating ? editUntil(rating.created_at) : null,
    tags: RATING_TAGS.map((tag) => ({ tag, label: tagLabel(tag) })),
    tip: {
      /** Added at checkout, collected in cash with the order. */
      rider_tip: cashTip,
      /** Paid after delivery from the Blynk Wallet. */
      rider_tip_wallet: walletTip,
      tipped,
      source: cashTip > 0 ? ('CASH' as const) : walletTip > 0 ? ('WALLET' as const) : null,
      rider_first_name: rider?.full_name?.trim().split(/\s+/)[0] || null,
      can_tip: inWindow && !tipped && !!rider && setting.enabled && balance > 0,
      wallet_balance: balance,
      tip_options: [...TIP_OPTIONS_LKR],
      max_lkr: MAX_TIP_LKR,
    },
  };
}

/** GET /orders/:id/rating. */
export async function getRating(orderId: string, customerId: string) {
  await assertRatingsReady();
  return await ratingState(db, await customerOrder(db, orderId, customerId));
}

/**
 * POST /orders/:id/rating: rates the customer's DELIVERED order within 14 days
 * of delivery, or changes the rating within 24 h of giving it. A rating that
 * newly drops to 1-2 stars queues the staff "low rating" push in the same
 * transaction.
 */
export async function rateOrder(orderId: string, customerId: string, input: RatingInput) {
  await assertRatingsReady();
  const now = new Date();
  const created = await db.transaction().execute(async (trx) => {
    const order = await customerOrder(trx, orderId, customerId, true);
    if (order.order_status !== 'DELIVERED') {
      throw new AppError('You can rate an order once it is delivered.', 422, 'ORDER_NOT_DELIVERED', { order_status: order.order_status });
    }
    const existing = await trx.selectFrom('order_ratings').selectAll().where('order_id', '=', order.id).executeTakeFirst();
    if (!existing) {
      if (!insideRateWindow(order.delivered_at, now)) {
        throw new AppError('This order can no longer be rated.', 422, 'RATING_WINDOW_CLOSED', { rate_until: rateUntil(order.delivered_at) });
      }
      const rider = await deliveredRider(trx, order.id);
      await trx
        .insertInto('order_ratings')
        .values({
          order_id: order.id,
          user_id: customerId,
          rider_id: rider?.rider_id ?? null,
          stars: input.stars,
          tags: input.tags,
          comment: input.comment,
        })
        .execute();
    } else {
      if (!insideEditWindow(existing.created_at, now)) {
        throw new AppError('A rating can only be changed within 24 hours.', 409, 'RATING_LOCKED', { edit_until: editUntil(existing.created_at) });
      }
      await trx
        .updateTable('order_ratings')
        .set({ stars: input.stars, tags: input.tags, comment: input.comment, updated_at: now })
        .where('order_id', '=', order.id)
        .execute();
    }
    if (shouldAlertLowRating(existing ? Number(existing.stars) : null, input.stars)) {
      await enqueueLowRatingStaffPush(trx, {
        order: { id: order.id, order_number: order.order_number },
        stars: input.stars,
        body: lowRatingPushBody(input.stars, order.order_number, input.tags, input.comment),
      });
    }
    return !existing;
  });
  logger.info({ orderId, stars: input.stars, created }, created ? 'Order rated' : 'Order rating changed');
  return { created, state: await ratingState(db, await customerOrder(db, orderId, customerId)) };
}

/**
 * POST /orders/:id/tip: a tip for the rider from the customer's Blynk Wallet,
 * after delivery (within the same 14 days), once per order and only for an
 * order without a checkout tip. The balance must cover it (409 WALLET_LOW).
 * Writes a RIDER_TIP wallet debit (the ledger stays append-only) and
 * orders.rider_tip_wallet; the rider pay ledger credits it to the rider who
 * delivered the order.
 */
export async function tipFromWallet(orderId: string, customerId: string, amountLkr: number) {
  await assertRatingsReady();
  const now = new Date();
  const amount = money(amountLkr);
  try {
    await db.transaction().execute(async (trx) => {
      const order = await customerOrder(trx, orderId, customerId, true);
      if (order.order_status !== 'DELIVERED') {
        throw new AppError('You can tip your rider once the order is delivered.', 422, 'ORDER_NOT_DELIVERED', { order_status: order.order_status });
      }
      if (!insideRateWindow(order.delivered_at, now)) {
        throw new AppError('This order can no longer get a tip.', 422, 'TIP_WINDOW_CLOSED', { tip_until: rateUntil(order.delivered_at) });
      }
      if (money(order.rider_tip) > 0 || money(order.rider_tip_wallet) > 0) {
        throw new AppError('This order already has a tip. Thank you!', 409, 'TIP_ALREADY_GIVEN');
      }
      const rider = await deliveredRider(trx, order.id);
      if (!rider) throw new AppError('There is no rider to tip on this order.', 422, 'NO_RIDER_TO_TIP');
      const setting = await walletSettings.read();
      if (!setting.enabled) throw new AppError('The Blynk Wallet is not available right now.', 422, 'WALLET_DISABLED');

      // The customer's row lock, as every wallet write takes (wallet.service).
      await trx.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
      await expireWallet(trx, customerId, now);
      const balance = await walletBalance(trx, customerId, now);
      if (balance + 0.001 < amount) {
        throw new AppError('Not enough in your Blynk Wallet for this tip.', 409, 'WALLET_LOW', { balance, amount });
      }
      await trx
        .insertInto('wallet_entries')
        .values({
          customer_id: customerId,
          kind: 'RIDER_TIP',
          amount: -amount,
          order_id: order.id,
          reason: `Tip for the rider on order ${order.order_number}`,
        })
        .execute();
      await trx
        .updateTable('orders')
        .set({ rider_tip_wallet: amount, rider_tip_wallet_at: now, updated_at: now })
        .where('id', '=', order.id)
        .execute();
    });
  } catch (err) {
    // Two taps at once: the second meets uq_wallet_entries_order_tip.
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('This order already has a tip. Thank you!', 409, 'TIP_ALREADY_GIVEN');
    }
    throw err;
  }
  logger.info({ orderId, amount }, 'Rider tipped from the Blynk Wallet');
  return await ratingState(db, await customerOrder(db, orderId, customerId));
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

function ratingsQuery(executor: DBConnection) {
  return executor
    .selectFrom('order_ratings as r')
    .innerJoin('orders as o', 'o.id', 'r.order_id')
    .innerJoin('users as cu', 'cu.id', 'r.user_id')
    .leftJoin('riders as rd', 'rd.id', 'r.rider_id')
    .leftJoin('users as ru', 'ru.id', 'rd.user_id');
}

const STAFF_SELECT = [
  'r.order_id',
  'o.order_number',
  'o.delivered_at',
  'o.rider_tip',
  'o.rider_tip_wallet',
  'r.user_id as customer_id',
  'cu.full_name as customer_name',
  'cu.phone as customer_phone',
  'r.rider_id',
  'ru.full_name as rider_name',
  'r.stars',
  'r.tags',
  'r.comment',
  'r.created_at',
  'r.updated_at',
] as const;

function presentStaffRating(r: {
  order_id: string;
  order_number: string;
  delivered_at: Date | null;
  rider_tip: unknown;
  rider_tip_wallet: unknown;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  rider_id: string | null;
  rider_name: string | null;
  stars: number;
  tags: string[] | null;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    order_id: r.order_id,
    order_number: r.order_number,
    delivered_at: r.delivered_at,
    customer: { id: r.customer_id, name: r.customer_name, phone: publicPhone(r.customer_phone) },
    rider: r.rider_id ? { id: r.rider_id, name: r.rider_name } : null,
    stars: Number(r.stars),
    tags: r.tags ?? [],
    tag_labels: (r.tags ?? []).map(tagLabel),
    comment: r.comment,
    rider_tip: money(r.rider_tip),
    rider_tip_wallet: money(r.rider_tip_wallet),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** GET /admin/ratings: newest first, filtered by stars (at most), Colombo dates and rider. */
export async function listRatings(query: StaffRatingsQuery) {
  await assertRatingsReady();
  let q = ratingsQuery(db);
  if (query.stars_max) q = q.where('r.stars', '<=', query.stars_max);
  if (query.from) q = q.where('r.created_at', '>=', rangeBounds({ from: query.from, to: query.from }).start);
  if (query.to) q = q.where('r.created_at', '<', rangeBounds({ from: query.to, to: query.to }).end);
  if (query.rider_id) q = q.where('r.rider_id', '=', query.rider_id);
  const [rows, count] = await Promise.all([
    q
      .select(STAFF_SELECT)
      .orderBy('r.created_at', 'desc')
      .orderBy('r.order_id', 'desc')
      .limit(query.limit)
      .offset((query.page - 1) * query.limit)
      .execute(),
    q.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
  ]);
  const total = Number(count.n);
  return {
    ratings: rows.map(presentStaffRating),
    pagination: { page: query.page, limit: query.limit, total, total_pages: Math.ceil(total / query.limit) || 1 },
  };
}

/**
 * GET /admin/ratings/summary?days=30: ratings given in the last `days` days -
 * average, count, per-star counts, top tags, and per rider (the rider who
 * delivered each rated order) - plus the tips on orders delivered in that time.
 */
export async function ratingsSummary(days: number) {
  await assertRatingsReady();
  const since = new Date(Date.now() - days * 86_400_000);
  const [rows, tips] = await Promise.all([
    ratingsQuery(db)
      .select(['r.stars', 'r.tags', 'r.rider_id', 'ru.full_name as rider_name'])
      .where('r.created_at', '>=', since)
      .execute(),
    db
      .selectFrom('orders')
      .select([
        sql<string>`coalesce(sum(rider_tip), 0)`.as('cash'),
        sql<string>`coalesce(sum(rider_tip_wallet), 0)`.as('wallet'),
        sql<number>`(count(*) filter (where rider_tip > 0 or rider_tip_wallet > 0))::int`.as('orders_tipped'),
      ])
      .where('order_status', '=', 'DELIVERED')
      .where('delivered_at', '>=', since)
      .executeTakeFirstOrThrow(),
  ]);
  const all = rows.map((r) => ({ stars: Number(r.stars), tags: r.tags ?? [] }));
  const byRider = new Map<string, { name: string | null; rows: { stars: number; tags: string[] }[] }>();
  for (const r of rows) {
    if (!r.rider_id) continue;
    const entry = byRider.get(r.rider_id) ?? { name: r.rider_name, rows: [] };
    entry.rows.push({ stars: Number(r.stars), tags: r.tags ?? [] });
    byRider.set(r.rider_id, entry);
  }
  const { top_tags, ...overall } = summarize(all);
  const cash = money(tips.cash);
  const wallet = money(tips.wallet);
  return {
    days,
    since,
    ...overall,
    top_tags,
    per_rider: [...byRider.entries()]
      .map(([riderId, e]) => {
        const s = summarize(e.rows);
        return { rider_id: riderId, rider_name: e.name, count: s.count, average: s.average, low_count: s.low_count };
      })
      .sort((a, b) => b.count - a.count || (a.rider_name ?? '').localeCompare(b.rider_name ?? '') || a.rider_id.localeCompare(b.rider_id)),
    tips: { cash, wallet, total: money(cash + wallet), orders_tipped: tips.orders_tipped },
  };
}

/** Staff order detail: the customer's rating of the order, or null (also before migration 055). */
export async function staffOrderRating(orderId: string) {
  if (!(await ratingsReady())) return null;
  const row = await ratingsQuery(db).select(STAFF_SELECT).where('r.order_id', '=', orderId).executeTakeFirst();
  if (!row) return null;
  const { order_id: _o, order_number: _n, delivered_at: _d, rider_tip: _t, rider_tip_wallet: _w, ...rest } = presentStaffRating(row);
  return rest;
}
