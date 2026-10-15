import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { WalletEntryKind } from '../../database/types.js';
import type { DBConnection } from '../orders/order.repository.js';
import type { OrderRow, Trx } from '../orders/lifecycle/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { logger } from '../../utils/logger.js';
import { programSettings, round2 } from '../loyalty/program-settings.js';
import { expiryFor } from '../loyalty/points.rules.js';
import {
  orderPointsForRefund,
  removeEarnedPointsForRefund,
  returnPointsForRefund,
} from '../loyalty/points.service.js';
import { cannotRecordForSelf } from '../riders/self-record.js';
import { bestEffort, enqueuePush } from '../notifications/push/push.repository.js';
import { isPushEnabled } from '../notifications/push/push.sender.js';
import {
  CREDIT_KINDS,
  expiredUnspent,
  expiryNote,
  pointsToRemove,
  refundableFor,
  walletSettingFrom,
  walletUseFor,
  WALLET_SETTINGS_KEY,
  type StaffRefundKind,
  type WalletSetting,
} from './wallet.rules.js';

/**
 * Blynk Wallet ledger (owner, 2026-10-15; migration 049). Rules in
 * wallet.rules.ts. wallet_entries is append-only; the balance is its sum per
 * customer, less what is left of credits past their expiry date until the
 * EXPIRED row for it is written. Every write takes the customer's users row
 * lock first (as Blynk Points do), so a checkout, a refund and an adjustment
 * for the same customer never interleave and the balance never goes below 0.
 *
 *   checkout (order.repository createOrderAtomic)  decideWalletUse + recordWalletPayment
 *   cancelled (lifecycle cancelOrder)              refundCancelledOrderToWallet
 *   item removed (lifecycle RESOLVE_ITEM)          settleWalletAfterItemChange
 *   paid after cancel (PayHere)                    refundCancelledOrderToWallet
 *   staff                                          refundOrderToWallet, adjustWallet
 */

export const walletSettings = programSettings<WalletSetting>({
  key: WALLET_SETTINGS_KEY,
  description: 'Blynk Wallet: on/off, credit expiry, most of an order it may pay',
  auditAction: 'WALLET_SETTINGS_UPDATED',
  parse: walletSettingFrom,
});

export const PUSH_WALLET_CREDIT = 'PUSH_WALLET_CREDIT';

async function lockCustomer(executor: DBConnection, customerId: string): Promise<void> {
  await executor.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
}

const money = (v: unknown) => round2(Number(v ?? 0));
const lkr = (n: number) => `LKR ${n.toLocaleString('en-LK', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The ledger sum, the expiring credits whose date has passed, and everything taken out. */
async function ledgerTotals(executor: DBConnection, customerId: string, now: Date) {
  const row = await executor
    .selectFrom('wallet_entries')
    .select([
      sql<string>`coalesce(sum(amount), 0)`.as('sum'),
      sql<string>`coalesce(sum(amount) FILTER (WHERE amount > 0 AND expires_at IS NOT NULL AND expires_at <= ${now}), 0)`.as('expired_credits'),
      sql<string>`coalesce(-sum(amount) FILTER (WHERE amount < 0), 0)`.as('debits'),
    ])
    .where('customer_id', '=', customerId)
    .executeTakeFirstOrThrow();
  return { sum: money(row.sum), expiredCredits: money(row.expired_credits), debits: money(row.debits) };
}

/** What the customer can spend right now (credits past their date excluded even before their EXPIRED row). */
export async function walletBalance(executor: DBConnection, customerId: string, now: Date = new Date()): Promise<number> {
  const t = await ledgerTotals(executor, customerId, now);
  return round2(Math.max(0, t.sum - expiredUnspent(t.expiredCredits, t.debits)));
}

/** Writes the EXPIRED row for what is left of credits past their date (call under the customer lock). */
export async function expireWallet(executor: DBConnection, customerId: string, now: Date = new Date()): Promise<number> {
  const t = await ledgerTotals(executor, customerId, now);
  const amount = Math.min(expiredUnspent(t.expiredCredits, t.debits), t.sum);
  if (!(amount > 0)) return 0;
  await executor
    .insertInto('wallet_entries')
    .values({ customer_id: customerId, kind: 'EXPIRED', amount: -amount, reason: 'Expired' })
    .execute();
  return amount;
}

/** The worker's sweep: every customer holding unspent credits past their date. */
export async function expireWallets(now: Date = new Date(), limit = 200): Promise<number> {
  const due = await db
    .selectFrom('wallet_entries')
    .select('customer_id')
    .groupBy('customer_id')
    .having(
      sql<boolean>`coalesce(sum(amount) FILTER (WHERE amount > 0 AND expires_at IS NOT NULL AND expires_at <= ${now}), 0)
        > coalesce(-sum(amount) FILTER (WHERE amount < 0), 0) + 0.004`
    )
    .limit(limit)
    .execute();
  let customers = 0;
  for (const { customer_id } of due) {
    const amount = await db.transaction().execute(async (trx) => {
      await lockCustomer(trx, customer_id);
      return await expireWallet(trx, customer_id, now);
    });
    if (amount > 0) customers++;
  }
  if (customers) logger.info({ customers }, 'Blynk Wallet credits expired');
  return customers;
}

/** "LKR X added to your Blynk Wallet" - app push only (no SMS), best effort, after commit. */
async function queueCreditPush(executor: DBConnection, entry: { id: string; customer_id: string; amount: number; order_id: string | null }) {
  if (!isPushEnabled() || !('isTransaction' in executor) || !executor.isTransaction) return;
  await bestEffort(
    executor as Trx,
    () =>
      enqueuePush(executor, {
        userId: entry.customer_id,
        orderId: entry.order_id,
        type: PUSH_WALLET_CREDIT,
        idempotencyKey: `push:wallet:${entry.id}`,
        payload: {
          title: 'Blynk Wallet',
          body: `${lkr(entry.amount)} added to your Blynk Wallet.`,
          data: { type: 'wallet' },
        },
      }),
    (err) => logger.error({ err, entryId: entry.id }, 'Could not queue the wallet push; the refund stands')
  );
}

/** A credit (refund or positive adjustment), expiring under today's setting. Call under the customer lock. */
async function credit(
  executor: DBConnection,
  p: { customerId: string; kind: WalletEntryKind; amount: number; orderId?: string | null; reason: string; actorId?: string | null; now?: Date }
) {
  const amount = round2(p.amount);
  if (!(amount > 0)) return null;
  const setting = await walletSettings.read();
  const now = p.now ?? new Date();
  const entry = await executor
    .insertInto('wallet_entries')
    .values({
      customer_id: p.customerId,
      kind: p.kind,
      amount,
      order_id: p.orderId ?? null,
      reason: p.reason,
      created_by: p.actorId ?? null,
      expires_at: expiryFor(now, setting.expiry_months),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await queueCreditPush(executor, { id: entry.id, customer_id: entry.customer_id, amount, order_id: entry.order_id });
  return { ...entry, amount: money(entry.amount) };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * What the wallet pays for this order (0 when off, not asked for, or empty),
 * decided under the customer's row lock inside the order transaction. `due`
 * is what is still to pay after every discount and Blynk Points, delivery fee
 * included.
 */
export async function decideWalletUse(
  executor: DBConnection,
  p: { customerId: string; due: number; use: boolean | undefined; now: Date }
): Promise<number> {
  if (!p.use || !(p.due > 0)) return 0;
  const setting = await walletSettings.read();
  if (!setting.enabled) return 0;
  await lockCustomer(executor, p.customerId);
  await expireWallet(executor, p.customerId, p.now);
  const balance = await walletBalance(executor, p.customerId, p.now);
  return walletUseFor(balance, round2(p.due), setting);
}

/** Inside the order transaction, after the order row exists. */
export async function recordWalletPayment(executor: DBConnection, p: { orderId: string; customerId: string; amount: number; now: Date }) {
  if (!(p.amount > 0)) return;
  const balance = await walletBalance(executor, p.customerId, p.now);
  if (balance + 0.001 < p.amount) {
    throw new AppError('Not enough in your Blynk Wallet.', 409, 'WALLET_INSUFFICIENT', { balance });
  }
  await executor
    .insertInto('wallet_entries')
    .values({ customer_id: p.customerId, kind: 'ORDER_PAYMENT', amount: -round2(p.amount), order_id: p.orderId })
    .execute();
}

// ---------------------------------------------------------------------------
// An order's money
// ---------------------------------------------------------------------------

type MoneyOrder = Pick<OrderRow, 'id' | 'customer_id' | 'payment_method' | 'payment_status' | 'total_amount' | 'wallet_amount_used' | 'delivery_fee'>;

/**
 * What was paid for an order (wallet, PayHere, cash collected on delivery),
 * what has been credited back to the wallet for it, and what may still be
 * refunded. The cap every refund for the order respects.
 */
export async function orderMoney(executor: DBConnection, order: MoneyOrder) {
  const [entries, payment] = await Promise.all([
    executor.selectFrom('wallet_entries').select(['kind', 'amount']).where('order_id', '=', order.id).execute(),
    executor.selectFrom('payments').select(['payment_method', 'payment_status', 'amount']).where('order_id', '=', order.id).executeTakeFirst(),
  ]);
  const sumOf = (kinds: readonly WalletEntryKind[]) => round2(entries.filter((e) => kinds.includes(e.kind)).reduce((n, e) => n + Number(e.amount), 0));
  const walletDebited = -sumOf(['ORDER_PAYMENT']);
  const credited = sumOf(CREDIT_KINDS);
  const onlinePaid = payment && payment.payment_method === 'ONLINE' && payment.payment_status === 'PAID' ? money(payment.amount) : 0;
  const cashCollected = order.payment_method === 'COD' && order.payment_status === 'PAID' ? money(order.total_amount) : 0;
  const { paid, refundable } = refundableFor({ walletDebited, onlinePaid, cashCollected, credited });
  return {
    wallet: walletDebited,
    online: onlinePaid,
    cash: cashCollected,
    paid,
    credited,
    fee_refunded: sumOf(['REFUND_DELIVERY_FEE']),
    refundable,
  };
}

/**
 * Cancelled (lifecycle cancelOrder, under the order lock; also a PayHere
 * payment that arrives after the cancel): everything still held for the
 * order goes to the wallet - the wallet part as ORDER_PAYMENT_RETURNED, the
 * online part as REFUND_ORDER_CANCELLED. Idempotent: what is credited counts
 * against what was paid, so a second call credits nothing.
 *
 * `keepDeliveryFee` (owner, 2026-10-15): a cancel that follows a failed
 * delivery attempt (the order was FAILED or CUSTOMER_UNAVAILABLE) keeps the
 * delivery fee - the rider already made the trip. Only the items are
 * refunded. A fee already given back by staff (REFUND_DELIVERY_FEE) is never
 * withheld twice.
 */
export async function refundCancelledOrderToWallet(
  executor: DBConnection,
  order: MoneyOrder & { order_number: string },
  now = new Date(),
  opts: { keepDeliveryFee?: boolean } = {}
) {
  const m = await orderMoney(executor, order);
  const feeToKeep = opts.keepDeliveryFee ? round2(Math.max(0, money(order.delivery_fee) - m.fee_refunded)) : 0;
  const refundable = round2(Math.max(0, m.refundable - feeToKeep));
  if (!(refundable > 0)) return { wallet_returned: 0, online_refunded: 0 };
  await lockCustomer(executor, order.customer_id);
  // wallet_amount_used is what the wallet still pays (RESOLVE_ITEM lowers it as it returns the surplus).
  const walletPart = round2(Math.min(money(order.wallet_amount_used), refundable));
  const rest = round2(refundable - walletPart);
  if (walletPart > 0) {
    await credit(executor, {
      customerId: order.customer_id,
      kind: 'ORDER_PAYMENT_RETURNED',
      amount: walletPart,
      orderId: order.id,
      reason: `Order ${order.order_number} cancelled: wallet payment returned`,
      now,
    });
  }
  if (rest > 0) {
    await credit(executor, {
      customerId: order.customer_id,
      kind: 'REFUND_ORDER_CANCELLED',
      amount: rest,
      orderId: order.id,
      reason: `Order ${order.order_number} cancelled: payment refunded`,
      now,
    });
  }
  logger.info({ orderId: order.id, walletPart, rest }, 'Cancelled order refunded to the Blynk Wallet');
  return { wallet_returned: walletPart, online_refunded: rest };
}

/**
 * RESOLVE_ITEM (under the order lock): the order now costs `due` (after
 * discounts and points). The wallet never pays more than that - its surplus
 * goes back (ORDER_PAYMENT_RETURNED). On an order already paid online, money
 * held beyond what the order now costs is refunded to the wallet
 * (REFUND_ITEM). Returns the new wallet_amount_used and total_amount.
 */
export async function settleWalletAfterItemChange(
  executor: DBConnection,
  order: MoneyOrder & { order_number: string },
  due: number,
  itemName: string,
  now = new Date()
): Promise<{ wallet_amount_used: number; total_amount: number }> {
  const used = money(order.wallet_amount_used);
  const keep = round2(Math.min(used, Math.max(0, due)));
  const total = round2(Math.max(0, due) - keep);
  const paidOnline = order.payment_method === 'ONLINE' && order.payment_status === 'PAID';
  if (paidOnline) {
    const m = await orderMoney(executor, order);
    const surplus = round2(m.refundable - Math.max(0, due));
    if (surplus > 0) {
      await lockCustomer(executor, order.customer_id);
      await credit(executor, {
        customerId: order.customer_id,
        kind: 'REFUND_ITEM',
        amount: surplus,
        orderId: order.id,
        reason: `Item unavailable: ${itemName}`,
        now,
      });
    }
  } else if (used > keep) {
    await lockCustomer(executor, order.customer_id);
    await credit(executor, {
      customerId: order.customer_id,
      kind: 'ORDER_PAYMENT_RETURNED',
      amount: round2(used - keep),
      orderId: order.id,
      reason: `Item unavailable: ${itemName} - wallet payment returned`,
      now,
    });
  }
  return { wallet_amount_used: keep, total_amount: total };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** What the customer reads for an entry: refund reasons as written, adjustments and payments in Blynk's words. */
function customerReason(e: { kind: WalletEntryKind; reason: string | null; order_number: string | null }): string {
  switch (e.kind) {
    case 'ORDER_PAYMENT':
      return e.order_number ? `Paid for order ${e.order_number}` : 'Paid for an order';
    case 'ADJUSTMENT':
      return 'Adjusted by Blynk';
    case 'EXPIRED':
      return 'Expired';
    default:
      return e.reason ?? 'Refund';
  }
}

async function entriesPage(customerId: string, page: number, limit: number) {
  const [rows, count] = await Promise.all([
    db
      .selectFrom('wallet_entries as w')
      .leftJoin('orders as o', 'o.id', 'w.order_id')
      .leftJoin('users as a', 'a.id', 'w.created_by')
      .select(['w.id', 'w.kind', 'w.amount', 'w.order_id', 'w.reason', 'w.created_by', 'w.expires_at', 'w.created_at', 'o.order_number', 'a.full_name as created_by_name'])
      .where('w.customer_id', '=', customerId)
      .orderBy('w.created_at', 'desc')
      .orderBy('w.id', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .execute(),
    db.selectFrom('wallet_entries').select(sql<string>`count(*)`.as('n')).where('customer_id', '=', customerId).executeTakeFirstOrThrow(),
  ]);
  const total = Number(count.n);
  return {
    rows: rows.map((r) => ({ ...r, amount: money(r.amount) })),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 },
  };
}

/** Writes any pending expiry for the customer (own short transaction). */
async function settleExpiry(customerId: string, now: Date) {
  await db.transaction().execute(async (trx) => {
    await lockCustomer(trx, customerId);
    await expireWallet(trx, customerId, now);
  });
}

/** GET /me/wallet. */
export async function customerWallet(customerId: string, page = 1, limit = 30) {
  const now = new Date();
  const setting = await walletSettings.read();
  await settleExpiry(customerId, now);
  const balance = await walletBalance(db, customerId, now);
  const { rows, pagination } = await entriesPage(customerId, page, limit);
  return {
    enabled: setting.enabled,
    balance,
    expiry_months: setting.expiry_months,
    expiry_note: expiryNote(setting.expiry_months),
    max_use_percent: setting.max_use_percent,
    entries: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amount: r.amount,
      order_id: r.order_id,
      order_number: r.order_number,
      reason: customerReason(r),
      expires_at: r.amount > 0 ? r.expires_at : null,
      created_at: r.created_at,
    })),
    pagination,
  };
}

/** GET /orders/checkout-info: the wallet block. */
export async function checkoutWalletInfo(executor: DBConnection, customerId: string) {
  const setting = await walletSettings.read();
  return { enabled: setting.enabled, balance: await walletBalance(executor, customerId), max_use_percent: setting.max_use_percent };
}

/** The credits back to the wallet for one order, newest first (customer view unless `staff`). */
export async function orderWalletEntries(executor: DBConnection, orderId: string, staff = false) {
  const rows = await executor
    .selectFrom('wallet_entries as w')
    .leftJoin('orders as o', 'o.id', 'w.order_id')
    .leftJoin('users as a', 'a.id', 'w.created_by')
    .select(['w.id', 'w.kind', 'w.amount', 'w.order_id', 'w.reason', 'w.created_by', 'w.expires_at', 'w.created_at', 'o.order_number', 'a.full_name as created_by_name'])
    .where('w.order_id', '=', orderId)
    .orderBy('w.created_at', 'desc')
    .orderBy('w.id', 'desc')
    .execute();
  const list = rows.map((r) => ({ ...r, amount: money(r.amount) }));
  if (staff) return list;
  return list
    .filter((r) => r.amount > 0)
    .map((r) => ({ id: r.id, kind: r.kind, amount: r.amount, reason: customerReason(r), created_at: r.created_at }));
}

/** The customer's order view of the wallet: used, refunded and the refund entries. */
export async function customerOrderWallet(executor: DBConnection, order: { id: string; wallet_amount_used?: unknown }) {
  const entries = await orderWalletEntries(executor, order.id);
  return {
    used: money(order.wallet_amount_used),
    refunded_total: round2(entries.reduce((n, e) => n + e.amount, 0)),
    entries,
  };
}

/** Admin/Operations: a customer's balance and full history (reasons and who). */
export async function adminCustomerWallet(customerId: string, page = 1, limit = 50) {
  const user = await db.selectFrom('users').select('id').where('id', '=', customerId).executeTakeFirst();
  if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  const setting = await walletSettings.read();
  const balance = await walletBalance(db, customerId);
  const { rows, pagination } = await entriesPage(customerId, page, limit);
  return { customer_id: customerId, enabled: setting.enabled, balance, entries: rows, pagination };
}

async function orderForStaff(executor: DBConnection, orderId: string, lock: boolean) {
  let q = executor.selectFrom('orders').selectAll().where('id', '=', orderId);
  if (lock) q = q.forUpdate();
  const order = await q.executeTakeFirst();
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  return order;
}

async function orderWalletView(executor: DBConnection, order: OrderRow) {
  const m = await orderMoney(executor, order);
  const points = await orderPointsForRefund(executor, order);
  const fee = money(order.delivery_fee);
  return {
    order_id: order.id,
    order_number: order.order_number,
    customer_id: order.customer_id,
    order_status: order.order_status,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    wallet_amount_used: money(order.wallet_amount_used),
    total_amount: money(order.total_amount),
    delivery_fee: fee,
    paid: { wallet: m.wallet, online: m.online, cash: m.cash, total: m.paid },
    refunded_total: m.credited,
    refundable: m.refundable,
    delivery_fee_refundable: round2(Math.max(0, Math.min(fee - m.fee_refunded, m.refundable))),
    points: { redeemed: points.redeemed, returnable: points.returnable, earned: points.earned },
    entries: await orderWalletEntries(executor, order.id, true),
  };
}

/** GET /admin/orders/:id/wallet. */
export async function adminOrderWallet(orderId: string) {
  return await orderWalletView(db, await orderForStaff(db, orderId, false));
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/**
 * POST /admin/orders/:id/wallet-refund (Admin and Operations): a missing /
 * damaged / wrong item or the delivery fee, refunded to the customer's
 * wallet. Never more than the order's paid total less what was already
 * credited back for it; the fee never more than the fee. Points used on the
 * item may be given back (`return_points`); points earned on a refunded item
 * are taken back automatically. Audited (WALLET_ORDER_REFUND).
 */
export async function refundOrderToWallet(
  orderId: string,
  input: { amount: number; kind: StaffRefundKind; reason: string; return_points?: number },
  actor: AuditActor
) {
  const now = new Date();
  const result = await db.transaction().execute(async (trx) => {
    const order = await orderForStaff(trx, orderId, true);
    // Never your own order (owner, 2026-10-12: staff never credit themselves).
    if (order.customer_id === actor.actorId) throw cannotRecordForSelf('a wallet refund');
    const before = await orderWalletView(trx, order);
    const amount = round2(input.amount);
    if (!(before.refundable > 0)) {
      throw new AppError('Nothing is left to refund on this order.', 422, 'NOTHING_TO_REFUND', { refundable: 0 });
    }
    if (amount > before.refundable + 0.001) {
      throw new AppError(
        `At most ${lkr(before.refundable)} can still be refunded on this order.`,
        422,
        'REFUND_EXCEEDS_REFUNDABLE',
        { refundable: before.refundable }
      );
    }
    if (input.kind === 'REFUND_DELIVERY_FEE' && amount > before.delivery_fee_refundable + 0.001) {
      throw new AppError(
        `The delivery fee refund can be at most ${lkr(before.delivery_fee_refundable)}.`,
        422,
        'REFUND_EXCEEDS_DELIVERY_FEE',
        { delivery_fee_refundable: before.delivery_fee_refundable }
      );
    }
    const returnPoints = input.return_points ?? 0;
    if (returnPoints > before.points.returnable) {
      throw new AppError(`At most ${before.points.returnable} points can be given back on this order.`, 422, 'POINTS_RETURN_EXCEEDS', {
        returnable: before.points.returnable,
      });
    }

    await lockCustomer(trx, order.customer_id);
    const entry = (await credit(trx, {
      customerId: order.customer_id,
      kind: input.kind,
      amount,
      orderId: order.id,
      reason: input.reason.trim(),
      actorId: actor.actorId,
      now,
    }))!;

    const pointsReturned = await returnPointsForRefund(trx, {
      customerId: order.customer_id,
      orderId: order.id,
      points: returnPoints,
      actorId: actor.actorId,
      reason: `Refund on order ${order.order_number}: points returned`,
      now,
    });
    let pointsRemoved = 0;
    if (input.kind === 'REFUND_ITEM') {
      const p = await orderPointsForRefund(trx, order);
      const n = pointsToRemove({ earned: p.earned, earnBase: p.earn_base, amount, alreadyRemoved: p.removed });
      pointsRemoved = await removeEarnedPointsForRefund(trx, {
        customerId: order.customer_id,
        orderId: order.id,
        points: n,
        actorId: actor.actorId,
        reason: `Refund on order ${order.order_number}: points earned removed`,
        now,
      });
    }

    await writeAudit(trx, actor, {
      action: 'WALLET_ORDER_REFUND',
      entityType: 'ORDER',
      entityId: order.id,
      oldValues: { refundable: before.refundable, refunded_total: before.refunded_total },
      newValues: {
        customer_id: order.customer_id,
        kind: input.kind,
        amount,
        reason: input.reason.trim(),
        wallet_entry_id: entry.id,
        points_returned: pointsReturned,
        points_removed: pointsRemoved,
      },
    });
    logger.info({ orderId: order.id, amount, kind: input.kind, actorId: actor.actorId }, 'Order refunded to the Blynk Wallet');
    return { entry, pointsReturned, pointsRemoved };
  });
  return {
    refund: result.entry,
    points_returned: result.pointsReturned,
    points_removed: result.pointsRemoved,
    wallet: await adminOrderWallet(orderId),
  };
}

/** POST /admin/customers/:id/wallet/adjust (Admin only): +/- with a reason, audited (WALLET_ADJUSTED). Never below 0. */
export async function adjustWallet(customerId: string, amount: number, reason: string, actor: AuditActor) {
  if (customerId === actor.actorId) throw cannotRecordForSelf('a wallet adjustment');
  const now = new Date();
  const value = round2(amount);
  await db.transaction().execute(async (trx) => {
    const user = await trx.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
    if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
    await expireWallet(trx, customerId, now);
    const before = await walletBalance(trx, customerId, now);
    if (value < 0 && before + value < -0.001) {
      throw new AppError(`This customer's Blynk Wallet has only ${lkr(before)}.`, 422, 'WALLET_INSUFFICIENT', { balance: before });
    }
    let entryId: string;
    if (value > 0) {
      entryId = (await credit(trx, { customerId, kind: 'ADJUSTMENT', amount: value, reason, actorId: actor.actorId, now }))!.id;
    } else {
      entryId = (
        await trx
          .insertInto('wallet_entries')
          .values({ customer_id: customerId, kind: 'ADJUSTMENT', amount: value, reason, created_by: actor.actorId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    await writeAudit(trx, actor, {
      action: 'WALLET_ADJUSTED',
      entityType: 'USER',
      entityId: customerId,
      oldValues: { balance: before },
      newValues: { balance: round2(before + value), amount: value, reason, wallet_entry_id: entryId },
    });
    logger.info({ customerId, amount: value, actorId: actor.actorId }, 'Blynk Wallet adjusted');
  });
  return await adminCustomerWallet(customerId);
}
