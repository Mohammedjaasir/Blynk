import { sql } from 'kysely';
import type { DBConnection } from '../orders/order.repository.js';
import type { BirthdayOfferSetting } from '../configuration/settings.service.js';
import {
  birthdayDiscount,
  birthdayWindow,
  colomboDay,
  isoDay,
  MIN_DAYS_BETWEEN_GIFTS,
  parseIsoDate,
} from './birthday.rules.js';

/**
 * The birthday gift (owner, 2026-10-09; migration 034): X% off the item
 * subtotal of ONE order placed in the customer's birthday week. Server
 * authoritative - the app only shows what GET /orders/checkout-info says.
 *
 * Stacking:
 *  - Taken off the item subtotal AFTER product and category offers and combo
 *    prices (what the items actually cost), never off the delivery fee.
 *  - A free delivery still applies on the same order.
 *  - A coupon and the gift never stack: the larger discount is used, and on a
 *    tie the coupon, so the gift stays for another order that week. The one
 *    not used is not spent (no coupon redemption / no birthday redemption).
 *  - Cancelling the order gives the gift back (released_at), like a coupon.
 */

export interface BirthdayOfferStatus {
  enabled: boolean;
  percent: number;
  has_birthday: boolean;
  in_window: boolean;
  used: boolean;
  /** The next order gets `percent` off. */
  eligible: boolean;
  birthday: string | null;
  window_start: string | null;
  window_end: string | null;
  /** Internal: which birthday a redemption is for. */
  offer_year: number | null;
}

/** The customer's date of birth as YYYY-MM-DD, or null. */
export async function dateOfBirthOf(executor: DBConnection, customerId: string): Promise<string | null> {
  const row = await executor
    .selectFrom('users')
    .select(sql<string | null>`date_of_birth::text`.as('dob'))
    .where('id', '=', customerId)
    .executeTakeFirst();
  return row?.dob ?? null;
}

/** Whether a gift already counts against this birthday (or one was used too recently). */
async function giftUsed(executor: DBConnection, customerId: string, offerYear: number, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - MIN_DAYS_BETWEEN_GIFTS * 24 * 60 * 60 * 1000);
  const row = await executor
    .selectFrom('birthday_offer_redemptions')
    .select('id')
    .where('customer_id', '=', customerId)
    .where('released_at', 'is', null)
    .where((eb) => eb.or([eb('offer_year', '=', offerYear), eb('created_at', '>', since)]))
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

/**
 * Where this customer stands. Pass `lock` inside the order transaction: the
 * customer's user row is locked so two racing checkouts cannot both take the
 * gift (the partial unique index is the backstop).
 */
export async function birthdayOfferStatus(
  executor: DBConnection,
  customerId: string,
  setting: BirthdayOfferSetting,
  now: Date,
  lock = false
): Promise<BirthdayOfferStatus> {
  if (lock) {
    await executor.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
  }
  const base = { enabled: setting.enabled, percent: setting.percent };
  const dobText = await dateOfBirthOf(executor, customerId);
  const dob = dobText ? parseIsoDate(dobText) : null;
  if (!dob) {
    return { ...base, has_birthday: false, in_window: false, used: false, eligible: false, birthday: null, window_start: null, window_end: null, offer_year: null };
  }
  const w = birthdayWindow(dob, colomboDay(now));
  const used = await giftUsed(executor, customerId, w.offer_year, now);
  return {
    ...base,
    has_birthday: true,
    in_window: w.in_window,
    used,
    eligible: setting.enabled && w.in_window && !used,
    birthday: isoDay(w.birthday),
    window_start: isoDay(w.start),
    window_end: isoDay(w.end),
    offer_year: w.offer_year,
  };
}

/** What the customer sees: the status without the internal year. */
export function publicBirthdayStatus(status: BirthdayOfferStatus) {
  const { offer_year: _year, ...rest } = status;
  return rest;
}

export interface AppliedBirthday {
  percent: number;
  offer_year: number;
  discount_amount: number;
}

/** The gift for this order, or null when the customer is not eligible. */
export function applyBirthday(status: BirthdayOfferStatus, subtotal: number): AppliedBirthday | null {
  if (!status.eligible || status.offer_year === null) return null;
  const discount = birthdayDiscount(subtotal, status.percent);
  return discount > 0 ? { percent: status.percent, offer_year: status.offer_year, discount_amount: discount } : null;
}

/** The stacking rule: the birthday gift only when it is strictly larger than the coupon. */
export function birthdayBeatsCoupon(birthday: AppliedBirthday | null, couponDiscount: number | null): boolean {
  if (!birthday) return false;
  if (couponDiscount === null) return true;
  return birthday.discount_amount > couponDiscount;
}

/** Inside the order transaction, after the order row exists. */
export async function recordBirthdayRedemption(
  executor: DBConnection,
  applied: AppliedBirthday,
  orderId: string,
  customerId: string
): Promise<void> {
  await executor
    .insertInto('birthday_offer_redemptions')
    .values({
      customer_id: customerId,
      order_id: orderId,
      offer_year: applied.offer_year,
      percent: applied.percent,
      discount_amount: applied.discount_amount,
    })
    .execute();
}

/** Cancelling an order gives the gift back (the row stays for the record). */
export async function releaseBirthdayRedemption(executor: DBConnection, orderId: string): Promise<void> {
  await executor
    .updateTable('birthday_offer_redemptions')
    .set({ released_at: new Date() })
    .where('order_id', '=', orderId)
    .where('released_at', 'is', null)
    .execute();
}

/**
 * The gift after the store removes an item (RESOLVE_ITEM): the same % of the
 * new subtotal. Returns null when the order has no gift.
 */
export async function recomputeBirthdayDiscount(executor: DBConnection, orderId: string, subtotal: number): Promise<number | null> {
  const row = await executor
    .selectFrom('birthday_offer_redemptions')
    .select(['id', 'percent'])
    .where('order_id', '=', orderId)
    .executeTakeFirst();
  if (!row) return null;
  const discount = birthdayDiscount(subtotal, Number(row.percent));
  await executor.updateTable('birthday_offer_redemptions').set({ discount_amount: discount }).where('id', '=', row.id).execute();
  return discount;
}
