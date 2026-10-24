/**
 * Customer groups for push notifications and SMS offers (docs/superpowers/plans/
 * 2026-10-24-groups-ratings-requests.md section A). The API counts and sends;
 * these helpers build the `audience` it takes and the words for it. Same rules
 * and words as Admin's lib/customerGroups.ts (a fresh copy - no cross-app imports).
 */
export type CustomerGroup = 'ALL' | 'LAPSED' | 'NEW' | 'BIG_SPENDERS' | 'NEVER_ORDERED';

export type CustomerAudience =
  | { group: 'ALL' }
  | { group: 'LAPSED'; days: number }
  | { group: 'NEW'; days: number }
  | { group: 'BIG_SPENDERS'; days: number; min_spend_lkr: number }
  | { group: 'NEVER_ORDERED' };

type DaysGroup = 'LAPSED' | 'NEW' | 'BIG_SPENDERS';

/** What the picker edits: every number kept as typed, so switching groups keeps them. */
export interface AudienceDraft {
  group: CustomerGroup;
  days: Record<DaysGroup, string>;
  min_spend_lkr: string;
}

export const CUSTOMER_GROUPS: readonly CustomerGroup[] = ['ALL', 'LAPSED', 'NEW', 'BIG_SPENDERS', 'NEVER_ORDERED'];

export const GROUP_LABEL: Record<CustomerGroup, string> = {
  ALL: 'All customers',
  LAPSED: "Haven't ordered in N days",
  NEW: 'New customers (last N days)',
  BIG_SPENDERS: 'Big spenders',
  NEVER_ORDERED: 'Signed up, never ordered',
};

export const GROUP_HINT: Record<CustomerGroup, string> = {
  ALL: 'Everyone who can get it.',
  LAPSED: 'Ordered before, but nothing in the last N days.',
  NEW: 'Accounts made in the last N days.',
  BIG_SPENDERS: 'Delivered orders worth at least the minimum in the last N days.',
  NEVER_ORDERED: 'Made an account but never ordered.',
};

/** The API's limits and defaults for each group's days. */
export const DAYS_RANGE: Record<DaysGroup, { min: number; max: number; default: number }> = {
  LAPSED: { min: 7, max: 90, default: 14 },
  NEW: { min: 1, max: 60, default: 14 },
  BIG_SPENDERS: { min: 30, max: 365, default: 90 },
};
export const DEFAULT_MIN_SPEND_LKR = 5000;

export const hasDays = (group: string): group is DaysGroup => group === 'LAPSED' || group === 'NEW' || group === 'BIG_SPENDERS';

export const blankAudienceDraft = (): AudienceDraft => ({
  group: 'ALL',
  days: {
    LAPSED: String(DAYS_RANGE.LAPSED.default),
    NEW: String(DAYS_RANGE.NEW.default),
    BIG_SPENDERS: String(DAYS_RANGE.BIG_SPENDERS.default),
  },
  min_spend_lkr: String(DEFAULT_MIN_SPEND_LKR),
});

const wholeNumber = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);

/** The `audience` for the API, or the problem that stops it (shown under the picker). */
export function audienceFromDraft(
  draft: AudienceDraft
): { audience: CustomerAudience; problem: null } | { audience: null; problem: string } {
  const g = draft.group;
  if (g === 'ALL' || g === 'NEVER_ORDERED') return { audience: { group: g }, problem: null };
  const range = DAYS_RANGE[g];
  const days = wholeNumber(draft.days[g]);
  if (!Number.isInteger(days) || days < range.min || days > range.max) {
    return { audience: null, problem: `Days must be a whole number from ${range.min} to ${range.max}.` };
  }
  if (g !== 'BIG_SPENDERS') return { audience: { group: g, days }, problem: null };
  const min = wholeNumber(draft.min_spend_lkr);
  if (!Number.isInteger(min) || min < 1) return { audience: null, problem: 'Minimum spend must be a whole number of rupees, 1 or more.' };
  return { audience: { group: g, days, min_spend_lkr: min }, problem: null };
}

/** `group=LAPSED&days=14` for GET .../audience previews. */
export function audienceQuery(audience: CustomerAudience): string {
  const q = new URLSearchParams({ group: audience.group });
  if ('days' in audience) q.set('days', String(audience.days));
  if ('min_spend_lkr' in audience) q.set('min_spend_lkr', String(audience.min_spend_lkr));
  return q.toString();
}

const lkr = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Older SMS offers carry a word, not a group (backend migration 027). */
const LEGACY_LABEL: Record<string, string> = {
  ALL: 'All customers',
  ORDERED_30D: 'Ordered in last 30 days',
  ORDERED_90D: 'Ordered in last 90 days',
  NEVER_ORDERED: 'Signed up, never ordered',
};

/** "Haven't ordered in 14 days", "Big spenders: LKR 5,000+ in 90 days", ... for history rows. */
export function audienceLabel(audience: unknown): string {
  if (audience == null) return 'All customers';
  if (typeof audience === 'string') return LEGACY_LABEL[audience] ?? audience;
  if (typeof audience !== 'object') return String(audience);
  const a = audience as { group?: string; days?: number; min_spend_lkr?: number };
  switch (a.group) {
    case 'ALL':
      return 'All customers';
    case 'LAPSED':
      return `Haven't ordered in ${a.days ?? DAYS_RANGE.LAPSED.default} days`;
    case 'NEW':
      return `New customers (last ${a.days ?? DAYS_RANGE.NEW.default} days)`;
    case 'BIG_SPENDERS':
      return `Big spenders: LKR ${lkr.format(a.min_spend_lkr ?? DEFAULT_MIN_SPEND_LKR)}+ in ${a.days ?? DAYS_RANGE.BIG_SPENDERS.default} days`;
    case 'NEVER_ORDERED':
      return 'Signed up, never ordered';
    default:
      return a.group ? String(a.group) : 'All customers';
  }
}
