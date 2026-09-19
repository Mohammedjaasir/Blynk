const money = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeMoney = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 });

/** "Rs. 1,690" for whole rupees, "Rs. 1,690.50" otherwise - the cash a rider counts. */
export const formatMoney = (value: number) =>
  `Rs. ${Number.isInteger(value) ? wholeMoney.format(value) : money.format(value)}`;

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
