import type { Request, Response, NextFunction } from 'express';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Category groups on the customer home (migration 025).
 *
 * The home shows headings ("Grocery & Kitchen", "Snacks & Drinks", ...) each
 * over a grid of category tiles. Staff (ADMIN, OPERATIONS) create, rename,
 * switch on/off, reorder and delete groups, and choose which categories sit
 * in each group and in what order.
 *
 * - Public GET /catalog/home-groups: active groups in order, each with its
 *   active, live, top-level (migration 026) categories in order; empty
 *   groups are left out. Categories with no group close the list as "More"
 *   (id null), only if there are any. Sub-categories are reached through
 *   their parent.
 *   A switched-off group hides its whole section, categories included - they
 *   stay reachable by search and by link.
 * - Every write here touches category_groups or categories, whose migration
 *   011/025 triggers NOTIFY catalog_changed, so open customer homes refresh.
 * - Every write is audited (entity_type CATEGORY_GROUP); a reorder of the
 *   groups themselves has no single row, so it uses the nil UUID like the
 *   store-wide settings do.
 */

export const MORE_GROUP_NAME = 'More';

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------
const groupName = z.string().trim().min(1, 'Name is required').max(80, 'Name must be at most 80 characters');
const uuid = z.string().uuid('Invalid id');

export const createGroupSchema = z.object({
  name: groupName,
  is_active: z.boolean().optional(),
});

export const updateGroupSchema = z
  .object({ name: groupName.optional(), is_active: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.is_active !== undefined, { message: 'Nothing to update' });

export const reorderGroupsSchema = z.object({
  group_ids: z.array(uuid).refine((ids) => new Set(ids).size === ids.length, 'Each group may appear only once'),
});

export const setGroupCategoriesSchema = z.object({
  category_ids: z
    .array(uuid)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Each category may appear only once'),
});

const idParam = z.object({ id: uuid });

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------
function clampFocal(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export interface HomeGroupCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  image_focal_x: number;
  image_focal_y: number;
  /** Migration 026: always null here - the home lists top-level categories only. */
  parent_id: string | null;
}

export interface HomeGroup {
  id: string | null;
  name: string;
  sort_order: number;
  categories: HomeGroupCategory[];
}

/** The customer home: active groups in order, then "More" for the ungrouped. */
export async function listHomeGroups(): Promise<HomeGroup[]> {
  const [groups, categories] = await Promise.all([
    db
      .selectFrom('category_groups')
      .select(['id', 'name', 'sort_order'])
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute(),
    db
      .selectFrom('categories')
      .leftJoin('category_groups as g', (join) =>
        join.onRef('g.id', '=', 'categories.group_id').on('g.deleted_at', 'is', null)
      )
      .select([
        'categories.id',
        'categories.name',
        'categories.slug',
        'categories.description',
        'categories.image_url',
        'categories.display_order',
        'categories.image_focal_x',
        'categories.image_focal_y',
        'categories.group_sort_order',
        // A group_id pointing at a deleted group counts as no group.
        'g.id as live_group_id',
      ])
      .where('categories.is_active', '=', true)
      .where('categories.deleted_at', 'is', null)
      // Migration 026: sub-categories are reached through their parent.
      .where('categories.parent_id', 'is', null)
      .orderBy('categories.group_sort_order', 'asc')
      .orderBy('categories.display_order', 'asc')
      .orderBy('categories.name', 'asc')
      .execute(),
  ]);

  const byGroup = new Map<string | null, HomeGroupCategory[]>();
  for (const c of categories) {
    const key = c.live_group_id ?? null;
    const tile: HomeGroupCategory = {
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      image_url: c.image_url,
      display_order: c.display_order,
      image_focal_x: clampFocal(c.image_focal_x),
      image_focal_y: clampFocal(c.image_focal_y),
      parent_id: null,
    };
    const list = byGroup.get(key);
    if (list) list.push(tile);
    else byGroup.set(key, [tile]);
  }

  const result: HomeGroup[] = [];
  for (const g of groups) {
    const tiles = byGroup.get(g.id);
    if (tiles && tiles.length) result.push({ id: g.id, name: g.name, sort_order: g.sort_order, categories: tiles });
  }
  const ungrouped = byGroup.get(null);
  if (ungrouped && ungrouped.length) {
    // Ungrouped tiles keep the plain category order (display_order, name).
    ungrouped.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    result.push({ id: null, name: MORE_GROUP_NAME, sort_order: result.length, categories: ungrouped });
  }
  return result;
}

type Executor = typeof db | Transaction<Database>;

async function groupCategories(executor: Executor, groupIds: string[] | null) {
  let q = executor
    .selectFrom('categories')
    .leftJoin('category_groups as g', (join) =>
      join.onRef('g.id', '=', 'categories.group_id').on('g.deleted_at', 'is', null)
    )
    .select([
      'categories.id',
      'categories.name',
      'categories.slug',
      'categories.image_url',
      'categories.is_active',
      'g.id as group_id',
      'categories.group_sort_order',
    ])
    .where('categories.deleted_at', 'is', null)
    .orderBy('categories.group_sort_order', 'asc')
    .orderBy('categories.display_order', 'asc')
    .orderBy('categories.name', 'asc');
  if (groupIds) q = q.where('g.id', 'in', groupIds.length ? groupIds : [SETTINGS_ENTITY_ID]);
  return await q.execute();
}

/** Staff view: every live group (active or not) with all its live categories, plus the unassigned ones. */
export async function listGroupsAdmin(executor: Executor = db) {
  const [groups, categories] = await Promise.all([
    executor
      .selectFrom('category_groups')
      .select(['id', 'name', 'sort_order', 'is_active', 'created_at', 'updated_at'])
      .where('deleted_at', 'is', null)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute(),
    groupCategories(executor, null),
  ]);
  const withCategories = groups.map((g) => ({
    ...g,
    categories: categories.filter((c) => c.group_id === g.id),
  }));
  // Unassigned categories read best in plain name order.
  const unassigned = categories
    .filter((c) => c.group_id === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups: withCategories, unassigned };
}

async function getGroupAdmin(executor: Executor, id: string) {
  const group = await executor
    .selectFrom('category_groups')
    .select(['id', 'name', 'sort_order', 'is_active', 'created_at', 'updated_at'])
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!group) throw new AppError('Category group not found.', 404, 'CATEGORY_GROUP_NOT_FOUND');
  return { ...group, categories: await groupCategories(executor, [id]) };
}

// ----------------------------------------------------------------------------
// Writes
// ----------------------------------------------------------------------------
async function assertNameFree(executor: Executor, name: string, exceptId?: string) {
  let q = executor
    .selectFrom('category_groups')
    .select('id')
    .where(sql<boolean>`lower(name) = lower(${name})`)
    .where('deleted_at', 'is', null);
  if (exceptId) q = q.where('id', '<>', exceptId);
  if (await q.executeTakeFirst()) {
    throw new AppError(`A category group named '${name}' already exists.`, 409, 'CATEGORY_GROUP_NAME_EXISTS');
  }
}

function isUniqueViolation(err: unknown) {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

async function withNameGuard<T>(name: string | undefined, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(`A category group named '${name}' already exists.`, 409, 'CATEGORY_GROUP_NAME_EXISTS');
    }
    throw err;
  }
}

export async function createGroup(input: z.infer<typeof createGroupSchema>, actor: AuditActor) {
  return await withNameGuard(input.name, () =>
    db.transaction().execute(async (trx) => {
      await assertNameFree(trx, input.name);
      const next = await trx
        .selectFrom('category_groups')
        .select(sql<number>`COALESCE(MAX(sort_order) + 1, 0)::int`.as('n'))
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const created = await trx
        .insertInto('category_groups')
        .values({ name: input.name, is_active: input.is_active ?? true, sort_order: Number(next.n) })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, actor, {
        action: 'CATEGORY_GROUP_CREATED',
        entityType: 'CATEGORY_GROUP',
        entityId: created.id,
        newValues: { name: input.name, is_active: input.is_active ?? true },
      });
      logger.info({ groupId: created.id }, 'Category group created');
      return await getGroupAdmin(trx, created.id);
    })
  );
}

export async function updateGroup(id: string, input: z.infer<typeof updateGroupSchema>, actor: AuditActor) {
  return await withNameGuard(input.name, () =>
    db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('category_groups')
        .select(['id', 'name', 'is_active'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) throw new AppError('Category group not found.', 404, 'CATEGORY_GROUP_NOT_FOUND');
      if (input.name !== undefined) await assertNameFree(trx, input.name, id);
      await trx
        .updateTable('category_groups')
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await writeAudit(trx, actor, {
        action: 'CATEGORY_GROUP_UPDATED',
        entityType: 'CATEGORY_GROUP',
        entityId: id,
        oldValues: { name: existing.name, is_active: existing.is_active },
        newValues: { ...input },
      });
      return await getGroupAdmin(trx, id);
    })
  );
}

/** Soft delete (catalog convention, migration 017); its categories become unassigned. */
export async function deleteGroup(id: string, actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('category_groups')
      .select(['id', 'name'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!existing) throw new AppError('Category group not found.', 404, 'CATEGORY_GROUP_NOT_FOUND');
    const released = await trx
      .updateTable('categories')
      .set({ group_id: null, group_sort_order: 0, updated_at: new Date() })
      .where('group_id', '=', id)
      .executeTakeFirst();
    await trx
      .updateTable('category_groups')
      .set({ deleted_at: new Date(), is_active: false, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    const count = Number(released.numUpdatedRows ?? 0);
    await writeAudit(trx, actor, {
      action: 'CATEGORY_GROUP_DELETED',
      entityType: 'CATEGORY_GROUP',
      entityId: id,
      oldValues: { name: existing.name },
      newValues: { released_category_count: count },
    });
    logger.info({ groupId: id, released: count }, 'Category group deleted');
    return { group_id: id, released_category_count: count };
  });
}

/** The new order of every live group; the list must name each exactly once. */
export async function reorderGroups(groupIds: string[], actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const live = await trx
      .selectFrom('category_groups')
      .select('id')
      .where('deleted_at', 'is', null)
      .forUpdate()
      .execute();
    const liveIds = new Set(live.map((g) => g.id));
    if (groupIds.length !== liveIds.size || groupIds.some((id) => !liveIds.has(id))) {
      throw new AppError('List every category group exactly once to reorder them.', 400, 'INVALID_GROUP_ORDER', {
        expected_count: liveIds.size,
      });
    }
    if (groupIds.length) {
      await sql`
        UPDATE category_groups g
           SET sort_order = (x.ord - 1)::int, updated_at = now()
          FROM unnest(${groupIds}::uuid[]) WITH ORDINALITY AS x(id, ord)
         WHERE g.id = x.id AND g.sort_order IS DISTINCT FROM (x.ord - 1)::int
      `.execute(trx);
    }
    await writeAudit(trx, actor, {
      action: 'CATEGORY_GROUPS_REORDERED',
      entityType: 'CATEGORY_GROUP',
      entityId: SETTINGS_ENTITY_ID,
      newValues: { group_ids: groupIds },
    });
    return (await listGroupsAdmin(trx)).groups;
  });
}

/**
 * Sets a group's exact membership and order. Listed categories move here (from
 * another group too) at their list position; members left out become
 * unassigned.
 */
export async function setGroupCategories(groupId: string, categoryIds: string[], actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const group = await trx
      .selectFrom('category_groups')
      .select('id')
      .where('id', '=', groupId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!group) throw new AppError('Category group not found.', 404, 'CATEGORY_GROUP_NOT_FOUND');

    if (categoryIds.length) {
      const found = await trx
        .selectFrom('categories')
        .select('id')
        .where('id', 'in', categoryIds)
        .where('deleted_at', 'is', null)
        .execute();
      if (found.length !== categoryIds.length) {
        const known = new Set(found.map((c) => c.id));
        throw new AppError('Some of these categories do not exist.', 400, 'CATEGORY_NOT_FOUND', {
          missing: categoryIds.filter((id) => !known.has(id)),
        });
      }
    }

    const before = await trx
      .selectFrom('categories')
      .select('id')
      .where('group_id', '=', groupId)
      .orderBy('group_sort_order', 'asc')
      .execute();

    let removed = trx
      .updateTable('categories')
      .set({ group_id: null, group_sort_order: 0, updated_at: new Date() })
      .where('group_id', '=', groupId);
    if (categoryIds.length) removed = removed.where('id', 'not in', categoryIds);
    await removed.execute();

    if (categoryIds.length) {
      await sql`
        UPDATE categories c
           SET group_id = ${groupId}::uuid, group_sort_order = (x.ord - 1)::int, updated_at = now()
          FROM unnest(${categoryIds}::uuid[]) WITH ORDINALITY AS x(id, ord)
         WHERE c.id = x.id
           AND (c.group_id IS DISTINCT FROM ${groupId}::uuid OR c.group_sort_order <> (x.ord - 1)::int)
      `.execute(trx);
    }

    await writeAudit(trx, actor, {
      action: 'CATEGORY_GROUP_CATEGORIES_SET',
      entityType: 'CATEGORY_GROUP',
      entityId: groupId,
      oldValues: { category_ids: before.map((c) => c.id) },
      newValues: { category_ids: categoryIds },
    });
    return await getGroupAdmin(trx, groupId);
  });
}

/**
 * For the category create/edit forms: checks the target group and, when no
 * position is given, appends the category at the end of it.
 */
export async function resolveGroupPlacement(
  executor: Executor,
  groupId: string | null,
  sortOrder: number | undefined,
  categoryId?: string
): Promise<{ group_id: string | null; group_sort_order: number }> {
  if (groupId === null) return { group_id: null, group_sort_order: 0 };
  const group = await executor
    .selectFrom('category_groups')
    .select('id')
    .where('id', '=', groupId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!group) throw new AppError('Specified category group does not exist.', 400, 'CATEGORY_GROUP_NOT_FOUND');
  if (sortOrder !== undefined) return { group_id: groupId, group_sort_order: sortOrder };
  let q = executor
    .selectFrom('categories')
    .select(sql<number>`COALESCE(MAX(group_sort_order) + 1, 0)::int`.as('n'))
    .where('group_id', '=', groupId)
    .where('deleted_at', 'is', null);
  if (categoryId) q = q.where('id', '<>', categoryId);
  const next = await q.executeTakeFirstOrThrow();
  return { group_id: groupId, group_sort_order: Number(next.n) };
}

// ----------------------------------------------------------------------------
// Controller
// ----------------------------------------------------------------------------
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const handle =
  (fn: (req: Request, res: Response) => Promise<void>): Handler =>
  async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

export const categoryGroupsController = {
  /** GET /catalog/home-groups (public). */
  home: handle(async (_req, res) => {
    res.status(200).json({ success: true, data: { groups: await listHomeGroups() } });
  }),
  /** GET /admin/category-groups */
  list: handle(async (_req, res) => {
    res.status(200).json({ success: true, data: await listGroupsAdmin() });
  }),
  /** POST /admin/category-groups */
  create: handle(async (req, res) => {
    const group = await createGroup(createGroupSchema.parse(req.body), actorOf(req));
    res.status(201).json({ success: true, data: { group } });
  }),
  /** PATCH /admin/category-groups/:id */
  update: handle(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const group = await updateGroup(id, updateGroupSchema.parse(req.body), actorOf(req));
    res.status(200).json({ success: true, data: { group } });
  }),
  /** DELETE /admin/category-groups/:id */
  remove: handle(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.status(200).json({ success: true, data: await deleteGroup(id, actorOf(req)) });
  }),
  /** PUT /admin/category-groups/order */
  reorder: handle(async (req, res) => {
    const { group_ids } = reorderGroupsSchema.parse(req.body);
    res.status(200).json({ success: true, data: { groups: await reorderGroups(group_ids, actorOf(req)) } });
  }),
  /** PUT /admin/category-groups/:id/categories */
  setCategories: handle(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { category_ids } = setGroupCategoriesSchema.parse(req.body);
    const group = await setGroupCategories(id, category_ids, actorOf(req));
    res.status(200).json({ success: true, data: { group } });
  }),
};
