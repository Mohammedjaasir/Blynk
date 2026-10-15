import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { orderingClock } from '../../utils/time.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import {
  describeTargets,
  normalizePromotionTarget,
  type PromotionTarget,
} from '../promotions/promotion.targets.js';
import { promotionDestinationTypes } from '../promotions/promotion.schema.js';

/**
 * The purple hero banner at the top of the customer app's Home (the saucer
 * lifting illustrated groceries, two big jumping words, a rolling sub-line and
 * the ORDER NOW button). Until now its words were automatic: "FREE / DELIVERY"
 * while new-customer free deliveries are on, else "FRESH / GROCERIES", and the
 * sub-line rolls between the terms and "Groceries starting at <cheapest price>".
 * This lets Admin and Operations write their own (the same way as the yellow
 * promo band, promo-band.ts).
 *
 * Stored in system_configurations 'hero_banner' (no migration). No row - or a
 * malformed one - means the defaults below: mode AUTO, i.e. exactly the banner
 * the app drew before this existed.
 *
 *   mode AUTO    the app's automatic words (the CUSTOM fields are kept for later)
 *   mode CUSTOM  title_1 / title_2, 1-4 rolling sub-lines with the tokens
 *                {min_price} (the cheapest product, e.g. "LKR 253") and
 *                {free_count} (new-customer free deliveries) and {points_rule}
 *                (the Blynk Points earn rule, e.g. "1 point for every LKR 100";
 *                owner, 2026-10-14); a line whose token has no value is
 *                skipped by the app. Also the button's words and
 *                where it goes, and which illustrated items the beam lifts.
 *                Outside starts_at / ends_at the app falls back to AUTO.
 *
 * Colours are not editable: the purple / pink / yellow are the owner's choice.
 *
 * Staff:  GET|PATCH /admin/settings/hero-banner (ADMIN, OPERATIONS; audited
 *         HERO_BANNER_UPDATED). PATCH takes any subset of fields; the merged
 *         result is validated as a whole.
 * Public: GET /store `hero_banner` - the custom banner to draw now, or null
 *         (AUTO, or outside its schedule) = the automatic banner.
 *
 * Spec shared with the app and the staff previews: docs/promo-surfaces.md §3.
 */
export const HERO_BANNER_KEY = 'hero_banner';

/** Illustrated items the saucer's beam can lift (the app draws its own artwork for each key). */
export const HERO_BANNER_ITEMS = ['milk', 'bread', 'apple', 'carrot', 'egg', 'broccoli', 'banana'] as const;
export type HeroBannerItem = (typeof HERO_BANNER_ITEMS)[number];
export const HERO_BANNER_MODES = ['AUTO', 'CUSTOM'] as const;
/** The tokens a sub-line may use. */
export const HERO_BANNER_TOKENS = ['min_price', 'free_count', 'points_rule'] as const;

/**
 * Title words are sized to the 196 pt text column (Bowlby One ~0.82 em per
 * capital, at most 36 pt), so 12 characters still fit at 19 pt - also on a
 * 360 pt phone, where the column keeps its width. Sub-lines shrink to fit in
 * CUSTOM mode (docs/promo-surfaces.md §3).
 */
export const HERO_BANNER_LIMITS = { titleChars: 12, lines: 4, lineChars: 40, ctaChars: 16 } as const;

const isoDate = z
  .string()
  .trim()
  .datetime({ offset: true, message: 'Use a date and time, e.g. 2026-10-20T09:00:00+05:30' });

const oneLine = /^[^\r\n\t]*$/;
const TOKEN_RE = /\{([^{}]*)\}/g;

const title = (which: string) =>
  z
    .string({ invalid_type_error: `${which} must be text` })
    .trim()
    .min(1, `${which} needs at least 1 character`)
    .max(HERO_BANNER_LIMITS.titleChars, `${which} can be at most ${HERO_BANNER_LIMITS.titleChars} characters (it must fit the banner)`)
    .regex(oneLine, `${which} must be on one line`)
    .transform((s) => s.toUpperCase());

const subLine = z
  .string({ invalid_type_error: 'Each sub-line must be text' })
  .trim()
  .min(2, 'Each sub-line needs at least 2 characters')
  .max(HERO_BANNER_LIMITS.lineChars, `Each sub-line can be at most ${HERO_BANNER_LIMITS.lineChars} characters`)
  .regex(oneLine, 'Each sub-line must be on one line')
  .superRefine((s, ctx) => {
    for (const m of s.matchAll(TOKEN_RE)) {
      if (!(HERO_BANNER_TOKENS as readonly string[]).includes(m[1]!)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown token {${m[1]}}. Use {min_price}, {free_count} or {points_rule}.`,
        });
      }
    }
  });

const fields = {
  mode: z.enum(HERO_BANNER_MODES),
  title_1: title('The first title word'),
  title_2: title('The second title word'),
  lines: z
    .array(subLine)
    .min(1, 'Add at least 1 sub-line')
    .max(HERO_BANNER_LIMITS.lines, `At most ${HERO_BANNER_LIMITS.lines} sub-lines`),
  cta_label: z
    .string({ invalid_type_error: 'The button text must be text' })
    .trim()
    .min(1, 'The button needs text')
    .max(HERO_BANNER_LIMITS.ctaChars, `The button text can be at most ${HERO_BANNER_LIMITS.ctaChars} characters`)
    .regex(oneLine, 'The button text must be on one line')
    .transform((s) => s.toUpperCase()),
  cta_destination_type: z.enum(promotionDestinationTypes).nullable(),
  cta_destination_value: z.string().trim().max(255).nullable(),
  items: z
    .array(z.enum(HERO_BANNER_ITEMS))
    .min(1, 'Choose at least 1 item for the beam')
    .max(HERO_BANNER_ITEMS.length)
    .refine((xs) => new Set(xs).size === xs.length, 'Each item can be chosen once'),
  starts_at: isoDate.nullable(),
  ends_at: isoDate.nullable(),
};

const settingObject = z.object(fields);
export type HeroBannerSetting = z.infer<typeof settingObject>;

/** AUTO with today's words as the starting point for CUSTOM. */
export const DEFAULT_HERO_BANNER: HeroBannerSetting = {
  mode: 'AUTO',
  title_1: 'FRESH',
  title_2: 'GROCERIES',
  lines: ['Groceries starting at {min_price}'],
  cta_label: 'ORDER NOW',
  cta_destination_type: null,
  cta_destination_value: null,
  items: ['bread', 'apple', 'carrot', 'egg', 'broccoli', 'banana'],
  starts_at: null,
  ends_at: null,
};

/** Rules across fields, applied to the merged setting. */
export const heroBannerSettingSchema = settingObject.superRefine((v, ctx) => {
  if (v.starts_at && v.ends_at && Date.parse(v.ends_at) <= Date.parse(v.starts_at)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ends_at'], message: 'The end must be after the start' });
  }
  if ((v.cta_destination_type === 'CATEGORY' || v.cta_destination_type === 'PRODUCT') && !v.cta_destination_value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cta_destination_value'],
      message: `cta_destination_value is required when cta_destination_type is ${v.cta_destination_type}`,
    });
  }
});

/** Any subset of the fields; the rest keep their stored values. */
export const updateHeroBannerSchema = settingObject
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });
export type UpdateHeroBannerInput = z.infer<typeof updateHeroBannerSchema>;

/** A stored row as a setting; anything malformed falls back to the defaults. */
export function heroBannerFrom(value: unknown): HeroBannerSetting {
  if (!value || typeof value !== 'object') return { ...DEFAULT_HERO_BANNER };
  const parsed = heroBannerSettingSchema.safeParse({ ...DEFAULT_HERO_BANNER, ...(value as object) });
  return parsed.success ? parsed.data : { ...DEFAULT_HERO_BANNER };
}

export type HeroBannerStatus = 'AUTO' | 'LIVE' | 'SCHEDULED' | 'ENDED';
export function heroBannerStatus(s: Pick<HeroBannerSetting, 'mode' | 'starts_at' | 'ends_at'>, now: Date): HeroBannerStatus {
  if (s.mode !== 'CUSTOM') return 'AUTO';
  if (s.starts_at && now.getTime() < Date.parse(s.starts_at)) return 'SCHEDULED';
  if (s.ends_at && now.getTime() >= Date.parse(s.ends_at)) return 'ENDED';
  return 'LIVE';
}

/** What GET /store carries while a custom banner is live (tokens are filled in by the app). */
export interface PublicHeroBanner {
  mode: 'CUSTOM';
  title: [string, string];
  lines: string[];
  cta_label: string;
  /** Where ORDER NOW goes; null = the app's own (scroll to the aisles), also for a target that is gone or off. */
  cta_target: PromotionTarget | null;
  items: HeroBannerItem[];
  ends_at: string | null;
}

export class HeroBannerService {
  async get(): Promise<HeroBannerSetting & { cta_target: PromotionTarget | null; status: HeroBannerStatus; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', HERO_BANNER_KEY)
      .executeTakeFirst();
    const setting = heroBannerFrom(row?.value);
    const [target] = await describeTargets([setting]);
    return {
      ...setting,
      cta_target: target ?? null,
      status: heroBannerStatus(setting, orderingClock.now()),
      updated_at: row?.updated_at ?? null,
    };
  }

  /** Audited (HERO_BANNER_UPDATED); customers see it on their next GET /store. */
  async set(input: UpdateHeroBannerInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', HERO_BANNER_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = heroBannerFrom(before?.value);
      const merged = heroBannerSettingSchema.parse({ ...previous, ...input });
      // The same target rules as a promotion: it must exist; stored canonically.
      merged.cta_destination_value = await normalizePromotionTarget(merged.cta_destination_type, merged.cta_destination_value);
      const value = JSON.stringify(merged);
      await trx
        .insertInto('system_configurations')
        .values({ key: HERO_BANNER_KEY, value, description: 'Customer app Home hero banner: automatic or custom words, button, items and schedule' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'HERO_BANNER_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: HERO_BANNER_KEY, ...(before ? previous : {}) },
        newValues: { key: HERO_BANNER_KEY, ...merged },
      });
      logger.info({ actorId: actor.actorId, mode: merged.mode }, 'Hero banner changed');
    });
    return this.get();
  }

  /** The banner as GET /store serves it; null = AUTO (also outside its schedule). */
  async readPublic(now: Date): Promise<PublicHeroBanner | null> {
    const row = await db
      .selectFrom('system_configurations')
      .select('value')
      .where('key', '=', HERO_BANNER_KEY)
      .executeTakeFirst();
    const s = heroBannerFrom(row?.value);
    if (heroBannerStatus(s, now) !== 'LIVE') return null;
    const [target] = s.cta_destination_type ? await describeTargets([s]) : [null];
    return {
      mode: 'CUSTOM',
      title: [s.title_1, s.title_2],
      lines: s.lines,
      cta_label: s.cta_label,
      // A switched-off or deleted target: the button keeps the app's own behaviour.
      cta_target: target && target.is_active !== false ? target : null,
      items: s.items,
      ends_at: s.ends_at,
    };
  }
}

export const heroBannerService = new HeroBannerService();
