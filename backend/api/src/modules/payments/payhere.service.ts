import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { runTransition } from '../orders/lifecycle/engine.js';
import type { Actor } from '../orders/lifecycle/types.js';
import { isReady, paymentGateway, payhereUrls } from './gateway-settings.js';
import {
  checkoutHash,
  formatPayHereAmount,
  PAYHERE_CURRENCY,
  PAYHERE_STATUS,
  splitName,
  verifyNotifySignature,
} from './payhere.js';

/**
 * PayHere checkout and payment notification (migration 047; owner,
 * 2026-10-14). Contract: docs/api/payhere.md. Never trusts return_url; only a
 * notification whose md5sig verifies with our merchant secret moves an order.
 */

export const checkoutRequestSchema = z.object({ order_id: z.string().uuid('order_id must be a valid UUID') }).strict();

/** The posted notification, as strings (PayHere posts x-www-form-urlencoded). */
const notifySchema = z.object({
  merchant_id: z.string().max(64),
  order_id: z.string().max(64),
  payment_id: z.string().max(64).optional(),
  payhere_amount: z.string().max(32),
  payhere_currency: z.string().max(8),
  status_code: z.string().regex(/^-?[0-9]{1,2}$/),
  md5sig: z.string().max(64),
  method: z.string().max(32).optional(),
  status_message: z.string().max(500).optional(),
});
type Notify = z.infer<typeof notifySchema>;

export type NotifyOutcome =
  | 'REJECTED_MALFORMED'
  | 'REJECTED_NOT_CONFIGURED'
  | 'REJECTED_SIGNATURE'
  | 'UNKNOWN_ORDER'
  | 'CONFIRMED'
  | 'DUPLICATE'
  | 'AMOUNT_MISMATCH'
  | 'PAID_AFTER_CANCEL'
  | 'PENDING'
  | 'ATTEMPT_FAILED'
  | 'IGNORED_AFTER_PAID'
  | 'CHARGEBACK'
  | 'UNKNOWN_STATUS';

/** What is kept of a notification: never card fields, never md5sig. */
function sanitised(n: Notify) {
  return {
    merchant_id: n.merchant_id,
    order_id: n.order_id,
    payment_id: n.payment_id ?? null,
    payhere_amount: n.payhere_amount,
    payhere_currency: n.payhere_currency,
    status_code: Number(n.status_code),
    method: n.method ?? null,
    status_message: n.status_message ?? null,
  };
}

async function logNotification(entry: {
  orderId: string | null;
  n: Partial<Notify>;
  signatureValid: boolean;
  outcome: NotifyOutcome;
}) {
  const amount = entry.n.payhere_amount && /^[0-9]+(\.[0-9]{1,2})?$/.test(entry.n.payhere_amount) ? entry.n.payhere_amount : null;
  const status = entry.n.status_code && /^-?[0-9]{1,2}$/.test(entry.n.status_code) ? Number(entry.n.status_code) : null;
  await db
    .insertInto('payment_notifications')
    .values({
      order_id: entry.orderId,
      gateway_order_id: entry.n.order_id?.slice(0, 64) ?? null,
      gateway_payment_id: entry.n.payment_id?.slice(0, 64) ?? null,
      status_code: status,
      amount,
      currency: entry.n.payhere_currency?.slice(0, 8) ?? null,
      method: entry.n.method?.slice(0, 32) ?? null,
      signature_valid: entry.signatureValid,
      outcome: entry.outcome,
    })
    .execute();
}

const customerActor = (customerId: string): Actor => ({ id: customerId, role: 'CUSTOMER' });

export const payhereService = {
  /**
   * POST /payments/payhere/checkout: the form fields the app posts to
   * PayHere. Only the order's owner; only an unpaid ONLINE order still in its
   * payment window. Repeatable (a retry after a failed card).
   */
  async checkout(customerId: string, orderId: string) {
    const gateway = await paymentGateway.read();
    if (!gateway.enabled || !isReady(gateway)) {
      throw new AppError('Online payment is not available right now.', 422, 'ONLINE_PAYMENT_UNAVAILABLE');
    }
    const order = await db
      .selectFrom('orders')
      .innerJoin('users', 'users.id', 'orders.customer_id')
      .select([
        'orders.id',
        'orders.order_number',
        'orders.customer_id',
        'orders.order_status',
        'orders.payment_method',
        'orders.payment_status',
        'orders.payment_expires_at',
        'orders.total_amount',
        'orders.delivery_address_line1',
        'orders.delivery_address_line2',
        'orders.delivery_city',
        'users.full_name',
        'users.phone',
        'users.email',
      ])
      .where('orders.id', '=', orderId)
      .where('orders.customer_id', '=', customerId)
      .executeTakeFirst();
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.payment_method !== 'ONLINE') {
      throw new AppError('This order is cash on delivery.', 422, 'NOT_ONLINE_ORDER');
    }
    if (order.payment_status === 'PAID') throw new AppError('This order is already paid.', 409, 'ORDER_ALREADY_PAID');
    if (order.order_status !== 'AWAITING_PAYMENT') {
      throw new AppError('This order is no longer waiting for payment.', 409, 'ORDER_NOT_AWAITING_PAYMENT', {
        order_status: order.order_status,
      });
    }
    if (order.payment_expires_at && order.payment_expires_at.getTime() <= Date.now()) {
      await this.expireOne(order.id, order.customer_id);
      throw new AppError('The time to pay for this order has passed. The order was cancelled.', 409, 'PAYMENT_EXPIRED');
    }
    // A retry after a failed attempt: pending again.
    if (order.payment_status === 'FAILED') {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('orders').set({ payment_status: 'PENDING', updated_at: new Date() }).where('id', '=', order.id).execute();
        await trx.updateTable('payments').set({ payment_status: 'PENDING', updated_at: new Date() }).where('order_id', '=', order.id).execute();
      });
    }

    const urls = payhereUrls(gateway.mode);
    const amount = formatPayHereAmount(Number(order.total_amount));
    const name = splitName(order.full_name);
    const withOrder = (u: string) => `${u}${u.includes('?') ? '&' : '?'}order=${encodeURIComponent(order.id)}`;
    const fields = {
      merchant_id: gateway.merchant_id!,
      return_url: withOrder(urls.return_url),
      cancel_url: withOrder(urls.cancel_url),
      notify_url: urls.notify_url,
      order_id: order.order_number,
      items: `Blynk order ${order.order_number}`,
      currency: PAYHERE_CURRENCY,
      amount,
      first_name: name.first_name,
      last_name: name.last_name,
      email: order.email ?? '',
      phone: order.phone,
      address: [order.delivery_address_line1, order.delivery_address_line2].filter(Boolean).join(', '),
      city: order.delivery_city,
      country: 'Sri Lanka',
      custom_1: order.id,
      hash: checkoutHash({
        merchantId: gateway.merchant_id!,
        orderId: order.order_number,
        amount,
        currency: PAYHERE_CURRENCY,
        merchantSecret: gateway.merchant_secret!,
      }),
    };
    return {
      action_url: urls.checkout_url,
      method: 'POST' as const,
      mode: gateway.mode,
      expires_at: order.payment_expires_at,
      fields,
    };
  },

  /**
   * POST /payments/payhere/notify. Returns the outcome; the route answers 400
   * for a rejected (unverified) notification and 200 otherwise.
   */
  async handleNotify(body: unknown): Promise<{ outcome: NotifyOutcome; verified: boolean }> {
    const parsed = notifySchema.safeParse(body);
    if (!parsed.success) {
      await logNotification({ orderId: null, n: (body ?? {}) as Partial<Notify>, signatureValid: false, outcome: 'REJECTED_MALFORMED' });
      return { outcome: 'REJECTED_MALFORMED', verified: false };
    }
    const n = parsed.data;
    const gateway = await paymentGateway.read();
    if (!gateway.merchant_id || !gateway.merchant_secret) {
      await logNotification({ orderId: null, n, signatureValid: false, outcome: 'REJECTED_NOT_CONFIGURED' });
      logger.warn({ gatewayOrderId: n.order_id }, 'PayHere notification received but PayHere is not configured');
      return { outcome: 'REJECTED_NOT_CONFIGURED', verified: false };
    }
    if (n.merchant_id !== gateway.merchant_id || !verifyNotifySignature(n, gateway.merchant_secret)) {
      await logNotification({ orderId: null, n, signatureValid: false, outcome: 'REJECTED_SIGNATURE' });
      logger.warn({ gatewayOrderId: n.order_id, statusCode: n.status_code }, 'PayHere notification rejected: signature mismatch');
      return { outcome: 'REJECTED_SIGNATURE', verified: false };
    }

    const order = await db
      .selectFrom('orders')
      .select(['id', 'customer_id', 'payment_method'])
      .where('order_number', '=', n.order_id)
      .executeTakeFirst();
    if (!order || order.payment_method !== 'ONLINE') {
      await logNotification({ orderId: order?.id ?? null, n, signatureValid: true, outcome: 'UNKNOWN_ORDER' });
      logger.warn({ gatewayOrderId: n.order_id }, 'PayHere notification for an unknown or non-online order');
      return { outcome: 'UNKNOWN_ORDER', verified: true };
    }

    const outcome = await this.applyVerified(order.id, order.customer_id, n);
    await logNotification({ orderId: order.id, n, signatureValid: true, outcome });
    logger.info({ orderId: order.id, statusCode: Number(n.status_code), outcome }, 'PayHere notification processed');
    return { outcome, verified: true };
  },

  /** The effect of a verified notification, decided under the order lock. */
  async applyVerified(orderId: string, customerId: string, n: Notify): Promise<NotifyOutcome> {
    const status = Number(n.status_code);
    const info = sanitised(n);
    const gatewayFields = {
      gateway: 'PAYHERE',
      gateway_payment_id: n.payment_id ?? null,
      gateway_status_code: status,
      gateway_method: n.method ?? null,
      gateway_status_message: n.status_message ?? null,
      gateway_response: JSON.stringify(info),
    };

    if (status === PAYHERE_STATUS.SUCCESS) {
      // Locked read: decide between confirm / duplicate / late / mismatch.
      const decision = await db.transaction().execute(async (trx) => {
        const o = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirstOrThrow();
        const p = await trx.selectFrom('payments').selectAll().where('order_id', '=', orderId).executeTakeFirst();
        if (o.payment_status === 'PAID' || p?.payment_status === 'PAID') {
          return p?.gateway_payment_id && n.payment_id && p.gateway_payment_id !== n.payment_id ? 'SECOND_PAYMENT' : 'DUPLICATE';
        }
        const amountOk =
          n.payhere_currency === PAYHERE_CURRENCY &&
          /^[0-9]+(\.[0-9]{1,2})?$/.test(n.payhere_amount) &&
          formatPayHereAmount(n.payhere_amount) === formatPayHereAmount(Number(o.total_amount));
        if (!amountOk) {
          await trx
            .updateTable('payments')
            .set({ ...gatewayFields, refund_required: true, updated_at: new Date() })
            .where('order_id', '=', orderId)
            .execute();
          return 'AMOUNT_MISMATCH';
        }
        if (o.order_status !== 'AWAITING_PAYMENT') {
          // Paid after the order was cancelled or expired: the money must go back.
          const now = new Date();
          await trx
            .updateTable('payments')
            .set({ ...gatewayFields, payment_status: 'PAID', paid_at: now, refund_required: true, transaction_reference: n.payment_id ?? null, updated_at: now })
            .where('order_id', '=', orderId)
            .execute();
          await trx.updateTable('orders').set({ payment_status: 'PAID', updated_at: now }).where('id', '=', orderId).execute();
          return 'PAID_AFTER_CANCEL';
        }
        return 'CONFIRM';
      });
      if (decision === 'SECOND_PAYMENT') {
        // A second successful payment for an already-paid order: flag it.
        await db.updateTable('payments').set({ refund_required: true, updated_at: new Date() }).where('order_id', '=', orderId).execute();
        logger.warn({ orderId }, 'PayHere: a second successful payment arrived for a paid order - refund needed');
        return 'DUPLICATE';
      }
      if (decision !== 'CONFIRM') return decision;
      try {
        await runTransition('PAYMENT_CONFIRMED', {
          actor: customerActor(customerId),
          orderId,
          input: {
            payment: {
              gateway_payment_id: n.payment_id ?? null,
              status_code: status,
              method: n.method ?? null,
              status_message: n.status_message ?? null,
              response: info,
            },
          },
        });
        return 'CONFIRMED';
      } catch (err) {
        // Raced with an expiry/cancel between the read and the action: retry once as a late payment.
        if (err instanceof AppError && err.code === 'INVALID_STATUS_TRANSITION') return await this.applyVerified(orderId, customerId, n);
        throw err;
      }
    }

    if (status === PAYHERE_STATUS.PENDING) {
      await db
        .updateTable('payments')
        .set({ ...gatewayFields, updated_at: new Date() })
        .where('order_id', '=', orderId)
        .where('payment_status', '!=', 'PAID')
        .execute();
      return 'PENDING';
    }

    if (status === PAYHERE_STATUS.CANCELLED || status === PAYHERE_STATUS.FAILED) {
      // The attempt failed; the order stays AWAITING_PAYMENT until it expires,
      // so the customer may try again. Never overrides a payment already made.
      return await db.transaction().execute(async (trx) => {
        const o = await trx.selectFrom('orders').select(['payment_status', 'order_status']).where('id', '=', orderId).forUpdate().executeTakeFirstOrThrow();
        if (o.payment_status === 'PAID') return 'IGNORED_AFTER_PAID' as const;
        const now = new Date();
        await trx
          .updateTable('payments')
          .set({ ...gatewayFields, payment_status: 'FAILED', failed_at: now, updated_at: now })
          .where('order_id', '=', orderId)
          .execute();
        await trx.updateTable('orders').set({ payment_status: 'FAILED', updated_at: now }).where('id', '=', orderId).execute();
        return 'ATTEMPT_FAILED' as const;
      });
    }

    if (status === PAYHERE_STATUS.CHARGEDBACK) {
      const now = new Date();
      await db.transaction().execute(async (trx) => {
        await trx.selectFrom('orders').select('id').where('id', '=', orderId).forUpdate().executeTakeFirstOrThrow();
        await trx
          .updateTable('payments')
          .set({ ...gatewayFields, payment_status: 'REFUNDED', refund_required: true, updated_at: now })
          .where('order_id', '=', orderId)
          .execute();
        await trx.updateTable('orders').set({ payment_status: 'REFUNDED', updated_at: now }).where('id', '=', orderId).execute();
      });
      logger.warn({ orderId }, 'PayHere chargeback recorded');
      return 'CHARGEBACK';
    }

    return 'UNKNOWN_STATUS';
  },

  /** Cancels one unpaid online order whose window has passed (no-op otherwise). */
  async expireOne(orderId: string, customerId: string, now = new Date()): Promise<boolean> {
    try {
      await runTransition('PAYMENT_EXPIRED', { actor: customerActor(customerId), orderId, input: { now } });
      return true;
    } catch (err) {
      // Paid, cancelled or still inside its window by the time the lock was taken.
      if (err instanceof AppError && ['INVALID_STATUS_TRANSITION', 'PAYMENT_WINDOW_OPEN'].includes(err.code ?? '')) return false;
      throw err;
    }
  },

  /** The worker's sweep: every unpaid online order past its window. */
  async expireStalePayments(now = new Date(), limit = 50): Promise<number> {
    const due = await db
      .selectFrom('orders')
      .select(['id', 'customer_id'])
      .where('order_status', '=', 'AWAITING_PAYMENT')
      .where('payment_expires_at', '<=', now)
      .orderBy('payment_expires_at', 'asc')
      .limit(limit)
      .execute();
    let expired = 0;
    for (const o of due) {
      if (await this.expireOne(o.id, o.customer_id, now)) expired++;
    }
    if (expired) logger.info({ expired }, 'Expired unpaid online orders');
    return expired;
  },
};

