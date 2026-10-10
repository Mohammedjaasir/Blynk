import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { catalogService, type CustomerProductDto } from '../catalog/catalog.service.js';

/**
 * "Your usuals" (owner, 2026-10-10): the products of the customer's MOST
 * RECENT order that was not cancelled, at the quantities ordered, with each
 * product as the catalog shows it today (price, offer, availability). One
 * request for the Home row instead of one per product.
 *
 * - Products ordered inside a combo pack are left out: the pack is the
 *   thing they bought, and "Order again" on the order puts packs back.
 * - A product that was deleted or deactivated since is listed in
 *   `unavailable` by its name on the order; one that is only out of stock
 *   comes back with is_available false, so the row can show it greyed and
 *   "Add all" skips it.
 */
export interface UsualItem {
  product: CustomerProductDto;
  quantity: number;
}

export async function customerUsuals(customerId: string) {
  const order = await db
    .selectFrom('orders')
    .select(['id', 'order_number', 'placed_at'])
    .where('customer_id', '=', customerId)
    .where('order_status', '!=', 'CANCELLED')
    .orderBy('placed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!order) return { order: null, items: [] as UsualItem[], unavailable: [] as string[] };

  const lines = await db
    .selectFrom('order_items')
    .select(['product_id', 'product_name_snapshot', 'quantity', 'item_status'])
    .where('order_id', '=', order.id)
    .where('order_combo_id', 'is', null)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();

  // One entry per product (an order normally has each product once).
  const wanted = new Map<string, { name: string; quantity: number }>();
  for (const l of lines) {
    if (l.item_status === 'UNAVAILABLE') continue; // removed from that order by the store
    const prev = wanted.get(l.product_id);
    wanted.set(l.product_id, { name: l.product_name_snapshot, quantity: (prev?.quantity ?? 0) + l.quantity });
  }

  const items: UsualItem[] = [];
  const unavailable: string[] = [];
  for (const [productId, w] of wanted) {
    try {
      items.push({ product: await catalogService.getProductById(productId), quantity: w.quantity });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) unavailable.push(w.name);
      else throw err;
    }
  }
  return {
    order: { id: order.id, order_number: order.order_number, placed_at: order.placed_at },
    items,
    unavailable,
  };
}
