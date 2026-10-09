import type { RiderPayType } from '../api/types';

/**
 * Rider pay helpers (owner, 2026-10-09): a COMPANY rider is salaried - no
 * per-delivery commission, Blynk keeps the delivery charge. A COMMISSION
 * rider earns a % of the STANDARD delivery fee (the store default, or their
 * own %) and keeps that share out of the COD cash they collect.
 */

export const PAY_TYPE_OPTIONS: { value: RiderPayType; label: string }[] = [
  { value: 'COMPANY', label: 'Company' },
  { value: 'COMMISSION', label: 'Commission' },
];

/** 80 -> "80%", 72.5 -> "72.5%", 66.67 -> "66.67%". */
export function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/**
 * "Company", or "Commission · 80%" - the rider's own % when set, otherwise
 * the store default when known (marked "default").
 */
export function payLabel(
  payType: RiderPayType | undefined,
  ownPercent: number | null | undefined,
  defaultPercent: number | null
): string {
  if (payType !== 'COMMISSION') return 'Company';
  if (ownPercent != null) return `Commission · ${formatPercent(ownPercent)}`;
  return defaultPercent != null ? `Commission · ${formatPercent(defaultPercent)} (default)` : 'Commission · default %';
}

/**
 * The optional own % typed for a commission rider: blank = the store
 * default (null); otherwise 0-100 with at most 2 decimals, as the API takes.
 */
export function parseOwnPercent(input: string): { value: number | null } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: null };
  return parseCommissionPercent(s);
}

/** A required % 0-100, at most 2 decimals (the default commission setting). */
export function parseCommissionPercent(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { error: 'Enter a percentage from 0 to 100.' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a number, like 80 or 72.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value > 100) return { error: 'The percentage can be at most 100.' };
  return { value };
}
