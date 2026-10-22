import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * QR links (owner, 2026-10-22: "i need a dynamic QR code to put in the jersey"). A printed QR
 * cannot change, so it carries a short address that never does - https://blynk.lk/q/<code> -
 * and staff decide in Admin / Ops where that address leads, now and later, and see how many
 * people scanned it. The landing site's /q page asks GET /go/:code for the destination and
 * sends the visitor there (and to the shop if anything is missing).
 *
 * Stored in system_configurations (no migration):
 *   'qr_links'  { links: [{ code, label, url }] }   - what staff edit
 *   'qr_scans'  { <code>: { total, last_at, days: { 'YYYY-MM-DD': n } } }  - written by scans
 * With no row the jersey code (j) exists, leading to the shop, so a code can be printed before
 * anyone has saved anything.
 *
 * Staff:  GET|PUT /admin/settings/qr-links (ADMIN, OPERATIONS; audited QR_LINKS_UPDATED).
 * Public: GET /go/:code -> { url } (no store, never cached); a scan is counted.
 */
export const QR_LINKS_KEY = 'qr_links';
export const QR_SCANS_KEY = 'qr_scans';

export const SHOP_URL = 'https://blynk.lk/app/';
export const QR_LIMITS = { links: 30, code: 24, label: 40, url: 500, daysKept: 60 } as const;

export const DEFAULT_QR_LINKS: QrLink[] = [
  { code: 'j', label: 'Jersey', url: `${SHOP_URL}?utm_source=jersey&utm_medium=qr&utm_campaign=jersey` },
];

const CODE = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;
const oneLine = /^[^\r\n\t]*$/;

/** https only, a real host, no embedded login: the one kind of address a printed code may lead to. */
const url = z
  .string({ invalid_type_error: 'Must be a web address' })
  .trim()
  .max(QR_LIMITS.url, `At most ${QR_LIMITS.url} characters`)
  .superRefine((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a full web address, like https://blynk.lk/app/' });
      return;
    }
    if (u.protocol !== 'https:') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The address must start with https://' });
    else if (!u.hostname.includes('.')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a full web address, like https://blynk.lk/app/' });
    else if (u.username || u.password) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The address cannot contain a sign-in' });
  });

const linkSchema = z.object({
  code: z
    .string({ invalid_type_error: 'Must be text' })
    .trim()
    .toLowerCase()
    .regex(CODE, `1 to ${QR_LIMITS.code} letters, digits or dashes (not at the ends)`),
  label: z
    .string({ invalid_type_error: 'Must be text' })
    .trim()
    .min(1, 'Give the link a name')
    .max(QR_LIMITS.label, `At most ${QR_LIMITS.label} characters`)
    .regex(oneLine, 'Must be on one line'),
  url,
});
export type QrLink = z.infer<typeof linkSchema>;

export const updateQrLinksSchema = z
  .object({ links: z.array(linkSchema).max(QR_LIMITS.links, `At most ${QR_LIMITS.links} links`) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.links.forEach((l, i) => {
      if (seen.has(l.code)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['links', i, 'code'], message: `The code "${l.code}" is used twice` });
      seen.add(l.code);
    });
  });
export type UpdateQrLinksInput = z.infer<typeof updateQrLinksSchema>;

interface ScanCounter {
  total: number;
  last_at: string | null;
  days: Record<string, number>;
}
type Scans = Record<string, ScanCounter>;

export interface QrLinkView extends QrLink {
  scans_total: number;
  scans_7_days: number;
  scans_today: number;
  last_scan_at: string | null;
}

/** A stored row as a list of links; a malformed link is dropped, the rest are kept. */
export function qrLinksFrom(value: unknown): QrLink[] {
  const raw = value && typeof value === 'object' ? (value as { links?: unknown }).links : undefined;
  if (!Array.isArray(raw)) return DEFAULT_QR_LINKS.map((l) => ({ ...l }));
  const out: QrLink[] = [];
  for (const item of raw) {
    const parsed = linkSchema.safeParse(item);
    if (parsed.success && !out.some((l) => l.code === parsed.data.code)) out.push(parsed.data);
  }
  return out;
}

const colomboDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function scansFrom(value: unknown): Scans {
  const out: Scans = {};
  if (!value || typeof value !== 'object') return out;
  for (const [code, c] of Object.entries(value as Record<string, unknown>)) {
    if (!c || typeof c !== 'object') continue;
    const k = c as Partial<ScanCounter>;
    out[code] = {
      total: Number.isFinite(k.total) ? Number(k.total) : 0,
      last_at: typeof k.last_at === 'string' ? k.last_at : null,
      days: k.days && typeof k.days === 'object' ? (k.days as Record<string, number>) : {},
    };
  }
  return out;
}

export function viewOf(links: QrLink[], scans: Scans, now = new Date()): QrLinkView[] {
  const today = colomboDay(now);
  const week = Array.from({ length: 7 }, (_, i) => colomboDay(new Date(now.getTime() - i * 864e5)));
  return links.map((l) => {
    const c = scans[l.code];
    return {
      ...l,
      scans_total: c?.total ?? 0,
      scans_7_days: c ? week.reduce((n, d) => n + (c.days[d] ?? 0), 0) : 0,
      scans_today: c?.days[today] ?? 0,
      last_scan_at: c?.last_at ?? null,
    };
  });
}

export class QrLinksService {
  private async row(key: string) {
    return db.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', key).executeTakeFirst();
  }

  async get(): Promise<{ links: QrLinkView[]; updated_at: Date | null }> {
    const [links, scans] = await Promise.all([this.row(QR_LINKS_KEY), this.row(QR_SCANS_KEY)]);
    return { links: viewOf(qrLinksFrom(links?.value), scansFrom(scans?.value)), updated_at: links?.updated_at ?? null };
  }

  /** Replaces the list. Audited (QR_LINKS_UPDATED); printed codes follow it on their next scan. */
  async set(input: UpdateQrLinksInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('system_configurations').select('value').where('key', '=', QR_LINKS_KEY).forUpdate().executeTakeFirst();
      const value = JSON.stringify({ links: input.links });
      await trx
        .insertInto('system_configurations')
        .values({ key: QR_LINKS_KEY, value, description: 'QR links: short codes (blynk.lk/q/<code>) and where they lead' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'QR_LINKS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: QR_LINKS_KEY, links: qrLinksFrom(before?.value) },
        newValues: { key: QR_LINKS_KEY, links: input.links },
      });
      logger.info({ actorId: actor.actorId, links: input.links.length }, 'QR links changed');
    });
    return this.get();
  }

  /**
   * Where a code leads, counting the scan; null for a code that does not exist. A failed count
   * never stops the visitor getting where they are going.
   */
  async resolve(code: string, now = new Date()): Promise<string | null> {
    const wanted = code.trim().toLowerCase();
    if (!CODE.test(wanted)) return null;
    const link = qrLinksFrom((await this.row(QR_LINKS_KEY))?.value).find((l) => l.code === wanted);
    if (!link) return null;
    try {
      await this.countScan(wanted, now);
    } catch (err) {
      logger.warn({ err, code: wanted }, 'Could not count a QR scan');
    }
    return link.url;
  }

  private async countScan(code: string, now: Date) {
    await db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('system_configurations').select('value').where('key', '=', QR_SCANS_KEY).forUpdate().executeTakeFirst();
      const scans = scansFrom(row?.value);
      const c = scans[code] ?? { total: 0, last_at: null, days: {} };
      const today = colomboDay(now);
      c.total += 1;
      c.last_at = now.toISOString();
      c.days[today] = (c.days[today] ?? 0) + 1;
      const keep = new Set(Array.from({ length: QR_LIMITS.daysKept }, (_, i) => colomboDay(new Date(now.getTime() - i * 864e5))));
      c.days = Object.fromEntries(Object.entries(c.days).filter(([d]) => keep.has(d)));
      scans[code] = c;
      const value = JSON.stringify(scans);
      await trx
        .insertInto('system_configurations')
        .values({ key: QR_SCANS_KEY, value, description: 'QR link scan counters (written by scans)' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
    });
  }
}

export const qrLinksService = new QrLinksService();
