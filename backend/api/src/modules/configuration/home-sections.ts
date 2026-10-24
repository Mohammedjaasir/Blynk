import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { orderingClock } from '../../utils/time.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Home sections (owner's brother, 2026-10-24: "if we need snacks, if we need juices to come, and
 * showcase timely offers also with a countdown timer ... if some product is no sale after a
 * specific time we need to show that"). Staff add their own product rails to the customer app's
 * Home - a category's products, or up to 12 hand-picked ones - each optionally scheduled
 * (starts_at / ends_at) with a live countdown to its end.
 *
 * Stored in system_configurations 'home_sections' (no migration):
 *   { sections: HomeSection[] }   at most 8, array order = order on Home
 * No row = no sections, so nothing changes until staff add one.
 *
 * Staff:   GET|PUT /admin/settings/home-sections (ADMIN, OPERATIONS; audited HOME_SECTIONS_UPDATED).
 *          PUT replaces the whole list; the server assigns an id to a section that has none.
 * Public:  GET /store `home_sections` carries only the LIVE sections, in order (readPublic).
 * Times:   ISO datetimes; stored and returned with the store's Colombo offset (+05:30).
 */
export const HOME_SECTIONS_KEY = 'home_sections';
export const HOME_SECTIONS_LIMITS = { sections: 8, title: { min: 2, max: 28 }, subtitle: 40, products: 12, maxItems: { min: 4, max: 12, default: 8 } } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (message: string) => z.string({ invalid_type_error: 'Must be an id' }).regex(UUID, message);

/** An ISO datetime with an offset, normalised to the store's own offset so staff screens never depend on the browser's zone. */
const instant = z
  .string({ invalid_type_error: 'Must be a date and time' })
  .datetime({ offset: true, message: 'Must be a date and time' })
  .transform((s) => DateTime.fromISO(s, { setZone: true }).setZone(STORE_TIMEZONE).toISO({ suppressMilliseconds: true })!);

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CATEGORY'), category_id: uuid('Unknown category') }).strict(),
  z
    .object({
      kind: z.literal('PRODUCTS'),
      product_ids: z
        .array(uuid('Unknown product'))
        .min(1, 'Pick at least one product')
        .max(HOME_SECTIONS_LIMITS.products, `At most ${HOME_SECTIONS_LIMITS.products} products`),
    })
    .strict(),
]);

const sectionSchema = z
  .object({
    id: uuid('Unknown section').optional(),
    title: z
      .string({ required_error: 'Give the section a title', invalid_type_error: 'Must be text' })
      .trim()
      .min(HOME_SECTIONS_LIMITS.title.min, `At least ${HOME_SECTIONS_LIMITS.title.min} characters`)
      .max(HOME_SECTIONS_LIMITS.title.max, `At most ${HOME_SECTIONS_LIMITS.title.max} characters`)
      .regex(/^[^\r\n]+$/, 'One line only'),
    subtitle: z
      .string({ invalid_type_error: 'Must be text' })
      .trim()
      .max(HOME_SECTIONS_LIMITS.subtitle, `At most ${HOME_SECTIONS_LIMITS.subtitle} characters`)
      .regex(/^[^\r\n]*$/, 'One line only')
      .nullish()
      .transform((v) => v || null),
    source: sourceSchema,
    is_active: z.boolean().default(true),
    starts_at: instant.nullish().transform((v) => v ?? null),
    ends_at: instant.nullish().transform((v) => v ?? null),
    show_countdown: z.boolean().default(false),
    max_items: z
      .number({ invalid_type_error: 'Must be a number' })
      .int('A whole number')
      .min(HOME_SECTIONS_LIMITS.maxItems.min, `At least ${HOME_SECTIONS_LIMITS.maxItems.min}`)
      .max(HOME_SECTIONS_LIMITS.maxItems.max, `At most ${HOME_SECTIONS_LIMITS.maxItems.max}`)
      .default(HOME_SECTIONS_LIMITS.maxItems.default),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.source.kind === 'PRODUCTS' && new Set(s.source.product_ids).size !== s.source.product_ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'product_ids'], message: 'A product is listed twice' });
    }
    if (s.show_countdown && !s.ends_at) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'A countdown needs an end time' });
    }
    if (s.starts_at && s.ends_at && Date.parse(s.ends_at) <= Date.parse(s.starts_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'The end must be after the start' });
    }
  });

export type HomeSectionSource = z.infer<typeof sourceSchema>;
export type HomeSection = Omit<z.output<typeof sectionSchema>, 'id'> & { id: string };

export const updateHomeSectionsSchema = z
  .object({ sections: z.array(sectionSchema).max(HOME_SECTIONS_LIMITS.sections, `At most ${HOME_SECTIONS_LIMITS.sections} sections`) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.sections.forEach((s, i) => {
      if (!s.id) return;
      if (seen.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'id'], message: 'This section is listed twice' });
      seen.add(s.id);
    });
  });
export type UpdateHomeSectionsInput = z.input<typeof updateHomeSectionsSchema>;

/** A stored row as sections; a malformed one is dropped, the rest are kept. */
export function sectionsFrom(value: unknown): HomeSection[] {
  const raw = value && typeof value === 'object' ? (value as { sections?: unknown }).sections : undefined;
  if (!Array.isArray(raw)) return [];
  const out: HomeSection[] = [];
  for (const item of raw) {
    const parsed = sectionSchema.safeParse(item);
    if (parsed.success && parsed.data.id && !out.some((s) => s.id === parsed.data.id)) out.push({ ...parsed.data, id: parsed.data.id });
  }
  return out.slice(0, HOME_SECTIONS_LIMITS.sections);
}

export type HomeSectionStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'OFF';

/** OFF = switched off; otherwise by the schedule: before starts_at SCHEDULED, from ends_at on ENDED, else LIVE. */
export function sectionStatus(s: Pick<HomeSection, 'is_active' | 'starts_at' | 'ends_at'>, at: Date = orderingClock.now()): HomeSectionStatus {
  if (!s.is_active) return 'OFF';
  const t = at.getTime();
  if (s.starts_at && t < Date.parse(s.starts_at)) return 'SCHEDULED';
  if (s.ends_at && t >= Date.parse(s.ends_at)) return 'ENDED';
  return 'LIVE';
}

export interface HomeSectionView extends HomeSection {
  status: HomeSectionStatus;
  /** The category's name ("Beverages › Juices" for a sub-category), or "3 products". */
  source_name: string;
  /** PRODUCTS source: the picked products in staff order, by name (a product that no longer exists is left out). */
  products: { id: string; name: string }[];
}

/** What the customer app gets for a LIVE section (GET /store `home_sections[]`). */
export interface PublicHomeSection {
  id: string;
  title: string;
  subtitle: string | null;
  ends_at: string | null;
  show_countdown: boolean;
  max_items: number;
  category: { id: string; slug: string } | null;
  product_ids: string[] | null;
}

export class HomeSectionsService {
  private async row() {
    return db.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', HOME_SECTIONS_KEY).executeTakeFirst();
  }

  private async view(sections: HomeSection[], at: Date): Promise<HomeSectionView[]> {
    const cIds = [...new Set(sections.flatMap((s) => (s.source.kind === 'CATEGORY' ? [s.source.category_id] : [])))];
    const pIds = [...new Set(sections.flatMap((s) => (s.source.kind === 'PRODUCTS' ? s.source.product_ids : [])))];
    const cats = cIds.length ? await db.selectFrom('categories').select(['id', 'name', 'parent_id']).where('id', 'in', cIds).execute() : [];
    const parentIds = [...new Set(cats.map((c) => c.parent_id).filter((x): x is string => !!x))];
    const parents = parentIds.length ? await db.selectFrom('categories').select(['id', 'name']).where('id', 'in', parentIds).execute() : [];
    const products = pIds.length ? await db.selectFrom('products').select(['id', 'name']).where('id', 'in', pIds).where('deleted_at', 'is', null).execute() : [];
    const pName = new Map(products.map((p) => [p.id, p.name]));
    const cName = new Map(
      cats.map((c) => {
        const parent = c.parent_id ? parents.find((p) => p.id === c.parent_id)?.name : undefined;
        return [c.id, parent ? `${parent} › ${c.name}` : c.name] as const;
      })
    );
    return sections.map((s) => {
      const picked = s.source.kind === 'PRODUCTS' ? s.source.product_ids.filter((id) => pName.has(id)).map((id) => ({ id, name: pName.get(id)! })) : [];
      const source_name =
        s.source.kind === 'CATEGORY' ? (cName.get(s.source.category_id) ?? 'A category that was removed') : `${picked.length} ${picked.length === 1 ? 'product' : 'products'}`;
      return { ...s, status: sectionStatus(s, at), source_name, products: picked };
    });
  }

  async get(): Promise<{ sections: HomeSectionView[]; updated_at: Date | null }> {
    const row = await this.row();
    return { sections: await this.view(sectionsFrom(row?.value), orderingClock.now()), updated_at: row?.updated_at ?? null };
  }

  /** Audited (HOME_SECTIONS_UPDATED); customers see it when /store refreshes (30 s). */
  async set(input: z.output<typeof updateHomeSectionsSchema>, actor: AuditActor) {
    const cIds = [...new Set(input.sections.flatMap((s) => (s.source.kind === 'CATEGORY' ? [s.source.category_id] : [])))];
    const pIds = [...new Set(input.sections.flatMap((s) => (s.source.kind === 'PRODUCTS' ? s.source.product_ids : [])))];
    const foundC = cIds.length ? await db.selectFrom('categories').select('id').where('id', 'in', cIds).where('deleted_at', 'is', null).execute() : [];
    const foundP = pIds.length ? await db.selectFrom('products').select('id').where('id', 'in', pIds).where('deleted_at', 'is', null).execute() : [];
    if (foundC.length !== cIds.length) throw new AppError('One of the categories no longer exists.', 400, 'CATEGORY_NOT_FOUND');
    if (foundP.length !== pIds.length) throw new AppError('One of the products no longer exists.', 400, 'PRODUCT_NOT_FOUND');
    const sections: HomeSection[] = input.sections.map((s) => ({ ...s, id: s.id ?? randomUUID() }));
    await db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('system_configurations').select('value').where('key', '=', HOME_SECTIONS_KEY).forUpdate().executeTakeFirst();
      const value = JSON.stringify({ sections });
      await trx
        .insertInto('system_configurations')
        .values({ key: HOME_SECTIONS_KEY, value, description: 'Product rails on the customer app Home: a category or picked products, optionally timed with a countdown' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'HOME_SECTIONS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: HOME_SECTIONS_KEY, sections: sectionsFrom(before?.value) },
        newValues: { key: HOME_SECTIONS_KEY, sections },
      });
      logger.info({ actorId: actor.actorId, sections: sections.length }, 'Home sections changed');
    });
    return this.get();
  }

  /**
   * GET /store: the LIVE sections (active and inside their schedule), in order. A category
   * section whose category is gone or switched off is left out; missing products are left to
   * the app, which skips what the catalogue does not have.
   */
  async readPublic(at: Date = orderingClock.now()): Promise<PublicHomeSection[]> {
    const row = await this.row();
    const live = sectionsFrom(row?.value).filter((s) => sectionStatus(s, at) === 'LIVE');
    if (live.length === 0) return [];
    const cIds = [...new Set(live.flatMap((s) => (s.source.kind === 'CATEGORY' ? [s.source.category_id] : [])))];
    const cats = cIds.length
      ? await db.selectFrom('categories').select(['id', 'slug']).where('id', 'in', cIds).where('is_active', '=', true).where('deleted_at', 'is', null).execute()
      : [];
    const slug = new Map(cats.map((c) => [c.id, c.slug]));
    const out: PublicHomeSection[] = [];
    for (const s of live) {
      const base = { id: s.id, title: s.title, subtitle: s.subtitle, ends_at: s.ends_at, show_countdown: s.show_countdown && !!s.ends_at, max_items: s.max_items };
      if (s.source.kind === 'CATEGORY') {
        const sl = slug.get(s.source.category_id);
        if (sl) out.push({ ...base, category: { id: s.source.category_id, slug: sl }, product_ids: null });
      } else {
        out.push({ ...base, category: null, product_ids: s.source.product_ids });
      }
    }
    return out;
  }
}

export const homeSectionsService = new HomeSectionsService();
