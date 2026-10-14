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
import { resolveSellingPrice, type PricingMode, type PricingSource } from '../pricing/index.js';
import { getGlobalMarkup } from './catalog.pricing.js';

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
 * - On an update, blank optional cells (pack size, barcode, description,
 *   tracked, image URL) leave the stored value alone: a blank cell never
 *   wipes data. The required columns always apply.
 * - opening_stock only applies when the product is created. For an existing
 *   product stock moves through the Inventory screens (restock/adjust), so an
 *   import can never silently rewrite a count.
 * - The category must already exist (matched by name or slug, ignoring case);
 *   an import never invents categories from typos. A product can sit in a
 *   sub-category (owner, 2026-10-14: "main category - side category if
 *   available"): fill sub_category next to category, or write the category
 *   cell as "Parent > Child" (also › or →). A name that matches more than one
 *   category (e.g. "Rice" as a category and as a sub-category of "Rice &
 *   Flour") is an error asking for the parent or the slug - never a guess.
 * - Pricing (migration 044; owner, 2026-10-13). purchase_cost (or the older
 *   header cost_price) is the purchase cost. Then:
 *     selling_price given  -> FIXED at exactly that price (a price below cost
 *                             is allowed and reported as a warning);
 *     markup_percent given -> MARKUP with that custom markup;
 *     neither              -> a NEW product: MARKUP with no custom markup, so
 *                             the category / parent / global markup applies;
 *                             an EXISTING product keeps its current pricing
 *                             (mode, fixed price, custom markup) - like every
 *                             other blank cell (owner, 2026-10-13).
 *   Both given is an error ("give either selling_price or markup_percent").
 *   FIXED leaves a stored custom markup alone and MARKUP leaves a stored
 *   fixed price alone (both ignored while unused), so re-importing the same
 *   file changes nothing. Before 044 a selling_price became a derived custom
 *   markup; it is now the fixed price itself. Every row's result (dry run
 *   too) carries the resulting selling price and its source.
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

export interface ImportRowPricing {
  pricing_mode: PricingMode;
  pricing_source: PricingSource;
  purchase_cost: number;
  selling_price: number;
  /** MARKUP: the markup used; FIXED: the implied markup over cost (null when the cost is 0). */
  effective_markup_percent: number | null;
  /** True when both price cells were blank on an existing product, so its current pricing is kept. */
  kept_current?: boolean;
}

export interface ImportRowResult {
  row: number;
  sku: string | null;
  status: ImportStatus;
  product_id?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
  /** Migration 044: the price this row gives the product (created/updated/skipped rows). */
  pricing?: ImportRowPricing;
  /** Non-blocking notes, e.g. a fixed price below the purchase cost. */
  warnings?: string[];
}

interface CleanRow {
  row: number;
  name: string;
  category: string;
  /** Optional: a sub-category of `category` (matched within it). */
  sub_category?: string;
  unit: string;
  pack_size?: string;
  cost_price: number;
  selling_price?: number;
  markup_percent?: number;
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
  const subCategory = text(raw.sub_category) ?? text(raw.subcategory);
  const unit = text(raw.unit);
  const packSize = text(raw.pack_size);
  const sku = text(raw.sku);
  const barcode = text(raw.barcode);
  const description = text(raw.description);
  const imageUrl = text(raw.image_url);
  // purchase_cost is the template header since migration 044; cost_price is
  // the older one and still accepted. When both are filled they must agree.
  const purchaseCostCell = numberCell(raw.purchase_cost);
  const costPriceCell = numberCell(raw.cost_price);
  const cost = purchaseCostCell !== undefined ? purchaseCostCell : costPriceCell;
  const selling = numberCell(raw.selling_price);
  const markup = numberCell(raw.markup_percent);
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

  const costField = purchaseCostCell !== undefined ? 'purchase_cost' : 'cost_price';
  if (cost === undefined) errors.push({ field: 'purchase_cost', message: 'Purchase cost is required' });
  else if (!Number.isFinite(cost)) errors.push({ field: costField, message: 'Purchase cost must be a number' });
  else if (cost < 0) errors.push({ field: costField, message: 'Purchase cost cannot be negative' });
  else if (cost > 99_999_999.99) errors.push({ field: costField, message: 'Purchase cost is too large' });
  else if (!hasAtMost2Decimals(cost)) errors.push({ field: costField, message: 'Purchase cost can have at most 2 decimals' });
  else if (costPriceCell !== undefined && purchaseCostCell !== undefined && costPriceCell !== purchaseCostCell) {
    errors.push({ field: 'purchase_cost', message: 'purchase_cost and cost_price differ; fill only one of them' });
  }

  if (selling !== undefined && markup !== undefined) {
    errors.push({ field: 'selling_price', message: 'Give either selling_price or markup_percent, not both' });
  } else if (selling !== undefined) {
    if (!Number.isFinite(selling)) errors.push({ field: 'selling_price', message: 'Selling price must be a number' });
    else if (selling <= 0) errors.push({ field: 'selling_price', message: 'Selling price must be above 0' });
    else if (selling > 99_999_999.99) errors.push({ field: 'selling_price', message: 'Selling price is too large' });
    else if (!hasAtMost2Decimals(selling)) errors.push({ field: 'selling_price', message: 'Selling price can have at most 2 decimals' });
  } else if (markup !== undefined) {
    if (!Number.isFinite(markup)) errors.push({ field: 'markup_percent', message: 'Markup must be a number' });
    else if (markup < 0) errors.push({ field: 'markup_percent', message: 'Markup cannot be negative' });
    else if (markup > 999.99) errors.push({ field: 'markup_percent', message: 'Markup cannot exceed 999.99%' });
    else if (!hasAtMost2Decimals(markup)) errors.push({ field: 'markup_percent', message: 'Markup can have at most 2 decimals' });
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
      sub_category: subCategory,
      unit: unit!,
      pack_size: packSize,
      cost_price: cost!,
      selling_price: selling,
      markup_percent: markup,
      sku: sku!,
      barcode,
      description,
      tracked: tracked ?? undefined,
      opening_stock: opening,
      image_url: imageUrl,
    },
  };
}

type RowPricing = { mode: PricingMode; fixed: number | null; markup: number | null };

/** Both price cells blank: an existing product keeps its pricing (owner, 2026-10-13). */
const noPriceCells = (row: CleanRow) => row.selling_price === undefined && row.markup_percent === undefined;

/** An existing product's stored pricing. */
function storedPricing(existing: Pick<ExistingProduct, 'pricing_mode' | 'fixed_selling_price' | 'custom_markup_percent'>): RowPricing {
  return {
    mode: existing.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP',
    fixed: existing.fixed_selling_price === null ? null : Number(existing.fixed_selling_price),
    markup: existing.custom_markup_percent === null ? null : Number(existing.custom_markup_percent),
  };
}

/**
 * How the row prices the product (see the module comment). A new product
 * with both price cells blank uses the category/parent/global markup; an
 * existing one keeps whatever pricing it has.
 */
function pricingFor(row: CleanRow, existing?: RowPricing): RowPricing {
  if (row.selling_price !== undefined) return { mode: 'FIXED', fixed: row.selling_price, markup: null };
  if (row.markup_percent !== undefined) return { mode: 'MARKUP', fixed: null, markup: row.markup_percent };
  return existing ?? { mode: 'MARKUP', fixed: null, markup: null };
}

/** The markups a category gives its products: its own, else its live parent's. */
type CategoryMarkups = Map<string, { own: number | null; parent: number | null }>;

/** The price the row gives the product, with a warning when a fixed price is below cost. */
function pricingResult(row: CleanRow, categoryId: string, markups: CategoryMarkups, globalMarkup: number, existing?: RowPricing) {
  const want = pricingFor(row, existing);
  const inherited = markups.get(categoryId);
  const price = resolveSellingPrice({
    purchaseCost: row.cost_price,
    pricingMode: want.mode,
    fixedSellingPrice: want.fixed,
    productMarkupPercent: want.markup,
    categoryMarkupPercent: inherited?.own ?? null,
    parentCategoryMarkupPercent: inherited?.parent ?? null,
    globalMarkupPercent: globalMarkup,
  });
  const pricing: ImportRowPricing = {
    pricing_mode: price.pricingMode,
    pricing_source: price.pricingSource,
    purchase_cost: price.purchaseCost,
    selling_price: price.sellingPrice,
    effective_markup_percent: price.effectiveMarkupPercent,
  };
  // Both price cells blank on an existing product: its pricing is kept as it is.
  pricing.kept_current = existing !== undefined && noPriceCells(row);
  return { pricing, ...(price.warning ? { warnings: [price.warning.message] } : {}) };
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
  pricing_mode: string;
  fixed_selling_price: number | string | null;
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
  const want = pricingFor(row, storedPricing(existing));
  if (want.mode !== existing.pricing_mode) changes.pricing_mode = want.mode;
  if (noPriceCells(row)) {
    // Blank price cells change nothing (owner, 2026-10-13).
  } else if (want.mode === 'FIXED') {
    const currentFixed = existing.fixed_selling_price === null ? null : Number(existing.fixed_selling_price);
    if (want.fixed !== currentFixed) changes.fixed_selling_price = want.fixed;
  } else {
    const currentMarkup = existing.custom_markup_percent === null ? null : Number(existing.custom_markup_percent);
    if (want.markup !== currentMarkup) changes.custom_markup_percent = want.markup;
  }
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
      'p.pricing_mode',
      'p.fixed_selling_price',
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

  const [categories, globalMarkup] = await Promise.all([
    db.selectFrom('categories').select(['id', 'name', 'slug', 'parent_id', 'markup_percent']).where('deleted_at', 'is', null).execute(),
    getGlobalMarkup(),
  ]);
  const resolveCategory = categoryResolver(categories);
  // Migration 044: what each category's products inherit (v_product_catalog's rule).
  const ownMarkup = new Map(categories.map((c) => [c.id, c.markup_percent === null ? null : Number(c.markup_percent)]));
  const markups: CategoryMarkups = new Map(
    categories.map((c) => [c.id, { own: ownMarkup.get(c.id) ?? null, parent: c.parent_id ? ownMarkup.get(c.parent_id) ?? null : null }])
  );

  const results: ImportRowResult[] = [];
  const seenSkus = new Map<string, number>();
  const slugsUsed = new Set<string>();

  for (const [index, raw] of input.rows.entries()) {
    const checked = validateImportRow(raw, index);
    const errors = [...checked.errors];
    const row = checked.row;

    let categoryId: string | undefined;
    if (row) {
      const resolved = resolveCategory(row.category, row.sub_category);
      if ('error' in resolved) errors.push(resolved.error);
      else categoryId = resolved.id;
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
      const { existingPricing, ...result } = outcome as typeof outcome & { existingPricing?: RowPricing };
      const priced = pricingResult(row, categoryId, markups, globalMarkup, existingPricing);
      results.push({ row: row.row, sku: row.sku, ...result, ...priced });
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

type CategoryRef = { id: string; name: string; slug: string; parent_id: string | null };
const CATEGORY_PATH = /\s*(?:>|›|→)\s*/;
const nameKey = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Finds a row's category: "Name" or "slug", "Parent > Child", or category +
 * sub_category. Ambiguous names are an error (owner, 2026-10-14).
 */
export function categoryResolver(categories: CategoryRef[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const label = (c: CategoryRef) => (c.parent_id && byId.get(c.parent_id) ? `${byId.get(c.parent_id)!.name} > ${c.name}` : c.name);
  const matches = (value: string, pool: CategoryRef[]) => {
    const k = nameKey(value);
    const bySlug = pool.filter((c) => c.slug.toLowerCase() === k);
    if (bySlug.length) return bySlug;
    return pool.filter((c) => nameKey(c.name) === k);
  };
  const one = (value: string, pool: CategoryRef[], field: string, within?: CategoryRef): { id: string } | { error: { field: string; message: string } } => {
    const found = matches(value, pool);
    if (found.length === 1) return { id: found[0].id };
    if (!found.length) {
      return { error: { field, message: within ? `No sub-category called '${value}' inside '${within.name}'` : `No category called '${value}'` } };
    }
    return {
      error: {
        field,
        message: `'${value}' matches more than one category (${found.map(label).join('; ')}). Write it as 'Category > Sub-category' or use the slug.`,
      },
    };
  };
  return (categoryCell: string, subCell?: string) => {
    const parts = categoryCell.split(CATEGORY_PATH).filter(Boolean);
    if (parts.length > 2) return { error: { field: 'category', message: `'${categoryCell}' has too many levels; use 'Category > Sub-category'` } };
    if (parts.length === 2 && subCell) {
      return { error: { field: 'sub_category', message: 'Give the sub-category either in the category cell or in sub_category, not both' } };
    }
    const [parentText, childText] = parts.length === 2 ? parts : [parts[0] ?? categoryCell, subCell];
    if (!childText) return one(parentText, categories, 'category');
    const parent = one(parentText, categories.filter((c) => !c.parent_id), 'category');
    if ('error' in parent) return parent;
    const parentRef = byId.get(parent.id)!;
    return one(childText, categories.filter((c) => c.parent_id === parent.id), parts.length === 2 ? 'category' : 'sub_category', parentRef);
  };
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
    existingPricing: storedPricing(existing),
    ...(row.opening_stock ? { message: 'Opening stock is ignored for an existing product' } : {}),
  };
}

async function applyRow(trx: Transaction<Database>, row: CleanRow, categoryId: string, slugsUsed: Set<string>, actorId: string) {
  const existing = await findExisting(trx, row.sku, true);

  if (!existing) {
    const slug = await pickSlug(trx, row, slugsUsed);
    const want = pricingFor(row);
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
        custom_markup_percent: want.markup,
        pricing_mode: want.mode,
        fixed_selling_price: want.fixed,
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
    return { status: 'skipped' as const, product_id: existing.id, existingPricing: storedPricing(existing) };
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
    existingPricing: storedPricing(existing),
    ...(row.opening_stock ? { message: 'Opening stock is ignored for an existing product' } : {}),
  };
}
