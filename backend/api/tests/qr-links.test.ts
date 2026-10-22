import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { QR_LINKS_KEY, QR_SCANS_KEY, DEFAULT_QR_LINKS, viewOf } from '../src/modules/configuration/qr-links.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * QR links (owner, 2026-10-22: a jersey's QR code must stay the same while staff choose where it
 * leads). GET|PUT /admin/settings/qr-links for Admin and Operations (audited QR_LINKS_UPDATED);
 * the public GET /go/:code gives the destination and counts the scan. The stored rows and the
 * audit entries are put back afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

type SavedRow = { key: string; value: unknown; description: string | null };
let saved: SavedRow[] = [];
let testStart: Date;

const getLinks = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/qr-links').set(auth(token));
const putLinks = (body: unknown, token = tokens.admin) => request(app).put('/api/v1/admin/settings/qr-links').set(auth(token)).send(body as object);
const go = (code: string) => request(app).get(`/api/v1/go/${code}`);
const clearRows = () => pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [[QR_LINKS_KEY, QR_SCANS_KEY]]);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description FROM system_configurations WHERE key = ANY($1)', [[QR_LINKS_KEY, QR_SCANS_KEY]])).rows;
});

beforeEach(clearRows);

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'QR_LINKS_UPDATED' AND created_at >= $1`, [testStart]);
  await clearRows();
  for (const r of saved) {
    await pool.query('INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, $3)', [r.key, JSON.stringify(r.value), r.description]);
  }
});

describe('QR links', () => {
  it('with nothing saved the jersey code exists and leads to the shop with campaign tags', async () => {
    const res = await getLinks();
    expect(res.status).toBe(200);
    expect(res.body.data.links).toEqual([
      expect.objectContaining({ code: 'j', label: 'Jersey', scans_total: 0, scans_7_days: 0, scans_today: 0, last_scan_at: null }),
    ]);
    expect(res.body.data.links[0].url).toBe(DEFAULT_QR_LINKS[0]!.url);
    expect(res.body.data.links[0].url).toMatch(/^https:\/\/blynk\.lk\/app\/\?utm_source=jersey/);
    const scan = await go('j');
    expect(scan.status).toBe(200);
    expect(scan.body.data.url).toBe(DEFAULT_QR_LINKS[0]!.url);
  });

  it('staff change where a code leads and the very next scan follows (Ops too), never cached', async () => {
    const put = await putLinks({ links: [{ code: 'J', label: ' Jersey ', url: 'https://blynk.lk/?utm_source=jersey' }] }, opsToken);
    expect(put.status).toBe(200);
    expect(put.body.data.links[0]).toMatchObject({ code: 'j', label: 'Jersey', url: 'https://blynk.lk/?utm_source=jersey' });
    const scan = await go('j');
    expect(scan.body.data.url).toBe('https://blynk.lk/?utm_source=jersey');
    expect(scan.headers['cache-control']).toBe('no-store');
    // changed again: the same printed code now leads somewhere else
    await putLinks({ links: [{ code: 'j', label: 'Jersey', url: 'https://wa.me/94717107374' }] });
    expect((await go('j')).body.data.url).toBe('https://wa.me/94717107374');
    const audits = await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'QR_LINKS_UPDATED' AND created_at >= $1`, [testStart]);
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('counts scans per code, today / last 7 days / total, and keeps them when staff edit the links', async () => {
    await putLinks({ links: [{ code: 'j', label: 'Jersey', url: 'https://blynk.lk/app/' }, { code: 'poster-1', label: 'Poster', url: 'https://blynk.lk/' }] });
    await go('j');
    await go('j');
    await go('poster-1');
    await go('nope');
    await putLinks({ links: [{ code: 'j', label: 'Rider jersey', url: 'https://blynk.lk/app/' }, { code: 'poster-1', label: 'Poster', url: 'https://blynk.lk/' }] });
    const links = (await getLinks()).body.data.links;
    expect(links.find((l: { code: string }) => l.code === 'j')).toMatchObject({ label: 'Rider jersey', scans_total: 2, scans_today: 2, scans_7_days: 2 });
    expect(links.find((l: { code: string }) => l.code === 'poster-1')).toMatchObject({ scans_total: 1 });
    expect(links.find((l: { code: string }) => l.code === 'j').last_scan_at).toBeTruthy();
  });

  it('only the last 7 days count toward "7 days"; older scans stay in the total', () => {
    const now = new Date('2026-10-22T06:00:00Z');
    const day = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date(now.getTime() - n * 864e5));
    const v = viewOf(
      [{ code: 'j', label: 'Jersey', url: 'https://blynk.lk/' }],
      { j: { total: 14, last_at: now.toISOString(), days: { [day(0)]: 3, [day(6)]: 4, [day(7)]: 7 } } },
      now
    );
    expect(v[0]).toMatchObject({ scans_total: 14, scans_today: 3, scans_7_days: 7 });
  });

  it('an unknown or malformed code answers 404 (the page then opens the shop)', async () => {
    expect((await go('nope')).status).toBe(404);
    expect((await go('bad_code')).status).toBe(404);
    expect((await go('-x')).status).toBe(404);
  });

  it('a removed code stops working; the rest keep working', async () => {
    await putLinks({ links: [{ code: 'a', label: 'A', url: 'https://blynk.lk/a' }, { code: 'b', label: 'B', url: 'https://blynk.lk/b' }] });
    await putLinks({ links: [{ code: 'b', label: 'B', url: 'https://blynk.lk/b' }] });
    expect((await go('a')).status).toBe(404);
    expect((await go('b')).status).toBe(200);
  });

  it('refuses addresses a printed code must never lead to, and bad lists', async () => {
    const bad = async (links: unknown[]) => (await putLinks({ links })).status;
    expect(await bad([{ code: 'j', label: 'J', url: 'http://blynk.lk/' }])).toBe(400); // not https
    expect(await bad([{ code: 'j', label: 'J', url: 'javascript:alert(1)' }])).toBe(400);
    expect(await bad([{ code: 'j', label: 'J', url: 'https://user:pass@blynk.lk/' }])).toBe(400);
    expect(await bad([{ code: 'j', label: 'J', url: 'https://localhost/' }])).toBe(400); // no real host
    expect(await bad([{ code: 'j', label: 'J', url: 'blynk.lk' }])).toBe(400);
    expect(await bad([{ code: 'bad code', label: 'J', url: 'https://blynk.lk/' }])).toBe(400);
    expect(await bad([{ code: 'j', label: '', url: 'https://blynk.lk/' }])).toBe(400);
    expect(await bad([{ code: 'j', label: 'A', url: 'https://blynk.lk/' }, { code: 'J', label: 'B', url: 'https://blynk.lk/x' }])).toBe(400); // twice
    expect(await bad(Array.from({ length: 31 }, (_, i) => ({ code: `c${i}`, label: 'x', url: 'https://blynk.lk/' })))).toBe(400);
    // nothing bad was stored
    expect((await getLinks()).body.data.links).toHaveLength(1);
  });

  it('customers, riders and signed-out callers cannot read or change the list', async () => {
    expect((await getLinks(tokens.customer)).status).toBe(403);
    expect((await putLinks({ links: [] }, tokens.customer)).status).toBe(403);
    expect((await putLinks({ links: [] }, tokens.rider)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/qr-links')).status).toBe(401);
  });
});
