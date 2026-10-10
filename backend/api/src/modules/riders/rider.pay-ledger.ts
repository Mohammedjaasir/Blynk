import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { RiderBonusKind } from '../../database/types.js';
import { rangeBounds, STORE_ZONE, type DateRange } from '../reports/sales.service.js';

/*
 * The rider pay ledger (migration 038; owner, 2026-10-10): what each rider
 * earned and what their cash should be, per Asia/Colombo day, shared by the
 * earnings report, the rider's own earnings and the cash reconciliation so
 * the three can never disagree.
 *
 * Per rider per day:
 *   collected     = sum of cod_collected_amount (deliveries settled that day)
 *   kept_share    = sum of min(rider_earning_lkr, cod) - each delivery's own
 *                   earning (base + per-delivery bonuses), never more than
 *                   that door's cash (migration 032's rule, unchanged)
 *   day_bonuses   = DAILY_TARGET lines of that day
 *   adjustments   = staff +/- entries dated that day (signed)
 *   raw           = collected - kept_share - day_bonuses - adjustments
 *   to hand in    = max(0, raw)
 *   payable       = max(0, -raw)  - Blynk owes the rider (paid separately)
 *
 * So a daily-target bonus or an extra-pay adjustment is kept out of that
 * day's cash like a commission share; a deduction is added to what the rider
 * hands in that day; anything the day's cash cannot cover is owed to the
 * rider. Days are summed for a range.
 */

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

export const BONUS_KINDS: RiderBonusKind[] = ['PEAK_BOOST', 'RAIN_BOOST', 'LONG_DISTANCE', 'DAILY_TARGET'];
export type BonusBreakdown = Record<RiderBonusKind, number>;
const emptyBreakdown = (): BonusBreakdown => ({ PEAK_BOOST: 0, RAIN_BOOST: 0, LONG_DISTANCE: 0, DAILY_TARGET: 0 });

export interface LedgerTotals {
  deliveries: number;
  /** Standard delivery fees of the delivered orders. */
  delivery_charges: number;
  /** What customers actually paid as delivery fees (0 on a free delivery). */
  customer_delivery_fees: number;
  /** What the deliveries earned: base + per-delivery bonuses (sum of rider_earning_lkr). */
  rider_share: number;
  /** delivery_charges - rider_share. */
  blynk_delivery_share: number;
  base_earnings: number;
  delivery_bonuses: number;
  day_bonuses: number;
  additions: number;
  /** Negative adjustments, as a positive number. */
  deductions: number;
  /** additions - deductions. */
  adjustments: number;
  /** rider_share + day_bonuses + adjustments. */
  total_earnings: number;
  bonus_breakdown: BonusBreakdown;
  cash_collected: number;
  /** Per-delivery kept share: sum of min(earning, cod). */
  cash_kept: number;
  /** Sum over days of max(0, raw). */
  cash_to_hand_in: number;
  /** Sum over days of max(0, -raw). */
  payable_to_rider: number;
  coupon_discount: number;
}

export function emptyTotals(): LedgerTotals {
  return {
    deliveries: 0,
    delivery_charges: 0,
    customer_delivery_fees: 0,
    rider_share: 0,
    blynk_delivery_share: 0,
    base_earnings: 0,
    delivery_bonuses: 0,
    day_bonuses: 0,
    additions: 0,
    deductions: 0,
    adjustments: 0,
    total_earnings: 0,
    bonus_breakdown: emptyBreakdown(),
    cash_collected: 0,
    cash_kept: 0,
    cash_to_hand_in: 0,
    payable_to_rider: 0,
    coupon_discount: 0,
  };
}

/** The day rule for one rider-day. */
export function dayCash(input: { collected: number; kept: number; day_bonuses: number; adjustments: number }) {
  const raw = money(input.collected - input.kept - input.day_bonuses - input.adjustments);
  return { expected_handin: Math.max(0, raw), payable_to_rider: Math.max(0, money(-raw)) };
}

interface DayParts {
  deliveries: number;
  delivery_charges: number;
  customer_delivery_fees: number;
  rider_share: number;
  base: number;
  delivery_bonus: number;
  collected: number;
  kept: number;
  coupon_discount: number;
  day_bonus: number;
  additions: number;
  deductions: number;
}
const emptyDay = (): DayParts => ({
  deliveries: 0,
  delivery_charges: 0,
  customer_delivery_fees: 0,
  rider_share: 0,
  base: 0,
  delivery_bonus: 0,
  collected: 0,
  kept: 0,
  coupon_discount: 0,
  day_bonus: 0,
  additions: 0,
  deductions: 0,
});

/** Per rider: the range's totals. Riders with no delivery, bonus or adjustment in the range are absent. */
export async function riderLedger(range: DateRange, riderId?: string): Promise<Map<string, LedgerTotals>> {
  const { start, end } = rangeBounds(range);
  const dayExpr = sql<string>`((d.delivered_at AT TIME ZONE ${sql.lit(STORE_ZONE)})::date)::text`;
  let deliveriesQ = db
    .selectFrom('deliveries as d')
    .innerJoin('orders as o', 'o.id', 'd.order_id')
    .select([
      'd.rider_id',
      dayExpr.as('day'),
      sql<number>`count(*)::int`.as('deliveries'),
      sql<string>`coalesce(sum(coalesce(o.standard_delivery_fee, o.delivery_fee)), 0)`.as('delivery_charges'),
      sql<string>`coalesce(sum(o.delivery_fee), 0)`.as('customer_delivery_fees'),
      sql<string>`coalesce(sum(coalesce(d.rider_earning_lkr, 0)), 0)`.as('rider_share'),
      sql<string>`coalesce(sum(coalesce(d.rider_base_earning_lkr, d.rider_earning_lkr, 0)), 0)`.as('base'),
      sql<string>`coalesce(sum(coalesce(d.rider_bonus_lkr, 0)), 0)`.as('delivery_bonus'),
      sql<string>`coalesce(sum(d.cod_collected_amount), 0)`.as('collected'),
      sql<string>`coalesce(sum(least(coalesce(d.rider_earning_lkr, 0), d.cod_collected_amount)), 0)`.as('kept'),
      sql<string>`coalesce(sum(o.discount_amount), 0)`.as('coupon_discount'),
    ])
    .where('d.assignment_status', '=', 'DELIVERED')
    .where('d.delivered_at', '>=', start)
    .where('d.delivered_at', '<', end);
  if (riderId) deliveriesQ = deliveriesQ.where('d.rider_id', '=', riderId);

  let linesQ = db
    .selectFrom('rider_earning_lines')
    .select([
      'rider_id',
      sql<string>`earning_date::text`.as('day'),
      'kind',
      sql<string>`sum(amount_lkr)`.as('amount'),
    ])
    .where(sql`earning_date`, '>=', range.from)
    .where(sql`earning_date`, '<=', range.to);
  if (riderId) linesQ = linesQ.where('rider_id', '=', riderId);

  let adjQ = db
    .selectFrom('rider_pay_adjustments')
    .select([
      'rider_id',
      sql<string>`adjustment_date::text`.as('day'),
      sql<string>`coalesce(sum(amount_lkr) filter (where amount_lkr > 0), 0)`.as('additions'),
      sql<string>`coalesce(-sum(amount_lkr) filter (where amount_lkr < 0), 0)`.as('deductions'),
    ])
    .where(sql`adjustment_date`, '>=', range.from)
    .where(sql`adjustment_date`, '<=', range.to);
  if (riderId) adjQ = adjQ.where('rider_id', '=', riderId);

  const [deliveryRows, lineRows, adjRows] = await Promise.all([
    deliveriesQ.groupBy(['d.rider_id', dayExpr]).execute(),
    linesQ.groupBy(['rider_id', sql`earning_date`, 'kind']).execute(),
    adjQ.groupBy(['rider_id', sql`adjustment_date`]).execute(),
  ]);

  const days = new Map<string, Map<string, DayParts>>();
  const breakdowns = new Map<string, BonusBreakdown>();
  const dayOf = (rider: string, day: string) => {
    let m = days.get(rider);
    if (!m) days.set(rider, (m = new Map()));
    let p = m.get(day);
    if (!p) m.set(day, (p = emptyDay()));
    return p;
  };
  for (const r of deliveryRows) {
    const p = dayOf(r.rider_id, r.day);
    p.deliveries += r.deliveries;
    p.delivery_charges += Number(r.delivery_charges);
    p.customer_delivery_fees += Number(r.customer_delivery_fees);
    p.rider_share += Number(r.rider_share);
    p.base += Number(r.base);
    p.delivery_bonus += Number(r.delivery_bonus);
    p.collected += Number(r.collected);
    p.kept += Number(r.kept);
    p.coupon_discount += Number(r.coupon_discount);
  }
  for (const r of lineRows) {
    const b = breakdowns.get(r.rider_id) ?? emptyBreakdown();
    b[r.kind] = money(b[r.kind] + Number(r.amount));
    breakdowns.set(r.rider_id, b);
    if (r.kind === 'DAILY_TARGET') dayOf(r.rider_id, r.day).day_bonus += Number(r.amount);
    else dayOf(r.rider_id, r.day); // the day exists even if only through a bonus
  }
  for (const r of adjRows) {
    const p = dayOf(r.rider_id, r.day);
    p.additions += Number(r.additions);
    p.deductions += Number(r.deductions);
  }

  const out = new Map<string, LedgerTotals>();
  for (const [rider, perDay] of days) {
    const t = emptyTotals();
    for (const p of perDay.values()) {
      t.deliveries += p.deliveries;
      t.delivery_charges += p.delivery_charges;
      t.customer_delivery_fees += p.customer_delivery_fees;
      t.rider_share += p.rider_share;
      t.base_earnings += p.base;
      t.delivery_bonuses += p.delivery_bonus;
      t.day_bonuses += p.day_bonus;
      t.additions += p.additions;
      t.deductions += p.deductions;
      t.cash_collected += p.collected;
      t.cash_kept += p.kept;
      t.coupon_discount += p.coupon_discount;
      const cash = dayCash({ collected: p.collected, kept: p.kept, day_bonuses: p.day_bonus, adjustments: p.additions - p.deductions });
      t.cash_to_hand_in += cash.expected_handin;
      t.payable_to_rider += cash.payable_to_rider;
    }
    for (const k of Object.keys(t) as (keyof LedgerTotals)[]) {
      if (typeof t[k] === 'number' && k !== 'deliveries') (t as unknown as Record<string, number>)[k] = money(t[k]);
    }
    t.adjustments = money(t.additions - t.deductions);
    t.blynk_delivery_share = money(t.delivery_charges - t.rider_share);
    t.total_earnings = money(t.rider_share + t.day_bonuses + t.adjustments);
    t.bonus_breakdown = breakdowns.get(rider) ?? emptyBreakdown();
    out.set(rider, t);
  }
  return out;
}

/** Sum of several riders' totals (report totals). */
export function sumTotals(rows: LedgerTotals[]): LedgerTotals {
  const t = emptyTotals();
  for (const r of rows) {
    for (const k of Object.keys(t) as (keyof LedgerTotals)[]) {
      if (k === 'bonus_breakdown') {
        for (const b of BONUS_KINDS) t.bonus_breakdown[b] = money(t.bonus_breakdown[b] + r.bonus_breakdown[b]);
      } else {
        (t as unknown as Record<string, number>)[k] = k === 'deliveries' ? t.deliveries + r.deliveries : money(Number(t[k]) + Number(r[k]));
      }
    }
  }
  return t;
}
