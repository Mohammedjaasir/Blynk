import type { CheckoutSettings, DeliveryFeeSetting, SmallOrderFeeSetting } from '../api/types';
import { parseAmount } from './riderPay';
import { tierAmountText } from './kmTiers';

/**
 * Delivery fee "base + per km", small-order fee and delivery radius
 * (2026-10-25, docs/superpowers/plans/2026-10-25-fees.md). The server works
 * the real amounts out; the formula here is for the live preview and the
 * client-side checks only. Every limit mirrors the API, which re-checks it.
 */

/** The API's defaults for a store that never saved Base + per km. */
export const BASE_PER_KM_DEFAULTS = { base_lkr: 120, base_km: 2, per_km_lkr: 40 } as const;

export interface BasePerKm {
  base_lkr: number;
  base_km: number;
  per_km_lkr: number;
}

/** The trip lengths the live preview shows. */
export const PREVIEW_DISTANCES: readonly number[] = [1.5, 2, 2.1, 3, 3.4, 4.8, 5.6];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The fee for one trip: `base_lkr` while distance <= base_km, then
 * `per_km_lkr` for every STARTED km beyond it (`ceil(distance - base_km)`),
 * then the optional cap. The distance is rounded to 2 decimals first and a
 * 1e-9 epsilon keeps 3.0 - 2 from becoming 2 through float noise.
 * 1.5 -> 120, 2.0 -> 120, 2.1 -> 160, 3.0 -> 160, 3.4 -> 200 (base 120, 2 km, 40).
 */
export function basePerKmFee(distanceKm: number, f: BasePerKm, cap: number | null = null): number {
  const d = round2(Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0);
  const over = d - f.base_km;
  const extraKm = over <= 1e-9 ? 0 : Math.ceil(over - 1e-9);
  const fee = round2(f.base_lkr + f.per_km_lkr * extraKm);
  return cap != null && fee > cap ? cap : fee;
}

/** One preview row: the trip length and what the customer pays. */
export function basePerKmPreview(f: BasePerKm, cap: number | null = null): Array<{ km: number; fee: number }> {
  return PREVIEW_DISTANCES.map((km) => ({ km, fee: basePerKmFee(km, f, cap) }));
}

/** "LKR 120 up to 2 km, then LKR 40 for each extra km" (+ " · max LKR 250" with a cap). */
export function basePerKmText(f: BasePerKm, cap: number | null = null): string {
  const text = `LKR ${tierAmountText(f.base_lkr)} up to ${Number(f.base_km)} km, then LKR ${tierAmountText(f.per_km_lkr)} for each extra km`;
  return cap != null ? `${text} · max LKR ${tierAmountText(cap)}` : text;
}

/** The stored values, or the API's defaults for any the (older) API left out. */
export function basePerKmOf(fee: Pick<DeliveryFeeSetting, 'base_lkr' | 'base_km' | 'per_km_lkr'>): BasePerKm {
  return {
    base_lkr: fee.base_lkr ?? BASE_PER_KM_DEFAULTS.base_lkr,
    base_km: fee.base_km ?? BASE_PER_KM_DEFAULTS.base_km,
    per_km_lkr: fee.per_km_lkr ?? BASE_PER_KM_DEFAULTS.per_km_lkr,
  };
}

export const MAX_BASE_LKR = 1_000;
export const MIN_BASE_KM = 0.5;
export const MAX_BASE_KM = 20;

/** "Base fee (LKR)": 0..1000, at most 2 decimals. */
export function parseBaseLkr(raw: string): { value: number } | { error: string } {
  const r = parseAmount(raw, { max: MAX_BASE_LKR, what: 'the base fee in LKR, like 120' });
  return 'error' in r ? { error: `Base fee: ${r.error}` } : { value: r.value as number };
}

/** "Covers the first (km)": 0.5..20, at most 1 decimal. */
export function parseBaseKm(raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(/\s*km$/i, '');
  const r = parseAmount(text, { min: MIN_BASE_KM, max: MAX_BASE_KM, decimals: 1, what: 'how many km the base fee covers, like 2' });
  return 'error' in r ? { error: `Covers the first km: ${r.error}` } : { value: r.value as number };
}

/** "Then for each extra started km (LKR)": 0..1000, at most 2 decimals. */
export function parsePerKmLkr(raw: string): { value: number } | { error: string } {
  const r = parseAmount(raw, { max: MAX_BASE_LKR, what: 'the amount for each extra km in LKR, like 40' });
  return 'error' in r ? { error: `Each extra km: ${r.error}` } : { value: r.value as number };
}

/** The three typed fields as numbers, or the first problem. */
export function parseBasePerKm(draft: { base: string; baseKm: string; perKm: string }): { value: BasePerKm } | { error: string } {
  const base = parseBaseLkr(draft.base);
  if ('error' in base) return base;
  const km = parseBaseKm(draft.baseKm);
  if ('error' in km) return km;
  const per = parsePerKmLkr(draft.perKm);
  if ('error' in per) return per;
  return { value: { base_lkr: base.value, base_km: km.value, per_km_lkr: per.value } };
}

// ------------------------------------------------------- small-order fee

export const SMALL_ORDER_DEFAULTS: SmallOrderFeeSetting = { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 };
export const MAX_SMALL_ORDER_MIN_LKR = 100_000;
export const MAX_SMALL_ORDER_FEE_LKR = 1_000;

/** "Item total under (LKR)": 1..100000, at most 2 decimals. */
export function parseSmallOrderMin(raw: string): { value: number } | { error: string } {
  const r = parseAmount(raw, { min: 1, max: MAX_SMALL_ORDER_MIN_LKR, what: 'the item total in LKR, like 1000' });
  return 'error' in r ? { error: `Item total under: ${r.error}` } : { value: r.value as number };
}

/** "Fee (LKR)": 0.01..1000, at most 2 decimals. */
export function parseSmallOrderFeeLkr(raw: string): { value: number } | { error: string } {
  const r = parseAmount(raw, { min: 0, positive: true, max: MAX_SMALL_ORDER_FEE_LKR, what: 'the fee in LKR, like 50' });
  return 'error' in r ? { error: `Fee: ${r.error}` } : { value: r.value as number };
}

/** The stored small-order fee, or the API's defaults (off, 1000, 50) when it is absent. */
export function smallOrderFeeOf(s: Pick<CheckoutSettings, 'small_order_fee'> | null | undefined): SmallOrderFeeSetting {
  return s?.small_order_fee ?? SMALL_ORDER_DEFAULTS;
}

/** The body for PATCH /admin/settings/checkout, or the first problem with what was typed. */
export function smallOrderFeeBody(draft: {
  enabled: boolean;
  min: string;
  fee: string;
}): { small_order_fee: SmallOrderFeeSetting } | { error: string } {
  const min = parseSmallOrderMin(draft.min);
  if ('error' in min) return min;
  const fee = parseSmallOrderFeeLkr(draft.fee);
  if ('error' in fee) return fee;
  return { small_order_fee: { enabled: draft.enabled, min_subtotal_lkr: min.value, fee_lkr: fee.value } };
}

/** "Customers whose items total under LKR 1,000 pay LKR 50 on top of delivery." */
export function smallOrderFeeSummary(s: SmallOrderFeeSetting): string {
  return `Customers whose items total under LKR ${tierAmountText(s.min_subtotal_lkr)} pay LKR ${tierAmountText(s.fee_lkr)} on top of delivery.`;
}

// ------------------------------------------------------- free delivery wording

/** "Free delivery when the item total is at least LKR 3,000." - X from the typed amount, else a pointer to the field. */
export function basketFreeDeliveryText(amountText: string): string {
  const n = Number(amountText.trim().replace(/,/g, ''));
  const x = amountText.trim() && Number.isFinite(n) && n > 0 ? `LKR ${tierAmountText(n)}` : 'the amount below';
  return `Free delivery when the item total is at least ${x}.`;
}

// ------------------------------------------------------- delivery radius

export const MIN_RADIUS_KM = 0.5;
export const MAX_RADIUS_KM = 50;

/** Delivery radius in km: 0.5..50, at most 2 decimals. */
export function parseRadiusKm(raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(/\s*km$/i, '');
  const r = parseAmount(text, { min: MIN_RADIUS_KM, max: MAX_RADIUS_KM, what: 'the delivery radius in km, like 4' });
  return 'error' in r ? { error: `Delivery radius: ${r.error}` } : { value: r.value as number };
}
