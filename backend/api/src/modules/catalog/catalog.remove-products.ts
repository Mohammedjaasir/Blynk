import type { Request, Response, NextFunction } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { mediaStorage, type MediaStorage } from '../../utils/storage.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { notifyCatalogChanged } from './catalog.events.js';
import {
  clearProductImageLinks,
  deleteProductImageFiles,
  imagesSummary,
  previewRemoveProductImages,
  type RemoveImagesPreview,
  type RemoveImagesResult,
} from './catalog.remove-images.js';

/**
 * Remove all products (owner, 2026-10-14: "remove all the existing products
 * and images" - the catalog is then re-loaded, without images, through the
 * Excel bulk upload).
 *
 * ADMIN only, like "Remove all product images" (catalog.remove-images.ts):
 * store-wide and destructive. Operations staff get 403.
 *
 * Nothing is hard-deleted. order_items and inventory reference products ON
 * DELETE RESTRICT, and an order still being packed or delivered needs its
 * product and stock rows, so every product is SOFT-deleted - the "ordered
 * before" branch of the single delete (catalog.delete.ts): deleted_at set,
 * is_active / is_available cleared. v_product_catalog skips deleted rows, so
 * the products leave the customer catalog, search, shelves and staff lists;
 * order creation refuses them; the edit endpoints 404 on them. SKU and slug
 * are unique only among live rows (migration 017), so the bulk upload can
 * re-create the same SKUs straight away.
 *
 * In ONE transaction (live products locked FOR UPDATE first, so an order
 * being placed for one of them either commits before or is refused after):
 *  - products: every live one soft-deleted.
 *  - product_variants (migration 045): every live variant of those products
 *    soft-deleted the same way (deleted_at, is_active / is_available off), so
 *    a variant SKU can be re-imported too.
 *  - combos (migration 033): every active combo holding one of them is
 *    switched off (is_active = false). Its items are kept for the record.
 *  - promotions (home carousel): every ACTIVE banner whose button opens one of
 *    these products is switched off. Chosen over re-pointing it at the whole
 *    catalog: a banner made for one product would otherwise keep advertising
 *    something that no longer exists. Staff can re-point and re-enable it.
 *    The hero banner / promo band settings are not touched (settings stay as
 *    they are): a deleted target already falls back to the app's own button
 *    (hero-banner.ts / promo-band.ts); the preview counts them.
 *  - stock_alerts (migration 022): "notify me" subscriptions for them deleted.
 *  - also_remove_images (default true): exactly "Remove all product images"
 *    - every product (soft-deleted ones too) and combo image link cleared;
 *    after commit the unused uploaded files under products/ are deleted.
 * Untouched: categories, category groups, settings, orders (items keep their
 * name/SKU/unit/price snapshots), inventory rows and their ledger, customers,
 * riders.
 *
 * Open orders: nothing they need changes. Order reads (customer, Ops, Rider)
 * use the order_items snapshots, never the live product; packing deducts from
 * the inventory rows, which stay; a soft-deleted variant is still the row an
 * item's variant_id points at. The preview reports how many open orders hold
 * one of these products.
 *
 * Audited once (PRODUCTS_REMOVED_ALL) with the counts. Idempotent: a second
 * run finds no live product and changes nothing. Open customer apps refresh:
 * the migration 011 / 033 / 045 triggers NOTIFY catalog_changed on commit, and
 * the API also queues a catalog event itself (catalog.events.ts).
 *
 * GET  /admin/products/remove-all/preview -> the counts (dry run)
 * POST /admin/products/remove-all {confirm: "DELETE ALL PRODUCTS", also_remove_images?: boolean}
 */

export const REMOVE_ALL_PRODUCTS_CONFIRM = 'DELETE ALL PRODUCTS';
export const removeAllProductsSchema = z.object({
  confirm: z.literal(REMOVE_ALL_PRODUCTS_CONFIRM, {
    errorMap: () => ({ message: `Type ${REMOVE_ALL_PRODUCTS_CONFIRM} to confirm` }),
  }),
  also_remove_images: z.boolean({ invalid_type_error: 'also_remove_images must be true or false' }).default(true),
});

type Executor = Kysely<Database> | Transaction<Database>;

/** Orders still in progress (users/account.service.ts FINAL_ORDER_STATUSES is the complement). */
const FINAL_ORDER_STATUSES = ['DELIVERED', 'CANCELLED', 'FAILED'] as const;
/** system_configurations keys whose button may open a product (hero-banner.ts, promo-band.ts). */
const BANNER_SETTING_KEYS = ['hero_banner', 'promo_band'];

const n = (v: unknown) => Number(v ?? 0);

export interface RemoveAllProductsPreview {
  /** Live (not yet deleted) products. */
  products: number;
  /** Their live variants. */
  variants: number;
  /** Live products with an image link. */
  products_with_images: number;
  /** Active combo packs holding one of them (switched off). */
  combos: number;
  /** Active home carousel banners opening one of them (switched off). */
  promotions: number;
  /** Hero banner / promo band settings opening one of them (left as they are; they fall back on their own). */
  banners_linked: number;
  /** "Notify me when it's back" subscriptions for them (cleared). */
  stock_alerts: number;
  /** Orders not yet delivered/cancelled/failed that hold one of them (kept, still fulfillable). */
  open_orders: number;
  /** Distinct products in those orders. */
  products_in_open_orders: number;
  /** What also_remove_images would clear (the "Remove all product images" dry run). */
  images: RemoveImagesPreview;
}

export async function previewRemoveAllProducts(
  opts: { executor?: Executor; storage?: MediaStorage } = {}
): Promise<RemoveAllProductsPreview> {
  const executor = opts.executor ?? db;
  const counts = await sql<{
    products: string;
    variants: string;
    products_with_images: string;
    combos: string;
    promotions: string;
    banners_linked: string;
    stock_alerts: string;
    open_orders: string;
    products_in_open_orders: string;
  }>`
    WITH live AS (SELECT id, image_url FROM products WHERE deleted_at IS NULL),
    open_items AS (
      SELECT oi.order_id, oi.product_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id IN (SELECT id FROM live)
        AND o.order_status::text NOT IN (${sql.join(FINAL_ORDER_STATUSES.map((s) => sql`${s}`))})
    )
    SELECT
      (SELECT count(*) FROM live) AS products,
      (SELECT count(*) FROM product_variants v WHERE v.deleted_at IS NULL AND v.product_id IN (SELECT id FROM live)) AS variants,
      (SELECT count(*) FROM live WHERE image_url IS NOT NULL) AS products_with_images,
      (SELECT count(*) FROM combos c WHERE c.deleted_at IS NULL AND c.is_active
          AND EXISTS (SELECT 1 FROM combo_items ci WHERE ci.combo_id = c.id AND ci.product_id IN (SELECT id FROM live))) AS combos,
      (SELECT count(*) FROM promotions pr WHERE pr.is_active AND pr.cta_destination_type = 'PRODUCT'
          AND pr.cta_destination_value IN (SELECT id::text FROM live)) AS promotions,
      (SELECT count(*) FROM system_configurations cfg
          WHERE cfg.key IN (${sql.join(BANNER_SETTING_KEYS.map((k) => sql`${k}`))})
            AND cfg.value->>'cta_destination_type' = 'PRODUCT'
            AND cfg.value->>'cta_destination_value' IN (SELECT id::text FROM live)) AS banners_linked,
      (SELECT count(*) FROM stock_alerts sa WHERE sa.product_id IN (SELECT id FROM live)) AS stock_alerts,
      (SELECT count(DISTINCT order_id) FROM open_items) AS open_orders,
      (SELECT count(DISTINCT product_id) FROM open_items) AS products_in_open_orders
  `.execute(executor);
  const row = counts.rows[0]!;
  return {
    products: n(row.products),
    variants: n(row.variants),
    products_with_images: n(row.products_with_images),
    combos: n(row.combos),
    promotions: n(row.promotions),
    banners_linked: n(row.banners_linked),
    stock_alerts: n(row.stock_alerts),
    open_orders: n(row.open_orders),
    products_in_open_orders: n(row.products_in_open_orders),
    images: await previewRemoveProductImages({ executor, storage: opts.storage }),
  };
}

export interface RemoveAllProductsResult {
  products_removed: number;
  variants_removed: number;
  combos_switched_off: number;
  promotions_switched_off: number;
  stock_alerts_cleared: number;
  /** Open orders holding a removed product: untouched and still fulfillable. */
  open_orders_kept: number;
  /** The image wipe's counts, or null when also_remove_images was false. */
  images: RemoveImagesResult | null;
}

/**
 * Soft-deletes every live product and tidies what pointed at them (one
 * transaction), then deletes the image files and audits. With opts.executor
 * a caller-owned transaction is used as is (tests roll it back); otherwise the
 * DB work commits before any file is removed, so a failed write never leaves
 * a product pointing at a deleted file.
 */
export async function removeAllProducts(
  actor: AuditActor,
  input: { alsoRemoveImages?: boolean } = {},
  opts: { executor?: Executor; storage?: MediaStorage } = {}
): Promise<RemoveAllProductsResult> {
  const storage = opts.storage ?? mediaStorage;
  const alsoRemoveImages = input.alsoRemoveImages ?? true;

  const apply = async (trx: Executor) => {
    // FOR UPDATE: an order being placed takes a KEY SHARE lock on its
    // products (order_items FK), so it either commits first (and is counted
    // as open below) or waits and is then refused (product inactive).
    const live = await trx
      .selectFrom('products')
      .select('id')
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .forUpdate()
      .execute();
    const ids = live.map((p) => p.id);
    const now = new Date();
    const inIds = (col: string) => sql<boolean>`${sql.ref(col)} = ANY(${ids}::uuid[])`;

    let variants = 0;
    let combos = 0;
    let promotions = 0;
    let alerts = 0;
    let openOrders = 0;
    if (ids.length) {
      const openRow = await trx
        .selectFrom('order_items as oi')
        .innerJoin('orders as o', 'o.id', 'oi.order_id')
        .select(sql<string>`count(DISTINCT oi.order_id)`.as('n'))
        .where(inIds('oi.product_id'))
        .where(sql<boolean>`o.order_status::text NOT IN (${sql.join(FINAL_ORDER_STATUSES.map((s) => sql`${s}`))})`)
        .executeTakeFirst();
      openOrders = n(openRow?.n);

      variants = n(
        (
          await trx
            .updateTable('product_variants')
            .set({ deleted_at: now, is_active: false, is_available: false, updated_at: now })
            .where(inIds('product_id'))
            .where('deleted_at', 'is', null)
            .executeTakeFirst()
        ).numUpdatedRows
      );

      combos = n(
        (
          await trx
            .updateTable('combos')
            .set({ is_active: false, updated_at: now })
            .where('deleted_at', 'is', null)
            .where('is_active', '=', true)
            .where((eb) => eb.exists(eb.selectFrom('combo_items as ci').select('ci.combo_id').whereRef('ci.combo_id', '=', 'combos.id').where(inIds('ci.product_id'))))
            .executeTakeFirst()
        ).numUpdatedRows
      );

      promotions = n(
        (
          await trx
            .updateTable('promotions')
            .set({ is_active: false, updated_at: now })
            .where('is_active', '=', true)
            .where('cta_destination_type', '=', 'PRODUCT')
            .where(sql<boolean>`cta_destination_value = ANY(${ids}::text[])`)
            .executeTakeFirst()
        ).numUpdatedRows
      );

      alerts = n((await trx.deleteFrom('stock_alerts').where(inIds('product_id')).executeTakeFirst()).numDeletedRows);

      await trx
        .updateTable('products')
        .set({ deleted_at: now, is_active: false, is_available: false, updated_at: now })
        .where(inIds('id'))
        .where('deleted_at', 'is', null)
        .execute();
    }

    const images = alsoRemoveImages ? await clearProductImageLinks(trx, storage) : null;
    return { products: ids.length, variants, combos, promotions, alerts, openOrders, images };
  };

  const finish = async (executor: Executor, done: Awaited<ReturnType<typeof apply>>): Promise<RemoveAllProductsResult> => {
    const images = done.images ? imagesSummary(done.images, await deleteProductImageFiles(executor, done.images.keys, storage)) : null;
    const result: RemoveAllProductsResult = {
      products_removed: done.products,
      variants_removed: done.variants,
      combos_switched_off: done.combos,
      promotions_switched_off: done.promotions,
      stock_alerts_cleared: done.alerts,
      open_orders_kept: done.openOrders,
      images,
    };
    await writeAudit(executor, actor, {
      action: 'PRODUCTS_REMOVED_ALL',
      entityType: 'PRODUCT',
      entityId: SETTINGS_ENTITY_ID,
      newValues: { ...result, also_remove_images: alsoRemoveImages },
    });
    return result;
  };

  let result: RemoveAllProductsResult;
  if (opts.executor) {
    result = await finish(opts.executor, await apply(opts.executor));
  } else {
    const done = await db.transaction().execute((trx) => apply(trx));
    result = await finish(db, done);
    // The triggers already NOTIFY on commit; this also reaches this
    // instance's open apps if the LISTEN connection is down.
    const imagesChanged = done.images ? done.images.productsCleared + done.images.combosCleared > 0 : false;
    if (done.products > 0 || imagesChanged) notifyCatalogChanged('products');
  }
  logger.info({ ...result, actorId: actor.actorId }, 'All products removed');
  return result;
}

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const removeAllProductsController = {
  async preview(_req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, data: await previewRemoveAllProducts() });
    } catch (err) {
      next(err);
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const body = removeAllProductsSchema.parse(req.body ?? {});
      res.status(200).json({ success: true, data: await removeAllProducts(actorOf(req), { alsoRemoveImages: body.also_remove_images }) });
    } catch (err) {
      next(err);
    }
  },
};
