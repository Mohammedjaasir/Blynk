import { ApiError } from '../api/client';
import type { ProductRequestStatus, RepeatStatus } from '../api/growth';
import { errorMessage } from './errors';

/**
 * Words and small rules for repeat baskets, ratings + rider tips and product requests
 * (plans 2026-10-24-buy-again-repeat.md and 2026-10-24-groups-ratings-requests.md).
 * Pure - tested in test/growth-lib.test.ts.
 */

const COLOMBO = 'Asia/Colombo';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The migration each feature waits for (run by hand in Coolify). */
const NOT_READY: Record<string, string> = {
  REPEAT_NOT_READY: 'Repeat baskets need database update 054. Run the migration in Coolify first.',
  RATINGS_NOT_READY: 'Ratings need database update 055. Run the migration in Coolify first.',
  PRODUCT_REQUESTS_NOT_READY: 'Product requests need database update 056. Run the migration in Coolify first.',
};

/** True for the 503 a feature answers before its migration has been run. */
export function isNotReady(err: unknown): boolean {
  return err instanceof ApiError && /_NOT_READY$/.test(err.code ?? '');
}

/** The operator's words for these screens' errors. */
export function growthErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code) {
    if (NOT_READY[err.code]) return NOT_READY[err.code];
    if (err.code === 'BASKET_NOT_FOUND') return 'That repeat basket no longer exists. Refresh the list.';
  }
  return errorMessage(err, fallback);
}

// ------------------------------------------------------------ repeat baskets
/** "08:00" -> "8:00 am", "17:30" -> "5:30 pm". */
export function clockText(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return '';
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${suffix}`;
}

/** "Every day at 8:00 am", "Every Monday at 8:00 am", "Every 2 weeks on Monday at 8:00 am". */
export function scheduleText(b: { frequency: string; weekday: number | null; place_at: string | null }): string {
  const at = b.place_at ? ` at ${clockText(b.place_at)}` : '';
  const day = b.weekday != null && b.weekday >= 0 && b.weekday <= 6 ? WEEKDAYS[b.weekday] : null;
  if (b.frequency === 'DAILY') return `Every day${at}`;
  if (b.frequency === 'BIWEEKLY') return `Every 2 weeks${day ? ` on ${day}` : ''}${at}`;
  return day ? `Every ${day}${at}` : `Every week${at}`;
}

const nextFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: COLOMBO,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "Mon 26 Oct, 8:00 am" in Sri Lanka time. */
export function colomboWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return nextFmt.format(d).replace(/\b(AM|PM)\b/g, (x) => x.toLowerCase());
}

export const REPEAT_STATUS_LABEL: Record<RepeatStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
};

/** "Placed - order #1042", "Skipped - Store closed", "Failed - ...". */
export function runText(run: { status: string; order_number: string | null; reason: string | null } | null): string | null {
  if (!run) return null;
  const word = run.status === 'PLACED' ? 'Placed' : run.status === 'SKIPPED' ? 'Skipped' : run.status === 'FAILED' ? 'Failed' : run.status;
  const parts = [word];
  if (run.order_number) parts.push(`order #${run.order_number}`);
  if (run.reason) parts.push(run.reason);
  return parts.join(' - ');
}

// ------------------------------------------------------------------ ratings
export const RATING_TAG_LABEL: Record<string, string> = {
  ON_TIME: 'On time',
  LATE: 'Late',
  FRIENDLY_RIDER: 'Friendly rider',
  RUDE_RIDER: 'Rude rider',
  FRESH: 'Fresh',
  DAMAGED: 'Damaged',
  MISSING_ITEM: 'Missing item',
  WRONG_ITEM: 'Wrong item',
  GOOD_PACKING: 'Good packing',
};

/** Tags that are complaints (shown in red). */
export const BAD_TAGS = new Set(['LATE', 'RUDE_RIDER', 'DAMAGED', 'MISSING_ITEM', 'WRONG_ITEM']);

export const tagLabel = (tag: string) => RATING_TAG_LABEL[tag] ?? tag.replace(/_/g, ' ').toLowerCase();

/** "★★★★☆" for 4. */
export function starsText(stars: number): string {
  const s = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}

/** "4.3" or "-" when there are no ratings. */
export const averageText = (avg: number | null | undefined) => (avg == null || !Number.isFinite(avg) ? '-' : avg.toFixed(1));

/** A rating at or under this many stars is a low rating (the staff push threshold). */
export const LOW_RATING_STARS = 2;

/**
 * The rider tip a figures row carries, if the API sends one (plan §B: tips are credited
 * 100% to the rider and shown as a "Tips" line). Older APIs leave it out: undefined.
 */
export function tipsOf(row: object | null | undefined): number | undefined {
  if (!row) return undefined;
  const r = row as Record<string, unknown>;
  for (const k of ['tips', 'tips_lkr', 'rider_tips', 'tip_total']) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/**
 * Where tapping a staff push opens. The new-order push keeps opening the Orders board
 * (as before); a push about one order's rating (the low-rating alert) opens that order.
 */
export function pushOpenPath(data: unknown): string {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const type = typeof d.type === 'string' ? d.type : '';
  const orderId = typeof d.order_id === 'string' ? d.order_id : '';
  if (orderId && /rating/i.test(type)) return `/orders/${encodeURIComponent(orderId)}`;
  // A shop applied at blynk.lk/seller (owner's brother, 2026-10-27).
  if (type === 'staff_seller_application') return '/more/seller-applications';
  return '/orders';
}

// --------------------------------------------------------- product requests
export const REQUEST_STATUS_LABEL: Record<ProductRequestStatus, string> = {
  NEW: 'New',
  PLANNED: 'Planned',
  ADDED: 'Added',
  DECLINED: 'Not stocking',
};
