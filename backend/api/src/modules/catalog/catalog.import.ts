import { z } from 'zod';
import type { Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { lockInventoryRow, recordStockMovement } from '../inventory/stock-ledger.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { slugify } from './catalog.schema.js';
import { generateUniqueSlug } from './catalog.slugs.js';

/**
 * Bulk product import (Admin site and Ops app).
 *
 * The browser parses the .xlsx/.csv file and sends its rows as JSON; this
 * validates them against the same limits as the product form and applies
 * them. Decisions:
 *
 * - Idempotent on SKU. A SKU that already exists (live, not deleted) is
 *   UPDATED from the row; a row that would change nothing is SKIPPED. So
 *   importing the same file twice creates nothing the second time.
 * - On an update, blank optional cells (pack size, selling price, barcode,
 *   description, tracked, image URL) leave the stored value alone: a blank
 *   cell never wipes data. The required columns always apply.
 * - opening_stock only applies when the product is created. For an existing
 *   product stock moves through the Inventory screens (restock/adjust), so an
 *   import can never silently rewrite a count.
 * - The category must already exist (matched by name or slug, ignoring case);
 *   an import never invents categories from typos.
 * - Pricing uses the backend's own inputs: cost_price is the purchase cost;
 *   selling_price, when given, becomes the product's custom markup
 *   ((selling / cost - 1) * 100, 2 decimals - the stored price is recomputed
 *   from it and can differ by a cent). Blank means the store default markup.
 * - Every row runs in its own transaction: a bad row is reported and never
 *   blocks the others. dry_run validates against the database and reports
 *   what would happen without writing anything.
 */

export const MAX_IMPORT_ROWS = 1000;

export const importProductsSchema = z.object({
  rows: z
    .array(z.record(z.unknown()))
    .min(1, 'The file has no product rows.')
    .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} products at a time.`),
  dry_run: z.boolean().optional(),
});
export type ImportProductsInput = z.infer<typeof importProductsSchema>;

export type ImportStatus = 'created' | 'updated' | 'skipped' | 'error';

export interface ImportRowResult {
  row: number;
  sku: string | null;
  status: ImportStatus;
  product_id?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

interface CleanRow {
  row: number;
  name: string;
  category: string;
  unit: string;
  pack_size?: string;
  cost_price: number;
  selling_price?: number;
  sku: string;
  barcode?: string;
  description?: string;
  tracked?: boolean;
  opening_stock?: number;
  image_url?: string;
}

type FieldError = { field: string; message: string };

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A number cell: 1250, "1250", "1,250.50", "LKR 1250". NaN when present but unreadable. */
function numberCell(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const raw = text(value);
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/^lkr\s*/i, '').replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

function yesNo(value: unknown): boolean | undefined | null {
  if (typeof value === 'boolean') return value;
  const raw = text(value)?.toLowerCase();
  if (raw === undefined) return undefined;
  if (['yes', 'y', 'true', '1', 'tracked'].includes(raw)) return true;
  if (['no', 'n', 'false', '0', 'untracked'].includes(raw)) return false;
  return null; // present but unreadable
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hasAtMost2Decimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The product form's limits (catalog.schema.ts createProductSchema), per cell. */
export function validateImportRow(raw: Record<string, unknown>, index: number): { row: CleanRow | null; rowNo: number; sku: string | null; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const rowNoRaw = Number(raw.row);
  const rowNo = Number.isInteger(rowNoRaw) && rowNoRaw > 0 ? rowNoRaw : index + 2;

  const name = text(raw.name);
  const category = text(raw.category);
  const unit = text(raw.unit);
  const packSize = text(raw.pack_size);
  const sku = text(raw.sku);
  const barcode = text(raw.barcode);
  const description = text(raw.description);
  const imageUrl = text(raw.image_url);
  const cost = numberCell(raw.cost_price);
  const selling = numberCell(raw.selling_price);
  const tracked = yesNo(raw.tracked);
  const opening = numberCell(raw.opening_stock);

  if (!name) errors.push({ field: 'name', message: 'Name is required' });
  else if (name.length < 2) errors.push({ field: 'name', message: 'Name must be at least 2 characters' });
  else if (name.length > 255) errors.push({ field: 'name', message: 'Name must be at most 255 characters' });

  if (!category) errors.push({ field: 'category', message: 'Category is required' });

  if (!unit) errors.push({ field: 'unit', message: 'Unit is required' });
  else if (unit.length > 32) errors.push({ field: 'unit', message: 'Unit must be at most 32 characters' });

  if (packSize && packSize.length > 64) errors.push({ field: 'pack_size', message: 'Pack size must be at most 64 characters' });

  if (!sku) errors.push({ field: 'sku', message: 'SKU is required' });
  else if (sku.length < 3) errors.push({ field: 'sku', message: 'SKU must be at least 3 characters' });
  else if (sku.length > 64) errors.push({ field: 'sku', message: 'SKU must be at most 64 characters' });

  if (barcode && barcode.length > 64) errors.push({ field: 'barcode', message: 'Barcode must be at most 64 characters' });
  if (description && description.length > 2000) {
    errors.push({ field: 'description', message: 'Description must be at most 2000 characters' });
  }
  if (imageUrl && !isHttpUrl(imageUrl)) errors.push({ field: 'image_url', message: 'Image URL must be a valid http(s) URL' });

  if (cost === undefined) errors.push({ field: 'cost_price', message: 'Cost price is required' });
  else if (!Number.isFinite(cost)) errors.push({ field: 'cost_price', message: 'Cost price must be a number' });
  else if (cost < 0) errors.push({ field: 'cost_price', message: 'Cost price cannot be negative' });
  else if (cost > 99_999_999.99) errors.push({ field: 'cost_price', message: 'Cost price is too large' });
  else if (!hasAtMost2Decimals(cost)) errors.push({ field: 'cost_price', message: 'Cost price can have at most 2 decimals' });

  if (selling !== undefined) {
    if (!Number.isFinite(selling)) errors.push({ field: 'selling_price', message: 'Selling price must be a number' });
    else if (selling < 0) errors.push({ field: 'selling_price', message: 'Selling price cannot be negative' });
    else if (!hasAtMost2Decimals(selling)) errors.push({ field: 'selling_price', message: 'Selling price can have at most 2 decimals' });
    else if (cost !== undefined && Number.isFinite(cost) && cost >= 0) {
      if (selling < cost) errors.push({ field: 'selling_price', message: 'Selling price cannot be below the cost price' });
      else if (cost === 0 && selling > 0) {
        errors.push({ field: 'selling_price', message: 'Set a cost price above 0 to use a selling price' });
      } else if (cost > 0 && round2((selling / cost - 1) * 100) > 999.99) {
        errors.push({ field: 'selling_price', message: 'Selling price is more than 10 times the cost price' });
      }
    }
  }

  if (tracked === null) errors.push({ field: 'tracked', message: 'Tracked must be yes or no' });

  if (opening !== undefined) {
    if (!Number.isInteger(opening) || opening < 0) {
      errors.push({ field: 'opening_stock', message: 'Opening stock must be a whole number, 0 or more' });
    } else if (opening > 100_000) {
      errors.push({ field: 'opening_stock', message: 'Opening stock is too large' });
    } else if (opening > 0 && tracked !== true) {
      errors.push({ field: 'opening_stock', message: 'Opening stock needs tracked = yes' });
    }
  }

  if (errors.length > 0) return { row: null, rowNo, sku: sku ?? null, errors };
  return {
    rowNo,
    sku: sku!,
    errors,
    row: {
      row: rowNo,
      name: name!,
      category: category!,
      unit: unit!,
      pack_size: packSize,
      cost_price: cost!,
      selling_price: selling,
      sku: sku!,
      barcode,
      description,
      tracked: tracked ?? undefined,
      opening_stock: opening,
      image_url: imageUrl,
    },
  };
}

/** The custom markup a selling price stands for; undefined when none was given. */
function markupFor(row: CleanRow): number | undefined {
  if (row.selling_price === undefined) return undefined;
  if (row.cost_price === 0) return 0;
  return round2((row.selling_price / row.cost_price - 1) * 100);
}

// ---------------------------------------------------------------------------
// Applying rows
// ---------------------------------------------------------------------------

type ExistingProduct = {
  id: string;
  name: string;
  category_id: string;
  unit: string;
  pack_size: string | null;
  purchase_cost: number | string;
  custom_markup_percent: number | string | null;
  barcode: string | null;
  description: string | null;
  image_url: string | null;
  tracking_mode: string | null;
};

/** The product columns a row would change on an existing product (blank cells change nothing). */
function changesFor(row: CleanRow, categoryId: string, existing: ExistingProduct) {
  const changes: Record<string, unknown> = {};
  if (row.name !== existing.name) changes.name = row.name;
  if (categoryId !== existing.category_id) changes.category_id = categoryId;
  if (row.unit !== existing.unit) changes.unit = row.unit;
  if (row.pack_size !== undefined && row.pack_size !== existing.pack_size) changes.pack_size = row.pack_size;
  if (Number(existing.purchase_cost) !== row.cost_price) changes.purchase_cost = row.cost_price;
  const markup = markupFor(row);
  const currentMarkup = existing.custom_markup_percent === null ? null : Number(existing.custom_markup_percent);
  if (markup !== undefined && markup !== currentMarkup) changes.custom_markup_percent = markup;
  if (row.barcode !== undefined && row.barcode !== existing.barcode) changes.barcode = row.barcode;
  if (row.description !== undefined && row.description !== existing.description) changes.description = row.description;
  if (row.image_url !== undefined && row.image_url !== existing.image_url) changes.image_url = row.image_url;
  return changes;
}

function trackingChange(row: CleanRow, existing: ExistingProduct | undefined): 'TRACKED' | 'UNTRACKED' | null {
  if (row.tracked === undefined) return null;
  const want = row.tracked ? 'TRACKED' : 'UNTRACKED';
  const have = existing?.tracking_mode ?? 'UNTRACKED';
  return want === have ? null : want;
}

async function findExisting(executor: Transaction<Database> | typeof db, sku: string, lock: boolean) {
  let query = executor
    .selectFrom('products as p')
    .leftJoin('inventory as inv', (join) =>
      join.onRef('inv.product_id', '=', 'p.id').on('inv.dark_store_id', '=', DEFAULT_DARK_STORE_ID)
    )
    .select([
      'p.id',
      'p.name',
      'p.category_id',
      'p.unit',
      'p.pack_size',
      'p.purchase_cost',
      'p.custom_markup_percent',
      'p.barcode',
      'p.description',
      'p.image_url',
      'inv.tracking_mode',
    ])
    .where('p.sku', '=', sku)
    .where('p.deleted_at', 'is', null);
  if (lock) query = query.forUpdate(['p']);
  return (await query.executeTakeFirst()) as ExistingProduct | undefined;
}

async function slugTaken(executor: Transaction<Database> | typeof db, slug: string) {
  const hit = await executor
    .selectFrom('products')
    .select('id')
    .where('slug', '=', slug)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return !!hit;
}

async function setTracking(trx: Transaction<Database>, productId: string, mode: 'TRACKED' | 'UNTRACKED') {
  const existing = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, productId);
  if (existing) {
    await trx
      .updateTable('inventory')
      .set({ tracking_mode: mode, updated_at: new Date() })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await trx
      .insertInto('inventory')
      .values({ dark_store_id: DEFAULT_DARK_STORE_ID, product_id: productId, tracking_mode: mode })
      .execute();
  }
}

export async function importProducts(input: ImportProductsInput, actorId: string) {
  const dryRun = input.dry_run === true;

  const categories = await db
    .selectFrom('categories')
    .select(['id', 'name', 'slug'])
    .where('deleted_at', 'is', null)
    .execute();
  const categoryByKey = new Map<string, string>();
  for (const c of categories) {
    categoryByKey.set(c.slug.toLowerCase(), c.id);
    categoryByKey.set(c.name.trim().toLowerCase(), c.id);
  }

  const results: ImportRowResult[] = [];
  const seenSkus = new Map<string, number>();
  const slugsUsed = new Set<string>();

  for (const [index, raw] of input.rows.entries()) {
    const checked = validateImportRow(raw, index);
    const errors = [...checked.errors];
    const row = checked.row;

    let categoryId: string | undefined;
    if (row) {
      categoryId = categoryByKey.get(row.category.toLowerCase());
      if (!categoryId) errors.push({ field: 'category', message: `No category called '${row.category}'` });
      const firstRow = seenSkus.get(row.sku);
      if (firstRow !== undefined) {
        errors.push({ field: 'sku', message: `SKU ${row.sku} is already used on row ${firstRow} of this file` });
      }
    }
    if (checked.sku && !seenSkus.has(checked.sku)) seenSkus.set(checked.sku, checked.rowNo);

    if (!row || errors.length > 0 || !categoryId) {
      results.push({ row: checked.rowNo, sku: checked.sku, status: 'error', message: errors[0]?.message, errors });
      continue;
    }

    try {
      const outcome = dryRun
        ? await planRow(row, categoryId, slugsUsed)
        : await db.transaction().execute((trx) => applyRow(trx, row, categoryId!, slugsUsed, actorId));
      results.push({ row: row.row, sku: row.sku, ...outcome });
    } catch (err) {
      const message =
        err instanceof AppError
          ? err.message
          : (err as { code?: string }).code === '23505'
            ? 'Another product already uses this SKU or name (try again, or change the SKU)'
            : 'This row could not be saved';
      if (!(err instanceof AppError)) logger.warn({ err, row: row.row, sku: row.sku }, 'Product import row failed');
      results.push({ row: row.row, sku: row.sku, status: 'error', message, errors: [{ field: 'row', message }] });
    }
  }

  const summary = { created: 0, updated: 0, skipped: 0, errors: 0 };
  for (const r of results) {
    if (r.status === 'error') summary.errors += 1;
    else summary[r.status] += 1;
  }
  logger.info({ ...summary, dryRun, actorId, rows: input.rows.length }, 'Product import processed');
  return { dry_run: dryRun, summary, results };
}

/** Picks a free slug for a new product: the name, else name + SKU. */
async function pickSlug(executor: Transaction<Database> | typeof db, row: CleanRow, slugsUsed: Set<string>) {
  for (const candidate of [slugify(row.name), slugify(`${row.name}-${row.sku}`)]) {
    if (!candidate || candidate.length > 255) continue;
    if (slugsUsed.has(candidate)) continue;
    if (await slugTaken(executor, candidate)) continue;
    return candidate;
  }
  // A Sinhala/Tamil name slugifies to nothing, or both are taken: a fallback
  // ("product-<random>" or "<name>-2", ...) rather than failing the row.
  return generateUniqueSlug(row.name, 'product', async (s) => slugsUsed.has(s) || (await slugTaken(executor, s)), 255);
}

async function planRow(row: CleanRow, categoryId: string, slugsUsed: Set<string>) {
  const existing = await findExisting(db, row.sku, false);
  if (!existing) {
    slugsUsed.add(await pickSlug(db, row, slugsUsed));
    return { status: 'created' as const };
  }
  const changed = Object.keys(changesFor(row, categoryId, existing)).length > 0 || trackingChange(row, existing) !== null;
  return {
    status: changed ? ('updated' as const) : ('skipped' as const),
    product_id: existing.id,
    ...(row.opening_stock ? { message: 'Opening stock is ignored for an existing product' } : {}),
  };
}

async function applyRow(trx: Transaction<Database>, row: CleanRow, categoryId: string, slugsUsed: Set<string>, actorId: string) {
  const existing = await findExisting(trx, row.sku, true);

  if (!existing) {
    const slug = await pickSlug(trx, row, slugsUsed);
    const markup = markupFor(row);
    const created = await trx
      .insertInto('products')
      .values({
        category_id: categoryId,
        name: row.name,
        slug,
        sku: row.sku,
        barcode: row.barcode ?? null,
        unit: row.unit,
        pack_size: row.pack_size ?? null,
        description: row.description ?? null,
        image_url: row.image_url ?? null,
        purchase_cost: row.cost_price,
        custom_markup_percent: markup ?? null,
        is_available: true,
        is_active: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    slugsUsed.add(slug);

    if (row.tracked) {
      await setTracking(trx, created.id, 'TRACKED');
      if (row.opening_stock && row.opening_stock > 0) {
        const inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, created.id);
        await recordStockMovement(trx, {
          inventory: inventory!,
          delta: row.opening_stock,
          type: 'PURCHASE_RESTOCK',
          orderId: null,
          actorId,
          notes: 'Opening stock (product import)',
        });
      }
    }
    return { status: 'created' as const, product_id: created.id };
  }

  const changes = changesFor(row, categoryId, existing);
  const tracking = trackingChange(row, existing);
  if (Object.keys(changes).length === 0 && tracking === null) {
    return { status: 'skipped' as const, product_id: existing.id };
  }
  if (Object.keys(changes).length > 0) {
    await trx
      .updateTable('products')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', existing.id)
      .execute();
  }
  if (tracking) await setTracking(trx, existing.id, tracking);
  return {
    status: 'updated' as const,
    product_id: existing.id,
    ...(row.opening_stock ? { message: 'Opening stock is ignored for an existing product' } : {}),
  };
}
