import { AppError } from '../../middleware/error.middleware.js';
import { riderRepository } from './rider.repository.js';
import {
  LOCATION_FRESH_MINUTES,
  distanceKm,
  findOpenDeliveriesForRiders,
  getBatchingRules,
  roundKm,
  toPoint,
  type BatchingRules,
} from './batching.js';

/** One stop the rider already holds, as the assign dialog shows it. */
export interface TripStop {
  order_id: string;
  order_number: string;
  assignment_status: string;
  /** Straight line between that drop-off and this order's; null when a pin is missing. */
  dropoff_distance_km: number | null;
}

export interface RiderSuggestion {
  id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string | null;
  open_deliveries: number;
  /** Holding as many open deliveries as a trip may carry: cannot take this order. */
  at_capacity: boolean;
  /** When the rider's last GPS point was captured, however old; null if never. */
  last_seen_at: string | null;
  /** The last point is recent enough (LOCATION_FRESH_MINUTES) to be trusted. */
  location_known: boolean;
  /** Straight line from the last point to the store, only when location_known. */
  distance_km: number | null;
  /** The orders this rider already carries (a second order joins their trip). */
  trip: TripStop[];
  /** Every existing drop-off is within the batching distance of this one. */
  trip_within_distance: boolean;
  suggested: boolean;
}

export interface RiderSuggestions {
  order_id: string;
  rules: BatchingRules & { location_fresh_minutes: number };
  riders: RiderSuggestion[];
}

/**
 * GET /admin/riders/suggestions?order_id= (ADMIN, OPERATIONS): the active
 * riders the assign dialog lists, best first.
 *
 *   1. riders who can still take an order (below the trip cap) before those
 *      who cannot;
 *   2. fewest open deliveries first (a free rider first);
 *   3. nearest to the store by their last GPS point (straight line), riders
 *      whose last point is older than 15 minutes, or who have none, after;
 *   4. then by name.
 *
 * The first rider who can take the order without a confirmation (below the
 * cap, and any trip within the batching distance) is `suggested`. Only
 * distances and a timestamp leave the server - never a rider's coordinates -
 * so what staff learn about riders is what GET /admin/riders already shows.
 */
export async function suggestRidersForOrder(orderId: string, now: Date = new Date()): Promise<RiderSuggestions> {
  const order = await riderRepository.findOrderDispatchPoints(orderId);
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  const store = toPoint(order.store_latitude, order.store_longitude);
  const dropoff = toPoint(order.delivery_latitude, order.delivery_longitude);

  const [rules, riders] = await Promise.all([getBatchingRules(), riderRepository.listActiveRidersForAssignment()]);
  const ids = riders.map((r) => r.id);
  const [points, open] = await Promise.all([
    riderRepository.findLastKnownPoints(ids),
    findOpenDeliveriesForRiders(ids),
  ]);
  const pointOf = new Map(points.map((p) => [p.rider_id, p]));
  const freshAfter = now.getTime() - LOCATION_FRESH_MINUTES * 60_000;

  const rows: RiderSuggestion[] = riders.map((r) => {
    const last = pointOf.get(r.id);
    const seenAt = last?.location_captured_at ?? null;
    const at = last ? toPoint(last.current_latitude, last.current_longitude) : null;
    const fresh = seenAt !== null && at !== null && seenAt.getTime() >= freshAfter;
    const trip = open
      .filter((d) => d.rider_id === r.id && d.order_id !== orderId)
      .map((d) => ({
        order_id: d.order_id,
        order_number: d.order_number,
        assignment_status: d.assignment_status,
        dropoff_distance_km: dropoff && d.dropoff ? roundKm(distanceKm(dropoff, d.dropoff)) : null,
      }));
    const openCount = Number(r.open_deliveries);
    return {
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      vehicle_type: r.vehicle_type,
      vehicle_registration_number: r.vehicle_registration_number,
      open_deliveries: openCount,
      at_capacity: openCount >= rules.max_active_deliveries,
      last_seen_at: seenAt ? seenAt.toISOString() : null,
      location_known: fresh,
      distance_km: fresh && store ? roundKm(distanceKm(at!, store)) : null,
      trip,
      trip_within_distance: trip.every(
        (t) => t.dropoff_distance_km !== null && t.dropoff_distance_km <= rules.max_dropoff_distance_km
      ),
      suggested: false,
    };
  });

  rows.sort(compareSuggestions);
  const best = rows.find((r) => !r.at_capacity && r.trip_within_distance);
  if (best) best.suggested = true;

  return { order_id: orderId, rules: { ...rules, location_fresh_minutes: LOCATION_FRESH_MINUTES }, riders: rows };
}

export function compareSuggestions(a: RiderSuggestion, b: RiderSuggestion): number {
  if (a.at_capacity !== b.at_capacity) return a.at_capacity ? 1 : -1;
  if (a.open_deliveries !== b.open_deliveries) return a.open_deliveries - b.open_deliveries;
  const da = a.distance_km ?? Number.POSITIVE_INFINITY;
  const db = b.distance_km ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return (a.full_name ?? a.phone ?? '').localeCompare(b.full_name ?? b.phone ?? '');
}
