/**
 * Birthday offer helpers (owner, 2026-10-09): X% off ONE order in the
 * customer's birthday week (birthday +-3 days, Asia/Colombo), plus a
 * birthday SMS on the day. The backend is the real guard; these only check
 * input and format dates for the screen.
 */

export const MAX_BIRTHDAY_SMS = 300;

/** % off: more than 0, at most 50, at most 2 decimals (the backend's rule). */
export function parseBirthdayPercent(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { error: 'Enter a percentage from 1 to 50.' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a number, like 10 or 12.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value <= 0) return { error: 'The percentage must be more than 0.' };
  if (value > 50) return { error: 'The percentage can be at most 50.' };
  return { value };
}

/** "10", "12.5" - no trailing zeros. */
export const percentText = (n: number) => String(Number(n.toFixed(2)));

/** The SMS text with {percent} filled in, as the server does it. */
export function fillPercent(text: string, percent: string): string {
  return text.trim().split('{percent}').join(percent);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "YYYY-MM-DD" read as a calendar day - never through Date, so no
 * timezone can move it a day. */
function parts(ymd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return [Number(m[1]), month, Number(m[3])];
}

/** "12 Oct". */
export function formatDayMonth(ymd: string): string {
  const p = parts(ymd);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]}` : ymd;
}

/** "12 Oct 1990". */
export function formatDayMonthYear(ymd: string): string {
  const p = parts(ymd);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}` : ymd;
}

/** "Today", "Tomorrow", "In 2 days", "Yesterday", "2 days ago". */
export function birthdayWhen(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil === -1) return 'Yesterday';
  return daysUntil > 0 ? `In ${daysUntil} days` : `${-daysUntil} days ago`;
}
