import { bundleOffersReady } from './bundle-offers.ready.js';
import { freeUnitsAfterRemoval } from './bundle-pricing.js';
import type { Trx } from './lifecycle/types.js';

/**
 * RESOLVE_ITEM (a staff member marks an item UNAVAILABLE) - keeps bundle offers honest (owner,
 * 2026-10-25). A BUY_X_GET_Y free-unit line was earned by the paid units next to it: when some of
 * those are removed, the free units shrink to what the remaining paid units earn on their own
 * (floor(paid / buy_qty) x get_qty, never more than before). The surplus free units are removed
 * (the line is cut, or marked UNAVAILABLE when none is left) - they cost the customer nothing, so
 * the order total and any refund are unaffected; the store simply does not give away what was not
 * earned. A gift stays (a shortage on the store's side does not take the customer's gift away).
 * Money always follows the lines still on the order (subtotal = paid lines), so a removed paid
 * item can never refund more than that item cost.
 *
 * Called under the order lock, after the item's status was written. A no-op before migration 062.
 */
export async function recomputeBundleFreeUnits(trx: Trx, orderId: string): Promise<void> {
  if (!(await bundleOffersReady())) return;
  const rows = await trx
    .selectFrom('order_items')
    .select(['id', 'product_id', 'quantity', 'item_status', 'order_combo_id', 'bundle_kind', 'bundle_offer_id', 'bundle_value', 'bundle_rule'])
    .where('order_id', '=', orderId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  const live = rows.filter((r) => r.item_status !== 'UNAVAILABLE');
  const freeRows = live.filter((r) => r.bundle_kind === 'FREE_UNITS' && r.bundle_offer_id);
  if (freeRows.length === 0) return;

  const paid = live.filter((r) => r.bundle_kind === null && r.order_combo_id === null);
  const productIds = [...new Set(paid.map((r) => r.product_id))];
  const cats = productIds.length
    ? await trx
        .selectFrom('products as p')
        .leftJoin('categories as c', 'c.id', 'p.category_id')
        .select(['p.id', 'p.category_id', 'c.parent_id'])
        .where('p.id', 'in', productIds)
        .execute()
    : [];
  const catOf = new Map(cats.map((c) => [c.id, c]));

  const offerIds = [...new Set(freeRows.map((r) => r.bundle_offer_id!))];
  for (const offerId of offerIds) {
    const group = freeRows.filter((r) => r.bundle_offer_id === offerId);
    const rule = (typeof group[0].bundle_rule === 'string' ? JSON.parse(group[0].bundle_rule) : group[0].bundle_rule) as {
      buy_qty?: number;
      get_qty?: number;
      product_ids?: string[] | null;
      category_id?: string | null;
    } | null;
    if (!rule || !rule.buy_qty || !rule.get_qty) continue;
    const matching = paid.filter((r) => {
      if (rule.product_ids) return rule.product_ids.includes(r.product_id);
      const c = catOf.get(r.product_id);
      return !!rule.category_id && !!c && (c.category_id === rule.category_id || c.parent_id === rule.category_id);
    });
    const paidUnits = matching.reduce((n, r) => n + r.quantity, 0);
    const freeNow = group.reduce((n, r) => n + r.quantity, 0);
    const allowed = freeUnitsAfterRemoval(paidUnits, freeNow, { buy_qty: rule.buy_qty, get_qty: rule.get_qty });
    let excess = freeNow - allowed;
    // Cut from the last free line backwards.
    for (const r of [...group].reverse()) {
      if (excess <= 0) break;
      if (r.quantity <= excess) {
        await trx.updateTable('order_items').set({ item_status: 'UNAVAILABLE' }).where('id', '=', r.id).execute();
        excess -= r.quantity;
      } else {
        const keep = r.quantity - excess;
        const unitValue = Number(r.bundle_value ?? 0) / r.quantity;
        await trx
          .updateTable('order_items')
          .set({ quantity: keep, bundle_value: Number((unitValue * keep).toFixed(2)) })
          .where('id', '=', r.id)
          .execute();
        excess = 0;
      }
    }
  }
}
