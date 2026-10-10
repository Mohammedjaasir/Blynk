import type { Request, Response, NextFunction } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Arrange (owner, 2026-10-10): "in the down category like grocery, egg,
 * milk - ops and admin can decide which should be shown first".
 *
 * 1. CATEGORY ORDER - PUT /admin/categories/order {ids}. The ids are one set
 *    of siblings: all top-level categories, or the sub-categories of one
 *    parent. Their display_order is rewritten 10, 20, 30... in the listed
 *    order, in one transaction. A live sibling the list leaves out (say one
 *    added on another screen meanwhile) is kept, after the listed ones in its
 *    current order, so no two siblings share a position afterwards. The
 *    customer GET /categories and every home group (GET /catalog/home-groups,
 *    "More" included) order by display_order, name: Arrange overrides the
 *    category groups' own order (owner, 2026-10-10).
 *
 * 2. PRODUCT ORDER - GET/PUT /admin/categories/:id/product-order. The scope is
 *    the category and its live sub-categories (the products a customer sees
 *    on that category's page, migration 026). PUT {product_ids} gives the
 *    listed products display_order 1..n; every other product in the scope
 *    goes back to NULL (not arranged: after the arranged ones, A-Z).
 *    Customer lists order by display_order NULLS LAST, then name
 *    (migration 035).
 *
 * Both writes are audited (entity_type CATEGORY); products and categories
 * NOTIFY catalog_changed (migration 011), so open customer apps refresh.
 */

const uuid = z.string().uuid('Invalid id');
const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const categoryOrderSchema = z.object({
  ids: z.array(uuid).min(1, 'List at least one category').max(500).refine(uniqueIds, 'Each category may appear only once'),
});

export const productOrderSchema = z.object({
  product_ids: z.array(uuid).max(2000).refine(uniqueIds, 'Each product may appear only once'),
});

/** The gap between arranged categories, so a manual "Display order" can still slot one in between. */
export const CATEGORY_ORDER_STEP = 10;

/** Rewrites one set of siblings' display_order 10, 20, 30... in the listed order. */
export async function reorderCategories(ids: string[], actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const listed = await trx
      .selectFrom('categories')
      .select(['id', 'parent_id'])
      .where('id', 'in', ids)
      .where('deleted_at', 'is', null)
      .execute();
    if (listed.length !== ids.length) {
      const known = new Set(listed.map((c) => c.id));
      throw new AppError('Some of these categories do not exist.', 404, 'CATEGORY_NOT_FOUND', {
        missing: ids.filter((id) => !known.has(id)),
      });
    }
    const parents = new Set(listed.map((c) => c.parent_id ?? null));
    if (parents.size !== 1) {
      throw new AppError(
        'Arrange one level at a time: all top-level categories, or the sub-categories of one category.',
        400,
        'MIXED_CATEGORY_LEVELS'
      );
    }
    const parentId = listed[0].parent_id ?? null;

    // Every live sibling, locked, in its current order.
    let siblingsQuery = trx
      .selectFrom('categories')
      .select(['id', 'display_order'])
      .where('deleted_at', 'is', null)
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc')
      .forUpdate();
    siblingsQuery = parentId === null ? siblingsQuery.where('parent_id', 'is', null) : siblingsQuery.where('parent_id', '=', parentId);
    const siblings = await siblingsQuery.execute();

    const listedSet = new Set(ids);
    const finalOrder = [...ids, ...siblings.filter((s) => !listedSet.has(s.id)).map((s) => s.id)];

    await sql`
      UPDATE categories c
         SET display_order = (x.ord * ${CATEGORY_ORDER_STEP})::int, updated_at = now()
        FROM unnest(${finalOrder}::uuid[]) WITH ORDINALITY AS x(id, ord)
       WHERE c.id = x.id AND c.display_order IS DISTINCT FROM (x.ord * ${CATEGORY_ORDER_STEP})::int
    `.execute(trx);

    await writeAudit(trx, actor, {
      action: 'CATEGORIES_REORDERED',
      entityType: 'CATEGORY',
      // A sibling set has no single row; a sub-category set is its parent's.
      entityId: parentId ?? SETTINGS_ENTITY_ID,
      oldValues: { parent_id: parentId, ids: siblings.map((s) => s.id) },
      newValues: { parent_id: parentId, ids: finalOrder },
    });

    return await trx
      .selectFrom('categories')
      .select(['id', 'name', 'parent_id', 'display_order'])
      .where('id', 'in', finalOrder)
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc')
      .execute();
  });
}

/** The category's live sub-category ids, plus itself (migration 026: one level). */
function scopeCategoryIds(categoryId: string) {
  return db
    .selectFrom('categories')
    .select('id')
    .where('deleted_at', 'is', null)
    .where((eb) => eb.or([eb('id', '=', categoryId), eb('parent_id', '=', categoryId)]));
}

async function liveCategory(id: string) {
  const category = await db
    .selectFrom('categories')
    .select(['id', 'name', 'parent_id'])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!category) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
  return category;
}

export interface ArrangeProduct {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x: number;
  image_focal_y: number;
  /** The regular selling price (cost x markup), for recognising the row. */
  selling_price: number;
  is_active: boolean;
  is_available: boolean;
  display_order: number | null;
}

/** The category's products (its sub-categories' too) in the order customers see them. */
export async function listCategoryProductOrder(categoryId: string) {
  const category = await liveCategory(categoryId);
  const rows = await db
    .selectFrom('v_product_catalog')
    .select([
      'id',
      'name',
      'category_id',
      'category_name',
      'unit',
      'pack_size',
      'image_url',
      'image_focal_x',
      'image_focal_y',
      'calculated_selling_price',
      'is_active',
      'is_available',
      'display_order',
    ])
    .where('category_id', 'in', scopeCategoryIds(categoryId))
    .orderBy(sql`display_order`, sql`asc nulls last`)
    .orderBy('name', 'asc')
    .execute();

  const products: ArrangeProduct[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category_id: r.category_id,
    category_name: r.category_name,
    unit: r.unit,
    pack_size: r.pack_size,
    image_url: r.image_url,
    image_focal_x: Number(r.image_focal_x ?? 50),
    image_focal_y: Number(r.image_focal_y ?? 50),
    selling_price: Number(r.calculated_selling_price),
    is_active: r.is_active,
    is_available: r.is_available,
    display_order: r.display_order ?? null,
  }));
  return { category, products };
}

/** Listed products get display_order 1..n; the scope's other products go back to NULL. */
export async function setCategoryProductOrder(categoryId: string, productIds: string[], actor: AuditActor) {
  await liveCategory(categoryId);
  await db.transaction().execute(async (trx) => {
    const scope = await trx
      .selectFrom('products')
      .select(['id', 'display_order'])
      .where('deleted_at', 'is', null)
      .where('category_id', 'in', scopeCategoryIds(categoryId))
      .orderBy(sql`display_order`, sql`asc nulls last`)
      .orderBy('name', 'asc')
      .forUpdate()
      .execute();
    const inScope = new Set(scope.map((p) => p.id));
    const outside = productIds.filter((id) => !inScope.has(id));
    if (outside.length) {
      throw new AppError('Some of these products are not in this category.', 400, 'PRODUCT_NOT_IN_CATEGORY', {
        product_ids: outside,
      });
    }

    const listed = new Set(productIds);
    const unlisted = scope.filter((p) => !listed.has(p.id) && p.display_order !== null).map((p) => p.id);
    if (unlisted.length) {
      await trx
        .updateTable('products')
        .set({ display_order: null, updated_at: new Date() })
        .where('id', 'in', unlisted)
        .execute();
    }
    if (productIds.length) {
      await sql`
        UPDATE products p
           SET display_order = x.ord::int, updated_at = now()
          FROM unnest(${productIds}::uuid[]) WITH ORDINALITY AS x(id, ord)
         WHERE p.id = x.id AND p.display_order IS DISTINCT FROM x.ord::int
      `.execute(trx);
    }

    await writeAudit(trx, actor, {
      action: 'CATEGORY_PRODUCTS_REORDERED',
      entityType: 'CATEGORY',
      entityId: categoryId,
      oldValues: { product_ids: scope.filter((p) => p.display_order !== null).map((p) => p.id) },
      newValues: { product_ids: productIds },
    });
  });
  return await listCategoryProductOrder(categoryId);
}

// ----------------------------------------------------------------------------
// Controller
// ----------------------------------------------------------------------------
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const handle =
  (fn: (req: Request, res: Response) => Promise<void>): Handler =>
  async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

export const arrangeController = {
  /** PUT /admin/categories/order */
  reorderCategories: handle(async (req, res) => {
    const { ids } = categoryOrderSchema.parse(req.body);
    res.status(200).json({ success: true, data: { categories: await reorderCategories(ids, actorOf(req)) } });
  }),
  /** GET /admin/categories/:id/product-order */
  getProductOrder: handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listCategoryProductOrder(req.params.id as string) });
  }),
  /** PUT /admin/categories/:id/product-order */
  setProductOrder: handle(async (req, res) => {
    const { product_ids } = productOrderSchema.parse(req.body);
    res.status(200).json({
      success: true,
      data: await setCategoryProductOrder(req.params.id as string, product_ids, actorOf(req)),
    });
  }),
};
