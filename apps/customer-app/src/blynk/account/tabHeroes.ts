import type { StoreInfo } from '../api/types';
import { formatClock, formatHours } from '../lib/storeText';
import { HELP_HERO } from '../ui/strings';

/*
 * Pure pieces of the Profile and Help tab heroes (src/components/TabHero.tsx): the store's
 * open-now chip, the greeting's first name and initial, the points count-up curve and the
 * list rows' entrance stagger.
 */

const TZ = 'Asia/Colombo';

/** Minutes since midnight in Sri Lanka time. */
function colomboMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

const toMinutes = (hhmm: string | undefined | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
};

const colomboDay = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: TZ });

export type OpenStatus = { open: boolean; label: string };

/**
 * The Help hero's chip: "We're open now · 8 AM – 9 PM" while the store takes orders, else when
 * it opens next ("Opens at 8 AM", "Opens tomorrow at 8 AM", "Opens Tue at 8 AM"). The server's
 * is_open_now decides (it knows holidays and closed days); the hours only fill in when it is
 * missing. null until the store has loaded, so nothing is claimed before it is known.
 */
export function openStatus(store: StoreInfo | null, now: Date = new Date()): OpenStatus | null {
  if (!store) return null;
  const hours = formatHours(store);
  let open: boolean | null = typeof store.is_open_now === 'boolean' ? store.is_open_now : null;
  if (open === null) {
    const a = toMinutes(store.delivery_hours?.start), b = toMinutes(store.delivery_hours?.end);
    if (a === null || b === null) return null;
    const t = colomboMinutes(now);
    open = a <= b ? t >= a && t < b : t >= a || t < b;
  }
  if (open) return { open: true, label: hours ? HELP_HERO.openNow(hours) : HELP_HERO.openNowShort };

  const iso = store.reopens_at ?? store.next_open_at;
  const at = iso ? new Date(iso) : null;
  if (at && !Number.isNaN(at.getTime())) {
    const time = at.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
    if (colomboDay(at) === colomboDay(now)) return { open: false, label: HELP_HERO.opensAt(time) };
    const tomorrow = new Date(now.getTime() + 86_400_000);
    if (colomboDay(at) === colomboDay(tomorrow)) return { open: false, label: HELP_HERO.opensTomorrow(time) };
    const weekday = at.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
    return { open: false, label: HELP_HERO.opensOn(weekday, time) };
  }
  const start = formatClock(store.delivery_hours?.start);
  return { open: false, label: start ? HELP_HERO.opensAt(start) : HELP_HERO.closedNow };
}

/** "Fathima Rizna" -> "Fathima"; null for an empty name. */
export function firstName(full: string | null | undefined): string | null {
  const f = (full ?? '').trim().split(/\s+/)[0];
  return f ? f : null;
}

/** The avatar's letter: the first letter of the name, upper-cased; null without a name. */
export function initialOf(full: string | null | undefined): string | null {
  const f = firstName(full);
  if (!f) return null;
  const ch = Array.from(f)[0];
  return ch ? ch.toLocaleUpperCase() : null;
}

/** The points count-up: 0 -> target, easing out (cubic), whole numbers, exactly target at t >= 1. */
export function countUpAt(target: number, t: number): number {
  if (!Number.isFinite(target) || target <= 0) return Math.max(0, Math.round(target || 0));
  if (t >= 1) return Math.round(target);
  if (t <= 0) return 0;
  const e = 1 - Math.pow(1 - t, 3);
  return Math.min(Math.round(target), Math.floor(target * e));
}

/** List rows: each one ENTER.stepMs after the one above; rows past the cap come in together. */
export const ENTER = { stepMs: 38, maxSlot: 8, durationMs: 260 } as const;

/** Delay (ms) of the row in `slot` (0 = first). Every row is in by ENTER.maxSlot * stepMs + durationMs (< 600 ms). */
export const enterDelay = (slot: number): number => Math.max(0, Math.min(Math.floor(slot), ENTER.maxSlot)) * ENTER.stepMs;
