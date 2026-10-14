import type { Request, Response, NextFunction } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { generateUniqueSlug } from './catalog.slugs.js';
import { CATEGORY_ORDER_STEP } from './catalog.arrange.js';

/**
 * Category import (owner, 2026-10-14) - Admin site and Ops app.
 *
 * The owner's list has three levels, mapped onto the existing model with no
 * schema change:
 *
 *   Main         ("1. GROCERY")             -> a category GROUP (migration 025):
 *                                              the heading on the customer home
 *   Category     ("- Rice & Flour")         -> a TOP-LEVEL category: a tile
 *                                              under that heading
 *   Sub-category ("→ Rice | Flour | ...")   -> a CHILD category (migration 026):
 *                                              the sidebar inside that tile
 *
 * That is exactly how the customer apps already show the catalog (home
 * groups -> category tiles -> a category screen whose sidebar lists its
 * sub-categories), so no third category level is needed.
 *
 * Input: pasted text in the owner's format (see OWNER_CATEGORY_SETUP) or rows
 * from an Excel/CSV sheet ({main, category, sub_category, active}) that the
 * browser parsed. dry_run returns the preview tree without writing.
 *
 * Rules:
 *  - Matching is by name, ignoring case and extra spaces: a Main against live
 *    groups, a Category against live TOP-LEVEL categories, a Sub-category
 *    against the live children of its Category. Matched items keep their
 *    name, slug, image, offer, markup and on/off state.
 *  - Nothing is ever deleted or switched off, and products are never touched.
 *  - Order follows the list: the listed Mains become the first home sections
 *    in list order, listed Categories the first tiles (display_order 10, 20,
 *    ...), listed Sub-categories the first in their sidebar. Anything not in
 *    the list keeps its relative order after them (the Arrange rule).
 *  - A matched Category in a different Main moves to the listed one.
 *  - "(add later)" (also "(hidden)" / "(inactive)") after a name creates it
 *    switched off; an existing one is left as it is. Sub-categories created
 *    under a new "(add later)" Category are created off too.
 *  - Names written in CAPITALS become Title Case ("GROCERY" -> "Grocery");
 *    any other name is kept exactly as written. Slugs are generated.
 *  - Applied in one transaction, audited once (CATEGORIES_IMPORTED).
 */

export const OWNER_CATEGORY_SETUP = `BLYNK – CATEGORY SETUP (Ops → Catalog)
1. GROCERY
- Rice & Flour → Rice | Flour | Dhal & Grams
- Oil, Sugar & Salt → Oil | Sugar & Salt | Coconut & Coconut Milk | Sauces
- Spices → Chilli & Curry Powder | Whole Spices | Curry Mixes | Goraka & Tamarind
- Vegetables → Onions & Garlic | Potatoes & Others
- Dry Fish & Tin Fish
- Noodles & Soup
2. BREAKFAST & DRINKS
- Milk Powder & Eggs
- Jam, Butter & Cereal
- Tea & Coffee
- Drinks → Milo & Nestomalt | Soft Drinks | Water & Juice
3. SNACKS
- Biscuits
- Chips & Bites
- Chocolates & Sweets → Chocolates | Jelly & Custard
- Dates & Nuts
4. BABY ITEMS
- Diapers & Wipes → Diapers | Wipes
- Baby Soap & Powder
- Baby Food & Bottles
5. LADIES ITEMS
- Sanitary Pads
- Hair Oil & Shampoo
- Creams & Beauty
- Clips, Bands & Pins
6. PERSONAL CARE
- Soap & Toothpaste
- Shaving Items
- First Aid
- Adult Diapers
7. HOUSEHOLD
- Washing Powder & Dishwash
- Cleaning Items
- Tissue, Foil & Lunch Sheets
- Batteries, Bulbs & Candles
- Mosquito Coils & Sprays
- Books & Pens (add later)`;

export const MAX_IMPORT_TEXT = 20000;
export const MAX_IMPORT_CATEGORY_ROWS = 1000;

export const categoryImportSchema = z
  .object({
    text: z.string().max(MAX_IMPORT_TEXT, `Paste at most ${MAX_IMPORT_TEXT} characters`).optional(),
    rows: z
      .array(z.record(z.unknown()))
      .max(MAX_IMPORT_CATEGORY_ROWS, `Import at most ${MAX_IMPORT_CATEGORY_ROWS} rows at a time`)
      .optional(),
    dry_run: z.boolean().optional(),
  })
  .refine((v) => (v.text !== undefined) !== (v.rows !== undefined), {
    message: 'Send either text or rows',
  });
export type CategoryImportInput = z.infer<typeof categoryImportSchema>;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
interface ParsedItem {
  name: string;
  active: boolean;
  /** Text line or sheet row it came from (1-based). */
  source: number;
}
interface ParsedCategory extends ParsedItem {
  subs: ParsedItem[];
}
interface ParsedMain extends ParsedItem {
  categories: ParsedCategory[];
}
export interface ImportIssue {
  line: number | null;
  message: string;
}
interface Parsed {
  mains: ParsedMain[];
  errors: ImportIssue[];
  ignored: ImportIssue[];
}

const HIDDEN_MARK = /\s*\((?:add\s+later|hidden|inactive)\)\s*$/i;

/** "GROCERY" -> "Grocery", "BREAKFAST & DRINKS" -> "Breakfast & Drinks"; mixed case is kept. */
export function displayName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!/[A-Z]/.test(name) || /[a-z]/.test(name)) return name;
  return name.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function cleanName(raw: string): { name: string; active: boolean } {
  const hidden = HIDDEN_MARK.test(raw);
  return { name: displayName(raw.replace(HIDDEN_MARK, '')), active: !hidden };
}

const key = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

function checkName(level: 'main' | 'category' | 'sub', name: string, line: number, errors: ImportIssue[]) {
  const label = level === 'main' ? 'Main category' : level === 'category' ? 'Category' : 'Sub-category';
  const max = level === 'main' ? 80 : 128;
  const min = level === 'main' ? 1 : 2;
  if (name.length < min) errors.push({ line, message: `${label} name '${name}' is too short` });
  else if (name.length > max) errors.push({ line, message: `${label} name is longer than ${max} characters` });
}

/** Adds (or merges into) the tree. */
class TreeBuilder {
  mains: ParsedMain[] = [];
  errors: ImportIssue[] = [];
  private categoryHome = new Map<string, string>();

  main(raw: string, line: number): ParsedMain | null {
    const { name, active } = cleanName(raw);
    checkName('main', name, line, this.errors);
    const found = this.mains.find((m) => key(m.name) === key(name));
    if (found) return found;
    const main: ParsedMain = { name, active, source: line, categories: [] };
    this.mains.push(main);
    return main;
  }

  category(main: ParsedMain, raw: string, line: number): ParsedCategory | null {
    const { name, active } = cleanName(raw);
    checkName('category', name, line, this.errors);
    const home = this.categoryHome.get(key(name));
    if (home !== undefined && home !== key(main.name)) {
      this.errors.push({ line, message: `'${name}' is listed under two main categories; a category sits in one only` });
      return null;
    }
    this.categoryHome.set(key(name), key(main.name));
    const found = main.categories.find((c) => key(c.name) === key(name));
    if (found) return found;
    const category: ParsedCategory = { name, active, source: line, subs: [] };
    main.categories.push(category);
    return category;
  }

  sub(category: ParsedCategory, raw: string, line: number) {
    const { name, active } = cleanName(raw);
    checkName('sub', name, line, this.errors);
    if (key(name) === key(category.name)) {
      this.errors.push({ line, message: `'${name}' cannot be a sub-category of itself` });
      return;
    }
    if (category.subs.some((s) => key(s.name) === key(name))) return;
    category.subs.push({ name, active: active && category.active, source: line });
  }
}

const MAIN_LINE = /^\d{1,3}\s*[.)]\s*(.+)$/;
const CATEGORY_LINE = /^[-*•–—]\s+(.+)$/;
const SUB_ARROW = /\s*(?:→|->|=>|›|»)\s*/;

/** The owner's text format: "1. MAIN", "- Category → Sub | Sub", anything else is ignored. */
export function parseCategoryText(text: string): Parsed {
  const b = new TreeBuilder();
  const ignored: ImportIssue[] = [];
  let main: ParsedMain | null = null;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = i + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    const m = MAIN_LINE.exec(trimmed);
    if (m) {
      main = b.main(m[1], line);
      return;
    }
    const c = CATEGORY_LINE.exec(trimmed);
    if (c) {
      if (!main) {
        b.errors.push({ line, message: 'A category comes before any main category (e.g. "1. GROCERY")' });
        return;
      }
      const [left, ...rest] = c[1].split(SUB_ARROW);
      const category = b.category(main, left, line);
      if (!category) return;
      const subsText = rest.join(' ');
      for (const sub of subsText.split('|')) if (sub.trim()) b.sub(category, sub, line);
      return;
    }
    ignored.push({ line, message: trimmed });
  });
  if (!b.mains.length && !b.errors.length) b.errors.push({ line: null, message: 'No main categories found (lines like "1. GROCERY")' });
  return { mains: b.mains, errors: b.errors, ignored };
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function rowKey(k: string) {
  return k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
const MAIN_KEYS = ['main', 'main_category', 'group', 'section', 'home_section'];
const CATEGORY_KEYS = ['category', 'category_name'];
const SUB_KEYS = ['sub_category', 'subcategory', 'sub', 'sidebar', 'sidebar_category', 'sub_category_name'];
const ACTIVE_KEYS = ['active', 'is_active', 'show', 'visible'];

/** Sheet rows: main, category, sub_category (optional), active (optional yes/no). */
export function parseCategoryRows(rows: Array<Record<string, unknown>>): Parsed {
  const b = new TreeBuilder();
  rows.forEach((raw, i) => {
    const normalized = new Map<string, unknown>();
    for (const [k, v] of Object.entries(raw)) normalized.set(rowKey(k), v);
    const pick = (keys: string[]) => {
      for (const k of keys) {
        const v = cell(normalized.get(k));
        if (v) return v;
      }
      return '';
    };
    const rowNoRaw = Number(normalized.get('row'));
    const line = Number.isInteger(rowNoRaw) && rowNoRaw > 0 ? rowNoRaw : i + 2;
    const mainText = pick(MAIN_KEYS);
    const categoryText = pick(CATEGORY_KEYS);
    const subText = pick(SUB_KEYS);
    const activeText = pick(ACTIVE_KEYS).toLowerCase();
    if (!mainText && !categoryText && !subText) return; // a blank row
    if (!mainText) {
      b.errors.push({ line, message: 'Main category is empty' });
      return;
    }
    if (!categoryText) {
      b.errors.push({ line, message: 'Category is empty' });
      return;
    }
    let hide = false;
    if (activeText) {
      if (['no', 'n', 'false', '0', 'off', 'hidden', 'add later', 'inactive'].includes(activeText)) hide = true;
      else if (!['yes', 'y', 'true', '1', 'on', 'active'].includes(activeText)) {
        b.errors.push({ line, message: `Active must be yes or no (got '${activeText}')` });
        return;
      }
    }
    const main = b.main(mainText, line);
    if (!main) return;
    const category = b.category(main, subText || !hide ? categoryText : `${categoryText} (add later)`, line);
    if (!category) return;
    if (subText) b.sub(category, hide ? `${subText} (add later)` : subText, line);
  });
  if (!b.mains.length && !b.errors.length) b.errors.push({ line: null, message: 'The sheet has no category rows' });
  return { mains: b.mains, errors: b.errors, ignored: [] };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
export type ImportAction = 'create' | 'update' | 'keep';

export interface ImportNodeBase {
  name: string;
  id: string | null;
  action: ImportAction;
  /** Human-readable changes for 'update' (and notes for 'create'). */
  changes: string[];
  /** Whether customers will see it (an existing item keeps its own state). */
  active: boolean;
  warnings: string[];
  source: number;
}
export interface ImportSubNode extends ImportNodeBase {
  display_order: number;
}
export interface ImportCategoryNode extends ImportNodeBase {
  display_order: number;
  sub_categories: ImportSubNode[];
}
export interface ImportMainNode extends ImportNodeBase {
  sort_order: number;
  categories: ImportCategoryNode[];
}

type Executor = Kysely<Database> | Transaction<Database>;

interface LiveGroup {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}
interface LiveCategory {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  group_id: string | null;
  group_sort_order: number;
  display_order: number;
  is_active: boolean;
}

interface Plan {
  tree: ImportMainNode[];
  /** Live items not in the list whose position shifts to after the listed ones. */
  others: {
    groups: Array<{ id: string; sort_order: number }>;
    categories: Array<{ id: string; display_order: number }>;
  };
  warnings: string[];
}

const byOrder = <T extends { name: string }>(order: (x: T) => number) => (a: T, b: T) =>
  order(a) - order(b) || a.name.localeCompare(b.name);

async function loadLive(executor: Executor) {
  const [groups, categories] = await Promise.all([
    executor
      .selectFrom('category_groups')
      .select(['id', 'name', 'sort_order', 'is_active'])
      .where('deleted_at', 'is', null)
      .execute(),
    executor
      .selectFrom('categories')
      .select(['id', 'name', 'slug', 'parent_id', 'group_id', 'group_sort_order', 'display_order', 'is_active'])
      .where('deleted_at', 'is', null)
      .execute(),
  ]);
  return { groups: groups as LiveGroup[], categories: categories as LiveCategory[] };
}

function plan(parsed: Parsed, live: { groups: LiveGroup[]; categories: LiveCategory[] }): Plan {
  const warnings: string[] = [];
  const groupByKey = new Map(live.groups.map((g) => [key(g.name), g]));
  const groupById = new Map(live.groups.map((g) => [g.id, g]));
  const topLevel = live.categories.filter((c) => !c.parent_id);
  const topByKey = new Map(topLevel.map((c) => [key(c.name), c]));
  const categoryById = new Map(live.categories.map((c) => [c.id, c]));
  const childrenOf = (parentId: string) => live.categories.filter((c) => c.parent_id === parentId);

  const tree: ImportMainNode[] = [];
  const listedGroupIds = new Set<string>();
  const listedTopIds = new Set<string>();
  let topIndex = 0;
  const otherCategories: Array<{ id: string; display_order: number }> = [];

  parsed.mains.forEach((m, mi) => {
    const existing = groupByKey.get(key(m.name));
    const node: ImportMainNode = {
      name: existing?.name ?? m.name,
      id: existing?.id ?? null,
      action: existing ? 'keep' : 'create',
      changes: [],
      active: existing ? existing.is_active : true,
      warnings: [],
      source: m.source,
      sort_order: mi,
      categories: [],
    };
    if (existing) {
      listedGroupIds.add(existing.id);
      if (existing.sort_order !== mi) node.changes.push(`Home position ${existing.sort_order + 1} → ${mi + 1}`);
      if (!existing.is_active) node.warnings.push('This main category is switched off on the customer home; switch it on in Category groups.');
    }

    m.categories.forEach((c) => {
      topIndex += 1;
      const order = topIndex * CATEGORY_ORDER_STEP;
      const found = topByKey.get(key(c.name));
      const cNode: ImportCategoryNode = {
        name: found?.name ?? c.name,
        id: found?.id ?? null,
        action: found ? 'keep' : 'create',
        changes: [],
        active: found ? found.is_active : c.active,
        warnings: [],
        source: c.source,
        display_order: order,
        sub_categories: [],
      };
      if (!found) {
        const asChild = live.categories.find((x) => x.parent_id && key(x.name) === key(c.name));
        if (asChild) {
          const parent = categoryById.get(asChild.parent_id!);
          cNode.warnings.push(
            `A sub-category '${asChild.name}' already exists inside '${parent?.name ?? 'another category'}'. A new category is created here; products there are not moved.`
          );
        }
        if (!c.active) cNode.changes.push('Created switched off (add later)');
      } else {
        listedTopIds.add(found.id);
        const currentGroup = found.group_id ? groupById.get(found.group_id) : undefined;
        const sameGroup = existing ? currentGroup?.id === existing.id : false;
        if (!sameGroup) cNode.changes.push(`Moves to '${node.name}' (was ${currentGroup ? `'${currentGroup.name}'` : 'no main category'})`);
        if (found.display_order !== order) cNode.changes.push(`Position ${found.display_order} → ${order}`);
        if (!found.is_active) cNode.warnings.push('This category is switched off; it stays off.');
      }

      const kids = found ? childrenOf(found.id) : [];
      const kidByKey = new Map(kids.map((k) => [key(k.name), k]));
      const listedKidIds = new Set<string>();
      c.subs.forEach((s, si) => {
        const subOrder = (si + 1) * CATEGORY_ORDER_STEP;
        const kid = kidByKey.get(key(s.name));
        const sNode: ImportSubNode = {
          name: kid?.name ?? s.name,
          id: kid?.id ?? null,
          action: kid ? 'keep' : 'create',
          changes: [],
          active: kid ? kid.is_active : s.active,
          warnings: [],
          source: s.source,
          display_order: subOrder,
        };
        if (kid) {
          listedKidIds.add(kid.id);
          if (kid.display_order !== subOrder) sNode.changes.push(`Position ${kid.display_order} → ${subOrder}`);
          if (!kid.is_active) sNode.warnings.push('This sub-category is switched off; it stays off.');
        } else {
          const elsewhere = live.categories.find((x) => key(x.name) === key(s.name));
          if (elsewhere) {
            const where = elsewhere.parent_id ? `inside '${categoryById.get(elsewhere.parent_id)?.name ?? 'another category'}'` : 'as a main-level category';
            sNode.warnings.push(`'${elsewhere.name}' already exists ${where}. A new sub-category is created here; products there are not moved.`);
          }
          if (!s.active) sNode.changes.push('Created switched off (add later)');
        }
        if (sNode.changes.length && sNode.action === 'keep') sNode.action = 'update';
        cNode.sub_categories.push(sNode);
      });
      // Existing sub-categories the list leaves out keep their order after the listed ones.
      kids
        .filter((k) => !listedKidIds.has(k.id))
        .sort(byOrder((x) => x.display_order))
        .forEach((k, i) => {
          const o = (c.subs.length + i + 1) * CATEGORY_ORDER_STEP;
          if (k.display_order !== o) otherCategories.push({ id: k.id, display_order: o });
        });
      if (found && (kids.length > 0 || c.subs.length > 0)) {
        const unlisted = kids.filter((k) => !listedKidIds.has(k.id));
        if (unlisted.length) cNode.warnings.push(`Also keeps ${unlisted.length} sub-categor${unlisted.length === 1 ? 'y' : 'ies'} not in the list: ${unlisted.map((u) => u.name).join(', ')}`);
      }

      if (cNode.changes.length && cNode.action === 'keep') cNode.action = 'update';
      node.categories.push(cNode);
    });

    if (node.changes.length && node.action === 'keep') node.action = 'update';
    tree.push(node);
  });

  // Groups and top-level categories the list leaves out follow the listed ones.
  const otherGroups = live.groups
    .filter((g) => !listedGroupIds.has(g.id))
    .sort(byOrder((g) => g.sort_order))
    .map((g, i) => ({ id: g.id, sort_order: parsed.mains.length + i, current: g.sort_order }))
    .filter((g) => g.sort_order !== g.current)
    .map(({ id, sort_order }) => ({ id, sort_order }));
  topLevel
    .filter((c) => !listedTopIds.has(c.id))
    .sort(byOrder((c) => c.display_order))
    .forEach((c, i) => {
      const o = (topIndex + i + 1) * CATEGORY_ORDER_STEP;
      if (c.display_order !== o) otherCategories.push({ id: c.id, display_order: o });
    });

  const unlistedTop = topLevel.filter((c) => !listedTopIds.has(c.id)).length;
  if (unlistedTop) {
    warnings.push(`${unlistedTop} existing categor${unlistedTop === 1 ? 'y is' : 'ies are'} not in this list. They are kept as they are and shown after the listed ones.`);
  }
  return { tree, others: { groups: otherGroups, categories: otherCategories }, warnings };
}

function summarize(p: Plan) {
  const counts = () => ({ create: 0, update: 0, keep: 0 });
  const s = { mains: counts(), categories: counts(), sub_categories: counts(), others_reordered: p.others.groups.length + p.others.categories.length };
  for (const m of p.tree) {
    s.mains[m.action] += 1;
    for (const c of m.categories) {
      s.categories[c.action] += 1;
      for (const sub of c.sub_categories) s.sub_categories[sub.action] += 1;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
async function applyPlan(trx: Transaction<Database>, p: Plan) {
  const slugsUsed = new Set<string>();
  const slugFor = (name: string) =>
    generateUniqueSlug(name, 'category', async (s) => {
      if (slugsUsed.has(s)) return true;
      const taken = await trx.selectFrom('categories').select('id').where('slug', '=', s).where('deleted_at', 'is', null).executeTakeFirst();
      return !!taken;
    }, 128).then((slug) => {
      slugsUsed.add(slug);
      return slug;
    });

  // 1. Groups: create, then the listed ones first in list order.
  for (const m of p.tree) {
    if (!m.id) {
      const created = await trx
        .insertInto('category_groups')
        .values({ name: m.name, is_active: true, sort_order: m.sort_order })
        .returning('id')
        .executeTakeFirstOrThrow();
      m.id = created.id;
    }
  }
  const groupOrder = [...p.tree.map((m) => ({ id: m.id!, sort_order: m.sort_order })), ...p.others.groups];
  if (groupOrder.length) {
    await sql`
      UPDATE category_groups g SET sort_order = x.ord::int, updated_at = now()
        FROM unnest(${groupOrder.map((g) => g.id)}::uuid[], ${groupOrder.map((g) => g.sort_order)}::int[]) AS x(id, ord)
       WHERE g.id = x.id AND g.sort_order IS DISTINCT FROM x.ord::int
    `.execute(trx);
  }

  // 2. Categories and sub-categories.
  const positions: Array<{ id: string; display_order: number; group_id: string | null; group_sort_order: number | null }> = [];
  for (const m of p.tree) {
    for (const [ci, c] of m.categories.entries()) {
      if (!c.id) {
        const created = await trx
          .insertInto('categories')
          .values({
            name: c.name,
            slug: await slugFor(c.name),
            is_active: c.active,
            display_order: c.display_order,
            group_id: m.id,
            group_sort_order: ci,
            parent_id: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        c.id = created.id;
      } else {
        positions.push({ id: c.id, display_order: c.display_order, group_id: m.id, group_sort_order: ci });
      }
      for (const s of c.sub_categories) {
        if (!s.id) {
          const created = await trx
            .insertInto('categories')
            .values({
              name: s.name,
              slug: await slugFor(s.name),
              is_active: s.active,
              display_order: s.display_order,
              parent_id: c.id,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          s.id = created.id;
        } else {
          positions.push({ id: s.id, display_order: s.display_order, group_id: null, group_sort_order: null });
        }
      }
    }
  }
  for (const o of p.others.categories) positions.push({ id: o.id, display_order: o.display_order, group_id: null, group_sort_order: null });

  // Listed top-level categories get their group; everything listed or
  // shifted gets its position. One statement each.
  const grouped = positions.filter((x) => x.group_id);
  if (grouped.length) {
    await sql`
      UPDATE categories c SET group_id = x.gid, group_sort_order = x.gord::int, updated_at = now()
        FROM unnest(${grouped.map((x) => x.id)}::uuid[], ${grouped.map((x) => x.group_id)}::uuid[], ${grouped.map((x) => x.group_sort_order)}::int[]) AS x(id, gid, gord)
       WHERE c.id = x.id AND (c.group_id IS DISTINCT FROM x.gid OR c.group_sort_order IS DISTINCT FROM x.gord::int)
    `.execute(trx);
  }
  if (positions.length) {
    await sql`
      UPDATE categories c SET display_order = x.ord::int, updated_at = now()
        FROM unnest(${positions.map((x) => x.id)}::uuid[], ${positions.map((x) => x.display_order)}::int[]) AS x(id, ord)
       WHERE c.id = x.id AND c.display_order IS DISTINCT FROM x.ord::int
    `.execute(trx);
  }
}

export async function importCategories(input: CategoryImportInput, actor: AuditActor) {
  const dryRun = input.dry_run === true;
  const parsed = input.text !== undefined ? parseCategoryText(input.text) : parseCategoryRows(input.rows ?? []);

  const run = async (executor: Executor) => plan(parsed, await loadLive(executor));

  if (dryRun || parsed.errors.length) {
    const p = await run(db);
    const response = {
      dry_run: true,
      summary: summarize(p),
      tree: p.tree,
      warnings: p.warnings,
      errors: parsed.errors,
      ignored_lines: parsed.ignored,
    };
    if (!dryRun) {
      throw new AppError('Fix the errors in the list first.', 400, 'CATEGORY_IMPORT_INVALID', { errors: parsed.errors });
    }
    return response;
  }

  const result = await db.transaction().execute(async (trx) => {
    // One import at a time, so two staff applying at once can't create twins.
    await sql`SELECT pg_advisory_xact_lock(hashtext('blynk-category-import'))`.execute(trx);
    const p = await run(trx);
    const summary = summarize(p);
    await applyPlan(trx, p);
    const created = p.tree.flatMap((m) => [
      ...(m.action === 'create' ? [m.name] : []),
      ...m.categories.flatMap((c) => [...(c.action === 'create' ? [c.name] : []), ...c.sub_categories.filter((s) => s.action === 'create').map((s) => s.name)]),
    ]);
    await writeAudit(trx, actor, {
      action: 'CATEGORIES_IMPORTED',
      entityType: 'CATEGORY',
      entityId: SETTINGS_ENTITY_ID,
      newValues: { summary, created: created.slice(0, 200) },
    });
    return { p, summary };
  });
  logger.info({ ...result.summary, actorId: actor.actorId }, 'Categories imported');
  return {
    dry_run: false,
    summary: result.summary,
    tree: result.p.tree,
    warnings: result.p.warnings,
    errors: [] as ImportIssue[],
    ignored_lines: parsed.ignored,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const categoryImportController = {
  /** GET /admin/categories/import/template - the owner's list and the sheet columns. */
  async template(_req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({
        success: true,
        data: { text: OWNER_CATEGORY_SETUP, columns: ['main', 'category', 'sub_category', 'active'] },
      });
    } catch (err) {
      next(err);
    }
  },
  /** POST /admin/categories/import {text | rows, dry_run} */
  async run(req: Request, res: Response, next: NextFunction) {
    try {
      const input = categoryImportSchema.parse(req.body ?? {});
      const result = await importCategories(input, actorOf(req));
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
};
