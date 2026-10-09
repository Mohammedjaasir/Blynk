/**
 * Which `deliveries` columns an API response may carry.
 *
 * The rider's live position (migration 006) reaches exactly one consumer: the
 * order's own customer, through the SSE stream (`findTrackableLocationForCustomer`)
 * - plan §D.6 has no admin, staff or rider location surface in this phase.
 * The same customer also gets the road route that STARTS at that position
 * (GET /orders/:id/route, owner 2026-10-10) - same owner check, same
 * trackable window, and it never returns these column names. The
 * rider's write (`RiderRepository.writeLocation`) names the location columns
 * itself.
 *
 * Every other query that returns a delivery row selects DELIVERY_PUBLIC_COLUMNS
 * (an allow-list, never `selectAll`), and anything that receives a whole row
 * from the lifecycle engine passes it through `toPublicDelivery`. A column added
 * to `deliveries` is therefore private until someone adds it here, and
 * tests/delivery-payload-privacy.test.ts fails until every column is classified.
 */

/** Columns that identify where a rider is; dedicated paths only. */
export const DELIVERY_LOCATION_COLUMNS = [
  'current_latitude',
  'current_longitude',
  'location_accuracy_m',
  'location_captured_at',
  'location_received_at',
] as const;

/**
 * Rider pay snapshot written at settlement (migration 032; owner,
 * 2026-10-09). Private: read only by the earnings report and cash
 * reconciliation queries, never returned on a delivery payload.
 */
export const DELIVERY_PAY_COLUMNS = ['rider_pay_type', 'rider_commission_percent', 'rider_earning_lkr'] as const;

/** Columns safe to return to staff (admin/packing) and, after sanitising, customers. */
export const DELIVERY_PUBLIC_COLUMNS = [
  'id',
  'order_id',
  'rider_id',
  'assignment_status',
  'cod_collected_amount',
  'handover_notes',
  'assigned_at',
  'accepted_at',
  'picked_up_at',
  'delivered_at',
  'failed_at',
  'failure_reason',
  'created_at',
  'updated_at',
] as const;

/** Qualified for a join: `deliveries.id`, ... */
export const DELIVERY_PUBLIC_SELECT = DELIVERY_PUBLIC_COLUMNS.map((c) => `deliveries.${c}` as const);

/** An allow-list copy of a delivery row: only public columns survive. */
export function toPublicDelivery<T extends Record<string, unknown>>(row: T) {
  const out: Record<string, unknown> = {};
  for (const col of DELIVERY_PUBLIC_COLUMNS) if (col in row) out[col] = row[col];
  return out as Pick<T, Extract<(typeof DELIVERY_PUBLIC_COLUMNS)[number], keyof T>>;
}
