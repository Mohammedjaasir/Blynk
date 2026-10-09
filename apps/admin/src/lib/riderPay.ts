import type { RiderPayType } from '../api/types';

/**
 * Rider pay (owner, 2026-10-09). Riders are one of two types once approved:
 * a COMPANY rider is salaried (no per-delivery commission; Blynk keeps the
 * delivery charge) and a COMMISSION rider earns a % of the STANDARD delivery
 * fee - the store default, or the rider's own override - and keeps that
 * share out of the COD cash they collect.
 */

export const PAY_TYPE_LABEL: Record<RiderPayType, string> = {
  COMPANY: 'Company',
  COMMISSION: 'Commission',
};

/** 80 -> "80", 72.5 -> "72.5", 66.666 -> "66.67". */
export const formatPercent = (value: number) => String(Number(value.toFixed(2)));

/**
 * "Company", "Commission · 75%" (own %), or "Commission · 80% (default)".
 * `defaultPercent` may be unknown (the setting did not load).
 */
export function payLabel(
  payType: RiderPayType | undefined,
  ownPercent: number | null | undefined,
  defaultPercent?: number | null
): string {
  if (payType !== 'COMMISSION') return PAY_TYPE_LABEL.COMPANY;
  if (typeof ownPercent === 'number') return `Commission · ${formatPercent(ownPercent)}%`;
  if (typeof defaultPercent === 'number') return `Commission · ${formatPercent(defaultPercent)}% (default)`;
  return 'Commission · default %';
}

/**
 * A commission % as the API accepts it: 0..100, at most 2 decimals. With
 * `optional`, blank means "use the store default" (null).
 */
export function parsePercent(raw: string, optional = false): { percent: number | null } | { error: string } {
  const text = raw.trim().replace(/%$/, '').trim();
  if (!text) return optional ? { percent: null } : { error: 'Enter a percentage from 0 to 100.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 80 or 72.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const percent = Number(text);
  if (percent > 100) return { error: 'Enter a percentage from 0 to 100.' };
  return { percent };
}
