import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { db } from '../../database/connection.js';
import { STORE_ZONE, rangeBounds, salesReport, type DateRange } from './sales.service.js';

/**
 * The sales dashboard on the phone (owner, 2026-10-10): Ops Home and the
 * Admin Dashboard. It is the Sales report (salesReport - the same
 * definitions, so the two screens never disagree) for one of four ranges,
 * plus orders by status, cash collected, and the previous period.
 *
 * Every figure is over orders PLACED in the range (Asia/Colombo days):
 * * delivered_revenue: total_amount of those orders now DELIVERED.
 * * cash_collected: what riders recorded collecting at the door
 *   (deliveries.cod_collected_amount) for those DELIVERED orders.
 * * average_basket: delivered_revenue / delivered orders.
 *
 * Ranges are "to date", and the comparison is the same length just before:
 * * today      vs yesterday
 * * yesterday  vs the day before
 * * this_week  (Monday .. today) vs last week's Monday .. the same weekday
 * * this_month (1st .. today) vs last month's 1st .. the same day (clamped
 *   to that month's length, e.g. 31 March compares with 1-28/29 February)
 */
export type DashboardRange = 'today' | 'yesterday' | 'this_week' | 'this_month';
export const DASHBOARD_RANGES: DashboardRange[] = ['today', 'yesterday', 'this_week', 'this_month'];

export function resolveDashboardRange(range: DashboardRange, now: Date = new Date()): { current: DateRange; previous: DateRange } {
  const today = DateTime.fromJSDate(now).setZone(STORE_ZONE).startOf('day');
  const iso = (d: DateTime) => d.toISODate()!;
  const span = (from: DateTime, to: DateTime): DateRange => ({ from: iso(from), to: iso(to) });
  switch (range) {
    case 'today':
      return { current: span(today, today), previous: span(today.minus({ days: 1 }), today.minus({ days: 1 })) };
    case 'yesterday': {
      const y = today.minus({ days: 1 });
      return { current: span(y, y), previous: span(y.minus({ days: 1 }), y.minus({ days: 1 })) };
    }
    case 'this_week': {
      // Luxon weeks start on Monday (ISO).
      const monday = today.startOf('week');
      const lastMonday = monday.minus({ weeks: 1 });
      return { current: span(monday, today), previous: span(lastMonday, today.minus({ weeks: 1 })) };
    }
    case 'this_month': {
      const first = today.startOf('month');
      const prevFirst = first.minus({ months: 1 });
      const prevEnd = DateTime.min(prevFirst.plus({ days: today.day - 1 }), prevFirst.endOf('month').startOf('day'));
      return { current: span(first, today), previous: span(prevFirst, prevEnd) };
    }
  }
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

/** Orders by status and cash collected, over orders placed in the range. */
async function statusAndCash(range: DateRange) {
  const { start, end } = rangeBounds(range);
  const [statuses, cash] = await Promise.all([
    db
      .selectFrom('orders')
      .select(['order_status', sql<number>`count(*)::int`.as('count')])
      .where('placed_at', '>=', start)
      .where('placed_at', '<', end)
      .groupBy('order_status')
      .execute(),
    db
      .selectFrom('orders as o')
      .innerJoin('deliveries as d', 'd.order_id', 'o.id')
      .select(sql<string>`coalesce(sum(d.cod_collected_amount), 0)`.as('cash'))
      .where('o.placed_at', '>=', start)
      .where('o.placed_at', '<', end)
      .where('o.order_status', '=', 'DELIVERED')
      .where('d.assignment_status', '=', 'DELIVERED')
      .executeTakeFirstOrThrow(),
  ]);
  const by_status: Record<string, number> = {};
  for (const s of statuses) by_status[s.order_status] = s.count;
  return { by_status, cash_collected: money(cash.cash) };
}

/** Percent change from previous to current; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export async function salesDashboard(range: DashboardRange, now: Date = new Date()) {
  const ranges = resolveDashboardRange(range, now);
  const [cur, prev, curExtra, prevExtra] = await Promise.all([
    salesReport(ranges.current),
    salesReport(ranges.previous),
    statusAndCash(ranges.current),
    statusAndCash(ranges.previous),
  ]);
  const pick = (r: typeof cur, extra: typeof curExtra) => ({
    order_count: r.order_count,
    delivered_count: r.delivered_count,
    cancelled_count: r.cancelled_count,
    delivered_revenue: r.delivered_revenue,
    cash_collected: extra.cash_collected,
    average_basket: r.average_basket,
  });
  const current = pick(cur, curExtra);
  const previous = pick(prev, prevExtra);
  const change = Object.fromEntries(
    (Object.keys(current) as (keyof typeof current)[]).map((k) => [k, percentChange(current[k], previous[k])])
  ) as Record<keyof typeof current, number | null>;

  return {
    range,
    timezone: STORE_ZONE,
    period: ranges.current,
    previous_period: ranges.previous,
    ...current,
    orders_by_status: curExtra.by_status,
    previous,
    change,
    discount_given: cur.discount_given,
    delivery_fees: cur.delivery_fees,
    top_by_quantity: cur.top_by_quantity.slice(0, 5),
    top_by_revenue: cur.top_by_revenue.slice(0, 5),
    orders_by_hour: cur.orders_by_hour,
  };
}
