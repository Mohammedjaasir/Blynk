import type { PointsKind, PointsSetting, ReferralMode, ReferralSetting, ReferralStatus } from '../api/referralPoints';

/**
 * Refer a friend and Blynk Points helpers (owner, 2026-10-10). The backend
 * is the real guard; these check input with the same limits and word the
 * screens.
 */

export const MAX_REFERRAL_LKR = 10000;
export const MAX_REFERRAL_CAP = 1000;
export const MIN_REASON = 3;
export const MAX_REASON = 200;
export const MAX_ADJUST = 1000000;

export type Parsed = { value: number } | { error: string };

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A number from `min` to `max` with at most `decimals` decimals (0 = whole). */
export function parseNumber(input: string, label: string, min: number, max: number, decimals = 2): Parsed {
  const s = input.trim().replace(/,/g, '');
  if (s === '') return { error: `Enter ${label}.` };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: `${capital(label)} must be a number.` };
  if (decimals === 0 && s.includes('.')) return { error: `${capital(label)} must be a whole number.` };
  if (decimals > 0 && !new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(s)) {
    return { error: `${capital(label)} can have at most ${decimals} decimals.` };
  }
  const value = Number(s);
  if (value < min) return { error: `${capital(label)} must be at least ${min}.` };
  if (value > max) return { error: `${capital(label)} can be at most ${max}.` };
  return { value };
}

/** "200", "12.5" - no trailing zeros. */
export const numberText = (n: number) => String(Number(n.toFixed(2)));

const grouped = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 });
export const groupNumber = (n: number) => grouped.format(n);
export const lkr = (n: number) => `LKR ${groupNumber(n)}`;

export const REFERRAL_MODE_LABEL: Record<ReferralMode, string> = {
  LKR_OFF: 'LKR off',
  FREE_DELIVERY: 'Free delivery',
};

export const REFERRAL_STATUSES: ReferralStatus[] = ['PENDING', 'REWARDED', 'CAPPED', 'NO_REWARD'];

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  PENDING: 'Pending',
  REWARDED: 'Rewarded',
  CAPPED: 'Over monthly cap',
  NO_REWARD: 'No reward',
};

export const REFERRAL_STATUS_HINT: Record<ReferralStatus, string> = {
  PENDING: "Waiting for the friend's first delivered order.",
  REWARDED: 'The inviter has been credited.',
  CAPPED: 'The inviter was over the monthly cap - no inviter reward.',
  NO_REWARD: "Refer a friend was off when the friend's order was delivered.",
};

/** "LKR 200 off" / "Free delivery". */
export function rewardText(mode: ReferralMode, amount: number): string {
  return mode === 'FREE_DELIVERY' ? 'Free delivery' : `${lkr(amount)} off`;
}

/** One line describing both rewards. */
export function referralSummary(s: Pick<ReferralSetting, 'mode' | 'friend_amount_lkr' | 'inviter_amount_lkr'>): string {
  if (s.mode === 'FREE_DELIVERY') return 'Friend: free delivery on their first order · Inviter: free delivery on their next order';
  return `Friend: ${lkr(s.friend_amount_lkr)} off their first order · Inviter: ${lkr(s.inviter_amount_lkr)} off their next order`;
}

/** (owner, 2026-10-10) The one-line explanation beside the "Unused friend reward becomes a credit" switch. */
export const FRIEND_UNUSED_TO_CREDIT_HINT =
  "If the friend's first order could not use their reward (it already had free delivery, or a bigger coupon or birthday gift won), they get it as a credit when that order is delivered. Off: the unused reward lapses.";

/** The rules shown under the settings, in the order a customer meets them. */
export const REFERRAL_RULES = [
  "The friend's reward applies on their first order.",
  "The inviter's reward is credited when the friend's first order is delivered, and used automatically on their next order.",
  'One referral per new account; nobody can refer themselves.',
  'A referral reward does not stack with a coupon or birthday gift - the single larger discount wins.',
];

/** Points for an order: `earn_points` for every full LKR `earn_per_lkr`. */
export function pointsEarned(amount: number, s: Pick<PointsSetting, 'earn_points' | 'earn_per_lkr'>): number {
  if (!(s.earn_per_lkr > 0)) return 0;
  return Math.floor(amount / s.earn_per_lkr + 1e-9) * s.earn_points;
}

/** "A LKR 1,000 order earns 10 points; 100 points = LKR 100". */
export function pointsExample(s: Pick<PointsSetting, 'earn_points' | 'earn_per_lkr' | 'lkr_per_point'>, order = 1000): string {
  const earned = pointsEarned(order, s);
  return `A ${lkr(order)} order earns ${groupNumber(earned)} ${earned === 1 ? 'point' : 'points'}; 100 points = ${lkr(100 * s.lkr_per_point)}`;
}

export const POINTS_KIND_LABEL: Record<PointsKind, string> = {
  EARN: 'Earned',
  REDEEM: 'Used',
  REFUND: 'Given back',
  EXPIRE: 'Expired',
  ADJUST: 'Adjusted',
};

/** "+10", "−5". */
export const signedPoints = (n: number) => (n > 0 ? `+${groupNumber(n)}` : n < 0 ? `−${groupNumber(-n)}` : '0');

/** A non-zero whole number of points, + or -. */
export function parseAdjustPoints(input: string): Parsed {
  const s = input.trim().replace(/\s/g, '').replace(/^\+/, '').replace(/^−/, '-');
  if (s === '' || s === '-') return { error: 'Enter the points to add (like 50) or take away (like -50).' };
  if (!/^-?\d+$/.test(s)) return { error: 'Points must be a whole number, like 50 or -50.' };
  const value = Number(s);
  if (value === 0) return { error: 'Points cannot be 0.' };
  if (Math.abs(value) > MAX_ADJUST) return { error: `Points can be at most ${groupNumber(MAX_ADJUST)} either way.` };
  return { value };
}

export function parseReason(input: string): { value: string } | { error: string } {
  const s = input.trim();
  if (s.length < MIN_REASON) return { error: `Write a reason (at least ${MIN_REASON} characters).` };
  if (s.length > MAX_REASON) return { error: `The reason can be at most ${MAX_REASON} characters.` };
  return { value: s };
}

/** Only the fields that differ from what is saved - the PATCH is strict and
 * refuses an empty body, so an unchanged form sends nothing. */
export function changedFields<T extends object>(saved: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (next[key] !== saved[key]) out[key] = next[key];
  }
  return out;
}

/** Referral settings form -> a validated body, or the first error. */
export function readReferralForm(form: {
  enabled: boolean;
  mode: ReferralMode;
  friend: string;
  inviter: string;
  cap: string;
  /** (owner, 2026-10-10) "Unused friend reward becomes a credit". */
  friendUnusedToCredit: boolean;
}): { value: Omit<ReferralSetting, 'updated_at'> } | { error: string; field: 'friend' | 'inviter' | 'cap' } {
  const cap = parseNumber(form.cap, 'the monthly cap', 1, MAX_REFERRAL_CAP, 0);
  if ('error' in cap) return { error: cap.error, field: 'cap' };
  let friend = 0;
  let inviter = 0;
  if (form.mode === 'LKR_OFF') {
    const f = parseNumber(form.friend, "the friend's amount", 0, MAX_REFERRAL_LKR);
    if ('error' in f) return { error: f.error, field: 'friend' };
    const i = parseNumber(form.inviter, "the inviter's amount", 0, MAX_REFERRAL_LKR);
    if ('error' in i) return { error: i.error, field: 'inviter' };
    friend = f.value;
    inviter = i.value;
  }
  return {
    value: {
      enabled: form.enabled,
      mode: form.mode,
      friend_amount_lkr: friend,
      inviter_amount_lkr: inviter,
      monthly_cap: cap.value,
      friend_unused_to_credit: form.friendUnusedToCredit,
    },
  };
}

export type PointsFormField = 'earn_points' | 'earn_per_lkr' | 'lkr_per_point' | 'min_redeem_points' | 'max_redeem_percent' | 'expiry_months';

/** Points settings form (text inputs) -> a validated body, or the first error. */
export function readPointsForm(
  form: { enabled: boolean } & Record<PointsFormField, string>
): { value: Omit<PointsSetting, 'updated_at'> } | { error: string; field: PointsFormField } {
  const rules: [PointsFormField, string, number, number, number][] = [
    ['earn_points', 'points earned', 1, 1000, 0],
    ['earn_per_lkr', 'the LKR spent per earning', 1, 100000, 2],
    ['lkr_per_point', 'the value of a point', 0.01, 1000, 2],
    ['min_redeem_points', 'the minimum points to use', 0, 1000000, 0],
    ['max_redeem_percent', 'the most of an order points can pay', 1, 100, 2],
    ['expiry_months', 'the expiry months', 0, 120, 0],
  ];
  const out: Record<string, number> = {};
  for (const [field, label, min, max, decimals] of rules) {
    const parsed = parseNumber(form[field], label, min, max, decimals);
    if ('error' in parsed) return { error: parsed.error, field };
    out[field] = parsed.value;
  }
  return { value: { enabled: form.enabled, ...(out as Record<PointsFormField, number>) } };
}

/** Text inputs for a saved points setting. */
export function pointsFormFrom(s: PointsSetting): { enabled: boolean } & Record<PointsFormField, string> {
  return {
    enabled: s.enabled,
    earn_points: String(s.earn_points),
    earn_per_lkr: numberText(s.earn_per_lkr),
    lkr_per_point: numberText(s.lkr_per_point),
    min_redeem_points: String(s.min_redeem_points),
    max_redeem_percent: numberText(s.max_redeem_percent),
    expiry_months: String(s.expiry_months),
  };
}
