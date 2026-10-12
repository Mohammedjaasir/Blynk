import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import type { UserRole } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { clientIp } from '../../utils/client-ip.js';
import { logger } from '../../utils/logger.js';
import { authRateLimiter } from '../auth/auth.rate-limiter.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Staff app downloads (owner, 2026-10-12): the Blynk Ops and Blynk Rider APKs
 * are no longer public (https://blynk.lk/download/ is closed). The API serves
 * them, from a fixed file per app in APP_FILES_DIR (backend/api/app-files,
 * baked into the Docker image):
 *
 * - GET /app-updates/manifest?app=ops|rider   the version manifest (JSON)
 * - GET|HEAD /app-updates/download?app=...     the APK
 *   Signed in only: ops = ADMIN, OPERATIONS; rider = RIDER, ADMIN, OPERATIONS.
 *
 * - GET|HEAD /app-updates/share/<token>/<app>.apk  PUBLIC, only while Admin or
 *   Operations has switched on that app's temporary share link (1-72 hours).
 *   Each switch-on makes a fresh random token; Off or the expiry ends it. A
 *   wrong, old or expired token is a plain 404. Rate-limited per IP.
 *
 * Share links live in system_configurations 'app_share_links'
 * {"ops": ShareLink | null, "rider": ShareLink | null}; no migration. The token
 * is never written to the audit log (APP_SHARE_LINK_UPDATED keeps only on/off,
 * hours and expiry).
 */
export const STAFF_APP_NAMES = ['ops', 'rider'] as const;
export type StaffAppName = (typeof STAFF_APP_NAMES)[number];

export const APP_DOWNLOAD_ROLES: Record<StaffAppName, UserRole[]> = {
  ops: ['ADMIN', 'OPERATIONS'],
  rider: ['RIDER', 'ADMIN', 'OPERATIONS'],
};

export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';
export const APP_SHARE_LINKS_KEY = 'app_share_links';
export const SHARE_MIN_HOURS = 1;
export const SHARE_MAX_HOURS = 72;
export const SHARE_DEFAULT_HOURS = 24;
/** 24 random bytes = 32 base64url characters. */
const SHARE_TOKEN_BYTES = 24;
const SHARE_TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;
/** Per IP, for the public share route (valid and invalid tries alike). */
export const SHARE_RATE_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };

// ----------------------------------------------------------------------------
// Files
// ----------------------------------------------------------------------------
const DEFAULT_FILES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app-files');
let filesDirOverride: string | null = null;

export function appFilesDir(): string {
  if (filesDirOverride) return filesDirOverride;
  return env.APP_FILES_DIR ? path.resolve(env.APP_FILES_DIR) : DEFAULT_FILES_DIR;
}

/** Tests only: serve from another directory (null = back to the default). */
export function __setAppFilesDirForTests(dir: string | null): void {
  filesDirOverride = dir;
}

/** Fixed names only - nothing from the request is ever part of a path. */
const FILE_NAMES: Record<StaffAppName, { apk: string; manifest: string }> = {
  ops: { apk: 'ops.apk', manifest: 'ops.json' },
  rider: { apk: 'rider.apk', manifest: 'rider.json' },
};

export function isStaffApp(value: unknown): value is StaffAppName {
  return typeof value === 'string' && (STAFF_APP_NAMES as readonly string[]).includes(value);
}

export interface AppManifest {
  app: StaffAppName;
  version_code: number;
  version_name: string;
  sha256: string;
  size: number;
  released_at: string;
}

const notPublished = () => new AppError('This app has not been published yet.', 404, 'NOT_FOUND');

/** The published manifest, or null when it is missing or malformed. */
export async function readManifest(app: StaffAppName): Promise<AppManifest | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(path.join(appFilesDir(), FILE_NAMES[app].manifest), 'utf8');
  } catch {
    return null;
  }
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (
      v.app !== app ||
      typeof v.version_code !== 'number' ||
      !Number.isInteger(v.version_code) ||
      v.version_code < 1 ||
      typeof v.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(v.sha256) ||
      typeof v.size !== 'number' ||
      !Number.isInteger(v.size) ||
      v.size <= 0
    ) {
      logger.warn({ app }, 'Staff app manifest is malformed');
      return null;
    }
    return {
      app,
      version_code: v.version_code,
      version_name: typeof v.version_name === 'string' ? v.version_name : String(v.version_code),
      sha256: v.sha256.toLowerCase(),
      size: v.size,
      released_at: typeof v.released_at === 'string' ? v.released_at : '',
    };
  } catch {
    logger.warn({ app }, 'Staff app manifest is not valid JSON');
    return null;
  }
}

/**
 * Streams the app's APK. Returns false (nothing sent) when the file is
 * missing, so the caller decides the 404 (detailed for staff, bare for a
 * share link).
 */
async function sendApk(app: StaffAppName, req: Request, res: Response): Promise<boolean> {
  const file = path.join(appFilesDir(), FILE_NAMES[app].apk);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.status(200);
  res.set({
    'Content-Type': APK_CONTENT_TYPE,
    'Content-Length': String(stat.size),
    'Content-Disposition': `attachment; filename="${FILE_NAMES[app].apk}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise<void>((resolve) => {
    const stream = fs.createReadStream(file);
    const done = () => resolve();
    stream.on('error', (err) => {
      logger.error({ err, app }, 'Staff app download failed while streaming');
      res.destroy(err);
      done();
    });
    res.on('close', () => {
      stream.destroy();
      done();
    });
    stream.on('end', done);
    stream.pipe(res);
  });
  return true;
}

// ----------------------------------------------------------------------------
// Signed-in routes
// ----------------------------------------------------------------------------
/** ?app=ops|rider, an unknown app is a 404; then the per-app roles (403). requireAuth runs first. */
function staffAppFor(req: Request): StaffAppName {
  const app = req.query.app;
  if (!isStaffApp(app)) throw new AppError('Unknown app.', 404, 'NOT_FOUND');
  if (!req.user || !APP_DOWNLOAD_ROLES[app].includes(req.user.role)) {
    throw new AppError("Your account can't download this app.", 403, 'FORBIDDEN');
  }
  return app;
}

export async function manifestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const app = staffAppFor(req);
    const manifest = await readManifest(app);
    if (!manifest) throw notPublished();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: manifest });
  } catch (err) {
    next(err);
  }
}

export async function downloadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const app = staffAppFor(req);
    if (!(await sendApk(app, req, res))) throw notPublished();
  } catch (err) {
    if (res.headersSent) return;
    next(err);
  }
}

// ----------------------------------------------------------------------------
// Temporary share links
// ----------------------------------------------------------------------------
interface StoredShareLink {
  token: string;
  hours: number;
  created_at: string;
  expires_at: string;
}
type StoredShareLinks = Record<StaffAppName, StoredShareLink | null>;

/** What Admin and Operations see. `path` is relative to the API base (…/api/v1). */
export interface ShareLinkView {
  active: boolean;
  path: string | null;
  hours: number | null;
  created_at: string | null;
  expires_at: string | null;
}
export type ShareLinksView = Record<StaffAppName, ShareLinkView>;

function storedLinkFrom(value: unknown): StoredShareLink | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.token !== 'string' || !SHARE_TOKEN_SHAPE.test(v.token)) return null;
  if (typeof v.expires_at !== 'string' || Number.isNaN(Date.parse(v.expires_at))) return null;
  return {
    token: v.token,
    hours: typeof v.hours === 'number' ? v.hours : 0,
    created_at: typeof v.created_at === 'string' ? v.created_at : '',
    expires_at: v.expires_at,
  };
}

function storedLinksFrom(value: unknown): StoredShareLinks {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { ops: storedLinkFrom(v.ops), rider: storedLinkFrom(v.rider) };
}

const isLive = (link: StoredShareLink | null, now: number): link is StoredShareLink =>
  !!link && Date.parse(link.expires_at) > now;

export const sharePath = (app: StaffAppName, token: string) => `/app-updates/share/${token}/${FILE_NAMES[app].apk}`;

function viewOf(app: StaffAppName, link: StoredShareLink | null, now: number): ShareLinkView {
  if (!isLive(link, now)) return { active: false, path: null, hours: null, created_at: null, expires_at: null };
  return {
    active: true,
    path: sharePath(app, link.token),
    hours: link.hours,
    created_at: link.created_at || null,
    expires_at: link.expires_at,
  };
}

/** Constant-time: both sides are hashed to the same length first. */
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export const updateShareLinkSchema = z
  .object({
    app: z.enum(STAFF_APP_NAMES, { errorMap: () => ({ message: "app must be 'ops' or 'rider'" }) }),
    enabled: z.boolean({ required_error: 'enabled is required', invalid_type_error: 'enabled must be true or false' }),
    hours: z
      .number({ invalid_type_error: 'hours must be a whole number' })
      .int('hours must be a whole number')
      .min(SHARE_MIN_HOURS, `hours must be from ${SHARE_MIN_HOURS} to ${SHARE_MAX_HOURS}`)
      .max(SHARE_MAX_HOURS, `hours must be from ${SHARE_MIN_HOURS} to ${SHARE_MAX_HOURS}`)
      .optional(),
  })
  .strict();
export type UpdateShareLinkInput = z.infer<typeof updateShareLinkSchema>;

export class AppShareLinksService {
  constructor(private readonly clock: () => number = () => Date.now()) {}

  private async stored(): Promise<{ links: StoredShareLinks; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', APP_SHARE_LINKS_KEY)
      .executeTakeFirst();
    return { links: storedLinksFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  async get(): Promise<ShareLinksView & { updated_at: Date | null }> {
    const { links, updated_at } = await this.stored();
    const now = this.clock();
    return { ops: viewOf('ops', links.ops, now), rider: viewOf('rider', links.rider, now), updated_at };
  }

  /** The live token for this app, or null (off, expired or unreadable). */
  async liveToken(app: StaffAppName): Promise<string | null> {
    const { links } = await this.stored();
    const link = links[app];
    return isLive(link, this.clock()) ? link.token : null;
  }

  /**
   * On: a fresh token valid for `hours` (default 24) - switching on again
   * replaces the old link. Off: the token is deleted. Audited
   * (APP_SHARE_LINK_UPDATED) without the token.
   */
  async set(input: UpdateShareLinkInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', APP_SHARE_LINKS_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = storedLinksFrom(before?.value);
      const now = this.clock();
      const next: StoredShareLinks = { ...previous };
      if (input.enabled) {
        const hours = input.hours ?? SHARE_DEFAULT_HOURS;
        next[input.app] = {
          token: randomBytes(SHARE_TOKEN_BYTES).toString('base64url'),
          hours,
          created_at: new Date(now).toISOString(),
          expires_at: new Date(now + hours * 60 * 60 * 1000).toISOString(),
        };
      } else {
        next[input.app] = null;
      }
      // Expired links are dropped while we are here.
      for (const app of STAFF_APP_NAMES) if (!isLive(next[app], now)) next[app] = null;
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: APP_SHARE_LINKS_KEY, value, description: 'Staff app temporary public download links (per app token + expiry)' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      const summary = (l: StoredShareLink | null) =>
        isLive(l, now) ? { active: true, hours: l.hours, expires_at: l.expires_at } : { active: false };
      await writeAudit(trx, actor, {
        action: 'APP_SHARE_LINK_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: APP_SHARE_LINKS_KEY, app: input.app, ...summary(previous[input.app]) },
        newValues: { key: APP_SHARE_LINKS_KEY, app: input.app, ...summary(next[input.app]) },
      });
      logger.info(
        { app: input.app, enabled: input.enabled, expiresAt: next[input.app]?.expires_at ?? null, actorId: actor.actorId },
        'Staff app share link changed'
      );
    });
    return this.get();
  }
}

export const appShareLinksService = new AppShareLinksService();

const SHARE_FILE = /^(ops|rider)\.apk$/;

/** PUBLIC GET|HEAD /app-updates/share/:token/:file - a bare 404 for anything but a live link. */
export async function shareDownloadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    authRateLimiter.checkLimit(
      `app_share_ip:${clientIp(req) ?? 'unknown'}`,
      SHARE_RATE_LIMIT.max,
      SHARE_RATE_LIMIT.windowMs,
      'Too many download attempts. Please wait before retrying.'
    );
    const token = String(req.params.token ?? '');
    const match = SHARE_FILE.exec(String(req.params.file ?? ''));
    const app = match ? (match[1] as StaffAppName) : null;
    const live = app && SHARE_TOKEN_SHAPE.test(token) ? await appShareLinksService.liveToken(app) : null;
    if (!app || !live || !tokensMatch(token, live)) throw new AppError('Not found.', 404, 'NOT_FOUND');
    res.set('Referrer-Policy', 'no-referrer');
    if (!(await sendApk(app, req, res))) throw new AppError('Not found.', 404, 'NOT_FOUND');
  } catch (err) {
    if (res.headersSent) return;
    next(err);
  }
}
