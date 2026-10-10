/**
 * Per-km tier pricing (owner, 2026-10-10: "1st km LKR 100, then an additional
 * amount for the 2nd km, another for the 3rd and 4th"). Used by the customer
 * delivery fee (Settings -> Delivery fee) and rider distance pay (Rider pay,
 * a rider's own pay). The API is the authority; this mirrors its formula so
 * the editors can show live examples and catch mistakes before saving.
 *
 *   km_counted = max(1, ceil(distance_km))   2.3 km -> 3; 2.0 -> 2; 0.4 -> 1
 *   amount(i)  = tiers[min(i, n) - 1].lkr     the last row repeats
 *   total      = sum of amount(1..km_counted), then the optional cap
 */

import type { KmTier } from '../api/types';

export type { KmTier };

/** The API's limits (owner, 2026-10-10). */
export const MIN_KM_TIERS = 1;
export const MAX_KM_TIERS = 10;
export const MAX_TIER_LKR = 1000;
export const MAX_FEE_CAP_LKR = 10000;

/** Every started km counts: 2.3 km -> 3, 2.0 -> 2, 0.4 -> 1 (and 0 -> 1). */
export function kmCounted(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 1;
  return Math.max(1, Math.ceil(distanceKm));
}

/** The amount for each counted km; the last row repeats for longer trips. */
export function tierAmounts(tiers: KmTier[], distanceKm: number): number[] {
  if (tiers.length === 0) return [];
  const n = kmCounted(distanceKm);
  return Array.from({ length: n }, (_, i) => tiers[Math.min(i, tiers.length - 1)].lkr);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Sum of the counted kms, capped at `capLkr` when one is set. */
export function tierTotal(tiers: KmTier[], distanceKm: number, capLkr?: number | null): number {
  const sum = round2(tierAmounts(tiers, distanceKm).reduce((a, b) => a + b, 0));
  return typeof capLkr === 'number' && capLkr >= 0 ? Math.min(sum, capLkr) : sum;
}

/** 100 -> "100", 1250 -> "1,250", 62.5 -> "62.50": no decimals when whole, else 2. */
export function formatTierLkr(value: number): string {
  const whole = Number.isInteger(round2(value));
  return value.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/**
 * The live example (owner, 2026-10-10): "3 km = LKR 100 + 60 + 50 = LKR 210",
 * "1 km = LKR 100", and with a cap "5 km = LKR 100 + 60 + 50 + 50 + 50 =
 * LKR 310, capped at LKR 250". Empty when there are no tiers.
 */
export function tierExampleText(tiers: KmTier[], distanceKm: number, capLkr?: number | null): string {
  const amounts = tierAmounts(tiers, distanceKm);
  if (amounts.length === 0) return '';
  const n = kmCounted(distanceKm);
  const sum = round2(amounts.reduce((a, b) => a + b, 0));
  const head = `${n} km = LKR ${amounts.map(formatTierLkr).join(' + ')}`;
  const body = amounts.length === 1 ? head : `${head} = LKR ${formatTierLkr(sum)}`;
  const total = tierTotal(tiers, distanceKm, capLkr);
  return total < sum ? `${body}, capped at LKR ${formatTierLkr(total)}` : body;
}

/** The example distances the editors show. */
export const EXAMPLE_KMS = [1, 3, 5];

/** "LKR 100 per km" or "km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50". */
export function tiersSummary(tiers: KmTier[]): string {
  if (tiers.length === 0) return 'no km amounts set';
  if (tiers.length === 1) return `LKR ${formatTierLkr(tiers[0].lkr)} per km`;
  return tiers
    .map((t, i) => `km ${i + 1}${i === tiers.length - 1 ? '+' : ''} LKR ${formatTierLkr(t.lkr)}`)
    .join(', ');
}

/** Tiers as text for the editor's boxes: 100 -> "100", 62.5 -> "62.5". */
export function tiersToDrafts(tiers: KmTier[] | null | undefined): string[] {
  return (tiers ?? []).map((t) => String(Number(t.lkr.toFixed(2))));
}

const AMOUNT = /^\d+(\.\d+)?$/;
const TWO_DP = /^\d+(\.\d{1,2})?$/;

const cleanAmount = (raw: string) => raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();

/** One km amount: 0..1000, at most 2 decimals. */
export function parseTierAmount(raw: string): { value: number } | { error: string } {
  const text = cleanAmount(raw);
  if (!text) return { error: 'Enter an amount (0 is allowed).' };
  if (!AMOUNT.test(text)) return { error: 'Enter a number, like 60 or 62.50.' };
  if (!TWO_DP.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  if (value > MAX_TIER_LKR) return { error: `At most LKR ${MAX_TIER_LKR.toLocaleString('en-US')} per km.` };
  return { value };
}

export interface TierErrors {
  /** Row index -> message. */
  rows: Record<number, string>;
  list?: string;
}

/** The editor's boxes as API tiers ({km: 1..n, lkr}), or the problems found. */
export function parseTierDrafts(drafts: string[]): { tiers: KmTier[] } | { errors: TierErrors } {
  const errors: TierErrors = { rows: {} };
  if (drafts.length < MIN_KM_TIERS) errors.list = 'Add the amount for km 1.';
  if (drafts.length > MAX_KM_TIERS) errors.list = `Up to ${MAX_KM_TIERS} km rows.`;
  const tiers: KmTier[] = drafts.map((raw, i) => {
    const r = parseTierAmount(raw);
    if ('error' in r) {
      errors.rows[i] = r.error;
      return { km: i + 1, lkr: 0 };
    }
    return { km: i + 1, lkr: r.value };
  });
  return errors.list || Object.keys(errors.rows).length ? { errors } : { tiers };
}

/** The tiers the boxes hold right now, or null while any box is not a valid amount (for live examples). */
export function tiersOrNull(drafts: string[]): KmTier[] | null {
  const r = parseTierDrafts(drafts);
  return 'tiers' in r ? r.tiers : null;
}

/** The optional maximum fee: blank = no cap (null), else 0..10,000 with at most 2 decimals. */
export function parseFeeCap(raw: string): { cap: number | null } | { error: string } {
  const text = cleanAmount(raw);
  if (!text) return { cap: null };
  if (!AMOUNT.test(text)) return { error: 'Enter a number, like 400, or leave it blank.' };
  if (!TWO_DP.test(text)) return { error: 'Use at most 2 decimal places.' };
  const cap = Number(text);
  if (cap > MAX_FEE_CAP_LKR) return { error: `The maximum fee must be LKR ${MAX_FEE_CAP_LKR.toLocaleString('en-US')} or less.` };
  return { cap };
}
