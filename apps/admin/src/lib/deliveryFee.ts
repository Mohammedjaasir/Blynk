import { formatTierLkr } from './kmTiers';

/**
 * Client-side check for the delivery fee (mirrors the API: 0..1000 LKR, at
 * most 2 decimals). The API re-validates; this only saves a round trip.
 * Returns the parsed fee, or an error message for the operator.
 */
export function parseDeliveryFee(raw: string): { fee: number } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Enter a fee in LKR (0 for free delivery).' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 150 or 149.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const fee = Number(text);
  if (fee < 0 || fee > 1000) return { error: 'The fee must be between LKR 0 and LKR 1,000.' };
  return { fee };
}

/**
 * Free deliveries per new customer (owner, 2026-10-08): a whole number
 * 0..10, as PATCH /admin/settings/checkout accepts.
 */
export function parseFreeDeliveryCount(raw: string): { count: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { error: 'Enter a whole number from 0 to 10.' };
  const count = Number(text);
  if (count > 10) return { error: 'Enter a whole number from 0 to 10.' };
  return { count };
}

/**
 * Free delivery above a basket amount (owner, 2026-10-12): more than 0, up to
 * LKR 100,000, at most 2 decimals, as PATCH /admin/settings/checkout accepts.
 */
export function parseBasketAmount(raw: string): { amount: number } | { error: string } {
  const text = raw.trim().replace(/,/g, '');
  if (!text) return { error: 'Enter the basket amount in LKR, like 3000.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 3000 or 2999.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const amount = Number(text);
  if (amount <= 0 || amount > 100_000) return { error: 'The basket amount must be more than LKR 0 and at most LKR 100,000.' };
  return { amount };
}

/**
 * "Base + per km" delivery fee (owner, 2026-10-25), mirroring the API:
 *   fee = base_lkr                                          while distance <= base_km
 *   fee = base_lkr + per_km_lkr * ceil(distance - base_km)  beyond it (every STARTED km counts)
 * then the optional maximum fee. The distance is rounded to 2 decimals first and
 * a 1e-9 epsilon keeps float noise (3.1 - 0.1) from adding a whole extra km.
 * Defaults when the owner never saved them: LKR 120 for the first 2 km, LKR 40 per extra km.
 */
export const DEFAULT_BASE_LKR = 120;
export const DEFAULT_BASE_KM = 2;
export const DEFAULT_PER_KM_LKR = 40;

/** The distances the live preview table shows. */
export const BASE_PER_KM_EXAMPLE_KMS = [1.5, 2, 2.1, 3, 3.4, 4.8, 5.6];

export interface BasePerKmFormula {
  baseLkr: number;
  baseKm: number;
  perKmLkr: number;
}

const roundTo2 = (value: number) => Math.round(value * 100) / 100;

/** The fee for one trip; `capLkr` null/undefined = no maximum. */
export function basePerKmFee(distanceKm: number, formula: BasePerKmFormula, capLkr?: number | null): number {
  const km = roundTo2(Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0);
  const extra = km - formula.baseKm;
  const extraKm = extra <= 1e-9 ? 0 : Math.ceil(extra - 1e-9);
  const fee = roundTo2(formula.baseLkr + formula.perKmLkr * extraKm);
  return typeof capLkr === 'number' && capLkr >= 0 ? Math.min(fee, capLkr) : fee;
}

/** One preview row per example distance. */
export function basePerKmPreview(
  formula: BasePerKmFormula,
  capLkr?: number | null,
  distances: number[] = BASE_PER_KM_EXAMPLE_KMS
): { km: number; fee: number }[] {
  return distances.map((km) => ({ km, fee: basePerKmFee(km, formula, capLkr) }));
}

/** "LKR 120 up to 2 km, then LKR 40 for each extra km" (the customer app's cart says the same). */
export function basePerKmSummary(formula: BasePerKmFormula): string {
  return `LKR ${formatTierLkr(formula.baseLkr)} up to ${formula.baseKm} km, then LKR ${formatTierLkr(formula.perKmLkr)} for each extra km`;
}

const cleanNumber = (raw: string) => raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();

/** Base fee: 0..1000 LKR, at most 2 decimals, as PATCH /admin/settings/delivery-fee accepts. */
export function parseBaseFee(raw: string): { value: number } | { error: string } {
  const text = cleanNumber(raw);
  if (!text) return { error: 'Enter the base fee in LKR, like 120.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 120 or 119.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  if (value > 1000) return { error: 'The base fee must be between LKR 0 and LKR 1,000.' };
  return { value };
}

/** "Covers the first (km)": 0.5..20, at most 1 decimal. */
export function parseBaseKm(raw: string): { value: number } | { error: string } {
  const text = cleanNumber(raw);
  if (!text) return { error: 'Enter how many km the base fee covers, like 2.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 2 or 2.5.' };
  if (!/^\d+(\.\d)?$/.test(text)) return { error: 'Use at most 1 decimal place.' };
  const value = Number(text);
  if (value < 0.5 || value > 20) return { error: 'The base distance must be between 0.5 and 20 km.' };
  return { value };
}

/** Each extra started km: 0..1000 LKR, at most 2 decimals. */
export function parsePerKmFee(raw: string): { value: number } | { error: string } {
  const text = cleanNumber(raw);
  if (!text) return { error: 'Enter the fee for each extra km in LKR, like 40.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 40 or 37.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  if (value > 1000) return { error: 'The fee per extra km must be between LKR 0 and LKR 1,000.' };
  return { value };
}
