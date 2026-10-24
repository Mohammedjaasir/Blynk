/** "LKR 1,250.00". Money is always LKR. */
export function lkr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  return `LKR ${Number(value).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number): string {
  return Number(value).toLocaleString('en-LK', { maximumFractionDigits: 3 });
}

/** "24 Oct 2026" from an ISO date or timestamp (shown in Colombo time). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Colombo',
  });
}

/** Parses what a seller typed as a price ("1,250.50"); null if it is not a number. */
export function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/^LKR/i, '');
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Today in Colombo as YYYY-MM-DD. */
export function todayColombo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now);
}
