import { revenueOf } from '../reports/revenue-sql.js';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';

/**
 * Customer groups for offers (owner, 2026-10-24: "push / SMS only to people who haven't ordered in
 * 14 days, new customers, big spenders"). Used by push broadcasts (push/broadcast.ts) and SMS offers
 * (sms-offers/). No migration: every group is a condition over users and orders.
 *
 *   ALL            every active customer (the old behaviour; a missing `audience` means this)
 *   LAPSED         has at least one DELIVERED order, and no order placed in the last `days` (7-90, default 14)
 *   NEW            account created in the last `days` (1-60, default 14)
 *   BIG_SPENDERS   DELIVERED orders placed in the last `days` (30-365, default 90) total >= `min_spend_lkr`
 *                  (default 5000). Spend = total_amount + wallet_amount_used, as in Admin's customer list.
 *   NEVER_ORDERED  signed up, never placed an order
 *
 * "Placed" is orders.placed_at, any status (an order that was cancelled was still placed). The caller
 * keeps its own channel rules: active CUSTOMER accounts only, push needs a device, SMS needs a real
 * phone and the opt-out / sending-hours rules.
 */
export const CUSTOMER_GROUPS = ['ALL', 'LAPSED', 'NEW', 'BIG_SPENDERS', 'NEVER_ORDERED'] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];

export const GROUP_LIMITS = {
  LAPSED: { min: 7, max: 90, default: 14 },
  NEW: { min: 1, max: 60, default: 14 },
  BIG_SPENDERS: { min: 30, max: 365, default: 90 },
  MIN_SPEND: { min: 1, max: 10_000_000, default: 5000 },
} as const;

export type CustomerAudience =
  | { group: 'ALL' }
  | { group: 'LAPSED'; days: number }
  | { group: 'NEW'; days: number }
  | { group: 'BIG_SPENDERS'; days: number; min_spend_lkr: number }
  | { group: 'NEVER_ORDERED' };

export const ALL_CUSTOMERS: CustomerAudience = { group: 'ALL' };

/** '' (an empty query-string field) counts as not given. */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const days = (limits: { min: number; max: number; default: number }) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: 'Days must be a number' })
      .int('Days must be a whole number')
      .min(limits.min, `Days must be from ${limits.min} to ${limits.max}`)
      .max(limits.max, `Days must be from ${limits.min} to ${limits.max}`)
      .default(limits.default)
  );

const minSpend = z.preprocess(
  blankToUndefined,
  z.coerce
    .number({ invalid_type_error: 'The minimum spend must be a number' })
    .min(GROUP_LIMITS.MIN_SPEND.min, 'The minimum spend must be at least LKR 1')
    .max(GROUP_LIMITS.MIN_SPEND.max, 'The minimum spend is too large')
    .default(GROUP_LIMITS.MIN_SPEND.default)
);

/** `audience` in a request body. Unknown extra fields (a days on ALL) are dropped. */
export const customerAudienceSchema: z.ZodType<CustomerAudience, z.ZodTypeDef, unknown> = z.discriminatedUnion(
  'group',
  [
    z.object({ group: z.literal('ALL') }),
    z.object({ group: z.literal('LAPSED'), days: days(GROUP_LIMITS.LAPSED) }),
    z.object({ group: z.literal('NEW'), days: days(GROUP_LIMITS.NEW) }),
    z.object({ group: z.literal('BIG_SPENDERS'), days: days(GROUP_LIMITS.BIG_SPENDERS), min_spend_lkr: minSpend }),
    z.object({ group: z.literal('NEVER_ORDERED') }),
  ],
  { errorMap: () => ({ message: `The group must be one of ${CUSTOMER_GROUPS.join(', ')}` }) }
) as never;

/**
 * The audience preview's query string (`?group=&days=&min_spend_lkr=`). No group = ALL. Throws a
 * ZodError (400 VALIDATION_ERROR) for a bad group or an out-of-range number.
 */
export function parseAudienceQuery(query: Record<string, unknown>): CustomerAudience {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const group = one(query.group);
  if (group === undefined || group === '') return ALL_CUSTOMERS;
  return customerAudienceSchema.parse({
    group: typeof group === 'string' ? group.trim().toUpperCase() : group,
    days: one(query.days),
    min_spend_lkr: one(query.min_spend_lkr),
  });
}

/**
 * The group as a SQL condition on the customer row aliased `u` (users as u). ALL is `true`, so a
 * query with it is exactly the one before groups existed.
 */
export function audienceCondition(audience: CustomerAudience): RawBuilder<boolean> {
  switch (audience.group) {
    case 'LAPSED':
      return sql<boolean>`(EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.order_status = 'DELIVERED')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id
                        AND o.placed_at >= now() - make_interval(days => ${audience.days}::int)))`;
    case 'NEW':
      return sql<boolean>`(u.created_at >= now() - make_interval(days => ${audience.days}::int))`;
    case 'BIG_SPENDERS':
      return sql<boolean>`((SELECT coalesce(sum(${revenueOf('o')}), 0) FROM orders o
                             WHERE o.customer_id = u.id AND o.order_status = 'DELIVERED'
                               AND o.placed_at >= now() - make_interval(days => ${audience.days}::int))
                           >= ${audience.min_spend_lkr}::numeric)`;
    case 'NEVER_ORDERED':
      return sql<boolean>`(NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id))`;
    case 'ALL':
    default:
      return sql<boolean>`true`;
  }
}

/** A short line for logs and lists: "Haven't ordered in 14 days". */
export function audienceLabel(audience: CustomerAudience): string {
  switch (audience.group) {
    case 'LAPSED':
      return `Haven't ordered in ${audience.days} days`;
    case 'NEW':
      return `Joined in the last ${audience.days} days`;
    case 'BIG_SPENDERS':
      return `Spent LKR ${audience.min_spend_lkr} or more in ${audience.days} days`;
    case 'NEVER_ORDERED':
      return 'Never ordered';
    default:
      return 'All customers';
  }
}

/** An audience read back from an audit row; anything unreadable (older rows) = ALL. */
export function audienceFromStored(value: unknown): CustomerAudience {
  const r = customerAudienceSchema.safeParse(value);
  return r.success ? r.data : ALL_CUSTOMERS;
}
