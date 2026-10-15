import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import {
  belowCostWarning,
  defaultMarkupFrom,
  MAX_MARKUP_PERCENT,
  resolveSellingPrice,
  type PriceWarning,
  type PricingMode,
  type PricingSource,
  type ResolvedPrice,
} from '../pricing/index.js';

/**
 * Selling-price modes and category markup, database side (migration 044;
 * owner, 2026-10-13). The rule itself is pricing/index.ts resolveSellingPrice
 * (and its SQL twin, v_product_catalog); this file reads the markups a
 * product inherits, shapes the staff pricing fields and owns the global
 * default markup setting (system_configurations 'default_markup').
 */

type Executor = typeof db | Transaction<Database>;

export const DEFAULT_MARKUP_KEY = 'default_markup';

/** The global default markup (20% when the row is missing or unusable). */
export async function getGlobalMarkup(executor: Executor = db): Promise<number> {
  const row = await executor.selectFrom('system_configurations').select('value').where('key', '=', DEFAULT_MARKUP_KEY).executeTakeFirst();
  return defaultMarkupFrom(row?.value);
}

export interface InheritedMarkups {
  categoryMarkupPercent: number | null;
  parentCategoryMarkupPercent: number | null;
  globalMarkupPercent: number;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The markups a product in this category inherits (own category, live parent, global). */
export async function inheritedMarkups(categoryId: string, executor: Executor = db): Promise<InheritedMarkups> {
  const [row, globalMarkupPercent] = await Promise.all([
    executor
      .selectFrom('categories as c')
      .leftJoin('categories as pc', (join) => join.onRef('pc.id', '=', 'c.parent_id').on('pc.deleted_at', 'is', null))
      .select(['c.markup_percent as own', 'pc.markup_percent as parent'])
      .where('c.id', '=', categoryId)
      .executeTakeFirst(),
    getGlobalMarkup(executor),
  ]);
  return {
    categoryMarkupPercent: num(row?.own),
    parentCategoryMarkupPercent: num(row?.parent),
    globalMarkupPercent,
  };
}

/** The price a product will have after an edit, from its (merged) pricing inputs. */
export async function priceForProduct(
  args: {
    categoryId: string;
    purchaseCost: number;
    pricingMode: PricingMode;
    fixedSellingPrice: number | null;
    customMarkupPercent: number | null;
    /** Migration 048: the MRP after the edit (null = none); the price is capped at it. */
    mrp?: number | null;
  },
  executor: Executor = db
): Promise<ResolvedPrice> {
  const inherited = await inheritedMarkups(args.categoryId, executor);
  return resolveSellingPrice({
    purchaseCost: args.purchaseCost,
    pricingMode: args.pricingMode,
    fixedSellingPrice: args.fixedSellingPrice,
    productMarkupPercent: args.customMarkupPercent,
    ...inherited,
    mrp: args.mrp ?? null,
  });
}

export interface StaffPricingFields {
  purchase_cost: number;
  pricing_mode: PricingMode;
  fixed_selling_price: number | null;
  custom_markup_percent: number | null;
  category_markup_percent: number | null;
  parent_category_markup_percent: number | null;
  global_markup_percent: number | null;
  /** MARKUP: the markup used; FIXED: the implied markup over cost (null when the cost is 0). */
  effective_markup_percent: number | null;
  pricing_source: PricingSource;
  calculated_selling_price: number;
  /** Same as calculated_selling_price (the regular price customers see; capped at the MRP). */
  selling_price: number;
  /** A selling price below the purchase cost (a low fixed price, or an MRP under cost); null otherwise. */
  price_warning: PriceWarning | null;
  /** Migration 048: the MRP (null when none). */
  mrp: number | null;
  /** Migration 048: the price the markup / fixed price gives before the MRP cap. */
  computed_selling_price: number;
  /** Migration 048: true when computed_selling_price > mrp (selling_price is then the MRP). */
  mrp_capped: boolean;
}

const money = (v: unknown) => Number(Number(v).toFixed(2));

/** Staff (Admin/Ops) pricing fields from a v_product_catalog row. Never sent to customers. */
export function staffPricing(row: {
  purchase_cost: unknown;
  pricing_mode?: unknown;
  fixed_selling_price?: unknown;
  custom_markup_percent: unknown;
  category_markup_percent?: unknown;
  parent_category_markup_percent?: unknown;
  global_markup_percent?: unknown;
  effective_markup_percent: unknown;
  pricing_source?: unknown;
  calculated_selling_price: unknown;
  mrp?: unknown;
  computed_selling_price?: unknown;
  mrp_capped?: unknown;
}): StaffPricingFields {
  const cost = money(row.purchase_cost);
  const selling = money(row.calculated_selling_price);
  const computed = row.computed_selling_price === null || row.computed_selling_price === undefined ? selling : money(row.computed_selling_price);
  const mode: PricingMode = row.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP';
  return {
    purchase_cost: cost,
    pricing_mode: mode,
    fixed_selling_price: row.fixed_selling_price === null || row.fixed_selling_price === undefined ? null : money(row.fixed_selling_price),
    custom_markup_percent: num(row.custom_markup_percent),
    category_markup_percent: num(row.category_markup_percent),
    parent_category_markup_percent: num(row.parent_category_markup_percent),
    global_markup_percent: num(row.global_markup_percent),
    effective_markup_percent: row.effective_markup_percent === null || row.effective_markup_percent === undefined ? null : money(row.effective_markup_percent),
    pricing_source: ((row.pricing_source as PricingSource | undefined) ?? (row.custom_markup_percent != null ? 'PRODUCT_MARKUP' : 'GLOBAL_MARKUP')) as PricingSource,
    calculated_selling_price: selling,
    selling_price: selling,
    price_warning: belowCostWarning(cost, selling),
    mrp: row.mrp === null || row.mrp === undefined ? null : money(row.mrp),
    computed_selling_price: computed,
    mrp_capped: row.mrp_capped === true,
  };
}

/**
 * How many live products WOULD follow this category's markup if it had one:
 * MARKUP products without a custom markup in the category, plus those in its
 * sub-categories that have no markup of their own. For the "N products use
 * this markup" note (also when the markup is blank).
 */
export async function countProductsFollowingCategory(categoryId: string, executor: Executor = db): Promise<number> {
  const row = await executor
    .selectFrom('products as p')
    .innerJoin('categories as c', 'c.id', 'p.category_id')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('p.deleted_at', 'is', null)
    .where('p.pricing_mode', '=', 'MARKUP')
    .where('p.custom_markup_percent', 'is', null)
    .where((eb) =>
      eb.or([
        eb('c.id', '=', categoryId),
        eb.and([eb('c.parent_id', '=', categoryId), eb('c.markup_percent', 'is', null), eb('c.deleted_at', 'is', null)]),
      ])
    )
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Per category: live products that follow its markup (see countProductsFollowingCategory). */
export async function productsFollowingEachCategory(executor: Executor = db): Promise<Map<string, number>> {
  const rows = await executor
    .selectFrom('products as p')
    .innerJoin('categories as c', 'c.id', 'p.category_id')
    .select(['c.id', 'c.parent_id', 'c.markup_percent', sql<number>`count(*)::int`.as('n')])
    .where('p.deleted_at', 'is', null)
    .where('p.pricing_mode', '=', 'MARKUP')
    .where('p.custom_markup_percent', 'is', null)
    .groupBy(['c.id', 'c.parent_id', 'c.markup_percent'])
    .execute();
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.id, (out.get(r.id) ?? 0) + Number(r.n));
    if (r.parent_id && r.markup_percent === null) out.set(r.parent_id, (out.get(r.parent_id) ?? 0) + Number(r.n));
  }
  return out;
}

// ----------------------------------------------------------------------------
// Global default markup (Admin + Ops; audited DEFAULT_MARKUP_UPDATED)
// ----------------------------------------------------------------------------
export const markupPercentSchema = z
  .number({ invalid_type_error: 'Markup must be a number' })
  .finite()
  .min(0, 'Markup cannot be negative')
  .max(MAX_MARKUP_PERCENT, `Markup cannot exceed ${MAX_MARKUP_PERCENT}%`)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Markup can have at most 2 decimals');

export const updateDefaultMarkupSchema = z
  .object({ markup_percent: markupPercentSchema })
  .strict();
export type UpdateDefaultMarkupInput = z.infer<typeof updateDefaultMarkupSchema>;

async function globalMarkupProductCount(executor: Executor): Promise<number> {
  const row = await executor
    .selectFrom('v_product_catalog')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('pricing_source', '=', 'GLOBAL_MARKUP')
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export const defaultMarkupSettings = {
  async get() {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', DEFAULT_MARKUP_KEY)
      .executeTakeFirst();
    return {
      markup_percent: defaultMarkupFrom(row?.value),
      updated_at: row?.updated_at ?? null,
      /** Live products priced by the global markup right now. */
      products_using: await globalMarkupProductCount(db),
    };
  },

  /** Audited (DEFAULT_MARKUP_UPDATED). Every product priced by the global markup changes at once (view-based). */
  async set(input: UpdateDefaultMarkupInput, actor: AuditActor) {
    const pct = Math.round(input.markup_percent * 100) / 100;
    const value = JSON.stringify({ markup_percent: pct });
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', DEFAULT_MARKUP_KEY)
        .forUpdate()
        .executeTakeFirst();
      await trx
        .insertInto('system_configurations')
        .values({ key: DEFAULT_MARKUP_KEY, value, description: 'Global default product markup percentage' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      const previous = before ? defaultMarkupFrom(before.value) : null;
      await writeAudit(trx, actor, {
        action: 'DEFAULT_MARKUP_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: DEFAULT_MARKUP_KEY, markup_percent: previous },
        newValues: { key: DEFAULT_MARKUP_KEY, markup_percent: pct },
      });
      logger.info({ previous, pct, actorId: actor.actorId }, 'Global default markup changed');
    });
    return await this.get();
  },
};
