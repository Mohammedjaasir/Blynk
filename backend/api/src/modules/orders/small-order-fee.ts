import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';

/**
 * Small-order fee (owner's brother, 2026-10-25): an order whose item total is UNDER
 * `min_subtotal_lkr` pays `fee_lkr` on top of its delivery fee. Switch, OFF by default; all three
 * values are set in Admin / Ops (system_configurations 'small_order_fee', no migration for the
 * setting). Rules, shared by GET /orders/checkout-info, the coupon preview and order placement:
 *
 * - The item total is the order's subtotal after item / category offers, bundle prices and combo
 *   prices, BEFORE coupons, the birthday gift, referral rewards and points - the same amount the
 *   free-delivery-above-a-basket rule compares, so a coupon cannot create the fee.
 * - Free delivery (new-customer or basket amount) does NOT waive it, and it is not part of the
 *   delivery fee, so rider pay (a % of the STANDARD delivery fee) never touches it.
 * - Snapshotted on the order (orders.small_order_fee, migration 063). Removing an unavailable item
 *   later does not add or change it, like the delivery fee.
 * - The column is added by migration 063, run by hand in Coolify: until it exists the fee is
 *   treated as off everywhere (smallOrderFeeReady) and switching it on answers 409.
 */
export const SMALL_ORDER_FEE_KEY = 'small_order_fee';
export const MAX_SMALL_ORDER_MIN_LKR = 100_000;
export const MAX_SMALL_ORDER_FEE_LKR = 1000;
export const DEFAULT_SMALL_ORDER_FEE = { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 } as const;

export interface SmallOrderFeeSetting {
  enabled: boolean;
  min_subtotal_lkr: number;
  fee_lkr: number;
}

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const round2 = (v: number) => Math.round(v * 100) / 100;

export const smallOrderFeeSchema = z
  .object({
    enabled: z.boolean({ required_error: 'enabled is required', invalid_type_error: 'enabled must be true or false' }),
    min_subtotal_lkr: z
      .number({ required_error: 'The item total is required', invalid_type_error: 'The item total must be a number' })
      .finite()
      .gt(0, 'The item total must be more than 0')
      .max(MAX_SMALL_ORDER_MIN_LKR, `The item total can be at most LKR ${MAX_SMALL_ORDER_MIN_LKR}`)
      .refine(twoDecimals, 'The item total can have at most 2 decimals'),
    fee_lkr: z
      .number({ required_error: 'The fee is required', invalid_type_error: 'The fee must be a number' })
      .finite()
      .gt(0, 'The fee must be more than 0')
      .max(MAX_SMALL_ORDER_FEE_LKR, `The fee can be at most LKR ${MAX_SMALL_ORDER_FEE_LKR}`)
      .refine(twoDecimals, 'The fee can have at most 2 decimals'),
  })
  .strict();

/** A stored row, or null when missing / malformed (the caller then uses the default). */
export function smallOrderFeeFrom(value: unknown): SmallOrderFeeSetting | null {
  const parsed = smallOrderFeeSchema.safeParse(value);
  return parsed.success ? { ...parsed.data, min_subtotal_lkr: round2(parsed.data.min_subtotal_lkr), fee_lkr: round2(parsed.data.fee_lkr) } : null;
}

/** Whether this item total pays the fee (false when switched off). */
export function smallOrderFeeApplies(policy: SmallOrderFeeSetting | null | undefined, subtotal: number): boolean {
  return !!policy && policy.enabled && policy.fee_lkr > 0 && policy.min_subtotal_lkr > 0 && subtotal + 1e-9 < policy.min_subtotal_lkr;
}

/** The fee an order with this item total is charged (0 when none). */
export function smallOrderFeeCharged(policy: SmallOrderFeeSetting | null | undefined, subtotal: number): number {
  return smallOrderFeeApplies(policy, subtotal) ? round2(policy!.fee_lkr) : 0;
}

export interface SmallOrderFeeStatus extends SmallOrderFeeSetting {
  /** Whether this subtotal pays the fee (null = off, or no subtotal given). */
  applies: boolean | null;
  /** The fee that will be charged (0 when it does not apply). */
  charged_lkr: number;
  /** LKR still to add to avoid it (0 once reached; null = off or no subtotal). */
  remaining_lkr: number | null;
}

export function smallOrderFeeStatus(policy: SmallOrderFeeSetting, subtotal?: number | null): SmallOrderFeeStatus {
  if (!policy.enabled || subtotal === undefined || subtotal === null) {
    return { ...policy, applies: policy.enabled ? null : false, charged_lkr: 0, remaining_lkr: null };
  }
  const applies = smallOrderFeeApplies(policy, subtotal);
  return {
    ...policy,
    applies,
    charged_lkr: applies ? round2(policy.fee_lkr) : 0,
    remaining_lkr: applies ? round2(policy.min_subtotal_lkr - subtotal) : 0,
  };
}

let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

/** Whether migration 063 (orders.small_order_fee) has been run. A "yes" is kept; a "no" is asked again after a minute. */
export async function smallOrderFeeReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'small_order_fee'`.execute(db);
    cached = { ok: (r.rows[0]?.n ?? 0) >= 1, at: Date.now() };
  } catch {
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 063 is missing (false) or present (true); null = check the database again. */
export function setSmallOrderFeeReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}
