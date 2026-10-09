/**
 * Rider trips (owner, 2026-10-10: "ops can control the 2 orders for one
 * delivery if it's in the same route"). The limits mirror the API
 * (PATCH /admin/settings/rider-trips), which re-checks them.
 */
export const TRIP_ORDER_CHOICES = [1, 2, 3, 4, 5] as const;
export const MIN_DROPOFF_KM = 0.5;
export const MAX_DROPOFF_KM = 10;

/** The distance the API accepts: 0.5-10 km, at most 1 decimal. */
export function parseDropoffKm(input: string): { value: number } | { error: string } {
  const text = input.trim().replace(/\s*km$/i, '');
  if (text === '') return { error: 'Enter a distance in km.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a distance like 1.5.' };
  const value = Number(text);
  if (value < MIN_DROPOFF_KM || value > MAX_DROPOFF_KM) {
    return { error: `Enter a distance from ${MIN_DROPOFF_KM} to ${MAX_DROPOFF_KM} km.` };
  }
  if (!/^\d+(\.\d)?$/.test(text)) return { error: 'Use at most 1 decimal, e.g. 1.5.' };
  return { value };
}

/** "1 order (no trips)", "2 orders". */
export const tripOrdersLabel = (n: number) => (n === 1 ? '1 order (no trips)' : `${n} orders`);

/** "1.5 km". */
export const formatKm = (km: number) => `${Number(km.toFixed(1))} km`;
