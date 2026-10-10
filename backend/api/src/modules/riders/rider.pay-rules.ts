import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { RiderBonusKind, RiderPayModel, RiderPayType } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import {
  commissionPercentSchema,
  DEFAULT_RIDER_COMMISSION_PERCENT,
  RIDER_COMMISSION_KEY,
} from '../configuration/settings.service.js';
import type { DBConnection } from '../orders/order.repository.js';
import type { DeliveryRow, OrderRow } from '../orders/lifecycle/types.js';
import { haversineM, roadDistanceM } from '../routing/index.js';
import { kmTiersFrom, kmTiersSchema, priceByKmTiers, type KmTier } from '../pricing/km-tiers.js';

/*
 * Rider pay controls (migration 038; owner, 2026-10-10): "give the option in
 * ops and admin to control the rider app charges" - fixed pay per delivery,
 * distance-based pay, bonuses & incentives, deductions/penalties.
 *
 * THE EARNING FORMULA (worked out once, when the delivery is settled, and
 * snapshotted on the delivery row so history never changes):
 *
 *   base  (COMMISSION riders only; COMPANY riders are salaried, base 0)
 *     PERCENT  : standard_delivery_fee x percent / 100
 *     FIXED    : fixed_lkr
 *     DISTANCE : base_lkr + per_km_lkr x road km (store -> drop-off, OSRM;
 *                when OSRM is unavailable: straight line x 1.3, marked
 *                estimated) - distance_mode LINEAR
 *                or, distance_mode TIERS (migration 040; owner, 2026-10-10):
 *                the per-km tier table on the same road km - every started
 *                km counts, the last row repeats (pricing/km-tiers.ts)
 *     then the optional floor: base = max(base, min_lkr)
 *   per-delivery bonuses (each rule on/off; for COMMISSION riders, and for
 *   COMPANY riders too only when bonus_rules.company_riders is on)
 *     PEAK_BOOST    : delivered (Asia/Colombo) inside a peak window
 *     RAIN_BOOST    : the "Rain boost" switch is on (and not past auto-off)
 *       each +amount LKR (FIXED) or +amount% of base (PERCENT); they stack
 *     LONG_DISTANCE : +amount_lkr when the drop-off is more than over_km away
 *   rider_earning_lkr = base + per-delivery bonuses
 *
 *   per-day bonus
 *     DAILY_TARGET  : each tier pays its amount ONCE when the rider's
 *                     delivered count that Colombo day reaches it (10 -> +200,
 *                     then 20 -> +500 more). A line with no delivery.
 *
 * A rider's own model (riders.pay_model) or the store default; a rider's own
 * numbers override the default's one by one (null = the default's number).
 * Adjustments (deductions / extra pay) are in rider.pay.ts.
 */

export const RIDER_PAY_MODELS = ['PERCENT', 'FIXED', 'DISTANCE'] as const satisfies readonly RiderPayModel[];
/** How DISTANCE pays (migration 040; owner, 2026-10-10): base + per km, or per-km tiers. */
export const DISTANCE_MODES = ['LINEAR', 'TIERS'] as const;
export type DistanceMode = (typeof DISTANCE_MODES)[number];
export const BOOST_MODES = ['FIXED', 'PERCENT'] as const;
export type BoostMode = (typeof BOOST_MODES)[number];
export const PER_DELIVERY_BONUS_KINDS = ['PEAK_BOOST', 'RAIN_BOOST', 'LONG_DISTANCE'] as const satisfies readonly RiderBonusKind[];

export const RIDER_PAY_MODEL_KEY = 'rider_pay_model';
export const RIDER_BONUS_RULES_KEY = 'rider_bonus_rules';
export const RIDER_RAIN_BOOST_KEY = 'rider_rain_boost';
/** Straight line x this when OSRM cannot give the road distance. */
export const ROAD_FACTOR = 1.3;
const ZONE = 'Asia/Colombo';

export interface PayParams {
  model: RiderPayModel;
  percent: number;
  fixed_lkr: number;
  base_lkr: number;
  per_km_lkr: number;
  min_lkr: number | null;
  /** DISTANCE only (owner, 2026-10-10): LINEAR = base_lkr + per_km_lkr x km; TIERS = km_tiers. */
  distance_mode: DistanceMode;
  km_tiers: KmTier[];
}

export interface PeakWindow {
  days: number[];
  start: string;
  end: string;
}

export interface BonusRules {
  company_riders: boolean;
  peak: { enabled: boolean; mode: BoostMode; amount: number; windows: PeakWindow[] };
  daily_target: { enabled: boolean; tiers: { deliveries: number; amount_lkr: number }[] };
  long_distance: { enabled: boolean; over_km: number; amount_lkr: number };
}

export interface RainBoostState {
  on: boolean;
  mode: BoostMode;
  amount: number;
  auto_off_at: string | null;
  turned_on_at: string | null;
}

export const DEFAULT_PAY_MODEL: Omit<PayParams, 'percent'> = {
  model: 'PERCENT',
  fixed_lkr: 80,
  base_lkr: 50,
  per_km_lkr: 20,
  min_lkr: null,
  distance_mode: 'LINEAR',
  km_tiers: [],
};
export const DEFAULT_BONUS_RULES: BonusRules = {
  company_riders: false,
  peak: { enabled: false, mode: 'FIXED', amount: 30, windows: [] },
  daily_target: { enabled: false, tiers: [] },
  long_distance: { enabled: false, over_km: 5, amount_lkr: 50 },
};
export const DEFAULT_RAIN_BOOST: RainBoostState = { on: false, mode: 'FIXED', amount: 30, auto_off_at: null, turned_on_at: null };

export const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
export const lkrSchema = (label: string, max = 10_000) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(max, `${label} can be at most LKR ${max}`)
    .refine(twoDecimals, `${label} can have at most 2 decimals`);

const boostAmountSchema = z
  .number({ invalid_type_error: 'The boost must be a number' })
  .finite()
  .min(0, 'The boost cannot be negative')
  .max(10_000, 'The boost is too large')
  .refine(twoDecimals, 'The boost can have at most 2 decimals');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM');

const peakWindowSchema = z
  .object({
    days: z
      .array(z.number().int().min(1, 'Days are 1 (Mon) to 7 (Sun)').max(7, 'Days are 1 (Mon) to 7 (Sun)'))
      .min(1, 'Pick at least one day')
      .max(7)
      .refine((d) => new Set(d).size === d.length, 'A day is listed twice'),
    start: hhmm,
    end: hhmm,
  })
  .strict()
  .refine((w) => w.start < w.end, { message: 'The window must end after it starts', path: ['end'] });

const boostSection = { mode: z.enum(BOOST_MODES), amount: boostAmountSchema };
const percentBoostOk = (v: { mode: BoostMode; amount: number }) => v.mode !== 'PERCENT' || v.amount <= 100;

export const bonusRulesPatchSchema = z
  .object({
    company_riders: z.boolean().optional(),
    peak: z
      .object({ enabled: z.boolean(), ...boostSection, windows: z.array(peakWindowSchema).max(10, 'At most 10 peak windows') })
      .strict()
      .refine(percentBoostOk, { message: 'A percentage boost can be at most 100%', path: ['amount'] })
      .refine((p) => !p.enabled || p.windows.length > 0, { message: 'Add at least one peak window', path: ['windows'] })
      .optional(),
    daily_target: z
      .object({
        enabled: z.boolean(),
        tiers: z
          .array(
            z
              .object({
                deliveries: z.number().int('Deliveries must be a whole number').min(1).max(100),
                amount_lkr: lkrSchema('The bonus').refine((v) => v > 0, 'The bonus must be above 0'),
              })
              .strict()
          )
          .max(5, 'At most 5 targets')
          .refine((t) => new Set(t.map((x) => x.deliveries)).size === t.length, 'Two targets have the same number of deliveries'),
      })
      .strict()
      .refine((d) => !d.enabled || d.tiers.length > 0, { message: 'Add at least one target', path: ['tiers'] })
      .optional(),
    long_distance: z
      .object({
        enabled: z.boolean(),
        over_km: z.number().finite().min(0.5, 'At least 0.5 km').max(50, 'At most 50 km').refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6, 'At most 1 decimal'),
        amount_lkr: lkrSchema('The bonus'),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type BonusRulesPatch = z.infer<typeof bonusRulesPatchSchema>;

export const payModelPatchSchema = z
  .object({
    model: z.enum(RIDER_PAY_MODELS, { errorMap: () => ({ message: 'model must be PERCENT, FIXED or DISTANCE' }) }),
    percent: commissionPercentSchema.optional(),
    fixed_lkr: lkrSchema('The fixed pay').optional(),
    base_lkr: lkrSchema('The base pay').optional(),
    per_km_lkr: lkrSchema('The pay per km', 1000).optional(),
    min_lkr: lkrSchema('The minimum').nullable().optional(),
    // Per-km tiers (owner, 2026-10-10).
    distance_mode: z.enum(DISTANCE_MODES, { errorMap: () => ({ message: 'distance_mode must be LINEAR or TIERS' }) }).optional(),
    km_tiers: kmTiersSchema.optional(),
  })
  .strict();
export type PayModelPatch = z.infer<typeof payModelPatchSchema>;

export const rainBoostPatchSchema = z
  .object({
    on: z.boolean({ required_error: 'on is required' }),
    mode: z.enum(BOOST_MODES).optional(),
    amount: boostAmountSchema.optional(),
    auto_off_at: z
      .string()
      .datetime({ offset: true, message: 'auto_off_at must be an ISO date-time' })
      .nullable()
      .optional()
      .refine((v) => !v || new Date(v).getTime() > Date.now(), 'The auto-off time must be in the future')
      .refine((v) => !v || new Date(v).getTime() <= Date.now() + 7 * 86_400_000, 'The auto-off time can be at most 7 days ahead'),
  })
  .strict();
export type RainBoostPatch = z.infer<typeof rainBoostPatchSchema>;

// ----------------------------------------------------------------------------
// Reading the settings (a missing or malformed row = the defaults)
// ----------------------------------------------------------------------------

async function readValue(executor: DBConnection, key: string): Promise<{ value: unknown; updated_at: Date } | null> {
  const row = await executor.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', key).executeTakeFirst();
  return row ?? null;
}

const fullBonusSchema = z.object({
  company_riders: z.boolean(),
  peak: z.object({ enabled: z.boolean(), ...boostSection, windows: z.array(peakWindowSchema) }),
  daily_target: z.object({ enabled: z.boolean(), tiers: z.array(z.object({ deliveries: z.number().int().min(1), amount_lkr: z.number().positive() })) }),
  long_distance: z.object({ enabled: z.boolean(), over_km: z.number().positive(), amount_lkr: z.number().min(0) }),
});

function bonusRulesFrom(value: unknown): BonusRules {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  // Section by section, so one malformed section does not drop the others.
  const merged = { ...DEFAULT_BONUS_RULES, ...v };
  const parsed = fullBonusSchema.safeParse(merged);
  if (parsed.success) return parsed.data as BonusRules;
  const out: BonusRules = structuredClone(DEFAULT_BONUS_RULES);
  for (const k of ['company_riders', 'peak', 'daily_target', 'long_distance'] as const) {
    const one = fullBonusSchema.shape[k].safeParse(v[k]);
    if (one.success) (out as unknown as Record<string, unknown>)[k] = one.data;
  }
  return out;
}

function payModelFrom(value: unknown): Omit<PayParams, 'percent'> {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
  return {
    model: RIDER_PAY_MODELS.includes(v.model as RiderPayModel) ? (v.model as RiderPayModel) : DEFAULT_PAY_MODEL.model,
    fixed_lkr: n(v.fixed_lkr, DEFAULT_PAY_MODEL.fixed_lkr),
    base_lkr: n(v.base_lkr, DEFAULT_PAY_MODEL.base_lkr),
    per_km_lkr: n(v.per_km_lkr, DEFAULT_PAY_MODEL.per_km_lkr),
    min_lkr: typeof v.min_lkr === 'number' && Number.isFinite(v.min_lkr) && v.min_lkr >= 0 ? v.min_lkr : null,
    ...distanceFrom(v.distance_mode, v.km_tiers),
  };
}

/** TIERS only with a valid table; anything else is LINEAR, so a bad row never pays nonsense. */
function distanceFrom(mode: unknown, tiers: unknown): { distance_mode: DistanceMode; km_tiers: KmTier[] } {
  const km_tiers = kmTiersFrom(tiers);
  return { distance_mode: mode === 'TIERS' && km_tiers.length ? 'TIERS' : 'LINEAR', km_tiers };
}

/** 400 when TIERS would be saved with no tier table to pay by. */
export const tiersNeeded = () =>
  new z.ZodError([{ code: 'custom', path: ['km_tiers'], message: 'Add the km amounts before paying by per-km tiers' }]);

function rainFrom(value: unknown): RainBoostState {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    on: v.on === true,
    mode: BOOST_MODES.includes(v.mode as BoostMode) ? (v.mode as BoostMode) : DEFAULT_RAIN_BOOST.mode,
    amount: typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount >= 0 ? v.amount : DEFAULT_RAIN_BOOST.amount,
    auto_off_at: typeof v.auto_off_at === 'string' ? v.auto_off_at : null,
    turned_on_at: typeof v.turned_on_at === 'string' ? v.turned_on_at : null,
  };
}

function percentFrom(value: unknown): number {
  const p = value && typeof value === 'object' ? (value as { default_percent?: unknown }).default_percent : undefined;
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100 ? p : DEFAULT_RIDER_COMMISSION_PERCENT;
}

export async function getDefaultPayModel(executor: DBConnection = db): Promise<PayParams> {
  const [model, pct] = await Promise.all([readValue(executor, RIDER_PAY_MODEL_KEY), readValue(executor, RIDER_COMMISSION_KEY)]);
  return { ...payModelFrom(model?.value), percent: percentFrom(pct?.value) };
}

export async function getBonusRules(executor: DBConnection = db): Promise<BonusRules> {
  return bonusRulesFrom((await readValue(executor, RIDER_BONUS_RULES_KEY))?.value);
}

export async function getRainBoost(executor: DBConnection = db): Promise<RainBoostState> {
  return rainFrom((await readValue(executor, RIDER_RAIN_BOOST_KEY))?.value);
}

/** On, and not past its auto-off time. */
export function rainActive(rain: RainBoostState, at: Date = new Date()): boolean {
  if (!rain.on) return false;
  return !rain.auto_off_at || at.getTime() < new Date(rain.auto_off_at).getTime();
}

export interface RiderPaySettings {
  default_model: PayParams;
  bonus_rules: BonusRules;
  rain_boost: RainBoostState & { active: boolean };
}

export async function getRiderPaySettings(executor: DBConnection = db): Promise<RiderPaySettings> {
  const [default_model, bonus_rules, rain] = await Promise.all([
    getDefaultPayModel(executor),
    getBonusRules(executor),
    getRainBoost(executor),
  ]);
  return { default_model, bonus_rules, rain_boost: { ...rain, active: rainActive(rain) } };
}

// ----------------------------------------------------------------------------
// Changing the settings (ADMIN and OPERATIONS; audited)
// ----------------------------------------------------------------------------

async function upsert(executor: DBConnection, key: string, value: unknown, description: string) {
  const json = JSON.stringify(value);
  await executor
    .insertInto('system_configurations')
    .values({ key, value: json, description })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: new Date() }))
    .execute();
}

async function lockKeys(executor: DBConnection, keys: string[]) {
  await executor.selectFrom('system_configurations').select('key').where('key', 'in', keys).forUpdate().execute();
}

/** Audited (RIDER_PAY_MODEL_UPDATED); applies to deliveries settled afterwards. The % is the 'rider_commission' row. */
export async function setDefaultPayModel(input: PayModelPatch, actor: AuditActor): Promise<RiderPaySettings> {
  await db.transaction().execute(async (trx) => {
    await lockKeys(trx, [RIDER_PAY_MODEL_KEY, RIDER_COMMISSION_KEY]);
    const before = await getDefaultPayModel(trx);
    const next: PayParams = {
      model: input.model,
      percent: input.percent ?? before.percent,
      fixed_lkr: input.fixed_lkr ?? before.fixed_lkr,
      base_lkr: input.base_lkr ?? before.base_lkr,
      per_km_lkr: input.per_km_lkr ?? before.per_km_lkr,
      min_lkr: input.min_lkr === undefined ? before.min_lkr : input.min_lkr,
      distance_mode: input.distance_mode ?? before.distance_mode,
      km_tiers: input.km_tiers ?? before.km_tiers,
    };
    if (next.distance_mode === 'TIERS' && !next.km_tiers.length) throw tiersNeeded();
    const { percent, ...stored } = next;
    await upsert(trx, RIDER_PAY_MODEL_KEY, stored, 'The store default rider pay model (migration 038)');
    if (input.percent !== undefined) {
      await upsert(trx, RIDER_COMMISSION_KEY, { default_percent: round2(percent) }, "A commission rider's default share of the standard delivery fee, %");
    }
    await writeAudit(trx, actor, {
      action: 'RIDER_PAY_MODEL_UPDATED',
      entityType: 'SYSTEM_CONFIGURATION',
      entityId: SETTINGS_ENTITY_ID,
      oldValues: { key: RIDER_PAY_MODEL_KEY, ...before },
      newValues: { key: RIDER_PAY_MODEL_KEY, ...next },
    });
    logger.info({ before, next, actorId: actor.actorId }, 'Rider default pay model changed');
  });
  return await getRiderPaySettings();
}

/** Audited (RIDER_BONUS_RULES_UPDATED); applies to deliveries settled afterwards. */
export async function setBonusRules(input: BonusRulesPatch, actor: AuditActor): Promise<RiderPaySettings> {
  await db.transaction().execute(async (trx) => {
    await lockKeys(trx, [RIDER_BONUS_RULES_KEY]);
    const before = await getBonusRules(trx);
    const next: BonusRules = {
      company_riders: input.company_riders ?? before.company_riders,
      peak: input.peak ?? before.peak,
      daily_target: input.daily_target
        ? { ...input.daily_target, tiers: [...input.daily_target.tiers].sort((a, b) => a.deliveries - b.deliveries) }
        : before.daily_target,
      long_distance: input.long_distance ?? before.long_distance,
    };
    await upsert(trx, RIDER_BONUS_RULES_KEY, next, 'Rider bonuses: peak boost, daily target, long distance (migration 038)');
    await writeAudit(trx, actor, {
      action: 'RIDER_BONUS_RULES_UPDATED',
      entityType: 'SYSTEM_CONFIGURATION',
      entityId: SETTINGS_ENTITY_ID,
      oldValues: { key: RIDER_BONUS_RULES_KEY, ...before },
      newValues: { key: RIDER_BONUS_RULES_KEY, ...next },
    });
    logger.info({ actorId: actor.actorId }, 'Rider bonus rules changed');
  });
  return await getRiderPaySettings();
}

/** Audited (RAIN_BOOST_UPDATED); applies at once to deliveries settled afterwards. */
export async function setRainBoost(input: RainBoostPatch, actor: AuditActor): Promise<RiderPaySettings> {
  await db.transaction().execute(async (trx) => {
    await lockKeys(trx, [RIDER_RAIN_BOOST_KEY]);
    const before = await getRainBoost(trx);
    const wasActive = rainActive(before);
    const next: RainBoostState = {
      on: input.on,
      mode: input.mode ?? before.mode,
      amount: input.amount ?? before.amount,
      auto_off_at: input.on ? (input.auto_off_at === undefined ? (wasActive ? before.auto_off_at : null) : input.auto_off_at) : null,
      turned_on_at: input.on ? (wasActive ? before.turned_on_at : new Date().toISOString()) : null,
    };
    if (next.mode === 'PERCENT' && next.amount > 100) {
      throw new z.ZodError([{ code: 'custom', path: ['amount'], message: 'A percentage boost can be at most 100%' }]);
    }
    await upsert(trx, RIDER_RAIN_BOOST_KEY, next, 'Rain boost switch for rider pay (migration 038)');
    await writeAudit(trx, actor, {
      action: 'RAIN_BOOST_UPDATED',
      entityType: 'SYSTEM_CONFIGURATION',
      entityId: SETTINGS_ENTITY_ID,
      oldValues: { key: RIDER_RAIN_BOOST_KEY, ...before },
      newValues: { key: RIDER_RAIN_BOOST_KEY, ...next },
    });
    logger.info({ on: next.on, mode: next.mode, amount: next.amount, actorId: actor.actorId }, 'Rain boost changed');
  });
  return await getRiderPaySettings();
}

// ----------------------------------------------------------------------------
// Pure rules
// ----------------------------------------------------------------------------

export interface RiderPayColumns {
  pay_type: RiderPayType;
  commission_percent: unknown;
  pay_model: RiderPayModel | null;
  pay_fixed_lkr: unknown;
  pay_base_lkr: unknown;
  pay_per_km_lkr: unknown;
  pay_min_lkr: unknown;
  /** Migration 040 (owner, 2026-10-10); null = the store default's. */
  pay_distance_mode?: DistanceMode | null;
  pay_km_tiers?: unknown;
}

/** What a COMMISSION rider is paid on: own model/numbers over the store default's. */
export function effectivePayParams(rider: Omit<RiderPayColumns, 'pay_type'>, def: PayParams): PayParams {
  const ownTiers = kmTiersFrom(rider.pay_km_tiers);
  const tiers = ownTiers.length ? ownTiers : def.km_tiers;
  const mode = rider.pay_distance_mode ?? def.distance_mode;
  return {
    model: rider.pay_model ?? def.model,
    percent: num(rider.commission_percent) ?? def.percent,
    fixed_lkr: num(rider.pay_fixed_lkr) ?? def.fixed_lkr,
    base_lkr: num(rider.pay_base_lkr) ?? def.base_lkr,
    per_km_lkr: num(rider.pay_per_km_lkr) ?? def.per_km_lkr,
    min_lkr: num(rider.pay_min_lkr) ?? def.min_lkr,
    // TIERS with no table anywhere pays LINEAR (setRiderPay refuses to save that).
    distance_mode: mode === 'TIERS' && tiers.length ? 'TIERS' : 'LINEAR',
    km_tiers: tiers,
  };
}

/**
 * The model's pay for one delivery, with the floor. DISTANCE without a
 * distance pays base_lkr (LINEAR) or the km-1 amount (TIERS).
 */
export function basePay(p: PayParams, input: { standardFee: number; distanceKm: number | null }): number {
  let v: number;
  if (p.model === 'FIXED') v = p.fixed_lkr;
  else if (p.model === 'DISTANCE' && p.distance_mode === 'TIERS' && p.km_tiers.length) {
    v = priceByKmTiers(p.km_tiers, input.distanceKm ?? 0).total;
  } else if (p.model === 'DISTANCE') v = p.base_lkr + p.per_km_lkr * (input.distanceKm ?? 0);
  else v = Math.round(input.standardFee * p.percent) / 100;
  if (p.min_lkr !== null) v = Math.max(v, p.min_lkr);
  return round2(v);
}

export function boostAmount(mode: BoostMode, amount: number, base: number): number {
  return round2(mode === 'PERCENT' ? (base * amount) / 100 : amount);
}

/** Inside any window? `at` is read in Asia/Colombo; end is exclusive. */
export function inPeakWindow(windows: PeakWindow[], at: Date): boolean {
  const t = DateTime.fromJSDate(at).setZone(ZONE);
  const hm = t.toFormat('HH:mm');
  return windows.some((w) => w.days.includes(t.weekday) && hm >= w.start && hm < w.end);
}

export interface BonusLine {
  kind: RiderBonusKind;
  amount: number;
  detail: Record<string, unknown>;
}

/** The per-delivery bonuses (zero amounts left out). */
export function deliveryBonuses(
  rules: BonusRules,
  rain: RainBoostState,
  input: { base: number; distanceKm: number | null; at: Date }
): BonusLine[] {
  const out: BonusLine[] = [];
  if (rules.peak.enabled && inPeakWindow(rules.peak.windows, input.at)) {
    out.push({ kind: 'PEAK_BOOST', amount: boostAmount(rules.peak.mode, rules.peak.amount, input.base), detail: { mode: rules.peak.mode, amount: rules.peak.amount } });
  }
  if (rainActive(rain, input.at)) {
    out.push({ kind: 'RAIN_BOOST', amount: boostAmount(rain.mode, rain.amount, input.base), detail: { mode: rain.mode, amount: rain.amount } });
  }
  if (rules.long_distance.enabled && input.distanceKm !== null && input.distanceKm > rules.long_distance.over_km) {
    out.push({
      kind: 'LONG_DISTANCE',
      amount: round2(rules.long_distance.amount_lkr),
      detail: { over_km: rules.long_distance.over_km, distance_km: input.distanceKm },
    });
  }
  return out.filter((l) => l.amount > 0);
}

/** Do the automatic bonuses apply to a rider of this type? */
export const bonusesApply = (payType: RiderPayType, rules: BonusRules) => payType === 'COMMISSION' || rules.company_riders;

// ----------------------------------------------------------------------------
// Distance (store -> drop-off)
// ----------------------------------------------------------------------------

type Point = { lat: number; lng: number };

/** Swappable in tests (OSRM is mocked there). */
export const payDistance = {
  roadMetres: (from: Point, to: Point): Promise<number> => roadDistanceM(from, to),
};

/** Road km by OSRM, or straight line x 1.3 marked estimated when OSRM cannot answer. */
export async function measureDistance(from: Point, to: Point): Promise<{ km: number; estimated: boolean }> {
  try {
    const m = await payDistance.roadMetres(from, to);
    return { km: round2(m / 1000), estimated: false };
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'Rider pay: road distance unavailable; straight line x 1.3');
    return { km: round2((haversineM(from, to) * ROAD_FACTOR) / 1000), estimated: true };
  }
}

// ----------------------------------------------------------------------------
// Settlement (lifecycle settleCod)
// ----------------------------------------------------------------------------

export interface PaySnapshot {
  columns: {
    rider_pay_type: RiderPayType;
    rider_commission_percent: number | null;
    rider_earning_lkr: number;
    rider_pay_model: RiderPayModel | null;
    rider_pay_inputs: string | null;
    rider_distance_km: number | null;
    rider_distance_estimated: boolean | null;
    rider_base_earning_lkr: number;
    rider_bonus_lkr: number;
  };
  lines: BonusLine[];
}

/**
 * What this delivery earns, worked out with the rider's pay and the rules as
 * they are now. The distance is measured only when something needs it (a
 * DISTANCE model, or the long-distance bonus for a rider bonuses apply to).
 * OSRM runs inside the settlement transaction with a 2.5 s timeout.
 */
export async function computePaySnapshot(
  executor: DBConnection,
  delivery: Pick<DeliveryRow, 'rider_id'>,
  order: Pick<OrderRow, 'standard_delivery_fee' | 'delivery_fee' | 'dark_store_id' | 'delivery_latitude' | 'delivery_longitude'>,
  at: Date
): Promise<PaySnapshot> {
  const rider = await executor
    .selectFrom('riders')
    .select([
      'pay_type',
      'commission_percent',
      'pay_model',
      'pay_fixed_lkr',
      'pay_base_lkr',
      'pay_per_km_lkr',
      'pay_min_lkr',
      'pay_distance_mode',
      'pay_km_tiers',
    ])
    .where('id', '=', delivery.rider_id)
    .executeTakeFirst();
  const payType: RiderPayType = rider?.pay_type === 'COMMISSION' ? 'COMMISSION' : 'COMPANY';
  const [def, rules, rain] = await Promise.all([getDefaultPayModel(executor), getBonusRules(executor), getRainBoost(executor)]);
  const params = payType === 'COMMISSION' ? effectivePayParams(rider!, def) : null;
  const applies = bonusesApply(payType, rules);
  const fee = Number(order.standard_delivery_fee ?? order.delivery_fee ?? 0);

  let distance: { km: number; estimated: boolean } | null = null;
  if (params?.model === 'DISTANCE' || (applies && rules.long_distance.enabled)) {
    const hub = await executor.selectFrom('dark_stores').select(['latitude', 'longitude']).where('id', '=', order.dark_store_id).executeTakeFirst();
    if (hub) {
      distance = await measureDistance(
        { lat: Number(hub.latitude), lng: Number(hub.longitude) },
        { lat: Number(order.delivery_latitude), lng: Number(order.delivery_longitude) }
      );
    }
  }
  const km = distance?.km ?? null;
  const base = params ? basePay(params, { standardFee: fee, distanceKm: km }) : 0;
  const lines = applies ? deliveryBonuses(rules, rain, { base, distanceKm: km, at }) : [];
  const bonus = round2(lines.reduce((s, l) => s + l.amount, 0));

  let inputs: Record<string, unknown> | null = null;
  if (params) {
    inputs = { model: params.model, standard_fee: fee, min_lkr: params.min_lkr };
    if (params.model === 'PERCENT') inputs.percent = params.percent;
    if (params.model === 'FIXED') inputs.fixed_lkr = params.fixed_lkr;
    if (params.model === 'DISTANCE' && params.distance_mode === 'TIERS') {
      // Per-km tiers (owner, 2026-10-10): the table and the km it charged.
      Object.assign(inputs, {
        distance_mode: 'TIERS',
        km_tiers: params.km_tiers,
        km_counted: km === null ? null : priceByKmTiers(params.km_tiers, km).km_counted,
      });
    } else if (params.model === 'DISTANCE') Object.assign(inputs, { base_lkr: params.base_lkr, per_km_lkr: params.per_km_lkr });
  }
  return {
    columns: {
      rider_pay_type: payType,
      rider_commission_percent: params?.model === 'PERCENT' ? params.percent : null,
      rider_earning_lkr: round2(base + bonus),
      rider_pay_model: params?.model ?? null,
      rider_pay_inputs: inputs ? JSON.stringify(inputs) : null,
      rider_distance_km: km,
      rider_distance_estimated: distance ? distance.estimated : null,
      rider_base_earning_lkr: base,
      rider_bonus_lkr: bonus,
    },
    lines,
  };
}

export const colomboDate = (at: Date) => DateTime.fromJSDate(at).setZone(ZONE).toISODate()!;

/** The per-delivery bonus lines, idempotent per delivery and kind. */
export async function recordDeliveryBonusLines(executor: DBConnection, riderId: string, deliveryId: string, at: Date, lines: BonusLine[]) {
  if (!lines.length) return;
  await executor
    .insertInto('rider_earning_lines')
    .values(
      lines.map((l) => ({
        rider_id: riderId,
        delivery_id: deliveryId,
        earning_date: colomboDate(at),
        kind: l.kind,
        amount_lkr: l.amount,
        detail: JSON.stringify(l.detail),
        dedupe_key: `${l.kind}:${deliveryId}`,
      }))
    )
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute();
}

/**
 * Daily target: after a delivery is settled, every enabled tier the rider's
 * delivered count for that Colombo day has reached and that was not paid yet
 * becomes a DAILY_TARGET line (the tier's amount now). Each tier pays once a
 * day (dedupe key rider + day + tier).
 */
export async function awardDailyTargets(executor: DBConnection, riderId: string, payType: RiderPayType, at: Date) {
  const rules = await getBonusRules(executor);
  if (!rules.daily_target.enabled || !rules.daily_target.tiers.length || !bonusesApply(payType, rules)) return [];
  const day = colomboDate(at);
  const start = DateTime.fromISO(day, { zone: ZONE }).startOf('day');
  const { n } = await executor
    .selectFrom('deliveries')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('rider_id', '=', riderId)
    .where('assignment_status', '=', 'DELIVERED')
    .where('delivered_at', '>=', start.toJSDate())
    .where('delivered_at', '<', start.plus({ days: 1 }).toJSDate())
    .executeTakeFirstOrThrow();
  const count = Number(n);
  const reached = rules.daily_target.tiers.filter((t) => t.deliveries <= count);
  if (!reached.length) return [];
  const inserted = await executor
    .insertInto('rider_earning_lines')
    .values(
      reached.map((t) => ({
        rider_id: riderId,
        delivery_id: null,
        earning_date: day,
        kind: 'DAILY_TARGET' as const,
        amount_lkr: t.amount_lkr,
        detail: JSON.stringify({ deliveries: t.deliveries }),
        dedupe_key: `DAILY_TARGET:${riderId}:${day}:${t.deliveries}`,
      }))
    )
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .returning(['id'])
    .execute();
  if (inserted.length) logger.info({ riderId, day, count, tiers: inserted.length }, 'Rider daily target reached');
  return inserted;
}
