import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { notifyCatalogChanged } from '../catalog/catalog.events.js';
import { releaseStockAlertsNow } from '../notifications/push/push.events.js';
import { sellerService } from './seller.service.js';

/**
 * A seller pauses / resumes one of their products (owner's brother, 2026-10-30: "the seller can set
 * their own products active / inactive"): PATCH /seller/products/:id/availability { available }.
 *
 * "Paused" is the product's existing unavailable state (products.is_available = false): customers
 * see it greyed out as unavailable and an order for it is refused (PRODUCT_UNAVAILABLE), exactly as
 * for staff's "sold out" switch. `is_active` (listed at all) stays staff-only - the seller never
 * touches it, and a product staff switched off stays off whatever the seller sets here.
 *   - own products only: 404 PRODUCT_NOT_FOUND for anyone else's or a deleted one;
 *   - seller APPROVED: 403 SELLER_NOT_APPROVED otherwise (pending, rejected, suspended);
 *   - the same value again changes nothing (200, no audit row);
 *   - audited SELLER_PRODUCT_AVAILABILITY; the live customer catalog is told; a product that becomes
 *     orderable again releases its "notify me" customers (best effort, like staff's switch-on).
 */
export const availabilitySchema = z
  .object({
    available: z.boolean({ required_error: 'Say whether the product is on sale.', invalid_type_error: 'available must be true or false.' }),
  })
  .strict();
export type AvailabilityInput = z.infer<typeof availabilitySchema>;

export async function setProductAvailability(userId: string, productId: string, input: AvailabilityInput, actor: AuditActor) {
  const seller = await sellerService.sellerOf(userId);
  if (seller.status !== 'APPROVED') {
    throw new AppError('Your seller account has not been approved yet.', 403, 'SELLER_NOT_APPROVED', { status: seller.status });
  }

  const out = await db.transaction().execute(async (trx) => {
    const product = await trx
      .selectFrom('products')
      .select(['id', 'name', 'is_active', 'is_available'])
      .where('id', '=', productId)
      .where('seller_id', '=', seller.id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

    const changed = product.is_available !== input.available;
    if (changed) {
      await trx.updateTable('products').set({ is_available: input.available, updated_at: new Date() }).where('id', '=', product.id).execute();
      await writeAudit(trx, actor, {
        action: 'SELLER_PRODUCT_AVAILABILITY',
        entityType: 'PRODUCT',
        entityId: product.id,
        oldValues: { is_available: product.is_available },
        newValues: { is_available: input.available, seller_id: seller.id, product_name: product.name },
      });
    }
    return { product, changed };
  });

  if (out.changed) {
    notifyCatalogChanged('products');
    if (input.available && out.product.is_active) {
      try {
        await releaseStockAlertsNow(out.product.id);
      } catch (err) {
        logger.warn({ err, productId: out.product.id }, 'Could not release stock alerts after a seller resumed a product');
      }
    }
    logger.info({ sellerId: seller.id, productId: out.product.id, available: input.available }, 'Seller changed product availability');
  }
  return {
    product: { id: out.product.id, name: out.product.name, is_active: out.product.is_active, is_available: input.available },
  };
}
