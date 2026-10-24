import { sql, type ExpressionBuilder, type SelectQueryBuilder, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Multi-category products (migration 060, owner 2026-10-25).
 *
 * A product keeps ONE primary category (products.category_id: its offer, markup, availability
 * hours, seller commission and slug all follow it) plus up to MAX_EXTRA_CATEGORIES extra ones
 * (product_categories) that only decide where it is LISTED: a category's list, count and rails
 * include the products whose primary OR an extra category is that category (or one of its
 * sub-categories, as for the primary since migration 026).
 *
 * The API is deployed before the migration is run by hand in Coolify. Until product_categories
 * exists every function here is a no-op / empty answer, the listings behave exactly as before and
 * the staff forms hide the field (the admin product DTO says so with `extra_categories_ready`).
 * A "yes" is cached for good; a "no" is checked again after a minute.
 */
export const MAX_EXTRA_CATEGORIES = 5;

let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function productCategoriesReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ t: boolean }>`SELECT to_regclass('product_categories') IS NOT NULL AS t`.execute(db);
    cached = { ok: r.rows[0]?.t === true, at: Date.now() };
  } catch {
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 060 is missing (false) or present (true); null = check the database again. */
export function setProductCategoriesReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

/**
 * WHERE for a category-filtered listing on v_product_catalog: the primary category is in `scope`
 * (a category and its sub-categories), or - once migration 060 exists - one of the extra
 * categories is. `scope` is called twice, as each use needs its own query builder.
 */
export type CategoryScope = () => SelectQueryBuilder<Database, 'categories', { id: string }>;

export function inCategoryScope(ready: boolean, scope: CategoryScope) {
  return (eb: ExpressionBuilder<Database, 'v_product_catalog'>) => {
    const primary = eb('category_id', 'in', scope());
    if (!ready) return primary;
    return eb.or([
      primary,
      eb('id', 'in', eb.selectFrom('product_categories').select('product_id').where('category_id', 'in', scope())),
    ]);
  };
}

/** ORDER BY pieces for a category list: the arranged primary products first, extra-category members after (A-Z). */
export function categoryListOrder(scope: CategoryScope) {
  return {
    primaryFirst: sql`CASE WHEN category_id IN (${scope()}) THEN 0 ELSE 1 END`,
    // Arrange (products.display_order) is per primary category: it only orders the primary members.
    arranged: sql`CASE WHEN category_id IN (${scope()}) THEN display_order END`,
  };
}

/** A category's name with its parent: "Rice & Noodles" or "Food › Rice & Noodles". */
export interface ExtraCategory {
  id: string;
  name: string;
  path: string;
}

/** The extra categories of these products (never the primary, never a deleted category), in the order they were added. */
export async function extraCategoriesFor(productIds: string[]): Promise<Map<string, ExtraCategory[]>> {
  const out = new Map<string, ExtraCategory[]>();
  if (!productIds.length || !(await productCategoriesReady())) return out;
  const rows = await db
    .selectFrom('product_categories as pc')
    .innerJoin('products as p', 'p.id', 'pc.product_id')
    .innerJoin('categories as c', 'c.id', 'pc.category_id')
    .leftJoin('categories as par', 'par.id', 'c.parent_id')
    .select(['pc.product_id', 'c.id', 'c.name', 'par.name as parent_name'])
    .where('pc.product_id', 'in', productIds)
    .whereRef('pc.category_id', '<>', 'p.category_id')
    .where('c.deleted_at', 'is', null)
    .orderBy('pc.created_at', 'asc')
    .orderBy('c.name', 'asc')
    .execute();
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push({ id: r.id, name: r.name, path: r.parent_name ? `${r.parent_name} › ${r.name}` : r.name });
    out.set(r.product_id, list);
  }
  return out;
}

/** The staff DTO part: ids and names. `extra_categories_ready` tells the forms whether to show the field. */
export function staffExtraFields(list: ExtraCategory[] | undefined, ready: boolean) {
  const extra = list ?? [];
  return {
    extra_categories_ready: ready,
    extra_category_ids: extra.map((c) => c.id),
    extra_categories: extra,
  };
}

/**
 * Checks a requested extra set: at most 5, no duplicates, none the product's primary, every one
 * an existing active category. Returns the ids as given. Throws 400 EXTRA_CATEGORIES_INVALID.
 * Before migration 060 a non-empty set is refused with 503 EXTRA_CATEGORIES_NOT_READY (never
 * silently dropped: the staff would think it saved).
 */
export async function assertExtraCategories(ids: string[], primaryId: string): Promise<string[]> {
  if (!ids.length) return [];
  if (!(await productCategoriesReady())) {
    throw new AppError('Extra categories will be available shortly.', 503, 'EXTRA_CATEGORIES_NOT_READY');
  }
  if (ids.length > MAX_EXTRA_CATEGORIES) {
    throw new AppError(`A product can be shown in at most ${MAX_EXTRA_CATEGORIES} extra categories.`, 400, 'EXTRA_CATEGORIES_INVALID', {
      field: 'extra_category_ids',
    });
  }
  if (new Set(ids).size !== ids.length) {
    throw new AppError('Each extra category can be chosen once.', 400, 'EXTRA_CATEGORIES_INVALID', { field: 'extra_category_ids' });
  }
  if (ids.includes(primaryId)) {
    throw new AppError('The main category is already where the product shows. Choose other categories.', 400, 'EXTRA_CATEGORIES_INVALID', {
      field: 'extra_category_ids',
    });
  }
  const found = await db
    .selectFrom('categories')
    .select('id')
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .where('is_active', '=', true)
    .execute();
  const known = new Set(found.map((c) => c.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) {
    throw new AppError('Some of these extra categories do not exist or are switched off.', 400, 'EXTRA_CATEGORIES_INVALID', {
      field: 'extra_category_ids',
      category_ids: missing,
    });
  }
  return ids;
}

/**
 * Replaces a product's extra set (update semantics: the request IS the new set). Audited as
 * PRODUCT_CATEGORIES_CHANGED when it changed. Returns whether it changed. No-op before migration 060.
 */
export async function replaceExtraCategories(
  productId: string,
  ids: string[],
  actor?: AuditActor,
  trx?: Transaction<Database>
): Promise<boolean> {
  if (!(await productCategoriesReady())) return false;
  const run = async (t: Transaction<Database>) => {
    const before = await t.selectFrom('product_categories').select('category_id').where('product_id', '=', productId).execute();
    const was = before.map((r) => r.category_id).sort();
    const now = [...ids].sort();
    if (was.length === now.length && was.every((v, i) => v === now[i])) return false;
    const gone = was.filter((id) => !ids.includes(id));
    if (gone.length) {
      await t.deleteFrom('product_categories').where('product_id', '=', productId).where('category_id', 'in', gone).execute();
    }
    const added = ids.filter((id) => !was.includes(id));
    if (added.length) {
      await t
        .insertInto('product_categories')
        .values(added.map((category_id) => ({ product_id: productId, category_id })))
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    if (actor) {
      await writeAudit(t, actor, {
        action: 'PRODUCT_CATEGORIES_CHANGED',
        entityType: 'PRODUCT',
        entityId: productId,
        oldValues: { extra_category_ids: was },
        newValues: { extra_category_ids: ids },
      });
    }
    return true;
  };
  return trx ? await run(trx) : await db.transaction().execute(run);
}

/** A product's primary category became `categoryId`: it cannot also be an extra one. */
export async function dropExtraEqualToPrimary(productId: string, categoryId: string): Promise<void> {
  if (!(await productCategoriesReady())) return;
  await db.deleteFrom('product_categories').where('product_id', '=', productId).where('category_id', '=', categoryId).execute();
}

/** Whether `ids` differs from the product's stored extra set (the import's dry run / skip check). */
export async function extraSetDiffers(productId: string, ids: string[], executor: Transaction<Database> | typeof db = db): Promise<boolean> {
  if (!(await productCategoriesReady())) return false;
  const rows = await executor.selectFrom('product_categories').select('category_id').where('product_id', '=', productId).execute();
  const was = rows.map((r) => r.category_id).sort();
  const now = [...ids].sort();
  return !(was.length === now.length && was.every((v, i) => v === now[i]));
}
