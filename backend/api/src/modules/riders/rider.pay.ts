import { Router, type Request } from 'express';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { RiderPayType } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { logger } from '../../utils/logger.js';
import { publicPhone } from '../../utils/phone.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import {
  commissionPercentSchema,
  DEFAULT_RIDER_COMMISSION_PERCENT,
  RIDER_COMMISSION_KEY,
} from '../configuration/settings.service.js';
import type { DBConnection } from '../orders/order.repository.js';
import type { DeliveryRow, OrderRow } from '../orders/lifecycle/types.js';
import { rangeBounds, STORE_ZONE } from '../reports/sales.service.js';

/*
 * Rider pay (migration 032; owner, 2026-10-09). Like Uber/PickMe an approved
 * rider is either
 *  - COMPANY: salaried, earns nothing per delivery; Blynk keeps the whole
 *    delivery charge, or
 *  - COMMISSION: earns `percent` of the order's STANDARD delivery fee
 *    (orders.standard_delivery_fee - the normal fee even when the customer
 *    had a free delivery; Blynk pays the share then). `percent` is the
 *    rider's own riders.commission_percent, else the store default
 *    (system_configurations 'rider_commission', 80 when unset).
 * Blynk always keeps the product margin.
 *
 * When a delivery is settled (lifecycle settleCod) the pay type, the share
 * and the earning are written onto the delivery row, so later changes to the
 * rider or the default never rewrite what a past delivery earned.
 *
 * Cash (owner, 2026-10-09): a commission rider keeps their earned share out
 * of the COD cash they collected and hands in the rest. For one delivery the
 * kept share is min(earning, cash collected) - a rider never keeps more than
 * they took at that door. See cash/index.ts reconciliation.
 */

export const RIDER_PAY_TYPES = ['COMPANY', 'COMMISSION'] as const;

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** What one delivery earns: a share of the standard fee for COMMISSION, 0 for COMPANY. */
export function riderEarning(payType: RiderPayType, percent: number, standardFee: number): number {
  if (payType !== 'COMMISSION') return 0;
  return Math.round(standardFee * percent) / 100;
}

/** The store default share, read with the caller's executor (inside the settlement transaction). */
export async function defaultCommissionPercent(executor: DBConnection = db): Promise<number> {
  const row = await executor
    .selectFrom('system_configurations')
    .select('value')
    .where('key', '=', RIDER_COMMISSION_KEY)
    .executeTakeFirst();
  const p = row?.value && typeof row.value === 'object' ? (row.value as { default_percent?: unknown }).default_percent : undefined;
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100 ? p : DEFAULT_RIDER_COMMISSION_PERCENT;
}

/**
 * The snapshot settleCod writes onto the delivery: the rider's pay type now,
 * the share applied (null for COMPANY) and the earning on the order's
 * standard fee (falling back to delivery_fee for a row written outside order
 * creation).
 */
export async function riderPaySnapshot(
  executor: DBConnection,
  delivery: Pick<DeliveryRow, 'rider_id'>,
  order: Pick<OrderRow, 'standard_delivery_fee' | 'delivery_fee'>
): Promise<{ rider_pay_type: RiderPayType; rider_commission_percent: number | null; rider_earning_lkr: number }> {
  const rider = await executor
    .selectFrom('riders')
    .select(['pay_type', 'commission_percent'])
    .where('id', '=', delivery.rider_id)
    .executeTakeFirst();
  const payType: RiderPayType = rider?.pay_type === 'COMMISSION' ? 'COMMISSION' : 'COMPANY';
  if (payType === 'COMPANY') return { rider_pay_type: 'COMPANY', rider_commission_percent: null, rider_earning_lkr: 0 };
  const percent = numOrNull(rider!.commission_percent) ?? (await defaultCommissionPercent(executor));
  const fee = Number(order.standard_delivery_fee ?? order.delivery_fee ?? 0);
  return { rider_pay_type: 'COMMISSION', rider_commission_percent: percent, rider_earning_lkr: riderEarning('COMMISSION', percent, fee) };
}

// ----------------------------------------------------------------------------
// Setting a rider's pay (Ops/Admin)
// ----------------------------------------------------------------------------

/**
 * A rider's pay type and own share. commission_percent: a number overrides
 * the default for this rider, null (or omitted) uses the default. A COMPANY
 * rider never keeps a percentage (stored null).
 */
export const riderPaySchema = z
  .object({
    pay_type: z.enum(RIDER_PAY_TYPES, { errorMap: () => ({ message: 'pay_type must be COMPANY or COMMISSION' }) }),
    commission_percent: commissionPercentSchema.nullable().optional(),
  })
  .strict();
export type RiderPayInput = z.infer<typeof riderPaySchema>;

/** The approve body: both optional; without pay_type the rider stays COMPANY (the column default). */
export const approvePaySchema = z
  .object({
    pay_type: z.enum(RIDER_PAY_TYPES, { errorMap: () => ({ message: 'pay_type must be COMPANY or COMMISSION' }) }).optional(),
    commission_percent: commissionPercentSchema.nullable().optional(),
  })
  .strict()
  .default({});
export type ApprovePayInput = z.infer<typeof approvePaySchema>;

export function payValues(input: RiderPayInput) {
  return {
    pay_type: input.pay_type,
    commission_percent: input.pay_type === 'COMMISSION' ? (input.commission_percent ?? null) : null,
  };
}

export interface RiderPay {
  rider_id: string;
  pay_type: RiderPayType;
  /** The rider's own share; null = the default. */
  commission_percent: number | null;
  /** What a COMMISSION rider earns now (own share or default); null for COMPANY. */
  effective_percent: number | null;
  default_percent: number;
}

export async function getRiderPay(riderId: string, executor: DBConnection = db): Promise<RiderPay> {
  const rider = await executor
    .selectFrom('riders')
    .select(['id', 'pay_type', 'commission_percent'])
    .where('id', '=', riderId)
    .where('approval_status', '=', 'APPROVED')
    .executeTakeFirst();
  if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
  const def = await defaultCommissionPercent(executor);
  const own = numOrNull(rider.commission_percent);
  return {
    rider_id: rider.id,
    pay_type: rider.pay_type,
    commission_percent: own,
    effective_percent: rider.pay_type === 'COMMISSION' ? (own ?? def) : null,
    default_percent: def,
  };
}

/** Audited (RIDER_PAY_UPDATED). Deliveries already settled keep their snapshot. */
export async function setRiderPay(riderId: string, input: RiderPayInput, actor: AuditActor): Promise<RiderPay> {
  return await db.transaction().execute(async (trx) => {
    const before = await trx
      .selectFrom('riders')
      .select(['id', 'pay_type', 'commission_percent'])
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
      oldValues: { pay_type: before.pay_type, commission_percent: numOrNull(before.commission_percent) },
      newValues: values,
    });
    logger.info({ riderId, ...values, by: actor.actorId }, 'Rider pay changed');
    return await getRiderPay(riderId, trx);
  });
}

// ----------------------------------------------------------------------------
// Earnings
// ----------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Invalid date');

/** Monday of this week, Asia/Colombo (ISO weeks, as the Rider app's "My day"). */
function colomboToday() {
  return DateTime.now().setZone(STORE_ZONE).startOf('day');
}

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

interface DeliveryTotals {
  deliveries: number;
  /** Standard delivery fees of the delivered orders (the basis of a share). */
  delivery_charges: number;
  /** What customers actually paid as delivery fees (0 on a free delivery). */
  customer_delivery_fees: number;
  rider_share: number;
  /** delivery_charges - rider_share. */
  blynk_delivery_share: number;
  cash_collected: number;
  /** Cash the rider keeps (their share, never more than that door's cash). */
  cash_kept: number;
  /** cash_collected - cash_kept. */
  cash_to_hand_in: number;
}

/** Delivered (settled) deliveries in [start, end), grouped by rider. */
async function deliveryTotals(start: Date, end: Date, riderId?: string) {
  let q = db
    .selectFrom('deliveries as d')
    .innerJoin('orders as o', 'o.id', 'd.order_id')
    .select([
      'd.rider_id',
      sql<number>`count(*)::int`.as('deliveries'),
      sql<string>`coalesce(sum(coalesce(o.standard_delivery_fee, o.delivery_fee)), 0)`.as('delivery_charges'),
      sql<string>`coalesce(sum(o.delivery_fee), 0)`.as('customer_delivery_fees'),
      sql<string>`coalesce(sum(coalesce(d.rider_earning_lkr, 0)), 0)`.as('rider_share'),
      sql<string>`coalesce(sum(d.cod_collected_amount), 0)`.as('cash_collected'),
      sql<string>`coalesce(sum(least(coalesce(d.rider_earning_lkr, 0), d.cod_collected_amount)), 0)`.as('cash_kept'),
      sql<string>`coalesce(sum(o.discount_amount), 0)`.as('coupon_discount'),
    ])
    .where('d.assignment_status', '=', 'DELIVERED')
    .where('d.delivered_at', '>=', start)
    .where('d.delivered_at', '<', end);
  if (riderId) q = q.where('d.rider_id', '=', riderId);
  return await q.groupBy('d.rider_id').execute();
}

function presentTotals(row: Awaited<ReturnType<typeof deliveryTotals>>[number] | undefined): DeliveryTotals {
  const charges = money(row?.delivery_charges);
  const share = money(row?.rider_share);
  const cash = money(row?.cash_collected);
  const kept = money(row?.cash_kept);
  return {
    deliveries: row?.deliveries ?? 0,
    delivery_charges: charges,
    customer_delivery_fees: money(row?.customer_delivery_fees),
    rider_share: share,
    blynk_delivery_share: money(charges - share),
    cash_collected: cash,
    cash_kept: kept,
    cash_to_hand_in: money(cash - kept),
  };
}

/**
 * The Ops/Admin earnings report: per rider, deliveries settled in the range
 * (by delivered_at, Asia/Colombo days).
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
  const [totals, items] = await Promise.all([
    deliveryTotals(start, end),
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
  ]);
  const ids = totals.map((t) => t.rider_id);
  const [riders, def] = await Promise.all([
    ids.length
      ? db
          .selectFrom('riders as r')
          .innerJoin('users as u', 'u.id', 'r.user_id')
          .select(['r.id', 'u.full_name', 'u.phone', 'r.pay_type', 'r.commission_percent'])
          .where('r.id', 'in', ids)
          .execute()
      : Promise.resolve([]),
    defaultCommissionPercent(),
  ]);

  const rows = totals
    .map((t) => {
      const r = riders.find((x) => x.id === t.rider_id);
      const it = items.find((x) => x.rider_id === t.rider_id);
      const sales = money(it?.product_sales);
      const cost = money(it?.product_cost);
      const own = numOrNull(r?.commission_percent);
      return {
        rider_id: t.rider_id,
        rider_name: r?.full_name ?? null,
        rider_phone: publicPhone(r?.phone),
        pay_type: (r?.pay_type ?? 'COMPANY') as RiderPayType,
        commission_percent: own,
        effective_percent: r?.pay_type === 'COMMISSION' ? (own ?? def) : null,
        ...presentTotals(t),
        product_sales: sales,
        product_cost: cost,
        product_margin: money(sales - cost),
        coupon_discount: money(t.coupon_discount),
      };
    })
    .sort((a, b) => (a.rider_name ?? '').localeCompare(b.rider_name ?? '') || a.rider_id.localeCompare(b.rider_id));

  const sum = (k: keyof (typeof rows)[number]) => money(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0));
  return {
    range: { ...range, timezone: STORE_ZONE },
    default_percent: def,
    riders: rows,
    totals: {
      deliveries: rows.reduce((s, r) => s + r.deliveries, 0),
      delivery_charges: sum('delivery_charges'),
      customer_delivery_fees: sum('customer_delivery_fees'),
      rider_share: sum('rider_share'),
      blynk_delivery_share: sum('blynk_delivery_share'),
      cash_collected: sum('cash_collected'),
      cash_kept: sum('cash_kept'),
      cash_to_hand_in: sum('cash_to_hand_in'),
      product_sales: sum('product_sales'),
      product_cost: sum('product_cost'),
      product_margin: sum('product_margin'),
      coupon_discount: sum('coupon_discount'),
    },
  };
}

/**
 * The calling rider's own earnings (Rider app): today and this week
 * (Monday-Sunday, Asia/Colombo). A COMPANY rider gets the same counts with
 * zero earnings; the app shows them deliveries only.
 */
export async function ownEarnings(riderId: string) {
  const today = colomboToday();
  const weekStart = today.startOf('week');
  const todayRange = { from: today.toISODate()!, to: today.toISODate()! };
  const weekRange = { from: weekStart.toISODate()!, to: today.toISODate()! };
  const t = rangeBounds(todayRange);
  const w = rangeBounds(weekRange);
  const [[dayRow], [weekRow], pay] = await Promise.all([
    deliveryTotals(t.start, t.end, riderId),
    deliveryTotals(w.start, w.end, riderId),
    getRiderPay(riderId),
  ]);
  const pick = (x: DeliveryTotals) => ({
    deliveries: x.deliveries,
    delivery_charges: x.delivery_charges,
    earnings: x.rider_share,
    cash_collected: x.cash_collected,
    cash_to_keep: x.cash_kept,
    cash_to_hand_in: x.cash_to_hand_in,
  });
  return {
    timezone: STORE_ZONE,
    pay_type: pay.pay_type,
    /** The share a COMMISSION rider earns on new deliveries; null for COMPANY. */
    commission_percent: pay.effective_percent,
    today: { date: todayRange.from, ...pick(presentTotals(dayRow)) },
    week: { starts_on: weekRange.from, ...pick(presentTotals(weekRow)) },
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
