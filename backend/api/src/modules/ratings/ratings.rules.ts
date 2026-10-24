import { z } from 'zod';
import { DateTime } from 'luxon';

/**
 * Order ratings + rider tips (owner, 2026-10-24; migration 055). Pure rules,
 * tested without a database.
 *
 * - One rating per DELIVERED order, by the customer who placed it, within
 *   RATE_WINDOW_DAYS of delivery; it can be changed for EDIT_WINDOW_HOURS
 *   after it was first given.
 * - A tip at checkout (rider_tip_lkr, 0-1000 whole LKR) is paid in cash with
 *   the order. After delivery, an order without a tip can get one from the
 *   Blynk Wallet (once, inside the same 14 days, only if the balance covers it).
 * - Every tip goes 100% to the rider who delivered the order.
 */

export const RATE_WINDOW_DAYS = 14;
export const EDIT_WINDOW_HOURS = 24;
export const TIP_OPTIONS_LKR = [50, 100, 200] as const;
export const MAX_TIP_LKR = 1000;
/** Stars at or below this queue the staff "low rating" push. */
export const LOW_RATING_STARS = 2;

export const RATING_TAGS = [
  'ON_TIME',
  'LATE',
  'FRIENDLY_RIDER',
  'RUDE_RIDER',
  'FRESH',
  'DAMAGED',
  'MISSING_ITEM',
  'WRONG_ITEM',
  'GOOD_PACKING',
] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

/** Tags that say opposite things about the same order. */
const OPPOSITES: [RatingTag, RatingTag][] = [
  ['ON_TIME', 'LATE'],
  ['FRIENDLY_RIDER', 'RUDE_RIDER'],
];

/** The words staff read for a tag ("Late, Missing item"). */
export function tagLabel(tag: string): string {
  const s = tag.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ratingInputSchema = z
  .object({
    stars: z
      .number({ required_error: 'stars is required', invalid_type_error: 'stars must be a number from 1 to 5' })
      .int('stars must be a whole number from 1 to 5')
      .min(1, 'stars must be from 1 to 5')
      .max(5, 'stars must be from 1 to 5'),
    tags: z
      .array(z.enum(RATING_TAGS, { errorMap: () => ({ message: `Each tag must be one of ${RATING_TAGS.join(', ')}` }) }), {
        invalid_type_error: 'tags must be a list',
      })
      .max(RATING_TAGS.length, 'Too many tags')
      .optional()
      // The same tag twice counts once; order kept as sent.
      .transform((v) => (v ? [...new Set(v)] : []))
      .superRefine((tags, ctx) => {
        for (const [a, b] of OPPOSITES) {
          if (tags.includes(a) && tags.includes(b)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${a} and ${b} cannot both be chosen` });
          }
        }
      }),
    comment: z
      .string({ invalid_type_error: 'comment must be text' })
      .trim()
      .max(500, 'comment can be at most 500 characters')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict();
export type RatingInput = z.infer<typeof ratingInputSchema>;

export const tipInputSchema = z
  .object({
    amount_lkr: z
      .number({ required_error: 'amount_lkr is required', invalid_type_error: 'amount_lkr must be a number' })
      .int('amount_lkr must be a whole number of rupees')
      .min(1, 'amount_lkr must be at least 1')
      .max(MAX_TIP_LKR, `amount_lkr can be at most ${MAX_TIP_LKR}`),
  })
  .strict();

/** The checkout field (order create): 0 = no tip. */
export const riderTipLkrSchema = z
  .number({ invalid_type_error: 'rider_tip_lkr must be a number' })
  .int('rider_tip_lkr must be a whole number of rupees')
  .min(0, 'rider_tip_lkr cannot be negative')
  .max(MAX_TIP_LKR, `rider_tip_lkr can be at most ${MAX_TIP_LKR}`);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Invalid date');

export const staffRatingsQuerySchema = z
  .object({
    stars_max: z.coerce.number().int().min(1).max(5).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    rider_id: z.string().uuid('rider_id must be a valid UUID').optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'to must be on or after from', path: ['to'] });
export type StaffRatingsQuery = z.infer<typeof staffRatingsQuerySchema>;

export const ratingsSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1, 'days must be 1-365').max(365, 'days must be 1-365').default(30),
});

const DAY_MS = 86_400_000;

/** The last moment the order can be rated (and tipped from the wallet); null when it was never delivered. */
export function rateUntil(deliveredAt: Date | null): Date | null {
  return deliveredAt ? new Date(deliveredAt.getTime() + RATE_WINDOW_DAYS * DAY_MS) : null;
}

/** The last moment a rating can be changed. */
export function editUntil(ratedAt: Date): Date {
  return new Date(ratedAt.getTime() + EDIT_WINDOW_HOURS * 3_600_000);
}

export function insideRateWindow(deliveredAt: Date | null, now: Date): boolean {
  const until = rateUntil(deliveredAt);
  return !!until && now.getTime() <= until.getTime();
}

export function insideEditWindow(ratedAt: Date, now: Date): boolean {
  return now.getTime() <= editUntil(ratedAt).getTime();
}

/** A rating that newly reaches the low band (created low, or changed from above it) alerts staff. */
export function shouldAlertLowRating(previousStars: number | null, stars: number): boolean {
  return stars <= LOW_RATING_STARS && (previousStars === null || previousStars > LOW_RATING_STARS);
}

/** "2-star rating on order BL-1: Late, Missing item" - the staff push text. */
export function lowRatingPushBody(stars: number, orderNumber: string, tags: readonly string[], comment: string | null): string {
  const what = tags.length ? tags.map(tagLabel).join(', ') : comment ? `"${comment.length > 80 ? `${comment.slice(0, 77)}...` : comment}"` : 'no details';
  return `${stars}-star rating on order ${orderNumber}: ${what}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The summary maths over a set of ratings. */
export function summarize(rows: readonly { stars: number; tags: readonly string[] }[]) {
  const perStar: Record<'1' | '2' | '3' | '4' | '5', number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const tagCounts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    perStar[String(r.stars) as keyof typeof perStar] += 1;
    total += r.stars;
    for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const count = rows.length;
  return {
    count,
    average: count ? round2(total / count) : null,
    per_star: perStar,
    low_count: perStar['1'] + perStar['2'],
    top_tags: [...tagCounts.entries()]
      .map(([tag, n]) => ({ tag, label: tagLabel(tag), count: n }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}
