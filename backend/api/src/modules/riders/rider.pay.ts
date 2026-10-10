import { Router, type Request } from 'express';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { RiderAdjustmentReason, RiderBonusKind, RiderPayModel, RiderPayType } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { logger } from '../../utils/logger.js';
import { publicPhone } from '../../utils/phone.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { commissionPercentSchema, DEFAULT_RIDER_COMMISSION_PERCENT, RIDER_COMMISSION_KEY } from '../configuration/settings.service.js';
import type { DBConnection } from '../orders/order.repository.js';
import { rangeBounds, STORE_ZONE } from '../reports/sales.service.js';
import {
  bonusesApply,
  bonusRulesPatchSchema,
  effectivePayParams,
  getBonusRules,
  getDefaultPayModel,
  getRainBoost,
  getRiderPaySettings,
  inPeakWindow,
  lkrSchema,
  payModelPatchSchema,
  rainActive,
  rainBoostPatchSchema,
  RIDER_PAY_MODELS,
  setBonusRules,
  setDefaultPayModel,
  setRainBoost,
  type BonusRulesPatch,
  type PayModelPatch,
  type PayParams,
  type RainBoostPatch,
} from './rider.pay-rules.js';
import { BONUS_KINDS, emptyTotals, riderLedger, sumTotals, type LedgerTotals } from './rider.pay-ledger.js';

/*
 * Rider pay (migration 032; owner, 2026-10-09). Like Uber/PickMe an approved
 * rider is either
 *  - COMPANY: salaried, earns nothing per delivery; Blynk keeps the whole
 *    delivery charge, or
 *  - COMMISSION: earns per delivery.
 * Blynk always keeps the product margin.
 *
 * Pay controls (migration 038; owner, 2026-10-10: "give the option in ops
 * and admin to control the rider app charges"): a COMMISSION rider is paid on
 * a model - PERCENT of the standard delivery fee (the original rule), FIXED
 * LKR per delivery or DISTANCE (base + per road km) - with an optional
 * minimum per delivery; the store default model or the rider's own. Bonuses
 * (peak / rain boost, daily target, long distance) and staff adjustments
 * (deductions / extra pay) come on top. The formula and the settlement
 * snapshot are in rider.pay-rules.ts; the per-day cash rule in
 * rider.pay-ledger.ts.
 *
 * DECISION (owner brief, 2026-10-10): staff adjustments apply to every
 * rider, COMPANY included. The automatic bonuses are for COMMISSION riders;
 * COMPANY riders get them too only while the "company riders get bonuses"
 * switch (bonus_rules.company_riders) is on - their base stays 0, so a
 * percentage boost gives them nothing, a fixed one does.
 *
 * Cash (owner, 2026-10-09; extended 2026-10-10): a rider keeps what each
 * delivery earned out of that door's COD cash (min(earning, cash)), plus the
 * day's daily-target bonuses and adjustments out of the day's cash; anything
 * the day's cash cannot cover is owed to the rider (payable_to_rider).
 */

export const RIDER_PAY_TYPES = ['COMPANY', 'COMMISSION'] as const;
export const ADJUSTMENT_REASONS = ['CASH_SHORT', 'DAMAGED_ITEM', 'LATE', 'BONUS', 'OTHER'] as const satisfies readonly RiderAdjustmentReason[];

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** What one PERCENT delivery earns: a share of the standard fee for COMMISSION, 0 for COMPANY. */
export function riderEarning(payType: RiderPayType, percent: number, standardFee: number): number {
  if (payType !== 'COMMISSION') return 0;
  return Math.round(standardFee * percent) / 100;
}

/** The store default share, read with the caller's executor. */
export async function defaultCommissionPercent(executor: DBConnection = db): Promise<number> {
  const row = await executor
    .selectFrom('system_configurations')
    .select('value')
    .where('key', '=', RIDER_COMMISSION_KEY)
    .executeTakeFirst();
  const p = row?.value && typeof row.value === 'object' ? (row.value as { default_percent?: unknown }).default_percent : undefined;
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100 ? p : DEFAULT_RIDER_COMMISSION_PERCENT;
}

// ----------------------------------------------------------------------------
// Setting a rider's pay (Ops/Admin)
// ----------------------------------------------------------------------------

/**
 * A rider's pay type and own numbers. commission_percent: a number overrides
 * the default share for this rider, null (or omitted) uses the default.
 *
 * Pay controls (migration 038; owner, 2026-10-10): pay_model picks the
 * rider's own model (null = follow the store default model), and fixed_lkr /
 * base_lkr / per_km_lkr / min_lkr their own numbers (each null = the store
 * default's). Only the chosen model's numbers (and the floor) are kept. A
 * COMPANY rider has none. An older client sending just
 * {pay_type: 'COMMISSION', commission_percent: 80} puts the rider on their own
 * PERCENT 80, as before.
 */
const payFields = {
  commission_percent: commissionPercentSchema.nullable().optional(),
  pay_model: z
    .enum(RIDER_PAY_MODELS, { errorMap: () => ({ message: 'pay_model must be PERCENT, FIXED or DISTANCE' }) })
    .nullable()
    .optional(),
  fixed_lkr: lkrSchema('The fixed pay').nullable().optional(),
  base_lkr: lkrSchema('The base pay').nullable().optional(),
  per_km_lkr: lkrSchema('The pay per km', 1000).nullable().optional(),
  min_lkr: lkrSchema('The minimum').nullable().optional(),
};
const payTypeSchema = z.enum(RIDER_PAY_TYPES, { errorMap: () => ({ message: 'pay_type must be COMPANY or COMMISSION' }) });

export const riderPaySchema = z.object({ pay_type: payTypeSchema, ...payFields }).strict();
export type RiderPayInput = z.infer<typeof riderPaySchema>;

/** The approve body: all optional; without pay_type the rider stays COMPANY (the column default). */
export const approvePaySchema = z.object({ pay_type: payTypeSchema.optional(), ...payFields }).strict().default({});
export type ApprovePayInput = z.infer<typeof approvePaySchema>;

/** The riders columns for a pay input. */
export function payValues(input: RiderPayInput) {
  const none = {
    commission_percent: null as number | null,
    pay_model: null as RiderPayModel | null,
    pay_fixed_lkr: null as number | null,
    pay_base_lkr: null as number | null,
    pay_per_km_lkr: null as number | null,
    pay_min_lkr: null as number | null,
  };
  if (input.pay_type !== 'COMMISSION') return { pay_type: input.pay_type, ...none };
  const model: RiderPayModel | null =
    input.pay_model !== undefined ? input.pay_model : input.commission_percent != null ? 'PERCENT' : null;
  if (model === null) return { pay_type: input.pay_type, ...none };
  return {
    pay_type: input.pay_type,
    pay_model: model,
    commission_percent: model === 'PERCENT' ? (input.commission_percent ?? null) : null,
    pay_fixed_lkr: model === 'FIXED' ? (input.fixed_lkr ?? null) : null,
    pay_base_lkr: model === 'DISTANCE' ? (input.base_lkr ?? null) : null,
    pay_per_km_lkr: model === 'DISTANCE' ? (input.per_km_lkr ?? null) : null,
    pay_min_lkr: input.min_lkr ?? null,
  };
}

export interface RiderPay {
  rider_id: string;
  pay_type: RiderPayType;
  /** The rider's own share; null = the default. */
  commission_percent: number | null;
  /** COMMISSION: own share or default; null for COMPANY. */
  effective_percent: number | null;
  default_percent: number;
  /** Migration 038: the rider's own model; null = the store default model. */
  pay_model: RiderPayModel | null;
  own: { fixed_lkr: number | null; base_lkr: number | null; per_km_lkr: number | null; min_lkr: number | null };
  /** What a new delivery pays this rider now; null for COMPANY. */
  effective: PayParams | null;
  default_model: PayParams;
}

const RIDER_PAY_SELECT = ['id', 'pay_type', 'commission_percent', 'pay_model', 'pay_fixed_lkr', 'pay_base_lkr', 'pay_per_km_lkr', 'pay_min_lkr'] as const;

export async function getRiderPay(riderId: string, executor: DBConnection = db): Promise<RiderPay> {
  const rider = await executor
    .selectFrom('riders')
    .select(RIDER_PAY_SELECT)
    .where('id', '=', riderId)
    .where('approval_status', '=', 'APPROVED')
    .executeTakeFirst();
  if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
  const defModel = await getDefaultPayModel(executor);
  const own = numOrNull(rider.commission_percent);
  return {
    rider_id: rider.id,
    pay_type: rider.pay_type,
    commission_percent: own,
    effective_percent: rider.pay_type === 'COMMISSION' ? (own ?? defModel.percent) : null,
    default_percent: defModel.percent,
    pay_model: rider.pay_model,
    own: {
      fixed_lkr: numOrNull(rider.pay_fixed_lkr),
      base_lkr: numOrNull(rider.pay_base_lkr),
      per_km_lkr: numOrNull(rider.pay_per_km_lkr),
      min_lkr: numOrNull(rider.pay_min_lkr),
    },
    effective: rider.pay_type === 'COMMISSION' ? effectivePayParams(rider, defModel) : null,
    default_model: defModel,
  };
}

/** Audit shape: the original {pay_type, commission_percent} for a plain percentage deal, the full shape otherwise. */
function payAudit(v: {
  pay_type: unknown;
  commission_percent: unknown;
  pay_model: unknown;
  pay_fixed_lkr: unknown;
  pay_base_lkr: unknown;
  pay_per_km_lkr: unknown;
  pay_min_lkr: unknown;
}) {
  const base = { pay_type: v.pay_type, commission_percent: numOrNull(v.commission_percent) };
  if (v.pay_model === null || (v.pay_model === 'PERCENT' && v.pay_min_lkr === null)) return base;
  return {
    ...base,
    pay_model: v.pay_model,
    fixed_lkr: numOrNull(v.pay_fixed_lkr),
    base_lkr: numOrNull(v.pay_base_lkr),
    per_km_lkr: numOrNull(v.pay_per_km_lkr),
    min_lkr: numOrNull(v.pay_min_lkr),
  };
}

/** Audited (RIDER_PAY_UPDATED). Deliveries already settled keep their snapshot. */
export async function setRiderPay(riderId: string, input: RiderPayInput, actor: AuditActor): Promise<RiderPay> {
  return await db.transaction().execute(async (trx) => {
    const before = await trx
      .selectFrom('riders')
      .select(RIDER_PAY_SELECT)
      .where('id', '=', riderId)
      .where('approval_status', '=', 'APPROVED')
      .forUpdate()
      .executeTakeFirst();
    if (!before) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
    const values = payValues(input);
    await trx
      .updateTable('riders')
      .set({ ...values, updated_at: sql`now()` })
      .where('id', '=', riderId)
      .execute();
    await writeAudit(trx, actor, {
      action: 'RIDER_PAY_UPDATED',
      entityType: 'RIDER',
      entityId: riderId,
      oldValues: payAudit(before),
      newValues: payAudit(values),
    });
    logger.info({ riderId, ...values, by: actor.actorId }, 'Rider pay changed');
    return await getRiderPay(riderId, trx);
  });
}

// ----------------------------------------------------------------------------
// Adjustments: deductions and extra pay (migration 038; owner, 2026-10-10)
// ----------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Invalid date');

/** Today, Asia/Colombo. */
function colomboToday() {
  return DateTime.now().setZone(STORE_ZONE).startOf('day');
}

const adjustmentDate = isoDate
  .refine((v) => v <= colomboToday().toISODate()!, 'An adjustment cannot be dated in the future')
  .refine((v) => v >= colomboToday().minus({ days: 400 }).toISODate()!, 'An adjustment can be at most 400 days back');

const adjustmentAmount = z
  .number({ required_error: 'amount_lkr is required', invalid_type_error: 'amount_lkr must be a number' })
  .finite()
  .min(-100_000, 'An adjustment can be at most LKR 100000')
  .max(100_000, 'An adjustment can be at most LKR 100000')
  .refine((v) => v !== 0, 'The amount cannot be 0 - use a minus for a deduction')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'The amount can have at most 2 decimals');

const adjustmentNote = z.string().trim().max(300, 'The note can be at most 300 characters').nullable().optional();
const reasonSchema = z.enum(ADJUSTMENT_REASONS, {
  errorMap: () => ({ message: 'reason must be CASH_SHORT, DAMAGED_ITEM, LATE, BONUS or OTHER' }),
});

export const createAdjustmentSchema = z
  .object({ amount_lkr: adjustmentAmount, reason: reasonSchema, note: adjustmentNote, adjustment_date: adjustmentDate.optional() })
  .strict();
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

export const updateAdjustmentSchema = z
  .object({ amount_lkr: adjustmentAmount.optional(), reason: reasonSchema.optional(), note: adjustmentNote, adjustment_date: adjustmentDate.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateAdjustmentInput = z.infer<typeof updateAdjustmentSchema>;

export const listAdjustmentsQuerySchema = z
  .object({ rider_id: z.string().uuid('rider_id must be a valid UUID').optional(), from: isoDate.optional(), to: isoDate.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'to must be on or after from', path: ['to'] });

function adjustmentQuery(executor: DBConnection = db) {
  return executor
    .selectFrom('rider_pay_adjustments as a')
    .innerJoin('riders as r', 'r.id', 'a.rider_id')
    .innerJoin('users as u', 'u.id', 'r.user_id')
    .leftJoin('users as c', 'c.id', 'a.created_by_user_id')
    .select([
      'a.id',
      'a.rider_id',
      'u.full_name as rider_name',
      'a.amount_lkr',
      'a.reason',
      'a.note',
      sql<string>`a.adjustment_date::text`.as('adjustment_date'),
      'a.created_by_user_id',
      'c.full_name as created_by_name',
      'a.created_at',
      'a.updated_at',
    ]);
}
const presentAdjustment = <T extends { amount_lkr: unknown }>(row: T) => ({ ...row, amount_lkr: money(row.amount_lkr) });

const auditAdjustment = (a: { rider_id: string; amount_lkr: unknown; reason: string; note: string | null; adjustment_date: string }) => ({
  rider_id: a.rider_id,
  amount_lkr: money(a.amount_lkr),
  reason: a.reason,
  note: a.note,
  adjustment_date: a.adjustment_date,
});

/** Audited (RIDER_PAY_ADJUSTMENT_CREATED). Any approved rider, COMPANY included. */
export async function createAdjustment(riderId: string, input: CreateAdjustmentInput, actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const rider = await trx.selectFrom('riders').select('id').where('id', '=', riderId).where('approval_status', '=', 'APPROVED').executeTakeFirst();
    if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
    const values = {
      rider_id: riderId,
      amount_lkr: input.amount_lkr,
      reason: input.reason,
      note: input.note || null,
      adjustment_date: input.adjustment_date ?? colomboToday().toISODate()!,
    };
    const { id } = await trx
      .insertInto('rider_pay_adjustments')
      .values({ ...values, created_by_user_id: actor.actorId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, actor, {
      action: 'RIDER_PAY_ADJUSTMENT_CREATED',
      entityType: 'RIDER_PAY_ADJUSTMENT',
      entityId: id,
      newValues: auditAdjustment(values),
    });
    logger.info({ riderId, amount: values.amount_lkr, reason: values.reason, by: actor.actorId }, 'Rider pay adjustment added');
    return presentAdjustment(await adjustmentQuery(trx).where('a.id', '=', id).executeTakeFirstOrThrow());
  });
}

export async function listAdjustments(params: z.infer<typeof listAdjustmentsQuerySchema>) {
  const today = colomboToday().toISODate()!;
  const from = params.from ?? params.to ?? today;
  const to = params.to ?? (params.from ? params.from : today);
  let q = adjustmentQuery().where(sql`a.adjustment_date`, '>=', from).where(sql`a.adjustment_date`, '<=', to);
  if (params.rider_id) q = q.where('a.rider_id', '=', params.rider_id);
  return (await q.orderBy('a.adjustment_date', 'desc').orderBy('a.created_at', 'desc').execute()).map(presentAdjustment);
}

const adjustmentNotFound = () => new AppError('Adjustment not found.', 404, 'ADJUSTMENT_NOT_FOUND');

async function lockAdjustment(trx: DBConnection, id: string) {
  const row = await trx
    .selectFrom('rider_pay_adjustments')
    .select(['id', 'rider_id', 'amount_lkr', 'reason', 'note', sql<string>`adjustment_date::text`.as('adjustment_date')])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw adjustmentNotFound();
  return row;
}

/** Audited (RIDER_PAY_ADJUSTMENT_UPDATED). */
export async function updateAdjustment(id: string, input: UpdateAdjustmentInput, actor: AuditActor) {
  return await db.transaction().execute(async (trx) => {
    const before = await lockAdjustment(trx, id);
    const next = {
      rider_id: before.rider_id,
      amount_lkr: input.amount_lkr ?? Number(before.amount_lkr),
      reason: input.reason ?? before.reason,
      note: input.note === undefined ? before.note : input.note || null,
      adjustment_date: input.adjustment_date ?? before.adjustment_date,
    };
    await trx
      .updateTable('rider_pay_adjustments')
      .set({ amount_lkr: next.amount_lkr, reason: next.reason, note: next.note, adjustment_date: next.adjustment_date, updated_at: sql`now()` })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'RIDER_PAY_ADJUSTMENT_UPDATED',
      entityType: 'RIDER_PAY_ADJUSTMENT',
      entityId: id,
      oldValues: auditAdjustment(before),
      newValues: auditAdjustment(next),
    });
    return presentAdjustment(await adjustmentQuery(trx).where('a.id', '=', id).executeTakeFirstOrThrow());
  });
}

/** Audited (RIDER_PAY_ADJUSTMENT_DELETED, with what was removed). */
export async function deleteAdjustment(id: string, actor: AuditActor) {
  await db.transaction().execute(async (trx) => {
    const before = await lockAdjustment(trx, id);
    await trx.deleteFrom('rider_pay_adjustments').where('id', '=', id).execute();
    await writeAudit(trx, actor, {
      action: 'RIDER_PAY_ADJUSTMENT_DELETED',
      entityType: 'RIDER_PAY_ADJUSTMENT',
      entityId: id,
      oldValues: auditAdjustment(before),
    });
  });
  return { deleted: true as const };
}

// ----------------------------------------------------------------------------
// Earnings
// ----------------------------------------------------------------------------

export const earningsQuerySchema = z
  .object({
    range: z.enum(['today', 'this_week', 'custom']).default('today'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.range !== 'custom') return;
    if (!v.from || !v.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'A custom range needs from and to' });
      return;
    }
    if (v.from > v.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to must be on or after from' });
    else if (DateTime.fromISO(v.to).diff(DateTime.fromISO(v.from), 'days').days > 366)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'A range can be at most a year' });
  });
export type EarningsQuery = z.infer<typeof earningsQuerySchema>;

export function resolveEarningsRange(q: EarningsQuery): { from: string; to: string } {
  const today = colomboToday();
  if (q.range === 'custom') return { from: q.from!, to: q.to! };
  if (q.range === 'this_week') return { from: today.startOf('week').toISODate()!, to: today.toISODate()! };
  return { from: today.toISODate()!, to: today.toISODate()! };
}

/** The ledger figures a report row shows (coupon_discount is reported beside the margin). */
function figures(t: LedgerTotals) {
  const { coupon_discount: _c, ...rest } = t;
  return rest;
}

/**
 * The Ops/Admin earnings report: per rider, deliveries settled in the range
 * (by delivered_at, Asia/Colombo days), their bonuses, the staff adjustments
 * dated in the range and the cash per the day rule (rider.pay-ledger.ts).
 *
 * Product margin = selling price - purchase cost of the lines on that rider's
 * delivered orders (lines the store marked unavailable are left out). The
 * cost is the line's actual_unit_cost (set at pack), else
 * estimated_unit_cost - both snapshots of the product's purchase cost when
 * the order was placed, so later cost changes do not move it. Coupon
 * discounts are shown beside it, not taken out of it.
 */
export async function earningsReport(query: EarningsQuery) {
  const range = resolveEarningsRange(query);
  const { start, end } = rangeBounds(range);
  const [ledger, items, adjustments, defModel] = await Promise.all([
    riderLedger(range),
    db
      .selectFrom('deliveries as d')
      .innerJoin('order_items as i', 'i.order_id', 'd.order_id')
      .select([
        'd.rider_id',
        sql<string>`coalesce(sum(i.subtotal), 0)`.as('product_sales'),
        sql<string>`coalesce(sum(i.quantity * coalesce(i.actual_unit_cost, i.estimated_unit_cost)), 0)`.as('product_cost'),
      ])
      .where('d.assignment_status', '=', 'DELIVERED')
      .where('d.delivered_at', '>=', start)
      .where('d.delivered_at', '<', end)
      .where('i.item_status', '!=', 'UNAVAILABLE')
      .groupBy('d.rider_id')
      .execute(),
    listAdjustments({ from: range.from, to: range.to }),
    getDefaultPayModel(),
  ]);
  const ids = [...ledger.keys()];
  const riders = ids.length
    ? await db
        .selectFrom('riders as r')
        .innerJoin('users as u', 'u.id', 'r.user_id')
        .select([
          'r.id',
          'u.full_name',
          'u.phone',
          'r.pay_type',
          'r.commission_percent',
          'r.pay_model',
          'r.pay_fixed_lkr',
          'r.pay_base_lkr',
          'r.pay_per_km_lkr',
          'r.pay_min_lkr',
        ])
        .where('r.id', 'in', ids)
        .execute()
    : [];

  const rows = ids
    .map((riderId) => {
      const t = ledger.get(riderId) ?? emptyTotals();
      const r = riders.find((x) => x.id === riderId);
      const it = items.find((x) => x.rider_id === riderId);
      const sales = money(it?.product_sales);
      const cost = money(it?.product_cost);
      const own = numOrNull(r?.commission_percent);
      const commission = r?.pay_type === 'COMMISSION';
      return {
        rider_id: riderId,
        rider_name: r?.full_name ?? null,
        rider_phone: publicPhone(r?.phone),
        pay_type: (r?.pay_type ?? 'COMPANY') as RiderPayType,
        commission_percent: own,
        effective_percent: commission ? (own ?? defModel.percent) : null,
        pay_model: commission && r ? effectivePayParams(r, defModel).model : null,
        ...figures(t),
        product_sales: sales,
        product_cost: cost,
        product_margin: money(sales - cost),
        coupon_discount: t.coupon_discount,
      };
    })
    .sort((a, b) => (a.rider_name ?? '').localeCompare(b.rider_name ?? '') || a.rider_id.localeCompare(b.rider_id));

  const sum = (k: 'product_sales' | 'product_cost' | 'product_margin') => money(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0));
  const all = sumTotals([...ledger.values()]);
  return {
    range: { ...range, timezone: STORE_ZONE },
    default_percent: defModel.percent,
    default_model: defModel,
    riders: rows,
    totals: {
      ...figures(all),
      product_sales: sum('product_sales'),
      product_cost: sum('product_cost'),
      product_margin: sum('product_margin'),
      coupon_discount: all.coupon_discount,
    },
    adjustments,
  };
}

/**
 * The calling rider's own earnings (Rider app): today and this week
 * (Monday-Sunday, Asia/Colombo), with today's bonus lines and adjustments
 * (with their reasons) and the boosts running now. A COMPANY rider gets the
 * same counts; their base earning is 0.
 */
export async function ownEarnings(riderId: string) {
  const today = colomboToday();
  const todayRange = { from: today.toISODate()!, to: today.toISODate()! };
  const weekRange = { from: today.startOf('week').toISODate()!, to: today.toISODate()! };
  const [dayLedger, weekLedger, pay, rules, rain, lines, adjustments] = await Promise.all([
    riderLedger(todayRange, riderId),
    riderLedger(weekRange, riderId),
    getRiderPay(riderId),
    getBonusRules(),
    getRainBoost(),
    db
      .selectFrom('rider_earning_lines')
      .select(['kind', sql<string>`sum(amount_lkr)`.as('amount'), sql<number>`count(*)::int`.as('count')])
      .where('rider_id', '=', riderId)
      .where(sql`earning_date`, '=', todayRange.from)
      .groupBy('kind')
      .execute(),
    listAdjustments({ rider_id: riderId, from: todayRange.from, to: todayRange.to }),
  ]);
  const pick = (x: LedgerTotals) => ({
    deliveries: x.deliveries,
    delivery_charges: x.delivery_charges,
    /** The total: base + bonuses + adjustments. */
    earnings: x.total_earnings,
    base_earnings: x.base_earnings,
    delivery_bonuses: x.delivery_bonuses,
    day_bonuses: x.day_bonuses,
    bonuses: money(x.delivery_bonuses + x.day_bonuses),
    additions: x.additions,
    deductions: x.deductions,
    adjustments: x.adjustments,
    cash_collected: x.cash_collected,
    cash_to_keep: Math.max(0, money(x.cash_collected - x.cash_to_hand_in)),
    cash_to_hand_in: x.cash_to_hand_in,
    payable_to_rider: x.payable_to_rider,
  });
  const now = new Date();
  const order = (k: RiderBonusKind) => BONUS_KINDS.indexOf(k);
  return {
    timezone: STORE_ZONE,
    pay_type: pay.pay_type,
    /** The share a PERCENT rider earns on new deliveries; null for COMPANY. */
    commission_percent: pay.effective_percent,
    pay_model: pay.effective,
    boosts: {
      applies: bonusesApply(pay.pay_type, rules),
      rain: { active: rainActive(rain, now), mode: rain.mode, amount: rain.amount, until: rainActive(rain, now) ? rain.auto_off_at : null },
      peak: { active_now: rules.peak.enabled && inPeakWindow(rules.peak.windows, now), mode: rules.peak.mode, amount: rules.peak.amount },
    },
    today: {
      date: todayRange.from,
      ...pick(dayLedger.get(riderId) ?? emptyTotals()),
      bonus_lines: lines
        .map((l) => ({ kind: l.kind, amount_lkr: money(l.amount), count: l.count }))
        .filter((l) => l.amount_lkr > 0)
        .sort((a, b) => order(a.kind) - order(b.kind)),
      adjustment_lines: adjustments.map((a) => ({ id: a.id, amount_lkr: a.amount_lkr, reason: a.reason, note: a.note })),
    },
    week: { starts_on: weekRange.from, ...pick(weekLedger.get(riderId) ?? emptyTotals()) },
  };
}

// ----------------------------------------------------------------------------
// Routes (mounted under /admin) - ADMIN and OPERATIONS
// ----------------------------------------------------------------------------

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];
const riderIdParams = z.object({ id: z.string().uuid('Invalid rider ID') });
const adjustmentIdParams = z.object({ id: z.string().uuid('Invalid adjustment ID') });

export const adminRiderPayRouter = Router();

adminRiderPayRouter.get('/riders/:id/pay', ...STAFF, validate({ params: riderIdParams }), async (req, res, next) => {
  try {
    res.json({ success: true, data: { pay: await getRiderPay(req.params.id as string) } });
  } catch (err) {
    next(err);
  }
});

adminRiderPayRouter.patch(
  '/riders/:id/pay',
  ...STAFF,
  validate({ params: riderIdParams, body: riderPaySchema }),
  async (req, res, next) => {
    try {
      const pay = await setRiderPay(req.params.id as string, req.body as RiderPayInput, actorOf(req));
      res.json({ success: true, data: { pay } });
    } catch (err) {
      next(err);
    }
  }
);

adminRiderPayRouter.get(
  '/reports/rider-earnings',
  ...STAFF,
  validate({ query: earningsQuerySchema }),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await earningsReport(req.query as unknown as EarningsQuery) });
    } catch (err) {
      next(err);
    }
  }
);

// Store-wide rider pay settings (owner, 2026-10-10): the default model, the
// bonus rules and the rain boost switch. Each change audited
// (RIDER_PAY_MODEL_UPDATED, RIDER_BONUS_RULES_UPDATED, RAIN_BOOST_UPDATED)
// and applies to deliveries settled afterwards.
adminRiderPayRouter.get('/settings/rider-pay', ...STAFF, async (_req, res, next) => {
  try {
    res.json({ success: true, data: await getRiderPaySettings() });
  } catch (err) {
    next(err);
  }
});

adminRiderPayRouter.patch('/settings/rider-pay/model', ...STAFF, validate({ body: payModelPatchSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, data: await setDefaultPayModel(req.body as PayModelPatch, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

adminRiderPayRouter.patch('/settings/rider-pay/bonuses', ...STAFF, validate({ body: bonusRulesPatchSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, data: await setBonusRules(req.body as BonusRulesPatch, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

adminRiderPayRouter.patch('/settings/rider-pay/rain-boost', ...STAFF, validate({ body: rainBoostPatchSchema }), async (req, res, next) => {
  try {
    res.json({ success: true, data: await setRainBoost(req.body as RainBoostPatch, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

// Adjustments (owner, 2026-10-10): deductions and extra pay with a reason.
adminRiderPayRouter.post(
  '/riders/:id/adjustments',
  ...STAFF,
  validate({ params: riderIdParams, body: createAdjustmentSchema }),
  async (req, res, next) => {
    try {
      const adjustment = await createAdjustment(req.params.id as string, req.body as CreateAdjustmentInput, actorOf(req));
      res.status(201).json({ success: true, data: { adjustment } });
    } catch (err) {
      next(err);
    }
  }
);

adminRiderPayRouter.get('/rider-adjustments', ...STAFF, validate({ query: listAdjustmentsQuerySchema }), async (req, res, next) => {
  try {
    const adjustments = await listAdjustments(req.query as z.infer<typeof listAdjustmentsQuerySchema>);
    res.json({ success: true, data: { adjustments } });
  } catch (err) {
    next(err);
  }
});

adminRiderPayRouter.patch(
  '/rider-adjustments/:id',
  ...STAFF,
  validate({ params: adjustmentIdParams, body: updateAdjustmentSchema }),
  async (req, res, next) => {
    try {
      const adjustment = await updateAdjustment(req.params.id as string, req.body as UpdateAdjustmentInput, actorOf(req));
      res.json({ success: true, data: { adjustment } });
    } catch (err) {
      next(err);
    }
  }
);

adminRiderPayRouter.delete('/rider-adjustments/:id', ...STAFF, validate({ params: adjustmentIdParams }), async (req, res, next) => {
  try {
    res.json({ success: true, data: await deleteAdjustment(req.params.id as string, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});
