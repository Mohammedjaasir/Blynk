import type { KmTier } from '../api/types';

/**
 * Per-km tier pricing (owner, 2026-10-10: "1st km LKR 100, then an
 * additional amount for the 2nd km, another for the 3rd and 4th"). One
 * formula for the customer delivery fee and for rider distance pay:
 *
 *   km_counted = max(1, ceil(distance_km))   2.3 km -> 3, 2.0 -> 2, 0.4 -> 1
 *   amount(i)  = tiers[min(i, n) - 1].lkr    the last row repeats
 *   total      = amount(1) + ... + amount(km_counted), then the optional cap
 *
 * The server works the real amounts out; this is for the editors' live
 * example and client-side checks only.
 */

/** The API's limits: 1..10 rows, each LKR 0..1000 with at most 2 decimals. */
export const MAX_KM_TIERS = 10;
export const MAX_KM_TIER_LKR = 1_000;
/** The delivery fee's optional cap: LKR 0..10000. */
export const MAX_FEE_CAP_LKR = 10_000;

/** Every started km counts, and a trip always counts at least 1 km. */
export function kmCounted(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 1;
  // Strip float noise first so 2.0000000001 (a sum of decimals) stays 2.
  return Math.max(1, Math.ceil(Math.round(distanceKm * 1e6) / 1e6));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface TierBreakdown {
  /** The km that count (see kmCounted). */
  km: number;
  /** What each counted km adds, km 1 first. */
  amounts: number[];
  /** Sum of `amounts`. */
  sum: number;
  /** What is charged / paid: the sum, or the cap when it is lower. */
  total: number;
  /** True when the cap lowered the sum. */
  capped: boolean;
}

/** The tier formula for one trip. `tiers` must have at least one row (in km order). */
export function tierBreakdown(tiers: KmTier[], distanceKm: number, cap: number | null = null): TierBreakdown {
  const km = kmCounted(distanceKm);
  const n = tiers.length;
  const amounts = n ? Array.from({ length: km }, (_, i) => tiers[Math.min(i + 1, n) - 1].lkr) : [];
  const sum = round2(amounts.reduce((a, b) => a + b, 0));
  const capped = cap != null && sum > cap;
  return { km, amounts, sum, total: capped ? (cap as number) : sum, capped };
}

/** Just the amount: see tierBreakdown. */
export function tierTotal(tiers: KmTier[], distanceKm: number, cap: number | null = null): number {
  return tierBreakdown(tiers, distanceKm, cap).total;
}

/** 100 -> "100", 12.5 -> "12.50", 1500 -> "1,500" (whole amounts without decimals, else 2). */
export function tierAmountText(value: number): string {
  const whole = Number.isInteger(round2(value));
  return value.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/**
 * The editors' live example: "3 km = LKR 100 + 60 + 50 = LKR 210";
 * "1 km = LKR 100"; with a cap that bites: "5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310, capped at LKR 250".
 */
export function tierExampleText(tiers: KmTier[], km: number, cap: number | null = null): string {
  const b = tierBreakdown(tiers, km, cap);
  const head = `${b.km} km = LKR `;
  const parts = b.amounts.map(tierAmountText);
  const line = parts.length <= 1 ? `${head}${parts[0] ?? '0'}` : `${head}${parts.join(' + ')} = LKR ${tierAmountText(b.sum)}`;
  return b.capped ? `${line}, capped at LKR ${tierAmountText(b.total)}` : line;
}

/**
 * A one-line summary for "Now: ..." texts: one row reads "LKR 100 per km";
 * more read "km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50" (the last row repeats).
 */
export function tiersSummary(tiers: KmTier[]): string {
  if (tiers.length === 0) return 'no km amounts set';
  if (tiers.length === 1) return `LKR ${tierAmountText(tiers[0].lkr)} per km`;
  return tiers
    .map((t, i) => `km ${i + 1}${i === tiers.length - 1 ? '+' : ''} LKR ${tierAmountText(t.lkr)}`)
    .join(', ');
}

/** Tier rows as input texts: [{km:1, lkr:100}, {km:2, lkr:12.5}] -> ["100", "12.5"]. */
export function tiersToRows(tiers: KmTier[] | null | undefined): string[] {
  return [...(tiers ?? [])]
    .sort((a, b) => a.km - b.km)
    .map((t) => String(Number(t.lkr.toFixed(2))));
}

/**
 * Starting rows that pay what base + per km pays for whole km: km 1 = base
 * + per km, then per km (repeats). Used when switching to tiers with none
 * stored yet.
 */
export function linearToRows(base: number, perKm: number): string[] {
  const first = String(round2(base + perKm));
  return perKm === base + perKm ? [first] : [first, String(round2(perKm))];
}

/** One amount typed by staff: LKR 0..max, at most 2 decimals. */
export function parseTierAmount(raw: string, max = MAX_KM_TIER_LKR): { value: number } | { error: string } {
  const text = raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();
  if (!text) return { error: 'Enter an amount (0 is fine).' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 100 or 62.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimals.' };
  const value = Number(text);
  if (value > max) return { error: `Enter at most ${max.toLocaleString('en-US')}.` };
  return { value };
}

/**
 * The rows as the API's tiers (km = 1..n in order), or the first problem.
 * `rowErrors[i]` is the message for row i (for the editor's red rows).
 */
export function parseTierRows(
  rows: string[]
): { tiers: KmTier[] } | { error: string; rowErrors: (string | undefined)[] } {
  if (rows.length === 0) return { error: 'Add at least km 1.', rowErrors: [] };
  if (rows.length > MAX_KM_TIERS) return { error: `Use at most ${MAX_KM_TIERS} rows.`, rowErrors: [] };
  const rowErrors: (string | undefined)[] = [];
  const tiers: KmTier[] = [];
  rows.forEach((raw, i) => {
    const r = parseTierAmount(raw);
    if ('error' in r) rowErrors[i] = r.error;
    else tiers.push({ km: i + 1, lkr: r.value });
  });
  const first = rowErrors.findIndex((e) => e !== undefined);
  if (first >= 0) return { error: `km ${first + 1}: ${rowErrors[first]}`, rowErrors };
  return { tiers };
}

/** The rows when every one parses (for the live example), else null. */
export function tiersIfValid(rows: string[]): KmTier[] | null {
  const r = parseTierRows(rows);
  return 'tiers' in r ? r.tiers : null;
}

/** The delivery fee's optional cap: blank = no cap (null); else LKR 0..10000, 2 decimals. */
export function parseMaxFee(raw: string): { value: number | null } | { error: string } {
  if (!raw.trim()) return { value: null };
  return parseTierAmount(raw, MAX_FEE_CAP_LKR);
}
