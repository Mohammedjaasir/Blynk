import type { Request, Response, NextFunction } from 'express';
import type { Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { belowCostWarning, resolveVariantPrice, type PriceWarning, type PricingMode, type VariantPricingSource } from '../pricing/index.js';
import { activeOfferPrice, assertOfferAllowed, publicOffer } from './catalog.offers.js';
import { mrpSchema } from './catalog.schema.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { inventoryRepository } from '../inventory/inventory.repository.js';
import { staffStockFor, UNTRACKED_STOCK, type StaffStock } from '../inventory/stock-view.js';

export { staffStockFor, toStaffStock, UNTRACKED_STOCK, type StaffStock } from '../inventory/stock-view.js';

/**
 * Product variants (migration 045; owner, 2026-10-14): "chilli powder has
 * 50g, 100g, 250g, 500g with different prices"; "pieces with prices, some
 * items have 3-packs".
 *
 * A variant has a label ('50 g', '1 piece', '3 pack'), an optional SKU and
 * barcode, a sort order, its own purchase cost and pricing - FIXED price, or
 * MARKUP with its own markup falling back to the product's custom markup,
 * then category / parent / global (pricing/index.ts resolveVariantPrice) -
 * an optional offer price, active/available switches and its own stock
 * (inventory row with variant_id, same ledger). Admin and Ops manage them.
 *
 * Customers see a product with variants as a price range (the cheapest and
 * dearest of its orderable variants, offers included) and, on the product
 * page, each active variant's price, offer and availability - never a cost,
 * markup or stock count. Orders name the variant (order_items.variant_id)
 * and the server prices it.
 *
 * Delete: a variant never ordered goes for good (its stock rows and ledger
 * with it); one that was ordered is soft-deleted (deleted_at) so past orders
 * keep it.
 */

type Executor = typeof db | Transaction<Database>;

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const money = (v: unknown) => Number(Number(v).toFixed(2));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Migration 048: the MRP a customer is shown - only when it is above what
 * they pay now (catalog.service uses the same rule for products).
 */
export function publicMrp(mrp: unknown, pricePaid: number): number | null {
  if (mrp === null || mrp === undefined) return null;
  const m = money(mrp);
  return Number.isFinite(m) && m > pricePaid ? m : null;
}

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------
const optionalCode = (min: number, label: string) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .trim()
    .max(64, `${label} must be at most 64 characters`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v))
    .refine((v) => v === undefined || v === null || v.length >= min, `${label} must be at least ${min} characters`);

const variantFields = {
  label: z
    .string({ required_error: 'Enter the variant name, e.g. 100 g or 3 pack', invalid_type_error: 'The variant name must be text' })
    .trim()
    .min(1, 'Enter the variant name, e.g. 100 g or 3 pack')
    .max(64, 'The variant name must be at most 64 characters'),
  sku: optionalCode(3, 'SKU'),
  barcode: optionalCode(1, 'Barcode'),
  sort_order: z.number().int().min(0).max(100_000).optional(),
  purchase_cost: z
    .number({ required_error: 'Enter the purchase cost', invalid_type_error: 'Purchase cost must be a number' })
    .min(0, 'Purchase cost cannot be negative')
    .max(99_999_999.99, 'Purchase cost cannot exceed 99,999,999.99')
    .refine(twoDecimals, 'Purchase cost can have at most 2 decimals'),
  pricing_mode: z.enum(['MARKUP', 'FIXED'], { errorMap: () => ({ message: "pricing_mode must be 'MARKUP' or 'FIXED'" }) }).optional(),
  fixed_selling_price: z
    .number({ invalid_type_error: 'Selling price must be a number' })
    .positive('Selling price must be above 0')
    .max(99_999_999.99, 'Selling price cannot exceed 99,999,999.99')
    .refine(twoDecimals, 'Selling price can have at most 2 decimals')
    .nullable()
    .optional(),
  custom_markup_percent: z
    .number({ invalid_type_error: 'Markup must be a number' })
    .min(0, 'Markup cannot be negative')
    .max(999.99, 'Markup cannot exceed 999.99%')
    .refine(twoDecimals, 'Markup can have at most 2 decimals')
    .nullable()
    .optional(),
  offer_price: z
    .number({ invalid_type_error: 'Offer price must be a number' })
    .positive('Offer price must be above 0')
    .max(99_999_999.99, 'Offer price cannot exceed 99,999,999.99')
    .refine(twoDecimals, 'Offer price can have at most 2 decimals')
    .nullable()
    .optional(),
  offer_ends_at: z
    .string()
    .datetime({ offset: true, message: 'Offer end must be a date and time, e.g. 2026-10-31T23:59:59+05:30' })
    .nullable()
    .optional(),
  // Migration 048: this size's own MRP (null = none); its price is capped at it.
  mrp: mrpSchema,
  is_active: z.boolean().optional(),
  is_available: z.boolean().optional(),
};

/** Stock set together with a new variant (optional): the same as PUT /admin/inventory/:productId/stock. */
const stockOnCreate = {
  track_stock: z.boolean().optional(),
  stock_count: z.number().int('Stock must be a whole number').min(0, 'Stock cannot be negative').max(100_000).optional(),
  low_stock_threshold: z.number().int().min(0).max(100_000).optional(),
};

export const createVariantSchema = z.object({ ...variantFields, ...stockOnCreate }).superRefine((v, ctx) => {
  if (v.pricing_mode === 'FIXED' && (v.fixed_selling_price === null || v.fixed_selling_price === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fixed_selling_price'], message: 'Enter the selling price for a fixed-price variant' });
  }
  if (v.stock_count !== undefined && v.stock_count > 0 && v.track_stock !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stock_count'], message: 'Turn on stock tracking to set a stock count' });
  }
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z
  .object({
    ...variantFields,
    label: variantFields.label.optional(),
    purchase_cost: variantFields.purchase_cost.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const reorderVariantsSchema = z.object({
  variant_ids: z
    .array(z.string().uuid('Invalid variant id'))
    .min(1, 'Send the variants in their new order')
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Each variant may appear only once'),
});

const productParam = z.object({ id: z.string().uuid('Invalid id') });
const variantParams = z.object({ id: z.string().uuid('Invalid id'), variantId: z.string().uuid('Invalid variant id') });

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------
export interface StaffVariant {
  id: string;
  product_id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  sort_order: number;
  is_active: boolean;
  is_available: boolean;
  purchase_cost: number;
  pricing_mode: PricingMode;
  fixed_selling_price: number | null;
  custom_markup_percent: number | null;
  product_markup_percent: number | null;
  category_markup_percent: number | null;
  parent_category_markup_percent: number | null;
  global_markup_percent: number | null;
  effective_markup_percent: number | null;
  pricing_source: VariantPricingSource;
  /** The regular price customers see (capped at the MRP). */
  selling_price: number;
  price_warning: PriceWarning | null;
  /** Migration 048: the size's MRP (null = none), the price before the cap, and whether it capped. */
  mrp: number | null;
  computed_selling_price: number;
  mrp_capped: boolean;
  offer_price: number | null;
  offer_ends_at: string | null;
  offer_active: boolean;
  /** What a customer pays right now (best of the variant offer and the category offer). */
  customer_price: number;
  /** Customers can add it to the basket right now (active, available, in stock). */
  is_orderable: boolean;
  stock: StaffStock;
  created_at: Date;
  updated_at: Date;
}

type VariantViewRow = Awaited<ReturnType<typeof readVariantRows>>[number];

async function readVariantRows(executor: Executor, productIds: string[]) {
  if (productIds.length === 0) return [];
  return await executor
    .selectFrom('v_product_variant_catalog')
    .selectAll()
    .where('product_id', 'in', productIds)
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
}

function toStaffVariant(row: VariantViewRow, stock: StaffStock | undefined): StaffVariant {
  const cost = money(row.purchase_cost);
  const selling = money(row.calculated_selling_price);
  const mode: PricingMode = row.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP';
  const offerPrice = num(row.offer_price);
  return {
    id: row.id,
    product_id: row.product_id,
    label: row.label,
    sku: row.sku,
    barcode: row.barcode,
    sort_order: row.sort_order,
    is_active: row.is_active,
    is_available: row.is_available,
    purchase_cost: cost,
    pricing_mode: mode,
    fixed_selling_price: row.fixed_selling_price === null ? null : money(row.fixed_selling_price),
    custom_markup_percent: num(row.custom_markup_percent),
    product_markup_percent: num(row.product_markup_percent),
    category_markup_percent: num(row.category_markup_percent),
    parent_category_markup_percent: num(row.parent_category_markup_percent),
    global_markup_percent: num(row.global_markup_percent),
    effective_markup_percent: row.effective_markup_percent === null ? null : money(row.effective_markup_percent),
    pricing_source: row.pricing_source,
    selling_price: selling,
    price_warning: belowCostWarning(cost, selling),
    mrp: row.mrp === null ? null : money(row.mrp),
    computed_selling_price: row.computed_selling_price === null ? selling : money(row.computed_selling_price),
    mrp_capped: row.mrp_capped === true,
    offer_price: offerPrice,
    offer_ends_at: row.offer_ends_at ? new Date(row.offer_ends_at).toISOString() : null,
    offer_active: activeOfferPrice({ offer_price: offerPrice, offer_ends_at: row.offer_ends_at }, selling) !== null,
    customer_price: publicOffer(row, selling).offer_price ?? selling,
    is_orderable: row.is_orderable,
    stock: stock ?? { ...UNTRACKED_STOCK },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Staff: every live variant of these products (inactive ones too), with costs, pricing and stock. */
export async function staffVariantsFor(executor: Executor, productIds: string[]): Promise<Map<string, StaffVariant[]>> {
  const rows = await readVariantRows(executor, productIds);
  const stock = await staffStockFor(executor, { variantIds: rows.map((r) => r.id) });
  const out = new Map<string, StaffVariant[]>();
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push(toStaffVariant(r, stock.get(r.id)));
    out.set(r.product_id, list);
  }
  return out;
}

/** Staff summary for product lists: how many variants and the regular price range of the active ones. */
export function variantSummary(variants: StaffVariant[] | undefined) {
  const list = variants ?? [];
  const active = list.filter((v) => v.is_active);
  const prices = (active.length ? active : list).map((v) => v.selling_price);
  return {
    variant_count: list.length,
    active_variant_count: active.length,
    price_min: prices.length ? Math.min(...prices) : null,
    price_max: prices.length ? Math.max(...prices) : null,
  };
}

/** What a customer sees of a variant: prices and availability, never cost, markup or stock. */
export interface CustomerVariantDto {
  id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  sort_order: number;
  /** The regular price (capped at the MRP); struck through while an offer is on. */
  selling_price: number;
  offer_price: number | null;
  offer_ends_at: string | null;
  offer_kind: 'PRODUCT' | 'CATEGORY' | null;
  /** What one unit costs right now (offer_price ?? selling_price) - what the basket charges. */
  price: number;
  /** Migration 048: the size's MRP only when it is above `price` (shown struck as "MRP"); else null. */
  mrp: number | null;
  /** Can be added to the basket now (switched on and in stock). */
  is_available: boolean;
}

export function toCustomerVariant(row: VariantViewRow, now: Date = new Date()): CustomerVariantDto {
  const selling = money(row.calculated_selling_price);
  const offer = publicOffer(row, selling, now);
  return {
    id: row.id,
    label: row.label,
    sku: row.sku,
    barcode: row.barcode,
    sort_order: row.sort_order,
    selling_price: selling,
    ...offer,
    price: offer.offer_price ?? selling,
    mrp: publicMrp(row.mrp, offer.offer_price ?? selling),
    is_available: row.is_orderable,
  };
}

/** Customer: the active variants of these products (sold-out ones included, marked unavailable). */
export async function customerVariantsFor(executor: Executor, productIds: string[]): Promise<Map<string, CustomerVariantDto[]>> {
  const rows = (await readVariantRows(executor, productIds)).filter((r) => r.is_active);
  const now = new Date();
  const out = new Map<string, CustomerVariantDto[]>();
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push(toCustomerVariant(r, now));
    out.set(r.product_id, list);
  }
  return out;
}

/**
 * The customer price range of a product with variants: the cheapest and
 * dearest price right now (offers included) of its available variants, or of
 * all its active variants when none is available (a sold-out product still
 * shows its prices). The "headline" variant is the cheapest one: its regular
 * price and offer fill selling_price / offer_price for older apps.
 */
export function variantPriceRange(variants: CustomerVariantDto[]) {
  if (variants.length === 0) return null;
  const pool = variants.some((v) => v.is_available) ? variants.filter((v) => v.is_available) : variants;
  const cheapest = pool.reduce((a, b) => (b.price < a.price ? b : a));
  return {
    price_min: Math.min(...pool.map((v) => v.price)),
    price_max: Math.max(...pool.map((v) => v.price)),
    headline: cheapest,
  };
}

// ----------------------------------------------------------------------------
// Writes (ADMIN, OPERATIONS)
// ----------------------------------------------------------------------------
async function productForVariants(executor: Executor, productId: string) {
  const product = await executor
    .selectFrom('v_product_catalog')
    .select(['id', 'name', 'sku', 'custom_markup_percent', 'category_markup_percent', 'parent_category_markup_percent', 'global_markup_percent'])
    .where('id', '=', productId)
    .executeTakeFirst();
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return product;
}

async function liveVariant(executor: Executor, productId: string, variantId: string) {
  const v = await executor
    .selectFrom('product_variants')
    .selectAll()
    .where('id', '=', variantId)
    .where('product_id', '=', productId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!v) throw new AppError('Variant not found.', 404, 'VARIANT_NOT_FOUND');
  return v;
}

/** A label is unique per product (ignoring case and spaces at the ends); a SKU across variants and products. */
async function assertUnique(executor: Executor, args: { productId: string; label?: string; sku?: string | null; exceptId?: string }) {
  if (args.label !== undefined) {
    let q = executor
      .selectFrom('product_variants')
      .select('id')
      .where('product_id', '=', args.productId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb(eb.fn('lower', [eb.fn('btrim', ['label'])]), '=', args.label!.trim().toLowerCase()));
    if (args.exceptId) q = q.where('id', '!=', args.exceptId);
    if (await q.executeTakeFirst()) {
      throw new AppError(`This product already has a variant called '${args.label}'.`, 409, 'VARIANT_LABEL_EXISTS', { label: args.label });
    }
  }
  if (args.sku) {
    let q = executor.selectFrom('product_variants').select('id').where('sku', '=', args.sku).where('deleted_at', 'is', null);
    if (args.exceptId) q = q.where('id', '!=', args.exceptId);
    const taken =
      (await q.executeTakeFirst()) ??
      (await executor.selectFrom('products').select('id').where('sku', '=', args.sku).where('deleted_at', 'is', null).executeTakeFirst());
    if (taken) throw new AppError(`SKU '${args.sku}' is already used.`, 409, 'VARIANT_SKU_EXISTS', { sku: args.sku });
  }
}

/** The variant's selling price after an edit (for the offer check). */
function priceAfter(
  product: Awaited<ReturnType<typeof productForVariants>>,
  v: { purchase_cost: number; pricing_mode: PricingMode; fixed_selling_price: number | null; custom_markup_percent: number | null; mrp: number | null }
) {
  return resolveVariantPrice({
    mrp: v.mrp,
    purchaseCost: v.purchase_cost,
    pricingMode: v.pricing_mode,
    fixedSellingPrice: v.fixed_selling_price,
    variantMarkupPercent: v.custom_markup_percent,
    productMarkupPercent: product.custom_markup_percent,
    categoryMarkupPercent: product.category_markup_percent,
    parentCategoryMarkupPercent: product.parent_category_markup_percent,
    globalMarkupPercent: product.global_markup_percent,
  });
}

const auditShape = (v: Record<string, unknown>) => ({
  label: v.label,
  sku: v.sku ?? null,
  purchase_cost: v.purchase_cost === undefined ? undefined : Number(v.purchase_cost),
  pricing_mode: v.pricing_mode,
  fixed_selling_price: v.fixed_selling_price === null || v.fixed_selling_price === undefined ? null : Number(v.fixed_selling_price),
  custom_markup_percent: v.custom_markup_percent === null || v.custom_markup_percent === undefined ? null : Number(v.custom_markup_percent),
  offer_price: v.offer_price === null || v.offer_price === undefined ? null : Number(v.offer_price),
  mrp: v.mrp === null || v.mrp === undefined ? null : Number(v.mrp),
  is_active: v.is_active,
  is_available: v.is_available,
});

export async function getVariant(productId: string, variantId: string): Promise<StaffVariant> {
  const list = (await staffVariantsFor(db, [productId])).get(productId) ?? [];
  const found = list.find((v) => v.id === variantId);
  if (!found) throw new AppError('Variant not found.', 404, 'VARIANT_NOT_FOUND');
  return found;
}

export async function createVariant(productId: string, input: CreateVariantInput, actor: AuditActor): Promise<StaffVariant> {
  const product = await productForVariants(db, productId);
  await assertUnique(db, { productId, label: input.label, sku: input.sku ?? null });
  const mode: PricingMode = input.pricing_mode ?? 'MARKUP';
  const fixed = input.fixed_selling_price ?? null;
  const offer = input.offer_price ?? null;
  if (offer !== null) {
    const price = priceAfter(product, {
      purchase_cost: input.purchase_cost,
      pricing_mode: mode,
      fixed_selling_price: fixed,
      custom_markup_percent: input.custom_markup_percent ?? null,
      mrp: input.mrp ?? null,
    });
    assertOfferAllowed({ offerPrice: offer, sellingPrice: price.sellingPrice, endsAt: input.offer_ends_at ?? null, endsAtChanged: true, mrpCapped: price.mrpCapped });
  }

  const id = await db.transaction().execute(async (trx) => {
    const sortOrder =
      input.sort_order ??
      Number(
        (
          await trx
            .selectFrom('product_variants')
            .select((eb) => eb.fn.coalesce(eb.fn.max('sort_order'), eb.val(-1)).as('m'))
            .where('product_id', '=', productId)
            .where('deleted_at', 'is', null)
            .executeTakeFirst()
        )?.m ?? -1
      ) + 1;
    const created = await trx
      .insertInto('product_variants')
      .values({
        product_id: productId,
        label: input.label,
        sku: input.sku ?? null,
        barcode: input.barcode ?? null,
        sort_order: sortOrder,
        purchase_cost: input.purchase_cost,
        pricing_mode: mode,
        fixed_selling_price: fixed,
        custom_markup_percent: input.custom_markup_percent ?? null,
        offer_price: offer,
        offer_ends_at: offer === null ? null : input.offer_ends_at ?? null,
        mrp: input.mrp ?? null,
        is_active: input.is_active ?? true,
        is_available: input.is_available ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeAudit(trx, actor, {
      action: 'PRODUCT_VARIANT_CREATED',
      entityType: 'PRODUCT',
      entityId: productId,
      newValues: { variant_id: created.id, ...auditShape(created) },
    });
    return created.id;
  });

  if (input.track_stock !== undefined || input.low_stock_threshold !== undefined || input.stock_count !== undefined) {
    await inventoryRepository.setStockAtomic(
      {
        productId,
        variantId: id,
        darkStoreId: DEFAULT_DARK_STORE_ID,
        tracked: input.track_stock ?? false,
        stockCount: input.stock_count,
        lowStockThreshold: input.low_stock_threshold,
        reason: 'Opening stock (new variant)',
      },
      actor
    );
  }
  logger.info({ productId, variantId: id, sku: product.sku }, 'Product variant created');
  return await getVariant(productId, id);
}

export async function updateVariant(productId: string, variantId: string, input: UpdateVariantInput, actor: AuditActor): Promise<StaffVariant> {
  const product = await productForVariants(db, productId);
  const existing = await liveVariant(db, productId, variantId);
  await assertUnique(db, {
    productId,
    label: input.label !== undefined && input.label.trim().toLowerCase() !== existing.label.trim().toLowerCase() ? input.label : undefined,
    sku: input.sku !== undefined && input.sku !== existing.sku ? input.sku : null,
    exceptId: variantId,
  });

  const mode: PricingMode = input.pricing_mode ?? existing.pricing_mode;
  const fixed = input.fixed_selling_price !== undefined ? input.fixed_selling_price : num(existing.fixed_selling_price);
  if (mode === 'FIXED' && fixed === null) {
    throw new AppError('Enter the selling price for a fixed-price variant.', 400, 'FIXED_PRICE_REQUIRED', { field: 'fixed_selling_price' });
  }
  const markup = input.custom_markup_percent !== undefined ? input.custom_markup_percent : num(existing.custom_markup_percent);
  const cost = input.purchase_cost ?? Number(existing.purchase_cost);
  const mrp = input.mrp !== undefined ? input.mrp : num(existing.mrp);
  const offer = input.offer_price !== undefined ? input.offer_price : num(existing.offer_price);
  const existingEnds = existing.offer_ends_at ? new Date(existing.offer_ends_at).toISOString() : null;
  const requestedEnds = input.offer_ends_at !== undefined ? input.offer_ends_at : existingEnds;
  const offerEnds = offer === null ? null : requestedEnds;
  const endsAtChanged =
    input.offer_ends_at !== undefined &&
    (input.offer_ends_at === null ? existingEnds !== null : new Date(input.offer_ends_at).toISOString() !== existingEnds);
  const priceTouched =
    input.purchase_cost !== undefined ||
    input.pricing_mode !== undefined ||
    input.fixed_selling_price !== undefined ||
    input.custom_markup_percent !== undefined ||
    input.mrp !== undefined;
  if (offer !== null && (input.offer_price !== undefined || priceTouched || endsAtChanged)) {
    const price = priceAfter(product, { purchase_cost: cost, pricing_mode: mode, fixed_selling_price: fixed, custom_markup_percent: markup, mrp });
    assertOfferAllowed({ offerPrice: offer, sellingPrice: price.sellingPrice, endsAt: offerEnds, endsAtChanged, mrpCapped: price.mrpCapped });
  }
  const offerChanged = input.offer_price !== undefined || input.offer_ends_at !== undefined;

  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('product_variants')
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.sort_order !== undefined ? { sort_order: input.sort_order } : {}),
        ...(input.purchase_cost !== undefined ? { purchase_cost: input.purchase_cost } : {}),
        ...(input.pricing_mode !== undefined ? { pricing_mode: input.pricing_mode } : {}),
        ...(input.fixed_selling_price !== undefined ? { fixed_selling_price: input.fixed_selling_price } : {}),
        ...(input.custom_markup_percent !== undefined ? { custom_markup_percent: input.custom_markup_percent } : {}),
        ...(input.mrp !== undefined ? { mrp: input.mrp } : {}),
        ...(offerChanged ? { offer_price: offer, offer_ends_at: offerEnds } : {}),
        ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
        ...(input.is_available !== undefined ? { is_available: input.is_available } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', variantId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeAudit(trx, actor, {
      action: 'PRODUCT_VARIANT_UPDATED',
      entityType: 'PRODUCT',
      entityId: productId,
      oldValues: { variant_id: variantId, ...auditShape(existing) },
      newValues: { variant_id: variantId, ...auditShape(updated) },
    });
  });
  logger.info({ productId, variantId }, 'Product variant updated');
  return await getVariant(productId, variantId);
}

export async function deleteVariant(productId: string, variantId: string, actor: AuditActor) {
  await productForVariants(db, productId);
  const mode = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('product_variants')
      .selectAll()
      .where('id', '=', variantId)
      .where('product_id', '=', productId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) throw new AppError('Variant not found.', 404, 'VARIANT_NOT_FOUND');
    const ordered = await trx.selectFrom('order_items').select('id').where('variant_id', '=', variantId).limit(1).executeTakeFirst();
    let result: 'HARD' | 'SOFT';
    if (ordered) {
      await trx
        .updateTable('product_variants')
        .set({ deleted_at: new Date(), is_active: false, is_available: false, updated_at: new Date() })
        .where('id', '=', variantId)
        .execute();
      // A deleted variant no longer counts for low stock or purchasing.
      await trx.updateTable('inventory').set({ tracking_mode: 'UNTRACKED', updated_at: new Date() }).where('variant_id', '=', variantId).execute();
      result = 'SOFT';
    } else {
      // Its stock rows (and their ledger) and combo items go with it (CASCADE).
      await trx.deleteFrom('product_variants').where('id', '=', variantId).execute();
      result = 'HARD';
    }
    await writeAudit(trx, actor, {
      action: 'PRODUCT_VARIANT_DELETED',
      entityType: 'PRODUCT',
      entityId: productId,
      oldValues: { variant_id: variantId, label: existing.label, sku: existing.sku },
      newValues: { mode: result },
    });
    return result;
  });
  logger.info({ productId, variantId, mode }, 'Product variant deleted');
  return { product_id: productId, variant_id: variantId, mode };
}

export async function reorderVariants(productId: string, variantIds: string[], actor: AuditActor) {
  await productForVariants(db, productId);
  await db.transaction().execute(async (trx) => {
    const live = await trx
      .selectFrom('product_variants')
      .select('id')
      .where('product_id', '=', productId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .execute();
    const liveIds = new Set(live.map((v) => v.id));
    if (variantIds.length !== liveIds.size || variantIds.some((id) => !liveIds.has(id))) {
      throw new AppError('Send every variant of this product exactly once.', 400, 'VARIANT_ORDER_MISMATCH', {
        expected: liveIds.size,
        received: variantIds.length,
      });
    }
    for (const [index, id] of variantIds.entries()) {
      await trx.updateTable('product_variants').set({ sort_order: index, updated_at: new Date() }).where('id', '=', id).execute();
    }
    await writeAudit(trx, actor, {
      action: 'PRODUCT_VARIANTS_REORDERED',
      entityType: 'PRODUCT',
      entityId: productId,
      newValues: { variant_ids: variantIds },
    });
  });
  return (await staffVariantsFor(db, [productId])).get(productId) ?? [];
}

// ----------------------------------------------------------------------------
// Controllers (/api/v1/admin/products/:id/variants; ADMIN, OPERATIONS)
// ----------------------------------------------------------------------------
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const variantsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = productParam.parse(req.params);
      await productForVariants(db, id);
      const variants = (await staffVariantsFor(db, [id])).get(id) ?? [];
      res.status(200).json({ success: true, data: { variants } });
    } catch (err) {
      next(err);
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = productParam.parse(req.params);
      const input = createVariantSchema.parse(req.body);
      res.status(201).json({ success: true, data: { variant: await createVariant(id, input, actorOf(req)) } });
    } catch (err) {
      next(err);
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, variantId } = variantParams.parse(req.params);
      const input = updateVariantSchema.parse(req.body);
      res.status(200).json({ success: true, data: { variant: await updateVariant(id, variantId, input, actorOf(req)) } });
    } catch (err) {
      next(err);
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, variantId } = variantParams.parse(req.params);
      res.status(200).json({ success: true, data: await deleteVariant(id, variantId, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  },
  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = productParam.parse(req.params);
      const { variant_ids } = reorderVariantsSchema.parse(req.body);
      res.status(200).json({ success: true, data: { variants: await reorderVariants(id, variant_ids, actorOf(req)) } });
    } catch (err) {
      next(err);
    }
  },
};
