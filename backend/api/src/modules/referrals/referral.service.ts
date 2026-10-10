import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { ReferralRewardMode, ReferralStatus } from '../../database/types.js';
import type { DBConnection } from '../orders/order.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { programSettings } from '../loyalty/program-settings.js';
import {
  colomboMonthStart,
  generateReferralCode,
  referralProgramFrom,
  referralRewardValue,
  REFERRAL_PROGRAM_KEY,
  type ReferralProgramSetting,
} from './referral.rules.js';

/**
 * Refer a friend (owner, 2026-10-10; migration 037). The rules are in
 * referral.rules.ts; this is the database side. Everything that decides a
 * reward runs inside the order or lifecycle transaction under a lock.
 */

export const referralSettings = programSettings<ReferralProgramSetting>({
  key: REFERRAL_PROGRAM_KEY,
  description: 'Refer a friend: on/off, reward type and amounts, rewards per inviter per month, unused friend reward to credit',
  auditAction: 'REFERRAL_PROGRAM_UPDATED',
  parse: referralProgramFrom,
});

/** Locks the customer's user row (checkout and the reward decisions serialise on it). */
async function lockUser(executor: DBConnection, userId: string): Promise<void> {
  await executor.selectFrom('users').select('id').where('id', '=', userId).forNoKeyUpdate().executeTakeFirst();
}

/** Any order that was not cancelled: the customer is no longer "new". */
async function hasLiveOrder(executor: DBConnection, customerId: string): Promise<boolean> {
  const row = await executor
    .selectFrom('orders')
    .select('id')
    .where('customer_id', '=', customerId)
    .where('order_status', '!=', 'CANCELLED')
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

const CODE_ATTEMPTS = 8;

/** The customer's personal code, made the first time it is asked for. */
export async function referralCodeFor(customerId: string): Promise<string> {
  const existing = await db.selectFrom('referral_codes').select('code').where('customer_id', '=', customerId).executeTakeFirst();
  if (existing) return existing.code;
  for (let attempt = 1; ; attempt++) {
    const code = generateReferralCode();
    try {
      const row = await db
        .insertInto('referral_codes')
        .values({ customer_id: customerId, code })
        .onConflict((oc) => oc.column('customer_id').doNothing())
        .returning('code')
        .executeTakeFirst();
      if (row) return row.code;
      // Made by a concurrent request: read theirs.
      const raced = await db.selectFrom('referral_codes').select('code').where('customer_id', '=', customerId).executeTakeFirst();
      if (raced) return raced.code;
    } catch (err) {
      const e = err as { code?: string };
      if (e.code !== '23505' || attempt >= CODE_ATTEMPTS) throw err; // the code itself was taken: draw again
    }
  }
}

/**
 * POST /me/referral/apply: a new customer enters a friend's code (typed at
 * sign-up or carried by the link). Refusals (422 unless noted):
 * REFERRALS_DISABLED, REFERRAL_CODE_NOT_FOUND (404), REFERRAL_SELF,
 * REFERRAL_ALREADY_APPLIED (409), REFERRAL_NOT_NEW_CUSTOMER.
 */
export async function applyReferralCode(friendId: string, code: string) {
  const setting = await referralSettings.read();
  if (!setting.enabled) throw new AppError('Refer a friend is not available right now.', 422, 'REFERRALS_DISABLED');
  return await db.transaction().execute(async (trx) => {
    await lockUser(trx, friendId);
    const owner = await trx
      .selectFrom('referral_codes')
      .innerJoin('users', 'users.id', 'referral_codes.customer_id')
      .select(['referral_codes.customer_id', 'users.is_active', 'users.full_name'])
      .where('referral_codes.code', '=', code)
      .executeTakeFirst();
    if (!owner || !owner.is_active) throw new AppError('That referral code does not exist.', 404, 'REFERRAL_CODE_NOT_FOUND', { code });
    if (owner.customer_id === friendId) throw new AppError("You can't use your own referral code.", 422, 'REFERRAL_SELF');
    const already = await trx.selectFrom('referrals').select('id').where('friend_id', '=', friendId).executeTakeFirst();
    if (already) throw new AppError('You have already used a referral code.', 409, 'REFERRAL_ALREADY_APPLIED');
    if (await hasLiveOrder(trx, friendId)) {
      throw new AppError('Referral codes are for new customers, before their first order.', 422, 'REFERRAL_NOT_NEW_CUSTOMER');
    }
    const row = await trx
      .insertInto('referrals')
      .values({ inviter_id: owner.customer_id, friend_id: friendId, code })
      .returning(['id', 'status', 'created_at'])
      .executeTakeFirstOrThrow();
    logger.info({ referralId: row.id, friendId, inviterId: owner.customer_id }, 'Referral code applied');
    return { status: row.status, inviter_first_name: firstName(owner.full_name) };
  });
}

const firstName = (full: string | null) => (full ?? '').trim().split(/\s+/)[0] || null;

/** GET /me/referral: the customer's code, the reward on offer, and how their invites went. */
export async function referralOverview(customerId: string) {
  const setting = await referralSettings.read();
  const code = await referralCodeFor(customerId);
  const [counts, mine, credits, live] = await Promise.all([
    db
      .selectFrom('referrals')
      .select([
        sql<number>`count(*)::int`.as('invited'),
        sql<number>`count(*) FILTER (WHERE status = 'REWARDED')::int`.as('rewarded'),
      ])
      .where('inviter_id', '=', customerId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('referrals')
      .innerJoin('users', 'users.id', 'referrals.inviter_id')
      .select(['referrals.status', 'users.full_name'])
      .where('referrals.friend_id', '=', customerId)
      .executeTakeFirst(),
    availableCredits(db, customerId),
    hasLiveOrder(db, customerId),
  ]);
  return {
    enabled: setting.enabled,
    code,
    reward: {
      mode: setting.mode,
      friend_amount_lkr: setting.friend_amount_lkr,
      inviter_amount_lkr: setting.inviter_amount_lkr,
    },
    invited_count: counts.invited,
    rewarded_count: counts.rewarded,
    /** Credits waiting for the customer's next orders (one per order). */
    credits: credits.map((c) => ({ side: c.side, mode: c.mode, amount_lkr: Number(c.amount) })),
    referred_by: mine ? { first_name: firstName(mine.full_name), status: mine.status } : null,
    can_apply_code: setting.enabled && !mine && !live,
  };
}

async function availableCredits(executor: DBConnection, customerId: string) {
  return await executor
    .selectFrom('referral_rewards')
    .select(['id', 'referral_id', 'side', 'mode', 'amount'])
    .where('customer_id', '=', customerId)
    .where('order_id', 'is', null)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface AppliedReferral {
  side: 'FRIEND' | 'INVITER';
  referral_id: string;
  /** The credit being used (an inviter's, or a friend's carried over); null = the friend's first-order reward. */
  reward_id: string | null;
  mode: ReferralRewardMode;
  amount: number;
  discount_amount: number;
}

/**
 * The best referral reward this order could take, or null. Pass `lock`
 * inside the order transaction. A friend's reward needs the program on and
 * this to be their first order; an inviter's credit, once given, is honoured
 * even if the program is later switched off. Larger value wins; on a tie the
 * friend's (it is only good for the first order).
 */
export async function referralCandidate(
  executor: DBConnection,
  params: { customerId: string; subtotal: number; deliveryFee: number; setting: ReferralProgramSetting; lock?: boolean }
): Promise<AppliedReferral | null> {
  const { customerId, subtotal, deliveryFee, setting } = params;
  if (params.lock) await lockUser(executor, customerId);
  let best: AppliedReferral | null = null;

  if (setting.enabled) {
    const ref = await executor
      .selectFrom('referrals')
      .select('id')
      .where('friend_id', '=', customerId)
      .where('status', '=', 'PENDING')
      .executeTakeFirst();
    if (ref) {
      const taken = await executor
        .selectFrom('referral_rewards')
        .select('id')
        .where('referral_id', '=', ref.id)
        .where('side', '=', 'FRIEND')
        .executeTakeFirst();
      if (!taken && !(await hasLiveOrder(executor, customerId))) {
        const amount = setting.mode === 'LKR_OFF' ? setting.friend_amount_lkr : 0;
        const discount = referralRewardValue(setting.mode, amount, subtotal, deliveryFee);
        if (discount > 0) best = { side: 'FRIEND', referral_id: ref.id, reward_id: null, mode: setting.mode, amount, discount_amount: discount };
      }
    }
  }

  for (const credit of await availableCredits(executor, customerId)) {
    const discount = referralRewardValue(credit.mode, Number(credit.amount), subtotal, deliveryFee);
    if (discount > 0 && (!best || discount > best.discount_amount)) {
      best = { side: credit.side, referral_id: credit.referral_id, reward_id: credit.id, mode: credit.mode, amount: Number(credit.amount), discount_amount: discount };
    }
    break; // one credit per order: the oldest
  }
  return best;
}

/** Inside the order transaction, after the order row exists. */
export async function recordReferralUse(executor: DBConnection, applied: AppliedReferral, orderId: string, customerId: string): Promise<void> {
  const now = new Date();
  if (applied.reward_id === null) {
    await executor
      .insertInto('referral_rewards')
      .values({
        referral_id: applied.referral_id,
        customer_id: customerId,
        side: 'FRIEND',
        mode: applied.mode,
        amount: applied.amount,
        order_id: orderId,
        discount_amount: applied.discount_amount,
        used_at: now,
      })
      .execute();
    return;
  }
  const used = await executor
    .updateTable('referral_rewards')
    .set({ order_id: orderId, discount_amount: applied.discount_amount, used_at: now })
    .where('id', '=', applied.reward_id!)
    .where('order_id', 'is', null)
    .executeTakeFirst();
  if (Number(used.numUpdatedRows) !== 1) {
    // Unreachable under the customer's row lock; refuse rather than discount twice.
    throw new AppError('Your referral reward changed. Please try again.', 409, 'REFERRAL_REWARD_CHANGED');
  }
}

/**
 * Cancelling an order: a friend's first-order reward is removed while the
 * referral is still PENDING (their next first order can take it again); a
 * credit (an inviter's, or a friend's carried over) comes back.
 */
export async function releaseReferralUse(executor: DBConnection, orderId: string): Promise<void> {
  const row = await executor
    .selectFrom('referral_rewards as rw')
    .innerJoin('referrals as r', 'r.id', 'rw.referral_id')
    .select(['rw.id', 'rw.side', 'r.status'])
    .where('rw.order_id', '=', orderId)
    .executeTakeFirst();
  if (!row) return;
  if (row.side === 'FRIEND' && row.status === 'PENDING') {
    await executor.deleteFrom('referral_rewards').where('id', '=', row.id).execute();
    return;
  }
  await executor.updateTable('referral_rewards').set({ order_id: null, discount_amount: 0, used_at: null }).where('id', '=', row.id).execute();
}

/** The reward after the store removes an item (RESOLVE_ITEM), or null when the order used none. */
export async function recomputeReferralDiscount(
  executor: DBConnection,
  orderId: string,
  subtotal: number,
  deliveryFee: number
): Promise<number | null> {
  const row = await executor.selectFrom('referral_rewards').select(['id', 'mode', 'amount']).where('order_id', '=', orderId).executeTakeFirst();
  if (!row) return null;
  const discount = referralRewardValue(row.mode, Number(row.amount), subtotal, deliveryFee);
  await executor.updateTable('referral_rewards').set({ discount_amount: discount }).where('id', '=', row.id).execute();
  return discount;
}

/** The reward mode an order used, or null (Blynk Points needs it to know what was off the items). */
export async function referralModeForOrder(executor: DBConnection, orderId: string): Promise<ReferralRewardMode | null> {
  const row = await executor.selectFrom('referral_rewards').select('mode').where('order_id', '=', orderId).executeTakeFirst();
  return row?.mode ?? null;
}

// ---------------------------------------------------------------------------
// Delivered
// ---------------------------------------------------------------------------

/**
 * Inside the delivery settlement (lifecycle settleCod), after the order is
 * DELIVERED: if this is the friend's first delivered order, the referral is
 * completed - the inviter gets a credit unless the program is off or the
 * inviter is over this month's cap. A friend whose first order could not
 * take their reward (it already went out free, or a bigger coupon/gift won)
 * gets it now as a credit for their next order, so neither side loses it
 * ("one extra free delivery each") - only while `friend_unused_to_credit` is
 * on (owner, 2026-10-10: Admin/Operations switch); off, it lapses.
 */
export async function completeReferralOnDelivery(
  trx: DBConnection,
  order: { id: string; customer_id: string },
  now: Date = new Date()
): Promise<ReferralStatus | null> {
  const ref = await trx
    .selectFrom('referrals')
    .select(['id', 'inviter_id'])
    .where('friend_id', '=', order.customer_id)
    .where('status', '=', 'PENDING')
    .forUpdate()
    .executeTakeFirst();
  if (!ref) return null;
  const earlier = await trx
    .selectFrom('orders')
    .select('id')
    .where('customer_id', '=', order.customer_id)
    .where('order_status', '=', 'DELIVERED')
    .where('id', '!=', order.id)
    .limit(1)
    .executeTakeFirst();
  if (earlier) return null; // unreachable in practice: an earlier delivery would have completed it

  const setting = await referralSettings.read();
  let status: ReferralStatus;
  if (!setting.enabled) {
    status = 'NO_REWARD';
  } else {
    // The cap is counted under the inviter's row lock, so two friends'
    // deliveries at once cannot both take the last reward.
    await lockUser(trx, ref.inviter_id);
    const inviter = await trx.selectFrom('users').select(['is_active']).where('id', '=', ref.inviter_id).executeTakeFirst();
    const { n } = await trx
      .selectFrom('referrals')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('inviter_id', '=', ref.inviter_id)
      .where('status', '=', 'REWARDED')
      .where('completed_at', '>=', colomboMonthStart(now))
      .executeTakeFirstOrThrow();
    if (!inviter?.is_active) status = 'NO_REWARD';
    else if (n >= setting.monthly_cap) status = 'CAPPED';
    else {
      status = 'REWARDED';
      await trx
        .insertInto('referral_rewards')
        .values({
          referral_id: ref.id,
          customer_id: ref.inviter_id,
          side: 'INVITER',
          mode: setting.mode,
          amount: setting.mode === 'LKR_OFF' ? setting.inviter_amount_lkr : 0,
        })
        .execute();
    }
  }
  // (owner, 2026-10-10) "Unused friend reward becomes a credit" switch.
  if (setting.enabled && setting.friend_unused_to_credit) {
    const friendReward = await trx
      .selectFrom('referral_rewards')
      .select('id')
      .where('referral_id', '=', ref.id)
      .where('side', '=', 'FRIEND')
      .executeTakeFirst();
    const amount = setting.mode === 'LKR_OFF' ? setting.friend_amount_lkr : 0;
    if (!friendReward && (setting.mode === 'FREE_DELIVERY' || amount > 0)) {
      await trx
        .insertInto('referral_rewards')
        .values({ referral_id: ref.id, customer_id: order.customer_id, side: 'FRIEND', mode: setting.mode, amount })
        .execute();
    }
  }
  await trx
    .updateTable('referrals')
    .set({ status, qualifying_order_id: order.id, completed_at: now })
    .where('id', '=', ref.id)
    .execute();
  logger.info({ referralId: ref.id, orderId: order.id, status }, 'Referral completed');
  return status;
}

// ---------------------------------------------------------------------------
// Admin / Operations
// ---------------------------------------------------------------------------

export async function listReferrals(params: { status?: ReferralStatus; page: number; limit: number }) {
  let q = db
    .selectFrom('referrals as r')
    .innerJoin('users as inviter', 'inviter.id', 'r.inviter_id')
    .innerJoin('users as friend', 'friend.id', 'r.friend_id')
    .leftJoin('orders as qo', 'qo.id', 'r.qualifying_order_id');
  if (params.status) q = q.where('r.status', '=', params.status);
  const [rows, total, summary] = await Promise.all([
    q
      .select([
        'r.id',
        'r.code',
        'r.status',
        'r.created_at',
        'r.completed_at',
        'inviter.id as inviter_id',
        'inviter.full_name as inviter_name',
        'inviter.phone as inviter_phone',
        'friend.id as friend_id',
        'friend.full_name as friend_name',
        'friend.phone as friend_phone',
        'qo.order_number as qualifying_order_number',
      ])
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(params.limit)
      .offset((params.page - 1) * params.limit)
      .execute(),
    q.select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow(),
    db
      .selectFrom('referrals')
      .select(['status', sql<number>`count(*)::int`.as('n')])
      .groupBy('status')
      .execute(),
  ]);
  const rewards = rows.length
    ? await db
        .selectFrom('referral_rewards as rw')
        .leftJoin('orders as o', 'o.id', 'rw.order_id')
        .select(['rw.referral_id', 'rw.side', 'rw.mode', 'rw.amount', 'rw.discount_amount', 'rw.used_at', 'rw.created_at', 'o.order_number'])
        .where(
          'rw.referral_id',
          'in',
          rows.map((r) => r.id)
        )
        .execute()
    : [];
  const rewardOf = (id: string, side: 'FRIEND' | 'INVITER') => {
    const rw = rewards.find((x) => x.referral_id === id && x.side === side);
    if (!rw) return null;
    return {
      mode: rw.mode,
      amount_lkr: Number(rw.amount),
      discount_amount: Number(rw.discount_amount),
      used: rw.order_number !== null && rw.used_at !== null,
      order_number: rw.order_number,
      created_at: rw.created_at,
    };
  };
  const counts: Record<ReferralStatus, number> = { PENDING: 0, REWARDED: 0, CAPPED: 0, NO_REWARD: 0 };
  for (const s of summary) counts[s.status as ReferralStatus] = s.n;
  return {
    referrals: rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
      inviter: { id: r.inviter_id, name: r.inviter_name, phone: r.inviter_phone },
      friend: { id: r.friend_id, name: r.friend_name, phone: r.friend_phone },
      qualifying_order_number: r.qualifying_order_number,
      friend_reward: rewardOf(r.id, 'FRIEND'),
      inviter_reward: rewardOf(r.id, 'INVITER'),
    })),
    summary: counts,
    pagination: { page: params.page, limit: params.limit, total: total.n, total_pages: Math.ceil(total.n / params.limit) || 1 },
  };
}
