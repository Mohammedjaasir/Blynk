import type { OrderRow, Trx } from './types.js';
import { normalizeSriLankanPhone } from '../../../utils/phone.js';
import { checkoutSettings, orderForSomeoneElseOf } from '../../configuration/settings.service.js';
import { langPayload, smsLanguageForUser } from '../../notifications/sms-language.js';

/**
 * The order texts a customer is sent (owner, 2026-10-07: SMS cost). Only what
 * they must act on: the order is on its way (be at the door with the cash),
 * or something went wrong (cancelled, or an item missing and the total
 * changed). Placed, rider assigned, delivered and cash received are shown in
 * the app instead - at most one SMS for an ordinary order, down from five.
 */
export const CUSTOMER_ORDER_SMS: ReadonlySet<string> = new Set(['OUT_FOR_DELIVERY', 'ORDER_CANCELLED', 'ITEM_UNAVAILABLE']);

/**
 * Order for someone else (owner, 2026-10-12: "so a Colombo child can
 * follow"): the BUYER also gets these texts on their own (verified) number -
 * the ones above plus "delivered", since they are not at the door to see it.
 */
export const BUYER_ORDER_SMS: ReadonlySet<string> = new Set([...CUSTOMER_ORDER_SMS, 'DELIVERED']);

/** The buyer's own number as an SMS can reach it, or null (placeholder, foreign, missing). */
async function buyerPhone(trx: Trx, customerId: string): Promise<string | null> {
  const row = await trx.selectFrom('users').select('phone').where('id', '=', customerId).executeTakeFirst();
  if (!row?.phone) return null;
  try {
    return normalizeSriLankanPhone(row.phone);
  } catch {
    return null;
  }
}

function samePhone(a: string, b: string): boolean {
  try {
    return normalizeSriLankanPhone(a) === normalizeSriLankanPhone(b);
  } catch {
    return a === b;
  }
}

async function insertSms(
  trx: Trx,
  order: OrderRow,
  notificationType: string,
  idempotencyKey: string,
  recipient: string,
  payload: Record<string, unknown>
): Promise<void> {
  await trx
    .insertInto('notifications')
    .values({
      user_id: order.customer_id,
      order_id: order.id,
      idempotency_key: idempotencyKey,
      channel: 'SMS',
      notification_type: notificationType,
      recipient,
      payload,
      status: 'QUEUED',
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .execute();
}

/**
 * Enqueues a customer SMS in the outbox, in the same transaction as the
 * change it reports. The idempotency key makes a retried action send once.
 * A type outside [CUSTOMER_ORDER_SMS] (or [BUYER_ORDER_SMS] for the buyer of
 * an order for someone else) is not sent.
 *
 * Who gets it:
 *  - An ordinary order: order.delivery_recipient_phone, as always.
 *  - An order placed "For someone else" (migration 042): the receiver
 *    (delivery_recipient_phone) AND the buyer (their account's own number).
 *    The delivery code (OUT_FOR_DELIVERY) goes to the receiver while "Send
 *    delivery code to receiver" is on (the default); off, only the buyer's
 *    text carries it. Nobody else ever gets the code. Same number twice ->
 *    one text, with the code.
 *
 * The receiver's number is one the buyer typed and never proved, so callers
 * never put customer-written text in a payload (security audit 2026-10) and
 * the templates ignore any that slips in.
 *
 * Language (owner, 2026-10-12): the "Customer SMS language" setting and the
 * buyer's own pick (sms-language.ts) - payload.lang, left out for English.
 */
export async function enqueueCustomerSms(
  trx: Trx,
  order: OrderRow,
  notificationType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  const forSomeoneElse = order.ordered_for_someone_else === true;
  const toReceiver = CUSTOMER_ORDER_SMS.has(notificationType);
  const toBuyer = forSomeoneElse && BUYER_ORDER_SMS.has(notificationType);
  if (!toReceiver && !toBuyer) return;

  const lang = langPayload(await smsLanguageForUser(trx, order.customer_id));

  if (!forSomeoneElse) {
    await insertSms(trx, order, notificationType, idempotencyKey, order.delivery_recipient_phone, { ...payload, ...lang });
    return;
  }

  const hasCode = typeof payload.delivery_code === 'string';
  const { delivery_code: code, ...withoutCode } = payload;
  const buyer = await buyerPhone(trx, order.customer_id);
  const sameNumber = buyer !== null && samePhone(buyer, order.delivery_recipient_phone);
  const codeToReceiver = hasCode && (sameNumber || orderForSomeoneElseOf(await checkoutSettings.read()).send_code_to_receiver);

  if (toReceiver) {
    await insertSms(trx, order, notificationType, idempotencyKey, order.delivery_recipient_phone, {
      ...(codeToReceiver ? payload : withoutCode),
      ...lang,
    });
  }
  if (toBuyer && buyer && !sameNumber) {
    await insertSms(trx, order, notificationType, `${idempotencyKey}_BUYER`, buyer, {
      ...withoutCode,
      // The buyer's "on the way" text: no "keep LKR ready" (the receiver pays),
      // and the code only when the receiver's text does not carry it.
      ...(notificationType === 'OUT_FOR_DELIVERY' ? { to_buyer: true } : {}),
      ...(hasCode && !codeToReceiver ? { delivery_code: code } : {}),
      ...lang,
    });
  }
}
