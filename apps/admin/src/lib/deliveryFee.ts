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
