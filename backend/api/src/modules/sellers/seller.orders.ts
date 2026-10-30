import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { OrderStatus } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { runTransition } from '../orders/lifecycle/engine.js';
import { sellerService } from './seller.service.js';

/**
 * A seller's orders and the "Order is ready" button (seller portal, 2026-10-30, owner's brother:
 * "when a seller gets orders they must get notifications; when the order is ready the seller sends
 * the notification to the rider").
 *
 *   GET  /seller/orders?status=   the orders that contain this seller's products, newest first, the
 *                                 last 60 days, at most 100
 *   POST /seller/orders/:id/ready the seller has put the order together: PLACED -> PACKED
 *
 * Privacy: a seller never sees a customer (name, phone, address) or any order total. Each order
 * carries its number, time, status, the seller's OWN lines and what the seller earns for them
 * (quantity x the seller's price when the order was placed - the same figure the statement uses -
 * before Blynk's commission).
 *
 * "Ready" is the lifecycle's PACK action run by the seller's user (sellerMayRun in the catalogue;
 * lifecycle/actions/store.ts re-checks under the order lock that the order is still new and
 * entirely this seller's). So the status history, the stock ledger rows (ORDER_FULFILLMENT), the
 * customer's "packed" push and the push to the rider / staff are the engine's, exactly as when staff
 * pack - nothing here writes an order or stock directly. An order with products of more than one
 * seller (or Blynk's own) is staff's to pack: 409 SELLER_ORDER_MIXED.
 */

export const SELLER_ORDER_STATUSES = ['NEW', 'READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'] as const;
export type SellerOrderStatus = (typeof SELLER_ORDER_STATUSES)[number];

export const sellerOrdersQuerySchema = z.object({
  status: z.enum(SELLER_ORDER_STATUSES, { errorMap: () => ({ message: `status must be one of ${SELLER_ORDER_STATUSES.join(', ')}` }) }).optional(),
});

/** Which order states each seller-facing status covers (AWAITING_PAYMENT orders are not listed yet). */
const STATUS_GROUPS: Record<SellerOrderStatus, readonly OrderStatus[]> = {
  NEW: ['PLACED', 'ITEM_UNAVAILABLE'],
  READY: ['PACKED'],
  ON_THE_WAY: ['OUT_FOR_DELIVERY'],
  DELIVERED: ['DELIVERED'],
  CANCELLED: ['CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE'],
};

export function sellerOrderStatusOf(status: OrderStatus): SellerOrderStatus | null {
  return SELLER_ORDER_STATUSES.find((s) => STATUS_GROUPS[s].includes(status)) ?? null;
}

export const SELLER_ORDER_WINDOW_DAYS = 60;
export const SELLER_ORDER_LIMIT = 100;

export interface SellerOrderItem {
  product_id: string;
  name: string;
  quantity: number;
}

export interface SellerOrderDto {
  id: string;
  order_number: string;
  placed_at: string;
  status: SellerOrderStatus;
  /** When the order went PACKED (the seller's "ready" or staff packing); null before that. */
  ready_at: string | null;
  /** True only for a NEW (PLACED) order that is entirely this seller's. */
  can_mark_ready: boolean;
  items: SellerOrderItem[];
  /** The seller's price x quantity over their lines, before commission. */
  seller_amount: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (d: unknown): string => new Date(d as string | number | Date).toISOString();

interface OrderRowOut {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  placed_at: Date;
  ready_at: Date | null;
  has_others: boolean;
}

/**
 * The seller's orders, as the DTO. `ids` limits it to those orders (the ready response); `status`
 * to one group. Only orders that were announced to the seller are listed: they have a PLACED history
 * row (an online order that expired unpaid never had one).
 */
async function sellerOrderDtos(
  sellerId: string,
  opts: { ids?: string[]; status?: SellerOrderStatus } = {}
): Promise<SellerOrderDto[]> {
  const states = opts.status ? STATUS_GROUPS[opts.status] : (SELLER_ORDER_STATUSES.flatMap((s) => STATUS_GROUPS[s]) as OrderStatus[]);
  const ids = opts.ids ? (opts.ids.length ? sql.join(opts.ids.map((id) => sql`${id}::uuid`)) : sql`NULL::uuid`) : null;
  const orders = (
    await sql<OrderRowOut>`
      SELECT o.id, o.order_number, o.order_status,
             COALESCE(o.placed_at, o.created_at) AS placed_at,
             (SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.new_status = 'PACKED') AS ready_at,
             EXISTS (
               SELECT 1 FROM order_items x JOIN products xp ON xp.id = x.product_id
                WHERE x.order_id = o.id AND x.item_status <> 'UNAVAILABLE' AND xp.seller_id IS DISTINCT FROM ${sellerId}::uuid
             ) AS has_others
        FROM orders o
       WHERE EXISTS (
               SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id AND p.seller_id = ${sellerId}::uuid
             )
         AND o.order_status IN (${sql.join(states.map((s) => sql`${s}`))})
         AND EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.new_status = 'PLACED')
         ${ids ? sql`AND o.id IN (${ids})` : sql`AND COALESCE(o.placed_at, o.created_at) >= now() - ${SELLER_ORDER_WINDOW_DAYS} * interval '1 day'`}
       ORDER BY COALESCE(o.placed_at, o.created_at) DESC, o.id DESC
       LIMIT ${SELLER_ORDER_LIMIT}`.execute(db)
  ).rows;
  if (orders.length === 0) return [];

  const lines = (
    await sql<{ order_id: string; product_id: string; name: string; quantity: number; amount: string }>`
      SELECT oi.order_id, oi.product_id,
             TRIM(oi.product_name_snapshot || COALESCE(' ' || NULLIF(oi.variant_label_snapshot, ''), '')) AS name,
             oi.quantity,
             (oi.quantity * oi.estimated_unit_cost)::text AS amount
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
       WHERE p.seller_id = ${sellerId}::uuid
         AND oi.order_id IN (${sql.join(orders.map((o) => sql`${o.id}::uuid`))})
         AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
       ORDER BY oi.created_at, name, oi.id`.execute(db)
  ).rows;
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l]);

  return orders.map((o) => {
    const own = byOrder.get(o.id) ?? [];
    return {
      id: o.id,
      order_number: o.order_number,
      placed_at: iso(o.placed_at),
      status: sellerOrderStatusOf(o.order_status)!,
      ready_at: o.ready_at ? iso(o.ready_at) : null,
      can_mark_ready: o.order_status === 'PLACED' && !o.has_others && own.length > 0,
      items: own.map((l) => ({ product_id: l.product_id, name: l.name, quantity: Number(l.quantity) })),
      seller_amount: round2(own.reduce((sum, l) => sum + Number(l.amount), 0)),
    };
  });
}

async function approvedSeller(userId: string) {
  const seller = await sellerService.sellerOf(userId);
  if (seller.status !== 'APPROVED') {
    throw new AppError('Your seller account has not been approved yet.', 403, 'SELLER_NOT_APPROVED', { status: seller.status });
  }
  return seller;
}

export async function listSellerOrders(userId: string, status?: SellerOrderStatus) {
  const seller = await approvedSeller(userId);
  return { orders: await sellerOrderDtos(seller.id, { status }) };
}

/** POST /seller/orders/:id/ready. 404 for an order with none of the seller's products. */
export async function markSellerOrderReady(userId: string, orderId: string): Promise<SellerOrderDto> {
  const seller = await approvedSeller(userId);

  const order = await db
    .selectFrom('orders as o')
    .select(['o.id', 'o.order_status'])
    .where('o.id', '=', orderId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('order_items as oi')
          .innerJoin('products as p', 'p.id', 'oi.product_id')
          .select('oi.id')
          .whereRef('oi.order_id', '=', 'o.id')
          .where('p.seller_id', '=', seller.id)
      )
    )
    .executeTakeFirst();
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  if (order.order_status !== 'PLACED') {
    throw new AppError('This order is not new any more.', 409, 'ORDER_NOT_NEW', { order_status: order.order_status });
  }

  // The lifecycle checks it all again under the order lock (a mixed order: 409 SELLER_ORDER_MIXED).
  await runTransition('PACK', {
    actor: { id: userId, role: 'SELLER' },
    orderId,
    sellerId: seller.id,
    input: { notes: `Marked ready by the seller (${seller.shop_name})` },
  });

  const [dto] = await sellerOrderDtos(seller.id, { ids: [orderId] });
  return dto;
}
