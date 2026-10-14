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
 * The customer app's animated promo band (owner, 2026-10-14: "make sure
 * promotional banner edit option like this animation in the ops and admin").
 *
 * The yellow band with scalloped edges that follows the third aisle on Home:
 * sliding headline lines, a row of ticked points, an optional item floating
 * in a light beam and the waving rider mascot. Until now every word and
 * colour was hard-coded in the app; this makes it Admin's and Operations'.
 *
 * Stored in system_configurations 'promo_band' (no migration). No row - or a
 * malformed one - means the defaults below, which render exactly the band the
 * app drew before this existed (empty `lines` / `ticks` = the app's own live
 * copy: "Free delivery on your first N orders", "No Platform Fee"...).
 *
 * Staff:  GET|PATCH /admin/settings/promo-band (ADMIN, OPERATIONS; audited
 *         PROMO_BAND_UPDATED). PATCH takes any subset of fields; the merged
 *         result is validated as a whole.
 * Public: GET /store `promo_band` - the band as the app should draw it now,
 *         or null while it is switched off or outside its schedule.
 *
 * Colours are palette keys, never free hex: the band stays inside Blynk's
 * palette, and a text colour that cannot be read on the chosen background
 * (WCAG AA, 4.5:1 against both gradient stops) is refused. The shared visual
 * spec is docs/promo-surfaces.md.
 */
export const PROMO_BAND_KEY = 'promo_band';

/** Background gradients [top, bottom] - Blynk palette only. */
export const PROMO_BAND_BACKGROUNDS = {
  YELLOW: ['#FFE141', '#F2C600'],
  YELLOW_SOFT: ['#FFEFA0', '#FFE141'],
  CREAM: ['#FFF8D6', '#FFEFA0'],
  WHITE: ['#FFFFFF', '#F4F4F6'],
  INK: ['#1A1D2E', '#2A2E45'],
  GREEN: ['#0C831F', '#0A6B19'],
} as const;
export type PromoBandBackground = keyof typeof PROMO_BAND_BACKGROUNDS;
const BACKGROUND_KEYS = Object.keys(PROMO_BAND_BACKGROUNDS) as [PromoBandBackground, ...PromoBandBackground[]];

export const PROMO_BAND_TEXT_COLORS = {
  INK: '#1A1D2E',
  WHITE: '#FFFFFF',
  YELLOW: '#FFE141',
  BROWN: '#7A5F00',
  GREEN: '#0A6B19',
} as const;
export type PromoBandTextColor = keyof typeof PROMO_BAND_TEXT_COLORS;
const TEXT_KEYS = Object.keys(PROMO_BAND_TEXT_COLORS) as [PromoBandTextColor, ...PromoBandTextColor[]];

/** Illustrated items the beam can hold (the app draws its own artwork for each key). */
export const PROMO_BAND_ILLUSTRATIONS = [
  'bread', 'apple', 'carrot', 'egg', 'broccoli', 'banana', 'milk', 'rice', 'cheese', 'tomato', 'fish', 'chicken', 'gift', 'cart',
] as const;
export const PROMO_BAND_ITEM_KINDS = ['NONE', 'ILLUSTRATED', 'IMAGE'] as const;
export const PROMO_BAND_MASCOTS = ['WAVE', 'RIDE', 'OFF'] as const;

export const PROMO_BAND_LIMITS = { lines: 5, lineChars: 44, ticks: 3, tickChars: 24 } as const;

/** WCAG relative luminance of #RRGGBB. */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Worst contrast of a text colour against both stops of a background. */
export function textContrast(background: PromoBandBackground, text: PromoBandTextColor): number {
  const [top, bottom] = PROMO_BAND_BACKGROUNDS[background];
  const hex = PROMO_BAND_TEXT_COLORS[text];
  return Math.min(contrast(top, hex), contrast(bottom, hex));
}
export const MIN_TEXT_CONTRAST = 4.5;
/** The text colours that stay readable on a background (AA). */
export function readableTextColors(background: PromoBandBackground): PromoBandTextColor[] {
  return TEXT_KEYS.filter((t) => textContrast(background, t) >= MIN_TEXT_CONTRAST);
}
/** text_color null = automatic: the most readable one. */
export function autoTextColor(background: PromoBandBackground): PromoBandTextColor {
  return [...TEXT_KEYS].sort((a, b) => textContrast(background, b) - textContrast(background, a))[0]!;
}

const line = (max: number, what: string) =>
  z
    .string({ invalid_type_error: `Each ${what} must be text` })
    .trim()
    .min(2, `Each ${what} needs at least 2 characters`)
    .max(max, `Each ${what} can be at most ${max} characters`);

const isoDate = z
  .string()
  .trim()
  .datetime({ offset: true, message: 'Use a date and time, e.g. 2026-10-20T09:00:00+05:30' });

const fields = {
  enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }),
  lines: z
    .array(line(PROMO_BAND_LIMITS.lineChars, 'headline'))
    .max(PROMO_BAND_LIMITS.lines, `At most ${PROMO_BAND_LIMITS.lines} headlines`),
  ticks: z
    .array(line(PROMO_BAND_LIMITS.tickChars, 'ticked point'))
    .max(PROMO_BAND_LIMITS.ticks, `At most ${PROMO_BAND_LIMITS.ticks} ticked points`),
  background: z.enum(BACKGROUND_KEYS),
  text_color: z.enum(TEXT_KEYS).nullable(),
  item_kind: z.enum(PROMO_BAND_ITEM_KINDS),
  item_illustration: z.enum(PROMO_BAND_ILLUSTRATIONS).nullable(),
  item_image_url: z
    .string()
    .trim()
    .url('Must be a valid URL')
    .max(1000)
    .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL')
    .nullable(),
  mascot: z.enum(PROMO_BAND_MASCOTS),
  cta_destination_type: z.enum(promotionDestinationTypes).nullable(),
  cta_destination_value: z.string().trim().max(255).nullable(),
  starts_at: isoDate.nullable(),
  ends_at: isoDate.nullable(),
};

const settingObject = z.object(fields);
export type PromoBandSetting = z.infer<typeof settingObject>;

export const DEFAULT_PROMO_BAND: PromoBandSetting = {
  enabled: true,
  lines: [],
  ticks: [],
  background: 'YELLOW',
  text_color: null,
  item_kind: 'NONE',
  item_illustration: null,
  item_image_url: null,
  mascot: 'WAVE',
  cta_destination_type: null,
  cta_destination_value: null,
  starts_at: null,
  ends_at: null,
};

/** Rules across fields, applied to the merged setting. */
export const promoBandSettingSchema = settingObject.superRefine((v, ctx) => {
  if (v.text_color && textContrast(v.background, v.text_color) < MIN_TEXT_CONTRAST) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['text_color'],
      message: `${v.text_color} text is hard to read on ${v.background}. Choose ${readableTextColors(v.background).join(' or ')}.`,
    });
  }
  if (v.item_kind === 'ILLUSTRATED' && !v.item_illustration) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['item_illustration'], message: 'Choose the illustrated item' });
  }
  if (v.item_kind === 'IMAGE' && !v.item_image_url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['item_image_url'], message: 'Upload the item image' });
  }
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
export const updatePromoBandSchema = settingObject
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });
export type UpdatePromoBandInput = z.infer<typeof updatePromoBandSchema>;

/** A stored row as a setting; anything malformed falls back to the defaults. */
export function promoBandFrom(value: unknown): PromoBandSetting {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PROMO_BAND };
  const parsed = promoBandSettingSchema.safeParse({ ...DEFAULT_PROMO_BAND, ...(value as object) });
  return parsed.success ? parsed.data : { ...DEFAULT_PROMO_BAND };
}

export type PromoBandStatus = 'LIVE' | 'OFF' | 'SCHEDULED' | 'ENDED';
export function promoBandStatus(s: Pick<PromoBandSetting, 'enabled' | 'starts_at' | 'ends_at'>, now: Date): PromoBandStatus {
  if (!s.enabled) return 'OFF';
  if (s.starts_at && now.getTime() < Date.parse(s.starts_at)) return 'SCHEDULED';
  if (s.ends_at && now.getTime() >= Date.parse(s.ends_at)) return 'ENDED';
  return 'LIVE';
}

/** What GET /store carries: the band to draw now. Colours are resolved to hex for the app. */
export interface PublicPromoBand {
  lines: string[];
  ticks: string[];
  background: PromoBandBackground;
  colors: { start: string; end: string; text: string };
  item: { kind: (typeof PROMO_BAND_ITEM_KINDS)[number]; illustration: string | null; image_url: string | null };
  mascot: (typeof PROMO_BAND_MASCOTS)[number];
  /** Where a tap goes; null = the band is informational (or its target is gone or switched off). */
  cta_target: PromotionTarget | null;
  ends_at: string | null;
}

export class PromoBandService {
  async get(): Promise<PromoBandSetting & { cta_target: PromotionTarget | null; status: PromoBandStatus; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', PROMO_BAND_KEY)
      .executeTakeFirst();
    const setting = promoBandFrom(row?.value);
    const [target] = await describeTargets([setting]);
    return {
      ...setting,
      cta_target: target ?? null,
      status: promoBandStatus(setting, orderingClock.now()),
      updated_at: row?.updated_at ?? null,
    };
  }

  /** Audited (PROMO_BAND_UPDATED); customers see it on their next GET /store. */
  async set(input: UpdatePromoBandInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', PROMO_BAND_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = promoBandFrom(before?.value);
      const merged = promoBandSettingSchema.parse({ ...previous, ...input });
      // The same target rules as a promotion: it must exist; stored canonically.
      merged.cta_destination_value = await normalizePromotionTarget(merged.cta_destination_type, merged.cta_destination_value);
      const value = JSON.stringify(merged);
      await trx
        .insertInto('system_configurations')
        .values({ key: PROMO_BAND_KEY, value, description: 'Customer app Home promo band: headlines, colours, item, mascot, link and schedule' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'PROMO_BAND_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: PROMO_BAND_KEY, ...(before ? previous : {}) },
        newValues: { key: PROMO_BAND_KEY, ...merged },
      });
      logger.info({ actorId: actor.actorId, enabled: merged.enabled }, 'Promo band changed');
    });
    return this.get();
  }

  /** The band as GET /store serves it; null while off or outside its schedule. */
  async readPublic(now: Date): Promise<PublicPromoBand | null> {
    const row = await db
      .selectFrom('system_configurations')
      .select('value')
      .where('key', '=', PROMO_BAND_KEY)
      .executeTakeFirst();
    const s = promoBandFrom(row?.value);
    if (promoBandStatus(s, now) !== 'LIVE') return null;
    const [target] = s.cta_destination_type ? await describeTargets([s]) : [null];
    const [start, end] = PROMO_BAND_BACKGROUNDS[s.background];
    return {
      lines: s.lines,
      ticks: s.ticks,
      background: s.background,
      colors: { start, end, text: PROMO_BAND_TEXT_COLORS[s.text_color ?? autoTextColor(s.background)] },
      item: {
        kind: s.item_kind,
        illustration: s.item_kind === 'ILLUSTRATED' ? s.item_illustration : null,
        image_url: s.item_kind === 'IMAGE' ? s.item_image_url : null,
      },
      mascot: s.mascot,
      // A switched-off or deleted target is not linked: the band stays informational.
      cta_target: target && target.is_active !== false ? target : null,
      ends_at: s.ends_at,
    };
  }
}

export const promoBandService = new PromoBandService();
