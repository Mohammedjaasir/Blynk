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
 * Drop-off points are snapped to a grid of CELL_DEG (~150 m) cells and
 * counted. Owner, 2026-10-11 ("see number of order for the particular
 * location"): each cell is named by its most common address line (not just
 * the town, which is the same for nearly every cell), and orderMapCell()
 * lists the cell's addresses and orders with their counts. Staff only
 * (ADMIN and OPERATIONS): it carries customer names, phones and addresses,
 * and is never part of a customer-facing endpoint.
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
/** An order's address line, tidied (spaces collapsed), or null when blank. */
const addressKey = sql<string | null>`nullif(regexp_replace(trim(delivery_address_line1), '[[:space:]]+', ' ', 'g'), '')`;

/** A cell's id: its grid row and column, "cy:cx". */
export const cellKey = (cy: number, cx: number) => `${cy}:${cx}`;
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
      'delivery_address_line1',
      'customer_id',
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
      // The address line most of the cell's orders name - what tells one
      // cell from the next (owner, 2026-10-11).
      sql<string | null>`mode() WITHIN GROUP (ORDER BY ${addressKey})`.as('label'),
      sql<number>`count(DISTINCT ${addressKey})::int`.as('addresses'),
      sql<number>`count(DISTINCT customer_id)::int`.as('customers'),
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
      cell: cellKey(r.cy, r.cx),
      lat,
      lng,
      orders: r.orders,
      delivered: r.delivered,
      revenue: money(r.revenue),
      area: r.area,
      label: r.label,
      addresses: r.addresses,
      customers: r.customers,
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

/** Most orders one cell's list returns (the counts always cover every order). */
export const CELL_ORDERS_MAX = 200;

/**
 * GET /admin/reports/order-map/cell (ADMIN and OPERATIONS; owner,
 * 2026-10-11): one grid cell of the map - the addresses its orders went to,
 * each with its order count, and the orders themselves (newest first) with
 * the customer, recipient and address. Same range and status rules as
 * orderMap(). The cell is "cy:cx" from orderMap()'s `cell`.
 */
export async function orderMapCell(
  range: OrderMapRange,
  status: 'delivered' | 'all',
  cell: { cy: number; cx: number },
  now: Date = new Date()
) {
  const period = resolveOrderMapRange(range, now);
  const { start, end } = rangeBounds(period);
  const store = await db.selectFrom('dark_stores').select(['id']).where('is_active', '=', true).limit(1).executeTakeFirst();
  if (!store) throw new AppError('No active dark store hub found.', 500, 'STORE_UNAVAILABLE');

  let base = db
    .selectFrom('orders as o')
    .where('o.dark_store_id', '=', store.id)
    .where('o.placed_at', '>=', start)
    .where('o.placed_at', '<', end)
    .where(sql<boolean>`floor(o.delivery_latitude / ${CELL_DEG})::int = ${cell.cy}`)
    .where(sql<boolean>`floor(o.delivery_longitude / ${CELL_DEG})::int = ${cell.cx}`);
  if (status === 'delivered') base = base.where('o.order_status', '=', 'DELIVERED');

  const line = sql<string>`coalesce(nullif(regexp_replace(trim(o.delivery_address_line1), '[[:space:]]+', ' ', 'g'), ''), '')`;
  const line2 = sql<string>`coalesce(nullif(regexp_replace(trim(o.delivery_address_line2), '[[:space:]]+', ' ', 'g'), ''), '')`;

  const addressesQ = base
    .select([
      line.as('address_line1'),
      line2.as('address_line2'),
      'o.delivery_city as city',
      sql<number>`count(*)::int`.as('orders'),
      sql<number>`(count(*) FILTER (WHERE o.order_status = 'DELIVERED'))::int`.as('delivered'),
      sql<string>`coalesce(sum(o.total_amount) FILTER (WHERE o.order_status = 'DELIVERED'), 0)`.as('revenue'),
      sql<number>`count(DISTINCT o.customer_id)::int`.as('customers'),
      sql<Date>`max(o.placed_at)`.as('last_order_at'),
      sql<string>`avg(o.delivery_latitude)`.as('lat'),
      sql<string>`avg(o.delivery_longitude)`.as('lng'),
    ])
    .groupBy([line, line2, 'o.delivery_city'])
    .orderBy(sql`count(*)`, 'desc')
    .orderBy(sql`max(o.placed_at)`, 'desc')
    .execute();

  const ordersQ = base
    .leftJoin('users as u', 'u.id', 'o.customer_id')
    .select([
      'o.id',
      'o.order_number',
      'o.order_status',
      'o.total_amount',
      'o.placed_at',
      'o.customer_id',
      'u.full_name as customer_name',
      'u.phone as customer_phone',
      'o.delivery_recipient_name as recipient_name',
      'o.delivery_recipient_phone as recipient_phone',
      'o.delivery_address_line1 as address_line1',
      'o.delivery_address_line2 as address_line2',
      'o.delivery_city as city',
      'o.delivery_latitude as latitude',
      'o.delivery_longitude as longitude',
    ])
    .orderBy('o.placed_at', 'desc')
    .orderBy('o.id')
    .limit(CELL_ORDERS_MAX)
    .execute();

  const totalsQ = base
    .select([
      sql<number>`count(*)::int`.as('orders'),
      sql<number>`(count(*) FILTER (WHERE o.order_status = 'DELIVERED'))::int`.as('delivered'),
      sql<string>`coalesce(sum(o.total_amount) FILTER (WHERE o.order_status = 'DELIVERED'), 0)`.as('revenue'),
      sql<number>`count(DISTINCT o.customer_id)::int`.as('customers'),
    ])
    .executeTakeFirstOrThrow();

  const [addresses, orders, totals] = await Promise.all([addressesQ, ordersQ, totalsQ]);
  return {
    range,
    status,
    timezone: STORE_ZONE,
    period,
    cell: cellKey(cell.cy, cell.cx),
    lat: round6((cell.cy + 0.5) * CELL_DEG),
    lng: round6((cell.cx + 0.5) * CELL_DEG),
    totals: { orders: totals.orders, delivered: totals.delivered, revenue: money(totals.revenue), customers: totals.customers, addresses: addresses.length },
    addresses: addresses.map((a) => ({
      address_line1: a.address_line1,
      address_line2: a.address_line2 || null,
      city: a.city,
      orders: a.orders,
      delivered: a.delivered,
      revenue: money(a.revenue),
      customers: a.customers,
      last_order_at: a.last_order_at,
      lat: round6(Number(a.lat)),
      lng: round6(Number(a.lng)),
    })),
    orders: orders.map((o) => ({
      ...o,
      total_amount: money(o.total_amount),
      latitude: Number(o.latitude),
      longitude: Number(o.longitude),
    })),
    orders_shown: orders.length,
  };
}
