/** Delivery radius (owner, 2026-10-25): 0.5..50 km, at most 2 decimals, as PATCH /admin/settings/delivery-radius accepts. */
export const MIN_RADIUS_KM = 0.5;
export const MAX_RADIUS_KM = 50;

export function parseRadiusKm(raw: string): { km: number } | { error: string } {
  const text = raw.trim().replace(/\s*km$/i, '').trim();
  if (!text) return { error: 'Enter the radius in km, like 4 or 6.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 6 or 4.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const km = Number(text);
  if (km < MIN_RADIUS_KM || km > MAX_RADIUS_KM) {
    return { error: `The radius must be between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM} km.` };
  }
  return { km };
}
