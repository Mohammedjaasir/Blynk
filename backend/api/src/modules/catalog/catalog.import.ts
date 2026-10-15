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
import { resolveSellingPrice, resolveVariantPrice, type PricingMode, type PricingSource, type VariantPricingSource } from '../pricing/index.js';
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
 * - delivery_lead_days (migration 045): whole days 0..30 before the product
 *   can be delivered; blank = 0 for a new product, unchanged for an existing.
 * - Variants (migration 045; owner, 2026-10-14). A row with `variant` filled
 *   is a VARIANT row of the product whose SKU is in `parent_sku` (that
 *   product may be created by a product row of the same file). Variant rows
 *   need parent_sku, variant (its label, e.g. "100 g") and purchase_cost;
 *   name / category / unit are taken from the product (and may be left
 *   blank). sku and barcode are the variant's own (optional). Pricing works
 *   as for products: selling_price = FIXED, markup_percent = the variant's
 *   own markup, both blank = a NEW variant follows the product / category /
 *   parent / global markup and an EXISTING one keeps its pricing. tracked /
 *   opening_stock are the variant's own stock (opening stock only when the
 *   variant is created). Idempotent: a variant is matched by its product and
 *   label (ignoring case), so re-importing changes nothing. Product rows are
 *   applied first, then variant rows; results come back in file order.
 * - mrp (migration 048; owner, 2026-10-14): the MRP of the product (product
 *   row) or of the size (variant row), LKR above 0. Blank = none for a new
 *   product/size, unchanged for an existing one (like every blank price
 *   cell; remove an MRP in the product form). When the selling price the row
 *   gives is above the MRP, the customer pays the MRP: the row's pricing says
 *   mrp_capped with the price before the cap, a warning names it, and the
 *   summary counts the capped rows.
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
  pricing_source: PricingSource | VariantPricingSource;
  purchase_cost: number;
  selling_price: number;
  /** MARKUP: the markup used; FIXED: the implied markup over cost (null when the cost is 0). */
  effective_markup_percent: number | null;
  /** True when both price cells were blank on an existing product, so its current pricing is kept. */
  kept_current?: boolean;
  /** Migration 048: the MRP after this row (null = none). */
  mrp: number | null;
  /** Migration 048: the price before the MRP cap (markup or fixed). */
  computed_selling_price: number;
  /** Migration 048: selling_price is the MRP because computed_selling_price was higher. */
  mrp_capped: boolean;
}

export interface ImportRowResult {
  row: number;
  sku: string | null;
  status: ImportStatus;
  /** Migration 045: 'variant' for a variant row (with its parent SKU and label). */
  kind?: 'product' | 'variant';
  parent_sku?: string;
  variant?: string;
  variant_id?: string;
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
  /** Migration 048: blank = none for a new product, unchanged for an existing one. */
  mrp?: number;
  sku: string;
  barcode?: string;
  description?: string;
  tracked?: boolean;
  opening_stock?: number;
  image_url?: string;
  /** Migration 045: blank = 0 for a new product, unchanged for an existing one. */
  delivery_lead_days?: number;
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
  const mrp = numberCell(raw.mrp);
  const tracked = yesNo(raw.tracked);
  const opening = numberCell(raw.opening_stock);
  const leadDays = numberCell(raw.delivery_lead_days);

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

  errors.push(...mrpErrors(mrp));

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

  if (leadDays !== undefined && (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 30)) {
    errors.push({ field: 'delivery_lead_days', message: 'Delivery lead time must be whole days from 0 to 30' });
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
      mrp,
      sku: sku!,
      barcode,
      description,
      tracked: tracked ?? undefined,
      opening_stock: opening,
      image_url: imageUrl,
      delivery_lead_days: leadDays,
    },
  };
}

/** Migration 048: the mrp cell's checks (blank is fine). */
function mrpErrors(mrp: number | undefined): FieldError[] {
  if (mrp === undefined) return [];
  if (!Number.isFinite(mrp)) return [{ field: 'mrp', message: 'MRP must be a number' }];
  if (mrp <= 0) return [{ field: 'mrp', message: 'MRP must be above 0' }];
  if (mrp > 99_999_999.99) return [{ field: 'mrp', message: 'MRP is too large' }];
  if (!hasAtMost2Decimals(mrp)) return [{ field: 'mrp', message: 'MRP can have at most 2 decimals' }];
  return [];
}

/** Migration 048: the MRP after a row - its cell, else the stored one (blank keeps it). */
const mrpAfter = (cell: number | undefined, stored: number | string | null | undefined): number | null =>
  cell !== undefined ? cell : stored === null || stored === undefined ? null : Number(stored);

/** Migration 048: the row result's MRP fields and the "capped" warning. */
function mrpOutcome(price: { mrp: number | null; computedSellingPrice: number; mrpCapped: boolean }) {
  return {
    fields: { mrp: price.mrp, computed_selling_price: price.computedSellingPrice, mrp_capped: price.mrpCapped },
    warning: price.mrpCapped
      ? `Capped at MRP LKR ${price.mrp!.toFixed(2)} (the price would be LKR ${price.computedSellingPrice.toFixed(2)})`
      : null,
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
function pricingResult(
  row: CleanRow,
  categoryId: string,
  markups: CategoryMarkups,
  globalMarkup: number,
  existing?: RowPricing,
  existingMrp?: number | string | null
) {
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
    mrp: mrpAfter(row.mrp, existingMrp),
  });
  const capped = mrpOutcome(price);
  const pricing: ImportRowPricing = {
    pricing_mode: price.pricingMode,
    pricing_source: price.pricingSource,
    purchase_cost: price.purchaseCost,
    selling_price: price.sellingPrice,
    effective_markup_percent: price.effectiveMarkupPercent,
    ...capped.fields,
  };
  // Both price cells blank on an existing product: its pricing is kept as it is.
  pricing.kept_current = existing !== undefined && noPriceCells(row);
  const warnings = [capped.warning, price.warning?.message].filter((w): w is string => !!w);
  return { pricing, ...(warnings.length ? { warnings } : {}) };
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
  mrp: number | string | null;
  barcode: string | null;
  description: string | null;
  image_url: string | null;
  tracking_mode: string | null;
  delivery_lead_days: number;
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
  // Migration 048: a blank mrp cell keeps the stored MRP.
  if (row.mrp !== undefined && row.mrp !== (existing.mrp === null ? null : Number(existing.mrp))) changes.mrp = row.mrp;
  if (row.barcode !== undefined && row.barcode !== existing.barcode) changes.barcode = row.barcode;
  if (row.description !== undefined && row.description !== existing.description) changes.description = row.description;
  if (row.image_url !== undefined && row.image_url !== existing.image_url) changes.image_url = row.image_url;
  if (row.delivery_lead_days !== undefined && row.delivery_lead_days !== Number(existing.delivery_lead_days ?? 0)) {
    changes.delivery_lead_days = row.delivery_lead_days;
  }
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
      join.onRef('inv.product_id', '=', 'p.id').on('inv.dark_store_id', '=', DEFAULT_DARK_STORE_ID).on('inv.variant_id', 'is', null)
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
      'p.mrp',
      'p.barcode',
      'p.description',
      'p.image_url',
      'p.delivery_lead_days',
      'inv.tracking_mode',
    ])
    .where('p.sku', '=', sku)
    .where('p.deleted_at', 'is', null);
  if (lock) query = query.forUpdate(['p']);
  return (await query.executeTakeFirst()) as ExistingProduct | undefined;
}

/** Migration 045: a new product's SKU must not be a variant's. */
async function assertSkuNotAVariant(executor: Transaction<Database> | typeof db, sku: string) {
  const hit = await executor.selectFrom('product_variants').select('id').where('sku', '=', sku).where('deleted_at', 'is', null).executeTakeFirst();
  if (hit) throw new AppError(`SKU '${sku}' is already used by a product variant`, 409, 'PRODUCT_SKU_EXISTS');
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
  // Migration 045: variant rows run after every product row, so a product
  // created by this file exists (or, in a dry run, is planned) before its
  // variants. What each product row decided, for its variant rows' prices.
  const variantRows: Array<{ raw: Record<string, unknown>; index: number }> = [];
  const parents = new Map<string, ParentInfo>();

  for (const [index, raw] of input.rows.entries()) {
    if (isVariantRow(raw)) {
      variantRows.push({ raw, index });
      continue;
    }
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
      const { existingPricing, existingMrp, ...result } = outcome as typeof outcome & {
        existingPricing?: RowPricing;
        existingMrp?: number | string | null;
      };
      const priced = pricingResult(row, categoryId, markups, globalMarkup, existingPricing, existingMrp);
      results.push({ row: row.row, sku: row.sku, kind: 'product', ...result, ...priced });
      parents.set(row.sku, {
        productId: (result as { product_id?: string }).product_id ?? null,
        categoryId,
        customMarkup: pricingFor(row, existingPricing).markup,
      });
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

  for (const { raw, index } of variantRows) {
    results.push(await importVariantRow(raw, index, { dryRun, actorId, parents, markups, globalMarkup, seenSkus }));
  }
  results.sort((a, b) => a.row - b.row);

  const summary = { created: 0, updated: 0, skipped: 0, errors: 0 };
  // Migration 048: rows (created/updated/skipped) whose selling price is capped at the MRP.
  let mrpCapped = 0;
  for (const r of results) {
    if (r.status === 'error') summary.errors += 1;
    else summary[r.status] += 1;
    if (r.status !== 'error' && r.pricing?.mrp_capped) mrpCapped += 1;
  }
  logger.info({ ...summary, mrpCapped, dryRun, actorId, rows: input.rows.length }, 'Product import processed');
  return { dry_run: dryRun, summary, mrp_capped: mrpCapped, results };
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
    await assertSkuNotAVariant(db, row.sku);
    slugsUsed.add(await pickSlug(db, row, slugsUsed));
    return { status: 'created' as const };
  }
  const changed = Object.keys(changesFor(row, categoryId, existing)).length > 0 || trackingChange(row, existing) !== null;
  return {
    status: changed ? ('updated' as const) : ('skipped' as const),
    product_id: existing.id,
    existingPricing: storedPricing(existing),
    existingMrp: existing.mrp,
    ...(row.opening_stock ? { message: 'Opening stock is ignored for an existing product' } : {}),
  };
}

async function applyRow(trx: Transaction<Database>, row: CleanRow, categoryId: string, slugsUsed: Set<string>, actorId: string) {
  const existing = await findExisting(trx, row.sku, true);

  if (!existing) {
    await assertSkuNotAVariant(trx, row.sku);
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
        mrp: row.mrp ?? null,
        is_available: true,
        is_active: true,
        delivery_lead_days: row.delivery_lead_days ?? 0,
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
    return { status: 'skipped' as const, product_id: existing.id, existingPricing: storedPricing(existing), existingMrp: existing.mrp };
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
    existingMrp: existing.mrp,
    ...(row.opening_stock ? { message: 'Opening stock is ignored for an existing product' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Variant rows (migration 045)
// ---------------------------------------------------------------------------

/** What a product row of this file decided (or null productId when only planned, in a dry run). */
interface ParentInfo {
  productId: string | null;
  categoryId: string;
  customMarkup: number | null;
}

/** A row is a variant row when its `variant` or `parent_sku` cell is filled. */
export function isVariantRow(raw: Record<string, unknown>): boolean {
  return text(raw.variant) !== undefined || text(raw.parent_sku) !== undefined;
}

interface CleanVariantRow {
  row: number;
  parent_sku: string;
  label: string;
  sku?: string;
  barcode?: string;
  cost_price: number;
  selling_price?: number;
  markup_percent?: number;
  /** Migration 048: the size's MRP; blank = none (new) / unchanged (existing). */
  mrp?: number;
  tracked?: boolean;
  opening_stock?: number;
}

/** The variant row's cells (the variant form's limits). */
export function validateVariantRow(
  raw: Record<string, unknown>,
  index: number
): { row: CleanVariantRow | null; rowNo: number; errors: FieldError[]; parentSku: string | null; label: string | null; sku: string | null } {
  const errors: FieldError[] = [];
  const rowNoRaw = Number(raw.row);
  const rowNo = Number.isInteger(rowNoRaw) && rowNoRaw > 0 ? rowNoRaw : index + 2;
  const parentSku = text(raw.parent_sku);
  const label = text(raw.variant);
  const sku = text(raw.sku);
  const barcode = text(raw.barcode);
  const purchaseCostCell = numberCell(raw.purchase_cost);
  const costPriceCell = numberCell(raw.cost_price);
  const cost = purchaseCostCell !== undefined ? purchaseCostCell : costPriceCell;
  const selling = numberCell(raw.selling_price);
  const markup = numberCell(raw.markup_percent);
  const mrp = numberCell(raw.mrp);
  const tracked = yesNo(raw.tracked);
  const opening = numberCell(raw.opening_stock);

  if (!parentSku) errors.push({ field: 'parent_sku', message: "A variant row needs parent_sku (the product's SKU)" });
  if (!label) errors.push({ field: 'variant', message: 'A variant row needs the variant name, e.g. 100 g or 3 pack' });
  else if (label.length > 64) errors.push({ field: 'variant', message: 'The variant name must be at most 64 characters' });
  if (sku && (sku.length < 3 || sku.length > 64)) errors.push({ field: 'sku', message: 'A variant SKU must be 3 to 64 characters' });
  if (sku && parentSku && sku === parentSku) errors.push({ field: 'sku', message: "A variant's SKU must differ from its product's SKU (or leave it blank)" });
  if (barcode && barcode.length > 64) errors.push({ field: 'barcode', message: 'Barcode must be at most 64 characters' });

  if (cost === undefined) errors.push({ field: 'purchase_cost', message: 'Purchase cost is required' });
  else if (!Number.isFinite(cost)) errors.push({ field: 'purchase_cost', message: 'Purchase cost must be a number' });
  else if (cost < 0) errors.push({ field: 'purchase_cost', message: 'Purchase cost cannot be negative' });
  else if (cost > 99_999_999.99) errors.push({ field: 'purchase_cost', message: 'Purchase cost is too large' });
  else if (!hasAtMost2Decimals(cost)) errors.push({ field: 'purchase_cost', message: 'Purchase cost can have at most 2 decimals' });

  if (selling !== undefined && markup !== undefined) {
    errors.push({ field: 'selling_price', message: 'Give either selling_price or markup_percent, not both' });
  } else if (selling !== undefined) {
    if (!Number.isFinite(selling) || selling <= 0) errors.push({ field: 'selling_price', message: 'Selling price must be a number above 0' });
    else if (selling > 99_999_999.99) errors.push({ field: 'selling_price', message: 'Selling price is too large' });
    else if (!hasAtMost2Decimals(selling)) errors.push({ field: 'selling_price', message: 'Selling price can have at most 2 decimals' });
  } else if (markup !== undefined) {
    if (!Number.isFinite(markup) || markup < 0 || markup > 999.99) errors.push({ field: 'markup_percent', message: 'Markup must be between 0 and 999.99' });
    else if (!hasAtMost2Decimals(markup)) errors.push({ field: 'markup_percent', message: 'Markup can have at most 2 decimals' });
  }

  errors.push(...mrpErrors(mrp));

  if (tracked === null) errors.push({ field: 'tracked', message: 'Tracked must be yes or no' });
  if (opening !== undefined) {
    if (!Number.isInteger(opening) || opening < 0) errors.push({ field: 'opening_stock', message: 'Opening stock must be a whole number, 0 or more' });
    else if (opening > 100_000) errors.push({ field: 'opening_stock', message: 'Opening stock is too large' });
    else if (opening > 0 && tracked !== true) errors.push({ field: 'opening_stock', message: 'Opening stock needs tracked = yes' });
  }

  const base = { rowNo, errors, parentSku: parentSku ?? null, label: label ?? null, sku: sku ?? null };
  if (errors.length > 0) return { ...base, row: null };
  return {
    ...base,
    row: {
      row: rowNo,
      parent_sku: parentSku!,
      label: label!,
      sku,
      barcode,
      cost_price: cost!,
      selling_price: selling,
      markup_percent: markup,
      mrp,
      tracked: tracked ?? undefined,
      opening_stock: opening,
    },
  };
}

type ExistingVariant = {
  id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  purchase_cost: string | number;
  pricing_mode: string;
  fixed_selling_price: string | number | null;
  custom_markup_percent: string | number | null;
  mrp: string | number | null;
  tracking_mode: string | null;
};

function variantRowPricing(row: CleanVariantRow, existing?: ExistingVariant): RowPricing {
  if (row.selling_price !== undefined) return { mode: 'FIXED', fixed: row.selling_price, markup: null };
  if (row.markup_percent !== undefined) return { mode: 'MARKUP', fixed: null, markup: row.markup_percent };
  if (existing) return storedPricing(existing);
  return { mode: 'MARKUP', fixed: null, markup: null };
}

function variantChanges(row: CleanVariantRow, existing: ExistingVariant) {
  const changes: Record<string, unknown> = {};
  if (row.label !== existing.label) changes.label = row.label;
  if (row.sku !== undefined && row.sku !== existing.sku) changes.sku = row.sku;
  if (row.barcode !== undefined && row.barcode !== existing.barcode) changes.barcode = row.barcode;
  if (Number(existing.purchase_cost) !== row.cost_price) changes.purchase_cost = row.cost_price;
  if (row.selling_price !== undefined || row.markup_percent !== undefined) {
    const want = variantRowPricing(row, existing);
    if (want.mode !== existing.pricing_mode) changes.pricing_mode = want.mode;
    if (want.mode === 'FIXED') {
      if (want.fixed !== (existing.fixed_selling_price === null ? null : Number(existing.fixed_selling_price))) changes.fixed_selling_price = want.fixed;
    } else if (want.markup !== (existing.custom_markup_percent === null ? null : Number(existing.custom_markup_percent))) {
      changes.custom_markup_percent = want.markup;
    }
  }
  // Migration 048: a blank mrp cell keeps the stored MRP.
  if (row.mrp !== undefined && row.mrp !== (existing.mrp === null ? null : Number(existing.mrp))) changes.mrp = row.mrp;
  return changes;
}

async function findExistingVariant(executor: Transaction<Database> | typeof db, productId: string, label: string, lock: boolean) {
  let q = executor
    .selectFrom('product_variants as v')
    .leftJoin('inventory as inv', (join) =>
      join.onRef('inv.variant_id', '=', 'v.id').on('inv.dark_store_id', '=', DEFAULT_DARK_STORE_ID)
    )
    .select([
      'v.id',
      'v.label',
      'v.sku',
      'v.barcode',
      'v.purchase_cost',
      'v.pricing_mode',
      'v.fixed_selling_price',
      'v.custom_markup_percent',
      'v.mrp',
      'inv.tracking_mode',
    ])
    .where('v.product_id', '=', productId)
    .where('v.deleted_at', 'is', null)
    .where((eb) => eb(eb.fn('lower', [eb.fn('btrim', ['v.label'])]), '=', label.trim().toLowerCase()));
  if (lock) q = q.forUpdate(['v']);
  return (await q.executeTakeFirst()) as ExistingVariant | undefined;
}

async function variantSkuTaken(executor: Transaction<Database> | typeof db, sku: string, exceptVariantId?: string) {
  let q = executor.selectFrom('product_variants').select('id').where('sku', '=', sku).where('deleted_at', 'is', null);
  if (exceptVariantId) q = q.where('id', '!=', exceptVariantId);
  if (await q.executeTakeFirst()) return true;
  return !!(await executor.selectFrom('products').select('id').where('sku', '=', sku).where('deleted_at', 'is', null).executeTakeFirst());
}

async function setVariantTracking(trx: Transaction<Database>, productId: string, variantId: string, mode: 'TRACKED' | 'UNTRACKED') {
  const existing = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, productId, variantId);
  if (existing) {
    await trx.updateTable('inventory').set({ tracking_mode: mode, updated_at: new Date() }).where('id', '=', existing.id).execute();
  } else {
    await trx
      .insertInto('inventory')
      .values({ dark_store_id: DEFAULT_DARK_STORE_ID, product_id: productId, variant_id: variantId, tracking_mode: mode })
      .execute();
  }
}

async function importVariantRow(
  raw: Record<string, unknown>,
  index: number,
  ctx: {
    dryRun: boolean;
    actorId: string;
    parents: Map<string, ParentInfo>;
    markups: CategoryMarkups;
    globalMarkup: number;
    seenSkus: Map<string, number>;
  }
): Promise<ImportRowResult> {
  const checked = validateVariantRow(raw, index);
  const errors = [...checked.errors];
  const head = {
    row: checked.rowNo,
    sku: checked.sku,
    kind: 'variant' as const,
    ...(checked.parentSku ? { parent_sku: checked.parentSku } : {}),
    ...(checked.label ? { variant: checked.label } : {}),
  };
  const row = checked.row;
  if (row?.sku) {
    const first = ctx.seenSkus.get(row.sku);
    if (first !== undefined) errors.push({ field: 'sku', message: `SKU ${row.sku} is already used on row ${first} of this file` });
    else ctx.seenSkus.set(row.sku, row.row);
  }
  if (!row || errors.length) return { ...head, status: 'error', message: errors[0]?.message, errors };

  try {
    // The parent: a product row of this file, else an existing product.
    const fromFile = ctx.parents.get(row.parent_sku);
    const stored = await db
      .selectFrom('products')
      .select(['id', 'category_id', 'custom_markup_percent'])
      .where('sku', '=', row.parent_sku)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!stored && !fromFile) {
      const message = `No product with SKU '${row.parent_sku}' (add its product row above, or create it first)`;
      return { ...head, status: 'error', message, errors: [{ field: 'parent_sku', message }] };
    }
    const categoryId = fromFile?.categoryId ?? stored!.category_id;
    const productMarkup = fromFile ? fromFile.customMarkup : stored!.custom_markup_percent === null ? null : Number(stored!.custom_markup_percent);
    const productId = stored?.id ?? null;

    const existing = productId ? await findExistingVariant(db, productId, row.label, false) : undefined;
    if (row.sku && (await variantSkuTaken(db, row.sku, existing?.id))) {
      const message = `SKU '${row.sku}' is already used by another product or variant`;
      return { ...head, status: 'error', message, errors: [{ field: 'sku', message }] };
    }

    const want = variantRowPricing(row, existing);
    const inherited = ctx.markups.get(categoryId);
    const price = resolveVariantPrice({
      purchaseCost: row.cost_price,
      pricingMode: want.mode,
      fixedSellingPrice: want.fixed,
      variantMarkupPercent: want.markup,
      productMarkupPercent: productMarkup,
      categoryMarkupPercent: inherited?.own ?? null,
      parentCategoryMarkupPercent: inherited?.parent ?? null,
      globalMarkupPercent: ctx.globalMarkup,
      mrp: mrpAfter(row.mrp, existing?.mrp),
    });
    const capped = mrpOutcome(price);
    const pricing: ImportRowPricing = {
      pricing_mode: price.pricingMode,
      pricing_source: price.pricingSource,
      purchase_cost: price.purchaseCost,
      selling_price: price.sellingPrice,
      effective_markup_percent: price.effectiveMarkupPercent,
      kept_current: existing !== undefined && row.selling_price === undefined && row.markup_percent === undefined,
      ...capped.fields,
    };
    const warnings = [capped.warning, price.warning?.message].filter((w): w is string => !!w);
    const priced = { pricing, ...(warnings.length ? { warnings } : {}) };
    const trackingWant = row.tracked === undefined ? null : row.tracked ? 'TRACKED' : 'UNTRACKED';
    const ignoredStock = existing && row.opening_stock ? { message: 'Opening stock is ignored for an existing variant' } : {};

    if (existing) {
      const changes = variantChanges(row, existing);
      const trackingChange = trackingWant !== null && trackingWant !== (existing.tracking_mode ?? 'UNTRACKED') ? trackingWant : null;
      const changed = Object.keys(changes).length > 0 || trackingChange !== null;
      if (!changed) return { ...head, status: 'skipped', product_id: productId!, variant_id: existing.id, ...priced, ...ignoredStock };
      if (!ctx.dryRun) {
        await db.transaction().execute(async (trx) => {
          const locked = await findExistingVariant(trx, productId!, row.label, true);
          if (!locked) throw new AppError('The variant changed while importing; try again.', 409, 'VARIANT_CHANGED');
          if (Object.keys(changes).length) {
            await trx.updateTable('product_variants').set({ ...changes, updated_at: new Date() }).where('id', '=', locked.id).execute();
          }
          if (trackingChange) await setVariantTracking(trx, productId!, locked.id, trackingChange);
        });
      }
      return { ...head, status: 'updated', product_id: productId!, variant_id: existing.id, ...priced, ...ignoredStock };
    }

    if (ctx.dryRun) return { ...head, status: 'created', ...(productId ? { product_id: productId } : {}), ...priced };

    const variantId = await db.transaction().execute(async (trx) => {
      const sortRow = await trx
        .selectFrom('product_variants')
        .select((eb) => eb.fn.coalesce(eb.fn.max('sort_order'), eb.val(-1)).as('m'))
        .where('product_id', '=', productId!)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      const created = await trx
        .insertInto('product_variants')
        .values({
          product_id: productId!,
          label: row.label,
          sku: row.sku ?? null,
          barcode: row.barcode ?? null,
          sort_order: Number(sortRow?.m ?? -1) + 1,
          purchase_cost: row.cost_price,
          pricing_mode: want.mode,
          fixed_selling_price: want.fixed,
          custom_markup_percent: want.markup,
          mrp: row.mrp ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (row.tracked) {
        await setVariantTracking(trx, productId!, created.id, 'TRACKED');
        if (row.opening_stock && row.opening_stock > 0) {
          const inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, productId!, created.id);
          await recordStockMovement(trx, {
            inventory: inventory!,
            delta: row.opening_stock,
            type: 'PURCHASE_RESTOCK',
            orderId: null,
            actorId: ctx.actorId,
            notes: 'Opening stock (product import, variant)',
          });
        }
      }
      return created.id;
    });
    return { ...head, status: 'created', product_id: productId!, variant_id: variantId, ...priced };
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : (err as { code?: string }).code === '23505'
          ? 'Another variant already uses this name or SKU (try again, or change it)'
          : 'This row could not be saved';
    if (!(err instanceof AppError)) logger.warn({ err, row: head.row, sku: head.sku }, 'Variant import row failed');
    return { ...head, status: 'error', message, errors: [{ field: 'row', message }] };
  }
}
