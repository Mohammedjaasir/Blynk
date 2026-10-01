import type { RiderOption, RiderSuggestion, RiderSuggestions } from '../api/types';

/**
 * Words for the assign-rider dialog's rider rows (backend rider trips,
 * 2026-09-30). The backend ranks and decides; this only phrases it.
 */

export const riderName = (r: Pick<RiderOption, 'full_name' | 'phone'>) => r.full_name?.trim() || r.phone;
const firstName = (r: Pick<RiderOption, 'full_name' | 'phone'>) => riderName(r).split(/\s+/)[0];

/** "about 1.2 km away" from their last GPS point, or "location unknown". */
export function distanceText(r: Pick<RiderSuggestion, 'location_known' | 'distance_km'>): string {
  if (!r.location_known || r.distance_km === null) return 'location unknown';
  return r.distance_km < 0.1 ? 'at the store' : `about ${r.distance_km.toFixed(1)} km away`;
}

export function loadText(openDeliveries: number): string {
  if (openDeliveries === 0) return 'No open deliveries';
  return `${openDeliveries} open ${openDeliveries === 1 ? 'delivery' : 'deliveries'}`;
}

/** How far the furthest of the rider's existing drop-offs is from this order's, in km (null: unknown). */
export function farthestDropoffKm(r: Pick<RiderSuggestion, 'trip'>): number | null {
  const known = r.trip.map((t) => t.dropoff_distance_km).filter((km): km is number => km !== null);
  return known.length === r.trip.length && known.length > 0 ? Math.max(...known) : null;
}

/**
 * For a rider who already carries an order: "Add to Farhan's trip (0.7 km
 * from their other drop-off)". `far` when staff must confirm the longer trip.
 */
export function tripText(r: RiderSuggestion, maxKm: number): { text: string; far: boolean } | null {
  if (r.trip.length === 0 || r.at_capacity) return null;
  const km = farthestDropoffKm(r);
  const other = r.trip.length === 1 ? 'their other drop-off' : 'their other drop-offs';
  const name = firstName(r);
  if (km === null) return { text: `Add to ${name}'s trip (distance from ${other} unknown)`, far: true };
  const far = !r.trip_within_distance;
  return {
    text: `Add to ${name}'s trip (${km.toFixed(1)} km from ${other}${far ? `, more than ${maxKm} km` : ''})`,
    far,
  };
}

/** The plain roster as suggestion rows, when the suggestions endpoint cannot be reached. */
export function fromRoster(list: RiderOption[]): RiderSuggestions {
  return {
    order_id: '',
    rules: { max_active_deliveries: Number.POSITIVE_INFINITY, max_dropoff_distance_km: Number.POSITIVE_INFINITY, location_fresh_minutes: 15 },
    riders: list.map((r) => ({
      ...r,
      at_capacity: false,
      last_seen_at: null,
      location_known: false,
      distance_km: null,
      trip: [],
      trip_within_distance: true,
      suggested: false,
    })),
  };
}
