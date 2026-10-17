import type { StoreInfo } from '../api/types';
import { formatLkr } from '../lib/money';
import type { FreeClaim } from './freeClaim';

/*
 * Blynk Points instead of free delivery (owner, 2026-10-14: "remove completely free delivery -
 * instead of that, for 100 LKR order 1 Blynk point"). What Home, the aisles, the cart and
 * "Order placed" may say, decided in one place. Pure: no React, no network.
 *
 * - Points: only while GET /store `points_program` is on (Admin / Ops "Blynk Points"), worded
 *   from its live numbers ("1 point for every LKR 100"). Guests and signed-in customers alike.
 * - Free deliveries: only while Admin / Ops have them on and this customer may be told
 *   (freeClaim.ts). When both are on, Home's headline surfaces promote Points.
 * - Neither: neutral, true wording ("No packaging or platform fee", "Fresh groceries").
 *
 * The earn arithmetic is the server's own (backend points.rules.ts pointsEarned + earnBase):
 * items after discounts, never the delivery fee, never the part paid with points, in full
 * steps of earn_per_lkr.
 */

export interface PointsRule {
  earnPoints: number;
  earnPerLkr: number;
  lkrPerPoint: number;
  minRedeemPoints: number;
}

const num = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : NaN;
};

/** The live earn rule from GET /store, or null while the program is off (or the answer is not one). */
export function pointsRuleOf(store: StoreInfo | null | undefined): PointsRule | null {
  const p = store?.points_program;
  if (!p || p.enabled !== true) return null;
  const earnPoints = Math.floor(num(p.earn_points));
  const earnPerLkr = num(p.earn_per_lkr);
  if (!(earnPoints > 0) || !(earnPerLkr > 0)) return null;
  const lkrPerPoint = num(p.lkr_per_point);
  const minRedeemPoints = Math.floor(num(p.min_redeem_points));
  return {
    earnPoints,
    earnPerLkr,
    lkrPerPoint: lkrPerPoint > 0 ? lkrPerPoint : 0,
    minRedeemPoints: minRedeemPoints > 0 ? minRedeemPoints : 0,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Points earned on `base` LKR of items (after discounts, before points): the server's pointsEarned. */
export function pointsFor(rule: Pick<PointsRule, 'earnPoints' | 'earnPerLkr'> | null, base: number): number {
  if (!rule || !(base > 0) || !(rule.earnPerLkr > 0) || !(rule.earnPoints > 0)) return 0;
  return Math.floor(round2(base) / rule.earnPerLkr + 1e-9) * rule.earnPoints;
}

const pts = (n: number) => `${n} Blynk ${n === 1 ? 'Point' : 'Points'}`;

/** Customer-facing words (kept together for the Sinhala / Tamil phase). */
export const POINTS_COPY = {
  /** "1 point for every LKR 100" (also the hero's {points_rule} token). */
  rule: (r: Pick<PointsRule, 'earnPoints' | 'earnPerLkr'>) => `${r.earnPoints} ${r.earnPoints === 1 ? 'point' : 'points'} for every ${formatLkr(r.earnPerLkr)}`,
  /** Hero banner AUTO title: two short words for the jumping-letter layout. */
  heroTitle: ['EARN', 'POINTS'] as [string, string],
  /** Home's yellow band. */
  bandTitle: 'EARN BLYNK POINTS',
  bandLine: (r: Pick<PointsRule, 'earnPoints' | 'earnPerLkr'>) => `${POINTS_COPY.rule(r)} · No packaging or platform fee`,
  /** The bottom fee strip's third item: [coin, label] -> "(1) pt / LKR 100". */
  fee: (r: Pick<PointsRule, 'earnPoints' | 'earnPerLkr'>): [string, string] => [String(r.earnPoints), `pt / ${formatLkr(r.earnPerLkr)}`],
  /** An aisle screen's offer row. */
  aisleTitle: 'EARN BLYNK POINTS',
  /** Cart: signed in / a guest. */
  cartEarn: (n: number) => `You'll earn ${pts(n)} on this order`,
  cartGuest: (n: number) => `Sign in to earn ${pts(n)} on this order`,
  /** Profile / the Points screen for a guest. */
  profileGuest: (r: Pick<PointsRule, 'earnPoints' | 'earnPerLkr'>) => `${POINTS_COPY.rule(r)} · Log in to earn`,
  guestHow: (r: Pick<PointsRule, 'earnPoints' | 'earnPerLkr'>) =>
    `Earn ${POINTS_COPY.rule(r)} you spend on items, once your order is delivered.`,
  /** Order placed: points are added when the order is delivered (backend onOrderDeliveredRewards). */
  placed: (n: number) => `You'll earn ${pts(n)} when it's delivered`,
};

/**
 * Neutral words for when neither points nor free deliveries are on. The band kicker is back
 * (owner, 2026-10-17: "i need that but differeent wordings which is not related to fee" - said
 * right after the fee-negation kicker was removed), with a catchy line that has nothing to do
 * with fees.
 */
export const NEUTRAL_COPY = {
  bandKicker: ['Fresh picks, great prices'] as [string],
  heroTitle: ['FRESH', 'GROCERIES'] as [string, string],
};

/** What Home's headline surfaces (hero AUTO, the yellow band, the fee strip) promote. */
export type HomeMessage =
  | { kind: 'points'; rule: PointsRule }
  | { kind: 'free'; claim: FreeClaim }
  | { kind: 'none' };

export function homeMessage(rule: PointsRule | null, claim: FreeClaim): HomeMessage {
  if (rule) return { kind: 'points', rule };
  if (claim.kind !== 'none' && claim.count > 0) return { kind: 'free', claim };
  return { kind: 'none' };
}

/**
 * The points this cart earns: the checkout estimate once the server's quote is in (it knows the
 * discount and "Use points"), else the items total under GET /store's rule (guests, or before
 * the quote). 0 while points are off.
 */
export function cartEarn(args: { rule: PointsRule | null; itemTotal: number; quoted: { earn: number } | null }): number {
  if (args.quoted) return Math.max(0, Math.floor(args.quoted.earn));
  return pointsFor(args.rule, args.itemTotal);
}

/** The cart's quiet points line, or null (nothing to earn); a guest is asked to sign in for them. */
export function cartPointsLine(args: { signedIn: boolean; earn: number }): string | null {
  const { signedIn, earn } = args;
  if (!(earn > 0)) return null;
  return signedIn ? POINTS_COPY.cartEarn(earn) : POINTS_COPY.cartGuest(earn);
}

/** "Order placed": the server's points_earn_preview for the order, or null. */
export function placedPointsLine(order: { points_earn_preview?: unknown; order_status?: string } | null): string | null {
  const n = Math.floor(num(order?.points_earn_preview));
  if (!(n > 0) || order?.order_status === 'CANCELLED' || order?.order_status === 'DELIVERED') return null;
  return POINTS_COPY.placed(n);
}
