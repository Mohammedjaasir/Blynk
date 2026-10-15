import { formatLkr } from '@/blynk/lib/money';
import type { CheckoutInfo, CouponPreview } from '@/blynk/orders/types';
import { pointsFor } from '@/blynk/store/pointsPromo';
import { checkoutWalletOf, walletPreview } from '@/blynk/wallet/models';

/*
 * Birthday gift, referral reward and Blynk Points at checkout (owner, 2026-10-09/10; the
 * Flutter shop's rewards_estimates.dart, points_model.dart, referral_model.dart,
 * birthday_offer_model.dart and cart_rewards_lines.dart).
 *
 * One discount only: a coupon, the birthday gift and a referral reward never stack. The server
 * uses the larger single one (a tie keeps the coupon; the reward only when strictly larger).
 * A coupon preview carries the server's own choice; without one, the larger of the gift and
 * the reward is assumed. Points come on top ("Use points"), capped by the programme, then the
 * Blynk Wallet ("Use wallet balance", docs/api/wallet.md): a payment, not a discount, on what is
 * still due including the delivery fee. All of it is an estimate: the server prices the order
 * when it is placed.
 */

const round2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};

export interface Birthday { eligible: boolean; percent: number }
export interface Referral { available: boolean; mode: 'LKR_OFF' | 'FREE_DELIVERY' | null; amount: number }
export interface PointsProgram {
  enabled: boolean;
  balance: number;
  valueLkr: number;
  earnPoints: number;
  earnPerLkr: number;
  lkrPerPoint: number;
  minRedeemPoints: number;
  maxRedeemPercent: number;
}

/** The gift as the app can word it: a percentage outside 0-100 is never shown. */
export function birthdayOf(q: CheckoutInfo | null): Birthday | null {
  const b = q?.birthday_offer;
  if (!b || typeof b.eligible !== 'boolean') return null;
  const percent = num(b.percent);
  const ok = percent > 0 && percent < 100;
  return { eligible: b.eligible && ok, percent: ok ? percent : 0 };
}

export function referralOf(q: CheckoutInfo | null): Referral | null {
  const r = q?.referral_reward;
  if (!r) return null;
  const mode = r.mode === 'LKR_OFF' || r.mode === 'FREE_DELIVERY' ? r.mode : null;
  const amount = num(r.amount_lkr);
  return { available: r.available === true && (mode === 'FREE_DELIVERY' || (mode === 'LKR_OFF' && amount > 0)), mode, amount };
}

export function pointsOf(q: CheckoutInfo | null): PointsProgram | null {
  const p = q?.points;
  if (!p || typeof p.enabled !== 'boolean') return null;
  return {
    enabled: p.enabled,
    balance: Math.max(0, Math.floor(num(p.balance))),
    valueLkr: num(p.value_lkr),
    earnPoints: Math.floor(num(p.earn_points)),
    earnPerLkr: num(p.earn_per_lkr),
    lkrPerPoint: num(p.lkr_per_point),
    minRedeemPoints: Math.floor(num(p.min_redeem_points)),
    maxRedeemPercent: num(p.max_redeem_percent),
  };
}

const pct = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')}%`;

export const birthdayBanner = (b: Birthday) => `Happy birthday! ${pct(b.percent)} off one order this week`;
export const BIRTHDAY_SUB = 'Taken off at checkout, no code needed.';

export const referralLine = (r: Referral) => (r.mode === 'FREE_DELIVERY'
  ? 'Referral reward: free delivery on this order'
  : `Referral reward: ${formatLkr(r.amount)} off this order`);
export const REFERRAL_SUB = "Applied automatically when it's your biggest saving. It doesn't add to a coupon or birthday gift.";

/** The gift on an item subtotal, to the cent. */
export const birthdayEstimate = (b: Birthday | null, subtotal: number) =>
  (!b || !b.eligible || subtotal <= 0 ? 0 : Math.round(subtotal * b.percent) / 100);

export function referralEstimate(r: Referral | null, subtotal: number, deliveryFee: number): number {
  if (!r || !r.available) return 0;
  if (r.mode === 'FREE_DELIVERY') return Math.max(0, deliveryFee);
  return Math.min(r.amount, Math.max(0, subtotal));
}

export type DiscountKind = 'COUPON' | 'BIRTHDAY' | 'REFERRAL' | null;

export interface DiscountEstimate {
  kind: DiscountKind;
  amount: number;
  /** The part taken off the items (a free delivery is not), for the points to earn. */
  onItems: number;
}

/** The one discount this order would get. */
export function estimateDiscount(args: {
  subtotal: number; deliveryFee: number; coupon?: CouponPreview | null; birthday: Birthday | null; referral: Referral | null;
}): DiscountEstimate {
  const { subtotal, deliveryFee, coupon, birthday, referral } = args;
  const referralIsDelivery = referral?.mode === 'FREE_DELIVERY';
  if (coupon) {
    if (coupon.applied_discount === 'BIRTHDAY') return { kind: 'BIRTHDAY', amount: coupon.birthday_discount_amount, onItems: coupon.birthday_discount_amount };
    if (coupon.applied_discount === 'REFERRAL') {
      const r = coupon.referral_discount_amount;
      return { kind: 'REFERRAL', amount: r, onItems: referralIsDelivery ? 0 : r };
    }
    const freeDelivery = coupon.discount_type === 'FREE_DELIVERY';
    return { kind: 'COUPON', amount: coupon.discount_amount, onItems: freeDelivery ? 0 : coupon.discount_amount };
  }
  const gift = birthdayEstimate(birthday, subtotal);
  const reward = referralEstimate(referral, subtotal, deliveryFee);
  if (reward > 0 && reward > gift) return { kind: 'REFERRAL', amount: reward, onItems: referralIsDelivery ? 0 : reward };
  if (gift > 0) return { kind: 'BIRTHDAY', amount: gift, onItems: gift };
  return { kind: null, amount: 0, onItems: 0 };
}

export const canRedeem = (p: PointsProgram | null) => !!p && p.enabled && p.balance > 0 && p.balance >= p.minRedeemPoints;

/** Points "Use points" would take off an order of `due` (subtotal + fee - discount), and their value. */
export function pointsRedeem(p: PointsProgram | null, due: number): { points: number; value: number } {
  if (!p || !canRedeem(p) || p.lkrPerPoint <= 0 || due <= 0) return { points: 0, value: 0 };
  const cap = Math.floor((due * p.maxRedeemPercent / 100) / p.lkrPerPoint);
  const usable = Math.max(0, Math.min(p.balance, cap));
  return { points: usable, value: Math.round(usable * p.lkrPerPoint * 100) / 100 };
}

/**
 * Points an order with this much of items (after the discount, before points) earns once
 * delivered: the server's rule (pointsPromo.ts pointsFor = backend pointsEarned).
 */
export function earnEstimate(p: PointsProgram | null, itemsAfterDiscount: number): number {
  if (!p || !p.enabled) return 0;
  return pointsFor({ earnPoints: p.earnPoints, earnPerLkr: p.earnPerLkr }, itemsAfterDiscount);
}
export const balanceLine = (p: PointsProgram) => `You have ${p.balance} ${p.balance === 1 ? 'point' : 'points'} = ${formatLkr(p.valueLkr)}`;
export const redeemLine = (r: { points: number; value: number }) => (r.points > 0
  ? `About ${r.points} points (${formatLkr(r.value)}) off this order. The final amount is confirmed when you place it.`
  : "Points can't be used on this order.");

export interface RewardsSummary {
  discount: DiscountEstimate;
  points: { points: number; value: number };
  earn: number;
  /** What the Blynk Wallet pays (when on): after the discount and points, capped by max_use_percent and the balance. */
  wallet: number;
  /** What is due before the wallet (subtotal + fee - discount - points). */
  dueBeforeWallet: number;
  /** Estimated amount still to pay after the one discount, the points and the wallet (when on). */
  toPay: number;
}

/** Everything the bill and the rewards card show, from the cart's subtotal and the charged fee. */
export function rewardsSummary(args: {
  subtotal: number; deliveryFee: number; quote: CheckoutInfo | null; coupon?: CouponPreview | null; usePoints: boolean;
  useWallet?: boolean;
}): RewardsSummary {
  const { subtotal, deliveryFee, quote, coupon, usePoints, useWallet = false } = args;
  const discount = estimateDiscount({ subtotal, deliveryFee, coupon, birthday: birthdayOf(quote), referral: referralOf(quote) });
  const due = round2(Math.max(0, subtotal + deliveryFee - discount.amount));
  const points = usePoints ? pointsRedeem(pointsOf(quote), due) : { points: 0, value: 0 };
  const dueBeforeWallet = round2(Math.max(0, due - points.value));
  const wallet = useWallet ? walletPreview(checkoutWalletOf(quote?.wallet), dueBeforeWallet) : 0;
  return {
    discount,
    points,
    // the part paid with points never earns (backend earnBase); wallet money earns like cash
    earn: earnEstimate(pointsOf(quote), subtotal - discount.onItems - points.value),
    wallet,
    dueBeforeWallet,
    toPay: round2(Math.max(0, dueBeforeWallet - wallet)),
  };
}
