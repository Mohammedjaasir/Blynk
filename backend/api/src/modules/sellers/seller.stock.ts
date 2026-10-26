import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { lockInventoryRow, recordStockMovement } from '../inventory/stock-ledger.js';
import { sellerService } from './seller.service.js';

/**
 * Sellers set their own stock (owner, 2026-10-26: "stock they must manage themselves"; replaces the
 * stock notes Ops used to receive): PUT /seller/products/:id/stock { quantity }. The number the
 * seller types becomes the product's on-hand quantity - the canonical stock writer
 * (inventory/stock-ledger.ts) books the difference:
 *   - more than now: one PURCHASE_RESTOCK row (so back-in-stock alerts fire as for any restock),
 *   - less than now: one INVENTORY_AUDIT_ADJUSTMENT row,
 *   - the same: nothing is written (200, `previous` = `stock_on_hand`).
 * The seller is the ledger row's actor. Rules:
 *   - own products only (404 PRODUCT_NOT_FOUND for anyone else's), seller APPROVED;
 *   - a product that is still only a proposal (pending / rejected, no product row yet): 409
 *     PRODUCT_NOT_APPROVED;
 *   - a product without an inventory row gets a TRACKED one at 0 first; one staff switched to
 *     UNTRACKED: 409 PRODUCT_NOT_TRACKED (stock is not counted, so a number means nothing);
 *   - a product with sizes (variants, migration 045): 409 PRODUCT_HAS_VARIANTS - the old stock-note
 *     flow only ever fed the product-level row, so sizes are not supported here; staff keep their
 *     stock per size in Inventory;
 *   - never below what open orders have reserved: 400 INSUFFICIENT_AVAILABLE_INVENTORY.
 * Each change is audited (SELLER_STOCK_SET with the old and new quantity).
 */

export const SELLER_STOCK_MAX = 100_000;

export const setStockSchema = z
  .object({
    quantity: z
      .number({ required_error: 'Enter the quantity.', invalid_type_error: 'The quantity must be a number.' })
      .int('The quantity must be a whole number.')
      .min(0, 'The quantity cannot be below 0.')
      .max(SELLER_STOCK_MAX, `The quantity must be at most ${SELLER_STOCK_MAX.toLocaleString('en-US')}.`),
  })
  .strict();
export type SetStockInput = z.infer<typeof setStockSchema>;

/** The product id, or "submission:<id>" - what GET /seller/products calls a product that is not live yet. */
export const stockParamSchema = z.object({ id: z.string().min(1).max(100) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
const notApproved = () =>
  new AppError('This product has not been approved yet. You can set its stock once Blynk approves it.', 409, 'PRODUCT_NOT_APPROVED');

export async function setProductStock(userId: string, rawId: string, input: SetStockInput, actor: AuditActor) {
  const seller = await sellerService.sellerOf(userId);
  if (seller.status !== 'APPROVED') {
    throw new AppError('Your seller account has not been approved yet.', 403, 'SELLER_NOT_APPROVED', { status: seller.status });
  }

  // A proposal the seller sent (shown in their list as "submission:<id>") is not a product yet.
  if (rawId.startsWith('submission:')) {
    const subId = rawId.slice('submission:'.length);
    if (!UUID.test(subId)) throw notFound();
    const sub = await db
      .selectFrom('seller_submissions')
      .select('id')
      .where('id', '=', subId)
      .where('seller_id', '=', seller.id)
      .where('product_id', 'is', null)
      .executeTakeFirst();
    if (!sub) throw notFound();
    throw notApproved();
  }
  if (!UUID.test(rawId)) throw notFound();

  const product = await db
    .selectFrom('products')
    .select(['id', 'name'])
    .where('id', '=', rawId)
    .where('seller_id', '=', seller.id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) throw notFound();

  const hasVariants = await db
    .selectFrom('product_variants')
    .select('id')
    .where('product_id', '=', product.id)
    .where('deleted_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  if (hasVariants) {
    throw new AppError("Ask Blynk to update this product's sizes.", 409, 'PRODUCT_HAS_VARIANTS', { product_id: product.id });
  }

  const out = await db.transaction().execute(async (trx) => {
    let inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, product.id);
    if (!inventory) {
      // ON CONFLICT: two first saves at once make one row (the partial unique index of migration 045).
      await sql`
        INSERT INTO inventory (dark_store_id, product_id, tracking_mode)
        VALUES (${DEFAULT_DARK_STORE_ID}, ${product.id}, 'TRACKED')
        ON CONFLICT DO NOTHING`.execute(trx);
      inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, product.id);
    }
    if (!inventory || inventory.tracking_mode !== 'TRACKED') {
      throw new AppError(
        'Blynk is not counting this product\'s stock, so it cannot be set here. Ask Blynk to turn stock counting on.',
        409,
        'PRODUCT_NOT_TRACKED',
        { product_id: product.id }
      );
    }

    const previous = inventory.quantity_on_hand;
    const delta = input.quantity - previous;
    if (delta === 0) {
      return { onHand: previous, reserved: inventory.quantity_reserved, previous };
    }
    if (input.quantity < inventory.quantity_reserved) {
      const n = inventory.quantity_reserved;
      throw new AppError(
        `${n} are already reserved for open orders, so the stock cannot go below ${n}.`,
        400,
        'INSUFFICIENT_AVAILABLE_INVENTORY',
        { reserved: n, field: 'quantity' }
      );
    }
    const moved = await recordStockMovement(trx, {
      inventory,
      delta,
      type: delta > 0 ? 'PURCHASE_RESTOCK' : 'INVENTORY_AUDIT_ADJUSTMENT',
      orderId: null,
      actorId: userId,
      notes: `Seller ${seller.shop_name} set stock (was ${previous})`,
    });
    await writeAudit(trx, actor, {
      action: 'SELLER_STOCK_SET',
      entityType: 'PRODUCT',
      entityId: product.id,
      oldValues: { quantity_on_hand: previous },
      newValues: {
        quantity_on_hand: moved.inventory.quantity_on_hand,
        seller_id: seller.id,
        product_name: product.name,
        adjustment_id: moved.adjustment.id,
      },
    });
    return { onHand: moved.inventory.quantity_on_hand, reserved: moved.inventory.quantity_reserved, previous };
  });

  if (out.onHand !== out.previous) {
    logger.info({ sellerId: seller.id, productId: product.id, from: out.previous, to: out.onHand }, 'Seller set stock');
  }
  return { product_id: product.id, stock_on_hand: out.onHand, stock_reserved: out.reserved, previous: out.previous };
}
