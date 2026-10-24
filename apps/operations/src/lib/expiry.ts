import type { BatchBucket, BatchSeverity, ExpirySummary, StockBatch } from '../api/expiry';

/**
 * Expiry dates (wave 2, 2026-10-25; migration 059): the words and checks the Expiry screens use.
 * Dates are Colombo calendar days ('YYYY-MM-DD'); the API sends days_left, severity and a label for every
 * batch, so the screen never does date arithmetic of its own except to check a typed date.
 */
export const MAX_BATCH_QUANTITY = 1_000_000;

export const BUCKETS: Array<{ id: BatchBucket; label: string; hint: string }> = [
  { id: 'expired', label: 'Expired', hint: 'Out of date: throw these away' },
  { id: 'week', label: 'This week', hint: 'Expires today or within 7 days' },
  { id: 'month', label: 'This month', hint: 'Expires in 8 to 30 days' },
  { id: 'all', label: 'All open', hint: 'Every batch still on the shelf' },
];

/** The Colombo calendar day of `at`, 'YYYY-MM-DD'. */
export function colomboToday(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  return parts; // en-CA prints 2026-10-25
}

/** "25 Oct 2026" for a 'YYYY-MM-DD'. */
export function dayText(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "12 pcs", "3 x Milk 1 L" style count: plain whole number with thousands separators. */
export const unitsText = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'unit' : 'units'}`;

/** CSS modifier of a severity: expired and <= 7 days are red, <= 30 days amber. */
export const severityClass = (s: BatchSeverity) => `expiry-chip expiry-chip--${s}`;

/** The product line: name plus the variant, if any. */
export const batchTitle = (b: Pick<StockBatch, 'product_name' | 'variant_label'>) =>
  b.variant_label ? `${b.product_name} (${b.variant_label})` : b.product_name;

export function summaryCount(summary: ExpirySummary | null, bucket: BatchBucket): number | null {
  if (!summary) return null;
  if (bucket === 'all') return summary.total_active;
  return summary[bucket].batches;
}

/** What the "expiring soon" chips say; null when nothing is expired or expiring within 30 days. */
export function chipLines(summary: ExpirySummary | null): Array<{ severity: BatchSeverity; text: string; bucket: BatchBucket }> {
  if (!summary) return [];
  const out: Array<{ severity: BatchSeverity; text: string; bucket: BatchBucket }> = [];
  if (summary.expired.batches > 0) {
    out.push({ severity: 'expired', bucket: 'expired', text: `${summary.expired.batches} expired (${unitsText(summary.expired.units)})` });
  }
  if (summary.week.batches > 0) {
    out.push({ severity: 'red', bucket: 'week', text: `${summary.week.batches} expiring this week (${unitsText(summary.week.units)})` });
  }
  if (summary.month.batches > 0) {
    out.push({ severity: 'amber', bucket: 'month', text: `${summary.month.batches} this month (${unitsText(summary.month.units)})` });
  }
  return out;
}

export interface BatchForm {
  quantity: string;
  expires_on: string;
  batch_code: string;
  note: string;
}

/** Checks the add / edit form; the server checks again. */
export function parseBatchForm(
  form: BatchForm,
  today: string = colomboToday()
): { value: { quantity: number; expires_on: string; batch_code: string | null; note: string | null } } | { error: string } {
  const q = form.quantity.trim();
  if (!/^\d+$/.test(q)) return { error: 'Enter how many units, as a whole number.' };
  const quantity = Number(q);
  if (quantity < 1) return { error: 'How many must be at least 1.' };
  if (quantity > MAX_BATCH_QUANTITY) return { error: 'That quantity is too large.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expires_on)) return { error: 'Pick the expiry date.' };
  const d = new Date(`${form.expires_on}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== form.expires_on) return { error: 'That is not a real date.' };
  const days = Math.round((d.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  if (days < -365 || days > 3650) return { error: 'The expiry date is too far in the past or future.' };
  const code = form.batch_code.trim();
  if (code.length > 60) return { error: 'The batch code can be 60 characters at most.' };
  const note = form.note.trim();
  if (note.length > 300) return { error: 'The note can be 300 characters at most.' };
  return { value: { quantity, expires_on: form.expires_on, batch_code: code || null, note: note || null } };
}

/** Message after a discard: what came off stock. */
export function discardedText(name: string, removed: number): string {
  return removed > 0
    ? `${name} discarded. ${unitsText(removed)} taken off the stock count.`
    : `${name} discarded. Stock count unchanged.`;
}
