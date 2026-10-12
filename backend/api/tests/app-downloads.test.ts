import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import {
  APK_CONTENT_TYPE,
  APP_SHARE_LINKS_KEY,
  SHARE_RATE_LIMIT,
  __setAppFilesDirForTests,
  appFilesDir,
  tokensMatch,
} from '../src/modules/configuration/app-downloads.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Staff app downloads behind sign-in (owner, 2026-10-12): the Blynk Ops and
 * Blynk Rider APKs + manifests are served by the API (backend/api/app-files),
 * not by blynk.lk/download any more.
 *
 * - GET /app-updates/manifest?app=  and  GET|HEAD /app-updates/download?app=
 *   (requireAuth; ops: ADMIN, OPERATIONS; rider: RIDER, ADMIN, OPERATIONS).
 * - GET|PATCH /admin/settings/app-share-links (ADMIN + OPERATIONS, audited
 *   APP_SHARE_LINK_UPDATED) and the public GET|HEAD
 *   /app-updates/share/<token>/<app>.apk while a link is on.
 *
 * Most tests serve small fake files from a temp directory; one reads the
 * committed APKs. Puts the stored share-link row and its audit entries back.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const ROLE_TOKENS = {
  ADMIN: tokens.admin,
  OPERATIONS: opsToken,
  RIDER: tokens.rider,
  CUSTOMER: tokens.customer,
  PACKING_STAFF: tokens.staff,
} as const;
const ALLOWED: Record<'ops' | 'rider', string[]> = {
  ops: ['ADMIN', 'OPERATIONS'],
  rider: ['RIDER', 'ADMIN', 'OPERATIONS'],
};

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;
let tmp: string;
const files: Record<'ops' | 'rider', { apk: Buffer; manifest: Record<string, unknown> }> = {} as never;

function fakeApk(name: string): Buffer {
  return Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.from(`fake ${name} apk `.repeat(500))]);
}

const getManifest = (name: string, token?: string) => {
  const r = request(app).get(`/api/v1/app-updates/manifest?app=${name}`);
  return token ? r.set(auth(token)) : r;
};
const getDownload = (name: string, token?: string) => {
  const r = request(app).get(`/api/v1/app-updates/download?app=${name}`).buffer(true).parse(binaryParser);
  return token ? r.set(auth(token)) : r;
};
const headDownload = (name: string, token: string) => request(app).head(`/api/v1/app-updates/download?app=${name}`).set(auth(token));
const getLinks = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/app-share-links').set(auth(token));
const patchLink = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/app-share-links').set(auth(token)).send(body as object);
const share = (urlPath: string) => request(app).get(`/api/v1${urlPath}`).buffer(true).parse(binaryParser);

function binaryParser(res: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (err: Error) => callback(err, Buffer.alloc(0)));
}

function clearShareLimits() {
  for (const key of authRateLimiter.keys()) if (key.startsWith('app_share_ip:')) authRateLimiter.clear(key);
}

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (
      await pool.query(
        'SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1',
        [APP_SHARE_LINKS_KEY]
      )
    ).rows[0] ?? null;
  await pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_SHARE_LINKS_KEY]);

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-app-files-'));
  for (const name of ['ops', 'rider'] as const) {
    const apk = fakeApk(name);
    const manifest = {
      app: name,
      version_code: name === 'ops' ? 150 : 151,
      version_name: '1.3',
      sha256: createHash('sha256').update(apk).digest('hex'),
      size: apk.length,
      released_at: '2026-10-12T06:00:00.000Z',
    };
    fs.writeFileSync(path.join(tmp, `${name}.apk`), apk);
    fs.writeFileSync(path.join(tmp, `${name}.json`), JSON.stringify(manifest));
    files[name] = { apk, manifest };
  }
});

beforeEach(() => {
  __setAppFilesDirForTests(tmp);
  clearShareLimits();
});
afterEach(() => __setAppFilesDirForTests(null));

afterAll(async () => {
  clearShareLimits();
  await pool.query(`DELETE FROM audit_logs WHERE action = 'APP_SHARE_LINK_UPDATED' AND created_at >= $1`, [testStart]);
  if (!saved) {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_SHARE_LINKS_KEY]);
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [APP_SHARE_LINKS_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Signed-in manifest and download', () => {
  it('role matrix per app: allowed roles get the manifest and the APK; others 403; no token 401', async () => {
    for (const name of ['ops', 'rider'] as const) {
      for (const [role, token] of Object.entries(ROLE_TOKENS)) {
        const m = await getManifest(name, token);
        const d = await getDownload(name, token);
        if (ALLOWED[name].includes(role)) {
          expect(m.status, `${name} manifest as ${role}`).toBe(200);
          expect(m.body).toEqual({ success: true, data: files[name].manifest });
          expect(m.headers['cache-control']).toBe('no-store');
          expect(d.status, `${name} download as ${role}`).toBe(200);
          expect(Buffer.compare(d.body as Buffer, files[name].apk)).toBe(0);
        } else {
          expect(m.status, `${name} manifest as ${role}`).toBe(403);
          expect(m.body.error.code).toBe('FORBIDDEN');
          expect(d.status, `${name} download as ${role}`).toBe(403);
        }
      }
      expect((await getManifest(name)).status).toBe(401);
      expect((await getDownload(name)).status).toBe(401);
      expect((await getManifest(name, 'not-a-jwt')).status).toBe(401);
    }
  });

  it('the APK response: type, length, attachment, no-store', async () => {
    const res = await getDownload('rider', tokens.rider);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(APK_CONTENT_TYPE);
    expect(res.headers['content-length']).toBe(String(files.rider.apk.length));
    expect(res.headers['content-disposition']).toBe('attachment; filename="rider.apk"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(createHash('sha256').update(res.body as Buffer).digest('hex')).toBe(files.rider.manifest.sha256);
  });

  it('HEAD answers the headers only', async () => {
    const res = await headDownload('ops', opsToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(APK_CONTENT_TYPE);
    expect(res.headers['content-length']).toBe(String(files.ops.apk.length));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body === undefined || Object.keys(res.body).length === 0).toBe(true);
    expect((await request(app).head('/api/v1/app-updates/download?app=ops').set(auth(tokens.rider))).status).toBe(403);
  });

  it('an unknown or missing app is a 404, even for Admin; no path tricks', async () => {
    for (const q of ['?app=customer', '?app=', '', '?app=../ops', '?app=ops.apk', '?app=OPS', '?app[]=ops']) {
      expect((await getManifest(q.replace('?app=', ''), tokens.admin)).status, `manifest ${q}`).toBe(404);
      const d = await request(app).get(`/api/v1/app-updates/download${q}`).set(auth(tokens.admin));
      expect(d.status, `download ${q}`).toBe(404);
    }
  });

  it('nothing published yet: 404 NOT_FOUND', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-app-files-empty-'));
    try {
      __setAppFilesDirForTests(empty);
      const m = await getManifest('ops', tokens.admin);
      expect(m.status).toBe(404);
      expect(m.body.error.code).toBe('NOT_FOUND');
      expect((await getDownload('ops', tokens.admin)).status).toBe(404);
      // A malformed manifest is treated as not published.
      fs.writeFileSync(path.join(empty, 'ops.json'), '{"app":"rider","version_code":1}');
      expect((await getManifest('ops', tokens.admin)).status).toBe(404);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('serves the committed APKs (backend/api/app-files): manifest size = APK length', async () => {
    __setAppFilesDirForTests(null);
    expect(appFilesDir().replace(/\\/g, '/')).toMatch(/backend\/api\/app-files$/);
    for (const name of ['ops', 'rider'] as const) {
      const m = await getManifest(name, tokens.admin);
      expect(m.status).toBe(200);
      expect(m.body.data.app).toBe(name);
      const h = await headDownload(name, tokens.admin);
      expect(h.status).toBe(200);
      expect(Number(h.headers['content-length'])).toBe(m.body.data.size);
    }
  });
});

describe('Temporary share link', () => {
  it('off by default: GET says inactive for both apps', async () => {
    for (const token of [tokens.admin, opsToken]) {
      const res = await getLinks(token);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const off = { active: false, path: null, hours: null, created_at: null, expires_at: null };
      expect(res.body.data).toEqual({ ops: off, rider: off, updated_at: null });
    }
  });

  it('on (default 24 h) serves the APK publicly; Off ends it at once; each switch-on is a fresh token; audited without the token', async () => {
    const before = Date.now();
    const on = await patchLink({ app: 'rider', enabled: true }, opsToken);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const link = on.body.data.rider;
    expect(link.active).toBe(true);
    expect(link.hours).toBe(24);
    expect(link.path).toMatch(/^\/app-updates\/share\/[A-Za-z0-9_-]{32}\/rider\.apk$/);
    const expires = Date.parse(link.expires_at);
    expect(expires).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 5_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 5_000);
    expect(on.body.data.ops.active).toBe(false);
    expect((await getLinks()).body.data.rider.path).toBe(link.path);

    // Public: no Authorization header.
    const dl = await share(link.path);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe(APK_CONTENT_TYPE);
    expect(dl.headers['content-length']).toBe(String(files.rider.apk.length));
    expect(dl.headers['content-disposition']).toBe('attachment; filename="rider.apk"');
    expect(dl.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(dl.body as Buffer, files.rider.apk)).toBe(0);
    const head = await request(app).head(`/api/v1${link.path}`);
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(files.rider.apk.length));
    // The token only opens its own app.
    expect((await share(link.path.replace('/rider.apk', '/ops.apk'))).status).toBe(404);

    // Switching on again replaces the link: the old one is dead.
    const again = await patchLink({ app: 'rider', enabled: true, hours: 2 });
    const link2 = again.body.data.rider;
    expect(link2.path).not.toBe(link.path);
    expect(link2.hours).toBe(2);
    expect((await share(link.path)).status).toBe(404);
    expect((await share(link2.path)).status).toBe(200);

    const off = await patchLink({ app: 'rider', enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data.rider).toEqual({ active: false, path: null, hours: null, created_at: null, expires_at: null });
    expect((await share(link2.path)).status).toBe(404);

    const stored = (await pool.query('SELECT value FROM system_configurations WHERE key = $1', [APP_SHARE_LINKS_KEY])).rows[0].value;
    expect(stored.rider).toBeNull();

    const audit = (
      await pool.query(
        `SELECT actor_user_id, old_values, new_values FROM audit_logs
          WHERE action = 'APP_SHARE_LINK_UPDATED' AND created_at >= $1 ORDER BY created_at`,
        [testStart]
      )
    ).rows;
    expect(audit).toHaveLength(3);
    expect(audit[0].old_values).toEqual({ key: APP_SHARE_LINKS_KEY, app: 'rider', active: false });
    expect(audit[0].new_values).toMatchObject({ key: APP_SHARE_LINKS_KEY, app: 'rider', active: true, hours: 24 });
    expect(audit[1].new_values).toMatchObject({ active: true, hours: 2 });
    expect(audit[2].new_values).toEqual({ key: APP_SHARE_LINKS_KEY, app: 'rider', active: false });
    expect(audit.every((a) => a.actor_user_id === users.admin.id)).toBe(true);
    // The token itself is never written to the audit log.
    const tokenOf = (p: string) => p.split('/')[3];
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toContain(tokenOf(link.path));
    expect(auditText).not.toContain(tokenOf(link2.path));
  });

  it('an expired link is a 404 and shows as off', async () => {
    const token = 'E'.repeat(32);
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        APP_SHARE_LINKS_KEY,
        JSON.stringify({
          ops: { token, hours: 1, created_at: new Date(Date.now() - 2 * 3600_000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() },
          rider: null,
        }),
      ]
    );
    const res = await share(`/app-updates/share/${token}/ops.apk`);
    expect(res.status).toBe(404);
    expect((await getLinks()).body.data.ops.active).toBe(false);
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_SHARE_LINKS_KEY]);
  });

  it('wrong, malformed or near-miss tokens and wrong file names are a bare 404', async () => {
    const on = await patchLink({ app: 'ops', enabled: true, hours: 1 });
    const good = on.body.data.ops.path as string;
    const token = good.split('/')[3];
    const nearMiss = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    const bad = [
      `/app-updates/share/${nearMiss}/ops.apk`,
      `/app-updates/share/${token}x/ops.apk`,
      `/app-updates/share/${token.slice(0, 20)}/ops.apk`,
      `/app-updates/share/${'A'.repeat(32)}/ops.apk`,
      `/app-updates/share/${token}/ops.json`,
      `/app-updates/share/${token}/customer.apk`,
      `/app-updates/share/${token}/..%2Fops.apk`,
      `/app-updates/share/${token}/OPS.apk`,
      `/app-updates/share/${token}`,
    ];
    for (const p of bad) {
      const res = await share(p);
      expect(res.status, p).toBe(404);
      expect(res.headers['content-type'] ?? '', p).not.toContain('android');
    }
    expect((await share(good)).status).toBe(200);
    await patchLink({ app: 'ops', enabled: false });
  });

  it('token comparison is constant-time over equal-length digests (different lengths never throw)', () => {
    const t = 'abcdefghijklmnopqrstuvwxyz012345';
    expect(tokensMatch(t, t)).toBe(true);
    expect(tokensMatch(t.slice(0, -1) + '6', t)).toBe(false);
    expect(tokensMatch('short', t)).toBe(false);
    expect(tokensMatch(t + t, t)).toBe(false);
    expect(tokensMatch('', t)).toBe(false);
  });

  it(`rate-limited per IP (${SHARE_RATE_LIMIT.max} per 15 minutes), valid or not`, async () => {
    const path404 = `/app-updates/share/${'Z'.repeat(32)}/ops.apk`;
    for (let i = 0; i < SHARE_RATE_LIMIT.max; i++) expect((await share(path404)).status).toBe(404);
    const limited = await share(path404);
    expect(limited.status).toBe(429);
    clearShareLimits();
    expect((await share(path404)).status).toBe(404);
  });

  it('validates the body (strict, hours 1-72) and changes nothing', async () => {
    const before = (await getLinks()).body.data;
    const bad = [
      {},
      { app: 'ops' },
      { enabled: true },
      { app: 'customer', enabled: true },
      { app: 'ops', enabled: 'yes' },
      { app: 'ops', enabled: true, hours: 0 },
      { app: 'ops', enabled: true, hours: 73 },
      { app: 'ops', enabled: true, hours: 1.5 },
      { app: 'ops', enabled: true, hours: '24' },
      { app: 'ops', enabled: true, token: 'mine' },
    ];
    for (const body of bad) {
      const res = await patchLink(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await getLinks()).body.data).toEqual(before);
    const max = await patchLink({ app: 'ops', enabled: true, hours: 72 });
    expect(max.body.data.ops.hours).toBe(72);
    await patchLink({ app: 'ops', enabled: false });
  });

  it('the setting is Admin and Operations only', async () => {
    for (const token of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await getLinks(token)).status).toBe(403);
      expect((await patchLink({ app: 'ops', enabled: true }, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/app-share-links')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/settings/app-share-links').send({ app: 'ops', enabled: true })).status).toBe(401);
  });
});
