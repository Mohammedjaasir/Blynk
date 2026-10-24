import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { inventoryService } from '../inventory/inventory.service.js';
import { ratingsReady } from '../ratings/ratings.ready.js';
import { rangeBounds, salesReport } from '../reports/sales.service.js';
import type { DailyReportSnapshot } from './daily-report.builder.js';

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

/**
 * The numbers for one Colombo day, as the report builder takes them. The definitions are the Admin
 * dashboard's (reports/sales.service.ts salesReport), so the SMS and the screen never disagree:
 * every figure is over orders PLACED that Colombo day - sales is what the day's DELIVERED orders
 * brought in (revenueOf, so a rider's cash tip is not counted), top products are those orders'
 * lines. Beyond the dashboard:
 *  - cash collected: what riders recorded taking at the door (deliveries.cod_collected_amount) for
 *    the day's delivered orders (a cash tip is inside it);
 *  - new customers: CUSTOMER accounts created that day;
 *  - low stock: the "Running low" list as it is right now (not historical);
 *  - rating: stars given that day (null before migration 055 or with none);
 *  - repeat orders: the day's orders placed by a repeat basket (0 before migration 054);
 *  - tips: rider tips (cash + wallet) on the day's delivered orders (null before 055).
 * Columns from migrations 054 / 055 are read as JSON from the row, so a missing column is 0, never
 * an error (same idea as reports/revenue-sql.ts).
 */
export async function gatherDailyReportData(date: string): Promise<DailyReportSnapshot> {
  const range = { from: date, to: date };
  const { start, end } = rangeBounds(range);

  const cashQ = db
    .selectFrom('orders as o')
    .innerJoin('deliveries as d', 'd.order_id', 'o.id')
    .select(sql<string>`coalesce(sum(d.cod_collected_amount), 0)`.as('cash'))
    .where('o.placed_at', '>=', start)
    .where('o.placed_at', '<', end)
    .where('o.order_status', '=', 'DELIVERED')
    .where('d.assignment_status', '=', 'DELIVERED')
    .executeTakeFirstOrThrow();

  const customersQ = db
    .selectFrom('users')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('role', '=', 'CUSTOMER')
    .where('created_at', '>=', start)
    .where('created_at', '<', end)
    .executeTakeFirstOrThrow();

  const extrasQ = db
    .selectFrom('orders')
    .select([
      sql<number>`(count(*) FILTER (WHERE to_jsonb(orders)->>'repeat_basket_id' IS NOT NULL))::int`.as('repeat_orders'),
      sql<string>`coalesce(sum(coalesce((to_jsonb(orders)->>'rider_tip')::numeric, 0) + coalesce((to_jsonb(orders)->>'rider_tip_wallet')::numeric, 0))
        FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('tips'),
      sql<boolean>`bool_or(to_jsonb(orders) ? 'rider_tip')`.as('has_tips'),
    ])
    .where('placed_at', '>=', start)
    .where('placed_at', '<', end)
    .executeTakeFirstOrThrow();

  const ratingQ = async () => {
    if (!(await ratingsReady())) return { avg: null as number | null, count: 0 };
    const r = await db
      .selectFrom('order_ratings')
      .select([sql<string | null>`avg(stars)`.as('avg'), sql<number>`count(*)::int`.as('n')])
      .where('created_at', '>=', start)
      .where('created_at', '<', end)
      .executeTakeFirstOrThrow();
    return { avg: r.n > 0 && r.avg !== null ? Number(Number(r.avg).toFixed(1)) : null, count: r.n };
  };

  const lowQ = async () => {
    try {
      const low = await inventoryService.listLowStock();
      return { count: low.counts.total, names: low.items.slice(0, 3).map((i) => i.display_name) };
    } catch (err) {
      logger.warn({ err }, 'Daily report: low stock could not be read; the line is left out');
      return { count: 0, names: [] as string[] };
    }
  };

  const [sales, cash, customers, extras, rating, low] = await Promise.all([salesReport(range), cashQ, customersQ, extrasQ, ratingQ(), lowQ()]);

  return {
    date,
    orders_placed: sales.order_count,
    orders_delivered: sales.delivered_count,
    orders_cancelled: sales.cancelled_count,
    sales_lkr: sales.delivered_revenue,
    cash_collected_lkr: money(cash.cash),
    avg_basket_lkr: sales.average_basket,
    new_customers: customers.n,
    top_products: sales.top_by_quantity.slice(0, 3).map((p) => ({ name: p.name, quantity: p.quantity })),
    low_stock_count: low.count,
    low_stock_names: low.names,
    avg_rating: rating.avg,
    ratings_count: rating.count,
    repeat_orders: extras.repeat_orders,
    tips_lkr: extras.has_tips ? money(extras.tips) : null,
  };
}
