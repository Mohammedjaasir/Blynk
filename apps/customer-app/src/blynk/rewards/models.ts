import { formatLkr } from '@/blynk/lib/money';

/*
 * Refer a friend, Blynk Points and the birthday gift (owner, 2026-10-09/10), parsed the way the
 * Flutter shop does it (Models/referral_model.dart, points_model.dart, birthday_offer_model.dart).
 * The server decides every reward; the app only words what GET /me/referral, GET /me/points and
 * GET /me (birthday_offer) say.
 */

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const x = Number(v.trim()); return Number.isFinite(x) ? x : 0; }
  return 0;
};
const int = (v: unknown) => Math.trunc(num(v));
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const trimmed = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

// ---------------------------------------------------------------- referral

export type ReferralRewardMode = 'LKR_OFF' | 'FREE_DELIVERY';
const mode = (v: unknown): ReferralRewardMode | null => {
  const s = String(v ?? '').toUpperCase();
  return s === 'LKR_OFF' || s === 'FREE_DELIVERY' ? s : null;
};

export type ReferralReward = { mode: ReferralRewardMode; friendAmountLkr: number; inviterAmountLkr: number };
export type ReferralCredit = { mode: ReferralRewardMode; amountLkr: number };
export type ReferredBy = { firstName: string | null; status: string };
export type ReferralInfo = {
  /** The store switch (Ops / Admin). Off: nothing about referrals shows. */
  enabled: boolean;
  /** This customer's own code ('' when the server sent none). */
  code: string;
  reward: ReferralReward | null;
  invitedCount: number;
  rewardedCount: number;
  credits: ReferralCredit[];
  referredBy: ReferredBy | null;
  /** The customer may still enter a friend's code (new customer, none yet). */
  canApplyCode: boolean;
};

/** GET /me/referral's data, or null when it is not one. */
export function parseReferral(raw: unknown): ReferralInfo | null {
  const r = obj(raw);
  if (!r || typeof r.enabled !== 'boolean') return null;
  const rw = obj(r.reward);
  const rwMode = rw ? mode(rw.mode) : null;
  const by = obj(r.referred_by);
  return {
    enabled: r.enabled,
    code: String(r.code ?? '').trim(),
    reward: rw && rwMode ? { mode: rwMode, friendAmountLkr: num(rw.friend_amount_lkr), inviterAmountLkr: num(rw.inviter_amount_lkr) } : null,
    invitedCount: int(r.invited_count),
    rewardedCount: int(r.rewarded_count),
    credits: (Array.isArray(r.credits) ? r.credits : []).flatMap((c) => {
      const o = obj(c);
      const m = o ? mode(o.mode) : null;
      return o && m ? [{ mode: m, amountLkr: num(o.amount_lkr) }] : [];
    }),
    referredBy: by ? { firstName: trimmed(by.first_name), status: String(by.status ?? '').toUpperCase() } : null,
    canApplyCode: r.can_apply_code === true,
  };
}

/** The one sentence the Refer screen shows. */
export function rewardDescription(r: ReferralReward): string {
  return r.mode === 'LKR_OFF'
    ? `Your friend gets ${formatLkr(r.friendAmountLkr)} off their first order. You get ${formatLkr(r.inviterAmountLkr)} off your next order after their first order is delivered.`
    : "Your friend gets a free delivery on their first order; you get a free delivery after it's delivered.";
}

export const creditLabel = (c: ReferralCredit) => (c.mode === 'FREE_DELIVERY' ? 'A free delivery' : `${formatLkr(c.amountLkr)} off`);

export const referredByText = (by: ReferredBy) =>
  by.firstName ? `${by.firstName} invited you to Blynk.` : 'A friend invited you to Blynk.';

/** "Referral code applied. Nimal invited you, and your first order gets the reward." */
export const referralAppliedText = (inviterFirstName: string | null) =>
  inviterFirstName
    ? `Referral code applied. ${inviterFirstName} invited you, and your first order gets the reward.`
    : 'Referral code applied. Your first order gets the reward.';

export const REFERRAL_NOT_A_CODE = "That doesn't look like a referral code. Check it and try again.";

// ---------------------------------------------------------------- points

export type PointsProgram = {
  earnPoints: number; earnPerLkr: number; lkrPerPoint: number;
  minRedeemPoints: number; maxRedeemPercent: number; expiryMonths: number;
};
export type PointsEntryKind = 'EARN' | 'REDEEM' | 'REFUND' | 'EXPIRE' | 'ADJUST';
export type PointsEntry = {
  id: string; kind: PointsEntryKind; points: number; orderNumber: string | null;
  expiresAt: Date | null; createdAt: Date | null;
};
export type PointsInfo = { enabled: boolean; balance: number; valueLkr: number; program: PointsProgram | null; history: PointsEntry[] };

const KINDS = new Set<PointsEntryKind>(['EARN', 'REDEEM', 'REFUND', 'EXPIRE', 'ADJUST']);
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function program(r: Record<string, unknown>): PointsProgram {
  return {
    earnPoints: int(r.earn_points), earnPerLkr: num(r.earn_per_lkr), lkrPerPoint: num(r.lkr_per_point),
    minRedeemPoints: int(r.min_redeem_points), maxRedeemPercent: num(r.max_redeem_percent), expiryMonths: int(r.expiry_months),
  };
}

/** GET /me/points's data, or null when it is not one. */
export function parsePoints(raw: unknown): PointsInfo | null {
  const r = obj(raw);
  if (!r || typeof r.enabled !== 'boolean') return null;
  const p = obj(r.program);
  return {
    enabled: r.enabled,
    balance: int(r.balance),
    valueLkr: num(r.value_lkr),
    program: p ? program(p) : null,
    history: (Array.isArray(r.history) ? r.history : []).flatMap((e) => {
      const o = obj(e);
      const kind = String(o?.kind ?? '').toUpperCase() as PointsEntryKind;
      if (!o || !KINDS.has(kind)) return [];
      return [{
        id: String(o.id ?? ''), kind, points: int(o.points), orderNumber: trimmed(o.order_number),
        expiresAt: date(o.expires_at), createdAt: date(o.created_at),
      }];
    }),
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const percent = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')}%`;

/** "How it works", from the numbers. */
export function howItWorks(p: PointsProgram): string[] {
  const out: string[] = [];
  if (p.earnPoints > 0 && p.earnPerLkr > 0) {
    out.push(`Earn ${p.earnPoints} ${plural(p.earnPoints, 'point', 'points')} for every ${formatLkr(p.earnPerLkr)} you spend on items, once your order is delivered.`);
  }
  if (p.lkrPerPoint > 0) out.push(`Each point is worth ${formatLkr(p.lkrPerPoint)} at checkout.`);
  if (p.minRedeemPoints > 0) out.push(`Use points once you have ${p.minRedeemPoints} or more.`);
  if (p.maxRedeemPercent > 0) out.push(`Points can pay up to ${percent(p.maxRedeemPercent)} of an order.`);
  if (p.expiryMonths > 0) out.push(`Points expire ${p.expiryMonths} ${plural(p.expiryMonths, 'month', 'months')} after you earn them.`);
  return out;
}

/** "Earned on order BL-1001", "Used on order BL-1002", ... */
export function entryLabel(e: Pick<PointsEntry, 'kind' | 'orderNumber'>): string {
  switch (e.kind) {
    case 'EARN': return e.orderNumber ? `Earned on order ${e.orderNumber}` : 'Earned';
    case 'REDEEM': return e.orderNumber ? `Used on order ${e.orderNumber}` : 'Used on an order';
    case 'REFUND': return 'Returned (order cancelled)';
    case 'EXPIRE': return 'Expired';
    case 'ADJUST': return 'Adjusted by Blynk';
  }
}

/** "+40" / "-120". */
export const entryPoints = (points: number) => (points > 0 ? `+${points}` : `${points}`);

/** "120 Blynk Points = LKR 120" ("1 Blynk Point = ..."). */
export const pointsBalanceText = (balance: number, valueLkr: number) =>
  `${balance} Blynk ${plural(balance, 'Point', 'Points')} = ${formatLkr(valueLkr)}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "14 March 2027". */
export const formatPointsDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// ---------------------------------------------------------------- birthday gift

export type BirthdayOffer = { enabled: boolean; percent: number; eligible: boolean };

/** The `birthday_offer` block on GET /me; null for anything that is not a well-formed offer. */
export function parseBirthdayOffer(raw: unknown): BirthdayOffer | null {
  const r = obj(raw);
  if (!r || typeof r.enabled !== 'boolean' || typeof r.eligible !== 'boolean') return null;
  const p = typeof r.percent === 'number' ? r.percent : typeof r.percent === 'string' ? Number(r.percent.trim()) : NaN;
  if (!Number.isFinite(p)) return null;
  const ok = p > 0 && p < 100;
  // A percentage the app cannot word is never shown as a gift.
  return { enabled: r.enabled, percent: ok ? p : 0, eligible: r.eligible && ok };
}

/** "Happy birthday! 10% off one order this week". */
export const birthdayBannerText = (o: BirthdayOffer) => `Happy birthday! ${percent(o.percent)} off one order this week`;
