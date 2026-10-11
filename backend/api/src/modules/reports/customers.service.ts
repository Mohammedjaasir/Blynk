import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { categoryNames, favouritesOf } from '../birthday/birthday.list.js';

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

/** How many addresses the customer has saved (not deleted). */
const addressesCount = sql<number>`(SELECT count(*)::int FROM customer_addresses a WHERE a.user_id = u.id AND a.is_deleted = false)`;
/** The customer's default address (else their newest) as one line, or null. */
const defaultAddressLine = sql<string | null>`(SELECT concat_ws(', ', a.address_line1, nullif(a.address_line2, ''), a.city)
  FROM customer_addresses a WHERE a.user_id = u.id AND a.is_deleted = false
  ORDER BY a.is_default DESC, a.created_at DESC LIMIT 1)`;

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
    'u.sms_language',
    sql<boolean>`(u.sms_offers_opted_out_at is null)`.as('sms_offers'),
    // Migration 034: optional, YYYY-MM-DD.
    sql<string | null>`u.date_of_birth::text`.as('date_of_birth'),
    sql<number>`coalesce(s.orders_count, 0)`.as('orders_count'),
    sql<number>`coalesce(s.delivered_count, 0)`.as('delivered_count'),
    sql<string>`coalesce(s.delivered_spend, 0)`.as('delivered_spend'),
    sql<Date | null>`s.last_order_at`.as('last_order_at'),
    // Owner, 2026-10-11: each customer's address, recorded in Admin.
    addressesCount.as('addresses_count'),
    defaultAddressLine.as('default_address'),
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
      addresses_count: Number(r.addresses_count ?? 0),
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
      'u.sms_language',
      sql<boolean>`(u.sms_offers_opted_out_at is null)`.as('sms_offers'),
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
      'u.sms_language',
      sql<boolean>`(u.sms_offers_opted_out_at is null)`.as('sms_offers'),
      // Migration 034 (owner, 2026-10-09): the optional profile.
      sql<string | null>`u.date_of_birth::text`.as('date_of_birth'),
      'u.favourite_category_ids',
      'u.favourites_note',
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
      'o.birthday_discount_amount',
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
  const { favourite_category_ids: favouriteIds, ...profile } = customer;
  const names = await categoryNames(favouriteIds ?? []);
  return {
    customer: {
      ...profile,
      favourite_categories: favouritesOf(favouriteIds, names),
      orders_count: total,
      delivered_count: Number(customer.delivered_count),
      delivered_spend: money(customer.delivered_spend),
    },
    orders: orders.map((o) => ({
      ...o,
      subtotal_amount: money(o.subtotal_amount),
      delivery_fee: money(o.delivery_fee),
      discount_amount: money(o.discount_amount),
      birthday_discount_amount: money(o.birthday_discount_amount),
      total_amount: money(o.total_amount),
      item_count: Number(o.item_count ?? 0),
    })),
    pagination: { page: params.page, limit: params.limit, total, total_pages: Math.ceil(total / params.limit) || 1 },
  };
}

// ----------------------------------------------------------------------------
// Customer addresses (owner, 2026-10-11): "record the address of each
// customer in admin". Staff only (ADMIN and OPERATIONS - the same view is in
// both apps); never part of any customer-facing endpoint.
// ----------------------------------------------------------------------------

/** Two points this close (degrees, ~1 m) are the same drop-off. */
const SAME_POINT_DEG = 0.00001;

const norm = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** A delivery address taken from a customer's orders, with how often it was used. */
export interface UsedAddress {
  address_line1: string;
  address_line2: string | null;
  city: string;
  latitude: number;
  longitude: number;
  recipient_name: string;
  recipient_phone: string;
  orders: number;
  delivered: number;
  last_order_at: Date | null;
}

/**
 * Every distinct address a customer's orders went to (orders keep a copy of
 * the address, so this survives the customer editing or deleting it), most
 * used first.
 */
async function usedAddresses(customerId: string): Promise<UsedAddress[]> {
  const lat = sql<string>`round(delivery_latitude::numeric, 5)`;
  const lng = sql<string>`round(delivery_longitude::numeric, 5)`;
  const rows = await db
    .selectFrom('orders')
    .select([
      'delivery_address_line1',
      'delivery_address_line2',
      'delivery_city',
      lat.as('lat'),
      lng.as('lng'),
      sql<string>`(array_agg(delivery_recipient_name ORDER BY placed_at DESC))[1]`.as('recipient_name'),
      sql<string>`(array_agg(delivery_recipient_phone ORDER BY placed_at DESC))[1]`.as('recipient_phone'),
      sql<number>`count(*)::int`.as('orders'),
      sql<number>`(count(*) FILTER (WHERE order_status = 'DELIVERED'))::int`.as('delivered'),
      sql<Date | null>`max(placed_at)`.as('last_order_at'),
    ])
    .where('customer_id', '=', customerId)
    .groupBy(['delivery_address_line1', 'delivery_address_line2', 'delivery_city', lat, lng])
    .orderBy(sql`count(*)`, 'desc')
    .orderBy(sql`max(placed_at)`, 'desc')
    .execute();
  return rows.map((r) => ({
    address_line1: r.delivery_address_line1,
    address_line2: r.delivery_address_line2,
    city: r.delivery_city,
    latitude: Number(r.lat),
    longitude: Number(r.lng),
    recipient_name: r.recipient_name,
    recipient_phone: r.recipient_phone,
    orders: Number(r.orders),
    delivered: Number(r.delivered),
    last_order_at: r.last_order_at,
  }));
}

type Place = { address_line1: string; city: string; latitude: number; longitude: number };

/** An order's address belongs to a saved address when it is the same point, or the same street line in the same town. */
export function sameAddress(saved: Place, used: Place): boolean {
  const samePoint = Math.abs(saved.latitude - used.latitude) < SAME_POINT_DEG && Math.abs(saved.longitude - used.longitude) < SAME_POINT_DEG;
  const line = norm(saved.address_line1);
  const sameLine = line !== '' && line === norm(used.address_line1) && norm(saved.city) === norm(used.city);
  return samePoint || sameLine;
}

/**
 * GET /admin/customers/:id/addresses (ADMIN and OPERATIONS): the customer's
 * saved addresses (label, recipient, phones, the line, town, pin) with how
 * many orders went to each, and the other addresses their orders went to
 * (one since edited or deleted).
 */
export async function customerAddresses(id: string) {
  const customer = await db
    .selectFrom('users')
    .select(['id', 'full_name', 'phone'])
    .where('id', '=', id)
    .where('role', '=', 'CUSTOMER')
    .executeTakeFirst();
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  const [saved, used] = await Promise.all([
    db
      .selectFrom('customer_addresses')
      .select([
        'id',
        'label',
        'recipient_name',
        'recipient_phone',
        'alternate_phone',
        'address_line1',
        'address_line2',
        'city',
        'postal_code',
        'latitude',
        'longitude',
        'delivery_instructions',
        'is_default',
        'created_at',
        'updated_at',
      ])
      .where('user_id', '=', id)
      .where('is_deleted', '=', false)
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'desc')
      .execute(),
    usedAddresses(id),
  ]);

  // Each order address is counted once, against the first saved address it matches.
  const claimed = new Set<number>();
  const addresses = saved.map((a) => {
    const place = { address_line1: a.address_line1, city: a.city, latitude: Number(a.latitude), longitude: Number(a.longitude) };
    let orders = 0;
    let delivered = 0;
    let last: Date | null = null;
    used.forEach((u, i) => {
      if (claimed.has(i) || !sameAddress(place, u)) return;
      claimed.add(i);
      orders += u.orders;
      delivered += u.delivered;
      if (u.last_order_at && (last === null || u.last_order_at > last)) last = u.last_order_at;
    });
    return { ...a, latitude: place.latitude, longitude: place.longitude, orders, delivered, last_order_at: last };
  });

  return {
    customer,
    addresses,
    other_addresses: used.filter((_, i) => !claimed.has(i)),
  };
}

/**
 * GET /admin/customer-addresses (ADMIN and OPERATIONS): customers by name or
 * phone with their default address and how many they saved - the Ops app's
 * way in to a customer's addresses. No spend figures.
 */
export async function listCustomerAddressBook(params: { search?: string; page: number; limit: number }) {
  const offset = (params.page - 1) * params.limit;
  const [rows, count] = await Promise.all([
    baseQuery(params.search)
      .select([
        'u.id',
        'u.full_name',
        'u.phone',
        sql<number>`coalesce(s.orders_count, 0)`.as('orders_count'),
        sql<Date | null>`s.last_order_at`.as('last_order_at'),
        addressesCount.as('addresses_count'),
        defaultAddressLine.as('default_address'),
      ])
      .orderBy(sql`s.last_order_at`, sql`desc nulls last`)
      .orderBy('u.created_at', 'desc')
      .orderBy('u.id')
      .limit(params.limit)
      .offset(offset)
      .execute(),
    baseQuery(params.search).select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow(),
  ]);
  return {
    customers: rows.map((r) => ({
      ...r,
      orders_count: Number(r.orders_count),
      addresses_count: Number(r.addresses_count ?? 0),
    })),
    pagination: { page: params.page, limit: params.limit, total: count.n, total_pages: Math.ceil(count.n / params.limit) || 1 },
  };
}
