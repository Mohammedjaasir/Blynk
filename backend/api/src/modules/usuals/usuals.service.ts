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
  /**
   * Migration 045: the variant ordered (null for a product without variants)
   * and its label then; "Add all" puts this variant in the basket. When it is
   * no longer sold, product.variants says what can be picked instead.
   */
  variant_id: string | null;
  variant_label: string | null;
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
    .select(['product_id', 'variant_id', 'variant_label_snapshot', 'product_name_snapshot', 'quantity', 'item_status'])
    .where('order_id', '=', order.id)
    .where('order_combo_id', 'is', null)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();

  // One entry per product, or per variant (migration 045).
  const wanted = new Map<string, { productId: string; variantId: string | null; label: string | null; name: string; quantity: number }>();
  for (const l of lines) {
    if (l.item_status === 'UNAVAILABLE') continue; // removed from that order by the store
    const key = `${l.product_id}:${l.variant_id ?? ''}`;
    const prev = wanted.get(key);
    wanted.set(key, {
      productId: l.product_id,
      variantId: l.variant_id ?? null,
      label: l.variant_label_snapshot ?? null,
      name: l.product_name_snapshot,
      quantity: (prev?.quantity ?? 0) + l.quantity,
    });
  }

  const items: UsualItem[] = [];
  const unavailable: string[] = [];
  for (const w of wanted.values()) {
    try {
      items.push({
        product: await catalogService.getProductById(w.productId),
        quantity: w.quantity,
        variant_id: w.variantId,
        variant_label: w.label,
      });
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
