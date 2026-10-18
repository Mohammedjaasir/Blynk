import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * The customer app's own words and colours that are not part of the hero
 * banner or the promo band (owner, 2026-10-18: "make sure each and everything
 * was editable from the admin"): Home headlines and aisle-card lines, the
 * cart's top header and strip, the order-placed and login lines, the "coming
 * soon" online-payment note, and one card colour per aisle.
 *
 * Stored in system_configurations 'app_texts' (no migration). Every text is
 * optional: '' (or an empty list / no colour) keeps the app's built-in words,
 * so no row at all draws the app exactly as before.
 *
 * Staff:  GET|PATCH /admin/settings/app-texts (ADMIN, OPERATIONS; audited
 *         APP_TEXTS_UPDATED). PATCH takes any subset of fields.
 * Public: GET /store `app_texts` - only the fields that are set.
 */
export const APP_TEXTS_KEY = 'app_texts';

/** One-line texts and their limits (characters). */
export const APP_TEXT_FIELDS = {
  home_explore_title: 32,
  home_aisle_offer: 40,
  home_band_kicker: 36,
  home_band_title_offers: 24,
  home_band_title_aisles: 24,
  home_footer_title: 36,
  home_footer_sub: 48,
  aisle_banner_title: 32,
  aisle_banner_sub: 40,
  cart_header_pill: 36,
  cart_burst_top: 20,
  cart_burst_bottom: 20,
  cart_burst_big: 10,
  cart_burst_line_1: 20,
  cart_burst_line_2: 20,
  cart_bar_line: 36,
  cart_basket_title: 28,
  cart_bill_note: 48,
  pay_online_coming_soon: 32,
  placed_title: 28,
  placed_sub: 48,
} as const;
export type AppTextField = keyof typeof APP_TEXT_FIELDS;

/**
 * Colours of the app's main promotional surfaces (owner, 2026-10-18: "even colors also
 * editable through admin for each and everything"); '' = the app's own. The promo band has
 * its own colours (promo-band.ts) and each aisle card its own (aisle_colors).
 */
export const APP_COLOR_FIELDS = ['hero_bg_top', 'hero_bg_bottom', 'home_band_bg', 'cart_header_bg', 'cart_bar_bg', 'cart_bar_strip_bg'] as const;
export type AppColorField = (typeof APP_COLOR_FIELDS)[number];

export const APP_TEXT_LISTS = { home_aisle_lines: { max: 8, chars: 36 }, login_headlines: { max: 5, chars: 28 } } as const;
export const UNDER_AMOUNT_LIMITS = { min: 50, max: 100_000 } as const;

const oneLine = /^[^\r\n\t]*$/;
const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (max: number) =>
  z
    .string({ invalid_type_error: 'Must be text' })
    .trim()
    .max(max, `At most ${max} characters`)
    .regex(oneLine, 'Must be on one line');

const list = (max: number, chars: number) =>
  z.array(text(chars).min(1, 'An empty line is not allowed')).max(max, `At most ${max} lines`);

const color = z.string({ invalid_type_error: 'Must be a colour' }).trim().regex(/^(#[0-9a-f]{6})?$/i, 'Colours look like #FFE141');

const fields = {
  ...(Object.fromEntries(Object.entries(APP_TEXT_FIELDS).map(([k, max]) => [k, text(max)])) as Record<AppTextField, ReturnType<typeof text>>),
  ...(Object.fromEntries(APP_COLOR_FIELDS.map((k) => [k, color])) as Record<AppColorField, typeof color>),
  home_aisle_lines: list(APP_TEXT_LISTS.home_aisle_lines.max, APP_TEXT_LISTS.home_aisle_lines.chars),
  login_headlines: list(APP_TEXT_LISTS.login_headlines.max, APP_TEXT_LISTS.login_headlines.chars),
  /** "Under LKR 300" on Home (the rail and the filter chip); null = 300. */
  home_under_amount: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Use a whole amount')
    .min(UNDER_AMOUNT_LIMITS.min, `At least ${UNDER_AMOUNT_LIMITS.min}`)
    .max(UNDER_AMOUNT_LIMITS.max, `At most ${UNDER_AMOUNT_LIMITS.max}`)
    .nullable(),
  /** Category id -> card colour (#RRGGBB) for Home's aisle cards; missing = the app's own. */
  aisle_colors: z
    .record(z.string().regex(UUID, 'Unknown category'), z.string().regex(HEX, 'Colours look like #FFF1E6'))
    .refine((r) => Object.keys(r).length <= 200, 'Too many colours'),
};

const settingObject = z.object(fields);
export type AppTextsSetting = z.infer<typeof settingObject>;

export const DEFAULT_APP_TEXTS: AppTextsSetting = {
  ...(Object.fromEntries(Object.keys(APP_TEXT_FIELDS).map((k) => [k, ''])) as Record<AppTextField, string>),
  ...(Object.fromEntries(APP_COLOR_FIELDS.map((k) => [k, ''])) as Record<AppColorField, string>),
  home_aisle_lines: [],
  login_headlines: [],
  home_under_amount: null,
  aisle_colors: {},
};

export const updateAppTextsSchema = settingObject
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change' });
export type UpdateAppTextsInput = z.infer<typeof updateAppTextsSchema>;

/** A stored row as a setting; a malformed field falls back to its default, the rest are kept. */
export function appTextsFrom(value: unknown): AppTextsSetting {
  const out: AppTextsSetting = { ...DEFAULT_APP_TEXTS, aisle_colors: {} };
  if (!value || typeof value !== 'object') return out;
  for (const [k, schema] of Object.entries(fields)) {
    const parsed = (schema as z.ZodTypeAny).safeParse((value as Record<string, unknown>)[k]);
    if (parsed.success) (out as Record<string, unknown>)[k] = parsed.data;
  }
  return out;
}

/** GET /store's `app_texts`: only what staff set (the app keeps its own words for the rest). */
export type PublicAppTexts = Partial<AppTextsSetting>;

export function publicAppTexts(s: AppTextsSetting): PublicAppTexts {
  const out: PublicAppTexts = {};
  for (const k of Object.keys(APP_TEXT_FIELDS) as AppTextField[]) if (s[k]) out[k] = s[k];
  for (const k of APP_COLOR_FIELDS) if (s[k]) out[k] = s[k].toUpperCase();
  if (s.home_aisle_lines.length) out.home_aisle_lines = s.home_aisle_lines;
  if (s.login_headlines.length) out.login_headlines = s.login_headlines;
  if (s.home_under_amount !== null) out.home_under_amount = s.home_under_amount;
  if (Object.keys(s.aisle_colors).length) out.aisle_colors = s.aisle_colors;
  return out;
}

export class AppTextsService {
  private async row() {
    return db.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', APP_TEXTS_KEY).executeTakeFirst();
  }

  async get(): Promise<AppTextsSetting & { updated_at: Date | null }> {
    const row = await this.row();
    return { ...appTextsFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  /** Audited (APP_TEXTS_UPDATED); customers see it on their next GET /store. */
  async set(input: UpdateAppTextsInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', APP_TEXTS_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = appTextsFrom(before?.value);
      const merged = settingObject.parse({ ...previous, ...input });
      const value = JSON.stringify(merged);
      await trx
        .insertInto('system_configurations')
        .values({ key: APP_TEXTS_KEY, value, description: 'Customer app words and aisle colours (blank = the app\'s own)' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'APP_TEXTS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: APP_TEXTS_KEY, ...(before ? previous : {}) },
        newValues: { key: APP_TEXTS_KEY, ...merged },
      });
      logger.info({ actorId: actor.actorId, fields: Object.keys(input) }, 'App texts changed');
    });
    return this.get();
  }

  async readPublic(): Promise<PublicAppTexts> {
    return publicAppTexts(appTextsFrom((await this.row())?.value));
  }
}

export const appTextsService = new AppTextsService();
