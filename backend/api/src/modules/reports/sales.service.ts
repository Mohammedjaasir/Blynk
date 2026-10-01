import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { db } from '../../database/connection.js';

/** The store's business day (business rules §4). */
export const STORE_ZONE = 'Asia/Colombo';

export type SalesRangePreset = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days';

/** Inclusive Asia/Colombo calendar dates, YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * A preset as Colombo calendar dates. "Last 7 days" is today and the six
 * days before it (so it includes today), likewise "last 30 days".
 */
export function resolveSalesRange(preset: SalesRangePreset, now: Date = new Date()): DateRange {
  const today = DateTime.fromJSDate(now).setZone(STORE_ZONE).startOf('day');
  const iso = (d: DateTime) => d.toISODate()!;
  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case 'yesterday': {
      const y = today.minus({ days: 1 });
      return { from: iso(y), to: iso(y) };
    }
    case 'last_7_days':
      return { from: iso(today.minus({ days: 6 })), to: iso(today) };
    case 'last_30_days':
      return { from: iso(today.minus({ days: 29 })), to: iso(today) };
  }
}

/** [start, end) instants for inclusive Colombo dates: midnight of `from` to midnight after `to`. */
export function rangeBounds(range: DateRange): { start: Date; end: Date } {
  const start = DateTime.fromISO(range.from, { zone: STORE_ZONE }).startOf('day');
  const end = DateTime.fromISO(range.to, { zone: STORE_ZONE }).startOf('day').plus({ days: 1 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

/**
 * The Admin sales dashboard. Every figure is over orders PLACED in the range
 * (Asia/Colombo days), so one order is counted in one place:
 *
 * * order_count: every order placed, whatever its status.
 * * delivered_revenue: the total (what the rider collected) of those now DELIVERED.
 * * average_basket: delivered_revenue / delivered orders.
 * * cancelled_count, discount_given and delivery_fees (the last two over
 *   DELIVERED orders - money actually given up / charged).
 * * top products: DELIVERED orders' lines, minus lines the store removed.
 * * orders_by_hour: all orders placed, by Colombo hour 0-23.
 */
export async function salesReport(range: DateRange) {
  const { start, end } = rangeBounds(range);

  const summaryQ = db
    .selectFrom('orders')
    .select([
      sql<number>`count(*)::int`.as('order_count'),
      sql<number>`(count(*) FILTER (WHERE order_status = 'DELIVERED'))::int`.as('delivered_count'),
      sql<number>`(count(*) FILTER (WHERE order_status = 'CANCELLED'))::int`.as('cancelled_count'),
      sql<string>`coalesce(sum(total_amount) FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('delivered_revenue'),
      sql<string>`coalesce(sum(discount_amount) FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('discount_given'),
      sql<string>`coalesce(sum(delivery_fee) FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('delivery_fees'),
    ])
    .where('placed_at', '>=', start)
    .where('placed_at', '<', end)
    .executeTakeFirstOrThrow();

  const hoursQ = db
    .selectFrom('orders')
    .select([
      sql<number>`extract(hour FROM placed_at AT TIME ZONE ${sql.lit(STORE_ZONE)})::int`.as('hour'),
      sql<number>`count(*)::int`.as('orders'),
    ])
    .where('placed_at', '>=', start)
    .where('placed_at', '<', end)
    .groupBy(sql`1`)
    .execute();

  const topProducts = (by: 'quantity' | 'revenue') =>
    db
      .selectFrom('order_items as i')
      .innerJoin('orders as o', 'o.id', 'i.order_id')
      .select([
        'i.product_id',
        sql<string>`max(i.product_name_snapshot)`.as('name'),
        sql<number>`sum(i.quantity)::int`.as('quantity'),
        sql<string>`sum(i.subtotal)`.as('revenue'),
      ])
      .where('o.placed_at', '>=', start)
      .where('o.placed_at', '<', end)
      .where('o.order_status', '=', 'DELIVERED')
      .where('i.item_status', '!=', 'UNAVAILABLE')
      .groupBy('i.product_id')
      .orderBy(by === 'quantity' ? sql`sum(i.quantity)` : sql`sum(i.subtotal)`, 'desc')
      .orderBy(by === 'quantity' ? sql`sum(i.subtotal)` : sql`sum(i.quantity)`, 'desc')
      .orderBy(sql`max(i.product_name_snapshot)`)
      .limit(10)
      .execute();

  const [summary, hours, byQuantity, byRevenue] = await Promise.all([
    summaryQ,
    hoursQ,
    topProducts('quantity'),
    topProducts('revenue'),
  ]);

  const revenue = money(summary.delivered_revenue);
  const line = (p: { product_id: string; name: string; quantity: number; revenue: string }) => ({
    product_id: p.product_id,
    name: p.name,
    quantity: p.quantity,
    revenue: money(p.revenue),
  });
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hours.find((h) => h.hour === hour)?.orders ?? 0 }));

  return {
    range: { ...range, timezone: STORE_ZONE },
    order_count: summary.order_count,
    delivered_count: summary.delivered_count,
    delivered_revenue: revenue,
    average_basket: summary.delivered_count ? money(revenue / summary.delivered_count) : 0,
    cancelled_count: summary.cancelled_count,
    discount_given: money(summary.discount_given),
    delivery_fees: money(summary.delivery_fees),
    top_by_quantity: byQuantity.map(line),
    top_by_revenue: byRevenue.map(line),
    orders_by_hour: byHour,
  };
}
