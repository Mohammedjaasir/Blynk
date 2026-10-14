import type { Request, Response, NextFunction } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { mediaStorage, type MediaStorage } from '../../utils/storage.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Remove all product images (owner decision, 2026-10-14: clear every
 * product's image link AND delete the uploaded image files).
 *
 * ADMIN only - unlike the rest of the catalog (ADMIN + OPERATIONS) - because
 * it is destructive, store-wide and cannot be undone: the photos are gone
 * from disk, so the only way back is re-uploading every one. Operations staff
 * run day-to-day catalog work; an irreversible wipe of everyone's work stays
 * with the owner's Admin account.
 *
 * What it touches:
 *  - products (every row, soft-deleted ones too, since those can be
 *    restored): image_url -> null, image_focal_x/y -> 50 (the columns are
 *    NOT NULL; 50/50 is their default, the centre).
 *  - combos (combo packs, migration 033 - sold like products and their photo
 *    is uploaded to the same products/ folder): image_url -> null. There is
 *    no variants table.
 *  - NOT category images, promotion images or doctor photos.
 *  - Files: only those a cleared product/combo URL pointed at under
 *    /uploads/products/ (one flat file name), deleted through the media
 *    storage helper with its MEDIA_ROOT containment check, and only when no
 *    category, promotion or doctor still uses the same file. Nothing outside
 *    MEDIA_ROOT/products is ever touched; external URLs are just unlinked.
 *  - Audited once (PRODUCT_IMAGES_REMOVED_ALL) with the counts.
 *  - Idempotent: a second run finds nothing and changes nothing.
 *
 * GET  /admin/products/remove-images/preview -> the counts (dry run)
 * POST /admin/products/remove-images {confirm: "REMOVE"} -> does it
 */

export const REMOVE_CONFIRM_WORD = 'REMOVE';
export const removeImagesSchema = z.object({
  confirm: z.literal(REMOVE_CONFIRM_WORD, {
    errorMap: () => ({ message: `Type ${REMOVE_CONFIRM_WORD} to confirm` }),
  }),
});

type Executor = Kysely<Database> | Transaction<Database>;

/** A key this tool may delete: products/<one file name>, nothing nested, nothing else. */
const PRODUCT_FILE_KEY = /^products\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function productFileKey(storage: MediaStorage, url: string): string | null {
  const key = storage.keyFromUrl(url);
  if (!key || !PRODUCT_FILE_KEY.test(key) || key.includes('..')) return null;
  return key;
}

/** Whether a category, promotion or doctor (not cleared by this tool) still uses the file. */
async function fileUsedElsewhere(executor: Executor, url: string, key: string): Promise<boolean> {
  const suffix = `%/uploads/${key.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
  const matches = (col: string) => sql`(${sql.ref(col)} = ${url} OR ${sql.ref(col)} LIKE ${suffix})`;
  const row = await sql<{ used: boolean }>`
    SELECT EXISTS (SELECT 1 FROM categories WHERE ${matches('image_url')})
        OR EXISTS (SELECT 1 FROM promotions WHERE ${matches('image_url')} OR ${matches('background_image_url')})
        OR EXISTS (SELECT 1 FROM doctors WHERE ${matches('photo_url')})
        OR EXISTS (SELECT 1 FROM products WHERE ${matches('image_url')})
        OR EXISTS (SELECT 1 FROM combos WHERE ${matches('image_url')}) AS used
  `.execute(executor);
  return Boolean(row.rows[0]?.used);
}

async function imageRows(executor: Executor) {
  const [products, combos] = await Promise.all([
    executor.selectFrom('products').select(['id', 'image_url']).where('image_url', 'is not', null).execute(),
    executor.selectFrom('combos').select(['id', 'image_url']).where('image_url', 'is not', null).execute(),
  ]);
  return { products, combos };
}

function distinctKeys(storage: MediaStorage, urls: string[]) {
  const byKey = new Map<string, string>();
  for (const url of urls) {
    const key = productFileKey(storage, url);
    if (key && !byKey.has(key)) byKey.set(key, url);
  }
  return byKey;
}

export interface RemoveImagesPreview {
  products: number;
  combos: number;
  /** Distinct uploaded files under products/ those links point at. */
  files: number;
  /** Of those, how many exist on disk right now. */
  files_on_disk: number;
  /** Links to other places (not our uploads) that are only unlinked. */
  external_links: number;
}

export async function previewRemoveProductImages(
  opts: { executor?: Executor; storage?: MediaStorage } = {}
): Promise<RemoveImagesPreview> {
  const executor = opts.executor ?? db;
  const storage = opts.storage ?? mediaStorage;
  const { products, combos } = await imageRows(executor);
  const urls = [...products, ...combos].map((r) => r.image_url!).filter(Boolean);
  const keys = distinctKeys(storage, urls);
  let onDisk = 0;
  for (const key of keys.keys()) if (await storage.exists(key)) onDisk += 1;
  return {
    products: products.length,
    combos: combos.length,
    files: keys.size,
    files_on_disk: onDisk,
    external_links: urls.filter((u) => !productFileKey(storage, u)).length,
  };
}

export interface RemoveImagesResult {
  products_cleared: number;
  combos_cleared: number;
  files_deleted: number;
  /** Referenced files that were already gone. */
  files_missing: number;
  /** Files kept because a category, promotion or doctor still shows them. */
  files_kept_in_use: number;
}

/**
 * Clears the links (one transaction, audited) and then deletes the files.
 * With opts.executor a caller-owned transaction is used as is (tests roll it
 * back); otherwise the DB work commits before any file is removed, so a
 * failed write never leaves products pointing at deleted files.
 */
export async function removeAllProductImages(
  actor: AuditActor,
  opts: { executor?: Executor; storage?: MediaStorage } = {}
): Promise<RemoveImagesResult> {
  const storage = opts.storage ?? mediaStorage;

  const clear = async (trx: Executor) => {
    const { products, combos } = await imageRows(trx);
    const urls = [...products, ...combos].map((r) => r.image_url!).filter(Boolean);
    if (products.length) {
      await trx
        .updateTable('products')
        .set({ image_url: null, image_focal_x: 50, image_focal_y: 50, updated_at: new Date() })
        .where('image_url', 'is not', null)
        .execute();
    }
    if (combos.length) {
      await trx.updateTable('combos').set({ image_url: null, updated_at: new Date() }).where('image_url', 'is not', null).execute();
    }
    return { productsCleared: products.length, combosCleared: combos.length, keys: distinctKeys(storage, urls) };
  };

  const deleteFiles = async (executor: Executor, keys: Map<string, string>) => {
    let deleted = 0;
    let missing = 0;
    let kept = 0;
    for (const [key, url] of keys) {
      try {
        if (await fileUsedElsewhere(executor, url, key)) {
          kept += 1;
          continue;
        }
        if (!(await storage.exists(key))) {
          missing += 1;
          continue;
        }
        await storage.delete(key);
        deleted += 1;
      } catch (err) {
        // One unreadable file must not stop the rest; it stays on disk.
        logger.warn({ err, key }, 'Remove product images: could not delete a file');
        kept += 1;
      }
    }
    return { deleted, missing, kept };
  };

  const audit = async (executor: Executor, result: RemoveImagesResult) => {
    await writeAudit(executor, actor, {
      action: 'PRODUCT_IMAGES_REMOVED_ALL',
      entityType: 'PRODUCT',
      entityId: SETTINGS_ENTITY_ID,
      newValues: { ...result },
    });
  };

  let result: RemoveImagesResult;
  if (opts.executor) {
    const cleared = await clear(opts.executor);
    const files = await deleteFiles(opts.executor, cleared.keys);
    result = summary(cleared, files);
    await audit(opts.executor, result);
  } else {
    const cleared = await db.transaction().execute((trx) => clear(trx));
    const files = await deleteFiles(db, cleared.keys);
    result = summary(cleared, files);
    await audit(db, result);
  }
  logger.info({ ...result, actorId: actor.actorId }, 'All product images removed');
  return result;
}

function summary(
  cleared: { productsCleared: number; combosCleared: number },
  files: { deleted: number; missing: number; kept: number }
): RemoveImagesResult {
  return {
    products_cleared: cleared.productsCleared,
    combos_cleared: cleared.combosCleared,
    files_deleted: files.deleted,
    files_missing: files.missing,
    files_kept_in_use: files.kept,
  };
}

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const removeImagesController = {
  async preview(_req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, data: await previewRemoveProductImages() });
    } catch (err) {
      next(err);
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      removeImagesSchema.parse(req.body ?? {});
      res.status(200).json({ success: true, data: await removeAllProductImages(actorOf(req)) });
    } catch (err) {
      next(err);
    }
  },
};
