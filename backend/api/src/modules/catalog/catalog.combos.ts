import type { Request, Response, NextFunction } from 'express';
import type { Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { effectivePrice } from './catalog.offers.js';

/**
 * Combo packs (migration 033; owner, 2026-10-09).
 *
 * Staff (ADMIN, OPERATIONS) pick products, with quantities, into a named
 * combo at one price - e.g. "Breakfast pack: bread + eggs + milk" - with an
 * optional image, end date and an active switch. The customer home shows the
 * live ones as a "Combo packs" rail; adding one puts its items in the cart at
 * the combo price, and the order charges the combo price (order.service
 * priceCart -> priceComboLines; the server decides, never the app).
 *
 * Rules:
 * - A combo holds at least 2 products, or 1 product with quantity 2 or more.
 * - Its price is above 0 and below what its items cost today on their own
 *   ("items total": each item's current price - offers included, the same
 *   effectivePrice an order charges - times its quantity).
 * - LIVE (shown to customers, orderable): switched on, not deleted, not
 *   ended, every item an active product, and still cheaper than its items
 *   total. A combo whose items got cheaper than it simply stops showing,
 *   like a product offer above the selling price.
 * - AVAILABLE: live, and every item is available with enough tracked stock
 *   for the pack (on hand - reserved >= quantity). A sold-out combo still
 *   shows, marked unavailable, like a sold-out product.
 *
 * In an order a combo is one order_combos line (name, price, quantity
 * snapshotted) whose items are ordinary order_items rows pointing at it
 * (order_items.order_combo_id). Their unit prices share the combo price in
 * proportion to the items' own prices (allocateComboPrice), so the order
 * subtotal, packing, stock (taken at pack, put back on cancel), item
 * resolution and the reports all work on them unchanged.
 */

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------
const uuid = z.string().uuid('Invalid id');
const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

const comboItemSchema = z.object({
  product_id: uuid,
  quantity: z.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(100, 'Quantity cannot exceed 100'),
});

const comboItemsSchema = z
  .array(comboItemSchema)
  .min(1, 'Pick the products in the combo')
  .max(30, 'A combo can hold at most 30 products')
  .refine((items) => new Set(items.map((i) => i.product_id)).size === items.length, 'Each product may appear only once - raise its quantity instead')
  .refine(
    (items) => items.length >= 2 || (items.length === 1 && items[0].quantity >= 2),
    'A combo needs at least 2 products, or 1 product with a quantity of 2 or more'
  );

const comboFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120, 'Name must be at most 120 characters'),
  description: z.string().trim().max(500, 'Description must be at most 500 characters').nullable().optional(),
  image_url: z.string().trim().max(2048).nullable().optional(),
  price: z
    .number({ required_error: 'price is required', invalid_type_error: 'Price must be a number' })
    .positive('Price must be above 0')
    .max(99_999_999.99, 'Price cannot exceed 99,999,999.99')
    .refine(twoDecimals, 'Price can have at most 2 decimals'),
  is_active: z.boolean().optional(),
  ends_at: z
    .string()
    .datetime({ offset: true, message: 'End must be a date and time, e.g. 2026-10-31T23:59:59+05:30' })
    .nullable()
    .optional(),
  display_order: z.number().int().min(0).max(100_000).optional(),
  items: comboItemsSchema,
};

export const createComboSchema = z.object(comboFields);
export type CreateComboInput = z.infer<typeof createComboSchema>;

export const updateComboSchema = z
  .object({
    ...comboFields,
    name: comboFields.name.optional(),
    price: comboFields.price.optional(),
    items: comboItemsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateComboInput = z.infer<typeof updateComboSchema>;

/** One combo line of an order (order.schema createOrderSchema.combos). */
export const orderComboLineSchema = z.object({
  combo_id: uuid,
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(20, 'Quantity cannot exceed 20'),
});
export type OrderComboLine = z.infer<typeof orderComboLineSchema>;

const idParam = z.object({ id: uuid });

// ----------------------------------------------------------------------------
// Money
// ----------------------------------------------------------------------------
const toCents = (n: number) => Math.round(Number(n) * 100);
const fromCents = (c: number) => Number((c / 100).toFixed(2));

export interface AllocatedLine {
  /** Index into the items given. */
  index: number;
  quantity: number;
  unit_price: number;
}

/**
 * Shares one pack's price across its items in proportion to their own
 * prices, in whole cents, so the lines add up to the price EXACTLY (order
 * items keep subtotal = unit price x quantity, and the order subtotal is
 * their sum). Rounded down first; the cents left over go to the items with
 * the smallest quantities. Only when every item has a quantity above 1 and
 * the leftover cannot be spread evenly is one unit of the first item split
 * onto its own line - the same product twice under the combo.
 */
export function allocateComboPrice(price: number, items: Array<{ unit_price: number; quantity: number }>): AllocatedLine[] {
  const target = toCents(price);
  const regular = items.map((i) => toCents(i.unit_price));
  const total = items.reduce((sum, item, idx) => sum + regular[idx] * item.quantity, 0);
  if (items.length === 0 || target <= 0) return [];
  // All items free (cannot happen for a live combo): an even share.
  const units = items.map((_, idx) =>
    total > 0 ? Math.floor((regular[idx] * target) / total) : Math.floor(target / items.reduce((s, i) => s + i.quantity, 0))
  );
  let left = target - items.reduce((sum, item, idx) => sum + units[idx] * item.quantity, 0);
  const bySmallestQty = items.map((_, idx) => idx).sort((a, b) => items[a].quantity - items[b].quantity || a - b);
  for (const idx of bySmallestQty) {
    if (left <= 0) break;
    const add = Math.floor(left / items[idx].quantity);
    units[idx] += add;
    left -= add * items[idx].quantity;
  }
  const lines: AllocatedLine[] = [];
  items.forEach((item, idx) => {
    if (left > 0 && idx === bySmallestQty[0]) {
      // Split one unit off to carry the last cents.
      if (item.quantity > 1) lines.push({ index: idx, quantity: item.quantity - 1, unit_price: fromCents(units[idx]) });
      lines.push({ index: idx, quantity: 1, unit_price: fromCents(units[idx] + left) });
      left = 0;
    } else {
      lines.push({ index: idx, quantity: item.quantity, unit_price: fromCents(units[idx]) });
    }
  });
  return lines;
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------
type Executor = typeof db | Transaction<Database>;

export interface ComboItemView {
  product_id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  unit: string | null;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x: number;
  image_focal_y: number;
  quantity: number;
  /** The product's regular price. */
  selling_price: number;
  /** What one unit costs on its own today (offers included). */
  unit_price: number;
  is_active: boolean;
  is_available: boolean;
  /** Tracked stock covers this item's quantity in one pack (always true for untracked products). */
  in_stock: boolean;
  /** Units free to sell right now for a TRACKED product; null when untracked. */
  stock_available: number | null;
  /** Internal, for order pricing: never sent to customers. */
  purchase_cost: number;
  effective_markup_percent: number;
}

export interface ComboView {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at: string | null;
  display_order: number;
  created_at: Date;
  updated_at: Date;
  items: ComboItemView[];
  /** What the items cost on their own today, per pack. */
  items_total: number;
  /** items_total - price, never below 0. */
  saving: number;
  /** Shown to customers and orderable (see the module comment). */
  is_live: boolean;
  /** Live and every item in stock. */
  is_available: boolean;
  /** Why it is not live, for Ops/Admin: INACTIVE, ENDED, ITEM_INACTIVE, NOT_CHEAPER; null when live. */
  not_live_reason: 'INACTIVE' | 'ENDED' | 'ITEM_INACTIVE' | 'NOT_CHEAPER' | null;
}

function clampFocal(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/** The only active store (Dharga Town) - whose stock a combo is measured against. */
async function activeStoreId(executor: Executor): Promise<string | null> {
  const row = await executor.selectFrom('dark_stores').select('id').where('is_active', '=', true).limit(1).executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Combos with their items, priced right now. `ids` limits the read; without
 * it every combo that is not deleted is read (Ops/Admin list, then filtered
 * to live ones for customers).
 */
export async function loadCombos(executor: Executor, ids?: string[], now: Date = new Date()): Promise<ComboView[]> {
  if (ids && ids.length === 0) return [];
  let q = executor.selectFrom('combos').selectAll().where('deleted_at', 'is', null);
  if (ids) q = q.where('id', 'in', ids);
  const combos = await q.orderBy('display_order', 'asc').orderBy('created_at', 'desc').execute();
  if (combos.length === 0) return [];

  const comboIds = combos.map((c) => c.id);
  // The product's catalog row (v_product_catalog skips deleted products, so a
  // deleted one reads as missing -> inactive).
  const items = await executor
    .selectFrom('combo_items as ci')
    .innerJoin('products as p', 'p.id', 'ci.product_id')
    .leftJoin('v_product_catalog as v', 'v.id', 'ci.product_id')
    .select([
      'ci.combo_id',
      'ci.product_id',
      'ci.quantity',
      'ci.sort_order',
      'p.name',
      'p.slug',
      'p.sku',
      'p.unit',
      'p.pack_size',
      'p.image_url',
      'p.image_focal_x',
      'p.image_focal_y',
      'p.purchase_cost',
      'v.effective_markup_percent',
      'v.calculated_selling_price',
      'v.is_active',
      'v.is_available',
      'v.offer_price',
      'v.offer_ends_at',
      'v.category_offer_percent',
      'v.category_offer_ends_at',
    ])
    .where('ci.combo_id', 'in', comboIds)
    .orderBy('ci.sort_order', 'asc')
    .orderBy('p.name', 'asc')
    .execute();

  const storeId = await activeStoreId(executor);
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const stock =
    storeId && productIds.length
      ? await executor
          .selectFrom('inventory')
          .select(['product_id', 'tracking_mode', 'quantity_on_hand', 'quantity_reserved'])
          .where('dark_store_id', '=', storeId)
          .where('product_id', 'in', productIds)
          .execute()
      : [];
  const tracked = new Map(
    stock.filter((s) => s.tracking_mode === 'TRACKED').map((s) => [s.product_id, s.quantity_on_hand - s.quantity_reserved])
  );

  return combos.map((c) => {
    const mine: ComboItemView[] = items
      .filter((i) => i.combo_id === c.id)
      .map((i) => {
        const listed = i.calculated_selling_price !== null && i.calculated_selling_price !== undefined;
        const selling = listed ? Number(Number(i.calculated_selling_price).toFixed(2)) : 0;
        const available = tracked.has(i.product_id) ? tracked.get(i.product_id)! : null;
        return {
          product_id: i.product_id,
          name: i.name,
          slug: i.slug,
          sku: i.sku,
          unit: i.unit,
          pack_size: i.pack_size,
          image_url: i.image_url,
          image_focal_x: clampFocal(i.image_focal_x),
          image_focal_y: clampFocal(i.image_focal_y),
          quantity: i.quantity,
          selling_price: selling,
          unit_price: listed ? effectivePrice(i, selling, now) : 0,
          is_active: listed && i.is_active === true,
          is_available: listed && i.is_active === true && i.is_available === true,
          in_stock: available === null || available >= i.quantity,
          stock_available: available,
          purchase_cost: Number(Number(i.purchase_cost).toFixed(2)),
          effective_markup_percent: listed ? Number(Number(i.effective_markup_percent).toFixed(2)) : 0,
        };
      });
    const price = Number(Number(c.price).toFixed(2));
    const itemsTotal = fromCents(mine.reduce((sum, i) => sum + toCents(i.unit_price) * i.quantity, 0));
    const ended = c.ends_at !== null && new Date(c.ends_at).getTime() <= now.getTime();
    const notLive: ComboView['not_live_reason'] = !c.is_active
      ? 'INACTIVE'
      : ended
        ? 'ENDED'
        : // A product deleted from the catalog leaves the combo (CASCADE): fewer
          // than 2 units left is no longer a combo.
          mine.reduce((n, i) => n + i.quantity, 0) < 2 || mine.some((i) => !i.is_active)
          ? 'ITEM_INACTIVE'
          : !(price < itemsTotal)
            ? 'NOT_CHEAPER'
            : null;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      image_url: c.image_url,
      price,
      is_active: c.is_active,
      ends_at: c.ends_at ? new Date(c.ends_at).toISOString() : null,
      display_order: c.display_order,
      created_at: c.created_at,
      updated_at: c.updated_at,
      items: mine,
      items_total: itemsTotal,
      saving: Math.max(0, fromCents(toCents(itemsTotal) - toCents(price))),
      is_live: notLive === null,
      is_available: notLive === null && mine.every((i) => i.is_available && i.in_stock),
      not_live_reason: notLive,
    };
  });
}

/** What a customer sees: no costs, markups or stock counts. */
export function publicCombo(c: ComboView) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    image_url: c.image_url,
    price: c.price,
    ends_at: c.ends_at,
    items_total: c.items_total,
    saving: c.saving,
    is_available: c.is_available,
    items: c.items.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      slug: i.slug,
      unit: i.unit,
      pack_size: i.pack_size,
      image_url: i.image_url,
      image_focal_x: i.image_focal_x,
      image_focal_y: i.image_focal_y,
      quantity: i.quantity,
      selling_price: i.selling_price,
      unit_price: i.unit_price,
      is_available: i.is_available && i.in_stock,
    })),
  };
}

/** Ops/Admin: everything but the cost figures. */
export function adminCombo(c: ComboView) {
  return {
    ...c,
    items: c.items.map(({ purchase_cost: _c, effective_markup_percent: _m, ...rest }) => rest),
  };
}

// ----------------------------------------------------------------------------
// Order pricing (order.service priceCart)
// ----------------------------------------------------------------------------
export interface PricedComboLine {
  combo_id: string;
  combo_name_snapshot: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  items_regular_total: number;
  items: Array<{
    product_id: string;
    product_name_snapshot: string;
    sku_snapshot: string;
    unit_snapshot: string;
    unit_selling_price: number;
    estimated_unit_cost: number;
    markup_percentage_applied: number;
    quantity: number;
    subtotal: number;
  }>;
}

/**
 * Authoritative combo pricing for an order: each combo must be live and
 * available, and tracked stock must cover every pack ordered plus any loose
 * units of the same products in the cart (`looseQuantities`). The combo is
 * charged its own price; its items carry their share (allocateComboPrice).
 */
export async function priceComboLines(
  lines: OrderComboLine[],
  looseQuantities: Map<string, number> = new Map(),
  executor: Executor = db
): Promise<PricedComboLine[]> {
  if (lines.length === 0) return [];
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.combo_id, (merged.get(l.combo_id) ?? 0) + l.quantity);
  const combos = await loadCombos(executor, [...merged.keys()]);
  const byId = new Map(combos.map((c) => [c.id, c]));

  const need = new Map(looseQuantities);
  for (const [comboId, qty] of merged) {
    const combo = byId.get(comboId);
    if (!combo) throw new AppError('A combo pack in your cart no longer exists.', 400, 'COMBO_NOT_FOUND', { combo_id: comboId });
    if (!combo.is_live || combo.items.some((i) => !i.is_available)) {
      throw new AppError(`The combo '${combo.name}' is no longer available.`, 400, 'COMBO_UNAVAILABLE', {
        combo_id: combo.id,
        name: combo.name,
      });
    }
    if (qty > 20) throw new AppError('You can order at most 20 of one combo.', 400, 'COMBO_QUANTITY_TOO_HIGH', { combo_id: comboId });
    for (const i of combo.items) need.set(i.product_id, (need.get(i.product_id) ?? 0) + i.quantity * qty);
  }
  for (const [comboId] of merged) {
    const combo = byId.get(comboId)!;
    const short = combo.items.find((i) => i.stock_available !== null && i.stock_available < (need.get(i.product_id) ?? 0));
    if (short) {
      throw new AppError(`Not enough ${short.name} in stock for the combo '${combo.name}'.`, 409, 'COMBO_OUT_OF_STOCK', {
        combo_id: combo.id,
        name: combo.name,
        product_id: short.product_id,
        available: short.stock_available,
      });
    }
  }

  return [...merged].map(([comboId, qty]) => {
    const combo = byId.get(comboId)!;
    const allocated = allocateComboPrice(combo.price, combo.items);
    return {
      combo_id: combo.id,
      combo_name_snapshot: combo.name,
      unit_price: combo.price,
      quantity: qty,
      subtotal: fromCents(toCents(combo.price) * qty),
      items_regular_total: combo.items_total,
      items: allocated.map((line) => {
        const item = combo.items[line.index];
        const quantity = line.quantity * qty;
        return {
          product_id: item.product_id,
          product_name_snapshot: item.name,
          sku_snapshot: item.sku ?? '',
          unit_snapshot: item.unit ?? '',
          unit_selling_price: line.unit_price,
          estimated_unit_cost: item.purchase_cost,
          markup_percentage_applied: item.effective_markup_percent,
          quantity,
          subtotal: fromCents(toCents(line.unit_price) * quantity),
        };
      }),
    };
  });
}

// ----------------------------------------------------------------------------
// Writes (ADMIN, OPERATIONS)
// ----------------------------------------------------------------------------
/** Products must exist and be live; the price must be below the items' total today. */
async function assertComboAllowed(
  executor: Executor,
  args: { price: number; items: Array<{ product_id: string; quantity: number }>; endsAt: string | null; endsAtChanged: boolean }
) {
  const ids = args.items.map((i) => i.product_id);
  const rows = await executor
    .selectFrom('v_product_catalog')
    .select(['id', 'name', 'is_active', 'calculated_selling_price', 'offer_price', 'offer_ends_at', 'category_offer_percent', 'category_offer_ends_at'])
    .where('id', 'in', ids)
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new AppError('One or more products in the combo do not exist.', 400, 'COMBO_PRODUCT_NOT_FOUND', { product_ids: missing });
  }
  const inactive = rows.filter((r) => !r.is_active);
  if (inactive.length) {
    throw new AppError(`'${inactive[0].name}' is switched off, so it cannot go in a combo.`, 400, 'COMBO_PRODUCT_INACTIVE', {
      product_ids: inactive.map((r) => r.id),
    });
  }
  const totalCents = args.items.reduce((sum, i) => {
    const r = byId.get(i.product_id)!;
    const selling = Number(Number(r.calculated_selling_price).toFixed(2));
    return sum + toCents(effectivePrice(r, selling)) * i.quantity;
  }, 0);
  if (!(toCents(args.price) < totalCents)) {
    throw new AppError(
      `The combo price must be lower than its items bought separately (LKR ${fromCents(totalCents).toFixed(2)}).`,
      400,
      'COMBO_PRICE_NOT_LOWER',
      { price: args.price, items_total: fromCents(totalCents) }
    );
  }
  if (args.endsAt !== null && args.endsAtChanged && new Date(args.endsAt).getTime() <= Date.now()) {
    throw new AppError('The end date must be in the future.', 400, 'OFFER_END_IN_PAST', { ends_at: args.endsAt });
  }
}

async function writeItems(trx: Transaction<Database>, comboId: string, items: Array<{ product_id: string; quantity: number }>) {
  await trx.deleteFrom('combo_items').where('combo_id', '=', comboId).execute();
  await trx
    .insertInto('combo_items')
    .values(items.map((i, idx) => ({ combo_id: comboId, product_id: i.product_id, quantity: i.quantity, sort_order: idx })))
    .execute();
}

const auditShape = (c: { name: string; price: number | string; is_active: boolean; ends_at: Date | string | null }, items?: unknown) => ({
  name: c.name,
  price: Number(c.price),
  is_active: c.is_active,
  ends_at: c.ends_at ? new Date(c.ends_at).toISOString() : null,
  ...(items !== undefined ? { items } : {}),
});

export async function createCombo(input: CreateComboInput, actor: AuditActor) {
  await assertComboAllowed(db, { price: input.price, items: input.items, endsAt: input.ends_at ?? null, endsAtChanged: true });
  const id = await db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('combos')
      .values({
        name: input.name,
        description: input.description ?? null,
        image_url: input.image_url ?? null,
        price: input.price,
        is_active: input.is_active ?? true,
        ends_at: input.ends_at ?? null,
        display_order: input.display_order ?? 0,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeItems(trx, created.id, input.items);
    await writeAudit(trx, actor, {
      action: 'COMBO_CREATED',
      entityType: 'COMBO',
      entityId: created.id,
      newValues: auditShape(created, input.items),
    });
    return created.id;
  });
  logger.info({ comboId: id }, 'Combo created');
  return (await loadCombos(db, [id]))[0];
}

export async function updateCombo(id: string, input: UpdateComboInput, actor: AuditActor) {
  const existing = await db.selectFrom('combos').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!existing) throw new AppError('Combo not found.', 404, 'COMBO_NOT_FOUND');
  const existingItems = await db.selectFrom('combo_items').select(['product_id', 'quantity']).where('combo_id', '=', id).orderBy('sort_order').execute();

  const items = input.items ?? existingItems;
  const price = input.price ?? Number(existing.price);
  const existingEnds = existing.ends_at ? new Date(existing.ends_at).toISOString() : null;
  const endsAt = input.ends_at !== undefined ? input.ends_at : existingEnds;
  const endsAtChanged =
    input.ends_at !== undefined && (input.ends_at === null ? existingEnds !== null : new Date(input.ends_at).toISOString() !== existingEnds);
  // Re-checked when the price or the items change (or it is switched back
  // on): the combo must still be a saving. A name or photo edit is not
  // refused because item prices moved since.
  if (input.price !== undefined || input.items !== undefined || endsAtChanged || (input.is_active === true && !existing.is_active)) {
    await assertComboAllowed(db, { price, items, endsAt, endsAtChanged });
  }

  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('combos')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.image_url !== undefined ? { image_url: input.image_url } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
        ...(input.ends_at !== undefined ? { ends_at: input.ends_at } : {}),
        ...(input.display_order !== undefined ? { display_order: input.display_order } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (input.items) await writeItems(trx, id, input.items);
    await writeAudit(trx, actor, {
      action: 'COMBO_UPDATED',
      entityType: 'COMBO',
      entityId: id,
      oldValues: auditShape(existing, input.items ? existingItems : undefined),
      newValues: auditShape(updated, input.items),
    });
  });
  logger.info({ comboId: id }, 'Combo updated');
  return (await loadCombos(db, [id]))[0];
}

/** Soft delete: past orders keep pointing at it (order_combos.combo_id). */
export async function deleteCombo(id: string, actor: AuditActor) {
  const existing = await db.selectFrom('combos').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!existing) throw new AppError('Combo not found.', 404, 'COMBO_NOT_FOUND');
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('combos').set({ deleted_at: new Date(), is_active: false, updated_at: new Date() }).where('id', '=', id).execute();
    await writeAudit(trx, actor, { action: 'COMBO_DELETED', entityType: 'COMBO', entityId: id, oldValues: auditShape(existing) });
  });
  logger.info({ comboId: id }, 'Combo deleted');
  return { id, deleted: true };
}

// ----------------------------------------------------------------------------
// Controllers
// ----------------------------------------------------------------------------
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const combosController = {
  /** GET /catalog/combos (and /combos): live combos, sold-out ones marked. */
  async listPublic(_req: Request, res: Response, next: NextFunction) {
    try {
      const combos = (await loadCombos(db)).filter((c) => c.is_live).map(publicCombo);
      res.status(200).json({ success: true, data: { combos } });
    } catch (err) {
      next(err);
    }
  },

  async getPublic(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParam.parse(req.params);
      const combo = (await loadCombos(db, [id]))[0];
      if (!combo || !combo.is_live) throw new AppError('Combo not found.', 404, 'COMBO_NOT_FOUND');
      res.status(200).json({ success: true, data: { combo: publicCombo(combo) } });
    } catch (err) {
      next(err);
    }
  },

  /** GET /admin/combos: every combo that is not deleted, with why it is not live. */
  async listAdmin(_req: Request, res: Response, next: NextFunction) {
    try {
      const combos = (await loadCombos(db)).map(adminCombo);
      res.status(200).json({ success: true, data: { combos } });
    } catch (err) {
      next(err);
    }
  },

  async getAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParam.parse(req.params);
      const combo = (await loadCombos(db, [id]))[0];
      if (!combo) throw new AppError('Combo not found.', 404, 'COMBO_NOT_FOUND');
      res.status(200).json({ success: true, data: { combo: adminCombo(combo) } });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createComboSchema.parse(req.body);
      const combo = await createCombo(input, actorOf(req));
      res.status(201).json({ success: true, data: { combo: adminCombo(combo) } });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParam.parse(req.params);
      const input = updateComboSchema.parse(req.body);
      const combo = await updateCombo(id, input, actorOf(req));
      res.status(200).json({ success: true, data: { combo: adminCombo(combo) } });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParam.parse(req.params);
      res.status(200).json({ success: true, data: await deleteCombo(id, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  },
};

/** For tests and the order module: how many units of a product loose lines take. */
export function looseQuantities(items: Array<{ product_id: string; quantity: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.quantity);
  return m;
}
