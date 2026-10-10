import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { env } from '../src/config/env.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { hashOtp } from '../src/modules/auth/otp.service.js';
import {
  riderDocumentSettings,
  settingsFrom,
  documentsFor,
  RIDER_DOCUMENTS_KEY,
} from '../src/modules/riders/rider.documents.settings.js';
import {
  riderDocumentService,
  expiryState,
  colomboToday,
  signApplicantToken,
  verifyApplicantToken,
} from '../src/modules/riders/rider.documents.js';
import {
  assertPrivateRoot,
  riderDocumentStore,
  sniffDocument,
  stripJpegLocation,
  stripPngLocation,
  stripWebpLocation,
} from '../src/modules/riders/rider.documents.files.js';
import { DateTime } from 'luxon';

/**
 * Rider documents (migration 039; owner, 2026-10-10): applicants upload a
 * Vehicle book, Revenue licence, Insurance certificate and Driving licence
 * (which ones are required per vehicle type is an Ops/Admin setting); Ops
 * and Admin verify or reject each one; approval needs every required one
 * verified (ADMIN-only override, audited). Files are private.
 *
 * Own throwaway users (phones +94770009500-9, emails @rider-docs.blynk.test),
 * files in a temporary directory; every row and file is removed afterwards
 * and the rider_documents setting row is restored.
 */
const PREFIX = '+9477000950';
const local = (n: string) => `077000950${n}`;
const EMAIL_DOMAIN = '@rider-docs.blynk.test';

// --- tiny files ---------------------------------------------------------------

/** A JPEG whose EXIF has an orientation and a GPS position, plus an XMP block with GPS. */
function jpegWithGps(): Buffer {
  const tiff = Buffer.alloc(92);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  // IFD0 at 8: 2 entries
  tiff.writeUInt16LE(2, 8);
  // Orientation = 6
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  // GPS IFD pointer -> 38
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(38, 30);
  tiff.writeUInt32LE(0, 34); // next IFD
  // GPS IFD at 38: 2 entries
  tiff.writeUInt16LE(2, 38);
  tiff.writeUInt16LE(0x0001, 40); // GPSLatitudeRef 'N'
  tiff.writeUInt16LE(2, 42);
  tiff.writeUInt32LE(2, 44);
  tiff.write('N\0', 48, 'latin1');
  tiff.writeUInt16LE(0x0002, 52); // GPSLatitude, 3 rationals at 68
  tiff.writeUInt16LE(5, 54);
  tiff.writeUInt32LE(3, 56);
  tiff.writeUInt32LE(68, 60);
  tiff.writeUInt32LE(0, 64);
  for (let i = 0; i < 6; i++) tiff.writeUInt32LE(0x11223344, 68 + i * 4);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16be(exif.length + 2), exif]);
  const xmpBody = Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><exif:GPSLatitude>6,25.5N</exif:GPSLatitude></x:xmpmeta>', 'latin1');
  const xmp = Buffer.concat([Buffer.from([0xff, 0xe1]), u16be(xmpBody.length + 2), xmpBody]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xcc, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, xmp, sos]);
}
function u16be(n: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
const PLAIN_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), Buffer.from([0xff, 0xd9])]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1')]);

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
function riffChunk(id: string, data: Buffer) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(id, 'latin1'), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

describe('Rider documents', () => {
  const app = createApp();
  const seededPacker = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const ids = { admin: '', ops: '', customer: '' };
  const tokens = { admin: '', ops: '', customer: '', packer: generateAccessToken(seededPacker) };
  let tmpRoot = '';
  let savedSetting: { value: unknown; description: string | null } | null = null;
  const originalRead = riderDocumentSettings.read;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const userIds = () => `(SELECT id FROM users WHERE phone LIKE '${PREFIX}%' OR email LIKE '%${EMAIL_DOMAIN}' OR id = ANY('{${ids.customer || '00000000-0000-0000-0000-000000000000'}}'::uuid[]))`;

  async function plantOtp(n: string, code = '246810') {
    await pool.query(`UPDATE otp_verifications SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL`, [`${PREFIX}${n}`]);
    await pool.query(
      `INSERT INTO otp_verifications (phone, otp_hash, purpose, attempts_count, max_attempts, expires_at)
       VALUES ($1, $2, 'LOGIN', 0, 5, now() + interval '5 minutes')`,
      [`${PREFIX}${n}`, await hashOtp(code)]
    );
    return code;
  }
  async function session(n: string) {
    const otp = await plantOtp(n);
    const res = await request(app).post('/api/v1/riders/applications/session').send({ phone: local(n), otp });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as { applicant_token: string; documents: unknown[]; document_types: unknown[]; application: unknown };
  }
  const put = (token: string, type: string, page: number, file: Buffer, name = 'doc.jpg', contentType = 'image/jpeg') =>
    request(app)
      .put(`/api/v1/riders/applications/documents/${type}/pages/${page}`)
      .set(auth(token))
      .attach('file', file, { filename: name, contentType });
  const me = (token: string) => request(app).get('/api/v1/riders/applications/me').set(auth(token));
  const details = (n: string, extra: Record<string, unknown> = {}) => ({
    full_name: `Doc Applicant ${n}`,
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: `wp-doc-${n}`,
    ...extra,
  });
  const submit = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/riders/applications/submit').set(auth(token)).send(body);
  const riderOf = async (n: string) =>
    (await pool.query(`SELECT r.* FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = $1`, [`${PREFIX}${n}`])).rows[0];
  const docsOf = async (riderId: string) =>
    (await pool.query(`SELECT *, to_char(expiry_date, 'YYYY-MM-DD') AS expiry FROM rider_documents WHERE rider_id = $1 ORDER BY doc_type`, [riderId])).rows;
  const inFuture = (days: number) => DateTime.fromISO(colomboToday()).plus({ days }).toISODate()!;

  /** Uploads every default-required document (driving licence front + back). */
  async function uploadAll(token: string) {
    expect((await put(token, 'VEHICLE_BOOK', 0, jpegWithGps())).status).toBe(200);
    expect((await put(token, 'REVENUE_LICENCE', 0, PLAIN_JPEG)).status).toBe(200);
    expect((await put(token, 'INSURANCE', 0, PDF, 'insurance.pdf', 'application/pdf')).status).toBe(200);
    expect((await put(token, 'DRIVING_LICENCE', 0, PLAIN_JPEG)).status).toBe(200);
    expect((await put(token, 'DRIVING_LICENCE', 1, PLAIN_JPEG)).status).toBe(200);
  }

  async function cleanup() {
    const users = userIds();
    const riders = `(SELECT id FROM riders WHERE user_id IN ${users})`;
    await pool.query(
      `DELETE FROM notifications WHERE user_id IN ${users} OR recipient LIKE '${PREFIX}%';
       DELETE FROM audit_logs WHERE entity_id IN ${users} OR entity_id IN ${riders} OR actor_user_id IN ${users}
         OR entity_id IN (SELECT id FROM rider_documents WHERE rider_id IN ${riders} OR draft_phone LIKE '${PREFIX}%');
       DELETE FROM rider_documents WHERE rider_id IN ${riders} OR draft_phone LIKE '${PREFIX}%';
       DELETE FROM riders WHERE user_id IN ${users};
       DELETE FROM refresh_tokens WHERE user_id IN ${users};
       DELETE FROM otp_verifications WHERE phone LIKE '${PREFIX}%';
       DELETE FROM users WHERE id IN ${users};`
    );
  }

  async function restoreSetting() {
    if (savedSetting) {
      await pool.query(
        `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description`,
        [RIDER_DOCUMENTS_KEY, JSON.stringify(savedSetting.value), savedSetting.description]
      );
    } else {
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    }
  }

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-rider-docs-'));
    riderDocumentStore.useRoot(tmpRoot);
    // The real setting (tests/setup/rider-documents.ts pins "none required").
    riderDocumentSettings.read = () => riderDocumentSettings.realRead();
    const saved = await pool.query(`SELECT value, description FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    savedSetting = saved.rows[0] ?? null;
    await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]); // the defaults
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, email, full_name, role) VALUES
         ('${PREFIX}0', 'admin${EMAIL_DOMAIN}', 'RD Admin', 'ADMIN'),
         ('${PREFIX}1', 'ops${EMAIL_DOMAIN}', 'RD Operator', 'OPERATIONS'),
         ('${PREFIX}2', NULL, 'RD Customer', 'CUSTOMER')
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    Object.assign(ids, { admin: id('0'), ops: id('1'), customer: id('2') });
    tokens.admin = generateAccessToken({ id: ids.admin, phone: `${PREFIX}0`, role: 'ADMIN' });
    tokens.ops = generateAccessToken({ id: ids.ops, phone: `${PREFIX}1`, role: 'OPERATIONS' });
    tokens.customer = generateAccessToken({ id: ids.customer, phone: `${PREFIX}2`, role: 'CUSTOMER' });
  });

  beforeEach(() => authRateLimiter.reset());

  afterAll(async () => {
    await cleanup();
    await restoreSetting();
    riderDocumentSettings.read = originalRead;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  describe('migration 039', () => {
    it('creates rider_documents with its checks', async () => {
      const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'rider_documents'`);
      expect(cols.rows.map((c) => c.column_name).sort()).toEqual(
        [
          'id', 'rider_id', 'draft_phone', 'doc_type', 'custom_name', 'images', 'expiry_date', 'status',
          'reject_reason', 'reject_note', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at',
        ].sort()
      );
      // Exactly one owner: neither, or both, is refused.
      await expect(pool.query(`INSERT INTO rider_documents (doc_type) VALUES ('INSURANCE')`)).rejects.toThrow();
      await expect(
        pool.query(`INSERT INTO rider_documents (draft_phone, doc_type, status) VALUES ('${PREFIX}9', 'INSURANCE', 'MAYBE')`)
      ).rejects.toThrow();
      await expect(
        pool.query(`INSERT INTO rider_documents (draft_phone, doc_type, reject_reason) VALUES ('${PREFIX}9', 'INSURANCE', 'UGLY')`)
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  describe('settings', () => {
    it('defaults: all four required for motor vehicles, none for a bicycle; expiry for licence/insurance/driving licence', async () => {
      const s = settingsFrom(null);
      expect(s.documents.map((d) => d.key)).toEqual(['VEHICLE_BOOK', 'REVENUE_LICENCE', 'INSURANCE', 'DRIVING_LICENCE']);
      expect(documentsFor(s, 'MOTORCYCLE').every((d) => d.required)).toBe(true);
      expect(documentsFor(s, 'CAR').every((d) => d.required)).toBe(true);
      expect(documentsFor(s, 'BICYCLE').some((d) => d.required)).toBe(false);
      expect(s.documents.filter((d) => d.needs_expiry).map((d) => d.key)).toEqual(['REVENUE_LICENCE', 'INSURANCE', 'DRIVING_LICENCE']);
      expect(s.documents.find((d) => d.key === 'DRIVING_LICENCE')!.needs_back).toBe(true);
      // A malformed row is the defaults.
      expect(settingsFrom({ documents: 'nope' })).toEqual(s);
    });

    it('GET/PUT for ADMIN and OPERATIONS only; adds a custom document; audited', async () => {
      for (const token of [tokens.customer, tokens.packer]) {
        expect((await request(app).get('/api/v1/admin/settings/rider-documents').set(auth(token))).status).toBe(403);
      }
      expect((await request(app).get('/api/v1/admin/settings/rider-documents')).status).toBe(401);
      const got = await request(app).get('/api/v1/admin/settings/rider-documents').set(auth(tokens.ops));
      expect(got.status).toBe(200);
      expect(got.body.data.settings.documents).toHaveLength(4);

      const bad = await request(app)
        .put('/api/v1/admin/settings/rider-documents')
        .set(auth(tokens.ops))
        .send({ documents: [{ required_for: ['MOTORCYCLE'], needs_expiry: false }] });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.map((d: { field: string }) => d.field)).toContain('documents.0.label');
      const badVehicle = await request(app)
        .put('/api/v1/admin/settings/rider-documents')
        .set(auth(tokens.ops))
        .send({ documents: [{ key: 'INSURANCE', required_for: ['TRUCK'], needs_expiry: true }] });
      expect(badVehicle.status).toBe(400);

      const res = await request(app)
        .put('/api/v1/admin/settings/rider-documents')
        .set(auth(tokens.ops))
        .send({
          documents: [
            { key: 'VEHICLE_BOOK', enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: false, needs_back: false },
            { key: 'INSURANCE', enabled: true, required_for: ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'], needs_expiry: true, needs_back: false },
            { label: 'Police clearance', enabled: true, required_for: ['BICYCLE'], needs_expiry: false, needs_back: false },
          ],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const docs = res.body.data.settings.documents as Array<{ key: string; label: string; builtin: boolean; required_for: string[] }>;
      // Built-ins left out keep their stored values; the custom one gets a key.
      expect(docs.map((d) => d.key).slice(0, 4)).toEqual(['VEHICLE_BOOK', 'REVENUE_LICENCE', 'INSURANCE', 'DRIVING_LICENCE']);
      const custom = docs[4];
      expect(custom).toMatchObject({ label: 'Police clearance', builtin: false, required_for: ['BICYCLE'] });
      expect(custom.key).toMatch(/^CUSTOM_[A-Z0-9]{8}$/);
      const audit = await pool.query(
        `SELECT new_values FROM audit_logs WHERE action = 'RIDER_DOCUMENT_SETTINGS_UPDATED' AND actor_user_id = $1`,
        [ids.ops]
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].new_values.documents).toHaveLength(5);
      // Back to the defaults for the flows below.
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    });
  });

  // ==========================================================================
  describe('files', () => {
    it('blanks EXIF GPS (keeping orientation) and drops XMP from JPEGs', () => {
      const original = jpegWithGps();
      expect(original.indexOf(Buffer.from([0x44, 0x33, 0x22, 0x11]))).toBeGreaterThan(0);
      const out = stripJpegLocation(original);
      expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(out.indexOf(Buffer.from([0x44, 0x33, 0x22, 0x11]))).toBe(-1);
      expect(out.toString('latin1')).not.toContain('GPSLatitude');
      // Orientation tag (0x0112 = 6) is still there; the image data too.
      expect(out.indexOf(Buffer.from([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00]))).toBeGreaterThan(0);
      expect(out.subarray(-5)).toEqual(Buffer.from([0xaa, 0xbb, 0xcc, 0xff, 0xd9]));
    });

    it('drops PNG eXIf and WebP EXIF/XMP chunks', () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', Buffer.alloc(13)),
        chunk('eXIf', Buffer.from('GPSDATA')),
        chunk('IEND', Buffer.alloc(0)),
      ]);
      const p = stripPngLocation(png);
      expect(p.toString('latin1')).not.toContain('eXIf');
      expect(p.toString('latin1')).toContain('IEND');

      const vp8x = Buffer.alloc(10);
      vp8x[0] = 0x0c;
      const body = Buffer.concat([riffChunk('VP8X', vp8x), riffChunk('VP8 ', Buffer.alloc(10)), riffChunk('EXIF', Buffer.from('GPSDATA'))]);
      const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
      head.writeUInt32LE(body.length + 4, 4);
      const w = stripWebpLocation(Buffer.concat([head, body]));
      expect(w.toString('latin1')).not.toContain('GPSDATA');
      expect(w.readUInt32LE(4)).toBe(w.length - 8);
      expect(w[20] & 0x0c).toBe(0);
    });

    it('recognises types by content; HEIC is detected (to refuse it)', () => {
      expect(sniffDocument(PLAIN_JPEG)).toEqual({ type: 'image/jpeg' });
      expect(sniffDocument(PDF)).toEqual({ type: 'application/pdf' });
      expect(sniffDocument(HEIC)).toEqual({ heic: true });
      expect(sniffDocument(Buffer.from('hello world, not an image'))).toBeNull();
    });

    it('the private root may not sit inside the public media folder', () => {
      expect(() => assertPrivateRoot('uploads', 'uploads/rider-documents')).toThrow(/private/);
      expect(() => assertPrivateRoot(env.MEDIA_ROOT, 'private/rider-documents')).not.toThrow();
    });
  });

  // ==========================================================================
  describe('applicant session', () => {
    it('an SMS code gives an applicant token that is not a sign-in token (and vice versa)', async () => {
      const s = await session('5');
      expect(s.application).toBeNull();
      expect(s.documents).toEqual([]);
      expect(s.document_types).toHaveLength(4);
      expect(verifyApplicantToken(s.applicant_token)).toBe(`${PREFIX}5`);
      // Not accepted where a sign-in is needed...
      expect((await request(app).get('/api/v1/auth/me').set(auth(s.applicant_token))).status).toBe(401);
      expect((await request(app).get('/api/v1/admin/rider-applications').set(auth(s.applicant_token))).status).toBe(401);
      // ...and a sign-in token is not an applicant session.
      const res = await me(tokens.customer);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('APPLICANT_SESSION_REQUIRED');
      // The code was consumed.
      const again = await request(app).post('/api/v1/riders/applications/session').send({ phone: local('5'), otp: '246810' });
      expect(again.status).toBe(401);
    });

    it('refuses staff numbers before spending the code', async () => {
      const otp = await plantOtp('1');
      const res = await request(app).post('/api/v1/riders/applications/session').send({ phone: local('1'), otp });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STAFF_CAN_DELIVER');
    });
  });

  // ==========================================================================
  describe('the full flow (MOTORCYCLE)', () => {
    let token = '';
    let riderId = '';

    it('uploads are validated: type, HEIC, size, page order, unknown document', async () => {
      token = (await session('5')).applicant_token;
      const text = await put(token, 'VEHICLE_BOOK', 0, Buffer.from('this is not an image at all'), 'a.jpg');
      expect(text.status).toBe(415);
      const heic = await put(token, 'VEHICLE_BOOK', 0, HEIC, 'a.heic', 'image/heic');
      expect(heic.status).toBe(415);
      expect(heic.body.error.message).toMatch(/HEIC/);
      const big = await put(token, 'VEHICLE_BOOK', 0, Buffer.concat([PLAIN_JPEG, Buffer.alloc(8 * 1024 * 1024)]));
      expect(big.status).toBe(413);
      expect(big.body.error.code).toBe('FILE_TOO_LARGE');
      const back = await put(token, 'DRIVING_LICENCE', 1, PLAIN_JPEG);
      expect(back.status).toBe(400);
      expect(back.body.error.code).toBe('DOCUMENT_PAGE_ORDER');
      expect((await put(token, 'PASSPORT', 0, PLAIN_JPEG)).status).toBe(404);
      expect((await put(token, 'VEHICLE_BOOK', 2, PLAIN_JPEG)).status).toBe(400);
      expect((await request(app).put('/api/v1/riders/applications/documents/VEHICLE_BOOK/pages/0').attach('file', PLAIN_JPEG, 'a.jpg')).status).toBe(401);
      const none = await pool.query(`SELECT count(*)::int AS n FROM rider_documents WHERE draft_phone = $1`, [`${PREFIX}5`]);
      expect(none.rows[0].n).toBe(0);
    });

    it('cannot send the application until every required document is uploaded', async () => {
      const res = await submit(token, details('5'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DOCUMENTS_REQUIRED');
      expect(res.body.error.details.missing.map((m: { key: string }) => m.key)).toEqual([
        'VEHICLE_BOOK',
        'REVENUE_LICENCE',
        'INSURANCE',
        'DRIVING_LICENCE',
      ]);
      // Nothing was created.
      expect(await riderOf('5')).toBeUndefined();
      expect((await pool.query(`SELECT 1 FROM users WHERE phone = $1`, [`${PREFIX}5`])).rows).toHaveLength(0);
    });

    it('stores drafts privately (outside /uploads), without GPS; retake replaces the file; front+back needed', async () => {
      await uploadAll(token);
      // Retake the vehicle book: the old file is removed.
      const before = (await pool.query(`SELECT id, images FROM rider_documents WHERE draft_phone = $1 AND doc_type = 'VEHICLE_BOOK'`, [`${PREFIX}5`])).rows[0];
      const oldKey = before.images[0].key as string;
      expect(fs.existsSync(path.join(tmpRoot, oldKey))).toBe(true);
      const stored = fs.readFileSync(path.join(tmpRoot, oldKey));
      expect(stored.indexOf(Buffer.from([0x44, 0x33, 0x22, 0x11]))).toBe(-1);
      expect(path.resolve(tmpRoot, oldKey).startsWith(path.resolve(env.MEDIA_ROOT))).toBe(false);
      const retake = await put(token, 'VEHICLE_BOOK', 0, PLAIN_JPEG);
      expect(retake.status).toBe(200);
      expect(retake.body.data.document).toMatchObject({ doc_type: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', status: 'PENDING' });
      expect(retake.body.data.document.pages).toHaveLength(1);
      expect(JSON.stringify(retake.body.data.document)).not.toContain(tmpRoot.slice(-8)); // no storage keys leak
      expect(fs.existsSync(path.join(tmpRoot, oldKey))).toBe(false);
      // Not reachable through the public media route.
      expect((await request(app).get(`/uploads/${oldKey}`)).status).toBe(404);

      // An optional expiry date.
      const expiry = await request(app)
        .patch('/api/v1/riders/applications/documents/INSURANCE')
        .set(auth(token))
        .send({ expiry_date: inFuture(200) });
      expect(expiry.status).toBe(200);
      expect(expiry.body.data.document.expiry_date).toBe(inFuture(200));
      const badDate = await request(app)
        .patch('/api/v1/riders/applications/documents/INSURANCE')
        .set(auth(token))
        .send({ expiry_date: '2027-02-30' });
      expect(badDate.status).toBe(400);

      // Remove the back of the driving licence: the application needs it again.
      const removed = await request(app).delete('/api/v1/riders/applications/documents/DRIVING_LICENCE/pages/1').set(auth(token));
      expect(removed.status).toBe(200);
      expect(removed.body.data.document.pages).toHaveLength(1);
      const short = await submit(token, details('5'));
      expect(short.status).toBe(400);
      expect(short.body.error.details.missing).toEqual([{ key: 'DRIVING_LICENCE', label: 'Driving licence', problem: 'BACK_MISSING' }]);
      expect((await put(token, 'DRIVING_LICENCE', 1, PLAIN_JPEG)).status).toBe(200);

      // The applicant can read their own page back (private, no-store).
      const own = await request(app).get('/api/v1/riders/applications/documents/INSURANCE/pages/0').set(auth(token));
      expect(own.status).toBe(200);
      expect(own.headers['content-type']).toBe('application/pdf');
      expect(own.headers['cache-control']).toContain('no-store');
      expect(own.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sends the application: drafts move onto the riders row', async () => {
      const res = await submit(token, details('5'));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const rider = await riderOf('5');
      riderId = rider.id;
      expect(rider.approval_status).toBe('PENDING');
      const docs = await docsOf(riderId);
      expect(docs.map((d) => d.doc_type)).toEqual(['DRIVING_LICENCE', 'INSURANCE', 'REVENUE_LICENCE', 'VEHICLE_BOOK']);
      expect(docs.every((d) => d.draft_phone === null)).toBe(true);
      const drafts = await pool.query(`SELECT count(*)::int AS n FROM rider_documents WHERE draft_phone = $1`, [`${PREFIX}5`]);
      expect(drafts.rows[0].n).toBe(0);
      // The session now shows the application.
      const state = await me(token);
      expect(state.body.data.application).toMatchObject({ id: riderId, status: 'PENDING', vehicle_type: 'MOTORCYCLE' });
      expect(state.body.data.documents).toHaveLength(4);
    });

    it('Rider requests list each document and block Approve until verified', async () => {
      const list = await request(app).get('/api/v1/admin/rider-applications?limit=100').set(auth(tokens.ops));
      const mine = (list.body.data.applications as Array<Record<string, unknown>>).find((a) => a.id === riderId)!;
      expect(mine.documents_verified).toBe(false);
      expect((mine.documents as unknown[]).length).toBe(4);
      expect((mine.documents_blocking as Array<{ key: string }>).map((b) => b.key).sort()).toEqual(
        ['DRIVING_LICENCE', 'INSURANCE', 'REVENUE_LICENCE', 'VEHICLE_BOOK'].sort()
      );

      const detail = await request(app).get(`/api/v1/admin/riders/${riderId}/documents`).set(auth(tokens.admin));
      expect(detail.status).toBe(200);
      expect(detail.body.data.requirements.every((r: { required: boolean }) => r.required)).toBe(true);
      expect((await request(app).get(`/api/v1/admin/riders/${riderId}/documents`).set(auth(tokens.customer))).status).toBe(403);

      const approve = await request(app).post(`/api/v1/admin/rider-applications/${riderId}/approve`).set(auth(tokens.ops)).send({});
      expect(approve.status).toBe(409);
      expect(approve.body.error.code).toBe('DOCUMENTS_NOT_VERIFIED');
      // Operations cannot "approve anyway".
      const override = await request(app)
        .post(`/api/v1/admin/rider-applications/${riderId}/approve`)
        .set(auth(tokens.ops))
        .send({ override_documents: true, override_reason: 'Known to us' });
      expect(override.status).toBe(403);
      expect(override.body.error.code).toBe('OVERRIDE_ADMIN_ONLY');
      const noReason = await request(app)
        .post(`/api/v1/admin/rider-applications/${riderId}/approve`)
        .set(auth(tokens.admin))
        .send({ override_documents: true });
      expect(noReason.status).toBe(400);
    });

    it('staff open pages privately: ADMIN/OPERATIONS only, no-store', async () => {
      const doc = (await docsOf(riderId)).find((d) => d.doc_type === 'VEHICLE_BOOK')!;
      const page = await request(app).get(`/api/v1/admin/rider-documents/${doc.id}/pages/0`).set(auth(tokens.ops));
      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toBe('image/jpeg');
      expect(page.headers['cache-control']).toContain('no-store');
      expect(Buffer.from(page.body).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect((await request(app).get(`/api/v1/admin/rider-documents/${doc.id}/pages/0`).set(auth(tokens.customer))).status).toBe(403);
      expect((await request(app).get(`/api/v1/admin/rider-documents/${doc.id}/pages/0`)).status).toBe(401);
      expect((await request(app).get(`/api/v1/admin/rider-documents/${doc.id}/pages/1`).set(auth(tokens.ops))).status).toBe(404);
      // Another applicant's session cannot see it.
      const other = (await session('6')).applicant_token;
      expect((await request(app).get('/api/v1/riders/applications/documents/VEHICLE_BOOK/pages/0').set(auth(other))).status).toBe(404);
    });

    it('verify needs an expiry date where required and refuses expired ones; reject needs a reason', async () => {
      const docs = await docsOf(riderId);
      const by = (t: string) => docs.find((d) => d.doc_type === t)!.id as string;
      const verify = (id: string, body: Record<string, unknown> = {}) =>
        request(app).post(`/api/v1/admin/rider-documents/${id}/verify`).set(auth(tokens.ops)).send(body);
      const reject = (id: string, body: Record<string, unknown>) =>
        request(app).post(`/api/v1/admin/rider-documents/${id}/reject`).set(auth(tokens.ops)).send(body);

      const noExpiry = await verify(by('REVENUE_LICENCE'));
      expect(noExpiry.status).toBe(400);
      expect(noExpiry.body.error.code).toBe('EXPIRY_REQUIRED');
      const expired = await verify(by('REVENUE_LICENCE'), { expiry_date: inFuture(-1) });
      expect(expired.status).toBe(409);
      expect(expired.body.error.code).toBe('DOCUMENT_EXPIRED');

      expect((await verify(by('VEHICLE_BOOK'))).status).toBe(200);
      const rl = await verify(by('REVENUE_LICENCE'), { expiry_date: inFuture(300) });
      expect(rl.status).toBe(200);
      expect(rl.body.data.document).toMatchObject({ status: 'VERIFIED', expiry_date: inFuture(300), expiry_state: 'OK' });
      // Insurance kept the applicant's own date.
      expect((await verify(by('INSURANCE'))).body.data.document).toMatchObject({ status: 'VERIFIED', expiry_date: inFuture(200) });

      expect((await reject(by('DRIVING_LICENCE'), { reason: 'OTHER' })).status).toBe(400);
      expect((await reject(by('DRIVING_LICENCE'), { reason: 'UGLY' })).status).toBe(400);
      const rejected = await reject(by('DRIVING_LICENCE'), { reason: 'BLURRY', note: 'Front is out of focus' });
      expect(rejected.status).toBe(200);
      expect(rejected.body.data.document).toMatchObject({ status: 'REJECTED', reject_reason: 'BLURRY', reject_note: 'Front is out of focus' });

      const audit = await pool.query(
        `SELECT action, count(*)::int AS n FROM audit_logs WHERE actor_user_id = $1 AND entity_type = 'RIDER_DOCUMENT' GROUP BY action ORDER BY action`,
        [ids.ops]
      );
      expect(audit.rows).toEqual([
        { action: 'RIDER_DOCUMENT_REJECTED', n: 1 },
        { action: 'RIDER_DOCUMENT_VERIFIED', n: 3 },
      ]);
    });

    it('the applicant sees which document was rejected and why, and re-uploads just that one', async () => {
      const state = await me(token);
      const dl = (state.body.data.documents as Array<Record<string, unknown>>).find((d) => d.doc_type === 'DRIVING_LICENCE')!;
      expect(dl).toMatchObject({
        status: 'REJECTED',
        reject_reason: 'BLURRY',
        reject_reason_label: 'The photo is blurry or hard to read',
        reject_note: 'Front is out of focus',
      });
      const again = await put(token, 'DRIVING_LICENCE', 0, PLAIN_JPEG);
      expect(again.status).toBe(200);
      expect(again.body.data.document).toMatchObject({ status: 'PENDING', reject_reason: null, reject_note: null });
      // The others stay verified.
      const docs = await docsOf(riderId);
      expect(docs.filter((d) => d.status === 'VERIFIED').map((d) => d.doc_type).sort()).toEqual(['INSURANCE', 'REVENUE_LICENCE', 'VEHICLE_BOOK']);
      const uploadAudit = await pool.query(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'RIDER_DOCUMENT_UPLOADED' AND entity_id = $1`,
        [docs.find((d) => d.doc_type === 'DRIVING_LICENCE')!.id]
      );
      expect(uploadAudit.rows[0].n).toBe(1); // drafts of a new number have no account to audit
    });

    it('approves once every required document is verified', async () => {
      const dl = (await docsOf(riderId)).find((d) => d.doc_type === 'DRIVING_LICENCE')!;
      expect(
        (await request(app).post(`/api/v1/admin/rider-documents/${dl.id}/verify`).set(auth(tokens.ops)).send({ expiry_date: inFuture(20) })).status
      ).toBe(200);
      const approve = await request(app).post(`/api/v1/admin/rider-applications/${riderId}/approve`).set(auth(tokens.ops)).send({});
      expect(approve.status, JSON.stringify(approve.body)).toBe(200);
      expect(approve.body.data.application.approval_status).toBe('APPROVED');
    });

    it('expiry alerts: approved riders with documents expired or expiring within 30 days', async () => {
      const ins = (await docsOf(riderId)).find((d) => d.doc_type === 'INSURANCE')!;
      await pool.query(`UPDATE rider_documents SET expiry_date = $1 WHERE id = $2`, [inFuture(-3), ins.id]);
      const res = await request(app).get('/api/v1/admin/rider-documents/alerts').set(auth(tokens.ops));
      expect(res.status).toBe(200);
      const mine = (res.body.data.alerts as Array<Record<string, unknown>>).filter((a) => a.rider_id === riderId);
      expect(mine).toEqual([
        expect.objectContaining({ doc_type: 'INSURANCE', is_insurance: true, expiry_state: 'EXPIRED', expiry_date: inFuture(-3) }),
        expect.objectContaining({ doc_type: 'DRIVING_LICENCE', is_insurance: false, expiry_state: 'EXPIRING', expiry_date: inFuture(20) }),
      ]);
      expect((await request(app).get('/api/v1/admin/rider-documents/alerts').set(auth(tokens.customer))).status).toBe(403);
      expect(expiryState(inFuture(31))).toBe('OK');
      expect(expiryState(inFuture(30))).toBe('EXPIRING');
    });
  });

  // ==========================================================================
  describe('other vehicles and paths', () => {
    it('a BICYCLE needs no documents by default', async () => {
      const token = (await session('6')).applicant_token;
      const res = await submit(token, details('6', { vehicle_type: 'BICYCLE', vehicle_registration_number: '' }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const rider = await riderOf('6');
      const review = await riderDocumentService.forRider(rider.id);
      expect(review.all_required_verified).toBe(true);
      expect(review.requirements.every((r) => !r.required)).toBe(true);
    });

    it('the old phone + code endpoint is refused too while documents are required', async () => {
      const otp = await plantOtp('9');
      const res = await request(app)
        .post('/api/v1/riders/applications')
        .send({ phone: local('9'), otp, ...details('9') });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DOCUMENTS_REQUIRED');
      // The code was not spent.
      const unspent = await pool.query(`SELECT count(*)::int AS n FROM otp_verifications WHERE phone = $1 AND consumed_at IS NULL`, [`${PREFIX}9`]);
      expect(unspent.rows[0].n).toBe(1);
    });

    it('an ADMIN may approve anyway, with a reason, audited', async () => {
      const token = (await session('7')).applicant_token;
      await uploadAll(token);
      expect((await submit(token, details('7'))).status).toBe(201);
      const rider = await riderOf('7');
      const res = await request(app)
        .post(`/api/v1/admin/rider-applications/${rider.id}/approve`)
        .set(auth(tokens.admin))
        .send({ override_documents: true, override_reason: 'Documents checked in person at the store' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const audit = await pool.query(
        `SELECT action, new_values FROM audit_logs WHERE entity_id = $1 AND action IN ('RIDER_APPROVED', 'RIDER_APPROVAL_DOCUMENTS_OVERRIDDEN') ORDER BY action`,
        [rider.id]
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['RIDER_APPROVAL_DOCUMENTS_OVERRIDDEN', 'RIDER_APPROVED']);
      expect(audit.rows[1].new_values.documents_override.reason).toBe('Documents checked in person at the store');
      expect(audit.rows[1].new_values.documents_override.blocking).toHaveLength(4);
    });

    it('deleting an application deletes its documents and files', async () => {
      const token = (await session('8')).applicant_token;
      await uploadAll(token);
      expect((await submit(token, details('8'))).status).toBe(201);
      const rider = await riderOf('8');
      const docIds = (await docsOf(rider.id)).map((d) => d.id as string);
      expect(docIds.every((id) => fs.existsSync(path.join(tmpRoot, id)))).toBe(true);
      expect((await request(app).delete(`/api/v1/admin/rider-applications/${rider.id}`).set(auth(tokens.customer))).status).toBe(403);
      const res = await request(app).delete(`/api/v1/admin/rider-applications/${rider.id}`).set(auth(tokens.ops));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: true, documents_removed: 4 });
      expect(await riderOf('8')).toBeUndefined();
      expect((await pool.query(`SELECT count(*)::int AS n FROM rider_documents WHERE id = ANY($1)`, [docIds])).rows[0].n).toBe(0);
      expect(docIds.some((id) => fs.existsSync(path.join(tmpRoot, id)))).toBe(false);
      // An approved rider is not deleted here.
      const approved = await riderOf('5');
      expect((await request(app).delete(`/api/v1/admin/rider-applications/${approved.id}`).set(auth(tokens.ops))).status).toBe(409);
    });

    it('deleting a customer account deletes its rider documents (drafts too)', async () => {
      const token = (await session('2')).applicant_token;
      expect((await put(token, 'INSURANCE', 0, PLAIN_JPEG)).status).toBe(200);
      const draft = (await pool.query(`SELECT id FROM rider_documents WHERE draft_phone = $1`, [`${PREFIX}2`])).rows[0];
      expect(fs.existsSync(path.join(tmpRoot, draft.id))).toBe(true);
      const res = await request(app).delete('/api/v1/me').set(auth(tokens.customer));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await pool.query(`SELECT 1 FROM rider_documents WHERE id = $1`, [draft.id])).rows).toHaveLength(0);
      expect(fs.existsSync(path.join(tmpRoot, draft.id))).toBe(false);
    });

    it('the sweep removes stale drafts and orphaned files', async () => {
      const token = (await session('3')).applicant_token;
      expect((await put(token, 'VEHICLE_BOOK', 0, PLAIN_JPEG)).status).toBe(200);
      const draft = (await pool.query(`SELECT id FROM rider_documents WHERE draft_phone = $1`, [`${PREFIX}3`])).rows[0];
      await pool.query(`UPDATE rider_documents SET updated_at = now() - interval '15 days' WHERE id = $1`, [draft.id]);
      const orphan = '00000000-0000-4000-8000-00000000abcd';
      fs.mkdirSync(path.join(tmpRoot, orphan));
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(path.join(tmpRoot, orphan), old, old);
      const result = await riderDocumentService.sweep();
      expect(result.drafts_removed).toBeGreaterThanOrEqual(1);
      expect(result.orphans_removed).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(path.join(tmpRoot, draft.id))).toBe(false);
      expect(fs.existsSync(path.join(tmpRoot, orphan))).toBe(false);
      // Files of live documents stay.
      const live = (await docsOf((await riderOf('5')).id)).map((d) => d.id as string);
      expect(live.every((id) => fs.existsSync(path.join(tmpRoot, id)))).toBe(true);
    });

    it('applicant tokens are signed with their own key and expire', () => {
      const t = signApplicantToken(`${PREFIX}4`);
      expect(verifyApplicantToken(t)).toBe(`${PREFIX}4`);
      expect(() => verifyApplicantToken(tokens.admin)).toThrow();
      expect(() => verifyApplicantToken(`${t}x`)).toThrow();
    });
  });
});
