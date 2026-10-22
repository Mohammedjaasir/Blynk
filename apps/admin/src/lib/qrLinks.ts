import QRCode from 'qrcode';
import { SHOP_URL } from '../components/ProductAdLinks';

/*
 * QR links (owner, 2026-10-22: "i need a dynamic QR code to put in the jersey"). The code printed
 * on a jersey or poster never changes: it always encodes the short address <site>/q/<code>. Staff
 * choose here where that address leads and can change it any time, GET|PUT
 * /admin/settings/qr-links (the whole list is replaced on every save). Limits and rules match
 * backend/api/src/modules/configuration/qr-links.ts.
 */
export const QR_LIMITS = { links: 30, code: 24, label: 40, url: 500 } as const;

/** What staff edit, and what PUT carries. */
export interface QrLink {
  code: string;
  label: string;
  url: string;
}
/** A link with its scan numbers, as GET and PUT return it. */
export interface QrLinkView extends QrLink {
  scans_total: number;
  scans_7_days: number;
  scans_today: number;
  last_scan_at: string | null;
}
export interface QrLinksSetting {
  links: QrLinkView[];
  updated_at: string | null;
}

const CODE = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;

/** The code as typed becomes lowercase, trimmed (the server lowercases too). */
export const normalizeQrCode = (code: string) => code.trim().toLowerCase();

/** Why a code cannot be used (null = fine). `others` are the codes already in the list. */
export function qrCodeProblem(code: string, others: readonly string[] = []): string | null {
  const c = normalizeQrCode(code);
  if (!CODE.test(c)) return `1 to ${QR_LIMITS.code} letters, digits or dashes (not at the ends)`;
  if (others.includes(c)) return `The code "${c}" is already used`;
  return null;
}

export function qrLabelProblem(label: string): string | null {
  const l = label.trim();
  if (!l) return 'Give the link a name';
  if (l.length > QR_LIMITS.label) return `At most ${QR_LIMITS.label} characters`;
  return null;
}

/** https only, a real host, no sign-in inside: the one kind of address a printed code may lead to. */
export function qrUrlProblem(url: string): string | null {
  const v = url.trim();
  if (v.length > QR_LIMITS.url) return `At most ${QR_LIMITS.url} characters`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'Enter a full web address, like https://blynk.lk/app/';
  }
  if (u.protocol !== 'https:') return 'The address must start with https://';
  if (!u.hostname.includes('.')) return 'Enter a full web address, like https://blynk.lk/app/';
  if (u.username || u.password) return 'The address cannot contain a sign-in';
  return null;
}

/** What is wrong with a link, field by field (empty object = fine). */
export function qrLinkProblems(link: QrLink, others: readonly string[] = []): Partial<Record<keyof QrLink, string>> {
  const out: Partial<Record<keyof QrLink, string>> = {};
  const code = qrCodeProblem(link.code, others);
  const label = qrLabelProblem(link.label);
  const url = qrUrlProblem(link.url);
  if (code) out.code = code;
  if (label) out.label = label;
  if (url) out.url = url;
  return out;
}

/** The address a printed QR carries. Never the destination. */
export const qrShortAddress = (code: string) => `${SHOP_URL}/q/${code}`;

const BLYNK_HOST = 'blynk.lk';
function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}
/** True when the destination is a real address somewhere other than blynk.lk (or this site). */
export function leavesBlynk(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const own = hostOf(SHOP_URL);
  return !(host === BLYNK_HOST || host.endsWith(`.${BLYNK_HOST}`) || host === own);
}

const TAGS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
const tagValues = (code: string) => ({ utm_source: code, utm_medium: 'qr', utm_campaign: code });

/** True when the destination already carries all three campaign tags. */
export function hasCampaignTags(url: string): boolean {
  try {
    const p = new URL(url.trim()).searchParams;
    return TAGS.every((t) => p.has(t));
  } catch {
    return false;
  }
}
/** Adds utm_source=<code>&utm_medium=qr&utm_campaign=<code> where missing; other tags are left alone. */
export function withCampaignTags(url: string, code: string): string {
  try {
    const u = new URL(url.trim());
    const values = tagValues(normalizeQrCode(code));
    for (const t of TAGS) if (!u.searchParams.has(t)) u.searchParams.set(t, values[t]);
    return u.toString();
  } catch {
    return url;
  }
}
/** Takes the three campaign tags off again. */
export function withoutCampaignTags(url: string): string {
  try {
    const u = new URL(url.trim());
    for (const t of TAGS) u.searchParams.delete(t);
    return u.toString();
  } catch {
    return url;
  }
}

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Colombo',
});
/** "22 Oct 2026, 14:05 (Sri Lanka time)", or "No scans yet". */
export function lastScanText(iso: string | null): string {
  if (!iso) return 'No scans yet';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'No scans yet' : `${when.format(d)} (Sri Lanka time)`;
}

/** What PUT carries: trimmed, code lowercased, nothing else. */
export function qrLinksPayload(links: readonly QrLink[]): { links: QrLink[] } {
  return { links: links.map((l) => ({ code: normalizeQrCode(l.code), label: l.label.trim(), url: l.url.trim() })) };
}

// Printed matter: error correction H (a scuffed jersey still scans), a 4-module quiet zone, dark on
// white and never inverted.
const QR_STYLE = { errorCorrectionLevel: 'H' as const, margin: 4, color: { dark: '#12151F', light: '#FFFFFF' } };
export const QR_PNG_SIZE = 1600;

/** The QR of a code's short address as an SVG string (shown on the page and downloaded for print). */
export function qrSvg(code: string): Promise<string> {
  return QRCode.toString(qrShortAddress(code), { ...QR_STYLE, type: 'svg' });
}
/** The same QR as a 1600px PNG data URL. */
export function qrPngDataUrl(code: string): Promise<string> {
  return QRCode.toDataURL(qrShortAddress(code), { ...QR_STYLE, width: QR_PNG_SIZE });
}

export const qrFileName = (code: string, ext: 'svg' | 'png') => `blynk-qr-${code}.${ext}`;

/** Saves a file in the browser. */
export function saveHref(href: string, fileName: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
export function saveSvg(svg: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  saveHref(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
