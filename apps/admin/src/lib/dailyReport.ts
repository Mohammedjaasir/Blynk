/*
 * The daily report (owner, 2026-10-25: "the 9 pm daily report"): one short SMS a day to the saved
 * numbers - orders, sales, cash, top products, low stock, ratings. GET|PUT
 * /admin/settings/daily-report, POST /admin/daily-report/preview and /send-now
 * (backend/api/src/modules/daily-report, modules/configuration/daily-report.ts). The same helpers
 * live in Ops (apps/operations/src/lib/dailyReport.ts).
 */
export const MAX_REPORT_PHONES = 5;
export const REPORT_MAX_CHARS = 480;
export const DEFAULT_SEND_AT = '21:00';

export interface DailyReportSetting {
  enabled: boolean;
  /** 'HH:MM', Colombo. */
  send_at: string;
  /** +947XXXXXXXX */
  phones: string[];
  /** The Colombo day the automatic report last went out. */
  last_sent_date: string | null;
  last_sent_at: string | null;
  last_sent_kind: 'auto' | 'manual' | null;
  last_manual_at: string | null;
  updated_at: string | null;
}

export interface DailyReportPreview {
  date: string;
  text: string;
  chars: number;
  parts: number;
}

export interface DailyReportSendResult extends DailyReportPreview {
  recipients: number;
  sent_at: string;
}

/** What PUT carries. */
export interface DailyReportDraft {
  enabled: boolean;
  send_at: string;
  phones: string[];
}

export const COOLDOWN_SECONDS = 120;

/** 0771234567 / 94771234567 / +94 77 123 4567 -> +94771234567; null when it is not a Sri Lankan mobile number. */
export function normalizeLkPhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, '');
  if (!cleaned) return null;
  let n = cleaned;
  if (cleaned.startsWith('0')) n = `+94${cleaned.slice(1)}`;
  else if (cleaned.startsWith('94')) n = `+${cleaned}`;
  else if (!cleaned.startsWith('+')) n = `+94${cleaned}`;
  return /^\+94(70|71|72|74|75|76|77|78)\d{7}$/.test(n) ? n : null;
}

/** Why a number cannot be added (null = fine). `existing` are the numbers already on the list. */
export function phoneProblem(input: string, existing: readonly string[]): string | null {
  if (!input.trim()) return 'Type a mobile number.';
  const n = normalizeLkPhone(input);
  if (!n) return 'Enter a Sri Lankan mobile number, like 077 123 4567.';
  if (existing.includes(n)) return 'That number is already on the list.';
  if (existing.length >= MAX_REPORT_PHONES) return `At most ${MAX_REPORT_PHONES} numbers.`;
  return null;
}

/** +94771234567 -> "077 123 4567". */
export function readableLkPhone(phone: string): string {
  const local = phone.startsWith('+94') ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}

/** SMS parts of a plain GSM text: 160 characters in one, then 153 per part. */
export function reportParts(chars: number): number {
  if (chars <= 0) return 0;
  return chars <= 160 ? 1 : Math.ceil(chars / 153);
}

export const partsLabel = (parts: number) => `${parts} SMS part${parts === 1 ? '' : 's'}`;

/** "09:00 PM" style: 21:00 -> "9 pm". */
export function clockLabel(t: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m[2] === '00' ? '' : `:${m[2]}`} ${h < 12 ? 'am' : 'pm'}`;
}

export const isValidSendAt = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function reportPayload(draft: DailyReportDraft): DailyReportDraft {
  return { enabled: draft.enabled, send_at: draft.send_at, phones: [...draft.phones] };
}

export function sameDraft(a: DailyReportDraft, b: DailyReportDraft): boolean {
  return a.enabled === b.enabled && a.send_at === b.send_at && a.phones.length === b.phones.length && a.phones.every((p, i) => p === b.phones[i]);
}

/** "25 Oct 2026, 9:01 pm (Sri Lanka time)" for a stored instant. */
export function colomboWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${(parts.dayPeriod ?? '').toLowerCase()} (Sri Lanka time)`;
}

/** The "Last sent" line: when and how, or that it has not gone out yet. */
export function lastSentText(s: Pick<DailyReportSetting, 'last_sent_at' | 'last_sent_kind'>): string {
  if (!s.last_sent_at) return 'Not sent yet.';
  return `Last sent ${colomboWhen(s.last_sent_at)}${s.last_sent_kind === 'manual' ? ', with Send now' : s.last_sent_kind === 'auto' ? ', automatically' : ''}.`;
}

/** Seconds until "Send now" works again (0 = ready). */
export function cooldownLeft(lastManualAt: string | null, now: number = Date.now()): number {
  if (!lastManualAt) return 0;
  const t = new Date(lastManualAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t + COOLDOWN_SECONDS * 1000 - now) / 1000));
}
