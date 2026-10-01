import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { mediaStorage } from '../../utils/storage.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Deleting products and categories (migration 017).
 *
 * Product: never ordered -> the row goes, with its inventory rows (whose
 * ledger entries cascade). Ordered at least once -> soft delete: deleted_at
 * set, is_active/is_available cleared. v_product_catalog skips deleted rows,
 * so the product leaves the customer catalog, search, shelves and every staff
 * list; order creation already refuses an inactive product; and the edit
 * endpoints 404 on it, so it can never be switched back on.
 *
 * Category: empty -> deleted. With live products -> the caller must name a
 * category to move them to (409 CATEGORY_NOT_EMPTY otherwise); every product
 * (soft-deleted ones too, which still reference it) moves, then the category
 * is deleted. Only soft-deleted products left -> the category is soft-deleted,
 * since those rows must keep a category and must not surface elsewhere.
 *
 * Either way the migration 011 triggers NOTIFY catalog_changed, so open
 * customer apps refresh straight away.
 */

export type DeleteMode = 'HARD' | 'SOFT';

export async function deleteProduct(productId: string, actor: AuditActor) {
  const result = await db.transaction().execute(async (trx) => {
    // FOR UPDATE: an order being placed for this product takes a KEY SHARE
    // lock on it (the order_items FK), so the check below cannot miss an
    // order committed in between.
    const product = await trx
      .selectFrom('products')
      .select(['id', 'name', 'sku', 'image_url'])
      .where('id', '=', productId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

    const ordered = await trx
      .selectFrom('order_items')
      .select('id')
      .where('product_id', '=', productId)
      .limit(1)
      .executeTakeFirst();
    const sourced = ordered
      ? ordered
      : await trx
          .selectFrom('sourcing_records')
          .select('id')
          .where('product_id', '=', productId)
          .limit(1)
          .executeTakeFirst();

    let mode: DeleteMode;
    if (sourced) {
      await trx
        .updateTable('products')
        .set({ deleted_at: new Date(), is_active: false, is_available: false, updated_at: new Date() })
        .where('id', '=', productId)
        .execute();
      mode = 'SOFT';
    } else {
      // inventory_adjustments cascade from inventory (migration 001).
      await trx.deleteFrom('inventory').where('product_id', '=', productId).execute();
      await trx.deleteFrom('products').where('id', '=', productId).execute();
      mode = 'HARD';
    }

    await writeAudit(trx, actor, {
      action: 'PRODUCT_DELETED',
      entityType: 'PRODUCT',
      entityId: productId,
      oldValues: { name: product.name, sku: product.sku },
      newValues: { mode },
    });

    return { mode, imageUrl: product.image_url };
  });

  if (result.mode === 'HARD' && result.imageUrl) {
    await removeUnusedImage(result.imageUrl);
  }

  logger.info({ productId, mode: result.mode }, 'Product deleted');
  return { product_id: productId, mode: result.mode };
}

/**
 * Removes an uploaded photo once nothing points at it any more. Best effort:
 * a leftover file costs disk space, never correctness.
 */
async function removeUnusedImage(url: string) {
  const key = mediaStorage.keyFromUrl(url);
  if (!key) return;
  try {
    const stillUsed = await db
      .selectNoFrom((eb) => [
        eb
          .exists(eb.selectFrom('products').select('id').where('image_url', '=', url))
          .as('in_products'),
        eb
          .exists(eb.selectFrom('categories').select('id').where('image_url', '=', url))
          .as('in_categories'),
        eb
          .exists(
            eb
              .selectFrom('promotions as pr')
              .select('pr.id')
              .where(sql<boolean>`strpos(to_jsonb(pr)::text, ${url}) > 0`)
          )
          .as('in_promotions'),
      ])
      .executeTakeFirstOrThrow();
    if (stillUsed.in_products || stillUsed.in_categories || stillUsed.in_promotions) return;
    await mediaStorage.delete(key);
  } catch (err) {
    logger.warn({ err, url }, 'Could not remove the deleted product photo; leaving it in place');
  }
}

export async function deleteCategory(categoryId: string, moveToCategoryId: string | undefined, actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const category = await trx
      .selectFrom('categories')
      .select(['id', 'name', 'slug'])
      .where('id', '=', categoryId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!category) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');

    if (moveToCategoryId !== undefined) {
      const target =
        moveToCategoryId === categoryId
          ? undefined
          : await trx
              .selectFrom('categories')
              .select('id')
              .where('id', '=', moveToCategoryId)
              .where('deleted_at', 'is', null)
              .forShare()
              .executeTakeFirst();
      if (!target) {
        throw new AppError(
          'Choose another existing category to move the products to.',
          400,
          'INVALID_MOVE_TARGET',
          { move_to_category_id: moveToCategoryId }
        );
      }
    }

    const counts = await trx
      .selectFrom('products')
      .select([
        sql<number>`count(*) FILTER (WHERE deleted_at IS NULL)::int`.as('live'),
        sql<number>`count(*)::int`.as('total'),
      ])
      .where('category_id', '=', categoryId)
      .executeTakeFirstOrThrow();
    const live = Number(counts.live);
    const total = Number(counts.total);

    if (live > 0 && moveToCategoryId === undefined) {
      throw new AppError(
        `This category still has ${live} product${live === 1 ? '' : 's'}. Choose a category to move ${live === 1 ? 'it' : 'them'} to.`,
        409,
        'CATEGORY_NOT_EMPTY',
        { product_count: live }
      );
    }

    let mode: DeleteMode;
    if (moveToCategoryId !== undefined && total > 0) {
      await trx
        .updateTable('products')
        .set({ category_id: moveToCategoryId, updated_at: new Date() })
        .where('category_id', '=', categoryId)
        .execute();
    }

    if (moveToCategoryId === undefined && total > 0) {
      // Only soft-deleted products are left: they keep this category, hidden.
      await trx
        .updateTable('categories')
        .set({ deleted_at: new Date(), is_active: false, updated_at: new Date() })
        .where('id', '=', categoryId)
        .execute();
      mode = 'SOFT';
    } else {
      await trx.deleteFrom('categories').where('id', '=', categoryId).execute();
      mode = 'HARD';
    }

    const moved = moveToCategoryId !== undefined ? live : 0;
    await writeAudit(trx, actor, {
      action: 'CATEGORY_DELETED',
      entityType: 'CATEGORY',
      entityId: categoryId,
      oldValues: { name: category.name, slug: category.slug },
      newValues: { mode, moved_product_count: moved, move_to_category_id: moveToCategoryId ?? null },
    });

    logger.info({ categoryId, mode, moved, moveToCategoryId }, 'Category deleted');
    return { category_id: categoryId, moved_product_count: moved, mode };
  });
}
