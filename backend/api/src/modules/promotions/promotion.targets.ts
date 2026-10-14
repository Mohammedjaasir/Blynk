import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * Promotion banner targets (owner, 2026-10-14: "for the promotion banner we
 * must be able to select sidebar (sub categories as well)").
 *
 * The three category levels (see docs/api/catalog-tools.md):
 *   Main         = a category group (the heading on the customer home)
 *   Category     = a top-level category (a tile under that heading)
 *   Sub-category = a child category (the sidebar inside that category)
 *
 * How a banner stores each target (no schema change; the existing CHECK
 * allows CATEGORY, PRODUCT, CATALOG):
 *   CATEGORY + category SLUG     - a Category OR a Sub-category (any level).
 *   PRODUCT  + product id        - one product.
 *   CATALOG  + nothing           - the whole catalog (as before).
 *   CATALOG  + category group id - the catalog opened at that Main section.
 *     Older apps ignore the value and just open the catalog, so it degrades
 *     safely.
 *
 * Staff may send a category's id or slug and a product's id or slug; the API
 * stores the canonical form above. The target must exist (not deleted) or the
 * write is refused with 400 INVALID_PROMOTION_TARGET. A switched-off target is
 * allowed (a banner can be prepared before the category goes live).
 */
export type PromotionTargetLevel = 'MAIN' | 'CATEGORY' | 'SUB_CATEGORY' | 'PRODUCT' | 'CATALOG';

export interface PromotionTarget {
  level: PromotionTargetLevel;
  id: string | null;
  slug: string | null;
  name: string | null;
  /** SUB_CATEGORY: its parent category (the screen whose sidebar it sits in). */
  parent_id: string | null;
  parent_slug: string | null;
  parent_name: string | null;
  /** Whether customers can see the target right now (null for the whole catalog). */
  is_active: boolean | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message: string): never {
  throw new AppError(message, 400, 'INVALID_PROMOTION_TARGET');
}

function categoryQuery() {
  return db
    .selectFrom('categories as c')
    .leftJoin('categories as p', (j) => j.onRef('p.id', '=', 'c.parent_id').on('p.deleted_at', 'is', null))
    .select(['c.id', 'c.slug', 'c.name', 'c.is_active', 'c.parent_id', 'p.slug as parent_slug', 'p.name as parent_name'])
    .where('c.deleted_at', 'is', null);
}

async function findCategory(value: string) {
  const q = categoryQuery();
  return await (UUID_RE.test(value)
    ? q.where((eb) => eb.or([eb('c.id', '=', value), eb('c.slug', '=', value.toLowerCase())]))
    : q.where('c.slug', '=', value.toLowerCase())
  ).executeTakeFirst();
}

async function findProduct(value: string) {
  const q = db.selectFrom('products').select(['id', 'slug', 'name', 'is_active']).where('deleted_at', 'is', null);
  return await (UUID_RE.test(value) ? q.where('id', '=', value) : q.where('slug', '=', value.toLowerCase())).executeTakeFirst();
}

async function findGroup(value: string) {
  if (!UUID_RE.test(value)) return undefined;
  return await db
    .selectFrom('category_groups')
    .select(['id', 'name', 'is_active'])
    .where('id', '=', value)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

/**
 * Checks a destination and returns the value to store. Throws 400
 * INVALID_PROMOTION_TARGET when it points at nothing.
 */
export async function normalizePromotionTarget(
  type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null | undefined,
  value: string | null | undefined
): Promise<string | null> {
  const v = value?.trim() || null;
  if (!type) return null;
  if (type === 'CATEGORY') {
    if (!v) invalid('Choose the category or sub-category this banner opens.');
    const c = await findCategory(v);
    if (!c) invalid(`No category '${v}'. Choose a category or sub-category from the list.`);
    return c.slug;
  }
  if (type === 'PRODUCT') {
    if (!v) invalid('Choose the product this banner opens.');
    const p = await findProduct(v);
    if (!p) invalid(`No product '${v}'. Choose a product from the list.`);
    return p.id;
  }
  // CATALOG: optionally a Main section (category group).
  if (!v) return null;
  const g = await findGroup(v);
  if (!g) invalid('That main category (home section) does not exist.');
  return g.id;
}

type DestinationRow = { cta_destination_type: string | null; cta_destination_value: string | null };

/** What each stored destination points at, for staff lists and the customer app (null = nothing usable). */
export async function describeTargets(rows: DestinationRow[]): Promise<Array<PromotionTarget | null>> {
  const catKeys = new Set<string>();
  const productIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const r of rows) {
    const v = r.cta_destination_value;
    if (r.cta_destination_type === 'CATEGORY' && v) catKeys.add(v.toLowerCase());
    if (r.cta_destination_type === 'PRODUCT' && v && UUID_RE.test(v)) productIds.add(v);
    if (r.cta_destination_type === 'CATALOG' && v && UUID_RE.test(v)) groupIds.add(v);
  }
  const catIds = [...catKeys].filter((k) => UUID_RE.test(k));
  const [cats, products, groups] = await Promise.all([
    catKeys.size
      ? categoryQuery()
          .where((eb) => eb.or([eb('c.slug', 'in', [...catKeys]), ...(catIds.length ? [eb('c.id', 'in', catIds)] : [])]))
          .execute()
      : Promise.resolve([]),
    productIds.size
      ? db
          .selectFrom('products')
          .select(['id', 'slug', 'name', 'is_active'])
          .where('id', 'in', [...productIds])
          .where('deleted_at', 'is', null)
          .execute()
      : Promise.resolve([]),
    groupIds.size
      ? db
          .selectFrom('category_groups')
          .select(['id', 'name', 'is_active'])
          .where('id', 'in', [...groupIds])
          .where('deleted_at', 'is', null)
          .execute()
      : Promise.resolve([]),
  ]);
  const catByKey = new Map<string, (typeof cats)[number]>();
  for (const c of cats) {
    catByKey.set(c.slug, c);
    catByKey.set(c.id, c);
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const none = { id: null, slug: null, name: null, parent_id: null, parent_slug: null, parent_name: null, is_active: null };
  return rows.map((r): PromotionTarget | null => {
    const v = r.cta_destination_value;
    switch (r.cta_destination_type) {
      case 'CATEGORY': {
        const c = v ? catByKey.get(v.toLowerCase()) : undefined;
        if (!c) return null;
        return {
          level: c.parent_id ? 'SUB_CATEGORY' : 'CATEGORY',
          id: c.id,
          slug: c.slug,
          name: c.name,
          parent_id: c.parent_id ?? null,
          parent_slug: c.parent_slug ?? null,
          parent_name: c.parent_name ?? null,
          is_active: c.is_active,
        };
      }
      case 'PRODUCT': {
        const p = v ? productById.get(v) : undefined;
        if (!p) return null;
        return { ...none, level: 'PRODUCT', id: p.id, slug: p.slug, name: p.name, is_active: p.is_active };
      }
      case 'CATALOG': {
        const g = v ? groupById.get(v) : undefined;
        if (!g) return { ...none, level: 'CATALOG' };
        return { ...none, level: 'MAIN', id: g.id, name: g.name, is_active: g.is_active };
      }
      default:
        return null;
    }
  });
}
