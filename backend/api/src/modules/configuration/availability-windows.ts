import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { orderingClock } from '../../utils/time.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Time-limited products (owner, 2026-10-23: "some product that I want to add time-based ... the
 * juice from the morning till 6, because the shop closes around 8 ... product-wise and category-
 * wise ... the timing will be different"). A product, or a whole category, can be orderable only
 * between two times of day (Colombo). Outside them it is shown greyed with its hours and cannot be
 * ordered (the cart and checkout refuse it too). A product's own window wins over its category's,
 * and a sub-category's over its parent's. A window may run past midnight (22:00 - 02:00).
 *
 * Stored in system_configurations 'availability_windows' (no migration):
 *   { windows: [{ kind: 'PRODUCT' | 'CATEGORY', id, from: 'HH:MM', until: 'HH:MM' }] }
 * No row = no limits, so nothing changes until staff add one.
 *
 * Staff:   GET|PUT /admin/settings/availability-windows (ADMIN, OPERATIONS; audited
 *          AVAILABILITY_WINDOWS_UPDATED). PUT replaces the whole list.
 * Public:  every customer product carries `available_window` ({from, until} or null) and is
 *          `is_available: false` with `window_closed: true` while its window is shut.
 * Orders:  priceCart refuses a line outside its window (400 PRODUCT_OUTSIDE_HOURS).
 */
export const AVAILABILITY_KEY = 'availability_windows';
export const AVAILABILITY_LIMITS = { windows: 300 } as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const windowSchema = z
  .object({
    kind: z.enum(['PRODUCT', 'CATEGORY']),
    id: z.string({ invalid_type_error: 'Must be an id' }).regex(UUID, 'Unknown product or category'),
    from: z.string({ invalid_type_error: 'Must be a time' }).regex(HHMM, 'Times look like 06:00'),
    until: z.string({ invalid_type_error: 'Must be a time' }).regex(HHMM, 'Times look like 18:00'),
  })
  .refine((w) => w.from !== w.until, { path: ['until'], message: 'The two times must differ' });
export type AvailabilityWindow = z.infer<typeof windowSchema>;

export const updateAvailabilitySchema = z
  .object({ windows: z.array(windowSchema).max(AVAILABILITY_LIMITS.windows, `At most ${AVAILABILITY_LIMITS.windows} windows`) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.windows.forEach((w, i) => {
      const k = `${w.kind}:${w.id}`;
      if (seen.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['windows', i, 'id'], message: 'This item is listed twice' });
      seen.add(k);
    });
  });
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

/** A stored row as windows; a malformed one is dropped, the rest are kept. */
export function windowsFrom(value: unknown): AvailabilityWindow[] {
  const raw = value && typeof value === 'object' ? (value as { windows?: unknown }).windows : undefined;
  if (!Array.isArray(raw)) return [];
  const out: AvailabilityWindow[] = [];
  for (const item of raw) {
    const parsed = windowSchema.safeParse(item);
    if (parsed.success && !out.some((w) => w.kind === parsed.data.kind && w.id === parsed.data.id)) out.push(parsed.data);
  }
  return out;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Is the window open at this time of day (Colombo)? from <= now < until, wrapping past midnight when from > until. */
export function windowOpenAt(w: Pick<AvailabilityWindow, 'from' | 'until'>, at: Date = orderingClock.now()): boolean {
  const t = DateTime.fromJSDate(at).setZone(STORE_TIMEZONE);
  const now = t.hour * 60 + t.minute;
  const from = minutes(w.from);
  const until = minutes(w.until);
  return from < until ? now >= from && now < until : now >= from || now < until;
}

/** "6 am", "6:30 pm": plain 12-hour text for messages. */
export function clockText(t: string): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}
export const windowText = (w: Pick<AvailabilityWindow, 'from' | 'until'>) => `${clockText(w.from)} - ${clockText(w.until)}`;

export interface AvailabilitySnapshot {
  at: number;
  products: Map<string, AvailabilityWindow>;
  categories: Map<string, AvailabilityWindow>;
  parentOf: Map<string, string | null>;
}
const TTL_MS = 5000;
let snapshot: AvailabilitySnapshot | null = null;
let loading: Promise<AvailabilitySnapshot> | null = null;

async function readSnapshot(): Promise<AvailabilitySnapshot> {
  const row = await db.selectFrom('system_configurations').select('value').where('key', '=', AVAILABILITY_KEY).executeTakeFirst();
  const windows = windowsFrom(row?.value);
  const products = new Map(windows.filter((w) => w.kind === 'PRODUCT').map((w) => [w.id, w]));
  const categories = new Map(windows.filter((w) => w.kind === 'CATEGORY').map((w) => [w.id, w]));
  const parentOf = new Map<string, string | null>();
  if (categories.size > 0) {
    for (const c of await db.selectFrom('categories').select(['id', 'parent_id']).execute()) parentOf.set(c.id, c.parent_id);
  }
  return { at: Date.now(), products, categories, parentOf };
}

/** Cached for a few seconds; dropped on every change. Call before using `windowFor`. */
export async function loadAvailability(): Promise<AvailabilitySnapshot> {
  if (snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot;
  loading ??= readSnapshot()
    .then((s) => (snapshot = s))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The window that applies to a product: its own, else its category's, else that category's parent's. */
export function windowFor(s: AvailabilitySnapshot, product: { id: string; category_id: string }): AvailabilityWindow | null {
  const own = s.products.get(product.id);
  if (own) return own;
  const cat = s.categories.get(product.category_id);
  if (cat) return cat;
  const parent = s.parentOf.get(product.category_id);
  return (parent && s.categories.get(parent)) || null;
}

/** priceCart's check: 400 PRODUCT_OUTSIDE_HOURS while the product's window is shut. */
export function assertWithinHours(s: AvailabilitySnapshot, product: { id: string; name: string; category_id: string }, at: Date = orderingClock.now()): void {
  const w = windowFor(s, product);
  if (w && !windowOpenAt(w, at)) {
    throw new AppError(`'${product.name}' can only be ordered between ${windowText(w)}.`, 400, 'PRODUCT_OUTSIDE_HOURS', {
      product_id: product.id,
      name: product.name,
      from: w.from,
      until: w.until,
    });
  }
}

export interface AvailabilityView extends AvailabilityWindow {
  name: string;
  /** For a category: its main category's name, when it is a sub-category. */
  parent_name: string | null;
  open_now: boolean;
}

export class AvailabilityService {
  private async row() {
    return db.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', AVAILABILITY_KEY).executeTakeFirst();
  }

  private async view(windows: AvailabilityWindow[]): Promise<AvailabilityView[]> {
    const pIds = windows.filter((w) => w.kind === 'PRODUCT').map((w) => w.id);
    const cIds = windows.filter((w) => w.kind === 'CATEGORY').map((w) => w.id);
    const products = pIds.length ? await db.selectFrom('products').select(['id', 'name']).where('id', 'in', pIds).execute() : [];
    const cats = cIds.length ? await db.selectFrom('categories').select(['id', 'name', 'parent_id']).where('id', 'in', cIds).execute() : [];
    const parentIds = [...new Set(cats.map((c) => c.parent_id).filter((x): x is string => !!x))];
    const parents = parentIds.length ? await db.selectFrom('categories').select(['id', 'name']).where('id', 'in', parentIds).execute() : [];
    const pName = new Map(products.map((p) => [p.id, p.name]));
    const cInfo = new Map(
      cats.map((c) => [c.id, { name: c.name, parent: c.parent_id ? (parents.find((p) => p.id === c.parent_id)?.name ?? null) : null }])
    );
    return windows
      .filter((w) => (w.kind === 'PRODUCT' ? pName.has(w.id) : cInfo.has(w.id)))
      .map((w) => ({
        ...w,
        name: w.kind === 'PRODUCT' ? pName.get(w.id)! : cInfo.get(w.id)!.name,
        parent_name: w.kind === 'CATEGORY' ? cInfo.get(w.id)!.parent : null,
        open_now: windowOpenAt(w),
      }));
  }

  async get(): Promise<{ windows: AvailabilityView[]; updated_at: Date | null }> {
    const row = await this.row();
    return { windows: await this.view(windowsFrom(row?.value)), updated_at: row?.updated_at ?? null };
  }

  /** Audited (AVAILABILITY_WINDOWS_UPDATED); customers see it within seconds. */
  async set(input: UpdateAvailabilityInput, actor: AuditActor) {
    const pIds = [...new Set(input.windows.filter((w) => w.kind === 'PRODUCT').map((w) => w.id))];
    const cIds = [...new Set(input.windows.filter((w) => w.kind === 'CATEGORY').map((w) => w.id))];
    const foundP = pIds.length ? await db.selectFrom('products').select('id').where('id', 'in', pIds).execute() : [];
    const foundC = cIds.length ? await db.selectFrom('categories').select('id').where('id', 'in', cIds).execute() : [];
    if (foundP.length !== pIds.length) throw new AppError('One of the products no longer exists.', 400, 'PRODUCT_NOT_FOUND');
    if (foundC.length !== cIds.length) throw new AppError('One of the categories no longer exists.', 400, 'CATEGORY_NOT_FOUND');
    await db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('system_configurations').select('value').where('key', '=', AVAILABILITY_KEY).forUpdate().executeTakeFirst();
      const value = JSON.stringify({ windows: input.windows });
      await trx
        .insertInto('system_configurations')
        .values({ key: AVAILABILITY_KEY, value, description: 'Products and categories orderable only between two times of day' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'AVAILABILITY_WINDOWS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: AVAILABILITY_KEY, windows: windowsFrom(before?.value) },
        newValues: { key: AVAILABILITY_KEY, windows: input.windows },
      });
      logger.info({ actorId: actor.actorId, windows: input.windows.length }, 'Availability windows changed');
    });
    snapshot = null;
    return this.get();
  }
}

export const availabilityService = new AvailabilityService();
