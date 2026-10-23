import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { releaseStockAlertsNow } from '../notifications/push/push.events.js';
import { notifyCatalogChanged } from './catalog.events.js';

/**
 * Bulk on / off for products (owner, 2026-10-23: "some items I have added as 1 LKR priced ... make
 * all of them not available ... I am slowly making the images ... then I will enable them" and
 * "better here bulk select products and make them available or unavailable"). Staff tick products
 * in the Products list and switch the whole selection:
 *   is_active    false = hidden from customers entirely, true = shown again
 *   is_available false = shown greyed out ("Sold out"), true = orderable again
 * Either or both per call. Same effect as editing each product (a product that becomes orderable
 * releases its "notify me" customers), audited once as PRODUCTS_BULK_STATUS with the ids.
 *
 * PATCH /admin/products/bulk-status (ADMIN, OPERATIONS)  { ids, is_active?, is_available? }
 *   -> { matched, changed, switched_on }
 */
export const BULK_STATUS_MAX = 500;

export const bulkStatusSchema = z
  .object({
    ids: z.array(z.string().uuid('Unknown product')).min(1, 'Select at least one product').max(BULK_STATUS_MAX, `At most ${BULK_STATUS_MAX} at a time`),
    is_active: z.boolean().optional(),
    is_available: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.is_active !== undefined || v.is_available !== undefined, { message: 'Choose what to change' });
export type BulkStatusInput = z.infer<typeof bulkStatusSchema>;

export interface BulkStatusResult {
  matched: number;
  changed: number;
  /** Products that became orderable (active and available) because of this change. */
  switched_on: number;
}

export async function bulkSetProductStatus(input: BulkStatusInput, actor: AuditActor): Promise<BulkStatusResult> {
  const ids = [...new Set(input.ids)];
  const rows = await db
    .selectFrom('products')
    .select(['id', 'is_active', 'is_available'])
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute();
  if (rows.length === 0) throw new AppError('None of the selected products exist any more.', 404, 'PRODUCT_NOT_FOUND');

  const next = (r: (typeof rows)[number]) => ({
    is_active: input.is_active ?? r.is_active,
    is_available: input.is_available ?? r.is_available,
  });
  const changing = rows.filter((r) => {
    const n = next(r);
    return n.is_active !== r.is_active || n.is_available !== r.is_available;
  });
  const switchedOn = changing.filter((r) => !(r.is_active && r.is_available) && next(r).is_active && next(r).is_available).map((r) => r.id);

  if (changing.length > 0) {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('products')
        .set({
          ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
          ...(input.is_available !== undefined ? { is_available: input.is_available } : {}),
        })
        .where(
          'id',
          'in',
          changing.map((r) => r.id)
        )
        .execute();
      await writeAudit(trx, actor, {
        action: 'PRODUCTS_BULK_STATUS',
        entityType: 'PRODUCT',
        entityId: SETTINGS_ENTITY_ID,
        newValues: {
          ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
          ...(input.is_available !== undefined ? { is_available: input.is_available } : {}),
          product_ids: changing.map((r) => r.id),
        },
      });
    });
    notifyCatalogChanged('products');
    // Back in stock: tell the customers who asked, after the change commits; never fails it.
    for (const id of switchedOn) {
      try {
        await releaseStockAlertsNow(id);
      } catch (err) {
        logger.warn({ err, productId: id }, 'Could not release stock alerts after a bulk switch-on');
      }
    }
  }
  logger.info({ actorId: actor.actorId, matched: rows.length, changed: changing.length }, 'Products bulk status changed');
  return { matched: rows.length, changed: changing.length, switched_on: switchedOn.length };
}

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const bulkStatusController = {
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const input = bulkStatusSchema.parse(req.body);
      res.status(200).json({ success: true, data: await bulkSetProductStatus(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  },
};
