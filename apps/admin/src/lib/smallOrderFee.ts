import type { CheckoutSettings, SmallOrderFeeSetting } from '../api/types';
import { formatTierLkr } from './kmTiers';

/**
 * Small-order fee (owner, 2026-10-25; PATCH /admin/settings/checkout
 * `small_order_fee`): customers whose item total is UNDER `min_subtotal_lkr`
 * pay `fee_lkr` on top of delivery. Off by default. The API re-validates; this
 * only saves a round trip.
 */
export const DEFAULT_SMALL_ORDER_FEE: SmallOrderFeeSetting = { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 };

export const SMALL_ORDER_NOT_READY_NOTICE = 'Needs migration 063';

const cleanNumber = (raw: string) => raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();

/** "Item total under (LKR)": 1..100,000, at most 2 decimals. */
export function parseSmallOrderMin(raw: string): { value: number } | { error: string } {
  const text = cleanNumber(raw);
  if (!text) return { error: 'Enter the item total in LKR, like 1000.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 1000 or 999.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  if (value < 1 || value > 100_000) return { error: 'The item total must be between LKR 1 and LKR 100,000.' };
  return { value };
}

/** "Fee (LKR)": 0.01..1000, at most 2 decimals. */
export function parseSmallOrderFeeAmount(raw: string): { value: number } | { error: string } {
  const text = cleanNumber(raw);
  if (!text) return { error: 'Enter the fee in LKR, like 50.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 50 or 49.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  if (value < 0.01 || value > 1000) return { error: 'The fee must be between LKR 0.01 and LKR 1,000.' };
  return { value };
}

/** The stored fee, or the defaults when the API has none (older backend / never saved). */
export function storedSmallOrderFee(setting: CheckoutSettings | null | undefined): SmallOrderFeeSetting {
  return setting?.small_order_fee ?? DEFAULT_SMALL_ORDER_FEE;
}

/** True when the migration is known to be missing (false only; an older API that leaves the flag out is not flagged). */
export function smallOrderFeeNeedsMigration(setting: CheckoutSettings | null | undefined): boolean {
  return setting?.small_order_fee_ready === false;
}

/** "LKR 50 when the items come to less than LKR 1,000" / "off". */
export function smallOrderFeeText(fee: SmallOrderFeeSetting): string {
  return fee.enabled
    ? `LKR ${formatTierLkr(fee.fee_lkr)} when the items come to less than LKR ${formatTierLkr(fee.min_subtotal_lkr)}`
    : 'off';
}
