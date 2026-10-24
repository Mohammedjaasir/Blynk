import type { DeliverySummary, EarningsTotals, RiderEarnings } from '../api/types';
import { formatMoney } from './format';

/*
 * Rider tips (owner, 2026-10-24; backend migration 055). A customer can add a
 * cash tip at checkout (inside the cash the rider collects) or tip from their
 * Blynk Wallet after delivery (Blynk pays the rider). The rider keeps 100%.
 * Every field is optional on the wire - an older API leaves them out - so
 * each helper answers "nothing to show" instead of guessing.
 */

const positive = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0.005 ? Math.round(v * 100) / 100 : 0;
};

/** The cash tip inside the amount to collect, never more than that amount; 0 when none. */
export function cashTipOf(d: Pick<DeliverySummary, 'rider_tip' | 'total_amount'>): number {
  const tip = positive(d.rider_tip);
  if (tip === 0) return 0;
  const total = Number(d.total_amount);
  return Number.isFinite(total) ? Math.min(tip, Math.max(0, total)) : tip;
}

/** "includes LKR 50 tip for you" - one short line; the rider keeps it all. */
export const tipIncludedText = (tip: number) => `includes ${formatMoney(tip)} tip for you`;
export const TIP_KEPT_NOTE = "It's all yours - keep it.";

export interface TipSplit {
  cash: number;
  wallet: number;
  total: number;
}

/**
 * A period's tips from the earnings totals, or null when there are none (or the
 * API predates tips). Uses `tips` when present, else cash + wallet.
 */
export function tipsOf(t: Partial<Pick<EarningsTotals, 'tips' | 'tips_cash' | 'tips_wallet'>> | null | undefined): TipSplit | null {
  if (!t) return null;
  const cash = positive(t.tips_cash);
  const wallet = positive(t.tips_wallet);
  const total = positive(t.tips) || Math.round((cash + wallet) * 100) / 100;
  return total > 0 ? { cash, wallet, total } : null;
}

/** earnings + tips, from the API's total_with_tips or derived. Null when there are no tips. */
export function totalWithTips(t: EarningsTotals): number | null {
  const tips = tipsOf(t);
  if (!tips) return null;
  const given = Number(t.total_with_tips);
  if (Number.isFinite(given) && given > 0) return given;
  return Math.round((Number(t.earnings || 0) + tips.total) * 100) / 100;
}

/** "LKR 120 cash · LKR 80 wallet", leaving out the part that is 0. */
export function tipSplitText(tips: TipSplit): string {
  const parts: string[] = [];
  if (tips.cash > 0) parts.push(`${formatMoney(tips.cash)} cash`);
  if (tips.wallet > 0) parts.push(`${formatMoney(tips.wallet)} wallet`);
  return parts.join(' · ');
}

/* ---- "You received a tip" notice ---- */

const SEEN_KEY = 'blynk.rider.tips.seen';

interface Seen {
  date: string;
  wallet: number;
}

function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Seen>;
    return typeof v.date === 'string' && Number.isFinite(Number(v.wallet)) ? { date: v.date, wallet: Number(v.wallet) } : null;
  } catch {
    return null;
  }
}

function writeSeen(seen: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage blocked or full: the notice may repeat, nothing else breaks.
  }
}

/**
 * The wallet tip that arrived since the rider last looked (today's wallet total
 * minus the last-seen total for the same day), then remembers today's total so
 * it is announced once. Wallet tips are dated by the day they were paid, so a
 * new day starts again from 0. Returns 0 when there is nothing new, the field is
 * missing, or storage is unavailable.
 */
export function takeNewWalletTip(earnings: Pick<RiderEarnings, 'today'> | null | undefined): number {
  const today = earnings?.today;
  if (!today || typeof today.date !== 'string') return 0;
  const wallet = positive(today.tips_wallet);
  const seen = readSeen();
  const before = seen && seen.date === today.date ? seen.wallet : 0;
  if (wallet === before) return 0;
  writeSeen({ date: today.date, wallet });
  return wallet > before ? Math.round((wallet - before) * 100) / 100 : 0;
}

/** "You received a LKR 80 tip". */
export const tipReceivedText = (amount: number) => `You received a ${formatMoney(amount)} tip`;
