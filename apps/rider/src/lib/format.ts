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
