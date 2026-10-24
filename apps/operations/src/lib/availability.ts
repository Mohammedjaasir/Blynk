/* Blynk Ops copy of apps/admin/src/lib/availability.ts (common.md rule 2: no cross-app imports) - keep the two in step. */
/*
 * Time-limited products (owner, 2026-10-23: "some product that I want to add time-based ... for
 * category-wise or product-wise ... the timing will be different"): a product, or a whole category,
 * can be ordered only between two times of day (Colombo). Outside them the customer app greys it
 * with its hours and the cart refuses it. A product's own hours win over its category's, and a
 * sub-category's over its main category's. GET|PUT /admin/settings/availability-windows
 * (backend/api/src/modules/configuration/availability-windows.ts); PUT replaces the whole list.
 */

export type AvailabilityKind = 'PRODUCT' | 'CATEGORY';

export interface AvailabilityWindow {
  kind: AvailabilityKind;
  id: string;
  /** 'HH:MM', Colombo. */
  from: string;
  until: string;
}

export interface AvailabilityView extends AvailabilityWindow {
  name: string;
  /** A sub-category's main category. */
  parent_name: string | null;
  open_now: boolean;
}

export interface AvailabilitySetting {
  windows: AvailabilityView[];
  updated_at: string | null;
}

export const AVAILABILITY_LIMITS = { windows: 300 } as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "6 am", "6:30 pm". */
export function clockText(t: string): string {
  if (!HHMM.test(t)) return t;
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}

export const windowText = (w: Pick<AvailabilityWindow, 'from' | 'until'>) => `${clockText(w.from)} - ${clockText(w.until)}`;

/** The name staff know it by: "Beverages › Juices" for a sub-category. */
export const windowLabel = (w: Pick<AvailabilityView, 'kind' | 'name' | 'parent_name'>) =>
  w.kind === 'CATEGORY' && w.parent_name ? `${w.parent_name} › ${w.name}` : w.name;

const colomboMinutes = (at: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
};
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Is the window open right now (Colombo)? Same rule as the API: from <= now < until, past midnight when from > until. */
export function isOpenNow(w: Pick<AvailabilityWindow, 'from' | 'until'>, at: Date = new Date()): boolean {
  if (!HHMM.test(w.from) || !HHMM.test(w.until)) return false;
  const now = colomboMinutes(at);
  const from = minutes(w.from);
  const until = minutes(w.until);
  return from < until ? now >= from && now < until : now >= from || now < until;
}

/** What is wrong with one window, in words for the form; null = fine. */
export function windowProblem(w: Pick<AvailabilityWindow, 'from' | 'until'>): string | null {
  if (!HHMM.test(w.from) || !HHMM.test(w.until)) return 'Choose both times.';
  if (w.from === w.until) return 'The two times must differ.';
  return null;
}

/** The PUT body. */
export function windowsPayload(list: ReadonlyArray<AvailabilityWindow>): { windows: AvailabilityWindow[] } {
  return { windows: list.map((w) => ({ kind: w.kind, id: w.id, from: w.from, until: w.until })) };
}

/** This product's own hours in the list, or null. */
export const productWindow = <T extends AvailabilityWindow>(list: ReadonlyArray<T>, productId: string): T | null =>
  list.find((w) => w.kind === 'PRODUCT' && w.id === productId) ?? null;

/** What is wrong with a product's From / Until as typed on its form ('' and '' = any time); null = fine. */
export function productHoursProblem(from: string, until: string): string | null {
  if (!from && !until) return null;
  if (!from || !until) return 'Fill in both times, or leave both empty for any time.';
  return windowProblem({ from, until });
}

/**
 * The whole list with only this product's entry set (changed in place, else added) or, when both
 * times are empty, removed. Every other entry (other products, categories) is kept as it is: the
 * PUT replaces the whole list.
 */
export function withProductWindow(list: ReadonlyArray<AvailabilityWindow>, productId: string, from: string, until: string): AvailabilityWindow[] {
  const rest = list.filter((w) => !(w.kind === 'PRODUCT' && w.id === productId));
  if (!from && !until) return rest;
  const entry: AvailabilityWindow = { kind: 'PRODUCT', id: productId, from, until };
  const at = list.findIndex((w) => w.kind === 'PRODUCT' && w.id === productId);
  if (at < 0) return [...rest, entry];
  const out = [...rest];
  out.splice(at, 0, entry);
  return out;
}
