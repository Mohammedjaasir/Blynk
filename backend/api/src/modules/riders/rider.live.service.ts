import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { orderRepository } from '../orders/order.repository.js';
import { riderAutoAssignService, type RiderAutoAssignSetting } from '../configuration/rider-auto-assign.js';
import { findOpenDeliveriesForRiders, getBatchingRules, toPoint, type BatchingRules } from './batching.js';
import { riderRepository } from './rider.repository.js';

/**
 * GET /admin/riders/live (ADMIN, OPERATIONS): the data behind the Rider map in Admin and Ops.
 *
 * "On duty" here means what the rest of the staff screens mean by it: an approved rider whose profile
 * and account are active (GET /admin/riders). Nothing maintains a clock-in flag, and a rider's position
 * exists only while a delivery is on the road (the Rider app reports it for a PICKED_UP delivery), so a
 * rider with no recent delivery has `position: null`. Staff already see these riders' names, phones and
 * load in the assign dialog, and every order's drop-off in the order screens; this adds their last
 * reported point, which staff could not see before (owner, 2026-10-25), to those two roles only.
 */
export type RiderLiveState = 'FREE' | 'ON_TRIP';

export interface LiveRiderDelivery {
  order_id: string;
  order_number: string;
  assignment_status: string;
  dropoff: { lat: number; lng: number } | null;
}

export interface LiveRider {
  id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  status: RiderLiveState;
  open_deliveries: number;
  /** How many more orders the rider may take before the trip cap. */
  capacity_left: number;
  /** Last reported point; null when the rider has never reported one. */
  position: { lat: number; lng: number; accuracy_m: number | null; captured_at: string; age_seconds: number } | null;
  deliveries: LiveRiderDelivery[];
}

export interface LiveUnassignedOrder {
  order_id: string;
  order_number: string;
  order_status: string;
  /** Seconds since the order was packed (how long it has waited for a rider). */
  waiting_seconds: number;
  address: string;
  dropoff: { lat: number; lng: number } | null;
}

export interface LiveRiderMap {
  server_time: string;
  store: { lat: number; lng: number; radius_km: number } | null;
  rules: Pick<BatchingRules, 'max_active_deliveries' | 'max_dropoff_distance_km'>;
  auto_assign: Pick<RiderAutoAssignSetting, 'enabled' | 'wait_seconds' | 'max_distance_km'>;
  riders: LiveRider[];
  unassigned_orders: LiveUnassignedOrder[];
}

export async function getLiveRiderMap(now: Date = new Date()): Promise<LiveRiderMap> {
  const [store, rules, auto, riders] = await Promise.all([
    orderRepository.findActiveDarkStore(),
    getBatchingRules(),
    riderAutoAssignService.read(),
    riderRepository.listActiveRidersForAssignment(),
  ]);
  const ids = riders.map((r) => r.id);
  const [points, open, waiting] = await Promise.all([
    riderRepository.findLastKnownPoints(ids),
    findOpenDeliveriesForRiders(ids),
    findWaitingOrders(),
  ]);
  const pointOf = new Map(points.map((p) => [p.rider_id, p]));

  const out: LiveRider[] = riders.map((r) => {
    const mine = open.filter((d) => d.rider_id === r.id);
    const last = pointOf.get(r.id);
    const at = last ? toPoint(last.current_latitude, last.current_longitude) : null;
    const captured = last?.location_captured_at ?? null;
    return {
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      vehicle_type: r.vehicle_type,
      status: mine.length > 0 ? 'ON_TRIP' : 'FREE',
      open_deliveries: mine.length,
      capacity_left: Math.max(0, rules.max_active_deliveries - mine.length),
      position:
        at && captured
          ? {
              lat: at.lat,
              lng: at.lng,
              accuracy_m: last?.location_accuracy_m == null ? null : Number(last.location_accuracy_m),
              captured_at: captured.toISOString(),
              age_seconds: Math.max(0, Math.round((now.getTime() - captured.getTime()) / 1000)),
            }
          : null,
      deliveries: mine.map((d) => ({
        order_id: d.order_id,
        order_number: d.order_number,
        assignment_status: d.assignment_status,
        dropoff: d.dropoff,
      })),
    };
  });
  // Free riders first, then by name, so the list reads "who can take an order" top down.
  out.sort(
    (a, b) =>
      Number(a.status === 'ON_TRIP') - Number(b.status === 'ON_TRIP') ||
      (a.full_name ?? a.phone ?? '').localeCompare(b.full_name ?? b.phone ?? '')
  );

  const storePoint = store ? toPoint(store.latitude, store.longitude) : null;
  return {
    server_time: now.toISOString(),
    store: storePoint ? { ...storePoint, radius_km: Number(store!.radius_km) } : null,
    rules: { max_active_deliveries: rules.max_active_deliveries, max_dropoff_distance_km: rules.max_dropoff_distance_km },
    auto_assign: { enabled: auto.enabled, wait_seconds: auto.wait_seconds, max_distance_km: auto.max_distance_km },
    riders: out,
    unassigned_orders: waiting.map((o) => ({
      order_id: o.id,
      order_number: o.order_number,
      order_status: o.order_status,
      waiting_seconds: Math.max(0, Math.round((now.getTime() - new Date(o.packed_at).getTime()) / 1000)),
      address: [o.delivery_address_line1, o.delivery_city].filter(Boolean).join(', '),
      dropoff: toPoint(o.delivery_latitude, o.delivery_longitude),
    })),
  };
}

/** Orders that need a rider now: packed, and no rider holds them (a cancelled order's left-over row holds nothing). */
async function findWaitingOrders() {
  const { rows } = await sql<{
    id: string;
    order_number: string;
    order_status: string;
    delivery_address_line1: string;
    delivery_city: string;
    delivery_latitude: unknown;
    delivery_longitude: unknown;
    packed_at: Date;
  }>`
    SELECT o.id, o.order_number, o.order_status, o.delivery_address_line1, o.delivery_city,
           o.delivery_latitude, o.delivery_longitude,
           COALESCE(
             (SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.new_status = 'PACKED'),
             o.updated_at
           ) AS packed_at
      FROM orders o
     WHERE o.order_status = 'PACKED'
       AND NOT EXISTS (
         SELECT 1 FROM deliveries d
          WHERE d.order_id = o.id AND d.assignment_status IN ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER')
       )
     ORDER BY packed_at ASC, o.id ASC
     LIMIT 100`.execute(db);
  return rows;
}
