import { z } from 'zod';

/*
 * Per-km tier pricing (owner, 2026-10-10): "1st km LKR 100, then an
 * additional amount for the 2nd km, another for the 3rd and 4th". Used by the
 * customer delivery fee (orders/delivery-fee.ts, fee mode DISTANCE_TIERS) and
 * by rider distance pay (riders/rider.pay-rules.ts, distance_mode TIERS);
 * each has its own table, set by Ops and Admin.
 *
 * THE FORMULA
 *   km_counted = max(1, ceil(distance_km))   every STARTED km counts:
 *                                            2.3 km -> 3, 2.0 -> 2, 0.4 -> 1
 *   amount(i)  = tiers[min(i, n) - 1].lkr    the last row repeats
 *   total      = amount(1) + ... + amount(km_counted), then the optional cap
 *   e.g. [100, 60, 50]: 3 km = 100 + 60 + 50 = 210; 5 km = 310
 */

export interface KmTier {
  km: number;
  lkr: number;
}

export const MAX_KM_TIERS = 10;
/** Each row's amount, LKR. */
export const MAX_KM_TIER_LKR = 1000;

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** 1..10 rows; row i is km i (1, 2, 3 ... in order); amounts 0..1000 with at most 2 decimals. */
export const kmTiersSchema = z
  .array(
    z
      .object({
        km: z
          .number({ required_error: 'km is required', invalid_type_error: 'km must be a number' })
          .int('km must be a whole number')
          .min(1, 'km starts at 1')
          .max(MAX_KM_TIERS, `At most ${MAX_KM_TIERS} km rows`),
        lkr: z
          .number({ required_error: 'The amount is required', invalid_type_error: 'The amount must be a number' })
          .finite()
          .min(0, 'An amount cannot be negative')
          .max(MAX_KM_TIER_LKR, `An amount can be at most LKR ${MAX_KM_TIER_LKR}`)
          .refine(twoDecimals, 'An amount can have at most 2 decimals'),
      })
      .strict(),
    { invalid_type_error: 'The km amounts must be a list' }
  )
  .min(1, 'Add the amount for km 1')
  .max(MAX_KM_TIERS, `At most ${MAX_KM_TIERS} km rows`)
  .refine((rows) => rows.every((r, i) => r.km === i + 1), 'The rows must be km 1, km 2, km 3 ... in order')
  .transform((rows) => rows.map((r) => ({ km: r.km, lkr: round2(r.lkr) })));

/** A stored table, or [] when missing or malformed (never throws). */
export function kmTiersFrom(value: unknown): KmTier[] {
  const parsed = kmTiersSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Every started km counts; at least 1. Distances are 2-decimal km, so 2.00 is 2. */
export function kmCounted(distanceKm: number): number {
  const km = Number.isFinite(distanceKm) && distanceKm > 0 ? round2(distanceKm) : 0;
  return Math.max(1, Math.ceil(km - 1e-9));
}

export interface TierPrice {
  km_counted: number;
  /** Each counted km's amount, km 1 first. */
  parts: number[];
  /** Before any cap. */
  sum: number;
  /** After the cap. */
  total: number;
  capped: boolean;
}

/** The tier formula. `tiers` must be non-empty (validated tables always are). */
export function priceByKmTiers(tiers: KmTier[], distanceKm: number, maxLkr: number | null = null): TierPrice {
  if (!tiers.length) throw new Error('priceByKmTiers needs at least one tier');
  const n = kmCounted(distanceKm);
  const parts = Array.from({ length: n }, (_, i) => tiers[Math.min(i, tiers.length - 1)].lkr);
  const sum = round2(parts.reduce((s, v) => s + v, 0));
  const capped = maxLkr !== null && sum > maxLkr;
  return { km_counted: n, parts, sum, total: capped ? round2(maxLkr!) : sum, capped };
}
