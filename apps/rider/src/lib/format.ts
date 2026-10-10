const money = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeMoney = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 });

/** "LKR 1,690" for whole rupees, "LKR 1,690.50" otherwise - the cash a rider counts. */
export const formatMoney = (value: number) =>
  `LKR ${Number.isInteger(value) ? wholeMoney.format(value) : money.format(value)}`;

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });

/** Store-local clock time (Asia/Colombo), e.g. "14:05". */
export const formatTime = (iso: string | Date) => time.format(typeof iso === 'string' ? new Date(iso) : iso);

/** "+94771234567" → "077 123 4567" for reading aloud; the tel: link keeps the raw number. */
export function formatPhone(phone: string): string {
  const local = phone.replace(/^\+94/, '0').replace(/\s+/g, '');
  return /^0\d{9}$/.test(local) ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : phone;
}

/** Order numbers are long; riders say the tail. "BLK-20260918-0042" → "0042". */
export const shortOrderNumber = (orderNumber: string) => orderNumber.split('-').pop() ?? orderNumber;

/**
 * How long ago something happened, in the same steps the customer app uses for
 * "Last seen ...": seconds under a minute, whole minutes under an hour, whole
 * hours after that. "4s ago", "2 min ago", "1 h ago". A negative age (clock
 * skew) reads as "0s ago" rather than a negative number.
 */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s ago`;
  if (whole < 3600) return `${Math.floor(whole / 60)} min ago`;
  return `${Math.floor(whole / 3600)} h ago`;
}

/*
 * Scheduled delivery slots (owner, 2026-10-10): an order placed for a slot
 * carries scheduled_for (slot start) and scheduled_until (slot end, null on
 * older orders). Riders read it as "Scheduled: Tomorrow 8–10 AM", in store
 * time (Asia/Colombo), the same wording the customer picked.
 */
const colomboParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});
const colomboDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

function partsOf(date: Date) {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(colomboParts.formatToParts(date).find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** Whole calendar days from `now` to `date`, both in Asia/Colombo (owner, 2026-10-10). */
function colomboDayOffset(date: Date, now: Date): number {
  const a = partsOf(date);
  const b = partsOf(now);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000);
}

/** 'Today' | 'Tomorrow' | 'Sat 12 Oct' for a slot start (owner, 2026-10-10). */
export function formatSlotDay(date: Date, now: Date = new Date()): string {
  const offset = colomboDayOffset(date, now);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return colomboDay.format(date).replace(',', '');
}

function clock(hour: number, minute: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { text: minute === 0 ? `${h12}` : `${h12}:${String(minute).padStart(2, '0')}`, meridiem: hour < 12 ? 'AM' : 'PM' };
}

/**
 * '8 AM', '4–6 PM', '11 AM–1 PM', '8:30–9:30 AM' (en dash; the meridiem is
 * written once when both ends share it) (owner, 2026-10-10).
 */
export function formatSlotTime(start: Date, end: Date | null): string {
  const s = partsOf(start);
  const a = clock(s.hour, s.minute);
  if (!end) return `${a.text} ${a.meridiem}`;
  const e = partsOf(end);
  const b = clock(e.hour, e.minute);
  return a.meridiem === b.meridiem
    ? `${a.text}–${b.text} ${b.meridiem}`
    : `${a.text} ${a.meridiem}–${b.text} ${b.meridiem}`;
}

/**
 * "Scheduled: Tomorrow 8–10 AM", or "Scheduled: Today 8 AM" when the slot end
 * is unknown; null when the order is not scheduled or the date is unreadable
 * (owner, 2026-10-10).
 */
export function formatScheduledSlot(
  scheduledFor: string | null | undefined,
  scheduledUntil: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!scheduledFor) return null;
  const start = new Date(scheduledFor);
  if (Number.isNaN(start.getTime())) return null;
  const endRaw = scheduledUntil ? new Date(scheduledUntil) : null;
  const end = endRaw && !Number.isNaN(endRaw.getTime()) ? endRaw : null;
  return `Scheduled: ${formatSlotDay(start, now)} ${formatSlotTime(start, end)}`;
}
