import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';

export type CustomerSort = 'recent' | 'spend' | 'orders' | 'name';

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

/** LIKE pattern for a user's search text, with its wildcards taken literally. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Per-customer order figures: one grouped pass over orders, joined to the page. */
const orderStats = db
  .selectFrom('orders')
  .select([
    'customer_id',
    sql<number>`count(*)::int`.as('orders_count'),
    sql<number>`(count(*) FILTER (WHERE order_status = 'DELIVERED'))::int`.as('delivered_count'),
    sql<string>`coalesce(sum(total_amount) FILTER (WHERE order_status = 'DELIVERED'), 0)`.as('delivered_spend'),
    sql<Date | null>`max(placed_at)`.as('last_order_at'),
  ])
  .groupBy('customer_id')
  .as('s');

function baseQuery(search?: string) {
  let q = db
    .selectFrom('users as u')
    .leftJoin(orderStats, 's.customer_id', 'u.id')
    .where('u.role', '=', 'CUSTOMER');
  const text = search?.trim();
  if (text) {
    const pattern = containsPattern(text);
    // Phone numbers are stored as +94771234567; let "077 123" find them too.
    const digits = text.replace(/[^0-9]/g, '').replace(/^0/, '');
    q = q.where((eb) =>
      eb.or([
        eb('u.full_name', 'ilike', pattern),
        eb('u.phone', 'like', pattern),
        ...(digits.length >= 3 ? [eb('u.phone', 'like', containsPattern(digits))] : []),
      ])
    );
  }
  return q;
}

/**
 * GET /admin/customers (ADMIN only - the rows carry phone numbers):
 * search by name or phone, paginated, with orders placed, delivered spend
 * (the totals of DELIVERED orders) and the last order date. Sort by spend or
 * orders for top customers.
 */
export async function listCustomers(params: { search?: string; sort: CustomerSort; page: number; limit: number }) {
  const offset = (params.page - 1) * params.limit;
  let q = baseQuery(params.search).select([
    'u.id',
    'u.full_name',
    'u.phone',
    'u.email',
    'u.is_active',
    'u.created_at',
    sql<number>`coalesce(s.orders_count, 0)`.as('orders_count'),
    sql<number>`coalesce(s.delivered_count, 0)`.as('delivered_count'),
    sql<string>`coalesce(s.delivered_spend, 0)`.as('delivered_spend'),
    sql<Date | null>`s.last_order_at`.as('last_order_at'),
  ]);
  switch (params.sort) {
    case 'spend':
      q = q.orderBy(sql`coalesce(s.delivered_spend, 0)`, 'desc').orderBy(sql`coalesce(s.orders_count, 0)`, 'desc');
      break;
    case 'orders':
      q = q.orderBy(sql`coalesce(s.orders_count, 0)`, 'desc').orderBy(sql`coalesce(s.delivered_spend, 0)`, 'desc');
      break;
    case 'name':
      q = q.orderBy(sql`u.full_name`, sql`asc nulls last`);
      break;
    default:
      q = q.orderBy(sql`s.last_order_at`, sql`desc nulls last`).orderBy('u.created_at', 'desc');
  }
  const [rows, count] = await Promise.all([
    q.orderBy('u.id').limit(params.limit).offset(offset).execute(),
    baseQuery(params.search).select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow(),
  ]);
  return {
    customers: rows.map((r) => ({
      ...r,
      orders_count: Number(r.orders_count),
      delivered_count: Number(r.delivered_count),
      delivered_spend: money(r.delivered_spend),
    })),
    pagination: {
      page: params.page,
      limit: params.limit,
      total: count.n,
      total_pages: Math.ceil(count.n / params.limit) || 1,
    },
  };
}

/** Most rows one export returns; far above today's customer count. */
export const CUSTOMER_EXPORT_MAX = 50_000;

/**
 * GET /admin/customers/export (ADMIN only): every customer's name and phone
 * with their order figures, by name, for the Admin "Download Excel" button.
 * The owner sends promotional SMS from this sheet by hand.
 */
export async function exportCustomers() {
  const rows = await baseQuery()
    .select([
      'u.full_name',
      'u.phone',
      'u.is_active',
      'u.created_at',
      sql<number>`coalesce(s.orders_count, 0)`.as('orders_count'),
      sql<string>`coalesce(s.delivered_spend, 0)`.as('delivered_spend'),
      sql<Date | null>`s.last_order_at`.as('last_order_at'),
    ])
    .orderBy(sql`u.full_name`, sql`asc nulls last`)
    .orderBy('u.created_at', 'asc')
    .limit(CUSTOMER_EXPORT_MAX)
    .execute();
  return {
    customers: rows.map((r) => ({
      ...r,
      orders_count: Number(r.orders_count),
      delivered_spend: money(r.delivered_spend),
    })),
  };
}

/** GET /admin/customers/:id: the profile, the same figures, and their order history (newest first). */
export async function getCustomer(id: string, params: { page: number; limit: number }) {
  const customer = await baseQuery()
    .select([
      'u.id',
      'u.full_name',
      'u.phone',
      'u.email',
      'u.is_active',
      'u.created_at',
      'u.last_login_at',
      sql<number>`coalesce(s.orders_count, 0)`.as('orders_count'),
      sql<number>`coalesce(s.delivered_count, 0)`.as('delivered_count'),
      sql<string>`coalesce(s.delivered_spend, 0)`.as('delivered_spend'),
      sql<Date | null>`s.last_order_at`.as('last_order_at'),
    ])
    .where('u.id', '=', id)
    .executeTakeFirst();
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  const offset = (params.page - 1) * params.limit;
  const orders = await db
    .selectFrom('orders as o')
    .select([
      'o.id',
      'o.order_number',
      'o.order_status',
      'o.payment_status',
      'o.subtotal_amount',
      'o.delivery_fee',
      'o.discount_amount',
      'o.total_amount',
      'o.coupon_code',
      'o.placed_at',
      'o.delivered_at',
      'o.cancelled_at',
      (eb) =>
        eb
          .selectFrom('order_items as i')
          .select(sql<number>`coalesce(sum(i.quantity), 0)::int`.as('n'))
          .whereRef('i.order_id', '=', 'o.id')
          .as('item_count'),
    ])
    .where('o.customer_id', '=', id)
    .orderBy('o.placed_at', 'desc')
    .orderBy('o.id')
    .limit(params.limit)
    .offset(offset)
    .execute();

  const total = Number(customer.orders_count);
  return {
    customer: {
      ...customer,
      orders_count: total,
      delivered_count: Number(customer.delivered_count),
      delivered_spend: money(customer.delivered_spend),
    },
    orders: orders.map((o) => ({
      ...o,
      subtotal_amount: money(o.subtotal_amount),
      delivery_fee: money(o.delivery_fee),
      discount_amount: money(o.discount_amount),
      total_amount: money(o.total_amount),
      item_count: Number(o.item_count ?? 0),
    })),
    pagination: { page: params.page, limit: params.limit, total, total_pages: Math.ceil(total / params.limit) || 1 },
  };
}
