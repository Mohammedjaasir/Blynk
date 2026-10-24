import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { orderingClock } from '../../utils/time.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { bundleOffersReady } from '../orders/bundle-offers.ready.js';

/**
 * Bundle offers (owner, 2026-10-25: "buy 2 get 1 free", "spend X, get a gift"). Staff write the
 * rules here; the real order pricing applies them (orders/bundle-pricing.ts, called by priceCart),
 * so the cart quote, the coupon preview and the placed order always agree.
 *
 * Stored in system_configurations 'bundle_offers' (no table):
 *   { offers: BundleOffer[] }   at most 10; array order = the order the offers are applied in
 * No row = no offers, so nothing changes until staff add one.
 *
 *   BUY_X_GET_Y     for every buy_qty + get_qty matching units in the cart, the cheapest get_qty are
 *                   free. Matching = the products in product_ids, or any product of category_id (its
 *                   sub-categories too). Free units come out of what the customer ordered.
 *   SPEND_GET_GIFT  when the items subtotal (after offers, before delivery and coupons) reaches
 *                   min_subtotal, gift_qty of gift_product_id are added free - once per order.
 *
 * Staff:   GET|PUT /admin/settings/bundle-offers (ADMIN, OPERATIONS; audited BUNDLE_OFFERS_UPDATED).
 *          PUT replaces the whole list; the server assigns an id to an offer that has none.
 * Public:  GET /store `bundle_offers` carries only the LIVE offers, in order (readPublic).
 * Times:   ISO datetimes; stored and returned with the store's Colombo offset (+05:30).
 */
export const BUNDLE_OFFERS_KEY = 'bundle_offers';
export const BUNDLE_OFFERS_LIMITS = {
  offers: 10,
  title: { min: 2, max: 40 },
  qty: { min: 1, max: 10 },
  products: 20,
  minSubtotal: { min: 1, max: 1_000_000 },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (message: string) => z.string({ invalid_type_error: 'Must be an id' }).regex(UUID, message);

const instant = z
  .string({ invalid_type_error: 'Must be a date and time' })
  .datetime({ offset: true, message: 'Must be a date and time' })
  .transform((s) => DateTime.fromISO(s, { setZone: true }).setZone(STORE_TIMEZONE).toISO({ suppressMilliseconds: true })!);

const qty = (what: string) =>
  z
    .number({ required_error: `${what} is required`, invalid_type_error: 'Must be a number' })
    .int('A whole number')
    .min(BUNDLE_OFFERS_LIMITS.qty.min, `At least ${BUNDLE_OFFERS_LIMITS.qty.min}`)
    .max(BUNDLE_OFFERS_LIMITS.qty.max, `At most ${BUNDLE_OFFERS_LIMITS.qty.max}`);

const common = {
  id: uuid('Unknown offer').optional(),
  title: z
    .string({ required_error: 'Give the offer a title', invalid_type_error: 'Must be text' })
    .trim()
    .min(BUNDLE_OFFERS_LIMITS.title.min, `At least ${BUNDLE_OFFERS_LIMITS.title.min} characters`)
    .max(BUNDLE_OFFERS_LIMITS.title.max, `At most ${BUNDLE_OFFERS_LIMITS.title.max} characters`)
    .regex(/^[^\r\n]+$/, 'One line only'),
  is_active: z.boolean().default(true),
  starts_at: instant.nullish().transform((v) => v ?? null),
  ends_at: instant.nullish().transform((v) => v ?? null),
};

const buyGetSchema = z
  .object({
    ...common,
    type: z.literal('BUY_X_GET_Y'),
    buy_qty: qty('buy_qty'),
    get_qty: qty('get_qty'),
    product_ids: z
      .array(uuid('Unknown product'))
      .min(1, 'Pick at least one product')
      .max(BUNDLE_OFFERS_LIMITS.products, `At most ${BUNDLE_OFFERS_LIMITS.products} products`)
      .nullish()
      .transform((v) => v ?? null),
    category_id: uuid('Unknown category')
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict();

const spendGiftSchema = z
  .object({
    ...common,
    type: z.literal('SPEND_GET_GIFT'),
    min_subtotal: z
      .number({ required_error: 'min_subtotal is required', invalid_type_error: 'Must be a number' })
      .min(BUNDLE_OFFERS_LIMITS.minSubtotal.min, `At least ${BUNDLE_OFFERS_LIMITS.minSubtotal.min}`)
      .max(BUNDLE_OFFERS_LIMITS.minSubtotal.max, `At most ${BUNDLE_OFFERS_LIMITS.minSubtotal.max}`)
      .transform((v) => Number(v.toFixed(2))),
    gift_product_id: uuid('Unknown product'),
    gift_qty: qty('gift_qty').default(1),
  })
  .strict();

const offerSchema = z
  .discriminatedUnion('type', [buyGetSchema, spendGiftSchema], {
    errorMap: () => ({ message: "type must be 'BUY_X_GET_Y' or 'SPEND_GET_GIFT'" }),
  })
  .superRefine((o, ctx) => {
    if (o.starts_at && o.ends_at && Date.parse(o.ends_at) <= Date.parse(o.starts_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'The end must be after the start' });
    }
    if (o.type === 'BUY_X_GET_Y') {
      if ((o.product_ids === null) === (o.category_id === null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['product_ids'], message: 'Pick products or one category, not both and not neither' });
      }
      if (o.product_ids && new Set(o.product_ids).size !== o.product_ids.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['product_ids'], message: 'A product is listed twice' });
      }
    }
  });

/**
 * Staff screens PUT back what GET gave them: drop the view-only fields and the fields the other
 * type owns when they are null (so a round trip is accepted); a non-null foreign field is still refused.
 */
const VIEW_ONLY = ['status', 'product_names', 'category_name', 'gift_product_name'];
const BUY_GET_ONLY = ['buy_qty', 'get_qty', 'product_ids', 'category_id'];
const SPEND_GIFT_ONLY = ['min_subtotal', 'gift_product_id', 'gift_qty'];
function cleanOffer(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const k of VIEW_ONLY) delete o[k];
  const foreign = o.type === 'BUY_X_GET_Y' ? SPEND_GIFT_ONLY : o.type === 'SPEND_GET_GIFT' ? BUY_GET_ONLY : [];
  for (const k of foreign) if (o[k] === null) delete o[k];
  return o;
}

export type BundleOffer = (Omit<z.output<typeof buyGetSchema>, 'id'> | Omit<z.output<typeof spendGiftSchema>, 'id'>) & { id: string };
export type BuyGetOffer = Extract<BundleOffer, { type: 'BUY_X_GET_Y' }>;
export type SpendGiftOffer = Extract<BundleOffer, { type: 'SPEND_GET_GIFT' }>;

export const updateBundleOffersSchema = z
  .object({ offers: z.array(z.preprocess(cleanOffer, offerSchema)).max(BUNDLE_OFFERS_LIMITS.offers, `At most ${BUNDLE_OFFERS_LIMITS.offers} offers`) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.offers.forEach((o, i) => {
      if (!o.id) return;
      if (seen.has(o.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['offers', i, 'id'], message: 'This offer is listed twice' });
      seen.add(o.id);
    });
  });
export type UpdateBundleOffersInput = z.input<typeof updateBundleOffersSchema>;

/** A stored row as offers; a malformed one is dropped, the rest are kept. */
export function offersFrom(value: unknown): BundleOffer[] {
  const raw = value && typeof value === 'object' ? (value as { offers?: unknown }).offers : undefined;
  if (!Array.isArray(raw)) return [];
  const out: BundleOffer[] = [];
  for (const item of raw) {
    const parsed = offerSchema.safeParse(item);
    if (parsed.success && parsed.data.id && !out.some((o) => o.id === parsed.data.id)) out.push({ ...parsed.data, id: parsed.data.id } as BundleOffer);
  }
  return out.slice(0, BUNDLE_OFFERS_LIMITS.offers);
}

export type BundleOfferStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'OFF';

/** OFF = switched off; otherwise by the schedule: before starts_at SCHEDULED, from ends_at on ENDED, else LIVE. */
export function offerStatus(o: Pick<BundleOffer, 'is_active' | 'starts_at' | 'ends_at'>, at: Date = orderingClock.now()): BundleOfferStatus {
  if (!o.is_active) return 'OFF';
  const t = at.getTime();
  if (o.starts_at && t < Date.parse(o.starts_at)) return 'SCHEDULED';
  if (o.ends_at && t >= Date.parse(o.ends_at)) return 'ENDED';
  return 'LIVE';
}

/** Every field of an offer as the API returns it: fields the type does not use are null. */
export interface BundleOfferFields {
  id: string;
  type: 'BUY_X_GET_Y' | 'SPEND_GET_GIFT';
  title: string;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  product_ids: string[] | null;
  category_id: string | null;
  min_subtotal: number | null;
  gift_product_id: string | null;
  gift_qty: number | null;
}

export function offerFields(o: BundleOffer): BundleOfferFields {
  const base = { id: o.id, type: o.type, title: o.title, is_active: o.is_active, starts_at: o.starts_at, ends_at: o.ends_at };
  return o.type === 'BUY_X_GET_Y'
    ? { ...base, buy_qty: o.buy_qty, get_qty: o.get_qty, product_ids: o.product_ids, category_id: o.category_id, min_subtotal: null, gift_product_id: null, gift_qty: null }
    : { ...base, buy_qty: null, get_qty: null, product_ids: null, category_id: null, min_subtotal: o.min_subtotal, gift_product_id: o.gift_product_id, gift_qty: o.gift_qty };
}

export interface BundleOfferView extends BundleOfferFields {
  status: BundleOfferStatus;
  product_names: { id: string; name: string }[];
  category_name: string | null;
  gift_product_name: string | null;
}

/** What the customer app gets for a LIVE offer (GET /store `bundle_offers[]`). */
export interface PublicBundleOffer {
  id: string;
  type: BundleOffer['type'];
  title: string;
  ends_at: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  product_ids: string[] | null;
  category: { id: string; slug: string } | null;
  min_subtotal: number | null;
  gift_product_id: string | null;
  gift_product_name: string | null;
  gift_qty: number | null;
}

async function readOffersRow() {
  return db.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', BUNDLE_OFFERS_KEY).executeTakeFirst();
}

/** The offers pricing may apply right now: stored, LIVE, in rule order. Empty until migration 062 exists. */
export async function liveBundleOffers(at: Date = orderingClock.now()): Promise<BundleOffer[]> {
  if (!(await bundleOffersReady())) return [];
  const row = await readOffersRow();
  return offersFrom(row?.value).filter((o) => offerStatus(o, at) === 'LIVE');
}

export class BundleOffersService {
  private async view(offers: BundleOffer[], at: Date): Promise<BundleOfferView[]> {
    const pIds = [...new Set(offers.flatMap((o) => (o.type === 'BUY_X_GET_Y' ? (o.product_ids ?? []) : [o.gift_product_id])))];
    const cIds = [...new Set(offers.flatMap((o) => (o.type === 'BUY_X_GET_Y' && o.category_id ? [o.category_id] : [])))];
    const products = pIds.length ? await db.selectFrom('products').select(['id', 'name']).where('id', 'in', pIds).where('deleted_at', 'is', null).execute() : [];
    const cats = cIds.length ? await db.selectFrom('categories').select(['id', 'name', 'parent_id']).where('id', 'in', cIds).execute() : [];
    const parentIds = [...new Set(cats.map((c) => c.parent_id).filter((x): x is string => !!x))];
    const parents = parentIds.length ? await db.selectFrom('categories').select(['id', 'name']).where('id', 'in', parentIds).execute() : [];
    const pName = new Map(products.map((p) => [p.id, p.name]));
    const cName = new Map(
      cats.map((c) => {
        const parent = c.parent_id ? parents.find((p) => p.id === c.parent_id)?.name : undefined;
        return [c.id, parent ? `${parent} › ${c.name}` : c.name] as const;
      })
    );
    return offers.map((o) => ({
      ...offerFields(o),
      status: offerStatus(o, at),
      product_names: o.type === 'BUY_X_GET_Y' ? (o.product_ids ?? []).filter((id) => pName.has(id)).map((id) => ({ id, name: pName.get(id)! })) : [],
      category_name: o.type === 'BUY_X_GET_Y' && o.category_id ? (cName.get(o.category_id) ?? 'A category that was removed') : null,
      gift_product_name: o.type === 'SPEND_GET_GIFT' ? (pName.get(o.gift_product_id) ?? null) : null,
    }));
  }

  async get(): Promise<{ ready: boolean; offers: BundleOfferView[]; updated_at: Date | null }> {
    const row = await readOffersRow();
    return {
      ready: await bundleOffersReady(),
      offers: await this.view(offersFrom(row?.value), orderingClock.now()),
      updated_at: row?.updated_at ?? null,
    };
  }

  /** Audited (BUNDLE_OFFERS_UPDATED); customers see it when /store refreshes (30 s), the cart quote at once. */
  async set(input: z.output<typeof updateBundleOffersSchema>, actor: AuditActor) {
    const pIds = [...new Set(input.offers.flatMap((o) => (o.type === 'BUY_X_GET_Y' ? (o.product_ids ?? []) : [o.gift_product_id])))];
    const cIds = [...new Set(input.offers.flatMap((o) => (o.type === 'BUY_X_GET_Y' && o.category_id ? [o.category_id] : [])))];
    const foundP = pIds.length ? await db.selectFrom('products').select('id').where('id', 'in', pIds).where('deleted_at', 'is', null).execute() : [];
    const foundC = cIds.length ? await db.selectFrom('categories').select('id').where('id', 'in', cIds).where('deleted_at', 'is', null).execute() : [];
    if (foundP.length !== pIds.length) throw new AppError('One of the products no longer exists.', 400, 'PRODUCT_NOT_FOUND');
    if (foundC.length !== cIds.length) throw new AppError('One of the categories no longer exists.', 400, 'CATEGORY_NOT_FOUND');
    const offers = input.offers.map((o) => ({ ...o, id: o.id ?? randomUUID() })) as BundleOffer[];
    await db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('system_configurations').select('value').where('key', '=', BUNDLE_OFFERS_KEY).forUpdate().executeTakeFirst();
      const value = JSON.stringify({ offers });
      await trx
        .insertInto('system_configurations')
        .values({ key: BUNDLE_OFFERS_KEY, value, description: 'Bundle offers: buy X get Y free, spend X get a gift' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'BUNDLE_OFFERS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: BUNDLE_OFFERS_KEY, offers: offersFrom(before?.value) },
        newValues: { key: BUNDLE_OFFERS_KEY, offers },
      });
      logger.info({ actorId: actor.actorId, offers: offers.length }, 'Bundle offers changed');
    });
    return this.get();
  }

  /**
   * GET /store: the LIVE offers (active and inside their schedule), in order; [] until migration
   * 062 exists. A category offer whose category is gone or off, and a gift offer whose gift
   * product is gone or switched off, are left out.
   */
  async readPublic(at: Date = orderingClock.now()): Promise<PublicBundleOffer[]> {
    const live = await liveBundleOffers(at);
    if (live.length === 0) return [];
    const cIds = [...new Set(live.flatMap((o) => (o.type === 'BUY_X_GET_Y' && o.category_id ? [o.category_id] : [])))];
    const gIds = [...new Set(live.flatMap((o) => (o.type === 'SPEND_GET_GIFT' ? [o.gift_product_id] : [])))];
    const cats = cIds.length
      ? await db.selectFrom('categories').select(['id', 'slug']).where('id', 'in', cIds).where('is_active', '=', true).where('deleted_at', 'is', null).execute()
      : [];
    const gifts = gIds.length
      ? await db.selectFrom('products').select(['id', 'name']).where('id', 'in', gIds).where('is_active', '=', true).where('deleted_at', 'is', null).execute()
      : [];
    const slug = new Map(cats.map((c) => [c.id, c.slug]));
    const giftName = new Map(gifts.map((g) => [g.id, g.name]));
    const out: PublicBundleOffer[] = [];
    for (const o of live) {
      const base = { id: o.id, type: o.type, title: o.title, ends_at: o.ends_at };
      if (o.type === 'BUY_X_GET_Y') {
        const sl = o.category_id ? slug.get(o.category_id) : undefined;
        if (o.category_id && !sl) continue;
        out.push({
          ...base,
          buy_qty: o.buy_qty,
          get_qty: o.get_qty,
          product_ids: o.product_ids,
          category: o.category_id && sl ? { id: o.category_id, slug: sl } : null,
          min_subtotal: null,
          gift_product_id: null,
          gift_product_name: null,
          gift_qty: null,
        });
      } else {
        const name = giftName.get(o.gift_product_id);
        if (!name) continue;
        out.push({
          ...base,
          buy_qty: null,
          get_qty: null,
          product_ids: null,
          category: null,
          min_subtotal: o.min_subtotal,
          gift_product_id: o.gift_product_id,
          gift_product_name: name,
          gift_qty: o.gift_qty,
        });
      }
    }
    return out;
  }
}

export const bundleOffersService = new BundleOffersService();
