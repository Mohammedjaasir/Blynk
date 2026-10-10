import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { STORE_ZONE, rangeBounds, type DateRange } from './sales.service.js';
import { resolveDashboardRange, type DashboardRange } from './dashboard.service.js';

/**
 * Delivery heat map (owner, 2026-10-10): where orders come from, so the
 * owner can see busy areas and decide whether to stretch the service radius.
 *
 * Privacy: only aggregates leave the server - drop-off points are snapped
 * to a grid of CELL_DEG (~150 m) cells and counted. No names, phones,
 * addresses or order ids, and no exact coordinates (a cell's centre only).
 *
 * * Orders are those PLACED in the range (Asia/Colombo days), like the Sales
 *   report. status=delivered (default) counts DELIVERED orders only;
 *   status=all counts every order placed, whatever happened to it.
 * * revenue is total_amount of the cell's DELIVERED orders (the Sales report
 *   definition), whichever status filter is used.
 * * Distance is from the store hub (dark_stores lat/lng) to each order's own
 *   drop-off point (haversine, km). "Near the edge" = within EDGE_KM inside
 *   the radius; "outside" = beyond radius_km (older orders, or before the
 *   radius was changed).
 */
export type OrderMapRange = DashboardRange | 'last_30_days' | 'last_90_days';
export const ORDER_MAP_RANGES: OrderMapRange[] = ['today', 'yesterday', 'this_week', 'this_month', 'last_30_days', 'last_90_days'];

/** Grid cell size in degrees: 0.00135° of latitude ≈ 150 m (and ≈ 149 m of longitude near Colombo). */
export const CELL_DEG = 0.00135;
export const CELL_METERS = 150;
/** The band just inside the radius counted as "near the edge". */
export const EDGE_KM = 0.5;

export function resolveOrderMapRange(range: OrderMapRange, now: Date = new Date()): DateRange {
  if (range === 'last_30_days' || range === 'last_90_days') {
    const today = DateTime.fromJSDate(now).setZone(STORE_ZONE).startOf('day');
    const days = range === 'last_30_days' ? 29 : 89;
    return { from: today.minus({ days }).toISODate()!, to: today.toISODate()! };
  }
  return resolveDashboardRange(range, now).current;
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const round6 = (v: number) => Number(v.toFixed(6));

export async function orderMap(range: OrderMapRange, status: 'delivered' | 'all' = 'delivered', now: Date = new Date()) {
  const period = resolveOrderMapRange(range, now);
  const { start, end } = rangeBounds(period);
  const store = await db
    .selectFrom('dark_stores')
    .select(['id', 'name', 'latitude', 'longitude', 'radius_km'])
    .where('is_active', '=', true)
    .limit(1)
    .executeTakeFirst();
  if (!store) throw new AppError('No active dark store hub found.', 500, 'STORE_UNAVAILABLE');
  const hub = { lat: Number(store.latitude), lng: Number(store.longitude) };
  const radiusKm = Number(store.radius_km);

  const distanceKm = sql<number>`(2 * 6371 * asin(sqrt(
      power(sin(radians(delivery_latitude - ${hub.lat}) / 2), 2) +
      cos(radians(${hub.lat})) * cos(radians(delivery_latitude)) * power(sin(radians(delivery_longitude - ${hub.lng}) / 2), 2)
    )))`;

  let base = db
    .selectFrom('orders')
    .select([
      sql<number>`floor(delivery_latitude / ${CELL_DEG})::int`.as('cy'),
      sql<number>`floor(delivery_longitude / ${CELL_DEG})::int`.as('cx'),
      'order_status',
      'total_amount',
      'delivery_city',
      distanceKm.as('distance_km'),
    ])
    .where('dark_store_id', '=', store.id)
    .where('placed_at', '>=', start)
    .where('placed_at', '<', end);
  if (status === 'delivered') base = base.where('order_status', '=', 'DELIVERED');

  const cellsQ = db
    .selectFrom(base.as('o'))
    .select([
      'cy',
      'cx',
      sql<number>`count(*)::int`.as('orders'),
      sql<number>`(count(*) FILTER (WHERE order_status = 'DELIVERED'))::int`.as('delivered'),
      sql<string>`coalesce(sum(total_amount) FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('revenue'),
      // The town most of the cell's orders name (a place, not a person).
      sql<string | null>`mode() WITHIN GROUP (ORDER BY delivery_city)`.as('area'),
      sql<number>`avg(distance_km)`.as('distance_km'),
    ])
    .groupBy(['cy', 'cx'])
    .orderBy(sql`count(*)`, 'desc')
    .orderBy(sql`coalesce(sum(total_amount) FILTER (WHERE order_status = 'DELIVERED'), 0)`, 'desc')
    .orderBy('cy')
    .orderBy('cx')
    .execute();

  const totalsQ = db
    .selectFrom(base.as('o'))
    .select([
      sql<number>`count(*)::int`.as('orders'),
      sql<string>`coalesce(sum(total_amount) FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('revenue'),
      sql<number>`(count(*) FILTER (WHERE distance_km <= ${radiusKm - EDGE_KM}))::int`.as('inside'),
      sql<number>`(count(*) FILTER (WHERE distance_km > ${radiusKm - EDGE_KM} AND distance_km <= ${radiusKm}))::int`.as('near_edge'),
      sql<number>`(count(*) FILTER (WHERE distance_km > ${radiusKm}))::int`.as('outside'),
      sql<number | null>`max(distance_km)`.as('farthest_km'),
    ])
    .executeTakeFirstOrThrow();

  const [rows, totals] = await Promise.all([cellsQ, totalsQ]);
  const cells = rows.map((r) => {
    const lat = round6((r.cy + 0.5) * CELL_DEG);
    const lng = round6((r.cx + 0.5) * CELL_DEG);
    const d = Number(r.distance_km);
    return {
      lat,
      lng,
      orders: r.orders,
      delivered: r.delivered,
      revenue: money(r.revenue),
      area: r.area,
      distance_km: Number(d.toFixed(2)),
      zone: (d > radiusKm ? 'outside' : d > radiusKm - EDGE_KM ? 'near_edge' : 'inside') as 'inside' | 'near_edge' | 'outside',
    };
  });

  return {
    range,
    status,
    timezone: STORE_ZONE,
    period,
    cell_meters: CELL_METERS,
    cell_degrees: CELL_DEG,
    edge_km: EDGE_KM,
    store: { name: store.name, lat: hub.lat, lng: hub.lng, radius_km: radiusKm },
    totals: {
      orders: totals.orders,
      revenue: money(totals.revenue),
      inside: totals.inside,
      near_edge: totals.near_edge,
      outside: totals.outside,
      farthest_km: totals.farthest_km === null ? null : Number(Number(totals.farthest_km).toFixed(2)),
      cells: cells.length,
    },
    cells,
    busiest: cells.slice(0, 10),
  };
}
