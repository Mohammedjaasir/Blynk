import type { Seller } from '../api/types';
import { todayColombo } from './format';

/** The free month the owner promised: used when the API does not say how long it is. */
export const DEFAULT_FREE_DAYS = 30;
/** After the free month ends, the "it is over" note stays this many days, then goes. */
export const ENDED_NOTE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type FreePeriodKind = 'running' | 'last-day' | 'ended';

/** What the home card shows about the commission-free month. */
export interface FreePeriodView {
  kind: FreePeriodKind;
  /** Small text before the bold part, "Commission-free:" (empty when there is none). */
  lead: string;
  /** The bold part: "23 days to go", "Last commission-free day". Null for the ended note. */
  emphasis: string | null;
  /** The plain sentence of the ended note. */
  message: string | null;
  /** Days of the free month used so far, out of `total` (for the bar); null without a bar. */
  used: number | null;
  total: number | null;
  /** 0-100, or null when there is no bar. */
  percent: number | null;
}

export const ENDED_MESSAGE = "Commission-free month is over. Blynk's commission rates apply now.";
export const LAST_DAY_TEXT = 'Last commission-free day';

/** "23 days to go", "1 day to go". */
export function daysToGoText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} to go`;
}

/** Days of the free month used (never below 0 or above the total) and the bar's percent. */
export function freeProgress(daysLeft: number, totalDays: number): { used: number; percent: number } | null {
  if (!Number.isFinite(totalDays) || totalDays <= 0) return null;
  const used = Math.min(totalDays, Math.max(0, totalDays - daysLeft));
  return { used, percent: Math.round((used / totalDays) * 1000) / 10 };
}

/**
 * The commission-free card for a shop, or null when nothing should show:
 *  - `daysLeft` above 0: "Commission-free: 23 days to go" with a bar (the last calendar day,
 *    when the free period ends today in Colombo, says "Last commission-free day" instead);
 *  - 0 once it ended: the "month is over" note, for ENDED_NOTE_DAYS days after the end date;
 *  - null (no free period, or an API without it): nothing.
 * The server's whole-day count is the truth; the end date only decides the last day and how long
 * the "over" note stays.
 */
export function freePeriodView(
  info: Pick<Seller, 'commission_free_until' | 'commission_free_days_left' | 'commission_free_days'>,
  now: Date = new Date()
): FreePeriodView | null {
  const left = info.commission_free_days_left;
  if (left === null || left === undefined || !Number.isFinite(Number(left))) return null;
  const days = Math.max(0, Math.floor(Number(left)));
  const until = info.commission_free_until ? new Date(info.commission_free_until) : null;
  const untilOk = until !== null && !Number.isNaN(until.getTime());
  const total = Math.max(info.commission_free_days ?? DEFAULT_FREE_DAYS, days);

  if (days > 0) {
    const progress = freeProgress(days, total);
    const lastDay = days === 1 && (!untilOk || todayColombo(until!) === todayColombo(now));
    return {
      kind: lastDay ? 'last-day' : 'running',
      lead: lastDay ? '' : 'Commission-free:',
      emphasis: lastDay ? LAST_DAY_TEXT : daysToGoText(days),
      message: null,
      used: progress?.used ?? null,
      total: progress ? total : null,
      percent: progress?.percent ?? null,
    };
  }

  // Ended: needs the end date to know whether the note is still wanted.
  if (!untilOk) return null;
  const since = now.getTime() - until!.getTime();
  if (since < 0 || since >= ENDED_NOTE_DAYS * DAY_MS) return null;
  return { kind: 'ended', lead: '', emphasis: null, message: ENDED_MESSAGE, used: null, total: null, percent: null };
}
