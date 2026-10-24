import type {
  AdminRepeatBasket,
  ProductRequestGroup,
  ProductRequestSort,
  ProductRequestStatus,
  RepeatBasketStatus,
  RepeatRunStatus,
} from '../api/engagement';

/** Words and small rules for the Repeat baskets, Ratings and Product requests pages. */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** '08:00' -> '8:00 am', '13:30' -> '1:30 pm'. */
export function clock12(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Every day at 8:00 am", "Every Monday at 8:00 am", "Every 2 weeks on Monday at 8:00 am". */
export function scheduleText(b: Pick<AdminRepeatBasket, 'frequency' | 'weekday' | 'place_at'>): string {
  const at = clock12(b.place_at);
  const day = b.weekday != null ? WEEKDAYS[b.weekday] : undefined;
  if (b.frequency === 'DAILY') return `Every day at ${at}`;
  if (b.frequency === 'WEEKLY') return day ? `Every ${day} at ${at}` : `Every week at ${at}`;
  return day ? `Every 2 weeks on ${day} at ${at}` : `Every 2 weeks at ${at}`;
}

const colomboDateTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Colombo',
});
const colomboDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' });

/** "Mon 27 Oct, 8:00 am" in Sri Lanka time. */
export const whenText = (iso: string | null | undefined) => (iso ? colomboDateTime.format(new Date(iso)) : '—');
/** "27 Oct 2026" in Sri Lanka time. */
export const dayText = (iso: string | null | undefined) => (iso ? colomboDay.format(new Date(iso)) : '—');

export const BASKET_STATUS_LABEL: Record<RepeatBasketStatus, string> = { ACTIVE: 'Active', PAUSED: 'Paused', CANCELLED: 'Cancelled' };
export const BASKET_STATUS_TONE: Record<RepeatBasketStatus, 'active' | 'inactive' | 'muted' | 'offer'> = {
  ACTIVE: 'active',
  PAUSED: 'offer',
  CANCELLED: 'muted',
};
export const RUN_STATUS_LABEL: Record<RepeatRunStatus, string> = { PLACED: 'Ordered', SKIPPED: 'Skipped', FAILED: 'Failed' };

export const basketCustomer = (b: AdminRepeatBasket) => ({
  name: b.customer_name ?? b.customer?.full_name ?? null,
  phone: b.customer_phone ?? b.customer?.phone ?? null,
});

export const basketItemsCount = (b: AdminRepeatBasket) =>
  b.items_count ?? (b.items ? b.items.reduce((n, line) => n + (Number(line.quantity) || 0), 0) : 0);

/** "Milk 1L x2, Bread x1 +3 more" when the API names the products; '' when it does not. */
export function basketItemsPreview(b: AdminRepeatBasket, max = 3): string {
  const named = (b.items ?? []).filter((l) => l.product_name);
  if (named.length === 0) return '';
  const shown = named.slice(0, max).map((l) => `${l.product_name} x${l.quantity}`);
  const more = (b.items?.length ?? 0) - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
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
export const tagLabel = (tag: string) => RATING_TAG_LABEL[tag] ?? tag;

/** Share of the biggest star count, for the CSS bars (0-100). */
export function barPercent(count: number, counts: number[]): number {
  const max = Math.max(0, ...counts);
  return max > 0 ? Math.round((count / max) * 100) : 0;
}

export const starsText = (stars: number) => `${'★'.repeat(Math.max(0, Math.min(5, stars)))}${'☆'.repeat(Math.max(0, 5 - stars))}`;

/** Money from the API may arrive as a string (NUMERIC). */
export const amount = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? n : 0;
};

// --------------------------------------------------------- product requests
export const REQUEST_STATUSES: readonly ProductRequestStatus[] = ['NEW', 'PLANNED', 'ADDED', 'DECLINED'];
export const REQUEST_STATUS_LABEL: Record<ProductRequestStatus, string> = {
  NEW: 'New',
  PLANNED: 'Planned',
  ADDED: 'Added',
  DECLINED: 'Not stocking',
};
export const REQUEST_STATUS_TONE: Record<ProductRequestStatus, 'active' | 'inactive' | 'muted' | 'offer'> = {
  NEW: 'offer',
  PLANNED: 'active',
  ADDED: 'active',
  DECLINED: 'muted',
};

export function sortRequestGroups(groups: ProductRequestGroup[], sort: ProductRequestSort): ProductRequestGroup[] {
  const last = (g: ProductRequestGroup) => Date.parse(g.last_requested_at) || 0;
  return [...groups].sort((a, b) => (sort === 'popular' ? b.count - a.count || last(b) - last(a) : last(b) - last(a)));
}

export function requestCounts(groups: ProductRequestGroup[]): Record<ProductRequestStatus | 'ALL', number> {
  const out = { ALL: groups.length, NEW: 0, PLANNED: 0, ADDED: 0, DECLINED: 0 };
  for (const g of groups) out[g.status] = (out[g.status] ?? 0) + 1;
  return out;
}
